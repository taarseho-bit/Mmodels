/**
 * 全盘搜索本机已有的原生模块编译产物（.node 文件）
 * 重点找：better_sqlite3.node / pty.node / node_sqlite3.node
 * 同时报告其所在项目的 Electron / Node 版本，用于判断 ABI 兼容性。
 */
const fs = require('fs');
const path = require('path');

// 默认只检查当前项目；需要扫描其他目录时通过 MM_SCAN_ROOTS 传入分号分隔的路径。
// 不把开发机的用户目录写进仓库，避免把个人环境带入发布包。
const ROOTS = (process.env.MM_SCAN_ROOTS || process.cwd())
  .split(';')
  .map((item) => item.trim())
  .filter(Boolean);

// 要跳过的巨型目录，避免扫穿全盘
const SKIP_DIRS = new Set([
  'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData',
  '$Recycle.Bin', 'System Volume Information', 'node_modules', 'AppData',
  '.git', '.cache', '.npm', 'npm-cache', '.mmodels-audit',
  'resources', 'release', 'dist', 'out', '.unpack',
]);

const WANT = /^(better_sqlite3|pty|node_sqlite3|sqlite3)\.node$/i;

const hits = [];
let scanned = 0;

function walk(dir, depth) {
  if (depth > 6) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  scanned++;
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (e.name.startsWith('.')) continue;
      walk(full, depth + 1);
    } else if (e.isFile() && WANT.test(e.name)) {
      try {
        const st = fs.statSync(full);
        hits.push({ file: full, size: st.size, mtime: st.mtime.toISOString().slice(0, 19) });
      } catch {}
    }
  }
}

for (const r of ROOTS) {
  try { walk(r, 0); } catch {}
}

const out = [];
out.push(`扫描目录数: ${scanned}`);
out.push(`命中 .node 文件: ${hits.length}`);
out.push('');
for (const h of hits.sort((a, b) => b.size - a.size)) {
  out.push(`[${(h.size / 1024).toFixed(0).padStart(6)} KB]  ${h.mtime}  ${h.file}`);
}
fs.writeFileSync('D:\\mathmodel-desktop\\.scan-node-modules.txt', out.join('\r\n'), 'utf8');
console.log('done');
