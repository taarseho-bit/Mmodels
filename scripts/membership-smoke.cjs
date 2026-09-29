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
const trialDevice = 'trial-device-0123456789';
const inviterDevice = 'inviter-device-0123456789';
const secret = randomBytes(32).toString('hex');
const password = 'SmokePass123!';
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
const passHash = `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
const now = Date.now();
const cardCode = 'ABCD-EFGH-JKLM-NPQR';
const user = {
  name: 'smoke', passHash, tokenVersion: 1, createdAt: now - 10 * 86_400_000,
  expiresAt: 0, trialExpiresAt: now - 86_400_000, plan: 'free', points: 0,
  // 已领取注册奖励，避免迁移补发影响本脚本对每日积分扣减的固定断言。
  pointsAwards: { register: now }, aiPoints: { date: new Date(now).toISOString().slice(0, 10), dailyGrant: 100, dailyBonus: 0, dailyRemaining: 100, pointsPerTurn: 10, consumed: {} },
  quota: { date: '', used: 0, bonus: 0, consumed: {} },
  checkinDate: '', banned: false, deviceId: device,
};
const trialUser = {
  name: 'trial', passHash, tokenVersion: 1, createdAt: now,
  expiresAt: now, trialExpiresAt: now + 24 * 60 * 60_000, trialGrantedAt: now, plan: 'free', points: 20,
  pointsAwards: {}, aiPoints: { date: new Date(now).toISOString().slice(0, 10), dailyGrant: 100, dailyBonus: 0, dailyRemaining: 100, pointsPerTurn: 10, consumed: {} },
  quota: { date: '', used: 0, bonus: 0, consumed: {} }, checkinDate: '', banned: false, deviceId: trialDevice,
};
const inviter = {
  name: 'inviter', passHash, tokenVersion: 1, createdAt: now - 5 * 86_400_000,
  expiresAt: 0, trialExpiresAt: now - 4 * 86_400_000, plan: 'free', points: 0,
  pointsAwards: { register: now }, quota: { date: '', used: 0, bonus: 0, consumed: {} }, checkinDate: '', banned: false,
  deviceId: inviterDevice, inviteCode: 'MM-ABC234',
};
user.invitedBy = 'inviter';
mkdirSync(data, { recursive: true });
writeFileSync(join(data, 'secret'), secret, { mode: 0o600 });
writeFileSync(join(data, 'admin-auth'), 'admin:smoke-pass', { mode: 0o600 });
writeFileSync(join(data, 'db.json'), JSON.stringify({ cards: { [cardCode]: { days: 30, createdAt: now, usedBy: null, usedAt: null, revoked: false } }, redemptions: {}, users: { smoke: user, trial: trialUser, inviter }, events: [] }));
function makeToken(username, deviceId) {
  const body = Buffer.from(JSON.stringify({ username, deviceId, expiresAt: now + 365 * 86_400_000, tokenVersion: 1 })).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
const token = makeToken('smoke', device);
const trialToken = makeToken('trial', trialDevice);
const inviterToken = makeToken('inviter', inviterDevice);
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
async function postAs(path, authToken, authDevice, payload = {}) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${authToken}`, 'x-mmodels-device': authDevice }, body: JSON.stringify(payload) });
  return { status: res.status, body: await res.json() };
}
async function run() {
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await sleep(100); }
    const trialAdvanced = await postAs('/api/license/check', trialToken, trialDevice, { feature: 'multi-agent' });
    if (trialAdvanced.status !== 403 || trialAdvanced.body.code !== 'PAID_VIP_REQUIRED') throw new Error('24 小时试用不应开放多智能体');
    const trialStrict = await postAs('/api/license/check', trialToken, trialDevice, { feature: 'deep-modeling' });
    if (trialStrict.status !== 403 || trialStrict.body.code !== 'PAID_VIP_REQUIRED') throw new Error('24 小时试用不应开放深度建模');
    const freePaper = await post('/api/license/check', { feature: 'full-paper' });
    if (freePaper.status !== 200 || freePaper.body.allowed !== true) throw new Error('免费基础论文不应被会员墙拦截');
    // 服务端按明确模式派生成本，故意把旧 pointsCost 写成 10 也必须按论文档位扣 30。
    const paperTurn = await post('/api/license/check', { feature: 'ai-chat', chatMode: 'paper', pointsCost: 10, requestId: 'smoke-paper-0001', consume: true });
    if (paperTurn.status !== 200 || paperTurn.body.pointsPerTurn !== 30 || paperTurn.body.chatMode !== 'paper' || paperTurn.body.aiPoints.balance !== 70) throw new Error(`论文轮次积分成本不正确：${JSON.stringify(paperTurn)}`);
    // 没有明确模式的旧请求仍按基础档位处理；伪造高价 pointsCost 不能改变服务端扣费。
    const first = await post('/api/license/check', { feature: 'ai-chat', pointsCost: 80, requestId: 'smoke-0001', consume: true });
    if (first.status !== 200 || first.body.allowed !== true || first.body.aiPoints.balance !== 60 || first.body.pointsPerTurn !== 10) throw new Error('首次 AI 积分扣减失败');
    // 先在只剩 60 分时签到：只能增加 100 分，不能把已用的 40 分补回。
    const checkin = await post('/api/account/checkin');
    if (!checkin.body.ok || checkin.body.aiPoints.dailyBonus !== 100 || checkin.body.aiPoints.balance !== 160) throw new Error('签到应按当前剩余积分增加，不能返还已用积分');
    for (let i = 2; i <= 17; i++) { const r = await post('/api/license/check', { feature: 'ai-chat', requestId: `smoke-${String(i).padStart(4, '0')}`, consume: true }); if (!r.body.allowed) throw new Error(`第 ${i} 次不应被拦截`); }
    const over = await post('/api/license/check', { feature: 'ai-chat', requestId: 'smoke-0018', consume: true });
    if (over.body.code !== 'AI_QUOTA_EXCEEDED' || over.body.aiPoints.balance !== 0) throw new Error('AI 积分耗尽错误不正确');
    const duplicateCheckin = await post('/api/account/checkin');
    if (!duplicateCheckin.body.ok || !duplicateCheckin.body.alreadyCheckedIn || duplicateCheckin.body.aiPoints.balance !== 0) throw new Error('重复签到不应再次增加积分');
    const advanced = await post('/api/license/check', { feature: 'multi-agent' });
    if (advanced.body.code !== 'FEATURE_VIP_REQUIRED') throw new Error('高级能力会员墙失败');
    const points = await post('/api/account/points-redeem', { days: 7 });
    if (points.status !== 409 || points.body.code !== 'POINTS_REDEEM_DISABLED') throw new Error('积分兑换会员未停用');
    const redeemed = await fetch(base + '/api/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'smoke', password, code: cardCode, deviceId: device }) });
    const redeemedBody = await redeemed.json();
    if (redeemed.status !== 200 || !redeemedBody.ok || redeemedBody.plan !== 'vip') throw new Error('卡密兑换会员失败');
    const vip = await post('/api/license/check', { feature: 'multi-agent' });
    if (!vip.body.allowed || vip.body.plan !== 'vip') throw new Error('兑换后高级能力未放行');
    const vipStrict = await post('/api/license/check', { feature: 'deep-modeling' });
    if (!vipStrict.body.allowed || vipStrict.body.plan !== 'vip') throw new Error('兑换后深度建模未放行');
    const firstReward = await post('/api/account/points-earn', { kind: 'firstProject', eventId: 'first-project' });
    if (!firstReward.body.ok || firstReward.body.awarded !== 30) throw new Error('首个项目积分奖励失败');
    const paperReward = await post('/api/account/points-earn', { kind: 'paperExport', eventId: 'paper-export-smoke-0001' });
    if (!paperReward.body.ok || paperReward.body.awarded !== 20) throw new Error('论文导出积分奖励失败');
    const duplicateReward = await post('/api/account/points-earn', { kind: 'firstProject', eventId: 'first-project' });
    if (!duplicateReward.body.ok || duplicateReward.body.awarded !== 0 || duplicateReward.body.duplicate !== true) throw new Error('积分奖励幂等失败');
    const inviterStatus = await postAs('/api/account/status', inviterToken, inviterDevice);
    if (inviterStatus.body.points !== 50) throw new Error('邀请奖励未在有效项目完成后按低额规则发放');
    const invite = await post('/api/account/points-earn', { kind: 'invite', eventId: 'invite-smoke' });
    if (invite.body.code !== 'INVITE_NOT_VERIFIED') throw new Error('未验证邀请奖励未拦截');
    const fakeFeedback = await post('/api/account/points-earn', { kind: 'feedback', eventId: 'feedback-fake-0001' });
    if (fakeFeedback.status !== 409 || fakeFeedback.body.code !== 'FEEDBACK_NOT_FOUND') throw new Error('伪造反馈积分未拦截');
    const beforeFeedback = await post('/api/account/status');
    const submittedFeedback = await post('/api/account/feedback', { text: '工作流节点说明很清楚，但希望审核状态可以在会员中心看到。' });
    if (submittedFeedback.status !== 200 || submittedFeedback.body.awarded !== 0 || submittedFeedback.body.reviewStatus !== 'pending' || !submittedFeedback.body.feedbackId) throw new Error(`反馈提交不应立即奖励：${JSON.stringify(submittedFeedback)}`);
    const pendingFeedback = await post('/api/account/points-earn', { kind: 'feedback', eventId: submittedFeedback.body.feedbackId });
    if (pendingFeedback.status !== 409 || pendingFeedback.body.code !== 'FEEDBACK_REVIEW_PENDING') throw new Error('待审核反馈被客户端提前领取');
    const adminAuth = 'Basic ' + Buffer.from('admin:smoke-pass').toString('base64');
    const reviewRes = await fetch(base + '/admin/api/feedback/review', { method: 'POST', headers: { authorization: adminAuth, 'content-type': 'application/json' }, body: JSON.stringify({ id: submittedFeedback.body.feedbackId, useful: true }) });
    const review = await reviewRes.json();
    if (reviewRes.status !== 200 || !review.ok || review.feedback.reviewStatus !== 'approved' || review.awarded !== 100) throw new Error(`反馈审核奖励失败：${JSON.stringify(review)}`);
    const afterFeedback = await post('/api/account/status');
    if (Number(afterFeedback.body.points) !== Number(beforeFeedback.body.points) + 100) throw new Error('审核通过后积分未到账');
    const duplicateReviewRes = await fetch(base + '/admin/api/feedback/review', { method: 'POST', headers: { authorization: adminAuth, 'content-type': 'application/json' }, body: JSON.stringify({ id: submittedFeedback.body.feedbackId, useful: true }) });
    const duplicateReview = await duplicateReviewRes.json();
    if (!duplicateReview.ok || duplicateReview.awarded !== 100 || duplicateReview.duplicate !== true) throw new Error('反馈审核重复点击未保持幂等');
    const overviewRes = await fetch(base + '/admin/api/overview', { headers: { authorization: adminAuth } });
    const overview = await overviewRes.json();
    if (!overview.ok || overview.paperExports !== 1 || overview.inviteSettled !== 1) throw new Error('论文导出/邀请结算统计事件漏记');
    const csrfRes = await fetch(base + '/admin/api/users/adjust-points', {
      method: 'POST',
      headers: { authorization: adminAuth, origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'smoke', delta: 1 }),
    });
    if (csrfRes.status !== 403) throw new Error('管理后台未拦截跨站写请求');
    console.log('会员服务端冒烟测试通过');
  } finally {
    child.kill();
    await sleep(120);
    rmSync(data, { recursive: true, force: true });
  }
}
run().catch((error) => { console.error(error instanceof Error ? error.message : error, logs); process.exitCode = 1; });
