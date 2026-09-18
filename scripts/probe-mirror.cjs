/**
 * 探测 npmmirror 上 better-sqlite3 / node-pty 的 prebuild 可用性
 * 只发 HEAD/GET 拿状态码，不下载。
 */
const targets = [
  // better-sqlite3 prebuild 约定路径: {host}/v{version}/better-sqlite3-v{version}-node-v{abi}-{platform}-{arch}.tar.gz
  'https://registry.npmmirror.com/-/binary/better-sqlite3/v12.11.1/better-sqlite3-v12.11.1-node-v115-win32-x64.tar.gz',
  'https://registry.npmmirror.com/-/binary/better-sqlite3/v12.11.1/better-sqlite3-v12.11.1-node-v127-win32-x64.tar.gz',
  'https://registry.npmmirror.com/-/binary/better-sqlite3/v12.11.1/better-sqlite3-v12.11.1-node-v108-win32-x64.tar.gz',
  // node-pty 是否有 prebuilds
  'https://registry.npmmirror.com/-/binary/node-pty/',
  'https://registry.npmmirror.com/-/binary/better-sqlite3/',
  // GitHub 原始地址对照
  'https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/better-sqlite3-v12.11.1-node-v127-win32-x64.tar.gz',
];

async function probe(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const ms = Date.now() - t0;
    let len = res.headers.get('content-length') || '?';
    // 读一点点就够判断
    return `${res.status}  ${ms}ms  len=${len}  ${url}`;
  } catch (e) {
    const ms = Date.now() - t0;
    return `ERR   ${ms}ms  ${e.name}: ${String(e.message).slice(0, 60)}  ${url}`;
  }
}

(async () => {
  const fs = require('fs');
  const out = [];
  for (const t of targets) {
    out.push(await probe(t));
  }
  fs.writeFileSync('D:\\mathmodel-desktop\\.probe-mirror.txt', out.join('\r\n'), 'utf8');
  console.log('done');
})();
