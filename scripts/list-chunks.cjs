const fs = require('fs');
const d = 'D:/softreg-源码/.unpack/app-asar/out/renderer/assets';
const js = fs.readdirSync(d).filter((n) => n.endsWith('.js'))
  .map((n) => ({ n, s: fs.statSync(d + '/' + n).size }))
  .sort((a, b) => b.s - a.s);
const lines = js.map((x) => `${(x.s / 1024).toFixed(0).padStart(6)} KB  ${x.n}`);
lines.push('', 'total js = ' + js.length);
fs.writeFileSync('D:/mathmodel-desktop/out/chunks.txt', lines.join('\n'));
console.log(lines.join('\n'));
