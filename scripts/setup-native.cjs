/**
 * 手动装配原生二进制 + Electron 二进制。
 *
 * 背景：pnpm 的 postinstall 会去 GitHub 拉 prebuild，本机对 GitHub 极慢
 * （实测首字节 3.7s，而 prebuild-install 默认 30s 超时），于是回退到
 * node-gyp 编译 —— 而本机没有 MSVC 编译器，必然失败。
 *
 * 解法：直接从 npmmirror 的 `-/binary/` 镜像拿现成的二进制包。
 * 我们已探测确认这些包存在且 HTTP 200。
 *
 * 这个脚本做三件事：
 *   1. electron: 用本地缓存 zip 解压到 dist/
 *   2. better-sqlite3: 按当前 Electron ABI 下载预编译包解压到 build/Release/
 *   3. node-pty: 已自带 prebuilds，跳过
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const NM = 'D:\\mathmodel-desktop\\node_modules\\.pnpm';
const out = [];
function packageDir(prefix) {
  try {
    const entry = fs.readdirSync(NM).find((x) => x.startsWith(prefix + '@'));
    return entry ? path.join(NM, entry, 'node_modules', prefix) : '';
  } catch { return ''; }
}
function packageVersion(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version; } catch { return ''; }
}
const electronPkgDir = packageDir('electron');
const electronVersion = packageVersion(electronPkgDir) || '43.3.0';
const electronMajor = Number(electronVersion.split('.')[0]);
// electron 43 对应 Node module ABI 148；未知主版本不猜，提示手动准备预编译包。
const electronAbi = ({ 33: 130, 34: 132, 35: 134, 36: 136, 37: 138, 38: 140, 39: 142, 40: 144, 41: 146, 42: 147, 43: 148, 44: 150 })[electronMajor];
function log(s) { out.push(s); }

// ─────────────────────────────────────────────────────────────
// 1. Electron
// ─────────────────────────────────────────────────────────────
function setupElectron() {
  const pkgDir = electronPkgDir;
  log('=== Electron ===');
  log('pkg dir: ' + pkgDir + '  exists=' + fs.existsSync(pkgDir));
  if (!fs.existsSync(pkgDir)) { log('  SKIP: pkg dir missing'); return; }

  const distDir = path.join(pkgDir, 'dist');
  const exe = path.join(distDir, 'electron.exe');
  if (fs.existsSync(exe)) { log('  已就位: ' + exe); return; }

  // 找本地缓存 zip
  const cacheDir = path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache');
  let zipPath = null;
  try {
    const files = fs.readdirSync(cacheDir).filter((f) => f.startsWith(`electron-v${electronMajor}`) && f.endsWith('.zip'));
    if (files.length) zipPath = path.join(cacheDir, files[0]);
  } catch (e) { log('  读缓存失败: ' + e.message); }

  if (!zipPath) { log(`  缓存里没有 electron-v${electronMajor} zip`); return; }
  log('  使用缓存 zip: ' + zipPath + '  (' + (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1) + ' MB)');

  // 用系统 tar 解压（Windows 10 自带 bsdtar，能解 zip）
  fs.mkdirSync(distDir, { recursive: true });
  try {
    execFileSync('tar', ['-xf', zipPath, '-C', distDir], { stdio: 'pipe' });
    log('  解压完成');
  } catch (e) {
    log('  tar 解压失败: ' + (e.stderr ? String(e.stderr).slice(0, 300) : e.message));
    return;
  }

  // 写 path.txt（electron 包用它定位可执行文件）
  try {
    fs.writeFileSync(path.join(pkgDir, 'path.txt'), 'electron.exe', 'utf8');
    log('  写入 path.txt');
  } catch (e) { log('  path.txt 写入失败: ' + e.message); }

  log('  electron.exe: ' + (fs.existsSync(exe) ? fs.statSync(exe).size + ' bytes' : 'STILL MISSING'));
}

// ─────────────────────────────────────────────────────────────
// 2. better-sqlite3（当前 Electron ABI 预编译包）
// ─────────────────────────────────────────────────────────────
async function setupBetterSqlite3() {
  const pkgDir = packageDir('better-sqlite3');
  log('');
  log('=== better-sqlite3 ===');
  log('pkg dir: ' + pkgDir + '  exists=' + fs.existsSync(pkgDir));
  if (!fs.existsSync(pkgDir)) { log('  SKIP: pkg dir missing'); return; }

  const target = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
  if (fs.existsSync(target)) { log('  已就位: ' + target); return; }

  if (!electronAbi) { log(`  未知 Electron ${electronVersion} 的 ABI，跳过自动下载`); return; }
  const sqliteVersion = packageVersion(pkgDir) || '12.11.1';
  // 国内镜像上的对应 Electron ABI 预编译包
  const url =
    `https://registry.npmmirror.com/-/binary/better-sqlite3/v${sqliteVersion}/` +
    `better-sqlite3-v${sqliteVersion}-electron-v${electronAbi}-win32-x64.tar.gz`;

  const tmp = path.join('D:\\mathmodel-desktop', '.cache', 'better-sqlite3-prebuilt.tar.gz');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });

  log('  下载: ' + url);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
    if (!res.ok) { log('  HTTP ' + res.status); return; }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmp, buf);
    log('  下载完成: ' + (buf.length / 1024).toFixed(0) + ' KB');
  } catch (e) {
    log('  下载失败: ' + e.message);
    return;
  }

  const releaseDir = path.join(pkgDir, 'build', 'Release');
  fs.mkdirSync(releaseDir, { recursive: true });
  try {
    execFileSync('tar', ['-xzf', tmp, '-C', releaseDir], { stdio: 'pipe' });
    log('  解压完成');
  } catch (e) {
    log('  tar 解压失败: ' + (e.stderr ? String(e.stderr).slice(0, 300) : e.message));
    return;
  }

  log('  better_sqlite3.node: ' + (fs.existsSync(target) ? fs.statSync(target).size + ' bytes' : 'STILL MISSING'));
  // 列表看看解出什么
  try { log('  Release/ 内容: ' + fs.readdirSync(releaseDir).join(', ')); } catch {}
}

// ─────────────────────────────────────────────────────────────
// 3. node-pty（自带 prebuilds，只需验证）
// ─────────────────────────────────────────────────────────────
function checkNodePty() {
  log('');
  log('=== node-pty ===');
  const pkgDir = packageDir('node-pty');
  const pre = path.join(pkgDir, 'prebuilds', 'win32-x64', 'pty.node');
  log('  pty.node: ' + (fs.existsSync(pre) ? fs.statSync(pre).size + ' bytes' : 'MISSING'));
  const conpty = path.join(pkgDir, 'third_party', 'conpty');
  try {
    const versions = fs.readdirSync(conpty);
    log('  conpty 版本: ' + versions.join(', '));
    for (const v of versions) {
      const x64 = path.join(conpty, v, 'win10-x64');
      if (fs.existsSync(x64)) log('    ' + v + '/win10-x64: ' + fs.readdirSync(x64).join(', '));
    }
  } catch (e) { log('  conpty err: ' + e.message); }
}

(async () => {
  try {
    setupElectron();
    await setupBetterSqlite3();
    checkNodePty();
  } catch (e) {
    log('FATAL: ' + (e.stack || e.message));
  }
  fs.writeFileSync('D:\\mathmodel-desktop\\.native-setup.txt', out.join('\r\n'), 'utf8');
  console.log('done');
})();
