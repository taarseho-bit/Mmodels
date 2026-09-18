/**
 * 从原版打包产物中提取「可读情报」：
 *   1. 所有中文字符串（界面文案、提示词、错误信息）
 *   2. 所有 IPC 通道名（形如 'xxx:yyy'）
 *   3. 长文本块（可能是提示词）
 *
 * main/index.js 是 javascript-obfuscator 处理过的（字符串数组打散），
 * 所以先从 preload（未混淆）和 renderer chunk 里拿，main 单独处理。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'D:\\softreg-源码\\.unpack\\app-asar\\out';
const OUTDIR = 'D:\\softreg-源码\\.unpack\\_extract';
fs.mkdirSync(OUTDIR, { recursive: true });

/** 递归收集文件 */
function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const files = [
  ...walk(path.join(ROOT, 'preload')),
  ...walk(path.join(ROOT, 'renderer', 'assets')).filter((f) => f.endsWith('.js')),
  path.join(ROOT, 'main', 'index.js'),
].filter((f) => fs.existsSync(f));

const log = [];
log.push(`扫描 ${files.length} 个文件`);

const allChinese = new Map(); // 中文串 -> Set<file>
const allChannels = new Map(); // 通道名 -> Set<file>
const longStrings = []; // {file, len, text}

function add(map, key, file) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(path.basename(file));
}

for (const f of files) {
  let src;
  try {
    src = fs.readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  const base = path.relative(ROOT, f);

  // 1) 字符串字面量（单/双/反引号）
  const litRe = /(['"`])((?:\\.|(?!\1)[^\\]){2,2000})\1/g;
  let m;
  while ((m = litRe.exec(src))) {
    const s = m[2];
    // 含中文
    if (/[\u4e00-\u9fff]/.test(s)) {
      // 转义还原（\n \t \" 等）
      const clean = s
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, '\\');
      if (clean.length <= 1200) add(allChinese, clean, base);
    }
    // IPC 通道名形态：小写字母+冒号
    if (/^[a-z][a-z0-9-]*(:[a-z0-9-]+)+$/.test(s)) add(allChannels, s, base);
    // 长文本（疑似提示词）：含中文且长度 > 200
    if (s.length > 200 && /[\u4e00-\u9fff]/.test(s)) {
      longStrings.push({ file: base, len: s.length, text: s });
    }
  }
}

log.push(`中文串 ${allChinese.size} 条`);
log.push(`通道名 ${allChannels.size} 条`);
log.push(`长文本块 ${longStrings.length} 条`);

// ── 输出 1：中文串清单（按长度降序，长的更像提示词）──
const zhLines = [...allChinese.keys()].sort((a, b) => b.length - a.length);
fs.writeFileSync(
  path.join(OUTDIR, 'chinese-strings.txt'),
  zhLines.map((s) => `${String(s.length).padStart(5)}  ${JSON.stringify(s)}`).join('\n'),
  'utf8',
);

// ── 输出 2：通道名 ──
const chLines = [...allChannels.keys()].sort();
fs.writeFileSync(path.join(OUTDIR, 'ipc-channels.txt'), chLines.join('\n'), 'utf8');

// ── 输出 3：长文本（疑似提示词）──
longStrings.sort((a, b) => b.len - a.len);
fs.writeFileSync(
  path.join(OUTDIR, 'long-texts.txt'),
  longStrings
    .slice(0, 400)
    .map((x) => `\n${'='.repeat(80)}\n[${x.file}] len=${x.len}\n${'-'.repeat(80)}\n${x.text}\n`)
    .join(''),
  'utf8',
);

// ── 输出 4：按文件统计中文串（看哪个文件文案最多）──
const byFile = new Map();
for (const [s, set] of allChinese) {
  for (const f of set) {
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(s);
  }
}
const statLines = [...byFile.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .map(([f, arr]) => `${String(arr.length).padStart(4)}  ${f}`);
fs.writeFileSync(path.join(OUTDIR, 'chinese-by-file.txt'), statLines.join('\n'), 'utf8');

fs.writeFileSync(path.join(OUTDIR, '_summary.txt'), log.join('\n'), 'utf8');
console.log('done');
