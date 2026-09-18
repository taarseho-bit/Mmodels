const fs = require('node:fs');
const path = require('node:path');

const installedRoot = process.env.MATHMODEL_BASELINE_DIR || path.join(
  process.env.LOCALAPPDATA || path.join(require('node:os').homedir(), 'AppData', 'Local'),
  'Programs', '@mathmodeldesktop',
);
const installedApp = path.join(installedRoot, 'mathmodel.exe');
function requireBaseline() {
  if (!fs.existsSync(installedApp)) {
    throw new Error(`找不到基准程序：${installedApp}；请设置 MATHMODEL_BASELINE_DIR。`);
  }
  return installedRoot;
}
module.exports = { installedRoot, installedApp, requireBaseline };
