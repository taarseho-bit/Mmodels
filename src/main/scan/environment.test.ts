/**
 * `environment.ts` —— **分支与版本串解析**（`child_process` 被打桩）
 *
 * 为什么要打桩：这一层要覆盖"**工具在、但版本串很怪**"和"**工具不在**"这些分支，
 * 它们**没法在本机同时真实出现**（本机 python/git/xelatex 都在）。
 * 所以本文件把 `execFile` 换成脚本化的假实现，**只替换"命令的返回值"**，
 * 被测逻辑（版本号解析、分支选择、聚合计数）全是产品代码里那一份。
 *
 * ⚠️ 本文件**不跑任何真实命令**（`execFile` 是假的），因此**永远不会安装任何东西**。
 *
 * 真实机器状态的覆盖在隔壁 `environment.real.test.ts` —— 两个文件分开是**必须的**：
 * `vi.mock` 会被提升到整个文件，混在一起会把真实探测也一起打桩，
 * 那样 `environment.ts` 的价值（"能反映本机真实探测结果"）就没了。
 *
 * ── 本文件里每条用例都写了一句「反向对照」──
 *    回答总纲：**"如果这段逻辑是坏的，这个观测值会不一样吗？"**
 *    答不出来的用例就是装饰，不要写。
 *
 * ── 本次变更（冻结期解冻后）──
 *   这份文件之前有 **三条"现状固化"用例**（把已报告的缺陷锁住，等修好那天变红提醒后来人）。
 *   `B1`（Python 回退不可达）/ `B2`（PDF 转图 `firstAvailable` 的外层死逻辑）/
 *   `B3`（latexmk / bibtex 恒无 version）修完之后，它们**如期变红**了 ——
 *   已按修复后的判据重写，并各补了反向对照。这正说明那三条不是装饰。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 打桩小黑板：记录每一次 execFile 调用，并按 cmd 分发脚本化返回 */
const shell = vi.hoisted(() => {
  type Reply = { err?: Error | null; stdout?: string; stderr?: string };
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const script = new Map<string, (args: string[]) => Reply>();
  return {
    calls,
    script,
    reset() {
      calls.length = 0;
      script.clear();
    },
  };
});

/**
 * 造一个"命令**根本没起来**"的错误。
 *
 * ⚠️ 不能只写 `new Error('ENOENT')`：真实 `execFile` 在 ENOENT 时会把
 *    `err.code === 'ENOENT'`（**字符串**）设上（实测见 `_tmp/env-b123-probe.txt` [F]：
 *    `errCode='ENOENT'`、`errno=-4058`、`syscall='spawn <cmd>'`）。
 *    产品代码里 `notFound` 的判据是 `typeof code === 'string' && SPAWN_ERROR_CODES.has(code)`，
 *    桩件少了 `.code` ⇒ 这一半判据**永远走不到**，`notFound` 恒为 false ⇒ 打桩失真。
 *    （"命令不存在"和"存在但退出码非 0"必须能分开，见 `ProbeResult.notFound` 注释。）
 */
function spawnError(code = 'ENOENT'): Error & { code: string } {
  const e = new Error(`spawn ${code}`) as Error & { code: string };
  e.code = code;
  return e;
}

vi.mock('node:child_process', () => ({
  execFile(
    cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) {
    shell.calls.push({ cmd, args: [...args] });
    const fn = shell.script.get(cmd);
    const r: { err?: Error | null; stdout?: string; stderr?: string } = fn
      ? fn([...args])
      : { err: spawnError() }; // 未登记 = 这台机器上没有这个命令（跟真实 ENOENT 同形）
    // 真实 execFile 是**异步**回调。用 queueMicrotask 保真：
    // 若产品代码漏了 await，这里会暴露成"读到空结果"，而不是"恰好也对"。
    queueMicrotask(() => cb(r.err ?? null, r.stdout ?? '', r.stderr ?? ''));
    return undefined as never;
  },
}));

// vi.mock 会被提升到文件顶部，所以这里用普通 import 即可（与 migrate.test.ts 一致）
import { checkEnvironment, findPython } from './environment';

const NOT_FOUND = { err: spawnError() };
/** "命令在，但这次调用失败了"（退出码非 0）—— 与 NOT_FOUND 是**两件不同的事** */
const exited = (code = 1): Error & { code: number } => {
  const e = new Error(`exit ${code}`) as Error & { code: number };
  e.code = code;
  return e;
};

/** 登记一个"存在且 --version 正常"的工具 */
function present(cmd: string, versionLine: string): void {
  shell.script.set(cmd, (args) => {
    if (args.includes('--version') || args.includes('-v')) {
      return { err: null, stdout: versionLine + '\n', stderr: '' };
    }
    return { err: null, stdout: versionLine + '\n', stderr: '' };
  });
}

