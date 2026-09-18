// 按前缀/关键词筛 i18n key，用法：node grep-i18n.cjs <正则> [<正则>...]
const fs = require('fs');
const lines = fs
  .readFileSync('D:/softreg-源码/.unpack/_extract/i18n-zh-by-key.txt', 'utf8')
  .split('\n');
const pats = process.argv.slice(2).map((p) => new RegExp(p, 'i'));
const out = [];
for (const l of lines) {
  if (!l.trim()) continue;
  const k = l.split('\t')[0];
  if (pats.some((p) => p.test(k))) out.push(l);
}
console.log(out.join('\n'));
console.error('matched=' + out.length);
