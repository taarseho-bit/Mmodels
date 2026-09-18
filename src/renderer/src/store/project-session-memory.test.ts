/**
 * 「切到别的项目再切回来，要回到原来那个会话」。
 *
 * ## 这条盯的是用户报的 bug 的**直接根因**
 *
 * 用户原话是「一切换，再切换回去，就看不到**整个**聊天记录」。
 * 过程块丢失（`chat-stream` 那一族）只解释了"那一轮的过程没了"，
 * 而"整屏空白"来自这里：
 *
 *   `openProject` 无条件 `set({ activeSessionId: null })`（切项目必须先离开旧会话），
 *   **但没有任何东西再把它选回来** → 切回甲时 `activeSessionId` 是 null →
 *   `ChatPage` 走「没有会话」分支清空消息与过程 → 空白页。
 *
 * 所以修法是给 store 加一份「项目 → 上次看的是哪个会话」的内存记忆，
 * 选中会话时写、`openProject` 刷新完会话列表后读。
 *
 * ## 两条边界（别让"恢复"变成自作主张）
 *
 *   · 记的会话已被删除 → 退化成"不选中"（**不**塞死 id、**不**去 get 它）；
 *   · 从没记过 → 保持"不选中"（**不**自动选列表第一个 —— 那是没确认过的产品决策）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectMeta, SessionMeta } from '@shared/types';
import { useApp } from './app';

const proj = (id: string, name = id): ProjectMeta => ({
  id,
  name,
  root: `D:/${id}`,
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
});

const sess = (id: string, projectId: string): SessionMeta => ({
  id,
  title: id,
  projectId,
  providerId: 'prov',
  model: 'm',
  status: 'idle',
  createdAt: 1,
  updatedAt: 1,
  messageCount: 0,
});

/** 磁盘上的"事实"：每个项目下有哪些会话。测试里"删会话"就是从这里摘掉。 */
let disk: Record<string, string[]>;

const projectOpen = vi.fn(async (id: string) => proj(id));
const projectList = vi.fn(async () => Object.keys(disk).map((id) => proj(id)));
const sessionList = vi.fn(async (projectId: string) =>
  (disk[projectId] ?? []).map((sid) => sess(sid, projectId)),
);
const sessionGet = vi.fn(async (id: string) => ({ meta: sess(id, ''), messages: [] }));
const sessionCreate = vi.fn(async (projectId: string, _title?: string) => {
  const id = `new-${(disk[projectId] ?? []).length + 1}`;
  disk[projectId] = [...(disk[projectId] ?? []), id];
  return sess(id, projectId);
});
const sessionRemove = vi.fn(async (id: string) => {
  for (const key of Object.keys(disk)) disk[key] = disk[key].filter((x) => x !== id);
});
const settingsGet = vi.fn(async () => ({}));

beforeEach(() => {
  disk = { p1: ['A', 'A2'], p2: ['B', 'B2'] };
  projectOpen.mockClear();
  projectList.mockClear();
  sessionList.mockClear();
  sessionGet.mockClear();
  sessionCreate.mockClear();
  sessionRemove.mockClear();
  settingsGet.mockClear();
  // `api()` 在调用时读 window.mathmodel，用例里临时挂一份即可
  (globalThis as unknown as { window: unknown }).window = {
    mathmodel: {
      project: { open: projectOpen, list: projectList },
      session: { list: sessionList, get: sessionGet, create: sessionCreate, remove: sessionRemove },
      settings: { get: settingsGet },
    },
  };
  useApp.setState({
    projects: [proj('p1'), proj('p2')],
    currentProject: null,
    sessions: [],
    activeSessionId: null,
    lastSessionByProject: {},
    newChatRequest: 0,
  });
});

