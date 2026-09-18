/**
 * 通用右键上下文菜单。
 *
 * 用途：侧栏「项目」区的**项目行**与「会话」区的**会话行**右键弹出，
 * 菜单里带「打开文件夹目录」——这是用户点名要、原版没有的能力。
 *
 * 交互契约（与原生菜单对齐）：
 *   - 跟随鼠标坐标弹出；贴到视口边缘时自动翻转，不会超出屏幕；
 *   - 点击菜单外任意位置 / 按 Esc / 窗口失焦 / 滚动 → 关闭；
 *   - ↑ ↓ 移动高亮，Enter 触发，Tab 关闭（键盘可达）。
 *
 * 渲染走 portal 挂到 body：侧栏有 `overflow: auto`，菜单若留在侧栏内会被裁切。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface ContextMenuItem {
  /** 菜单项文案（已本地化） */
  label: string;
  /** 图标名（`Icon` 组件的 name） */
  icon?: string;
  onSelect: () => void;
  /** 危险操作（删除）—— 文字用危险色 */
  danger?: boolean;
  /** 该项之前画一条分隔线，用于分组 */
  divider?: boolean;
  disabled?: boolean;
}

export interface ContextMenuProps {
  /** 打开时的鼠标视口坐标 */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** 实机取证用的稳定标识，渲染成 `data-ctx` */
  testId?: string;
  /** 无障碍标签 */
  ariaLabel?: string;
}

/** 菜单与视口边缘之间保留的最小间距 */
const EDGE = 8;

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  testId,
  ariaLabel,
}: ContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  /** 先以 (0,0) 渲染量尺寸，再落最终坐标；null 表示还没定位（首帧不可见） */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(-1);
  /** 键盘高亮下标的镜像 —— keydown 监听器里要读最新值，不能靠闭包捕获的 state */
  const activeRef = useRef(-1);
  activeRef.current = active;

  /** 可聚焦的菜单项下标（跳过分隔线与 disabled） */
  const selectable = useMemo(
    () => items.map((it, i) => (!it.disabled && !it.divider ? i : -1)).filter((i) => i >= 0),
    [items],
  );

  /** 视口边缘翻转 */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x;
    let top = y;
    if (left + w + EDGE > window.innerWidth) {
      left = Math.max(EDGE, window.innerWidth - w - EDGE);
    }
    if (top + h + EDGE > window.innerHeight) {
      // 优先向上翻转；上方也放不下就贴下边
      const flipped = y - h;
      top = flipped >= EDGE ? flipped : Math.max(EDGE, window.innerHeight - h - EDGE);
    }
    setPos({ left, top });
  }, [x, y, items.length]);

  const close = useCallback((): void => onClose(), [onClose]);

  const runItem = useCallback(
    (idx: number): void => {
      const it = items[idx];
      if (!it || it.disabled) return;
      close();
      it.onSelect();
    },
    [items, close],
  );

  /** 点击外部 / 再次右键 / Esc / 失焦 / 滚动 → 关闭 */
  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onContextMenu = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      if (selectable.length === 0) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const at = selectable.indexOf(activeRef.current);
        const next =
          e.key === 'ArrowDown'
            ? selectable[(at + 1) % selectable.length]
            : selectable[(at <= 0 ? selectable.length : at) - 1];
        setActive(next ?? -1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        runItem(activeRef.current);
        return;
      }
      if (e.key === 'Tab') close();
    };
    const onBlur = (): void => close();

    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  }, [close, runItem, selectable]);

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      data-ctx={testId}
      role="menu"
      aria-label={ariaLabel}
      style={{
        left: pos?.left ?? x,
        top: pos?.top ?? y,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <div key={`${it.label}-${i}`} className="ctx-item-wrap">
          {it.divider && i > 0 && <div className="ctx-sep" role="separator" />}
          <button
            type="button"
            role="menuitem"
            className={`ctx-item${it.danger ? ' danger' : ''}${active === i ? ' active' : ''}`}
            disabled={it.disabled}
            onMouseEnter={() => setActive(i)}
            onClick={() => runItem(i)}
          >
            {it.icon ? <Icon name={it.icon} size={13} /> : <span className="ctx-item-icon-gap" />}
            <span className="ctx-item-label truncate">{it.label}</span>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
