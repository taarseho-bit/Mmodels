/**
 * 1) 确认 Electron 33 的 Node/ABI 版本
 * 2) 判断 better-sqlite3 需要哪种 prebuild
 */
const fs = require('fs');
const out = [];

// Electron 33.4.x -> Node 20.18.0, ABI 130
// 权威来源: electron/releases 的 dependencies
const matrix = [
  { electron: '33.x', node: '20.18.0', abi: 130, modules: 130 },
  { electron: '32.x', node: '20.17.0', abi: 128, modules: 128 },
  { electron: '31.x', node: '20.15.0', abi: 125, modules: 125 },
  { electron: '30.x', node: '20.11.0', abi: 123, modules: 123 },
];
out.push('=== Electron ABI 对照表 ===');
for (const m of matrix) {
  out.push(`${m.electron}  node ${m.node}  ABI ${m.abi}`);
}
out.push('');
out.push('=== 本机 Node ===');
out.push(`process.versions.node = ${process.versions.node}`);
out.push(`process.versions.modules = ${process.versions.modules}`);

// 检查镜像上是否有 electron ABI 130 的 better-sqlite3 prebuild
const urls = [
  'https://registry.npmmirror.com/-/binary/better-sqlite3/v12.11.1/better-sqlite3-v12.11.1-electron-v130-win32-x64.tar.gz',
  'https://registry.npmmirror.com/-/binary/better-sqlite3/v12.11.1/better-sqlite3-v12.11.1-electron-v125-win32-x64.tar.gz',
  'https://registry.npmmirror.com/-/binary/better-sqlite3/v11.10.0/better-sqlite3-v11.10.0-electron-v130-win32-x64.tar.gz',
  'https://registry.npmmirror.com/-/binary/better-sqlite3/v12.4.1/better-sqlite3-v12.4.1-electron-v130-win32-x64.tar.gz',
];

(async () => {
  out.push('');
  out.push('=== better-sqlite3 Electron-ABI prebuild 探测 ===');
  for (const u of urls) {
    try {
      const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
      out.push(`${res.status}  len=${res.headers.get('content-length') || '?'}  ${u}`);
    } catch (e) {
      out.push(`ERR ${e.name}  ${u}`);
    }
  }
  fs.writeFileSync('D:\\mathmodel-desktop\\.probe-abi.txt', out.join('\r\n'), 'utf8');
  console.log('done');
})();
