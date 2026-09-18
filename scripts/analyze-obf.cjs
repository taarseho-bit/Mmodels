/**
 * 分析 main/index.js 的混淆结构，判断字符串能否还原。
 *
 * javascript-obfuscator 的 string-array-v1 模式：
 *   顶部有一个大数组 _0x1234 = ['str1','str2',...]
 *   代码里用 _0x1234[0x1f] 取值，可能还有 base64/rc4 解码函数包裹。
 *
 * 策略：找出字符串数组，统计其中有多少中文串 —— 那才是提示词所在。
 */
const fs = require('node:fs');
const path = require('node:path');

const MAIN = 'D:\\softreg-源码\\.unpack\\app-asar\\out\\main\\index.js';
const OUTDIR = 'D:\\softreg-源码\\.unpack\\_extract';
fs.mkdirSync(OUTDIR, { recursive: true });

const src = fs.readFileSync(MAIN, 'utf8');
const log = [];
log.push(`main/index.js 长度 = ${src.length}`);
log.push(`行数 = ${(src.match(/\n/g) || []).length + 1}`);

// ── 1) 找候选字符串数组声明 ──
// 形态：var _0xabc = ['a','b',...] 或 const _0xabc=['a',...]
const arrRe = /(?:var|const|let)\s+(_0x[0-9a-fA-F]+)\s*=\s*\[((?:'[^']*'|"[^"]*"|,|\s){500,})\]/g;
const arrays = [];
let m;
while ((m = arrRe.exec(src))) {
  const name = m[1];
  const body = m[2];
  const items = body.match(/'[^']*'|"[^"]*"/g) || [];
  arrays.push({ name, count: items.length, start: m.index, items });
}
log.push(`找到 ${arrays.length} 个候选大数组`);
for (const a of arrays) {
  const zh = a.items.filter((s) => /[\u4e00-\u9fff]/.test(s));
  log.push(`  ${a.name}: ${a.count} 项, 其中含中文 ${zh.length} 项`);
}

// ── 2) base64 解码函数探测 ──
const hasAtob = /atob|Buffer\.from\([^)]*,\s*['"]base64['"]\)/.test(src);
const hasRc4 = /_0x[0-9a-fA-F]+\s*\(\s*_0x[0-9a-fA-F]+\s*,\s*0x/.test(src);
log.push(`含 base64 解码迹象: ${hasAtob}`);
log.push(`含疑似 rc4 解码调用: ${hasRc4}`);

// ── 3) 把所有单/双引号串都 dump 出来，看中文密度 ──
const lits = src.match(/'[^'\\]*'|"[^"\\]*"/g) || [];
const zhLits = lits.filter((s) => /[\u4e00-\u9fff]/.test(s));
log.push(`裸字符串字面量 ${lits.length} 个，其中含中文 ${zhLits.length} 个`);

// ── 4) 找出所有含中文的行，看它们长什么样 ──
const zhLines = [];
const lines = src.split('\n');
lines.forEach((l, i) => {
  if (/[\u4e00-\u9fff]/.test(l)) {
    zhLines.push({ line: i + 1, len: l.length, text: l.slice(0, 300) });
  }
});
log.push(`含中文的行数 = ${zhLines.length}`);

fs.writeFileSync(
  path.join(OUTDIR, '_main-obf-analysis.txt'),
  log.join('\n'),
  'utf8',
);

// 把含中文的行单独输出（可能藏着明文提示词）
fs.writeFileSync(
  path.join(OUTDIR, 'main-chinese-lines.txt'),
  zhLines.map((x) => `L${x.line} (len=${x.len})\n${x.text}\n`).join('\n'),
  'utf8',
);

// 把大数组的内容全部 dump（如果是明文的话）
if (arrays.length) {
  const biggest = arrays.sort((a, b) => b.count - a.count)[0];
  fs.writeFileSync(
    path.join(OUTDIR, 'main-string-array.txt'),
    biggest.items.map((s, i) => `${i}\t${s}`).join('\n'),
    'utf8',
  );
  log.push(`已 dump 最大数组 ${biggest.name} (${biggest.count} 项)`);
  fs.writeFileSync(path.join(OUTDIR, '_main-obf-analysis.txt'), log.join('\n'), 'utf8');
}

console.log('done');
