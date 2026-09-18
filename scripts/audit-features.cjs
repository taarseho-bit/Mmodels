/**
 * 功能缺口审计：找出「原版有、复刻基本没用到」的文案命名空间。
 *
 * 思路：把原版字典按命名空间聚合，再看复刻源码里引用了该命名空间的多少条键。
 * 引用率极低的大命名空间 = 很可能整块功能没做。
 *
 * 用法：node scripts/audit-features.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'D:/mathmodel-desktop';
const SRC = path.join(ROOT, 'src');
const DICT = 'D:/softreg-源码/.unpack/_extract/i18n-zh-full.txt';

/** 递归收集源码 */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// 1) 汇总源码里引用的键
const used = new Set();
for (const f of walk(SRC)) {
  const code = fs
    .readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const m of code.matchAll(/\btx\(\s*'([a-zA-Z][\w.]*)'/g)) used.add(m[1]);
  for (const m of code.matchAll(/\btx\(\s*`([a-zA-Z][\w.]*\.)\$\{/g)) {
    used.add(m[1] + '*');
  }
}

// 2) 按命名空间聚合原版字典
const dict = fs.readFileSync(DICT, 'utf8').split('\n').filter(Boolean);
const ns = new Map(); // ns -> {total, hit}
for (const line of dict) {
  const key = line.split('\t')[0];
  const top = key.split('.')[0];
  if (!ns.has(top)) ns.set(top, { total: 0, hit: 0 });
  const rec = ns.get(top);
  rec.total++;
  // 该键或它的前缀被引用即算命中
  const parts = key.split('.');
  let hit = false;
  for (let i = 1; i <= parts.length; i++) {
    const cand = parts.slice(0, i).join('.');
    if (used.has(cand)) { hit = true; break; }
    if (used.has(cand + '.')) { hit = true; break; }   // 模板拼接前缀
  }
  if (hit) rec.hit++;
}

const rows = [...ns.entries()]
  .map(([k, v]) => ({ ns: k, ...v, rate: v.total ? v.hit / v.total : 0 }))
  .sort((a, b) => b.total - a.total);

console.log('命名空间                 原版键数  已用  覆盖率');
console.log('-'.repeat(52));
for (const r of rows.slice(0, 30)) {
  const flag = r.total >= 15 && r.rate < 0.25 ? '  ← 疑似整块未做' : '';
  console.log(
    r.ns.padEnd(24) + String(r.total).padStart(7) + String(r.hit).padStart(7) +
      ('  ' + (r.rate * 100).toFixed(0) + '%').padStart(7) + flag,
  );
}

const suspects = rows.filter((r) => r.total >= 15 && r.rate < 0.25);
console.log('');
console.log(`疑似未实现（≥15 键且覆盖率 <25%）：${suspects.length} 个`);
for (const s of suspects) console.log(`  ${s.ns}  （${s.total} 键，仅用 ${s.hit}）`);
