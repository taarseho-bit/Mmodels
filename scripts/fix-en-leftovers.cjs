// 修补项目契约 en 词典里 25 条未翻译的中文条目（项目契约自身的翻译欠账）
const fs = require('fs');
const p = 'D:/mathmodel-desktop/src/renderer/src/i18n/en.ts';
let s = fs.readFileSync(p, 'utf8');
const map = [
  ['案例加载失败，请重试', 'Failed to load the example. Please try again'],
  ['正在加载案例', 'Loading examples'],
  ['试试这些数模真题案例', 'Try these real competition examples'],
  ['数学建模助手', 'Math Modeling Assistant'],
  ['在 <muted>{{name}}</muted> 中建模', 'Modeling in <muted>{{name}}</muted>'],
  ['在此上传文件和粘贴题目，启动 mathmodelagent...', 'Upload files and paste the problem here to start mathmodelagent...'],
  ['科研绘图模板', 'Scientific Figure Templates'],
  ['查看全部模板', 'View all templates'],
  ['点击提示词即可填充到左侧输入框', 'Click a prompt to fill it into the input box on the left'],
  ['SHAP、ROC、泰勒图、环形热图等当前实现模板', 'Publication-ready templates: SHAP, ROC, Taylor diagrams, ring heatmaps and more'],
  ['填入{{title}}绘图提示词', 'Insert the {{title}} plotting prompt'],
  ['简体中文', 'Chinese (Simplified)'],
  ['全部', 'All'],
  ['关闭预览', 'Close preview'],
  ['选择模板，让 Agent 根据项目数据当前实现并导出投稿级图表', 'Pick a template and let the Agent render and export publication-ready figures from your project data'],
  ['绘图库', 'Plotting libraries'],
  ['下一张图', 'Next figure'],
  ['上一张图', 'Previous figure'],
  ['模板日期', 'Template date'],
  ['来源', 'Source'],
  ['使用此模板', 'Use this template'],
  ['科研绘图', 'Scientific Figures'],
];
let n = 0;
for (const [zh, en] of map) {
  const esc = zh.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('("' + esc + '")', 'g');
  s = s.replace(re, () => { n++; return '"' + en + '"'; });
}
fs.writeFileSync(p, s);
console.log('replaced', n, 'entries (expect 25)');
