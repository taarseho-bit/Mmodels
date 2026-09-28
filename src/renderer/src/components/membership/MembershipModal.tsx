import { useEffect, useMemo, useState } from 'react';
import type { AccountStatusInfo } from '@shared/types';
import { t } from '../../i18n';
import { Icon } from '../Icon';
import { PlanCards, type MembershipPlan } from './PlanCards';
import { RedeemBar } from './RedeemBar';

type MembershipTab = 'plans' | 'redeem' | 'points';
const DAY = 86_400_000;
const PURCHASE_URL = String(import.meta.env.VITE_MMODELS_PURCHASE_URL ?? '').trim();

const ENTITLEMENT_ROWS = [
  ['本地项目与编辑', '可用', '可用'],
  ['基础 AI 对话', '每天 10 次，签到再得 10 次', '不限次数'],
  ['单智能体建模', '可用', '可用'],
  ['多智能体协作', '不可用', '可用'],
  ['完整论文生成', '不可用', '可用'],
  ['严格建模与高级图表', '不可用', '可用'],
  ['最终成品导出', '不可用', '可用'],
  ['云端协作与自动化', '不可用', '可用'],
] as const;

function fmtDate(ts: number): string {
  if (!ts) return '—';
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function statusLabel(status: AccountStatusInfo | null): { text: string; vip: boolean } {
  if (!status?.loggedIn) return { text: t('未登录'), vip: false };
  if (status.plan === 'vip') return { text: t(`VIP·到期 ${fmtDate(status.expiresAt)}`), vip: true };
  if ((status.trialDaysLeft ?? 0) > 0) return { text: t(`免费试用·剩 ${status.trialDaysLeft} 天`), vip: false };
  const remaining = status.aiQuota?.remaining;
  return { text: typeof remaining === 'number' ? t(`免费版·今日剩 ${remaining} 次`) : t('免费版'), vip: false };
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
  const [redeemingDays, setRedeemingDays] = useState<number | null>(null);

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
    if (checkingIn || !status?.loggedIn || status.plan === 'vip') return;
    setCheckingIn(true);
    setMessage(null);
    try {
      updateStatus(await window.mathmodel.account.checkin());
      setMessage(t('签到成功，今日额外获得 10 次对话'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('签到失败，请稍后重试'));
    } finally {
      setCheckingIn(false);
    }
  };

  const redeemPoints = async (days: number): Promise<void> => {
    if (redeemingDays !== null || !status?.loggedIn) return;
    setRedeemingDays(days);
    setMessage(null);
    try {
      updateStatus(await window.mathmodel.account.redeemPoints(days));
      setMessage(t(`已用积分兑换 ${days} 天 VIP`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('积分兑换失败，请稍后重试'));
    } finally {
      setRedeemingDays(null);
    }
  };

  const remainingDays = status?.loggedIn ? Math.max(0, Math.floor((status.expiresAt - Date.now()) / DAY)) : 0;
  const checkedIn = Boolean(status?.aiQuota && status.aiQuota.bonus > 0);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal membership-dialog" role="dialog" aria-modal="true" aria-labelledby="membership-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <span id="membership-title" className="modal-title">{t('MModels 会员')}</span>
            <span className={`membership-status-pill${label.vip ? ' vip' : ''}`}>{label.text}</span>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" aria-label={t('关闭')} onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="modal-body">
          <div className="membership-statusbar">
            <strong>{status?.username || t('登录后查看会员权益')}</strong>
            {status?.loggedIn && <span className="muted">{status.plan === 'vip' ? t(`会员剩余 ${remainingDays} 天`) : t('免费账号可使用本地基础功能')}</span>}
            <span className="membership-points">{t(`积分：${status?.points ?? 0}`)}</span>
          </div>

          <div className="membership-tabs" role="tablist" aria-label={t('会员中心')}>
            <button type="button" role="tab" aria-selected={tab === 'plans'} className={tab === 'plans' ? 'active' : ''} onClick={() => setTab('plans')}>{t('会员套餐')}</button>
            <button type="button" role="tab" aria-selected={tab === 'redeem'} className={tab === 'redeem' ? 'active' : ''} onClick={() => setTab('redeem')}>{t('卡密兑换')}</button>
            <button type="button" role="tab" aria-selected={tab === 'points'} className={tab === 'points' ? 'active' : ''} onClick={() => setTab('points')}>{t('积分')}</button>
          </div>

          {tab === 'plans' && <>
            <section className="membership-comparison" aria-labelledby="membership-comparison-title">
              <div className="membership-comparison-head">
                <div>
                  <strong id="membership-comparison-title">{t('免费版与 VIP 权益')}</strong>
                  <span>{t('先用本地基础能力，升级后解锁完整建模流程。')}</span>
                </div>
                <span className="membership-comparison-note">{t('试用期内按 VIP 体验')}</span>
              </div>
              <div className="membership-comparison-table" role="table" aria-label={t('免费版与 VIP 权益对照')}>
                <div className="membership-comparison-row membership-comparison-heading" role="row">
                  <span role="columnheader">{t('功能')}</span>
                  <span role="columnheader">{t('免费版')}</span>
                  <span role="columnheader">{t('VIP')}</span>
                </div>
                {ENTITLEMENT_ROWS.map(([feature, free, vip]) => (
                  <div className="membership-comparison-row" role="row" key={feature}>
                    <span role="cell">{t(feature)}</span>
                    <span role="cell" className={free === '不可用' ? 'is-muted' : ''}>{t(free)}</span>
                    <span role="cell" className="is-vip">{t(vip)}</span>
                  </div>
                ))}
              </div>
            </section>
            <PlanCards selected={selected} onSelect={(plan) => { setSelected(plan.id); setMessage(t(`${plan.title}购卡后将获得对应卡密`)); }} />
            <div className="membership-link-row">
              <button type="button" onClick={() => setTab('redeem')}>{t('已有卡密？立即兑换 ›')}</button>
              <button type="button" onClick={() => setTab('points')}>{t('积分兑换 VIP ›')}</button>
            </div>
            <div className="membership-purchase-row">
              {PURCHASE_URL ? (
                <button type="button" onClick={() => void window.mathmodel.browser.openExternal(PURCHASE_URL)}>{t('前往购买卡密 ›')}</button>
              ) : (
                <span className="muted">{t('购买卡密后，在这里输入卡密即可激活')}</span>
              )}
            </div>
          </>}

          {tab === 'redeem' && <>
            <div style={{ marginTop: 16, fontSize: 12.5, fontWeight: 650 }}>{t('输入卡密激活会员')}</div>
            <RedeemBar onStatusChange={updateStatus} />
          </>}

          {tab === 'points' && <div className="membership-points-panel">
            <div className="membership-points-balance"><span>{t('当前积分')}</span><strong>{status?.points ?? 0}</strong></div>
            <p className="muted">{t('积分可通过注册、完成建模项目和发布论文获得。')}</p>
            <div className="membership-points-options">
              {[{ days: 1, points: 100 }, { days: 7, points: 600 }, { days: 30, points: 2000 }].map((item) => (
                <button
                  type="button"
                  key={item.days}
                  disabled={!status?.loggedIn || (status.points ?? 0) < item.points || redeemingDays !== null}
                  onClick={() => void redeemPoints(item.days)}
                >
                  <strong>{item.days} 天 VIP</strong><span>{item.points} 积分</span>
                </button>
              ))}
            </div>
          </div>}

          <div className="membership-checkin">
            <span aria-hidden>📅</span>
            <span className="membership-checkin-copy">
              <strong>{t('每日签到 · 领 10 次对话')}</strong>
              <small>{status?.plan === 'vip' ? t('VIP 不限次，无需签到') : checkedIn ? t(`已签到，今日剩 ${status?.aiQuota?.remaining ?? 0} 次`) : t('免费账号签到后，当日额外获得 10 次额度')}</small>
            </span>
            <button type="button" className="btn btn-sm btn-primary" disabled={!status?.loggedIn || status.plan === 'vip' || checkingIn || checkedIn} onClick={() => void checkin()}>
              {status?.plan === 'vip' ? t('VIP 不限次') : checkedIn ? t('今日已签到') : checkingIn ? t('签到中…') : t('立即签到')}
            </button>
          </div>
          {message && <div className="membership-modal-message" role="status">{message}</div>}
        </div>
      </div>
    </div>
  );
}