/** 登记 `where`/`which`（按平台，两个都登记以免平台差异把用例变成红） */
function locate(lines: string[]): void {
  const reply = { err: null, stdout: lines.join('\n') + '\n', stderr: '' };
  shell.script.set('where', () => reply);
  shell.script.set('which', () => reply);
}

/** 登记 python：`--version` / `sys.executable` / 包清单 JSON 三种调用 */
function scriptPython(o: {
  version?: string | null;
  exe?: string;
  pkgs?: Record<string, string | null>;
  pkgRaw?: string;
}): void {
  shell.script.set('python', (args) => {
    const code = args[1] ?? '';
    if (args.includes('--version')) {
      if (o.version === null) return NOT_FOUND;
      return { err: null, stdout: (o.version ?? 'Python 3.13.14') + '\n', stderr: '' };
    }
    if (code.includes('sys.executable')) {
      return { err: null, stdout: (o.exe ?? 'C:\\py\\python.exe') + '\n', stderr: '' };
    }
    if (code.includes('importlib.metadata')) {
      if (o.pkgRaw !== undefined) return { err: null, stdout: o.pkgRaw, stderr: '' };
      return { err: null, stdout: JSON.stringify(o.pkgs ?? {}) + '\n', stderr: '' };
    }
    return NOT_FOUND;
  });
}

const item = (r: Awaited<ReturnType<typeof checkEnvironment>>, id: string) =>
  r.items.find((i) => i.id === id)!;

