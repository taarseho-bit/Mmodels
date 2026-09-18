/**
 * 手动跑 electron 的 postinstall（下载二进制）。
 *
 * pnpm 10 默认**不执行依赖的 build script**，只打一条
 * 「Ignored build scripts: electron, …」的警告就过去了 ——
 * 结果是 `node_modules/electron/dist/electron.exe` 根本不存在，
 * 但 `require('electron/package.json').version` 照样能读到新版本号，
 * 于是「看起来升级成功了」。这个坑很隐蔽。
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'D:/mathmodel-desktop';
const NODE = 'C:/Users/xh/.workbuddy/binaries/node/versions/22.22.2-3/node.exe';

const env = { ...process.env };
env.NODE_OPTIONS = '';
delete env.ELECTRON_RUN_AS_NODE;

// electron 的安装脚本
const installer = path.join(ROOT, 'node_modules', 'electron', 'install.js');
console.log('installer 存在:', fs.existsSync(installer));

try {
  const out = execFileSync(NODE, [installer], {
    cwd: path.join(ROOT, 'node_modules', 'electron'),
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 900000,
  });
  console.log('EXIT=0');
  console.log(String(out).slice(-2000));
} catch (e) {
  console.log('EXIT=' + e.status);
  console.log('STDOUT:\n' + String(e.stdout || '').slice(-3000));
  console.log('STDERR:\n' + String(e.stderr || '').slice(-3000));
}

// 校验
const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
console.log('\ndist/electron.exe:', fs.existsSync(exe) ? 'OK' : '仍缺失');
if (fs.existsSync(exe)) {
  console.log('体积:', (fs.statSync(exe).size / 1048576).toFixed(1) + ' MB');
}
const pathTxt = path.join(ROOT, 'node_modules', 'electron', 'path.txt');
if (fs.existsSync(pathTxt)) console.log('path.txt =', fs.readFileSync(pathTxt, 'utf8').trim());
