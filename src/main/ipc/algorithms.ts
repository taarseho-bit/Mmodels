/**
 * 算法市场 + Python 运行时管理。
 *
 * 原版语义（从 renderer ExtensionsPage chunk 与主进程字符串还原）：
 *   - 目录三个来源：remote（远端拉取）/ cache（上次缓存）/ bundled（随包内置）
 *     本地版直接用 **bundled**（resources/algorithms/catalog.json），离线可用 —— 这是既定的优化。
 *   - 条目字段：task 分类（decision/prediction/classification/clustering/optimization/
 *     multiObjective/statistics）、packageName/versionRange、license、suitableFor/inputs/outputs/notFor、docs
 *   - Python 运行时状态机：ready / installable / no-python / broken
 *   - 原版有 /install-python 服务路由：下载官方安装器静默安装。
 *     本地版走 **npmmirror 镜像**（官方源在本机不通，见项目记忆）。
 *
 * 安装状态机：对每个 unique packageName 用 `python -c "import ..."` 探测（比 pip show 快且准）。
 */
import { ipcMain } from 'electron';
import { spawn, execFile } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { get as httpsGet } from 'node:https';
import { IPC } from '@shared/types';
import { findPython } from '../scan/environment';
import { resolveResource } from '../resources';
import { sharedEnvironmentRoot, sharedPythonPath, sharedRuntimeEnv } from '../runtime/shared-environment';
import { pushToRenderer, safeWrap, type IpcContext } from './index';

type IpcCtx = IpcContext;

// ── 类型 ─────────────────────────────────────────────────────

interface CatalogEntry {
  id: string;
  name: string;
  task: string;
  packageName: string;
  versionRange: string;
  license: string;
  summary: string;
  suitableFor: string[];
  inputs: string[];
  outputs: string[];
  notFor: string[];
  docs: string;
}

interface CatalogFile {
  version: number;
  source: string;
  algorithms: CatalogEntry[];
}

type RuntimeState = 'ready' | 'installable' | 'no-python' | 'broken';

// ── 内部工具 ─────────────────────────────────────────────────

function catalogPath(): string {
  const found = resolveResource(['algorithms', 'catalog.json']);
  if (found) return found;
  throw new Error('没有找到内置算法资源。请重新打开应用；如果仍未恢复，请重新下载最新版免安装包。');
}

function loadCatalog(): CatalogFile {
  return JSON.parse(readFileSync(catalogPath(), 'utf8')) as CatalogFile;
}

/** execFile 的 Promise 化（超时保护） */
function execFileP(cmd: string, args: string[], timeout = 15000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      const out = String(stdout ?? '') + String(stderr ?? '');
      resolve({ code: err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0, out });
    });
  });
}

/** Python 运行时状态机（对应原版 runtimeReady / runtimeInstallable / runtimeNoPython / runtimeBroken） */
async function pythonRuntime(): Promise<{ state: RuntimeState; cmd: string | null; version: string; pipOk: boolean }> {
  // ⚠️ `await`：`findPython` 会**逐个候选试**（见其注释），不再是同步取候选表首项
  const py = await findPython();
  if (!py) return { state: 'no-python', cmd: null, version: '', pipOk: false };
  const v = await execFileP(py.cmd, [...py.prefixArgs, '--version'], 10000);
  if (v.code !== 0 || !/python\s+3/i.test(v.out)) return { state: 'broken', cmd: py.cmd, version: '', pipOk: false };
  const version = (v.out.match(/python\s+(\S+)/i)?.[1] ?? '').trim();
  const pip = await execFileP(py.cmd, [...py.prefixArgs, '-m', 'pip', '--version'], 15000);
  return { state: 'ready', cmd: py.cmd, version, pipOk: pip.code === 0 };
}

/** 探测某个包是否已安装（python -c "import ..."，按 pip 包名 → import 名的常见差异兜底） */
const IMPORT_NAME: Record<string, string> = {
  'scikit-learn': 'sklearn',
  'python-dateutil': 'dateutil',
  'pymoo': 'pymoo',
  xgboost: 'xgboost',
  pyswarms: 'pyswarms',
  statsmodels: 'statsmodels',
  networkx: 'networkx',
  pulp: 'pulp',
};

async function probePackage(py: { cmd: string; prefixArgs: string[] }, packageName: string): Promise<boolean> {
  const imp = IMPORT_NAME[packageName] ?? packageName.replace(/-/g, '_');
  const r = await execFileP(py.cmd, [...py.prefixArgs, '-c', `import ${imp}`], 20000);
  return r.code === 0;
}

// ── 安装队列（防并发）─────────────────────────────────────────

let installing = false;

