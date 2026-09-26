/**
 * 流程图扫描（`src/main/scan/diagram.ts` 的 `collectDiagrams`）回归测试。
 *
 * 为什么这层要单独测：
 *   它是 `diagram:list` 的唯一实现，`DiagramsPanel` 直接用它的四个字段画界面 ——
 *   `pngRelPath`（缩略图）、`stale`（"需要重新导出"提示）、`total`（"共 N 张"）、
 *   `sourceMtime`/`size`（行内副标题）。也就是说：**这几个字段算错，用户直接看得见**，
 *   而且不会报错 —— 只会安静地显示一个空图、或一句他不该看到的提示。
 *
 *   这个文件顶部的注释还写着一条架构约定：
 *     「凡是要被验证脚本直接跑的逻辑，都必须能独立 import；IPC 层只做
 *       『取参数 → 调这里 → 包结果』」
 *   所以这里**顺便把"IPC 层只包结果"也钉住**：`truncated` 是 IPC 层算的
 *   （`ipc/diagram.ts` 的 `r.total > r.diagrams.length`），不在扫描层 —— 见下面
 *   「total 与 MAX_DIAGRAMS」那组用例，两者口径必须对得上。
 *
 * ⚠️ 本文件**不 mock `node:fs`**：全部在 `os.tmpdir()` 下造真实文件树，用真实
 *   `readdirSync` / `statSync` / 真实 mtime 跑。
 *   理由同 `dataset.test.ts`：Windows 的 readdir 顺序、`Dirent` 对符号链接的判定、
 *   `existsSync` **对目录也返回 true** 这类语义，都是打桩桩不出来的 ——
 *   最后一条正是下面 ★ 那条缺陷的成因。
 *
 * ⚠️ 判据纪律：每条用例都要能回答
 *   「**如果这段逻辑是坏的，这个观测值会不一样吗？**」
 *
 * ⚠️ 本文件最初是**只加测试、未改产品代码**（验收包冻结期内），发现的缺陷只报告不修
 *   （见 `verify/func-gap-fixes.md` §10-5.7 / §10-6）。
 *   冻结期解冻后，`diagram.ts` 那两处缺陷已修（`B-dg-1` `total` 少报、
 *   `B-dg-2` 同名**目录**被当成导出图 + `statSync` 无 try/catch），
 *   本文件里对应的 `★` 用例已从"现状固化"改成"**修复后的判据**" ——
 *   它们现在是**回归护栏**：谁把按条数早退的护栏加回 `walk`、或把 `exportedAt`
 *   里的 `isFile()` 去掉，谁就红。
 *   （`existsSync` 已不再被 `diagram.ts` 使用；本文件自己仍在用，见下面几组用例。）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MAX_DIAGRAMS, collectDiagrams, type DiagramEntry } from './diagram';

/** 固定基准时间，避免用例依赖"现在几点" */
const T0 = Date.UTC(2026, 0, 1);
const HOUR = 3600_000;

