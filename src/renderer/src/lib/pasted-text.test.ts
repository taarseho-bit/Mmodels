/**
 * 粘贴长文本折叠逻辑的单测。
 *
 * 为什么这些用例值钱：这套逻辑有**四处"看起来该优化、实际一改就与应用约定不一致"**的
 * 细节（闭区间阈值 / `split('\n').length` / 空串短路 / 尾巴不进 parts），
 * 它们都不会让界面报错，只会让**边界那一格**悄悄错掉（4000 字符的文本不折叠、
 * `'a\n'` 少算一行）。所以每条都钉死在边界值上。
 *
 * 另外这里必须有一条**图标名断言**：本仓的 `Icon`（`components/Icon.tsx:36`）
 * 遇到不存在的名字**不报错**，只是静默画一个空心圆 —— 名字写错在 UI 上只会
 * 变成一个圈，typecheck / 构建 / 其余用例全绿。这是唯一能提前拦住它的地方。
 */
import { describe, expect, it } from 'vitest';
import { hasIcon } from '../components/Icon';
import { setLang } from '../i18n';
import {
  PASTE_FOLD_CHARS,
  PASTE_FOLD_LINES,
  appendPasted,
  lineCountOf,
  makePastedText,
  normalizeNewlines,
  pastedMetricsLabel,
  pastedTitle,
  serializePasted,
  shouldFoldPasted,
  stripPasted,
  type PastedText,
} from './pasted-text';

/** 造一个 chip（id 是随机的，用例只关心 text） */
const chip = (text: string): PastedText => makePastedText(text);

/** 尾巴的规范形态（三行，`\n` 分隔） */
const tailOf = (json: string): string => `\n\n<pasted_text>\n${json}\n</pasted_text>`;

describe('pasted-text · 折叠阈值是闭区间', () => {
  it('阈值常量与应用约定一致（25 行 / 4000 字符）', () => {
    expect(PASTE_FOLD_LINES).toBe(25);
    expect(PASTE_FOLD_CHARS).toBe(4000);
  });

  it('字符阈值：3999 不折、4000 折（`>=` 而不是 `>`）', () => {
    expect(shouldFoldPasted('a'.repeat(3999))).toBe(false);
    expect(shouldFoldPasted('a'.repeat(4000))).toBe(true);
  });

  it('行阈值：24 行不折、25 行折', () => {
    expect(shouldFoldPasted(Array(24).fill('a').join('\n'))).toBe(false);
    expect(shouldFoldPasted(Array(25).fill('a').join('\n'))).toBe(true);
  });

  it('行数够多但字符数远超阈值时靠字符阈值命中（24 行 × 200 字符）', () => {
    expect(shouldFoldPasted(Array(24).fill('x'.repeat(200)).join('\n'))).toBe(true);
  });

  it('空串直接 false；纯空白不做特殊分支、只是不足阈值', () => {
    expect(shouldFoldPasted('')).toBe(false);
    expect(shouldFoldPasted('\n\n\n')).toBe(false);
    expect(shouldFoldPasted('   ')).toBe(false);
  });
});

describe('pasted-text · 换行归一化与行数口径', () => {
  it('\\r\\n 与孤立 \\r 都归一成 \\n', () => {
    expect(normalizeNewlines('a\r\nb\rc')).toBe('a\nb\nc');
    expect(lineCountOf(normalizeNewlines('a\r\nb\rc'))).toBe(3);
  });

  it('charCount 是**归一化之后**的长度（原文 4 字符 → 3）', () => {
    const p = makePastedText('a\r\nb');
    expect(p.text).toBe('a\nb');
    expect(p.charCount).toBe(3);
    expect(p.lineCount).toBe(2);
  });

  it("行数是 split('\\n').length，不是 filter(Boolean) —— 末尾换行也算一行", () => {
    expect(lineCountOf('')).toBe(0);
    expect(lineCountOf('a')).toBe(1);
    expect(lineCountOf('a\n')).toBe(2); // filter(Boolean) 会给出 1，那是错的
    expect(lineCountOf('a\nb\n')).toBe(3);
  });
});

