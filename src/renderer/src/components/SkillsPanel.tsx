/**
 * 技能面板 —— 侧栏里的技能开关。
 *
 * 完整版的技能管理在「扩展」页；这里只做**任务进行中最常用的那个动作**：
 * 快速开关某个技能。比如发现 agent 没调用某个能力，随手打开它。
 *
 * ⚠️ 开关语义：主进程用「禁用列表」持久化（见 main/skills/index.ts 注释），
 *    所以关掉一个技能就是把它写进 disabledSkills，而不是从启用列表里删。
 *    新增技能目录因此**零配置自动可用** —— 这是刻意的产品选择。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SkillMeta } from '@shared/types';
import { useApp } from '../store/app';
import { Icon } from './Icon';
import { t } from '../i18n';

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function SkillsPanel(): JSX.Element {
  const skills = useApp((s) => s.skills);
  const toggleSkill = useApp((s) => s.toggleSkill);
  const refreshSkills = useApp((s) => s.refreshSkills);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** 详情弹层：显示 SKILL.md 原文 */
  const [detail, setDetail] = useState<{ meta: SkillMeta; doc: string } | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.dirName.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skills, query]);

  const enabledCount = skills.filter((s) => s.enabled).length;
  const totalBytes = skills.reduce((a, s) => a + s.byteSize, 0);

  const onToggle = useCallback(
    async (s: SkillMeta) => {
      setBusy(s.dirName);
      setError(null);
      try {
        await toggleSkill(s.dirName, !s.enabled);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [toggleSkill],
  );

  const openDetail = useCallback(async (s: SkillMeta) => {
    setDocLoading(true);
    setDetail({ meta: s, doc: '' });
    try {
      const doc = await window.mathmodel.skill.read(s.dirName);
      setDetail({ meta: s, doc });
    } catch (e) {
      setDetail({
        meta: s,
        doc: t('读取失败：{{msg}}', { msg: e instanceof Error ? e.message : String(e) }),
      });
    } finally {
      setDocLoading(false);
    }
  }, []);

  if (detail) {
    return (
      <div className="col" style={{ height: '100%' }}>
        <div className="row" style={{ padding: '8px 10px', gap: 6, flexShrink: 0 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setDetail(null)}>
            {'← ' + t('返回')}
          </button>
          <span className="truncate grow" style={{ fontSize: 11, fontWeight: 600 }}>
            {detail.meta.name}
          </span>
        </div>
        <div className="divider" style={{ margin: 0 }} />
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '8px 10px' }}>
          {docLoading ? (
            <div className="muted" style={{ fontSize: 12 }}>
              {t('读取中…')}
            </div>
          ) : (
            <pre
              style={{
                margin: 0,
                fontSize: 11,
                lineHeight: 1.65,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'var(--font-mono)',
                color: 'var(--fg-secondary)',
              }}
            >
              {detail.doc}
            </pre>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="col" style={{ padding: '8px 10px', gap: 6, flexShrink: 0 }}>
        <div className="row" style={{ gap: 6 }}>
          <input
            className="input"
            style={{ fontSize: 11, padding: '4px 8px' }}
            placeholder={t('筛选技能…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn btn-sm btn-ghost" title={t('刷新')} onClick={() => void refreshSkills()}>
            ⟳
          </button>
        </div>
        <div className="muted" style={{ fontSize: 10 }}>
          {t('已启用 {{n}}/{{total}} · 共 {{size}}', { n: enabledCount, total: skills.length, size: humanSize(totalBytes) })}
        </div>
      </div>

      <div className="divider" style={{ margin: 0 }} />

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: 8 }}>
        {error && (
          <div className="muted" style={{ fontSize: 11, color: 'var(--danger)', marginBottom: 8 }}>
            {error}
          </div>
        )}

        {skills.length === 0 && (
          <div className="empty" style={{ padding: 20 }}>
            {t('没有扫描到技能。')}
            <br />
            {t('把技能目录放进')} <code className="mono">resources/builtin-skills/</code>
            <br />
            {t('或用户技能目录即可自动出现。')}
          </div>
        )}

        {skills.length > 0 && filtered.length === 0 && (
          <div className="muted" style={{ padding: 12, fontSize: 12 }}>
            {t('没有匹配「{{q}}」的技能。', { q: query })}
          </div>
        )}

        {filtered.map((s) => (
          <div key={s.dirName} className={`skill-card${s.enabled ? '' : ' disabled'}`}>
            <div className="skill-main">
              <div className="row" style={{ gap: 5 }}>
                <span className="skill-name truncate" title={s.name}>
                  {s.name}
                </span>
                {s.source === 'builtin' ? (
                  <span className="badge" style={{ fontSize: 9 }}>
                    {t('内置')}
                  </span>
                ) : (
                  <span className="badge badge-accent" style={{ fontSize: 9 }}>
                    {t('用户')}
                  </span>
                )}
                {s.disabledByDefault && (
                  <span className="badge badge-warning" style={{ fontSize: 9 }} title={t('存在 .disabled-by-default')}>
                    {t('默认关')}
                  </span>
                )}
              </div>

              <div className="skill-desc" title={s.description}>
                {s.description || t('（无描述）')}
              </div>

              <div className="row skill-meta" style={{ gap: 8 }}>
                <span className="mono" style={{ fontSize: 9 }}>
                  {s.dirName}
                </span>
                <span style={{ fontSize: 9 }}>{humanSize(s.byteSize)}</span>
                <span style={{ fontSize: 9 }}>{t('{{n}} 文件', { n: s.fileCount })}</span>
                {s.hasScripts && (
                  <span
                    style={{ fontSize: 9, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                    title={t('含 scripts/ 目录')}
                  >
                    <Icon name="terminal" size={9} />
                    {t('脚本')}
                  </span>
                )}
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ marginLeft: 'auto', fontSize: 10, padding: '1px 5px' }}
                  onClick={() => void openDetail(s)}
                >
                  {t('查看')}
                </button>
              </div>
            </div>

            <button
              className={`switch${s.enabled ? ' on' : ''}`}
              disabled={busy === s.dirName}
              title={s.enabled ? t('点击禁用') : t('点击启用')}
              onClick={() => void onToggle(s)}
            >
              <span className="switch-knob" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
