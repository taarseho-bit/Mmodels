/**
 * 按原版 chunk 体积估算「页面/面板层」的复刻进度与剩余量。
 * 用体积当复杂度代理 —— 比数页面个数更接近真实工作量
 * （CollabEditor 一个 chunk 就顶三个普通页面）。
 */
const fs = require('fs');

const D = 'D:/softreg-源码/.unpack/app-asar/out/renderer/assets';

// 页面/面板级 chunk（排除库与推导 chunk）
const KNOWN_LIBS = /^(mermaid|katex|pdf|pdf_viewer|cytoscape|xlsx|papaparse|vendor|dagre|layout|graph|linear|arc|boxes|map|stex|r-|octave|yaml|ordinal|shell|useFeishu|automationFormat|defaultLocale|sizeCapture|latexCompile|highlighted-body|init|chunk-|diagram-|swimlanes|sequenceDiagram|architectureDiagram|blockDiagram|c4Diagram|ganttDiagram|flowDiagram|vennDiagram|xychartDiagram|quadrantDiagram|requirementDiagram|timeline|gitGraphDiagram|erDiagram|wardleyDiagram|journeyDiagram|sankeyDiagram|mindmap|kanban|ishikawa|stateDiagram|cynefin|pieDiagram|classDiagram|infoDiagram|swimlanesDiagram|railroadDiagram|abnfDiagram|pegDiagram|ebnfDiagram|dataPreview)/;

/** 复刻状态：done=已实现，partial=部分覆盖，todo=未做 */
const STATUS = {
  index: 'done',                 // 应用外壳（本轮之前完成）
  ChatPage: 'done',
  SettingsPage: 'done',
  ExtensionsPage: 'done',
  AutomationPage: 'done',
  TerminalPanel: 'done',
  FilesPanel: 'done',
  CompetitionsPage: 'done',
  GalleryPage: 'done',
  PapersPage: 'done',
  PageShell: 'done',
  Skeleton: 'done',
  SettingsPrimitives: 'done',
  DiffPanel: 'done',
  VersionHistoryPanel: 'done',
  DataFilePreview: 'done',
  PdfFilePreview: 'done',
  BrowserPanel: 'done',
  DiagramsPanel: 'done',
  DatabasePage: 'done',
  OnboardingWizard: 'done',
  MotionOnboarding: 'done',      // 聚光灯巡览已实现（原版另含 gsap 动画）
  ArtifactPanes: 'todo',
  PresetConnectDialog: 'partial', // 向导第一步覆盖了同类能力
  CollabEditor: 'todo',
  CollabRailTabs: 'todo',
  CollabGuestPage: 'todo',
};

const files = fs.readdirSync(D).filter((n) => n.endsWith('.js'));
const rows = [];
let doneKB = 0, partialKB = 0, todoKB = 0, unknownKB = 0;

for (const f of files) {
  if (KNOWN_LIBS.test(f)) continue;
  // 从文件名取组件名（形如 Name-HASH.js），index-*.js 单独处理
  const m = /^([A-Za-z][\w-]*?)-[A-Za-z0-9_-]{8,}\.js$/.exec(f);
  const name = m ? m[1] : (f.startsWith('index-') ? 'index' : null);
  if (!name) continue;
  const kb = fs.statSync(D + '/' + f).size / 1024;
  const st = STATUS[name] ?? 'unknown';
  if (st === 'done') doneKB += kb;
  else if (st === 'partial') partialKB += kb;
  else if (st === 'todo') todoKB += kb;
  else unknownKB += kb;
  rows.push({ name, kb, st });
}

rows.sort((a, b) => b.kb - a.kb);

const total = doneKB + partialKB + todoKB;
const pct = (x) => ((x / total) * 100).toFixed(1);

console.log('组件                                体积KB   状态');
console.log('-'.repeat(56));
for (const r of rows) {
  console.log(
    r.name.padEnd(34) + String(Math.round(r.kb)).padStart(7) + '   ' +
      (r.st === 'done' ? '✓ 已实现' : r.st === 'partial' ? '◐ 部分覆盖' : r.st === 'todo' ? '· 未做' : '? 未归类'),
  );
}
console.log('-'.repeat(56));
console.log(`已实现 ${Math.round(doneKB)} KB (${pct(doneKB)}%)`);
console.log(`部分覆盖 ${Math.round(partialKB)} KB (${pct(partialKB)}%)`);
console.log(`未做 ${Math.round(todoKB)} KB (${pct(todoKB)}%)`);
console.log(`未归类 ${Math.round(unknownKB)} KB`);

const todoList = rows.filter((r) => r.st !== 'done');
console.log('\n未完成明细：');
for (const r of todoList) console.log(`  ${r.name}  ${Math.round(r.kb)} KB  ${r.st}`);
