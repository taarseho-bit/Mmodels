// 由 gallery-raw.json 生成 src/shared/gallery-data.ts
const fs = require('fs');

const items = JSON.parse(
  fs.readFileSync('D:/softreg-源码/.unpack/_extract/gallery-raw.json', 'utf8'),
);

const OUT = 'D:/mathmodel-desktop/src/shared/gallery-data.ts';

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

const rows = items.map(
  (it) =>
    `  {\n` +
    `    id: ${q(it.id)},\n` +
    `    title: ${q(it.title)},\n` +
    `    description: ${q(it.description)},\n` +
    `    category: ${q(it.category)},\n` +
    `    tags: [${it.tags.map(q).join(', ')}],\n` +
    `    image: ${q(it.id + '.webp')},\n` +
    `  },`,
);

const cats = [...new Set(items.map((x) => x.category))];

const file = `/**
 * 科研绘图模板目录 —— 逐字取自原版 MathModel 0.0.20 渲染层 chunk。
 *
 * 共 ${items.length} 套复刻模板，${cats.length} 个分类：${cats.join(' / ')}。
 * 缩略图为原版内置 webp 复刻图，已随包放在 \`src/renderer/src/assets/gallery/\`。
 *
 * 原版用法（见 i18n 字典 gallery* 系列键）：
 *   点击模板 → 向 Agent 发 \`/mathmodel-figure-templates 在 LaTeX sandbox 中复刻「<标题>」\`
 *   要求优先调用 skill 内置的 render_template.py 与模板脚本，使用当前题目数据绘制。
 */

export interface GalleryTemplate {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  /** 相对于 assets/gallery 的文件名 */
  image: string;
}

export const GALLERY: GalleryTemplate[] = [
${rows.join('\n')}
];

/** 全部分类（保持出现顺序） */
export const GALLERY_CATEGORIES: string[] = [
${cats.map((c) => '  ' + q(c) + ',').join('\n')}
];

/** 复刻模板时发给 Agent 的指令（逐字取自原版字符串表） */
export function galleryPrompt(title: string): string {
  return \`/mathmodel-figure-templates 在 LaTeX sandbox 中复刻「\${title}」。请优先调用 skill 内置的 render_template.py 和模板脚本，使用当前数学建模题目中数据绘制，输出 PNG/PDF/SVG，并返回脚本和图片路径。\`;
}
`;

fs.writeFileSync(OUT, file, 'utf8');
console.log('wrote ' + items.length + ' templates / ' + cats.length + ' categories -> ' + OUT);
