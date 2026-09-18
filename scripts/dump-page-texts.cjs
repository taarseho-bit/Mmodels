// 按 chunk 提取中文文案，供逐页复刻参考。
const fs = require('fs');
const D = 'D:/softreg-源码/.unpack/app-asar/out/renderer/assets';
const OUT = 'D:/softreg-源码/.unpack/_extract/page-texts';
fs.mkdirSync(OUT, { recursive: true });

const TARGETS = [
  'CompetitionsPage', 'GalleryPage', 'PapersPage', 'CollabGuestPage', 'DatabasePage',
  'CollabEditor', 'CollabRailTabs', 'ArtifactPanes', 'BrowserPanel', 'VersionHistoryPanel',
  'DiagramsPanel', 'DiffPanel', 'PageShell', 'Skeleton', 'SettingsPrimitives',
  'MotionOnboarding', 'OnboardingWizard', 'PresetConnectDialog',
  'PdfFilePreview', 'DataFilePreview', 'FilesPanel',
];

const index = [];
for (const t of TARGETS) {
  const f = fs.readdirSync(D).find((n) => n.startsWith(t + '-') && n.endsWith('.js'));
  if (!f) { index.push(t + '\tNOT FOUND'); continue; }
  const s = fs.readFileSync(D + '/' + f, 'utf8');
  const set = new Set();
  const re = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = re.exec(s))) {
    const v = m[2];
    if (/[\u4e00-\u9fff]/.test(v) && v.length <= 400) set.add(v);
  }
  const arr = [...set].sort();
  fs.writeFileSync(OUT + '/' + t + '.txt', arr.join('\n'));
  index.push(`${t}\t${f}\t${arr.length} 条`);
}
fs.writeFileSync(OUT + '/_index.txt', index.join('\n'));
console.log(index.join('\n'));
