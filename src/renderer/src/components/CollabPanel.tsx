/**
 * 「局域网协作」面板 —— 原版是**局域网**协作（非云端）：房主开房生成加入码，
 * 队友在同一网段内用「房主地址 + 加入码」加入；进房间要房主批准（编辑者 / 查看者），
 * 附近的房间靠 UDP 广播自动发现，Agent 任务可以提交给房主批准后执行。
 *
 * 三种视图：
 *   ① 未开房：开房 / 加入表单 / 附近房间 / 网络提示
 *   ② 我是房主：地址 + 加入码（10 分钟有效，可换）+ 成员 + 待批准 + Agent 任务
 *   ③ 我是队员：房间信息 + 成员 + 任务（可提交）+ 退出
 *
 * 所有文案走 `tx('dock.collabPanel.*')`；数据全部来自主进程的局域网服务
 * （`src/main/collab/server.ts`），这里不做任何网络细节。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CollabEvent,
  CollabJoinError,
  CollabMember,
  CollabNearbyRoom,
  CollabRoomInfo,
  CollabTaskStatus,
  FileNode,
  ProjectMeta,
} from '@shared/types';
import { tx } from '../i18n';
interface Props {
  open: boolean;
  onClose: () => void;
}

/** 加入失败的语义 → 文案键（一一对应原版词典里的 joinXxx） */
const ERR_KEY: Record<CollabJoinError, string> = {
  joinFailed: 'dock.collabPanel.joinFailed',
  joinInvalidCode: 'dock.collabPanel.joinInvalidCode',
  joinRoomClosed: 'dock.collabPanel.joinRoomClosed',
  joinRejected: 'dock.collabPanel.joinRejected',
  joinSameAccountNotAllowed: 'dock.collabPanel.joinSameAccountNotAllowed',
  joinIncompatibleRoom: 'dock.collabPanel.joinIncompatibleRoom',
  joinMembershipRequired: 'dock.collabPanel.joinMembershipRequired',
};

const ROLE_KEY: Record<CollabMember['role'], string> = {
  owner: 'dock.collabPanel.roles.owner',
  editor: 'dock.collabPanel.roles.editor',
  viewer: 'dock.collabPanel.roles.viewer',
};

const TASK_KEY: Record<CollabTaskStatus, string> = {
  pending: 'dock.collabPanel.taskStatus.pending',
  queued: 'dock.collabPanel.taskStatus.queued',
  running: 'dock.collabPanel.taskStatus.running',
  done: 'dock.collabPanel.taskStatus.done',
  failed: 'dock.collabPanel.taskStatus.failed',
  rejected: 'dock.collabPanel.taskStatus.rejected',
};

function roleClass(role: CollabMember['role']): string {
  if (role === 'owner') return 'badge badge-accent';
  if (role === 'editor') return 'badge badge-success';
  return 'badge';
}

function taskClass(status: CollabTaskStatus): string {
  if (status === 'done') return 'badge badge-success';
  if (status === 'failed' || status === 'rejected') return 'badge badge-danger';
  if (status === 'pending') return 'badge badge-warning';
  return 'badge badge-accent';
}

/** 能当文本共同编辑的扩展名 —— 其余（图片/PDF/二进制）不列进「加入共享」的候选 */
const TEXT_EXT = new Set([
  'tex', 'sty', 'cls', 'bib', 'md', 'markdown', 'txt', 'log',
  'py', 'm', 'jl', 'r', 'c', 'h', 'cpp', 'hpp', 'java', 'js', 'cjs', 'mjs', 'ts', 'tsx',
  'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'csv', 'tsv', 'sql', 'sh',
  'html', 'css', 'xml', 'mmd', 'drawio', 'svg',
]);

function isTextFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_EXT.has(name.slice(dot + 1).toLowerCase());
}

/** 项目文件树 → 可共享的候选相对路径（只留文本文件） */
function flattenTextFiles(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.isDirectory) {
      if (n.children) flattenTextFiles(n.children, out);
      continue;
    }
    if (isTextFile(n.name) || isTextFile(n.relPath)) out.push(n.relPath);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** 正在编辑的共享文件（`savedContent` = 上次从房主拿到的磁盘内容，用来判断有没有本地改动） */
interface EditingFile {
  path: string;
  baseVersion: number;
  content: string;
  savedContent: string;
}

