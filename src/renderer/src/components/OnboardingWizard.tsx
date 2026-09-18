/**
 * 首次运行向导 —— 复刻原版 `OnboardingWizard`。
 *
 * 三步（文案逐字取自 `onboarding.wizard.*`）：
 *   1. 连接模型   —— 选供应商 + 填 API Key + 测试连接
 *   2. 检查运行环境 —— 展示 env:check 结果，可交给 Agent 安装
 *   3. 开始使用
 *
 * ⚠️ 与原版的差异：原版第一步内嵌了账号登录与「DeepSeek 官方充值」入口，
 *    本复刻按既定要求**去掉账号与计费**，只保留「选供应商 + 填 Key」这条纯 API Key 路径。
 */
import { useCallback, useEffect, useState } from 'react';
import type { PresetProvider, ProviderConfig, AppSettings } from '@shared/types';
import { useApp } from '../store/app';
import { Icon } from './Icon';
import { t, tx } from '../i18n';

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

type Step = 'model' | 'environment' | 'done';

const STEP_ORDER: Step[] = ['model', 'environment', 'done'];

export function OnboardingWizard({
  onClose,
  onFinish,
}: {
  onClose: () => void;
  /** 完成向导（写入 onboardingDone 并可选启动引导巡览） */
  onFinish: (opts: { startTour: boolean }) => void;
}): JSX.Element {
  const [step, setStep] = useState<Step>('model');
  const stepIndex = STEP_ORDER.indexOf(step);

  // ── 第一步：模型 ──
  const [presets, setPresets] = useState<PresetProvider[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [picked, setPicked] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fillPrompt = useApp((s) => s.fillPrompt);

  // ── 第二步：环境 ──
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
        // 已有可用供应商就直接跳到下一步，别让用户重复填
        if (ls.some((p) => p.enabled !== false)) setStep('environment');
        else setPicked(ps[0]?.key ?? '');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
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
      setError(e instanceof Error ? e.message : String(e));
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
        setTestResult({ ok: false, detail: e instanceof Error ? e.message : String(e) });
      } finally {
        setTesting(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  /** 把「让 Agent 装环境」的指令填进输入框（原版行为） */
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

  const missingRequired = env?.missingRequired ?? 0;

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="ob-card" onClick={(e) => e.stopPropagation()}>
        {/* ── 头部：步骤指示 ── */}
        <div className="ob-head">
          <div className="ob-steps">
            {STEP_ORDER.map((s, i) => (
              <span key={s} className={`ob-dot${i <= stepIndex ? ' on' : ''}`} />
            ))}
          </div>
          <span className="muted" style={{ fontSize: 11 }}>
            {tx('onboarding.wizard.stepLabel', {
              current: stepIndex + 1,
              total: STEP_ORDER.length,
            })}
          </span>
          <div className="grow" />
          <button className="btn btn-sm btn-ghost" onClick={onClose} title={tx('common.close')}>
            ✕
          </button>
        </div>

        {/* ── 第 1 步：连接模型 ── */}
        {step === 'model' && (
          <div className="ob-body">
            <h2 className="ob-title">{tx('onboarding.wizard.model.title')}</h2>
            <p className="ob-desc">{tx('onboarding.wizard.model.description')}</p>

            <div className="ob-presets">
              {presets.map((p) => (
                <button
                  key={p.key}
                  className={`ob-preset${picked === p.key ? ' active' : ''}`}
                  onClick={() => setPicked(p.key)}
                >
                  <span className="ob-preset-name">
                    {p.name}
                    {/* 原版对首个预设标「推荐」 */}
                    {p.key === presets[0]?.key ? (
                      <span className="ob-rec">{tx('onboarding.wizard.model.recommended')}</span>
                    ) : null}
                  </span>
                  <span className="ob-preset-note">{p.note ?? p.defaultModel}</span>
                </button>
              ))}
            </div>

            {preset && (
              <div className="col" style={{ gap: 6, marginTop: 12 }}>
                <label className="field-label">API Key</label>
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  placeholder={preset.key === 'deepseek' ? 'sk-...' : '粘贴服务商提供的 API Key'}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <span className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
                  接口地址：<span className="mono">{preset.baseUrl}</span> · 默认模型{' '}
                  <span className="mono">{preset.defaultModel}</span>
                </span>
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

        {/* ── 第 2 步：检查运行环境 ── */}
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

        {/* ── 第 3 步：开始使用 ── */}
        {step === 'done' && (
          <div className="ob-body" style={{ textAlign: 'center', paddingTop: 28 }}>
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'center' }}>
              <Icon name="circle-check" size={34} />
            </div>
            <h2 className="ob-title" style={{ marginBottom: 8 }}>
              {tx('onboarding.wizard.finish')}
            </h2>
            <p className="ob-desc" style={{ maxWidth: 380, margin: '0 auto' }}>
              {tx('onboarding.tour.steps.composer.description')}
            </p>
          </div>
        )}

        {/* ── 底部操作 ── */}
        <div className="ob-foot">
          {step !== 'model' && stepIndex > 0 && step !== 'done' ? (
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
                {tx('onboarding.wizard.finish')}
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
