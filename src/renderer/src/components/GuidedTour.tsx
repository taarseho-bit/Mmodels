/**
 * 引导巡览 —— 复刻原版 `MotionOnboarding` 的聚光灯引导（`onboarding.tour.*`）。
 *
 * 实现方式：**用 CSS 遮罩 + 高亮框**而不是画四个遮罩块 ——
 * 前者只需一个覆盖全屏的半透明层，再用 `box-shadow: 0 0 0 9999px` 挖出洞，
 * 目标元素能被真实点击（原版教程要求用户「点一下高亮的按钮」）。
 *
 * 定位策略：每步给一组**候选选择器**，取第一个能匹配到的元素。
 * 找不到就跳过该步（自动前进），而不是卡死或指向空气。
 * 原版也是这个思路（教程依赖真实界面元素存在）。
 *
 * ── 多套教程（对应原版「新手教程」页的 7 张卡）──
 * 原版每张卡跑的是**一段独立的短教程**，不是同一条完整导览。这里用
 * `TOURS` 把步骤分成 7 组：
 *   - `quickStart` → `onboarding.tour.steps.*`（11 步，原有那条完整导览）
 *   - 其余 6 组 → `onboarding.guided.<tour>.steps.*`（原版短教程的同名键）
 * 每组步骤数与原版卡片上标的「· n 步」严格一致。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TourId } from '@shared/types';
import { tx } from '../i18n';
import { openRoute, type AppRoute } from '../lib/settings-nav';

interface TourStep {
  /** 稳定 id（也是 i18n 键的一部分） */
  id: string;
  /** 候选选择器，按优先级排列 */
  selectors: string[];
  /** 气泡相对目标的位置 */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** 点击目标后自动前进（原版教程的「点一下」交互） */
  autoAdvanceOnClick?: boolean;
  /** 切到该路由（保证目标存在） */
  route?: string;
  /** i18n 键前缀，默认 `onboarding.tour.steps.<id>`；短教程用 `onboarding.guided.*` */
  i18nBase?: string;
  /**
   * 该步要求先跳到别的页面/打开某个面板（短教程「带到对应功能」用）。
   * 优先于 `route`：openRoute 会同时切路由并展开面板。
   */
  go?: { route: AppRoute; panel?: string };
}

/** 步骤定义：id 与 `onboarding.tour.steps.<id>.*` 对应（2026-09-25 版：15 步覆盖新版功能） */
const STEPS: TourStep[] = [
  {
    id: 'settings',
    selectors: ['.rail-item[data-route="settings"]'],
    placement: 'bottom',
    route: 'chat',
  },
  {
    id: 'providers',
    selectors: ['#tour-providers', '.rail-item[data-route="settings"]'],
    placement: 'bottom',
    route: 'settings',
  },
  {
    id: 'projects',
    selectors: ['#tour-projects', '.sidebar-new'],
    placement: 'right',
    route: 'chat',
  },
  {
    id: 'newThread',
    selectors: ['#tour-new-thread', '.sidebar-new'],
    placement: 'right',
    route: 'chat',
  },
  {
    id: 'composer',
    selectors: ['#tour-composer', '.composer-input textarea', 'textarea'],
    placement: 'top',
    route: 'chat',
  },
  {
    id: 'plus',
    selectors: ['#tour-plus', '.composer-plus'],
    placement: 'top',
    route: 'chat',
  },
  {
    // 决策模式 chip（先规划 / 精细人工 / AI 自动）—— 2026-09-20 新增的正交维度
    id: 'decisionModes',
    selectors: ['.cz-bar [title^="选择 AI 的决策方式"]', '.cz-bar'],
    placement: 'top',
    route: 'chat',
  },
  {
    // 检查强度 chip（快速 / 标准 / 严格交付）—— 2026-09-25 用户点名要的对话区入口
    id: 'quality',
    selectors: ['.cz-foot [title^="检查强度"]', '.cz-foot'],
    placement: 'top',
    route: 'chat',
  },
  {
    // 模型切换已收进输入框底部栏：点一下列出所有已配置供应商的全部模型
    id: 'model',
    selectors: ['.cz-foot [title="请选择模型"]', '.topbar-model', '.badge'],
    placement: 'top',
    route: 'chat',
  },
  {
    id: 'examples',
    selectors: ['#tour-examples', '.starter'],
    placement: 'bottom',
    route: 'chat',
  },
  {
    // 数据与图表工作室（推荐图表 + 当前项目数据，SPSSPRO 式选型）
    id: 'dataStudio',
    selectors: ['.data-chart-studio', '.data-chart-head'],
    placement: 'left',
    go: { route: 'datasets' },
  },
  {
    id: 'environment',
    selectors: ['#tour-environment', '.settings-env'],
    placement: 'left',
    route: 'settings',
  },
  {
    id: 'communitySkills',
    // 社区 Skills 入口在侧栏「扩展」页（原版右栏没有 skills 标签，此处不再指向右栏）
    selectors: ['.rail-item[data-route="extensions"]'],
    placement: 'right',
    route: 'chat',
  },
  {
    // 协作开关现在住在输入框底部栏（2026-09-20 从选项菜单拎出来）
    id: 'collaboration',
    selectors: ['.cz-foot [aria-label="多智能体协作"]', '#tour-collab', '.topbar-actions > button.topbar-action'],
    placement: 'top',
    route: 'chat',
  },
  {
    // 比赛工作台的交付检查 —— 提交前的最后一道关
    id: 'deliveryCheck',
    selectors: ['.studio-delivery-panel', '.studio-readiness'],
    placement: 'left',
    route: 'workbench',
  },
];

