/**
 * 文案保真度审计：找出源码里**硬编码的中文**（应该走 tx() 的那些）。
 *
 * 背景：本项目规矩是「界面文案一律取自原版 i18n 字典」。
 * 早几轮做的页面（设置 / 自动化 / 扩展 / 对话）当时字典还没提取出来，
 * 用的是自写中文 —— 类型检查与冒烟都抓不到这类偏差。
 *
 * 用法：node scripts/audit-hardcoded.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const SRC = 'D:/mathmodel-desktop/src/renderer/src';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 允许保留中文的地方：注释、纯符号、以及确实不是界面文案的（如单位、示例值） */
const CJK = /[\u4e00-\u9fff]/;

const rows = [];
for (const f of walk(SRC)) {
  const raw = fs.readFileSync(f, 'utf8');
  const lines = raw.split('\n');
  let inBlock = false;
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // 跟踪块注释
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (/^\s*\/\*/.test(line) && !line.includes('*/')) {
      inBlock = true;
      continue;
    }
    // 去掉行内块注释与行注释
    line = line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '');
    if (!CJK.test(line)) continue;
    // 排除 JSX 注释 {/* … */}
    if (/^\s*\{\s*\/\*/.test(line)) continue;
    hits.push({ line: i + 1, text: lines[i].trim().slice(0, 110) });
  }
  if (hits.length) rows.push({ file: path.relative(SRC, f).replace(/\\/g, '/'), hits });
}

rows.sort((a, b) => b.hits.length - a.hits.length);

console.log('文件                                       硬编码中文行');
console.log('-'.repeat(62));
let total = 0;
for (const r of rows) {
  console.log(r.file.padEnd(42) + String(r.hits.length).padStart(6));
  total += r.hits.length;
}
console.log('-'.repeat(62));
console.log('合计 ' + total + ' 行（涉及 ' + rows.length + ' 个文件）');

// 落盘明细，便于逐条替换
const detail = rows
  .map((r) => `##### ${r.file}  (${r.hits.length})\n` + r.hits.map((h) => `  ${h.line}: ${h.text}`).join('\n'))
  .join('\n\n');
fs.writeFileSync('D:/mathmodel-desktop/out/hardcoded-text.txt', detail, 'utf8');
console.log('\n明细已写入 out/hardcoded-text.txt');