describe('pasted-text · 标题', () => {
  it('取首个非空行，并 trim 掉前后空白', () => {
    expect(pastedTitle('   \n  hello  \nworld')).toBe('hello');
  });

  it('140 字符不截；141 字符截成 137 + ...（结果长度正好 140）', () => {
    expect(pastedTitle('a'.repeat(140))).toBe('a'.repeat(140));
    const t = pastedTitle('a'.repeat(141));
    expect(t).toHaveLength(140);
    expect(t.endsWith('...')).toBe(true);
    expect(t.slice(0, -3)).toBe('a'.repeat(137));
  });

  it('全空白 → 空串（由调用方回落「粘贴的文本」）', () => {
    expect(pastedTitle('   \n\t\n ')).toBe('');
    expect(pastedTitle('')).toBe('');
  });
});

describe('pasted-text · 尾巴序列化', () => {
  it("三行 join('\\n')，JSON 是 [{text}] 形态", () => {
    expect(serializePasted([chip('x')])).toBe('<pasted_text>\n[{"text":"x"}]\n</pasted_text>');
  });

  it('空文本条目被丢掉；一条都不剩 → 空串', () => {
    expect(serializePasted([chip(''), chip('x')])).toBe('<pasted_text>\n[{"text":"x"}]\n</pasted_text>');
    expect(serializePasted([chip('')])).toBe('');
    expect(serializePasted([])).toBe('');
  });

  it('多条保持入参顺序', () => {
    expect(serializePasted([chip('a'), chip('b')])).toBe('<pasted_text>\n[{"text":"a"},{"text":"b"}]\n</pasted_text>');
  });
});

describe('pasted-text · 拼接（尾巴不进正文 parts）', () => {
  it('正文 + **两个**换行 + 尾巴', () => {
    expect(appendPasted('body', [chip('x')])).toBe(`body${tailOf('[{"text":"x"}]')}`);
  });

  it('正文为空 → 只有尾巴；无 chip → 正文原样（trim 过）', () => {
    expect(appendPasted('', [chip('x')])).toBe('<pasted_text>\n[{"text":"x"}]\n</pasted_text>');
    expect(appendPasted('  body  ', [])).toBe('body');
    expect(appendPasted('', [])).toBe('');
  });
});

describe('pasted-text · 解析与往返', () => {
  it('往返恒等：strip(append(body, chips)) 还原正文与每一段文本', () => {
    const chips = [chip('line1\nline2'), chip('中文第二段')];
    const body = '用户打的正文\n第二行';
    const back = stripPasted(appendPasted(body, chips));
    expect(back.promptText).toBe(body);
    expect(back.texts).toEqual(chips.map((c) => c.text));
  });

  it('没有尾巴 → 原样返回（不误伤普通正文）', () => {
    expect(stripPasted('just a prompt')).toEqual({ promptText: 'just a prompt', texts: [] });
  });

  it('尾巴坏掉不抛：JSON 非法 / 不是数组 → 静默丢弃并把整个 body 留在正文里', () => {
    const badJson = `body${tailOf('{不是 json')}`;
    expect(stripPasted(badJson)).toEqual({ promptText: badJson, texts: [] });

    const notArray = `body${tailOf('{"text":"x"}')}`;
    expect(stripPasted(notArray)).toEqual({ promptText: notArray, texts: [] });
  });

  it('元素 text 非 string 的条目被丢弃，剩下的照常解析', () => {
    const mixed = `body${tailOf('[{"text":1},null,"a",{"text":"ok"}]')}`;
    expect(stripPasted(mixed)).toEqual({ promptText: 'body', texts: ['ok'] });
  });
});

describe('pasted-text · 计量文案走词典而非写死', () => {
  it('单行走 charCount、多行走 lineCount', () => {
    setLang('zh-CN');
    expect(pastedMetricsLabel({ lineCount: 1, charCount: 3 })).toBe('3 个字符');
    expect(pastedMetricsLabel({ lineCount: 3, charCount: 20 })).toBe('3 行');
  });
});

describe('chip 用到的图标名都真实存在', () => {
  // Icon 组件缺名时**不报错**，只画一个空心圆（components/Icon.tsx:36）——
  // 没有这条断言，写错图标名会一路绿到界面样例。
  it('clipboard-list / corner-down-right / x 都在 lucide 资源里', () => {
    expect(hasIcon('clipboard-list')).toBe(true);
    expect(hasIcon('corner-down-right')).toBe(true);
    expect(hasIcon('x')).toBe(true);
  });
});