/**
 * 6 段短教程的步骤。
 *
 * 选择器优先用本复刻里**真实存在**的锚点，找不到就靠 GuidedTour 的
 * 「跳过找不到的步骤」机制优雅降级 —— 不写空洞的 #id（那些永远不会命中，
 * 会让用户觉得教程坏了）。
 */
const GUIDED: Record<Exclude<TourId, 'quickStart'>, TourStep[]> = {
  modes: [
    {
      id: 'trigger',
      i18nBase: 'onboarding.guided.modes.steps.trigger',
      // 模式下拉在 Composer 顶部栏 `.cz-bar` 的第 2 个槽（第 1 个是项目、第 3 个是模板）
      selectors: ['.cz-bar > .cz-slot:nth-of-type(2)', '.cz-bar', '#tour-composer'],
      placement: 'top',
      route: 'chat',
    },
    {
      id: 'options',
      i18nBase: 'onboarding.guided.modes.steps.options',
      // 下拉展开后是 `.cz-pop-item`；未展开时退化到整条顶部栏
      selectors: ['.cz-bar > .cz-slot:nth-of-type(2) .cz-pop-item', '.cz-bar', '#tour-composer'],
      placement: 'top',
      route: 'chat',
    },
    {
      id: 'selected',
      i18nBase: 'onboarding.guided.modes.steps.selected',
      selectors: ['#tour-composer', '.cz-bar'],
      placement: 'top',
      route: 'chat',
    },
  ],
  templates: [
    {
      id: 'library',
      i18nBase: 'onboarding.guided.templates.steps.library',
      // 论文模板在「扩展 → 模板」tab（.ext-nav 的第 2 个按钮，见 ExtensionsPage 的 SECTIONS）
      selectors: ['.ext-nav button:nth-of-type(2)', '.ext-nav'],
      placement: 'right',
      go: { route: 'extensions' },
    },
    {
      id: 'detail',
      i18nBase: 'onboarding.guided.templates.steps.detail',
      selectors: ['.ext-list-body', '.ext-list'],
      placement: 'right',
      go: { route: 'extensions' },
    },
    {
      id: 'actions',
      i18nBase: 'onboarding.guided.templates.steps.actions',
      selectors: ['.ext-detail button', '.ext-detail'],
      placement: 'left',
      go: { route: 'extensions' },
    },
    {
      id: 'composer',
      i18nBase: 'onboarding.guided.templates.steps.composer',
      // 模板落在顶部栏第 3 个槽（1 项目 / 2 模式 / 3 模板）
      selectors: ['.cz-bar > .cz-slot:nth-of-type(3)', '.cz-bar', '#tour-composer'],
      placement: 'top',
      route: 'chat',
    },
  ],
  gallery: [
    {
      id: 'template',
      i18nBase: 'onboarding.guided.gallery.steps.template',
      selectors: ['.gallery-grid .gallery-card', '.gallery-grid', '.gallery-page'],
      placement: 'bottom',
      go: { route: 'gallery' },
    },
    {
      id: 'preview',
      i18nBase: 'onboarding.guided.gallery.steps.preview',
      selectors: ['.gallery-aside', '.gallery-dialog', '.gallery-page'],
      placement: 'left',
      go: { route: 'gallery' },
    },
    {
      id: 'use',
      i18nBase: 'onboarding.guided.gallery.steps.use',
      selectors: ['.gallery-use', '.gallery-aside-foot', '.gallery-page'],
      placement: 'left',
      go: { route: 'gallery' },
    },
    {
      id: 'composer',
      i18nBase: 'onboarding.guided.gallery.steps.composer',
      selectors: ['#tour-composer', '.cz-bar'],
      placement: 'top',
      route: 'chat',
    },
  ],
  skills: [
    {
      id: 'library',
      i18nBase: 'onboarding.guided.skills.steps.library',
      selectors: ['.ext-list-body', '.ext-list', '.rail-item[data-route="extensions"]'],
      placement: 'right',
      go: { route: 'extensions' },
    },
    {
      id: 'detail',
      i18nBase: 'onboarding.guided.skills.steps.detail',
      selectors: ['.ext-detail', '.ext-list-body'],
      placement: 'left',
      go: { route: 'extensions' },
    },
  ],
  collaboration: [
    {
      id: 'entry',
      i18nBase: 'onboarding.guided.collaboration.steps.entry',
      selectors: ['.topbar-actions > button.topbar-action'],
      placement: 'bottom',
      route: 'chat',
    },
    {
      id: 'panel',
      i18nBase: 'onboarding.guided.collaboration.steps.panel',
      // 这一步要求用户先点了上一步高亮的按钮（面板才会出现）。
      // 没点开就没有目标 → 自动跳过，而不是指向一个不存在的东西。
      selectors: ['.collab-modal'],
      placement: 'bottom',
      route: 'chat',
    },
  ],
  paperSharing: [
    {
      id: 'entry',
      i18nBase: 'onboarding.guided.paperSharing.steps.entry',
      selectors: ['.topbar-actions > button.topbar-action:nth-of-type(2)'],
      placement: 'bottom',
      route: 'chat',
    },
    {
      id: 'overview',
      i18nBase: 'onboarding.guided.paperSharing.steps.overview',
      selectors: ['.sq-grid', '.sq-page'],
      placement: 'bottom',
      go: { route: 'papers' },
    },
    {
      id: 'dialog',
      i18nBase: 'onboarding.guided.paperSharing.steps.dialog',
      selectors: ['.paper-share-dialog', '.share-dialog', '.sq-page'],
      placement: 'bottom',
      go: { route: 'papers' },
    },
  ],
};

