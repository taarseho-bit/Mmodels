/**
 * 设置页 ⑤ 供应商
 *
 * 结构与原版 `ProviderManager`（SettingsPage chunk）对齐：
 *   ① 「已连接的供应商」卡 —— 图标 + 名称 + 状态徽标 + baseUrl + 编辑 / 断开连接
 *   ② 「添加供应商」卡 —— 说明 + 「对话供应商」小节 + 15 行预设（图标 + 名称 + 推荐徽标 + 描述 + 「+ 连接」）
 *
 * 预设目录与原版 `PRESETS` 数组逐字对齐（名称 / 描述 i18n 键 / 协议 / baseURL / 默认模型 / 推荐标记）。
 * 原版 16 项口径 = 15 行预设 + 1 张已连接卡。
 */
import { useCallback, useMemo, useState } from 'react';
import type { AnthropicAuthMode, ApiFormat, ProviderConfig } from '@shared/types';
import { useApp } from '../../store/app';
import { tx, t } from '../../i18n';
import { Icon } from '../Icon';
import { friendlyError } from '../../lib/friendly-error';

/** 生成一个本地 id（不需要后端参与） */
function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 品牌键 —— 决定图标底色与形状（色值取自原版品牌色表 `dU`） */
type BrandKey =
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'moonshotai'
  | 'zhipuai'
  | 'alibaba'
  | 'minimax'
  | 'volcengine'
  | 'tencent'
  | 'xiaomi';

/** 品牌样式表（色值逐字取自原版 `dU`；tencent / xiaomi 取自原版图标默认色） */
const BRAND: Record<BrandKey, { color: string; text: string; round?: boolean }> = {
  anthropic: { color: '#d97757', text: 'AI' },
  openai: { color: '#10a37f', text: 'O', round: true },
  deepseek: { color: '#4d6bfe', text: 'D', round: true },
  moonshotai: { color: '#7c66ff', text: 'M', round: true },
  zhipuai: { color: '#3b6ffb', text: 'Z' },
  alibaba: { color: '#615ced', text: 'Q' },
  minimax: { color: '#ee4d3d', text: 'M', round: true },
  volcengine: { color: '#006eff', text: 'V' },
  tencent: { color: '#0052d9', text: 'T' },
  xiaomi: { color: '#ff6900', text: 'X' },
};

interface ProviderPreset {
  key: string;
  /** 展示名（原版硬编码的产品名；OpenAI 兼容走原版 i18n 键） */
  name: string;
  /** 名称是否走 i18n 键 */
  nameKey?: string;
  /** 描述 —— 原版 `settings.providerPresets.*` 键 */
  descKey: string;
  brand: BrandKey;
  apiFormat: ApiFormat;
  baseUrl: string;
  anthropicAuthMode: AnthropicAuthMode;
  /** 原版 `default_models`（无则空数组） */
  defaultModels: string[];
  recommended?: boolean;
  /** 需要用户自己填接口地址（中转站 / 本机 CLI） */
  needsBaseUrl?: boolean;
  /** 控制台申请地址 */
  consoleUrl?: string;
}