beforeEach(() => {
  shell.reset();
  // 默认：什么都没装。各用例按需登记。
  locate(['C:\\bin\\tool.exe']);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('版本号解析：非标准版本串（原版只显示前三段）', () => {
  it('git 的 `2.55.0.windows.3` → 只取 `2.55.0`（这是本机真实版本串）', async () => {
    present('git', 'git version 2.55.0.windows.3');
    const r = await checkEnvironment();
    // 反向对照：若实现改成"整串照抄"，观测值会变成 `2.55.0.windows.3` → 立刻红。
    expect(item(r, 'git').version).toBe('2.55.0');
    // 而**原始首行**必须完整保留在 detail（界面要能看全）
    expect(item(r, 'git').detail).toBe('git version 2.55.0.windows.3');
  });

  it('git 的单段版本 `git version 2` → undefined（口径：至少两段数字）', async () => {
    present('git', 'git version 2');
    const r = await checkEnvironment();
    // 反向对照：若正则放宽成 `\d+`，观测值会从 undefined 变成 `2`。
    expect(item(r, 'git').version).toBeUndefined();
  });

  it('xelatex 优先取括号里的 `TeX Live 2024`，**不是** XeTeX 引擎号', async () => {
    present('xelatex', 'XeTeX 3.141592653-2.6-0.999996 (TeX Live 2024)');
    const r = await checkEnvironment();
    // 反向对照：若 `(...TeX...)` 那段提取坏掉，会回落到 numericVersion → 变成 `3.141592653`。
    expect(item(r, 'xelatex').version).toBe('TeX Live 2024');
    expect(item(r, 'xelatex').version).not.toBe('3.141592653');
  });

  it('xelatex 没有括号时回落数字版本', async () => {
    present('xelatex', 'XeTeX 3.141592653-2.6-0.999996');
    const r = await checkEnvironment();
    expect(item(r, 'xelatex').version).toBe('3.141592653');
  });

  it('★ 已修复：LaTeX 三件套**三个都**能解析出版本（latexmk / bibtex 不再恒 undefined）', async () => {
    present('xelatex', 'XeTeX 3.141592653 (TeX Live 2024)');
    present('latexmk', 'Latexmk, John Collins, 27 Dec. 2024. Version 4.86a');
    present('bibtex', 'BibTeX 0.99d (TeX Live 2024)');
    const r = await checkEnvironment();
    expect(item(r, 'xelatex').version).toBe('TeX Live 2024');
    // 反向对照：若 `id === 'xelatex'` 那个分支把 else 吞了（旧实现就是这样），
    // 这两条会回到 undefined → 红。字段注释说 version 是"原版会显示的那一段"，
    // 而它们的输出里明摆着有版本号 —— 恒缺一半是没道理的。
    expect(item(r, 'latexmk').version).toBe('4.86'); // 注意**不是** `2024`（那年月日也在串里）
    expect(item(r, 'bibtex').version).toBe('0.99');
  });
});

describe('toolLine：latexmk 的版本行在第 3 行（首行是代码页通知）', () => {
  it('★ 已修复：latexmk 的 detail 取到版本行，不再显示 CP936 通知', async () => {
    shell.script.set('latexmk', () => ({
      err: null,
      stdout:
        [
          'Initial Win CP for (console input, console output, system): (CP936, CP936, CP936)',
          'I changed them all to CP936',
          'Latexmk, John Collins, 27 Dec. 2024. Version 4.86a',
        ].join('\n') + '\n',
      stderr: 'perl: warning: Setting locale failed.\n',
    }));
    const r = await checkEnvironment();
    // 反向对照：若退回 `firstLine(stdout)`，detail 会变成 `Initial Win CP for (console …)`
    // 并且 version 变成 `936`（那串 CP936 里的数字）→ 两条同时红。
    // 本机实测就是这个形状（`_tmp/env-b123-probe.txt` [A]），所以这不是编出来的极端输入。
    expect(item(r, 'latexmk').detail).toBe('Latexmk, John Collins, 27 Dec. 2024. Version 4.86a');
    expect(item(r, 'latexmk').version).toBe('4.86');
    expect(String(item(r, 'latexmk').detail)).not.toContain('CP936');
  });

  it('★ 反向对照：bibtex 不许把 `kpathsea version 6.4.0` 当成自己的版本', async () => {
    // 这是"不能简单改成『取含版本号的第一行』"的原因：TeX 系的输出里紧跟着
    // kpathsea（**路径搜索库**，不是 bibtex 本身）的版本 —— 一个**看起来合理但是错的**数字。
    shell.script.set('bibtex', () => ({
      err: null,
      stdout: 'BibTeX 0.99d (TeX Live 2024)\nkpathsea version 6.4.0\n',
      stderr: '',
    }));
    const r = await checkEnvironment();
    expect(item(r, 'bibtex').version).toBe('0.99');
    expect(item(r, 'bibtex').version).not.toBe('6.4.0');
    expect(item(r, 'bibtex').detail).toBe('BibTeX 0.99d (TeX Live 2024)');
  });

  it('xelatex 没有任何一行含命令名 → 退回首个非空行（`XeTeX …`）', async () => {
    present('xelatex', 'XeTeX 3.141592653-2.6-0.999996 (TeX Live 2024)');
    const r = await checkEnvironment();
    // 它的首行写的是引擎名 `XeTeX`（不含 `xelatex`）⇒ 匹配不到"自己那行"，必须能退回首行。
    // 反向对照：若 toolLine 在匹配失败时返回空串，detail 会变 undefined → 红。
    expect(item(r, 'xelatex').detail).toBe('XeTeX 3.141592653-2.6-0.999996 (TeX Live 2024)');
  });

  it('stdout 一行都没有时，**才**退回 stderr（不把两者拼起来取首行）', async () => {
    shell.script.set('bibtex', () => ({
      err: exited(1),
      stdout: '',
      stderr: 'BibTeX 0.99d (TeX Live 2024)\n',
    }));
    const r = await checkEnvironment();
    expect(item(r, 'bibtex').detail).toBe('BibTeX 0.99d (TeX Live 2024)');
    // 反向对照：若实现改成 `firstLine(stdout + stderr)`（拼接），latexmk 那种
    // "stderr 全是 perl locale 警告"的工具会把警告放到第一位 → 上一条用例红。
    // 这条则钉住另一半：stdout 真的为空时，兜底必须还在（否则 detail 变 undefined）。
  });
});

describe('"找不到工具"的返回形状（不抛、如实报 missing）', () => {
  it('命令不存在 → status=missing、detail=undefined，且**不抛异常**', async () => {
    present('git', 'git version 2.55.0'); // 只登记 git，其余全部 ENOENT
    const r = await checkEnvironment();
    const x = item(r, 'xelatex');
    expect(x.status).toBe('missing');
    expect(x.detail).toBeUndefined();
    expect(x.version).toBeUndefined();
    expect(x.path).toBeUndefined();
  });

  it('`where` 返回空串但 exit 0 → path 为 undefined（`line || null` 这条兜底）', async () => {
    present('git', 'git version 2.55.0');
    shell.script.set('where', () => ({ err: null, stdout: '\n\n', stderr: '' }));
    shell.script.set('which', () => ({ err: null, stdout: '\n\n', stderr: '' }));
    const r = await checkEnvironment();
    expect(item(r, 'git').status).toBe('ok');
    // 反向对照：若去掉 `|| null` 兜底，这里会变成空字符串（而不是 undefined）。
    expect(item(r, 'git').path).toBeUndefined();
  });

  it('`where` 多行 → path 只取**第一条**', async () => {
    present('git', 'git version 2.55.0');
    locate(['C:\\first\\git.exe', 'C:\\second\\git.exe']);
    const r = await checkEnvironment();
    expect(item(r, 'git').path).toBe('C:\\first\\git.exe');
  });
});

describe('Python 判定：3 / 非 3 / 缺失 三种分支', () => {
  it('`Python 2.7.18` → 报 missing（不是 3），但仍保留原因在 detail', async () => {
    scriptPython({ version: 'Python 2.7.18' });
    present('git', 'git version 2.55.0');
    const r = await checkEnvironment();
    const py = item(r, 'python');
    expect(py.status).toBe('missing');
    // 反向对照：若把 `/python\s+3/i` 放宽成"有输出就算 ok"，这两条都会变。
    expect(py.detail).toBe('Python 2.7.18');
    expect(py.version).toBe('2.7.18');
    // ★ 这条是 B1 修完之后**新加**的：`findPython` 会跳过"不是 3"的候选并返回 null，
    //   如果 `checkEnvironment` 不把沿途看到的原因带出来，detail 会变成 undefined（我们踩过这个坑）。
    //   同时"探不到就别乱给路径"这条也得钉住 —— 报 missing 的项不该有 path。
    expect(py.path).toBeUndefined();
  });

  it('Python 完全探不到 → 6 个 py: 包全部降级为 `unknown`（**不是** missing）', async () => {
    scriptPython({ version: null });
    const r = await checkEnvironment();
    expect(item(r, 'python').status).toBe('missing');
    const pkgs = r.items.filter((i) => i.id.startsWith('py:'));
    expect(pkgs).toHaveLength(6);
    // 反向对照：若降级分支写错（比如也用 missing），这 6 条会变成 missing → 红。
    // 为什么要用 unknown：**没装 Python 时我们并不知道包在不在**，说 missing 是撒谎。
    expect(pkgs.every((p) => p.status === 'unknown')).toBe(true);
  });

  it('Python 缺失时 missingRequired 把 6 个 unknown **也算作缺失**（真的缺失只有 5 项）', async () => {
    scriptPython({ version: null });
    const r = await checkEnvironment();
    const unknown = r.items.filter((i) => i.status === 'unknown');
    const missingOnly = r.items.filter((i) => i.level === 'required' && i.status === 'missing').length;
    expect(unknown).toHaveLength(6);
    // 反向对照：若统计只认 `status === 'missing'`，missingRequired 会等于 missingOnly（少 6）→ 红。
    // 为什么要算进去：界面拿它决定"要不要提示一键装环境"；没装 Python 时包在不在是**未知**，
    // 当作"已知没问题"会让用户以为环境是好的。
    expect(r.missingRequired).toBe(missingOnly + unknown.length);
    expect(r.ok).toBe(false);
  });

  it('Python 的 path 取解释器**自报**的 sys.executable（不是 where 的结果）', async () => {
    scriptPython({ version: 'Python 3.13.14', exe: 'C:\\real\\python.exe' });
    locate(['C:\\misleading\\python.exe']); // where 给的是另一个
    const r = await checkEnvironment();
    // 反向对照：若哪天改成直接用 which() 的结果，这里会变成 C:\misleading\python.exe → 红。
    // 这正是注释里写的坑：venv / Microsoft Store 别名会让 `where python` 给出误导性结果。
    expect(item(r, 'python').path).toBe('C:\\real\\python.exe');
  });

  it('解释器自报路径失败时，回落 `where`', async () => {
    shell.script.set('python', (args) => {
      if (args.includes('--version')) return { err: null, stdout: 'Python 3.13.14\n', stderr: '' };
      if ((args[1] ?? '').includes('sys.executable')) return NOT_FOUND;
      return { err: null, stdout: '{}', stderr: '' };
    });
    locate(['C:\\fallback\\python.exe']);
    const r = await checkEnvironment();
    expect(item(r, 'python').path).toBe('C:\\fallback\\python.exe');
  });
});

describe('Python 包版本：一次调用批量问，且只认最后一行 JSON', () => {
  it('stdout 前面有 warning、JSON 在最后一行 → 仍能解析出来', async () => {
    scriptPython({
      pkgRaw: 'WARNING: something noisy\n{"numpy":"2.5.3","pandas":null}\n',
    });
    const r = await checkEnvironment();
    expect(item(r, 'py:numpy').status).toBe('ok');
    expect(item(r, 'py:numpy').detail).toBe('2.5.3');
    // 反向对照：若改成 `JSON.parse(stdout.trim())`（整段解析），warning 会让它抛 → 全部 null → 红。
    expect(item(r, 'py:pandas').status).toBe('missing');
  });

  it('JSON 坏掉 → 全部 missing，**不抛**', async () => {
    scriptPython({ pkgRaw: 'not json at all\n' });
    const r = await checkEnvironment();
    const pkgs = r.items.filter((i) => i.id.startsWith('py:'));
    expect(pkgs.every((p) => p.status === 'missing')).toBe(true);
  });

  it('包探测命令本身失败（非零退出）→ 全部 missing', async () => {
    shell.script.set('python', (args) => {
      if (args.includes('--version')) return { err: null, stdout: 'Python 3.13.14\n', stderr: '' };
      if ((args[1] ?? '').includes('sys.executable')) return { err: null, stdout: 'C:\\py\\python.exe\n', stderr: '' };
      return NOT_FOUND; // 包探测失败
    });
    const r = await checkEnvironment();
    const pkgs = r.items.filter((i) => i.id.startsWith('py:'));
    expect(pkgs.every((p) => p.status === 'missing')).toBe(true);
    expect(item(r, 'python').status).toBe('ok');
  });

  it('只探测一次包（不是每个包起一次进程）', async () => {
    scriptPython({ pkgs: { numpy: '2.5.3' } });
    await checkEnvironment();
    const pkgCalls = shell.calls.filter((c) => (c.args[1] ?? '').includes('importlib.metadata'));
    // 反向对照：若实现改成循环里逐个 probe，这里会变成 6 → 红（6 次进程 ≈ 拖慢界面）。
    expect(pkgCalls).toHaveLength(1);
  });
});

describe('PDF 转图：任一可用即可（firstAvailable）', () => {
  it('第一个失败、第二个成功 → 取第二个的名字', async () => {
    shell.script.set('mutool', (args) => ({ err: null, stdout: `mutool ${args[0]}\n`, stderr: '' }));
    const r = await checkEnvironment();
    const it2 = item(r, 'pdftoimage');
    expect(it2.status).toBe('ok');
    // 反向对照：若 firstAvailable 里 `return c` 写错（比如总返回第一个），会是 pdftoppm。
    expect(it2.detail).toBe('mutool');
  });

  it('三个都不在 → missing', async () => {
    const r = await checkEnvironment();
    expect(item(r, 'pdftoimage').status).toBe('missing');
  });

  it('★ 已修复：非 0 退出但**吐了版本号**的命令判为可用（`mutool -v` / `magick -v` 那一类）', async () => {
    // 原来的实现是
    //     if (r.ok || firstLine(r.stdout + r.stderr)) {   ← 外层：有输出也算"存在"
    //       if (r.ok) return c;                           ← 内层：又要求退出码为 0
    //     }
    // 内层把外层刚判定的"有输出"整个否定掉 ⇒ 外层那半边是**死逻辑**，从未影响过结果。
    // 影响：版本打到 stderr 且以非 0 退出的实现，**存在**也会被报成"缺失"，设置页会引导
    // 用户去装一个他已经装了的工具。
    shell.script.set('pdftoppm', () => NOT_FOUND);
    shell.script.set('mutool', () => ({ err: exited(1), stdout: '', stderr: 'mutool version 1.24.9\n' }));
    const r = await checkEnvironment();
    expect(item(r, 'pdftoimage').status).toBe('ok');
    // 反向对照：把 `!r.notFound && numericVersion(...)` 这半边删掉（退回只看 `r.ok`），
    // 这里会变回 missing → 红。也就是说这条真的能区分两种实现。
    expect(item(r, 'pdftoimage').detail).toBe('mutool');
  });

  it('★ 反向对照：命令存在但**起不来**（有 stderr、无版本号）→ 仍判缺失', async () => {
    // 这一半很关键：不能简化成"有输出就算装好了"。缺动态库之类的启动失败会打 stderr 并非 0 退出。
    shell.script.set('pdftoppm', () => ({
      err: exited(127),
      stdout: '',
      stderr: 'error while loading shared libraries: libpoppler.so\n',
    }));
    shell.script.set('mutool', () => NOT_FOUND);
    shell.script.set('magick', () => NOT_FOUND);
    const r = await checkEnvironment();
    // 反向对照：若判据退化成 `firstLine(...) !== ''`（"有输出就算"），这条会变 ok → 红。
    expect(item(r, 'pdftoimage').status).toBe('missing');
    expect(item(r, 'pdftoimage').detail).toBeUndefined();
  });

  it('★ notFound 判据：ENOENT 不许因为"有输出"被当成可用', async () => {
    // ⚠️ 这是**构造**出来的形状：真实机器上 ENOENT 的 stdout / stderr 一定是空串
    //    （实测 `_tmp/env-b123-probe.txt` [F]），所以只有构造输入才能把 `!r.notFound` 这半边单独打红。
    //    没有这条，"命令根本不存在"和"跑起来了"就又会混成一个布尔。
    shell.script.set('pdftoppm', () => ({ err: spawnError(), stdout: 'pdftoppm version 24.02.0\n', stderr: '' }));
    shell.script.set('mutool', () => NOT_FOUND);
    shell.script.set('magick', () => NOT_FOUND);
    const r = await checkEnvironment();
    expect(item(r, 'pdftoimage').status).toBe('missing');
  });
});

describe('uv：随包优先于 PATH（原版把 uv 随包分发）', () => {
  it('resourcesDir 里有 `bin/uv` → ok，且 detail 标明"随包"，path 指向随包那份', async () => {
    const res = mkdtempSync(join(tmpdir(), 'mm-env-res-'));
    mkdirSync(join(res, 'bin'), { recursive: true });
    const bundled = join(res, 'bin', 'uv.exe');
    writeFileSync(bundled, ''); // 空文件即可：本用例只验"有没有被找到"

    const r = await checkEnvironment(undefined, res);
    const uv = item(r, 'uv');
    expect(uv.status).toBe('ok');
    expect(uv.path).toBe(bundled);
    // 反向对照：若漏了"随包"分支只看 PATH，本机 PATH 上没有 uv（真实探测已实测）→ status 会是 missing。
    expect(String(uv.detail)).toContain('随包');
  });

  it('有随包 uv 时**不再**去 PATH 上问（不做多余的进程调用）', async () => {
    const res = mkdtempSync(join(tmpdir(), 'mm-env-res-'));
    mkdirSync(join(res, 'bin'), { recursive: true });
    writeFileSync(join(res, 'bin', 'uv.exe'), '');

    shell.reset();
    locate(['C:\\bin\\tool.exe']);
    await checkEnvironment(undefined, res);
    // 反向对照：若实现是"先问 PATH 再看随包"，这里会多出 which('uv') → 红。
    const askedPath = shell.calls.some((c) => c.cmd === 'uv' || (c.cmd === 'where' && c.args[0] === 'uv'));
    expect(askedPath).toBe(false);
  });

  it('没有随包时回落 PATH，PATH 上也没有 → missing', async () => {
    const r = await checkEnvironment();
    expect(item(r, 'uv').status).toBe('missing');
  });
});

describe('中文字体：只认文件名，不把整条路径塞进 detail', () => {
  /**
   * 只在 Windows 上跑：把 `process.platform` 强改成 darwin/linux 后，那些字体路径
   * 在 Windows 上**必然不存在** —— 于是这条断言是确定的（不是"两种结果都接受"的装饰）。
   * 在真 Linux/macOS 上跑没有意义（路径可能真的存在），所以显式 skip。
   */
  it.skipIf(process.platform !== 'win32')(
    '被伪造成 darwin / linux 时，字体路径必然找不到 → missing（负分支真的可达）',
    async () => {
      const real = process.platform;
      for (const fake of ['darwin', 'linux'] as const) {
        Object.defineProperty(process, 'platform', { value: fake, configurable: true });
        try {
          const r = await checkEnvironment();
          // 反向对照：若 hasCjkFont 在某分支里写成了"总是返回某个名字"（漏判 existsSync），
          // 这里就会变成 ok → 红。这条钉的是"负分支真的存在"。
          expect(item(r, 'cjkfont').status, `platform=${fake}`).toBe('missing');
          expect(item(r, 'cjkfont').detail).toBeUndefined();
        } finally {
          Object.defineProperty(process, 'platform', { value: real, configurable: true });
        }
      }
    },
  );

  it.skipIf(process.platform !== 'win32')('win32 分支：WINDIR 指向不存在的目录 → missing（不靠 existsSync 漏判）', async () => {
    const prev = process.env.WINDIR;
    process.env.WINDIR = 'C:\\definitely-no-such-windows-fonts-dir-xyz';
    try {
      const r = await checkEnvironment();
      // 反向对照：若 win32 分支漏了 `existsSync`（写成"总是返回第一个候选名"），
      // 这里会变成 ok + detail='simsun.ttc' → 红。
      // 没有这条，win32 那条"找到时是文件名"的用例在**任何**机器上都会过 —— 等于没验负分支。
      expect(item(r, 'cjkfont').status).toBe('missing');
      expect(item(r, 'cjkfont').detail).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.WINDIR;
      else process.env.WINDIR = prev;
    }
  });

  it.skipIf(process.platform !== 'win32')('win32 分支：找到时 detail 是**文件名**，找不到时必须没有 detail', async () => {
    const r = await checkEnvironment();
    const f = item(r, 'cjkfont');
    if (f.status === 'ok') {
      // 反向对照：若哪天改成返回完整路径，detail 会带上 `C:\Windows\Fonts\` → 红。
      // 为什么要钉：detail 是给用户看的"是哪一款字体"，塞全路径没信息量。
      expect(String(f.detail)).not.toMatch(/[\\/]/);
      expect(String(f.detail)).toMatch(/\.(ttc|ttf|otf)$/i);
    } else {
      // 两个分支都断言（不是"环境不同就算了"）：
      // 找不到字体时若还留着 detail，界面会显示一款根本没装的字体名。
      expect(f.status).toBe('missing');
      expect(f.detail).toBeUndefined();
    }
  });
});

describe('聚合口径（界面用它决定"要不要提示一键装环境"）', () => {
  it('missingRequired / missingRecommended 与实际逐项计数一致，ok 只看必需项', async () => {
    scriptPython({ pkgs: { numpy: '2.5.3' } });
    present('git', 'git version 2.55.0');
    const r = await checkEnvironment();

    const reqBad = r.items.filter((i) => i.level === 'required' && i.status !== 'ok').length;
    const recBad = r.items.filter((i) => i.level === 'recommended' && i.status !== 'ok').length;
    // 反向对照：若统计换成了 `status === 'missing'`（漏掉 unknown），Python 缺失场景下就会不一致。
    expect(r.missingRequired).toBe(reqBad);
    expect(r.missingRecommended).toBe(recBad);
    // 建议项缺失**不影响** ok —— 反向：若把 recBad 也算进去，这里会是 false。
    expect(r.ok).toBe(reqBad === 0);
  });

  it('必需项齐了 → ok=true，即使建议项全缺', async () => {
    scriptPython({ pkgs: { numpy: '1', scipy: '1', pandas: '1', matplotlib: '1', seaborn: '1', 'python-dateutil': '1' } });
    present('git', 'git version 2.55.0');
    present('xelatex', 'XeTeX 3 (TeX Live 2024)');
    present('latexmk', 'x');
    present('bibtex', 'x');
    const r = await checkEnvironment();
    expect(r.missingRequired).toBe(0);
    expect(r.ok).toBe(true);
    // 建议项（uv / drawio / pdftoimage / cjkfont）全部没登记
    expect(r.missingRecommended).toBeGreaterThan(0);
  });
});

describe('draw.io：Windows 标准安装目录', () => {
  it.skipIf(process.platform !== 'win32')('PATH 没有 drawio 命令时，仍能识别 draw.io.exe', async () => {
    const previous = process.env.LOCALAPPDATA;
    const local = mkdtempSync(join(tmpdir(), 'mm-drawio-'));
    const executable = join(local, 'Programs', 'draw.io', 'draw.io.exe');
    mkdirSync(join(local, 'Programs', 'draw.io'), { recursive: true });
    writeFileSync(executable, '');
    process.env.LOCALAPPDATA = local;
    present(executable, 'draw.io 31.4.5');

    try {
      const r = await checkEnvironment();
      expect(item(r, 'drawio').status).toBe('ok');
      expect(item(r, 'drawio').path).toBe(executable);
      expect(item(r, 'drawio').version).toBe('31.4.5');
      expect(shell.calls.some((call) => call.cmd === 'drawio')).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previous;
    }
  });
});

describe('item 契约（界面按 id 分组，改 id 会让分组错位）', () => {
  it('id / level / order 稳定', async () => {
    const r = await checkEnvironment();
    expect(r.items.map((i) => i.id)).toEqual([
      'python',
      'git',
      'xelatex',
      'latexmk',
      'bibtex',
      'py:numpy',
      'py:scipy',
      'py:pandas',
      'py:matplotlib',
      'py:seaborn',
      'py:python-dateutil',
      'uv',
      'drawio',
      'pdftoimage',
      'cjkfont',
    ]);
    // 反向对照：id 改名/顺序变化会直接让设置页分组错位 → 这条会红。
    const required = r.items.filter((i) => i.level === 'required').map((i) => i.id);
    expect(required).toContain('xelatex');
    expect(required).not.toContain('uv');
  });

  it('detail / version 一定不含换行（firstLine 的意义）', async () => {
    scriptPython({ pkgs: { numpy: '2.5.3' } });
    present('git', 'git version 2.55.0\nsecond line');
    const r = await checkEnvironment();
    for (const i of r.items) {
      expect(String(i.detail ?? '')).not.toContain('\n');
      expect(String(i.version ?? '')).not.toContain('\n');
    }
  });
});

describe('findPython：逐个候选试到第一个可用', () => {
  it('项目里有 `.venv` → 返回 venv 里的解释器（不是 PATH 上的 python）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mm-env-proj-'));
    // 两个平台的分支都造出来，断言只看"是否落在项目内"，避免平台差异
    mkdirSync(join(root, '.venv', 'Scripts'), { recursive: true });
    writeFileSync(join(root, '.venv', 'Scripts', 'python.exe'), '');
    mkdirSync(join(root, '.venv', 'bin'), { recursive: true });
    writeFileSync(join(root, '.venv', 'bin', 'python'), '');
    // ⚠️ 现在 `findPython` 会**真的去 probe** 这个路径（`existsSync` 只说明文件在，
    //    不说明它能跑），所以桩件必须登记它 —— 否则默认回答是 ENOENT，会被跳过。
    //    这里故意让两个平台的路径都"可用"（用例本身只关心选出来的是哪一个）。
    present(join(root, '.venv', 'Scripts', 'python.exe'), 'Python 3.11.9');
    present(join(root, '.venv', 'bin', 'python'), 'Python 3.11.9');

    const py = await findPython(root);
    // 反向对照：若丢了 venv 分支，返回值会是 `python`（相对命令名）→ 红。
    expect(py?.cmd.startsWith(root)).toBe(true);
    expect(py?.prefixArgs).toEqual([]);
  });

  it('★ 已修复：没有 `python` 时回退到 `python3`（旧实现恒返回 `candidates[0]`，这条永远走不到）', async () => {
    // 复现 Linux / macOS 的常态：**只有 `python3`，没有 `python`**。
    shell.script.set('python', () => NOT_FOUND);
    shell.script.set('python3', () => ({ err: null, stdout: 'Python 3.13.14\n', stderr: '' }));
    const py = await findPython();
    // 反向对照：旧实现（组好候选表就取 `[0]`）在这里返回 `null`：
    //   candidates[0] 恒为 `python` ⇒ ENOENT ⇒ 直接返回 ⇒ Python 判 missing
    //   ⇒ 6 个 py:* 降级 unknown ⇒ missingRequired=7 ⇒ 设置页引导用户去装一个**已经装好**的 Python。
    //   这是本模块最靠前的一次误判（python 是第一个必需项）。
    expect(py?.cmd).toBe('python3');
    expect(py?.prefixArgs).toEqual([]);
  });

  it('★ 反向对照：`python` 在但是 Microsoft Store 存根（非 0 退出）→ 继续试下一个', async () => {
    // 只看输出会误收：能跑起来但退出码非 0 的 `python` 不是可用的解释器。
    shell.script.set('python', () => ({ err: exited(9009) }));
    shell.script.set('python3', () => ({ err: null, stdout: 'Python 3.13.14\n', stderr: '' }));
    const py = await findPython();
    expect(py?.cmd).toBe('python3');
  });

  it('★ 反向对照：`python` 是 Python 2 → 不许被当成 Python 3', async () => {
    // 只看退出码也不行：Python 2 会以 0 退出。
    shell.script.set('python', () => ({ err: null, stdout: 'Python 2.7.18\n', stderr: '' }));
    shell.script.set('python3', () => ({ err: null, stdout: 'Python 3.13.14\n', stderr: '' }));
    const py = await findPython();
    // 反向对照：若判据只剩 `r.ok`，这里会返回 `python`（Python 2）→ 红。
    expect(py?.cmd).toBe('python3');
  });

  it('三个候选都不可用 → null（不抛、也不返回一个跑不起来的）', async () => {
    const py = await findPython();
    // 反向对照：若最后没有那个 `return null`（或写成了 `?? candidates[0]`），
    // 这里会返回 `{cmd:'python'}`，而它刚刚才 ENOENT —— 调用方拿去 execFile 会抛。
    expect(py).toBeNull();
  });

  it('★ 反向对照：`python` 是"会打印 Python 3 字样的假壳"（退出码非 0）→ 不许选它', async () => {
    // ⚠️ 这一条是**变异探针逼出来的覆盖缺口**：把 `if (r.ok && /python\s+3/i.test(v))` 的 `r.ok`
    //    去掉（只判输出），原来那一组用例**全都还是绿的** —— 说明没人盯着"退出码"这一半。
    //    形状很真实：PATH 上某个 `python.bat` 壳子会提示"Python 3 was not found"然后非 0 退出，
    //    它**含 `Python 3` 字样**却没在跑 Python。
    shell.script.set('python', () => ({
      err: exited(1),
      stdout: 'Python 3 was not found. Run the setup script first.\n',
      stderr: '',
    }));
    shell.script.set('python3', () => ({ err: null, stdout: 'Python 3.13.14\n', stderr: '' }));
    const py = await findPython();
    // 反向对照：去掉 `r.ok` ⇒ 返回 `python`（那个壳子）⇒ 红。判据注释里写着"只看输出也不够"，
    // 这条就是那句话的可执行版本。
    expect(py?.cmd).toBe('python3');
  });

  it('venv 里的解释器**存在但跑不起来** → 继续试 PATH 上的', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mm-env-brokenvenv-'));
    mkdirSync(join(root, '.venv', 'Scripts'), { recursive: true });
    const winExe = join(root, '.venv', 'Scripts', 'python.exe');
    writeFileSync(winExe, '');
    // venv 被搬过目录 / 解释器被删掉，都会留下一个跑不起来的 python.exe
    shell.script.set(winExe, () => ({ err: exited(1) }));
    shell.script.set('python', () => ({ err: null, stdout: 'Python 3.13.14\n', stderr: '' }));
    const py = await findPython(root);
    // 反向对照：若实现改成"`existsSync` 命中就直接 return"（不做探测），
    // 这里会返回那个坏的 venv 解释器 → 红。
    // 本机走不到这条分支（本机没有 .venv），由打桩覆盖 —— 如实标注。
    expect(py?.cmd).toBe('python');
  });
});
