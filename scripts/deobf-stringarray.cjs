/**
 * 从 main/index.js 里还原被 rc4 混淆的字符串表。
 *
 * javascript-obfuscator 的 rc4 模式结构：
 *   - 字符串数组 _0x4ff1e4 = [密文1, 密文2, ...]
 *   - 解码器函数 _0x????(str, key)
 *   - 取用函数 _0x627a(idx, key?)
 *
 * 做法：不重写整个混淆器 —— 而是在沙箱里把**数组和解码器**抠出来执行，
 * 然后遍历所有下标，把明文全部 dump 出来。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MAIN = 'D:\\softreg-源码\\.unpack\\app-asar\\out\\main\\index.js';
const OUTDIR = 'D:\\softreg-源码\\.unpack\\_extract';
fs.mkdirSync(OUTDIR, { recursive: true });

const src = fs.readFileSync(MAIN, 'utf8');
const log = [];

// ── 1) 定位字符串数组 ──
const arrRe = /(?:var|const|let)\s+(_0x[0-9a-fA-F]+)\s*=\s*\[((?:'[^']*'|"[^"]*"|,|\s){500,})\]/;
const am = src.match(arrRe);
if (!am) {
  log.push('❌ 未找到字符串数组');
  fs.writeFileSync(path.join(OUTDIR, '_deobf-log.txt'), log.join('\n'), 'utf8');
  process.exit(1);
}
const arrName = am[1];
log.push(`字符串数组名 = ${arrName}`);

// ── 2) 找解码器函数：形如 function _0xabc(_0x1, _0x2) { ... } ──
// javascript-obfuscator 的解码器首行通常是 var _0x..=...；return _0x..(str,key)
const decRe =
  /function\s+(_0x[0-9a-fA-F]+)\s*\(\s*(_0x[0-9a-fA-F]+)\s*,\s*(_0x[0-9a-fA-F]+)\s*\)\s*\{/g;
const decoders = [];
let dm;
while ((dm = decRe.exec(src))) decoders.push({ name: dm[1], a: dm[2], b: dm[3], idx: dm.index });
log.push(`找到 ${decoders.length} 个双参函数候选`);

// ── 3) 最稳的做法：把「数组 + 所有顶层函数」放进 VM，逐个试解码 ──
// 只取数组声明 + 疑似解码器函数体
function extractFunctionBody(src, startIdx, name) {
  // 从 startIdx 的花括号开始配平
  let i = src.indexOf('{', startIdx);
  if (i < 0) return null;
  let depth = 0;
  const begin = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(startIdx, i + 1);
    }
  }
  return null;
}

const snippets = [am[0]]; // 数组声明
for (const d of decoders) {
  const body = extractFunctionBody(src, d.idx, d.name);
  if (body) snippets.push(body);
}
log.push(`收集 ${snippets.length} 段代码进 VM`);

// 另外把可能用到的辅助函数（rotl 之类）也带上：搜索同名字符串
const helpers = src.match(/function\s+_0x[0-9a-fA-F]+\s*\([^)]*\)\s*\{[\s\S]{0,900}?\n\}/g) || [];
log.push(`额外候选函数 ${helpers.length} 个`);

const code = [...snippets, ...helpers].join('\n');
let ctx = {};
try {
  vm.createContext(ctx);
  vm.runInContext(code + `\n;globalThis.__ARR=${arrName};`, ctx, { timeout: 20000 });
  log.push('✅ VM 执行成功，数组已就位');
} catch (e) {
  log.push('❌ VM 执行失败: ' + e.message);
  // 退一步：只放数组
  try {
    const ctx2 = {};
    vm.createContext(ctx2);
    vm.runInContext(am[0] + `\n;globalThis.__ARR=${arrName};`, ctx2, { timeout: 20000 });
    ctx = ctx2;
    log.push('（降级：仅数组）');
  } catch (e2) {
    log.push('❌ 连数组都放不进 VM: ' + e2.message);
    fs.writeFileSync(path.join(OUTDIR, '_deobf-log.txt'), log.join('\n'), 'utf8');
    process.exit(1);
  }
}

const arr = ctx.__ARR;
log.push(`数组长度 = ${arr && arr.length}`);

// ── 4) 找出真正能把密文解成中文的解码函数 ──
const fnNames = Object.keys(ctx).filter(
  (k) => typeof ctx[k] === 'function' && /^_0x/.test(k),
);
log.push(`VM 里的函数: ${fnNames.join(', ') || '(无)'}`);

let best = null;
for (const fn of fnNames) {
  let hits = 0;
  let sample = null;
  for (let i = 0; i < Math.min(arr.length, 300); i++) {
    try {
      const out = ctx[fn](arr[i]);
      if (typeof out === 'string' && /[\u4e00-\u9fff]/.test(out)) {
        hits++;
        if (!sample) sample = out.slice(0, 120);
      }
    } catch {
      /* 忽略 */
    }
  }
  log.push(`  ${fn}: 前300项解出中文 ${hits} 条${sample ? ' | 例: ' + JSON.stringify(sample) : ''}`);
  if (hits > 0 && (!best || hits > best.hits)) best = { fn, hits };
}

if (!best) {
  // 可能解码器需要第二个参数（key）。尝试带 key 调用
  log.push('单参调用无中文 —— 尝试各种二参组合…');
  for (const fn of fnNames) {
    for (const key of [0x0, 0x1, 0x2, 0x3, 0x4, 0x5, 0x6]) {
      try {
        const out = ctx[fn](arr[0], key);
        if (typeof out === 'string' && /[\u4e00-\u9fff]/.test(out)) {
          log.push(`  ${fn}(arr[0], ${key}) => ${JSON.stringify(out.slice(0, 80))}`);
          best = { fn, key };
          break;
        }
      } catch {
        /* 忽略 */
      }
    }
    if (best) break;
  }
}

if (best) {
  log.push(`✅ 解码器 = ${best.fn}${best.key !== undefined ? `, key=${best.key}` : ''}`);
  const decoded = [];
  for (let i = 0; i < arr.length; i++) {
    let out = null;
    try {
      out = best.key !== undefined ? ctx[best.fn](arr[i], best.key) : ctx[best.fn](arr[i]);
    } catch {
      out = null;
    }
    if (typeof out === 'string') decoded.push(out);
    else decoded.push(String(arr[i]));
  }
  fs.writeFileSync(
    path.join(OUTDIR, 'main-decoded-strings.txt'),
    decoded.map((s, i) => `${i}\t${JSON.stringify(s)}`).join('\n'),
    'utf8',
  );
  const zh = decoded.filter((s) => /[\u4e00-\u9fff]/.test(s));
  log.push(`解出 ${decoded.length} 条，其中含中文 ${zh.length} 条`);
  log.push('已写 main-decoded-strings.txt');
} else {
  log.push('⚠️ 未找到可用解码器，需要人工分析');
}

fs.writeFileSync(path.join(OUTDIR, '_deobf-log.txt'), log.join('\n'), 'utf8');
console.log('done');
