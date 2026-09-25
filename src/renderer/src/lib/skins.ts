/**
 * 全局皮肤（2026-09-25 用户要求：像 WorkBuddy 一样的简单全局皮肤，
 * 带花纹/图案背景，一击切换、全局生效、浅深两用，文字始终可读）。
 *
 * 应用方式：`documentElement.dataset.skin = id`（CSS 按 [data-skin] 套花纹底）
 * + 直接覆盖 accent 系列变量（store 的 applyAppearance 在末尾调用）。
 */

export interface SkinDef {
  id: string;
  name: string;
  hint: string;
  /** 强调色（浅色主题用；深色主题自动提亮一档） */
  accent: string;
  /** 深色主题的强调色（更亮一档保证对比） */
  accentDark: string;
  /** 图案种类（对应 skins.css 里的花纹） */
  pattern: 'none' | 'grid' | 'dots' | 'hex' | 'waves' | 'diag' | 'plus' | 'stars' | 'rings';
  /** 浅色模式的画布底色（带一点皮肤色调） */
  tint: string;
}

export const SKINS: SkinDef[] = [
  { id: 'classic',      name: '经典',     hint: '默认干净版面',             accent: '#007aff', accentDark: '#0a84ff', pattern: 'none',  tint: '#f5f3ef' },
  { id: 'solver-blue',  name: '求解蓝',   hint: '网格纹 · 建模求解',         accent: '#3b62d4', accentDark: '#7d9df2', pattern: 'grid',  tint: '#eef2fc' },
  { id: 'data-teal',    name: '数据青',   hint: '波点纹 · 数据分析',         accent: '#1d8a80', accentDark: '#4ecabf', pattern: 'dots',  tint: '#e9f5f2' },
  { id: 'review-violet',name: '评审紫',   hint: '菱形纹 · 论文评审',         accent: '#6a4bd8', accentDark: '#a794f0', pattern: 'hex',   tint: '#f1eefc' },
  { id: 'figure-orange',name: '图表橙',   hint: '波浪纹 · 图表制作',         accent: '#d97b2e', accentDark: '#f2a45e', pattern: 'waves', tint: '#fdf1e6' },
  { id: 'rose-paper',   name: '论文玫',   hint: '斜纹 · 论文写作',           accent: '#d04a76', accentDark: '#ef83a8', pattern: 'diag',  tint: '#fdeff4' },
  { id: 'forest-calc',  name: '推演森',   hint: '十字纹 · 推导演算',         accent: '#2e7d5b', accentDark: '#5cb98d', pattern: 'plus',  tint: '#eaf4ee' },
  { id: 'night-owl',   name: '深夜鸮',   hint: '星点纹 · 深夜推演',         accent: '#5a6acf', accentDark: '#9aa6ee', pattern: 'stars', tint: '#eceffb' },
  { id: 'dawn-gold',    name: '曙光金',   hint: '环纹 · 汇总交付',           accent: '#b8860b', accentDark: '#e0b34e', pattern: 'rings', tint: '#fbf5e6' },
];

export function skinById(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

// ── 小工具：十六进制色混合 / 亮度 ─────────────────────────────

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parse(hex: string): [number, number, number] {
  const s = hex.replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

export function mixHex(a: string, b: string, ratio: number): string {
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return `rgb(${clamp(r1 + (r2 - r1) * ratio)}, ${clamp(g1 + (g2 - g1) * ratio)}, ${clamp(b1 + (b2 - b1) * ratio)})`;
}

function relLum(hex: string): number {
  const [r, g, b] = parse(hex).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 把皮肤变量写到文档根（在 applyAppearance 的主题变体之后调用，皮肤优先） */
export function applySkinVars(root: HTMLElement, skinId: string): void {
  const skin = skinById(skinId);
  const dark = root.dataset.theme === 'dark';
  const accent = dark ? skin.accentDark : skin.accent;
  root.dataset.skin = skin.id;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-hover', mixHex(accent, relLum(accent) > 0.5 ? '#000000' : '#ffffff', 0.14));
  root.style.setProperty('--accent-weak', mixHex(dark ? '#1c1c1c' : skin.tint, accent, 0.15));
  root.style.setProperty('--accent-fg', relLum(accent) > 0.55 ? '#1a1a1a' : '#ffffff');
}
