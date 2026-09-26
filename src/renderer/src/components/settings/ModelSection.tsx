/**
 * 设置页 ④ 模型
 *
 * 项目契约结构（SettingsPage chunk 中 `o==="models"` 分支）：
 *   ① 分区右上「+ 添加自定义模型」按钮
 *   ② 两行下拉 —— 当前供应商 / 当前模型（左标题+说明、右下拉）
 *   ③ 「添加自定义模型」弹窗（供应商下拉 + 模型 ID 输入 + 校验）
 *
 * 当前实现原有的自创区块（模型名 / 推理强度 effort / 关闭思考 / 内置 MCP）
 * 保留功能、整体下移，收在同分区末尾的「本地附加项」里（项目契约无这些控件）。
 */
import { useCallback, useMemo, useState } from 'react';
import type { ProviderConfig } from '@shared/types';
import { useApp } from '../../store/app';
import { tx, t } from '../../i18n';
import { Icon } from '../Icon';
import { Section, Switch } from './shared';
import { friendlyError } from '../../lib/friendly-error';

/** 模型 ID 校验 —— 项目契约 zod 规则：非空且不含空格 / 逗号 */
function isValidModelId(v: string): boolean {
  return v.trim() !== '' && !/[\s,]/.test(v.trim());
}

function Row({
  title,
  description,
  control,
}: {
  title: string;
  description: string;
  control: React.ReactNode;
}): JSX.Element {
  return (
    <div className="model-row">
      <div className="model-row-main">
        <span className="model-row-title">{title}</span>
        <span className="model-row-desc">{description}</span>
      </div>
      <div className="model-row-control">{control}</div>
    </div>
  );
}

