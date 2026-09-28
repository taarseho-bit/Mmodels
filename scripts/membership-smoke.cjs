/* 会员服务端闭环冒烟测试：不发送邮件，直接构造一个已过试用期的免费账号。 */
'use strict';
const { spawn } = require('node:child_process');
const { createHash, createHmac, randomBytes, scryptSync } = require('node:crypto');
const { existsSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const data = join(root, 'server', '.membership-smoke');
const port = 49152;
const device = 'smoke-device-0123456789';
const secret = randomBytes(32).toString('hex');
const password = 'SmokePass123!';
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
const passHash = `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
const now = Date.now();
const user = {
  name: 'smoke', passHash, tokenVersion: 1, createdAt: now - 10 * 86_400_000,
  expiresAt: 0, trialExpiresAt: now - 86_400_000, plan: 'free', points: 600,
  pointsAwards: {}, quota: { date: '', used: 0, bonus: 0, consumed: {} },
  checkinDate: '', banned: false, deviceId: device,
};
mkdirSync(data, { recursive: true });
writeFileSync(join(data, 'secret'), secret, { mode: 0o600 });
writeFileSync(join(data, 'admin-auth'), 'admin:smoke-pass', { mode: 0o600 });
writeFileSync(join(data, 'db.json'), JSON.stringify({ cards: {}, redemptions: {}, users: { smoke: user }, events: [] }));
const body = Buffer.from(JSON.stringify({ username: 'smoke', deviceId: device, expiresAt: now + 365 * 86_400_000, tokenVersion: 1 })).toString('base64url');
const token = `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/license-server.cjs'], { cwd: root, env: { ...process.env, MM_DATA_DIR: data, MM_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stdout.on('data', (b) => { logs += b.toString(); });
child.stderr.on('data', (b) => { logs += b.toString(); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function post(path, payload = {}) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-mmodels-device': device }, body: JSON.stringify(payload) });
  return { status: res.status, body: await res.json() };
}
async function run() {
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await sleep(100); }
    const first = await post('/api/license/check', { feature: 'ai-chat', requestId: 'smoke-0001', consume: true });
    if (first.status !== 200 || first.body.allowed !== true || first.body.aiQuota.remaining !== 9) throw new Error('首次额度扣减失败');
    for (let i = 2; i <= 10; i++) { const r = await post('/api/license/check', { feature: 'ai-chat', requestId: `smoke-${String(i).padStart(4, '0')}`, consume: true }); if (!r.body.allowed) throw new Error(`第 ${i} 次不应被拦截`); }
    const over = await post('/api/license/check', { feature: 'ai-chat', requestId: 'smoke-0011', consume: true });
    if (over.body.code !== 'AI_QUOTA_EXCEEDED') throw new Error('超额错误码不正确');
    const checkin = await post('/api/account/checkin');
    if (!checkin.body.ok || checkin.body.aiQuota.bonus !== 10) throw new Error('签到奖励失败');
    const advanced = await post('/api/license/check', { feature: 'multi-agent' });
    if (advanced.body.code !== 'FEATURE_VIP_REQUIRED') throw new Error('高级能力会员墙失败');
    const points = await post('/api/account/points-redeem', { days: 7 });
    if (!points.body.ok || points.body.plan !== 'vip') throw new Error('积分兑换会员失败');
    const vip = await post('/api/license/check', { feature: 'multi-agent' });
    if (!vip.body.allowed || vip.body.plan !== 'vip') throw new Error('兑换后高级能力未放行');
    const firstReward = await post('/api/account/points-earn', { kind: 'firstProject', eventId: 'first-project' });
    if (!firstReward.body.ok || firstReward.body.awarded !== 30) throw new Error('首个项目积分奖励失败');
    const duplicateReward = await post('/api/account/points-earn', { kind: 'firstProject', eventId: 'first-project' });
    if (!duplicateReward.body.ok || duplicateReward.body.awarded !== 0 || duplicateReward.body.duplicate !== true) throw new Error('积分奖励幂等失败');
    const invite = await post('/api/account/points-earn', { kind: 'invite', eventId: 'invite-smoke' });
    if (invite.body.code !== 'INVITE_NOT_VERIFIED') throw new Error('未验证邀请奖励未拦截');
    console.log('会员服务端冒烟测试通过');
  } finally {
    child.kill();
    await sleep(120);
    rmSync(data, { recursive: true, force: true });
  }
}
run().catch((error) => { console.error(error instanceof Error ? error.message : error, logs); process.exitCode = 1; });
