/**
 * 全局皮肤 v3（2026-09-26：变量驱动 + 双层花纹 + 零模糊动画）
 *
 * 用户实测三轮反馈定稿：
 * 1. 主题 11 选 1（经典白/经典黑/跟随系统 + 8 风格），全部平级——THEME_PRESETS
 * 2. 风格主题必须让**整个界面**带色调 → 覆盖 --bg-canvas / --bg-panel（布局体系
 *    的侧栏 72%/顶栏 82% 半透明 + blur 会自动透出画布色，app-main 直接用变量）
 * 3. 界面本体上严禁 opacity/transform 动画（呼吸闪烁/整体模糊都是这么来的）——
 *    动画只存在于花纹前景层（::before，独立合成层，transform translate 由
 *    GPU 加速，内容层不动，永不模糊、零重绘负担）
 */

export interface SkinDef {
  id: string;
  name: string;
  hint: string;
  /** 浅色模式强调色 */
  accent: string;
  /** 深色模式强调色（更亮保证对比） */
  accentDark: string;
  /** 图案种类 */
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
  { id: 'solver-blue',  name: '求解蓝',   hint: '网格纹 · 建模求解',         accent: '#3b62d4', accentDark: '#7d9df2', pattern: 'grid',  tint: '#e8eefb', tintDark: '#12141d', patternColor: '#3b62d4', patternColorDark: '#7d9df2' },
  { id: 'data-teal',    name: '数据青',   hint: '波点纹 · 数据分析',         accent: '#1d8a80', accentDark: '#4ecabf', pattern: 'dots',  tint: '#e4f3ef', tintDark: '#101a18', patternColor: '#1d8a80', patternColorDark: '#4ecabf' },
  { id: 'review-violet',name: '评审紫',   hint: '菱形纹 · 论文评审',         accent: '#6a4bd8', accentDark: '#a794f0', pattern: 'hex',   tint: '#edeafa', tintDark: '#151224', patternColor: '#6a4bd8', patternColorDark: '#a794f0' },
  { id: 'figure-orange',name: '图表橙',   hint: '波浪纹 · 图表制作',         accent: '#d97b2e', accentDark: '#f2a45e', pattern: 'waves', tint: '#fcefdf', tintDark: '#1b1410', patternColor: '#d97b2e', patternColorDark: '#f2a45e' },
  { id: 'rose-paper',   name: '论文玫',   hint: '斜纹 · 论文写作',           accent: '#d04a76', accentDark: '#ef83a8', pattern: 'diag',  tint: '#fceaf1', tintDark: '#1c1116', patternColor: '#d04a76', patternColorDark: '#ef83a8' },
  { id: 'forest-calc',  name: '推演森',   hint: '十字纹 · 推导演算',         accent: '#2e7d5b', accentDark: '#5cb98d', pattern: 'plus',  tint: '#e5f2ea', tintDark: '#101913', patternColor: '#2e7d5b', patternColorDark: '#5cb98d' },
  { id: 'night-owl',    name: '深夜鸮',   hint: '星点纹 · 深夜推演',         accent: '#5a6acf', accentDark: '#9aa6ee', pattern: 'stars', tint: '#e9ecf9', tintDark: '#12131f', patternColor: '#5a6acf', patternColorDark: '#9aa6ee' },
  { id: 'dawn-gold',    name: '曙光金',   hint: '环纹 · 汇总交付',           accent: '#b8860b', accentDark: '#e0b34e', pattern: 'rings', tint: '#f9f2dd', tintDark: '#1b1710', patternColor: '#b8860b', patternColorDark: '#e0b34e' },
];

