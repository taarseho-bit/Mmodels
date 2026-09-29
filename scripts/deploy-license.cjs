#!/usr/bin/env node
/**
 * 会员授权服务的安全更新流程。
 *
 * 凭证只从 MM_SERVER_IP / MM_SERVER_USER / MM_SERVER_PASS 环境变量读取，
 * 不写入命令行参数、仓库或日志。执行前会把服务端文件和 db.json 备份到
 * /opt/mmodels/backups-deploy/<时间>/，然后做语法检查、原子替换、重启和本机健康检查。
 *
 * 用法：
 *   MM_SERVER_IP=... MM_SERVER_PASS=... node scripts/deploy-license.cjs
 *
 * 这是卡密服务的部署工具，不会修改用户数据，也不会覆盖 /etc/mmodels/license.env
 * 中的随机管理路径。第一次部署前请确认服务器已经有 mmodels 服务用户。
 */
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const remoteExec = path.join(__dirname, 'remote-exec.cjs');
const host = String(process.env.MM_SERVER_IP || '').trim();
const pass = String(process.env.MM_SERVER_PASS || '');
const user = String(process.env.MM_SERVER_USER || 'ubuntu').trim();
if (!host || !pass) {
  console.error('请通过 MM_SERVER_IP 和 MM_SERVER_PASS 环境变量提供部署凭证。');
  process.exit(2);
}

const env = { ...process.env, MM_SERVER_IP: host, MM_SERVER_PASS: pass, MM_SERVER_USER: user };
const files = [
  ['server/license-server.cjs', '/opt/mmodels/.incoming/license-server.cjs'],
  ['server/admin.html', '/opt/mmodels/.incoming/admin.html'],
  ['server/mmodels-license.service', '/opt/mmodels/.incoming/mmodels-license.service'],
];

function runRemote(mode, ...args) {
  const result = spawnSync(process.execPath, [remoteExec, mode, ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`远程步骤失败：${mode}`);
}

try {
  runRemote('exec', 'sudo install -d -m 700 /opt/mmodels/.incoming && sudo chown $(id -u):$(id -g) /opt/mmodels/.incoming');
  for (const [local, remote] of files) runRemote('b64', path.join(root, local), remote);

  const deploy = [
    'set -eu',
    'STAMP=$(date +%Y%m%d-%H%M%S)',
    'BACK=/opt/mmodels/backups-deploy/$STAMP',
    'sudo install -d -m 700 "$BACK"',
    'sudo cp -a /opt/mmodels/server.cjs /opt/mmodels/admin.html /etc/systemd/system/mmodels-license.service "$BACK/"',
    'sudo cp -a /opt/mmodels/data/db.json "$BACK/db.json" 2>/dev/null || true',
    'sudo id mmodels >/dev/null',
    'sudo node --check /opt/mmodels/.incoming/license-server.cjs',
    'sudo install -o root -g root -m 644 /opt/mmodels/.incoming/license-server.cjs /opt/mmodels/server.cjs',
    'sudo install -o root -g root -m 644 /opt/mmodels/.incoming/admin.html /opt/mmodels/admin.html',
    'sudo install -o root -g root -m 644 /opt/mmodels/.incoming/mmodels-license.service /etc/systemd/system/mmodels-license.service',
    'sudo -u mmodels env MM_DATA_DIR=/opt/mmodels/data node /opt/mmodels/server.cjs migrate',
    'sudo systemctl daemon-reload',
    'sudo systemctl restart mmodels-license.service',
    'sleep 2',
    'curl -fsS --max-time 10 http://127.0.0.1:8080/health >/tmp/mmodels-health.json',
    'grep -q \'"ok":true\' /tmp/mmodels-health.json',
    'rm -f /tmp/mmodels-health.json /opt/mmodels/.incoming/license-server.cjs /opt/mmodels/.incoming/admin.html /opt/mmodels/.incoming/mmodels-license.service',
    'printf "部署完成，备份目录：%s\\n" "$BACK"',
  ].join(' && ');
  runRemote('exec', deploy);
  console.log('授权服务更新完成；服务器数据和管理路径配置已保留。');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
