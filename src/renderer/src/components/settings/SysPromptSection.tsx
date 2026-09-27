/**
 * 设置页 ⑧ 系统提示词
 */
import { useEffect, useState } from 'react';
import { useApp } from '../../store/app';
import { tx, t } from '../../i18n';
import { Section } from './shared';

export function SysPromptSection(): JSX.Element {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const [draft, setDraft] = useState(settings?.systemPrompt ?? '');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(settings?.systemPrompt ?? '');
  }, [settings?.systemPrompt]);

  return (
    <Section
      title={t('附加系统提示词')}
      hint={t('追加在 Agent 系统层末尾的自定义指令（应用约定同位置功能）。每个新会话生效，只保存在本机。')}
    >
      <div className="panel col" style={{ padding: 14, gap: 10 }}>
        <textarea
          className="input mono"
          style={{ minHeight: 160, fontSize: 12, lineHeight: 1.7 }}
          value={draft}
          placeholder={t('例：所有图表统一使用科技期刊配色；代码注释用中文…')}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
        />
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              void patchSettings({ systemPrompt: draft.trim() || undefined });
              setSaved(true);
            }}
          >
            {tx('common.save')}
          </button>
          {saved && <span className="muted" style={{ fontSize: 12 }}>{t('已保存 ✓ 下一个会话生效')}</span>}
        </div>
      </div>
    </Section>
  );
}
