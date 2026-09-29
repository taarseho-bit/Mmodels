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
  { icon: 'blocks', title: '多智能体分工协作', copy: '主助手把赛题拆成子任务：题意解析、数据勘探、建模求解、制图写作各自成为节点，并行推进并交叉复核。' },
  { icon: 'workflow', title: '从选题到成稿', copy: '读题、找数据、建模求解、绘图、写论文，一条流程走完。' },
  { icon: 'folder-open', title: '成果留在本地', copy: '代码、数据、图表和论文都保存在你的项目文件夹里，不经过云端中转。' },
  { icon: 'file-check', title: '过程可回放', copy: '每位成员做了什么、调用了哪些技能、交回了什么，全程留痕，随时复核与复现。' },
] as const;

/** 数学符号水印：与营销站首屏同款「数模感」背景。
 *  位置 / 字号 / 动画时长用确定性伪随机算，避免每次渲染跳动。 */
const SYMBOL_FIELD = [
  '∑', '∫', 'π', '∂', '√', 'Σ', '∏', '≈', '≠', '∞',
  'x²', 'Δx', 'μ', 'σ', 'θ', 'λ', 'ƒ(x)', 'lim', 'dy/dx', '∅',
].map((s, i) => ({
  s,
  left: `${(i * 37 + ((i * 17) % 23)) % 94}%`,
  top: `${6 + ((i * 53) % 86)}%`,
  fontSize: `${20 + ((i * 13) % 30)}px`,
  animationDuration: `${18 + ((i * 7) % 16)}s`,
  animationDelay: `${-((i * 11) % 22)}s`,
}));

const PARTICLES = [
  { left: '36%', top: '25%', size: 6, delay: '0s' },
  { left: '72%', top: '44%', size: 4, delay: '-0.8s' },
  { left: '18%', top: '74%', size: 3, delay: '-1.4s' },
  { left: '58%', top: '66%', size: 5, delay: '-1.9s' },
] as const;

/** 首启页背景：数学符号水印 + 漂移粒子。 */
function MathField(): JSX.Element {
  return (
    <div className="first-run-backdrop" aria-hidden>
      {SYMBOL_FIELD.map((item, index) => (
        <span
          key={`${item.s}-${index}`}
          className="first-run-symbol"
          style={{
            left: item.left,
            top: item.top,
            fontSize: item.fontSize,
            animationDuration: item.animationDuration,
            animationDelay: item.animationDelay,
          }}
        >
          {item.s}
        </span>
      ))}
      {PARTICLES.map((p) => (
        <i
          key={`${p.left}-${p.top}`}
          className="first-run-particle"
          style={{ left: p.left, top: p.top, width: p.size, height: p.size, animationDelay: p.delay }}
        />
      ))}
    </div>
  );
}

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
  const [darkMode, setDarkMode] = useState(false);

  const showAuthOnly = (): void => {
    onLater?.();
  };

  /* 亮/暗配色切换：亮色为营销站白底朱红，暗色为改造前的深色配色；文案不变。 */
  const themeClass = darkMode ? ' first-run-shell-dark' : '';
  const themeToggle = (
    <button
      type="button"
      className="first-run-theme-toggle"
      onClick={() => setDarkMode((v) => !v)}
      aria-pressed={darkMode}
      title={darkMode ? t('切换到亮色') : t('切换到暗色')}
    >
      <Icon name="sun-moon" size={13} />
      {darkMode ? t('亮色') : t('暗色')}
    </button>
  );

  if (compactAuth) {
    return (
      <div className={`first-run-shell first-run-shell-auth${themeClass}`} data-testid="account-gate">
        <MathField />
        <div className="first-run-theme-toggle-floating">{themeToggle}</div>
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
            <p>{t('注册免费账号可领取 24 小时完整基础体验并获得 50 积分。体验结束后仍可使用基础 AI，本地项目与编辑功能继续可用。多智能体、云协作和自动化需要卡密激活 VIP。')}</p>
            <div className="first-run-mini-points">
              <span><Icon name="check" size={13} />{t('免费账号可使用基础功能')}</span>
              <span><Icon name="check" size={13} />{t('注册即领 24 小时体验')}</span>
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
    <div className={`first-run-shell${themeClass}`} data-testid="first-run-welcome">
      <MathField />

      <header className="first-run-head">
        <div className="first-run-brand"><span className="first-run-mark" aria-hidden>∑</span><strong>MModels</strong></div>
        <div className="first-run-head-actions">
          <span className="first-run-local-note"><Icon name="shield-check" size={13} />{t('本地基础功能永久免费')}</span>
          {themeToggle}
        </div>
      </header>

      <div className="first-run-grid">
        <section className="first-run-intro">
          <span className="first-run-eyebrow">{t('为数学建模竞赛而生的桌面工作台')}</span>
          <h1>{t('一道题，一支队伍，')}<em>{t('一篇可以直接交的论文。')}</em></h1>
          <p className="first-run-lead">{t('把赛题放进 MModels，先用基础流程完成从分析到论文的工作；需要多人协作时，再用卡密激活 VIP。每一步做了什么、调用了哪些技能、交回了什么，全部摆在你眼前。注册免费账号即领 24 小时体验和 50 积分。')}</p>
          <div className="first-run-offer">
            <span className="first-run-offer-icon"><Icon name="sparkles" size={18} /></span>
            <span><strong>{t('注册享 24 小时体验')}</strong><small>{t('基础建模、论文写作和本地排版可直接体验；多智能体、云协作和自动化需卡密 VIP')}</small></span>
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
            <button type="button" className="btn btn-primary" onClick={() => setCompactAuth(true)}>
              {t('注册领取 24 小时体验')}
            </button>
            <button type="button" className="btn first-run-tour-btn" onClick={() => onStartTour?.()}>
              {t('看看它是怎么干活的')}
            </button>
            <button type="button" className="first-run-later" onClick={showAuthOnly}>
              {t('稍后再说')}
            </button>
          </div>
          <small className="first-run-footnote">{t('本地基础功能永久免费，随时可以升级会员。')}</small>
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
