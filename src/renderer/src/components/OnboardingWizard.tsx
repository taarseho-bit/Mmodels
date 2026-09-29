/**
 * 首次运行向导 —— 2026-09-28 布局大改版。
 *
 * 与改造前差异（用户要求"引导大改，不能和之前一样"）：
 *   1. 新增第一步「会员权益」——注册享 24 小时体验 / 积分签到 / 本地永久免费，
 *      让新用户在配模型之前就知道免费与 VIP 的边界和薅羊毛姿势；
 *   2. 模型选择改为**卡片网格 + 分组**：国产直连模型在最前（DeepSeek 默认选中），
 *      海外/本地分组靠后 —— 对齐参考软件的引导习惯，面向国内建模用户；
 *   3. 完成页新增「新手三件事」：`#` 唤起任务面板、左下角头像管理会员、每日签到；
 *   4. 保留原有的连接逻辑（connect / 测试连通 / 环境检测 / 让 Agent 装环境）。
 *
 * 预设顺序本身在 `@shared/providers` 定稿（国产在前），本组件只负责展示分组。
 */
import { useCallback, useEffect, useState } from 'react';
import type { PresetProvider, ProviderConfig, AppSettings } from '@shared/types';
import { useApp } from '../store/app';
import { Icon } from './Icon';
import { t, tx } from '../i18n';
import { friendlyError } from '../lib/friendly-error';
import { openMembership } from '../lib/membership-nav';

interface EnvItem {
  id: string;
  name: string;
  level: 'required' | 'recommended';
  status: 'ok' | 'missing' | 'unknown';
  detail?: string;
  purpose: string;
}

interface EnvResult {
  items: EnvItem[];
  missingRequired: number;
  missingRecommended: number;
  ok: boolean;
}

type Step = 'welcome' | 'model' | 'environment' | 'done';

const STEP_ORDER: Step[] = ['welcome', 'model', 'environment', 'done'];

/** 供应商分组：国产直连在前，海外/本地在后（providers.ts 的顺序即组内顺序） */
const CN_KEYS = new Set(['deepseek', 'zhipu', 'dashscope', 'moonshot', 'minimax']);

function groupPresets(all: PresetProvider[]): { cn: PresetProvider[]; rest: PresetProvider[] } {
  return {
    cn: all.filter((p) => CN_KEYS.has(p.key)),
    rest: all.filter((p) => !CN_KEYS.has(p.key)),
  };
}

/** 供应商卡片的分类徽章（国产直连 / 海外 / 本地） */
function providerTag(key: string): { label: string; kind: 'cn' | 'global' | 'local' } | null {
  if (key === 'ollama') return { label: '本地运行', kind: 'local' };
  if (CN_KEYS.has(key)) return { label: '国内直连', kind: 'cn' };
  return { label: '海外服务', kind: 'global' };
}

