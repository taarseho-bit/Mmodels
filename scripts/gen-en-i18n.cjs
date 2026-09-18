// 从原版渲染层 bundle 提取英文词典 jse.en.translation，生成与 zh.ts 同构的 en.ts。
// 键集合以 zh.ts 为准（zh.ts 已排除账号/计费文案，en 自动同步排除）。
const fs = require('fs');

const D = 'D:/softreg-源码/.unpack/app-asar/out/renderer/assets';
const OUT = 'D:/softreg-源码/.unpack/_extract';
const ZH_TS = 'D:/mathmodel-desktop/src/renderer/src/i18n/zh.ts';
const EN_TS = 'D:/mathmodel-desktop/src/renderer/src/i18n/en.ts';

const s = fs.readFileSync(D + '/index-OYc102qC.js', 'utf8');

// 1) 定位 en translation 变量
// en 键可能不带引号：jse={en:{translation:Sse},"zh-CN":{...}}
const enMapVar = (/"?\ben"?\s*:\s*\{\s*translation\s*:\s*([A-Za-z_$][\w$]*)/.exec(s) || [])[1];
if (!enMapVar) throw new Error('未找到 en translation 变量');
console.log('en resources var =', enMapVar);

const NS = [
  'competitions', 'automation', 'chat', 'collabTeam', 'common', 'composer', 'dock',
  'extensions', 'integrations', 'onboarding', 'papers', 'profile', 'settings', 'shell',
  'whatsnew',
];

function matchBrace(str, i) {
  let d = 0;
  for (let k = i; k < str.length; k++) {
    if (str[k] === '{') d++;
    else if (str[k] === '}') { d--; if (d === 0) return [i, k + 1]; }
  }
  return null;
}

function readVar(name) {
  const re = new RegExp('(?:^|[,;{\\s])' + name + '\\s*=\\s*\\{');
  const m = re.exec(s);
  if (!m) return null;
  const at = s.indexOf('{', m.index + m[0].length - 1);
  const r = matchBrace(s, at);
  return r ? s.slice(r[0] + 1, r[1] - 1) : null;
}

// 2) 解析对象一层（复用 dump-i18n-full.cjs 的解析器）
function parseObj(body) {
  const pairs = [];
  let i = 0;
  const skipWs = () => { while (i < body.length && /[\s,]/.test(body[i])) i++; };
  while (i < body.length) {
    skipWs();
    if (i >= body.length) break;
    let key;
    if ('"\'`'.includes(body[i])) {
      const q = body[i]; let j = i + 1;
      while (j < body.length && body[j] !== q) { if (body[j] === '\\') j++; j++; }
      key = body.slice(i + 1, j); i = j + 1;
    } else {
      const m = /^([A-Za-z_$][\w$]*)/.exec(body.slice(i));
      if (!m) break;
      key = m[1]; i += m[1].length;
    }
    while (i < body.length && /\s/.test(body[i])) i++;
    if (body[i] !== ':') { while (i < body.length && body[i] !== ',') i++; continue; }
    i++;
    while (i < body.length && /\s/.test(body[i])) i++;
    let val;
    if (body[i] === '{') {
      const r = matchBrace(body, i);
      if (!r) break;
      val = { kind: 'obj', body: body.slice(r[0] + 1, r[1] - 1) };
      i = r[1];
    } else if ('"\'`'.includes(body[i])) {
      const q = body[i]; let j = i + 1;
      while (j < body.length && body[j] !== q) { if (body[j] === '\\') j++; j++; }
      val = { kind: 'str', value: body.slice(i + 1, j) };
      i = j + 1;
    } else {
      let d = 0, j = i;
      for (; j < body.length; j++) {
        const c = body[j];
        if ('([{'.includes(c)) d++;
        else if (')]}'.includes(c)) d--;
        else if (c === ',' && d === 0) break;
      }
      val = { kind: 'other', raw: body.slice(i, j) };
      i = j;
    }
    pairs.push([key, val]);
  }
  return pairs;
}

const flatEn = new Map();
function walk(body, prefix, depth) {
  if (depth > 8) return;
  for (const [k, v] of parseObj(body)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v.kind === 'str') {
      if (!flatEn.has(path)) flatEn.set(path, v.value);
    } else if (v.kind === 'obj') {
      walk(v.body, path, depth + 1);
    } else if (v.kind === 'other') {
      const ref = v.raw.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(ref)) {
        const sub = readVar(ref);
        if (sub) { walk(sub, path, depth + 1); continue; }
      }
    }
  }
}

const enBody = readVar(enMapVar);
if (!enBody) throw new Error('未找到 ' + enMapVar + ' 的对象定义');
const enNsVar = new Map();
for (const [k, v] of parseObj(enBody)) {
  if (NS.includes(k) && v.kind === 'other' && /^[A-Za-z_$][\w$]*$/.test(v.raw.trim())) {
    enNsVar.set(k, v.raw.trim());
  }
}
console.log('en namespaces bound:', [...enNsVar.entries()].map(([k, v]) => `${k}=${v}`).join(' '));
for (const [ns, varName] of enNsVar) {
  const body = readVar(varName);
  if (!body) { console.log(ns, 'MISSING var', varName); continue; }
  walk(body, ns, 0);
}
console.log('en flat keys =', flatEn.size);

// 3) 读取 zh.ts 的键集合（把 export const zh = {...} 变成可 require 的对象）
const zhSrc = fs.readFileSync(ZH_TS, 'utf8');
const jsSrc = zhSrc
  .replace(/export\s+const\s+zh\s*=/, 'module.exports.zh =')
  .replace(/\}\s*as\s*const\s*;/, '};')
  .replace(/^export\s+(?:type|default).*$/gm, '');
const zhObj = new Function('module', jsSrc + '\nreturn module.exports.zh;')({ exports: {} });

function flatKeys(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push(path);
    else if (v && typeof v === 'object') flatKeys(v, path, out);
  }
  return out;
}
const zhKeys = new Set(flatKeys(zhObj, '', []));
console.log('zh keys =', zhKeys.size);

// 4) 对齐：只保留 zh.ts 里存在的键
let missing = 0;
const nested = {};
for (const key of zhKeys) {
  const en = flatEn.get(key);
  const parts = key.split('.');
  let cur = nested;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  if (en === undefined) { missing++; cur[parts[parts.length - 1]] = `/*MISSING*/`; }
  else cur[parts[parts.length - 1]] = en;
}
console.log('aligned keys =', zhKeys.size - missing, ' missing in en =', missing);

// 5) 生成 en.ts（保持键顺序与 zh.ts 一致 —— 按原嵌套顺序）
function renderTs(obj, indent) {
  const pad = '  '.repeat(indent);
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    const safeKey = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
    if (typeof v === 'string') {
      lines.push(`${pad}${safeKey}: ${JSON.stringify(v)},`);
    } else {
      lines.push(`${pad}${safeKey}: {`);
      lines.push(renderTs(v, indent + 1));
      lines.push(`${pad}},`);
    }
  }
  return lines.join('\n');
}

const header = `/**
 * 英文文案字典 —— 逐字取自原版 MModels 0.0.20 的 i18n 资源（jse.en.translation）。
 *
 * 与 zh.ts 同构：键集合完全对齐（由 scripts/gen-en-i18n.cjs 生成，勿手改结构）。
 * 原版默认 zh-CN 并回退 en；本文件即那份 en 回退资源。
 */

export const en = {
`;
fs.writeFileSync(EN_TS, header + renderTs(nested, 1) + '\n};\n');
console.log('written:', EN_TS, fs.statSync(EN_TS).size, 'bytes');
