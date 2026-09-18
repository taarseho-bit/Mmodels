// 原版 i18n 结构（从主 chunk 还原）：
//   zse = { competitions:Ese, automation:Cse, chat:_se, collabTeam:kse, common:Tse,
//           composer:Pse, dock:Rse, extensions:Mse, integrations:Ase, onboarding:Nse,
//           papers:Ose, profile:Lse, settings:Dse, shell:Ise, whatsnew:Fse }
//   jse = { en:{translation:Sse}, "zh-CN":{translation:zse} }
// 即：中文文案分散在 15 个命名空间变量里，键要拼成 "papers.page.title" 这类点号路径。
const fs = require('fs');

const D = 'D:/softreg-源码/.unpack/app-asar/out/renderer/assets';
const OUT = 'D:/softreg-源码/.unpack/_extract';
const s = fs.readFileSync(D + '/index-OYc102qC.js', 'utf8');

const NS = [
  'competitions', 'automation', 'chat', 'collabTeam', 'common', 'composer', 'dock',
  'extensions', 'integrations', 'onboarding', 'papers', 'profile', 'settings', 'shell',
  'whatsnew',
];

// 1) 命名空间 -> 变量名
//    ⚠️ 文件里有两份资源映射（en 与 zh-CN）。必须先定位 "zh-CN":{translation:XXX}，
//    再从 XXX 那份映射里取命名空间，否则会拿到英文变量。
const zhMapVar = (/"zh-CN"\s*:\s*\{\s*translation\s*:\s*([A-Za-z_$][\w$]*)/.exec(s) || [])[1];
if (!zhMapVar) throw new Error('未找到 zh-CN translation 变量');
console.log('zh resources var =', zhMapVar);

const zhBody = readVarRaw(zhMapVar);
if (!zhBody) throw new Error('未找到 ' + zhMapVar + ' 的对象定义');

function readVarRaw(name) {
  const re = new RegExp('(?:^|[,;{\\s])' + name + '\\s*=\\s*\\{');
  const m = re.exec(s);
  if (!m) return null;
  const at = s.indexOf('{', m.index + m[0].length - 1);
  const r = matchBrace(s, at);
  return r ? s.slice(r[0] + 1, r[1] - 1) : null;
}

const nsVar = new Map();
for (const [k, v] of parseObj(zhBody)) {
  if (NS.includes(k) && v.kind === 'other' && /^[A-Za-z_$][\w$]*$/.test(v.raw.trim())) {
    nsVar.set(k, v.raw.trim());
  }
}
console.log('namespaces bound:', [...nsVar.entries()].map(([k, v]) => `${k}=${v}`).join(' '));

// 2) 括号配平
function matchBrace(str, i) {
  let d = 0;
  for (let k = i; k < str.length; k++) {
    if (str[k] === '{') d++;
    else if (str[k] === '}') { d--; if (d === 0) return [i, k + 1]; }
  }
  return null;
}

// 3) 解析对象一层
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
    if (body[i] !== ':') {
      // 可能是简写或异常，跳到下一个逗号
      while (i < body.length && body[i] !== ',') i++;
      continue;
    }
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

const hasCJK = (x) => /[\u4e00-\u9fff]/.test(x);
const flat = new Map();

function walk(body, prefix, depth) {
  if (depth > 8) return;
  for (const [k, v] of parseObj(body)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v.kind === 'str') {
      if (hasCJK(v.value) && v.value.length <= 4000) {
        if (!flat.has(path)) flat.set(path, v.value);
      }
    } else if (v.kind === 'obj') {
      walk(v.body, path, depth + 1);
    } else if (v.kind === 'other') {
      // 兼容 `key: SOME_VAR` 形式的嵌套命名空间引用
      const ref = v.raw.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(ref)) {
        const sub = readVar(ref);
        if (sub) { walk(sub, path, depth + 1); continue; }
      }
      // 数组里含对象/字符串的情况：粗粒度抽中文短串
      if (hasCJK(v.raw) && v.raw.length < 20000) {
        for (const mm of v.raw.matchAll(/["'`]([^"'`]{1,400})["'`]/g)) {
          if (hasCJK(mm[1]) && !flat.has(path + '.' + mm[1])) {
            // 数组项无法命名，跳过以免污染
          }
        }
      }
    }
  }
}

/** 读取 varName={...} 的对象体 */
function readVar(name) {
  const re = new RegExp('\\b' + name + '\\s*=\\s*\\{');
  const m = re.exec(s);
  if (!m) return null;
  const at = s.indexOf('{', m.index + m[0].length - 1);
  const r = matchBrace(s, at);
  return r ? s.slice(r[0] + 1, r[1] - 1) : null;
}

// 4) 逐命名空间解析
const stats = [];
for (const [ns, varName] of nsVar) {
  const body = readVar(varName);
  if (!body) { stats.push(`${ns}\tMISSING var ${varName}`); continue; }
  const before = flat.size;
  walk(body, ns, 0);
  stats.push(`${ns}\t${flat.size - before} keys\t(${varName})`);
}

console.log(stats.join('\n'));

const lines = [...flat.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([k, v]) => `${k}\t${v.replace(/\n/g, '\\n')}`);
fs.writeFileSync(OUT + '/i18n-zh-full.txt', lines.join('\n'));
console.log('\nTOTAL dotted keys =', flat.size);
