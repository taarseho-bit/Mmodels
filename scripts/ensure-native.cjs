/**
 * 安装后自愈：确保 Electron 二进制与原生模块**真的可用**。
 *
 * ⚠️ 为什么需要这个：
 *   pnpm 10 默认不执行依赖的 build script，而且只打一条警告就过去了。
 *   后果极其隐蔽 —— `require('electron/package.json').version` 照样显示新版本号，
 *   但 `node_modules/electron/dist/electron.exe` 根本没下载；
 *   原生模块同理，装完没有 .node，直到运行时才炸。
 *
 *   放行清单写在 `.npmrc`（onlyBuiltDependencies[]=…）、`pnpm-workspace.yaml`
 *   与 `package.json` 的 pnpm 字段里，**在 pnpm 10.18.0 上实测都不生效**。
 *   所以这里做一道确定性自检：缺什么就补什么，补不上就明确报错。
 *
 * 挂载点：package.json 的 "postinstall"（pnpm 会执行**根项目**的 postinstall，
 * 不受 onlyBuiltDependencies 限制 —— 那是针对依赖的）。
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const log = [];
const step = (s) => {
  log.push(s);
  console.log(s);
};

/** 找出 electron 包的真实位置（pnpm 会在 .pnpm 下） */
function findElectronPkg() {
  const direct = path.join(ROOT, 'node_modules', 'electron', 'package.json');
  if (fs.existsSync(direct)) return path.dirname(direct);
  const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) return null;
  const hit = fs
    .readdirSync(pnpmDir)
    .filter((d) => d.startsWith('electron@'))
    .sort()
    .pop();
  if (!hit) return null;
  const p = path.join(pnpmDir, hit, 'node_modules', 'electron');
  return fs.existsSync(path.join(p, 'package.json')) ? p : null;
}

let failed = false;

// ── 1. Electron 二进制 ──
{
  const pkgDir = findElectronPkg();
  if (!pkgDir) {
    step('✗ 找不到 electron 包，请先运行安装');
    failed = true;
  } else {
    const exe = path.join(pkgDir, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
    if (fs.existsSync(exe)) {
      const ver = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
      step(`✓ Electron ${ver} 二进制就位（${(fs.statSync(exe).size / 1048576).toFixed(0)} MB）`);
    } else {
      step('… Electron 二进制缺失（pnpm 跳过了 postinstall），正在补下载');
      try {
        const installer = path.join(pkgDir, 'install.js');
        execFileSync(process.execPath, [installer], {
          cwd: pkgDir,
          stdio: 'inherit',
          timeout: 900000,
          env: { ...process.env, NODE_OPTIONS: '' },
        });
        step(fs.existsSync(exe) ? '✓ 已补齐 Electron 二进制' : '✗ 补齐失败');
        if (!fs.existsSync(exe)) failed = true;
      } catch (e) {
        step('✗ 补下载 Electron 失败：' + (e && e.message));
        failed = true;
      }
    }
  }
}

// ── 2. 原生模块能否真的加载 ──
const NATIVE = ['better-sqlite3', 'node-pty'];
for (const mod of NATIVE) {
  try {
    require(mod);
    step(`✓ ${mod} 可加载`);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/NODE_MODULE_VERSION|ERR_DLOPEN_FAILED/.test(msg)) {
      step(`✗ ${mod} ABI 不匹配 —— 需要用对应 Electron 版本重编：`);
      step('    node scripts/rebuild-native.cjs');
    } else {
      step(`✗ ${mod} 加载失败：${msg.slice(0, 200)}`);
    }
    failed = true;
  }
}

if (failed) {
  step('');
  step('⚠️ 环境自检未通过。上面每一条都给了修复方向，按提示处理后重新运行安装即可。');
  // 用 0 退出：这是「提醒」而不是「安装失败」，
  // 直接失败会让 CI / 首次 clone 的流程整体中断，反而更难处理。
  process.exit(0);
}
step('');
step('环境自检通过。');
