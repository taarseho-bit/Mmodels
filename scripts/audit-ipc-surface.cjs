/**
 * 对照原版 preload 的 window.mathmodel API 面 与 本复刻的 preload。
 * 原版 preload 未混淆，可以直接解析。
 */
const fs = require('fs');
const path = require('path');

const ORIG = 'D:/softreg-源码/.unpack/app-asar/out/preload/index.mjs';
const MINE = path.join(__dirname, '..', 'src', 'preload', 'index.ts');

function bail(msg) {
  console.error(msg);
  process.exit(1);
}

const orig = fs.readFileSync(ORIG, 'utf8');

// ── 提取 exposeInMainWorld("mathmodel", { ... }) 的对象字面量 ──
const start = orig.indexOf('exposeInMainWorld("mathmodel"');
if (start < 0) bail('找不到 mathmodel 暴露点');
const braceAt = orig.indexOf('{', start);
let depth = 0;
let end = -1;
for (let i = braceAt; i < orig.length; i++) {
  const c = orig[i];
  if (c === '{') depth++;
  else if (c === '}') {
    depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
}
const obj = orig.slice(braceAt, end + 1);

// ── 收集所有 "mathmodel:xxx" IPC 通道 ──
const channels = new Set();
for (const m of orig.matchAll(/["'](mathmodel:[a-z0-9-]+)["']/g)) channels.add(m[1]);
for (const m of orig.matchAll(/["'](desktop:[a-z-]+)["']/g)) channels.add(m[1]);

// ── 顶层键（含嵌套一层）──
function topKeys(text) {
  const out = [];
  let d = 0;
  let i = 0;
  // 找到每个 depth===1 处的 `key:` 或 `key(` 或 `...spread`
  while (i < text.length) {
    const c = text[i];
    if (c === '{' || c === '(' || c === '[') d++;
    else if (c === '}' || c === ')' || c === ']') d--;
    else if (d === 1) {
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(text.slice(i, i + 60));
      if (m) {
        out.push(m[1]);
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return out;
}
const origKeys = topKeys(obj);

// ── 解析本复刻的 preload 顶层键 ──
const mine = fs.readFileSync(MINE, 'utf8');
const mineKeys = new Set();
for (const m of mine.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gm)) mineKeys.add(m[1]);
for (const m of mine.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*\(/gm)) mineKeys.add(m[1]);

const set = new Set(origKeys);
console.log('════ 原版 window.mathmodel 顶层键 (' + set.size + ') ════');
console.log([...set].sort().join(', '));
console.log('');
console.log('════ 本复刻 preload 顶层键 (' + mineKeys.size + ') ════');
console.log([...mineKeys].sort().join(', '));
console.log('');
console.log('════ 原版有、我没有 ════');
const missing = [...set].filter((k) => !mineKeys.has(k)).sort();
console.log(missing.length ? missing.join(', ') : '（无）');
console.log('');
console.log('════ 我有、原版没有 ════');
const extra = [...mineKeys].filter((k) => !set.has(k)).sort();
console.log(extra.length ? extra.join(', ') : '（无）');
console.log('');
console.log('════ 原版 IPC 通道全量 (' + channels.size + ') ════');
console.log([...channels].sort().join('\n'));

fs.writeFileSync(
  path.join(__dirname, '..', 'out', 'ipc-surface-original.txt'),
  [...channels].sort().join('\n'),
  'utf8',
);
console.log('');
console.log('（通道清单已写入 out/ipc-surface-original.txt）');
