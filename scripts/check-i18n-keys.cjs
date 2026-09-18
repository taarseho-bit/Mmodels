/**
 * 校验源码里 tx('...') 引用的文案键是否都真实存在。
 *
 * 这套复刻的规矩是「文案一律取自原版字典」，
 * 一旦键名打错，`tx()` 会**静默返回键名本身**（界面直接显示 `composer.xxx.yyy`），
 * 而且类型检查抓不到（tx 收的是 string）。所以需要这道确定性检查。
 *
 * 用法：node scripts/check-i18n-keys.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'D:/mathmodel-desktop';
const SRC = path.join(ROOT, 'src');
const DICT = 'D:/softreg-源码/.unpack/_extract/i18n-zh-full.txt';

/** 字典里全部可用的键 */
const available = new Set(
  fs.readFileSync(DICT, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')[0]),
);

/** 递归收集源码文件 */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const missing = [];
const used = new Set();
let scanned = 0;

for (const f of walk(SRC)) {
  const src = fs.readFileSync(f, 'utf8');
  scanned++;
  // 去掉注释，避免把注释里的示例键也算进来
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // 静态键：tx('a.b.c')
  for (const m of code.matchAll(/\btx\(\s*'([a-zA-Z][\w.]*)'/g)) {
    used.add(m[1]);
    if (!available.has(m[1])) {
      missing.push({ file: path.relative(ROOT, f), key: m[1], kind: '静态' });
    }
  }

  // 模板拼接键：tx(`a.b.${x}`) —— 只能校验前缀是否存在同族键
  for (const m of code.matchAll(/\btx\(\s*`([a-zA-Z][\w.]*\.)\$\{/g)) {
    const prefix = m[1];
    const hasFamily = [...available].some((k) => k.startsWith(prefix));
    used.add(prefix + '*');
    if (!hasFamily) {
      missing.push({ file: path.relative(ROOT, f), key: prefix + '${…}', kind: '拼接前缀' });
    }
  }
}

const lines = [];
lines.push(`扫描 ${scanned} 个源文件，引用 ${used.size} 个文案键`);
lines.push('');
if (missing.length === 0) {
  lines.push('✅ 全部命中原版字典');
} else {
  lines.push(`❌ 有 ${missing.length} 个键在字典里不存在：`);
  for (const m of missing) lines.push(`  ${m.key}   ← ${m.file}  (${m.kind})`);
}
fs.writeFileSync(path.join(ROOT, 'out', 'i18n-key-check.txt'), lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
process.exit(missing.length === 0 ? 0 : 1);
