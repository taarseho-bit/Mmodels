/**
 * 源码注释纪律 —— **源码注释里不许出现成段的实现代码**。
 *
 * ────────────────────────────────────────────────────────────────
 * 为什么要立这条（不是洁癖，是真出过事故）
 * ────────────────────────────────────────────────────────────────
 * 实现代码如果直接写进 `src/` 的注释里，后果不是"注释太长"，而是
 * **污染搜索与计数**：`grep -c` 会把注释里的原文一起数上，给出一个
 * **看起来像样的错数字**。
 *
 * 真实事故（`WRITE-RULES.md §8`）：`grep -c "mcp__" src/main/agent/permissions.ts`
 * 期望 10、**实跑 15** —— 差的 5 行全在文件头注释里。
 * 同族的错那一轮出现了三次，**每一次都是被命令输出抓出来的**。
 *
 * ────────────────────────────────────────────────────────────────
 * 这条规则不禁止解释设计，只禁止把实现代码整段贴在源码里。
 * ────────────────────────────────────────────────────────────────
 * 源码注释保留动机和容易出错的边界，让源码可以安全地被 grep 计数。
 *
 * ────────────────────────────────────────────────────────────────
 * 两条规则
 * ────────────────────────────────────────────────────────────────
 *   A `fenced-js-block`            —— 注释里的 **js/ts 代码栅栏**（应用约定是 JS）
 *   B `code-like-comment-run`      —— 连续 ≥3 行注释，且**每一行**都是代码
 *
 * ⚠️ 规则 A **刻意不带 `json` 栅栏**：引用**我们自己**的资产/产物（例如
 *    `assets/.../template.json` 的片段）是合法的，那不是"应用约定代码"。
 *    本仓 `shared/types.ts` 里就留着一处 `json` 栅栏作为对照 —— 它**不该**被报红。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

export type Finding = {
  file: string;
  /** 1-based 行号 */
  line: number;
  rule: 'fenced-js-block' | 'code-like-comment-run';
};

/** 注释里的 js/ts 栅栏（` * ```js` 这种形态） */
const JS_FENCE = /^\s*\*\s*```(js|javascript|ts|typescript)\s*$/i;

/** "应用约定代码"的特征 token。命中 ≥1 个只能说明"像代码"，够不上规则 B（B 要求每行都像） */
const CODE_TOKENS: RegExp[] = [
  /_0x[0-9a-f]{4,}/i, // 混淆局部名
  /!0x[0-9a-f]+/i, // 混淆布尔
  /\b0x[0-9a-f]{2,}\b/i, // 十六进制字面量
  /=>/, // 箭头函数
  /===/, // 严格比较
  /new Set\(\[/, // 集合字面量
  /function\s+[A-Za-z_$][\w$]*\s*\(/, // 具名函数
  /z\.enum\(/, // zod
  /\?\?!/, // 应用约定常见的空值合并到 true
  /['"][^'"]*__[^'"]*['"]/, // 含双下划线的字符串字面量（如 mcp__…）
];

/**
 * 找出源码里的"成段应用约定代码引用"。
 *
 * **纯函数**（只吃字符串），所以规则本身可以用合成输入做回归护栏 ——
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
     *    ` * 应用约定：` 就会把整段作废（我第一版就是这么写的，被回归护栏当场抓红）。
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

describe('源码注释纪律：不许成段引用应用约定代码', () => {
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

  // ── 回归护栏：证明规则**真的会报红**，不是恒等于空数组 ──────────

  it('回归护栏：注释里的 js 栅栏必须被报红', () => {
    const src = ['/**', ' * 说明：', ' * ```js', ' * function foo(x){ return x === 1 }', ' * ```', ' */', 'export const a = 1;'].join(
      '\n',
    );
    const found = findVerbatimDumps(src, 'synthetic.ts');
    expect(found).toEqual([{ file: 'synthetic.ts', line: 3, rule: 'fenced-js-block' }]);
  });

  it('回归护栏：`json` 栅栏**不**报红（引用我们自己的资产是合法的）', () => {
    const src = ['/**', ' * 实证：', ' * ```json', ' * { "value": "本科生" }', ' * ```', ' */'].join('\n');
    expect(findVerbatimDumps(src, 'synthetic.ts')).toEqual([]);
  });

  it('回归护栏：连续 3 行都是代码的注释必须被报红（哪怕前面有一行散文）', () => {
    const src = [
      '/**',
      ' * 应用约定：', // ← 散文行，不该把后面的 dump 一起作废
      " * const Ku = 'mathmodel', Ju = new Set([",
      " *   'mcp__mathmodel__get_settings',",
      " *   'mcp__mathmodel__list_projects']);",
      ' */',
    ].join('\n');
    const found = findVerbatimDumps(src, 'synthetic.ts');
    // 命中的是**第 3 行**（第 1 个"像代码"的行），不是第 2 行那句散文
    expect(found).toEqual([{ file: 'synthetic.ts', line: 3, rule: 'code-like-comment-run' }]);
  });

  it('回归护栏：只有 2 行连续代码**不**报红（阈值是 3）', () => {
    const src = [
      '/**',
      ' * 应用约定：',
      ' * const a = 1;',
      ' * const b = a === 2;',
      ' * 然后是一句散文。',
      ' */',
    ].join('\n');
    expect(findVerbatimDumps(src, 'synthetic.ts')).toEqual([]);
  });

  it('回归护栏：散文注释里**偶尔**出现代码 token 不报红（防误报）', () => {
    const src = [
      '/**',
      ' * 这段讲的是为什么 `canonicalPermissionMode()` 不能省。',
      ' * 应用约定门内比的是 app 级口径，所以我们不把 SDK 值喂给它。',
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

});
