/**
 * i18n 键护栏 v2 —— **所有像键的字符串字面量**都必须在字典里真实存在。
 *
 * ## 为什么需要它
 *
 * `tx()` 取不到键时会**原样返回路径字符串**（见 `./index.ts`：
 * `const raw = lookup(path) ?? path;`）—— 不抛错、不警告、不像坏，
 * 界面上只是**把 `composer.composerTaskListCard.progress` 直接显示给用户**。
 *
 * 这个坑本仓库已经真踩过：任务进度面板第一版把命名空间猜成
 * `chat.composerTaskListCard.*`（真实是 `composer.composerTaskListCard.*`），
 * 单测、typecheck、构建全绿，直到**实机截图里看到那一行路径字符串**才发现。
 *
 * ## v1 → v2 修的是什么
 *
 * v1 只认 `tx('a.b.c')` 这种「`tx(` 后**紧跟引号**」的写法。于是：
 *   - `tx(collapsed ? 'a' : 'b')`（跨行三元）扫不到；
 *   - `tx(r.labelKey)`（键在同文件的字面量映射表里）扫不到；
 *   - 更隐蔽的是：**bug 修好了、护栏对它的保护却同时失效了**
 *     （`Sidebar.tsx` 从单行键改成三元后，那两个键就再也扫不到了）。
 *
 * v2 把「扫调用点」换成「扫**所有像键的字面量**」：
 *   - **A 类 `directArgs`**：出现在任一 `tx(...)` 实参区间里的字符串字面量
 *     （用括号配平取出实参区间，所以三元 / 跨行 / 多实参都能取到）；
 *   - **B 类 `indirect`**：不在 `tx(...)` 里、但形如 `<命名空间>.<段>.<段>` 的字面量，
 *     它们通常是「键映射表」的值（`ROLE_KEY` / `KIND_KEY` / `labelKey: 'dock.x.y'`），
 *     最终也会喂给 `tx()`。
 * 两类都必须在 `zh.ts` 里命中。
 *
 * ## 两条**有原则**的豁免（不是名单，是规则）
 *
 * 1. **复数基名**：`zh` 里有 `<key>_one` 或 `<key>_other` → 放行。
 *    （`txPlural('dock.diffPanel.changedFiles', n)` 的真实键是 `changedFiles_one/_other`）
 * 2. **分步基名**：**仅对 B 类**，且 `zh` 里存在以 `<key>.` 为前缀的子键 → 放行。
 *    （`GuidedTour` 用 `` tx(`${i18nBaseOf(step)}.title`) `` 拼后缀，基名本身不是叶子）
 *
 *    为什么只给 B 类：A 类是**真的把字面量喂给了 tx()**，落到对象节点上照样会
 *    把路径渲染出来 —— 那是真 bug，不能豁免。B 类里混着大量「只作为前缀使用」
 *    的基名，才需要这条规则。
 *
 * 这两条豁免都带**自证**：放行的每一条都必须当场拿得出 `_one/_other` 或子键的证据
 * （见用例「豁免自证」），所以不存在「规则写歪了悄悄放行」。
 *
 * ## 它**不**覆盖什么（如实写明）
 * - **含 `${}` 的模板串**：`` tx(`settings.x.${id}`) `` 拼出来的键无法静态验证，
 *   整条跳过。这是本护栏最大的盲区（全仓约 25 处）；
 * - **拼接片段**：`tx('a.' + b)` 里紧邻 `+` 的片段按「不是完整键」跳过；
 * - **变量键**：`tx(SOME_MAP[x])` 的取值路径不可静态判定 —— 但**映射表里的字面量值**
 *   会被 B 类规则扫到，这是 v2 相对 v1 的主要增益；
 * - `t('中文原文')`（中文即键）不在此列：查不到英文显示中文是**正确**行为；
 * - 「英文缺了但中文有」不会报错（`en` 取不到会回退 `zh`）—— 本护栏只管「两侧都没有」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { setLang, tx, zh } from './index';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 排除 i18n 目录本身：`index.ts` / `overrides/index.ts` 的 JSDoc 里有
 * `tx('papers.page.problem', …)` 这种**示例**，不是真实调用点。
 */
const EXCLUDE_DIRS = [path.join(SRC_ROOT, 'i18n')];

