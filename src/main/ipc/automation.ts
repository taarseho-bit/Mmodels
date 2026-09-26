/**
 * 自动化任务（cron）。
 *
 * 当前实现项目契约的「定时自动跑 agent」能力：比如「每天早上 8 点分析一次最新数据」。
 *
 * ⚠️ 为什么不用 node-cron 之类的库：
 *   cron 表达式解析只用 5 段标准格式（分 时 日 月 周），
 *   我们的需求就是「算下一次触发时间」，手写 80 行足够，
 *   而且能精确控制「跑失败要不要重试」「并发怎么拦」这些项目契约没有的细节。
 *
 * ⚠️ 关键约束：**任务不能重叠执行**。
 *   一个 cron 任务上一轮还没跑完就到下一个触发点了 —— 这时应当跳过，
 *   而不是并发起两个 agent（会互相踩同一个工作目录）。
 */
import { ipcMain, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC } from '@shared/types';
import { getDb } from '../db';
import { createSystemNotification } from '../notify';
import { createSession } from './session';
import { pushToRenderer, safeWrap, type IpcContext } from './index';

// ─────────────────────────────────────────────────────────────
// cron 表达式解析（5 段：分 时 日 月 周）
// ─────────────────────────────────────────────────────────────

interface CronField {
  /** 允许的值集合 */
  allowed: Set<number>;
  /** 是否通配（*）——通配时不需要匹配计算 */
  wildcard: boolean;
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  day: CronField;
  month: CronField;
  weekday: CronField;
}

