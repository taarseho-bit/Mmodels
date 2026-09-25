/**
 * 自动化页 —— 定时自动跑 agent。
 *
 * 使用场景（原版的核心卖点之一）：
 *   「每天早上 8 点用最新数据重跑一次预测模型，把结果写进 report.md」
 *
 * ⚠️ 关键约束：任务不会重叠执行
 *   上一轮还没跑完就到下一个触发点 —— 主进程会**跳过**这一轮而不是并发起两个 agent
 *   （并发会互相踩同一个工作目录）。
 *
 * ⚠️ cron 表达式是 5 段标准格式：分 时 日 月 周
 *   不引入 cron 库，主进程手写了 80 行解析（见 main/ipc/automation.ts）。
 *   这里提供常用模板，避免用户去查语法。
 *
 * 页面文案全部走原版 `automation.automationPage.*` 键（空态标题/描述/主按钮）。
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../store/app';
import { PageShell, EmptyState } from '../components/PageShell';
import { Icon } from '../components/Icon';
import { t, tx, getLang } from '../i18n';
import { friendlyError } from '../lib/friendly-error';

/**
 * 主进程回传的记录形态。
 * preload 里返回的是 unknown[]（因为 automation 是最后加的功能，没来得及进 shared/types），
 * 这里做一次收窄，好处是页面代码有类型、且**单一收窄点**便于以后搬到 shared/types。
 */
interface AutomationRecord {
  id: string;
  projectId: string;
  name: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
}

interface RunRecord {
  id: string;
  automation_id: string;
  session_id: string | null;
  status: string;
  started_at: number;
  finished_at: number | null;
  summary: string | null;
  error: string | null;
}

function toAutomations(value: unknown): AutomationRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is AutomationRecord => !!x && typeof x === 'object');
}

function toRuns(value: unknown): RunRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is RunRecord => !!x && typeof x === 'object');
}

const TEMPLATES: Array<{ label: string; cron: string; hint: string }> = [
  { label: '每天早上 8 点', cron: '0 8 * * *', hint: '工作日开工前把结果准备好' },
  { label: '每 6 小时', cron: '0 */6 * * *', hint: '一天四次，跟进数据变化' },
  { label: '每小时', cron: '0 * * * *', hint: '适合监控型任务' },
  { label: '每周一 9 点', cron: '0 9 * * 1', hint: '周报场景' },
  { label: '每 30 分钟', cron: '*/30 * * * *', hint: '高频，注意 token 消耗' },
];

const MODELING_PRESETS: Array<{ label: string; name: string; prompt: string; cron: string }> = [
  {
    label: '数据更新后复盘',
    name: '数据更新后复盘',
    prompt: '读取 data/ 下最新数据，检查缺失值、异常值和字段变化；如果数据结构没有问题，重新运行当前项目的模型，并把数据质量摘要写入 .mathmodel/data-quality.md。',
    cron: '0 */6 * * *',
  },
  {
    label: '论文交付检查',
    name: '论文交付检查',
    prompt: '检查当前项目论文的页数、图表、表格、参考文献、中文字体和 PDF 输出；把需要处理的问题写入 .mathmodel/delivery-check.md，不要擅自修改正文。',
    cron: '0 8 * * *',
  },
  {
    label: '比赛截止提醒',
    name: '比赛截止前准备',
    prompt: '读取当前项目比赛信息和截止时间，检查论文和提交文件是否齐全；如果距离截止时间不足 72 小时，生成简短的待办清单。',
    cron: '0 9 * * *',
  },
];

/** 空态图标 —— 原版是圆角容器内的线性 SVG（两个错位圆角方块），不是 emoji */
function TasksIcon(): JSX.Element {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4.5" y="4.5" width="9" height="9" rx="2.2" />
      <rect x="10.5" y="10.5" width="9" height="9" rx="2.2" />
    </svg>
  );
}

function describeCron(expr: string): string {
  const tpl = TEMPLATES.find((x) => x.cron === expr);
  if (tpl) return t(tpl.hint);
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return t('⚠️ 需要 5 段（分 时 日 月 周）');
  return t('自定义表达式');
}

function fmtTime(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(getLang() === 'en-US' ? 'en-US' : 'zh-CN', { hour12: false });
}

