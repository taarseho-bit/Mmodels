/**
 * 运行环境检查 —— **纯 Node 逻辑，不依赖 electron / 数据库**。
 *
 * 检测项与分级对齐 `resources/builtin-skills/doctor/SKILL.md`：
 *   - 必需：Python 3、git、xelatex、latexmk、bibtex、numpy/scipy/pandas、
 *           matplotlib/seaborn/python-dateutil
 *   - 建议：uv、drawio、PDF 转图工具、中文字体
 *
 * ⚠️ 全部是**确定性检测**，不调用任何模型：
 *   环境有无是事实问题，让 LLM 去猜只会引入不确定性。
 *   检测只做只读探测（`--version` / `import`），**绝不安装任何东西**。
 *
 * 之所以放在 `scan/` 而不是 ipc/：验证脚本要能直接 import 跑真检测，
 * 而 ipc 层会把 better-sqlite3 拖进 ESM bundle（见 scan/diagram.ts 的说明）。
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { sharedPythonPath, managedPythonPath } from '../runtime/shared-environment';
import { findLocalCompute } from '../runtime/local-compute';

export type CheckLevel = 'required' | 'recommended';
export type CheckStatus = 'ok' | 'missing' | 'unknown';

export interface EnvCheckItem {
  /** 稳定标识（界面用来分组，不要改） */
  id: string;
  /** 展示名 */
  name: string;
  level: CheckLevel;
  status: CheckStatus;
  /** 探测到的版本或路径 */
  detail?: string;
  /**
   * 归一化后的版本号（应用约定「运行环境」工具行显示 `版本 · 绝对路径`）。
   * 与 `detail` 的区别：`detail` 是探测命令的原始首行（如 `git version 2.55.0.windows.3`），
   * 这里只保留应用约定会显示的那一段（`2.55.0`）。探测不到时为 undefined。
   */
  version?: string;
  /** 可执行文件绝对路径（应用约定工具行显示）。探测不到时为 undefined。 */
  path?: string;
  /** 用途说明 */
  purpose: string;
}

export interface EnvCheckResult {
  items: EnvCheckItem[];
  /** 必需项缺失数量 */
  missingRequired: number;
  /** 建议项缺失数量 */
  missingRecommended: number;
  /** 总体是否可用 */
  ok: boolean;
  /** 本机平台 */
  platform: string;
  /** 检查耗时（毫秒） */
  elapsedMs: number;
}

/** 单次命令探测的超时 —— 环境探测不能拖住界面 */
const PROBE_TIMEOUT = 8000;

interface ProbeResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /**
   * 命令**根本不存在 / 起不来**（`ENOENT` 等 spawn 失败），
   * 而不是"跑起来了但退出码非 0"。
   *
   * 为什么需要把它从 `ok` 里拆出来：`ok === false` 这一个布尔把两件完全不同的事混在一起 ——
   *   「这台机器上没有这个命令」和「有，但它对 `-v` 返回了非 0」。
   *   必须区分才敢断言"命令存在"（见 `firstAvailable` 的语义决策）。
   *   实测（`_tmp/env-b123-probe.txt` [F]）：命令不存在时 `err.code === 'ENOENT'`、
   *   `errno === -4058`、`syscall === 'spawn <cmd>'`，且 stdout / stderr 都是空串。
   */
  notFound: boolean;
}

/** execFile 失败时，这些 `err.code` 表示"命令根本没起来"，而不是"起来了但退出码非 0" */
const SPAWN_ERROR_CODES = new Set(['ENOENT', 'EACCES', 'EPERM']);

function probe(cmd: string, args: string[] = ['--version']): Promise<ProbeResult> {
  return new Promise((resolve) => {
    try {
      execFile(
        cmd,
        args,
        { timeout: PROBE_TIMEOUT, windowsHide: true, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          // ⚠️ `err.code` 的类型是**混的**：spawn 失败时是字符串（'ENOENT'），
          //    子进程非 0 退出时是数字（退出码）。所以先判类型再判集合，
          //    否则 `Number(code)` 会把退出码 1 也当成"不存在"。
          const code = (err as { code?: unknown } | null)?.code;
          resolve({
            ok: !err,
            notFound: Boolean(err) && typeof code === 'string' && SPAWN_ERROR_CODES.has(code),
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
          });
        },
      );
    } catch {
      // 命令根本不存在（ENOENT 在 execFile 里会同步抛）
      resolve({ ok: false, notFound: true, stdout: '', stderr: '' });
    }
  });
}

