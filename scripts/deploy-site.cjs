#!/usr/bin/env node
/**
 * 营销站一键部署：把 docs/ 打包上传到服务器，替换 /opt/mmodels/site 并自检。
 *
 * 用法：
 *   npm run deploy:site                 # 部署 docs/
 *   node scripts/deploy-site.cjs <目录>  # 部署指定目录（默认 docs）
 *
 * 凭证读取顺序：环境变量 MM_SERVER_IP / MM_SERVER_PASS
 *            → 项目根目录 .env（已被 .gitignore 忽略）
 *
 * 部署方式：上传 tar.gz → 解压到 site-new → 原子替换 site（先清空旧目录，
 * 这样删掉的文件不会残留），Caddy 无需重启（root 路径字符串未变）。
 */
'use strict';
const { Client } = require('ssh2');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(ROOT, process.argv[2] || 'docs');
const REMOTE_TGZ = '/opt/mmodels/site.tgz';
const TMP_TGZ = path.join(os.tmpdir(), `mm-site-${Date.now()}.tgz`);

function loadEnvFile() {
  // 极简 .env 解析：只认 KEY=VALUE，够用且不引入依赖。
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const fileEnv = loadEnvFile();
const HOST = process.env.MM_SERVER_IP || fileEnv.MM_SERVER_IP;
const PASS = process.env.MM_SERVER_PASS || fileEnv.MM_SERVER_PASS;
const USER = process.env.MM_SERVER_USER || fileEnv.MM_SERVER_USER || 'ubuntu';

if (!fs.existsSync(SRC_DIR) || !fs.existsSync(path.join(SRC_DIR, 'index.html'))) {
  console.error(`[deploy-site] 源目录无效或缺少 index.html: ${SRC_DIR}`);
  process.exit(2);
}
if (!HOST || !PASS) {
  console.error('[deploy-site] 缺少凭证：请设置 MM_SERVER_IP / MM_SERVER_PASS，或在项目根目录 .env 中配置。');
  process.exit(2);
}

function pack() {
  console.log(`[deploy-site] 打包 ${SRC_DIR} ...`);
  // 用系统 tar（Windows 10+ 自带 bsdtar）；-C 保证压缩包内是站点根内容。
  const r = spawnSync('tar', ['-czf', TMP_TGZ, '-C', SRC_DIR, '.'], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('[deploy-site] tar 打包失败（请确认系统有 tar 命令）');
    process.exit(3);
  }
  const mb = (fs.statSync(TMP_TGZ).size / 1048576).toFixed(1);
  console.log(`[deploy-site] 打包完成 ${mb} MB`);
}

const REMOTE_SCRIPT = `
set -euo pipefail
SITE=/opt/mmodels/site
NEW=/opt/mmodels/site-new
sudo rm -rf "\$NEW"
sudo mkdir -p "\$NEW"
sudo tar -xzf ${REMOTE_TGZ} -C "\$NEW"
sudo chown -R ${USER}:${USER} "\$NEW"

# 原子替换：旧的先挪走再删除，避免解压失败时站点变空
sudo rm -rf "\${SITE}.old"
if [ -d "\$SITE" ]; then sudo mv "\$SITE" "\${SITE}.old"; fi
sudo mv "\$NEW" "\$SITE"
sudo rm -rf "\${SITE}.old"
sudo rm -f ${REMOTE_TGZ}

echo "FILES=\$(find "\$SITE" -type f | wc -l)"
test -f "\$SITE/index.html" && echo CHK_INDEX_OK
test -f "\$SITE/group.js" && echo CHK_GROUP_OK
echo "--- 本机自检 ---"
curl -s -o /dev/null -w "mmodel.top=%{http_code}\\n" --resolve mmodel.top:443:127.0.0.1 https://mmodel.top/
curl -s --resolve mmodel.top:443:127.0.0.1 https://mmodel.top/ | grep -o '<title>[^<]*</title>' | head -1
`;

function execScript(conn, script) {
  return new Promise((resolve, reject) => {
    conn.exec('bash -s', (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('close', (code) => resolve({ code, out, errOut }))
        .on('data', (d) => { out += d; })
        .stderr.on('data', (d) => { errOut += d; });
      stream.end(script);
    });
  });
}

function cleanup() {
  try { if (fs.existsSync(TMP_TGZ)) fs.unlinkSync(TMP_TGZ); } catch { /* ignore */ }
}

pack();

const conn = new Client();
const timer = setTimeout(() => {
  console.error('[deploy-site] 超时（SSH 上传/执行 > 5 分钟）');
  cleanup();
  process.exit(4);
}, 300_000);

conn.on('ready', () => {
  console.log('[deploy-site] SSH 已连接，上传中 ...');
  conn.sftp((err, sftp) => {
    if (err) { console.error('[deploy-site] SFTP 失败', err.message); clearTimeout(timer); cleanup(); process.exit(3); }
    sftp.fastPut(TMP_TGZ, REMOTE_TGZ, async (e) => {
      if (e) { console.error('[deploy-site] 上传失败', e.message); clearTimeout(timer); conn.end(); cleanup(); process.exit(3); }
      console.log('[deploy-site] 上传完成，远端替换中 ...');
      try {
        const r = await execScript(conn, REMOTE_SCRIPT);
        if (r.out) process.stdout.write(r.out);
        if (r.errOut) process.stderr.write(r.errOut);
        clearTimeout(timer);
        conn.end();
        cleanup();
        if (r.code === 0 && r.out.includes('CHK_INDEX_OK')) {
          console.log('[deploy-site] 部署成功：https://mmodel.top');
          process.exit(0);
        }
        console.error('[deploy-site] 远端执行失败，退出码', r.code);
        process.exit(1);
      } catch (e2) {
        console.error('[deploy-site] 远端执行异常', e2.message);
        clearTimeout(timer); conn.end(); cleanup();
        process.exit(3);
      }
    });
  });
}).on('error', (e) => {
  clearTimeout(timer); cleanup();
  console.error('[deploy-site] SSH 连接失败', e.level || '', e.message);
  process.exit(3);
}).connect({
  host: HOST,
  port: 22,
  username: USER,
  password: PASS,
  readyTimeout: 30_000,
  tryKeyboard: false,
});