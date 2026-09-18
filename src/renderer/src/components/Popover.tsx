/**
 * 输入区（Composer）里的弹层原语 —— **从 `Composer.tsx` 原样搬过来的一份**。
 *
 * 搬家的原因：输入区左下角的「＋」菜单（`PlusMenu.tsx`）与 Composer 自己的
 * 项目 / 模式 / 权限 / 模型四个选择器用的是**同一套弹层**（同样要 portal 出去、
 * 同样要按上方剩余空间决定向上还是向下翻、同样要「点外部关闭」＋ Esc 关闭）。
 * 各留一份会让定位逻辑有两份真身，改一处漏一处。
 *
 * ⚠️ 搬动时**除了加这份文件头与 import，一个字符都没改**（后面只多了一个
 *    **可选**的 `maxHeight` 参数，默认值 = 原来的 320，另外 5 个选择器一个都没传，
 *    可见行为与本轮之前完全一致）。下面的注释就是原来那些，讲的都是踩过的坑，别删。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** 下拉面板（点外部关闭） */
/**
 * 输入区里的下拉弹层。
 *
 * ⚠️ 这里必须用 **portal + fixed 定位**，不能就地 `position:absolute`。两个原因：
 *
 *   ① **会被裁掉**：`.composer-box` 上有 `overflow:hidden`（用来裁圆角），
 *      弹层作为它的后代，一旦超出内容盒就整块被剪掉 —— 表现为
 *      「点了没反应」，而 DOM 里其实一直存在。
 *
 *   ② **会弹到视口外**：弹层默认向上展开（`bottom:100%`），而空状态时
 *      输入区在屏幕中部，一个 300+ px 高的面板向上展开会跑到 `top` 为负数，
 *      同样看不见。所以这里要根据上方**剩余空间**决定向上还是向下翻。
 *
 * 判定方向时用 `maxHeight` 夹住可用空间，避免"翻了但依然放不下"。
 */
