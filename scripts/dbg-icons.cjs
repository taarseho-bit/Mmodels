const fs = require('node:fs');
const D = 'D:/softreg-源码/.unpack/app-asar/out/renderer/assets';
const s = fs.readFileSync(D + '/star-CDVmcWVx.js', 'utf8');
console.log('文件长度', s.length);
console.log('内容:', s.slice(0, 120));
console.log();

const m = /=\s*\w\("([-a-z0-9]+)",\s*(\w+)\)/.exec(s);
console.log('name/var 匹配:', m ? { name: m[1], varName: m[2], at: m.index } : '未匹配');

const c = /const\s+(\w+)\s*=\s*\[/.exec(s);
console.log('const 数组定义:', c ? c[1] : '未找到');

// 统计有多少个文件符合「图标 chunk」特征
const files = fs.readdirSync(D).filter((f) => f.endsWith('.js'));
let likeIcon = 0;
const samples = [];
for (const f of files) {
  const t = fs.readFileSync(D + '/' + f, 'utf8');
  if (/\w\("[-a-z0-9]+",\s*\w+\)/.test(t) && t.length < 2000) {
    likeIcon++;
    if (samples.length < 5) samples.push(f + '  (' + t.length + 'B)');
  }
}
console.log();
console.log('疑似图标 chunk 数:', likeIcon);
console.log(samples.join('\n'));