/** 「添加自定义模型」弹窗 —— 名称输入 + 加入模型列表 + 删除已有模型 */
function AddCustomModelDialog({
  providers,
  activeProviderId,
  onClose,
}: {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  onClose: () => void;
}): JSX.Element {
  const patchSettings = useApp((s) => s.patchSettings);
  const refreshProviders = useApp((s) => s.refreshProviders);

  const [providerId, setProviderId] = useState(activeProviderId ?? providers[0]?.id ?? '');
  const [modelId, setModelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = providers.find((p) => p.id === providerId) ?? null;
  const models = useMemo(() => provider?.models ?? [], [provider]);
  const invalid = modelId.trim() !== '' && !isValidModelId(modelId);
  const already = models.includes(modelId.trim());

  const persist = useCallback(
    async (p: ProviderConfig, next: string[]) => {
      const list = await window.mathmodel.llm.upsertProvider({ ...p, models: next });
      useApp.setState({ providers: list });
      await refreshProviders();
    },
    [refreshProviders],
  );

  const submit = useCallback(async () => {
    if (!provider) {
      setError(tx('settings.customModelDialog.providerUnavailable'));
      return;
    }
    if (!isValidModelId(modelId)) {
      setError(tx('settings.customModelDialog.invalidModelId'));
      return;
    }
    const id = modelId.trim();
    setBusy(true);
    setError(null);
    try {
      if (!models.includes(id)) await persist(provider, [...models, id]);
      await patchSettings({ activeProviderId: provider.id, defaultModel: id });
      onClose();
    } catch (e) {
      setError(friendlyError(e, '模型设置没有保存成功，可以重试。'));
    } finally {
      setBusy(false);
    }
  }, [provider, modelId, models, persist, patchSettings, onClose]);

  const removeModel = useCallback(
    async (name: string) => {
      if (!provider) return;
      setBusy(true);
      setError(null);
      try {
        const next = models.filter((m) => m !== name);
        await persist(provider, next);
        // 删掉的正好是当前模型 → 回退到列表第一个（或清空）
        if (useApp.getState().settings?.defaultModel === name) {
          await patchSettings({ defaultModel: next[0] ?? null });
        }
      } catch (e) {
      setError(friendlyError(e, '模型设置没有更新成功，可以重试。'));
      } finally {
        setBusy(false);
      }
    },
    [provider, models, persist, patchSettings],
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(28rem, calc(100vw - 2rem))' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{tx('settings.customModelDialog.addCustomModel')}</span>
        </div>

        <div className="modal-body col" style={{ gap: 16 }}>
          <p className="model-row-desc" style={{ margin: 0 }}>
            {tx('settings.customModelDialog.customModelHint')}
          </p>

          <div className="field">
            <label className="field-label">{tx('settings.customModelDialog.provider')}</label>
            <select
              className="select"
              value={providerId}
              onChange={(e) => {
                setProviderId(e.target.value);
                setError(null);
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label">{tx('settings.customModelDialog.modelId')}</label>
            <input
              className="input mono"
              style={{ fontSize: 12 }}
              autoFocus
              spellCheck={false}
              value={modelId}
              placeholder={tx('settings.customModelDialog.modelIdPlaceholder')}
              onChange={(e) => setModelId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit();
              }}
            />
            <div className="field-hint">{tx('settings.customModelDialog.customModelAvailability')}</div>
          </div>

          {models.length > 0 && (
            <div className="field">
              <label className="field-label">{tx('settings.modelListEditor.models')}</label>
              <div className="col" style={{ gap: 4 }}>
                {models.map((m) => (
                  <div key={m} className="row model-list-item">
                    <span className="mono truncate grow" style={{ fontSize: 11.5 }}>
                      {m}
                    </span>
                    <button
                      className="provider-icon-btn"
                      disabled={busy}
                      title={tx('settings.modelListEditor.removeModel', { name: m })}
                      aria-label={tx('settings.modelListEditor.removeModel', { name: m })}
                      onClick={() => void removeModel(m)}
                    >
                      <Icon name="trash-2" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {invalid && (
            <p role="alert" className="provider-test-fail" style={{ margin: 0 }}>
              {tx('settings.customModelDialog.invalidModelId')}
            </p>
          )}
          {error && (
            <p role="alert" className="provider-test-fail" style={{ margin: 0 }}>
              {error}
            </p>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={onClose}>
            {tx('common.cancel')}
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || !provider || !isValidModelId(modelId)}
            onClick={() => void submit()}
          >
            {busy
              ? tx('settings.customModelDialog.savingModel')
              : already
                ? tx('settings.customModelDialog.useModel')
                : tx('settings.customModelDialog.addAndUseModel')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ModelSection(): JSX.Element {
  const settings = useApp((s) => s.settings);
  const providers = useApp((s) => s.providers);
  const patchSettings = useApp((s) => s.patchSettings);
  const [adding, setAdding] = useState(false);

  const activeProvider = providers.find((p) => p.id === settings?.activeProviderId) ?? null;
  const modelOptions = activeProvider?.models ?? [];

  return (
    <div className="col" style={{ gap: 22 }}>
      {/* ① 分区右上动作（项目契约在分区标题行右侧） */}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          className="btn btn-sm"
          disabled={providers.length === 0}
          onClick={() => setAdding(true)}
        >
          <Icon name="plus" size={14} />
          {tx('settings.customModelDialog.addCustomModel')}
        </button>
      </div>

      {/* ② 当前供应商 / 当前模型 */}
      <div className="panel col model-rows">
        <Row
          title={tx('settings.settingsPage.models.currentProvider')}
          description={tx('settings.settingsPage.models.currentProviderDescription')}
          control={
            <select
              className="select model-select"
              value={settings?.activeProviderId ?? ''}
              onChange={(e) => {
                const id = e.target.value;
                const p = providers.find((x) => x.id === id) ?? null;
                void patchSettings({ activeProviderId: id || null, defaultModel: p?.models?.[0] ?? null });
              }}
            >
              <option value="">{t('未选择')}</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          }
        />
        <Row
          title={tx('settings.settingsPage.models.currentModel')}
          description={tx('settings.settingsPage.models.currentModelDescription')}
          control={
            <select
              className="select model-select"
              value={settings?.defaultModel ?? ''}
              disabled={modelOptions.length === 0}
              onChange={(e) => void patchSettings({ defaultModel: e.target.value || null })}
            >
              {modelOptions.length === 0 && <option value="">{t('该供应商还没有模型')}</option>}
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              {/* 当前值不在列表里时也保留，避免下拉显示空白 */}
              {settings?.defaultModel && !modelOptions.includes(settings.defaultModel) && (
                <option value={settings.defaultModel}>{settings.defaultModel}</option>
              )}
            </select>
          }
        />
      </div>

      {/* ③ 高级模型选项 —— 默认模型与思考强度在对话框统一调整，避免出现两套入口 */}
      <Section
        title={t('高级模型选项')}
        hint={t('模型、思考强度和上下文用量在对话框中即时调整；这里仅保留兼容性开关。')}
      >
        <div className="panel col" style={{ padding: 14, gap: 14 }}>
          <Switch
            on={!!settings?.disableThinking}
            onChange={(v) => void patchSettings({ disableThinking: v })}
            label={t('关闭模型思考')}
            hint={t('⚠️ 强烈建议对 DeepSeek V4、以及任何「默认开思考」的推理模型开启此项，否则正文为空。')}
          />
          <Switch
            on={!!settings?.builtinMcpEnabled}
            onChange={(v) => void patchSettings({ builtinMcpEnabled: v })}
            label={t('允许使用内置工具')}
            hint={t('允许智能体使用文件、终端和内置建模工具。关闭后只保留对话能力。')}
          />
        </div>
      </Section>

      {adding && (
        <AddCustomModelDialog
          providers={providers}
          activeProviderId={settings?.activeProviderId ?? null}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
