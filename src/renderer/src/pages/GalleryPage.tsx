/**
 * 数学建模图表参考库 —— 保留熟悉的卡片交互，但目录和提示词已经独立整理。
 *
 * 页面结构：
 *   <PageShell title description>                    ← 页头无 action
 *     <div flex h-full flex-col>
 *       <div flex flex-wrap items-center gap-1.5 px-5 pb-3 pt-1>   ← 胶囊 + 计数
 *       <div flex-1 overflow-y-auto px-5 pb-6>
 *         <div grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4>
 *           <button> 缩略图(aspect 4/3, 白底 p-2) + 标题行(标题 + 分类胶囊) + 描述(line-clamp-2)
 *       <Dialog w-[min(1180px,94vw)] h-[min(720px,88vh)]>
 *         左：白底大图 + hover 左右箭头 + 底部 `n / N` 计数
 *         右 aside w-72：标题 / 分类胶囊 / 描述 / 配色主题(仅流程图) / 分隔线 /
 *                        来源·绘图库·模板日期 / 使用此模板
 *
 * 所有参考图都走数学建模绘图技能；图表标题、说明和生成约束均使用简体中文。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MATHMODEL_GALLERY,
  GALLERY_CATEGORIES,
  DATA_TYPES,
  DIAGRAM_THEMES,
  DEFAULT_DIAGRAM_THEME,
  templatePrompt,
  type GalleryTemplate,
} from '@shared/gallery-data';
import { PageShell } from '../components/PageShell';
import { useApp } from '../store/app';
import { tx } from '../i18n';
import { registerCommand } from '../keybindings/dispatch';

type DiagramTheme = 'mono' | 'color';

/** 应用约定「全部」胶囊的内部值（与 `shell.galleryPage.all` 文案区分） */
const ALL = 'All';

/** 模板缩略图：vite 在构建时解析为 URL（⚠️ svg 必须在列 —— 流程图参考全是 svg） */
const THUMBS = {
  ...import.meta.glob('../assets/gallery/*.png', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../assets/gallery/*.webp', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../assets/gallery/*.svg', { eager: true, query: '?url', import: 'default' }),
} as Record<string, string>;

function thumbOf(file: string): string | undefined {
  return THUMBS[`../assets/gallery/${file}`];
}

/** 应用约定 `Yr`：缩略图加载完成后淡入，卡片 hover 时轻微放大 */
function Thumb({ src, alt }: { src?: string; alt: string }): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);
  // 命中缓存时 onLoad 可能不触发，兜底补一次
  useEffect(() => {
    if (ref.current?.complete) setLoaded(true);
  }, [src]);
  if (!src) return <></>;
  return (
    <img
      ref={ref}
      className={`gallery-thumb${loaded ? ' loaded' : ''}`}
      src={src}
      alt={alt}
      loading="lazy"
      onLoad={() => setLoaded(true)}
    />
  );
}

/** 目录来源直接展示，方便演示时说明参考图来自哪里。 */
function sourceOf(item: GalleryTemplate): string {
  return item.library;
}

