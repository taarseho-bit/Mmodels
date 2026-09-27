const fs = require('fs');
const path = require('path');
const out = [];
const ROOT = 'D:\\mathmodel-desktop';
const PNPM = path.join(ROOT, 'node_modules', '.pnpm');
function packageDir(prefix) {
  const name = fs.readdirSync(PNPM).find((x) => x.startsWith(prefix + '@'));
  return name ? path.join(PNPM, name, 'node_modules', prefix) : '';
}
const electronDir = packageDir('electron');
const sqliteDir = packageDir('better-sqlite3');
const ptyDir = packageDir('node-pty');
const checks = [
  path.join(electronDir, 'dist', 'electron.exe'),
  path.join(electronDir, 'path.txt'),
  path.join(sqliteDir, 'build', 'Release', 'better_sqlite3.node'),
  path.join(ptyDir, 'prebuilds', 'win32-x64', 'pty.node'),
];
for (const c of checks) {
  out.push((fs.existsSync(c) ? 'OK      ' : 'MISSING ') + c);
}
fs.writeFileSync('D:\\mathmodel-desktop\\.pnpm-bin.txt', out.join('\r\n'), 'utf8');
console.log('ok');