/**
 * 按键名的白名单 —— **必须保持为空**。
 *
 * 历史：v1 时代这里放过 2 个真缺陷（`shell.sidebar.collapseSidebar`、
 * `extensions.paperTemplatesSection.builtinSource`），都已按原版 asar 实证修掉：
 *   - 前者原版是按折叠状态取 `shell.titleBarControls.expandSidebar / collapseSidebar` 一对键；
 *   - 后者**这个键根本不该存在** —— 原版那行是
 *     `{来源} · {source === "custom" ? customSource : "write-paper"}`，
 *     照我最初的提法「补一个 builtinSource」会凭空造出原版没有的键。
 * 用例「豁免零名单」会断言本集合为空：**放行只能靠上面两条通用规则**。
 */
const KNOWN_BAD = new Set<string>();

/** 命名空间 = `zh` 的顶层键。B 类候选必须落在这里面，否则误报会很多。 */
const NAMESPACES = new Set(Object.keys(zh as unknown as Record<string, unknown>));

interface Token {
  kind: 'single' | 'double' | 'template';
  start: number;
  end: number;
  /** 单/双引号：完整值；模板：字面文本（含 `${}` 原样） */
  value: string;
  /** 模板串里是否含 `${…}` */
  hasExpr: boolean;
}

interface Lexed {
  /** 注掉注释后的源码（长度/换行与原文一致，供定位行号） */
  masked: string;
  /** 去掉字符串内容后的源码（括号配平用，`) ` 不会再被串里的括号干扰） */
  parenSrc: string;
  tokens: Token[];
}

/**
 * 极简词法扫描：注释 / 字符串 / 模板串 / 正则字面量。
 *
 * 为什么要自己扫而不是用正则：
 *   ① 注释必须在**字符串之外**才算注释 —— 否则 `'https://x'` 会被当成行注释，
 *      把后面整行代码吃掉导致漏扫；
 *   ② 正则字面量 `['"]` 里的引号不能当成字符串起点；
 *   ③ 需要字符串的精确区间来做 `tx(...)` 实参配平。
 */
function lex(src: string): Lexed {
  const n = src.length;
  const masked = new Array<string>(n);
  const parenSrc = new Array<string>(n);
  const tokens: Token[] = [];

  for (let i = 0; i < n; i++) masked[i] = src[i];
  for (let i = 0; i < n; i++) parenSrc[i] = src[i];

  /** 把 [a,b) 区间在某个数组里涂成空格（保留换行） */
  const blank = (arr: string[], a: number, b: number): void => {
    for (let k = a; k < b; k++) if (arr[k] !== '\n') arr[k] = ' ';
  };

  /** 上一个有意义的非空白字符（判断 `/` 是正则还是除号） */
  const prevMeaningful = (i: number): string => {
    for (let k = i - 1; k >= 0; k--) {
      if (/\s/.test(src[k])) continue;
      return src[k];
    }
    return '';
  };

  let i = 0;
  while (i < n) {
    const c = src[i];

    // ── 行注释 ──
    if (c === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(masked, i, j);
      blank(parenSrc, i, j);
      i = j;
      continue;
    }

    // ── 块注释 ──
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const j = close < 0 ? n : close + 2;
      blank(masked, i, j);
      blank(parenSrc, i, j);
      i = j;
      continue;
    }

    // ── 单 / 双引号字符串 ──
    if (c === "'" || c === '"') {
      const kind = c === "'" ? 'single' : 'double';
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') j += 2;
        else if (src[j] === c) break;
        else if (src[j] === '\n') break; // 未闭合，别吃掉后面整段代码
        else j++;
      }
      const end = Math.min(j + 1, n);
      tokens.push({ kind, start: i, end, value: src.slice(i + 1, Math.min(j, n)), hasExpr: false });
      blank(parenSrc, i + 1, end - 1); // 串内容不参与括号配平
      i = end;
      continue;
    }

    // ── 模板串 ──
    if (c === '`') {
      let j = i + 1;
      let hasExpr = false;
      let depth = 0;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (depth === 0) {
          if (src[j] === '`') break;
          if (src[j] === '$' && src[j + 1] === '{') {
            hasExpr = true;
            depth = 1;
            j += 2;
            continue;
          }
        } else {
          // `${ … }` 里：括号配平 + 跳过内部字符串，避免嵌套 `}` 提前收尾
          if (src[j] === '{') depth++;
          else if (src[j] === '}') depth--;
          else if (src[j] === "'" || src[j] === '"') {
            const q = src[j];
            let k = j + 1;
            while (k < n && src[k] !== q) {
              if (src[k] === '\\') k++;
              k++;
            }
            j = k + 1;
            continue;
          }
        }
        j++;
      }
      const end = Math.min(j + 1, n);
      tokens.push({ kind: 'template', start: i, end, value: src.slice(i + 1, Math.min(j, n)), hasExpr });
      // 模板整段不参与括号配平：`(${x})` 里的括号不该被算进去
      blank(parenSrc, i + 1, end - 1);
      i = end;
      continue;
    }

    // ── 正则字面量（只在「该位置能出现正则」时认定） ──
    if (c === '/') {
      const p = prevMeaningful(i);
      if (p === '' || '(,=:[!&|?{};+-*%~^<>'.includes(p)) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          if (src[j] === '\\') j += 2;
          else if (src[j] === '[') {
            inClass = true;
            j++;
          } else if (src[j] === ']') {
            inClass = false;
            j++;
          } else if (src[j] === '/' && !inClass) break;
          else if (src[j] === '\n') break;
          else j++;
        }
        if (j < n && src[j] === '/') {
          i = j + 1;
          continue;
        }
      }
    }

    i++;
  }

  return { masked: masked.join(''), parenSrc: parenSrc.join(''), tokens };
}