function Detail({
  item,
  index,
  total,
  theme,
  onTheme,
  onPrev,
  onNext,
  onClose,
  onUse,
}: {
  item: GalleryTemplate;
  index: number;
  total: number;
  theme: DiagramTheme;
  onTheme: (t: DiagramTheme) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onUse: () => void;
}): JSX.Element {
  const src = thumbOf(item.image);

  /**
   * 灯箱打开期间的键盘行为。
   *
   * ⚠️ `←` / `→` 以前是**硬编码**的 `e.key === 'ArrowLeft'` —— 于是"设置 → 键盘快捷键"里
   *    把 `gallery.prev` / `gallery.next` 改成别的键**完全没有效果**（那两行看起来能录，
   *    录了其实不生效）。现在改走统一分发器：键位来自 `RULES` 的 `defaultBinding`
   *    （`left` / `right`）**加**用户在设置里的覆盖值 ⇒ 显示什么、按下就匹配什么。
   *
   * ⚠️ 登记**只在本组件挂载期间有效**：`Detail` 是 `openItem ? <Detail/> : null`
   *    条件渲染的（`GalleryPage.tsx:307`），所以"灯箱没开时按 ← 不会翻图"是结构保证的 ——
   *    否则用户在任何输入框里按方向键移动光标都会被吃掉。
   *    （这正是"一个分发器 + 组件内登记"比"全局挂 14 个监听"强的地方。）
   *
   * Esc 不走分发器：它不是 `RULES` 里的条目，是灯箱自己的关闭键（应用约定亦然）。
   *
   * 回调放 ref：`onPrev/onNext/onClose` 每次渲染都是新函数，直接进依赖数组会让登记
   * 每渲染一次就注销重登一次（中间那一小段窗口里命令是"没注册"的 = 偶发失灵）。
   */
  const cb = useRef({ onPrev, onNext, onClose });
  cb.current = { onPrev, onNext, onClose };
  useEffect(() => {
    const offPrev = registerCommand('gallery.prev', () => cb.current.onPrev());
    const offNext = registerCommand('gallery.next', () => cb.current.onNext());
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cb.current.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      offPrev();
      offNext();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="gallery-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gallery-stage">
          {src ? <img className="gallery-stage-img" src={src} alt={item.title} /> : null}
          <button
            type="button"
            className="gallery-nav gallery-nav-prev"
            aria-label={tx('shell.galleryPage.previousFigure')}
            onClick={onPrev}
          >
            ‹
          </button>
          <button
            type="button"
            className="gallery-nav gallery-nav-next"
            aria-label={tx('shell.galleryPage.nextFigure')}
            onClick={onNext}
          >
            ›
          </button>
          <div className="gallery-counter">
            {index + 1} / {total}
          </div>
        </div>

        <aside className="gallery-aside">
          <div className="gallery-aside-head">
            <h2 className="gallery-aside-title">{item.title}</h2>
            <button
              type="button"
              className="gallery-close"
              aria-label={tx('shell.galleryPage.closePreview')}
              onClick={onClose}
            >
              ✕
            </button>
          </div>

          <div className="gallery-aside-catbox">
            <span className="gallery-cat-pill">{item.category}</span>
          </div>

          <p className="gallery-aside-desc">{item.description}</p>

          <p className="gallery-aside-types">
            <span className="muted">适合数据：</span>
            {item.dataTypes.join(' · ')}
          </p>

          {item.diagramKey ? (
            <fieldset className="gallery-theme">
              <legend className="gallery-theme-legend">{tx('shell.galleryPage.diagramTheme')}</legend>
              <div className="gallery-theme-grid">
                {DIAGRAM_THEMES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={theme === t}
                    className={`gallery-theme-btn${theme === t ? ' active' : ''}`}
                    onClick={() => onTheme(t)}
                  >
                    <span className={`gallery-theme-swatch gallery-theme-swatch-${t}`} aria-hidden="true" />
                    <span className="gallery-theme-label">
                      {tx(
                        t === 'mono'
                          ? 'shell.galleryPage.diagramThemeMono'
                          : 'shell.galleryPage.diagramThemeColor',
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="gallery-divider" />

          <dl className="gallery-meta">
            <div className="gallery-meta-row">
              <dt>{tx('shell.galleryPage.source')}</dt>
              <dd>{sourceOf(item)}</dd>
            </div>
            <div className="gallery-meta-row">
              <dt>{tx('shell.galleryPage.library')}</dt>
              <dd>{item.library}</dd>
            </div>
            <div className="gallery-meta-row">
              <dt>{tx('shell.galleryPage.replicated')}</dt>
              <dd>{item.createdAt}</dd>
            </div>
          </dl>

          <div className="gallery-aside-foot">
            <button type="button" className="gallery-use" onClick={onUse}>
              {tx('shell.galleryPage.useAsTemplate')}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function GalleryPage(): JSX.Element {
  const fillPrompt = useApp((s) => s.fillPrompt);
  const [cat, setCat] = useState<string>(ALL);
  /** 「按数据类型」筛选 —— SPSSPRO 式选型：先说手里是什么数据，再看适合什么图 */
  const [dataType, setDataType] = useState<string | null>(null);
  const [theme, setTheme] = useState<DiagramTheme>(DEFAULT_DIAGRAM_THEME);
  const [openId, setOpenId] = useState<string | null>(null);

  /** 应用约定：`new Map([["All", Ot.length]])` + 逐条累加分类计数 */
  const counts = useMemo(() => {
    const m = new Map<string, number>([[ALL, MATHMODEL_GALLERY.length]]);
    for (const g of MATHMODEL_GALLERY) m.set(g.category, (m.get(g.category) ?? 0) + 1);
    return m;
  }, []);

  /** 各数据类型的可选项数（不受当前筛选影响，方便对比取舍） */
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of MATHMODEL_GALLERY) {
      for (const t of g.dataTypes) m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  }, []);

  const items = useMemo(() => {
    let list = cat === ALL ? MATHMODEL_GALLERY : MATHMODEL_GALLERY.filter((g) => g.category === cat);
    if (dataType) list = list.filter((g) => g.dataTypes.includes(dataType));
    return list;
  }, [cat, dataType]);

  const openIdx = openId === null ? -1 : items.findIndex((g) => g.id === openId);
  const openItem = openIdx >= 0 ? (items[openIdx] as GalleryTemplate) : null;

  const step = useCallback(
    (d: number) => {
      setOpenId((prev) => {
        if (prev === null) return prev;
        const i = items.findIndex((g) => g.id === prev);
        if (i < 0) return prev;
        return items[(i + d + items.length) % items.length].id;
      });
    },
    [items],
  );

  const use = useCallback(
    (item: GalleryTemplate) => {
      // 应用约定行为：把绘图提示词填进输入框（流程图按所选主题发 /paper-diagram）
      fillPrompt(templatePrompt(item, theme));
      setOpenId(null);
    },
    [fillPrompt, theme],
  );

  const chips = [ALL, ...GALLERY_CATEGORIES];

  return (
    <PageShell title={tx('shell.galleryPage.title')} description={tx('shell.galleryPage.description')}>
      <div className="gallery-page">
        <div className="gallery-chips">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              className={`gallery-chip${cat === c ? ' active' : ''}`}
              onClick={() => {
                setCat(c);
                setOpenId(null);
              }}
            >
              {c === ALL ? tx('shell.galleryPage.all') : c}
              <span className="gallery-chip-count">{counts.get(c) ?? 0}</span>
            </button>
          ))}
        </div>

        {/* 按数据类型选型（SPSSPRO 式）：先选手里数据长什么样，再看适合的表达方式 */}
        <div className="gallery-chips gallery-chips-types" role="group" aria-label="按数据类型筛选">
          <span className="gallery-types-label">数据类型：</span>
          {DATA_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`gallery-chip gallery-chip-type${dataType === t ? ' active' : ''}`}
              onClick={() => {
                setDataType((prev) => (prev === t ? null : t));
                setOpenId(null);
              }}
            >
              {t}
              <span className="gallery-chip-count">{typeCounts.get(t) ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="gallery-scroll">
          <div className="gallery-grid">
            {items.map((g) => {
              const src = thumbOf(g.image);
              return (
                <button
                  key={g.id}
                  type="button"
                  className="gallery-card"
                  onClick={() => {
                    setTheme(DEFAULT_DIAGRAM_THEME);
                    setOpenId(g.id);
                  }}
                >
                  <div className="gallery-thumb-wrap">
                    <Thumb src={src} alt={g.title} />
                  </div>
                  <div className="gallery-card-body">
                    <div className="gallery-card-head">
                      <span className="gallery-card-title">{g.title}</span>
                      <span className="gallery-cat-pill">{g.category}</span>
                    </div>
                    <span className="gallery-card-desc">{g.description}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {openItem ? (
          <Detail
            item={openItem}
            index={openIdx}
            total={items.length}
            theme={theme}
            onTheme={setTheme}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onClose={() => setOpenId(null)}
            onUse={() => use(openItem)}
          />
        ) : null}
      </div>
    </PageShell>
  );
}
