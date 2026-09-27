/**
 * 本地 HTTP 服务的业务路由。
 *
 * ⚠️ 这是本地服务层最有参考价值的设计：
 *   核心 API 走 HTTP 而不是全塞 IPC。好处在 server/index.ts 里说过了，
 *   这里补充一条最重要的：**agent 自己也能调这些 API**。
 *   比如 agent 需要查「我这个项目里有哪些文件」时，直接 curl 本地服务即可，
 *   不必让 SDK 反向调用 Electron IPC（那是不可能的）。
 *
 * 鉴权由 server/index.ts 的中间件统一处理，这里只管业务。
 */
import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { ContentBlock } from '@shared/types';
import { IPC } from '@shared/types';
import { listSkills } from '../skills';
import { listProviders, getSettings } from '../store/config';
import { getDb } from '../db';
import { bridgeRegistry } from '../agent/bridge-registry';
import { buildExportPayload, blocksToContent, planImport, sessionImportSchema } from './export';
import { getSession, getMessages, sessionRegistry } from '../ipc/session';
import { restoreVersion } from '../git';
import {
  checkRevertRequest,
  executeFork,
  revertToMessage,
  type ForkMessageRow,
  type ForkPorts,
  type OpsMessage,
} from './message-ops';

/**
 * 导入的会话挂到哪个项目。
 *
 * ⚠️ 这是**必须偏离应用约定**的一处：应用约定导入时写死 `projectId: null`（），
 *    而当前实现的 `sessions.project_id` 是 `TEXT NOT NULL REFERENCES projects(id)`
 *    —— 直接采用会直接违反约束。用户导入后就应该在**眼前的项目**里看到它，所以：
 *
 *   1. 当前打开的项目（`settings.recentProjectId`）
 *   2. 否则：`app_meta['project-bootstrap:v1']` 里记的默认项目
 *   3. 否则：最近打开过的项目（老库升级场景 meta 里是 null，但用户有项目）
 *   4. 都没有 → 返回 null，路由给 `no_project`
 *
 * 第 3 条不是拍脑袋加的：`bootstrapDefaultProject` 的"老库升级"分支**故意**把
 * `defaultProjectId` 写成 null（不擅自新建项目），只靠 1、2 两步的话，
 * 这批用户会**完全无法导入**。
 */
function resolveImportProjectId(): string | null {
  const exists = getDb().prepare<[string], { id: string }>('SELECT id FROM projects WHERE id = ?');

  const recent = getSettings().recentProjectId;
  if (recent && exists.get(recent)) return recent;

  const meta = getDb()
    .prepare<[string], { value: string }>('SELECT value FROM app_meta WHERE key = ?')
    .get('project-bootstrap:v1');
  if (meta) {
    try {
      const id = (JSON.parse(meta.value) as { defaultProjectId?: string | null }).defaultProjectId;
      if (id && exists.get(id)) return id;
    } catch {
      /* meta 坏了就往下走，不因为一段脏 JSON 让导入失败 */
    }
  }

  const first = getDb()
    .prepare<[], { id: string }>('SELECT id FROM projects ORDER BY last_opened_at DESC LIMIT 1')
    .get();
  return first ? first.id : null;
}

/** 会话所属项目的工作区根目录。项目行不存在时返回 null（不让它变成 500）。 */
function sessionCwd(projectId: string): string | null {
  const row = getDb()
    .prepare<[string], { root: string }>('SELECT root FROM projects WHERE id = ?')
    .get(projectId);
  return row ? row.root : null;
}

interface OpsMessageRow {
  id: string;
  role: string;
  blocks: string;
  model: string | null;
  created_at: number;
  input_tokens: number;
  output_tokens: number;
  checkpoint_ref: string | null;
  agent_msg_uuid: string | null;
}

/**
 * 读出一条会话的全部消息，**带上回退/分叉要用的两列**。
 *
 * ⚠️ 不复用 `ipc/session.ts` 的 `getMessages()`：那个函数映射出来的 `ChatMessage`
 *    里**没有** `checkpointRef` / `agentMsgUuid`（渲染层不需要它们，见 P0 的说明）。
 *    排序与 `getMessages` 字段一致（`ORDER BY created_at`）—— 顺序必须一样，
 *    否则"这条之后的消息"这个切片会与渲染层看到的顺序不一致。
 */
