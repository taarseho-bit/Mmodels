/**
 * 粘贴长文本的折叠逻辑 —— 逐条对齐原版 MathModel 0.0.20 渲染层 index chunk。
 * 原版实现与取证地址见 `.workbuddy/ui-audit/_tmp-audit/prep-4-7-11-orig.txt`
 * 与 `prep-11-tail-format.txt`（`_probe*.cjs` 已删，txt 是当时的逐字 dump）。
 *
 * ⚠️ 四处**不能"顺手优化"**的地方（改了就与原版不一致）：
 *   1. 阈值是**闭区间** `>=`，不是 `>`（4000 字符整就该折叠）；
 *   2. 行数是 `split('\n').length`，**不是** `filter(Boolean).length` ⇒ `'a\n'` 算 **2** 行；
 *   3. 空串直接 false，不参与任何阈值比较（但纯空白**不**特殊处理）；
 *   4. 尾巴与正文之间是**两个换行**，且尾巴**不进 parts 数组**（见 `appendPasted`）。
 */
import { txPlural } from '../i18n';

/** 折叠行阈值（原版 `X1e`，@1127411） */
export const PASTE_FOLD_LINES = 25;
/** 折叠字符阈值（原版 `$1e`，@1127418） */
export const PASTE_FOLD_CHARS = 4000;
/** 标题内联长度上限（原版 `Nz`，@1571342） */
const TITLE_MAX = 140;

/** 尾巴提取正则（原版 `J1e`，@1127426）。⚠️ 锚在正文末尾（`\s*$`） */
const PASTED_TAIL = /\n*<pasted_text>\n([\s\S]*?)\n<\/pasted_text>\s*$/;

/** 正文与尾巴之间的分隔（原版 `n0e` 里的 `\n\n`） */
const BODY_TAIL_SEP = '\n\n';

export interface PastedText {
  id: string;
  /** 已做换行归一化 */
  text: string;
  lineCount: number;
  charCount: number;
}

/** 原版 `oy()` —— `\r\n` / 孤立 `\r` 统一成 `\n` */
export function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** 原版 `dT()` —— 空串 0 行；`'a\n'` 是 **2** 行（末尾换行也算一行） */
export function lineCountOf(s: string): number {
  return s.length === 0 ? 0 : s.split('\n').length;
}

/** 原版 `e0e()` —— **闭区间** `>=`；空串直接 false */
export function shouldFoldPasted(raw: string): boolean {
  const s = normalizeNewlines(raw);
  if (s.length === 0) return false;
  return s.length >= PASTE_FOLD_CHARS || lineCountOf(s) >= PASTE_FOLD_LINES;
}

/** 原版 `dM()` —— 注意 charCount 是**归一化后**的长度（`'a\r\nb'` → 3，不是 4） */
export function makePastedText(raw: string): PastedText {
  const text = normalizeNewlines(raw);
  return { id: crypto.randomUUID(), text, lineCount: lineCountOf(text), charCount: text.length };
}

/** 原版 `Nz()` —— 首个非空行 trim；>140 → 前 137 + '...'；全空白 → ''（调用方回落 fallbackTitle） */
export function pastedTitle(text: string): string {
  for (const line of normalizeNewlines(text).split('\n')) {
    const s = line.trim();
    if (s.length > 0) return s.length > TITLE_MAX ? `${s.slice(0, 137)}...` : s;
  }
  return '';
}

/** 原版 `xxe()` —— 只有一行时显示字符数，多行时显示行数 */
export function pastedMetricsLabel(m: Pick<PastedText, 'lineCount' | 'charCount'>): string {
  return m.lineCount > 1
    ? txPlural('chat.pastedText.lineCount', m.lineCount)
    : txPlural('chat.pastedText.charCount', m.charCount);
}

/** 原版 `t0e()` —— 三行 join('\n')；无有效条目返回 '' */
export function serializePasted(items: PastedText[]): string {
  const live = items.filter((i) => normalizeNewlines(i.text).length > 0);
  if (live.length === 0) return '';
  const arr = live.map((i) => ({ text: normalizeNewlines(i.text) }));
  return ['<pasted_text>', JSON.stringify(arr), '</pasted_text>'].join('\n');
}

/**
 * 原版 `n0e(body, chips)` —— ★ 尾巴**不进 parts**，而是接在正文之后。
 * 正文为空 → 只有尾巴；无 chip → 正文原样（trim 过）。
 */
export function appendPasted(body: string, items: PastedText[]): string {
  const tail = serializePasted(items);
  const b = body.trim();
  if (tail.length === 0) return b;
  return b.length > 0 ? `${b}${BODY_TAIL_SEP}${tail}` : tail;
}

/**
 * 原版 `i0e()` + `Oz()` —— 解析尾巴（编辑回填用）。
 *
 * 容错口径（与用例一致）：尾巴 JSON 坏了 / 不是数组 / 元素不是对象或 `text` 非字符串
 * ⇒ **不抛异常**，坏条目静默丢弃；一条都没解析出来时**原样返回整个 body**
 * （把"看起来像尾巴但解析不了"的文本留在正文里，总好过悄悄吞掉用户的输入）。
 */
export function stripPasted(body: string): { promptText: string; texts: string[] } {
  const m = PASTED_TAIL.exec(body);
  if (!m) return { promptText: body, texts: [] };
  let texts: string[] = [];
  try {
    const parsed: unknown = JSON.parse((m[1] ?? '').trim());
    if (Array.isArray(parsed)) {
      texts = parsed
        .map((x) => (x && typeof x === 'object' ? (x as { text?: unknown }).text : undefined))
        .filter((x): x is string => typeof x === 'string');
    }
  } catch {
    /* 尾巴坏了就当没有 */
  }
  return texts.length
    ? { promptText: body.slice(0, m.index).replace(/\n+$/, ''), texts }
    : { promptText: body, texts: [] };
}
