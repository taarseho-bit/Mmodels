// 生成 src/renderer/src/i18n/zh.ts —— 嵌套结构，与原始 resources 形状一致。
// 输入：i18n-zh-full.txt（2153 条点号路径 key，来自 15 个中文命名空间）
const fs = require('fs');

const SRC = 'D:/softreg-源码/.unpack/_extract/i18n-zh-full.txt';
const OUT = 'D:/mathmodel-desktop/src/renderer/src/i18n/zh.ts';

/** 整段排除的路径前缀（账号 / 计费 / 会员 / 用户菜单） */
const EXCLUDE_PREFIX = [
  'settings.userMenu.',
  'settings.redeemCodeDialog.',
  'settings.creditGift.',
  'dock.collabPanel.membership',
  // 注：integrations.weChatSection.*（微信机器人配置，30 条）曾被此处排除，
  // 因本项目已实现「机器人 → 微信」分区，现已恢复收录（见 zh.ts 同名块）。
  'papers.quota.',
  'papers.page.signIn',
  'papers.share.signInRequired',
  'chat.planAlert.',
  'chat.errorNotice.recharge',
  'chat.errorNotice.redeemCode',
];

/** 逐条排除（路径精确匹配） */
const EXCLUDE_EXACT = new Set([
  'composer.composer.creditEstimate',
  'composer.composer.creditEstimateTooltip',
  'composer.composer.desktopAccessTooltip',
  'composer.composer.desktopLifetime',
  'composer.composerGoalBar.status.usageLimited',
  'composer.environmentPanel.quotaWindow',
  'dock.collabPanel.autoApproveTasksHint',
  'dock.collabPanel.taskRequest',
  'onboarding.wizard.model.topUp',
  'settings.presetConnectDialog.consoleLink',
  'settings.providerConnection.hint',
  'settings.providerConnection.results.quota',
]);

const lines = fs.readFileSync(SRC, 'utf8').split('\n').filter(Boolean);
const kept = [];
let skipped = 0;
for (const l of lines) {
  const i = l.indexOf('\t');
  if (i < 0) continue;
  const key = l.slice(0, i);
  const val = l.slice(i + 1);
  if (EXCLUDE_PREFIX.some((p) => key.startsWith(p))) { skipped++; continue; }
  if (EXCLUDE_EXACT.has(key)) { skipped++; continue; }
  kept.push([key, val]);
}

// ── 构建嵌套 ──
const root = {};
for (const [dotted, val] of kept) {
  const parts = dotted.split('.');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = val;
}

const q = (s) =>
  "'" +
  String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t') +
  "'";

const isIdent = (k) => /^[A-Za-z_$][\w$]*$/.test(k);

function emit(node, indent) {
  const pad = ' '.repeat(indent);
  const out = [];
  for (const k of Object.keys(node)) {
    const v = node[k];
    const key = isIdent(k) ? k : q(k);
    if (typeof v === 'string') {
      out.push(`${pad}${key}: ${q(v)},`);
    } else {
      out.push(`${pad}${key}: {`);
      out.push(emit(v, indent + 2));
      out.push(`${pad}},`);
    }
  }
  return out.join('\n');
}

const ns = Object.keys(root);
const head = `/**
 * 界面文案字典 —— 逐字取自原版 MathModel 0.0.20 的 i18n 资源。
 *
 * 原版结构（从主 chunk 还原）：
 *   zse = { competitions, automation, chat, collabTeam, common, composer, dock,
 *           extensions, integrations, onboarding, papers, profile, settings,
 *           shell, whatsnew }
 *   jse = { en:{translation:...}, "zh-CN":{translation:zse} }
 * 即中文文案分散在 15 个命名空间，键拼成 \`papers.page.title\` 这类点号路径。
 *
 * 本文件收录 ${kept.length} 条（原 ${lines.length} 条），
 * **已排除 ${skipped} 条账号 / 计费 / 会员 / 扫码登录 / 用户菜单相关文案**
 * （用户既定要求：不复刻收费）。
 *
 * ⚠️ 文案保真的单一真相源。改动前请对照原版，
 *    或用 \`scripts/grep-i18n.cjs\` 检索 \`_extract/i18n-zh-full.txt\`。
 *
 * 注入方式与原版一致：i18next，默认语言 zh-CN，占位符语法 \`{{name}}\`。
 */

export const zh = {
${emit(root, 2)}
} as const;

export type Messages = typeof zh;
export default zh;
`;

fs.writeFileSync(OUT, head, 'utf8');
console.log(
  `kept=${kept.length} skipped=${skipped} namespaces=${ns.length} (${ns.join(', ')})`,
);
