/**
 * 功能差距审计：复刻版 ↔ 原版。
 *
 * ⚠️ 为什么要单独写这个脚本（而不是用 audit-features.cjs）：
 *   那个脚本用 **i18n 文案使用率** 推断功能是否实现，这个指标两个方向都会骗人：
 *
 *   ① 文案有 ≠ 功能有 —— 实测「算法市场」「Python 一键安装」「Claude Code 插件」
 *      在本项目里都只有 i18n 文案，**一行实现都没有**，
 *      但按文案口径会被算成"部分覆盖"。
 *   ② 文案没有 ≠ 功能没有 —— settings/automation/chat 三个命名空间按文案口径
 *      是 0%~3%（"疑似整块未做"），实际页面都在且是实心的，
 *      只是文案写成了硬编码中文。
 *
 *   所以本脚本一律**只看代码**：有没有实现文件、IPC 处理器、路由、preload 方法。
 *   并且在 grep 时**强制排除 i18n 词典文件** —— 这是最容易踩的坑。
 *
 * 用法：node scripts/audit-gap.cjs
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ORIG_PRELOAD = 'D:/softreg-源码/.unpack/app-asar/out/preload/index.mjs';

/** 递归收集源码文件，**排除 i18n 词典**（否则文案会被误当成实现） */
function sourceFiles(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'i18n') continue;
      sourceFiles(p, acc);
    } else if (/\.(ts|tsx)$/.test(name)) {
      acc.push(p);
    }
  }
  return acc;
}

const SRC_FILES = [
  ...sourceFiles(path.join(ROOT, 'src', 'main')),
  ...sourceFiles(path.join(ROOT, 'src', 'renderer', 'src')),
  ...sourceFiles(path.join(ROOT, 'src', 'preload')),
  ...sourceFiles(path.join(ROOT, 'src', 'shared')),
].filter((f) => !/i18n/.test(f));

const CORPUS = SRC_FILES.map((f) => ({ f, text: fs.readFileSync(f, 'utf8') }));

/** 在真实源码里找实现痕迹（已排除 i18n） */
function hits(pattern) {
  const re = new RegExp(pattern, 'i');
  const found = [];
  for (const { f, text } of CORPUS) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) found.push(path.relative(ROOT, f) + ':' + (i + 1));
    }
  }
  return found;
}

function ok(label, cond, note = '') {
  console.log((cond ? '  有  ' : '  缺  ') + label + (note ? '   ' + note : ''));
  return cond;
}

// ─────────────────────────────────────────────────────────────
// 1. API 面：原版 preload vs 本复刻 preload
// ─────────────────────────────────────────────────────────────

function originalApi() {
  if (!fs.existsSync(ORIG_PRELOAD)) return null;
  const s = fs.readFileSync(ORIG_PRELOAD, 'utf8');
  const i = s.indexOf('exposeInMainWorld("mathmodel"');
  if (i < 0) return null;
  const b = s.indexOf('{', i);
  let d = 0;
  let e = -1;
  for (let j = b; j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') {
      d--;
      if (d === 0) {
        e = j + 1;
        break;
      }
    }
  }
  const obj = s.slice(b, e);
  // ⚠️ 先把字符串字面量抹掉再提取键名。
  //    否则 `i.invoke("mathmodel:auth-credits")` 里的 `mathmodel:` 会被
  //    当成一个方法名，结果 auth 的方法列表里混进一堆 "mathmodel"。
  const noStr = obj.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');

  // 只取 depth === 1 的键（真正的顶层），否则会把嵌套方法也算进"顶层键"
  const keys = new Set();
  {
    let d = 0;
    let i2 = 0;
    while (i2 < noStr.length) {
      const c = noStr[i2];
      if (c === '{' || c === '(' || c === '[') d++;
      else if (c === '}' || c === ')' || c === ']') d--;
      else if (d === 1) {
        const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(noStr.slice(i2, i2 + 64));
        if (m) {
          keys.add(m[1]);
          i2 += m[0].length;
          continue;
        }
      }
      i2++;
    }
  }

  // 嵌套命名空间的子方法
  const nested = {};
  for (const ns of ['update', 'browser', 'notifications', 'auth']) {
    const mi = noStr.indexOf(ns + ':{');
    if (mi < 0) continue;
    let d2 = 0;
    let end2 = -1;
    const sb = noStr.indexOf('{', mi);
    for (let j = sb; j < noStr.length; j++) {
      if (noStr[j] === '{') d2++;
      else if (noStr[j] === '}') {
        d2--;
        if (d2 === 0) {
          end2 = j + 1;
          break;
        }
      }
    }
    const body = noStr.slice(sb, end2);
    nested[ns] = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]);
  }
  return { keys, nested, raw: obj };
}

