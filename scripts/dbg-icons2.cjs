const fs = require('node:fs');
const D = 'D:/softreg-源码/.unpack/app-asar/out/renderer/assets';

// 找出所有形如 `X("icon-name", Y)` 的调用（lucide createLucideIcon 的签名）
const re = /\b([A-Za-z_$][\w$]*)\("([-a-z0-9]+)",\s*([A-Za-z_$][\w$]*)\)/g;

const all = new Map();
for (const f of fs.readdirSync(D).filter((x) => x.endsWith('.js'))) {
  const s = fs.readFileSync(D + '/' + f, 'utf8');
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(s))) {
    const [, , name, varName] = m;
    if (!all.has(name)) all.set(name, { file: f, varName });
  }
}

console.log('发现候选图标名 ' + all.size + ' 个');
const names = [...all.keys()].sort();
console.log(names.join(' '));
console.log();

// 统计这些名字里有多少能在同文件里找到对应的数组定义
let withData = 0;
const noData = [];
for (const [name, info] of all) {
  const s = fs.readFileSync(D + '/' + info.file, 'utf8');
  const r = new RegExp(`(?:const|var|let)\\s+${info.varName}\\s*=\\s*\\[`);
  if (r.test(s)) withData++;
  else noData.push(name);
}
console.log('能在同文件找到数组定义: ' + withData);
console.log('找不到定义: ' + noData.length + (noData.length ? ' → ' + noData.slice(0, 12).join(' ') : ''));
