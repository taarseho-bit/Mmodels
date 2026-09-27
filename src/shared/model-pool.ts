/**
 * 模型池路由的纯函数。
 *
 * 供应商的模型清单、当前默认模型和备用模型以前分别在设置页与运行器里
 * 各自处理，容易出现“界面能选、运行时又选回旧模型”的分叉。这里把规则
 * 收拢成一个无副作用的小模块，主进程和测试可以共用，渲染层也能用同一口径
 * 显示当前模型池。
 */

export const MAX_CONTEXT_WINDOW = 1_000_000;
export const MIN_CONTEXT_WINDOW = 128_000;

export interface ModelRouteInput {
  models?: string[];
  modelPool?: string[];
  fallbackModels?: string[];
  defaultModel?: string | null;
  sessionModel?: string | null;
}

export interface ModelRoute {
  /** 本轮首先尝试的模型。 */
  primary: string;
  /** 失败时按顺序尝试的模型，不含 primary。 */
  fallbacks: string[];
  /** primary + fallbacks，方便记录和展示。 */
  candidates: string[];
  /** 经过清洗后的可选模型池。 */
  pool: string[];
}

export function normalizeModelIds(values: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!id || /[\s,]/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 仅保留清单中仍存在的模型，同时允许用户留下一个尚未自动发现的默认值。 */
export function modelPoolOf(input: ModelRouteInput): string[] {
  const all = normalizeModelIds(input.models);
  const selected = normalizeModelIds(input.modelPool);
  if (selected.length) return selected.filter((id) => all.length === 0 || all.includes(id));
  return all;
}

export function chooseModelRoute(input: ModelRouteInput): ModelRoute {
  const pool = modelPoolOf(input);
  const all = normalizeModelIds(input.models);
  const preferred = [input.defaultModel, input.sessionModel]
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim());
  const primary = preferred.find((id) => pool.includes(id) || (!pool.length && (all.length === 0 || all.includes(id))))
    ?? pool[0]
    ?? all[0]
    ?? preferred[0]
    ?? '';

  const configuredFallbacks = normalizeModelIds(input.fallbackModels)
    .filter((id) => id !== primary && (pool.length === 0 || pool.includes(id)));
  // 没有显式备用顺序时，模型池中其余模型自然成为低优先级备用，
  // 这样新发现模型不会因为用户忘记点“加入备用”而完全浪费。
  const inferred = pool.filter((id) => id !== primary && !configuredFallbacks.includes(id));
  const fallbacks = [...configuredFallbacks, ...inferred];
  return { primary, fallbacks, candidates: primary ? [primary, ...fallbacks] : fallbacks, pool };
}

export function normalizeContextWindow(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < MIN_CONTEXT_WINDOW) return undefined;
  return Math.min(MAX_CONTEXT_WINDOW, n);
}

