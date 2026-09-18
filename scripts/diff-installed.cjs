/**
 * 原版安装目录 vs 复刻打包产物：逐文件对比。
 * 找出「原版有、复刻没有」以及体积差异大的项。
 */
const fs = require('node:fs');
const path = require('node:path');

const ORIG = require('./installed-baseline.cjs').requireBaseline();
const MINE = 'D:/mathmodel-desktop/dist/win-unpacked';

/** 递归收集 {relPath -> size} */
function walk(root, dir = '', out = new Map()) {
  const abs = path.join(root, dir);
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    const full = path.join(root, rel);
    if (e.isDirectory()) {
      walk(root, rel, out);
    } else {
      try {
        out.set(rel, fs.statSync(full).size);
      } catch {
        /* 读不到跳过 */
      }
    }
  }
  return out;
}

const a = walk(ORIG);
const b = walk(MINE);

const mb = (n) => (n / 1048576).toFixed(1);
const lines = [];
lines.push(`原版文件数 ${a.size}，复刻文件数 ${b.size}`);
lines.push('');

// ── 1. 原版有、复刻没有 ──
const onlyOrig = [...a.keys()].filter((k) => !b.has(k));
const onlyOrigBig = onlyOrig
  .map((k) => ({ k, s: a.get(k) }))
  .sort((x, y) => y.s - x.s);
lines.push(`════ 原版有、复刻没有（${onlyOrig.length} 个）════`);
for (const { k, s } of onlyOrigBig.slice(0, 40)) {
  lines.push(`  ${String(mb(s)).padStart(8)} MB  ${k}`);
}
if (onlyOrigBig.length > 40) lines.push(`  …还有 ${onlyOrigBig.length - 40} 个`);
lines.push('');

// ── 2. 复刻有、原版没有 ──
const onlyMine = [...b.keys()].filter((k) => !a.has(k));
const onlyMineBig = onlyMine
  .map((k) => ({ k, s: b.get(k) }))
  .sort((x, y) => y.s - x.s);
lines.push(`════ 复刻有、原版没有（${onlyMine.length} 个）════`);
for (const { k, s } of onlyMineBig.slice(0, 25)) {
  lines.push(`  ${String(mb(s)).padStart(8)} MB  ${k}`);
}
if (onlyMineBig.length > 25) lines.push(`  …还有 ${onlyMineBig.length - 25} 个`);
lines.push('');

// ── 3. 两边都有但体积差 >20%（或 >50KB）──
const diffs = [];
for (const [k, sa] of a) {
  if (!b.has(k)) continue;
  const sb = b.get(k);
  if (sa === sb) continue;
  const ratio = sb === 0 ? Infinity : sa / sb;
  if (Math.abs(sa - sb) > 50 * 1024 && (ratio > 1.2 || ratio < 0.8)) {
    diffs.push({ k, sa, sb });
  }
}
diffs.sort((x, y) => Math.abs(y.sa - y.sb) - Math.abs(x.sa - x.sb));
lines.push(`════ 体积差异较大（${diffs.length} 个）════`);
for (const { k, sa, sb } of diffs.slice(0, 30)) {
  lines.push(`  原版 ${String(mb(sa)).padStart(8)} MB  复刻 ${String(mb(sb)).padStart(8)} MB   ${k}`);
}
lines.push('');

// ── 4. 总体 ──
const sum = (m) => [...m.values()].reduce((x, y) => x + y, 0);
lines.push(`原版总体积 ${mb(sum(a))} MB，复刻总体积 ${mb(sum(b))} MB`);

fs.writeFileSync('D:/mathmodel-desktop/out/orig-vs-mine.txt', lines.join('\n'), 'utf8');
console.log(lines.slice(0, 60).join('\n'));