describe('项目记忆 —— 切走项目再切回来，回到原来那个会话', () => {
  it('[反向对照] 甲里选中 A → 切到乙 → 切回甲 → 还是 A', async () => {
    await useApp.getState().openProject('p1');
    useApp.getState().selectSession('A');
    expect(useApp.getState().activeSessionId).toBe('A');

    // 切到乙：**必须先离开旧会话**（否则界面是乙、却顶着甲的会话 id）
    await useApp.getState().openProject('p2');
    expect(useApp.getState().activeSessionId).toBe(null);
    expect(useApp.getState().sessions.map((s) => s.id)).toEqual(['B', 'B2']);

    useApp.getState().selectSession('B');

    // 切回甲：恢复成 A，且会话列表也是甲自己的
    await useApp.getState().openProject('p1');
    expect(useApp.getState().activeSessionId).toBe('A');
    expect(useApp.getState().sessions.map((s) => s.id)).toEqual(['A', 'A2']);
  });

  it('记忆里的会话已被删除 → 退化成"不选中"，不塞死 id、也不去 get 它', async () => {
    await useApp.getState().openProject('p1');
    useApp.getState().selectSession('A');
    await useApp.getState().openProject('p2');
    useApp.getState().selectSession('B');

    // A 在别处被删了（比如另一个窗口）
    disk.p1 = ['A2'];
    await useApp.getState().openProject('p1');

    expect(useApp.getState().activeSessionId).toBe(null);
    expect(useApp.getState().activeSessionId).not.toBe('A');
    // 记忆本身没被抹掉 —— 说明"没恢复"是因为**校验了刷新回来的 sessions**，
    // 而不是因为记性不好（换成"盲信记忆"的实现，这条会红）
    expect(useApp.getState().lastSessionByProject.p1).toBe('A');
    // 也没走"拉一次看看还在不在"那条路 —— 对着一个不存在的会话 get 是一发无用的 IPC
    expect(sessionGet).not.toHaveBeenCalled();
  });

  it('从未在甲里选过会话 → 切回甲仍然不选中（不自动选列表第一个）', async () => {
    await useApp.getState().openProject('p1');
    // 列表里确实有会话，但没替用户选
    expect(useApp.getState().sessions.map((s) => s.id)).toEqual(['A', 'A2']);
    expect(useApp.getState().activeSessionId).toBe(null);

    await useApp.getState().openProject('p2');
    await useApp.getState().openProject('p1');
    expect(useApp.getState().activeSessionId).toBe(null);
    expect(useApp.getState().lastSessionByProject.p1).toBeUndefined();
  });

  it('甲、乙各记各的：来回切两次都回到各自那个（记忆不串项目）', async () => {
    await useApp.getState().openProject('p1');
    useApp.getState().selectSession('A');
    await useApp.getState().openProject('p2');
    useApp.getState().selectSession('B');

    await useApp.getState().openProject('p1');
    expect(useApp.getState().activeSessionId).toBe('A');
    await useApp.getState().openProject('p2');
    expect(useApp.getState().activeSessionId).toBe('B');
    await useApp.getState().openProject('p1');
    expect(useApp.getState().activeSessionId).toBe('A');
    await useApp.getState().openProject('p2');
    expect(useApp.getState().activeSessionId).toBe('B');
    expect(useApp.getState().lastSessionByProject).toEqual({ p1: 'A', p2: 'B' });
  });

  it('在甲里换了另一个会话 → 记忆跟着更新（下次回来是新的那个）', async () => {
    await useApp.getState().openProject('p1');
    useApp.getState().selectSession('A');
    useApp.getState().selectSession('A2');

    await useApp.getState().openProject('p2');
    await useApp.getState().openProject('p1');
    expect(useApp.getState().activeSessionId).toBe('A2');
  });

  it('新建会话后自动选中也算"用户的选择"，会被记住', async () => {
    await useApp.getState().openProject('p1');
    const meta = await useApp.getState().createSession();
    expect(useApp.getState().activeSessionId).toBe(meta?.id);
    expect(useApp.getState().lastSessionByProject.p1).toBe(meta?.id);

    await useApp.getState().openProject('p2');
    await useApp.getState().openProject('p1');
    expect(useApp.getState().activeSessionId).toBe(meta?.id);
  });

  it('点“新任务”只进入空白草稿，不提前创建空会话', async () => {
    await useApp.getState().openProject('p1');
    useApp.getState().selectSession('A');
    const before = disk.p1.length;
    useApp.getState().beginNewChat();

    expect(useApp.getState().activeSessionId).toBeNull();
    expect(useApp.getState().lastSessionByProject.p1).toBeUndefined();
    expect(useApp.getState().newChatRequest).toBe(1);
    expect(disk.p1).toHaveLength(before);
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('删掉的正是记忆里那个会话 → 记忆跟着落到接替者（下次恢复不会撞死 id）', async () => {
    await useApp.getState().openProject('p1');
    useApp.getState().selectSession('A');

    await useApp.getState().removeSession('A');
    expect(useApp.getState().activeSessionId).toBe('A2'); // 既有行为：落到剩下的第一个
    expect(useApp.getState().lastSessionByProject.p1).toBe('A2');

    await useApp.getState().openProject('p2');
    await useApp.getState().openProject('p1');
    expect(useApp.getState().activeSessionId).toBe('A2');
  });

  it('删掉最后一个会话 → 记忆清掉，切回来是不选中（不是那个死 id）', async () => {
    await useApp.getState().openProject('p1');
    disk.p1 = ['A'];
    await useApp.getState().refreshSessions();
    useApp.getState().selectSession('A');

    await useApp.getState().removeSession('A');
    expect(useApp.getState().activeSessionId).toBe(null);
    expect(useApp.getState().lastSessionByProject.p1).toBeUndefined();

    disk.p1 = ['A'];
    await useApp.getState().openProject('p1');
    expect(useApp.getState().activeSessionId).toBe(null);
  });
});
