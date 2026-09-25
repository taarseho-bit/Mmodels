import { BrowserWindow, ipcMain } from 'electron';
import { getDb } from '../db';
import { WORKFLOW_IPC, type WorkflowRun } from '@shared/workflow';

/** 新增独立表，不更改对话正文。每任务保留最近 20 轮；删除任务时自动级联删除。 */
export function publishWorkflow(run: WorkflowRun): void {
  let published = run;
  try {
    const db = getDb();
    const session = db.prepare('SELECT project_id, title FROM sessions WHERE id=?').get(run.sessionId) as { project_id?: string; title?: string } | undefined;
    published = { ...run, ...(session?.project_id ? { projectId: session.project_id } : {}), ...(session?.title ? { sessionTitle: session.title } : {}) };
    db.prepare(`INSERT INTO workflow_runs (id, session_id, started_at, snapshot) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot`).run(run.id, run.sessionId, run.startedAt, JSON.stringify(published));
    if (run.revision === 1 || run.status !== 'running') db.prepare(`DELETE FROM workflow_runs WHERE session_id=? AND id NOT IN
      (SELECT id FROM workflow_runs WHERE session_id=? ORDER BY started_at DESC, id DESC LIMIT 20)`).run(run.sessionId, run.sessionId);
  } catch (error) {
    console.warn('[workflow] 运行记录暂未保存', error instanceof Error ? error.name : 'unknown');
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(WORKFLOW_IPC.changed, published);
  }
}

export function registerWorkflowHandlers(): void {
  // 上次异常退出的记录不再伪装成仍在工作。本函数只在主进程启动时执行。
  const db = getDb();
  const old = db.prepare(`SELECT id, snapshot FROM workflow_runs WHERE snapshot LIKE '%"status":"running"%'`).all() as { id: string; snapshot: string }[];
  for (const row of old) {
    try {
      const run = JSON.parse(row.snapshot) as WorkflowRun;
      if (run.status !== 'running') continue;
      run.status = 'interrupted'; run.revision++;
      for (const node of run.nodes) {
        if (node.status === 'running') node.status = 'unknown';
        for (const tool of node.tools) if (tool.status === 'running') tool.status = 'unknown';
      }
      db.prepare('UPDATE workflow_runs SET snapshot=? WHERE id=?').run(JSON.stringify(run), row.id);
    } catch { /* 一条损坏的记录不影响启动或其他历史 */ }
  }
  ipcMain.handle(WORKFLOW_IPC.list, (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length > 200) throw new Error('请选择有效任务');
    const rows = getDb().prepare('SELECT snapshot FROM workflow_runs WHERE session_id=? ORDER BY started_at DESC, id DESC LIMIT 20').all(sessionId) as { snapshot: string }[];
    return rows.flatMap(row => { try { return [JSON.parse(row.snapshot) as WorkflowRun]; } catch { return []; } });
  });
  ipcMain.handle(WORKFLOW_IPC.listProject, (_event, projectId: unknown) => {
    if (typeof projectId !== 'string' || projectId.length > 200) throw new Error('请选择有效项目');
    const rows = getDb().prepare(`SELECT wr.snapshot, s.project_id, s.title FROM workflow_runs wr
      INNER JOIN sessions s ON s.id = wr.session_id
      WHERE s.project_id=? ORDER BY wr.started_at DESC, wr.id DESC LIMIT 100`).all(projectId) as { snapshot: string; project_id?: string; title?: string }[];
    return rows.flatMap(row => {
      try {
        const run = JSON.parse(row.snapshot) as WorkflowRun;
        return [{ ...run, projectId: run.projectId ?? row.project_id, sessionTitle: run.sessionTitle ?? row.title }];
      } catch {
        return [];
      }
    });
  });
}
