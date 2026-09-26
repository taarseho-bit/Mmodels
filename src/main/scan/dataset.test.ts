/**
 * 数据集扫描（`src/main/scan/dataset.ts` 的 `collectDataFiles`）回归测试。
 *
 * 为什么这层要单独测：
 *   它是 `dataset:list` 的唯一实现，被**三处**消费 —— DatabasePage 的列表、
 *   Sidebar 的「当前项目有数据文件时才显示『数据集』导航项」、以及验证脚本的 stub。
 *   一旦它把不该收的收进来（`node_modules` 里的 csv、或我们自己写在
 *   `.mmodels/paper/config.json` 的论文配置），用户看到的是"项目里凭空多出几百个数据集"；
 *   一旦它漏收，用户看到的是"我明明放了 csv，数据集面板却是空的"。
 *   这两件事**都只在真实文件树上才看得出来**，而逻辑本身是纯 Node，可以直接跑。
 *
 * ⚠️ 本文件**不 mock `node:fs`**：每个用例都在 `os.tmpdir()` 下造**真实**目录与文件，
 *   用真实的 `readdirSync` / `statSync` / 真实 mtime 跑。
 *   打桩 fs 只能验证"我猜的 fs 语义"，而 Windows/NTFS 的 readdir 顺序、`Dirent`
 *   对符号链接的 `isFile()` 判定、`utimes` 精度，恰恰是最容易猜错的地方 ——
 *   下面 3 条发现就是这么找出来的（先用 `_tmp/probe-build/run-ds-boundary.cjs`
 *   在真实磁盘上把"我推测的边界"验了一遍，再写断言；不把猜想写成判据）。
 *
 * ⚠️ 判据纪律：每条用例都要能回答
 *   「**如果这段逻辑是坏的，这个观测值会不一样吗？**」
 *   答不上来的（例如只断言"返回了数组"）不要出现在这里。
 *
 * ⚠️ 本文件最初是**只加测试、未改产品代码**（验收包冻结期内），发现的缺陷只报告不修
 *   （见 `verify/func-gap-fixes.md` §10-5.7 / §10-6）。
 *   冻结期解冻后，`dataset.ts` 那两处缺陷已修（`B-ds-1` `truncated` 恰好 200 误报、
 *   `B-ds-2` 先截断后排序丢最新），本文件里对应的 `★` 用例已从"现状固化"改成
 *   "**修复后的判据**" —— 它们现在是**回归护栏**：谁把截断挪回 `walk` 里，谁就红。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DATA_EXT, MAX_DATASETS, collectDataFiles, type DatasetFile } from './dataset';

/** 固定基准时间，避免用例依赖"现在几点" */
const T0 = Date.UTC(2026, 0, 1);
const HOUR = 3600_000;

