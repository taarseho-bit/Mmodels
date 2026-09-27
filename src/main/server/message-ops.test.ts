/**
 * 消息级操作（回滚 / 分叉 / 编辑重发）的判据。
 *
 * ── 这一份测试**真的跑 git、真的读文件**（不是模拟） ────────────
 * 回滚是本仓唯一会覆盖用户文件的功能，所以它的判据不能用假宿主糊过去。
 * `better-sqlite3` 在纯 node 下加载不了（ABI 是 Electron 的），但 `git` 与 `fs`
 * 都是现成的：所以这一份用**真实临时 git 仓库**跑 `restoreVersion()`，
 * 断言的是**磁盘上文件的实际字节**，不是"函数返回了错误"。
 *
 * ── 如实写明**未被覆盖**的部分（证伪边界） ─────────────────────
 *   · **Hono 的 HTTP 传输层**（`app.post(...)` 的注册、Bearer token 鉴权、
 *     状态码怎么落到响应上）没有被执行 —— 需要 `getDb()`。这里覆盖的是
 *     **路由处理函数体内调用的那几个函数**（`checkRevertRequest` / `revertToMessage` /
 *     `executeFork`），它们持有全部决策逻辑与全部副作用。
 *     反过来说：如果有人把路由注册写错路径、或漏了 `return c.json`，
 *     **本文件的用例不会变红**。
 *   · **渲染层的交互**（点按钮 → 弹确认 → 调接口）只做结构断言，见 §6。
 *   · 应用约定 `restoreCheckpoint` 的"checkpoint 服务"在当前实现里由 `git/restoreVersion` 承担，
 *     `git/index.ts` 自身的正确性（trackedBefore 的取法、备份时机）由应用约定负责，
 *     本文件只在**行为层**断言"改过的文件回得去、备份真的写了"。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listVersions, restoreVersion, saveVersion } from '../git';
import {
  checkForkRequest,
  checkRevertRequest,
  editableUserMessageId,
  executeFork,
  forkTitle,
  planFork,
  planRevert,
  revertToMessage,
  FORK_TITLE_SUFFIX,
  type ForkMessageRow,
  type ForkSessionRow,
  type OpsMessage,
} from './message-ops';

// ─────────────────────────────────────────────────────────────
// 脚手架
// ─────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

/**
 * 真跑 git 的用例（§3 / §4）每条要 spawn 十几次 `git`。vitest 默认 5s 在
 * **全量并发**（39 个文件抢 CPU）下不够：实测全量跑时 §3 会偶发
 * `Test timed out in 5000ms`，而单独跑本文件一定绿 —— 这是负载型 flake，
 * 不是判据本身有问题。所以这两段显式放宽（放宽的是"机器有多忙"，
 * 断言仍然比磁盘字节，没有被调松）。
 */
const GIT_TEST_TIMEOUT = 30_000;

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'msgops-'));
  tmpDirs.push(dir);
  return dir;
}

function cleanupTmpDirs(): void {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (!d) continue;
    try {
      // maxRetries 只在 recursive 下生效：Windows 上刚跑完 git 的目录会被
      // 杀软 / 文件索引短暂占住（EBUSY），交给 Node 自己退避重试。
      rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // 还是删不掉就放过：这是 os.tmpdir() 下的丢弃目录，与任何断言无关，
      // 为它把整份判据判红只是噪声。
    }
  }
}

afterEach(cleanupTmpDirs);

let idSeq = 0;
const nextId = (): string => `id-${(idSeq += 1)}`;

function msg(partial: Partial<OpsMessage> & { id: string; role: 'user' | 'assistant' }): OpsMessage {
  const fallback = `正文 ${partial.id}`;
  const out: OpsMessage = {
    id: partial.id,
    role: partial.role,
    content: fallback,
    blocks: [{ kind: 'text', text: fallback }],
    createdAt: 1000,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    checkpointRef: null,
    agentMsgUuid: null,
  };
  // 逐项覆盖（不用对象展开：`Partial<T>` 展开出来的属性类型是 `T | undefined`，
  // 赋值给必填字段要靠断言，反而更脆）
  if (partial.content !== undefined) out.content = partial.content;
  if (partial.blocks !== undefined) out.blocks = partial.blocks;
  if (partial.createdAt !== undefined) out.createdAt = partial.createdAt;
  if (partial.model !== undefined) out.model = partial.model;
  if (partial.inputTokens !== undefined) out.inputTokens = partial.inputTokens;
  if (partial.outputTokens !== undefined) out.outputTokens = partial.outputTokens;
  if (partial.checkpointRef !== undefined) out.checkpointRef = partial.checkpointRef;
  if (partial.agentMsgUuid !== undefined) out.agentMsgUuid = partial.agentMsgUuid;
  return out;
}

