/**
 * 设置页 · 账号与授权（商业化，2026-09-28）
 *
 * - 未登录：注册（邮箱验证码必填 + 可选卡密直接激活）/ 登录 / 忘记密码（邮箱验证码重置）
 * - 已登录：账号、到期时间、剩余天数；卡密续费（叠加）；退出登录
 * - 凭证由主进程落盘 userData（account.json + license.token），本组件只发 IPC
 */
import { useCallback, useEffect, useState } from 'react';
import { t } from '../../i18n';
import { Section } from './shared';
import type { AccountStatusInfo } from '@shared/types';
import { conversationPointsLeft, isActiveTrial, isPaidVip, pointsBalance, trialHoursLeft } from '../membership/membership-ui';

const DAY = 86_400_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fmtDate(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface AccountSectionProps {
  /** 设置页保持原来的完整账号区；首启页面可使用 standalone 版。 */
  standalone?: boolean;
  /** 登录或注册成功后通知外层（首启门需要立即放行主界面）。 */
  onAuthenticated?: (status: AccountStatusInfo) => void;
  /** 任意状态变化（兑换、退出登录也会触发）。 */
  onStatusChange?: (status: AccountStatusInfo) => void;
  /** 账号状态区右侧的「会员套餐」入口。 */
  onOpenMembership?: () => void;
  initialAuthMode?: 'login' | 'register';
}

export function AccountSection({
  standalone = false,
  onAuthenticated,
  onStatusChange,
  onOpenMembership,
  initialAuthMode = 'register',
}: AccountSectionProps = {}): JSX.Element {
  const [status, setStatus] = useState<AccountStatusInfo | null>(null);
  const [view, setView] = useState<'auth' | 'forgot'>('auth');
  const [authMode, setAuthMode] = useState<'login' | 'register'>(initialAuthMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [regCode, setRegCode] = useState('');
  const [regInvite, setRegInvite] = useState('');
  const [regCd, setRegCd] = useState(0);
  const [fpEmail, setFpEmail] = useState('');
  const [fpCode, setFpCode] = useState('');
  const [fpNew1, setFpNew1] = useState('');
  const [fpNew2, setFpNew2] = useState('');
  const [fpCd, setFpCd] = useState(0);
  const [busy, setBusy] = useState('');
  const [statusError, setStatusError] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refreshStatus = useCallback((): void => {
    setStatusError('');
    void window.mathmodel.account.status().then((next) => {
      setStatus(next);
      onStatusChange?.(next);
    }).catch((e) => {
      setStatus(null);
      setStatusError(e instanceof Error ? e.message : t('读取账号状态失败，请重试'));
    });
  }, [onStatusChange]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    if (regCd <= 0) return;
    const id = window.setTimeout(() => setRegCd((v) => v - 1), 1000);
    return () => window.clearTimeout(id);
  }, [regCd]);

  useEffect(() => {
    if (fpCd <= 0) return;
    const id = window.setTimeout(() => setFpCd((v) => v - 1), 1000);
    return () => window.clearTimeout(id);
  }, [fpCd]);

  const run = async (label: string, fn: () => Promise<AccountStatusInfo>, okText: string): Promise<void> => {
    setBusy(label);
    setMessage(null);
    try {
      const next = await fn();
      setStatus(next);
      onStatusChange?.(next);
      if (next.loggedIn) onAuthenticated?.(next);
      setMessage({ kind: 'ok', text: okText });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : t('操作失败，请稍后重试') });
    } finally {
      setBusy('');
    }
  };

  const doSendCode = async (purpose: 'register' | 'reset', mail: string, setCd: (n: number) => void): Promise<void> => {
    if (!EMAIL_RE.test(mail.trim())) {
      setMessage({ kind: 'err', text: t('请输入正确的邮箱地址') });
      return;
    }
    setBusy('sendcode');
    setMessage(null);
    try {
      await window.mathmodel.account.sendCode({ email: mail.trim(), purpose });
      setCd(60);
      setMessage({ kind: 'ok', text: t('验证码已发送，请查收邮箱（10 分钟内有效）') });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : t('发送失败，请稍后重试') });
    } finally {
      setBusy('');
    }
  };

  const daysLeft = status?.loggedIn ? Math.floor((Number(status.expiresAt || 0) - Date.now()) / DAY) : 0;
  const emailOk = EMAIL_RE.test(email.trim());
  // 注册和登录的校验条件必须分开。旧逻辑把注册所需的邮箱验证码
  // 复用到了“已有账号，直接登录”，导致登录前必须先填邮箱、甚至消耗一次验证码。
  const canRegister = username.trim().length >= 3 && password.length >= 8 && emailOk && emailCode.trim().length === 6 && busy === '';
  const canLogin = username.trim().length >= 3 && password.length >= 8 && busy === '';
  const canReset = EMAIL_RE.test(fpEmail.trim()) && fpCode.trim().length === 6 && fpNew1.length >= 8 && fpNew1 === fpNew2 && busy === '';

  const sendCodeBtn = (purpose: 'register' | 'reset', mail: string, cd: number, setCd: (n: number) => void): JSX.Element => (
    <button
      className="btn btn-sm btn-ghost"
      style={{ whiteSpace: 'nowrap' }}
      disabled={busy !== '' || cd > 0}
      onClick={() => void doSendCode(purpose, mail, setCd)}
    >
      {busy === 'sendcode' ? t('发送中…') : cd > 0 ? t(`${cd} 秒后重发`) : t('获取验证码')}
    </button>
  );

  const loggedOutView = (
    <div className={`panel col account-auth-card${standalone ? ' account-auth-card-standalone' : ''}`}>
      <div className="account-auth-tabs" role="tablist" aria-label={t('账号操作')}>
        <button
          type="button"
          role="tab"
          aria-selected={authMode === 'register'}
          className={authMode === 'register' ? 'active' : ''}
          onClick={() => { setAuthMode('register'); setMessage(null); }}
        >{t('注册新账号')}</button>
        <button
          type="button"
          role="tab"
          aria-selected={authMode === 'login'}
          className={authMode === 'login' ? 'active' : ''}
          onClick={() => { setAuthMode('login'); setMessage(null); }}
        >{t('已有账号，直接登录')}</button>
      </div>

      <input
        className="input"
        placeholder={authMode === 'login' ? t('账号或邮箱（两个都可以登录）') : t('账号（3-24 位字母 / 数字 / 下划线）')}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        disabled={busy !== ''}
        autoComplete="username"
      />
      <input
        className="input"
        type="password"
        placeholder={t('密码（至少 8 位）')}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy !== ''}
        autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
      />

      {authMode === 'register' && <>
        <input
          className="input"
          placeholder={t('邮箱（用于验证码与找回密码）')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy !== ''}
          autoComplete="email"
        />
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder={t('邮箱验证码（6 位）')}
            value={emailCode}
            onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={busy !== ''}
          />
          {sendCodeBtn('register', email, regCd, setRegCd)}
        </div>
        <input
          className="input"
          placeholder={t('卡密（可选，注册时填入立即激活会员）')}
          value={regCode}
          onChange={(e) => setRegCode(e.target.value)}
          disabled={busy !== ''}
        />
        <input
          className="input"
          placeholder={t('邀请码（可选，好友完成首次有效使用后你可得 50 积分）')}
          value={regInvite}
          onChange={(e) => setRegInvite(e.target.value.toUpperCase().slice(0, 12))}
          disabled={busy !== ''}
        />
        <button
          className="btn btn-sm btn-primary"
          disabled={!canRegister}
          onClick={() => void run('register', () => window.mathmodel.account.register({ username: username.trim(), password, email: email.trim(), emailCode: emailCode.trim(), code: regCode.trim() || undefined, inviteCode: regInvite.trim() || undefined }), t('注册成功，已获得 24 小时完整基础体验'))}
        >
          {busy === 'register' ? t('注册中…') : t('注册并领取 24 小时体验')}
        </button>
      </>}

      {authMode === 'login' && <button
        className="btn btn-sm btn-primary"
        disabled={!canLogin}
        onClick={() => void run('login', () => window.mathmodel.account.login({ username: username.trim(), password }), t('登录成功'))}
      >
        {busy === 'login' ? t('登录中…') : t('登录并进入工作台')}
      </button>}

      <button
        className="btn btn-sm btn-ghost account-forgot-link"
        onClick={() => { setView('forgot'); setMessage(null); }}
      >
        {t('忘记密码？')}
      </button>
      {authMode === 'register' && <span className="muted" style={{ fontSize: 11.5 }}>
        {t('注册后可使用本地项目和基础论文流程，并获得 24 小时体验；多智能体协作需卡密 VIP。')}
      </span>}
    </div>
  );

  const forgotView = (
    <div className="panel col" style={{ padding: 14, gap: 10, maxWidth: 460 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{t('重置密码')}</span>
      <span className="muted" style={{ fontSize: 11.5 }}>{t('输入注册时绑定的邮箱，验证码将发送至该邮箱。')}</span>
      <input
        className="input"
        placeholder={t('绑定邮箱')}
        value={fpEmail}
        onChange={(e) => setFpEmail(e.target.value)}
        disabled={busy !== ''}
      />
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder={t('邮箱验证码（6 位）')}
          value={fpCode}
          onChange={(e) => setFpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          disabled={busy !== ''}
        />
        {sendCodeBtn('reset', fpEmail, fpCd, setFpCd)}
      </div>
      <input
        className="input"
        type="password"
        placeholder={t('新密码（至少 8 位）')}
        value={fpNew1}
        onChange={(e) => setFpNew1(e.target.value)}
        disabled={busy !== ''}
      />
      <input
        className="input"
        type="password"
        placeholder={t('确认新密码')}
        value={fpNew2}
        onChange={(e) => setFpNew2(e.target.value)}
        disabled={busy !== ''}
      />
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={!canReset}
          onClick={() => void run('reset', async () => {
            await window.mathmodel.account.resetPassword({ email: fpEmail.trim(), emailCode: fpCode.trim(), newPassword: fpNew1 });
            setView('auth');
            setFpEmail(''); setFpCode(''); setFpNew1(''); setFpNew2('');
            return status ?? { loggedIn: false, username: '', expiresAt: 0 };
          }, t('密码已重置，请用新密码登录'))}
        >
          {busy === 'reset' ? t('提交中…') : t('重置密码')}
        </button>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => { setView('auth'); setMessage(null); }}
        >
          {t('返回登录')}
        </button>
      </div>
    </div>
  );

  const loggedInView = (
    <div className="panel col" style={{ padding: 14, gap: 12, maxWidth: 520 }}>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>{status?.username}</span>
        {status?.plan === 'vip' ? (
          <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>{daysLeft < 7 ? t(`VIP·剩 ${Math.max(daysLeft, 0)} 天`) : t('VIP 会员')}</span>
        ) : isActiveTrial(status) ? (
          <span className="badge badge-accent">{t(`24 小时体验·剩 ${trialHoursLeft(status)} 小时`)}</span>
        ) : (
          <span className="badge">{t('免费账号')}</span>
        )}
      </div>
      <div className="col" style={{ gap: 4, fontSize: 12.5 }}>
        {isPaidVip(status) || isActiveTrial(status) ? <div className="row" style={{ gap: 8 }}>
          <span className="muted" style={{ width: 90 }}>{isPaidVip(status) ? t('会员到期') : t('体验到期')}</span>
          <span className="mono">{fmtDate(isActiveTrial(status) ? (status?.trialExpiresAt ?? status?.expiresAt ?? 0) : (status?.expiresAt ?? 0))}</span>
          <span className="muted">（{isActiveTrial(status) ? t(`剩余 ${trialHoursLeft(status)} 小时`) : t(`剩余 ${Math.max(daysLeft, 0)} 天`)}）</span>
        </div> : null}
        <div className="row" style={{ gap: 8 }}>
          <span className="muted" style={{ width: 90 }}>{t('本机绑定')}</span>
          <span className="muted" style={{ fontSize: 11.5 }}>{t('同一账号同一时间在一台电脑使用；换机登录将自动转移授权。')}</span>
        </div>
      </div>
      <div className="col" style={{ gap: 6 }}>
        {status?.plan !== 'vip' && !isActiveTrial(status) && (
          <span className="muted" style={{ fontSize: 11.5 }}>{t('当前为免费账号：每天有 100 对话积分，基础论文流程可用；多智能体与高级交付需卡密 VIP。')}</span>
        )}
        {status?.loggedIn && <span className="muted" style={{ fontSize: 11.5 }}>{t(`可用积分：${conversationPointsLeft(status) ?? pointsBalance(status)} 分`)}</span>}
        <span className="muted" style={{ fontSize: 11.5 }}>{t('卡密兑换、积分说明与每日签到都在左下角头像菜单里。')}</span>
        {onOpenMembership && <button className="btn btn-sm btn-primary" type="button" onClick={onOpenMembership}>{t('进入会员中心')}</button>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          className="btn btn-sm btn-ghost"
          disabled={busy !== ''}
          onClick={() => {
            if (!window.confirm(t('退出登录后本机授权将移除，确定吗？'))) return;
            void run('logout', () => window.mathmodel.account.logout(), t('已退出登录'));
            setUsername(''); setPassword(''); setRegCode(''); setRegInvite(''); setEmail(''); setEmailCode('');
          }}
        >
          {t('退出登录')}
        </button>
      </div>
    </div>
  );

  return (
    <div className={`col account-section${standalone ? ' account-section-standalone' : ''}`} style={{ gap: 22 }}>
      <Section
        title={t('会员状态')}
        hint={t('注册可领取 24 小时完整基础体验；体验后每天有 100 对话积分，签到再领 100 分。卡密 VIP 解锁多智能体、深度建模、自动化与完整导出。')}
      >
        {!status ? statusError ? (
          <div className="col" style={{ gap: 8, alignItems: 'flex-start' }}>
            <span className="muted">{statusError}</span>
            <button className="btn btn-sm btn-ghost" onClick={refreshStatus}>{t('重新读取')}</button>
          </div>
        ) : <span className="muted">{t('读取账号状态…')}</span> : status.loggedIn ? loggedInView : view === 'forgot' ? forgotView : loggedOutView}
      </Section>

      {message ? (
        <div
          className="panel row"
          style={{
            padding: '8px 12px', gap: 8, fontSize: 12.5,
            background: message.kind === 'ok' ? '#f0fdf4' : '#fef2f2',
            borderColor: message.kind === 'ok' ? '#bbf7d0' : '#fecaca',
            color: message.kind === 'ok' ? '#15803d' : '#b91c1c',
          }}
        >
          {message.text}
        </div>
      ) : null}
    </div>
  );
}
