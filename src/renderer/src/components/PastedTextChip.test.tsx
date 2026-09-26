/**
 * `PastedTextChip` 的叶子渲染测试 —— 补上「接线那一层没有自动化测试」的缺口。
 *
 * ## 为什么需要这一层（`pasted-text.test.ts` 挡不住的东西）
 *
 * `pasted-text.test.ts` 测的是**纯函数**，它证明不了「组件真的把结果渲染出来了」。
 * 本仓已经真踩过这个坑：`tx()` 取不到键时**原样返回路径字符串**，界面直接把
 * `composer.composerTaskListCard.progress` 显示给用户，而当时**单测、typecheck、
 * 构建全绿** —— 直到界面样例才看见。
 *
 * 所以这里盯三件事，都是纯函数测不到的：
 *   ① **图标名写错不报错**：`Icon`（`Icon.tsx:36`）缺名时**静默画一个空心圆**，
 *      所以必须断言**没走到兜底分支**（`data-missing-icon` 不出现），
 *      而不是只断言"名字在资源表里"；
 *   ② **文案必须来自词典**：断言渲染结果里**不含键路径** `chat.pastedText`；
 *   ③ **交互接线**：`onMouseDown` 必须真的调 `preventDefault()`（项目契约 `Sxe`）——
 *      漏了它，点「显示在输入框中」会让输入框失焦，用户接着打字打不进去。
 *
 * ## 环境说明
 *
 * `vitest.config.ts:28` 是 `environment: 'node'`（没有 DOM），所以按本仓既有做法
 * （`settings/sections-structure.test.tsx` / `store/follow-up-queue.test.ts`）用
 * `react-dom/server` 的 `renderToStaticMarkup` 取静态 HTML。
 *
 * ⚠️ 静态 HTML **不带事件处理器**，所以第 ③ 类断言改为**直接调用组件函数**取元素树。
 *    这么做的前提是 `PastedTextChip` **没有任何 hook**（纯函数组件）——
 *    如果将来给它加了 `useState`/`useEffect`，本文件会**立刻报错**，
 *    那时请改成 `react-test-renderer` 之类的真实渲染器，别把断言删掉。
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PastedTextChip } from './PastedTextChip';
import { setLang } from '../i18n';
import { makePastedText, pastedTitle, type PastedText } from '../lib/pasted-text';

const chip = (text: string): PastedText => makePastedText(text);

/** 30 行的长文本（正文里带可辨识的行，用来做"整段没被渲染进 chip"的反向断言） */
const LONG = ['第一行标题', ...Array.from({ length: 30 }, (_, i) => `第 ${i + 2} 行内容`)].join('\n');

function render(item: PastedText): string {
  return renderToStaticMarkup(<PastedTextChip item={item} onShowInTextField={() => {}} onRemove={() => {}} />);
}

/** 在元素树里按 className 找节点（静态 HTML 拿不到 handler，只能走元素树） */
function findByClass(node: unknown, cls: string): ReactElement<Record<string, unknown>> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findByClass(n, cls);
      if (hit) return hit;
    }
    return undefined;
  }
  const el = node as ReactElement<Record<string, unknown>>;
  const props = el.props as { className?: string; children?: unknown } | undefined;
  if (props?.className === cls) return el;
  return findByClass(props?.children, cls);
}

/** 出现次数（`className` 用闭合引号精确匹配，避免 `cz-paste-chip-body` 被算进去） */
const countOf = (html: string, className: string): number => (html.match(new RegExp(`class="${className}"`, 'g')) ?? []).length;

describe('PastedTextChip · 结构', () => {
  it('渲染出外壳 / 正文列 / 标题 / 两个按钮，各恰好一个', () => {
    setLang('zh-CN');
    const html = render(chip(LONG));
    expect(countOf(html, 'cz-paste-chip')).toBe(1);
    expect(countOf(html, 'cz-paste-chip-body')).toBe(1);
    expect(countOf(html, 'cz-paste-chip-title')).toBe(1);
    expect(countOf(html, 'cz-paste-chip-act')).toBe(1);
    expect(countOf(html, 'cz-paste-chip-x')).toBe(1);
    // 与附件 chip 是两套几何，**不允许**复用 .cz-chip
    expect(html).not.toContain('class="cz-chip"');
  });

  it('标题取首行，且 tooltip 也是首行（不是整段）', () => {
    setLang('zh-CN');
    const html = render(chip(LONG));
    expect(html).toContain('第一行标题');
    expect(html).toContain(`title="${pastedTitle(LONG)}"`);
  });

  it('★ 反向：整段文本**不进** chip（只渲染标题，正文交给尾巴）', () => {
    setLang('zh-CN');
    const html = render(chip(LONG));
    expect(html).not.toContain('第 2 行内容');
    expect(html).not.toContain('第 31 行内容');
    // 也不该出现尾巴标记本身 —— 那是发送时拼在正文末尾的，不是渲染进 chip 的
    expect(html).not.toContain('<pasted_text>');
  });

  it('标题截断：141 字符 → 140 长且以 ... 结尾', () => {
    setLang('zh-CN');
    const html = render(chip('a'.repeat(141)));
    expect(html).toContain(`${'a'.repeat(137)}...`);
  });

  it('全空白文本 → 回落到词典里的通用标题，而不是渲染成空', () => {
    setLang('zh-CN');
    const html = render(chip('   \n\t\n '));
    expect(html).toContain('粘贴的文本');
  });
});

