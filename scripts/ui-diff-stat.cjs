/**
 * 双开文本差异统计 —— 对比 .workbuddy/ui-audit/{original,replica}/<页名>.txt
 *
 * 输出每页：原版行数 / 复刻行数 / 仅原版有的行 / 仅复刻有的行 / 相似度
 * 用法：node scripts/ui-diff-stat.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'D:/mathmodel-desktop/.workbuddy/ui-audit';
const ORIG = path.join(ROOT, 'original');
const REP = path.join(ROOT, 'replica');

const PAGES = [
  '00-main', '01-figures', '02-square', '03-competitions', '04-automation', '05-extensions',
  '06-environment', '07-panel', '08-editorview', '09-share', '10-collab',
  '11-chat', '12-menu-project', '13-menu-mode', '14-menu-model', '15-menu-permission', '16-menu-plus',
  's00-profile', 's01-paper', 's02-chat', 's03-model', 's04-provider', 's05-env', 's06-network',
  's07-sysprompt', 's08-appearance', 's09-keys', 's10-notify', 's11-bots', 's12-tour', 's13-about',
];

/** 归一化：去空行、去首尾空白、去掉纯数字/计数类噪声行（会话数、体积等易变值） */
function norm(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^-?\d+(\.\d+)?\s*(MB|KB|GB|个|条|项|文件)?$/.test(l))
    .filter((l) => !/^(本地服务|:\d+)/.test(l));
}

function readLines(file) {
  if (!fs.existsSync(file)) return null;
  return norm(fs.readFileSync(file, 'utf8'));
}

const rows = [];
for (const page of PAGES) {
  const a = readLines(path.join(ORIG, page + '.txt'));
  const b = readLines(path.join(REP, page + '.txt'));
  if (!a || !b) {
    rows.push({ page, missing: !a ? (b ? '原版缺' : '两侧都缺') : '复刻缺' });
    continue;
  }
  const setA = new Set(a);
  const setB = new Set(b);
  const onlyA = a.filter((l) => !setB.has(l));
  const onlyB = b.filter((l) => !setA.has(l));
  const union = new Set([...a, ...b]).size || 1;
  const inter = new Set([...a].filter((l) => setB.has(l))).size;
  rows.push({
    page,
    nA: a.length,
    nB: b.length,
    onlyA: onlyA.length,
    onlyB: onlyB.length,
    sim: Math.round((inter / union) * 100),
    sampleOnlyA: onlyA.slice(0, 6),
    sampleOnlyB: onlyB.slice(0, 6),
  });
}

let out = '# 双开文本差异统计（自动生成）\n\n';
out += `生成时间：${new Date().toLocaleString('zh-CN')}\n\n`;
out += '说明：归一化后按「行集合」比较；`相似度 = 交集 / 并集`。相似度高≠界面一致（文案可能都对、布局仍不同），但**相似度低的页面一定还有大差异**，可作为收敛度指标。\n\n';
out += '| 页面 | 原版行 | 复刻行 | 仅原版 | 仅复刻 | 相似度 |\n|---|---|---|---|---|---|\n';
for (const r of rows) {
  if (r.missing) {
    out += `| ${r.page} | — | — | — | — | ${r.missing} |\n`;
  } else {
    out += `| ${r.page} | ${r.nA} | ${r.nB} | ${r.onlyA} | ${r.onlyB} | ${r.sim}% |\n`;
  }
}

out += '\n## 差异明细（仅列差异 ≥ 3 行的页面）\n\n';
for (const r of rows) {
  if (r.missing || (r.onlyA < 3 && r.onlyB < 3)) continue;
  out += `### ${r.page}（相似度 ${r.sim}%）\n`;
  if (r.onlyA) {
    out += `**仅原版有（${r.onlyA} 行，示例）：**\n`;
    for (const l of r.sampleOnlyA) out += `- ${l}\n`;
  }
  if (r.onlyB) {
    out += `**仅复刻有（${r.onlyB} 行，示例）：**\n`;
    for (const l of r.sampleOnlyB) out += `- ${l}\n`;
  }
  out += '\n';
}

const target = path.join(ROOT, 'DIFF-STATS.md');
fs.writeFileSync(target, out);
console.log('写入', target);
console.log(out.split('\n').slice(0, 40).join('\n'));
