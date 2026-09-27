/**
 * 项目管理。
 *
 * 一个「项目」= 一个工作目录。所有产物（论文、图、数据、`.mathmodel/` 元数据）
 * 都落在项目根目录下。这跟应用约定约定一致 —— 用户拷走整个目录就能带走全部成果。
 *
 * ⚠️ 项目目录里的 `.mathmodel/` 约定：
 *   .mathmodel/paper/config.json   论文模板来源（custom | builtin）
 *   .mathmodel/context.md          项目级上下文（会注入给 agent）
 *   这个目录由 agent 自己按需创建，主进程不强行写。
 */
import { app, ipcMain, dialog } from 'electron';
import { join, basename, resolve, dirname } from 'node:path';
import { projectPathRelation } from './project-paths';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { IPC, type ProjectMeta } from '@shared/types';
import { getDb } from '../db';
import { getSettings, updateSettings } from '../store/config';
import { safeWrap, type IpcContext } from './index';
import { removeCompetitionProject } from './competition-library';

interface ProjectRow {
  id: string;
  name: string;
  root: string;
  created_at: number;
  updated_at: number;
  last_opened_at: number;
}

function rowToMeta(r: ProjectRow): ProjectMeta {
  return {
    id: r.id,
    name: r.name,
    root: r.root,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastOpenedAt: r.last_opened_at,
  };
}

export function listProjects(): ProjectMeta[] {
  const rows = getDb()
    .prepare<[], ProjectRow>('SELECT * FROM projects ORDER BY last_opened_at DESC, created_at DESC')
    .all();
  return rows.map(rowToMeta);
}

export function getProject(id: string): ProjectMeta | null {
  const row = getDb().prepare<[string], ProjectRow>('SELECT * FROM projects WHERE id = ?').get(id);
  return row ? rowToMeta(row) : null;
}

export function findProjectByRoot(root: string): ProjectMeta | null {
  return listProjects().find(p => projectPathRelation(p.root, root) === 'same') ?? null;
}

