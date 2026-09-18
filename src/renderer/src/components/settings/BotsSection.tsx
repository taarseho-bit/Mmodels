/**
 * 设置页 ⑫ 机器人
 *
 * 原版两块（`integrations.feishuSection.*` / `integrations.weChatSection.*`）：
 *   飞书：App ID / App Secret、帮助行、测试连接 + 保存、启用机器人、连接状态
 *   微信：扫码登录微信、说明、启用机器人、连接状态
 *
 * ⚠️ 飞书 / 微信属既定排除的在线服务：这里只做**完整 UI + 本地持久化**，
 *    不发起任何真实联网（长连接、扫码、事件回调）。连接状态固定呈现
 *    「未连接」，点「测试连接」明确告知本地版不连接外部服务。
 *
 * 持久化分两处：
 *   - 非敏感部分（启用开关、App ID）→ `settings.bots`（conf，随设置一起走）
 *   - **App Secret** → 只经 IPC 交给主进程，由 `safeStorage.encryptString()`
 *     加密后存 conf 的 `botSecrets`；**永不回传渲染层**。
 *     safeStorage 取不到时回退明文并在界面上注明（见 `BotSecretStatus.encrypted`）。
 *
 * 复刻自创的「自动化机器人」卡保留在末尾。
 */
import { useCallback, useEffect, useState } from 'react';
import type { BotSecretStatus, BotSettings } from '@shared/types';
import { useApp } from '../../store/app';
import { tx, t } from '../../i18n';
import { Section, Switch } from './shared';

const FALLBACK_BOTS: BotSettings = { feishu: { enabled: false, appId: '' }, wechat: { enabled: false } };

