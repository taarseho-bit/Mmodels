/**
 * 运行诊断上报（默认开启，界面不提供开关）。
 *
 * 目标：软件运行中出现的错误、崩溃、加载失败、明显卡顿等信息，自动汇总到运营后台，
 * 方便定位问题与改进体验。只上报诊断文本（错误信息 + 堆栈 + 版本 + 系统），
 * 不采集用户内容，也不阻塞主流程：上报失败只丢队列，绝不影响软件使用。
 *
 * 覆盖范围：
 *   - 主进程：uncaughtException / unhandledRejection
 *   - 窗口：did-fail-load（页面加载失败）/ render-process-gone（渲染进程崩溃）
 *   - 渲染层：window.onerror / unhandledrejection / 长时间卡顿（经 IPC 转来）
 *   - 启动耗时明显偏长
 */
import { app, ipcMain, type BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC, type TelemetryKind, type TelemetryReportPayload } from '@shared/types';

const MAX_DETAIL = 1500;
const MAX_MESSAGE = 200;
const MAX_QUEUE = 40;
const FLUSH_INTERVAL_MS = 20_000;
const REQUEST_TIMEOUT_MS = 8_000;

interface QueuedReport {
  kind: TelemetryKind;
  message: string;
  detail: string;
}

let queue: QueuedReport[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;
let initialized = false;

/** 与 account.ts / license-gate.ts 同公式；上报只用于区分设备，不含个人信息。 */
function deviceId(): string {
  try {
    return createHash('sha256').update(`${app.getPath('userData')}|${process.platform}|${process.arch}`).digest('hex');
  } catch {
    return '';
  }
}

/** 已登录账号名（仅用于后台归因）；未登录返回空串。 */
function currentUsername(): string {
  try {
    const raw = JSON.parse(readFileSync(join(app.getPath('userData'), 'account.json'), 'utf8')) as { username?: string };
    return typeof raw.username === 'string' ? raw.username.slice(0, 24) : '';
  } catch {
    return '';
  }
}

/** 授权服务基址。这个解析过程必须比 account.ts 更宽容：上报失败可以丢，但不能抛异常。 */
function apiBase(): string | null {
  try {
    const file = app.isPackaged
      ? join(process.resourcesPath, 'license-policy.json')
      : join(process.cwd(), 'resources', 'license-policy.json');
    if (existsSync(file)) {
      const policy = JSON.parse(readFileSync(file, 'utf8')) as { endpoint?: string };
      const endpoint = String(policy.endpoint || '').trim();
      if (endpoint) {
        const parsed = new URL(endpoint);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
        return parsed.origin;
      }
    }
  } catch {
    /* 继续走下面的兜底 */
  }
  if (app.isPackaged) return 'https://api.mmodel.top';
  const env = process.env.MM_LICENSE_API?.trim();
  if (!env) return null;
  try {
    const parsed = new URL(env);
    return parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

function clip(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return;
  const base = apiBase();
  if (!base) {
    queue = [];
    return;
  }
  flushing = true;
  try {
    while (queue.length > 0) {
      const item = queue[0];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(`${base}/api/telemetry`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: item.kind,
            message: item.message,
            detail: item.detail,
            version: app.getVersion(),
            platform: `${process.platform} ${process.arch} ${process.getSystemVersion?.() ?? ''}`.trim(),
            deviceId: deviceId(),
            username: currentUsername(),
          }),
        });
        if (!res.ok) break; // 服务端拒绝时保留队列，下次再试
        queue.shift();
      } catch {
        break; // 网络不可用：留队列稍后重试
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    flushing = false;
  }
  if (queue.length > 0) scheduleFlush();
}

/** 入队一条诊断信息。任何输入都不会抛异常。 */
export function reportTelemetry(kind: TelemetryKind, message: unknown, detail?: unknown): void {
  try {
    const msg = clip(message, MAX_MESSAGE);
    if (!msg) return;
    queue.push({ kind, message: msg, detail: clip(detail, MAX_DETAIL) });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    // 攒够 5 条就立即发，避免长时间堆在本地。
    if (queue.length >= 5) void flush();
    else scheduleFlush();
  } catch {
    /* 上报是尽力而为，永不抛出 */
  }
}

/** 启动耗时明显偏长时上报（默认阈值 8 秒）。 */
export function reportSlowStartup(elapsedMs: number): void {
  if (elapsedMs > 8000) reportTelemetry('slow', `启动耗时 ${(elapsedMs / 1000).toFixed(1)} 秒`, `启动到主窗口可交互耗时 ${Math.round(elapsedMs)}ms`);
}

/** 挂载窗口级诊断：加载失败与渲染进程崩溃。 */
export function attachWindowTelemetry(win: BrowserWindow): void {
  try {
    win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame) return;
      reportTelemetry('load-fail', `页面加载失败：${description || code}`, `code=${code} url=${url}`);
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      reportTelemetry('crash', `渲染进程异常退出：${details?.reason || 'unknown'}`, `exitCode=${details?.exitCode ?? '?'}`);
    });
    win.webContents.on('unresponsive', () => {
      reportTelemetry('slow', '界面出现卡顿（无响应）', 'webContents unresponsive');
    });
  } catch {
    /* 忽略：诊断挂载失败不影响窗口 */
  }
}

/** 注册渲染层上报通道与主进程兜底监听。重复调用无副作用。 */
export function initTelemetry(): void {
  if (initialized) return;
  initialized = true;

  ipcMain.handle(IPC.TELEMETRY_REPORT, (_e, payload: TelemetryReportPayload): boolean => {
    try {
      reportTelemetry(payload?.kind || 'renderer-error', payload?.message, payload?.detail);
      return true;
    } catch {
      return false;
    }
  });

  process.on('uncaughtException', (err) => {
    reportTelemetry('error', err?.message || '主进程未捕获异常', err?.stack);
  });
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason ?? '未处理的 Promise 拒绝');
    reportTelemetry('error', message, reason instanceof Error ? reason.stack : '');
  });

  app.on('quit', () => {
    void flush();
  });
}