/**
 * 取首行做展示串。
 * @param max 截断长度。版本串压到 60 字够用；**绝对路径不能截**（会切掉文件名），传 0 关闭截断。
 */
function firstLine(s: string, max = 60): string {
  const l = s.split(/\r?\n/).find((x) => x.trim()) ?? '';
  return max > 0 ? l.trim().slice(0, max) : l.trim();
}

/**
 * 从探测输出里挑出**这个工具自己那行**：优先"含命令名且含版本号"的行，否则退回首个非空行。
 *
 * ⚠️ 为什么 LaTeX 三件套不能用 `firstLine`（本机实测，见 `_tmp/env-b123-probe.txt` [A][B]）：
 *
 *   `latexmk --version` 的 stdout **前两行是 perl/代码页通知**，版本行在**第 3 行**：
 *     out[0] Initial Win CP for (console input, console output, system): (CP936, CP936, CP936)
 *     out[1] I changed them all to CP936
 *     out[2] Latexmk, John Collins, 27 Dec. 2024. Version 4.86a   ← 这行才是
 *   取首行 ⇒ 应用里 latexmk 的 detail 显示成那串代码页通知（运行测试探测到的正是它）。
 *
 *   而**不能**简单改成"取含版本号的第一行"：xelatex / bibtex 的输出里紧跟着一行
 *     `kpathsea version 6.4.0`
 *   —— 那是 **kpathsea（TeX 的路径搜索库）**的版本，不是 xelatex / bibtex 的版本；
 *   那样会把 bibtex 的版本从 `0.99d` 变成 `6.4.0`（一个**看起来合理、但是错的**数字）。
 *   所以第一优先级是"**含命令名**且含版本号"：
 *     xelatex → 没有这样的行（它的首行写的是引擎名 `XeTeX`）⇒ 退回首个非空行 = `XeTeX … (TeX Live 2024)` ✅
 *     bibtex  → out[0] `BibTeX 0.99d (TeX Live 2024)` ✅
 *     latexmk → out[2] `Latexmk, John Collins, … Version 4.86a` ✅
 *
 * `stderr` 只作兜底（stdout 一行都没有时）—— 不要把两者拼起来再取首行：
 * latexmk 的 stderr 全是 perl locale 警告，拼起来就把警告放到了第一位。
 */
