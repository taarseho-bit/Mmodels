/**
 * 设置页 ⑬ 新手教程
 *
 * 项目契约（`onboarding.tutorialCenter.*`）：介绍段 + 「已完成 n / 7」进度 + 7 张教程卡
 * 两列网格，每卡：图标、标题、描述、时长步数、右侧「开始教程 / 重新学习」。
 *
 * 当前实现原先只有 1 张「界面巡览」卡（对应 quickStart）。本文件按项目契约重建 7 卡网格。
 *
 * 每张卡跑的是**自己那一段短教程**（`requestTour(id)` → GuidedTour 按 tourId 选步骤），
 * 不再一律跑 11 步完整导览。
 *
 * 完成态两条来源：
 *  - `quickStart`：`settings.tourDone`（完整导览看过就置位）
 *  - 其余 6 张：localStorage `mm-tour-done`。启动时把「这次开的哪张卡 +
 *    当时的 tourFinished 计数」记进 `mm-tour-pending`，等 `tourFinished` 超过
 *    记录值（= 这段巡览真的被关掉了）才结算，避免「刚点开、教程自己跳回设置页
 *    就被误记成已完成」。
 */
import { useCallback, useEffect, useState } from 'react';
import type { TourId } from '@shared/types';
import { useApp } from '../../store/app';
import { tx, t } from '../../i18n';
import { Icon } from '../Icon';
import { Section } from './shared';

/** 已完成的短教程 id 列表 */
const DONE_KEY = 'mm-tour-done';
/** 「刚启动了哪张卡」+ 当时的巡览计数 —— 巡览关闭后据此标记完成 */
const PENDING_KEY = 'mm-tour-pending';

interface TourCard {
  id: TourId;
  icon: string;
  /** 项目契约标记「建议先看」的卡（运行测试为第一张） */
  recommended?: boolean;
  /** 内容涉及云端分享 → 按既定决策排除，保留骨架 + 置灰 */
  disabled?: boolean;
}

/** 顺序与界面样例一致（图标名取自 icons/lucide-data.ts，见 hasIcon 断言） */
const CARDS: TourCard[] = [
  { id: 'quickStart', icon: 'zap', recommended: true },
  { id: 'modes', icon: 'boxes' },
  { id: 'templates', icon: 'file-text' },
  { id: 'gallery', icon: 'image' },
  { id: 'skills', icon: 'sparkles' },
  { id: 'collaboration', icon: 'users' },
  { id: 'paperSharing', icon: 'globe', disabled: true },
];

/** 当前启动的这张卡 + 启动时刻的 tourFinished */
interface Pending {
  id: string;
  at: number;
}

function loadDone(): Set<string> {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveDone(ids: Set<string>): void {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...ids]));
  } catch {
    /* 忽略写入失败 */
  }
}

function readPending(): Pending | null {
  try {
    const v = localStorage.getItem(PENDING_KEY);
    if (!v) return null;
    const parsed = JSON.parse(v) as Partial<Pending>;
    if (typeof parsed.id !== 'string') return null;
    return { id: parsed.id, at: typeof parsed.at === 'number' ? parsed.at : 0 };
  } catch {
    return null;
  }
}

function clearPending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* 忽略写入失败 */
  }
}