/** 原版 PRESETS（对话供应商 15 行，顺序一致） */
const PRESETS: ProviderPreset[] = [
  {
    key: 'deepseek',
    name: 'DeepSeek',
    descKey: 'settings.providerPresets.deepseek',
    brand: 'deepseek',
    apiFormat: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    anthropicAuthMode: 'apiKey',
    defaultModels: ['deepseek-flash', 'deepseek-v4-pro'],
    recommended: true,
    consoleUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    key: 'anthropic-thirdparty',
    name: 'Anthropic Third-party API',
    descKey: 'settings.providerPresets.anthropicThirdparty',
    brand: 'anthropic',
    apiFormat: 'anthropic',
    baseUrl: '',
    anthropicAuthMode: 'authToken',
    defaultModels: [],
    recommended: true,
    needsBaseUrl: true,
  },
  {
    key: 'openai-compatible',
    name: 'OpenAI 兼容 API',
    nameKey: 'settings.providerPresets.openaiCompatibleName',
    descKey: 'settings.providerPresets.openaiCompatible',
    brand: 'openai',
    apiFormat: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    anthropicAuthMode: 'apiKey',
    defaultModels: [],
  },
  {
    key: 'openai-codex',
    name: 'OpenAI Codex',
    descKey: 'settings.providerPresets.openaiCodex',
    brand: 'openai',
    apiFormat: 'openai',
    baseUrl: '',
    anthropicAuthMode: 'apiKey',
    defaultModels: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'],
    needsBaseUrl: true,
  },
  {
    key: 'anthropic-official',
    name: 'Anthropic',
    descKey: 'settings.providerPresets.anthropicOfficial',
    brand: 'anthropic',
    apiFormat: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    anthropicAuthMode: 'apiKey',
    defaultModels: [],
    consoleUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    key: 'glm-cn',
    name: 'GLM (CN)',
    descKey: 'settings.providerPresets.glmCn',
    brand: 'zhipuai',
    apiFormat: 'anthropic',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    anthropicAuthMode: 'apiKey',
    defaultModels: [],
    consoleUrl: 'https://open.bigmodel.cn',
  },
  {
    key: 'glm-global',
    name: 'GLM (Global)',
    descKey: 'settings.providerPresets.glmGlobal',
    brand: 'zhipuai',
    apiFormat: 'anthropic',
    baseUrl: 'https://api.z.ai/api/anthropic',
    anthropicAuthMode: 'apiKey',
    defaultModels: [],
    consoleUrl: 'https://z.ai',
  },
  {
    key: 'kimi',
    name: 'Kimi Coding Plan',
    descKey: 'settings.providerPresets.kimi',
    brand: 'moonshotai',
    apiFormat: 'anthropic',
    baseUrl: 'https://api.kimi.com/coding/',
    anthropicAuthMode: 'authToken',
    defaultModels: ['k3', 'k3-256k', 'kimi-for-coding', 'kimi-for-coding-highspeed'],
    consoleUrl: 'https://www.kimi.com',
  },
  {
    key: 'moonshot',
    name: 'Moonshot',
    descKey: 'settings.providerPresets.moonshot',
    brand: 'moonshotai',
    apiFormat: 'anthropic',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    anthropicAuthMode: 'apiKey',
    defaultModels: [],
    consoleUrl: 'https://platform.moonshot.cn/console',
  },
  {
    key: 'minimax-cn',
    name: 'MiniMax (CN)',
    descKey: 'settings.providerPresets.minimaxCn',
    brand: 'minimax',
    apiFormat: 'anthropic',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    anthropicAuthMode: 'authToken',
    defaultModels: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5'],
    consoleUrl: 'https://platform.minimaxi.com',
  },
  {
    key: 'minimax-global',
    name: 'MiniMax (Global)',
    descKey: 'settings.providerPresets.minimaxGlobal',
    brand: 'minimax',
    apiFormat: 'anthropic',
    baseUrl: 'https://api.minimax.io/anthropic',
    anthropicAuthMode: 'authToken',
    defaultModels: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5'],
    consoleUrl: 'https://www.minimax.io/platform',
  },
  {
    key: 'bailian',
    name: 'Aliyun Bailian',
    descKey: 'settings.providerPresets.bailian',
    brand: 'alibaba',
    apiFormat: 'anthropic',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    anthropicAuthMode: 'apiKey',
    defaultModels: ['qwen3.7-plus', 'qwen3.6-plus', 'kimi-k2.5', 'glm-5', 'MiniMax-M2.5'],
    consoleUrl: 'https://bailian.console.aliyun.com',
  },
  {
    key: 'volcano-ark',
    name: 'Volcano Ark Coding Plan',
    descKey: 'settings.providerPresets.volcanoArk',
    brand: 'volcengine',
    apiFormat: 'anthropic',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    anthropicAuthMode: 'authToken',
    defaultModels: ['ark-code-latest', 'doubao-seed-2.0-code'],
    consoleUrl: 'https://console.volcengine.com/ark',
  },
  {
    key: 'tencent-tokenhub',
    name: 'Tencent TokenHub',
    descKey: 'settings.providerPresets.tencentTokenHub',
    brand: 'tencent',
    apiFormat: 'anthropic',
    baseUrl: 'https://tokenhub.tencentmaas.com',
    anthropicAuthMode: 'authToken',
    defaultModels: [
      'hy3',
      'deepseek/deepseek-v4-pro',
      'glm-5.3',
      'kimi-k3',
      'minimax-m3',
      'qwen3.5-plus',
      'mimo-v2.5-pro',
    ],
    consoleUrl: 'https://console.cloud.tencent.com/tokenhub',
  },
  {
    key: 'xiaomi-mimo',
    name: 'Xiaomi MiMo',
    descKey: 'settings.providerPresets.xiaomiMimo',
    brand: 'xiaomi',
    apiFormat: 'anthropic',
    baseUrl: 'https://api.xiaomimimo.com/anthropic',
    anthropicAuthMode: 'apiKey',
    defaultModels: ['mimo-v2.5-pro', 'mimo-v2.5'],
    consoleUrl: 'https://platform.xiaomimimo.com',
  },
];

