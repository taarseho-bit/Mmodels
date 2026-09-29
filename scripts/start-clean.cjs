/**
 * 干净环境启动器：每次都用一份全新的数据目录启动应用，
 * 让「首次启动」的界面（引导 / 欢迎页 / 未登录态）重新出现，便于反复验收。
 *
 * 用法（也可以直接双击仓库根目录的「干净环境测试.bat」）：
 *   npm run start:clean          打包版（dist/win-unpacked/MModels.exe）
 *   npm run start:clean -- --dev 开发版（electron-vite dev，改代码即时生效）
 *
 * 说明：
 * - 数据目录按时间戳新建，互不干扰；运行结束后只保留最近 3 份，其余自动清理。
 * - 同时设置 MATHMODEL_E2E=1：新建的项目落在测试目录里，不会污染真实工作区。
 * - 与日常使用的正式版并存（单实例锁按 userData 路径算），不会互相抢锁。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BASE_DIR = path.join(ROOT, '.tmp', 'clean-test-data');
const PACKAGED_APP = path.join(ROOT, 'dist', 'win-unpacked', 'MModels.exe');
const KEEP_RUNS = 3;

const args = process.argv.slice(2);
const useDev = args.includes('--dev');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 只保留最近几次运行的数据目录，避免越攒越多。 */
function pruneOldRuns(keep) {
  let runs = [];
  try {
    runs = fs.readdirSync(BASE_DIR)
      .filter((name) => fs.statSync(path.join(BASE_DIR, name)).isDirectory())
      .sort();
  } catch {
    return;
  }
  for (const name of runs.slice(0, Math.max(0, runs.length - KEEP_RUNS))) {
    if (name === keep) continue;
    try {
      fs.rmSync(path.join(BASE_DIR, name), { recursive: true, force: true });
    } catch {
      /* 上一份实例还开着就跳过，下次再清 */
    }
  }
}

/** 清掉会干扰 Electron 的环境变量（ELECTRON_RUN_AS_NODE 会让它退化成普通 Node）。 */
function cleanEnv() {
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|SAFE_DELETE_.*)$/i.test(key)) continue;
    env[key] = process.env[key];
  }
  env.NODE_OPTIONS = '';
  return env;
}

const dataDir = path.join(BASE_DIR, stamp());

try {
  fs.mkdirSync(dataDir, { recursive: true });
} catch (error) {
  console.error('[clean] 无法创建测试数据目录：' + (error instanceof Error ? error.message : error));
  process.exit(1);
}

const env = cleanEnv();
env.MATHMODEL_USERDATA = dataDir;
// E2E 开关：新建项目落测试目录，避免写进真实工作区；也允许脚本带调试参数。
env.MATHMODEL_E2E = '1';

console.log('[clean] 数据目录 : ' + dataDir);
console.log('[clean] 每次启动都是全新数据，因此首次引导 / 欢迎页会重新出现。');

if (useDev) {
  console.log('[clean] 目标     : 开发版（electron-vite dev，改代码即时生效）');
  console.log('[clean] 关闭窗口或按 Ctrl+C 结束。\n');
  const child = spawn('npm', ['run', 'dev'], { cwd: ROOT, env, stdio: 'inherit', shell: true });
  child.on('exit', (code) => {
    pruneOldRuns(path.basename(dataDir));
    process.exit(code ?? 0);
  });
} else {
  if (!fs.existsSync(PACKAGED_APP)) {
    console.error('[clean] 找不到打包产物：' + PACKAGED_APP);
    console.error('[clean] 先跑 npm run pack:dir，或改用 npm run start:clean -- --dev');
    process.exit(1);
  }
  console.log('[clean] 目标     : ' + PACKAGED_APP);
  console.log('[clean] 这个数据目录里的项目不会出现在日常用的正式版里。\n');
  const child = spawn(PACKAGED_APP, ['--user-data-dir=' + dataDir], {
    cwd: path.dirname(PACKAGED_APP),
    env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  pruneOldRuns(path.basename(dataDir));
}