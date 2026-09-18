/**
 * 字段白名单校验。
 *
 * ⚠️ 这里的作用不是"格式检查"，而是**防线**：
 *   客户端的 token 会随安装包分发出去，客户端本身也可能被改造。
 *   所以服务端对每个字段做白名单挑选 —— **只取我们要的，其余一律丢弃**，
 *   绝不把原始 body 整个存下来。
 *
 * 由白名单挑选过的对象再落盘，即使有人往接口里灌垃圾，也污染不了库里已有的结构。
 */

/** 单字段长度上限（字符） */
const LIMITS = {
  category: 48,
  feature: 40,
  action: 40,
  result: 24,
  model: 64,
  providerKind: 24,
  providerType: 24,
  failureCategory: 48,
  message: 2000,
  reason: 2000,
  contact: 200,
  logs: 32768,
  page: 200,
} as const;

/** 数值字段上限，防异常值把统计打歪 */
const NUM_CAP = {
  durationMs: 7 * 24 * 3600 * 1000,
  inputTokens: 2_000_000_000,
  outputTokens: 2_000_000_000,
  costUsd: 1_000_000,
  filesChanged: 10_000,
} as const;

export const EVENT_NAMES = [
  'desktop_session_started',
  'feature_used',
  'operation_started',
  'operation_finished',
  'agent_run_finished',
  'app_error',
  'diagnostic',
] as const;

type EventName = (typeof EVENT_NAMES)[number];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, max: number, fallback = ''): string {
  if (typeof v !== 'string') return fallback;
  return v.length > max ? v.slice(0, max) : v;
}

function optionalStr(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string' || v.length === 0) return undefined;
  return v.length > max ? v.slice(0, max) : v;
}

function num(v: unknown, cap: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const n = Math.trunc(v);
  if (n < 0) return 0;
  return n > cap ? cap : n;
}

/** UUID 形态（也接受测试用的短串，只要字符集安全） */
const SAFE_TOKEN = /^[a-zA-Z0-9_-]{1,64}$/;

function safeToken(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  return SAFE_TOKEN.test(v) ? v : undefined;
}

/**
 * 事件脱敏 + 白名单。
 * 返回 null 表示这条不要（不是错误，调用方直接跳过即可）。
 */
export function sanitizeEvent(input: unknown): Record<string, unknown> | null {
  if (!isPlainObject(input)) return null;
  const name = input.name;
  if (typeof name !== 'string' || !(EVENT_NAMES as readonly string[]).includes(name)) return null;

  const out: Record<string, unknown> = {
    schemaVersion: 1,
    appId: str(input.appId, 64),
    eventId: safeToken(input.eventId),
    installId: safeToken(input.installId),
    sessionId: safeToken(input.sessionId),
    occurredAt: str(input.occurredAt, 32),
    appVersion: str(input.appVersion, 32),
    platform: str(input.platform, 16),
    arch: str(input.arch, 16),
    name,
  };

  if (!out.eventId) return null; // 没有 eventId 就没法去重，直接丢

  switch (name as EventName) {
    case 'feature_used': {
      // usage 是个小对象，逐个字段挑
      if (isPlainObject(input.usage)) {
        const u = input.usage;
        out.usage = {
          feature: str(u.feature, LIMITS.feature),
          action: str(u.action, LIMITS.action),
        };
      }
      break;
    }
    case 'agent_run_finished': {
      out.providerKind = optionalStr(input.providerKind, LIMITS.providerKind);
      out.providerType = optionalStr(input.providerType, LIMITS.providerType);
      out.model = optionalStr(input.model, LIMITS.model);
      out.result = optionalStr(input.result, LIMITS.result);
      out.durationMs = num(input.durationMs, NUM_CAP.durationMs);
      out.inputTokens = num(input.inputTokens, NUM_CAP.inputTokens);
      out.outputTokens = num(input.outputTokens, NUM_CAP.outputTokens);
      out.costUsd = num(input.costUsd, NUM_CAP.costUsd);
      out.filesChanged = num(input.filesChanged, NUM_CAP.filesChanged);
      out.failureCategory = optionalStr(input.failureCategory, LIMITS.failureCategory);
      break;
    }
    case 'app_error': {
      // ⚠️ 只收**分类名**，不收原始错误消息 —— 消息里可能带路径、密钥、业务数据
      out.errorCategory = str(input.errorCategory, LIMITS.category);
      break;
    }
    case 'operation_started':
    case 'operation_finished': {
      out.operation = optionalStr(input.operation, 48);
      out.result = optionalStr(input.result, LIMITS.result);
      out.durationMs = num(input.durationMs, NUM_CAP.durationMs);
      break;
    }
    default:
      break;
  }

  return out;
}

/**
 * 诊断报告脱敏 + 白名单。
 * 与事件不同，这里**允许带一段日志**和用户填的描述 —— 那是排障的关键信息，
 * 所以必须由客户端先脱敏，服务端再做长度与结构约束。
 */
export function sanitizeReport(input: unknown): Record<string, unknown> | null {
  if (!isPlainObject(input)) return null;
  const report = isPlainObject(input.report) ? input.report : input;
  const id = safeToken(report.id);
  if (!id) return null;

  const app = isPlainObject(report.app) ? report.app : {};
  const system = isPlainObject(report.system) ? report.system : {};

  const rawFaults = Array.isArray(report.faults) ? report.faults : [];
  const faults: Record<string, unknown>[] = [];
  for (const f of rawFaults.slice(0, 50)) {
    if (!isPlainObject(f)) continue;
    faults.push({
      id: safeToken(f.id),
      at: str(f.at, 32),
      source: str(f.source, 24),
      category: str(f.category, LIMITS.category),
      page: optionalStr(f.page, LIMITS.page),
      message: optionalStr(f.message, LIMITS.message),
    });
  }

  return {
    schemaVersion: 1,
    id,
    createdAt: str(report.createdAt, 32),
    reason: str(report.reason, LIMITS.reason),
    contact: optionalStr(report.contact, LIMITS.contact),
    app: {
      version: str(app.version, 32),
      electron: str(app.electron, 32),
      chrome: str(app.chrome, 32),
      node: str(app.node, 32),
    },
    system: {
      platform: str(system.platform, 16),
      arch: str(system.arch, 16),
      osVersion: str(system.osVersion, 48),
      locale: str(system.locale, 16),
    },
    faults,
    // 只留尾部：越近的日志越和故障相关；同时天然限制了体积
    logs: str(report.logs, LIMITS.logs),
  };
}