export function createProject(name: string, root: string): ProjectMeta {
  const abs = resolve(root);
  if (!existsSync(abs)) mkdirSync(abs, { recursive: true });

  const existing = findProjectByRoot(abs);
  if (existing) {
    // 已登记过就只更新名称与打开时间，不重复建
    getDb()
      .prepare('UPDATE projects SET name = ?, last_opened_at = ?, updated_at = ? WHERE id = ?')
      .run(name, Date.now(), Date.now(), existing.id);
    return getProject(existing.id)!;
  }

  const now = Date.now();
  const meta: ProjectMeta = {
    id: randomUUID(),
    name: name || basename(abs),
    root: abs,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
  getDb()
    .prepare(
      'INSERT INTO projects (id, name, root, created_at, updated_at, last_opened_at) VALUES (?,?,?,?,?,?)',
    )
    .run(meta.id, meta.name, meta.root, meta.createdAt, meta.updatedAt, meta.lastOpenedAt);
  return meta;
}

export function touchProject(id: string): void {
  getDb()
    .prepare('UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?')
    .run(Date.now(), Date.now(), id);
}

// ─────────────────────────────────────────────────────────────
// 首次启动播种默认项目（对齐应用约定 @mathmodel/desktop 的行为）
// ─────────────────────────────────────────────────────────────

/**
 * `settings` 表里记录「默认项目」的键。名字直接采用应用约定，别改 ——
 * 当前逻辑靠**这个键是否存在**来区分「全新安装」与「历史版本升级」，
 * 而不是靠 `projects` 表是否为空。两者语义不同：
 * 用户主动把项目全删光时，不该被当成首次安装又塞一个新项目进来。
 */
const BOOTSTRAP_KEY = 'project-bootstrap:v1';

/** 启动时播种的默认项目 id，供渲染层查询（对齐应用约定的 get-default-project-id 通道） */
let defaultProjectId: string | null = null;

/**
 * 默认工作区根目录。
 *
 * ⚠️ 应用约定**不放在 userData 里**，而是放在用户主目录下的
 * `MModels Projects/`。已用实际运行数据核对：
 *   C:\Users\<用户>\MModels Projects\Workspace
 * 放在主目录的好处是重装应用不丢工作区；代价是卸载残留。
 * 路径要跟应用约定一致，否则用户在两个版本间切换会看到两套目录。
 *
 * 例外：应用约定开了 E2E 开关（`MATHMODEL_E2E=1`）时改落 userData。
 * 这个分支必须保留 —— 自动化测试正是靠它把工作区关进沙箱，
 * 否则每跑一次测试就往用户主目录里写一遍。
 */
function defaultWorkspaceBase(): string {
  if (process.env.MATHMODEL_E2E === '1') {
    return join(app.getPath('userData'), 'projects');
  }
  return join(homedir(), 'MModels Projects');
}

interface MetaRow {
  value: string;
}

function readMeta(key: string): string | null {
  const row = getDb().prepare<[string], MetaRow>('SELECT value FROM app_meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function writeMeta(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

/**
 * 播种默认项目，返回默认项目 id。
 *
 * 三个分支与应用约定一一对应：
 *   1. 已有 meta        → 直接认 meta 里的 id（顺带校验该行还在，被删掉就返回 null）
 *   2. 有项目但无 meta  → 老库升级场景，只补写 meta 且 `defaultProjectId: null`，
 *                        **不擅自新建项目**（用户已经有自己的项目了）
 *   3. 两样都没有       → 全新安装：建 `Workspace` 项目 + 写 meta
 *
 * 这个函数**不抛异常**：调用方是启动流程，播种失败不该让应用起不来。
 */
export function bootstrapDefaultProject(baseDir = defaultWorkspaceBase()): string | null {
  defaultProjectId = resolveDefaultProject(baseDir);
  return defaultProjectId;
}

function resolveDefaultProject(baseDir: string): string | null {
  const existing = readMeta(BOOTSTRAP_KEY);
  if (existing !== null) {
    try {
      const parsed = JSON.parse(existing) as { defaultProjectId?: string | null };
      const id = parsed.defaultProjectId ?? null;
      if (!id) return null;
      const row = getDb().prepare<[string], { id: string }>('SELECT id FROM projects WHERE id = ?').get(id);
      return row ? row.id : null;
    } catch {
      // meta 坏了（比如手改过）—— 当没有处理，走下面的分支自愈
    }
  }

  const anyProject = getDb().prepare<[], { id: string }>('SELECT id FROM projects LIMIT 1').get();
  if (anyProject) {
    writeMeta(BOOTSTRAP_KEY, JSON.stringify({ version: 1, defaultProjectId: null }));
    return null;
  }

  /**
   * ⚠️ 默认项目名必须是 `Workspace`（界面检查取证：首屏 hero 显示「在 Workspace 中建模」、
   *    项目 chip 显示「Workspace」、侧栏项目行也是「Workspace」）。
   *    之前用了 `MModels Workspace`，导致这三处文案与应用约定不一致。
   *    目录名保留 `MModels Workspace`（只在 tooltip / 文件面板路径里出现，属品牌差异）。
   */
  const root = join(baseDir, 'MModels Workspace');
  try {
    mkdirSync(root, { recursive: true });
  } catch (err) {
    console.error('[projects] 无法创建默认项目目录：', err);
    return null;
  }

  const now = Date.now();
  const id = randomUUID();
  try {
    getDb().transaction(() => {
      getDb()
        .prepare(
          'INSERT INTO projects (id, name, root, created_at, updated_at, last_opened_at) VALUES (?,?,?,?,?,?)',
        )
        .run(id, 'Workspace', root, now, now, now);
      writeMeta(BOOTSTRAP_KEY, JSON.stringify({ version: 1, defaultProjectId: id }));
    })();
  } catch (err) {
    console.error('[projects] 初始化默认项目失败：', err);
    return null;
  }
  console.log('[projects] 已创建默认项目：', root);
  return id;
}

export function registerProjectHandlers(ctx: IpcContext): void {
  ipcMain.handle(
    IPC.PROJECT_LIST,
    safeWrap(() => listProjects(), '读取项目列表'),
  );

  ipcMain.handle(
    IPC.PROJECT_CREATE,
    safeWrap(async (_e, name: string) => {
      const win = ctx.getMainWindow();
      const result = await dialog.showOpenDialog(win ?? undefined!, {
        title: '选择或新建项目目录',
        defaultPath: (() => { const id = getSettings().recentProjectId; const p = id ? getProject(id) : null; return p ? dirname(p.root) : defaultWorkspaceBase(); })(),
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: '使用此目录',
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const selected = resolve(result.filePaths[0]);
      const overlap = listProjects().find(p => projectPathRelation(p.root, selected) === 'inside' || projectPathRelation(selected, p.root) === 'inside');
      if (!findProjectByRoot(selected) && overlap) {
        await dialog.showMessageBox(win ?? undefined!, { type: 'info', title: '请选择独立的项目目录',
          message: `这个位置与“${overlap.name}”有包含关系。`, detail: '每个项目应使用平级、互不包含的文件夹。请返回上一级，新建或选择另一个文件夹；现有文件不会移动。', buttons: ['知道了'] });
        return null;
      }
      const meta = createProject(name, result.filePaths[0]);
      updateSettings({ recentProjectId: meta.id });
      return meta;
    }, '创建项目'),
  );

  ipcMain.handle(
    IPC.PROJECT_OPEN,
    safeWrap((_e, id: string) => {
      const meta = getProject(id);
      if (!meta) throw new Error('项目不存在');
      if (!existsSync(meta.root)) {
        // 目录被删了 —— 这个项目已经不可用，直接清掉，避免用户反复点到
        getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
        throw new Error(`项目目录已不存在：${meta.root}`);
      }
      touchProject(id);
      updateSettings({ recentProjectId: id });
      return getProject(id);
    }, '打开项目'),
  );

  ipcMain.handle(
    IPC.PROJECT_REMOVE,
    safeWrap((_e, id: string, deleteFiles: boolean) => {
      const meta = getProject(id);
      if (!meta) throw new Error('项目不存在');
      // ⚠️ 只删数据库记录，**不删用户文件**，除非显式要求
      // 先删项目级比赛配置，再删数据库记录；否则 workspace(id) 无法解析项目根目录。
      removeCompetitionProject(id, meta.root);
      getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
      if (deleteFiles) {
        // 二次确认：这个操作不可逆
        try {
          // 两个目录名都清：`.mathmodel` 是 canonical（与应用约定一致），
          // `.mmodels` 是早期版本的遗留名（只读兼容，不会自动消失）
          rmSync(join(meta.root, '.mathmodel'), { recursive: true, force: true });
          rmSync(join(meta.root, '.mmodels'), { recursive: true, force: true });
        } catch {
          /* 元数据删不掉就算了，不动用户的成果文件 */
        }
      }
      if (getSettings().recentProjectId === id) {
        updateSettings({ recentProjectId: null });
      }
      return listProjects();
    }, '移除项目'),
  );

  ipcMain.handle(
    IPC.PROJECT_RENAME,
    safeWrap((_e, id: string, name: string) => {
      const meta = getProject(id);
      if (!meta) throw new Error('项目不存在');
      const next = name.trim();
      if (!next) throw new Error('项目名不能为空');
      /**
       * ⚠️ 只改显示名，**不重命名磁盘目录**。
       * 应用约定同样把「项目名」与「目录名」分开（默认项目名 `Workspace`，
       * 目录却是 `MModels Workspace`）——改个名字不该动用户的文件路径，
       * 否则最近打开记录、协作房间、agent 的上下文缓存全部要跟着搬。
       */
      getDb()
        .prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
        .run(next, Date.now(), id);
      return getProject(id);
    }, '重命名项目'),
  );

  ipcMain.handle(
    IPC.PROJECT_CURRENT,
    safeWrap(() => {
      const id = getSettings().recentProjectId;
      return id ? getProject(id) : null;
    }, '读取当前项目'),
  );

  ipcMain.handle(
    IPC.PROJECT_DEFAULT_ID,
    safeWrap(() => defaultProjectId, '读取默认项目 id'),
  );
}
