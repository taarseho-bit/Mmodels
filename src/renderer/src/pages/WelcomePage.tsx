/**
 * 欢迎页 —— 没有项目时的落地页。
 *
 * 设计意图（复刻原版第一屏，但做了改进）：
 *   原版第一屏是登录/付费引导；我们按用户要求**去掉账号计费**，
 *   所以这里回归到真正该做的事：**让用户最快地开始一次建模任务**。
 *
 * 三条路径，按推荐度排列：
 *   1. 新建项目 —— 我们会创建一个标准目录结构 + .mathmodel/ 约定目录
 *   2. 打开已有项目 —— 上次没做完的接着做
 *   3. 直接描述题目 —— 先聊起来，项目自动建
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/app';
import { t, tx, getLang } from '../i18n';
import { friendlyError } from '../lib/friendly-error';
import { Icon } from '../components/Icon';

export function WelcomePage(): JSX.Element {
  const projects = useApp((s) => s.projects);
  const createProject = useApp((s) => s.createProject);
  const openProject = useApp((s) => s.openProject);
  const removeProject = useApp((s) => s.removeProject);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (createOpen) nameInputRef.current?.focus();
  }, [createOpen]);

  const openCreateDialog = (): void => {
    setProjectName(
      t('建模任务 {{date}}', {
        date: new Date().toLocaleDateString(getLang() === 'en-US' ? 'en-US' : 'zh-CN'),
      }),
    );
    setError(null);
    setCreateOpen(true);
  };

  const onCreate = async (): Promise<void> => {
    const name = projectName.trim();
    if (!name) {
      setError(t('请输入项目名称。'));
      nameInputRef.current?.focus();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const meta = await createProject(name);
      if (!meta) {
        // 用户在选择目录那一步取消了
        setError(t('已取消创建。'));
      } else {
        setCreateOpen(false);
      }
    } catch (e) {
      setError(friendlyError(e, '项目没有创建成功，可以重试。'));
    } finally {
      setBusy(false);
    }
  };

  const onOpen = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await openProject(id);
    } catch (e) {
      setError(friendlyError(e, '项目文件夹没有打开成功，可以重试。'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        height: '100vh',
        overflow: 'auto',
        display: 'flex',
        justifyContent: 'center',
        padding: '56px 24px 40px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 760 }}>
        {/* ── 品牌区 ── */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 44, lineHeight: 1, marginBottom: 14, color: 'var(--accent)' }}>
            <Icon name="sigma" size={44} strokeWidth={1.5} />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 650, margin: '0 0 10px' }}>MModels</h1>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.8, margin: 0 }}>
            {t('面向数学建模竞赛的桌面工作台 · 选题 → 建模 → 求解 → 论文')}
          </p>
        </div>

        {/* ── 主行动 ── */}
        <div
          className="panel"
          style={{
            padding: 22,
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            flexWrap: 'wrap',
          }}
        >
          <div className="col grow" style={{ minWidth: 240 }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 5 }}>{t('新建一个建模项目')}</div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
              {t('会创建标准工作目录，并写入')} <code className="mono">.mathmodel/</code>{' '}
              {t('约定文件，之后代码、数据、图表、论文都会规整地放在里面。')}
            </div>
          </div>
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={openCreateDialog}>
            {busy ? tx('profile.editProfileDialog.processing') : t('＋ 新建项目')}
          </button>
        </div>

        {error && (
          <div
            className="panel"
            style={{ padding: 12, marginBottom: 18, color: 'var(--danger)', fontSize: 12.5 }}
          >
            {error}
          </div>
        )}

        {createOpen && (
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={() => !busy && setCreateOpen(false)}
          >
            <form
              className="modal"
              style={{ width: 460 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                void onCreate();
              }}
            >
              <div className="modal-head">
                <span className="modal-title">{tx('shell.newProjectDialog.title')}</span>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  aria-label={tx('common.close')}
                  disabled={busy}
                  onClick={() => setCreateOpen(false)}
                >
                  ✕
                </button>
              </div>
              <div className="modal-body col" style={{ gap: 8 }}>
                <label htmlFor="new-project-name" style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {tx('shell.newProjectDialog.namePlaceholder')}
                </label>
                <input
                  ref={nameInputRef}
                  id="new-project-name"
                  className="input"
                  value={projectName}
                  disabled={busy}
                  maxLength={120}
                  placeholder={t('例如：2026 国赛 A 题')}
                  onChange={(e) => setProjectName(e.target.value)}
                />
                <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                  {t('下一步请选择项目所在文件夹，代码、数据、图表和论文都会保存在该目录中。')}
                </span>
                {error && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span>}
              </div>
              <div className="modal-foot">
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => setCreateOpen(false)}
                >
                  {tx('common.cancel')}
                </button>
                <button className="btn btn-primary" type="submit" disabled={busy}>
                  {busy ? tx('extensions.algorithmsSection.starting') : t('选择文件夹并创建')}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── 最近项目 ── */}
        {projects.length > 0 && (
          <>
            <div
              className="row"
              style={{ marginBottom: 10, justifyContent: 'space-between', alignItems: 'baseline' }}
            >
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t('最近的项目')}</span>
              <span className="muted" style={{ fontSize: 11 }}>
                {tx('papers.detail.likesValue', { count: projects.length })}
              </span>
            </div>

            <div className="col" style={{ gap: 8 }}>
              {projects.map((p) => (
                <div
                  key={p.id}
                  className="panel row"
                  style={{ padding: '12px 14px', gap: 12, alignItems: 'center' }}
                >
                  <span style={{ fontSize: 18, display: 'inline-flex', alignItems: 'center' }}>
                    <Icon name="folder" size={18} />
                  </span>
                  <div className="col grow" style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }} className="truncate">
                      {p.name}
                    </div>
                    <div className="muted mono truncate" style={{ fontSize: 10.5 }} title={p.root}>
                      {p.root}
                    </div>
                  </div>
                  <span className="muted" style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>
                    {p.lastOpenedAt
                      ? new Date(p.lastOpenedAt).toLocaleDateString(getLang() === 'en-US' ? 'en-US' : 'zh-CN')
                      : '—'}
                  </span>
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => void onOpen(p.id)}
                  >
                    {tx('common.open')}
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    title={t('从列表移除（不删除磁盘文件）')}
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          t(
                            '从列表移除「{{name}}」？\n\n⚠️ 只移出列表，磁盘上的文件不会被删除。',
                            { name: p.name },
                          ),
                        )
                      ) {
                        void removeProject(p.id, false);
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── 能力说明 ── */}
        <div className="starters" style={{ marginTop: 32 }}>
          {[
            {
              icon: 'brain',
              title: t('多智能体编排'),
              desc: t('选题分析 / 建模 / 编码 / 论文四个角色分工，不是一个大 prompt 硬扛'),
            },
            {
              icon: 'wrench',
              title: t('可插拔技能'),
              desc: t('论文模板、数据分析、绘图、LaTeX 编译等能力按需挂载'),
            },
            {
              icon: 'square-terminal',
              title: t('真实终端'),
              desc: t('agent 跑 python / latex 的每一步你都看得见，随时能接手'),
            },
            {
              icon: 'folder-open',
              title: t('产物透明'),
              desc: t('所有中间结果都落在项目目录，不藏在数据库里'),
            },
          ].map((f) => (
            <div key={f.title} className="starter" style={{ cursor: 'default' }}>
              <span className="starter-title">
                <Icon
                  name={f.icon}
                  size={13}
                  style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }}
                />
                {f.title}
              </span>
              <span className="starter-desc">{f.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
