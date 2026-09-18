/**
 * 提取原版 Composer 全套情报 v2：
 *  A. 所有 composerXxx / composer:{ 词典子树（zh 优先）
 *  B. 关键组件 JSX 区域（minified 原样切片）
 */
const fs = require('node:fs');
const SRC = 'D:/softreg-源码/.unpack/app-asar/out/renderer/assets/index-OYc102qC.js';
const OUT = 'D:/mathmodel-desktop/.workbuddy/composer-intel';
fs.mkdirSync(OUT, { recursive: true });
const s = fs.readFileSync(SRC, 'utf8');

function extractBalanced(str, from) {
  let j = str.indexOf('{', from);
  if (j < 0) return null;
  let depth = 0, inStr = null;
  for (; j < str.length; j++) {
    const c = str[j];
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { start: from, end: j + 1 }; }
  }
  return null;
}

// A. 词典子树
const dictKeys = [
  'composer:{', 'composerAttachments:{', 'composerCommandMenu:{', 'composerGoalBar:{',
  'composerPendingApprovalPanel:{', 'composerPendingUserInputPanel:{',
  'composerPermissionPicker:{', 'composerPlusMenu:{', 'composerQueuedHeader:{',
  'composerTaskListCard:{', 'composerContextBar:{', 'environmentPanel:{',
  'paperSetupDialog:{', 'attach:{', 'composerModeMenu:{', 'composerModelPicker:{',
];
const dictOut = [];
for (const k of dictKeys) {
  let pos = 0;
  const found = [];
  while (true) {
    const i = s.indexOf(k, pos);
    if (i < 0) break;
    const seg = extractBalanced(s, i);
    if (!seg) break;
    found.push(s.slice(seg.start, seg.end));
    pos = seg.end;
  }
  for (const f of found) {
    const tag = /[\u4e00-\u9fff]/.test(f) ? 'zh' : 'en';
    if (tag === 'zh') { dictOut.push('// ' + k + '\n' + f); break; }
  }
  if (found.length === 0) dictOut.push('// ' + k + '  ==> NOT FOUND');
}
fs.writeFileSync(OUT + '/dicts-zh-all.txt', dictOut.join('\n\n'));
console.log('dicts extracted:', dictOut.length);

// B. JSX 区域切片（每个 testid 前后 3000 字符）
const regions = [
  ['composer-goal-bar', 877347],
  ['composer-goal-mode', 1633641],
  ['paper-setup-chip', 1654366],
  ['template-chip', 1654665],
  ['project-chip', 1661063],
  ['paper-setup-dialog', 1685420],
  ['permission-picker-dict', 654281],
  ['attach-dict', 647639],
];
for (const [name, pos] of regions) {
  const a = Math.max(0, pos - 2500), b = Math.min(s.length, pos + 5500);
  fs.writeFileSync(OUT + '/jsx-' + name + '.js', s.slice(a, b));
}
console.log('jsx regions written');

// C. 找主 Composer 组件：找 placeholderIdle 的 t() 用法
const uses = [];
let p = 0;
while (true) {
  const i = s.indexOf('placeholderIdle', p);
  if (i < 0) break;
  uses.push(i);
  p = i + 1;
}
console.log('placeholderIdle hits:', uses.join(','));
fs.writeFileSync(OUT + '/jsx-placeholder-idle.js',
  uses.map(u => s.slice(Math.max(0, u - 4000), u + 2500)).join('\n\n/*----*/\n\n'));