/** `tx(` 的实参区间（按括号配平） */
function txArgSpans(parenSrc: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const re = /\btx\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(parenSrc))) {
    const open = m.index + m[0].length - 1; // `(` 的下标
    let depth = 0;
    let j = open;
    for (; j < parenSrc.length; j++) {
      if (parenSrc[j] === '(') depth++;
      else if (parenSrc[j] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    spans.push({ start: open, end: Math.min(j, parenSrc.length) });
  }
  return spans;
}

/** 形如 `<命名空间>.<段>`（A 类）或 `<命名空间>.<段>.<段>+`（B 类） */
function looksLikeKey(v: string, minSegments: number): boolean {
  if (/\s/.test(v) || v.includes('*') || v.includes('$')) return false;
  const parts = v.split('.');
  if (parts.length < minSegments) return false;
  if (!NAMESPACES.has(parts[0])) return false;
  return parts.every((p) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p));
}

interface Candidate {
  key: string;
  /** 是否出现在 `tx(...)` 实参里 */
  direct: boolean;
  /** 全部出处 `文件:行号` */
  wheres: string[];
}

function collectCandidates(): { list: Candidate[]; directCount: number; indirectCount: number } {
  const files: string[] = [];
  (function walk(dir: string): void {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!EXCLUDE_DIRS.includes(p)) walk(p);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      if (/\.test\.tsx?$/.test(e.name)) continue; // 测试自己不算调用点
      files.push(p);
    }
  })(SRC_ROOT);

  const byKey = new Map<string, Candidate>();
  let directCount = 0;
  let indirectCount = 0;

  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(SRC_ROOT, f).split(path.sep).join('/');
    const { masked, parenSrc, tokens } = lex(src);
    const spans = txArgSpans(parenSrc);
    const lineOf = (idx: number): number => masked.slice(0, idx).split('\n').length;

    for (const t of tokens) {
      if (t.kind === 'template') {
        // 含 ${} 的模板串拼出来的键无法静态验证 —— 整条跳过（见文件头「不覆盖什么」）
        if (t.hasExpr) continue;
      }
      const direct = spans.some((s) => t.start > s.start && t.end <= s.end + 1);
      if (direct) {
        // `tx('a.' + b)` 这种拼接片段不是完整键，跳过
        const after = masked.slice(t.end, t.end + 8);
        const before = masked.slice(Math.max(0, t.start - 8), t.start);
        if (/^\s*\+/.test(after) || /\+\s*$/.test(before)) continue;
      }
      const isCandidate = direct ? looksLikeKey(t.value, 2) : looksLikeKey(t.value, 3);
      if (!isCandidate) continue;

      const where = `${rel}:${lineOf(t.start)}`;
      const existing = byKey.get(t.value);
      if (existing) {
        if (!existing.wheres.includes(where)) existing.wheres.push(where);
        if (direct && !existing.direct) existing.direct = true;
      } else {
        byKey.set(t.value, { key: t.value, direct, wheres: [where] });
        if (direct) directCount++;
        else indirectCount++;
      }
    }
  }

  return { list: [...byKey.values()], directCount, indirectCount };
}

/** `zh` 里所有「叶子是字符串」的点号路径 */
function zhLeaves(): Set<string> {
  const out = new Set<string>();
  (function walk(node: unknown, prefix: string): void {
    if (typeof node === 'string') {
      out.add(prefix);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walk(v, prefix ? `${prefix}.${k}` : k);
    }
  })(zh as unknown as Record<string, unknown>, '');
  return out;
}