describe('PastedTextChip · 图标与文案都真的到位（防静默失败）', () => {
  it('★ 三个图标名都命中了资源，**没有走到空心圆兜底**', () => {
    setLang('zh-CN');
    const html = render(chip(LONG));
    expect(html).toContain('data-icon="clipboard-list"');
    expect(html).toContain('data-icon="corner-down-right"');
    expect(html).toContain('data-icon="x"');
    // Icon 缺名时渲染 <Fallback>（Icon.tsx:36，带 data-missing-icon="1"）——
    // 这一条才是真正拦住"名字写错"的断言：写错不报错、只变成空心圆。
    expect(html).not.toContain('data-missing-icon');
  });

  it('★ 文案来自词典：不含键路径 `chat.pastedText`', () => {
    setLang('zh-CN');
    const html = render(chip(LONG));
    expect(html).toContain('显示在输入框中');
    expect(html).toContain('移除粘贴文本');
    // tx() 取不到键会把**路径原样渲染**给用户，这是本仓的静默失败形态
    expect(html).not.toContain('chat.pastedText');
  });

  it('切到英文时不再是中文（证明走的是 tx() 而不是硬编码）', () => {
    setLang('en-US');
    const html = render(chip(LONG));
    expect(html).toContain('Show in text field');
    expect(html).not.toContain('显示在输入框中');
    setLang('zh-CN');
  });
});

describe('PastedTextChip · 交互接线', () => {
  it('★ 点「显示在输入框中」前会 preventDefault（否则输入框失焦，见项目契约 Sxe）', () => {
    const onShow = vi.fn();
    const tree = PastedTextChip({ item: chip(LONG), onShowInTextField: onShow, onRemove: () => {} });
    const act = findByClass(tree, 'cz-paste-chip-act');
    expect(act, '没找到 .cz-paste-chip-act 按钮').toBeTruthy();

    const preventDefault = vi.fn();
    (act!.props as { onMouseDown?: (e: { preventDefault(): void }) => void }).onMouseDown?.({ preventDefault });
    expect(preventDefault, '漏了 onMouseDown→preventDefault，点完按钮光标会跑掉').toHaveBeenCalledTimes(1);
  });

  it('点「显示在输入框中」会回调 onShowInTextField（只回一次）', () => {
    const onShow = vi.fn();
    const tree = PastedTextChip({ item: chip(LONG), onShowInTextField: onShow, onRemove: () => {} });
    (findByClass(tree, 'cz-paste-chip-act')!.props as { onClick?: () => void }).onClick?.();
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('点删除按钮会回调 onRemove（只回一次）', () => {
    const onRemove = vi.fn();
    const tree = PastedTextChip({ item: chip(LONG), onShowInTextField: () => {}, onRemove });
    (findByClass(tree, 'cz-paste-chip-x')!.props as { onClick?: () => void }).onClick?.();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('两个按钮都是 type="button"（放在表单里不会被当成提交）', () => {
    const tree = PastedTextChip({ item: chip(LONG), onShowInTextField: () => {}, onRemove: () => {} });
    for (const cls of ['cz-paste-chip-act', 'cz-paste-chip-x']) {
      expect((findByClass(tree, cls)!.props as { type?: string }).type).toBe('button');
    }
  });
});

/**
 * 防摆设（变异探针的"零改产品码"版本）。
 *
 * 上面两条 `not.toContain(...)` 只有在**它们本来会失败**的前提下才算证据。
 * 这里不碰产品代码，只把两条断言的**前置信号**各触发一次，证明信号真的存在：
 *   - 若把 `Icon` 的名字写错，`data-missing-icon` **确实**会出现；
 *   - 若词典里没有这个键，`tx()` **确实**会把路径原样吐出来。
 * 两条都成立 ⇒ 那两条 `not.toContain` 才有拦错能力，而不是恒真。
 */
describe('PastedTextChip · 防摆设（证明上面两条否定断言的信号真实存在）', () => {
  it('图标名写错时 `data-missing-icon` 确实会出现（所以 `not.toContain` 有失败能力）', async () => {
    const { Icon } = await import('./Icon');
    const wrong = renderToStaticMarkup(<Icon name="this-icon-does-not-exist" />);
    const right = renderToStaticMarkup(<Icon name="clipboard-list" />);
    expect(wrong).toContain('data-missing-icon');
    expect(right).not.toContain('data-missing-icon');
  });

  it('词典缺键时 `tx()` 确实原样返回路径（所以 `not.toContain("chat.pastedText")` 有失败能力）', async () => {
    const { tx } = await import('../i18n');
    expect(tx('chat.pastedText.__no_such_key__')).toBe('chat.pastedText.__no_such_key__');
  });
});
