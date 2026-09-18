const fs = require('fs');
const path = require('path');
const out = [];
const checks = [
  'D:\\mathmodel-desktop\\node_modules\\.pnpm\\electron@33.4.11\\node_modules\\electron\\dist\\electron.exe',
  'D:\\mathmodel-desktop\\node_modules\\.pnpm\\electron@33.4.11\\node_modules\\electron\\path.txt',
  'D:\\mathmodel-desktop\\node_modules\\.pnpm\\better-sqlite3@12.11.1\\node_modules\\better-sqlite3\\build\\Release\\better_sqlite3.node',
  'D:\\mathmodel-desktop\\node_modules\\.pnpm\\node-pty@1.1.0\\node_modules\\node-pty\\prebuilds\\win32-x64\\pty.node',
];
for (const c of checks) {
  out.push((fs.existsSync(c) ? 'OK      ' : 'MISSING ') + c);
}
fs.writeFileSync('D:\\mathmodel-desktop\\.pnpm-bin.txt', out.join('\r\n'), 'utf8');
console.log('ok');
