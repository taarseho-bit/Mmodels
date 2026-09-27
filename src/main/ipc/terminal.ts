/**
 * 终端（伪终端）。
 *
 * 当前实现应用约定的设计：agent 在跑数学建模任务时需要一个真实终端
 * （跑 python / latex / git），而且用户希望能**看到**它在跑什么。
 * 所以内置一个 node-pty 驱动的终端面板，而不是黑箱执行。
 *
 * ⚠️ node-pty 是原生模块：
 *    - 加载失败不能让整个应用崩，必须降级为「终端不可用」并说明原因
 *    - Windows 上 conpty 可用性取决于系统版本，也要给出可读错误
 *
 * ⚠️ 为什么不用 child_process.spawn 起 shell：
 *    没有 PTY 就没有 TTY 语义 —— python 会缓冲输出、进度条乱码、
 *    交互式命令直接卡死。终端必须是 PTY。
 */
import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC } from '@shared/types';
import { pushToRenderer, safeWrap, type IpcContext } from './index';

// ─────────────────────────────────────────────────────────────
// node-pty 懒加载
// ─────────────────────────────────────────────────────────────

interface PtyProcess {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  pid: number;
}

interface PtyModule {
  spawn(
    file: string,
    args: string[] | string,
    opts: { name?: string; cols?: number; rows?: number; cwd?: string; env?: Record<string, string> },
  ): PtyProcess;
}

let ptyMod: PtyModule | null = null;
let ptyLoadError: string | null = null;

async function loadPty(): Promise<PtyModule> {
  if (ptyMod) return ptyMod;
  if (ptyLoadError) throw new Error(ptyLoadError);
  try {
    const mod = (await import('node-pty')) as unknown as PtyModule & { default?: PtyModule };
    ptyMod = (mod.default ?? mod) as PtyModule;
    return ptyMod;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    ptyLoadError =
      `终端不可用：无法加载 node-pty（${detail}）。` +
      `若在开发环境，请确认原生模块已编译；打包版本应自带预编译二进制。`;
    throw new Error(ptyLoadError);
  }
}

// ─────────────────────────────────────────────────────────────
// 终端会话表
// ─────────────────────────────────────────────────────────────

interface TermEntry {
  id: string;
  pty: PtyProcess;
  cwd: string;
}

const terms = new Map<string, TermEntry>();

function defaultShell(): string {
  if (process.platform === 'win32') {
    // 打包后的 Electron 是 GUI 进程，没有附着控制台。直接把 PowerShell
    // 作为 PTY 根进程会在部分 Windows 10 环境报 `AttachConsole failed`，
    // 表现为终端创建成功但永远没有输出。COMSPEC 是系统保证可用的稳定入口；
    // 用户仍可在其中启动 PowerShell、conda、python、latex 等命令。
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

export function killAllTerms(): void {
  for (const [id, t] of terms) {
    try {
      t.pty.kill();
    } catch {
      /* ignore */
    }
    terms.delete(id);
  }
}

export function registerTerminalHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.TERM_CREATE,
    safeWrap(async (_e, cwd: string, cols = 100, rows = 30) => {
      const pty = await loadPty();
      const id = randomUUID();

      const proc = pty.spawn(defaultShell(), [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...(process.env as Record<string, string>),
          // 让子进程知道自己是终端，而不是被管道包装的
          TERM: 'xterm-256color',
        },
      });

      proc.onData((data: string) => {
        pushToRenderer(IPC.TERM_DATA, { termId: id, data });
      });

      proc.onExit(({ exitCode }) => {
        pushToRenderer(IPC.TERM_EXIT, { termId: id, exitCode });
        terms.delete(id);
      });

      terms.set(id, { id, pty: proc, cwd });
      return { termId: id, pid: proc.pid };
    }, '创建终端'),
  );

  ipcMain.handle(
    IPC.TERM_WRITE,
    safeWrap((_e, termId: string, data: string) => {
      const t = terms.get(termId);
      if (!t) throw new Error('终端不存在或已退出');
      t.pty.write(data);
      return true;
    }, '写入终端'),
  );

  ipcMain.handle(
    IPC.TERM_RESIZE,
    safeWrap((_e, termId: string, cols: number, rows: number) => {
      const t = terms.get(termId);
      if (!t) return false;
      t.pty.resize(cols, rows);
      return true;
    }, '调整终端尺寸'),
  );

  ipcMain.handle(
    IPC.TERM_KILL,
    safeWrap((_e, termId: string) => {
      const t = terms.get(termId);
      if (t) {
        try {
          t.pty.kill();
        } catch {
          /* ignore */
        }
        terms.delete(termId);
      }
      return true;
    }, '关闭终端'),
  );
}
