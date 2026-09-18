/**
 * 为 Electron 43 重建 better-sqlite3。
 *
 * 策略：先试 prebuild-install（下载官方预编译，最快、不需要编译器），
 * 失败再退回 node-gyp 从源码编（本机有 VS 2022 + Python，可行但慢）。
 *
 * ⚠️ better-sqlite3 用 NAN（不是 N-API），二进制与 ABI 强绑定：
 *    旧的是 ABI 130（Electron 33），Electron 43 要 148，不重编必然加载失败。
 *    （node-pty 是 N-API，跨 ABI 稳定，所以不用重建 —— 实测确认过。）
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'D:/mathmodel-desktop';
const NODE = 'C:/Users/xh/.workbuddy/binaries/node/versions/22.22.2-3/node.exe';
const ELECTRON_VER = '43.3.0';

const pkgDir = path.join(
  ROOT,
  'node_modules/.pnpm/better-sqlite3@12.11.1/node_modules/better-sqlite3',
);
console.log('包目录:', pkgDir, '存在:', fs.existsSync(pkgDir));

const env = { ...process.env };
env.NODE_OPTIONS = '';
delete env.ELECTRON_RUN_AS_NODE;
env.npm_config_runtime = 'electron';
env.npm_config_target = ELECTRON_VER;
env.npm_config_disturl = 'https://electronjs.org/headers';
env.npm_config_arch = 'x64';

const prebuild = path.join(ROOT, 'node_modules/.pnpm/prebuild-install@7.1.3/node_modules/prebuild-install/bin.js');

function run(label, cmd, args, cwd) {
  console.log('\n──── ' + label + ' ────');
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 900000,
    });
    console.log('EXIT=0');
    console.log(String(out).slice(-2500));
    return true;
  } catch (e) {
    console.log('EXIT=' + e.status);
    console.log('STDOUT:\n' + String(e.stdout || '').slice(-2500));
    console.log('STDERR:\n' + String(e.stderr || '').slice(-2500));
    return false;
  }
}

// 1) 先清掉旧产物，避免「看起来成功了其实还用旧的」
const oldNode = path.join(pkgDir, 'build/Release/better_sqlite3.node');
if (fs.existsSync(oldNode)) {
  const bak = oldNode + '.abi130.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(oldNode, bak);
  fs.rmSync(oldNode, { force: true });
  console.log('已移走旧的 ABI 130 产物（备份为 .abi130.bak）');
}

// 2) 试 prebuild-install
const okPrebuild = run(
  'prebuild-install（下载 Electron 43 / ABI 148 预编译）',
  NODE,
  [prebuild, '--runtime=electron', '--target=' + ELECTRON_VER, '--arch=x64', '--verbose'],
  pkgDir,
);

// 3) 失败则 node-gyp 从源码编
let okGyp = false;
if (!okPrebuild || !fs.existsSync(oldNode)) {
  // 实际存在的 node-gyp（pnpm 布局）
  // ⚠️ 必须用 node-gyp ≥10：node-gyp 9 依赖 Python 的 distutils，
  //    而 Python 3.12+ 已移除 distutils，会直接 ModuleNotFoundError。
  const cands = [
    path.join(ROOT, 'node_modules/.pnpm/node-gyp@11.5.0/node_modules/node-gyp/bin/node-gyp.js'),
    path.join(ROOT, 'node_modules/.pnpm/node-gyp@9.4.1/node_modules/node-gyp/bin/node-gyp.js'),
  ];
  const gypBin = cands.find((c) => fs.existsSync(c)) || cands[0];
  console.log('\nnode-gyp 入口:', gypBin, '存在:', fs.existsSync(gypBin));
  if (fs.existsSync(gypBin)) {
    okGyp = run(
      'node-gyp rebuild（从源码编译）',
      NODE,
      [gypBin, 'rebuild', '--release', '--runtime=electron', '--target=' + ELECTRON_VER, '--arch=x64', '--dist-url=https://electronjs.org/headers'],
      pkgDir,
    );
  }
}

// 4) 校验
console.log('\n──────── 结果 ────────');
console.log('better_sqlite3.node 存在:', fs.existsSync(oldNode));
if (fs.existsSync(oldNode)) {
  console.log('体积:', (fs.statSync(oldNode).size / 1048576).toFixed(2) + ' MB');
  const buf = fs.readFileSync(oldNode);
  const hits = [...buf.toString('latin1').matchAll(/NODE_MODULE_VERSION (\d+)/g)].map((m) => m[1]);
  console.log('二进制内的 ABI 标记:', hits.length ? [...new Set(hits)].join(',') : '（未内嵌，靠加载时校验）');
}
