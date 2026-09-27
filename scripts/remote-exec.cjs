#!/usr/bin/env node
/**
 * 远程执行工具：经 SSH 在腾讯云轻量服务器上执行命令或上传文件。
 *
 * 用法：
 *   node remote-exec.cjs exec  "命令"                  执行单条 shell 命令
 *   node remote-exec.cjs put    <本地文件> <远端路径>   上传文件（sftp，本服务器 fastPut 失效勿用）
 *   node remote-exec.cjs script <本地脚本>              上传脚本到 /tmp 并 bash 执行
 *   node remote-exec.cjs b64    <本地文件> <远端路径>   base64 分块上传（推荐，绕过 sftp/argv 限制）
 *
 * 凭证从环境变量读：MM_SERVER_IP / MM_SERVER_PASS
 * 依赖：ssh2（NODE_PATH 指向受管 node workspace 的 node_modules）
 */
'use strict';
const { Client } = require('ssh2');
const fs = require('node:fs');
const path = require('node:path');

const HOST = process.env.MM_SERVER_IP;
const PASS = process.env.MM_SERVER_PASS;
const USER = process.env.MM_SERVER_USER || 'ubuntu';
const [,, mode, a, b] = process.argv;

function assertRemotePath(value) {
  const p = String(value || '');
  // put/b64 的目标不是 shell 命令，仍限制在部署目录或临时上传目录，避免
  // 误把任意用户输入拼进 sudo tee 后写覆盖系统文件。
  if (!/^\/opt\/mmodels(?:\/|$)/.test(p) && !/^\/tmp\/mm-(?:up-|script-)/.test(p)) {
    throw new Error('远端路径必须位于 /opt/mmodels 或受控 /tmp/mm-* 目录');
  }
  return p;
}

if (!HOST || !PASS || !mode) {
  console.error('usage: remote-exec.cjs exec|put|script ... (need MM_SERVER_IP/MM_SERVER_PASS)');
  process.exit(2);
}

const conn = new Client();
const timer = setTimeout(() => { console.error('TIMEOUT: ssh connect/exec > 120s'); process.exit(3); }, 120_000);

conn.on('ready', () => {
  if (mode === 'exec') {
    conn.exec(a, (err, stream) => {
      if (err) { console.error('EXEC_ERR', err.message); process.exit(3); }
      let out = '', errOut = '', code = 0;
      stream.on('close', (c) => {
        code = c;
        if (out) process.stdout.write(out);
        if (errOut) process.stderr.write(errOut);
        clearTimeout(timer); conn.end();
        process.exit(code === 0 ? 0 : 1);
      }).on('data', (d) => { out += d; })
        .stderr.on('data', (d) => { errOut += d; });
    });
  } else if (mode === 'put') {
    try { assertRemotePath(b); } catch (e) { console.error('PATH_ERR', e.message); process.exit(2); }
    conn.sftp((err, sftp) => {
      if (err) { console.error('SFTP_ERR', err.message); process.exit(3); }
      sftp.fastPut(a, b, (e) => {
        clearTimeout(timer); conn.end();
        if (e) { console.error('PUT_ERR', e.message); process.exit(3); }
        console.log('PUT_OK', a, '->', b);
        process.exit(0);
      });
    });
  } else if (mode === 'script') {
    const remote = '/tmp/mm-' + Date.now() + '-' + path.basename(a);
    conn.sftp((err, sftp) => {
      if (err) { console.error('SFTP_ERR', err.message); process.exit(3); }
      sftp.fastPut(a, remote, (e) => {
        if (e) { console.error('PUT_ERR', e.message); process.exit(3); }
        conn.exec(`bash ${remote}; RC=$?; rm -f ${remote}; exit $RC`, (e2, stream) => {
          if (e2) { console.error('EXEC_ERR', e2.message); process.exit(3); }
          let out = '', errOut = '';
          stream.on('close', (c) => {
            if (out) process.stdout.write(out);
            if (errOut) process.stderr.write(errOut);
            clearTimeout(timer); conn.end();
            process.exit(c === 0 ? 0 : 1);
          }).on('data', (d) => { out += d; })
            .stderr.on('data', (d) => { errOut += d; });
        });
      });
    });
  } else if (mode === 'b64') {
    let safeTarget;
    try { safeTarget = assertRemotePath(b); } catch (e) { console.error('PATH_ERR', e.message); process.exit(2); }
    // base64 分块上传：printf 追加 → 远端 base64 -d 落盘（base64 字符集无单引号，可安全内插）
    const b64 = fs.readFileSync(a).toString('base64');
    const CH = 24000;
    const parts = [];
    for (let i = 0; i < b64.length; i += CH) parts.push(b64.slice(i, i + CH));
    const tmp = '/tmp/mm-up-' + Date.now() + '.b64';
    const run = (cmd) => new Promise((resolve, reject) => {
      conn.exec(cmd, (e, stream) => {
        if (e) return reject(e);
        let out = '', errOut = '';
        stream.on('close', (c) => resolve({ c, out, errOut }))
          .on('data', (d) => { out += d; })
          .stderr.on('data', (d) => { errOut += d; });
      });
    });
    (async () => {
      try {
        await run(`rm -f ${tmp}`);
        for (const p of parts) await run(`printf '%s' '${p}' >> ${tmp}`);
        const quoted = `'${safeTarget.replaceAll("'", "'\\''")}'`;
        const fin = await run(`base64 -d ${tmp} | sudo tee -- ${quoted} >/dev/null && rm -f ${tmp} && echo B64_OK`);
        const ok = fin.out.includes('B64_OK');
        if (ok) console.log('B64_OK', a, '->', b, `(${parts.length} chunks)`);
        else console.error('B64_FAIL', fin.errOut || fin.out);
        clearTimeout(timer); conn.end();
        process.exit(ok ? 0 : 1);
      } catch (e) { console.error('B64_ERR', e.message); process.exit(3); }
    })();
  } else {
    console.error('unknown mode', mode);
    process.exit(2);
  }
}).on('error', (e) => {
  clearTimeout(timer);
  console.error('SSH_ERR', e.level || '', e.message);
  process.exit(3);
}).connect({
  host: HOST,
  port: 22,
  username: USER,
  password: PASS,
  readyTimeout: 30_000,
  tryKeyboard: false,
});
