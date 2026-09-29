/**
 * 渲染层运行诊断上报（默认开启，界面不提供开关）。
 *
 * 与主进程的 telemetry 模块配套：把界面上发生的脚本错误、未处理的 Promise 拒绝
 * 和明显卡顿（单次长任务 > 4 秒）转成一条诊断信息交给主进程，再由主进程汇总上传到
 * 运营后台。只上报错误文本与上下文，不采集用户内容。
 *
 * 说明：单次会话最多上报 40 条，避免错误风暴把网络和后台刷满。
 */
import type { TelemetryKind } from '@shared/types';

const MAX_SENDS = 40;

let installed = false;
let sentCount = 0;

function send(kind: TelemetryKind, message: string, detail?: string): void {
  if (sentCount >= MAX_SENDS) return;
  sentCount += 1;
  try {
    void window.mathmodel?.telemetry?.report({ kind, message, detail })?.catch(() => undefined);
  } catch {
    /* 上报是尽力而为，不能影响界面 */
  }
}

/** 安装渲染层诊断监听。重复调用无副作用。 */
export function installRendererTelemetry(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    // ResizeObserver 的循环告警是常见噪声，不代表功能故障。
    if (/ResizeObserver/i.test(event.message || '')) return;
    const error = event.error as Error | undefined;
    send(
      'renderer-error',
      event.message || '界面脚本错误',
      error?.stack || `${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}`,
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;
    const message = reason instanceof Error ? reason.message : String(reason ?? '未处理的异步操作');
    send('renderer-error', message || '未处理的异步操作', reason instanceof Error ? reason.stack : '');
  });

  // 明显卡顿：PerformanceObserver 的 longtask 只在支持的运行时存在。
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= 4000) {
          send('slow', `界面卡顿 ${(entry.duration / 1000).toFixed(1)} 秒`, `longtask duration=${Math.round(entry.duration)}ms`);
        }
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    /* 该环境不支持 longtask 观察，跳过 */
  }
}