/** 追加一行安装日志推给渲染层 */
function logProgress(line: string): void {
  pushToRenderer(IPC.ALG_INSTALL_PROGRESS, { line });
}

// ── 探测缓存：串行 import 探测太慢（13 包可拖 10s+），并行 + 60s TTL ──

interface CacheEntry {
  at: number;
  data: unknown;
}
let runtimeCache: CacheEntry | null = null;
const probeCache = new Map<string, CacheEntry>();
const PROBE_TTL = 60_000;

function cacheGet(e: CacheEntry | null | undefined): unknown | null {
  return e && Date.now() - e.at < PROBE_TTL ? e.data : null;
}

// ── 注册 ─────────────────────────────────────────────────────

export function registerAlgorithmHandlers(_ctx: IpcCtx): void {
  /** 目录 + 安装状态（对应原版 GET /api/algorithms） */
  ipcMain.handle(
    IPC.ALG_LIST,
    safeWrap(async () => {
      const catalog = loadCatalog();

      // 并行探测 + 会话缓存：串行逐包 import 会把列表拖到 10s+
      const cachedRuntime = cacheGet(runtimeCache) as Awaited<ReturnType<typeof pythonRuntime>> | null;
      const runtime = cachedRuntime ?? (await pythonRuntime());
      runtimeCache = { at: Date.now(), data: runtime };
      const py = await findPython();

      const pkgs = [...new Set(catalog.algorithms.map((a) => a.packageName))];
      const installedMap = new Map<string, string>();
      if (py && runtime.state === 'ready') {
        await Promise.all(
          pkgs.map(async (p) => {
            const hit = cacheGet(probeCache.get(p));
            if (hit !== null) {
              installedMap.set(p, hit as string);
              return;
            }
            const ok = await probePackage(py, p);
            const v = ok ? 'installed' : '';
            probeCache.set(p, { at: Date.now(), data: v });
            installedMap.set(p, v);
          }),
        );
      }

      return {
        source: 'bundled',
        catalogVersion: catalog.version,
        python: runtime,
        algorithms: catalog.algorithms.map((a) => ({
          ...a,
          installed: installedMap.get(a.packageName) === 'installed',
          installing: installing && installedMap.get(a.packageName) === 'pending',
        })),
      };
    }, '读取算法目录'),
  );

  /**
   * pip 安装算法依赖（对应原版「安装」→ agentWillPrepare 的直装路径）。
   * 直接用检测到的 Python 的 pip 装到用户环境；日志实时推渲染层。
   */
  ipcMain.handle(
    IPC.ALG_INSTALL,
    safeWrap(async (_e, packageName: string) => {
      if (installing) throw new Error('已有安装任务在进行，请等待完成');
      if (!loadCatalog().algorithms.some((a) => a.packageName === packageName)) throw new Error('请选择算法目录中的依赖');
      const runtime = await pythonRuntime();
      if (runtime.state !== 'ready' || !runtime.pipOk) {
        throw new Error(runtime.state === 'no-python' ? '未检测到 Python，请先一键安装 Python' : 'Python/pip 不可用，请先修复运行时');
      }
      let py = (await findPython())!;
      if (await probePackage(py, packageName)) {
        logProgress(`${packageName} 已可用，所有项目可以直接使用，无需重复安装。`);
        probeCache.set(packageName, { at: Date.now(), data: 'installed' });
        return { ok: true, code: 0 };
      }
      if (installing) throw new Error('已有安装任务在进行，请等待完成');
      installing = true;
      // A single app-owned overlay reuses system packages without changing the system interpreter.
      try {
        const shared = sharedPythonPath();
        const root = sharedEnvironmentRoot();
        if (!shared || !root) throw new Error('共用环境目录尚未就绪，请重新打开软件');
        if (py.cmd !== shared) {
          if (existsSync(join(root, 'python'))) throw new Error('已有共用环境暂时不可用，请先检查；不会覆盖其中的文件');
          logProgress('正在准备软件共用环境，已有的库会继续复用。');
          const prepared = await execFileP(py.cmd, [...py.prefixArgs, '-m', 'venv', '--system-site-packages', join(root, 'python')], 120000);
          if (prepared.code !== 0) throw new Error('共用环境暂未准备好，请在运行环境中检查 Python');
          py = { cmd: shared, prefixArgs: [] };
        }
      } catch (err) { installing = false; throw err; }
      logProgress(`> ${py.cmd} -m pip install ${packageName}（使用清华 PyPI 镜像）`);

      return new Promise((resolve) => {
        // 清华镜像在本机可达性远好于官方源（项目记忆：官方源 HTTP 000）
        const child = spawn(py.cmd, [...py.prefixArgs, '-m', 'pip', 'install', packageName, '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple', '--disable-pip-version-check'], {
          windowsHide: true,
          env: { ...process.env, ...sharedRuntimeEnv() },
        });
        const feed = (chunk: Buffer): void => {
          for (const line of chunk.toString().split(/\r?\n/)) {
            if (line.trim()) logProgress(line.trim().slice(0, 300));
          }
        };
        child.stdout.on('data', feed);
        child.stderr.on('data', feed);
        child.on('exit', (code) => {
          installing = false;
          // 装完立刻失效缓存，下次 list() 反映新状态
          probeCache.set(packageName, { at: 0, data: code === 0 ? 'installed' : '' });
          runtimeCache = null;
          logProgress(code === 0 ? `✓ ${packageName} 安装完成` : `✗ 安装退出码 ${code}`);
          resolve({ ok: code === 0, code: code ?? -1 });
        });
        child.on('error', (err) => {
          installing = false;
          logProgress(`✗ 启动 pip 失败：${err.message}`);
          resolve({ ok: false, code: -1 });
        });
      });
    }, '安装算法依赖'),
  );

  /**
   * Python 一键安装（对应原版 /install-python）。
   * 下载官方安装器（npmmirror 镜像）→ 静默安装（当前用户级，PrependPath）→ 重新检测。
   * 进度通过 ALG_PYTHON_PROGRESS 推送。
   */
  ipcMain.handle(
    IPC.ALG_INSTALL_PYTHON,
    safeWrap(async () => {
      if (installing) throw new Error('已有安装任务在进行，请等待完成');
      const existing = await pythonRuntime();
      if (existing.state === 'ready') {
        logProgress(`已有 Python ${existing.version}，将直接复用，不重复下载安装。`);
        return { ok: true, version: existing.version };
      }
      if (process.platform !== 'win32') throw new Error('请在运行环境中配置本机 Python');
      if (installing) throw new Error('已有安装任务在进行，请等待完成');
      const root = sharedEnvironmentRoot();
      if (!root) throw new Error('共用环境目录尚未就绪，请重新打开软件');
      installing = true;
      const ver = '3.12.10';
      const url = `https://registry.npmmirror.com/-/binary/python/${ver}/python-${ver}-amd64.exe`;
      const dest = join(tmpdir(), `python-${ver}-amd64.exe`);

      try {
        // ── 下载 ──
        logProgress(`> 下载 ${url}`);
        await download(url, dest, (received, total) => {
          if (total > 0) {
            const pct = Math.floor((received / total) * 100);
            if (pct % 5 === 0) logProgress(`下载中 ${pct}%`);
          }
        });
        const size = statSync(dest).size;
        logProgress(`✓ 下载完成（${Math.round(size / 1024 / 1024)} MB）`);

        // ── 静默安装（当前用户，PrependPath 写入 PATH）──
        logProgress('正在安装到软件共用目录，之后所有项目都可使用。');
        const code = await new Promise<number>((resolve) => {
          const child = spawn(dest, ['/quiet', 'InstallAllUsers=0', 'PrependPath=0', 'Include_test=0', `TargetDir=${join(root, 'python-base')}`], {
            windowsHide: true,
          });
          child.on('exit', (c) => resolve(c ?? -1));
          child.on('error', () => resolve(-1));
        });
        if (code !== 0) {
          logProgress(`✗ 安装器退出码 ${code}（可能需要管理员权限或被杀软拦截）`);
          return { ok: false, code };
        }
        logProgress('✓ Python 安装完成，正在重新检测…');
        // 给 PATH 刷新留点时间，并失效全部缓存
        await new Promise((r) => setTimeout(r, 1500));
        runtimeCache = null;
        probeCache.clear();
        const runtime = await pythonRuntime();
        logProgress(runtime.state === 'ready' ? `✓ 检测到 Python ${runtime.version}` : '⚠ 安装完成但未在当前进程 PATH 中检测到（重启应用后生效）');
        return { ok: runtime.state === 'ready', version: runtime.version };
      } finally {
        installing = false;
        try {
          rmSync(dest, { force: true });
        } catch {
          /* 清理失败无碍 */
        }
      }
    }, '一键安装 Python'),
  );
}

/** https 下载（跟随 3 跳重定向），进度回调 */
function download(url: string, dest: string, onProgress: (received: number, total: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let redirects = 0;
    const go = (u: string): void => {
      if (++redirects > 4) return reject(new Error('重定向次数过多'));
      httpsGet(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return go(res.headers.location);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = Number(res.headers['content-length'] ?? 0);
        let received = 0;
        mkdirSync(dirname(dest), { recursive: true });
        const file = createWriteStream(dest);
        res.on('data', (c: Buffer) => {
          received += c.length;
          onProgress(received, total);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      }).on('error', reject);
    };
    go(url);
  });
}
