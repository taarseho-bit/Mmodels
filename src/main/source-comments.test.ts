/**
 * 源码注释纪律 —— **源码注释里不许出现"成段引用原版代码"**。
 *
 * ────────────────────────────────────────────────────────────────
 * 为什么要立这条（不是洁癖，是真出过事故）
 * ────────────────────────────────────────────────────────────────
 * 原版的逐字 dump 原先写在 `src/` 的注释里。后果不是"注释太长"，而是
 * **污染搜索与计数**：`grep -c` 会把注释里的原文一起数上，给出一个
 * **看起来像样的错数字**。
 *
 * 真实事故（`WRITE-RULES.md §8`）：`grep -c "mcp__" src/main/agent/permissions.ts`
 * 期望 10、**实跑 15** —— 差的 5 行全在文件头注释里。
 * 同族的错那一轮出现了三次，**每一次都是被命令输出抓出来的**。
 *
 * ────────────────────────────────────────────────────────────────
 * 这条规则**不禁止**引用原版，只禁止"把原文贴在源码里"
 * ────────────────────────────────────────────────────────────────
 * 逐字原文搬到 `.workbuddy/ui-audit/verify/original-code-dumps.md`（**一个字都没删**），
 * 源码注释保留：
 *   · **一行指针**（"逐字 dump 见 <路径>"）
 *   · **动机**（为什么要对齐原版）与**容易错在哪**
 * ⇒ 信息没丢，但**源码可以安全地被 grep 计数**。
 *
 * ────────────────────────────────────────────────────────────────
 * 两条规则（都在真实仓库上取过数，见文件末的约束）
 * ────────────────────────────────────────────────────────────────
 *   A `fenced-js-block`            —— 注释里的 **js/ts 代码栅栏**（原版是 JS）
 *   B `code-like-comment-run`      —— 连续 ≥3 行注释，且**每一行**都是代码
 *
 * ⚠️ 规则 A **刻意不带 `json` 栅栏**：引用**我们自己**的资产/产物（例如
 *    `assets/.../template.json` 的片段）是合法的，那不是"原版代码"。
 *    本仓 `shared/types.ts` 里就留着一处 `json` 栅栏作为对照 —— 它**不该**被报红。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 逐字原文的归属地（**在 `src/` 之外**，所以不会被本测试自己扫到） */
export const REFERENCE_FILE = '.workbuddy/ui-audit/verify/original-code-dumps.md';

export type Finding = {
  file: string;
  /** 1-based 行号 */
  line: number;
  rule: 'fenced-js-block' | 'code-like-comment-run';
};