/** dataset.ts 里的 MAX_DEPTH 没有导出 —— 这里按源码钉死，改成别的值会显红 */
const MAX_DEPTH = 5;

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mm-scan-ds-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 真实写一个文件（自动建父目录），返回绝对路径 */
function put(rel: string, content = 'x'): string {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

/** 造一棵 n 层深的目录链，最里层放一个文件；返回相对路径 */
function deepFile(n: number, name: string): string {
  const parts: string[] = [];
  for (let i = 1; i <= n; i++) parts.push(`d${i}`);
  parts.push(name);
  put(parts.join('/'));
  return parts.join('/');
}

/** 把 mtime 钉到确定值（T0 + hours 小时；越大越新）。用真实 utimes，不依赖时钟。 */
function pin(rel: string, hours: number): void {
  const sec = (T0 + hours * HOUR) / 1000;
  utimesSync(join(root, rel), sec, sec);
}

const get = (r: { files: DatasetFile[] }, rel: string): DatasetFile | undefined =>
  r.files.find((f) => f.relPath === rel);

/** 独立手段数一遍磁盘上有多少数据文件 —— 不拿被测方的自报数当事实 */
function countOnDisk(dir = root): number {
  return readdirSync(dir).filter((n) => DATA_EXT.has(n.slice(n.lastIndexOf('.')).toLowerCase())).length;
}

describe('DATA_EXT 白名单 —— 它同时决定「导入」的放行面，不只是扫描', () => {
  it('正好 7 类，且全小写、全带点', () => {
    expect([...DATA_EXT].sort()).toEqual([
      '.csv',
      '.json',
      '.parquet',
      '.tsv',
      '.txt',
      '.xls',
      '.xlsx',
    ]);
    for (const e of DATA_EXT) {
      expect(e).toBe(e.toLowerCase());
      expect(e.startsWith('.')).toBe(true);
    }
  });

  it('不含可执行 / 脚本类扩展名（ipc/dataset.ts 用它筛「导入」，放行就等于让用户把 exe 导进项目）', () => {
    for (const bad of ['.exe', '.bat', '.cmd', '.ps1', '.js', '.mjs', '.dll', '.lnk', '.sh']) {
      expect(DATA_EXT.has(bad)).toBe(false);
    }
  });
});

describe('扩展名匹配', () => {
  it('真实文件上大小写不敏感，且 ext 归一成小写', () => {
    put('UPPER.CSV');
    put('mixed.Txt');
    put('dots.parquet');
    const r = collectDataFiles(root);
    expect(r.files.map((f) => `${f.name}|${f.ext}`).sort()).toEqual([
      'UPPER.CSV|.csv',
      'dots.parquet|.parquet',
      'mixed.Txt|.txt',
    ]);
  });

  it('非数据扩展名与"没有扩展名"都不收', () => {
    put('note.md');
    put('paper.tex');
    put('main.py');
    put('shot.png');
    put('report.docx');
    put('README');
    expect(collectDataFiles(root).files).toHaveLength(0);
  });

  it('取最后一段扩展：a.tar.csv 收（ext=.csv），b.csv.bak 不收（ext=.bak）', () => {
    put('a.tar.csv');
    put('b.csv.bak');
    const r = collectDataFiles(root);
    expect(r.files.map((f) => f.name)).toEqual(['a.tar.csv']);
    expect(get(r, 'a.tar.csv')!.ext).toBe('.csv');
  });

  it('名为 raw.csv 的**目录**不进结果，但会继续往里递归', () => {
    put('raw.csv/inner.csv');
    const r = collectDataFiles(root);
    expect(r.files.map((f) => f.relPath)).toEqual(['raw.csv/inner.csv']);
  });
});

describe('结果结构契约（渲染层直接按这几个字段取用）', () => {
  it('dir + name === relPath；dir 以 / 结尾；根目录文件的 dir 是空串', () => {
    put('top.csv');
    put('data/mid.csv');
    put('data/deep/x.csv');
    const r = collectDataFiles(root);
    expect(r.files).toHaveLength(3);
    for (const f of r.files) expect(f.dir + f.name).toBe(f.relPath);
    expect(get(r, 'top.csv')!.dir).toBe('');
    expect(get(r, 'data/mid.csv')!.dir).toBe('data/');
    expect(get(r, 'data/deep/x.csv')!.dir).toBe('data/deep/');
    expect(get(r, 'data/deep/x.csv')!.name).toBe('x.csv');
  });

  it('relPath 一律用正斜杠（不把 Windows 反斜杠泄漏给渲染层）', () => {
    put('a/b/c.csv');
    const r = collectDataFiles(root);
    expect(r.files[0]!.relPath).toBe('a/b/c.csv');
    expect(r.files[0]!.relPath).not.toContain('\\');
  });

  it('size 是真实字节数、mtimeMs 是真实 mtime（不是 0、也不是随手填的）', () => {
    const abs = put('a.csv', 'hello,world'); // 11 字节
    pin('a.csv', 5);
    const f = get(collectDataFiles(root), 'a.csv')!;
    expect(f.size).toBe(11);
    expect(f.mtimeMs).toBe(statSync(abs).mtimeMs);
    expect(f.mtimeMs).toBeGreaterThanOrEqual(T0 + 5 * HOUR);
  });
});

describe(`递归与深度上限（MAX_DEPTH = ${MAX_DEPTH}）`, () => {
  it('根目录自己的文件能扫到（depth 0）', () => {
    deepFile(0, 'a0.csv');
    expect(collectDataFiles(root).files.map((f) => f.name)).toEqual(['a0.csv']);
  });

  it(`深度 ${MAX_DEPTH} 的文件能扫到（边界内侧）`, () => {
    const rel = deepFile(MAX_DEPTH, 'inner.csv');
    expect(collectDataFiles(root).files.map((f) => f.relPath)).toEqual([rel]);
  });

  it(`深度 ${MAX_DEPTH + 1} 的文件扫不到（边界外侧）—— 否则巨型目录会把 IPC 拖死`, () => {
    deepFile(MAX_DEPTH + 1, 'too-deep.csv');
    const r = collectDataFiles(root);
    expect(r.files).toHaveLength(0);
    // 回归护栏：同一棵树上把文件提到边界内侧，必须能扫到
    // （证明"没扫到"是深度判的，不是别的原因）
    deepFile(MAX_DEPTH, 'ok.csv');
    expect(collectDataFiles(root).files.map((f) => f.name)).toEqual(['ok.csv']);
  });
});

describe('跳过的目录', () => {
  it('点目录整棵跳过 —— 尤其是我们自己的 .mmodels / .mathmodel（论文配置不是用户数据集）', () => {
    // 先证明样本真的躺在磁盘上，否则"没扫到"可能只是文件不存在（假通过）
    for (const rel of ['.mmodels/paper/config.json', '.mathmodel/paper/config.json', '.git/data.csv']) {
      expect(existsSync(put(rel))).toBe(true);
    }
    const r = collectDataFiles(root);
    expect(r.files).toHaveLength(0);
  });

  it('node_modules 跳过（否则会把依赖里的 csv/json 全扫成"数据集"）', () => {
    put('node_modules/pkg/data.csv');
    put('mine.csv');
    expect(collectDataFiles(root).files.map((f) => f.relPath)).toEqual(['mine.csv']);
  });

  it('★ 现状固化：build / dist / out / __pycache__ / venv **不**跳过（与 diagram.ts 的 SKIP_DIRS 不对称）', () => {
    // 不判定为 bug —— 没有证据说数据文件不会放在 build 下，而 dataset 的取舍是
    // "只排除点目录 + node_modules"。写下来是为了**免得以"漏了"为由顺手对齐**：
    // 改了它，用户放在 dist/ 下的导出数据就会从面板消失。
    for (const d of ['build', 'dist', 'out', '__pycache__', 'venv']) put(`${d}/x.csv`);
    const r = collectDataFiles(root);
    expect(r.files.map((f) => f.relPath).sort()).toEqual([
      '__pycache__/x.csv',
      'build/x.csv',
      'dist/x.csv',
      'out/x.csv',
      'venv/x.csv',
    ]);
  });

  it('★ 现状固化：指向文件的符号链接**不收**（`Dirent.isFile()` 对 symlink 为 false）', () => {
    // 现实后果：用户用 `mklink` 把大数据集挂进项目时，数据集面板里看不到它。
    // 记为观察项（见报告 §10-6.3），不是本次要修的东西。
    const outside = mkdtempSync(join(tmpdir(), 'mm-scan-ds-link-'));
    try {
      writeFileSync(join(outside, 'real.csv'), 'x');
      try {
        symlinkSync(join(outside, 'real.csv'), join(root, 'link.csv'), 'file');
      } catch {
        console.warn('[skip] 本机无法创建符号链接（需开发者模式/管理员），本条判据不可测');
        return;
      }
      const r = collectDataFiles(root);
      expect(r.files).toHaveLength(0);
      // 回归护栏：把同一个文件**真拷进来**必须能扫到（证明上面不是因为文件本身有问题）
      put('copied.csv', 'x');
      expect(collectDataFiles(root).files.map((f) => f.name)).toEqual(['copied.csv']);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('排序', () => {
  it('按 mtime 倒序 —— 最近修改的在最前（面板默认展示的就是这个顺序）', () => {
    put('old.csv');
    put('mid.csv');
    put('new.csv');
    pin('old.csv', 0);
    pin('mid.csv', 1);
    pin('new.csv', 2);
    expect(collectDataFiles(root).files.map((f) => f.name)).toEqual(['new.csv', 'mid.csv', 'old.csv']);
  });
});

describe('错误与畸形输入 —— 扫描器绝不能把 IPC 打崩', () => {
  it('root 不存在 → {files:[],truncated:false}，不抛', () => {
    expect(collectDataFiles(join(root, 'nope'))).toEqual({ files: [], truncated: false });
  });

  it('root 指向一个文件（不是目录）→ 不抛，返回空结果', () => {
    const f = put('a.csv');
    expect(collectDataFiles(f)).toEqual({ files: [], truncated: false });
  });

  it('root 是空串 → 不抛，返回空结果', () => {
    expect(collectDataFiles('')).toEqual({ files: [], truncated: false });
  });
});

describe(`数量上限 MAX_DATASETS = ${MAX_DATASETS}`, () => {
  /** 造 n 个数据文件，mtime 随文件名递增（f000 最旧） */
  function many(n: number, dirCount: number): void {
    for (let i = 0; i < n; i++) {
      const d = dirCount > 1 ? `d${i % dirCount}` : '';
      const name = `f${String(i).padStart(3, '0')}.csv`;
      const rel = d ? `${d}/${name}` : name;
      put(rel);
      pin(rel, i);
    }
  }

  it('超限时最多返回 200 条，且 truncated 为 true', () => {
    many(305, 5);
    const r = collectDataFiles(root);
    expect(r.files).toHaveLength(MAX_DATASETS);
    expect(r.truncated).toBe(true);
  });

  it('★ 已修复：磁盘上**恰好 200 个**时 truncated = false（一个都没丢就别吓唬用户）', () => {
    many(200, 1);
    const onDisk = countOnDisk();
    expect(onDisk).toBe(200); // 独立数一遍，别信被测方
    const r = collectDataFiles(root);
    expect(r.files).toHaveLength(200);
    expect(new Set(r.files.map((f) => f.relPath)).size).toBe(200);
    // 早期实现是 `out.length >= MAX_DATASETS`，而 `out.length` 永远只可能 === 200
    // ⇒ 一个都没丢也报 true。现在口径是"**是否真的还有没读完的**"：
    //   判据（回答总纲）：把 `>` 改回 `>=`，这一行立刻变 true ⇒ 红。
    expect(r.truncated).toBe(false);
  });

  it('★ 回归护栏：201 个（真的丢了一个）→ truncated 必须为 true —— 别为了"不吓唬人"把提示也去掉', () => {
    many(201, 1);
    const r = collectDataFiles(root);
    expect(r.files).toHaveLength(MAX_DATASETS);
    // 和上一条合起来才是完整的"边界两侧"：200 → false、201 → true。
    // 只测一边的话，把 truncated 写死成常量的实现也能过。
    expect(r.truncated).toBe(true);
  });

  it('★ 已修复：超限时保留的是**最近修改的 200 个**（先全收 → 排序 → 再切片）', () => {
    // 201 个文件，mtime 与文件名同向（f000 最旧、f200 最新）。
    // 取 201 而不是 200：这样才有一个"被丢弃的"可以观察。
    many(201, 1);
    const r = collectDataFiles(root);
    expect(r.files).toHaveLength(MAX_DATASETS);

    const kept = new Set(r.files.map((f) => f.relPath));
    const onDisk = readdirSync(root).filter((n) => n.endsWith('.csv')).sort();
    expect(onDisk).toHaveLength(201);
    const dropped = onDisk.filter((n) => !kept.has(n));
    expect(dropped).toHaveLength(1);

    // 「最近修改优先」：丢掉的必须是最旧的 f000。
    // 判据（回答总纲）：把截断挪回 `walk` 里（早期实现），丢掉的会变成**最新**的 f200
    //   —— 两个观测值直接对调 ⇒ 这条测试真的钉着"截断在排序之后"。
    // 早期实现的实测：丢弃 f200、保留 f000 —— 与 mtime 完全无关，纯粹是"遍历到 200 就停"。
    // （前提：NTFS 的 readdir 顺序在本机稳定且为字典序；已用
    //   _tmp/probe-build/run-ds-boundary.cjs 的 [I] 项在真实磁盘上验过：
    //   三次 readdir 一致、withFileTypes 与不带参数一致、顺序为 f000,f001,…。
    //   若换平台顺序变了、这条显红，请改判这条断言，**不要**去改产品代码。）
    expect(dropped).toEqual(['f000.csv']);
    expect(kept.has('f200.csv')).toBe(true);
    expect(r.files[0]!.name).toBe('f200.csv'); // 最新的排在最前
    // 影响面：DatabasePage 直接展示这 200 条，且它不读 truncated ⇒
    //   用户之前会看到"200 个较旧的"、刚放进去的那个反而找不到，且**没有任何提示**。
  });
});

describe('路径含空格与中文', () => {
  it('中文目录 + 文件名带空格：relPath / dir / name 都对', () => {
    put('中文 目录/再 一层/我的 数据.csv');
    const f = get(collectDataFiles(root), '中文 目录/再 一层/我的 数据.csv')!;
    expect(f.dir).toBe('中文 目录/再 一层/');
    expect(f.name).toBe('我的 数据.csv');
  });

  it('root 自己含空格/中文时，relPath 里不含 root（用的是 relative 而不是字符串裁剪）', () => {
    const sub = join(root, '中文 项目');
    mkdirSync(join(sub, 'data'), { recursive: true });
    writeFileSync(join(sub, 'data', 'x.csv'), 'x');
    const r = collectDataFiles(sub);
    expect(r.files.map((f) => f.relPath)).toEqual(['data/x.csv']);
  });
});

describe('真运行测试器状态（扫真实存在的目录，不是临时造的空壳）', () => {
  it('扫真实老项目目录：不把它自己的 .mmodels/paper/config.json 当成数据集', () => {
    const legacy = join(homedir(), 'MModels Projects', 'MModels Workspace');
    const cfg = join(legacy, '.mmodels', 'paper', 'config.json');
    if (!existsSync(cfg)) {
      console.warn('[skip] 本机没有那个真实老项目（含 .mmodels/paper/config.json），本条判据不可测');
      return;
    }
    // 先钉住前提：文件真的在、且扩展名在白名单里 —— 否则"没扫到"是白捡的
    expect(existsSync(cfg)).toBe(true);
    expect(DATA_EXT.has('.json')).toBe(true);

    const r = collectDataFiles(legacy);
    expect(r.files.some((f) => f.relPath.includes('.mmodels'))).toBe(false);
    // 通用不变量：不能把绝对路径或 ../ 泄漏给渲染层
    for (const f of r.files) {
      expect(f.relPath.startsWith('/')).toBe(false);
      expect(f.relPath.includes('..')).toBe(false);
      expect(f.relPath.includes('\\')).toBe(false);
    }
  });

  it('扫仓库 resources/ 真实目录：不抛、有真实命中、且全部是相对路径', () => {
    const res = join(process.cwd(), 'resources');
    if (!existsSync(res)) {
      console.warn('[skip] 当前 cwd 下没有 resources/，本条判据不可测');
      return;
    }
    const r = collectDataFiles(res);
    // 不求具体条数（会随资源更新变化），但求"这条链路在真实目录上确实跑通且能命中"
    expect(r.files.length).toBeGreaterThan(0);
    expect(r.truncated).toBe(false);
    for (const f of r.files) {
      expect(f.dir + f.name).toBe(f.relPath);
      expect(f.size).toBeGreaterThan(0);
      expect(f.mtimeMs).toBeGreaterThan(0);
    }
  });
});
