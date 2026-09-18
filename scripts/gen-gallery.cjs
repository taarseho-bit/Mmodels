// 提取原版「科研绘图模板」目录：id / 标题 / 说明 / 分类 / 标签 / 复刻图。
// 图片变量形如： const $me=""+new URL("xxx.webp",import.meta.url).href
const fs = require('fs');

const D = 'D:/softreg-源码/.unpack/app-asar/out/renderer/assets';
const s = fs.readFileSync(D + '/index-OYc102qC.js', 'utf8');

// 1) 变量 -> webp 文件名
const varToFile = new Map();
for (const m of s.matchAll(
  /([A-Za-z_$][\w$]*)\s*=\s*""\s*\+\s*new URL\("([^"]+\.webp)",\s*import\.meta\.url\)\.href/g,
)) {
  varToFile.set(m[1], m[2]);
}
console.log('webp vars =', varToFile.size);

// 2) 抓 gallery 条目
const items = [];
for (const m of s.matchAll(
  /\{id:"([a-z0-9-]+)",title:"((?:[^"\\]|\\.)*)",description:"((?:[^"\\]|\\.)*)",category:"((?:[^"\\]|\\.)*)",tags:\[((?:[^\]])*)\],image:([A-Za-z_$][\w$]*)\}/g,
)) {
  const [, id, title, description, category, tagsRaw, imgVar] = m;
  const tags = [...tagsRaw.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  items.push({
    id,
    title,
    description,
    category,
    tags,
    image: varToFile.get(imgVar) ?? null,
    imageVar: imgVar,
  });
}
console.log('gallery items =', items.length);
const withImg = items.filter((x) => x.image).length;
console.log('with image =', withImg);

// 3) 分类统计
const cats = new Map();
for (const it of items) cats.set(it.category, (cats.get(it.category) ?? 0) + 1);
console.log('categories:', [...cats.entries()].map(([k, v]) => `${k}(${v})`).join(' '));

fs.writeFileSync(
  'D:/softreg-源码/.unpack/_extract/gallery-raw.json',
  JSON.stringify(items, null, 2),
  'utf8',
);
console.log('written gallery-raw.json');
