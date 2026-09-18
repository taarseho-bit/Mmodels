const fs = require('fs');
const path = require('path');
const nm = 'D:\\mathmodel-desktop\\node_modules';
const out = [];
out.push('node_modules exists: ' + fs.existsSync(nm));
function has(p) { try { return fs.statSync(path.join(nm, p)).size; } catch { return null; } }
const checks = [
  'electron/dist/electron.exe',
  'electron/path.txt',
  'better-sqlite3/build/Release/better_sqlite3.node',
  'node-pty/prebuilds/win32-x64/pty.node',
  'node-pty/lib/index.js',
  '@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe',
  '@anthropic-ai/claude-agent-sdk/sdk.mjs',
  'hono/dist/index.js',
  'drizzle-orm/index.js',
  'react/index.js',
];
for (const c of checks) {
  const s = has(c);
  out.push((s === null ? 'MISSING  ' : String(s).padStart(12) + '  ') + c);
}
try {
  const n = fs.readdirSync(nm).length;
  out.push('');
  out.push('top-level entries: ' + n);
} catch (e) {
  out.push('readdir err: ' + e.message);
}
fs.writeFileSync('D:\\mathmodel-desktop\\.install-progress.txt', out.join('\r\n'), 'utf8');
console.log('ok');
