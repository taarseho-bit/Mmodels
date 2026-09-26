/**
 * `environment.ts` —— **真运行测试器状态**（不打桩、真的去执行 `--version`）
 *
 * 为什么要单独一个文件、且**不能**和 `environment.test.ts` 合并：
 *   `vi.mock` 会被提升到**整个文件**。一旦和打桩版放在一起，真实探测也会被一起打桩，
 *   而 `environment.ts` 的核心价值恰恰是"**能反映本机真实探测结果**"（文件头原话：
 *   "全部是确定性检测，不调用任何模型"）。打桩掉它 = 验的是我的想象力。
 *
 * ⚠️ 本文件**只跑只读探测**（`--version` / `python -c "import ..."`）——
 *    `environment.ts` 本身也只做只读探测，**绝不安装任何东西**。
 *    **不要**把这里当成"可以顺手装环境"的地方：加安装类命令会让 `npm test` 变成有副作用的操作。
 *
 * ── 断言的选取原则 ──
 * 1. **不变式**（在任何机器上都成立）：计数口径、字段契约、`unknown` 的适用范围、
 *    两次探测结果一致（"确定性检测"这句承诺的判据）。
 * 2. **跨机器可判的性质**：例如"有括号 `(…TeX…)` 时 version 必须等于括号里那段"——
 *    它在 TeX Live / MiKTeX 上都成立，且**能证伪**（实现坏掉会回落成 XeTeX 引擎号）。
 * 3. **本机特定值一律不写死**（`2.55.0` 这种写进去等于换台机器就红）。
 *    需要本机事实时，用**回归护栏**：同一台机器上只改一个变量，看观测值变不变。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { checkEnvironment, findPython, PATH_DELIMITER, type EnvCheckResult } from './environment';

/** 真实探测在本机约 2 秒（xelatex / latexmk 是 Perl 与 TeX 启动），给足超时 */
const REAL_TIMEOUT = 60_000;

let r1: EnvCheckResult;
let r2: EnvCheckResult;

const item = (r: EnvCheckResult, id: string) => r.items.find((i) => i.id === id)!;

beforeAll(async () => {
  r1 = await checkEnvironment();
  r2 = await checkEnvironment(); // 第二次：验"确定性"
}, REAL_TIMEOUT);

describe('真实探测：能跑起来、并如实反映本机', () => {
  it('返回结构完整，且 elapsedMs 是有限数字', () => {
    expect(r1.items.length).toBeGreaterThanOrEqual(11);
    expect(typeof r1.platform).toBe('string');
    expect(Number.isFinite(r1.elapsedMs)).toBe(true);
    expect(r1.elapsedMs).toBeGreaterThanOrEqual(0);
    // 回归护栏：若哪天忘了赋值（比如提前 return），这里会变 undefined → 红。
  });

  it('每一项都有 id / name / purpose，level 与 status 取值合法', () => {
    for (const i of r1.items) {
      expect(i.id, JSON.stringify(i)).toBeTruthy();
      expect(i.name, i.id).toBeTruthy();
      expect(i.purpose, i.id).toBeTruthy();
      expect(['required', 'recommended'], i.id).toContain(i.level);
      expect(['ok', 'missing', 'unknown'], i.id).toContain(i.status);
    }
  });

  it('detail / version 一定不含换行（firstLine 的承诺）', () => {
    for (const i of r1.items) {
      // 回归护栏：若去掉 firstLine 直接塞整段 stdout，多行版本串会带 \n → 界面错行 → 红。
      expect(String(i.detail ?? ''), i.id).not.toContain('\n');
      expect(String(i.version ?? ''), i.id).not.toContain('\n');
    }
  });

  it('★ 确定性：同一台机器连跑两次，id / level / status 逐项一致', () => {
    const project = (r: EnvCheckResult) => r.items.map((i) => `${i.id}|${i.level}|${i.status}`);
    // 回归护栏：若探测混进了随机或模型调用（文件头明确说"不调用任何模型"），
    // 两次结果就可能不同 → 这条会红。这是把那句承诺变成可执行判据。
    expect(project(r2)).toEqual(project(r1));
  });

  it('计数口径与实际逐项一致；ok 只看必需项', () => {
    for (const r of [r1, r2]) {
      const reqBad = r.items.filter((i) => i.level === 'required' && i.status !== 'ok').length;
      const recBad = r.items.filter((i) => i.level === 'recommended' && i.status !== 'ok').length;
      expect(r.missingRequired).toBe(reqBad);
      expect(r.missingRecommended).toBe(recBad);
      expect(r.ok).toBe(reqBad === 0);
    }
  });

  it('`unknown` 只允许出现在 py:*（工具探测不会用 unknown）', () => {
    const unknown = r1.items.filter((i) => i.status === 'unknown');
    // 回归护栏：若工具分支也改成"探不到就 unknown"，这里会多出非 py: 的 id → 红。
    expect(unknown.every((i) => i.id.startsWith('py:'))).toBe(true);
  });

  it('Python 可用时，包项一律不得是 unknown（降级只发生在 Python 不可用时）', () => {
    const py = item(r1, 'python');
    if (py.status !== 'ok') return; // 本机没 Python 时不适用
    // 回归护栏：若包探测失败时错误地降级成 unknown（而不是 missing），这里会红。
    // 语义区别很实际：Python 在，包在不在是**已知事实**；Python 不在才是"未知"。
    const pkgs = r1.items.filter((i) => i.id.startsWith('py:'));
    expect(pkgs.every((p) => p.status === 'ok' || p.status === 'missing')).toBe(true);
  });
});

