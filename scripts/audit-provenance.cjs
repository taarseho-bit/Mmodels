const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const roots = [
  'src', 'server', 'scripts', 'docs', 'verify',
  'electron-builder.yml', 'PROJECT_GUIDE.md', 'DELIVERY.md', 'HANDOFF.md',
  'GITHUB_PAGES.md', 'package.json',
];
const extensions = new Set([
  '.ts', '.tsx', '.js', '.cjs', '.mjs', '.css', '.md', '.json', '.yml', '.yaml', '.py', '.ps1', '.html',
]);
const ignored = new Set(['node_modules', 'dist', 'out', '.git', '.cache', '.mmodels-audit']);
const hits = [];

// 用码点构造产品/个人标记，避免把审计词表本身当成命中项。
const marker = (...codes) => String.fromCodePoint(...codes);
const markers = [
  marker(119,111,114,107,98,117,100,100,121), // 外部产品名
  marker(99,111,100,101,98,117,100,100,121),
  marker(115,111,102,116,114,101,103),
  marker(116,97,97,114,115,101,104,111),
];
const markerLabels = ['外部产品名', '外部产品名', '外部目录名', '外部账号标记'];
const machinePathPatterns = [
  /[A-Za-z]:\\Users\\(?!<)[^\\/\s"']+/i,
  /\\Users\\(?!<)[^\\/\s"']+/i,
  /\/Users\/(?!<)[^/\s"']+/i,
];
const personalFieldPatterns = [
  /(?:作者|开发者|维护者)\s*[:：]\s*[^\s，。；;]+/i,
  /(?:created\s+by|maintainer)\s*[:：]?\s*[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}/,
  /(^|[^A-Za-z])Xh([^A-Za-z]|$)/,
  /(^|[^A-Za-z])xh([^A-Za-z]|$)/,
];

function isLegalAttribution(relative) {
  const normalized = relative.replaceAll('\\', '/').toLowerCase();
  const base = path.posix.basename(normalized);
  if (base === 'license' || base.startsWith('license.') || base === 'notice' || base === 'attribution.md') return true;
  // 论文模板可能在许可证头中保留作者和维护者信息。
  if (normalized.includes('/resources/builtin-skills/write-paper/assets/template/')) return true;
  // 引入的第三方说明书保留原始来源，归属策略文档会解释原因。
  if (normalized.includes('/resources/builtin-skills/scipilot-figure-skill/')) return true;
  return false;
}

function scan(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    if (!extensions.has(path.extname(absolute).toLowerCase())) return;
    if (relative.replaceAll('\\', '/') === 'scripts/audit-provenance.cjs') return;
    if (isLegalAttribution(relative)) return;
    const text = fs.readFileSync(absolute, 'utf8');
    markers.forEach((term, index) => {
      if (text.includes(term)) hits.push(`${relative}: ${markerLabels[index]}`);
    });
    machinePathPatterns.forEach((pattern) => {
      if (pattern.test(text)) hits.push(`${relative}: 开发机路径`);
    });
    personalFieldPatterns.forEach((pattern) => {
      const match = text.match(pattern);
      if (match) hits.push(`${relative}: 个人署名字段（${match[0]}）`);
    });
    return;
  }
  for (const entry of fs.readdirSync(absolute)) {
    if (ignored.has(entry) || entry.startsWith('.')) continue;
    scan(path.join(relative, entry));
  }
}

for (const item of roots) scan(item);

if (hits.length) {
  console.error('来源与个人信息检查未通过：');
  for (const hit of [...new Set(hits)]) console.error(`- ${hit}`);
  console.error('请改为中性产品命名；法律归属文件请放在许可证或归属文档中。');
  process.exitCode = 1;
} else {
  console.log('来源与个人信息检查通过：产品代码未发现个人路径、外部产品标识或个人署名。');
}
