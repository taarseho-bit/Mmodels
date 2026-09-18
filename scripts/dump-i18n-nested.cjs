// 原版 i18n 是嵌套对象，键会被拼成 "papers.quota.today" 这类点号路径。
// 之前的扁平正则丢掉了命名空间。这里做真正的嵌套解析 + 点号拍平。
const fs = require('fs');

const D = 'D:/softreg-源码/.unpack/app-asar/out/renderer/assets';
const OUT = 'D:/softreg-源码/.unpack/_extract';

/** 从 i 处的 '{' 开始括号配平，返回 [start, endExclusive] */
function matchBrace(s, i) {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return [i, k + 1];
    }
  }
  return null;
}

/** 解析一个对象字面量的「一层」键值对（值可能是嵌套对象/字符串/数组） */
function parseObjectBody(s) {
  const pairs = [];
  let i = 0;
  while (i < s.length) {
    // 跳过空白与逗号
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (i >= s.length) break;

    // 读键
    let key = null;
    if (s[i] === '"' || s[i] === "'" || s[i] === '`') {
      const q = s[i];
      let j = i + 1;
      while (j < s.length && s[j] !== q) {
        if (s[j] === '\\') j++;
        j++;
      }
      key = s.slice(i + 1, j);
      i = j + 1;
    } else {
      const m = /^([A-Za-z_$][\w$]*)/.exec(s.slice(i));
      if (!m) break;
      key = m[1];
      i += m[1].length;
    }

    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] !== ':') break;
    i++;
    while (i < s.length && /\s/.test(s[i])) i++;

    // 读值
    let val;
    if (s[i] === '{') {
      const r = matchBrace(s, i);
      if (!r) break;
      val = { kind: 'obj', body: s.slice(r[0] + 1, r[1] - 1) };
      i = r[1];
    } else if (s[i] === '[') {
      let d = 0, j = i;
      for (; j < s.length; j++) {
        if (s[j] === '[') d++;
        else if (s[j] === ']') { d--; if (d === 0) break; }
      }
      val = { kind: 'arr', raw: s.slice(i, j + 1) };
      i = j + 1;
    } else if (s[i] === '"' || s[i] === "'" || s[i] === '`') {
      const q = s[i];
      let j = i + 1;
      while (j < s.length && s[j] !== q) {
        if (s[j] === '\\') j++;
        j++;
      }
      val = { kind: 'str', value: s.slice(i + 1, j) };
      i = j + 1;
    } else {
      // 其它表达式（函数/标识符）——跳到下一个顶层逗号
      let d = 0, j = i;
      for (; j < s.length; j++) {
        const c = s[j];
        if ('([{'.includes(c)) d++;
        else if (')]}'.includes(c)) d--;
        else if (c === ',' && d === 0) break;
      }
      val = { kind: 'expr', raw: s.slice(i, j) };
      i = j;
    }

    pairs.push([key, val]);
    while (i < s.length && /[\s,]/.test(s[i])) i++;
  }
  return pairs;
}

const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s);

const flat = new Map();   // dotted key -> 中文
const report = [];

for (const f of fs.readdirSync(D).filter((n) => n.endsWith('.js'))) {
  const s = fs.readFileSync(D + '/' + f, 'utf8');
  let found = 0;

  // 逐个扫描「标识符:{」形式，尝试解析为对象
  const re = /([A-Za-z_$][\w$]*)\s*:\s*\{/g;
  let m;
  while ((m = re.exec(s))) {
    const braceAt = s.indexOf('{', m.index + m[0].length - 1);
    const r = matchBrace(s, braceAt);
    if (!r) continue;
    const body = s.slice(braceAt + 1, r[1] - 1);

    // 只处理「含中文」的对象，避免解析海量无关数据
    if (!hasCJK(body)) continue;
    // 太小/太大的都跳过（太小没信息量，太大可能是业务数据）
    if (body.length < 20 || body.length > 400000) continue;

    walk(body, m[1], 0);
    found++;
    // 避免把子对象重复当作顶层再解析：跳过这段
    re.lastIndex = r[1];
  }
  if (found) report.push(`${f}\tobjects=${found}`);
}

function walk(body, prefix, depth) {
  if (depth > 6) return;
  for (const [k, v] of parseObjectBody(body)) {
    const path = prefix + '.' + k;
    if (v.kind === 'str') {
      if (hasCJK(v.value) && v.value.length <= 600) {
        if (!flat.has(path)) flat.set(path, v.value);
      }
    } else if (v.kind === 'obj') {
      walk(v.body, path, depth + 1);
    }
  }
}

const lines = [...flat.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  .map(([k, v]) => `${k}\t${v.replace(/\n/g, '\\n')}`);
fs.writeFileSync(OUT + '/i18n-zh-nested.txt', lines.join('\n'));
console.log('dotted keys =', flat.size);
console.log(report.slice(0, 10).join('\n'));
