/**
 * 扩展页 —— 复刻原版的三栏 master-detail 结构。
 *
 * 布局（对应原版 05-extensions 截图）：
 *   ┌──────────┬───────────────┬───────────────────────────┐
 *   │ 扩展类型 │ 条目列表      │ 详情面板                  │
 *   │ 技能     │ 已启用        │ 名称 + 开关 + 删除        │
 *   │ 模板     │  · doctor     │ 状态 / 位置 / 说明        │
 *   │ 算法     │  · mma-figure │ ─────────────────────     │
 *   │ 插件     │ 已停用        │ SKILL.md（渲染 / 源码）   │
 *   │ 连接器   │  · data-search│                           │
 *   │ (help)   │ 38 个技能     │                           │
 *   └──────────┴───────────────┴───────────────────────────┘
 *
 * ⚠️ 在线能力（技能市场 / 飞书机器人 / 微信机器人 / 自动更新）按既定决策排除：
 *    分区与入口保留骨架，但明确置灰说明，不放假入口。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  makeLocalizedText,
  type PaperTemplate,
  type PaperTemplateLibraryResult,
  type PaperTemplateRef,
  type SkillMeta,
} from '@shared/types';
import { useApp } from '../store/app';
import { tx, txPlural, t } from '../i18n';
import { Icon } from '../components/Icon';
import { Markdown } from '../components/Markdown';
import { AlgorithmsMarket } from '../components/AlgorithmsMarket';
import { ConnectorsSection } from '../components/ConnectorsSection';
import { friendlyError } from '../lib/friendly-error';
import { LocalPluginsPanel } from '../components/LocalPluginsPanel';

type Tab = 'skills' | 'templates' | 'algorithms' | 'plugins' | 'connectors';
/** SKILL.md 的两种查看方式（原版 viewToggle） */
type ViewMode = 'rendered' | 'source';

/** 左栏类型 tab（图标取自仓库 Icon 组件，不用 emoji） */
const SECTIONS: Array<{ key: Tab; labelKey: string; icon: string }> = [
  { key: 'skills', labelKey: 'extensions.sections.skills', icon: 'sparkles' },
  { key: 'templates', labelKey: 'extensions.sections.templates', icon: 'file-text' },
  { key: 'algorithms', labelKey: 'extensions.sections.algorithms', icon: 'sigma' },
  { key: 'plugins', labelKey: 'extensions.sections.plugins', icon: 'blocks' },
  { key: 'connectors', labelKey: 'extensions.sections.connectors', icon: 'plug' },
];

/** 复制到剪贴板（原版详情面板的复制按钮同语义） */
function copyText(text: string): void {
  void navigator.clipboard?.writeText(text);
}

/**
 * 扩展页。
 *
 * `requestedTab` 是**外面跳进来时指定的分区**（原版
 * `u({to:"/extensions", search:{section:"skills"}})`）——「＋」菜单的
 * 「管理技能 / 管理算法 / 管理连接器 / 管理插件」四行靠它落到正确的 tab 上。
 * ⚠️ 不能只在页内监听事件：`openRoute` 是当场派发的，而这一页此刻还没挂载
 *   （路由切过去才 mount）⇒ 必须由 `App.tsx` 把 detail 存下来、当 prop 传进来。
 *   `useEffect` 而不是 `useState` 初值：属性中途变化（已经在这一页时再跳一次）
 *   也要跟上，而且 mount 时 effect 必然跑一次，初值这条路不需要。
 */
