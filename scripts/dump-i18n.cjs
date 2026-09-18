// 原版把界面文案集中放在主 chunk 的 i18n 字典里（形如 `key:"中文"`）。
// 这里把所有「属性名 + 中文值」抽成对照表，供逐页复刻。
const fs = require('fs');
const D = 'D:/softreg-源码/.unpack/app-asar/out/renderer/assets';
const OUT = 'D:/softreg-源码/.unpack/_extract';

const rows = [];
for (const f of fs.readdirSync(D).filter((n) => n.endsWith('.js'))) {
  const s = fs.readFileSync(D + '/' + f, 'utf8');
  // key:"值" 或 key:'值' 或 key:`值`
  const re = /([A-Za-z_$][\w$]*)\s*:\s*(["'`])((?:\\.|(?!\2)[^\\])*?)\2/g;
  let m;
  while ((m = re.exec(s))) {
    const key = m[1], val = m[3];
    if (/[\u4e00-\u9fff]/.test(val)) rows.push({ f, key, val });
  }
}

// 按 key 去重（同一 key 的中文应唯一）
const byKey = new Map();
for (const r of rows) if (!byKey.has(r.key)) byKey.set(r.key, r);

const lines = [...byKey.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([k, r]) => `${k}\t${r.val.replace(/\n/g, '\\n')}`);
fs.writeFileSync(OUT + '/i18n-zh-by-key.txt', lines.join('\n'));

// 再按 chunk 分组，便于看某页用了哪些 key
const byFile = new Map();
for (const r of rows) {
  if (!byFile.has(r.f)) byFile.set(r.f, new Map());
  byFile.get(r.f).set(r.key, r.val);
}
const grouped = [];
for (const [f, map] of [...byFile.entries()].sort()) {
  grouped.push(`##### ${f}  (${map.size} keys)`);
  for (const [k, v] of [...map.entries()].sort()) grouped.push(`${k}\t${v.replace(/\n/g, '\\n')}`);
  grouped.push('');
}
fs.writeFileSync(OUT + '/i18n-zh-by-file.txt', grouped.join('\n'));

console.log('uniqueKeys=' + byKey.size, 'rows=' + rows.length, 'files=' + byFile.size);
