/**
 * 左下角头像快捷弹层（2026-09-28 用户点名改版）
 *
 * 点击头像先弹一个「短的」浮层，而不是整个会员大弹窗：
 *   - 顶部：签到栏（所有账号每日获得对话积分）
 *   - 菜单：会员中心 / 卡密兑换 / 积分说明 / 反馈中心 / 邀请好友 / 设置
 *   - 底部：退出登录
 *
 * 数据用 Sidebar 已缓存的账号快照渲染（点击瞬间出内容，不再「读取中」），
 * 签到 / 反馈成功后通过事件总线广播，左下角芯片与会员弹窗都会实时跟上。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AccountStatusInfo } from '@shared/types';
import { t } from '../../i18n';
import { Icon } from '../Icon';
import { openMembership, notifyAccountStatus } from '../../lib/membership-nav';
import { conversationPointsLeft, isActiveTrial, isPaidVip, pointsBalance, trialHoursLeft } from './membership-ui';

const DAY = 86_400_000;

export function AccountQuickMenu({
  open,
  onClose,
  account,
  onOpenSettings,
}: {
  open: boolean;
  onClose: () => void;
  /** Sidebar 缓存的账号快照；null 视为未登录。 */
  account: AccountStatusInfo | null;
  onOpenSettings: () => void;
}): JSX.Element | null {
  const [checkingIn, setCheckingIn] = useState(false);
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState<'none' | 'feedback' | 'invite'>('none');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** 弹层位置：跟随左下角账号芯片，fixed 定位后不受侧栏裁剪。 */
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null);
  /** 邀请弹层要在打开瞬间自动复制，用 ref 读取最新快照避免重复触发。 */
  const accountRef = useRef(account);
  accountRef.current = account;

  useEffect(() => {
    if (!open) { setToast(''); setDialog('none'); setPosition(null); return; }
    const place = (): void => {
      const anchor = document.querySelector('.rail-account');
      const rect = anchor?.getBoundingClientRect();
      const width = Math.min(272, window.innerWidth - 24);
      setPosition({
        left: rect ? Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) : 12,
        bottom: rect ? Math.max(8, window.innerHeight - rect.top + 8) : 76,
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  /** 打开邀请弹层即自动复制邀请码；快照里没有就现场向服务端要一次（服务端按需生成）。 */
  useEffect(() => {
    if (dialog !== 'invite') return;
    let cancelled = false;
    void (async () => {
      let code = accountRef.current?.inviteCode || '';
      if (!code) {
        try {
          const next = await window.mathmodel.account.status();
          notifyAccountStatus(next);
          code = next.inviteCode || '';
        } catch {
          /* 取不到就统一走下面的提示 */
        }
      }
      if (cancelled) return;
      if (!code) { setToast(t('邀请码暂时取不到，请稍后重试')); return; }
      try {
        await navigator.clipboard.writeText(code);
        if (cancelled) return;
        setCopied(true);
        setToast(t('邀请码已复制，发给好友即可'));
        window.setTimeout(() => setCopied(false), 1800);
      } catch {
        if (!cancelled) setToast(t('请手动复制邀请码'));
      }
    })();
    return () => { cancelled = true; };
  }, [dialog]);

  if (!open) return null;

  const loggedIn = account?.loggedIn === true;
  const vip = isPaidVip(account);
  const trial = isActiveTrial(account);
  const checkedIn = account?.checkedIn === true || (account?.aiQuota?.bonus ?? 0) > 0;

  const checkin = async (): Promise<void> => {
    if (checkingIn || !loggedIn) return;
    setCheckingIn(true);
    // 记录签到前的家底：服务端对「今日已签」返回 alreadyCheckedIn 但 IPC 不透传，
    // 用积分 / 服务端奖励是否增加来区分「刚签成功」和「其实早已签过」。
    const prevPoints = account?.points ?? 0;
    const prevBonus = account?.aiQuota?.bonus ?? 0;
    try {
      const next = await window.mathmodel.account.checkin();
      notifyAccountStatus(next);
      const gained = (next.points ?? 0) > prevPoints || (next.aiQuota?.bonus ?? 0) > prevBonus;
      const reward = isPaidVip(next) || isActiveTrial(next) ? 10 : 100;
      setToast(!gained
        ? t('今日已签到，明天再来')
        : t(`签到成功，今日获得 ${reward} 积分`));
    } catch (error) {
      setToast(error instanceof Error ? error.message : t('签到失败，请稍后重试'));
    } finally {
      setCheckingIn(false);
    }
  };

  const submitFeedback = async (): Promise<void> => {
    const text = feedbackText.trim();
    if (text.length < 8) return;
    setFeedbackBusy(true);
    try {
      const result = await window.mathmodel.account.feedback({ text });
      notifyAccountStatus(result.status);
      setFeedbackText('');
      setToast(result.awarded > 0 ? t('感谢反馈，积分 +10') : t('反馈已提交，感谢你的建议'));
      setDialog('none');
    } catch (error) {
      setToast(error instanceof Error ? error.message : t('反馈暂时没有提交成功，请稍后重试'));
    } finally {
      setFeedbackBusy(false);
    }
  };

  const copyInvite = async (): Promise<void> => {
    const code = account?.inviteCode || '';
    if (!code) {
      setToast(t('邀请码暂时取不到，请稍后重试'));
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setToast(t('复制失败，请手动选择邀请码'));
    }
  };

  const menuAction = (fn: () => void): void => {
    onClose();
    fn();
  };

  /**
   * keepOpen：反馈 / 邀请要弹自己的对话框。
   * 组件在 `!open` 时整体返回 null，之前这里先 onClose 再开对话框，
   * 弹层根本渲染不出来 —— 表现就是「点了没反应」。
   */
  const menuItem = (icon: string, label: string, hint: string, fn: () => void, keepOpen = false): JSX.Element => (
    <button
      type="button"
      className="quick-menu-item"
      onClick={() => (keepOpen ? fn() : menuAction(fn))}
    >
      <Icon name={icon} size={15} />
      <span className="quick-menu-item-label">{label}</span>
      <span className="quick-menu-item-hint">{hint}</span>
    </button>
  );

  // 挂到 body 并用 fixed 定位：侧栏自身会裁剪溢出内容，留在侧栏内会被切掉右侧文字。
  return createPortal(
    <>
      <div className="quick-menu-backdrop" role="presentation" onClick={onClose} />
      <div
        className="quick-menu"
        role="dialog"
        aria-label={t('账号快捷菜单')}
        style={{ left: position?.left ?? 12, bottom: position?.bottom ?? 76 }}
      >
        {!loggedIn ? (
          <>
            <div className="quick-menu-head">
              <span className="rail-avatar"><Icon name="user" size={14} /></span>
              <div className="quick-menu-head-text">
                <strong>{t('未登录')}</strong>
                <span>{t('注册得 24 小时体验 + 20 积分；每天 100 积分')}</span>
              </div>
            </div>
            <button type="button" className="btn btn-primary quick-menu-login" onClick={() => menuAction(() => openMembership('account'))}>
              {t('登录 / 注册')}
            </button>
            <div className="quick-menu-sep" />
            {menuItem('settings', t('设置'), '', onOpenSettings)}
          </>
        ) : (
          <>
            <div className="quick-menu-head">
              <span className={`rail-avatar${vip || trial ? ' is-vip' : ''}`} aria-hidden>
                {(account?.username || '?').trim().slice(0, 1).toUpperCase()}
              </span>
              <div className="quick-menu-head-text">
                <strong>{account?.username}</strong>
                <span>
                  {vip
                    ? t(`VIP 会员 · 剩 ${Math.max(0, Math.ceil(((account?.expiresAt ?? 0) - Date.now()) / DAY))} 天`)
                    : trial
                      ? t(`24 小时体验 · 剩 ${trialHoursLeft(account)} 小时`)
                      : t(`免费版 · 可用 ${conversationPointsLeft(account) ?? 0} 积分`)}
                </span>
              </div>
              <span className="quick-menu-points" title={t('积分余额')}>
                <Icon name="coins" size={11} />
                {pointsBalance(account)}
              </span>
            </div>

            <div className="quick-menu-checkin">
              <Icon name="calendar-days" size={16} />
              <div className="quick-menu-checkin-copy">
                <strong>{t('每日签到')}</strong>
                <small>
                  {vip
                    ? t('签到得 10 积分')
                    : trial
                      ? t('签到得 10 积分，留作体验后使用')
                      : t('签到得 100 积分')}
                </small>
              </div>
              <button
                type="button"
                className={`btn btn-sm ${checkedIn ? 'btn-ghost' : 'btn-primary'}`}
                disabled={checkingIn || checkedIn}
                onClick={() => void checkin()}
              >
                {checkedIn ? t('今日已签到') : checkingIn ? t('签到中…') : t('立即签到')}
              </button>
            </div>

            {menuItem('crown', t('会员中心'), t('权益 · 套餐'), () => openMembership('plans'))}
            {menuItem('ticket', t('卡密兑换'), t('激活 / 叠加时长'), () => openMembership('redeem'))}
            {menuItem('coins', t('积分说明'), t('余额与消耗规则'), () => openMembership('points'))}
            {menuItem('message-square', t('反馈中心'), t('建议换积分'), () => setDialog('feedback'), true)}
            {menuItem('users', t('邀请好友'), t('完成首次有效使用后得积分'), () => setDialog('invite'), true)}
            {menuItem('settings', t('设置'), '', onOpenSettings)}

            <div className="quick-menu-sep" />
            <button
              type="button"
              className="quick-menu-logout"
              onClick={() => {
                if (!window.confirm(t('退出登录后本机授权将移除，确定吗？'))) return;
                menuAction(() => {
                  void window.mathmodel.account.logout().then((next) => notifyAccountStatus(next)).catch(() => undefined);
                });
              }}
            >
              {t('退出登录')}
            </button>
          </>
        )}

        {toast && <div className="quick-menu-toast" role="status">{toast}</div>}
      </div>

      {dialog === 'feedback' && (
        <div className="modal-backdrop quick-dialog-backdrop" role="presentation" onClick={() => setDialog('none')}>
          <div className="modal quick-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">{t('反馈中心')}</span>
              <button type="button" className="btn btn-sm btn-ghost" aria-label={t('关闭')} onClick={() => setDialog('none')}><Icon name="x" size={14} /></button>
            </div>
            <div className="modal-body col" style={{ gap: 10 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>{t('哪里好用、哪里需要改进？有效反馈可获得 10 积分。')}</span>
              <textarea
                className="input"
                rows={5}
                autoFocus
                placeholder={t('写下至少 8 个字的反馈…')}
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value.slice(0, 500))}
                disabled={feedbackBusy}
              />
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDialog('none')}>{t('取消')}</button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={feedbackText.trim().length < 8 || feedbackBusy}
                  onClick={() => void submitFeedback()}
                >
                  {feedbackBusy ? t('提交中…') : t('提交反馈')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {dialog === 'invite' && (
        <div className="modal-backdrop quick-dialog-backdrop" role="presentation" onClick={() => setDialog('none')}>
          <div className="modal quick-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">{t('邀请好友')}</span>
              <button type="button" className="btn btn-sm btn-ghost" aria-label={t('关闭')} onClick={() => setDialog('none')}><Icon name="x" size={14} /></button>
            </div>
            <div className="modal-body col" style={{ gap: 12 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {t('好友注册时填写你的邀请码；完成邮箱验证、创建项目并完成一次有效对话后，你可获得 50 积分。奖励每天最多结算 3 次。')}
              </span>
              <div className="invite-code-row">
                <span className="invite-code">{account?.inviteCode || '—'}</span>
                <button type="button" className="btn btn-sm btn-primary" disabled={!account?.inviteCode} onClick={() => void copyInvite()}>
                  {copied ? t('已复制') : t('复制邀请码')}
                </button>
              </div>
              <span className="muted" style={{ fontSize: 11.5 }}>
                {t('打开本页会自动复制邀请码。奖励由服务端核验好友的首次有效使用后发放，不能靠重复注册刷取。')}
              </span>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