console.log('════════ 1. API 面对照 ════════');
const orig = originalApi();
if (!orig) {
  console.log('  （找不到原版 preload，跳过）');
} else {
  console.log('  原版顶层键 ' + orig.keys.size + ' 个：' + [...orig.keys].sort().join(', '));
  console.log('');
  for (const [ns, methods] of Object.entries(orig.nested)) {
    console.log('  原版 ' + ns + ' 有 ' + methods.length + ' 个方法：' + methods.join(', '));
  }
}

// 本复刻 preload 顶层键
const minePreload = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'index.ts'), 'utf8');
const mineKeys = new Set(
  [...minePreload.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]),
);
console.log('');
console.log('  本复刻顶层键 ' + mineKeys.size + ' 个：' + [...mineKeys].sort().join(', '));

// ─────────────────────────────────────────────────────────────
// 2. 功能级差距（B 类）
// ─────────────────────────────────────────────────────────────

console.log('');
console.log('════════ 2. 功能级差距（只看代码实现，不看文案）════════');

const FEATURES = [
  // [标签, 判定模式, 原版表现, 备注]
  //
  // ⚠️ 判定模式要**同时覆盖两种命名风格**：
  //    原版用 camelCase 的 API 名（saveBinaryFile），
  //    本项目用 IPC 常量 kebab-case（'file:save-binary'）。
  //    只写一种会误报成"缺失"——本脚本最初就把 saveBinaryFile 判成了缺，
  //    实际早就有 file:save-binary。
  ['自动更新（electron-updater 真实调用）', 'from\\s+[\'"]electron-updater|autoUpdater\\.', '原版 6 方法 + update-check/download'],
  ['浏览器：DevTools', 'openDevTools', '原版有'],
  ['浏览器：面板拖拽调整尺寸', 'setPanelBounds|browser-set-bounds', '原版有（架构不同，见 C 类）'],
  ['桌面能力 saveBinaryFile', 'saveBinaryFile|save-binary|FILE_SAVE_BINARY', '原版有'],
  ['桌面能力 openTextFile（打开外部文件）', 'openTextFile|open-text-file|FILE_OPEN_TEXT', '原版有'],
  ['桌面能力 saveShareImage（保存分享图）', 'saveShareImage|save-share-image', '原版有'],
  ['系统通知', 'new\\s+Notification\\(|notifications-is-supported|NOTIFICATIONS_SHOW', '原版有'],
  ['算法市场 / 算法目录', 'algorithmCatalog|algorithm-catalog|/api/algorithms', '原版有（含安装状态机）'],
  ['Python 一键安装', 'installPython|install-python', '原版有'],
  ['环境一键修复 UI（让 Agent 配置）', 'configureWithAgent|copyInstallCommand|让 Agent 配置', '原版有独立面板'],
  ['飞书集成', 'feishu|Feishu|Lark', '原版有客户端 + 绑定表'],
  ['企业微信集成', 'wecom|wechat|企微|企业微信', '原版有绑定表'],
  ['快捷键自定义', 'keybinding|Keybinding', '原版有 /api/keybindings'],
  ['英文界面', "i18n/en|en-US.*translation|locales?/en\\.ts", '原版 en + zh-CN'],
  ['更新日志 whatsnew', 'whatsnew|WhatsNew', '原版有'],
  ['MCP 服务器管理（增删改）', 'mcpServers\\s*[:=]\\s*\\[|upsertMcp|addMcpServer|MCP_UPSERT', '原版 /api/mcp'],
  ['用量统计', 'provider-usage|oauth/usage|usageStats', '原版有'],
];

