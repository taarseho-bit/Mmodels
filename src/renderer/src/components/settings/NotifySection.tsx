/**
 * 设置页 ⑪ 通知
 */
import { useEffect, useState } from 'react';
import { useApp } from '../../store/app';
import { t } from '../../i18n';
import { Section, Switch } from './shared';

export function NotifySection(): JSX.Element {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const [supported, setSupported] = useState(true);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    void window.mathmodel.notifications
      .isSupported()
      .then(setSupported)
      .catch(() => setSupported(false));
  }, []);

  return (
    <Section
      title={t('系统通知')}
      hint={
        supported
          ? t('自动化任务在后台完成且窗口失焦时弹系统通知；点击通知可跳转到对应会话。')
          : t('当前系统不支持原生通知（Windows 通知服务被关闭或环境不支持）。')
      }
    >
      <div className="panel col" style={{ padding: 14, gap: 12 }}>
        <Switch
          on={settings?.notifyEnabled !== false}
          onChange={(v) => void patchSettings({ notifyEnabled: v })}
          label={t('允许系统通知')}
          hint={t('关闭后自动化完成不再弹系统级通知（界面内提示不受影响）。')}
        />
        <div className="row" style={{ gap: 8 }}>
          {/*
            开关关掉时连测试按钮也一起禁掉 —— 主进程那侧（src/main/notify.ts）
            会照约定拒绝创建通知；按钮若还能点，只会回一句「发送失败」，
            那是句假话（不是失败，是用户自己关掉的不让发）。
          */}
          <button
            className="btn btn-sm"
            disabled={!supported || settings?.notifyEnabled === false}
            onClick={() => {
              void window.mathmodel.notifications
                .show({ title: t('MModels 测试通知'), body: t('通知工作正常') })
                .then((ok) => setTestResult(ok ? t('已发出') : t('发送失败')))
                .catch(() => setTestResult(t('发送失败')));
            }}
          >
            {t('发送测试通知')}
          </button>
          {testResult && <span className="muted" style={{ fontSize: 12 }}>{testResult}</span>}
        </div>
      </div>
    </Section>
  );
}
