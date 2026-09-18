// 把混淆字符串表整体 dump 成 JSONL，便于全文检索
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(process.argv[2], 'utf8');

function sliceFn(start) {
  let i = src.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced');
}
const headEnd = src.indexOf('}(_0x4e7d,');
const head = src.slice(0, src.indexOf('));', headEnd) + 3);
const arrFn = sliceFn(src.indexOf('function _0x4e7d('));
const accFn = sliceFn(src.indexOf('function _0x627a('));
const tmp = path.join(__dirname, '__strings.tmp.cjs');
fs.writeFileSync(tmp, head + '\n' + arrFn + '\n' + accFn + '\nmodule.exports={acc:_0x627a};', 'utf8');
const { acc } = require(tmp);

const out = [];
for (let n = 0x10a; n <= 0x1a00; n++) {
  try { out.push(n.toString(16) + '\t' + String(acc(n)).replace(/\t|\r?\n/g, ' ')); } catch { /* 越界忽略 */ }
}
fs.writeFileSync(path.join(__dirname, 'string-table.tsv'), out.join('\n'), 'utf8');
console.log('导出条数:', out.length);
