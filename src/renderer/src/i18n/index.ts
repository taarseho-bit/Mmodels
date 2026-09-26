/**
 * 文案取用与插值 —— 与项目契约一致：点号路径 + `{{name}}` 占位符。
 *
 * 项目契约用 i18next（jse = { en:{translation:Sse}, "zh-CN":{translation:zse} }），
 * 默认 zh-CN 并回退 en。本模块当前实现同一语义：
 *   - `tx('papers.page.title')`        → 字符串
 *   - `tx('papers.page.problem', { code: 'A' })` → '{{code}} 题' 插值
 *   - `setLang('en-US')`               → 切换语言（en 缺键时回退 zh）
 *
 * 响应式：组件用 `useLang()` 订阅语言变化（useSyncExternalStore）；
 * 语言切换后 App 会以 lang 为 key 重挂载内容树，保证所有 tx() 取到新文案。
 */
import { useSyncExternalStore } from 'react';
import { zh } from './zh';
import { en } from './en';
import { enOverrides } from './overrides';

export { zh, en };
export type Messages = typeof zh;

export type Lang = 'zh-CN' | 'en-US';

let lang: Lang = 'zh-CN';
const listeners = new Set<() => void>();

/** 当前语言 */
export function getLang(): Lang {
  return lang;
}

/** 切换语言并广播（App 启动时从 settings.locale 同步一次） */
export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  for (const fn of listeners) fn();
}

/** 订阅语言变化（返回退订函数） */
export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React 侧订阅：语言变化时触发重渲染 */
export function useLang(): Lang {
  return useSyncExternalStore(onLangChange, getLang, getLang);
}

/** 点号路径取值；en 优先、zh 回退；路径不存在返回 undefined */
export function lookup(path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = lang === 'en-US' ? en : zh;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null) break;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (typeof cur === 'string') return cur;
  if (lang === 'en-US') {
    // en 缺键 → 回退 zh（当前 i18next fallbackLng: 'en' 的反向兜底）
    cur = zh as unknown;
    for (const p of parts) {
      if (typeof cur !== 'object' || cur === null) return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
    return typeof cur === 'string' ? cur : undefined;
  }
  return undefined;
}

/**
 * 取文案并插值。
 * @example tx('papers.page.problem', { code: 'A' }) // 'A 题'
 */
export function tx(path: string, vars?: Record<string, string | number>): string {
  const raw = lookup(path) ?? path;
  if (!vars) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m,
  );
}

/** 复数形式（项目契约 `key_one` / `key_other` 约定） */
export function txPlural(path: string, count: number, vars?: Record<string, string | number>): string {
  const suffix = count === 1 ? '_one' : '_other';
  const target = lookup(path + suffix) !== undefined ? path + suffix : path;
  return tx(target, { count, ...vars });
}

function interp(raw: string, vars?: Record<string, string | number>): string {
  if (!vars) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m,
  );
}

/**
 * 「中文即键」取文案 —— 项目契约词典里没有对应条目的界面（本项目新增的功能页）
 * 用这个：中文原文直接作键，英文译文在 overrides/ 里登记，未登记则原样返回。
 * 优先级：能用项目契约键（tx）就用 tx，t() 只是新增界面的兜底。
 */
export function t(zhStr: string, vars?: Record<string, string | number>): string {
  if (lang !== 'en-US') return interp(zhStr, vars);
  const ov = enOverrides[zhStr];
  return interp(ov ?? zhStr, vars);
}
