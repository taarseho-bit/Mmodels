/**
 * 提取原版 Composer 情报：
 *  1. composer.* i18n 全量子树（zh + en）
 *  2. Composer 相关组件函数（beautified）到单独文件
 */
const fs = require('node:fs');
const SRC = 'D:/softreg-源码/.unpack/app-asar/out/renderer/assets/index-OYc102qC.js';
const OUT = 'D:/mathmodel-desktop/.workbuddy/composer-intel';
fs.mkdirSync(OUT, { recursive: true });

const s = fs.readFileSync(SRC, 'utf8');

// --- 1. i18n 子树：找 "composerContextBar:{ ... }" 直到平衡大括号 ---
function extractObject(startKey) {
  const i = s.indexOf(startKey + ':{');
  if (i < 0) return null;
  let j = s.indexOf('{', i), depth = 0, inStr = null;
  for (; j < s.length; j++) {
    const c = s[j];
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(i, j + 1); }
  }
  return null;
}

for (const key of ['composerContextBar', 'composerPermissionPicker']) {
  // zh 版本：内容含中文；en 版本在前。两个都取
  let pos = 0, n = 0;
  while (true) {
    const seg = extractObjectFrom(s, key, pos);
    if (!seg) break;
    n++;
    const tag = /[\u4e00-\u9fff]/.test(seg.text) ? 'zh' : 'en';
    fs.writeFileSync(`${OUT}/i18n-${key}-${n}-${tag}.txt`, seg.text);
    pos = seg.end + 1;
  }
}

function extractObjectFrom(str, key, from) {
  const i = str.indexOf(key + ':{', from);
  if (i < 0) return null;
  let j = str.indexOf('{', i), depth = 0, inStr = null;
  for (; j < str.length; j++) {
    const c = str[j];
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { text: str.slice(i, j + 1), end: j }; }
  }
  return null;
}

// composer 整个父级（composer:{ ... } 含 modes 等）
{
  const i = s.indexOf('composer:{');
  if (i >= 0) {
    // 向前回溯找词典归属（zh 或 en），直接按平衡截取
    let j = s.indexOf('{', i), depth = 0, inStr = null;
    for (; j < s.length; j++) {
      const c = s[j];
      if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) {
        const seg = s.slice(i, j + 1);
        const tag = /[\u4e00-\u9fff]/.test(seg) ? 'zh' : 'en';
        fs.writeFileSync(`${OUT}/i18n-composer-whole-${tag}.txt`, seg);
        break;
      } }
    }
  }
}

// --- 2. Composer 组件区：围绕 data-testid 提取 beautified 片段 ---
const testids = [...new Set([...s.matchAll(/data-testid["']?\s*:\s*"([^"]+)"/g)].map(m => m[1]))]
  .filter(t => /composer|attach|permission|mode|template|workspace|send|paper/i.test(t));
fs.writeFileSync(`${OUT}/data-testids.txt`, testids.join('\n'));

console.log('testids:', testids.length, testids.join(', '));
console.log('written to', OUT);