const LEAVES = zhLeaves();

const hasPlural = (key: string): boolean => LEAVES.has(`${key}_one`) || LEAVES.has(`${key}_other`);

/** 是否存在以 `<key>.` 为前缀的子键 */
function hasChild(key: string): boolean {
  const prefix = `${key}.`;
  for (const k of LEAVES) if (k.startsWith(prefix)) return true;
  return false;
}

type Verdict = 'ok' | 'pluralBase' | 'stepBase' | 'fail';

function judge(c: Candidate, missing = (k: string) => tx(k) === k): { verdict: Verdict; why: string } {
  if (!missing(c.key)) return { verdict: 'ok', why: '' };
  if (hasPlural(c.key)) {
    return { verdict: 'pluralBase', why: `复数基名（存在 ${c.key}_one/_other）` };
  }
  // 只对「不是 tx() 直接实参」的字面量放行：直接喂给 tx() 的中间节点是真 bug
  if (!c.direct && hasChild(c.key)) {
    return { verdict: 'stepBase', why: `分步基名（存在 ${c.key}.… 子键）` };
  }
  return { verdict: 'fail', why: c.direct ? '直接作为 tx() 实参' : '既无复数后缀也无子键' };
}

const { list: CANDIDATES, directCount, indirectCount } = collectCandidates();
const ZH_JUDGED = CANDIDATES.map((c) => ({ c, ...judge(c) }));
const EXEMPTED = ZH_JUDGED.filter((x) => x.verdict === 'pluralBase' || x.verdict === 'stepBase');

describe('i18n 键护栏 v2 · 像键的字面量都必须在字典里命中', () => {
  it('扫描规模合理（防止词法/目录一变就「一个都没扫到」而静默全绿）', () => {
    expect(CANDIDATES.length).toBeGreaterThan(500);
    expect(directCount).toBeGreaterThan(500); // A 类：tx() 实参里的键
    expect(indirectCount).toBeGreaterThan(50); // B 类：映射表里的键（v1 完全没扫）
  });

  it('zh-CN：每个候选键都命中（例外只走两条通用规则）', () => {
    setLang('zh-CN');
    const fails = CANDIDATES.map((c) => ({ c, ...judge(c) })).filter((x) => x.verdict === 'fail');
    console.info(
      `[i18n 护栏] 候选键 ${CANDIDATES.length}（A类 ${directCount} / B类 ${indirectCount}），` +
        `豁免 ${EXEMPTED.length}：复数基名 ${EXEMPTED.filter((x) => x.verdict === 'pluralBase').length}` +
        ` / 分步基名 ${EXEMPTED.filter((x) => x.verdict === 'stepBase').length}`,
    );
    expect(
      fails.map((x) => `  ✗ ${x.c.key}  [${x.why}]\n      出处：${x.c.wheres.join('  ')}`),
      `[zh-CN] ${fails.length} 个像键的字面量在字典里取不到 → 界面会直接把键路径显示给用户：`,
    ).toEqual([]);
  });

  it('en-US：同样全部命中（英文缺了会漏）', () => {
    setLang('en-US');
    const fails = CANDIDATES.map((c) => ({ c, ...judge(c) })).filter((x) => x.verdict === 'fail');
    expect(
      fails.map((x) => `  ✗ ${x.c.key}\n      出处：${x.c.wheres.join('  ')}`),
      `[en-US] ${fails.length} 个像键的字面量取不到文案：`,
    ).toEqual([]);
  });

  it('豁免自证：每条被放行的键都必须当场拿得出证据', () => {
    const liars: string[] = [];
    for (const x of EXEMPTED) {
      if (x.verdict === 'pluralBase' && !hasPlural(x.c.key)) liars.push(`${x.c.key}（说好的 _one/_other 呢）`);
      if (x.verdict === 'stepBase' && (x.c.direct || !hasChild(x.c.key)))
        liars.push(`${x.c.key}（说好的子键呢 / 或者它其实是 tx() 直接实参）`);
    }
    expect(liars, `豁免规则放行了拿不出证据的键：${liars.join(' , ')}`).toEqual([]);
    expect(EXEMPTED.length, '一条豁免都没有 → 说明豁免分支根本没被走到，规则可能写歪了').toBeGreaterThan(0);
  });

  it('豁免零名单：放行只能靠规则，不能靠按键名的白名单', () => {
    expect(
      [...KNOWN_BAD],
      'KNOWN_BAD 必须为空 —— 有缺陷就修代码，不要往名单里塞键名',
    ).toEqual([]);
  });
});