function parseField(spec: string, min: number, max: number): CronField {
  const allowed = new Set<number>();
  let wildcard = false;

  for (const part of spec.split(',')) {
    const seg = part.trim();
    if (seg === '*') {
      wildcard = true;
      for (let i = min; i <= max; i++) allowed.add(i);
      continue;
    }
    // 支持 a-b、a-b/n、*/n、a/n
    const [rangePart, stepPart] = seg.split('/');
    const step = stepPart ? Math.max(1, Number(stepPart)) : 1;

    let lo = min;
    let hi = max;
    if (rangePart !== '*') {
      const bounds = rangePart.split('-');
      lo = Number(bounds[0]);
      hi = bounds.length > 1 ? Number(bounds[1]) : lo;
      if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    }
    for (let i = lo; i <= hi; i += step) {
      if (i >= min && i <= max) allowed.add(i);
    }
  }
  return { allowed, wildcard };
}

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron 表达式需要 5 段（分 时 日 月 周），当前 ${parts.length} 段：${expr}`);
  }
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    day: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    // cron 的周是 0-6（0=周日）
    weekday: parseField(parts[4], 0, 6),
  };
}

/** 算下一次触发时间（从 from 之后开始找，最多找一年） */
export function nextRunAt(expr: string, from: number = Date.now()): number {
  const c = parseCron(expr);
  const d = new Date(from);
  // 从下一分钟开始
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  const limit = new Date(from);
  limit.setFullYear(limit.getFullYear() + 1);

  while (d < limit) {
    if (
      c.month.allowed.has(d.getMonth() + 1) &&
      c.day.allowed.has(d.getDate()) &&
      c.weekday.allowed.has(d.getDay()) &&
      c.hour.allowed.has(d.getHours()) &&
      c.minute.allowed.has(d.getMinutes())
    ) {
      return d.getTime();
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  // 一年内没有匹配（比如写了 2 月 30 日）→ 返回 0 表示永不再触发
  return 0;
}

// ─────────────────────────────────────────────────────────────
// 数据访问
// ─────────────────────────────────────────────────────────────

export interface AutomationRecord {
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

interface AutomationRow {
  id: string;
  project_id: string;
  name: string;
  prompt: string;
  cron: string;
  enabled: number;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  next_run_at: number | null;
}

function rowToAutomation(r: AutomationRow): AutomationRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    prompt: r.prompt,
    cron: r.cron,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
  };
}

export function listAutomations(projectId: string): AutomationRecord[] {
  const rows = getDb()
    .prepare<[string], AutomationRow>(
      'SELECT * FROM automations WHERE project_id = ? ORDER BY created_at DESC',
    )
    .all(projectId);
  return rows.map(rowToAutomation);
}

export function listAllEnabled(): AutomationRecord[] {
  const rows = getDb()
    .prepare<[], AutomationRow>('SELECT * FROM automations WHERE enabled = 1')
    .all();
  return rows.map(rowToAutomation);
}

// ─────────────────────────────────────────────────────────────
// 调度器
// ─────────────────────────────────────────────────────────────

/** 正在运行的自动化 id —— 防止重叠执行 */
const running = new Set<string>();
let timer: NodeJS.Timeout | null = null;
let debugMode = false;

/** 每个 automations 触发时实际做的事 */
async function executeAutomation(a: AutomationRecord): Promise<void> {
  if (running.has(a.id)) {
    if (debugMode) console.log(`[automation] 跳过 ${a.name}：上一轮还在跑`);
    return;
  }
  running.add(a.id);

  const runId = randomUUID();
  getDb()
    .prepare(
      'INSERT INTO automation_runs (id, automation_id, status, started_at) VALUES (?,?,?,?)',
    )
    .run(runId, a.id, 'running', Date.now());

  pushToRenderer(IPC.AUTOMATION_CHANGED, { automationId: a.id, phase: 'started' });

  try {
    // 每个自动化任务创建一个专属会话来承载这一轮
    const session = createSession(a.projectId, `[自动] ${a.name}`);

    getDb()
      .prepare('UPDATE automation_runs SET session_id = ? WHERE id = ?')
      .run(session.id, runId);

    // ⚠️ 这里不能直接 await sessionRunner.run() —— 因为 send 的实现在 ipc/session.ts
    //    里。为了避免循环依赖，我们在这里直接调 runner。
    const { sessionRegistry } = await import('./session');
    const { getProject } = await import('./project');
    const runner = sessionRegistry.get(session.id);

    const providerId = session.providerId || null;
    const { findProvider, activeProvider, getSettings } = await import('../store/config');
    const provider = (providerId ? findProvider(providerId) : null) ?? activeProvider();
    if (!provider) throw new Error('未配置模型供应商，自动化任务无法执行');

    const { bridgeRegistry } = await import('../agent/bridge-registry');
    const selectedModel = session.model || getSettings().defaultModel || provider.models?.[0] || '';
    const bridgeBaseUrl = await bridgeRegistry.ensureFor(provider, { model: selectedModel, effort: getSettings().effort ?? undefined, disableThinking: getSettings().disableThinking });
    const project = getProject(a.projectId);
    if (!project) throw new Error('定时任务所属项目不存在');
    const { extraPlugins, workspaceInstructions } = await import('../agent/project-plugins');
    const { buildSystemPrompt } = await import('./session');
    const { publishWorkflow } = await import('./workflow');
    const { competitionProjectContext } = await import('./competition-library');

    await runner.run({
      sessionId: session.id,
      prompt: a.prompt,
      provider,
      model: selectedModel,
      cwd: project.root,
      extraPluginPaths: extraPlugins(project.root, getSettings()),
      workspaceInstructions: [workspaceInstructions(project.root), competitionProjectContext(project.id)].filter(Boolean).join('\n'),
      systemPrompt: buildSystemPrompt(project.root),
      multiAgentEnabled: getSettings().multiAgentEnabled !== false,
      onWorkflow: publishWorkflow,
      // 技能插件由 session.ts 自动物化挂载（<userData>/skills-plugin），这里不用管
      builtinMcpEnabled: getSettings().builtinMcpEnabled,
      effort: getSettings().effort ?? undefined,
      disableThinking: getSettings().disableThinking,
      bridgeBaseUrl: bridgeBaseUrl ?? undefined,
    } as Parameters<typeof runner.run>[0]);

    getDb()
      .prepare('UPDATE automation_runs SET status = ?, finished_at = ?, summary = ? WHERE id = ?')
      .run('success', Date.now(), `共 ${runner.totalUsage.outputTokens} 输出 tokens`, runId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    getDb()
      .prepare('UPDATE automation_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?')
      .run('failed', Date.now(), msg, runId);
  } finally {
    running.delete(a.id);
    const next = nextRunAt(a.cron);
    getDb()
      .prepare('UPDATE automations SET last_run_at = ?, next_run_at = ? WHERE id = ?')
      .run(Date.now(), next, a.id);
    pushToRenderer(IPC.AUTOMATION_CHANGED, { automationId: a.id, phase: 'finished' });

    /**
     * 系统通知（对应项目契约的 run-finished 通知）：**只在主窗口没焦点时弹**，
     * 用户正盯着界面就不用打断。点击通知 → 聚焦窗口并打开对应会话
     * （渲染层订阅 NOTIFY_OPEN_SESSION）。
     *
     * ⚠️ 设置里的「允许系统通知」关掉时，`createSystemNotification` 返回 null，
     *    这里**不创建通知对象**（连 click 监听都不会挂上，不留悬空监听），
     *    与 `ipc/app.ts` 的 `notify:show` 走的是同一道门禁（`../notify.ts`）。
     */
    try {
      const winFocused = BrowserWindow.getAllWindows().some(
        (w) => !w.isDestroyed() && w.isFocused(),
      );
      if (!winFocused) {
        const run = getDb()
          .prepare<[string], { status: string; session_id: string | null; error: string | null }>(
            'SELECT status, session_id, error FROM automation_runs WHERE id = ?',
          )
          .get(runId);
        if (run) {
          const ok = run.status === 'success';
          const n = createSystemNotification({
            title: ok ? `自动化「${a.name}」已完成` : `自动化「${a.name}」运行失败`,
            body: ok ? '点击查看结果' : (run.error ?? '点击查看详情'),
          });
          if (n) {
            n.on('click', () => {
              const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
              if (win) {
                if (win.isMinimized()) win.restore();
                win.show();
                win.focus();
              }
              if (run.session_id) {
                pushToRenderer(IPC.NOTIFY_OPEN_SESSION, { sessionId: run.session_id });
              }
            });
            n.show();
          }
        }
      }
    } catch {
      /* 通知失败不影响任务本身 */
    }
  }
}

/** 每分钟扫一次，检查有没有到点的任务 */
function tick(): void {
  const now = Date.now();
  for (const a of listAllEnabled()) {
    if (!a.nextRunAt) continue;
    if (a.nextRunAt > now) continue;
    void executeAutomation(a);
  }
}

export function startScheduler(debug = false): void {
  debugMode = debug;
  if (timer) return;
  // 启动时把 enabled 但 next_run_at 为空的补上
  for (const a of listAllEnabled()) {
    if (!a.nextRunAt) {
      try {
        const next = nextRunAt(a.cron);
        getDb().prepare('UPDATE automations SET next_run_at = ? WHERE id = ?').run(next, a.id);
      } catch {
        /* 表达式非法的任务跳过，界面上会显示错误 */
      }
    }
  }
  timer = setInterval(tick, 60_000);
  // 不要因为这个定时器阻止进程退出
  timer.unref?.();
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ─────────────────────────────────────────────────────────────
// IPC
// ─────────────────────────────────────────────────────────────

export function registerAutomationHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.AUTOMATION_LIST,
    safeWrap((_e, projectId: string) => listAutomations(projectId), '读取自动化列表'),
  );

  ipcMain.handle(
    IPC.AUTOMATION_UPSERT,
    safeWrap(
      (
        _e,
        input: { id?: string; projectId: string; name: string; prompt: string; cron: string; enabled?: boolean },
      ) => {
        // 先验证 cron 合法，别把坏数据写进去
        const next = nextRunAt(input.cron);
        const now = Date.now();

        if (input.id) {
          getDb()
            .prepare(
              `UPDATE automations SET name = ?, prompt = ?, cron = ?, enabled = ?, updated_at = ?, next_run_at = ?
               WHERE id = ?`,
            )
            .run(
              input.name,
              input.prompt,
              input.cron,
              input.enabled === false ? 0 : 1,
              now,
              next,
              input.id,
            );
        } else {
          const id = randomUUID();
          getDb()
            .prepare(
              `INSERT INTO automations (id, project_id, name, prompt, cron, enabled, created_at, updated_at, next_run_at)
               VALUES (?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              id,
              input.projectId,
              input.name,
              input.prompt,
              input.cron,
              input.enabled === false ? 0 : 1,
              now,
              now,
              next,
            );
        }
        return listAutomations(input.projectId);
      },
      '保存自动化任务',
    ),
  );

  ipcMain.handle(
    IPC.AUTOMATION_DELETE,
    safeWrap((_e, id: string) => {
      const row = getDb().prepare<[string], AutomationRow>('SELECT * FROM automations WHERE id = ?').get(id);
      getDb().prepare('DELETE FROM automations WHERE id = ?').run(id);
      return row ? listAutomations(row.project_id) : [];
    }, '删除自动化任务'),
  );

  ipcMain.handle(
    IPC.AUTOMATION_TOGGLE,
    safeWrap((_e, id: string, enabled: boolean) => {
      const row = getDb().prepare<[string], AutomationRow>('SELECT * FROM automations WHERE id = ?').get(id);
      if (!row) throw new Error('任务不存在');
      const next = enabled ? nextRunAt(row.cron) : null;
      getDb()
        .prepare('UPDATE automations SET enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?')
        .run(enabled ? 1 : 0, next, Date.now(), id);
      return listAutomations(row.project_id);
    }, '切换自动化状态'),
  );

  ipcMain.handle(
    IPC.AUTOMATION_RUN_NOW,
    safeWrap(async (_e, id: string) => {
      const row = getDb().prepare<[string], AutomationRow>('SELECT * FROM automations WHERE id = ?').get(id);
      if (!row) throw new Error('任务不存在');
      void executeAutomation(rowToAutomation(row));
      return true;
    }, '立即运行'),
  );

  ipcMain.handle(
    IPC.AUTOMATION_RUNS,
    safeWrap((_e, automationId: string) => {
      return getDb()
        .prepare(
          `SELECT id, automation_id, session_id, status, started_at, finished_at, summary, error
           FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC LIMIT 50`,
        )
        .all(automationId);
    }, '读取运行历史'),
  );
}
