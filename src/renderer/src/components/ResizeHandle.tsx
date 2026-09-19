import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { draggedSize, panelSize } from '../lib/panel-size';

/** 只更新所在面板的 CSS 变量，不在每次鼠标移动时重画对话与工作流。 */
export function ResizeHandle({ storageKey, label, edge = 'right', initial = 240, min = 180, max = 480,
  fraction = .4, viewport = false, optional = false }: {
  storageKey: string; label: string; edge?: 'left' | 'right' | 'top' | 'bottom';
  initial?: number; min?: number; max?: number; fraction?: number; viewport?: boolean; optional?: boolean;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const controller = useRef<{ set: (n: number, save?: boolean) => void; reset: () => void }>();
  const drag = useRef<{ pointer: number; start: number; size: number }>();
  const [dragging, setDragging] = useState(false);
  const horizontal = edge === 'left' || edge === 'right';
  useLayoutEffect(() => {
    const handle = ref.current;
    const panel = handle?.parentElement;
    const container = panel?.parentElement;
    if (!handle || !panel || !container) return;
    const property = horizontal ? '--pane-width' : '--pane-height';
    let wanted = initial;
    let enabled = !optional;
    try { const saved = Number(localStorage.getItem(storageKey)); if (saved > 0) { wanted = saved; enabled = true; } } catch { /* 存储不可用时仍可拖动 */ }
    const available = (): number => viewport
      ? horizontal ? window.innerWidth : window.innerHeight
      : horizontal ? container.clientWidth : container.clientHeight;
    const render = (): void => {
      const size = panelSize(wanted, min, max, available(), fraction);
      if (enabled) panel.style.setProperty(property, `${size}px`);
      else panel.style.removeProperty(property);
      handle.setAttribute('aria-valuenow', String(size));
      handle.setAttribute('aria-valuemax', String(panelSize(max, min, max, available(), fraction)));
    };
    controller.current = {
      set(n, save = false) {
        enabled = true;
        wanted = panelSize(n, min, max, available(), fraction);
        render();
        if (save) try { localStorage.setItem(storageKey, String(wanted)); } catch { /* 可继续使用 */ }
      },
      reset() { wanted = initial; enabled = !optional; render(); try { localStorage.removeItem(storageKey); } catch { /* 可继续使用 */ } },
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(container);
    window.addEventListener('resize', render);
    const release = (): void => {
      if (drag.current) controller.current?.set(Number(handle.getAttribute('aria-valuenow')), true);
      drag.current = undefined; setDragging(false);
    };
    const move = (event: PointerEvent): void => {
      const d = drag.current;
      if (!d || d.pointer !== event.pointerId) return;
      if (!event.buttons) { release(); return; }
      controller.current?.set(draggedSize(d.size, (horizontal ? event.clientX : event.clientY) - d.start, edge));
    };
    // Electron 中窗口/浮层切换可能释放 pointer capture；全局监听 + 遮罩保证拖动连续。
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return () => {
      observer.disconnect(); window.removeEventListener('resize', render); window.removeEventListener('blur', release);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release); controller.current = undefined;
    };
  }, [storageKey, horizontal, edge, initial, min, max, fraction, viewport, optional]);
  return <>
    <div ref={ref} className={`pane-resizer at-${edge}`} role="separator" tabIndex={0}
      aria-label={label} aria-orientation={horizontal ? 'vertical' : 'horizontal'} aria-valuemin={min}
      title={`${label} · 拖动调节，双击恢复默认`} onDoubleClick={() => controller.current?.reset()}
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault();
        const rect = e.currentTarget.parentElement!.getBoundingClientRect();
        drag.current = { pointer: e.pointerId, start: horizontal ? e.clientX : e.clientY, size: horizontal ? rect.width : rect.height };
        setDragging(true);
      }}
      onKeyDown={e => {
        if (e.key === 'Home' || e.key === 'Enter') { e.preventDefault(); controller.current?.reset(); return; }
        const step = horizontal ? { ArrowLeft: -16, ArrowRight: 16 } : { ArrowUp: -16, ArrowDown: 16 };
        const delta = step[e.key as keyof typeof step];
        if (delta === undefined) return;
        e.preventDefault();
        controller.current?.set(draggedSize(Number(e.currentTarget.getAttribute('aria-valuenow')), delta, edge), true);
      }} />
    {dragging && createPortal(<div className={`pane-drag-shield ${horizontal ? 'horizontal' : 'vertical'}`} />, document.body)}
  </>;
}
