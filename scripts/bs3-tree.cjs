const fs = require('fs');
const path = require('path');
const out = [];
const pkg = 'D:\\mathmodel-desktop\\node_modules\\.pnpm\\better-sqlite3@12.11.1\\node_modules\\better-sqlite3';
function walk(dir, indent) {
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { out.push(indent + 'ERR ' + e.message); return; }
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) { out.push(indent + '[D] ' + it.name); walk(full, indent + '  '); }
    else { out.push(indent + '[F] ' + it.name + '  ' + fs.statSync(full).size); }
  }
}
walk(path.join(pkg, 'build'), '');
fs.writeFileSync('D:\\mathmodel-desktop\\.bs3-tree.txt', out.join('\r\n'), 'utf8');
console.log('ok');
