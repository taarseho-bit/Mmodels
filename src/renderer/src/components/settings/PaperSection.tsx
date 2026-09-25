/**
 * 设置页 ② 论文与比赛
 *
 * 对齐原版 s01-paper 的三段结构：
 *   ① 「队伍资料默认仅保存在本机」说明卡
 *   ② 「使用方式」：新论文默认使用队伍档案 / 初始化论文项目配置
 *   ③ 「队伍档案」：列表管理（新建 / 编辑 / 设为默认 / 删除）+ 空态卡
 *
 * ⚠️ 本项目追加一段 ③「自定义模板」——
 *    原版把模板来源存在**项目配置**里（`template.source='custom'` + `sourcePath`，
 *    见原版 `PaperTemplateService` / `customTemplatesRoot` / `builtin_template_readonly`），
 *    但原版只在扩展页提供「基于内置模板自定义」，没有「选一个本地目录当模板源」的入口；
 *    用户实机抱怨"模板字段读不到、也不知道怎么自己加模板"，故补这个入口。
 *    写入的是当前项目的 `.mathmodel/paper/config.json`（agent 真正读的那份）。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  makeLocalizedText,
  pickLocalizedText,
  type PaperTeamProfile,
  type PaperTemplateRef,
} from '@shared/types';
import { useApp } from '../../store/app';
import { tx, t } from '../../i18n';
import { Icon } from '../Icon';
import { Section, Switch } from './shared';

/** 生成一个本地 id（不需要后端参与） */
function newId(): string {
  return `tp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 新建档案时的队员槽位数量（原版按 3 人起） */
const MEMBER_SLOTS = 3;

function blankProfile(): PaperTeamProfile {
  return { id: newId(), name: '', school: '', members: Array.from({ length: MEMBER_SLOTS }, () => ''), advisor: '', contact: '' };
}

export function PaperSection(): JSX.Element {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const project = useApp((s) => s.currentProject);
  const [editing, setEditing] = useState<PaperTeamProfile | null>(null);

  const profiles = settings?.paperProfiles ?? [];
  const defaultId = settings?.paperDefaultProfileId ?? null;

  // ── 当前项目的模板来源（写进 .mathmodel/paper/config.json，agent 读的就是这份）──
  const [tplRef, setTplRef] = useState<PaperTemplateRef | null>(null);
  const [tplNotice, setTplNotice] = useState<string | null>(null);
  const [tplBusy, setTplBusy] = useState(false);

  /** 内置模板名（用于「恢复内置模板」时带上正确的 name/entryFile） */
  const builtinFor = useCallback(async (id: string | null): Promise<PaperTemplateRef | null> => {
    try {
      const r = await window.mathmodel.paper.templates();
      const hit = r.templates?.find((x) => x.id === id) ?? r.templates?.[0];
      if (!hit) return null;
      // 原版 `Np`：en 取 template.json 的 name.en（不带就原文兜底，但必须非空）
      return {
        id: hit.id,
        name: makeLocalizedText(hit.name, hit.nameEn),
        entryFile: hit.entryFile,
        source: 'builtin',
        sourcePath: null,
      };
    } catch {
      return null;
    }
  }, []);

  const reloadTpl = useCallback(async (): Promise<void> => {
    if (!project) {
      setTplRef(null);
      return;
    }
    try {
      const r = await window.mathmodel.paper.getConfig();
      setTplRef(r.config?.template ?? null);
    } catch {
      setTplRef(null);
    }
  }, [project]);

  useEffect(() => {
    void reloadTpl();
  }, [reloadTpl]);

  const saveTpl = useCallback(
    async (ref: PaperTemplateRef | null, okText: string): Promise<void> => {
      if (!ref) return;
      setTplBusy(true);
      setTplNotice(null);
      try {
        const r = await window.mathmodel.paper.saveConfig({ template: ref });
        if (!r?.ok) {
          // 原版同款语义（`chat.newChatPage.paperConfigConflict` / `paperConfigUnsafePath` /
          // `paperConfigSaveFailed`）—— 冲突=文件是用户手写的，我们拒绝覆盖（B19）
          setTplNotice(
            r?.reason === 'no-project'
              ? t('请先打开一个项目')
              : r?.reason === 'config-conflict'
                ? tx('chat.newChatPage.paperConfigConflict')
                : r?.reason === 'unsafe-path'
                  ? tx('chat.newChatPage.paperConfigUnsafePath')
                  : tx('chat.newChatPage.paperConfigSaveFailed'),
          );
          return;
        }
        setTplNotice(okText);
        await reloadTpl();
      } catch {
        setTplNotice(tx('chat.newChatPage.paperConfigSaveFailed'));
      } finally {
        setTplBusy(false);
      }
    },
    [reloadTpl],
  );

  const pickCustomDir = useCallback(async (): Promise<void> => {
    const dir = await window.mathmodel.file.selectDirectory();
    if (!dir) return;
    // 目录名当 id：与内置模板「目录名即 id」的约定一致（原版 `/:templateId` 同理）
    const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? 'custom-template';
    await saveTpl(
      // 目录名当显示名（用户自选目录，只有这一种语言）→ en 走原文兜底，两键都非空
      { id: name, name: makeLocalizedText(name), entryFile: 'document.tex', source: 'custom', sourcePath: dir },
      t('已把该目录设为当前项目的论文模板源'),
    );
  }, [saveTpl]);

  /** 把默认档案同步成扁平快照，供输入区「使用队伍档案」直接读取 */
  const syncFlat = useCallback(
    (list: PaperTeamProfile[], id: string | null): void => {
      const p = id ? list.find((x) => x.id === id) : null;
      void patchSettings({
        paperProfiles: list,
        paperDefaultProfileId: id,
        paperTeam: p
          ? {
              school: p.school ?? '',
              teamName: p.name ?? '',
              members: (p.members ?? []).filter((m) => m.trim()).join('\n'),
            }
          : undefined,
      });
    },
    [patchSettings],
  );

  const save = useCallback((): void => {
    if (!editing) return;
    const clean: PaperTeamProfile = {
      ...editing,
      name: editing.name.trim() || t('未命名档案'),
      school: editing.school?.trim() ?? '',
      advisor: editing.advisor?.trim() ?? '',
      contact: editing.contact?.trim() ?? '',
      members: (editing.members ?? []).map((m) => m.trim()).filter(Boolean),
    };
    const exists = profiles.some((p) => p.id === clean.id);
    const list = exists ? profiles.map((p) => (p.id === clean.id ? clean : p)) : [...profiles, clean];
    // 第一个档案自动成为默认
    const nextDefault = defaultId ?? clean.id;
    syncFlat(list, nextDefault);
    setEditing(null);
  }, [defaultId, editing, profiles, syncFlat]);

  const remove = useCallback(
    (p: PaperTeamProfile): void => {
      if (
        !window.confirm(
          `${tx('settings.settingsPage.paperCompetition.deleteTitle')}\n\n${tx(
            'settings.settingsPage.paperCompetition.deleteDescription',
            { name: p.name },
          )}`,
        )
      ) {
        return;
      }
      const list = profiles.filter((x) => x.id !== p.id);
      syncFlat(list, defaultId === p.id ? (list[0]?.id ?? null) : defaultId);
    },
    [defaultId, profiles, syncFlat],
  );

  // ── 新建 / 编辑态 ──
  if (editing) {
    const isNew = !profiles.some((p) => p.id === editing.id);
    const members = editing.members ?? [];
    const setMember = (i: number, v: string): void => {
      const next = members.slice();
      next[i] = v;
      setEditing({ ...editing, members: next });
    };
    return (
      <div className="col" style={{ gap: 18 }}>
        <div className="row">
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>
            ← {t('← 返回')}
          </button>
          <span className="page-title" style={{ fontSize: 13 }}>
            {isNew
              ? tx('settings.settingsPage.paperCompetition.newProfile')
              : tx('settings.settingsPage.paperCompetition.editProfile')}
          </span>
        </div>

        <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
          {tx('settings.settingsPage.paperCompetition.editorDescription')}
        </div>

        <div className="field">
          <label className="field-label">{tx('settings.settingsPage.paperCompetition.profileName')}</label>
          <input
            className="input"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            placeholder={tx('settings.settingsPage.paperCompetition.profileNamePlaceholder')}
          />
        </div>

        <div className="field">
          <label className="field-label">{tx('settings.settingsPage.paperCompetition.school')}</label>
          <input
            className="input"
            value={editing.school ?? ''}
            onChange={(e) => setEditing({ ...editing, school: e.target.value })}
          />
        </div>

        <div className="field">
          <label className="field-label">{tx('settings.settingsPage.paperCompetition.members')}</label>
          <div className="col" style={{ gap: 6 }}>
            {Array.from({ length: Math.max(MEMBER_SLOTS, members.length) }, (_, i) => (
              <input
                key={i}
                className="input"
                value={members[i] ?? ''}
                placeholder={tx('settings.settingsPage.paperCompetition.memberPlaceholder', { index: i + 1 })}
                onChange={(e) => setMember(i, e.target.value)}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field-label">{tx('settings.settingsPage.paperCompetition.advisor')}</label>
          <input
            className="input"
            value={editing.advisor ?? ''}
            onChange={(e) => setEditing({ ...editing, advisor: e.target.value })}
          />
        </div>

        <div className="field">
          <label className="field-label">{tx('settings.settingsPage.paperCompetition.contact')}</label>
          <input
            className="input"
            value={editing.contact ?? ''}
            placeholder={tx('settings.settingsPage.paperCompetition.phone')}
            onChange={(e) => setEditing({ ...editing, contact: e.target.value })}
          />
          <div className="field-hint">{tx('settings.settingsPage.paperCompetition.contactHint')}</div>
        </div>

        <div className="row" style={{ gap: 8, paddingTop: 6 }}>
          <button className="btn btn-primary" onClick={save}>
            {tx('settings.settingsPage.paperCompetition.save')}
          </button>
          <button className="btn btn-ghost" onClick={() => setEditing(null)}>
            {tx('settings.settingsPage.paperCompetition.cancel')}
          </button>
        </div>
      </div>
    );
  }

  // ── 列表态 ──
  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="panel row" style={{ padding: 12, gap: 10, alignItems: 'center', borderColor: 'color-mix(in srgb, var(--accent) 35%, var(--border-weak))' }}>
        <Icon name="folder" size={15} />
        <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>当前项目的论文设置</span>
          <span className="muted truncate" style={{ fontSize: 11.5 }}>
            {project ? `${project.name} · 模板、队伍和比赛资料只保存在这个项目中` : '请先打开一个项目；项目之间不会共用比赛信息'}
          </span>
        </div>
        <span className="badge badge-accent">{project ? '当前项目' : '未选择项目'}</span>
      </div>

      {/* ① 本机存储说明 */}
      <div className="panel row" style={{ padding: 14, gap: 12, alignItems: 'flex-start' }}>
        <Icon name="shield-check" size={15} style={{ marginTop: 2 }} />
        <div className="col grow" style={{ gap: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {tx('settings.settingsPage.paperCompetition.localOnlyTitle')}
          </span>
          <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
            {tx('settings.settingsPage.paperCompetition.localOnlyDescription')}
          </span>
        </div>
      </div>

      {/* ② 使用方式 */}
      <Section title={tx('settings.settingsPage.paperCompetition.usageTitle')}>
        <div className="panel col" style={{ padding: 14, gap: 12 }}>
          <Switch
            on={!!settings?.paperProfileEnabled}
            onChange={(v) => void patchSettings({ paperProfileEnabled: v })}
            label={tx('settings.settingsPage.paperCompetition.profileEnabled')}
            hint={tx('settings.settingsPage.paperCompetition.profileEnabledDescription')}
          />
          <Switch
            on={settings?.paperInitProjectConfig !== false}
            onChange={(v) => void patchSettings({ paperInitProjectConfig: v })}
            label={tx('settings.settingsPage.paperCompetition.projectConfigEnabled')}
            hint={tx('settings.settingsPage.paperCompetition.projectConfigEnabledDescription')}
          />
        </div>
      </Section>

      {/* ③ 自定义模板 */}
      <Section title={t('自定义模板')}>
        <div className="panel col" style={{ padding: 14, gap: 10 }}>
          <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
            {t(
              '把任意本地目录作为论文模板源。Agent 写论文时会按 write-paper 的规则把该目录整体复制到项目里，从入口文件开始写。不选则使用内置比赛模板。',
            )}
          </span>

          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Icon name={tplRef?.source === 'custom' ? 'folder' : 'book-open'} size={14} />
            <span style={{ fontSize: 12.5 }}>
              {tplRef?.source === 'custom' ? t('自定义模板源') : t('内置比赛模板')}
            </span>
            <span className="muted grow" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
              {tplRef?.source === 'custom'
                ? tplRef.sourcePath || tplRef.id
                : pickLocalizedText(tplRef?.name, settings?.locale ?? 'zh-CN') || tplRef?.id || t('（未设置）')}
            </span>
          </div>

          {!project && <span className="muted" style={{ fontSize: 11.5 }}>{t('请先打开一个项目')}</span>}

          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-sm row"
              style={{ gap: 5 }}
              disabled={!project || tplBusy}
              onClick={() => void pickCustomDir()}
            >
              <Icon name="folder" size={13} />
              {t('选择模板目录…')}
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={!project || tplBusy}
              onClick={() => {
                void (async () => {
                  const ref = await builtinFor(settings?.paperTemplateId ?? null);
                  if (!ref) {
                    setTplNotice(t('没有可用的内置模板'));
                    return;
                  }
                  await saveTpl(ref, t('已恢复为内置模板'));
                })();
              }}
            >
              {t('恢复内置模板')}
            </button>
          </div>

          {tplNotice && (
            <span className="muted" style={{ fontSize: 11.5, color: 'var(--accent)' }}>
              {tplNotice}
            </span>
          )}
        </div>
      </Section>

      {/* ④ 队伍档案 */}
      <section className="col" style={{ gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {tx('settings.settingsPage.paperCompetition.teamProfiles')}
          </span>
          <button className="btn btn-sm row" style={{ gap: 5 }} onClick={() => setEditing(blankProfile())}>
            <Icon name="plus" size={13} />
            {tx('settings.settingsPage.paperCompetition.addProfile')}
          </button>
        </div>

        {profiles.length === 0 ? (
          <div className="panel col" style={{ padding: 26, gap: 8, alignItems: 'center', textAlign: 'center' }}>
            <Icon name="user" size={24} className="muted" />
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {tx('settings.settingsPage.paperCompetition.emptyTitle')}
            </span>
            <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.7, maxWidth: 360 }}>
              {tx('settings.settingsPage.paperCompetition.emptyDescription')}
            </span>
            <button
              className="btn btn-sm btn-primary row"
              style={{ marginTop: 6, gap: 5 }}
              onClick={() => setEditing(blankProfile())}
            >
              <Icon name="plus" size={13} />
              {tx('settings.settingsPage.paperCompetition.addProfile')}
            </button>
          </div>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {profiles.map((p) => {
              const isDefault = p.id === defaultId;
              const members = (p.members ?? []).filter((m) => m.trim());
              const incomplete = !p.school?.trim() && members.length === 0;
              return (
                <div key={p.id} className="panel col" style={{ padding: 14, gap: 6 }}>
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</span>
                    {isDefault && (
                      <span className="badge badge-accent">
                        {tx('settings.settingsPage.paperCompetition.defaultBadge')}
                      </span>
                    )}
                    <div className="grow" />
                    {!isDefault && (
                      <button className="btn btn-sm btn-ghost" onClick={() => syncFlat(profiles, p.id)}>
                        {tx('settings.settingsPage.paperCompetition.setDefault')}
                      </button>
                    )}
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ ...p, members: members.slice() })}>
                      {tx('settings.settingsPage.paperCompetition.edit')}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => remove(p)}>
                      {tx('settings.settingsPage.paperCompetition.delete')}
                    </button>
                  </div>
                  <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
                    {incomplete
                      ? tx('settings.settingsPage.paperCompetition.profileNotCompleted')
                      : [
                          p.school?.trim() || null,
                          members.length
                            ? `${tx('settings.settingsPage.paperCompetition.members')}：${members.join('、')}`
                            : null,
                          p.advisor?.trim()
                            ? tx('settings.settingsPage.paperCompetition.advisorSummary', { name: p.advisor.trim() })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
