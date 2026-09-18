const fs = require('fs');
const path = require('path');
const out = [];

const checks = [
  ['electron.exe', 'node_modules\\.pnpm\\electron@33.4.11\\node_modules\\electron\\dist\\electron.exe'],
  ['electron path.txt', 'node_modules\\.pnpm\\electron@33.4.11\\node_modules\\electron\\path.txt'],
  ['better_sqlite3.node', 'node_modules\\.pnpm\\better-sqlite3@12.11.1\\node_modules\\better-sqlite3\\build\\Release\\better_sqlite3.node'],
  ['node-pty pty.node', 'node_modules\\.pnpm\\node-pty@1.1.0\\node_modules\\node-pty\\prebuilds\\win32-x64\\pty.node'],
  ['claude.exe', 'node_modules\\.pnpm\\@anthropic-ai+claude-agent-sdk-win32-x64@0.3.224\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe'],
  ['claude-agent-sdk sdk.mjs', 'node_modules\\.pnpm\\@anthropic-ai+claude-agent-sdk@0.3.224_*\\node_modules\\@anthropic-ai\\claude-agent-sdk\\sdk.mjs'],
];

out.push('=== 关键二进制 ===');
for (const [label, rel] of checks) {
  const full = path.join('D:\\mathmodel-desktop', rel);
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
