// 还原原版主进程包里的混淆字符串表，供逆向取证使用
const fs = require('fs');
const path = require('path');

const target = process.argv[2];
const src = fs.readFileSync(target, 'utf8');

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
if (headEnd < 0) throw new Error('找不到数组旋转 IIFE');
const head = src.slice(0, src.indexOf('));', headEnd) + 3);

const arrFnStart = src.indexOf('function _0x4e7d(');
const arrFn = sliceFn(arrFnStart);
const accStart = src.indexOf('function _0x627a(');
const accFn = sliceFn(accStart);

const code = head + '\n' + arrFn + '\n' + accFn + '\nmodule.exports={acc:_0x627a};';
const tmp = path.join(__dirname, '__strings.tmp.cjs');
fs.writeFileSync(tmp, code, 'utf8');

const { acc } = require(tmp);
const out = {};
for (const idx of process.argv.slice(3)) {
  const n = Number(idx);
  try { out[idx] = acc(n); } catch (e) { out[idx] = '<ERR ' + e.message + '>'; }
}
console.log(JSON.stringify(out, null, 2));
