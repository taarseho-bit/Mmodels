/**
 * 廉价的样式完整性检查：把新写的组件/页面里用到的静态 className
 * 与 CSS 求差集，抓出「写了类名但没有样式」的情况。
 *
 * 只匹配静态字符串类名 —— 模板字符串里的动态类名抓不全，需人工确认。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'D:\\mathmodel-desktop';
const SRC = path.join(ROOT, 'src', 'renderer', 'src');

/** 动态收集：components/ 与 pages/ 下全部 .tsx + App.tsx / main.tsx */
function collectTsx() {
  const out = [];
  for (const dir of ['components', 'pages']) {
    const abs = path.join(SRC, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith('.tsx')) out.push(`${dir}/${f}`);
    }
  }
  for (const f of ['App.tsx', 'main.tsx']) {
    if (fs.existsSync(path.join(SRC, f))) out.push(f);
  }
  return out;
}

const FILES = collectTsx();

const CSS_FILES = ['styles/theme.css', 'styles/layout.css', 'styles/pages.css'];
const css = CSS_FILES.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');

const used = new Map(); // className -> Set<file>
for (const f of FILES) {
  const p = path.join(SRC, f);
  if (!fs.existsSync(p)) continue;
  const t = fs.readFileSync(p, 'utf8');
  // className="a b c"
  // ⚠️ 必须先剥掉注释，否则文档里写的 className="..." 会被误当成真实用法
  const code = t
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const m of code.matchAll(/className="([^"{]+)"/g)) {
    for (const c of m[1].split(/\s+/).filter(Boolean)) {
      if (!used.has(c)) used.set(c, new Set());
      used.get(c).add(f);
    }
  }
}

// 动态分支手工登记：模板字符串里出现的类（已知的少量分支）
const DYNAMIC_KNOWN = new Set([
  'active',
  'on',
  'disabled',
  'user',
  'assistant',
  'ok',
  'warn',
  'err',
  'msg-user',
  'msg-assistant',
  'badge-accent',
  'badge-success',
  'badge-warning',
  'badge-danger',
  'btn-primary',
  'btn-ghost',
  'btn-danger',
  'btn-sm',
  'btn-lg',
]);

const missing = [];
for (const [c, files] of used) {
  if (css.includes('.' + c)) continue;
  if (DYNAMIC_KNOWN.has(c)) continue;
  missing.push(`${c}   <- ${[...files].join(', ')}`);
}

const lines = [];
lines.push(`共扫描 ${FILES.length} 个文件，用到 ${used.size} 个静态类名`);
if (missing.length === 0) {
  lines.push('样式齐备 ✅');
} else {
  lines.push(`缺样式 ${missing.length} 个：`);
  missing.sort().forEach((m) => lines.push('  ' + m));
}

const out = path.join(ROOT, 'out', 'class-check.txt');
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log('WROTE ' + out);
