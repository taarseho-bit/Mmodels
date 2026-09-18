const fs = require('fs');
const path = require('path');
const vp = 'D:\\mathmodel-desktop\\node_modules\\.pnpm';
const out = [];
let entries = [];
try { entries = fs.readdirSync(vp); } catch (e) { out.push('err: ' + e.message); }
out.push('.pnpm count: ' + entries.length);

// 关键包是否已下载
const want = [
  'electron@',
  'better-sqlite3@',
  'node-pty@',
  'hono@',
  'drizzle-orm@',
  'react@',
  'react-dom@',
  'zustand@',
  'vite@',
  'electron-vite@',
  'typescript@',
];
out.push('');
out.push('=== 关键包落地情况 ===');
for (const w of want) {
  const hit = entries.filter((e) => e.startsWith(w));
  out.push((hit.length ? 'OK   ' : 'NONE ') + w + '  -> ' + (hit.slice(0, 3).join(', ') || '—'));
}

// electron 包内部
const el = entries.find((e) => e.startsWith('electron@'));
if (el) {
  const p = path.join(vp, el, 'node_modules', 'electron');
  out.push('');
  out.push('=== electron pkg dir ===');
  try {
    for (const f of fs.readdirSync(p)) out.push('  ' + f);
    const pe = path.join(p, 'dist', 'electron.exe');
    out.push('electron.exe: ' + (fs.existsSync(pe) ? fs.statSync(pe).size : 'MISSING'));
    const pt = path.join(p, 'path.txt');
    out.push('path.txt: ' + (fs.existsSync(pt) ? fs.readFileSync(pt, 'utf8').trim() : 'MISSING'));
  } catch (e) { out.push('  err: ' + e.message); }
}

// better-sqlite3 原生
const bs = entries.find((e) => e.startsWith('better-sqlite3@'));
if (bs) {
  const p = path.join(vp, bs, 'node_modules', 'better-sqlite3');
  out.push('');
  out.push('=== better-sqlite3 dir ===');
  try {
    for (const f of fs.readdirSync(p)) out.push('  ' + f);
    const b = path.join(p, 'build', 'Release', 'better_sqlite3.node');
    out.push('better_sqlite3.node: ' + (fs.existsSync(b) ? fs.statSync(b).size : 'MISSING'));
  } catch (e) { out.push('  err: ' + e.message); }
}

fs.writeFileSync('D:\\mathmodel-desktop\\.nm-detail.txt', out.join('\r\n'), 'utf8');
console.log('ok');