export function OnboardingWizard({
  onClose,
  onFinish,
}: {
  onClose: () => void;
  /** 完成向导（写入 onboardingDone 并可选启动引导巡览） */
  onFinish: (opts: { startTour: boolean }) => void;
}): JSX.Element {
  const [step, setStep] = useState<Step>('welcome');
  const stepIndex = STEP_ORDER.indexOf(step);

  // ── 模型步 ──
  const [presets, setPresets] = useState<PresetProvider[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [picked, setPicked] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fillPrompt = useApp((s) => s.fillPrompt);

  // ── 环境步 ──
  const [env, setEnv] = useState<EnvResult | null>(null);
  const [envLoading, setEnvLoading] = useState(false);

  const refreshProviders = useCallback(async () => {
    const list = await window.mathmodel.llm.listProviders();
    setProviders(list);
    return list;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [ps, ls] = await Promise.all([
          window.mathmodel.llm.presets(),
          window.mathmodel.llm.listProviders(),
        ]);
        setPresets(ps);
        setProviders(ls);
        // 已有可用供应商就直接跳到模型步之后，别让用户重复填
        if (ls.some((p) => p.enabled !== false)) setStep('model');
        else setPicked(ps[0]?.key ?? '');
      } catch (e) {
        setError(friendlyError(e, '供应商列表没有读取成功，可以重试。'));
      }
    })();
  }, []);

  // ── 环境检测 ──
  const runEnvCheck = useCallback(async () => {
    setEnvLoading(true);
    setError(null);
    try {
      setEnv((await window.mathmodel.env.check()) as EnvResult);
    } catch (e) {
      setError(friendlyError(e, '运行环境检查没有完成，可以重试。'));
    } finally {
      setEnvLoading(false);
    }
  }, []);

  // 进到环境步就自动检测一次
  useEffect(() => {
    if (step === 'environment' && !env && !envLoading) void runEnvCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const preset = presets.find((p) => p.key === picked) ?? null;

  const connected = providers.filter((p) => p.enabled !== false);

  /** 保存供应商并（可选）测试连通性 */
  const connect = async (): Promise<void> => {
    if (!preset) return;
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      const id = `prov-${preset.key}-${Date.now().toString(36)}`;
      const created: ProviderConfig = {
        id,
        name: preset.name,
        apiFormat: preset.apiFormat,
        baseUrl: preset.baseUrl,
        apiKey: apiKey.trim(),
        models: [preset.defaultModel],
        enabled: true,
      };
      await window.mathmodel.llm.upsertProvider(created);
      await refreshProviders();

      // 设为当前供应商 + 默认模型
      const patch: Partial<AppSettings> = {
        activeProviderId: id,
        defaultModel: preset.defaultModel,
      };
      await window.mathmodel.settings.set(patch);

      // 顺手测一下，失败也允许继续（可能只是网络问题）
      setTesting(true);
      try {
        const r = await window.mathmodel.llm.testProvider(id);
        setTestResult(r);
      } catch (e) {
        setTestResult({ ok: false, detail: friendlyError(e, '连接测试没有完成，可以稍后重试。') });
      } finally {
        setTesting(false);
      }
    } catch (e) {
      setError(friendlyError(e, '供应商保存没有完成，可以重试。'));
    } finally {
      setSaving(false);
    }
  };

  /** 把「让 Agent 装环境」的指令填进输入框（应用约定行为） */
  const askAgentToFix = (): void => {
    const missing = (env?.items ?? []).filter((i) => i.status !== 'ok');
    const text =
      tx('onboarding.wizard.environment.fixPrompt.intro') +
      '\n' +
      missing.map((i) => `- ${i.name}（${i.purpose}）`).join('\n') +
      '\n\n' +
      tx('onboarding.wizard.environment.fixPrompt.requirements');
    // 走 store：App 会据此切到对话页，ChatPage 挂载后取走并填入输入框
    fillPrompt(text);
    onClose();
  };

  /** 第一步「去注册领 VIP」：记录向导已完成，再打开账号弹窗 */
  const goRegisterVip = (): void => {
    onFinish({ startTour: false });
    openMembership('account');
  };

  const missingRequired = env?.missingRequired ?? 0;
  const groups = groupPresets(presets);

  const renderPresetCard = (p: PresetProvider): JSX.Element => {
    const tag = providerTag(p.key);
    return (
      <button key={p.key} className={`ob-preset-card${picked === p.key ? ' active' : ''}`} onClick={() => setPicked(p.key)}>
        <span className="ob-preset-card-head">
          <span className="ob-preset-name">{p.name}</span>
          {tag && <span className={`ob-tag ob-tag-${tag.kind}`}>{tag.label}</span>}
        </span>
        <span className="ob-preset-model mono">{p.defaultModel}</span>
        {p.note && <span className="ob-preset-note">{p.note}</span>}
      </button>
    );
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="ob-card ob-card-v2" onClick={(e) => e.stopPropagation()}>
        {/* ── 品牌 + 步骤指示 ── */}
        <div className="ob-head">
          <span className="ob-brand" aria-hidden>
            <Icon name="sigma" size={16} strokeWidth={2} />
            MModels
          </span>
          <div className="ob-steps">
            {STEP_ORDER.map((s, i) => (
              <span key={s} className={`ob-dot${i <= stepIndex ? ' on' : ''}`} />
            ))}
          </div>
          <span className="muted" style={{ fontSize: 11 }}>
            {tx('onboarding.wizard.stepLabel', { current: stepIndex + 1, total: STEP_ORDER.length })}
          </span>
          <div className="grow" />
          <button className="btn btn-sm btn-ghost" onClick={onClose} title={tx('common.close')}>
            ✕
          </button>
        </div>

        {/* ── 第 1 步：会员权益 ── */}
        {step === 'welcome' && (
          <div className="ob-body">
            <h2 className="ob-title">{t('欢迎使用 MModels 建模工作台')}</h2>
            <p className="ob-desc">
              {t('从选题分析到论文成稿的完整 AI 工作流。先花 30 秒了解会员规则，再连接你的模型。')}
            </p>

            <div className="ob-perk-grid">
              <div className="ob-perk">
                <span className="ob-perk-icon is-gold"><Icon name="crown" size={15} /></span>
                <strong>{t('注册享 24 小时体验')}</strong>
                <span>{t('注册后可体验完整基础流程；多智能体、云协作和自动化仅对卡密 VIP 开放')}</span>
              </div>
              <div className="ob-perk">
                <span className="ob-perk-icon is-green"><Icon name="calendar-days" size={15} /></span>
                <strong>{t('积分用得明白')}</strong>
                <span>{t('免费账号每天获得基础积分，普通对话按固定积分消耗；签到可再领积分')}</span>
              </div>
              <div className="ob-perk">
                <span className="ob-perk-icon is-blue"><Icon name="shield-check" size={15} /></span>
                <strong>{t('本地功能永久免费')}</strong>
                <span>{t('项目管理、论文编辑、绘图工作台不收费，数据都在你自己的电脑上')}</span>
              </div>
            </div>

            <div className="ob-perk-actions">
              <button className="btn btn-primary" onClick={goRegisterVip}>
                {t('注册领取 24 小时体验')}
              </button>
              <button className="btn" onClick={() => setStep('model')}>
                {t('稍后再说，先配置模型')}
              </button>
            </div>
            {error && <div className="ob-err">{error}</div>}
          </div>
        )}

        {/* ── 第 2 步：连接模型（卡片式，国产前置）── */}
        {step === 'model' && (
          <div className="ob-body">
            <h2 className="ob-title">{tx('onboarding.wizard.model.title')}</h2>
            <p className="ob-desc">
              {t('选择一个模型服务商并填入 API Key。国内服务注册即用、直连无需加速。')}
            </p>

            {groups.cn.length > 0 && (
              <>
                <div className="ob-group-title">{t('国内直连 · 推荐')}</div>
                <div className="ob-preset-grid">{groups.cn.map(renderPresetCard)}</div>
              </>
            )}
            {groups.rest.length > 0 && (
              <>
                <div className="ob-group-title">{t('海外 / 本地')}</div>
                <div className="ob-preset-grid">{groups.rest.map(renderPresetCard)}</div>
              </>
            )}

            {preset && (
              <div className="col" style={{ gap: 6, marginTop: 14 }}>
                <label className="field-label">API Key</label>
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  placeholder={preset.key === 'deepseek' ? 'sk-...' : '粘贴服务商提供的 API Key'}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="muted" style={{ fontSize: 11 }}>
                    接口地址：<span className="mono">{preset.baseUrl}</span> · 默认模型{' '}
                    <span className="mono">{preset.defaultModel}</span>
                  </span>
                  {preset.docsUrl && (
                    <a
                      className="ob-docs-link"
                      href={preset.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        // 桌面应用走系统浏览器，不在内置 webview 里打开第三方页
                        e.preventDefault();
                        void window.mathmodel.browser.openExternal(preset.docsUrl ?? '');
                      }}
                    >
                      {t(`没有 Key？去 ${preset.name} 开通 ›`)}
                    </a>
                  )}
                </div>
              </div>
            )}

            {connected.length > 0 && (
              <div className="ob-ok">
                ✓ {tx('onboarding.wizard.model.connectedTitle')}（{connected.length}）
              </div>
            )}

            {testResult && (
              <div className={testResult.ok ? 'ob-ok' : 'ob-warn'}>
                {testResult.ok ? '✓ ' : '⚠ '}
                {testResult.detail}
              </div>
            )}

            {error && <div className="ob-err">{error}</div>}
          </div>
        )}

        {/* ── 第 3 步：检查运行环境 ── */}
        {step === 'environment' && (
          <div className="ob-body">
            <h2 className="ob-title">{tx('onboarding.wizard.environment.title')}</h2>
            <p className="ob-desc">{tx('onboarding.wizard.environment.description')}</p>

            {envLoading && (
              <div className="col" style={{ gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {tx('common.loading')}
                </span>
                <div className="ob-skeleton" />
                <div className="ob-skeleton" />
                <div className="ob-skeleton" />
              </div>
            )}

            {!envLoading && env && (
              <>
                <div className={env.ok ? 'ob-ok' : 'ob-warn'}>
                  {env.ok
                    ? `✓ ${tx('onboarding.wizard.environment.allGood')}`
                    : tx('onboarding.wizard.environment.hasIssues')}
                </div>

                <div className="ob-envlist">
                  {env.items.map((i) => (
                    <div key={i.id} className="ob-envrow">
                      <span className={`ob-envdot ${i.status === 'ok' ? 'ok' : 'bad'}`} />
                      <span className="ob-envname">{i.name}</span>
                      <span className="ob-envlevel">
                        {i.level === 'required' ? t('必需') : t('建议')}
                      </span>
                      <span className="ob-envdetail truncate" title={i.detail ?? ''}>
                        {i.status === 'ok' ? (i.detail ?? '') : i.purpose}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!envLoading && missingRequired > 0 && connected.length === 0 && (
              <div className="ob-warn">{tx('onboarding.wizard.environment.needProviderFirst')}</div>
            )}

            {error && <div className="ob-err">{error}</div>}
          </div>
        )}

        {/* ── 第 4 步：完成 + 新手三件事 ── */}
        {step === 'done' && (
          <div className="ob-body">
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'center' }}>
              <Icon name="circle-check" size={34} />
            </div>
            <h2 className="ob-title" style={{ textAlign: 'center' }}>
              {t('一切就绪！')}
            </h2>
            <p className="ob-desc" style={{ textAlign: 'center', maxWidth: 400, margin: '0 auto 14px' }}>
              {t('上手只要三件事，30 秒就能开始第一次建模。')}
            </p>
            <div className="ob-starter-list">
              <div className="ob-starter-row">
                <span className="ob-starter-key mono">#</span>
                <div>
                  <strong>{t('唤起任务面板')}</strong>
                  <span>{t('在输入框敲 # 选择 22 种建模任务，如「全流程论文写作」')}</span>
                </div>
              </div>
              <div className="ob-starter-row">
                <span className="ob-starter-icon"><Icon name="crown" size={13} /></span>
                <div>
                  <strong>{t('左下角头像管理会员')}</strong>
                  <span>{t('会员等级、积分、签到、卡密兑换都在这里')}</span>
                </div>
              </div>
              <div className="ob-starter-row">
                <span className="ob-starter-icon"><Icon name="calendar-days" size={13} /></span>
                <div>
                  <strong>{t('别忘了每日签到')}</strong>
                  <span>{t('会员中心每天可签到领取积分，比赛冲刺期更从容')}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 底部操作 ── */}
        <div className="ob-foot">
          {step !== 'welcome' && stepIndex > 0 && step !== 'done' ? (
            <button
              className="btn btn-sm"
              onClick={() => setStep(STEP_ORDER[Math.max(0, stepIndex - 1)])}
            >
              {tx('onboarding.wizard.back')}
            </button>
          ) : (
            <button className="btn btn-sm" onClick={() => onFinish({ startTour: false })}>
              {tx('onboarding.wizard.model.skip')}
            </button>
          )}

          <div className="grow" />

          {step === 'welcome' && (
            <button className="btn btn-sm btn-primary" onClick={() => setStep('model')}>
              {t('下一步：连接模型')}
            </button>
          )}

          {step === 'model' && (
            <>
              {preset && (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={saving || testing || !apiKey.trim()}
                  onClick={() => void connect()}
                >
                  {saving || testing ? tx('common.loading') : tx('onboarding.wizard.model.connect')}
                </button>
              )}
              {connected.length > 0 && (
                <button className="btn btn-sm" onClick={() => setStep('environment')}>
                  {tx('onboarding.wizard.next')}
                </button>
              )}
            </>
          )}

          {step === 'environment' && (
            <>
              <button className="btn btn-sm" disabled={envLoading} onClick={() => void runEnvCheck()}>
                {tx('common.refresh')}
              </button>
              {missingRequired > 0 && connected.length > 0 && (
                <button className="btn btn-sm" onClick={askAgentToFix}>
                  {tx('onboarding.wizard.environment.fixWithAgent')}
                </button>
              )}
              <button className="btn btn-sm btn-primary" onClick={() => setStep('done')}>
                {tx('onboarding.wizard.next')}
              </button>
            </>
          )}

          {step === 'done' && (
            <>
              <button className="btn btn-sm" onClick={() => onFinish({ startTour: true })}>
                {t('看一遍界面引导')}
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => onFinish({ startTour: false })}
              >
                {t('开始建模')}
              </button>
            </>
          )}
        </div>

        {step === 'model' && connected.length === 0 && preset && (
          <div className="ob-foothint">{tx('onboarding.wizard.model.skipHint')}</div>
        )}
      </div>
    </div>
  );
}

/** 向导是否应自动弹出 */
export function shouldShowOnboarding(settings: AppSettings | null): boolean {
  if (!settings) return false;
  return !settings.onboardingDone;
}
