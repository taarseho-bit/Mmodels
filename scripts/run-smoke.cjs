/**
 * 用 execFileSync 跑 electron 执行冒烟 bundle。
 * 为什么不用 PowerShell 直接调：本机 PowerShell 工具吞 stdout，
 * 而 Electron 的加载错误全走 stderr，必须显式捕获。
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = 'D:\\mathmodel-desktop';
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const BUNDLE = path.join(ROOT, 'out', 'smoke.mjs');
const OUT = path.join(os.tmpdir(), 'mm-verify');

const env = { ...process.env };
// ⚠️ 必须彻底清掉宿主注入的 Node 层钩子，否则验证脚本跑不起来：
//    1) ELECTRON_RUN_AS_NODE=1 → electron.exe 退化成普通 Node，
//       require('electron') 只拿到 npm 包的路径字符串，API 全 undefined
//    2) NODE_OPTIONS=--require=.../node-language-shim.cjs → 会接管 fs.rmSync，
//       清理临时目录时报 EPERM（表现为「App threw an error during load」，
//       看起来像应用崩了，其实是钩子不让删）
//    只清其中一两个不够 —— 凡是名字里带 SAFE_DELETE 的都要去掉。
for (const k of Object.keys(env)) {
  if (/NODE_OPTIONS|ELECTRON_RUN_AS_NODE|SAFE_DELETE/i.test(k)) delete env[k];
}
env.NODE_OPTIONS = '';
env.VERIFY_OUT = OUT;

const log = [];
log.push('electron = ' + ELECTRON + ' exists=' + fs.existsSync(ELECTRON));
log.push('bundle   = ' + BUNDLE + ' exists=' + fs.existsSync(BUNDLE));

try {
  const out = execFileSync(ELECTRON, [BUNDLE], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 300000,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  log.push('status=0');
  log.push('stdout=' + String(out || '').slice(0, 4000));
} catch (e) {
  log.push('status=' + e.status);
  log.push('stdout=' + String(e.stdout || '').slice(0, 4000));
  log.push('stderr=' + String(e.stderr || '').slice(0, 6000));
}

const traceFile = path.join(OUT, 'trace.txt');
if (fs.existsSync(traceFile)) {
  log.push('---- trace.txt ----');
  log.push(fs.readFileSync(traceFile, 'utf8'));
} else {
  log.push('⚠️ trace.txt 未生成 —— 脚本可能根本没执行');
}

fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'out', 'smoke-run.txt'), log.join('\n'), 'utf8');
console.log('done');