/** 保存被拒时的冲突现场 —— 三条处置路都从这里出发 */
interface FileConflict {
  path: string;
  myContent: string;
  diskContent: string;
  diskVersion: number;
}

export function CollabPanel({ open, onClose }: Props): JSX.Element | null {
  const [room, setRoom] = useState<CollabRoomInfo | null>(null);
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  /** 已提交加入申请、仍在等房主批准 */
  const [waiting, setWaiting] = useState(false);
  const [nearby, setNearby] = useState<{
    state: 'idle' | 'loading' | 'ready' | 'unavailable';
    rooms: CollabNearbyRoom[];
  }>({ state: 'idle', rooms: [] });
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState('');
  /** 已派发给本机 Agent 的任务：taskId → sessionId（防止重复派发） */
  const dispatched = useRef(new Map<string, string>());

  // ── 共享文件 ──
  /** 正在编辑的共享文件（null = 没打开编辑器） */
  const [editing, setEditing] = useState<EditingFile | null>(null);
  /** 保存被拒的冲突现场；非 null 时编辑器里给出「覆盖 / 放弃 / 另存」 */
  const [conflict, setConflict] = useState<FileConflict | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileMsg, setFileMsg] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  /** 房主侧「加入共享」的下拉候选（项目里的文本文件） */
  const [shareable, setShareable] = useState<string[]>([]);
  const [sharePath, setSharePath] = useState('');

  /** 编辑器的当前值镜像 —— 事件回调里要拿到最新值，不能靠闭包里的 state */
  const editingRef = useRef<EditingFile | null>(null);
  const applyEditing = useCallback((next: EditingFile | null): void => {
    editingRef.current = next;
    setEditing(next);
  }, []);

  const discover = useCallback(async () => {
    setNearby((prev) => ({ ...prev, state: 'loading' }));
    try {
      const res = await window.mathmodel.collab.discover();
      setNearby({ state: res.available ? 'ready' : 'unavailable', rooms: res.rooms });
    } catch {
      setNearby({ state: 'unavailable', rooms: [] });
    }
  }, []);

  // ── 打开面板：拉当前房间 + 当前项目 + 订阅事件 ──
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      try {
        const [info, proj, settings] = await Promise.all([
          window.mathmodel.collab.info(),
          window.mathmodel.project.current(),
          window.mathmodel.settings.get(),
        ]);
        if (!alive) return;
        setRoom(info);
        setProject(proj);
        setName((prev) => prev || settings.profileName || '');
      } catch {
        /* 拿不到就当没开房 */
      }
    })();

    const off = window.mathmodel.collab.onEvent((ev: CollabEvent) => {
      if (ev.type === 'room') {
        setRoom(ev.room);
        setWaiting(false);
        return;
      }
      if (ev.type === 'file') {
        // 房主（或别的队员）刚改完这个文件 —— 房主权威把「新版本 + 全文」推了过来
        const cur = editingRef.current;
        if (cur && cur.path === ev.path) {
          if (cur.content === ev.content) {
            // 推过来的正是我编辑框里的内容 —— 这是**我自己那次保存**的回声，静默跟版本
            applyEditing({
              path: ev.path,
              baseVersion: ev.version,
              content: ev.content,
              savedContent: ev.content,
            });
          } else if (cur.content === cur.savedContent) {
            // 我这边没有未保存的改动 → 跟到最新（这就是「别人改了我实时看到」）
            applyEditing({
              path: ev.path,
              baseVersion: ev.version,
              content: ev.content,
              savedContent: ev.content,
            });
          } else {
            // 我有未保存的改动 → 保留我的内容（基版本仍是旧的，保存时会走冲突处置）
            setFileErr(tx('dock.fileEditor.conflictBody'));
          }
        }
        return;
      }
      if (ev.type === 'closed') {
        setRoom(null);
        setWaiting(false);
        applyEditing(null);
        setConflict(null);
        setErrorKey(ev.error ? ERR_KEY[ev.error] : null);
        return;
      }
      if (ev.type === 'rejected') {
        setRoom(null);
        setWaiting(false);
        setErrorKey(ERR_KEY.joinRejected);
        return;
      }
      if (ev.type === 'error') setErrorKey(ERR_KEY[ev.error]);
    });

    return () => {
      alive = false;
      off();
    };
  }, [open]);

  // ── 没房间时自动找一次附近房间 ──
  useEffect(() => {
    if (!open || room || waiting) return;
    void discover();
  }, [open, room, waiting, discover]);

  // ── 房主：把「已批准/自动批准」的任务交给本机 Agent 跑 ──
  useEffect(() => {
    if (!room || room.self !== 'host') return;
    const projectId = room.projectId;
    for (const task of room.tasks) {
      if (task.status !== 'queued' || dispatched.current.has(task.id)) continue;
      dispatched.current.set(task.id, '');
      void (async () => {
        try {
          const meta = await window.mathmodel.session.create(projectId, task.title);
          dispatched.current.set(task.id, meta.id);
          await window.mathmodel.session.send(meta.id, task.prompt);
          await window.mathmodel.collab.setTaskStatus(task.id, 'running');
        } catch {
          try {
            await window.mathmodel.collab.setTaskStatus(task.id, 'failed');
          } catch {
            /* 房间可能已经关了 */
          }
        }
      })();
    }
  }, [room]);

  // ── 房主：Agent 跑完回写任务状态，让队员看到进度 ──
  useEffect(() => {
    if (!open) return;
    const off = window.mathmodel.session.onStream((sessionId, ev) => {
      if (ev.type !== 'session-end' && ev.type !== 'session-error') return;
      const hit = [...dispatched.current.entries()].find(([, sid]) => sid === sessionId);
      if (!hit) return;
      const status: CollabTaskStatus = ev.type === 'session-error' ? 'failed' : 'done';
      void window.mathmodel.collab.setTaskStatus(hit[0], status).catch(() => undefined);
    });
    return off;
  }, [open]);

  // ── 房主：拉一次项目文件树，作为「加入共享」的候选（只列文本文件） ──
  useEffect(() => {
    if (!open || room?.self !== 'host') return;
    let alive = true;
    void (async () => {
      try {
        const tree = await window.mathmodel.file.tree();
        if (alive) setShareable(flattenTextFiles(tree));
      } catch {
        if (alive) setShareable([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, room?.self]);

  /** 本机在这个房间里的角色 —— 决定共享文件能不能写（查看者只读） */
  const selfRole: CollabMember['role'] = useMemo(() => {
    if (!room) return 'viewer';
    return room.members.find((m) => m.self)?.role ?? (room.self === 'host' ? 'owner' : 'viewer');
  }, [room]);
  const readOnly = selfRole === 'viewer';

  if (!open) return null;

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setErrorKey(null);
    try {
      await fn();
    } catch {
      setErrorKey('dock.collabPanel.actionFailed');
    } finally {
      setBusy(false);
    }
  };

  const startHosting = (): Promise<void> =>
    act(async () => {
      const info = await window.mathmodel.collab.start(name.trim());
      setRoom(info);
    });

  const joinRoom = (): Promise<void> =>
    act(async () => {
      const res = await window.mathmodel.collab.join({
        address: address.trim(),
        code: code.trim(),
        name: name.trim(),
      });
      if (!res.ok) {
        setErrorKey(res.error ? ERR_KEY[res.error] : ERR_KEY.joinFailed);
        return;
      }
      if (res.pending) {
        setWaiting(true);
        return;
      }
      if (res.room) setRoom(res.room);
    });

  const leaveRoom = (): Promise<void> =>
    act(async () => {
      if (room?.self === 'host') await window.mathmodel.collab.stop();
      else await window.mathmodel.collab.leave();
      setRoom(null);
      setWaiting(false);
      setCode('');
      dispatched.current.clear();
    });

  const copyAddress = (): void => {
    void navigator.clipboard
      .writeText(`${room?.address ?? ''}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1_500);
      })
      .catch(() => setErrorKey('dock.collabPanel.actionFailed'));
  };

  const submitTask = (): Promise<void> =>
    act(async () => {
      const text = draft.trim();
      if (!text) return;
      const ok = await window.mathmodel.collab.submitTask({
        title: text.slice(0, 60),
        prompt: text,
      });
      if (ok) setDraft('');
      else setErrorKey('dock.collabPanel.actionFailed');
    });

  const isHost = room?.self === 'host';
  const otherProject = Boolean(room && project && room.projectId !== project.id);

  // ── 共享文件：读 / 写 / 冲突三选一 ──

  /** 打开（或从房主拉最新内容）某个共享文件 */
  const openFile = (path: string): Promise<void> =>
    actFile(async () => {
      const res = await window.mathmodel.collab.fileRead(path);
      if (!res.ok) {
        setFileErr(tx('dock.collabPanel.files.readFailed'));
        return;
      }
      applyEditing({
        path: res.path,
        baseVersion: res.version,
        content: res.content,
        savedContent: res.content,
      });
      setConflict(null);
      setFileMsg(null);
    });

  /** 保存 —— 带「我改之前看到的版本号」；对不上就落到冲突三选一 */
  const saveFile = (): Promise<void> =>
    actFile(async () => {
      const cur = editingRef.current;
      if (!cur || readOnly) return;
      const res = await window.mathmodel.collab.fileWrite({
        path: cur.path,
        content: cur.content,
        baseVersion: cur.baseVersion,
      });
      if (res.ok) {
        applyEditing({ ...cur, baseVersion: res.version, savedContent: cur.content });
        setConflict(null);
        setFileErr(null);
        setFileMsg(tx('dock.fileEditor.saved'));
        return;
      }
      if (res.error === 'fileConflict') {
        setConflict({
          path: res.path,
          myContent: cur.content,
          diskContent: res.content,
          diskVersion: res.diskVersion ?? res.version,
        });
        return;
      }
      setFileErr(res.error === 'fileReadOnly' ? tx('dock.fileEditor.readOnly') : tx('common.saveFailed'));
    });

  /** 冲突处置①「用我的内容覆盖」—— 用磁盘版本号当新基版本再写一次 */
  const overwriteSave = (): Promise<void> =>
    actFile(async () => {
      const c = conflict;
      if (!c) return;
      const res = await window.mathmodel.collab.fileWrite({
        path: c.path,
        content: c.myContent,
        baseVersion: c.diskVersion,
      });
      if (!res.ok) {
        setFileErr(res.error === 'fileReadOnly' ? tx('dock.fileEditor.readOnly') : tx('common.saveFailed'));
        return;
      }
      applyEditing({
        path: c.path,
        baseVersion: res.version,
        content: c.myContent,
        savedContent: c.myContent,
      });
      setConflict(null);
      setFileMsg(tx('dock.fileEditor.saved'));
    });

  /** 冲突处置②「放弃修改」—— 丢掉本地内容，跟到磁盘版本 */
  const discardMine = (): void => {
    const c = conflict;
    if (!c) return;
    applyEditing({
      path: c.path,
      baseVersion: c.diskVersion,
      content: c.diskContent,
      savedContent: c.diskContent,
    });
    setConflict(null);
    setFileMsg(null);
    setFileErr(null);
  };

  /** 冲突处置③「另存为副本」—— 我的内容写进 `名字-副本.ext`，原文件不动 */
  const saveAsCopy = (): Promise<void> =>
    actFile(async () => {
      const c = conflict;
      if (!c) return;
      const res = await window.mathmodel.collab.fileSaveCopy({ path: c.path, content: c.myContent });
      if (!res.ok || !res.savedAs) {
        setFileErr(tx('common.saveFailed'));
        return;
      }
      setConflict(null);
      // 副本已经落盘并进了共享清单 —— 直接切过去继续编辑（openFile 会清提示，
      // 所以「已复制为 …」放在它后面说）
      await openFile(res.savedAs);
      setFileMsg(tx('dock.explorerPanel.duplicatedAs', { name: res.savedAs }));
    });

  /** 房主把文件加入共享 */
  const shareFile = (): Promise<void> =>
    actFile(async () => {
      const path = sharePath.trim();
      if (!path) return;
      const info = await window.mathmodel.collab.shareFile(path);
      if (info) setRoom(info);
      if (info?.sharedFiles.some((f) => f.path === path)) {
        setSharePath('');
        setFileMsg(tx('dock.collabPanel.files.shareDone'));
      } else {
        setFileErr(tx('dock.collabPanel.files.shareFailed'));
      }
    });

  const unshareFile = (path: string): Promise<void> =>
    actFile(async () => {
      const info = await window.mathmodel.collab.unshareFile(path);
      if (info) setRoom(info);
      if (editingRef.current?.path === path) {
        applyEditing(null);
        setConflict(null);
      }
    });

  /** 共享文件操作自己的 busy/提示状态机 —— 和 `act()` 分开，免得多文件操作互相清提示 */
  const actFile = async (fn: () => Promise<void>): Promise<void> => {
    setFileBusy(true);
    setFileErr(null);
    setFileMsg(null);
    try {
      await fn();
    } catch {
      setFileErr(tx('common.saveFailed'));
    } finally {
      setFileBusy(false);
    }
  };

  /** 还没共享出去的项目文本文件 */
  const shareCandidates = shareable.filter((p) => !room?.sharedFiles.some((f) => f.path === p));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel col collab-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          {room
            ? tx(
                isHost ? 'dock.collabPanel.startTitle' : 'dock.collabPanel.guestActiveTitle',
                { name: room.roomName },
              )
            : tx('dock.collabPanel.startTitle')}
        </div>

        {errorKey && <div className="collab-error">{tx(errorKey)}</div>}

        {/* ── ① 还没开房也没加入 ── */}
        {!room && (
          <>
            {!project ? (
              <div className="col collab-box">
                <div className="collab-strong">{tx('dock.collabPanel.needProjectTitle')}</div>
                <div className="muted collab-note">{tx('dock.collabPanel.needProjectDescription')}</div>
              </div>
            ) : (
              <div className="col collab-box">
                <div className="collab-strong">{tx('dock.collabPanel.startTitle')}</div>
                <div className="muted collab-note">{tx('dock.collabPanel.startDescription')}</div>
                <input
                  className="input"
                  placeholder={tx('dock.collabPanel.namePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <div className="row collab-actions">
                  <span className="muted collab-note">{project.name}</span>
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void startHosting()}>
                    {tx('dock.collabPanel.startButton')}
                  </button>
                </div>
              </div>
            )}

            <div className="col collab-box">
              <div className="collab-strong">{tx('dock.collabPanel.joinTitle')}</div>
              <label className="muted collab-note">{tx('dock.collabPanel.manualAddressLabel')}</label>
              <input
                className="input"
                placeholder={tx('dock.collabPanel.addressPlaceholder')}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <input
                className="input"
                placeholder={tx('dock.collabPanel.codePlaceholder')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              {waiting ? (
                <div className="row collab-actions">
                  <span className="muted collab-note">{tx('dock.collabPanel.waitingApproval')}</span>
                  <button className="btn btn-sm" disabled={busy} onClick={() => void leaveRoom()}>
                    {tx('dock.collabPanel.cancelJoin')}
                  </button>
                </div>
              ) : (
                <div className="row collab-actions">
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy || !address.trim() || !code.trim()}
                    onClick={() => void joinRoom()}
                  >
                    {tx('dock.collabPanel.joinButton')}
                  </button>
                </div>
              )}
            </div>

            <div className="col collab-box">
              <div className="row collab-actions">
                <span className="collab-strong">{tx('dock.collabPanel.nearbyTitle')}</span>
                <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void discover()}>
                  {tx('dock.collabPanel.refreshNearby')}
                </button>
              </div>
              {nearby.state === 'loading' && (
                <div className="muted collab-note">{tx('dock.collabPanel.discovering')}</div>
              )}
              {nearby.state === 'unavailable' && (
                <div className="muted collab-note">{tx('dock.collabPanel.nearbyUnavailable')}</div>
              )}
              {nearby.state === 'ready' &&
                (nearby.rooms.length === 0 ? (
                  <div className="muted collab-note">{tx('dock.collabPanel.nearbyEmpty')}</div>
                ) : (
                  nearby.rooms.map((r) => (
                    <div className="row collab-row" key={r.address}>
                      <div className="col" style={{ gap: 2, minWidth: 0 }}>
                        <span className="collab-strong">{r.name || r.address}</span>
                        <span className="muted collab-note">
                          {r.projectName ? `${r.projectName} · ${r.address}` : r.address}
                        </span>
                      </div>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          setAddress(r.address);
                          setErrorKey(null);
                        }}
                      >
                        {tx('dock.collabPanel.selectNearbyRoom', { name: r.name || r.address })}
                      </button>
                    </div>
                  ))
                ))}
            </div>

            <div className="muted collab-tip">{tx('dock.collabPanel.networkTip')}</div>
          </>
        )}

        {/* ── ② / ③ 房间进行中 ── */}
        {room && (
          <>
            {otherProject && (
              <div className="collab-warn">
                {tx('dock.collabPanel.otherProjectHint', { name: room.projectName })}
              </div>
            )}

            {isHost && (
              <div className="col collab-box">
                <div className="muted collab-note">{tx('dock.collabPanel.addressHint')}</div>
                <div className="row collab-row">
                  <code className="collab-code">{room.address}</code>
                  <button className="btn btn-sm" onClick={copyAddress}>
                    {copied ? tx('common.copied') : tx('dock.collabPanel.copyAddress')}
                  </button>
                </div>
                <div className="row collab-row">
                  <div className="col" style={{ gap: 2 }}>
                    <span className="muted collab-note">{tx('dock.collabPanel.joinCode')}</span>
                    <strong className="collab-code-lg">{room.code}</strong>
                  </div>
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const info = await window.mathmodel.collab.refreshCode();
                        if (info) setRoom(info);
                      })
                    }
                  >
                    {tx('dock.collabPanel.refreshCode')}
                  </button>
                </div>
              </div>
            )}

            {!isHost && (
              <div className="muted collab-note">
                {room.projectName} · {room.address}
              </div>
            )}

            <div className="col collab-box">
              <div className="collab-strong">
                {tx('dock.collabPanel.membersTitle', { count: room.members.length })}
              </div>
              {room.members.map((m) => (
                <div className="row collab-row" key={m.id}>
                  <span className="collab-strong">
                    {m.name}
                    {m.online ? '' : tx('dock.collabPanel.offlineSuffix')}
                  </span>
                  <div className="row collab-inline">
                    <span className={roleClass(m.role)}>{tx(ROLE_KEY[m.role])}</span>
                    {isHost && m.role !== 'owner' && (
                      <button
                        className="btn btn-sm btn-ghost"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            const info = await window.mathmodel.collab.remove(m.id);
                            if (info) setRoom(info);
                          })
                        }
                      >
                        {tx('dock.collabPanel.remove')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* ── 共享文件（房主与队员两侧都有；队员的写也要过房主权威）── */}
            <div className="col collab-box">
              <div className="row collab-actions">
                <span className="collab-strong">{tx('dock.collabPanel.files.title')}</span>
                <span className="muted collab-note">
                  {tx(ROLE_KEY[selfRole])} · {tx('dock.fileEditor.collabActive')}
                </span>
              </div>

              {room.sharedFiles.length === 0 ? (
                <div className="muted collab-note">{tx('dock.collabPanel.files.empty')}</div>
              ) : (
                room.sharedFiles.map((f) => (
                  <div className="row collab-row" key={f.path}>
                    <div className="col" style={{ gap: 2, minWidth: 0 }}>
                      <span className="collab-strong">{f.path}</span>
                      <span className="muted collab-note">
                        v{f.version} · {f.by}
                      </span>
                    </div>
                    <div className="row collab-inline">
                      <button
                        className="btn btn-sm"
                        disabled={fileBusy}
                        onClick={() => void openFile(f.path)}
                      >
                        {editing?.path === f.path
                          ? tx('dock.collabPanel.files.editing')
                          : tx('common.edit')}
                      </button>
                      {isHost && (
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={fileBusy}
                          onClick={() => void unshareFile(f.path)}
                        >
                          {tx('dock.collabPanel.remove')}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}

              {isHost && (
                <div className="row collab-inline">
                  <select
                    className="input"
                    value={sharePath}
                    onChange={(e) => setSharePath(e.target.value)}
                  >
                    <option value="">{tx('dock.collabPanel.files.pickPlaceholder')}</option>
                    {shareCandidates.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={fileBusy || !sharePath.trim()}
                    onClick={() => void shareFile()}
                  >
                    {tx('dock.collabPanel.files.share')}
                  </button>
                </div>
              )}

              {fileMsg && <div className="muted collab-note">{fileMsg}</div>}
              {fileErr && <div className="collab-error">{fileErr}</div>}
            </div>

            {/* ── 共享文件编辑器 ── */}
            {editing && (
              <div className="col collab-box collab-file-editor">
                <div className="row collab-actions">
                  <span className="collab-strong">{editing.path}</span>
                  <span className="muted collab-note">
                    v{editing.baseVersion}
                    {readOnly ? ` · ${tx('dock.fileEditor.readOnly')}` : ''}
                  </span>
                </div>

                <textarea
                  className="input collab-editor"
                  rows={8}
                  spellCheck={false}
                  readOnly={readOnly}
                  value={editing.content}
                  onChange={(e) => applyEditing({ ...editing, content: e.target.value })}
                />

                {conflict && conflict.path === editing.path && (
                  <div className="col collab-conflict">
                    <div className="collab-warn">{tx('dock.fileEditor.conflictBody')}</div>
                    <div className="row collab-inline">
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={fileBusy}
                        onClick={() => void overwriteSave()}
                      >
                        {tx('dock.fileEditor.overwriteSave')}
                      </button>
                      <button className="btn btn-sm" disabled={fileBusy} onClick={discardMine}>
                        {tx('dock.fileEditor.discard')}
                      </button>
                      <button
                        className="btn btn-sm"
                        disabled={fileBusy}
                        onClick={() => void saveAsCopy()}
                      >
                        {tx('dock.collabPanel.files.saveCopy')}
                      </button>
                    </div>
                  </div>
                )}

                <div className="row collab-actions">
                  {/* 冲突未处置时不给「保存」入口 —— 再点一次只会再被拒，把位置让给三选一 */}
                  {!(conflict && conflict.path === editing.path) && (
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={fileBusy || readOnly}
                      onClick={() => void saveFile()}
                    >
                      {tx('dock.fileEditor.save')}
                    </button>
                  )}
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      applyEditing(null);
                      setConflict(null);
                      setFileErr(null);
                      setFileMsg(null);
                    }}
                  >
                    {tx('common.close')}
                  </button>
                </div>
              </div>
            )}

            {isHost && room.pending.length > 0 && (
              <div className="col collab-box">
                <div className="collab-strong">{tx('dock.collabPanel.pendingTitle')}</div>
                {room.pending.map((p) => (
                  <div className="row collab-row" key={p.id}>
                    <span className="collab-strong">{p.name}</span>
                    <div className="row collab-inline">
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            const info = await window.mathmodel.collab.approve(p.id, 'editor');
                            if (info) setRoom(info);
                          })
                        }
                      >
                        {tx('dock.collabPanel.approveEditor')}
                      </button>
                      <button
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            const info = await window.mathmodel.collab.approve(p.id, 'viewer');
                            if (info) setRoom(info);
                          })
                        }
                      >
                        {tx('dock.collabPanel.approveViewer')}
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            const info = await window.mathmodel.collab.reject(p.id);
                            if (info) setRoom(info);
                          })
                        }
                      >
                        {tx('dock.collabPanel.reject')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="col collab-box">
              <div className="row collab-actions">
                <span className="collab-strong">{tx('dock.collabPanel.agentTasksTitle')}</span>
                {isHost && (
                  <label className="row collab-inline muted collab-note">
                    <input
                      type="checkbox"
                      checked={room.autoApproveTasks}
                      onChange={(e) =>
                        void act(async () => {
                          const info = await window.mathmodel.collab.setAutoApproveTasks(e.target.checked);
                          if (info) setRoom(info);
                        })
                      }
                    />
                    {tx('dock.collabPanel.autoApproveTasks')}
                  </label>
                )}
              </div>

              {room.tasks.map((t) => (
                <div className="row collab-row" key={t.id}>
                  <div className="col" style={{ gap: 2, minWidth: 0 }}>
                    <span className="collab-strong">{t.title}</span>
                    <span className="muted collab-note">{t.from}</span>
                  </div>
                  <div className="row collab-inline">
                    <span className={taskClass(t.status)}>{tx(TASK_KEY[t.status])}</span>
                    {isHost && !t.mine && t.status === 'pending' && (
                      <>
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const info = await window.mathmodel.collab.decideTask(t.id, true);
                              if (info) setRoom(info);
                            })
                          }
                        >
                          {tx('dock.collabPanel.taskApprove')}
                        </button>
                        <button
                          className="btn btn-sm"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const info = await window.mathmodel.collab.decideTask(t.id, false);
                              if (info) setRoom(info);
                            })
                          }
                        >
                          {tx('dock.collabPanel.taskReject')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}

              {!isHost && (
                <div className="row collab-row">
                  <input
                    className="input"
                    placeholder={tx('dock.collabPanel.agentTasksTitle')}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy || !draft.trim()}
                    onClick={() => void submitTask()}
                  >
                    {tx('chat.messageList.send')}
                  </button>
                </div>
              )}
            </div>

            <div className="row collab-actions">
              <button className="btn btn-sm" onClick={onClose}>
                {tx('common.close')}
              </button>
              <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void leaveRoom()}>
                {isHost ? tx('dock.collabPanel.stopButton') : tx('dock.collabPanel.leaveRoom')}
              </button>
            </div>
          </>
        )}

        {/* ── 未开房时的底部按钮 ── */}
        {!room && (
          <div className="row collab-actions">
            <button className="btn btn-sm" onClick={onClose}>
              {tx('dock.collabPanel.cancelJoin')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