/** 教程 id —— 与设置页「新手教程」7 张卡一一对应（定义在 shared，见其注释） */
export type { TourId };

/** 取某套教程的步骤列表 */
export function stepsForTour(tourId?: TourId): TourStep[] {
  if (!tourId || tourId === 'quickStart') return STEPS;
  return GUIDED[tourId] ?? STEPS;
}

/** 每步的 i18n 键前缀 */
function i18nBaseOf(step: TourStep): string {
  return step.i18nBase ?? `onboarding.tour.steps.${step.id}`;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function findTarget(selectors: string[]): { el: HTMLElement; sel: string } | null {
  for (const sel of selectors) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el && el.offsetParent !== null) return { el, sel };
  }
  return null;
}

export function GuidedTour({
  tourId,
  startAt,
  onClose,
  onNavigate,
}: {
  /** 跑哪一段教程（设置页「新手教程」7 张卡各对应一个），省略 = 完整导览 */
  tourId?: TourId;
  /** 从第几步开始（0 基）。给「从某一步重看」留的口子 */
  startAt?: number;
  onClose: () => void;
  /** 需要切换路由时调用（由 App 传入 setRoute） */
  onNavigate?: (route: string) => void;
}): JSX.Element | null {
  const steps = useMemo(() => stepsForTour(tourId), [tourId]);
  const [index, setIndex] = useState(() =>
    startAt && startAt > 0 && startAt < steps.length ? startAt : 0,
  );
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const step = steps[index];

  /** 跳过找不到目标的步骤 */
  const advanceToUsable = useCallback(
    (from: number, dir: 1 | -1): number | null => {
      let i = from;
      while (i >= 0 && i < steps.length) {
        if (findTarget(steps[i].selectors)) return i;
        i += dir;
      }
      return null;
    },
    [steps],
  );

  // 切路由（若该步需要）→ 等一帧 → 定位
  useEffect(() => {
    if (!step) return;
    setReady(false);
    // 短教程优先走 openRoute（能同时切页面并展开面板）；
    // 完整导览沿用原来的 onNavigate 回调。
    if (step.go) openRoute(step.go.route, step.go.panel);
    else if (step.route && onNavigate) onNavigate(step.route);
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      const hit = findTarget(step.selectors);
      if (!hit) {
        // 目标不存在 → 自动跳过
        const next = advanceToUsable(index + 1, 1);
        if (next === null) onClose();
        else setIndex(next);
        return;
      }
      const r = hit.el.getBoundingClientRect();
      const pad = 6;
      setBox({
        top: r.top - pad,
        left: r.left - pad,
        width: r.width + pad * 2,
        height: r.height + pad * 2,
      });
      setReady(true);
      hit.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [index, step, onNavigate, onClose, advanceToUsable]);

  // 窗口尺寸变化时重算
  useLayoutEffect(() => {
    if (!step) return;
    const onResize = (): void => {
      const hit = findTarget(step.selectors);
      if (!hit) return;
      const r = hit.el.getBoundingClientRect();
      setBox({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [step]);

  // Esc 退出
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const next = (): void => {
    const n = advanceToUsable(index + 1, 1);
    if (n === null) onClose();
    else setIndex(n);
  };

  const prev = (): void => {
    const p = advanceToUsable(index - 1, -1);
    if (p === null) return;
    setIndex(p);
  };

  if (!step) return null;

  // 气泡位置：默认在目标下方，空间不够就翻到上方
  const bubbleStyle = (): React.CSSProperties => {
    if (!box) return { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' };
    const W = 320;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const place = step.placement ?? 'bottom';
    const gap = 14;

    let top: number;
    let left = Math.min(Math.max(box.left + box.width / 2 - W / 2, 12), vw - W - 12);

    if (place === 'top' || (place === 'bottom' && box.top + box.height + 180 > vh)) {
      top = Math.max(12, box.top - gap - 170);
    } else if (place === 'right') {
      top = box.top;
      left = Math.min(box.left + box.width + gap, vw - W - 12);
    } else if (place === 'left') {
      top = box.top;
      left = Math.max(12, box.left - W - gap);
    } else {
      top = box.top + box.height + gap;
    }
    return { top, left, width: W };
  };

  const title = tx(`${i18nBaseOf(step)}.title`);
  const rawDesc = tx(`${i18nBaseOf(step)}.description`);
  // 原版这几条描述里带 <b> 标签；这里只取纯文本，避免注入
  const desc = rawDesc.replace(/<\/?b>/g, '');

  return (
    <div className="tour-root" ref={wrapRef} role="dialog" aria-label={title}>
      {/* 聚光灯：整屏压暗，用超大 box-shadow 在目标处挖洞 */}
      {box ? (
        <div
          className="tour-hole"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        />
      ) : (
        <div className="tour-dim" />
      )}

      {/* 气泡 */}
      <div className={`tour-bubble${ready ? ' in' : ''}`} style={bubbleStyle()}>
        <div className="tour-step">
          {index + 1} / {steps.length}
        </div>
        <div className="tour-title">{title}</div>
        <div className="tour-desc">{desc}</div>
        <div className="tour-foot">
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            {tx('common.close')}
          </button>
          <div className="grow" />
          <button className="btn btn-sm" disabled={index === 0} onClick={prev}>
            {tx('onboarding.tour.prev')}
          </button>
          {index === steps.length - 1 ? (
            <button className="btn btn-sm btn-primary" onClick={onClose}>
              {tx('onboarding.tour.done')}
            </button>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={next}>
              {tx('onboarding.tour.next')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 供外部判断是否还有可展示的步骤 */
export function tourStepCount(tourId?: TourId): number {
  return stepsForTour(tourId).length;
}