/** 品牌徽标（原版为品牌 SVG，这里用同色首字母占位；形状与色值对齐原版） */
function BrandMark({ brand }: { brand: BrandKey }): JSX.Element {
  const b = BRAND[brand];
  return (
    <span
      className={`provider-brand${b.round ? ' provider-brand-round' : ''}`}
      style={{ background: b.color, fontSize: b.text.length > 1 ? 8.5 : 10.5 }}
      aria-hidden="true"
    >
      {b.text}
    </span>
  );
}

/** 按名称 / baseUrl 反查预设（原版 `resolvePreset` 的简化版） */
function brandOf(p: Pick<ProviderConfig, 'name' | 'baseUrl'>): BrandKey {
  const key = `${p.name} ${p.baseUrl}`.toLowerCase();
  if (/anthropic|claude/.test(key)) return 'anthropic';
  if (/openai|codex|api\.openai/.test(key)) return 'openai';
  if (/deepseek/.test(key)) return 'deepseek';
  if (/kimi|moonshot/.test(key)) return 'moonshotai';
  if (/glm|zhipu|bigmodel|z\.ai/.test(key)) return 'zhipuai';
  if (/minimax/.test(key)) return 'minimax';
  if (/bailian|dashscope|aliyun|qwen|tongyi/.test(key)) return 'alibaba';
  if (/volc|ark\.cn|doubao/.test(key)) return 'volcengine';
  if (/tokenhub|tencent|hunyuan/.test(key)) return 'tencent';
  if (/mimo|xiaomi/.test(key)) return 'xiaomi';
  return 'anthropic';
}

/** 已连接卡状态徽标 —— 有密钥或本地端点视为「已配置」 */
function isConfigured(p: ProviderConfig): boolean {
  return p.apiKey.trim() !== '' || /127\.0\.0\.1|localhost/.test(p.baseUrl);
}