export function ExtensionsPage({
  requestedTab,
  onNavigate,
}: {
  requestedTab?: string | null;
  /**
   * 跳回别的页面。
   *
   * ⚠️ 这一页**自己不持有路由**（`route` 是 `App.tsx` 的 state），而「使用此模板」
   *    要"选中后回到新会话"（原版 `extensionsHelpDialog.templatesBody` 原文），
   *    所以必须由 App 把 setRoute 递进来 —— 与 `GuidedTour` 的 `onNavigate` 同一套做法。
   *    不传也能用：那时只切模板 + 开新会话，不跳页（便于单测/预览单独挂载）。
   */
  onNavigate?: (route: 'chat') => void;
} = {}): JSX.Element {
  const [tab, setTab] = useState<Tab>('skills');
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (requestedTab && SECTIONS.some((s) => s.key === requestedTab)) {
      setTab(requestedTab as Tab);
    }
  }, [requestedTab]);

  return (
    <div className="page ext-page">
      <div className="ext-layout">
        {/* ── 左栏：扩展类型 ── */}
        <nav className="ext-nav">
          <div className="ext-nav-title">{tx('extensions.extensionsPage.title')}</div>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={`ext-nav-item${tab === s.key ? ' active' : ''}`}
              onClick={() => setTab(s.key)}
            >
              <Icon name={s.icon} size={14} />
              <span>{tx(s.labelKey)}</span>
            </button>
          ))}
          {/* 底部帮助入口（原版 sidebar 的 mt-auto 定位） */}
          <button className="ext-nav-item ext-nav-help" onClick={() => setHelpOpen(true)}>
            <Icon name="circle-question-mark" size={14} />
            <span>{tx('extensions.extensionsPage.helpButton')}</span>
          </button>
        </nav>

        {tab === 'skills' && <SkillsTab />}
        {tab === 'templates' && <TemplatesTab onNavigate={onNavigate} />}
        {tab === 'algorithms' && (
          <div className="ext-single">
            <AlgorithmsMarket />
          </div>
        )}
        {tab === 'plugins' && <LocalPluginsPanel />}
        {tab === 'connectors' && (
          <div className="ext-single">
            <ConnectorsSection />
          </div>
        )}
      </div>

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 技能 tab（列表 + 详情面板）
// ─────────────────────────────────────────────────────────────