export function BotsSection({ onOpenAutomations }: { onOpenAutomations: () => void }): JSX.Element {
  const currentProject = useApp((s) => s.currentProject);
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);

  const [count, setCount] = useState<number | null>(null);
  const bots: BotSettings = settings?.bots ?? FALLBACK_BOTS;

  /** 密钥草稿：只在内存里，保存后立刻清空 —— 再也不从主进程读回来 */
  const [secretDraft, setSecretDraft] = useState('');
  const [secret, setSecret] = useState<BotSecretStatus | null>(null);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const patchBots = useCallback(
    (p: Partial<BotSettings>) => {
      void patchSettings({ bots: { ...bots, ...p } });
    },
    [bots, patchSettings],
  );

  const refreshSecret = useCallback(async () => {
    try {
      const r = await window.mathmodel.network.botSecretStatus();
      setSecret(r.feishu);
    } catch {
      setSecret({ configured: false, encrypted: false, available: false });
    }
  }, []);

  useEffect(() => {
    void refreshSecret();
  }, [refreshSecret]);

  useEffect(() => {
    if (!currentProject) {
      setCount(0);
      return;
    }
    void window.mathmodel.automation
      .list(currentProject.id)
      .then((rows) => setCount(rows.length))
      .catch(() => setCount(null));
  }, [currentProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 保存：App ID 走设置，App Secret 走 safeStorage IPC（空串 = 保留原密钥） */
  const onSaveFeishu = async (): Promise<void> => {
    if (secretDraft !== '') {
      try {
        const r = await window.mathmodel.network.setBotSecret('feishuAppSecret', secretDraft);
        setSecret(r.feishu);
      } catch {
        setSecret({ configured: false, encrypted: false, available: false });
      }
      setSecretDraft('');
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  const onClearSecret = async (): Promise<void> => {
    try {
      const r = await window.mathmodel.network.clearBotSecret('feishuAppSecret');
      setSecret(r.feishu);
    } catch {
      /* 清除失败保持原状态 */
    }
  };

  const feishuConfigured = bots.feishu.appId.trim() !== '' && (secret?.configured ?? false);

  return (
    <div className="col" style={{ gap: 22 }}>
      {/* ── 飞书机器人 ── */}
      <Section title={tx('integrations.feishuSection.title')}>
        <div className="panel col bots-card" style={{ padding: 14, gap: 12 }}>
          <div className="col" style={{ gap: 6 }}>
            <label className="field-label">App ID</label>
            <input
              className="input mono"
              style={{ fontSize: 12, maxWidth: 360 }}
              value={bots.feishu.appId}
              placeholder="cli_xxxxxxxxxxxxxxxx"
              onChange={(e) => patchBots({ feishu: { ...bots.feishu, appId: e.target.value } })}
            />
          </div>

          <div className="col" style={{ gap: 6 }}>
            <label className="field-label">App Secret</label>
            <input
              className="input"
              type="password"
              style={{ fontSize: 12, maxWidth: 360 }}
              value={secretDraft}
              placeholder={
                secret?.configured
                  ? tx('integrations.feishuSection.secretConfiguredPlaceholder')
                  : tx('integrations.feishuSection.secretNotConfiguredPlaceholder')
              }
              onChange={(e) => setSecretDraft(e.target.value)}
            />
            {secret?.configured ? (
              <span className="field-hint bots-secret-note">
                {secret.encrypted
                  ? t('密钥已用系统凭据加密保存在本机。')
                  : t('本机系统加密不可用，密钥以明文保存在本机配置文件中。')}
                {' '}
                <button className="bots-linkbtn" onClick={() => void onClearSecret()}>
                  {t('清除密钥')}
                </button>
              </span>
            ) : null}
          </div>

          <span className="field-hint bots-help">
            {tx('integrations.feishuSection.setupHelpBefore')}
            <span className="mono">open.feishu.cn</span>
            {tx('integrations.feishuSection.setupHelpAfter')}
          </span>

          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-sm"
              onClick={() => setTestResult(t('本地版不连接外部服务，无法测试连接。'))}
            >
              {tx('integrations.feishuSection.testConnection')}
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void onSaveFeishu()}>
              {saved ? t('已保存 ✓') : tx('common.save')}
            </button>
          </div>

          {testResult ? (
            <span className="field-hint bots-testresult">{testResult}</span>
          ) : null}

          {/* 本地版不连接外部服务：说明 + 状态固定「未连接」 */}
          <span className="muted bots-localnote" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
            {t('本地版不连接外部服务，凭据仅保存在本机，不会发起长连接或事件回调。')}
          </span>

          <Switch
            on={bots.feishu.enabled}
            onChange={(v) => patchBots({ feishu: { ...bots.feishu, enabled: v } })}
            label={tx('integrations.feishuSection.enableBotTitle')}
            hint={tx('integrations.feishuSection.enableBotDescription')}
          />

          <div className="row bots-status" style={{ gap: 8 }}>
            <span style={{ fontSize: 12.5 }}>{tx('integrations.feishuSection.connectionStatus')}</span>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {bots.feishu.enabled && !feishuConfigured
                ? t('未配置')
                : tx('integrations.feishuSection.connectionState.disconnected')}
            </span>
          </div>
        </div>
      </Section>

      {/* ── 微信机器人 ── */}
      <Section title={t('微信机器人')}>
        <div className="panel col bots-card" style={{ padding: 14, gap: 12 }}>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-sm btn-primary" disabled>
              {t('扫码登录微信')}
            </button>
            <span className="muted" style={{ fontSize: 11.5 }}>{t('本地版不支持扫码授权')}</span>
          </div>

          <span className="field-hint bots-help">
            {t('请使用手机微信扫描二维码授权。个人账号自动化需注意官方对账号类型和消息频率的限制。')}
          </span>

          <span className="muted bots-localnote" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
            {t('本地版不连接外部服务，凭据仅保存在本机，不会发起长连接或事件回调。')}
          </span>

          <Switch
            on={bots.wechat.enabled}
            onChange={(v) => patchBots({ wechat: { enabled: v } })}
            label={t('启用机器人')}
            hint={t('接收微信私聊和群聊消息，并由 Agent 回复')}
          />

          <div className="row bots-status" style={{ gap: 8 }}>
            <span style={{ fontSize: 12.5 }}>{t('连接状态')}</span>
            <span className="muted" style={{ fontSize: 12.5 }}>{t('未连接')}</span>
          </div>
        </div>
      </Section>

      {/* ── 复刻自创：自动化机器人（保留在末尾） ── */}
      <Section
        title={t('自动化机器人')}
        hint={t('按 cron 定时跑任务的机器人（对应原版「机器人」）。完成时会发系统通知。')}
      >
        <div className="panel row" style={{ padding: 14, gap: 12, alignItems: 'center' }}>
          <div className="col grow" style={{ gap: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {count === null ? t('读取中…') : t('已创建 {{count}} 个自动化任务', { count })}
            </span>
            <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
              {t('每个任务一个专属会话，可在自动化页查看运行历史与输出。')}
            </span>
          </div>
          <button className="btn btn-sm btn-primary" onClick={onOpenAutomations}>
            {t('管理自动化')}
          </button>
        </div>
      </Section>
    </div>
  );
}
