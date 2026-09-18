const fs = require('fs');
const path = require('path');
const out = [];
const dst = 'D:\\mathmodel-desktop\\.vendor\\node-pty';
out.push('vendor exists: ' + fs.existsSync(dst));
try {
  const pre = path.join(dst, 'prebuilds');
  const dirs = fs.readdirSync(pre, { withFileTypes: true });
  for (const d of dirs) {
    const f = path.join(pre, d.name, 'pty.node');
    let sz = -1;
    try { sz = fs.statSync(f).size; } catch {}
    out.push('  prebuilds/' + d.name + '/pty.node  ' + sz + ' B');
  }
} catch (e) {
  out.push('prebuilds ERR: ' + e.message);
}
// conpty 依赖
for (const p of [
  'third_party/conpty/1.23.251008001/win10-x64/conpty.dll',
  'third_party/conpty/1.23.251008001/win10-x64/OpenConsole.exe',
  'lib/index.js',
  'package.json',
]) {
  const f = path.join(dst, p);
  let sz = -1;
  try { sz = fs.statSync(f).size; } catch {}
  out.push('  ' + p + '  ' + sz + ' B');
}
// 统计总大小
function du(dir) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) total += du(f);
      else { try { total += fs.statSync(f).size; } catch {} }
    }
  } catch {}
  return total;
}
out.push('');
out.push('vendor total: ' + (du(dst) / 1024 / 1024).toFixed(2) + ' MB');
fs.writeFileSync('D:\\mathmodel-desktop\\.vendor-check.txt', out.join('\r\n'), 'utf8');
console.log('done');