/** diagram.ts 里的局部常量（未导出）—— 按源码钉死，改动会显红 */
const MAX_DEPTH = 6;
const SKIP_DIRS = [
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.ipynb_checkpoints',
  'dist',
  'build',
  'out',
];

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mm-scan-dg-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 真实写一个文件（自动建父目录） */
function put(rel: string, content = '<mxfile/>'): string {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

/** 把 mtime 钉到确定值（T0 + hours 小时；越大越新） */
function pin(rel: string, hours: number): void {
  const sec = (T0 + hours * HOUR) / 1000;
  utimesSync(join(root, rel), sec, sec);
}

const get = (r: { diagrams: DiagramEntry[] }, rel: string): DiagramEntry | undefined =>
  r.diagrams.find((d) => d.relPath === rel);

/** 造一棵 n 层深的目录链，最里层放一个 .drawio */
function deepDrawio(n: number, name = 'x.drawio'): string {
  const parts: string[] = [];
  for (let i = 1; i <= n; i++) parts.push(`d${i}`);
  parts.push(name);
  put(parts.join('/'));
  return parts.join('/');
}

/** 造一个「一个 .drawio + 可选导出图」的三件套；mtime 由 hours 控制 */
function scene(
  name: string,
  opts: { src?: number; png?: number | null; pdf?: number | null } = {},
): void {
  const src = opts.src ?? 0;
  put(`${name}.drawio`);
  pin(`${name}.drawio`, src);
  if (opts.png !== null && opts.png !== undefined) {
    put(`${name}.png`, 'png');
    pin(`${name}.png`, opts.png);
  }
  if (opts.pdf !== null && opts.pdf !== undefined) {
    put(`${name}.pdf`, 'pdf');
    pin(`${name}.pdf`, opts.pdf);
  }
}

describe('只收 .drawio，且不看扩展名大小写', () => {
  it('真实文件上：a.drawio 与 B.DRAWIO 都收，name 去掉扩展名', () => {
    put('a.drawio');
    put('B.DRAWIO');
    const r = collectDiagrams(root);
    expect(r.diagrams.map((d) => d.name).sort()).toEqual(['B', 'a']);
    expect(r.total).toBe(2);
  });

  it('同名前缀但不是 drawio 的文件不收：d.drawio.bak / e.png / f.pdf / g.drawio.txt', () => {
    put('d.drawio.bak');
    put('e.png');
    put('f.pdf');
    put('g.drawio.txt');
    const r = collectDiagrams(root);
    expect(r.diagrams).toHaveLength(0);
    expect(r.total).toBe(0);
  });

  it('c.drawio.drawio → name = "c.drawio"（只去掉最后一个 .drawio）', () => {
    put('c.drawio.drawio');
    expect(collectDiagrams(root).diagrams.map((d) => d.name)).toEqual(['c.drawio']);
  });

  it('★ 现状固化：**隐藏文件** .hidden.drawio 会被收（只跳隐藏目录，不跳隐藏文件）', () => {
    // walk() 里 `e.name.startsWith('.')` 那个判断在 `e.isDirectory()` 分支内，
    // 所以隐藏**文件**照样进结果，name 变成 ".hidden"。
    // 记为观察项（见报告 §10-6.3）：不是本次要修的，但别以为它被跳过了。
    put('.hidden.drawio');
    put('visible.drawio');
    const r = collectDiagrams(root);
    expect(r.diagrams.map((d) => d.name).sort()).toEqual(['.hidden', 'visible']);
  });
});

describe('结果结构契约（DiagramsPanel 直接按这几个字段渲染）', () => {
  it('dir + name + 扩展名 === relPath；dir 以 / 结尾；根目录文件 dir 是空串', () => {
    put('top.drawio');
    put('figures/nested.drawio');
    const r = collectDiagrams(root);
    for (const d of r.diagrams) expect(d.dir + d.name + '.drawio').toBe(d.relPath);
    expect(get(r, 'top.drawio')!.dir).toBe('');
    expect(get(r, 'figures/nested.drawio')!.dir).toBe('figures/');
    expect(get(r, 'figures/nested.drawio')!.name).toBe('nested');
  });

  it('relPath 一律正斜杠；size 是真实字节数；sourceMtime 是真实 mtime', () => {
    const abs = put('a.drawio', '<mxfile><diagram/></mxfile>'); // 27 字节
    pin('a.drawio', 3);
    const r = collectDiagrams(root);
    expect(r.diagrams[0]!.relPath).toBe('a.drawio');
    expect(r.diagrams[0]!.relPath).not.toContain('\\');
    expect(r.diagrams[0]!.size).toBe(27);
    expect(r.diagrams[0]!.sourceMtime).toBeGreaterThanOrEqual(T0 + 3 * HOUR);
    expect(existsSync(abs)).toBe(true);
  });

  it('导出图路径：只有 png / 只有 pdf / 两者都有 / 都没有（null）', () => {
    scene('pngOnly', { src: 0, png: 1 });
    scene('pdfOnly', { src: 0, pdf: 1 });
    scene('both', { src: 0, png: 1, pdf: 1 });
    scene('none', { src: 0 });
    const r = collectDiagrams(root);
    expect(get(r, 'pngOnly.drawio')!.pngRelPath).toBe('pngOnly.png');
    expect(get(r, 'pngOnly.drawio')!.pdfRelPath).toBe(null);
    expect(get(r, 'pdfOnly.drawio')!.pngRelPath).toBe(null);
    expect(get(r, 'pdfOnly.drawio')!.pdfRelPath).toBe('pdfOnly.pdf');
    expect(get(r, 'both.drawio')!.pngRelPath).toBe('both.png');
    expect(get(r, 'both.drawio')!.pdfRelPath).toBe('both.pdf');
    expect(get(r, 'none.drawio')!.pngRelPath).toBe(null);
    expect(get(r, 'none.drawio')!.pdfRelPath).toBe(null);
  });

  it('子目录里的图：导出图取**自己那一层**的路径，不会串到别的同名图', () => {
    scene('a/flow', { src: 0, png: 1 });
    scene('b/flow', { src: 0, png: 1 });
    scene('flow', { src: 0, png: 1 });
    const r = collectDiagrams(root);
    expect(get(r, 'a/flow.drawio')!.pngRelPath).toBe('a/flow.png');
    expect(get(r, 'b/flow.drawio')!.pngRelPath).toBe('b/flow.png');
    expect(get(r, 'flow.drawio')!.pngRelPath).toBe('flow.png');
  });
});

describe('stale 判定（就是界面上那句"需要重新导出"）', () => {
  const cases: Array<[string, Parameters<typeof scene>[1], boolean]> = [
    ['完全没有导出图 → 待导出', { src: 0 }, true],
    ['png 比源文件新 → 已导出', { src: 0, png: 5 }, false],
    ['png 比源文件旧 → 待导出', { src: 0, png: -5 }, true],
    ['png 与源文件**同一时刻** → 已导出（判据是严格小于）', { src: 0, png: 0 }, false],
    ['png 旧但 pdf 新 → 已导出（取两张里最新的那张）', { src: 0, png: -5, pdf: 5 }, false],
    ['png 新但 pdf 旧 → 已导出', { src: 0, png: 5, pdf: -5 }, false],
    ['只有 pdf，且 pdf 新 → 已导出', { src: 0, pdf: 5 }, false],
    ['只有 pdf，且 pdf 旧 → 待导出', { src: 0, pdf: -5 }, true],
  ];
  for (const [title, opts, expected] of cases) {
    it(title, () => {
      scene('x', opts);
      const r = collectDiagrams(root);
      expect(r.diagrams).toHaveLength(1);
      expect(r.diagrams[0]!.stale).toBe(expected);
    });
  }
});

describe('跳过的目录（SKIP_DIRS + 一切点目录）', () => {
  for (const dir of SKIP_DIRS) {
    it(`跳过 ${dir}/ 里的 drawio`, () => {
      put(`${dir}/x.drawio`);
      put('keep.drawio');
      const r = collectDiagrams(root);
      expect(r.diagrams.map((d) => d.relPath)).toEqual(['keep.drawio']);
    });
  }

  it('通用点目录（不在 SKIP_DIRS 名单里）也跳过', () => {
    put('.cache/x.drawio');
    put('.mmodels-audit/x.drawio');
    put('keep.drawio');
    expect(collectDiagrams(root).diagrams.map((d) => d.relPath)).toEqual(['keep.drawio']);
  });

  it('★ 对照：figures/ 与 figures/sub/ 这类正常目录**不**跳过（别把跳过面放大）', () => {
    put('figures/a.drawio');
    put('figures/sub/b.drawio');
    expect(collectDiagrams(root).diagrams.map((d) => d.relPath).sort()).toEqual([
      'figures/a.drawio',
      'figures/sub/b.drawio',
    ]);
  });

  it('★ 现状固化：指向文件的符号链接不收（`Dirent.isFile()` 对 symlink 为 false）', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mm-scan-dg-link-'));
    try {
      writeFileSync(join(outside, 'real.drawio'), '<mxfile/>');
      try {
        symlinkSync(join(outside, 'real.drawio'), join(root, 'link.drawio'), 'file');
      } catch {
        console.warn('[skip] 本机无法创建符号链接（需开发者模式/管理员），本条判据不可测');
        return;
      }
      expect(collectDiagrams(root).diagrams).toHaveLength(0);
      put('copied.drawio'); // 回归护栏
      expect(collectDiagrams(root).diagrams.map((d) => d.name)).toEqual(['copied']);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe(`递归与深度上限（MAX_DEPTH = ${MAX_DEPTH}）`, () => {
  it(`深度 ${MAX_DEPTH} 能扫到（边界内侧）`, () => {
    const rel = deepDrawio(MAX_DEPTH);
    expect(collectDiagrams(root).diagrams.map((d) => d.relPath)).toEqual([rel]);
  });

  it(`深度 ${MAX_DEPTH + 1} 扫不到（边界外侧），但同树上边界内侧的能扫到`, () => {
    deepDrawio(MAX_DEPTH + 1, 'too-deep.drawio');
    expect(collectDiagrams(root).diagrams).toHaveLength(0);
    const ok = deepDrawio(MAX_DEPTH, 'ok.drawio');
    expect(collectDiagrams(root).diagrams.map((d) => d.relPath)).toEqual([ok]);
  });
});

describe('排序、total 与 MAX_DIAGRAMS', () => {
  it('按源文件 mtime 倒序', () => {
    scene('old', { src: 0 });
    scene('mid', { src: 1 });
    scene('new', { src: 2 });
    expect(collectDiagrams(root).diagrams.map((d) => d.name)).toEqual(['new', 'mid', 'old']);
  });

  it(`超过 ${MAX_DIAGRAMS} 张时只返回最近修改的 ${MAX_DIAGRAMS} 张，total 是**切片前**的全量`, () => {
    for (let i = 0; i < 61; i++) {
      const name = `f${String(i).padStart(2, '0')}`;
      put(`${name}.drawio`);
      pin(`${name}.drawio`, i); // mtime 随文件名递增：f00 最旧
    }
    const r = collectDiagrams(root);
    expect(r.total).toBe(61); // ← IPC 层用它算 truncated：61 > 60 ⇒ 界面显示"只显示了最近修改的一部分"
    expect(r.diagrams).toHaveLength(MAX_DIAGRAMS);
    expect(r.diagrams[0]!.name).toBe('f60');
    expect(r.diagrams[MAX_DIAGRAMS - 1]!.name).toBe('f01');
    // 被丢掉的是最旧的一张 —— 这一条是"最近修改优先"的真正判据
    expect(r.diagrams.some((d) => d.name === 'f00')).toBe(false);
  });

  it('★ 已修复：源文件多于 240 时 total 仍然**精确**（界面上"共 N 张"必须对）', () => {
    // 早期实现的 `walk()` 护栏是 `out.length > MAX_DIAGRAMS * 4`（>240），而且它**按目录**判定：
    //   集满一个目录就整体返回，不再进入后面的目录。
    // 这里造 5 个目录各 61 张 = 305 张。早期实现会停在 244，与 readdir 顺序无关地**稳定少报 61**。
    // 修法：条数上限只用在"最后返回多少条"（`all.slice(0, MAX_DIAGRAMS)`），
    //       真正的遍历边界是 `MAX_DEPTH` + `SKIP_DIRS` —— 见 `diagram.ts` 的 `walk` 注释。
    for (let d = 0; d < 5; d++) {
      for (let i = 0; i < 61; i++) put(`d${d}/f${String(i).padStart(2, '0')}.drawio`);
    }
    const r = collectDiagrams(root);
    // 判据（回答总纲）：把护栏加回去，这一行立刻变回 244 ⇒ 这条测试真的钉着"计数不受条数上限影响"。
    expect(r.total).toBe(305);
    expect(r.diagrams).toHaveLength(MAX_DIAGRAMS);
    expect(r.total > r.diagrams.length).toBe(true); // truncated 仍然是 true（提示是对的）
  });

  it('★ 回归护栏：`total` 数的是**全部**，`diagrams` 只给最近 60 张 —— 两者的分工不能混', () => {
    // 同一次扫描里同时看两个观测值：
    //   total    = 磁盘上真实有几张（给"共 N 张"和 truncated 用）
    //   diagrams = 按 mtime 倒序取前 60（给列表用）
    // 如果谁把它们合成一个数（比如像早期实现那样用条数上限去截遍历），必然有一个错。
    for (let d = 0; d < 2; d++) {
      for (let i = 0; i < 40; i++) {
        const rel = `g${d}/f${String(i).padStart(2, '0')}.drawio`;
        put(rel);
        pin(rel, d * 100 + i);
      }
    }
    const r = collectDiagrams(root);
    expect(r.total).toBe(80);
    expect(r.diagrams).toHaveLength(MAX_DIAGRAMS);
    // 最新的那张一定在（g1 的 f39），最旧的一定不在（g0 的 f00）
    expect(r.diagrams[0]!.name).toBe('f39');
    expect(r.diagrams[0]!.dir).toBe('g1/');
    expect(r.diagrams.some((x) => x.relPath === 'g0/f00.drawio')).toBe(false);
  });
});

describe('错误与畸形输入', () => {
  it('root 不存在 → {diagrams:[],total:0}，不抛', () => {
    expect(collectDiagrams(join(root, 'nope'))).toEqual({ diagrams: [], total: 0 });
  });

  it('root 指向一个文件 → 不抛，返回空结果', () => {
    const f = put('a.drawio');
    expect(collectDiagrams(f)).toEqual({ diagrams: [], total: 0 });
  });

  it('root 是空串 → 不抛，返回空结果', () => {
    expect(collectDiagrams('')).toEqual({ diagrams: [], total: 0 });
  });
});

describe('★ 已修复：和源文件同名的**目录**不算"已导出的图"', () => {
  it('名为 x.png 的目录 → pngRelPath = null、stale = true（不再把目录当缩略图）', () => {
    put('x.drawio');
    pin('x.drawio', 0); // 源文件定在很久以前
    mkdirSync(join(root, 'x.png')); // ……而"导出图"其实是个目录，mtime 是刚才

    const r = collectDiagrams(root);
    expect(r.diagrams).toHaveLength(1);
    // 早期实现：`existsSync` 对目录也返回 true、`statSync(dir)` 也成功 ⇒ 通过全部检查，
    //   于是 pngRelPath 指向一个目录（缩略图永远加载不出来）、stale=false（也不提示待导出）。
    // 现在：导出图必须 **存在且是文件** ⇒ 目录一律当作"没有导出图"。
    // 判据（回答总纲）：这两行就是全部观测值；把 `exportedAt` 的 `isFile()` 去掉，两行同时变回
    //   `'x.png'` / `false` ⇒ 红。
    expect(r.diagrams[0]!.pngRelPath).toBe(null);
    expect(r.diagrams[0]!.stale).toBe(true);

    // ★ 回归护栏：把那个目录换成**真文件**，行为必须变回"已导出"
    //   —— 证明上面那两行红的是"目录 vs 文件"，不是"x.png 这个路径本身不被认"。
    rmSync(join(root, 'x.png'), { recursive: true });
    writeFileSync(join(root, 'x.png'), 'png');
    pin('x.png', 1);
    const r2 = collectDiagrams(root);
    expect(r2.diagrams[0]!.pngRelPath).toBe('x.png');
    expect(r2.diagrams[0]!.stale).toBe(false);
  });

  it('同一条规则的第二种观测：x.pdf 是目录时也不会被填进 pdfRelPath', () => {
    put('y.drawio');
    pin('y.drawio', 0);
    mkdirSync(join(root, 'y.pdf'));
    const r1 = collectDiagrams(root);
    expect(r1.diagrams[0]!.pdfRelPath).toBe(null);
    expect(r1.diagrams[0]!.stale).toBe(true);

    // 回归护栏：png 是真文件（新）→ 已导出；pdf 是目录 → 不影响
    writeFileSync(join(root, 'y.png'), 'png');
    pin('y.png', 1);
    const r2 = collectDiagrams(root);
    expect(r2.diagrams[0]!.pdfRelPath).toBe(null);
    expect(r2.diagrams[0]!.pngRelPath).toBe('y.png');
    expect(r2.diagrams[0]!.stale).toBe(false);
  });
});

describe('路径含空格与中文', () => {
  it('中文目录 + 文件名带空格：relPath / name / dir / 导出图路径都对', () => {
    put('中文 目录/再 一层/流程 图.drawio');
    put('中文 目录/再 一层/流程 图.png');
    const r = collectDiagrams(root);
    const d = get(r, '中文 目录/再 一层/流程 图.drawio')!;
    expect(d.name).toBe('流程 图');
    expect(d.dir).toBe('中文 目录/再 一层/');
    expect(d.pngRelPath).toBe('中文 目录/再 一层/流程 图.png');
  });

  it('root 自己含空格/中文时，relPath 里不含 root（用的是 relative 而不是字符串裁剪）', () => {
    const sub = join(root, '中文 项目');
    mkdirSync(join(sub, 'figures'), { recursive: true });
    writeFileSync(join(sub, 'figures', 'a.drawio'), '<mxfile/>');
    expect(collectDiagrams(sub).diagrams.map((d) => d.relPath)).toEqual(['figures/a.drawio']);
  });
});

describe('真运行测试器状态（扫真实存在的目录，不是临时造的空壳）', () => {
  it('扫真实老项目目录：不抛，且不会顺着 .mmodels（点目录）爬进去', () => {
    const legacy = join(homedir(), 'MModels Projects', 'MModels Workspace');
    if (!existsSync(legacy)) {
      console.warn('[skip] 本机没有那个真实老项目目录，本条判据不可测');
      return;
    }
    expect(existsSync(join(legacy, '.mmodels', 'paper'))).toBe(true); // 先钉住前提
    const r = collectDiagrams(legacy);
    for (const d of r.diagrams) {
      expect(d.relPath.startsWith('/')).toBe(false);
      expect(d.relPath.includes('..')).toBe(false);
      expect(d.relPath.includes('\\')).toBe(false);
      expect(d.relPath.includes('.mmodels')).toBe(false);
    }
  });

  it('扫仓库 resources/ 真实目录：不抛、形状合法、且**两次结果一致**', () => {
    const res = join(process.cwd(), 'resources');
    if (!existsSync(res)) {
      console.warn('[skip] 当前 cwd 下没有 resources/，本条判据不可测');
      return;
    }
    const a = collectDiagrams(res);
    const b = collectDiagrams(res);
    // 判据（回答总纲）：这条测的是"真实目录上的确定性"。
    //   若哪天有人把上限判据改成依赖遍历副作用（比如复用同一个 hits 数组），
    //   两次调用的结果就会不一样 —— 观测值会变。
    expect(b.diagrams.map((d) => d.relPath)).toEqual(a.diagrams.map((d) => d.relPath));
    expect(b.total).toBe(a.total);
    expect(a.diagrams.length).toBeLessThanOrEqual(MAX_DIAGRAMS);
    expect(a.total).toBeGreaterThanOrEqual(a.diagrams.length);
    for (const d of a.diagrams) {
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.dir + d.name + '.drawio').toBe(d.relPath);
    }
  });

  it('扫仓库根真实目录：不抛，且不会爬进 node_modules / dist / out / build', () => {
    const repo = process.cwd();
    const r = collectDiagrams(repo);
    expect(r.diagrams.length).toBeLessThanOrEqual(MAX_DIAGRAMS);
    expect(r.total).toBeGreaterThanOrEqual(r.diagrams.length);
    // 前提自检：这两个目录在仓库里**确实存在**（否则"没爬进去"是白捡的）
    expect(existsSync(join(repo, 'node_modules'))).toBe(true);
    expect(existsSync(join(repo, 'dist')) || existsSync(join(repo, 'out'))).toBe(true);
    // ⚠️ 注意 `release/` **不在** SKIP_DIRS 里，它是会被扫的（本机恰好没有 .drawio）；
    //    所以这里只断言真正声明要跳的那几个，别把"没搜到"当成"跳过了"。
    for (const d of r.diagrams) {
      for (const skip of ['node_modules/', 'dist/', 'out/', 'build/', '.mmodels-audit/', '.git/']) {
        expect(d.relPath.startsWith(skip)).toBe(false);
      }
    }
  });
});
