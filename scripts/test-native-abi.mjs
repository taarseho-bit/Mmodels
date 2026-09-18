/**
 * 在真实 Electron 里加载两个原生模块。
 * 纯 node 能 require 不代表 Electron 里能 —— ABI 必须与 Electron 的
 * NODE_MODULE_VERSION 一致，否则报 ERR_DLOPEN_FAILED。
 */
import { app } from 'electron';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const OUT = process.env.VERIFY_OUT || path.join(process.cwd(), 'out');
fs.mkdirSync(OUT, { recursive: true });  // ⚠️ 目录不存在时 writeFileSync 会 ENOENT
const log = [];
const write = () => fs.writeFileSync(path.join(OUT, 'native-abi.txt'), log.join('\n'), 'utf8');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

app.whenReady().then(() => {
  log.push('Electron  = ' + process.versions.electron);
  log.push('Chrome    = ' + process.versions.chrome);
  log.push('Node      = ' + process.versions.node);
  log.push('modules   = ' + process.versions.modules + '  ← NODE_MODULE_VERSION');
  log.push('arch      = ' + process.arch);
  log.push('');

  for (const mod of ['better-sqlite3', 'node-pty']) {
    try {
      const m = require(mod);
      if (mod === 'better-sqlite3') {
        // 真开一次内存库，确认不只是「加载成功」
        const db = new m(':memory:');
        db.exec('CREATE TABLE t(a INTEGER)');
        db.prepare('INSERT INTO t VALUES (?)').run(42);
        const row = db.prepare('SELECT a FROM t').get();
        db.close();
        log.push(`PASS  ${mod} 可加载且可执行（SELECT 得到 ${row.a}）`);
      } else {
        const keys = Object.keys(m).join(',');
        log.push(`PASS  ${mod} 可加载（导出 ${keys}）`);
        // 真起一个进程，确认伪终端可用
        const p = m.spawn('cmd.exe', ['/c', 'echo abi-ok'], {
          name: 'xterm-color',
          cols: 80,
          rows: 24,
          cwd: process.cwd(),
          env: process.env,
        });
        log.push(`      已启动 pty，pid=${p.pid}`);
        p.kill();
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      log.push(`FAIL  ${mod} 加载失败：${msg.slice(0, 300)}`);
      if (/NODE_MODULE_VERSION/.test(msg)) {
        log.push(`      → ABI 不匹配，需要用对应 Electron 版本重编原生模块`);
      }
    }
  }

  log.push('');
  const fails = log.filter((l) => l.startsWith('FAIL')).length;
  log.push(fails === 0 ? '结论：两个原生模块在 Electron 下均可用' : `结论：${fails} 个原生模块不可用`);
  write();
  app.quit();
}).catch((e) => {
  log.push('FATAL ' + (e && e.stack ? e.stack : String(e)));
  write();
  app.quit();
});
