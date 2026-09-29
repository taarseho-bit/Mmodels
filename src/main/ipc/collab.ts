/**
 * 局域网协作的 IPC 层 —— 渲染层与 `src/main/collab/server.ts` 之间的唯一通道。
 *
 * 这一层只做三件事，业务逻辑全在 server.ts 里（那样才能脱离 electron 做联调）：
 *   1. 把渲染层传来的参数补齐（本机身份 id、当前项目信息）
 *   2. 把服务事件转发给渲染层（`collab:event`）
 *   3. 退出应用时收摊，别把监听端口留成僵尸
 *
 * 会员状态由账号与授权 IPC 统一管理；局域网协作只负责房间权限和项目范围，
 * 不在这里重复读取口令或实现另一套会员校验。
 */
import { app, ipcMain } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { IPC } from '@shared/types';
import type {
  CollabDiscoverResult,
  CollabEvent,
  CollabFileResult,
  CollabJoinResult,
  CollabRole,
  CollabRoomInfo,
  CollabTaskStatus,
} from '@shared/types';
import { collabService } from '../collab/server';
import { getProject } from './project';
import { getSettings } from '../store/config';
import { pushToRenderer, safeWrap } from './index';
import { assertAiEntitlement } from '../security/license-gate';

/**
 * 本机身份 id —— 用来挡应用约定的「同一个账号不能重复加入同一协作房间」。
 * 存 userData 下的一个小 JSON，重装/清数据才会变。
 */
let cachedIdentity: string | null = null;
function accountId(): string {
  if (cachedIdentity) return cachedIdentity;
  const file = join(app.getPath('userData'), 'collab-identity.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { id?: string };
    if (parsed.id) {
      cachedIdentity = parsed.id;
      return cachedIdentity;
    }
  } catch {
    /* 首次运行没有这个文件 */
  }
  cachedIdentity = randomUUID();
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(file, JSON.stringify({ id: cachedIdentity }, null, 2), 'utf8');
  } catch {
    /* 写不进去也不影响本次会话 */
  }
  return cachedIdentity;
}

/** 渲染层传来的显示名：优先用户填的，其次个人资料里的显示名，最后给个默认 */
function displayName(input: unknown): string {
  const name = typeof input === 'string' ? input.trim() : '';
  if (name) return name;
  const profile = getSettings().profileName?.trim();
  return profile || '房主';
}

/** 当前项目（协作以项目为单位，没有项目不许开房） */
function currentProject(): { id: string; name: string; root: string } | null {
  const id = getSettings().recentProjectId;
  if (!id) return null;
  const meta = getProject(id);
  return meta ? { id: meta.id, name: meta.name, root: meta.root } : null;
}