function SkillsTab(): JSX.Element {
  const skills = useApp((s) => s.skills);
  const refreshSkills = useApp((s) => s.refreshSkills);
  const toggleSkill = useApp((s) => s.toggleSkill);

  const [selected, setSelected] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? skills.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.dirName.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q),
        )
      : skills;
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [skills, query]);

  /** 原版分组：已启用 / 已停用（顺序固定） */
  const groups = useMemo(
    () => [
      { key: 'enabled', label: tx('common.enabled'), items: filtered.filter((s) => s.enabled) },
      { key: 'disabled', label: tx('common.disabled'), items: filtered.filter((s) => !s.enabled) },
    ],
    [filtered],
  );

  // 选中项被删掉 / 首次进入时自动选中第一个，避免详情面板空着
  const current = skills.find((s) => s.dirName === selected) ?? null;
  useEffect(() => {
    if (selected && skills.some((s) => s.dirName === selected)) return;
    setSelected(skills[0]?.dirName ?? null);
  }, [skills, selected]);

  const onToggle = useCallback(
    async (s: SkillMeta) => {
      setBusy(s.dirName);
      setError(null);
      try {
        await toggleSkill(s.dirName, !s.enabled);
      } catch (e) {
        setError(friendlyError(e, '扩展操作没有完成，可以重试。'));
      } finally {
        setBusy(null);
      }
    },
    [toggleSkill],
  );

  const onImport = useCallback(async () => {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const list = await window.mathmodel.skill.import();
      if (list === null) {
        // 用户取消：原版不提示，这里也保持安静
      } else {
        useApp.setState({ skills: list });
      }
    } catch (e) {
      setError(friendlyError(e, '扩展设置没有保存成功，可以重试。'));
    } finally {
      setImporting(false);
    }
  }, []);

  const onDelete = useCallback(
    async (s: SkillMeta) => {
      setError(null);
      try {
        const list = await window.mathmodel.skill.delete(s.dirName);
        useApp.setState({ skills: list });
        setNotice(t('已删除 Skill「{{name}}」', { name: s.name }));
      } catch (e) {
      setError(friendlyError(e, '扩展检查没有完成，可以重试。'));
      }
    },
    [],
  );

  return (
    <>
      {/* ── 中栏：条目列表 ── */}
      <div className="ext-list">
        <div className="ext-list-head">
          {searchOpen ? (
            <>
              <input
                className="input ext-search"
                autoFocus
                placeholder={tx('extensions.extensionsPage.searchSection', {
                  section: tx('extensions.skillsSection.header'),
                })}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="ext-icon-btn"
                title={tx('extensions.skillsSection.closeSearch')}
                onClick={() => {
                  setSearchOpen(false);
                  setQuery('');
                }}
              >
                <Icon name="x" size={14} />
              </button>
            </>
          ) : (
            <>
              <span className="ext-list-title">{tx('extensions.skillsSection.header')}</span>
              <div className="grow" />
              <button
                className="ext-icon-btn"
                title={tx('extensions.skillsSection.searchSkills')}
                onClick={() => setSearchOpen(true)}
              >
                <Icon name="search" size={15} />
              </button>
              <button
                className="ext-icon-btn"
                disabled={importing}
                title={`${tx('extensions.skillsSection.importSkillFolder')} · ${tx('extensions.skillsSection.importFolderHint')}`}
                onClick={() => void onImport()}
              >
                <Icon name="plus" size={15} />
              </button>
            </>
          )}
        </div>

        {error && <div className="ext-banner danger">{error}</div>}
        {notice && <div className="ext-banner">{notice}</div>}

        <div className="ext-list-body">
          {skills.length === 0 ? (
            <div className="empty">{tx('extensions.skillsSection.empty')}</div>
          ) : filtered.length === 0 ? (
            <div className="empty">{tx('extensions.skillsSection.noResults')}</div>
          ) : (
            groups.map((g) =>
              g.items.length === 0 ? null : (
                <div key={g.key} className="ext-group">
                  <div className="ext-group-head">
                    <Icon name={g.key === 'enabled' ? 'circle-check' : 'circle-slash'} size={12} />
                    <span>{g.label}</span>
                  </div>
                  {g.items.map((s) => (
                    <button
                      key={s.dirName}
                      className={`ext-item${current?.dirName === s.dirName ? ' active' : ''}`}
                      onClick={() => setSelected(s.dirName)}
                    >
                      <Icon name="box" size={16} className="ext-item-icon" />
                      <span className="ext-item-main">
                        <span className="ext-item-name">{s.name}</span>
                        <span className="ext-item-desc">{s.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ),
            )
          )}

          {/* 远端技能市场分组：按既定决策不接，但保留分组骨架（原版有「可安装 · MModels」组） */}
          {!query && filtered.length > 0 && (
            <div className="ext-group ext-group-muted">
              <div className="ext-group-head">
                <Icon name="cloud" size={12} />
                <span>{tx('extensions.skillsSection.groupAvailableMathModel')}</span>
                <span>· {tx('extensions.algorithmsSection.sourceRemote')}</span>
              </div>
              <div className="ext-item-note">{t('本地版不接远端技能市场。')}</div>
            </div>
          )}
        </div>

        <div className="ext-list-foot">
          {txPlural('extensions.skillsSection.skillCount', filtered.length)}
        </div>
      </div>

      {/* ── 右栏：详情面板 ── */}
      <SkillDetail
        skill={current}
        busy={busy === current?.dirName}
        onToggle={onToggle}
        onDelete={onDelete}
      />
    </>
  );
}

function SkillDetail({
  skill,
  busy,
  onToggle,
  onDelete,
}: {
  skill: SkillMeta | null;
  busy: boolean;
  onToggle: (s: SkillMeta) => void;
  onDelete: (s: SkillMeta) => void;
}): JSX.Element {
  const [view, setView] = useState<ViewMode>('rendered');
  const [doc, setDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const dirName = skill?.dirName ?? null;
  useEffect(() => {
    setView('rendered');
    setDoc(null);
    setConfirmOpen(false);
    setCopied(false);
    if (!dirName) return;
    let alive = true;
    setLoading(true);
    void window.mathmodel.skill
      .read(dirName)
      .then((raw) => alive && setDoc(raw))
      .catch((e) => alive && setDoc(t('读取失败：{{msg}}', { msg: friendlyError(e, '暂时无法读取扩展说明。') })))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [dirName]);

  if (!skill) {
    return (
      <div className="ext-detail">
        <div className="empty">{t('选择左侧的技能查看详情')}</div>
      </div>
    );
  }

  const onCopy = (text: string): void => {
    copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="ext-detail">
      <div className="ext-detail-head">
        <span className="ext-detail-name">{skill.name}</span>
        <div className="grow" />
        {copied && <span className="badge badge-success">{tx('common.copied')}</span>}
        <button
          className={`switch${skill.enabled ? ' on' : ''}`}
          disabled={busy}
          title={skill.enabled ? tx('common.disable') : tx('common.enable')}
          onClick={() => onToggle(skill)}
        >
          <span className="switch-knob" />
        </button>
        <button
          className="ext-icon-btn danger"
          disabled={skill.source === 'builtin'}
          title={
            skill.source === 'builtin'
              ? t('内置技能不可删除')
              : tx('extensions.skillsSection.deleteSkill')
          }
          onClick={() => setConfirmOpen(true)}
        >
          <Icon name="trash-2" size={15} />
        </button>
      </div>

      <div className="ext-detail-scroll">
        <div className="ext-field-row">
          <span className="ext-field-label">{tx('extensions.detail.status')}</span>
          <span className="ext-field-value">
            {skill.enabled ? tx('common.enabled') : tx('common.disabled')}
          </span>
        </div>

        <div className="ext-field-row">
          <span className="ext-field-label">{tx('extensions.detail.location')}</span>
          <span className="ext-field-value mono">{skill.path}</span>
          <button
            className="ext-icon-btn"
            title={tx('common.copy')}
            onClick={() => onCopy(skill.path)}
          >
            <Icon name="copy" size={14} />
          </button>
        </div>

        <div className="ext-desc-block">
          <div className="ext-field-label">{tx('extensions.detail.description')}</div>
          <div className="ext-desc-text">{skill.description}</div>
        </div>

        {/* ── SKILL.md：Markdown 渲染 / 源码 ── */}
        <div className="ext-doc">
          <div className="ext-doc-head">
            <div className="grow" />
            <button
              className={`ext-icon-btn${view === 'rendered' ? ' active' : ''}`}
              title={tx('extensions.viewToggle.renderedPreview')}
              onClick={() => setView('rendered')}
            >
              <Icon name="eye" size={14} />
            </button>
            <button
              className={`ext-icon-btn${view === 'source' ? ' active' : ''}`}
              title={tx('extensions.viewToggle.viewSource')}
              onClick={() => setView('source')}
            >
              <Icon name="code-xml" size={14} />
            </button>
            <button
              className="ext-icon-btn"
              title={tx('common.copy')}
              onClick={() => onCopy(doc ?? '')}
            >
              <Icon name="copy" size={14} />
            </button>
          </div>
          <div className="ext-doc-body">
            {loading ? (
              <span className="muted" style={{ fontSize: 12 }}>
                {tx('extensions.skillsSection.loadingSkillMd')}
              </span>
            ) : view === 'rendered' ? (
              <Markdown source={doc ?? ''} />
            ) : (
              <pre className="ext-doc-src">{doc ?? ''}</pre>
            )}
          </div>
        </div>
      </div>

      {confirmOpen && (
        <ConfirmDialog
          title={tx('extensions.skillsSection.deleteSkill')}
          message={tx('extensions.skillsSection.deleteConfirm', { name: skill.name })}
          confirmLabel={tx('common.delete')}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            onDelete(skill);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 模板 tab（论文模板列表，原版 paperTemplatesSection）
// ─────────────────────────────────────────────────────────────

/**
 * 模板操作失败码 → 用户可见文案键。
 *
 * 键全部来自 `extensions.paperTemplatesSection.*`（原版那一族的 31 个键），
 * **没有一个是新造的**。`i18n/keys.test.ts` 的零豁免名单会挡住不存在的键。
 *
 * ⚠️ `builtin_template_readonly` 用 `editorCustomOnly`（「只有自定义模板可以直接编辑。」）：
 *    原版的内置模板删除按钮在 UI 上根本不出现，所以那族键里**没有**一条"删内置被拒"的
 *    专门文案；这条是同一语义（内置只读）下最贴近的一条。主进程仍按原版回 403。
 */
const TEMPLATE_ERROR_KEY: Record<string, string> = {
  template_not_found: 'extensions.paperTemplatesSection.forkSourceMissing',
  builtin_template_readonly: 'extensions.paperTemplatesSection.editorCustomOnly',
  delete_failed: 'extensions.paperTemplatesSection.deleteFailed',
  custom_template_library_unavailable: 'extensions.paperTemplatesSection.forkLibraryUnavailable',
  invalid_template_name: 'extensions.paperTemplatesSection.forkInvalidName',
  unsafe_template: 'extensions.paperTemplatesSection.forkUnsafeTemplate',
};

function templateErrorText(code: string): string {
  return tx(TEMPLATE_ERROR_KEY[code] ?? 'common.failed');
}

function TemplatesTab({ onNavigate }: { onNavigate?: (route: 'chat') => void }): JSX.Element {
  const [templates, setTemplates] = useState<PaperTemplate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** 一次操作的结果提示（原版 `forkCreated` / `deleted`） */
  const [notice, setNotice] = useState<string | null>(null);

  const patchSettings = useApp((s) => s.patchSettings);
  const createSession = useApp((s) => s.createSession);

  // ── fork 弹层 ──
  const [forkOpen, setForkOpen] = useState(false);
  const [forkName, setForkName] = useState('');
  const [forkBusy, setForkBusy] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);

  // ── 删除确认 ──
  const [deleteTarget, setDeleteTarget] = useState<PaperTemplate | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<PaperTemplate[]> => {
    try {
      // 读**合并库**（内置 + 我的模板）：扩展页要按 source 分两段渲染。
      // ⚠️ 不用 `paper.templates()` —— 那条通道只报内置，是给输入区的模板选择器用的。
      const r = await window.mathmodel.paper.library();
      const list = (r as PaperTemplateLibraryResult).templates ?? [];
      setTemplates(list);
      return list;
    } catch {
      setTemplates([]);
      return [];
    }
  }, []);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? templates.filter((x) => x.name.toLowerCase().includes(q)) : templates;
  }, [templates, query]);

  /**
   * 两段分组：内置（`extensions.paperTemplatesSection.builtinGroup`）+
   * 我的模板（`customGroup`，即原版 `customTemplatesGroup` 在扩展页命名空间下的同一个键）。
   *
   * ⚠️ 空的自定义组**不渲染** —— 一条自定义模板都没有时，原版这一页上没有
   *    「我的模板」这段（真机 05-extensions 截图里只有一段「内置 · mma-paper」）。
   */
  const builtinList = useMemo(() => list.filter((t) => t.source === 'builtin'), [list]);
  const customList = useMemo(() => list.filter((t) => t.source === 'custom'), [list]);

  const current = templates.find((x) => x.id === selected) ?? null;
  useEffect(() => {
    if (selected && templates.some((x) => x.id === selected)) return;
    setSelected(templates[0]?.id ?? null);
  }, [templates, selected]);

  const langLabel = (lang: string): string =>
    lang === 'en'
      ? tx('extensions.paperTemplatesSection.languageEn')
      : lang === 'zh-CN+en'
        ? tx('extensions.paperTemplatesSection.languageBilingual')
        : tx('extensions.paperTemplatesSection.languageZhCN');

  /**
   * 「使用此模板」——用该模板**开一个新会话**。
   *
   * 原版语义（`extensionsHelpDialog.templatesBody` 原句）：
   *   「选中后回到新会话，Agent 会把整套模板复制到项目。」
   * ⇒ 三件事：
   *   ① **把"这篇论文用哪套模板"写进当前项目的论文配置**
   *      （`template: {id,name,entryFile,source,sourcePath}` —— 原版存的就是项目配置，
   *       输入区读的也是它：`source='custom'` 时走 `srcTpl` 那条路，名字从磁盘上的
   *       ref 取，所以自定义模板在输入区能正确显示）；
   *   ② 开新会话；③ 跳回对话页。
   *
   * 兜底：项目还没有 `.mathmodel/paper/config.json` 或没打开项目时，`saveConfig`
   * 会失败（`no-project` / `config-conflict` 等）—— 那时退回写全局设置
   * `paperTemplateId`（内置模板的正常通路）。**不静默假装成功**：这条分支只影响
   * "下次打开项目时预选哪套模板"，写不进去也不会让用户丢数据。
   *
   * 这里**不往输入框塞提示词** —— 原版那句只说了"回到新会话"，没提炼词；
   * 而那一族文案里也没有"用它开始写论文"的提示词键，自己编一条就等于造假文案。
   */
  const useThisTemplate = async (tpl: PaperTemplate): Promise<void> => {
    const ref: PaperTemplateRef = {
      id: tpl.id,
      name: makeLocalizedText(tpl.name, tpl.nameEn),
      entryFile: tpl.entryFile,
      source: tpl.source,
      // 自定义模板要把模板目录记下来（原版 default(null)，且 custom 必须有值）
      sourcePath: tpl.source === 'custom' ? tpl.dir : null,
    };
    try {
      const saved = await window.mathmodel.paper.saveConfig({ template: ref });
      if (!saved.ok) await patchSettings({ paperTemplateId: tpl.id });
    } catch {
      await patchSettings({ paperTemplateId: tpl.id });
    }
    await createSession();
    onNavigate?.('chat');
  };

  /** 打开 fork 弹层：默认名取原版 `forkDefaultName`（`{{name}} · 自定义`） */
  const openFork = (tpl: PaperTemplate): void => {
    setForkError(null);
    setForkName(tx('extensions.paperTemplatesSection.forkDefaultName', { name: tpl.name }));
    setForkOpen(true);
  };

  const submitFork = async (): Promise<void> => {
    if (!current) return;
    const name = forkName.trim();
    // 客户端先挡一次（原版 `forkInvalidName`）；主进程还会再判一次（不信渲染层）
    if (!name || name.length > 80) {
      setForkError(tx('extensions.paperTemplatesSection.forkInvalidName'));
      return;
    }
    setForkBusy(true);
    setForkError(null);
    try {
      const r = await window.mathmodel.paper.forkTemplate(current.id, name);
      if (!r.ok) {
        setForkError(templateErrorText(r.error.code));
        return;
      }
      await reload();
      setSelected(r.template.id);
      setForkOpen(false);
      setNotice(tx('extensions.paperTemplatesSection.forkCreated', { name: r.template.name }));
    } catch {
      setForkError(tx('extensions.paperTemplatesSection.forkFailed'));
    } finally {
      setForkBusy(false);
    }
  };

  const submitDelete = async (): Promise<void> => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const r = await window.mathmodel.paper.deleteTemplate(target.id);
      if (!r.ok) {
        // 内置模板走不到这里（UI 不给按钮）；真走到这里说明是被越权触发的，
        // 主进程已经拒了，这里如实把原因显示出来。
        setDeleteError(templateErrorText(r.error.code));
        return;
      }
      setDeleteTarget(null);
      await reload();
      setNotice(tx('extensions.paperTemplatesSection.deleted', { name: target.name }));
    } catch {
      setDeleteError(tx('extensions.paperTemplatesSection.deleteFailed'));
    } finally {
      setDeleteBusy(false);
    }
  };

  /** 一个模板分组（内置 / 我的模板） */
  const renderGroup = (titleKey: string, icon: string, items: PaperTemplate[]): JSX.Element | null => {
    if (items.length === 0) return null;
    return (
      <div className="ext-group">
        <div className="ext-group-head">
          <Icon name={icon} size={12} />
          <span>{tx(titleKey)}</span>
        </div>
        {items.map((tpl) => (
          <button
            key={tpl.id}
            className={`ext-item${current?.id === tpl.id ? ' active' : ''}`}
            onClick={() => {
              setSelected(tpl.id);
              // 换一条模板就把上一条的"已创建 / 已删除"提示收掉 ——
              // 否则用户会以为刚点的这一条也发生了那件事。
              setNotice(null);
            }}
          >
            <Icon name="file-text" size={16} className="ext-item-icon" />
            <span className="ext-item-main">
              <span className="ext-item-name">{tpl.name}</span>
              <span className="ext-item-desc">{tpl.description}</span>
            </span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <>
      <div className="ext-list">
        <div className="ext-list-head">
          {searchOpen ? (
            <>
              <input
                className="input ext-search"
                autoFocus
                placeholder={tx('extensions.paperTemplatesSection.searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="ext-icon-btn"
                title={tx('extensions.paperTemplatesSection.closeSearch')}
                onClick={() => {
                  setSearchOpen(false);
                  setQuery('');
                }}
              >
                <Icon name="x" size={14} />
              </button>
            </>
          ) : (
            <>
              <span className="ext-list-title">
                {tx('extensions.paperTemplatesSection.header')}
              </span>
              <div className="grow" />
              <button
                className="ext-icon-btn"
                title={tx('extensions.paperTemplatesSection.searchTemplates')}
                onClick={() => setSearchOpen(true)}
              >
                <Icon name="search" size={15} />
              </button>
            </>
          )}
        </div>

        <div className="ext-list-body">
          {loading ? (
            <div className="empty">{tx('extensions.paperTemplatesSection.loading')}</div>
          ) : list.length === 0 ? (
            <div className="empty">
              {query
                ? tx('extensions.paperTemplatesSection.noResults')
                : tx('extensions.paperTemplatesSection.empty')}
            </div>
          ) : (
            <>
              {renderGroup(
                'extensions.paperTemplatesSection.builtinGroup',
                'package-check',
                builtinList,
              )}
              {renderGroup('extensions.paperTemplatesSection.customGroup', 'user', customList)}
            </>
          )}
        </div>

        <div className="ext-list-foot">
          {t('{{n}} 个模板', { n: list.length })}
        </div>
      </div>

      <div className="ext-detail">
        {!current ? (
          <div className="empty">{tx('extensions.paperTemplatesSection.empty')}</div>
        ) : (
          <>
            <div className="ext-detail-head">
              <span className="ext-detail-name">{current.name}</span>
              <div className="grow" />
              <span className="badge">
                {current.source === 'custom'
                  ? tx('extensions.paperTemplatesSection.customBadge')
                  : tx('extensions.paperTemplatesSection.builtinBadge')}
              </span>
            </div>

            {/* ── 操作区（原版 `useTemplate` / `forkTemplate` / `editTemplate` / 删除）── */}
            <div className="row ext-detail-actions">
              <button className="btn btn-sm btn-primary" onClick={() => void useThisTemplate(current)}>
                {tx('extensions.paperTemplatesSection.useTemplate')}
              </button>
              <button className="btn btn-sm" onClick={() => openFork(current)}>
                {tx('extensions.paperTemplatesSection.forkTemplate')}
              </button>
              {/*
                ⚠️ 删除按钮**只在自定义模板上出现** —— 但这不是那道闸：
                   真正的拒绝在主进程 `deletePaperTemplate`（回 `builtin_template_readonly` 403）。
                   这里不渲染只是"不给用户看一个必然失败的按钮"，越权调用通道照样被挡。
              */}
              {current.source === 'custom' && (
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteTarget(current);
                  }}
                >
                  {tx('extensions.paperTemplatesSection.deleteTitle')}
                </button>
              )}
            </div>

            {notice && <div className="ext-detail-notice">{notice}</div>}

            <div className="ext-detail-scroll">
              <div className="ext-field-row">
                <span className="ext-field-label">{tx('extensions.paperTemplatesSection.language')}</span>
                <span className="ext-field-value">{langLabel(current.language)}</span>
              </div>
              <div className="ext-field-row">
                <span className="ext-field-label">{tx('extensions.paperTemplatesSection.entryFile')}</span>
                <span className="ext-field-value mono">{current.entryFile}</span>
              </div>
              <div className="ext-field-row">
                <span className="ext-field-label">{tx('extensions.paperTemplatesSection.folder')}</span>
                <span className="ext-field-value mono">{current.dir}</span>
              </div>
              <div className="ext-field-row">
                <span className="ext-field-label">{tx('extensions.paperTemplatesSection.source')}</span>
                <span className="ext-field-value">
                  {/* ⚠️ 原版实机取证（install asar @61892818 附近 / customSource 上下文）：
                      原版这一行是 `{source} · {source === "custom" ? customSource : "mma-paper"}`，
                      **没有 `builtinSource` 这个键**（`builtinSource` 只存在于
                      `extensions.connectorsSection.*`，是连接器详情那边的）。早期写成
                      `paperTemplatesSection.builtinSource` 取不到值，`tx()` 会把键路径原样渲染出来。 */}
                  {current.source === 'custom'
                    ? tx('extensions.paperTemplatesSection.customSource')
                    : 'mma-paper'}
                </span>
              </div>
              {current.defaultFor.length > 0 && (
                <div className="ext-field-row">
                  <span className="ext-field-label">
                    {tx('extensions.paperTemplatesSection.defaultFor')}
                  </span>
                  <span className="ext-field-value">
                    {current.defaultFor.map((l) => langLabel(l)).join(' · ')}
                  </span>
                </div>
              )}
              <div className="ext-desc-block">
                <div className="ext-field-label">{tx('extensions.detail.description')}</div>
                <div className="ext-desc-text">{current.description}</div>
              </div>
              <div className="ext-desc-block">
                <div className="ext-field-label">
                  {tx('extensions.paperTemplatesSection.howItWorks')}
                </div>
                <div className="ext-desc-text">
                  {tx('extensions.paperTemplatesSection.howItWorksDescription', {
                    entryFile: current.entryFile,
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── 「基于此模板自定义」弹层（原版 forkDialog*）── */}
      {forkOpen && current && (
        <Modal onClose={() => (forkBusy ? undefined : setForkOpen(false))}>
          <div className="ext-modal-head">
            <span className="ext-modal-title">
              {tx('extensions.paperTemplatesSection.forkDialogTitle')}
            </span>
          </div>
          <div className="ext-modal-sub">
            {tx('extensions.paperTemplatesSection.forkDialogDescription')}
          </div>

          <div className="col" style={{ gap: 10, marginTop: 12 }}>
            <label className="ext-field-label">
              {tx('extensions.paperTemplatesSection.forkSourceLabel')}
            </label>
            <div className="ext-fork-source">
              {current.name ||
                tx('extensions.paperTemplatesSection.forkSourcePlaceholder')}
            </div>

            <label className="ext-field-label" htmlFor="ext-fork-name">
              {tx('extensions.paperTemplatesSection.forkNameLabel')}
            </label>
            <input
              id="ext-fork-name"
              className="input"
              autoFocus
              value={forkName}
              placeholder={tx('extensions.paperTemplatesSection.forkNamePlaceholder')}
              onChange={(e) => setForkName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitFork();
              }}
            />
            {forkError && <div className="ext-form-error">{forkError}</div>}
          </div>

          <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              className="btn btn-sm"
              disabled={forkBusy}
              onClick={() => setForkOpen(false)}
            >
              {tx('common.cancel')}
            </button>
            {/*
              ⚠️ 这里用 `common.create`（创建）而不是原版的 `forkAndEdit`（创建并编辑）：
                 原版 `forkAndEdit` = 创建 + 打开**模板编辑器会话**
                 （`editorSessionTitle` / `editorProjectName`），本复刻还没有模板编辑器。
                 照抄那个标签会是"按了不编辑"的假按钮，宁可先用一条通用文案。
            */}
            <button className="btn btn-sm btn-primary" disabled={forkBusy} onClick={() => void submitFork()}>
              {tx('common.create')}
            </button>
          </div>
        </Modal>
      )}

      {/* ── 删除确认（原版 deleteTitle / deleteDescription / deleting）── */}
      {deleteTarget && (
        <ConfirmDialog
          title={tx('extensions.paperTemplatesSection.deleteTitle')}
          message={tx('extensions.paperTemplatesSection.deleteDescription', {
            name: deleteTarget.name,
          })}
          confirmLabel={tx('common.delete')}
          extra={deleteError}
          busy={deleteBusy}
          busyLabel={tx('extensions.paperTemplatesSection.deleting')}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void submitDelete()}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// 插件 tab
// 原版实测（.workbuddy/ui-audit/original-interactions/ext-plugins.png）：
//   插件 tab = 「插件」列表 + 详情面板，列的是**本机 Claude Code 插件**；
//   本机没有插件时只有空态「没有结果」。飞书 / 微信 / 更新 / 运行环境并不在这里
//   （那是设置页 `integrations.*` 的分区），所以这里不放四个分区，只保留
//   一行置灰说明 + 运行环境入口，避免出现原版没有的整块区域。
// ─────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────
// 帮助弹窗 / 二次确认弹窗
// ─────────────────────────────────────────────────────────────

function HelpDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const rows = [
    { kind: 'skillsKind', body: 'skillsBody', icon: 'sparkles' },
    { kind: 'templatesKind', body: 'templatesBody', icon: 'file-text' },
    { kind: 'algorithmsKind', body: 'algorithmsBody', icon: 'sigma' },
    { kind: 'pluginsKind', body: 'pluginsBody', icon: 'blocks' },
    { kind: 'connectorsKind', body: 'connectorsBody', icon: 'plug' },
  ];
  return (
    <Modal onClose={onClose}>
      <div className="ext-modal-head">
        <span className="ext-modal-title">{tx('extensions.extensionsHelpDialog.title')}</span>
        <button className="ext-icon-btn" title={tx('common.close')} onClick={onClose}>
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="ext-modal-sub">{tx('extensions.extensionsHelpDialog.subtitle')}</div>
      <div className="ext-modal-body">
        {rows.map((r) => (
          <div key={r.kind} className="ext-help-row">
            <Icon name={r.icon} size={15} />
            <div className="col" style={{ gap: 3 }}>
              <span className="ext-help-kind">
                {tx(`extensions.extensionsHelpDialog.${r.kind}`)}
              </span>
              <span className="ext-help-body">
                {tx(`extensions.extensionsHelpDialog.${r.body}`)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  extra,
  busy = false,
  busyLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  /** 失败原因（如主进程把内置模板的删除拒了）—— 有就显示在正文下面 */
  extra?: string | null;
  /** 忙碌中：两个按钮都禁用（原版 `deleting` 态） */
  busy?: boolean;
  busyLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <Modal onClose={onCancel}>
      <div className="ext-modal-head">
        <span className="ext-modal-title">{title}</span>
      </div>
      <div className="ext-modal-sub">{message}</div>
      {extra && <div className="ext-form-error">{extra}</div>}
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn btn-sm" disabled={busy} onClick={onCancel}>
          {tx('common.cancel')}
        </button>
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={onConfirm}>
          {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="ext-modal-mask" onClick={onClose}>
      <div className="ext-modal panel" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
