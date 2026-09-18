/**
 * 验证 Electron 43 下 `electron` 模块的正确导入方式。
 *
 * ⚠️ Electron 43（Node 24）不再为 ESM 提供具名导出：
 *    `import { app } from 'electron'` 会抛
 *      SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
 *    这会**同时打断主进程与所有验证脚本**（它们都是 ESM）。
 *
 * 这里逐个试出可用的写法。
 */
import { app } from 'electron';

const log = [];
log.push('Electron = ' + process.versions.electron);
log.push('Node     = ' + process.versions.node);
log.push('');
log.push('具名导入 import { app } from "electron" → 成功（能跑到这里就说明可以）');
log.push('app.isReady 可访问: ' + typeof app?.isReady);
write();
app.whenReady().then(() => {
  log.push('whenReady 回调也正常');
  write();
  app.quit();
});

function write() {
  const fs = require('node:fs');
  fs.mkdirSync(process.env.VERIFY_OUT || './out', { recursive: true });
  fs.writeFileSync((process.env.VERIFY_OUT || './out') + '/esm-import.txt', log.join('\n'), 'utf8');
}