function toolLine(s: string, cmd: string, max = 60): string {
  const lines = s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const re = new RegExp(cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const own =
    lines.find((l) => re.test(l) && numericVersion(l)) ??
    lines[0] ??
    '';
  return max > 0 ? own.slice(0, max) : own;
}

/** 取前 N 段数字构成的版本号：`2.55.0.windows.3` → `2.55.0`（应用约定只显示前三段） */
function numericVersion(s: string): string | undefined {
  return /(\d+(?:\.\d+)+)/.exec(s)?.[1];
}

/**
 * 把命令名解析成**绝对路径**（应用约定工具行的次行显示 `版本 · C:\...\git.EXE`）。
 * Windows 用 `where`（可能多行，取第一条），其余平台用 `which`。解析不到返回 null。
 */
async function which(cmd: string): Promise<string | null> {
  const r = await probe(process.platform === 'win32' ? 'where' : 'which', [cmd]);
  if (!r.ok) return null;
  const line = (r.stdout || r.stderr)
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find(Boolean);
  return line || null;
}

/**
 * 找到**第一个真正可用**的 Python 3 解释器。
 *
 * 顺序：软件共用环境 → 本机 Python。旧项目环境不自动接管检测。
 *
 * ⚠️ **必须逐个试到第一个可用**，不能"组好候选表就取 `[0]`"。
 *   早期实现是 `for (const name of ['python','python3','py']) candidates.push(...)`
 *   紧接 `return candidates[0] ?? null` —— 没有 venv 时 `candidates[0]` **恒为 `python`**，
 *   后两个候选**永远选不到**（函数文档却写着"其次 PATH 上的 python/python3"，文档与实现矛盾）。
 *
 *   后果不是"慢一点"，是**报错报反**：Linux / macOS 上通常**只有 `python3`、没有 `python`**
 *     ⇒ 探测 `python` 得到 ENOENT ⇒ Python 判 `missing`
 *     ⇒ 6 个 `py:*` 包只能降级成 `unknown`
 *     ⇒ `missingRequired` 从 1 涨到 7 ⇒ 设置页告诉用户"环境不可用 / 必需项缺失 7 项"，
 *       并**顺势引导他点「让 Agent 配置运行环境」**去装一个**他早就装好了**的 Python。
 *   —— 这是本模块最靠前的一次误判（`python` 是第一个必需项）。
 *
 * 判据（两条都要）：`--version` 退出码为 0 **且**输出里有 `Python 3`。
 *   只看退出码不够：Windows 上叫 `python` 的那个 Microsoft Store 存根
 *   会弹应用商店、**不会**以 0 退出（这也是候选顺序把 `python` 排在 `python3` 前面的原因）。
 *   只看输出也不够：任何一条会打印 "Python 3" 字样的命令都会被误收。
 *
 * 本机实测（`_tmp/env-b123-probe.txt` [E]）：`python` / `python3` / `py` 三个**都**可用，
 *   所以**本机看不出这次修复的差别** —— 差别只在"只有 python3"的机器上。
 *   该分支由 `environment.test.ts` 的打桩用例覆盖（真实版覆盖不到，如实标注）。
 */
export async function findPython(
  _projectRoot?: string,
  /**
   * 诊断收集：每个候选**实际探到的首行**（探测失败时是空串）。
   *
   * ⚠️ 为什么需要它：本函数只返回"可用"的那一个，**返回 null 时会把"这台机器上到底有什么"
   *    一起丢掉**。而用户看到「Python 3：缺失」时最需要知道的就是原因 ——
   *    「你装的是 Python 2.7.18」/「`python` 是 Microsoft Store 的存根」。
   *    `checkEnvironment` 原来靠 `else if (v) pyDetail = v` 保留这句原因，
   *    那个 `v` 来自"被 findPython 选中的那个候选"；一旦 findPython 改成会**跳过**不合格候选，
   *    该分支就永远是死的（`py` 非 null 就必然 ok）。
   *    所以把"沿途看到的东西"通过回调交出去，而不是让调用方再探一遍（那会白起 3 次进程）。
   */
  onSeen?: (cmd: string, versionLine: string) => void,
): Promise<{ cmd: string; prefixArgs: string[] } | null> {
  const candidates: Array<{ cmd: string; prefixArgs: string[] }> = [];

  for (const cmd of [sharedPythonPath(), managedPythonPath()]) {
    if (cmd && existsSync(cmd)) candidates.push({ cmd, prefixArgs: [] });
  }

  // Windows 上 python3 常是 Microsoft Store 的别名，先试 python
  // （顺序保持原样 —— 这次只修"取 [0]"这一处，不动候选优先级）
  for (const name of ['python', 'python3', 'py']) {
    candidates.push({ cmd: name, prefixArgs: [] });
  }

  // venv 里的那个也**要试**：`existsSync` 只说明文件在，不说明它能跑
  // （venv 被搬过目录、解释器被删掉，都会留下一个跑不起来的 `python.exe`）。
  for (const c of candidates) {
    const r = await probe(c.cmd, [...c.prefixArgs, '--version']);
    const v = firstLine(r.stdout || r.stderr);
    onSeen?.(c.cmd, v);
    if (r.ok && /python\s+3/i.test(v)) return c;
  }
  return null;
}

/** 逐个探测 Python 包（一次调用批量问，避免起 N 次进程） */
async function probePythonPackages(
  py: { cmd: string; prefixArgs: string[] },
  pkgs: string[],
): Promise<Map<string, string | null>> {
  // 用 importlib.metadata 拿版本；缺包就跳过，不抛
  const code = `
import json, importlib.metadata as m
out = {}
for name in ${JSON.stringify(pkgs)}:
    try:
        out[name] = m.version(name)
    except Exception:
        out[name] = None
print(json.dumps(out))
`.trim();

  const r = await probe(py.cmd, [...py.prefixArgs, '-c', code]);
  const map = new Map<string, string | null>();
  if (!r.ok) {
    for (const p of pkgs) map.set(p, null);
    return map;
  }
  try {
    // 只取最后一行 JSON（前面可能有 warning）
    const line = r.stdout.trim().split(/\r?\n/).pop() ?? '{}';
    const obj = JSON.parse(line) as Record<string, string | null>;
    for (const p of pkgs) map.set(p, obj[p] ?? null);
  } catch {
    for (const p of pkgs) map.set(p, null);
  }
  return map;
}

/** 检查是否存在任一中文字体 */
function hasCjkFont(): string | null {
  const plat = process.platform;
  if (plat === 'win32') {
    const winFonts = process.env.WINDIR ? join(process.env.WINDIR, 'Fonts') : 'C:/Windows/Fonts';
    for (const f of ['simsun.ttc', 'simsunb.ttf', 'msyh.ttc', 'simhei.ttf']) {
      if (existsSync(join(winFonts, f))) return f;
    }
    return null;
  }
  if (plat === 'darwin') {
    for (const p of [
      '/System/Library/Fonts/Supplemental/Songti.ttc',
      '/System/Library/Fonts/STHeiti Light.ttc',
      '/Library/Fonts/Songti.ttc',
    ]) {
      if (existsSync(p)) return p.split('/').pop() ?? p;
    }
    return null;
  }
  // Linux：常见 Noto CJK 路径
  for (const p of [
    '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  ]) {
    if (existsSync(p)) return p.split('/').pop() ?? p;
  }
  return null;
}

/**
 * 从候选里挑第一个**存在且能用**的命令（`pdftoppm` / `mutool` / `magick` 任一即可）。
 *
 * ★ **语义决策（必须写下来，否则下一个人会把它"化简"回去）**：
 *   「工具装没装」和「`-v` 的退出码是不是 0」**不是一回事**。
 *   有些实现（典型是 `mutool -v` / `magick -v` 这一类）把版本打到 **stderr**、
 *   而且**以非 0 退出**；只看 `r.ok` 就会把它们判成"没装"
 *   ⇒ 用户在设置页看到「PDF 转图工具：未找到」，被引导去装一个**已经装了**的工具。
 *
 *   所以判据拆成三条，**每条都有对应的反例要挡住**：
 *     1. `r.ok`（退出码 0）→ 可用。最简单也最没争议。
 *     2. `!r.notFound && 输出里有版本号` → 可用。
 *        `notFound` 这一半**不能省**：否则"命令根本不存在"（ENOENT，stdout/stderr 都是空串）
 *        会和"跑起来了"混为一谈 ——（见 `ProbeResult.notFound` 的注释）。
 *        "输出里有版本号"这一半也不能省：命令存在但**起不来**时（缺动态库等）
 *        也会打一段 stderr 并非 0 退出，不能因为"有输出"就当它可用。
 *     3. 其余（`notFound`，或跑了但没吐版本号）→ 保守判不可用，继续试下一个。
 *
 *   ⚠️ 早期实现的写法是
 *        `if (r.ok || firstLine(r.stdout + r.stderr)) { if (r.ok) return c; }`
 *      —— 外层"有输出也算"被内层的 `if (r.ok)` 整个抵消，**外层那半边从来没有影响过结果**；
 *      换句话说它等价于 `if (r.ok) return c;`，只是多了一层看不懂的壳。
 *      这次把外层那半边的**本意**补全（换成"不是 spawn 失败 且 有版本号"），两个条件各司其职。
 *
 * ⚠️ **本机验不到分支 2**：实测 `pdftoppm -v` 退出码为 **0**，`mutool` / `magick` 在本机
 *    **根本没装**（ENOENT）。所以这条语义只能由打桩用例覆盖 —— 见报告"诚实清单"，
 *    不要把"改对了"读成"在真机上验过了"。
 */
async function firstAvailable(cmds: string[]): Promise<string | null> {
  for (const c of cmds) {
    const r = await probe(c, ['-v']);
    if (r.ok) return c;
    if (!r.notFound && numericVersion(firstLine(r.stdout + r.stderr))) return c;
  }
  return null;
}

/** 主检测入口 */
export async function checkEnvironment(
  projectRoot?: string,
  /**
   * 随包二进制目录（Electron 的 `process.resourcesPath`）。
   * 应用约定把 `uv` 随包分发，因此不能只看 PATH —— 否则会误报「uv 缺失」。
   */
  resourcesDir?: string,
): Promise<EnvCheckResult> {
  const t0 = Date.now();
  const items: EnvCheckItem[] = [];

  const push = (
    id: string,
    name: string,
    level: CheckLevel,
    purpose: string,
    status: CheckStatus,
    detail?: string,
  ): EnvCheckItem => {
    const item: EnvCheckItem = { id, name, level, status, purpose, detail };
    items.push(item);
    // 返回引用：调用方可以随后补 version / path（应用约定工具行的 `版本 · 绝对路径`）
    return item;
  };

  // ── 必需：Python 3 ──
  // ⚠️ `findPython` 现在是 async（它要**逐个候选试**，见其注释 —— 早期实现恒取 `candidates[0]`）
  //    `seen` 收下沿途每个候选探到的首行：它给出的 `py` 只会有"可用"的那一个，
  //    但用户需要知道的是"为什么不可用"（Python 2 / Store 存根 / 根本没有）。
  const seen: string[] = [];
  const py = await findPython(projectRoot, (_cmd, v) => seen.push(v));
  let pyOk = false;
  let pyDetail = '';
  let pyVersion: string | undefined;
  let pyPath: string | undefined;
  if (py) {
    const r = await probe(py.cmd, [...py.prefixArgs, '--version']);
    const v = firstLine(r.stdout || r.stderr);
    if (r.ok && /python\s+3/i.test(v)) {
      pyOk = true;
      pyDetail = v;
    } else if (v) {
      pyDetail = v;
    }
    // `Python 3.13.14` → `3.13.14`（应用约定不显示 `Python ` 前缀）
    pyVersion = numericVersion(v);
    if (pyOk) {
      // 绝对路径必须问解释器自己：PATH 上叫 `python`，解析出的可能不是同一个
      // （项目 venv、Microsoft Store 别名都会让 `which python` 给出误导性结果）
      const exe = await probe(py.cmd, [...py.prefixArgs, '-c', 'import sys;print(sys.executable)']);
      const fromInterpreter = exe.ok ? firstLine(exe.stdout, 0) : '';
      pyPath = fromInterpreter || (await which(py.cmd)) || undefined;
    }
  } else {
    // 一个可用候选都没有。**不要让用户只看到一句"缺失"**：把第一个真的吐了东西的候选
    // 原样告诉他（`Python 2.7.18` / Store 存根的提示串），他才知道该装什么、该改什么。
    // 回归护栏：若这里退化成"什么都不填"，`environment.test.ts` 那条
    // 「Python 2.7.18 → missing 但保留原因在 detail」会立刻红。
    const reason = seen.find(Boolean);
    if (reason) {
      pyDetail = reason;
      pyVersion = numericVersion(reason);
    }
  }
  {
    const it = push('python', 'Python 3', 'required', '建模求解与绘图脚本', pyOk ? 'ok' : 'missing', pyDetail || undefined);
    it.version = pyVersion;
    it.path = pyPath;
  }

  // ── 必需：git ──
  {
    const r = await probe('git', ['--version']);
    const line = firstLine(r.stdout);
    const it = push('git', 'Git', 'required', '项目版本存档与回合快照恢复', r.ok ? 'ok' : 'missing', line || undefined);
    it.version = numericVersion(line);
    if (r.ok) it.path = (await which('git')) ?? undefined;
  }

  // ── 必需：LaTeX 三件套 ──
  for (const [id, name, cmd, purpose] of [
    ['xelatex', 'xelatex', 'xelatex', '编译 CUMCM 中文 LaTeX 论文'],
    ['latexmk', 'latexmk', 'latexmk', '论文自动多轮编译'],
    ['bibtex', 'bibtex', 'bibtex', '参考文献编译'],
  ] as const) {
    const r = await probe(cmd, ['--version']);
    // ⚠️ `toolLine` 而不是 `firstLine`：latexmk 的版本行在第 3 行（前两行是代码页通知），
    //    取首行会把通知当成"版本"显示 —— 见 `toolLine` 的注释。
    const line = toolLine(r.stdout, cmd) || firstLine(r.stderr);
    const it = push(id, name, 'required', purpose, r.ok ? 'ok' : 'missing', line || undefined);
    if (id === 'xelatex') {
      // `XeTeX 3.141592653-2.6-0.999996 (TeX Live 2024)` → 应用约定显示 `TeX Live 2024`
      // （xelatex 自身那串版本号是 XeTeX 引擎版本，对用户没有意义）
      const tex = /\(([^)]*TeX[^)]*)\)/i.exec(line)?.[1]?.trim();
      it.version = tex || numericVersion(line) || undefined;
      if (r.ok) it.path = (await which('xelatex')) ?? undefined;
    } else {
      // ⚠️ latexmk / bibtex 之前**恒无 `version`** —— 只因为这里写着 `if (id === 'xelatex')`。
      //    可它们的输出里明摆着有版本号：`Version 4.86a` / `BibTeX 0.99d`。
      //    字段注释说这个值是"应用约定会显示的那一段"，恒缺一半是没道理的。
      it.version = numericVersion(line) || undefined;
    }
  }

  // ── 必需：Python 科学计算包 ──
  if (pyOk && py) {
    const pkgs = [
      'numpy',
      'scipy',
      'pandas',
      'matplotlib',
      'seaborn',
      'python-dateutil',
    ];
    const versions = await probePythonPackages(py, pkgs);
    for (const p of pkgs) {
      const v = versions.get(p) ?? null;
      push(`py:${p}`, p, 'required', '数值计算、优化与数据处理', v ? 'ok' : 'missing', v ?? undefined);
    }
  } else {
    for (const p of ['numpy', 'scipy', 'pandas', 'matplotlib', 'seaborn', 'python-dateutil']) {
      push(`py:${p}`, p, 'required', '数值计算、优化与数据处理', 'unknown');
    }
  }

  // ── 建议：uv（先看随包，再看 PATH）──
  {
    let detail = '';
    let found = false;
    let uvPath: string | undefined;
    // 随包分发：打包后 uv 在 `<resourcesPath>/bin/uv.exe`
    // （应用约定布局就是 resources/bin/uv.exe），开发期在 `<proj>/resources/bin/uv.exe`。
    // 兼容性地也看一眼资源根目录。
    if (resourcesDir) {
      for (const rel of [
        join('bin', 'uv.exe'),
        join('bin', 'uv'),
        'uv.exe',
        'uv',
      ]) {
        const p = join(resourcesDir, rel);
        if (existsSync(p)) {
          found = true;
          uvPath = p;
          detail = `随包 · ${rel.replace(/\\/g, '/')}`;
          break;
        }
      }
    }
    if (!found) {
      const p = await which('uv');
      const r = p ? await probe(p, ['--version']) : await probe('uv', ['--version']);
      if (r.ok) {
        found = true;
        uvPath = p ?? undefined;
        detail = firstLine(r.stdout);
      }
    }
    const it = push('uv', 'uv', 'recommended', 'Python 虚拟环境与依赖管理', found ? 'ok' : 'missing', detail || undefined);
    // 随包分发时 detail 只说明来源，版本号要另外问一次 `uv --version`
    if (found && uvPath) {
      it.path = uvPath;
      const v = await probe(uvPath, ['--version']);
      it.version = v.ok ? numericVersion(firstLine(v.stdout)) : undefined;
    }
  }

  // ── 建议：R / Octave 本地计算连接器 ──
  // 这两项不属于所有用户的必需依赖，但只要用户选择对应连接器，必须在这里
  // 做真实的可执行检测，而不是只看 PATH 上有没有一个文件名。
  let rRuntime: Awaited<ReturnType<typeof findLocalCompute>> = null;
  for (const [id, name, purpose] of [
    ['r', 'R 语言', '统计检验、回归、时间序列与科研绘图'],
    ['octave', 'Octave', '优化、仿真与矩阵计算'],
  ] as const) {
    const found = await findLocalCompute(id);
    if (id === 'r') rRuntime = found;
    const it = push(id, name, 'recommended', purpose, found ? 'ok' : 'missing', found?.version);
    // `Rscript.exe` / `octave-cli.exe` 可能是 PATH 中的裸命令；界面和
    // 检查报告只展示可复现的绝对路径，裸命令仍保留在运行时 command 中使用。
    if (found && isAbsolute(found.command)) it.path = found.command;
  }

  // R 的常用科研绘图库单独列出，方便用户知道“R 已安装”与“R 可以画图”是两件事。
  if (rRuntime) {
    const packages = ['ggplot2', 'patchwork', 'ggrepel', 'svglite', 'ragg'];
    const code = `pkgs <- c(${packages.map(p => JSON.stringify(p)).join(',')}); cat(vapply(pkgs, function(p) if (requireNamespace(p, quietly=TRUE)) as.character(packageVersion(p)) else '', character(1)), sep='\\n')`;
    const result = await probe(rRuntime.command, ['-e', code]);
    const versions = result.ok ? result.stdout.trim().split(/\r?\n/) : [];
    packages.forEach((pkg, index) => {
      const version = versions[index] || undefined;
      push(`r:${pkg}`, `R 包 ${pkg}`, 'recommended', 'R 科研绘图与论文图表', version ? 'ok' : 'missing', version);
    });
  }

  // ── 建议：drawio ──
  {
    let cmd: string | null = null;
    let r: ProbeResult = { ok: false, notFound: true, stdout: '', stderr: '' };

    // Windows 安装包实际提供的是 draw.io.exe，通常不会把它加入 PATH。
    // 先看标准安装目录，避免“已经安装，但运行环境一直说没装”。
    if (process.platform === 'win32') {
      const roots = [
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : null,
        process.env.ProgramFiles ?? null,
        process.env['ProgramFiles(x86)'] ?? null,
      ].filter((value): value is string => Boolean(value));
      for (const root of roots) {
        const candidate = join(root, 'draw.io', 'draw.io.exe');
        if (!existsSync(candidate)) continue;
        const checked = await probe(candidate, ['--version']);
        if (checked.ok) {
          cmd = candidate;
          r = checked;
          break;
        }
      }
    }

    for (const candidate of ['drawio', 'draw.io']) {
      if (r.ok) break;
      const checked = await probe(candidate, ['--version']);
      if (checked.ok) {
        cmd = candidate;
        r = checked;
      }
    }
    const line = firstLine(r.stdout);
    const detail = line || (cmd && /[\\/]/.test(cmd) ? '已安装' : undefined);
    const it = push('drawio', 'draw.io', 'recommended', '导出技术路线图与流程图为 PNG / PDF', r.ok ? 'ok' : 'missing', detail);
    if (r.ok && cmd) {
      it.version = numericVersion(line);
      it.path = /[\\/]/.test(cmd) ? cmd : (await which(cmd)) ?? undefined;
    }
  }

  // ── 建议：PDF 转图（任一） ──
  {
    const got = await firstAvailable(['pdftoppm', 'mutool', 'magick']);
    push('pdftoimage', 'PDF 转图工具', 'recommended', '编译后做视觉检查（文字溢出、箭头压字）', got ? 'ok' : 'missing', got ?? undefined);
  }

  // ── 建议：中文字体 ──
  {
    const f = hasCjkFont();
    push('cjkfont', '中文字体', 'recommended', '论文与图表中文不出现方框', f ? 'ok' : 'missing', f ?? undefined);
  }

  const missingRequired = items.filter((i) => i.level === 'required' && i.status !== 'ok').length;
  const missingRecommended = items.filter(
    (i) => i.level === 'recommended' && i.status !== 'ok',
  ).length;

  return {
    items,
    missingRequired,
    missingRecommended,
    ok: missingRequired === 0,
    platform: process.platform,
    elapsedMs: Date.now() - t0,
  };
}

/** PATH 分隔符导出（界面排查环境问题时有用） */
export const PATH_DELIMITER = delimiter;