export function Popover({
  open,
  onClose,
  children,
  align = 'left',
  maxHeight = 320,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  align?: 'left' | 'right';
  /**
   * 高度上限（px，默认 320 = 设计系统里 `.cz-pop{max-height:320px}` 那个值）。
   *
   * ⚠️ **改这个参数不能替代改 `.cz-pop`** —— 这里给的是"每个弹层自己那条腿"，
   *    默认值只是与 `.cz-pop` 保持一致。要动全局观感请改 CSS，别改默认值。
   *
   * 为什么要有它：「＋」菜单是 11 行 + 4 条分隔线（≈374px），而原版根弹层的高度
   * 上限是 `max-h-[var(--available-height,28rem)]`（= 可用高度，兜底 28rem/448px）
   * ⇒ **原版这 11 行是一屏全见的**。本仓 `.cz-pop` 的 320px 会让它滚起来。
   * 那个 320px 还压在另外 5 个选择器上（项目/模式/模板/权限/模型），所以只能给
   * 「＋」菜单单独开一条腿：`<Popover maxHeight={448}>`。
   * 内联 `max-height` 的优先级高于 `.cz-pop` 那条类规则，所以它真的会生效。
   */
  maxHeight?: number;
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  /**
   * 定位用的隐形标记。
   *
   * portal 会把弹层挂到 document.body 下，弹层节点的 `parentElement`
   * 就不再是 `.cz-slot` 了 —— 直接往上找锚点按钮会找到 body。
   * 所以在原位置留一个 `display:none` 的 span 当"坐标系原点"，
   * 靠它反查同一槽位里的按钮。这样调用方不用额外传 ref。
   */
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const marker = markerRef.current;
    const slot = marker?.parentElement ?? null;
    const anchor = slot?.querySelector('button') ?? slot;
    if (!anchor) return;
    const measure = (): void => {
      const a = anchor.getBoundingClientRect();
      const self = ref.current;
      const GAP = 6;
      const MARGIN = 8;
      const wantH = self?.scrollHeight || maxHeight;
      const spaceAbove = a.top - MARGIN;
      const spaceBelow = window.innerHeight - a.bottom - MARGIN;
      // 上方放得下就向上，否则向下；两边都不够就选大的一侧并夹住高度
      const down = spaceAbove < wantH + GAP && spaceBelow > spaceAbove;
      const avail = Math.max(120, Math.floor((down ? spaceBelow : spaceAbove) - GAP));
      // 上限由调用方给（原版就是 `min(可用高度, 28rem)` 这个口径）
      const maxH = Math.min(maxHeight, avail);
      const top = down ? a.bottom + GAP : a.top - GAP - Math.min(wantH, maxH);
      const width = self?.offsetWidth || 220;
      const left =
        align === 'right'
          ? Math.max(MARGIN, a.right - width)
          : Math.min(a.left, window.innerWidth - width - MARGIN);
      setPos({ top, left, maxH });
    };
    measure();
    window.addEventListener('resize', measure);
    // 页面滚动会让 fixed 坐标失效，跟着重算
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, align, maxHeight]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node;
      // 弹层已经 portal 出去了，不在原位置，所以两处都要判断
      if (ref.current && ref.current.contains(t)) return;
      if (markerRef.current && markerRef.current.parentElement?.contains(t)) return;
      // 二级子菜单（SubFlyout）同样 portal 出去，点它不算「点外部」
      if ((t as Element | null)?.closest?.('[data-cz-flyout]')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    // 延后一帧挂监听，避免「打开这次点击」立刻把自己关掉
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <>
      <span ref={markerRef} style={{ display: 'none' }} />
      {open
        ? createPortal(
            <div
              className={`cz-pop${align === 'right' ? ' right' : ''}`}
              ref={ref}
              style={{
                position: 'fixed',
                top: pos ? pos.top : 0,
                left: pos ? pos.left : 0,
                maxHeight: pos ? pos.maxH : maxHeight,
                // 首帧还没量到位置，先藏起来避免闪一下
                visibility: pos ? 'visible' : 'hidden',
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * 二级子菜单（原版模型选择器底部的「思考强度　高　›」）。
 *
 * 和 Popover 一样必须 portal 出去：父弹层 `.cz-pop` 上有 `overflow-y:auto`，
 * 就地绝对定位会被整块裁掉。
 *
 * 定位规则：默认贴在所属行**右侧**展开；右边放不下就翻到左边 —— 模型选择器
 * 本身右对齐在输入区右下角，没有这条回退，子菜单会直接跑出视口。
 */
export function SubFlyout({
  open,
  onClose,
  onEnter,
  onLeave,
  extraClass,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** 鼠标进入/离开子菜单本体 —— 交给调用方做悬停延时关闭 */
  onEnter?: () => void;
  onLeave?: () => void;
  /**
   * 追加的 class（可选）。
   * 用途：`.cz-flyout` 只有 `min-width:120px`（够放「思考强度」那 4 行），
   * 而「＋」菜单的子菜单里有项目名 / 技能名 / 数据集文件名，原版给的是
   * `min-w-48/52/56`（192~224px）⇒ 由调用方传 `plus-sub` 加宽，
   * **不去改 `.cz-flyout` 本身**（那会连带改掉模型选择器里那个子菜单的宽度）。
   */
  extraClass?: string;
  children: React.ReactNode;
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const row = markerRef.current?.parentElement;
    if (!row) return;
    const measure = (): void => {
      const r = row.getBoundingClientRect();
      const self = ref.current;
      const GAP = 6;
      const M = 8;
      const w = self?.offsetWidth || 130;
      const h = self?.offsetHeight || 130;
      const left =
        r.right + GAP + w > window.innerWidth - M
          ? Math.max(M, r.left - w - GAP)
          : r.right + GAP;
      const top = Math.max(M, Math.min(r.top - 4, window.innerHeight - h - M));
      setPos({ top, left });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <span ref={markerRef} style={{ display: 'none' }} />
      {open
        ? createPortal(
            <div
              className={`cz-pop cz-flyout${extraClass ? ` ${extraClass}` : ''}`}
              // 父弹层的「点外部关闭」会误判子菜单为外部，靠这个标记豁免
              data-cz-flyout=""
              ref={ref}
              style={{
                position: 'fixed',
                top: pos ? pos.top : 0,
                left: pos ? pos.left : 0,
                visibility: pos ? 'visible' : 'hidden',
              }}
              onMouseEnter={onEnter}
              onMouseLeave={onLeave}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