/** 内存落库实现 —— 存**引用**（不是深拷贝）：谁原地改了源对象，断言就会抓到 */
function memoryStore(): {
  ports: { createSession: (r: ForkSessionRow) => void; insertMessages: (r: ForkMessageRow[]) => void };
  sessions: ForkSessionRow[];
  messages: ForkMessageRow[];
} {
  const sessions: ForkSessionRow[] = [];
  const messages: ForkMessageRow[] = [];
  return {
    sessions,
    messages,
    ports: {
      createSession: (r) => sessions.push(r),
      insertMessages: (rows) => messages.push(...rows),
    },
  };
}

// ─────────────────────────────────────────────────────────────
// ① 确认门槛（纯函数）
// ─────────────────────────────────────────────────────────────

describe('§1 确认门槛：revert 必须显式带 confirm', () => {
  const base = { sessionId: 's1', messageId: 'm1' };

  it('confirm: true 才通过，且只吐出两个 id（confirm 不进业务层）', () => {
    const r = checkRevertRequest({ ...base, confirm: true });
    expect(r).toEqual({ ok: true, value: { sessionId: 's1', messageId: 'm1' } });
  });

  it('★ 缺 confirm → confirm_required（不是"参数不合法"这种含糊码）', () => {
    expect(checkRevertRequest(base)).toEqual({
      ok: false,
      status: 400,
      error: 'confirm_required',
    });
  });

  it('★ 假值与近似值一律拒绝：false / 0 / 1 / "true" / null', () => {
    for (const v of [false, 0, 1, 'true', null, undefined]) {
      expect(checkRevertRequest({ ...base, confirm: v })).toEqual({
        ok: false,
        status: 400,
        error: 'confirm_required',
      });
    }
  });

  it('confirm 过了但形状不对 → bad_request（与 confirm_required 分开）', () => {
    for (const bad of [
      { confirm: true },
      { messageId: 'm1', confirm: true },
      { sessionId: '', messageId: 'm1', confirm: true },
      { sessionId: 's1', messageId: '', confirm: true },
    ]) {
      expect(checkRevertRequest(bad)).toEqual({ ok: false, status: 400, error: 'bad_request' });
    }
  });

  it('不是对象（null / 数组 / 字符串 / 数字）→ bad_request，不抛', () => {
    for (const bad of [null, undefined, [], 'x', 7, true]) {
      expect(checkRevertRequest(bad).ok).toBe(false);
    }
  });

  it('fork 只要 messageId，**不需要** confirm（它不改文件）', () => {
    expect(checkForkRequest({ messageId: 'm1' })).toEqual({ ok: true, value: { messageId: 'm1' } });
    expect(checkForkRequest({})).toEqual({ ok: false, status: 400, error: 'bad_request' });
    expect(checkForkRequest({ messageId: '' })).toEqual({
      ok: false,
      status: 400,
      error: 'bad_request',
    });
  });
});

// ─────────────────────────────────────────────────────────────
// ② 回滚目标 / 分叉计划的纯判定
// ─────────────────────────────────────────────────────────────

