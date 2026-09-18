/**
 * 从原版渲染层 chunk 里提取 Lucide 图标。
 *
 * 图标数据格式（lucide 的 createLucideIcon 签名）：
 *   const o=[["path",{d:"M11.5 2.29…",key:"r04s7s"}]], c=X("star", o)
 * 即 `[标签名, 属性对象][]`。
 *
 * ⚠️ 两个易错点：
 *   1. vite 只把**少量**图标拆成独立 chunk，多数图标被**内联进主 index chunk**，
 *      所以必须全量扫描所有文件，不能只看小文件。
 *   2. 候选名里混着大量非图标（`x`、`y`、`width`、`animationend` 等 DOM 常量），
 *      必须要求「同文件里能找到同名的数组定义」才算真图标。
 *
 * 提取后零依赖渲染，路径数据与原版逐字一致。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const D = 'D:/softreg-源码/.unpack/app-asar/out/renderer/assets';
const OUT = 'D:/mathmodel-desktop/src/renderer/src/components/icons/lucide-data.ts';

/** 括号配平截取数组字面量（跳过字符串内的括号） */
function takeArray(s, start) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

const CALL = /\b([A-Za-z_$][\w$]*)\("([-a-z0-9]+)",\s*([A-Za-z_$][\w$]*)\)/g;
const found = new Map();
let scanned = 0;

for (const f of fs.readdirSync(D).filter((x) => x.endsWith('.js'))) {
  const s = fs.readFileSync(path.join(D, f), 'utf8');
  scanned++;
  CALL.lastIndex = 0;
  let m;
  const jobs = [];
  while ((m = CALL.exec(s))) {
    const [, , name, varName] = m;
    if (found.has(name)) continue;
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) continue; // 只收 kebab-case
    jobs.push({ name, varName });
  }
  for (const { name, varName } of jobs) {
    // 同文件里必须有 `const <var> = [`
    const re = new RegExp(`(?:const|var|let)\\s+${varName}\\s*=\\s*\\[`);
    const hit = re.exec(s);
    if (!hit) continue; // 不是真图标（DOM 常量之类）
    const arrStart = s.indexOf('[', hit.index);
    const raw = takeArray(s, arrStart);
    if (!raw) continue;
    // ⚠️ 不能用 JSON.parse：压缩后的对象字面量 key 不带引号（{d:"…",key:"…"}）
    let data;
    try {
      data = vm.runInNewContext('(' + raw + ')', Object.create(null), { timeout: 1000 });
    } catch {
      continue;
    }
    // 形状校验：必须是 [[tag, attrs], ...]
    if (!Array.isArray(data) || data.length === 0) continue;
    const okShape = data.every(
      (it) => Array.isArray(it) && it.length === 2 && typeof it[0] === 'string' && it[1] && typeof it[1] === 'object',
    );
    if (!okShape) continue;
    const clean = data.map(([tag, attrs]) => {
      const a = { ...attrs };
      delete a.key; // React 内部用，剔除
      return [tag, a];
    });
    found.set(name, clean);
  }
}

const names = [...found.keys()].sort();
console.log(`扫描 ${scanned} 个 chunk，提取到 ${names.length} 个图标`);

const rows = names.map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(found.get(n))},`);

const file = `/**
 * Lucide 图标数据 —— 逐字取自原版 MathModel 0.0.20 渲染层 chunk。
 *
 * 原版用 \`lucide-react\`。这里把 ${names.length} 个图标的**路径数据原样提取**，
 * 零依赖渲染，视觉与原版一致，且不必引入 lucide-react。
 *
 * ⚠️ 多数图标被 vite 内联进主 index chunk（只有少数拆成独立文件），
 *    所以生成脚本是全量扫描。
 * ⚠️ 属性里的 \`key\` 是 React 内部用的，已剔除。
 *
 * 重新生成：\`node scripts/gen-icons.cjs\`
 */

export type IconNode = Array<[string, Record<string, string>]>;

export const LUCIDE_ICONS: Record<string, IconNode> = {
${rows.join('\n')}
};

export type IconName = string;
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, file, 'utf8');
console.log('写入 ' + OUT + '  (' + (file.length / 1024).toFixed(0) + ' KB)');