describe('真实探测：跨机器可判的性质（换台机器也成立，且能证伪）', () => {
  it('git 的 version 只保留点分数字，**不含**发行版后缀', () => {
    const g = item(r1, 'git');
    if (g.status !== 'ok') return;
    expect(g.version).toMatch(/^\d+\.\d+/);
    // 回归护栏：本机是 `2.55.0.windows.3`；若实现改成整串直接采用，这里会含 `windows` → 红。
    expect(String(g.version)).not.toMatch(/windows|darwin|linux/i);
  });

  it('xelatex 的 version 等于括号里那段 `(…TeX…)`，不是 XeTeX 引擎号', () => {
    const x = item(r1, 'xelatex');
    if (x.status !== 'ok') return;
    const paren = /\(([^)]*TeX[^)]*)\)/i.exec(String(x.detail ?? ''))?.[1]?.trim();
    if (!paren) return; // 某些发行版的首行没有括号，此时走数字回落（另有打桩用例覆盖）
    // 回归护栏：若 `(...TeX...)` 那段提取坏掉，version 会回落成 `3.141592653…` → 与 paren 不等 → 红。
    // 本机实测：detail = `XeTeX 3.141592653-2.6-0.999996 (TeX Live 2024)`，version = `TeX Live 2024`。
    expect(x.version).toBe(paren);
    expect(x.version).not.toMatch(/^\d/);
  });

  it('凡解析出 path 的项：path 必须是绝对路径（且 python 的 path 真的存在）', () => {
    const withPath = r1.items.filter((i) => i.path);
    for (const i of withPath) {
      // 回归护栏：若哪天把 `where` 的原始输出直接塞进去（可能带前缀/相对名），isAbsolute 会为假 → 红。
      expect(isAbsolute(i.path!), `${i.id}=${i.path}`).toBe(true);
    }

    const py = item(r1, 'python');
    if (py.status === 'ok' && py.path) {
      // python 的 path 来自解释器自报的 sys.executable —— **必须真的存在**。
      // 回归护栏：若改成用 where 的第一条（本机会命中 Microsoft Store 别名或另一个解释器），
      // 也可能存在……所以再钉一条"文件名含 python"，把明显错的东西挡掉。
      expect(existsSync(py.path), py.path).toBe(true);
      expect(basename(py.path).toLowerCase()).toContain('python');
    }
  });

  it('中文字体项：ok 时 detail 是文件名，missing 时没有 detail', () => {
    const f = item(r1, 'cjkfont');
    if (f.status === 'ok') {
      expect(String(f.detail)).not.toMatch(/[\\/]/);
    } else {
      expect(f.status).toBe('missing');
      expect(f.detail).toBeUndefined();
    }
  });

  it('★ LaTeX 三件套：detail 必须是**含版本号的那一行**（不是代码页通知 / 不是空）', () => {
    // 跨机器可判的性质：TeX 发行版换一个、版本号换一个，但"detail 里得有版本号"始终成立。
    // 而**能证伪**：早期实现取 stdout 首行，本机 latexmk 的首行是
    //   `Initial Win CP for (console input, console output, system): (CP936, CP936, CP936)`
    // —— 一串代码页通知，version 还会被解析成 `936`。
    for (const id of ['xelatex', 'latexmk', 'bibtex']) {
      const i = item(r1, id);
      if (i.status !== 'ok') continue; // 本机没装某个发行版时不适用
      expect(String(i.detail), `${id} detail=${i.detail}`).not.toContain('CP936');
      expect(String(i.detail), `${id} detail=${i.detail}`).toMatch(/\d/); // 至少得有个数字
      // 回归护栏：latexmk / bibtex 在早期实现里 version 恒为 undefined（`if (id === 'xelatex')` 吞掉了 else）
      expect(i.version, `${id} detail=${i.detail}`).toBeTruthy();
    }
  });
});

