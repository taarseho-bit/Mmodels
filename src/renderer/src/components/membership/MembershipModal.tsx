/**
 * 会员中心大弹窗（2026-09-28 按用户反馈重设计）
 *
 * 改版要点：
 * - 顶部三张统计卡：积分 / 会员剩余时间 / 可用积分 —— 一眼看清家底
 * - 分段式大 Tab（整行切换）：会员套餐 / 卡密兑换 / 积分说明
 * - 字体整体放大、VIP 列金色高亮，免费版与 VIP 的差距一眼可辨
 * - 签到对任何状态开放：免费号每日获得 100 积分，体验/VIP 账号保留 10 积分奖励
 * - 文案不再用「续费」，统一「卡密兑换 · 时长自动叠加」
 *
 * 打开即渲染：状态来自 App 缓存的账号快照（statusProp），
 * 没有缓存时才发起一次后台刷新，期间骨架照常显示。
 */
import { useEffect, useMemo, useState } from 'react';
import type { AccountStatusInfo } from '@shared/types';
import { t } from '../../i18n';
import { Icon } from '../Icon';
import { PlanCards, type MembershipPlan } from './PlanCards';
import { RedeemBar } from './RedeemBar';
import { SKILL_POINT_CATALOG, type SkillPointGroup } from '@shared/skill-pricing';
import {
  conversationPointsLeft,
  isActiveTrial,
  isPaidVip,
  pointsBalance,
  trialHoursLeft,
} from './membership-ui';

type MembershipTab = 'plans' | 'redeem' | 'points';
const DAY = 86_400_000;
const PURCHASE_URL = String(import.meta.env.VITE_MMODELS_PURCHASE_URL ?? '').trim();
const SUPPORT_CONTACT = String(import.meta.env.VITE_MMODELS_SUPPORT_CONTACT ?? '').trim();
const SUPPORT_URL = String(import.meta.env.VITE_MMODELS_SUPPORT_URL ?? '').trim();

const ENTITLEMENT_ROWS = [
  ['本地项目与编辑', '可用', '可用'],
  ['基础 AI 对话', '每日积分 100 分，签到再得 100 分', '积分不限量'],
  ['单智能体建模', '可用', '可用'],
  ['论文写作与导出 Word/PDF', '可用', '可用'],
  ['高级图表', '可用', '可用'],
  ['多智能体协作', '不可用', '可用'],
  ['AI 全自动模式', '不可用', '可用'],
  ['深度建模', '不可用', '可用'],
  ['云端协作与自动化', '不可用', '可用'],
] as const;

/**
 * 积分说明唯一口径：普通对话 10 分/轮；选择 `#` 技能后只按该技能的
 * 成本扣一次，不把普通档与技能档叠加。技能目录来自共享注册表，和主进程、服务端
 * 使用同一批稳定 id。论文导出不是一个 `#` 技能，因此本身不单独扣分。
 */
const SKILL_GROUP_ORDER: readonly SkillPointGroup[] = [
  '题目与建模',
  '数据与研究',
  '图表与交付',
  '论文与评阅',
  '协作与工具',
];

const SKILL_GROUPS = SKILL_GROUP_ORDER.map((group) => ({
  group,
  entries: SKILL_POINT_CATALOG.filter((entry) => entry.group === group),
}));

const VIP_COST_ROWS = [
  { kind: 'strict', title: '严格建模', cost: '卡密 VIP', detail: '严格模式是付费权益，未兑换卡密时不可执行。', tone: 'vip' },
  { kind: 'collaboration', title: '多智能体协作', cost: '卡密 VIP', detail: '试用窗口不开放；兑换卡密后才能派发协作成员。', tone: 'vip' },
  { kind: 'automation', title: 'AI 全自动与自动化', cost: '卡密 VIP', detail: '自动推进、后台任务和云端协作属于付费权益。', tone: 'vip' },
] as const;