function loadOpsMessages(sessionId: string): OpsMessage[] {
  const rows = getDb()
    .prepare<[string], OpsMessageRow>(
      `SELECT id, role, blocks, model, created_at, input_tokens, output_tokens,
              checkpoint_ref, agent_msg_uuid
       FROM messages WHERE session_id = ? ORDER BY created_at`,
    )
    .all(sessionId);

  return rows.map((r) => {
    let blocks: ContentBlock[] = [];
    try {
      blocks = JSON.parse(r.blocks) as ContentBlock[];
    } catch {
      blocks = [];
    }
    return {
      id: r.id,
      role: r.role === 'assistant' ? 'assistant' : 'user',
      content: blocksToContent(blocks),
      blocks,
      createdAt: r.created_at,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      checkpointRef: r.checkpoint_ref,
      agentMsgUuid: r.agent_msg_uuid,
    };
  });
}

export function mountRoutes(app: Hono): void {
  // ── 元信息 ────────────────────────────────────────────────
  app.get('/api/meta', (c) =>
    c.json({
      name: 'mmodels-desktop',
      version: '0.1.0',
      ipc: IPC,
      bridgeBaseUrl: bridgeRegistry.getBaseUrl(),
    }),
  );

  // ── 技能 ──────────────────────────────────────────────────
  app.get('/api/skills', (c) => c.json(listSkills()));

  // ── 供应商（密钥只给是否已配置，不回传明文）──────────────
  app.get('/api/providers', (c) =>
    c.json(
      listProviders().map((p) => ({
        id: p.id,
        name: p.name,
        apiFormat: p.apiFormat,
        baseUrl: p.baseUrl,
        models: p.models ?? [],
        enabled: p.enabled,
        builtin: p.builtin ?? false,
        hasKey: Boolean(p.apiKey),
      })),
    ),
  );

  // ── 设置 ──────────────────────────────────────────────────
  app.get('/api/settings', (c) => c.json(getSettings()));

  // ── 项目 / 会话（只读视图，供 agent 自查）───────────────
  app.get('/api/projects', (c) => {
    const rows = getDb().prepare('SELECT * FROM projects ORDER BY last_opened_at DESC').all();
    return c.json(rows);
  });

  app.get('/api/sessions', (c) => {
    const projectId = c.req.query('projectId');
    const rows = projectId
      ? getDb()
          .prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC')
          .all(projectId)
      : getDb().prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 100').all();
    return c.json(rows);
  });

  app.get('/api/sessions/:id/messages', (c) => {
    const id = c.req.param('id');
    const rows = getDb()
      .prepare('SELECT id, role, blocks, model, created_at FROM messages WHERE session_id = ? ORDER BY created_at')
      .all(id);
    return c.json(rows);
  });

  /**
   * 导出会话 JSON —— 对应应用约定 `GET /api/sessions/:id/export`（协议实现）。
   *
   * ⚠️ 这里**只产出 JSON，不弹保存框**。应用约定也是这么分的两截：
   *    渲染层先 HTTP 拿到 JSON，再用 IPC `file:saveText` 落盘。
   *    这样"用户点了取消"这个结果能回到渲染层去决定提示什么 ——
   *    如果在主进程弹框，取消与失败就分不开了。
   *
   * 404 的形状直接采用应用约定：`{error:'not_found'}`（下划线命名，不是驼峰）。
   */
  app.get('/api/sessions/:id/export', (c) => {
    const id = c.req.param('id');
    const meta = getSession(id);
    if (!meta) return c.json({ error: 'not_found' }, 404);
    // 复用 ipc/session 里那份**唯一的**行映射（getSession/getMessages），
    // 不在这里另写一套 SELECT —— 两套映射迟早会漂移，导出就会悄悄缺字段。
    return c.json(buildExportPayload(meta, getMessages(id), Date.now()));
  });

  /**
   * 导入会话 —— 对应应用约定 `POST /api/sessions/import`（协议实现）。
   *
   * ── 冲突处理：**永不冲突，永远 201**（直接采用应用约定，已机器确证） ──
   *   ① `cs` schema 里**根本没有 `session.id`**（只有 title/providerId/model/createdAt/updatedAt），
   *      导入端一律 `uuid()` 新生成 ⇒ **不可能覆盖任何已有会话**，也没有 409/覆盖分支。
   *   ② `title` 不做去重 —— 同一个文件导两次就是两条同名会话。这是应用约定行为，不是 bug。
   *
   * ── 有意比应用约定**更安全**的两处 ──
   *   ① 应用约定是"先 insert session、再循环 insert messages"，**没有包事务**，
   *      中途失败会留下半条会话（有会话、没消息）。这里包 `db.transaction`。
   *   ② 应用约定是 `z.array(Zn)`，任何一段 part 不认识就**整个文件 400**。
   *      这里信封严格、parts 逐段宽松，坏的那段降级成文本并计入 `degradedParts`。
   *
   * ── 偏离应用约定的地方（见 resolveImportProjectId 的注释） ──
   *   `projectId` 必须挂到一个真实项目；应用约定写死 `null`，当前实现的列是 NOT NULL。
   */
  app.post('/api/sessions/import', async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = sessionImportSchema.safeParse(raw);
    // ⚠️ 校验失败必须在**动数据库之前**返回 —— 这是"导入坏文件不能毁库"的落点
    if (!parsed.success) return c.json({ error: 'invalid_import_file' }, 400);

    const projectId = resolveImportProjectId();
    if (!projectId) return c.json({ error: 'no_project' }, 400);

    const sessionId = randomUUID();
    const plan = planImport(parsed.data, sessionId, () => randomUUID(), Date.now());

    const db = getDb();
    const insertSession = db.prepare(
      `INSERT INTO sessions (id, project_id, title, provider_id, model, status, created_at, updated_at, message_count)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    const insertMessage = db.prepare(
      `INSERT INTO messages (id, session_id, role, blocks, model, created_at, input_tokens, output_tokens,
                             checkpoint_ref, agent_msg_uuid)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );

    // better-sqlite3 的 transaction 是**同步**的；这里所有语句都是同步的，够用。
    // 一条失败就整批回滚 —— 用户要么拿到完整会话，要么什么都没发生。
    db.transaction(() => {
      insertSession.run(
        plan.session.id,
        projectId,
        plan.session.title,
        plan.session.providerId,
        plan.session.model,
        'idle',
        plan.session.createdAt,
        plan.session.updatedAt,
        plan.messages.length,
      );
      for (const m of plan.messages) {
        insertMessage.run(
          m.id,
          plan.session.id,
          m.role,
          JSON.stringify(m.blocks),
          m.model,
          m.createdAt,
          m.inputTokens,
          m.outputTokens,
          // 导入的消息没有工作区快照可指（快照属于原机器的磁盘状态），
          // 也不能假装有 agent 侧 uuid（那会让分叉走"续传"去到不存在的上下文）
          null,
          null,
        );
      }
    })();

    return c.json(
      {
        // ⚠️ 与应用约定的返回体不同：应用约定直接回 session DTO。这里包一层是为了带上
        //    `degradedParts` —— 用户需要知道"这次导入有几段被降级了"。
        session: getSession(plan.session.id),
        importedMessages: plan.messages.length,
        degradedParts: plan.degradedParts,
      },
      201,
    );
  });

  /**
   * 「回到此消息之前」—— 对应应用约定 `POST /api/checkpoint/revert`（协议实现）。
   *
   * ⚠️ 三个必须说清楚的点：
   *
   *  1. **这是本文件里唯一会改用户文件的路由。** 恢复走 `git/restoreVersion()`：
   *     先写 `restore-backup` 备份 → 再 checkout 目标版本 → 再删「当时被跟踪、
   *     但目标版本里没有」的文件。应用约定的 checkpoint 在它自己的 `project_versions`
   *     表里、不碰项目目录；当前实现复用 git（副作用已在 P0-5 报备）。
   *
   *  2. **确认门槛（`confirm: true`）是当前实现的加固**，应用约定没有这个字段。
   *     `revertToMessage()` 把它排在**第一位**：没确认的请求连一次数据库读都不做。
   *
   *  3. **顺序不能反**：先恢复文件，成功了才删消息。反过来的话恢复失败会留下
   *     "文件没回来、对话却没了"的半改状态。
   *
   * 错误码按字段对齐应用约定（渲染层按这些字符串查 `chat.useChat.revert*` 的 i18n）。
   */
  app.post('/api/checkpoint/revert', async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;

    // ⚠️ 先用一个**只做校验**的探测拿到 sessionId（不带确认位的请求会在这里被挡住，
    //    此时还没有做任何数据库读）。真正的门槛判定在 revertToMessage 里做第二次，
    //    两次用的是同一个纯函数 —— 不重复实现，也就不会漂。
    const probe = checkRevertRequest(raw);
    if (!probe.ok) return c.json({ error: probe.error }, probe.status);

    const meta = getSession(probe.value.sessionId);
    const cwd = meta ? sessionCwd(meta.projectId) : null;
    const messages = meta ? loadOpsMessages(meta.id) : [];

    const outcome = await revertToMessage(
      raw,
      {
        session: meta && cwd ? { cwd } : null,
        running: sessionRegistry.listRunning().includes(probe.value.sessionId),
        messages,
      },
      restoreVersion,
    );
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);

    // ── 文件已经回滚成功，下面是数据库侧的收尾 ──
    const db = getDb();
    db.transaction(() => {
      const del = db.prepare('DELETE FROM messages WHERE id = ?');
      for (const m of outcome.removed) del.run(m.id);

      /**
       * 删完之后**重数**消息条数，而不是 `message_count - n`。
       * 差值法在"库里本来就有一条计数漂了"的场景会把错误原样带下去；
       * 重数永远与 messages 表一致。
       */
      db.prepare(
        'UPDATE sessions SET message_count = (SELECT COUNT(*) FROM messages WHERE session_id = ?) WHERE id = ?',
      ).run(probe.value.sessionId, probe.value.sessionId);

      /**
       * 用量口径归零 —— 当前渲染层在回退成功后就是这么做的（`setTokenUsage(sid, undefined)`）。
       * 不回填"剩余消息的 token 之和"：当前实现 assistant 行的 input/output_tokens 存的是
       * 那一轮的**累计**值，相加会把同一份输入数两遍。
       */
      db.prepare(
        'UPDATE sessions SET input_tokens = 0, output_tokens = 0, reasoning_tokens = 0 WHERE id = ?',
      ).run(probe.value.sessionId);

      /**
       * agent 会话 id：保留剩下的对话里还有 assistant 消息时才留着 —— 应用约定的写法是
       * `hasAssistantBefore ? {} : {agentSessionId: null}`（协议实现）。
       * 直接采用，不自己发明规则。
       */
      const keepAgent = outcome.kept.some((m) => m.role === 'assistant');
      if (!keepAgent) {
        db.prepare('UPDATE sessions SET sdk_session_id = NULL WHERE id = ?').run(
          probe.value.sessionId,
        );
      }

      /**
       * 进行中回合的快照也要清 —— 它指的 message_id 可能刚被删掉。
       * 回退本来就被 `turn_running` 挡在回合之外，所以这里留下的只会是一条陈旧快照。
       * 不留：留着会让"切回来"的画面里凭空多出一轮没跑完的过程。
       */
      db.prepare('DELETE FROM turn_spills WHERE session_id = ?').run(probe.value.sessionId);

      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
        Date.now(),
        probe.value.sessionId,
      );
    })();

    return c.json({ ok: true, removedMessages: outcome.removed.length });
  });

  /**
   * 「从此分叉」—— 对应应用约定 `POST /api/sessions/:id/fork`（协议实现）。
   *
   * 响应体 `{session, copiedMessages, draft}` 的字段名按字段对齐应用约定
   * （当前实现多加一个 `resumable`，见 message-ops.ts 的说明）。
   *
   * ⚠️ **原会话必须一个字节都不变**：这里只做 INSERT，一条 UPDATE/DELETE 都没有。
   *    消息是**新 id 的新行**，`created_at` 沿用原值（新会话里对话的时间线要跟原来一样）。
   *    新会话的 `sdk_session_id` 显式置 NULL —— 理由见 message-ops.ts 文件头 ③。
   */
  app.post('/api/sessions/:id/fork', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => null)) as unknown;

    const meta = getSession(id);
    if (!meta) return c.json({ error: 'session_not_found' }, 404);

    const db = getDb();
    const insertSession = db.prepare(
      `INSERT INTO sessions (id, project_id, title, provider_id, model, status, sdk_session_id,
                             created_at, updated_at, message_count)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );
    const insertMessage = db.prepare(
      `INSERT INTO messages (id, session_id, role, blocks, model, created_at,
                             input_tokens, output_tokens, checkpoint_ref, agent_msg_uuid)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );

    const ports: ForkPorts = {
      createSession(row) {
        insertSession.run(
          row.id,
          row.projectId,
          row.title,
          row.providerId,
          row.model,
          'idle',
          // 不继承父会话的 SDK 会话 id（见 message-ops.ts 文件头 ③）
          null,
          row.createdAt,
          row.updatedAt,
          row.messageCount,
        );
      },
      insertMessages(rows: ForkMessageRow[]) {
        for (const m of rows) {
          insertMessage.run(
            m.id,
            m.sessionId,
            m.role,
            JSON.stringify(m.blocks),
            m.model,
            m.createdAt,
            m.inputTokens,
            m.outputTokens,
            m.checkpointRef,
            m.agentMsgUuid,
          );
        }
      },
    };

    const outcome = executeFork(
      {
        session: {
          id: meta.id,
          title: meta.title,
          projectId: meta.projectId,
          providerId: meta.providerId,
          model: meta.model,
        },
        messages: loadOpsMessages(meta.id),
        body,
      },
      ports,
      () => randomUUID(),
      Date.now(),
    );
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);
    return c.json(outcome.result, outcome.status);
  });
}