export function TourSection(): JSX.Element {
  const requestTour = useApp((s) => s.requestTour);
  const settings = useApp((s) => s.settings);
  const tourFinished = useApp((s) => s.tourFinished);
  const tourDone = settings?.tourDone;
  const [done, setDone] = useState<Set<string>>(() => loadDone());

  /**
   * 结算：点开某张卡时把 `{id, at: tourFinished}` 存进 pending；
   * 等 `tourFinished` 超过 `at`（= 这段巡览真的被关掉了）才把卡标成已完成。
   *
   * 为什么不用 tourDone：tourDone 属于完整导览，短教程不该污染它；
   * 而且短教程会把用户带到别的页面，回来时 TourSection 是**重新挂载**的，
   * 光靠 effect 依赖变化会漏。挂载时也跑一次，所以从别处回来照样能结算。
   */
  useEffect(() => {
    const p = readPending();
    if (!p) return;
    if (tourFinished <= p.at) return; // 这段还没结束（或压根没起来）
    if (!CARDS.some((c) => c.id === p.id)) {
      clearPending();
      return;
    }
    clearPending();
    const cur = loadDone();
    if (cur.has(p.id)) return;
    cur.add(p.id);
    saveDone(cur);
    setDone(cur);
  }, [tourFinished, settings]);

  const isCardDone = useCallback(
    (id: TourId): boolean => (id === 'quickStart' ? done.has('quickStart') || !!tourDone : done.has(id)),
    [done, tourDone],
  );
  const completed = CARDS.filter((c) => isCardDone(c.id)).length;

  const start = useCallback(
    (id: TourId) => {
      // 记下「开的是哪张卡」+ 当前巡览计数，供上面的 effect 结算
      const payload: Pending = { id, at: tourFinished };
      try {
        localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
      } catch {
        /* 忽略写入失败 */
      }
      // 每张卡跑自己那一段短教程（GuidedTour 按 tourId 选步骤）
      requestTour(id);
    },
    [requestTour, tourFinished],
  );

  return (
    <Section title={t('新手教程')} hint={tx('onboarding.tutorialCenter.description')}>
      <div className="row tour-progress" style={{ gap: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {tx('onboarding.tutorialCenter.progress', { completed, total: CARDS.length })}
        </span>
      </div>

      <div className="tour-route" aria-label="新版数学建模使用路线">
        <div className="tour-route-title"><Icon name="workflow" size={15} /> <strong>新版数学建模使用路线</strong><span className="muted">从题目到交付，一条线走完</span></div>
        <div className="tour-route-steps">
          {[
            ['01', '新建项目', '每个项目独立保存一套比赛信息和资料'],
            ['02', '录入比赛信息', '选择赛事和模板，系统自动记住页数与截止时间'],
            ['03', '导入题目与数据', '拖入 PDF、表格或数据文件，先让助手读懂材料'],
            ['04', '拆题与建模', '需要时打开协作，让不同成员负责数据、模型和验证'],
            ['05', '图表与论文', '从数据与图表选择合适参考，再生成中文论文图表'],
            ['06', '提交前检查', '检查复算、页数、引用、图表和最终文件'],
          ].map(([no, title, desc]) => <div className="tour-route-step" key={no}><b>{no}</b><strong>{title}</strong><span>{desc}</span></div>)}
        </div>
      </div>

      <div className="tour-grid">
        {CARDS.map((c) => {
          const isDone = isCardDone(c.id);
          return (
            <div className={`panel col tour-card${isDone ? ' is-done' : ''}`} key={c.id}>
              <div className="row tour-card-head" style={{ gap: 8 }}>
                <span className="tour-card-icon">
                  <Icon name={c.icon} size={16} />
                </span>
                <span className="tour-card-title">{tx(`onboarding.tutorialCenter.items.${c.id}.title`)}</span>
                {c.recommended && !isDone ? (
                  <span className="badge badge-accent">{tx('onboarding.tutorialCenter.recommended')}</span>
                ) : null}
                {isDone ? (
                  <span className="badge badge-success">✓ {tx('onboarding.tutorialCenter.completed')}</span>
                ) : null}
              </div>

              <p className="tour-card-desc">{tx(`onboarding.tutorialCenter.items.${c.id}.description`)}</p>

              <div className="row tour-card-foot" style={{ gap: 10 }}>
                <span className="muted tour-card-duration">
                  {tx(`onboarding.tutorialCenter.items.${c.id}.duration`)}
                </span>
                <div className="grow" />
                <button
                  className="btn btn-sm"
                  disabled={c.disabled}
                  title={c.disabled ? t('当前版本不提供云端分享，教程暂不可用') : undefined}
                  onClick={() => start(c.id)}
                >
                  {isDone ? tx('onboarding.tutorialCenter.replay') : tx('onboarding.tutorialCenter.start')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
