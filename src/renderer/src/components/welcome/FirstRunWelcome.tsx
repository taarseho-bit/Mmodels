import { useState } from 'react';
import type { AccountStatusInfo } from '@shared/types';
import { t } from '../../i18n';
import { Icon } from '../Icon';
import { AccountSection } from '../settings/AccountSection';

export interface FirstRunWelcomeProps {
  /** 登录/注册成功后由 App 更新账号门状态。 */
  onAuthenticated?: (status: AccountStatusInfo) => void;
  /** 用户把欢迎介绍收起，回到本地工作台；AI 功能会在需要时再提示登录。 */
  onLater?: () => void;
  /** 进入现有的新手向导。 */
  onStartTour?: () => void;
  /** 纯登录页模式，可由账号入口显式打开。 */
  authOnly?: boolean;
}

const HIGHLIGHTS = [
  { icon: 'workflow', title: '多智能体编排', copy: '把复杂建模任务拆成可追踪的步骤。' },
  { icon: 'blocks', title: '可插拔技能', copy: '按题目加载数据、建模、绘图和写作能力。' },
  { icon: 'terminal', title: '真实终端', copy: '代码、数据与产物都留在你的本地项目中。' },
  { icon: 'file-check', title: '产物透明', copy: '每一步有证据、有文件，也方便继续修改。' },
] as const;

/**
 * 首启会员欢迎页。
 *
 * 它是独立首启页：用户可以直接进入本地工作台，联网 AI、导出和高级能力
 * 由主进程权益校验在触发时提示注册或升级。这样未登录用户能先看到项目和本地编辑能力。
 */
export function FirstRunWelcome({
  onAuthenticated,
  onLater,
  onStartTour,
  authOnly = false,
}: FirstRunWelcomeProps): JSX.Element {
  const [compactAuth, setCompactAuth] = useState(authOnly);

  const showAuthOnly = (): void => {
    onLater?.();
  };

  if (compactAuth) {
    return (
      <div className="first-run-shell first-run-shell-auth" data-testid="account-gate">
        <div className="first-run-auth-brand">
          <div className="first-run-mark" aria-hidden>∑</div>
          <div>
            <strong>MModels</strong>
            <span>{t('先登录，再开始你的数学建模工作')}</span>
          </div>
        </div>
        <div className="first-run-auth-only">
          <div className="first-run-auth-copy">
            <span className="first-run-eyebrow">{t('账号中心')}</span>
            <h1>{t('登录后进入工作台')}</h1>
            <p>{t('注册免费账号可领取 3 天全功能试用。试用结束后仍可每天使用基础 AI，本地项目与编辑功能继续可用。')}</p>
            <div className="first-run-mini-points">
              <span><Icon name="check" size={13} />{t('免费账号可使用基础功能')}</span>
              <span><Icon name="check" size={13} />{t('注册即领 3 天全功能试用')}</span>
              <span><Icon name="check" size={13} />{t('无需信用卡即可开始')}</span>
            </div>
          </div>
          <AccountSection
            standalone
            initialAuthMode="login"
            onAuthenticated={onAuthenticated}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="first-run-shell" data-testid="first-run-welcome">
      <div className="first-run-backdrop" aria-hidden>
        <span className="first-run-symbol first-run-symbol-a">∑</span>
        <span className="first-run-symbol first-run-symbol-b">∂</span>
        <span className="first-run-symbol first-run-symbol-c">π</span>
        <span className="first-run-symbol first-run-symbol-d">∫</span>
        <i className="first-run-particle first-run-particle-a" />
        <i className="first-run-particle first-run-particle-b" />
        <i className="first-run-particle first-run-particle-c" />
      </div>

      <header className="first-run-head">
        <div className="first-run-brand"><span className="first-run-mark" aria-hidden>∑</span><strong>MModels</strong></div>
        <span className="first-run-local-note"><Icon name="shield-check" size={13} />{t('本地基础功能永久免费')}</span>
      </header>

      <div className="first-run-grid">
        <section className="first-run-intro">
          <span className="first-run-eyebrow">{t('数学建模工作台')}</span>
          <h1>{t('把想法变成可提交的模型成果')}</h1>
          <p className="first-run-lead">{t('注册一个免费账号，领取 3 天全功能试用；之后每天仍有基础 AI 次数，签到还能继续领取。')}</p>
          <div className="first-run-offer">
            <span className="first-run-offer-icon"><Icon name="sparkles" size={18} /></span>
            <span><strong>{t('注册送 3 天 VIP 试用')}</strong><small>{t('多智能体、深度建模、完整导出都可体验')}</small></span>
          </div>
          <div className="first-run-highlights">
            {HIGHLIGHTS.map((item) => (
              <div className="first-run-highlight" key={item.title}>
                <Icon name={item.icon} size={15} />
                <span><strong>{t(item.title)}</strong><small>{t(item.copy)}</small></span>
              </div>
            ))}
          </div>
          <div className="first-run-actions">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setCompactAuth(true)}>
              {t('注册送 3 天试用')}
            </button>
            <button type="button" className="btn btn-sm first-run-tour-btn" onClick={() => onStartTour?.()}>
              {t('查看新手引导')}
            </button>
            <button type="button" className="first-run-later" onClick={showAuthOnly}>
              {t('稍后再说')}
            </button>
          </div>
          <small className="first-run-footnote">{t('本地基础功能永久免费 · 无需信用卡 · 随时可以退出')}</small>
        </section>

        <section className="first-run-auth-wrap" aria-label={t('登录或注册')}>
          <div className="first-run-auth-heading">
            <span className="first-run-eyebrow">{t('开始使用')}</span>
            <h2>{t('注册免费账号')}</h2>
            <p>{t('已有账号？切换到登录即可继续。')}</p>
          </div>
          <AccountSection standalone onAuthenticated={onAuthenticated} />
        </section>
      </div>
    </div>
  );
}