describe('真实探测：回归护栏 —— 同一台机器上只改 resourcesDir', () => {
  it('uv：本机 PATH 上没有它（missing），但把 resourcesDir 指向一个含 `bin/uv` 的目录就变 ok', async () => {
    const res = mkdtempSync(join(tmpdir(), 'mm-env-real-'));
    mkdirSync(join(res, 'bin'), { recursive: true });
    writeFileSync(join(res, 'bin', 'uv.exe'), ''); // 空文件：只验"有没有被找到"

    const withoutRes = await checkEnvironment();
    const withRes = await checkEnvironment(undefined, res);

    // 回归护栏的**最强形态**：同一台机器、唯一变量是 resourcesDir，观测值必须不同。
    // 若漏了"随包"分支（只看 PATH），withRes 也会是 missing → 两条断言同时红。
    if (withoutRes.items.find((i) => i.id === 'uv')!.status === 'missing') {
      expect(item(withRes, 'uv').status).toBe('ok');
      expect(item(withRes, 'uv').path).toBe(join(res, 'bin', 'uv.exe'));
      expect(String(item(withRes, 'uv').detail)).toContain('随包');
    } else {
      // 本机 PATH 上真的有 uv 时，至少证明"随包"分支把 path 换成了随包那份
      expect(item(withRes, 'uv').path).toBe(join(res, 'bin', 'uv.exe'));
    }
  }, REAL_TIMEOUT);
});

describe('findPython 的真实返回（不打桩）', () => {
  it('返回值形状合法：cmd 非空、prefixArgs 是数组', async () => {
    // ⚠️ `findPython` 现在是 async（它要**逐个候选试**，见其注释），必须 await。
    const py = await findPython();
    expect(py).not.toBeNull();
    expect(typeof py!.cmd).toBe('string');
    expect(py!.cmd.length).toBeGreaterThan(0);
    expect(Array.isArray(py!.prefixArgs)).toBe(true);
  });

  it('★ 返回的解释器**真的能跑**（不是从候选表里挑了个名字）', async () => {
    const py = await findPython();
    if (!py) return; // 本机没 Python 时真检测会给出 null，不是缺陷
    // 回归护栏：早期实现恒取 `candidates[0]`（= 字面量 `python`），在"只有 python3"的机器上
    // 会返回一个**跑不起来**的名字。这里把"返回的东西必须真能报出 Python 3"变成可执行判据。
    // 本机实测三个候选（python / python3 / py）都可用（`_tmp/env-b123-probe.txt` [E]），
    // 所以**本机看不出这次修复的差别** —— 差别由 `environment.test.ts` 的打桩用例覆盖。
    const r = await new Promise<{ out: string; code: number }>((resolve) => {
      execFile(py.cmd, [...py.prefixArgs, '--version'], { timeout: 20_000, windowsHide: true }, (err, stdout, stderr) => {
        resolve({ out: String(stdout ?? '') + String(stderr ?? ''), code: err ? 1 : 0 });
      });
    });
    expect(r.code, `${py.cmd} → ${r.out}`).toBe(0);
    expect(r.out).toMatch(/python\s+3/i);
  }, REAL_TIMEOUT);

  it('PATH_DELIMITER 与平台一致（界面排查环境问题会用到）', () => {
    // 回归护栏：若硬编码成 ':'，Windows 上就是错的 → 红。
    expect(PATH_DELIMITER).toBe(process.platform === 'win32' ? ';' : ':');
  });
});