function relative(ms: number | null): string {
  if (!ms) return '';
  const diff = ms - Date.now();
  if (diff < 0) return t('（已过期）');
  const min = Math.floor(diff / 60000);
  if (min < 60) return t('{{n}} 分钟后', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('{{n}} 小时后', { n: h });
  return t('{{n}} 天后', { n: Math.floor(h / 24) });
}

// ─────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────

export function AutomationPage(): JSX.Element {
  const project = useApp((s) => s.currentProject);

  const [items, setItems] = useState<AutomationRecord[]>([]);
  const [editing, setEditing] = useState<AutomationRecord | null>(null);
  const [runs, setRuns] = useState<Record<string, RunRecord[]>>({});
  const [expandedRuns, setExpandedRuns] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const projectId = project?.id ?? null;

  const reload = useCallback(async () => {
    if (!projectId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      setItems(toAutomations(await window.mathmodel.automation.list(projectId)));
    } catch (e) {
      setError(friendlyError(e, '自动化任务没有读取成功，可以重试。'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ── 监听主进程的变更通知（任务开始/结束）──
  useEffect(() => {
    const off = window.mathmodel.automation.onChanged(() => {
      void reload();
    });
    return off;
  }, [reload]);

  const save = useCallback(async () => {
    if (!editing || !projectId) return;
    const name = editing.name.trim();
    const prompt = editing.prompt.trim();
    const cron = editing.cron.trim();

    if (!name) {
      setError(t('任务名称不能为空。'));
      return;
    }
    if (!prompt) {
      setError(t('提示词不能为空 —— agent 需要知道该做什么。'));
      return;
    }
    if (cron.split(/\s+/).length !== 5) {
      setError(t('cron 表达式需要 5 段（分 时 日 月 周），当前 {{n}} 段。', { n: cron.split(/\s+/).length }));
      return;
    }

    setBusy(editing.id);
    setError(null);
    try {
      const list = toAutomations(
        await window.mathmodel.automation.upsert({
          id: items.some((x) => x.id === editing.id) ? editing.id : undefined,
          projectId,
          name,
          prompt,
          cron,
          enabled: editing.enabled,
        }),
      );
      setItems(list);
      setEditing(null);
    } catch (e) {
      setError(friendlyError(e, '自动化任务没有保存成功，可以重试。'));
    } finally {
      setBusy(null);
    }
  }, [editing, items, projectId]);

  const toggle = useCallback(async (a: AutomationRecord) => {
    setBusy(a.id);
    setError(null);
    try {
      setItems(toAutomations(await window.mathmodel.automation.toggle(a.id, !a.enabled)));
    } catch (e) {
      setError(friendlyError(e, '自动化任务没有更新成功，可以重试。'));
    } finally {
      setBusy(null);
    }
  }, []);

  const remove = useCallback(
    async (a: AutomationRecord) => {
      if (!window.confirm(t('删除自动化任务「{{name}}」？\n\n历史运行记录也会一并移除。', { name: a.name }))) return;
      setBusy(a.id);
      try {
        setItems(toAutomations(await window.mathmodel.automation.remove(a.id)));
      } catch (e) {
        setError(friendlyError(e, '自动化任务没有删除成功，可以重试。'));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const runNow = useCallback(async (a: AutomationRecord) => {
    setBusy(a.id);
    setError(null);
    try {
      await window.mathmodel.automation.runNow(a.id);
      // 等两秒再刷新，让主进程把状态写进去
      window.setTimeout(() => void reload(), 2000);
    } catch (e) {
        setError(friendlyError(e, '自动化任务没有暂停成功，可以重试。'));
    } finally {
      setBusy(null);
    }
  }, [reload]);

  const loadRuns = useCallback(async (a: AutomationRecord) => {
    if (expandedRuns === a.id) {
      setExpandedRuns(null);
      return;
    }
    setExpandedRuns(a.id);
    try {
      const list = toRuns(await window.mathmodel.automation.runs(a.id));
      setRuns((prev) => ({ ...prev, [a.id]: list }));
    } catch (e) {
        setError(friendlyError(e, '自动化任务没有立即运行，可以重试。'));
    }
  }, [expandedRuns]);

  const createTask = useCallback((): void => {
    if (!project) return;
    setError(null);
    setEditing({
      id: `a_${Date.now().toString(36)}`,
      projectId: project.id,
      name: '',
      prompt: '',
      cron: '0 8 * * *',
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastRunAt: null,
      nextRunAt: null,
    });
  }, [project]);

  if (!project) {
    return <div className="empty">{t('请先打开一个项目，自动化任务绑定在项目上。')}</div>;
  }

  // ── 编辑态 ──
  if (editing) {
    return (
      <div className="page">
        <div className="page-head">
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>
            {t('← 返回')}
          </button>
          <span className="page-title">
            {items.some((x) => x.id === editing.id) ? t('编辑任务') : t('新建定时任务')}
          </span>
        </div>

        <div className="page-scroll">
          <div className="page-narrow col" style={{ gap: 18 }}>
            {error && (
              <div className="panel" style={{ padding: 12, color: 'var(--danger)', fontSize: 12.5 }}>
                {error}
              </div>
            )}

            <div className="panel col" style={{ padding: 14, gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>数学建模预设</div>
              <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                先选一个常用场景，再按当前项目修改内容。高级定时规则仍然可以在下方调整。
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {MODELING_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    className="btn btn-sm btn-ghost"
                    onClick={() => setEditing({ ...editing, name: preset.name, prompt: preset.prompt, cron: preset.cron })}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label className="field-label">{t('任务名称')}</label>
              <input
                className="input"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder={t('比如：每日数据复盘')}
              />
            </div>

            <div className="field">
              <label className="field-label">{t('给 agent 的指令')}</label>
              <textarea
                className="textarea"
                rows={7}
                value={editing.prompt}
                onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
                placeholder={t('比如：读取 data/ 下最新数据，重新拟合预测模型，把图表写入 figures/，并在 report.md 里追加一段结论。')}
              />
              <div className="field-hint">
                {t('每次触发都会**新建一个会话**来跑这段指令，所以上下文是干净的 ——')}
                {t('需要的历史信息请在指令里写明路径，或写进')}{' '}
                <code className="mono">.mathmodel/context.md</code>。
              </div>
            </div>

            <div className="field">
              <label className="field-label">{t('运行时间')}</label>
              <div className="field-hint" style={{ marginBottom: 6 }}>
                {t('常用场景可以直接选择；需要更精确的时间时，再展开高级定时规则。')}
              </div>
              <input
                className="input mono"
                style={{ fontSize: 13 }}
                value={editing.cron}
                onChange={(e) => setEditing({ ...editing, cron: e.target.value })}
                placeholder="0 8 * * *"
              />
              <details style={{ marginTop: 6 }}>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: 11.5 }}>高级定时规则</summary>
                <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                  {TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.cron}
                      className="btn btn-sm btn-ghost"
                      onClick={() => setEditing({ ...editing, cron: tpl.cron })}
                      title={t(tpl.hint)}
                    >
                      {t(tpl.label)}
                    </button>
                  ))}
                </div>
              </details>
              <div className="field-hint">
                {t('当前含义：')}{describeCron(editing.cron)} · {t('例：')}{' '}
                <code className="mono">0 8 * * 1-5</code> {t('表示周一至周五 8:00')}
              </div>
            </div>

            <label className="row" style={{ gap: 10, cursor: 'pointer', alignItems: 'center' }}>
              <button
                className={`switch${editing.enabled ? ' on' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  setEditing({ ...editing, enabled: !editing.enabled });
                }}
              >
                <span className="switch-knob" />
              </button>
              <span style={{ fontSize: 13 }}>{t('保存后立即启用')}</span>
            </label>

            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" disabled={!!busy} onClick={() => void save()}>
                {busy ? t('保存中…') : tx('common.save')}
              </button>
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>
                {tx('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 列表态 ──
  // 原版：页头只有 `自动化 / 定时任务`，空态内自带主按钮「＋ 创建定时任务」；
  // 非空时才在页头放「刷新 / 新建」。没有「调度说明」面板（那是复刻自创的）。
  return (
    <PageShell
      title={tx('automation.automationPage.title')}
      description={tx('automation.automationPage.description')}
      action={
        items.length > 0 ? (
          <>
            <button className="btn btn-sm btn-ghost" onClick={() => void reload()}>
              ⟳ {tx('common.refresh')}
            </button>
            <button className="btn btn-sm btn-primary" onClick={createTask}>
              ＋ {tx('automation.automationPage.new')}
            </button>
          </>
        ) : null
      }
    >
      <div className="auto-page">
        {error ? (
          <div
            className="panel"
            style={{ padding: 12, marginBottom: 12, color: 'var(--danger)', fontSize: 12.5 }}
          >
            {error}
          </div>
        ) : null}

        {loading && items.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>
            {tx('common.loading')}
          </div>
        ) : null}

        {!loading && items.length === 0 ? (
          <EmptyState
            icon={<TasksIcon />}
            title={tx('automation.automationPage.emptyTitle')}
            description={tx('automation.automationPage.emptyDescription')}
            action={
              <button className="btn btn-primary" onClick={createTask}>
                ＋ {tx('automation.automationPage.createTask')}
              </button>
            }
          />
        ) : null}

        <div className="col" style={{ gap: 8 }}>
          {items.map((a) => {
              const runList = runs[a.id] ?? [];
              const showRuns = expandedRuns === a.id;
              const isBusy = busy === a.id;
              return (
                <div
                  key={a.id}
                  className="panel col"
                  style={{
                    padding: 14,
                    gap: 9,
                    opacity: a.enabled ? 1 : 0.62,
                    borderLeft: `3px solid ${a.enabled ? 'var(--accent)' : 'var(--border-strong)'}`,
                  }}
                >
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <Icon name={a.enabled ? 'clock' : 'circle-pause'} size={14} />
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{a.name}</span>
                    <span className="badge mono" style={{ fontSize: 10 }}>
                      {a.cron}
                    </span>
                    {a.enabled ? (
                      <span className="badge badge-success">
                        {t('下次 ')}{relative(a.nextRunAt)}
                      </span>
                    ) : (
                      <span className="badge badge-warning">
                        {tx('automation.automationPage.paused')}
                      </span>
                    )}

                    <div className="grow" />

                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={isBusy}
                      onClick={() => void runNow(a)}
                      title={t('立即执行一次，不影响后续排期')}
                    >
                      {t('立即运行')}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => void loadRuns(a)}>
                      {showRuns ? t('收起历史') : t('运行历史')}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing(a)}>
                      {tx('common.edit')}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => void remove(a)}>
                      {tx('common.delete')}
                    </button>

                    <button
                      className={`switch${a.enabled ? ' on' : ''}`}
                      disabled={isBusy}
                      onClick={() => void toggle(a)}
                      title={
                        a.enabled
                          ? tx('automation.automationPage.pause')
                          : tx('automation.automationPage.resume')
                      }
                    >
                      <span className="switch-knob" />
                    </button>
                  </div>

                  <div
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.7,
                      color: 'var(--fg-secondary)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {a.prompt}
                  </div>

                  <div className="row muted" style={{ gap: 14, fontSize: 10.5, flexWrap: 'wrap' }}>
                    <span>{t('上次运行：')}{fmtTime(a.lastRunAt)}</span>
                    <span>{t('下次运行：')}{fmtTime(a.nextRunAt)}</span>
                  </div>

                  {showRuns && (
                    <div className="col" style={{ gap: 4 }}>
                      <div className="divider" style={{ margin: '4px 0' }} />
                      {runList.length === 0 ? (
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          {t('还没有运行记录。')}
                        </span>
                      ) : (
                        runList.map((r) => (
                          <div key={r.id} className="row" style={{ gap: 8, fontSize: 11.5 }}>
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                flexShrink: 0,
                                background:
                                  r.status === 'success'
                                    ? 'var(--success)'
                                    : r.status === 'failed'
                                      ? 'var(--danger)'
                                      : 'var(--warning)',
                              }}
                            />
                            <span className="mono muted" style={{ fontSize: 10.5 }}>
                              {fmtTime(r.started_at)}
                            </span>
                            <span
                              style={{
                                color: r.status === 'failed' ? 'var(--danger)' : 'var(--fg-secondary)',
                              }}
                              className="truncate"
                            >
                              {r.error ?? r.summary ?? r.status}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </PageShell>
  );
}