function fmtDate(ts: number): string {
  if (!ts) return '—';
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function statusLabel(status: AccountStatusInfo | null): { text: string; vip: boolean } {
  if (!status?.loggedIn) return { text: t('未登录'), vip: false };
  if (isPaidVip(status)) return { text: t(`VIP · 到期 ${fmtDate(status.expiresAt)}`), vip: true };
  if (isActiveTrial(status)) return { text: t(`24 小时体验 · 剩 ${trialHoursLeft(status)} 小时`), vip: false };
  const points = conversationPointsLeft(status);
  return { text: typeof points === 'number' ? t(`免费版 · 可用 ${points} 积分`) : t('免费版'), vip: false };
}

export interface MembershipModalProps {
  open: boolean;
  onClose: () => void;
  status?: AccountStatusInfo | null;
  initialTab?: MembershipTab;
  onStatusChange?: (status: AccountStatusInfo) => void;
}

export function MembershipModal({
  open,
  onClose,
  status: statusProp,
  initialTab = 'plans',
  onStatusChange,
}: MembershipModalProps): JSX.Element | null {
  const [status, setStatus] = useState<AccountStatusInfo | null>(statusProp ?? null);
  const [tab, setTab] = useState<MembershipTab>(initialTab);
  const [selected, setSelected] = useState<MembershipPlan['id']>('lifetime');
  const [message, setMessage] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);

  useEffect(() => {
    setStatus(statusProp ?? null);
  }, [statusProp]);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setMessage(null);
    if (statusProp !== undefined) return;
    void window.mathmodel.account.status().then((next) => {
      setStatus(next);
      onStatusChange?.(next);
    }).catch((error) => {
      setMessage(error instanceof Error ? error.message : t('读取账号状态失败，请重试'));
    });
  }, [initialTab, onStatusChange, open, statusProp]);

  const label = useMemo(() => statusLabel(status), [status]);
  if (!open) return null;

  const updateStatus = (next: AccountStatusInfo): void => {
    setStatus(next);
    onStatusChange?.(next);
  };

  const checkin = async (): Promise<void> => {
    if (checkingIn || !status?.loggedIn) return;
    setCheckingIn(true);
    setMessage(null);
    // 服务端对「今日已签」返回 alreadyCheckedIn 但 IPC 不透传，
    // 用积分 / 服务端奖励是否增加来区分「刚签成功」和「其实早已签过」。
    const prevPoints = pointsBalance(status);
    const prevBonus = status.aiQuota?.bonus ?? 0;
    try {
      const next = await window.mathmodel.account.checkin();
      updateStatus(next);
      const gained = pointsBalance(next) > prevPoints
        || (next.aiQuota?.bonus ?? 0) > prevBonus
        || (next.checkedIn === true && status.checkedIn !== true);
      if (!gained) {
        setMessage(t('今日已签到，明天再来'));
      } else {
        const reward = isPaidVip(next) || isActiveTrial(next) ? 10 : 100;
        setMessage(t(`签到成功，今日额外获得 ${reward} 积分`));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('签到失败，请稍后重试'));
    } finally {
      setCheckingIn(false);
    }
  };

  // ── 统计卡数据：奖励积分 / 会员时间 / 可用积分 ──
  const vip = isPaidVip(status);
  const trial = isActiveTrial(status);
  const daysLeft = status?.loggedIn
    ? Math.max(0, Math.ceil(((status.expiresAt ?? 0) - Date.now()) / DAY))
    : 0;
  const timeCard = vip
    ? { value: t(`${daysLeft} 天`), label: t('VIP 剩余') }
    : trial
      ? { value: t(`${trialHoursLeft(status)} 小时`), label: t('体验剩余') }
      : { value: t('免费版'), label: t('当前身份') };
  const conversationPoints = conversationPointsLeft(status);
  const quotaCard = vip || trial
    ? { value: t('不限'), label: t('对话积分') }
    : { value: typeof conversationPoints === 'number' ? t(`${conversationPoints} 分`) : '—', label: t('可用积分') };

  const tabs: Array<{ id: MembershipTab; label: string }> = [
    { id: 'plans', label: t('会员套餐') },
    { id: 'redeem', label: t('卡密兑换') },
    { id: 'points', label: t('积分说明') },
  ];

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal membership-dialog" role="dialog" aria-modal="true" aria-labelledby="membership-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <span id="membership-title" className="modal-title">{t('会员中心')}</span>
            <span className={`membership-status-pill${label.vip ? ' vip' : ''}`}>{label.text}</span>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" aria-label={t('关闭')} onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="modal-body">
          {/* ── 统计卡：奖励积分 / 会员时间 / 可用积分 ── */}
          <div className="membership-stats" role="group" aria-label={t('账号概览')}>
            <div className="membership-stat">
              <span className="membership-stat-value is-points">{pointsBalance(status)}</span>
              <span className="membership-stat-label">{t('积分余额')}</span>
            </div>
            <div className="membership-stat">
              <span className="membership-stat-value">{timeCard.value}</span>
              <span className="membership-stat-label">{timeCard.label}</span>
            </div>
            <div className="membership-stat">
              <span className="membership-stat-value">{quotaCard.value}</span>
              <span className="membership-stat-label">{quotaCard.label}</span>
            </div>
          </div>

          {/* ── 分段式大 Tab：整行切换 ── */}
          <div className="membership-segtabs" role="tablist" aria-label={t('会员中心')}>
            {tabs.map((item) => (
              <button
                type="button"
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                className={tab === item.id ? 'active' : ''}
                onClick={() => { setTab(item.id); setMessage(null); }}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'plans' && <>
            <section className="membership-comparison" aria-labelledby="membership-comparison-title">
              <div className="membership-comparison-head">
                <div>
                  <strong id="membership-comparison-title">{t('免费版与 VIP 权益')}</strong>
                  <span>{t('先用本地基础能力，升级后解锁完整建模流程。')}</span>
                </div>
                  <span className="membership-comparison-note">{trial ? t('24 小时体验中 · 多智能体、云协作和自动化需卡密 VIP') : t('基础能力永久免费 · 高级能力卡密解锁')}</span>
              </div>
              <div className="membership-comparison-table" role="table" aria-label={t('免费版与 VIP 权益对照')}>
                <div className="membership-comparison-row membership-comparison-heading" role="row">
                  <span role="columnheader">{t('功能')}</span>
                  <span role="columnheader">{t('免费版')}</span>
                  <span role="columnheader" className="vip-col-head">{t('VIP')}</span>
                </div>
                {ENTITLEMENT_ROWS.map(([feature, free, vipText]) => (
                  <div className="membership-comparison-row" role="row" key={feature}>
                    <span role="cell">{t(feature)}</span>
                    <span role="cell" className={free === '不可用' ? 'is-muted' : ''}>{t(free)}</span>
                    <span role="cell" className="is-vip">{t(vipText)}</span>
                  </div>
                ))}
              </div>
            </section>
            {trial && (
              <div className="membership-trial-note" role="note">
                <Icon name="clock-3" size={14} />
                <span><strong>{t('你正在体验 24 小时完整基础流程')}</strong><small>{t('可以完成一篇基础论文和完整基础建模；多智能体、云协作和自动化需要卡密 VIP。')}</small></span>
              </div>
            )}
            <PlanCards selected={selected} onSelect={(plan) => {
              setSelected(plan.id);
              setTab('redeem');
              setMessage(t(`已选择「${plan.title}」（${plan.period}），请输入对应卡密激活`));
            }} />
            <div className="membership-link-row">
              <button type="button" onClick={() => setTab('redeem')}>{t('已有卡密？立即兑换 ›')}</button>
              <button type="button" onClick={() => setTab('points')}>{t('查看积分规则 ›')}</button>
            </div>
            <div className="membership-purchase-row">
              {PURCHASE_URL ? (
                <button type="button" onClick={() => void window.mathmodel.browser.openExternal(PURCHASE_URL)}>{t('查看卡密购买说明 ›')}</button>
              ) : <span className="muted">{t('卡密购买请联系管理员，收到卡密后在“卡密兑换”中激活。')}</span>}
              {(SUPPORT_URL || SUPPORT_CONTACT) && (
                SUPPORT_URL
                  ? <button type="button" onClick={() => void window.mathmodel.browser.openExternal(SUPPORT_URL)}>{t('联系管理员 ›')}</button>
                  : <span className="muted">{t(`联系方式：${SUPPORT_CONTACT}`)}</span>
              )}
            </div>
          </>}

          {tab === 'redeem' && <>
            <div style={{ marginTop: 16, fontSize: 13.5, fontWeight: 650 }}>{t('输入卡密激活 VIP（时长自动叠加）')}</div>
            <div className="membership-redeem-note">{t('卡密是当前版本唯一的 VIP 激活方式；没有卡密也可以继续使用本地项目和基础论文流程。')}</div>
            <RedeemBar onStatusChange={updateStatus} />
          </>}

          {tab === 'points' && <div className="membership-points-panel">
            <div className="membership-points-hero">
              <div className="membership-points-hero-copy">
                <span className="membership-section-kicker">{t('积分账本')}</span>
                <strong>{t('普通对话与 # 技能，成本清清楚楚')}</strong>
                <small>{t('不带 # 的普通对话每轮 10 分；选中某个 # 技能后，按该技能标注的积分扣一次。')}</small>
              </div>
              <div className="membership-points-hero-balance">
                <span>{t('当前可用')}</span>
                <strong>{pointsBalance(status)}</strong>
                <small>{t('积分')}</small>
              </div>
            </div>

            <div className="membership-points-guide" role="note">
              <Icon name="info" size={15} />
              <span>{t('一次发送只收一项费用，不会把普通档和技能档叠加。论文导出不是 # 技能，本身不单独扣分；成功导出奖励是否发放由服务端按资格审核。余额不足或网络失败不会扣分。')}</span>
            </div>

            <section className="membership-points-section" aria-labelledby="points-cost-title">
              <div className="membership-points-section-head">
                <div>
                  <h3 id="points-cost-title">{t('每项功能消耗多少')}</h3>
                  <span>{t('输入 # 可以从同一份目录选择技能；这里的价格与实际服务端扣分保持一致。论文导出不属于技能，放在下方奖励区说明。')}</span>
                </div>
                <span className="membership-points-legend"><i className="is-cost" />{t('技能回合')} <i className="is-vip" />{t('卡密 VIP')}</span>
              </div>
              <div className="membership-points-cost-grid">
                <div className="membership-points-cost-card is-basic membership-points-basic-card">
                  <div className="membership-points-cost-top">
                    <span className="membership-points-cost-title">{t('普通对话（不带 #）')}</span>
                    <strong>{t('10 积分 / 轮')}</strong>
                  </div>
                  <p>{t('解释概念、拆解题目、追问修改等没有选择技能的普通消息；免费账号按发送成功的一轮扣除。')}</p>
                </div>
                {SKILL_GROUPS.map(({ group, entries }) => (
                  <div className="membership-points-skill-group" key={group}>
                    <div className="membership-points-skill-group-head">
                      <strong>{t(group)}</strong>
                      <span>{t(`${entries.length} 项技能`)}</span>
                    </div>
                    <div className="membership-points-skill-grid">
                      {entries.map((entry) => (
                        <div className="membership-points-cost-card is-skill" key={entry.id} data-skill-id={entry.id}>
                          <div className="membership-points-cost-top">
                            <span className="membership-points-cost-title">{t(entry.label)}</span>
                            <strong>{t(`${entry.cost} 积分`)}</strong>
                          </div>
                          <p>{t(entry.description)}</p>
                          <small className="membership-points-skill-id">#{entry.id}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="membership-points-skill-group membership-points-vip-group">
                  <div className="membership-points-skill-group-head">
                    <strong>{t('不以积分计费的卡密 VIP 能力')}</strong>
                    <span>{t('直接锁定')}</span>
                  </div>
                  <div className="membership-points-skill-grid">
                    {VIP_COST_ROWS.map((row) => (
                      <div className={`membership-points-cost-card is-${row.tone}`} key={row.kind}>
                        <div className="membership-points-cost-top">
                          <span className="membership-points-cost-title">{t(row.title)}</span>
                          <strong>{t(row.cost)}</strong>
                        </div>
                        <p>{t(row.detail)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="membership-points-section membership-points-earn" aria-labelledby="points-earn-title">
              <div className="membership-points-section-head">
                <div>
                  <h3 id="points-earn-title">{t('如何获得积分')}</h3>
                  <span>{t('奖励在服务端确认后入账，重复事件不会重复发放。')}</span>
                </div>
                <span className="membership-points-earn-badge">{t('奖励')}</span>
              </div>
              <div className="membership-points-earn-grid">
                <div><span>{t('注册账号')}</span><b>+50</b><small>{t('一次')}</small></div>
                <div><span>{t('完成首次有效建模')}</span><b>+30</b><small>{t('一次')}</small></div>
                <div><span>{t('论文导出奖励（不是扣费）')}</span><b>+20</b><small>{t('符合资格时每篇一次')}</small></div>
                <div><span>{t('有效反馈审核通过')}</span><b>+100</b><small>{t('首次有效反馈')}</small></div>
                <div><span>{t('邀请好友完成首次有效使用')}</span><b>+50</b><small>{t('每日最多 3 次')}</small></div>
                <div><span>{t('免费账号每日签到')}</span><b>+100</b><small>{t('每日一次')}</small></div>
              </div>
            </section>

            <div className="membership-points-cta" role="note">
              <div>
                <strong>{t('想直接使用，不想计算积分？')}</strong>
                <span>{t('卡密 VIP 解锁多智能体、严格建模、AI 全自动、高级图表与最终交付；积分不会兑换会员。')}</span>
              </div>
              {SUPPORT_URL ? (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => void window.mathmodel.browser.openExternal(SUPPORT_URL)}>{t('联系管理员购买卡密')}</button>
              ) : SUPPORT_CONTACT ? (
                <span className="membership-points-contact">{t(`联系方式：${SUPPORT_CONTACT}`)}</span>
              ) : (
                <span className="membership-points-contact">{t('收到卡密后，在“卡密兑换”中激活')}</span>
              )}
            </div>
          </div>}

          <div className="membership-checkin">
            <span aria-hidden>📅</span>
            <span className="membership-checkin-copy">
              <strong>{t('每日签到 · 人人可签')}</strong>
              <small>
                {!status?.loggedIn
                  ? t('登录后每日签到可领奖励')
                  : vip
                    ? t('VIP 签到每日得 10 积分，留作会员到期后的基础对话')
                    : trial
                      ? t('体验期间签到每日得 10 积分，留作体验结束后的基础对话')
                      : t('免费账号签到后，当日额外获得 100 对话积分')}
              </small>
            </span>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!status?.loggedIn || checkingIn || status.checkedIn === true}
              onClick={() => void checkin()}
            >
              {!status?.loggedIn
                ? t('请先登录')
                : status.checkedIn === true
                  ? t('今日已签到')
                  : checkingIn
                    ? t('签到中…')
                    : t('立即签到')}
            </button>
          </div>
          {message && <div className="membership-modal-message" role="status">{message}</div>}
        </div>
      </div>
    </div>
  );
}