// 渲染层已实现的能力（原版在主进程做，本项目在渲染层用 webview 做 —— 功能等价）
console.log('');
console.log('  ── 浏览器面板（本项目在渲染层用 <webview> 实现，不走 preload 通道）──');
const BROWSER_UI = [
  ['多标签', 'addTab|closeTab'],
  ['前进 / 后退', 'goBack|goForward'],
  ['刷新 / 停止', 'reload\\(\\)|\\.stop\\(\\)'],
  ['复制链接', 'copyLink'],
  ['截图到剪贴板', 'copyScreenshot|capture'],
];
const browserPanel = path.join(ROOT, 'src', 'renderer', 'src', 'components', 'BrowserPanel.tsx');
const bpText = fs.existsSync(browserPanel) ? fs.readFileSync(browserPanel, 'utf8') : '';
for (const [label, pattern] of BROWSER_UI) {
  const has = new RegExp(pattern, 'i').test(bpText);
  console.log('  ' + (has ? '有  ' : '缺  ') + label);
}

let missing = 0;
for (const [label, pattern, origNote] of FEATURES) {
  const found = hits(pattern);
  const present = found.length > 0;
  if (!present) missing++;
  console.log(
    (present ? '  有  ' : '  缺  ') +
      label.padEnd(34) +
      (present ? '(' + found.length + ' 处)' : '（原版：' + origNote + '）'),
  );
}

// ─────────────────────────────────────────────────────────────
// 3. 已具备的对照项（确认没有被漏掉）
// ─────────────────────────────────────────────────────────────

console.log('');
console.log('════════ 3. 已具备（抽样确认）════════');
for (const [label, pattern] of [
  ['桌面能力 selectDirectory', 'selectDirectory'],
  ['桌面能力 getPathForFile', 'getPathForFile'],
  ['桌面能力 showItemInFolder', 'showItemInFolder'],
  ['桌面能力 openPath', 'openPath'],
  ['桌面能力 setNativeTheme', 'setNativeTheme'],
  ['桌面能力 saveTextFile', 'saveTextFile|save-text|FILE_SAVE_TEXT'],
  ['环境检测', 'checkEnvironment'],
  ['默认项目播种', 'bootstrapDefaultProject'],
  ['git 层', 'src/main/git|gitExec|execFileSync'],
  ['终端 / PTY', 'node-pty|pty\\.spawn'],
]) {
  const found = hits(pattern);
  ok(label.padEnd(34), found.length > 0, found.length ? '(' + found.length + ' 处)' : '');
}

// ─────────────────────────────────────────────────────────────
// 4. 文案未 i18n 化（D 类）
// ─────────────────────────────────────────────────────────────

console.log('');
console.log('════════ 4. 硬编码中文（D 类，不影响功能）════════');
let hardcoded = 0;
const byFile = [];
for (const { f, text } of CORPUS) {
  const n = text
    .split('\n')
    .filter(
      (l) =>
        /[\u4e00-\u9fa5]/.test(l) &&
        !/^\s*(\/\/|\*|\/\*)/.test(l) &&
        !/tx\(/.test(l) &&
        !/^\s*\*/.test(l),
    ).length;
  if (n > 3) byFile.push({ f: path.relative(ROOT, f), n });
  hardcoded += n;
}
byFile.sort((a, b) => b.n - a.n);
console.log('  合计约 ' + hardcoded + ' 行，涉及 ' + byFile.length + ' 个文件（已排除 i18n 与注释）');
for (const x of byFile.slice(0, 8)) console.log('    ' + String(x.n).padStart(4) + '  ' + x.f);

console.log('');
console.log('════════ 汇总 ════════');
console.log('  功能缺失 ' + missing + ' 项 / 共检查 ' + FEATURES.length + ' 项');
console.log('  （账号/计费/协作按需求排除，未计入）');