describe('§2 planRevert / planFork / forkTitle / editableUserMessageId', () => {
  const convo: OpsMessage[] = [
    msg({ id: 'u1', role: 'user', checkpointRef: 'sha-1' }),
    msg({ id: 'a1', role: 'assistant', agentMsgUuid: 'uuid-1' }),
    msg({ id: 'u2', role: 'user', checkpointRef: 'sha-2' }),
    msg({ id: 'a2', role: 'assistant' }),
  ];

  it('回滚目标是 user 行时：本条连同之后的一起删，之前的一份不动', () => {
    const p = planRevert(convo, 'u2');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.checkpointRef).toBe('sha-2');
    expect(p.removed.map((m) => m.id)).toEqual(['u2', 'a2']);
    expect(p.kept.map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('★ 消息不存在 → 404 message_not_found（不是静默成功）', () => {
    expect(planRevert(convo, 'nope')).toEqual({
      ok: false,
      status: 404,
      error: 'message_not_found',
    });
  });

  it('★ 非 user 行 → 404 message_not_found（与应用约定同一错误码）', () => {
    expect(planRevert(convo, 'a1')).toEqual({
      ok: false,
      status: 404,
      error: 'message_not_found',
    });
  });

  it('★ checkpointRef 为空 → 400 no_checkpoint，且**不许**退用更早的快照', () => {
    const noRef: OpsMessage[] = [
      msg({ id: 'u1', role: 'user', checkpointRef: 'sha-1' }),
      msg({ id: 'u2', role: 'user', checkpointRef: null }), // 工作区当时是干净的
    ];
    const p = planRevert(noRef, 'u2');
    expect(p).toEqual({ ok: false, status: 400, error: 'no_checkpoint' });
    // 反向：绝不能把 sha-1 当成 u2 的目标（那会恢复得比用户要求的还早一步）
    expect(JSON.stringify(p)).not.toContain('sha-1');
  });

  it('从**用户**消息分叉：本条不含，原文进 draft', () => {
    const p = planFork(convo, 'u2');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.kept.map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(p.draft).toBe('正文 u2');
    expect(p.resumable).toBe(true); // kept 里有带 uuid 的 assistant 行
  });

  it('从**助手**回复分叉：本条含，draft 为 null（方向刻意不对称）', () => {
    const p = planFork(convo, 'a1');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.kept.map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(p.draft).toBeNull();
    expect(p.resumable).toBe(true);
  });

  it('resumable 只看 kept：分叉点之后那条带 uuid 的 assistant 不算数', () => {
    const p = planFork(convo, 'u1');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.kept).toEqual([]);
    expect(p.resumable).toBe(false);
  });

  it('分叉消息不存在 → 404，且没有"半个计划"', () => {
    expect(planFork(convo, 'nope')).toEqual({ ok: false, status: 404, error: 'message_not_found' });
  });

  it('分叉标题：追加后缀；已带后缀的不叠加', () => {
    expect(forkTitle('2024 国赛 A 题')).toBe(`2024 国赛 A 题${FORK_TITLE_SUFFIX}`);
    expect(forkTitle(`2024 国赛 A 题${FORK_TITLE_SUFFIX}`)).toBe(`2024 国赛 A 题${FORK_TITLE_SUFFIX}`);
    // 连分叉两次也不该出现 `· fork · fork`
    const once = forkTitle('T');
    expect(forkTitle(once)).toBe(once);
    expect(forkTitle('   ')).toBe(`新会话${FORK_TITLE_SUFFIX}`);
    // 后缀长度就是应用约定硬编码的那个 7
    expect(FORK_TITLE_SUFFIX.length).toBe(7);
  });

  it('编辑重发只对**最后一条用户消息**开放', () => {
    expect(editableUserMessageId(convo)).toBe('u2');
    expect(editableUserMessageId([msg({ id: 'a1', role: 'assistant' })])).toBeNull();
    expect(editableUserMessageId([])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// ③ 回滚：真 git、真文件
// ─────────────────────────────────────────────────────────────

describe('§3 回滚真的改文件 —— 正向', { timeout: GIT_TEST_TIMEOUT }, () => {
  it('回到快照时的字节，并写下 restore-backup 备份', async () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, 'main.tex'), 'v1\n', 'utf8');

    // 这条就是「这条 user 消息发出**之前**的工作区快照」
    const ck = await saveVersion(cwd, '发消息前自动快照', 'auto');
    expect(ck.committed).toBe(true);
    const sha = ck.sha as string;

    // 之后 agent 改了文件、还新建了一个
    writeFileSync(join(cwd, 'main.tex'), 'v2-被-agent改过\n', 'utf8');
    writeFileSync(join(cwd, 'figure.py'), '# 新建的\n', 'utf8');

    const messages: OpsMessage[] = [
      msg({ id: 'u1', role: 'user', checkpointRef: sha }),
      msg({ id: 'a1', role: 'assistant' }),
    ];

    const out = await revertToMessage(
      { sessionId: 's1', messageId: 'u1', confirm: true },
      { session: { cwd }, running: false, messages },
      restoreVersion,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.status).toBe(200);
    expect(readFileSync(join(cwd, 'main.tex'), 'utf8')).toBe('v1\n');
    // 恢复前的那一版被备份下来了 —— 用户还能从版本历史里找回来
    expect(out.backupSha).toBeTruthy();
    const versions = await listVersions(cwd);
    expect(versions.some((v) => v.kind === 'restore-backup')).toBe(true);
    expect(out.removed.map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('快照里被删掉的文件会被找回来', async () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, 'main.tex'), 'v1\n', 'utf8');
    writeFileSync(join(cwd, 'data.csv'), 'a,b\n', 'utf8');
    const sha = (await saveVersion(cwd, '快照', 'auto')).sha as string;

    rmSync(join(cwd, 'data.csv'));
    writeFileSync(join(cwd, 'main.tex'), 'v2\n', 'utf8');

    const out = await revertToMessage(
      { sessionId: 's1', messageId: 'u1', confirm: true },
      {
        session: { cwd },
        running: false,
        messages: [msg({ id: 'u1', role: 'user', checkpointRef: sha })],
      },
      restoreVersion,
    );
    expect(out.ok).toBe(true);
    expect(existsSync(join(cwd, 'data.csv'))).toBe(true);
    expect(readFileSync(join(cwd, 'data.csv'), 'utf8')).toBe('a,b\n');
  });
});

// ─────────────────────────────────────────────────────────────
// ④ ★ 反例：没确认 / 参数不对 / 回合在跑 / 没有 checkpoint → 零文件改动
// ─────────────────────────────────────────────────────────────

describe('§4 ★ 反例：不满足门槛时一个文件都不许动', { timeout: GIT_TEST_TIMEOUT }, () => {
  /** 造一个"改过、有快照"的仓库，返回断言要用的一切 */
  async function fixture(): Promise<{ cwd: string; sha: string; headBefore: string }> {
    const cwd = makeRepo();
    writeFileSync(join(cwd, 'main.tex'), 'v1\n', 'utf8');
    const sha = (await saveVersion(cwd, '快照', 'auto')).sha as string;
    writeFileSync(join(cwd, 'main.tex'), 'v2\n', 'utf8');
    const versionsBefore = await listVersions(cwd);
    return { cwd, sha, headBefore: versionsBefore[0]?.sha ?? '' };
  }

  /** 断言"工作区与本轮 git 历史都一点没变" */
  async function assertUntouched(cwd: string, headBefore: string): Promise<void> {
    expect(readFileSync(join(cwd, 'main.tex'), 'utf8')).toBe('v2\n');
    const versionsAfter = await listVersions(cwd);
    expect(versionsAfter[0]?.sha).toBe(headBefore);
    expect(versionsAfter.some((v) => v.kind === 'restore-backup')).toBe(false);
  }

  it('★ 不带 confirm 的 revert：confirm_required 且文件字节未变、无备份版本', async () => {
    const { cwd, sha, headBefore } = await fixture();
    const messages = [msg({ id: 'u1', role: 'user', checkpointRef: sha })];

    const out = await revertToMessage(
      { sessionId: 's1', messageId: 'u1' }, // ← 没有 confirm
      { session: { cwd }, running: false, messages },
      restoreVersion,
    );

    expect(out).toEqual({ ok: false, status: 400, error: 'confirm_required' });
    await assertUntouched(cwd, headBefore);
  });

  it('★ confirm:false 也不行（literal(true) 而不是 boolean）', async () => {
    const { cwd, sha, headBefore } = await fixture();
    const out = await revertToMessage(
      { sessionId: 's1', messageId: 'u1', confirm: false },
      {
        session: { cwd },
        running: false,
        messages: [msg({ id: 'u1', role: 'user', checkpointRef: sha })],
      },
      restoreVersion,
    );
    expect(out).toEqual({ ok: false, status: 400, error: 'confirm_required' });
    await assertUntouched(cwd, headBefore);
  });

  it('★ 请求体是垃圾（null / 数组 / 字符串）时同样零改动', async () => {
    const { cwd, sha, headBefore } = await fixture();
    for (const body of [null, [], 'confirm', 42]) {
      const out = await revertToMessage(
        body,
        {
          session: { cwd },
          running: false,
          messages: [msg({ id: 'u1', role: 'user', checkpointRef: sha })],
        },
        restoreVersion,
      );
      expect(out.ok).toBe(false);
    }
    await assertUntouched(cwd, headBefore);
  });

  it('★ 回合在跑 → 409 turn_running，零改动（确认位给了也不放行）', async () => {
    const { cwd, sha, headBefore } = await fixture();
    const out = await revertToMessage(
      { sessionId: 's1', messageId: 'u1', confirm: true },
      {
        session: { cwd },
        running: true,
        messages: [msg({ id: 'u1', role: 'user', checkpointRef: sha })],
      },
      restoreVersion,
    );
    expect(out).toEqual({ ok: false, status: 409, error: 'turn_running' });
    await assertUntouched(cwd, headBefore);
  });

  it('★ checkpoint 不存在 / 已失效 → 500 restore_failed（明确错误码，不是静默成功）', async () => {
    const { cwd, headBefore } = await fixture();
    // 一个语法合法但仓库里不存在的 ref：模拟"快照被 gc 掉了"
    const ghost = '0123456789abcdef0123456789abcdef01234567';
    const out = await revertToMessage(
      { sessionId: 's1', messageId: 'u1', confirm: true },
      {
        session: { cwd },
        running: false,
        messages: [msg({ id: 'u1', role: 'user', checkpointRef: ghost })],
      },
      restoreVersion,
    );
    expect(out).toEqual({ ok: false, status: 500, error: 'restore_failed' });
    await assertUntouched(cwd, headBefore);
  });

  it('★ 没有 checkpoint 的那条 → 400 no_checkpoint，零改动', async () => {
    const { cwd, headBefore } = await fixture();
    const out = await revertToMessage(
      { sessionId: 's1', messageId: 'u1', confirm: true },
      {
        session: { cwd },
        running: false,
        messages: [msg({ id: 'u1', role: 'user', checkpointRef: null })],
      },
      restoreVersion,
    );
    expect(out).toEqual({ ok: false, status: 400, error: 'no_checkpoint' });
    await assertUntouched(cwd, headBefore);
  });

  it('★ 消息不是 user 行 / 不存在 → 404，零改动', async () => {
    const { cwd, sha, headBefore } = await fixture();
    const messages = [
      msg({ id: 'a1', role: 'assistant', checkpointRef: sha }),
      msg({ id: 'u1', role: 'user', checkpointRef: sha }),
    ];
    for (const badId of ['a1', 'nope']) {
      const out = await revertToMessage(
        { sessionId: 's1', messageId: badId, confirm: true },
        { session: { cwd }, running: false, messages },
        restoreVersion,
      );
      expect(out).toEqual({ ok: false, status: 404, error: 'message_not_found' });
    }
    await assertUntouched(cwd, headBefore);
  });

  it('★ 会话不存在 → 404 session_not_found，零改动', async () => {
    const { cwd, sha, headBefore } = await fixture();
    const out = await revertToMessage(
      { sessionId: 's1', messageId: 'u1', confirm: true },
      {
        session: null,
        running: false,
        messages: [msg({ id: 'u1', role: 'user', checkpointRef: sha })],
      },
      restoreVersion,
    );
    expect(out).toEqual({ ok: false, status: 404, error: 'session_not_found' });
    await assertUntouched(cwd, headBefore);
  });

  it('防恒真：同样的输入把 confirm 换成 true 就**必须**真的改文件', async () => {
    // 上一条与这一条唯一的差别就是 confirm —— 证明"零改动"来自门槛，
    // 不是来自"这个 fixture 本身就让 restore 失败"
    const { cwd, sha } = await fixture();
    const out = await revertToMessage(
      { sessionId: 's1', messageId: 'u1', confirm: true },
      {
        session: { cwd },
        running: false,
        messages: [msg({ id: 'u1', role: 'user', checkpointRef: sha })],
      },
      restoreVersion,
    );
    expect(out.ok).toBe(true);
    expect(readFileSync(join(cwd, 'main.tex'), 'utf8')).toBe('v1\n');
  });
});

// ─────────────────────────────────────────────────────────────
// ⑤ 分叉：原会话逐条不变
// ─────────────────────────────────────────────────────────────

describe('§5 分叉 —— 原会话必须一个字节都不变', () => {
  const source = {
    id: 's-parent',
    title: '2024 国赛 A 题',
    projectId: 'p1',
    providerId: 'prov-1',
    model: 'model-1',
  };

  function convo(): OpsMessage[] {
    return [
      msg({ id: 'u1', role: 'user', checkpointRef: 'sha-1', content: '第一问', createdAt: 11 }),
      msg({ id: 'a1', role: 'assistant', agentMsgUuid: 'uuid-1', content: '答第一问', createdAt: 12 }),
      msg({ id: 'u2', role: 'user', checkpointRef: 'sha-2', content: '第二问', createdAt: 13 }),
      msg({ id: 'a2', role: 'assistant', content: '答第二问', createdAt: 14 }),
    ];
  }

  it('★ 从回复分叉：原会话数组逐条深等不变，新会话带走了应有的消息', () => {
    const store = memoryStore();
    const messages = convo();
    // 深拷贝快照 —— 之后拿它跟"跑完 fork 的原数组"逐字节比
    const snapshot = JSON.parse(JSON.stringify(messages)) as OpsMessage[];

    const out = executeFork(
      { session: source, messages, body: { messageId: 'u2' } },
      store.ports,
      nextId,
      999,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.status).toBe(201);

    // ① 原会话：条数、顺序、每个字段都没变（含 checkpointRef / agentMsgUuid）
    expect(messages).toEqual(snapshot);
    expect(messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);

    // ② 新会话：是另一行、另一个 id、标题带后缀、计数等于带过来的条数
    expect(store.sessions.length).toBe(1);
    const created = store.sessions[0];
    expect(created.id).not.toBe(source.id);
    expect(created.title).toBe(`2024 国赛 A 题${FORK_TITLE_SUFFIX}`);
    expect(created.projectId).toBe('p1');
    expect(created.messageCount).toBe(2);

    // ③ 带过来的消息：内容与时间线一致，但 id 全新、sessionId 指向新会话
    expect(store.messages.length).toBe(2);
    expect(store.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(store.messages.map((m) => m.blocks)).toEqual([
      snapshot[0].blocks,
      snapshot[1].blocks,
    ]);
    expect(store.messages.map((m) => m.createdAt)).toEqual([11, 12]);
    expect(store.messages.map((m) => m.sessionId)).toEqual([created.id, created.id]);
    for (const row of store.messages) {
      expect(['u1', 'a1']).not.toContain(row.id);
    }
    expect(new Set(store.messages.map((m) => m.id)).size).toBe(2);

    // ④ 响应体：字段名对齐应用约定 + 当前实现额外报的 resumable / draft
    expect(out.result.copiedMessages).toBe(2);
    expect(out.result.draft).toBe('第二问'); // 用户消息分叉 → 原文预填输入框
    expect(out.result.session.id).toBe(created.id);
    expect(out.result.resumable).toBe(true); // kept 里有带 uuid 的 assistant 行
  });

  it('从助手回复分叉：本条**含**在新会话里，draft 为 null', () => {
    const store = memoryStore();
    const messages = convo();
    const snapshot = JSON.parse(JSON.stringify(messages)) as OpsMessage[];

    const out = executeFork(
      { session: source, messages, body: { messageId: 'a1' } },
      store.ports,
      nextId,
      999,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.copiedMessages).toBe(2);
    expect(out.result.draft).toBeNull();
    expect(store.messages.map((m) => m.createdAt)).toEqual([11, 12]);
    expect(messages).toEqual(snapshot);
  });

  it('空会话（从第一条用户消息分叉）也能建出会话：0 条消息、draft 是原文', () => {
    const store = memoryStore();
    const messages = convo();
    const out = executeFork(
      { session: source, messages, body: { messageId: 'u1' } },
      store.ports,
      nextId,
      999,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.copiedMessages).toBe(0);
    expect(out.result.draft).toBe('第一问');
    expect(out.result.resumable).toBe(false);
    expect(store.sessions[0].messageCount).toBe(0);
    expect(store.messages).toEqual([]);
  });

  it('★ 消息不存在 / 请求体不合法 → 报错且**不新建任何会话**', () => {
    for (const body of [{ messageId: 'nope' }, {}, { messageId: '' }, null, 'x']) {
      const store = memoryStore();
      const out = executeFork(
        { session: source, messages: convo(), body },
        store.ports,
        nextId,
        999,
      );
      expect(out.ok).toBe(false);
      expect(store.sessions).toEqual([]);
      expect(store.messages).toEqual([]);
    }
    expect(executeFork({ session: source, messages: convo(), body: { messageId: 'nope' } }, memoryStore().ports, nextId, 1)).toEqual(
      { ok: false, status: 404, error: 'message_not_found' },
    );
  });

  it('★ 分叉**不碰工作区**：没有任何 restore/save 端口，唯一副作用是那两次落库', () => {
    const store = memoryStore();
    const calls: string[] = [];
    const spyPorts = {
      createSession: (r: ForkSessionRow) => {
        calls.push('createSession');
        store.ports.createSession(r);
      },
      insertMessages: (r: ForkMessageRow[]) => {
        calls.push('insertMessages');
        store.ports.insertMessages(r);
      },
    };
    const out = executeFork(
      { session: source, messages: convo(), body: { messageId: 'a2' } },
      spyPorts,
      nextId,
      5,
    );
    expect(out.ok).toBe(true);
    // 落库调用**只有**这两次 —— 一个 saveVersion / restoreVersion 都不能有
    expect(calls).toEqual(['createSession', 'insertMessages']);
  });
});