export function registerCollabHandlers(): void {
  // ── 服务事件 → 渲染层 ──
  collabService.on('event', (event: CollabEvent) => {
    pushToRenderer(IPC.COLLAB_EVENT, event);
  });

  // 退出时关掉房主服务，别占着端口/广播位
  app.on('will-quit', () => {
    void collabService.stopHost();
  });

  ipcMain.handle(
    IPC.COLLAB_INFO,
    safeWrap((): CollabRoomInfo | null => collabService.snapshot(), '读取协作房间'),
  );

  ipcMain.handle(
    IPC.COLLAB_START,
    safeWrap(async (_e, name: unknown): Promise<CollabRoomInfo> => {
      await assertAiEntitlement('cloud-collaboration');
      const project = currentProject();
      if (!project) throw new Error('当前没有打开的项目，无法开始协作');
      return collabService.startHost({
        projectId: project.id,
        projectName: project.name,
        projectRoot: project.root,
        ownerName: displayName(name),
        accountId: accountId(),
      });
    }, '开始局域网协作'),
  );

  ipcMain.handle(
    IPC.COLLAB_STOP,
    safeWrap(async (): Promise<boolean> => {
      await collabService.stopHost();
      return true;
    }, '结束局域网协作'),
  );

  ipcMain.handle(
    IPC.COLLAB_REFRESH_CODE,
    safeWrap((): CollabRoomInfo | null => collabService.refreshCode(), '更换加入码'),
  );

  ipcMain.handle(
    IPC.COLLAB_JOIN,
    safeWrap(
      async (
        _e,
        input: { address?: string; code?: string; name?: string },
      ): Promise<CollabJoinResult> => {
        return assertAiEntitlement('cloud-collaboration').then(() => collabService.join({
          address: String(input?.address ?? ''),
          code: String(input?.code ?? ''),
          name: displayName(input?.name),
          accountId: accountId(),
        }));
      },
      '加入协作房间',
    ),
  );

  ipcMain.handle(
    IPC.COLLAB_LEAVE,
    safeWrap(async (): Promise<boolean> => {
      await collabService.leave();
      return true;
    }, '退出协作房间'),
  );

  ipcMain.handle(
    IPC.COLLAB_APPROVE,
    safeWrap((_e, requestId: string, role: CollabRole): CollabRoomInfo | null => {
      const safeRole: CollabRole = role === 'editor' ? 'editor' : 'viewer';
      return collabService.approve(String(requestId), safeRole);
    }, '批准加入请求'),
  );

  ipcMain.handle(
    IPC.COLLAB_REJECT,
    safeWrap((_e, requestId: string): CollabRoomInfo | null =>
      collabService.reject(String(requestId)), '拒绝加入请求'),
  );

  ipcMain.handle(
    IPC.COLLAB_REMOVE,
    safeWrap((_e, memberId: string): CollabRoomInfo | null =>
      collabService.removeMember(String(memberId)), '移除成员'),
  );

  ipcMain.handle(
    IPC.COLLAB_DISCOVER,
    safeWrap((): Promise<CollabDiscoverResult> => collabService.discover(), '查找附近房间'),
  );

  ipcMain.handle(
    IPC.COLLAB_TASK_SUBMIT,
    safeWrap(
      async (_e, input: { title?: string; prompt?: string }): Promise<boolean> => {
        await assertAiEntitlement('cloud-collaboration');
        return collabService.submitTask({
          title: String(input?.title ?? '').slice(0, 200),
          prompt: String(input?.prompt ?? ''),
        });
      },
      '提交协作任务',
    ),
  );

  ipcMain.handle(
    IPC.COLLAB_TASK_DECIDE,
    safeWrap((_e, taskId: string, approve: boolean): CollabRoomInfo | null =>
      collabService.decideTask(String(taskId), approve === true), '处理协作任务'),
  );

  ipcMain.handle(
    IPC.COLLAB_TASK_STATUS,
    safeWrap((_e, taskId: string, status: CollabTaskStatus): CollabRoomInfo | null =>
      collabService.setTaskStatus(String(taskId), status), '更新协作任务状态'),
  );

  ipcMain.handle(
    IPC.COLLAB_SET_AUTO_APPROVE,
    safeWrap((_e, value: boolean): CollabRoomInfo | null =>
      collabService.setAutoApproveTasks(value === true), '切换自动批准'),
  );

  // ── 共享文件（项目文件协作编辑）──

  ipcMain.handle(
    IPC.COLLAB_SHARE_FILE,
    safeWrap((_e, path: string): CollabRoomInfo | null =>
      collabService.shareFile(String(path ?? '')), '加入共享文件'),
  );

  ipcMain.handle(
    IPC.COLLAB_UNSHARE_FILE,
    safeWrap((_e, path: string): CollabRoomInfo | null =>
      collabService.unshareFile(String(path ?? '')), '移出共享文件'),
  );

  ipcMain.handle(
    IPC.COLLAB_FILE_READ,
    safeWrap((_e, path: string): Promise<CollabFileResult> =>
      collabService.readFile(String(path ?? '')), '读取共享文件'),
  );

  ipcMain.handle(
    IPC.COLLAB_FILE_WRITE,
    safeWrap(
      (_e, input: { path?: string; content?: string; baseVersion?: number }): Promise<CollabFileResult> =>
        collabService.writeFile(
          String(input?.path ?? ''),
          String(input?.content ?? ''),
          Number(input?.baseVersion ?? 0),
        ),
      '保存共享文件',
    ),
  );

  ipcMain.handle(
    IPC.COLLAB_FILE_SAVE_COPY,
    safeWrap(
      (_e, input: { path?: string; content?: string }): Promise<CollabFileResult> =>
        collabService.saveCopy(String(input?.path ?? ''), String(input?.content ?? '')),
      '另存共享文件副本',
    ),
  );
}
