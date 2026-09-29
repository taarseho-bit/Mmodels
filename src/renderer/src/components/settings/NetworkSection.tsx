/**
 * 设置页 ⑦ 网络
 *
 * 应用约定三块（`settings.proxySection.*`）：
 *   ① 通过代理发送 Agent 流量（开关）
 *   ② 代理来源（下拉：系统代理 / 手动配置）
 *   ③ 当前生效 + 重新检测
 * 说明桌面数据默认保存在本机，以及模型接口等可选网络连接。
 *
 * 代理**真的会生效**：
 *   设置存在 `settings.proxy`（conf）→ `main/store/config.ts` 每次写入都调
 *   `setProxyRuntime()` → `main/agent/env.ts: buildChildEnv()` 注入
 *   HTTP_PROXY/HTTPS_PROXY/NO_PROXY，Agent 会话与它在 Bash 里跑的 git/curl 都会走它。
 *   「重新检测」走 IPC `network:detect-proxy`，系统模式由主进程调
 *   Electron `session.resolveProxy()` —— 渲染层读不到系统代理，只能问主进程。
 */
import { useCallback, useEffect, useState } from 'react';
import type { ProxyDetection, ProxySettings } from '@shared/types';
import { useApp } from '../../store/app';
import { tx, t } from '../../i18n';
import { Icon } from '../Icon';
import { Section, Switch } from './shared';

/** 与 main/store/config.ts 的 DEFAULT_PROXY 保持一致（settings 还没加载出来时的兜底） */
const FALLBACK_PROXY: ProxySettings = { enabled: true, mode: 'system', manualUrl: '' };

export function NetworkSection(): JSX.Element {
  const providers = useApp((s) => s.providers);
  const activeProviderId = useApp((s) => s.settings?.activeProviderId);
  const active = providers.find((p) => p.id === activeProviderId);

  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const cfg: ProxySettings = settings?.proxy ?? FALLBACK_PROXY;

  /** 主进程给出的「当前生效」——点「重新检测」会刷新它 */
  const [detected, setDetected] = useState<ProxyDetection | null>(null);
  const [rechecked, setRechecked] = useState(false);

  const patch = useCallback(
    (p: Partial<ProxySettings>) => {
      void patchSettings({ proxy: { ...cfg, ...p } });
    },
    [cfg, patchSettings],
  );

  const redetect = useCallback(async () => {
    try {
      setDetected(await window.mathmodel.network.detectProxy());
    } catch {
      setDetected({ url: null, source: 'none', unsupported: false });
    }
    setRechecked(true);
    window.setTimeout(() => setRechecked(false), 1600);
  }, []);

  // 进页面就做一次真实检测（系统模式会去问 Electron）
  useEffect(() => {
    void redetect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const socks =
    cfg.mode === 'manual' ? /^socks/i.test(cfg.manualUrl.trim()) : (detected?.unsupported ?? false);

  /** 「当前生效」两行文案 —— 复用应用约定 settings.proxySection.* 词典 */
  const effectiveValue = (): string => {
    if (detected === null) return t('检测中…');
    if (!cfg.enabled) return tx('settings.proxySection.directDisabled');
    if (detected.url) return detected.url;
    return tx('settings.proxySection.directNoProxy');
  };

  const effectiveDetail = (): string => {
    if (detected === null || !cfg.enabled) return '';
    if (detected.unsupported) return tx('settings.proxySection.socksUnsupported');
    if (detected.url && detected.source === 'manual') {
      return tx('settings.proxySection.modeManualDescription');
    }
    if (detected.url && detected.source === 'system') {
      return tx('settings.proxySection.detected', { url: detected.url });
    }
    return tx('settings.proxySection.notDetected');
  };

  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="panel col network-proxy" style={{ padding: 0 }}>
        <div style={{ padding: 14 }}>
          <Switch
            on={cfg.enabled}
            onChange={(v) => patch({ enabled: v })}
            label={tx('settings.proxySection.enabled')}
            hint={tx('settings.proxySection.enabledDescription')}
          />
        </div>

        <div className="divider" style={{ margin: 0 }} />

        <div className="col" style={{ padding: 14, gap: 8 }}>
          <label className="field-label">{tx('settings.proxySection.mode')}</label>
          <select
            className="select"
            style={{ maxWidth: 260 }}
            value={cfg.mode}
            disabled={!cfg.enabled}
            onChange={(e) => patch({ mode: e.target.value === 'manual' ? 'manual' : 'system' })}
          >
            <option value="system">{tx('settings.proxySection.modeSystem')}</option>
            <option value="manual">{tx('settings.proxySection.modeManual')}</option>
          </select>
          <span className="field-hint">
            {cfg.mode === 'manual'
              ? tx('settings.proxySection.modeManualDescription')
              : tx('settings.proxySection.modeSystemDescription')}
          </span>

          {cfg.mode === 'manual' ? (
            <div className="col" style={{ gap: 6, marginTop: 4 }}>
              <label className="field-label">{t('代理地址')}</label>
              <input
                className="input mono"
                style={{ fontSize: 12, maxWidth: 320 }}
                value={cfg.manualUrl}
                disabled={!cfg.enabled}
                placeholder={t('例：http://127.0.0.1:7890')}
                onChange={(e) => patch({ manualUrl: e.target.value })}
              />
              {socks ? <span className="field-hint">{tx('settings.proxySection.socksUnsupported')}</span> : null}
            </div>
          ) : null}
        </div>

        <div className="divider" style={{ margin: 0 }} />

        <div className="row" style={{ padding: 14, gap: 12, alignItems: 'flex-start' }}>
          <div className="col grow" style={{ gap: 3 }}>
            <span className="muted" style={{ fontSize: 11.5 }}>{tx('settings.proxySection.effective')}</span>
            <span style={{ fontSize: 13, fontWeight: 500 }} className="network-proxy-value">
              {effectiveValue()}
            </span>
            {effectiveDetail() ? (
              <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>{effectiveDetail()}</span>
            ) : null}
          </div>
          <button className="btn btn-sm" onClick={() => void redetect()} style={{ flexShrink: 0 }}>
            {`⟳ ${tx('settings.proxySection.redetect')}`}
          </button>
        </div>
        {rechecked ? (
          <div className="muted network-proxy-rechecked" style={{ padding: '0 14px 12px' }}>
            {t('已重新检测')}
          </div>
        ) : null}
      </div>

      <Section title={t('数据与连接')} hint={t('项目文件、会话和配置默认保存在本机；只有启用代理或配置模型供应商后，相关请求才会通过网络发送。')}>
        <div className="panel col" style={{ padding: 14, gap: 8, fontSize: 12.5, lineHeight: 1.8 }}>
          <div className="row" style={{ gap: 8 }}>
            <Icon name="shield-check" size={14} className="network-localnote-icon" />
            <span>{t('会话、统计、模板配置、队伍档案全部保存在本机用户数据目录。')}</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Icon name="activity" size={14} className="network-localnote-icon" />
            <span>
              {t('模型请求会发送到你选择的供应商接口')}
              {active ? (
                <span className="mono">{t('（当前：{{url}}）', { url: active.baseUrl })}</span>
              ) : (
                t('（尚未配置供应商）')
              )}
              {t('。')}
            </span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Icon name="circle-slash" size={14} className="network-localnote-icon" />
            <span>{t('不配置供应商时，应用仍可使用本地项目、文件管理和环境检查；网络能力按你的配置启用。')}</span>
          </div>
        </div>
      </Section>
    </div>
  );
}