/** 注释里的 js/ts 栅栏（` * ```js` 这种形态） */
const JS_FENCE = /^\s*\*\s*```(js|javascript|ts|typescript)\s*$/i;

/** "原版代码"的特征 token。命中 ≥1 个只能说明"像代码"，够不上规则 B（B 要求每行都像） */
const CODE_TOKENS: RegExp[] = [
  /_0x[0-9a-f]{4,}/i, // 混淆局部名
  /!0x[0-9a-f]+/i, // 混淆布尔
  /\b0x[0-9a-f]{2,}\b/i, // 十六进制字面量
  /=>/, // 箭头函数
  /===/, // 严格比较
  /new Set\(\[/, // 集合字面量
  /function\s+[A-Za-z_$][\w$]*\s*\(/, // 具名函数
  /z\.enum\(/, // zod
  /\?\?!/, // 原版常见的空值合并到 true
  /['"][^'"]*__[^'"]*['"]/, // 含双下划线的字符串字面量（如 mcp__…）
];

/**
 * 找出源码里的"成段原版代码引用"。
 *
 * **纯函数**（只吃字符串），所以规则本身可以用合成输入做反向对照 ——
 * 不然这条断言只能证明"今天恰好是 0"，证明不了"规则真的会报红"。
 */
export function findVerbatimDumps(source: string, file = '<memory>'): Finding[] {
  const lines = source.split(/\r?\n/);
  const out: Finding[] = [];
  let inBlock = false;
  // 规则 B 的游标
  let runStart = -1;
  let runLen = 0;

  const flushRun = (): void => {
    if (runLen >= 3) {
      out.push({ file, line: runStart + 1, rule: 'code-like-comment-run' });
    }
    runStart = -1;
    runLen = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!inBlock) {
      if (/^\s*\/\*\*/.test(raw)) {
        inBlock = true;
        // 单行注释块 `/** … */`
        if (/\*\/\s*$/.test(raw)) inBlock = false;
      } else {
        flushRun();
      }
      continue;
    }
    // ── 在注释块内 ──
    if (JS_FENCE.test(raw)) out.push({ file, line: i + 1, rule: 'fenced-js-block' });
    /**
     * 规则 B：只在"像代码"的行上累积；遇到散文行就**断开**。
     *
     * ⚠️ 这里**不能**写成"整段注释每一行都必须像代码" —— 那样 dump 前面只要有一行
     *    ` * 原版：` 就会把整段作废（我第一版就是这么写的，被反向对照当场抓红）。
     *    正确语义是"**连续** ≥3 行都是代码"，散文行只是把游标归零。
     */
    if (CODE_TOKENS.some((re) => re.test(raw))) {
      if (runStart < 0) runStart = i;
      runLen++;
    } else {
      flushRun();
    }
    if (/\*\/\s*$/.test(raw)) {
      inBlock = false;
      flushRun();
    }
  }
  flushRun();
  return out;
}

/** 递归收集被测源码文件（跳过隐藏目录与 node_modules） */
export function collectSources(root = 'src'): string[] {
  const exts = new Set(['.ts', '.tsx']);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(p);
      } else if (exts.has(extname(entry.name))) {
        out.push(p);
      }
    }
  };
  walk(join(process.cwd(), root));
  return out;
}

describe('源码注释纪律：不许成段引用原版代码', () => {
  const files = collectSources('src');

  it('★ 真实源码树里 0 命中', () => {
    const findings = files.flatMap((f) =>
      findVerbatimDumps(readFileSync(f, 'utf8'), f.replace(process.cwd(), '').replace(/\\/g, '/')),
    );
    expect(findings).toEqual([]);
  });

  it('防恒真：扫描规模必须合理（否则 glob 坏了这条会静默全绿）', () => {
    // 实测 147 个文件；留足余量但不留到"扫到 0 个也算过"
    expect(files.length).toBeGreaterThanOrEqual(100);
    expect(files.some((f) => f.includes('permissions.ts'))).toBe(true);
  });

  // ── 反向对照：证明规则**真的会报红**，不是恒等于空数组 ──────────

  it('反向对照：注释里的 js 栅栏必须被报红', () => {
    const src = ['/**', ' * 说明：', ' * ```js', ' * function foo(x){ return x === 1 }', ' * ```', ' */', 'export const a = 1;'].join(
      '\n',
    );
    const found = findVerbatimDumps(src, 'synthetic.ts');
    expect(found).toEqual([{ file: 'synthetic.ts', line: 3, rule: 'fenced-js-block' }]);
  });

  it('反向对照：`json` 栅栏**不**报红（引用我们自己的资产是合法的）', () => {
    const src = ['/**', ' * 实证：', ' * ```json', ' * { "value": "本科生" }', ' * ```', ' */'].join('\n');
    expect(findVerbatimDumps(src, 'synthetic.ts')).toEqual([]);
  });

  it('反向对照：连续 3 行都是代码的注释必须被报红（哪怕前面有一行散文）', () => {
    const src = [
      '/**',
      ' * 原版：', // ← 散文行，不该把后面的 dump 一起作废
      " * const Ku = 'mathmodel', Ju = new Set([",
      " *   'mcp__mathmodel__get_settings',",
      " *   'mcp__mathmodel__list_projects']);",
      ' */',
    ].join('\n');
    const found = findVerbatimDumps(src, 'synthetic.ts');
    // 命中的是**第 3 行**（第 1 个"像代码"的行），不是第 2 行那句散文
    expect(found).toEqual([{ file: 'synthetic.ts', line: 3, rule: 'code-like-comment-run' }]);
  });

  it('反向对照：只有 2 行连续代码**不**报红（阈值是 3）', () => {
    const src = [
      '/**',
      ' * 原版：',
      ' * const a = 1;',
      ' * const b = a === 2;',
      ' * 然后是一句散文。',
      ' */',
    ].join('\n');
    expect(findVerbatimDumps(src, 'synthetic.ts')).toEqual([]);
  });

  it('反向对照：散文注释里**偶尔**出现代码 token 不报红（防误报）', () => {
    const src = [
      '/**',
      ' * 这段讲的是为什么 `canonicalPermissionMode()` 不能省。',
      ' * 原版门内比的是 app 级口径，所以我们不把 SDK 值喂给它。',
      ' * 只有当字面量相等时才全放行 —— 这句话是散文，不是代码。',
      ' * 另外注意顺序：plan 必须先判。',
      ' */',
    ].join('\n');
    expect(findVerbatimDumps(src, 'synthetic.ts')).toEqual([]);
  });

  it('反恒真：非空输入不会让规则"永远返回同一个值"', () => {
    const benign = '/**\n * 一句人话。\n * 再来一句。\n */\nexport const x = 1;';
    const offending = '/**\n * ```js\n * const a = 1;\n * const b = 2;\n * const c = a === b;\n * ```\n */';
    expect(findVerbatimDumps(benign, 'a.ts')).toEqual([]);
    expect(findVerbatimDumps(offending, 'a.ts').length).toBeGreaterThan(0);
  });

  // ── 搬走 ≠ 删掉：逐字原文必须在参照文件里 ──────────────────────

  it('★ 逐字原文必须**在参照文件里**（证明是"搬走"，不是"删掉"）', () => {
    const ref = readFileSync(join(process.cwd(), REFERENCE_FILE), 'utf8');
    const mustContain = [
      "permissionMode: z.enum(['full-access','approval-required'])", // §1.1 值域
      'function jh(s){', // §1.2
      "'allowDangerouslySkipPermissions': !0x0", // §1.3
      'mcp__mathmodel__list_projects', // §1.4 白名单来源一
      "'mcp__' + Eu + '__browser_logs'", // §1.4 白名单来源二（**逐字**就是拼接形式，不是展开后的名字）
      'function Oh(n){', // §1.5
      'function Dh(name, input){', // §1.6
      'function YI(t){', // §2 notify
      'function ZI(){', // §2 notify
      'function uw(t, e)', // §6 export-name
      'const LA = {', // §5 file.ts
      "ctx.emit({type:'approval-request'", // §4 session.ts
    ];
    const missing = mustContain.filter((s) => !ref.includes(s));
    expect(missing).toEqual([]);
  });

  it('参照文件必须在 src/ 之外（否则本测试自己会被自己污染）', () => {
    expect(REFERENCE_FILE.startsWith('src/')).toBe(false);
    expect(REFERENCE_FILE).toContain('verify/');
  });
});
