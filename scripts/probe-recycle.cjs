const fs = require('fs');
const path = require('path');
const base = 'D:\\$RECYCLE.BIN\\S-1-5-21-376651186-2644657867-3392034586-1001\\$R7Q82B4';
const out = [];
function list(p, indent) {
  const full = path.join(base, p);
  let entries;
  try { entries = fs.readdirSync(full, { withFileTypes: true }); } catch (e) { out.push(indent + p + ' -> ERR ' + e.message); return; }
  for (const e of entries) {
    const rel = path.join(p, e.name);
    if (e.isDirectory()) {
      out.push(indent + '[D] ' + rel);
      if (!rel.includes('prebuilds')) list(rel, indent + '    ');
    } else {
      let sz = 0;
      try { sz = fs.statSync(path.join(base, rel)).size; } catch {}
      out.push(indent + '[F] ' + rel + '  ' + sz + ' B');
    }
  }
}
list('', '');
// 读 package.json 确认版本
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
  out.push('');
  out.push('=== package.json ===');
  out.push('name: ' + pkg.name);
  out.push('version: ' + pkg.version);
  out.push('main: ' + pkg.main);
} catch (e) {
  out.push('package.json read failed: ' + e.message);
}
fs.writeFileSync('D:\\mathmodel-desktop\\.recycle-probe.txt', out.join('\r\n'), 'utf8');
console.log('done');