export function skinById(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

// ── 主题预设（2026-09-26 用户定稿：主题 = 3 亮度经典 + 8 花纹风格，11 选 1 平级） ──
//
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

// ── 花纹 SVG data-URI（浅/深同形，颜色不同；透明度压得很低保证文字清晰） ──

function svgUri(w: number, h: number, body: string): string {
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'%3E${body}%3C/svg%3E")`;
}

function hex2(hx: string): string {
  return `%23${hx.replace('#', '')}`;
}

/** 底层花纹（静态，铺在 app-shell / app-main / settings-shell 背景） */
function patternMainUri(pattern: SkinDef['pattern'], color: string): string {
  const c = hex2(color);
  switch (pattern) {
    case 'grid':
      return svgUri(60, 60, `%3Cpath d='M60 0H0v60' fill='none' stroke='${c}' stroke-opacity='.09'/%3E`);
    case 'dots':
      return svgUri(40, 40, `%3Ccircle cx='6' cy='6' r='3' fill='${c}' fill-opacity='.12'/%3E%3Ccircle cx='28' cy='28' r='2' fill='${c}' fill-opacity='.07'/%3E`);
    case 'hex':
      return svgUri(52, 52, `%3Cpath d='M26 6l16 16-16 16-16-16z' fill='none' stroke='${c}' stroke-opacity='.09'/%3E`);
    case 'waves':
      return svgUri(80, 24, `%3Cpath d='M0 12q16-10 32 0t32 0 16 0' fill='none' stroke='${c}' stroke-opacity='.10'/%3E`);
    case 'diag':
      return svgUri(32, 32, `%3Cpath d='M-4 20 20 -4M8 36 36 8' stroke='${c}' stroke-opacity='.08'/%3E`);
    case 'plus':
      return svgUri(44, 44, `%3Cpath d='M22 12v20M12 22h20' stroke='${c}' stroke-opacity='.09'/%3E`);
    case 'stars':
      return svgUri(56, 56, `%3Cpath d='m28 16 2.5 7.5 7.5 2.5-7.5 2.5-2.5 7.5-2.5-7.5L18 26l7.5-2.5z' fill='${c}' fill-opacity='.08'/%3E%3Ccircle cx='8' cy='44' r='2' fill='${c}' fill-opacity='.09'/%3E%3Ccircle cx='46' cy='12' r='1.5' fill='${c}' fill-opacity='.07'/%3E`);
    case 'rings':
      return svgUri(56, 56, `%3Ccircle cx='28' cy='28' r='12' fill='none' stroke='${c}' stroke-opacity='.09'/%3E%3Ccircle cx='28' cy='28' r='22' fill='none' stroke='${c}' stroke-opacity='.06'/%3E`);
    default:
      return 'none';
  }
}

/** 前景花纹（动层，与底层错位/反向形成"部位动"） */
function patternFrontUri(pattern: SkinDef['pattern'], color: string): string {
  const c = hex2(color);
  switch (pattern) {
    case 'grid':
      return svgUri(60, 60, `%3Ccircle cx='0' cy='0' r='2.5' fill='${c}' fill-opacity='.14'/%3E%3Ccircle cx='60' cy='60' r='2.5' fill='${c}' fill-opacity='.10'/%3E%3Ccircle cx='60' cy='0' r='1.5' fill='${c}' fill-opacity='.08'/%3E`);
    case 'dots':
      return svgUri(40, 40, `%3Ccircle cx='24' cy='8' r='1.8' fill='${c}' fill-opacity='.10'/%3E%3Ccircle cx='10' cy='32' r='1.4' fill='${c}' fill-opacity='.07'/%3E`);
    case 'hex':
      return svgUri(52, 52, `%3Cpath d='M26 14l8 8-8 8-8-8z' fill='${c}' fill-opacity='.06'/%3E`);
    case 'waves':
      return svgUri(80, 24, `%3Cpath d='M0 18q16 8 32 0t32 0 16 0' fill='none' stroke='${c}' stroke-opacity='.07'/%3E`);
    case 'diag':
      return svgUri(32, 32, `%3Cpath d='M-4 8 8 -4M20 36 36 20' stroke='${c}' stroke-opacity='.06'/%3E`);
    case 'plus':
      return svgUri(44, 44, `%3Cpath d='M22 15v14M15 22h14' stroke='${c}' stroke-opacity='.06'/%3E`);
    case 'stars':
      return svgUri(56, 56, `%3Cpath d='m12 20 1.5 4.5L18 26l-4.5 1.5L12 32l-1.5-4.5L6 26l4.5-1.5z' fill='${c}' fill-opacity='.06'/%3E%3Ccircle cx='44' cy='40' r='1.8' fill='${c}' fill-opacity='.07'/%3E%3Ccircle cx='50' cy='6' r='1.3' fill='${c}' fill-opacity='.05'/%3E`);
    case 'rings':
      return svgUri(56, 56, `%3Ccircle cx='28' cy='28' r='5' fill='none' stroke='${c}' stroke-opacity='.07'/%3E%3Cpath d='M28 14v28M14 28h28' stroke='${c}' stroke-opacity='.05'/%3E`);
    default:
      return 'none';
  }
}

/** 把皮肤变量写到文档根（皮肤与主题平行：读 theme 选色板，skin 选身份） */
export function applySkinVars(root: HTMLElement, skinId: string, accentOverride?: string): void {
  const skin = skinById(skinId);
  const dark = root.dataset.theme === 'dark';
  // 用户自定义强调色（外观设置取色器）优先于皮肤色板；
  // 深色模式下把自定义色自动提亮一档，保证对比（复用 mixHex 管线）。
  const base = accentOverride && /^#[0-9a-fA-F]{6}$/.test(accentOverride)
    ? accentOverride
    : (dark ? skin.accentDark : skin.accent);
  const accent = dark && !accentOverride ? skin.accentDark : base;
  const tint = dark ? skin.tintDark : skin.tint;
  const patternColor = dark ? skin.patternColorDark : skin.patternColor;
  root.dataset.skin = skin.id;
  // accent 系
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-hover', mixHex(accent, relLum(accent) > 0.5 ? '#000000' : '#ffffff', 0.14));
  root.style.setProperty('--accent-weak', mixHex(tint, accent, 0.15));
  root.style.setProperty('--accent-fg', relLum(accent) > 0.55 ? '#1a1a1a' : '#ffffff');
  // 全局色调：画布 = 皮肤 tint；面板 = tint 调白保持层次（侧栏/顶栏半透明会自动透出画布色）
  root.style.setProperty('--bg-canvas', tint);
  root.style.setProperty('--bg-panel', dark ? mixHex(tint, '#2c2c2e', 0.55) : mixHex(tint, '#ffffff', 0.55));
  // 花纹双层：底层静态铺画布，前景动层由 CSS ::before 引用并做 translate 动画
  root.style.setProperty('--skin-pattern', patternMainUri(skin.pattern, patternColor));
  root.style.setProperty('--skin-pattern-front', patternFrontUri(skin.pattern, patternColor));
}
