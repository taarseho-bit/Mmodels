/**
 * 右侧面板 —— 对齐原版 `dock.rightPanel.*`：7 个标签 + 多标签开合。
 *
 * 原版标签与顺序：文件 / 终端 / 浏览器 / 更改 / 项目版本 / 科研绘图 / 流程图
 * 原版另有 `addTab:"添加标签页"`、`closeTab:"关闭标签页"` → 标签可关可加
 * （已打开的标签持久化到 localStorage，刷新后恢复）。
 *
 * 原版右栏没有「产物」「技能」标签：
 *   · 产物 —— 是「文件」标签内的**内联视图**（面包屑/筛选/文件树/查看器都在 `FilesPanel` 里，
 *     打开文件不切标签，点查看器的 × 回到文件树）
 *   · 技能 —— 独立的能力入口，见侧栏「扩展」页
 */
import { useCallback, useRef, useState } from 'react';
import { useApp, SIDE_PANEL_TABS, type SidePanelTab } from '../store/app';
import { FilesPanel } from './FilesPanel';
import { TerminalPanel } from './TerminalPanel';
import { DiffPanel } from './DiffPanel';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import { DiagramsPanel } from './DiagramsPanel';
import { BrowserPanel } from './BrowserPanel';
import { Icon } from './Icon';
import { GALLERY, templatePrompt } from '@shared/gallery-data';
import { tx } from '../i18n';

/** 模板缩略图：vite 在构建时解析为 URL（与 GalleryPage 同一批内置 webp） */
const THUMBS = import.meta.glob('../assets/gallery/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 面板宽度范围与持久化键（对应原版面板拖拽调整尺寸） */
const PANEL_MIN = 260;
const PANEL_MAX = 720;
const PANEL_WIDTH_KEY = 'mm-sidepanel-width';

function initialPanelWidth(): number {
  const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
  if (Number.isFinite(saved) && saved >= PANEL_MIN && saved <= PANEL_MAX) return Math.round(saved);
  return 340;
}

/**
 * 科研绘图标签 —— 紧凑版模板列表。
 * 数据源与行为都复用 GalleryPage：同一份 `GALLERY` 目录（含「流程图」分类）、
 * 点击后经 `templatePrompt` 分派提示词（流程图走 `/paper-diagram`，其余走
 * `/mathmodel-figure-templates`，主题默认「灰白论文版」），再填进输入框。
 */
function GalleryPanel(): JSX.Element {
  const fillPrompt = useApp((s) => s.fillPrompt);
  return (
    <div className="sp-gallery">
      <div className="sp-gallery-hint">{tx('dock.galleryPanel.clickHint')}</div>
      {GALLERY.map((g) => {
        const src = THUMBS[`../assets/gallery/${g.image}`];
        const label = tx('dock.galleryPanel.fillPrompt', { title: g.title });
        return (
          <button
            key={g.id}
            className="sp-gallery-item"
            title={label}
            onClick={() => fillPrompt(templatePrompt(g))}
          >
            {src ? (
              <img className="sp-gallery-thumb" src={src} alt="" loading="lazy" />
            ) : (
              <span className="sp-gallery-thumb" />
            )}
            <span className="sp-gallery-text">
              <span className="sp-gallery-title">{g.title}</span>
              <span className="sp-gallery-cat">{g.category}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function SidePanel(): JSX.Element {
  const panel = useApp((s) => s.sidePanel);
  const setSidePanel = useApp((s) => s.setSidePanel);
  const closeSidePanelTab = useApp((s) => s.closeSidePanelTab);
  const tabs = useApp((s) => s.sidePanelTabs);
  const active: SidePanelTab = panel ?? 'files';
  const [width, setWidth] = useState(initialPanelWidth);
  const [menuOpen, setMenuOpen] = useState(false);
  const dragging = useRef(false);

  /** 左缘拖拽调宽：按住手柄移动鼠标，实时改宽并持久化 */
  const onResizeStart = useCallback((e: React.MouseEvent): void => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = width;
    const move = (ev: MouseEvent): void => {
      if (!dragging.current) return;
      // 手柄在面板左缘，向右拖 = 变宽
      const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, startW + (ev.clientX - startX)));
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      setWidth(next);
    };
    const up = (): void => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setWidth((w) => {
        localStorage.setItem(PANEL_WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [width]);

  return (
    <aside className="sidepanel" style={{ width }}>
      {/* 左缘拖拽手柄（原版 browser.setPanelBounds 的渲染层等价实现） */}
      <div className="sidepanel-resizer" onMouseDown={onResizeStart} role="separator" aria-orientation="vertical" />

      {/* 标签条：已打开的标签 + 末尾「+」添加标签页（原版 addTab / closeTab） */}
      <div className="sidepanel-tabs">
        {tabs.map((key) => (
          <div
            key={key}
            role="tab"
            aria-selected={active === key}
            className={`sidepanel-tab${active === key ? ' active' : ''}`}
            onClick={() => setSidePanel(key)}
          >
            <span className="sidepanel-tab-label">{tx(`dock.rightPanel.${key}`)}</span>
            <span
              className="sidepanel-tab-close"
              role="button"
              title={tx('dock.rightPanel.closeTab')}
              aria-label={tx('dock.rightPanel.closeTab')}
              onClick={(e) => {
                e.stopPropagation();
                closeSidePanelTab(key);
              }}
            >
              <Icon name="x" size={12} />
            </span>
          </div>
        ))}

        <button
          className="sidepanel-tab-add"
          title={tx('dock.rightPanel.addTab')}
          aria-label={tx('dock.rightPanel.addTab')}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <Icon name="plus" size={13} />
        </button>
      </div>

      {/* 「+」的标签清单：放在标签条之外，避免被横向滚动容器裁掉 */}
      {menuOpen ? (
        <>
          <div className="sidepanel-menu-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="sidepanel-menu" role="menu">
            {SIDE_PANEL_TABS.map((key) => (
              <button
                key={key}
                role="menuitem"
                className="sidepanel-menu-item"
                onClick={() => {
                  setSidePanel(key);
                  setMenuOpen(false);
                }}
              >
                {tx(`dock.rightPanel.${key}`)}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <div className="sidepanel-body">
        {/* 浏览器面板要保活（切走再切回不应丢页面），故用显隐而非卸载 */}
        <div className="panel-keepalive" style={{ display: active === 'browser' ? 'block' : 'none' }}>
          <BrowserPanel />
        </div>

        {/* 「文件」标签内部自带 面包屑/筛选/文件树/查看器（原版把查看、编辑、编译都放在这个标签里） */}
        {active === 'files' && <FilesPanel />}
        {active === 'terminal' && <TerminalPanel />}
        {active === 'changes' && <DiffPanel />}
        {active === 'versions' && <VersionHistoryPanel />}
        {active === 'gallery' && <GalleryPanel />}
        {active === 'diagrams' && <DiagramsPanel />}
      </div>
    </aside>
  );
}
