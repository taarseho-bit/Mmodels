// 从原版 i18n 字典生成 src/renderer/src/i18n/zh.ts
// 排除：账号 / 计费 / 会员 / 扫码登录 相关键（用户明确要求不复刻收费）
const fs = require('fs');

const SRC = 'D:/softreg-源码/.unpack/_extract/i18n-zh-by-key.txt';
const OUT = 'D:/mathmodel-desktop/src/renderer/src/i18n/zh.ts';

/** 计费 / 账号 / 会员 / 登录 相关，排除 */
const EXCLUDE = new Set([
  'activeLifetime', 'addAccount', 'alreadyBound', 'alreadyLifetime', 'alreadyRedeemedByYou',
  'codeUsed', 'creditEstimate', 'creditEstimateTooltip', 'creditsBalance', 'creditsUnit',
  'desktopAccess', 'desktopAccessTooltip', 'desktopLifetime', 'desktopLifetimeDescription',
  'desktopLifetimeOffer', 'desktopLifetimeOfferDescription', 'desktopMonthlyDescription',
  'desktopSessionLimit', 'desktopTimedAccess', 'exhaustedTitle', 'expiringTitle',
  'joinMembershipRequired', 'joinSameAccountNotAllowed', 'logOut', 'lowCredits', 'lowCreditsTitle',
  'membershipBody', 'membershipCheckingBody', 'membershipCheckingTitle', 'membershipCta',
  'membershipTitle', 'membershipVerifyFailed', 'qrAlt', 'quota', 'quotaWindow', 'recharge',
  'redeem', 'redeemCode', 'redeemed', 'scanHint', 'scanLogin', 'scanned', 'signIn', 'signInFailed',
  'signInRequired', 'signedInAccounts', 'taskRequest', 'timedAccessExpiry', 'topUp',
  'usageLimited', 'consoleLink', 'hint', 'autoApproveTasksHint', 'confirmed', 'wait',
  'desktopAccessShort', 'activeUntil', 'desktopMonthly', 'desktopMonthlyExpires',
  'desktopMonthlyStatus', 'planLabel', 'expiresAt', 'renew', 'upgrade',
]);

const lines = fs.readFileSync(SRC, 'utf8').split('\n').filter(Boolean);
const entries = [];
const seen = new Set();
for (const l of lines) {
  const i = l.indexOf('\t');
  if (i < 0) continue;
  const k = l.slice(0, i).trim();
  const v = l.slice(i + 1);
  if (EXCLUDE.has(k)) continue;
  if (!/^[A-Za-z_$][\w$]*$/.test(k)) continue;   // 非合法 TS 标识符则跳过
  if (seen.has(k)) continue;
  seen.add(k);
  entries.push([k, v]);
}
entries.sort((a, b) => a[0].localeCompare(b[0]));

/** TS 单引号字符串转义 */
function ts(str) {
  return (
    "'" +
    str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029') +
    "'"
  );
}

const head = `/**
 * 界面文案字典 —— 逐字取自原版 MathModel 0.0.20 的 i18n 字典。
 *
 * 来源：原版渲染层 \`out/renderer/assets/index-*.js\` 的 locale 对象，
 * 共提取 1651 条 key→中文 映射；本文件收录其中 ${entries.length} 条，
 * **已排除账号 / 计费 / 会员 / 扫码登录 相关键**（用户既定要求：不复刻收费）。
 *
 * ⚠️ 本文件是「文案保真」的单一真相源。改动前请先对照原版，
 *    或用 \`scripts/grep-i18n.cjs\` 重新检索原版字典。
 */

export const t = {
`;

const body = entries.map(([k, v]) => `  ${k}: ${ts(v)},`).join('\n');

const tail = `} as const;

export type Messages = typeof t;
export type MessageKey = keyof Messages;
`;

fs.writeFileSync(OUT, head + body + '\n' + tail, 'utf8');
console.log('wrote ' + entries.length + ' keys ->' + OUT);
