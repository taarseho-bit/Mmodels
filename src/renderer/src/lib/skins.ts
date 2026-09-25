/**
 * 全局皮肤（2026-09-26 v2：皮肤与主题完全平行、各自独立）
 *
 * 设计原则：
 * - 皮肤 = 配色身份（accent / 花纹 / 底色），主题 = 亮度模式（light / dark）
 * - 换皮肤不换主题时，花纹和强调色平滑过渡；换主题不换皮肤时，同一皮肤的深浅两态自动适配
 * - 不再从 theme 反推 accent —— 每款皮肤自带 light/dark 完整调色板
 *
 * 应用方式：`documentElement.dataset.skin = id`（CSS 按 [data-skin] 套花纹底 + 动画）
 * + applySkinVars 直写 --accent 系变量（读当前 theme 自选亮/暗色板）。
 */

export interface SkinDef {
  id: string;
  name: string;
  hint: string;
  /** 浅色模式强调色 */
  accent: string;
  /** 深色模式强调色（更亮保证对比） */
  accentDark: string;
  /** 图案种类（对应 skins.css 里的花纹 + 关键帧动画） */
  pattern: 'none' | 'grid' | 'dots' | 'hex' | 'waves' | 'diag' | 'plus' | 'stars' | 'rings';
  /** 浅色模式画布底色 */
  tint: string;
  /** 深色模式画布底色 */
  tintDark: string;
  /** 花纹主色（浅色用） */
  patternColor: string;
  /** 花纹主色（深色用） */
  patternColorDark: string;
}

export const SKINS: SkinDef[] = [
  { id: 'classic',      name: '经典',     hint: '默认干净版面',             accent: '#007aff', accentDark: '#0a84ff', pattern: 'none',  tint: '#ffffff', tintDark: '#1c1c1e', patternColor: '#007aff', patternColorDark: '#0a84ff' },
  { id: 'solver-blue',  name: '求解蓝',   hint: '网格纹 · 建模求解',         accent: '#3b62d4', accentDark: '#7d9df2', pattern: 'grid',  tint: '#eef2fc', tintDark: '#12141d', patternColor: '#3b62d4', patternColorDark: '#7d9df2' },
  { id: 'data-teal',    name: '数据青',   hint: '波点纹 · 数据分析',         accent: '#1d8a80', accentDark: '#4ecabf', pattern: 'dots',  tint: '#e9f5f2', tintDark: '#101a18', patternColor: '#1d8a80', patternColorDark: '#4ecabf' },
  { id: 'review-violet',name: '评审紫',   hint: '菱形纹 · 论文评审',         accent: '#6a4bd8', accentDark: '#a794f0', pattern: 'hex',   tint: '#f1eefc', tintDark: '#151224', patternColor: '#6a4bd8', patternColorDark: '#a794f0' },
  { id: 'figure-orange',name: '图表橙',   hint: '波浪纹 · 图表制作',         accent: '#d97b2e', accentDark: '#f2a45e', pattern: 'waves', tint: '#fdf1e6', tintDark: '#1b1410', patternColor: '#d97b2e', patternColorDark: '#f2a45e' },
  { id: 'rose-paper',   name: '论文玫',   hint: '斜纹 · 论文写作',           accent: '#d04a76', accentDark: '#ef83a8', pattern: 'diag',  tint: '#fdeff4', tintDark: '#1c1116', patternColor: '#d04a76', patternColorDark: '#ef83a8' },
  { id: 'forest-calc',  name: '推演森',   hint: '十字纹 · 推导演算',         accent: '#2e7d5b', accentDark: '#5cb98d', pattern: 'plus',  tint: '#eaf4ee', tintDark: '#101913', patternColor: '#2e7d5b', patternColorDark: '#5cb98d' },
  { id: 'night-owl',   name: '深夜鸮',   hint: '星点纹 · 深夜推演',         accent: '#5a6acf', accentDark: '#9aa6ee', pattern: 'stars', tint: '#eceffb', tintDark: '#12131f', patternColor: '#5a6acf', patternColorDark: '#9aa6ee' },
  { id: 'dawn-gold',    name: '曙光金',   hint: '环纹 · 汇总交付',           accent: '#b8860b', accentDark: '#e0b34e', pattern: 'rings', tint: '#fbf5e6', tintDark: '#1b1710', patternColor: '#b8860b', patternColorDark: '#e0b34e' },
];

export function skinById(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

// ── 主题预设（2026-09-26 用户定稿：主题 = 3 亮度经典 + 8 花纹风格，11 选 1 平级） ──
//
// 用户心智模型：设置页只有一个「主题」选择器——
//   经典白 / 经典黑 / 跟随系统 + 8 款风格主题，全部平级、点了就换，没有第二层概念。
// 每个主题完全自包含（一键到位，无隐藏状态）：
//   亮度类 → skin='classic' + 指定 mode；
//   风格类 → 指定 skin + mode='light'（锁定浅色底！）。
// ⚠️ 风格主题曾经是 mode='system'：系统深色时 8 款全渲染近黑的深色变体，
//    看起来都和经典黑一样（2026-09-26 用户实测报障后改为锁定浅色）。

export interface ThemePreset {
  id: string;
  name: string;
  hint: string;
  kind: 'brightness' | 'style';
  /** brightness 类的目标 mode */
  mode?: 'light' | 'dark' | 'system';
  /** style 类的目标皮肤 id */
  skinId?: string;
  /** 预览卡花纹 */
  pattern: SkinDef['pattern'];
  /** 预览卡底色（'split' = 跟随系统的半白半黑示意） */
  tint: string;
  /** 预览卡强调色 */
  accent: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'light',  name: '经典白',   hint: '纯白底 · 经典蓝',           kind: 'brightness', mode: 'light',  skinId: 'classic', pattern: 'none', tint: '#ffffff', accent: '#007aff' },
  { id: 'dark',   name: '经典黑',   hint: '纯黑底 · 经典蓝',           kind: 'brightness', mode: 'dark',   skinId: 'classic', pattern: 'none', tint: '#1c1c1e', accent: '#0a84ff' },
  { id: 'system', name: '跟随系统', hint: '随系统亮暗自动切换',         kind: 'brightness', mode: 'system', skinId: 'classic', pattern: 'none', tint: 'split',   accent: '#007aff' },
  ...SKINS.slice(1).map((s) => ({
    id: s.id,
    name: s.name,
    hint: s.hint,
    kind: 'style' as const,
    skinId: s.id,
    pattern: s.pattern,
    tint: s.tint,
    accent: s.accent,
  })),
];

// ── 小工具 ────────────────────────────────────────────

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

/** 把皮肤变量写到文档根（皮肤与主题平行：读 theme 选色板，skin 选身份） */
export function applySkinVars(root: HTMLElement, skinId: string): void {
  const skin = skinById(skinId);
  const dark = root.dataset.theme === 'dark';
  const accent = dark ? skin.accentDark : skin.accent;
  root.dataset.skin = skin.id;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-hover', mixHex(accent, relLum(accent) > 0.5 ? '#000000' : '#ffffff', 0.14));
  root.style.setProperty('--accent-weak', mixHex(dark ? skin.tintDark : skin.tint, accent, 0.15));
  root.style.setProperty('--accent-fg', relLum(accent) > 0.55 ? '#1a1a1a' : '#ffffff');
  // 暴露花纹色给 CSS 动画用
  root.style.setProperty('--skin-pattern-color', dark ? skin.patternColorDark : skin.patternColor);
  root.style.setProperty('--skin-tint-color', dark ? skin.tintDark : skin.tint);
}
