/** 把冒烟测试产物从 temp 拷到项目 out/ 下，便于用 Read 工具查看 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SRC = path.join(os.tmpdir(), 'mm-verify');
const DST = 'D:\\mathmodel-desktop\\out';
fs.mkdirSync(DST, { recursive: true });

const files = ['report.json', 'trace.txt', 'smoke.png'];
const done = [];
for (const f of files) {
  const s = path.join(SRC, f);
  if (fs.existsSync(s)) {
    fs.copyFileSync(s, path.join(DST, f));
    done.push(`${f} (${fs.statSync(s).size} bytes)`);
  } else {
    done.push(`${f} —— 不存在`);
  }
}
fs.writeFileSync(path.join(DST, 'collect-log.txt'), done.join('\n'), 'utf8');
console.log('ok');
