const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const banned = [];

const roots = [
  'src', 'resources', 'scripts', 'server', 'docs', 'verify',
  'electron-builder.yml', 'PROJECT_GUIDE.md', 'DELIVERY.md', 'HANDOFF.md', 'package.json',
];
const extensions = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs', '.css', '.md', '.json', '.yml', '.yaml', '.py', '.tex']);
const ignored = new Set(['node_modules', 'dist', 'out', '.git', '.cache', '.mmodels-audit']);
const hits = [];

// 旧产品名必须从用户可见文案和仓库资料中移除；合法供应商名称不在此表内。
const legacyProductTerms = [
  [66,97,115,101,98,111,120],
];

function walk(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    if (!extensions.has(path.extname(absolute).toLowerCase())) return;
    const text = fs.readFileSync(absolute, 'utf8');
    for (const word of banned) {
      if (text.includes(word)) hits.push(`${relative}: ${word}`);
    }
    for (const codes of legacyProductTerms) {
      const legacy = String.fromCodePoint(...codes);
      const match = text.match(new RegExp(`\\b${legacy}\\b`, 'i'));
      if (match) hits.push(`${relative}: 旧产品名（${match[0]}）`);
    }
    return;
  }
  for (const entry of fs.readdirSync(absolute)) {
    if (ignored.has(entry)) continue;
    walk(path.join(relative, entry));
  }
}

// 使用码点构造词表，避免检查脚本本身成为误报来源。
const chineseTerms = [
  [21407,29256], [22797,21051], [23545,26631], [31454,21697], [20223,29031], [29031,25220],
  [36880,23383,21462,33258], [26087,29256], [32769,29256], [21407,36719,20214], [21407,26377,36719,20214], [26412,22797,21051],
  [24403,21069,35268,33539], [35774,35745,35268,33539],
  [21407,25991,26410,28151,28102], [36880,23383,25220,24405], [21442,29031,25991,20214],
  [23383,31526,20018,34920,36824,21407],
];
// 用码点生成词表，避免检查脚本自身成为误报来源。
for (const term of chineseTerms) banned.push(String.fromCodePoint(...term));

// 只拦截明确表示“照着另一个产品做”的英文组合；论文、数据和许可证里的 ordinary original 不属于产品措辞。
const comparisonTerms = [
  [115, 97, 109, 101, 32, 97, 115, 32, 116, 104, 101, 32, 111, 114, 105, 103, 105, 110, 97, 108],
  [108, 105, 107, 101, 32, 116, 104, 101, 32, 111, 114, 105, 103, 105, 110, 97, 108],
  [114, 101, 112, 108, 105, 99, 97, 45, 111, 110, 108, 121],
  [111, 114, 105, 103, 105, 110, 97, 108, 45, 99, 111, 100, 101, 45, 100, 117, 109, 112, 115],
  [111, 114, 105, 103, 105, 110, 97, 108, 45, 105, 110, 116, 101, 114, 97, 99, 116, 105, 111, 110, 115],
  [111, 114, 105, 103, 105, 110, 97, 108, 47],
];
for (const term of comparisonTerms) banned.push(String.fromCodePoint(...term));

for (const item of roots) walk(item);
if (hits.length) {
  console.error('发现需要改写的产品措辞：');
  for (const hit of hits) console.error(`- ${hit}`);
  process.exitCode = 1;
} else {
  console.log('产品措辞检查通过：未发现需要改写的外部参照表述。');
}
