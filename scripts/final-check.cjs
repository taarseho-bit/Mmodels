const fs = require('fs');
const path = require('path');
const out = [];
const ROOT = 'D:\\mathmodel-desktop';
const PNPM = path.join(ROOT, 'node_modules', '.pnpm');
function packageDir(prefix) {
  try {
    const name = fs.readdirSync(PNPM).find((x) => x.startsWith(prefix + '@'));
    return name ? path.join(PNPM, name, 'node_modules', prefix) : '';
  } catch { return ''; }
}
const electronDir = packageDir('electron');
const sqliteDir = packageDir('better-sqlite3');
const ptyDir = packageDir('node-pty');
const claudeDir = packageDir('@anthropic-ai');

const checks = [
  ['electron.exe', path.join(electronDir, 'dist', 'electron.exe')],
  ['electron path.txt', path.join(electronDir, 'path.txt')],
  ['better_sqlite3.node', path.join(sqliteDir, 'build', 'Release', 'better_sqlite3.node')],
  ['node-pty pty.node', path.join(ptyDir, 'prebuilds', 'win32-x64', 'pty.node')],
];

out.push('=== 关键二进制 ===');
for (const [label, rel] of checks) {
  const full = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  const ok = fs.existsSync(full);
  out.push((ok ? 'OK      ' : 'MISSING ') + label + '  ' + (ok ? (fs.statSync(full).size / 1024 / 1024).toFixed(2) + ' MB' : ''));
}

// 顶层 node_modules 是否已硬链接
const nm = 'D:\\mathmodel-desktop\\node_modules';
try {
  const top = fs.readdirSync(nm).filter((f) => !f.startsWith('.'));
  out.push('');
  out.push('顶层包数量: ' + top.length);
  out.push(top.slice(0, 50).join(', '));
} catch (e) {
  out.push('顶层读取失败: ' + e.message);
}

fs.writeFileSync('D:\\mathmodel-desktop\\.final-check.txt', out.join('\r\n'), 'utf8');
console.log('ok');