export function ProvidersSection(): JSX.Element {
  const providers = useApp((s) => s.providers);
  const settings = useApp((s) => s.settings);
  const refreshProviders = useApp((s) => s.refreshProviders);
  const patchSettings = useApp((s) => s.patchSettings);

  const [editing, setEditing] = useState<ProviderConfig | null>(null);
  /** 从预设进入编辑态时记录预设名（用于「连接 xxx」标题与字段提示） */
  const [preset, setPreset] = useState<ProviderPreset | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [fastModeModels, setFastModeModels] = useState<string[]>([]);
  const [discoveringModels, setDiscoveringModels] = useState(false);

  /** 原版：已连接列表按名称排序 */
  const connected = useMemo(
    () => [...providers].sort((a, b) => a.name.localeCompare(b.name)),
    [providers],
  );

  const activeProvider = providers.find((p) => p.id === settings?.activeProviderId) ?? null;
  const editingExisting = !!editing && providers.some((p) => p.id === editing.id);

  const fromPreset = useCallback((p: ProviderPreset) => {
    setError(null);
    setPreset(p);
    setModels(p.defaultModels.slice());
    setFastModeModels([]);
    setEditing({
      id: newId(),
      name: p.nameKey ? tx(p.nameKey) : p.name,
      apiFormat: p.apiFormat,
      baseUrl: p.baseUrl,
      apiKey: '',
      anthropicAuthMode: p.anthropicAuthMode,
      models: p.defaultModels.slice(),
      enabled: true,
    });
  }, []);

  const editExisting = useCallback((p: ProviderConfig) => {
    setError(null);
    setPreset(null);
    setModels(p.models ?? []);
    setFastModeModels(p.fastModeModels ?? []);
    setEditing({ ...p });
  }, []);

  const closeForm = useCallback(() => {
    setEditing(null);
    setPreset(null);
    setModels([]);
    setFastModeModels([]);
    setError(null);
  }, []);

  const save = useCallback(async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      setError(tx('settings.providerForm.nameRequired'));
      return;
    }
    if (!editing.baseUrl.trim()) {
      setError(tx('settings.presetConnectDialog.baseUrlRequired'));
      return;
    }
    if (!editing.apiKey.trim() && !/127\.0\.0\.1|localhost/.test(editing.baseUrl)) {
      setError(tx('settings.providerForm.apiKeyRequired'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const list = await window.mathmodel.llm.upsertProvider({
        ...editing,
        name: editing.name.trim(),
        baseUrl: editing.baseUrl.trim().replace(/\/+$/, ''),
        apiKey: editing.apiKey.trim(),
        models: models.filter((m) => m.trim()),
        fastModeModels: fastModeModels.filter((m) => m.trim()),
      });
      useApp.setState({ providers: list });

      if (!settings?.activeProviderId) {
        await patchSettings({ activeProviderId: editing.id, defaultModel: models[0] ?? null });
      }
      closeForm();
      await refreshProviders();
    } catch (e) {
      setError(friendlyError(e, '供应商设置没有保存成功，可以重试。'));
    } finally {
      setSaving(false);
    }
  }, [editing, models, fastModeModels, patchSettings, refreshProviders, settings?.activeProviderId, closeForm]);

  const remove = useCallback(
    async (p: ProviderConfig) => {
      if (!window.confirm(t('断开与「{{name}}」的连接？', { name: p.name }))) return;
      const list = await window.mathmodel.llm.deleteProvider(p.id);
      useApp.setState({ providers: list });
      if (settings?.activeProviderId === p.id) {
        await patchSettings({ activeProviderId: null, defaultModel: null });
      }
    },
    [patchSettings, settings?.activeProviderId],
  );

  const test = useCallback(async (id: string) => {
    setTesting(id);
    try {
      const r = await window.mathmodel.llm.testProvider(id);
      setTestResult((prev) => ({ ...prev, [id]: r }));
    } catch (e) {
      setTestResult((prev) => ({
        ...prev,
        [id]: { ok: false, detail: friendlyError(e, '连接测试没有完成，可以重试。') },
      }));
    } finally {
      setTesting(null);
    }
  }, []);

  const discoverModels = useCallback(async () => {
    if (!editing) return;
    // 2026-09-25：填好 Base URL + 密钥就能直接拉，不必先保存（内联配置走临时通道）。
    if (!editingExisting && (!editing.baseUrl.trim() || !editing.apiKey.trim())) {
      setError(t('先填写接口基址和 API Key，再读取该接口下可用的模型。'));
      return;
    }
    setDiscoveringModels(true);
    setError(null);
    try {
      const found = editingExisting
        ? await window.mathmodel.llm.listModels(editing.id, true)
        : await window.mathmodel.llm.listModels(editing.id, true, {
            ...editing,
            baseUrl: editing.baseUrl.trim().replace(/\/+$/, ''),
            apiKey: editing.apiKey.trim(),
            models: [],
          });
      if (!found.length) {
        setError(t('接口没有返回模型列表，请检查地址、密钥或手动添加模型。'));
        return;
      }
      setModels(found);
    } catch (e) {
      setError(friendlyError(e, '读取模型没有完成，可以重试。'));
    } finally {
      setDiscoveringModels(false);
    }
  }, [editing, editingExisting]);

  // ── 编辑态 ──
  if (editing) {
    return (
      <div className="col" style={{ gap: 18 }}>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <button className="btn btn-sm btn-ghost" onClick={closeForm}>
            {t('← 返回')}
          </button>
          <span className="page-title" style={{ fontSize: 13 }}>
            {editingExisting
              ? tx('settings.providerForm.editTitle')
              : preset
                ? tx('settings.presetConnectDialog.connectTitle', { name: editing.name })
                : tx('settings.providerForm.addTitle')}
          </span>
        </div>

        <p className="provider-card-desc">
          {editingExisting
            ? tx('settings.providerForm.editDescription')
            : tx('settings.providerForm.addDescription')}
        </p>

        {error && (
          <div className="panel" style={{ padding: 12, color: 'var(--danger)', fontSize: 12.5 }}>
            {error}
          </div>
        )}

        {preset?.key === 'anthropic-thirdparty' && (
          <div className="panel provider-hint" style={{ padding: 12, fontSize: 12 }}>
            {tx('settings.presetConnectDialog.relayHint')}
          </div>
        )}

        {preset?.key === 'openai-codex' && (
          <div className="panel provider-hint" style={{ padding: 12, fontSize: 12 }}>
            {t('本机 Codex CLI 不签发 API Key：接口地址请填本机 CLI 暴露的端点（http://127.0.0.1:<端口>/v1），密钥留空即可。')}
          </div>
        )}

        {preset?.key === 'openai-compatible' && (
          <div className="panel provider-hint" style={{ padding: 12, fontSize: 12 }}>
            {tx('settings.presetConnectDialog.openaiCompatibleHint')}
          </div>
        )}

        <div className="field">
          <label className="field-label">{tx('settings.providerForm.name')}</label>
          <input
            className="input"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            placeholder={tx('settings.providerForm.namePlaceholder')}
          />
        </div>

        <div className="field">
          <label className="field-label">{t('接口基址（Base URL）')}</label>
          <input
            className="input mono"
            style={{ fontSize: 12 }}
            value={editing.baseUrl}
            onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
            placeholder="https://api.anthropic.com"
          />
          <div className="field-hint">
            {tx('settings.providerConfiguration.url-models')}
          </div>
        </div>

        <div className="field">
          <label className="field-label">{tx('settings.providerManager.apiKey')}</label>
          <input
            className="input mono"
            style={{ fontSize: 12 }}
            type="password"
            value={editing.apiKey}
            onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
            placeholder={editingExisting ? tx('settings.providerForm.maskedKeyPlaceholder') : 'sk-...'}
          />
          <div className="field-hint">
            {t('密钥保存在本机用户数据目录，不会写进项目、也不会随项目分享出去。')}
          </div>
        </div>

        {editing.apiFormat === 'anthropic' && (
          <div className="field">
            <label className="field-label">{tx('settings.providerConnection.authMode')}</label>
            <select
              className="select"
              value={editing.anthropicAuthMode ?? 'apiKey'}
              onChange={(e) =>
                setEditing({ ...editing, anthropicAuthMode: e.target.value as AnthropicAuthMode })
              }
            >
              <option value="authToken">ANTHROPIC_AUTH_TOKEN (Bearer)</option>
              <option value="apiKey">ANTHROPIC_API_KEY (x-api-key)</option>
            </select>
            <div className="field-hint">{tx('settings.providerConnection.authHint')}</div>
          </div>
        )}

        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <label className="field-label">{tx('settings.modelListEditor.models')}</label>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={discoveringModels}
              onClick={() => void discoverModels()}
              title={t('从 OpenAI /models 或 Anthropic /v1/models 自动读取；填好基址和密钥即可，无需先保存')}
            >
              {discoveringModels ? t('读取中…') : t('自动发现模型')}
            </button>
          </div>
          <div className="col" style={{ gap: 6 }}>
            {models.map((m, i) => (
              <div key={i} className="row" style={{ gap: 6 }}>
                <input
                  className="input mono grow"
                  style={{ fontSize: 12 }}
                  value={m}
                  onChange={(e) => {
                    const next = models.slice();
                    next[i] = e.target.value;
                    setModels(next);
                  }}
                  placeholder={tx('settings.modelListEditor.placeholder')}
                />
                <select className="input" style={{ width:150 }} aria-label={`${m} 上下文容量`}
                  value={editing.contextWindows?.[m.trim()] ?? 0}
                  onChange={e => {
                    const windows = { ...editing.contextWindows }; const amount = Number(e.target.value);
                    if (amount) windows[m.trim()] = amount; else delete windows[m.trim()];
                    setEditing({ ...editing, contextWindows: windows });
                  }}>
                  <option value={0}>自动 · 上限1M</option><option value={128000}>128K</option><option value={200000}>200K</option><option value={300000}>300K</option><option value={1000000}>1M</option>
                </select>
                <button
                  className="btn btn-sm btn-ghost"
                  title={tx('settings.modelListEditor.removeModel', { name: m })}
                  onClick={() => setModels(models.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${fastModeModels.includes(m.trim()) ? 'btn-primary' : 'btn-ghost'}`}
                  title={t('支持快速模式的模型')}
                  aria-label={t('支持快速模式的模型')}
                  aria-pressed={fastModeModels.includes(m.trim())}
                  disabled={!m.trim()}
                  onClick={() => {
                    const id = m.trim();
                    setFastModeModels((prev) =>
                      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                    );
                  }}
                >
                  <Icon name="zap" size={13} />
                </button>
              </div>
            ))}
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={() => setModels([...models, ''])}>
                {t('＋ 添加模型')}
              </button>
            </div>
            <div className="field-hint">
              {t('保存供应商后可自动读取接口支持的多个模型；OpenAI 兼容接口使用 /models，Anthropic 兼容接口使用 /v1/models。')}
              <br />
              容量是模型一次能参考的内容，不是消费额度。最大1M；请按接口实际能力选择，修改数字不会扩容模型。未知型号以运行器参考值显示。旧名称 deepseek-chat 建议在确认后改用官方当前名称 deepseek-flash。
              <br />
              {t('列表里的第一个会成为该供应商的默认模型。点击闪电可声明该模型支持快速模式。')}
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 8, paddingTop: 6 }}>
          <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving
              ? tx('settings.providerForm.saving')
              : editingExisting
                ? tx('settings.providerForm.update')
                : tx('settings.providerManager.connect')}
          </button>
          <button className="btn btn-ghost" onClick={closeForm}>
            {tx('common.cancel')}
          </button>
        </div>
      </div>
    );
  }

  // ── 列表态 ──
  return (
    <div className="col" style={{ gap: 18 }}>
      {/* ① 已连接的供应商 */}
      <section className="panel col" style={{ padding: 16, gap: 4 }}>
        <h3 className="provider-card-title">{tx('settings.providerManager.connectedProviders')}</h3>

        {connected.length === 0 && (
          <p className="provider-empty">{tx('settings.providerManager.empty')}</p>
        )}

        {connected.map((p) => {
          const r = testResult[p.id];
          return (
            <div key={p.id} className="provider-row">
              <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                <div className="provider-row-icon">
                  <BrandMark brand={brandOf(p)} />
                </div>
                <div className="provider-row-main">
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <span className="provider-name truncate">{p.name}</span>
                    <span className="provider-state-badge">
                      {isConfigured(p)
                        ? tx('settings.providerManager.configured')
                        : tx('settings.providerManager.apiKey')}
                    </span>
                  </div>
                  {p.baseUrl && <p className="provider-base truncate">{p.baseUrl}</p>}
                  {r && (
                    <p className={r.ok ? 'provider-test-ok' : 'provider-test-fail'}>
                      {r.ok ? '✓ ' : '✕ '}
                      {r.detail}
                    </p>
                  )}
                </div>
                <div className="row provider-row-actions">
                  {!r && (
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={testing === p.id}
                      onClick={() => void test(p.id)}
                    >
                      {testing === p.id
                        ? tx('settings.providerConnection.checking')
                        : tx('settings.providerConnection.check')}
                    </button>
                  )}
                  <button
                    className="provider-icon-btn"
                    title={tx('common.edit')}
                    aria-label={tx('common.edit')}
                    onClick={() => editExisting(p)}
                  >
                    <Icon name="pencil" size={12} />
                  </button>
                  <button className="provider-disconnect" onClick={() => void remove(p)}>
                    {tx('settings.providerManager.disconnect')}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* ② 添加供应商 */}
      <section className="panel col" style={{ padding: 16, gap: 4 }} data-tour="provider-presets">
        <h3 className="provider-card-title">{tx('settings.providerManager.addProvider')}</h3>
        <p className="provider-card-desc">{tx('settings.providerManager.addDescription')}</p>

        <h4 className="provider-group-title">{tx('settings.providerManager.chatProviders')}</h4>

        {PRESETS.map((p) => (
          <div key={p.key} className="provider-row">
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              <div className="provider-row-icon">
                <BrandMark brand={p.brand} />
              </div>
              <div className="provider-row-main">
                <span className="provider-name truncate">
                  {p.nameKey ? tx(p.nameKey) : p.name}
                  {p.recommended && (
                    <span className="provider-pill-recommended">
                      {tx('settings.providerManager.recommended')}
                    </span>
                  )}
                </span>
                <p className="provider-desc truncate">{tx(p.descKey)}</p>
                <p className="provider-desc">
                  {p.key === 'openai-compatible'
                    ? t('万能模式：兼容 OpenAI /models，可接入大多数国产与本地服务。')
                    : p.key === 'anthropic-thirdparty'
                      ? t('万能模式：兼容 Anthropic /v1/models，可接入第三方中转服务。')
                      : null}
                  {p.consoleUrl && (
                    <a className="provider-console-link" href={p.consoleUrl} target="_blank" rel="noreferrer">
                      {t('打开官网')} ↗
                    </a>
                  )}
                </p>
              </div>
              <button className="provider-connect" onClick={() => fromPreset(p)}>
                <Icon name="plus" size={14} />
                {tx('settings.providerManager.connect')}
              </button>
            </div>
          </div>
        ))}
      </section>

      {activeProvider && (
        <p className="muted" style={{ fontSize: 11 }}>
          {t('对话中正在使用：{{name}}', { name: activeProvider.name })}
        </p>
      )}
    </div>
  );
}
