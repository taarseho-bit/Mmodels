#!/usr/bin/node
/**
 * MModels License Server v4（账号体系 + 完整运营后台，零依赖）
 *
 * 客户端接口：
 *   GET  /health
 *   POST /api/auth/register {username, password, email, emailCode, deviceId, code?}
 *                                                注册（邮箱验证码必填；code 卡密可选，直接激活）
 *   POST /api/auth/login    {username, password, deviceId}          登录（换设备自动重绑）
 *   POST /api/auth/send-code {email, purpose: register|reset}       发送邮箱验证码（10 分钟有效）
 *   POST /api/auth/reset-pass {email, emailCode, newPassword}       忘记密码重置
 *   POST /api/redeem        {username, password, code, deviceId}    卡密续期（到期日叠加）
 *   POST /api/license/check Bearer token + x-mmodels-device         授权校验与额度扣减
 *   POST /api/account/status Bearer token + x-mmodels-device        账号权益快照
 *   POST /api/account/logout Bearer token + x-mmodels-device        退出登录（服务端吊销令牌）
 *   POST /api/account/checkin Bearer token + x-mmodels-device       每日签到
 *   POST /api/account/points-redeem Bearer token + x-mmodels-device  兼容积分兑换入口（现返回中文停用提示）
 *   POST /api/account/points-earn Bearer token + x-mmodels-device    记录已核验的积分奖励事件
 *   POST /api/account/feedback  Bearer token + x-mmodels-device      提交反馈（落库，后台审核通过后奖励积分）
 *   POST /api/telemetry        {kind, message, detail, version, platform}  客户端运行诊断上报（免登录）
 *
 * 邮件配置：/opt/mmodels/data/mail.json → {"host":"smtp.qq.com","port":465,"user":"...","pass":"授权码","from":"..."}
 *           未配置时 send-code 返回 503「邮件服务暂未开通」
 *
 * 管理后台（HTTP Basic Auth，凭证 /opt/mmodels/data/admin-auth；路径可通过 MM_ADMIN_PATH 环境变量自定义）：
 *   GET  /<admin-path>                 管理页（单文件 HTML）
 *   GET  /<admin-path>/api/overview    统计 + 近7天趋势
 *   GET  /<admin-path>/api/users       用户列表（不返回密码/备注/最近IP——密码只做单向校验）
 *   POST /<admin-path>/api/users/ban          {username, banned}
 *   POST /<admin-path>/api/users/reset-pass   {username, newPassword}
 *   POST /<admin-path>/api/users/unbind       {username}   解绑设备（换机）
 *   POST /<admin-path>/api/users/extend       {username, days}   手动延期（可为负，自动同步 VIP 状态）
 *   POST /<admin-path>/api/users/expire       {username}   取消会员与试用（降为免费版）
 *   POST /<admin-path>/api/users/note         {username, note}   客服备注
 *   POST /<admin-path>/api/users/adjust-points {username, delta}  积分调整
 *   GET  /<admin-path>/api/config            会员/积分/权益配置（与客户端同源）
 *   GET  /<admin-path>/api/logs?limit=300      审计日志（注册/登录/兑换/校验失败/管理操作，含 IP）
 *   GET  /<admin-path>/api/feedback            用户反馈列表
 *   POST /<admin-path>/api/feedback/review     {id, useful} 审核反馈并按结果发放奖励
 *   POST /<admin-path>/api/feedback/remove     {id} 删除反馈
 *   GET  /<admin-path>/api/reports?kind=       客户端诊断上报列表
 *   POST /<admin-path>/api/reports/clear       清空诊断上报
 *   GET  /<admin-path>/api/cards
 *   POST /<admin-path>/api/cards/gen          {days, count}
 *   POST /<admin-path>/api/cards/revoke       {code}
 *   POST /<admin-path>/api/admin-passwd        {newPassword}      网页端改管理密码
 *   GET  /<admin-path>/api/backup              立即备份并下载 db.json.gz（每日自动备份，保留 14 份）
 *
 * CLI：
 *   gen <days> [count]        生成卡密
 *   list                      查看数据
 *   passwd <newpass>          重设管理后台密码
 *   migrate                   补齐历史账号/卡密字段（幂等，不清空业务数据）
 */
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const tls = require('node:tls');

const DATA_DIR = process.env.MM_DATA_DIR || '/opt/mmodels/data';
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret');
const ADMIN_FILE = path.join(DATA_DIR, 'admin-auth');
const ADMIN_HTML = path.join(__dirname, 'admin.html');
// 后台管理路径可通过环境变量 MM_ADMIN_PATH 自定义（默认 admin）。
// 部署时设为随机字符串（如 MM_ADMIN_PATH=k7m3x9q2）可隐藏后台入口，
// 访问地址变为 https://api.mmodel.top/k7m3x9q2/
const ADMIN_PATH = String(process.env.MM_ADMIN_PATH || 'admin').replace(/^\/+|\/+$/g, '') || 'admin';
const ADMIN_PREFIX = '/' + ADMIN_PATH;
const PORT = Number(process.env.MM_PORT || 80);
const DAY_MS = 86_400_000;
// 数据结构迁移版本。迁移只补齐缺失字段，不会覆盖已有会员、积分或卡密数据。
const DB_SCHEMA_VERSION = 1;
/** 新账号只开放 24 小时完整体验；已有账号若保存了旧试用结束时间则保留原时间。 */
const TRIAL_HOURS = 24;
const TRIAL_MS = TRIAL_HOURS * 60 * 60_000;
const TRIAL_DAYS = 1; // 旧客户端/后台仍读取该字段，真实期限以 trialExpiresAt 为准。
/**
 * 免费账号统一使用“积分”而不是“次数”：每天 100 积分，普通对话每次 10 积分，
 * 签到再加 100 积分。兼容 quota 字段和 aiQuota 返回结构继续保留，便于历史账号平滑迁移。
 */
const FREE_DAILY_POINTS = 100;
const CHECKIN_BONUS_POINTS = 100;
const CHAT_POINT_COSTS = Object.freeze({ basic: 10, paper: 30, review: 30, figure: 20, strict: 50, collaboration: 80 });
const AI_CHAT_POINTS_COST = CHAT_POINT_COSTS.basic;
const FREE_BASE_QUOTA = FREE_DAILY_POINTS / AI_CHAT_POINTS_COST; // 旧字段兼容：10 次
const CHECKIN_BONUS_QUOTA = CHECKIN_BONUS_POINTS / AI_CHAT_POINTS_COST; // 旧字段兼容：10 次
/** VIP / 试用账号签到奖励的持久积分；AI 积分统一后仍保留小额奖励。 */
const CHECKIN_VIP_POINTS = 10;
/** 积分只用于普通 AI 消耗；不再兑换 VIP，VIP 必须使用付费卡密。 */
// 有价值反馈奖励 100 积分；必须由后台审核通过，且每个账号最多结算一次，避免刷分。
const POINT_REWARDS = Object.freeze({ register: 50, firstProject: 30, paperExport: 20, feedback: 100, invite: 50 });
const POINT_EXCHANGE = Object.freeze({});
const POINT_REWARD_KINDS = new Set(['firstProject', 'paperExport', 'feedback', 'invite']);
const POINT_EVENT_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * 由服务端统一决定普通对话的积分档位。
 *
 * 历史客户端仍可以发送 pointsCost（否则协议字段不同会导致请求失败），
 * 但该数字只作为兼容字段，绝不能作为扣费依据；否则篡改客户端就能把论文
 * 回合伪报成普通问答。新客户端发送 chatMode，由服务端白名单映射到固定成本。
 * 缺少模式时按 basic 处理，保证旧客户端仍能正常使用基础对话。
 */
const CHAT_COST_MODES = new Set(['basic', 'paper', 'review', 'figure']);
function normalizeChatMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return CHAT_COST_MODES.has(mode) ? mode : 'basic';
}
function requestedChatCost(_legacyValue, mode = 'basic') {
  return CHAT_POINT_COSTS[normalizeChatMode(mode)] || AI_CHAT_POINTS_COST;
}
/**
 * 客户端自报的完成事件必须限次。
 * 事件编号只是「去重键」，无法证明动作真的发生过 —— 攻击者可以每次换一个随机
 * 编号反复领取，按 20 积分/次、限流 30 次/小时算，一小时就能换 6 天会员。
 * 这里按类型限制「每个自然日」和「累计」的发放条数，把刷分收益压到可接受范围。
 */
const POINT_EARN_CAPS = Object.freeze({
  firstProject: { day: 1, total: 1 },
  paperExport: { day: 3, total: 20 },
  feedback: { day: 1, total: 1 },
});
/** 邀请奖励只有受邀人完成首个有效项目后才发放，且采用低额/限次规则。 */
const INVITE_REWARD_POINTS = 50;
const INVITE_REWARD_DAY_CAP = 3;
const INVITE_REWARD_TOTAL_CAP = 20;
// 基础单智能体可以完成一篇完整论文；2026-09-29 规则收缩：导出、长上下文、
// 高级图表全部开放给免费用户（试用 VIP 与普通用户的唯一区别是不扣积分），
// 付费卡密独占只剩多智能体协作、AI 全自动（automation）与深度建模三项。
// 旧客户端仍可传入 full-paper/export 等，但服务端不再把它们当作会员专属功能。
const FREE_FEATURES = new Set(['ai-chat', 'full-paper', 'export', 'large-context', 'advanced-figures']);
// VIP_FEATURES 是服务端可识别的全部会员能力；PAID_ONLY_FEATURES 是其中
// 只有卡密 VIP 才能使用的子集。严格建模必须同时出现在两个集合里，
// 否则会在付费校验前被误判为 INVALID_FEATURE。
const VIP_FEATURES = new Set(['multi-agent', 'cloud-collaboration', 'automation', 'deep-modeling']);
const PAID_ONLY_FEATURES = new Set(['multi-agent', 'cloud-collaboration', 'automation', 'deep-modeling']);

// ---------- 存储 ----------
function loadDb() {
  try {
    const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    d.cards ||= {}; d.redemptions ||= {}; d.users ||= {}; d.events ||= [];
    d.feedbacks ||= []; d.reports ||= [];
    // 反馈审核是后加入的字段。旧记录一律先标记为待审核，不能因为迁移
    // 自动再发积分；历史已经发放的积分仍保留在账号账本中。
    if (Array.isArray(d.feedbacks)) {
      for (const feedback of d.feedbacks) {
        if (!feedback || typeof feedback !== 'object') continue;
        if (!['pending', 'approved', 'rejected'].includes(feedback.reviewStatus)) feedback.reviewStatus = 'pending';
        if (!Number.isFinite(Number(feedback.reviewedAt))) feedback.reviewedAt = 0;
        if (!Number.isFinite(Number(feedback.rewardedAt))) feedback.rewardedAt = 0;
        if (!Number.isFinite(Number(feedback.awarded))) feedback.awarded = 0;
      }
    }
    return d;
  } catch (error) {
    // 只有首次部署时允许创建空库。权限错误、磁盘损坏或 JSON 截断必须让服务
    // 失败并保留现场，不能把空对象当成正常数据再覆盖掉全部账号和卡密。
    if (error && error.code === 'ENOENT') {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      return { cards: {}, redemptions: {}, users: {}, events: [], feedbacks: [], reports: [] };
    }
    throw new Error(`授权数据库读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
let db = loadDb();
let saveTimer = null;
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    const text = JSON.stringify(db, null, 2);
    fs.writeSync(fd, text, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, DB_FILE);
  fs.chmodSync(DB_FILE, 0o600);
}
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      saveDb();
    } catch (error) {
      // 异步落盘不能把未捕获异常带到事件循环；保留现场并让下一次请求/备份重试。
      console.error('授权数据库异步保存失败：', error instanceof Error ? error.message : String(error));
    }
  }, 200);
}

/*
 * 历史实现曾在所有读取异常时返回空库，导致 db.json 损坏后下一次写请求静默清空
 * 账号。保留这段注释是为了让迁移人员知道：这里不能再回退到空对象。
 */
function assertDbReady() {
  if (!db || typeof db !== 'object') throw new Error('授权数据库未就绪');
}
function logEvent(type, username, info) {
  const o = info || {};
  db.events.push({
    t: Date.now(), type, username: username || '-',
    ip: o.ip || '', days: o.days || 0, detail: o.detail || '',
  });
  if (db.events.length > 8000) db.events = db.events.slice(-6000); // 截断防膨胀
}

// ---------- 每日自动备份（gzip，保留 14 份） ----------
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
function backupNow() {
  saveDb(); // 先强制落盘，确保备份包含最新数据
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `db-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json.gz`;
  const backupPath = path.join(BACKUP_DIR, name);
  fs.writeFileSync(backupPath, zlib.gzipSync(JSON.stringify(db)), { mode: 0o600 });
  fs.chmodSync(backupPath, 0o600);
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json.gz')).sort();
  while (files.length > 14) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  return name;
}

// ---------- 密钥 ----------
function readOrCreate(file, generator, mode) {
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    try { fs.chmodSync(file, mode || 0o600); } catch { /* 只读部署时交给启动检查处理 */ }
    return value;
  } catch (error) {
    // 只有首次部署时允许创建。权限错误、磁盘故障或临时 I/O 错误都不能
    // 静默生成新密钥，否则会使全部令牌失效，甚至把管理员锁在后台外。
    if (!error || error.code !== 'ENOENT') throw error;
    const v = generator();
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, v, { mode: mode || 0o600 });
    try { fs.chmodSync(file, mode || 0o600); } catch { /* ignore */ }
    return v;
  }
}
const SECRET = readOrCreate(SECRET_FILE, () => crypto.randomBytes(32).toString('hex'));
let ADMIN_AUTH = readOrCreate(ADMIN_FILE, () => `admin:${crypto.randomBytes(6).toString('hex')}`);
if (!/^[a-f0-9]{64}$/i.test(SECRET)) throw new Error('授权服务 secret 文件无效，拒绝启动');
if (!/^admin:[^\u0000-\u001f\u007f]{8,128}$/.test(ADMIN_AUTH)) throw new Error('管理后台凭证格式无效，拒绝启动');

// ---------- 密码存储 ----------
// 新账号只保存 scrypt 单向摘要。AES 只保留给存量数据迁移：已有账号成功登录一次后，
// 立即升级成 scrypt，并删除 passEnc；任何 API 都不会再把密码返回给管理端。
const PASS_KEY = crypto.createHash('sha256').update(`${SECRET}|pass`).digest();
function encPass(p) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', PASS_KEY, iv);
  const enc = Buffer.concat([c.update(p, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}
function decPass(s) {
  try {
    if (typeof s !== 'string') return null;
    const [iv, tag, enc] = s.split('.').map((b) => Buffer.from(b, 'base64url'));
    const d = crypto.createDecipheriv('aes-256-gcm', PASS_KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; }
}
function hashPass(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}
function verifyPass(stored, password) {
  if (typeof stored !== 'string') return { ok: false, migrated: null };
  if (stored.startsWith('scrypt$')) {
    const [, saltText, hashText] = stored.split('$');
    try {
      const salt = Buffer.from(saltText, 'base64url');
      const expected = Buffer.from(hashText, 'base64url');
      const actual = crypto.scryptSync(password, salt, expected.length, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
      return { ok: expected.length === actual.length && crypto.timingSafeEqual(expected, actual), migrated: null };
    } catch { return { ok: false, migrated: null }; }
  }
  // 存量可逆密文仅用于一次性迁移，不能继续写回。
  const legacy = decPass(stored);
  return { ok: legacy !== null && legacy === password, migrated: legacy === password ? hashPass(password) : null };
}
function writeAdminAuth(password) {
  const tmp = `${ADMIN_FILE}.tmp`;
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(tmp, `admin:${password}`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, ADMIN_FILE);
  fs.chmodSync(ADMIN_FILE, 0o600);
  ADMIN_AUTH = `admin:${password}`;
}

// ---------- 卡密 / 令牌 ----------
function genCardCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}
function genInviteCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `MM-${part()}`;
}
function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const actualSig = Buffer.from(String(sig || ''), 'utf8');
  const expectedSig = Buffer.from(expect, 'utf8');
  if (actualSig.length !== expectedSig.length || !crypto.timingSafeEqual(actualSig, expectedSig)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p || typeof p.username !== 'string' || typeof p.deviceId !== 'string' || typeof p.expiresAt !== 'number' || p.expiresAt <= Date.now()) return null;
    if (p.tokenVersion !== undefined && (!Number.isInteger(p.tokenVersion) || p.tokenVersion < 1)) return null;
    return p;
  } catch { return null; }
}

// ---------- 限流 ----------
const hits = new Map(); // key(ip) -> {count, resetAt}
const PASSWORD_RE = /^[^\u0000-\u001f\u007f]{8,128}$/;
let lastHitsSweep = 0;
function requestIp(req) {
  const remote = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  // 只有明确声明“前置反代在本机”时才读取 X-Forwarded-For，避免客户端伪造
  // 任意 IP 绕过限流。生产 systemd unit 会设置 MM_TRUST_PROXY=1。
  if (process.env.MM_TRUST_PROXY === '1' && (remote === '127.0.0.1' || remote === '::1')) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return remote || 'unknown';
}
function rateAllowed(key, limit, windowMs) {
  const now = Date.now();
  if (now - lastHitsSweep > 60_000) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    // 即使攻击者制造大量短期 key，也不能让服务进程的 Map 无限增长。
    if (hits.size > 10_000) {
      const entries = [...hits.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
      for (const [k] of entries.slice(0, hits.size - 8_000)) hits.delete(k);
    }
    lastHitsSweep = now;
  }
  const w = hits.get(key);
  if (!w || now > w.resetAt) { hits.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  w.count += 1;
  return w.count <= limit;
}
function rateAvailable(key, limit) {
  const w = hits.get(key);
  return !w || Date.now() > w.resetAt || w.count < limit;
}
function rateRetryAfter(key) {
  const w = hits.get(key);
  return w ? Math.max(1, Math.ceil((w.resetAt - Date.now()) / 1000)) : 0;
}

// ---------- 邮件发送（零依赖 SMTP over implicit TLS，QQ 邮箱 smtp.qq.com:465 实测） ----------
const MAIL_FILE = path.join(DATA_DIR, 'mail.json');
const MAIL_TEXT_RE = /^[^\u0000-\u001f\u007f]{1,1024}$/;
const SMTP_HOST_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
function mailCfg() {
  try {
    const c = JSON.parse(fs.readFileSync(MAIL_FILE, 'utf8'));
    const host = c && c.host;
    const user = c && c.user;
    const pass = c && c.pass;
    const from = (c && c.from) || user;
    const rawPort = c && c.port;
    const port = rawPort === undefined || rawPort === null || rawPort === '' ? 465 : Number(rawPort);
    // 配置值会直接进入 TLS 主机名、SMTP 命令和 From 头；拒绝控制字符、
    // 超长值和不合法地址，避免 mail.json 被误配/篡改后产生命令或头部注入。
    if (typeof host !== 'string' || !SMTP_HOST_RE.test(host) || host.length > 253) return null;
    if (typeof user !== 'string' || !MAIL_TEXT_RE.test(user) || user.length > 254) return null;
    if (typeof pass !== 'string' || !MAIL_TEXT_RE.test(pass)) return null;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (typeof from !== 'string' || !EMAIL_RE.test(from) || !MAIL_TEXT_RE.test(from)) return null;
    return { host, port, user, pass, from };
  } catch { /* 未配置 */ }
  return null;
}
const b64s = (s) => Buffer.from(s, 'utf8').toString('base64');
const encHeader = (s) => `=?UTF-8?B?${b64s(s)}?=`;
function buildMessage(cfg, to, subject, text) {
  const body = b64s(text).replace(/(.{76})/g, '$1\r\n');
  return [
    `From: MModels <${cfg.from}>`,
    `To: <${to}>`,
    `Subject: ${encHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}
function sendMail(to, subject, text) {
  const cfg = mailCfg();
  if (!cfg) return Promise.reject(new Error('MAIL_NOT_CONFIGURED'));
  if (typeof to !== 'string' || !EMAIL_RE.test(to) || !MAIL_TEXT_RE.test(to)) {
    return Promise.reject(new Error('MAIL_RECIPIENT_INVALID'));
  }
  return new Promise((resolve, reject) => {
    const steps = [
      { expect: '2', cmd: null },                                   // banner 220
      { expect: '250', cmd: 'EHLO mmodels' },                       // 多行响应
      { expect: '334', cmd: 'AUTH LOGIN' },
      { expect: '334', cmd: b64s(cfg.user) },
      { expect: '235', cmd: b64s(cfg.pass) },
      { expect: '250', cmd: `MAIL FROM:<${cfg.from}>` },
      { expect: '250', cmd: `RCPT TO:<${to}>` },
      { expect: '354', cmd: 'DATA' },
      { expect: '250', cmd: `${buildMessage(cfg, to, subject, text)}\r\n.` },
      { expect: '221', cmd: 'QUIT' },
    ];
    const sock = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, rejectUnauthorized: true });
    let buf = ''; let i = 0; let done = false;
    const fail = (msg) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* 忽略 */ }
      reject(new Error(msg));
    };
    sock.setTimeout(20_000, () => fail('SMTP 超时'));
    sock.on('error', (e) => fail(`SMTP：${e.message}`));
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      if (!buf.includes('\r\n')) return;
      const complete = buf.split('\r\n').filter((l) => /^\d{3}[- ]/.test(l));
      if (!complete.length) return;
      const last = complete[complete.length - 1];
      if (last[3] === '-') return; // 多行响应未结束
      const code = last.slice(0, 3);
      buf = '';
      const step = steps[i];
      if (!step || !code.startsWith(step.expect)) return fail(`SMTP 第 ${i + 1} 步返回 ${code}：${last.slice(4).trim()}`);
      i += 1;
      if (i >= steps.length) {
        done = true;
        sock.end();
        return resolve();
      }
      if (steps[i].cmd !== null) sock.write(`${steps[i].cmd}\r\n`);
    });
  });
}

// ---------- 邮箱验证码（内存存储，10 分钟有效，一次性消费） ----------
const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,63}$/;
const emailCodes = new Map(); // `${purpose}|${email}` -> { code, exp, resendAt, tries }
function issueEmailCode(purpose, email, ip) {
  if (!rateAllowed(`mail:${ip}`, 10, 3600_000)) return { error: '验证码发送过于频繁，请稍后再试' };
  const key = `${purpose}|${email.toLowerCase()}`;
  const now = Date.now();
  const old = emailCodes.get(key);
  if (old && now < old.resendAt) return { error: '发送太频繁，请 1 分钟后再试' };
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  emailCodes.set(key, { code, exp: now + 10 * 60_000, resendAt: now + 60_000, tries: 0 });
  for (const [k, v] of emailCodes) if (v.exp < now) emailCodes.delete(k); // 顺手清理过期
  return { code };
}
function verifyEmailCode(purpose, email, code) {
  const key = `${purpose}|${email.toLowerCase()}`;
  const rec = emailCodes.get(key);
  if (!rec || Date.now() > rec.exp) return { error: '验证码已失效，请重新获取' };
  rec.tries += 1;
  if (rec.tries > 5) { emailCodes.delete(key); return { error: '验证码错误次数过多，请重新获取' }; }
  const a = Buffer.from(rec.code);
  const b = Buffer.from(String(code || ''));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { error: '验证码不正确' };
  emailCodes.delete(key); // 一次性消费
  return {};
}

// ---------- 业务 ----------
function dayKey(now = Date.now()) {
  // 额度与签到按产品服务地区的自然日清零，避免北京时间早上 8 点才重置。
  const d = new Date(now + 8 * 60 * 60_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function ensureUser(user) {
  if (!user || typeof user !== 'object') return user;
  const now = Date.now();
  if (!Number.isFinite(Number(user.createdAt))) user.createdAt = now;
  if (!Number.isFinite(Number(user.expiresAt))) user.expiresAt = 0;
  if (typeof user.inviteCode !== 'string' || !/^MM-[A-Z2-9]{6}$/.test(user.inviteCode)) {
    user.inviteCode = genInviteCode();
  }
  // 存量账号可能只有 expiresAt，没有 plan。先补齐，再把已经过期的 VIP
  // 明确迁回免费档；保留 expiresAt 供运营审计，不让旧 token 把用户锁死。
  if (user.plan !== 'vip' && user.plan !== 'free') user.plan = user.expiresAt > now ? 'vip' : 'free';
  if (user.plan === 'vip' && !(Number(user.expiresAt) > now)) {
    user.plan = 'free';
    // 付费会员到期后不能重新获得尚未用完的试用期；否则短期后台延期/卡密
    // 到期会把账号再次变成试用状态。没有历史试用字段的存量 VIP 也要保留
    // 为“已用过试用”，避免下面的迁移逻辑凭注册时间补出一段新试用。
    user.trialExpiresAt = Math.min(Number(user.trialExpiresAt) || now, now);
    if (!user.vipExpiredLoggedAt) {
      user.vipExpiredLoggedAt = now;
      logEvent('vip-expired', user.name, { detail: '会员已到期，账号自动回到免费额度' });
    }
  }
  if (!Number.isFinite(Number(user.trialExpiresAt))) {
    const created = Number(user.createdAt) || now;
    // 只有没有任何旧试用结束时间的存量账号才套用新规则；已有账号不能被迁移过程意外缩短。
    user.trialExpiresAt = created + TRIAL_MS;
  }
  if (Number(user.trialExpiresAt) <= now && !user.trialExpiredLoggedAt) {
    user.trialExpiredLoggedAt = now;
    logEvent('trial-expired', user.name, { detail: '试用期结束，账号自动回到免费额度' });
  }
  if (!Number.isFinite(Number(user.points)) || user.points < 0) user.points = 0;
  if (!user.pointsAwards || typeof user.pointsAwards !== 'object') user.pointsAwards = {};
  // 注册奖励 50 分一次性补发（幂等）：老账号在首次请求时自动到账，
  // 新注册账号则在注册流程里直接拿到——两条路径共用同一个幂等键。
  awardPoints(user, 'register', 50);
  // 新积分账本：dailyRemaining 是当天可用积分，points 是历史奖励积分；
  // 对外合并为 aiPoints.balance。旧账号按旧次数余额折算，避免升级后凭空丢额度。
  const legacyQuota = user.quota && typeof user.quota === 'object' ? user.quota : null;
  if (!user.aiPoints || typeof user.aiPoints !== 'object') {
    const oldBase = Math.max(0, Number(legacyQuota?.base) || FREE_BASE_QUOTA);
    const oldBonus = Math.max(0, Number(legacyQuota?.bonus) || 0);
    const oldUsed = Math.max(0, Number(legacyQuota?.used) || 0);
    const oldRemainingTurns = Math.max(0, oldBase + oldBonus - oldUsed);
    const today = dayKey(now);
    const legacyIsToday = legacyQuota?.date === today;
    user.aiPoints = {
      date: today,
      dailyGrant: FREE_DAILY_POINTS,
      // 过期的旧额度不应带到今天；迁移当天从新的 100 分开始，避免把昨天的
      // 已用次数误当成今天已经消耗，也避免把旧签到奖励永久复制到新账本。
      dailyBonus: legacyIsToday ? Math.min(CHECKIN_BONUS_POINTS, Math.max(0, oldBonus * AI_CHAT_POINTS_COST)) : 0,
      dailyRemaining: legacyIsToday
        ? Math.min(FREE_DAILY_POINTS + CHECKIN_BONUS_POINTS, oldRemainingTurns * AI_CHAT_POINTS_COST)
        : FREE_DAILY_POINTS,
      pointsPerTurn: AI_CHAT_POINTS_COST,
      consumed: {},
    };
  }
  user.aiPoints.date = typeof user.aiPoints.date === 'string' ? user.aiPoints.date : dayKey(now);
  user.aiPoints.dailyGrant = Math.max(0, Number(user.aiPoints.dailyGrant) || FREE_DAILY_POINTS);
  user.aiPoints.dailyBonus = Math.max(0, Number(user.aiPoints.dailyBonus) || 0);
  user.aiPoints.dailyRemaining = Math.max(0, Number(user.aiPoints.dailyRemaining) || 0);
  user.aiPoints.dailyRemaining = Math.min(user.aiPoints.dailyRemaining, user.aiPoints.dailyGrant + user.aiPoints.dailyBonus);
  user.aiPoints.pointsPerTurn = Math.max(1, Number(user.aiPoints.pointsPerTurn) || AI_CHAT_POINTS_COST);
  if (!user.aiPoints.consumed || typeof user.aiPoints.consumed !== 'object') user.aiPoints.consumed = {};
  if (user.aiPoints.date !== dayKey(now)) {
    user.aiPoints.date = dayKey(now);
    user.aiPoints.dailyRemaining = user.aiPoints.dailyGrant;
    user.aiPoints.dailyBonus = 0;
    user.aiPoints.consumed = {};
    user.aiPoints.lastResetAt = now;
  }
  if (!user.quota || typeof user.quota !== 'object') user.quota = {};
  if (user.quota.date !== dayKey(now)) {
    user.quota = { date: dayKey(now), used: 0, bonus: 0, consumed: {} };
  } else {
    user.quota.used = Math.max(0, Number(user.quota.used) || 0);
    user.quota.bonus = Math.max(0, Number(user.quota.bonus) || 0);
    if (!user.quota.consumed || typeof user.quota.consumed !== 'object') user.quota.consumed = {};
  }
  if (typeof user.checkinDate !== 'string') user.checkinDate = '';
  return user;
}

function trialActive(user, now = Date.now()) {
  return user.plan === 'free' && Number(user.trialExpiresAt) > now;
}

function accountExpiresAt(user) {
  return user.plan === 'vip' ? Number(user.expiresAt) || 0 : Number(user.trialExpiresAt) || 0;
}

function paidVipActive(user, now = Date.now()) {
  return user.plan === 'vip' && Number(user.expiresAt) > now;
}

function aiPointsSnapshot(user, now = Date.now()) {
  ensureUser(user);
  const paidVip = paidVipActive(user, now);
  const trial = trialActive(user, now);
  const dailyRemaining = Math.max(0, Number(user.aiPoints.dailyRemaining) || 0);
  const dailyGrant = Math.max(0, Number(user.aiPoints.dailyGrant) || FREE_DAILY_POINTS);
  const dailyBonus = Math.max(0, Number(user.aiPoints.dailyBonus) || 0);
  const rewardPoints = Math.max(0, Number(user.points) || 0);
  const balance = dailyRemaining + rewardPoints;
  return {
    balance,
    dailyGrant,
    dailyBonus,
    dailyRemaining,
    rewardPoints,
    pointsPerTurn: AI_CHAT_POINTS_COST,
    remainingTurns: Math.floor(balance / AI_CHAT_POINTS_COST),
    unlimited: paidVip || trial,
    date: user.aiPoints.date,
    checkedAt: now,
  };
}

function accountSnapshot(user, now = Date.now()) {
  ensureUser(user);
  const activeTrial = trialActive(user, now);
  const vip = paidVipActive(user, now);
  const points = aiPointsSnapshot(user, now);
  const dailyTotal = points.dailyGrant + points.dailyBonus;
  const dailyUsed = Math.max(0, dailyTotal - points.dailyRemaining);
  const bonus = Math.max(0, Math.floor(points.dailyBonus / AI_CHAT_POINTS_COST));
  const used = Math.max(0, Math.floor(dailyUsed / AI_CHAT_POINTS_COST));
  const total = Math.floor(dailyTotal / AI_CHAT_POINTS_COST);
  const trialHoursLeft = activeTrial ? Math.max(1, Math.ceil((Number(user.trialExpiresAt) - now) / 3_600_000)) : 0;
  return {
    plan: vip ? 'vip' : 'free',
    trialActive: activeTrial,
    trialDaysLeft: activeTrial ? Math.max(1, Math.ceil((Number(user.trialExpiresAt) - now) / DAY_MS)) : 0,
    trialHoursLeft,
    trialExpiresAt: Number(user.trialExpiresAt) || 0,
    paidVip: vip,
    vipSource: vip ? (typeof user.vipSource === 'string' ? user.vipSource : 'card') : '',
    expiresAt: accountExpiresAt(user),
    points: Math.max(0, Number(user.points) || 0),
    pointsBalance: points.balance,
    pointsPerTurn: AI_CHAT_POINTS_COST,
    dailyPointsRemaining: points.dailyRemaining,
    aiPoints: points,
    inviteCode: typeof user.inviteCode === 'string' ? user.inviteCode : '',
    checkedIn: user.checkinDate === dayKey(now),
    // 旧客户端仍能读取 aiQuota；新客户端请优先使用 aiPoints。
    aiQuota: { used, base: FREE_BASE_QUOTA, bonus, total, remaining: vip || activeTrial ? 0 : points.remainingTurns, vip: vip || activeTrial, date: user.quota.date, checkedAt: now, pointsPerTurn: AI_CHAT_POINTS_COST },
  };
}

function awardPoints(user, key, amount) {
  // 该函数也会在 ensureUser() 内用于补发注册奖励，不能反过来调用
  // ensureUser()，否则历史账号迁移会形成递归。调用方会负责账号结构迁移；
  // 这里仅补齐积分字段，保证单独奖励接口仍然具备幂等性。
  if (!user || typeof user !== 'object') return false;
  if (!Number.isFinite(Number(user.points)) || user.points < 0) user.points = 0;
  if (!user.pointsAwards || typeof user.pointsAwards !== 'object') user.pointsAwards = {};
  if (user.pointsAwards[key]) return false;
  user.pointsAwards[key] = Date.now();
  user.points += Math.max(0, Number(amount) || 0);
  return true;
}

/**
 * 把客户端事件映射到稳定的幂等键。
 * 首个项目奖励只能领取一次；其余奖励必须带项目/反馈/邀请的事件编号，
 * 这样同一个完成动作重试不会重复加分。事件编号只作为去重键，不作为积分数值来源。
 */
function pointRewardKey(kind, eventId) {
  if (kind === 'firstProject') return 'firstProject';
  if (!POINT_EVENT_RE.test(eventId)) return null;
  return `${kind}:${eventId}`;
}

/** 统计某类奖励的发放条数（累计 / 当日）。pointsAwards 的值是发放时间戳。 */
function pointAwardStats(user, kind) {
  const prefix = kind === 'firstProject' ? 'firstProject' : `${kind}:`;
  const today = dayKey();
  let total = 0;
  let day = 0;
  for (const [key, at] of Object.entries(user.pointsAwards || {})) {
    if (!key.startsWith(prefix)) continue;
    total += 1;
    if (dayKey(Number(at)) === today) day += 1;
  }
  return { total, day };
}

/**
 * 结算邀请奖励：必须由受邀人完成首个有效项目后触发，注册本身不发放。
 * 奖励只给邀请人，额度低且有日/累计上限，避免批量注册小号直接换会员。
 */
function settleInviteReward(invitedUser, ip) {
  const inviterName = String(invitedUser?.invitedBy || '').trim();
  if (!inviterName || invitedUser.inviteRewardGrantedAt) return { settled: false, reason: 'not-pending' };
  const inviter = db.users[inviterName];
  if (!inviter || inviter.banned) return { settled: false, reason: 'inviter-unavailable' };
  ensureUser(inviter);
  // 同一设备上的自邀请不结算。邀请关系仍保留，避免误删账号数据，
  // 但奖励必须来自另一台设备上的真实新用户。
  if (invitedUser.deviceId && inviter.deviceId && invitedUser.deviceId === inviter.deviceId) {
    invitedUser.inviteStatus = 'blocked-same-device';
    logEvent('invite-blocked', inviter.name, { ip, detail: `受邀账号 ${invitedUser.name} 与邀请人使用同一设备` });
    return { settled: false, reason: 'same-device' };
  }
  const stats = pointAwardStats(inviter, 'invite');
  if (stats.day >= INVITE_REWARD_DAY_CAP || stats.total >= INVITE_REWARD_TOTAL_CAP) {
    invitedUser.inviteStatus = 'capped';
    logEvent('invite-capped', inviter.name, {
      ip,
      detail: `邀请奖励已达上限（今日 ${stats.day}/${INVITE_REWARD_DAY_CAP}，累计 ${stats.total}/${INVITE_REWARD_TOTAL_CAP}）`,
    });
    return { settled: false, reason: 'capped' };
  }
  const key = `invite:${invitedUser.name}`;
  if (!awardPoints(inviter, key, INVITE_REWARD_POINTS)) return { settled: false, reason: 'duplicate' };
  invitedUser.inviteRewardGrantedAt = Date.now();
  invitedUser.inviteStatus = 'settled';
  const detail = `好友完成首个有效建模，邀请奖励 +${INVITE_REWARD_POINTS} 积分（${invitedUser.name}）`;
  logEvent('points-earn', inviter.name, {
    ip,
    detail,
  });
  // 单独记录邀请结算，供后台转化/邀请统计使用；积分审计事件仍保留。
  logEvent('invite-settled', inviter.name, {
    ip,
    detail,
  });
  return { settled: true, awarded: INVITE_REWARD_POINTS };
}

/** 定长常量时间比较，避免用 === 比较口令时泄漏长度/前缀信息。 */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function authUser(req, ip) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const payload = verifyToken(token);
  if (!payload) return { status: 401, error: '登录状态已失效，请重新登录', detail: '无效令牌' };
  const device = String(req.headers['x-mmodels-device'] || '');
  if (!DEVICE_RE.test(device)) return { status: 400, error: '设备标识不合法，请重启客户端后重试', detail: '设备标识不合法' };
  db = loadDb();
  const user = db.users[payload.username];
  if (!user) return { status: 401, error: '账号不存在，请重新注册', detail: '账号不存在' };
  if (user.banned) return { status: 403, error: '账号已被停用，请联系客服', detail: '已封禁' };
  if (device !== payload.deviceId || user.deviceId !== device) return { status: 403, error: '当前设备未绑定，请重新登录', detail: '设备不匹配' };
  if (payload.tokenVersion !== (Number(user.tokenVersion) || 1)) return { status: 401, error: '登录状态已更新，请重新登录', detail: '令牌已失效' };
  ensureUser(user);
  return { user, payload, token };
}

function saveQuotaRequest(user, requestId, now) {
  const consumed = user.quota.consumed || (user.quota.consumed = {});
  for (const [key, at] of Object.entries(consumed)) if (Number(at) < now - 2 * DAY_MS) delete consumed[key];
  if (requestId && consumed[requestId]) return true;
  if (requestId) consumed[requestId] = now;
  return false;
}

/**
 * 消耗一次普通对话的统一积分。先消耗当天积分，再消耗历史奖励积分；
 * 这样签到积分不会跨天无限累积，而用户通过建模/反馈获得的积分仍可继续使用。
 * requestId 是幂等键，网络重试不会重复扣分。
 */
function consumeAiPoints(user, requestId, now = Date.now(), _requestedCost = AI_CHAT_POINTS_COST, chatMode = 'basic') {
  ensureUser(user);
  const legacyConsumed = user.quota.consumed || (user.quota.consumed = {});
  const consumed = user.aiPoints.consumed || (user.aiPoints.consumed = {});
  const legacyDuplicate = Boolean(requestId && legacyConsumed[requestId]);
  for (const [key, at] of Object.entries(consumed)) if (Number(at) < now - 2 * DAY_MS) delete consumed[key];
  for (const [key, at] of Object.entries(legacyConsumed)) if (Number(at) < now - 2 * DAY_MS) delete legacyConsumed[key];
  if (requestId && (legacyDuplicate || consumed[requestId])) {
    const snapshot = aiPointsSnapshot(user, now);
    return { duplicate: true, cost: 0, remaining: snapshot.balance };
  }
  // 重新按服务端模式派生，调用方即使传入篡改后的数字也不会改变扣费。
  const cost = requestedChatCost(undefined, chatMode);
  const before = aiPointsSnapshot(user, now).balance;
  if (before < cost) return { duplicate: false, cost, remaining: before, exhausted: true };
  const fromDaily = Math.min(Math.max(0, Number(user.aiPoints.dailyRemaining) || 0), cost);
  const fromRewards = cost - fromDaily;
  user.aiPoints.dailyRemaining = Math.max(0, Number(user.aiPoints.dailyRemaining) - fromDaily);
  user.points = Math.max(0, Number(user.points) - fromRewards);
  if (requestId) {
    consumed[requestId] = now;
    legacyConsumed[requestId] = now;
  }
  // 旧字段同步为“已用对话数”，仅供旧客户端显示，不再作为扣减依据。
  user.quota.used = Math.max(0, Math.floor((user.aiPoints.dailyGrant + user.aiPoints.dailyBonus - user.aiPoints.dailyRemaining) / cost));
  user.quota.bonus = Math.max(0, Math.floor(user.aiPoints.dailyBonus / cost));
  const after = aiPointsSnapshot(user, now).balance;
  return { duplicate: false, cost, remaining: after };
}

function aiRequestAlreadyConsumed(user, requestId, now = Date.now()) {
  if (!requestId) return false;
  ensureUser(user);
  const oldAt = Number(user.quota?.consumed?.[requestId]) || 0;
  const newAt = Number(user.aiPoints?.consumed?.[requestId]) || 0;
  return oldAt > now - 2 * DAY_MS || newAt > now - 2 * DAY_MS;
}

function activateCard(code, deviceId, username) {
  const card = db.cards[code];
  if (!card) return { status: 404, error: '卡密不存在' };
  if (card.revoked) return { status: 409, error: '卡密已作废' };
  if (card.usedBy) return { status: 409, error: '卡密已兑换，不能重复使用' };
  const now = Date.now();
  const user = db.users[username];
  const base = user ? Math.max(now, Number(user.expiresAt) || 0, trialActive(user, now) ? Number(user.trialExpiresAt) : 0) : now;
  const expiresAt = base + card.days * 86_400_000;
  card.usedBy = card.usedBy || deviceId;
  card.usedByUsername = card.usedByUsername || username;
  card.usedAt = card.usedAt || now;
  user.expiresAt = expiresAt;
  user.plan = 'vip';
  user.vipSource = 'card';
  ensureUser(user);
  return { expiresAt, days: card.days }; // 日志由调用方记录（register 激活不应计入 redeem 统计）
}

function issueToken(user, deviceId) {
  user.tokenVersion = Number.isInteger(user.tokenVersion) && user.tokenVersion > 0 ? user.tokenVersion : 1;
  // 免费账号过了试用期仍可登录并使用每日基础额度，令牌寿命不能跟着试用期失效。
  // VIP 到期后 plan 字段保留历史状态用于审计，因此必须同时判断 expiresAt，
  // 否则过期账号重新登录会拿到一个已经过期的令牌，无法回到免费额度。
  const tokenExpiresAt = user.plan === 'vip' && Number(user.expiresAt) > Date.now()
    ? user.expiresAt
    : Date.now() + 3650 * DAY_MS;
  return signPayload({ username: user.name, deviceId, expiresAt: tokenExpiresAt, tokenVersion: user.tokenVersion });
}

// ---------- HTTP 基础 ----------
function send(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    ...extraHeaders,
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 16 * 1024) { reject(new Error('too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function checkAdmin(req) {
  if (!rateAllowed(`admin:${requestIp(req)}`, 60, 60_000)) return false;
  const h = req.headers['authorization'] || '';
  if (!h.startsWith('Basic ')) return false;
  const supplied = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const split = supplied.indexOf(':');
  const expectedSplit = ADMIN_AUTH.indexOf(':');
  if (split < 0 || expectedSplit < 0) return false;
  const u = supplied.slice(0, split);
  const p = supplied.slice(split + 1);
  const eu = ADMIN_AUTH.slice(0, expectedSplit);
  const ep = ADMIN_AUTH.slice(expectedSplit + 1);
  return safeEqual(u, eu) && safeEqual(p, ep);
}

/**
 * 管理后台使用 Basic Auth，但浏览器会自动带上已缓存的凭据；
 * 仅靠 Basic Auth 仍可能被第三方页面诱导发起跨站写请求。
 * 有来源头时只接受同一 Host；命令行/健康检查没有来源头则保持兼容。
 */
function adminOriginAllowed(req) {
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  const origin = String(req.headers.origin || '').trim();
  if (!origin) {
    const referer = String(req.headers.referer || '').trim();
    if (!referer) return true;
    try {
      return new URL(referer).host === String(req.headers.host || '').trim();
    } catch { return false; }
  }
  try {
    return new URL(origin).host === String(req.headers.host || '').trim();
  } catch { return false; }
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;
/** 登录标识解析：优先用户名精确匹配，其次按绑定邮箱（忽略大小写）匹配。 */
function findUserByLogin(identifier) {
  const key = String(identifier || '').trim();
  if (!key) return null;
  if (db.users[key]) return db.users[key];
  if (!key.includes('@')) return null;
  const mail = key.toLowerCase();
  return Object.values(db.users).find((u) => String(u.email || '').toLowerCase() === mail) || null;
}
const CARD_RE = /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/;
const DEVICE_RE = /^[A-Za-z0-9._:-]{8,200}$/;
const cardLabel = (code) => `****-${String(code || '').slice(-4)}`;

async function handleRequest(req, res) {
  const url = (req.url || '/').split('?')[0];
  const ip = requestIp(req);
  if (req.method === 'OPTIONS') return send(res, 204, {});

  try {
    // ===== 公开 =====
    if (req.method === 'GET' && url === '/health') {
      return send(res, 200, { ok: true, service: 'mmodels-license', version: 4, time: Date.now() });
    }

    // 客户端运行诊断上报：错误、卡顿、启动失败等。无需登录（登录前也会出错），
    // 只存诊断文本，不采集用户内容。默认开启，客户端不做开关。
    if (req.method === 'POST' && url === '/api/telemetry') {
      if (!rateAllowed(`telemetry:${ip}`, 60, 3600_000)) return send(res, 429, { ok: false, error: '上报过于频繁' });
      const b = await readBody(req);
      const message = String(b.message || '').trim().slice(0, 500);
      if (!message) return send(res, 400, { ok: false, error: '上报内容为空' });
      db = loadDb();
      db.reports.push({
        id: `rp-${crypto.randomBytes(6).toString('hex')}`,
        kind: String(b.kind || 'error').slice(0, 24),
        message,
        detail: String(b.detail || '').slice(0, 4000),
        version: String(b.version || '').slice(0, 32),
        platform: String(b.platform || '').slice(0, 64),
        device: String(b.deviceId || '').slice(0, 64),
        username: String(b.username || '').slice(0, 24),
        ip,
        t: Date.now(),
        handled: false,
      });
      if (db.reports.length > 5000) db.reports = db.reports.slice(-3000);
      saveDb();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url === '/api/auth/register') {
      db = loadDb();
      if (!rateAllowed(`reg:${ip}`, 5, 3600_000)) return send(res, 429, { ok: false, error: '注册过于频繁' });
      const b = await readBody(req);
      const username = String(b.username || '').trim();
      const password = String(b.password || '');
      const deviceId = String(b.deviceId || '').trim();
      const email = String(b.email || '').trim().toLowerCase();
      const emailCode = String(b.emailCode || '').trim();
      const inviteCode = String(b.inviteCode || '').trim().toUpperCase();
      if (!USERNAME_RE.test(username)) return send(res, 400, { ok: false, error: '账号需 3-24 位字母/数字/下划线' });
      if (!PASSWORD_RE.test(password)) return send(res, 400, { ok: false, error: '密码需为 8-128 位且不能含控制字符' });
      if (!DEVICE_RE.test(deviceId)) return send(res, 400, { ok: false, error: '设备标识不合法，请重启客户端后重试' });
      if (!EMAIL_RE.test(email)) return send(res, 400, { ok: false, error: '邮箱格式不正确' });
      if (Object.values(db.users).some((u) => (u.email || '') === email)) return send(res, 409, { ok: false, error: '该邮箱已绑定其他账号' });
      if (db.users[username]) return send(res, 409, { ok: false, error: '账号已存在' });
      let inviter = null;
      if (inviteCode) {
        inviter = Object.values(db.users).find((candidate) => candidate.inviteCode === inviteCode && candidate.name !== username) || null;
        if (!inviter) return send(res, 400, { ok: false, error: '邀请标识无效，请检查后重试' });
        if (inviter.deviceId && inviter.deviceId === deviceId) {
          return send(res, 409, { ok: false, error: '邀请人和新账号不能使用同一台设备' });
        }
      }
      const code = String(b.code || '').trim().toUpperCase();
      if (code && !CARD_RE.test(code)) return send(res, 400, { ok: false, error: '卡密格式不正确' });
      const vr = verifyEmailCode('register', email, emailCode);
      if (vr.error) return send(res, 400, { ok: false, error: vr.error });
      const now = Date.now();
      db.users[username] = {
        name: username, passHash: hashPass(password), tokenVersion: 1, createdAt: now,
        expiresAt: now, trialExpiresAt: now + TRIAL_MS, trialGrantedAt: now,
        plan: 'free', points: 0, pointsAwards: {},
        quota: { date: dayKey(now), used: 0, bonus: 0, consumed: {} }, checkinDate: '',
        banned: false, deviceId, lastLoginAt: now, email, inviteCode: genInviteCode(),
      };
      if (inviter) {
        db.users[username].invitedBy = inviter.name;
        db.users[username].inviteSourceDeviceId = inviter.deviceId || '';
      }
      let token = '';
      let expiresAt = now;
      let usedCard = '';
      if (code) {
        const r = activateCard(code, deviceId, username);
        if (r.error) {
          delete db.users[username]; saveDb();
          // 恢复验证码：卡密问题不影响已验证的邮箱，用户换卡密可直接重试
          emailCodes.set(`register|${email}`, { code: emailCode, exp: Date.now() + 10 * 60_000, resendAt: 0, tries: 0 });
          logEvent('register-fail', username, { ip, detail: `卡密 ${cardLabel(code)} 激活失败：${r.error}` });
          return send(res, r.status, { ok: false, error: r.error });
        }
        expiresAt = r.expiresAt;
        usedCard = code;
      }
      db.users[username].expiresAt = expiresAt;
      awardPoints(db.users[username], 'register', POINT_REWARDS.register);
      token = issueToken(db.users[username], deviceId);
      logEvent('trial-start', username, { ip, detail: `注册后开放 ${TRIAL_HOURS} 小时完整体验` });
      logEvent('points-earn', username, { ip, detail: `注册奖励 +${POINT_REWARDS.register} 积分` });
      if (inviter) {
        // 邀请只记录待验证关系；受邀人完成首个有效建模回合后再给邀请人发放低额奖励。
        db.users[username].inviteStatus = 'pending';
        logEvent('invite-pending', username, { ip, detail: `已记录邀请人 ${inviter.name}，完成首个有效项目后结算奖励` });
      }
      logEvent('register', username, { ip, detail: usedCard ? `激活卡密 ${cardLabel(usedCard)}（+${Math.round((expiresAt - now) / 86_400_000)} 天）` : '未带卡密' });
      saveDb();
      return send(res, 200, { ok: true, token, activated: Boolean(code), ...accountSnapshot(db.users[username]) });
    }

    if (req.method === 'POST' && url === '/api/auth/send-code') {
      db = loadDb();
      if (!rateAllowed(`sendcode:${ip}`, 20, 3600_000)) return send(res, 429, { ok: false, error: '请求过于频繁' });
      const b = await readBody(req);
      const email = String(b.email || '').trim().toLowerCase();
      const purpose = String(b.purpose || 'register');
      if (!EMAIL_RE.test(email)) return send(res, 400, { ok: false, error: '邮箱格式不正确' });
      if (purpose !== 'register' && purpose !== 'reset') return send(res, 400, { ok: false, error: '参数不合法' });
      const bound = Object.values(db.users).find((u) => (u.email || '') === email);
      if (purpose === 'register' && bound) return send(res, 409, { ok: false, error: '该邮箱已绑定其他账号' });
      if (purpose === 'reset' && !bound) return send(res, 404, { ok: false, error: '该邮箱未绑定任何账号' });
      const r = issueEmailCode(purpose, email, ip);
      if (r.error) return send(res, 429, { ok: false, error: r.error });
      try {
        await sendMail(
          email,
          purpose === 'register' ? 'MModels 注册验证码' : 'MModels 重置密码验证码',
          `你的验证码是：${r.code}\n\n10 分钟内有效，请勿泄露给他人。若非本人操作请忽略本邮件。\n\n—— MModels 数学建模工作台`,
        );
        logEvent('send-code', email, { ip, detail: purpose === 'register' ? '发送注册验证码' : '发送重置密码验证码' });
        saveSoon();
        return send(res, 200, { ok: true, hint: '验证码已发送至邮箱，10 分钟内有效' });
      } catch (e) {
        logEvent('send-code-fail', email, { ip, detail: String(e.message || e).slice(0, 140) });
        saveSoon();
        if (String(e.message).includes('MAIL_NOT_CONFIGURED')) return send(res, 503, { ok: false, error: '邮件服务暂未开通，请联系管理员' });
        return send(res, 500, { ok: false, error: '验证码发送失败，请稍后重试' });
      }
    }

    if (req.method === 'POST' && url === '/api/auth/reset-pass') {
      db = loadDb();
      if (!rateAllowed(`reset:${ip}`, 5, 3600_000)) return send(res, 429, { ok: false, error: '尝试过于频繁' });
      const b = await readBody(req);
      const email = String(b.email || '').trim().toLowerCase();
      const emailCode = String(b.emailCode || '').trim();
      const newPassword = String(b.newPassword || '');
      if (!EMAIL_RE.test(email)) return send(res, 400, { ok: false, error: '邮箱格式不正确' });
      if (!PASSWORD_RE.test(newPassword)) return send(res, 400, { ok: false, error: '密码需为 8-128 位且不能含控制字符' });
      const user = Object.values(db.users).find((u) => (u.email || '') === email);
      if (!user) {
        logEvent('reset-fail', email, { ip, detail: '邮箱未绑定账号' });
        return send(res, 404, { ok: false, error: '该邮箱未绑定任何账号' });
      }
      const vr = verifyEmailCode('reset', email, emailCode);
      if (vr.error) {
        logEvent('reset-fail', user.name, { ip, detail: vr.error });
        return send(res, 400, { ok: false, error: vr.error });
      }
      user.passHash = hashPass(newPassword);
      delete user.passEnc;
      user.tokenVersion = (Number(user.tokenVersion) || 1) + 1;
      logEvent('reset-pass', user.name, { ip, detail: '通过邮箱验证码重置密码' });
      saveDb();
      return send(res, 200, { ok: true, hint: '密码已重置，请用新密码登录' });
    }

    if (req.method === 'POST' && url === '/api/auth/login') {
      db = loadDb();
      const b = await readBody(req);
      const identifier = String(b.username || '').trim(); // 用户名或绑定邮箱，二者皆可登录
      const password = String(b.password || '');
      const deviceId = String(b.deviceId || '').trim();
      // 登录限流只记录失败请求，并将公网 IP 与账号分开统计：共享网络下的
      // 其他用户不会因为某个账号输错密码而一起被锁住。
      const loginIpKey = `login-ip:${ip}`;
      const loginAccountKey = `login-account:${ip}:${identifier.toLowerCase()}`;
      const loginRetryAfter = () => Math.max(rateRetryAfter(loginIpKey), rateRetryAfter(loginAccountKey));
      const loginBlocked = () => {
        const retryAfter = loginRetryAfter();
        return send(res, 429, { ok: false, code: 'LOGIN_RATE_LIMITED', error: '登录尝试过于频繁，请稍后重试', retryAfter }, { 'retry-after': String(retryAfter) });
      };
      const loginAvailable = rateAvailable(loginIpKey, 60) && rateAvailable(loginAccountKey, 15);
      if (!loginAvailable) return loginBlocked();
      const recordLoginFailure = () => {
        rateAllowed(loginIpKey, 60, 3600_000);
        rateAllowed(loginAccountKey, 15, 3600_000);
      };
      if (!PASSWORD_RE.test(password)) { recordLoginFailure(); return send(res, 401, { ok: false, error: '账号或密码错误' }); }
      const user = findUserByLogin(identifier);
      if (!DEVICE_RE.test(deviceId)) { recordLoginFailure(); return send(res, 400, { ok: false, error: '设备标识不合法，请重启客户端后重试' }); }
      const check = user ? verifyPass(user.passHash || user.passEnc, password) : { ok: false, migrated: null };
      if (!user || !check.ok) {
        recordLoginFailure();
        logEvent('login-fail', identifier || '-', { ip, detail: '账号或密码错误' });
        return send(res, 401, { ok: false, error: '账号或密码错误' });
      }
      if (user.banned) {
        recordLoginFailure();
        logEvent('login-fail', user.name, { ip, detail: '账号已被停用' });
        return send(res, 403, { ok: false, error: '账号已被停用' });
      }
      user.deviceId = deviceId; // 换设备 = 重新绑定，旧设备下次 check 失效
      if (check.migrated) { user.passHash = check.migrated; delete user.passEnc; }
      user.lastLoginAt = Date.now();
      user.lastIp = ip;
      ensureUser(user);
      const token = issueToken(user, deviceId);
      logEvent('login', user.name, { ip, detail: identifier === user.name ? '登录成功' : `邮箱登录成功（${identifier}）` });
      saveDb();
      hits.delete(loginAccountKey);
      // 回传真实用户名：客户端据此落盘，避免用邮箱登录后卡密兑换 / 签到找不到账号。
      return send(res, 200, { ok: true, token, username: user.name, ...accountSnapshot(user) });
    }

    if (req.method === 'POST' && url === '/api/redeem') {
      db = loadDb();
      if (!rateAllowed(`redeem:${ip}`, 10, 3600_000)) return send(res, 429, { ok: false, error: '尝试过于频繁' });
      const b = await readBody(req);
      const username = String(b.username || '').trim();
      const password = String(b.password || '');
      const deviceId = String(b.deviceId || '').trim();
      const code = String(b.code || '').trim().toUpperCase();
      if (!PASSWORD_RE.test(password)) return send(res, 401, { ok: false, error: '账号或密码错误' });
      const user = db.users[username];
      if (!DEVICE_RE.test(deviceId)) return send(res, 400, { ok: false, error: '设备标识不合法，请重启客户端后重试' });
      const check = user ? verifyPass(user.passHash || user.passEnc, password) : { ok: false, migrated: null };
      if (!user || !check.ok) {
        logEvent('redeem-fail', username || '-', { ip, detail: '账号或密码错误' });
        return send(res, 401, { ok: false, error: '账号或密码错误' });
      }
      if (user.banned) {
        logEvent('redeem-fail', username, { ip, detail: '账号已被停用' });
        return send(res, 403, { ok: false, error: '账号已被停用' });
      }
      if (!CARD_RE.test(code)) {
        logEvent('redeem-fail', username, { ip, detail: '卡密格式不正确' });
        return send(res, 400, { ok: false, error: '卡密格式不正确' });
      }
      const r = activateCard(code, deviceId, username);
      if (r.error) {
        logEvent('redeem-fail', username, { ip, detail: `卡密 ${cardLabel(code)}：${r.error}` });
        return send(res, r.status, { ok: false, error: r.error });
      }
      user.deviceId = deviceId;
      const token = issueToken(user, deviceId);
      logEvent('redeem', username, { ip, days: r.days, detail: `卡密 ${cardLabel(code)}（+${r.days} 天）` });
      if (check.migrated) { user.passHash = check.migrated; delete user.passEnc; }
      saveDb();
      return send(res, 200, { ok: true, token, ...accountSnapshot(user) });
    }

    if (req.method === 'POST' && url === '/api/license/check') {
      if (!rateAllowed(`check:${ip}`, 120, 60_000)) return send(res, 429, { allowed: false, code: 'RATE_LIMITED', reason: '校验请求过于频繁，请稍后重试' });
      const auth = authUser(req, ip);
      if (auth.error) {
        logEvent('check-fail', '-', { ip, detail: auth.detail });
        return send(res, auth.status, { allowed: false, reason: auth.error, code: 'LOGIN_REQUIRED' });
      }
      const b = await readBody(req);
      const user = auth.user;
      const feature = String(b.feature || 'ai-chat');
      const consume = b.consume === true;
      const requestId = String(b.requestId || '');
      // pointsCost 仅保留给旧客户端的协议兼容，不参与服务端计费；实际成本由
      // 明确的 chatMode 白名单决定，避免篡改客户端把论文/评阅回合报成低价问答。
      const chatMode = normalizeChatMode(b.chatMode ?? b.costKind ?? b.mode);
      const requestedCost = feature === 'ai-chat'
        ? requestedChatCost(undefined, chatMode)
        : AI_CHAT_POINTS_COST;
      if (!FREE_FEATURES.has(feature) && !VIP_FEATURES.has(feature)) return send(res, 400, { allowed: false, code: 'INVALID_FEATURE', reason: '功能标识不合法' });
      if (consume && feature === 'ai-chat' && !/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) return send(res, 400, { allowed: false, code: 'INVALID_REQUEST_ID', reason: '请求标识不合法' });
      const now = Date.now();
      const snapshot = accountSnapshot(user, now);
      const paidVip = snapshot.paidVip === true;
      const elevated = paidVip || snapshot.trialActive;
      // 团队型能力与深度建模是付费卡密的核心权益，24 小时体验也不能使用。
      if (PAID_ONLY_FEATURES.has(feature) && !paidVip) {
        logEvent('vip-block', user.name, { ip, detail: `拦截未兑换付费卡密的能力 ${feature}：${snapshot.trialActive ? '试用期' : '免费版'}` });
        saveSoon();
        return send(res, 403, {
          allowed: false,
          code: snapshot.trialActive ? 'PAID_VIP_REQUIRED' : 'FEATURE_VIP_REQUIRED',
          reason: snapshot.trialActive
            ? '多智能体协作、AI 全自动与深度建模需要兑换付费 VIP 卡密，24 小时体验可先使用其余全部功能'
            : '多智能体协作、AI 全自动与深度建模需要兑换付费 VIP 卡密，请打开会员中心兑换',
          ...snapshot,
        });
      }
      if (VIP_FEATURES.has(feature) && !elevated) {
        logEvent('vip-block', user.name, { ip, detail: `拦截会员功能：${feature}` });
        saveSoon();
        return send(res, 403, { allowed: false, code: 'FEATURE_VIP_REQUIRED', reason: '当前功能需要会员，可在会员中心升级', ...snapshot });
      }
      if (feature === 'ai-chat' && !elevated) {
        const points = aiPointsSnapshot(user, now);
        const duplicateRequest = consume && aiRequestAlreadyConsumed(user, requestId, now);
        if (!duplicateRequest && points.balance < requestedCost) {
          logEvent('quota-exhausted', user.name, { ip, detail: `AI 积分不足（${chatMode} 模式，本轮需要 ${requestedCost} 积分）` });
          saveSoon();
          return send(res, 403, {
            allowed: false,
            code: 'AI_QUOTA_EXCEEDED',
            reason: '今日 AI 积分余额不足，签到或开通 VIP 后可继续使用',
            chatMode,
            ...snapshot,
          });
        }
        if (consume) {
          const spent = consumeAiPoints(user, requestId, now, requestedCost, chatMode);
          if (spent.exhausted) {
            logEvent('quota-exhausted', user.name, { ip, detail: `AI 积分不足（${chatMode} 模式，本轮需要 ${spent.cost} 积分）` });
            saveSoon();
            return send(res, 403, {
              allowed: false,
              code: 'AI_QUOTA_EXCEEDED',
              reason: '今日 AI 积分余额不足，签到或开通 VIP 后可继续使用',
              chatMode,
              ...accountSnapshot(user, now),
            });
          }
          logEvent('ai-consume', user.name, { ip, detail: `消耗 ${spent.cost} 积分（${chatMode} 模式），对话后余额 ${spent.remaining}` });
          saveDb();
          return send(res, 200, { allowed: true, duplicate: spent.duplicate, ...accountSnapshot(user, now), costPoints: spent.cost, pointsPerTurn: spent.cost, pointsBalance: spent.remaining, chatMode });
        }
      }
      return send(res, 200, { allowed: true, ...accountSnapshot(user, now) });
    }

    if (req.method === 'POST' && url === '/api/account/status') {
      if (!rateAllowed(`account-status:${ip}`, 60, 60_000)) return send(res, 429, { ok: false, code: 'RATE_LIMITED', error: '状态查询过于频繁，请稍后重试' });
      const auth = authUser(req, ip);
      if (auth.error) return send(res, auth.status, { ok: false, code: 'LOGIN_REQUIRED', error: auth.error });
      saveSoon();
      return send(res, 200, { ok: true, ...accountSnapshot(auth.user) });
    }

    if (req.method === 'POST' && url === '/api/account/logout') {
      if (!rateAllowed(`account-logout:${ip}`, 30, 60_000)) return send(res, 429, { ok: false, code: 'RATE_LIMITED', error: '请求过于频繁，请稍后重试' });
      const auth = authUser(req, ip);
      if (auth.error) return send(res, auth.status, { ok: false, code: 'LOGIN_REQUIRED', error: auth.error });
      // 退出登录必须让服务端令牌真正失效：只删本地文件的话，令牌泄漏后 10 年内都能冒用。
      auth.user.tokenVersion = Number(auth.user.tokenVersion || 1) + 1;
      logEvent('logout', auth.user.name, { ip, detail: '退出登录，旧令牌已失效' });
      saveDb();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url === '/api/account/checkin') {
      if (!rateAllowed(`account-checkin:${ip}`, 10, 60_000)) return send(res, 429, { ok: false, code: 'RATE_LIMITED', error: '签到请求过于频繁，请稍后重试' });
      const auth = authUser(req, ip);
      if (auth.error) return send(res, auth.status, { ok: false, code: 'LOGIN_REQUIRED', error: auth.error });
      const user = auth.user;
      const today = dayKey();
      if (user.checkinDate === today) return send(res, 200, { ok: true, alreadyCheckedIn: true, ...accountSnapshot(user) });
      user.checkinDate = today;
      // 所有状态都统一显示“积分”：免费账号签到增加当天可用积分；
      // 试用/VIP 不扣 AI 积分，因此签到给少量持久积分作为回馈。
      if (user.plan === 'vip' || trialActive(user)) {
        user.points = Math.max(0, Number(user.points) || 0) + CHECKIN_VIP_POINTS;
        logEvent('checkin', user.name, { ip, detail: `会员签到奖励 +${CHECKIN_VIP_POINTS} 积分` });
      } else {
        // 签到只增加当前剩余积分，不能把当天已经消耗的基础积分补回来。
        // 例如还剩 20 分时签到，签到后应为 120 分，而不是先恢复到 100 再加到 200。
        // dailyBonus 仍保留为兼容字段，最终余额封顶为 dailyGrant + dailyBonus。
        user.aiPoints.dailyBonus = CHECKIN_BONUS_POINTS;
        const dailyGrant = Math.max(0, Number(user.aiPoints.dailyGrant) || FREE_DAILY_POINTS);
        const currentRemaining = Math.max(0, Number(user.aiPoints.dailyRemaining) || 0);
        user.aiPoints.dailyRemaining = Math.min(
          currentRemaining + CHECKIN_BONUS_POINTS,
          dailyGrant + user.aiPoints.dailyBonus,
        );
        user.quota.bonus = CHECKIN_BONUS_QUOTA;
        logEvent('checkin', user.name, { ip, detail: `签到奖励 +${CHECKIN_BONUS_POINTS} AI 积分` });
      }
      saveDb();
      return send(res, 200, { ok: true, alreadyCheckedIn: false, ...accountSnapshot(user) });
    }

    if (req.method === 'POST' && url === '/api/account/points-redeem') {
      if (!rateAllowed(`points-redeem:${ip}`, 10, 60_000)) return send(res, 429, { ok: false, code: 'RATE_LIMITED', error: '兑换请求过于频繁，请稍后重试' });
      const auth = authUser(req, ip);
      if (auth.error) return send(res, auth.status, { ok: false, code: 'LOGIN_REQUIRED', error: auth.error });
      // 新积分统一用于普通 AI 对话，不再兑换会员；多智能体必须由付费卡密解锁。
      // 保留端点是为了让旧客户端得到明确中文提示，而不是落入 404 或误发 VIP。
      logEvent('points-redeem-block', auth.user.name, { ip, detail: '积分兑换会员已停用，请使用付费卡密兑换' });
      return send(res, 409, {
        ok: false,
        code: 'POINTS_REDEEM_DISABLED',
        error: '积分现在用于 AI 对话，会员请使用付费卡密兑换',
        ...accountSnapshot(auth.user),
      });
    }

    if (req.method === 'POST' && url === '/api/account/points-earn') {
      const auth = authUser(req, ip);
      if (auth.error) return send(res, auth.status, { ok: false, code: 'LOGIN_REQUIRED', error: auth.error });
      if (!rateAllowed(`points:${auth.user.name}:${ip}`, 30, 3600_000)) {
        return send(res, 429, { ok: false, code: 'POINTS_TOO_FREQUENT', error: '积分奖励记录过于频繁，请稍后再试' });
      }
      const b = await readBody(req);
      const kind = String(b.kind || '').trim();
      if (!POINT_REWARD_KINDS.has(kind)) {
        return send(res, 400, { ok: false, code: 'INVALID_POINT_KIND', error: '积分奖励类型不合法' });
      }
      // 邀请奖励必须由服务端在受邀用户完成首个有效项目后结算，
      // 不接受客户端自行伪造 eventId 领取，避免刷积分。
      if (kind === 'invite') {
        return send(res, 409, { ok: false, code: 'INVITE_NOT_VERIFIED', error: '邀请关系尚未完成验证，暂不能领取该奖励' });
      }
      const eventId = String(b.eventId || '').trim();
      const key = pointRewardKey(kind, eventId);
      if (!key) {
        return send(res, 400, { ok: false, code: 'EVENT_ID_REQUIRED', error: '这类奖励需要提供有效的完成记录' });
      }
      const user = auth.user;
      if (kind === 'feedback') {
        // 反馈积分只能对应服务端已经落库的反馈，不能仅凭客户端随便填一个事件号领取。
        const feedbackExists = db.feedbacks.some((item) => item && item.id === eventId && item.username === user.name);
        if (!feedbackExists) {
          return send(res, 409, { ok: false, code: 'FEEDBACK_NOT_FOUND', error: '请先提交有效反馈，再领取反馈积分' });
        }
      }
      if (kind === 'paperExport' && !paidVipActive(user)) {
        // 成品导出本身属于卡密 VIP；不要让免费客户端仅凭一个事件编号
        // 伪造“已导出论文”来领取奖励。真正的导出在 license/check 与文件保存
        // 两层都已拦截，这里再做一次服务端兜底。
        return send(res, 403, { ok: false, code: 'FEATURE_VIP_REQUIRED', error: '论文成品导出奖励需要卡密 VIP' });
      }
      if (kind === 'firstProject' && eventId !== 'first-project') {
        return send(res, 400, { ok: false, code: 'EVENT_ID_INVALID', error: '首个项目奖励记录不合法' });
      }
      // 反馈奖励必须先由后台审核为“有用”；客户端只能提交反馈，不能自行把
      // pending 记录变成积分。审核接口会使用稳定的反馈 ID 发放幂等奖励。
      if (kind === 'feedback') {
        const feedback = db.feedbacks.find((item) => item && item.id === eventId && item.username === user.name);
        if (!feedback) {
          return send(res, 409, { ok: false, code: 'FEEDBACK_NOT_FOUND', error: '请先提交反馈，审核通过后才能领取奖励' });
        }
        if (feedback.reviewStatus !== 'approved') {
          return send(res, 409, {
            ok: false,
            code: feedback.reviewStatus === 'rejected' ? 'FEEDBACK_NOT_USEFUL' : 'FEEDBACK_REVIEW_PENDING',
            error: feedback.reviewStatus === 'rejected' ? '这条反馈暂未被采纳，暂不发放积分' : '反馈正在审核，审核通过后自动发放 100 积分',
            feedbackId: feedback.id,
            reviewStatus: feedback.reviewStatus || 'pending',
            ...accountSnapshot(user),
          });
        }
      }
      // 反馈奖励是每个账号一次；论文导出按稳定事件编号逐篇幂等。
      const feedbackAlreadyAwarded = kind === 'feedback' && Object.keys(user.pointsAwards).some((awardKey) => awardKey.startsWith('feedback:'));
      const duplicate = feedbackAlreadyAwarded || Boolean(user.pointsAwards[key]);
      // 限次：客户端换一个随机事件编号就能再领一次，必须按类型卡住条数。
      const caps = POINT_EARN_CAPS[kind];
      if (!duplicate && caps) {
        const stats = pointAwardStats(user, kind);
        if (stats.day >= caps.day || stats.total >= caps.total) {
          logEvent('points-earn-capped', user.name, { ip, detail: `${kind} 已达发放上限（当日 ${stats.day}/${caps.day}，累计 ${stats.total}/${caps.total}）` });
          saveSoon();
          return send(res, 429, { ok: false, code: 'POINT_AWARD_CAPPED', error: '这类奖励今天的上限已到，明天再来', ...accountSnapshot(user) });
        }
      }
      const awarded = duplicate ? 0 : POINT_REWARDS[kind] || 0;
      if (!duplicate) {
        awardPoints(user, key, awarded);
        logEvent('points-earn', user.name, {
          ip,
          days: 0,
          detail: `${kind} 完成奖励 +${awarded} 积分（${eventId || '首次完成'}）`,
        });
        if (kind === 'paperExport') {
          // 单独记录成功导出事件，供后台统计论文导出量；points-earn 仍保留作积分审计。
          logEvent('paper-export', user.name, {
            ip,
            detail: `论文导出成功，奖励 ${awarded} 积分（${eventId}）`,
          });
        }
        saveDb();
      } else {
        logEvent('points-earn-duplicate', user.name, { ip, detail: `${kind} 重复事件，未重复发放积分（${eventId}）` });
        saveSoon();
      }
      if (kind === 'firstProject') {
        // 兼容已经记过首个项目、但尚未结算邀请奖励的历史账号。
        const settled = settleInviteReward(user, ip);
        if (settled.settled) saveDb();
      }
      return send(res, 200, {
        ok: true,
        kind,
        awarded,
        duplicate,
        ...accountSnapshot(user),
      });
    }

    // 用户反馈：正文落库，后台「反馈」页可见；必须审核为有用后才奖励 100 积分。
    if (req.method === 'POST' && url === '/api/account/feedback') {
      const auth = authUser(req, ip);
      if (auth.error) return send(res, auth.status, { ok: false, code: 'LOGIN_REQUIRED', error: auth.error });
      if (!rateAllowed(`feedback:${auth.user.name}:${ip}`, 5, 3600_000)) {
        return send(res, 429, { ok: false, code: 'FEEDBACK_TOO_FREQUENT', error: '反馈提交过于频繁，请稍后再试' });
      }
      const b = await readBody(req);
      const text = String(b.text || '').trim().slice(0, 2000);
      if (text.length < 8) return send(res, 400, { ok: false, code: 'FEEDBACK_TOO_SHORT', error: '反馈内容太短，请至少写 8 个字' });
      const user = auth.user;
      const id = `fb-${crypto.randomBytes(6).toString('hex')}`;
      db.feedbacks.push({
        id,
        username: user.name,
        text,
        contact: String(b.contact || '').slice(0, 120),
        version: String(b.version || '').slice(0, 32),
        platform: String(b.platform || '').slice(0, 64),
        ip,
        t: Date.now(),
        handled: false,
        reviewStatus: 'pending',
        reviewedAt: 0,
        reviewedBy: '',
        rewardedAt: 0,
        awarded: 0,
      });
      if (db.feedbacks.length > 3000) db.feedbacks = db.feedbacks.slice(-2000);
      logEvent('feedback', user.name, { ip, detail: text.slice(0, 120) });
      saveDb();
      return send(res, 200, {
        ok: true,
        feedbackId: id,
        reviewStatus: 'pending',
        awarded: 0,
        message: '反馈已提交，审核通过后奖励 100 积分',
        ...accountSnapshot(user),
      });
    }

    // ===== 管理 =====
    if (req.method === 'GET' && (url === '/admin.html' || url === ADMIN_PREFIX + '.html')) {
      res.writeHead(302, { location: ADMIN_PREFIX, 'cache-control': 'no-store' });
      return res.end();
    }
    if (url === ADMIN_PREFIX || url.startsWith(ADMIN_PREFIX + '/')) {
      // 认证检查放在最前：随机路径 + Basic Auth 双重保护，未认证时
      // 连管理页外壳都不返回（避免路径被扫描出来后确认「这里确实是后台」）。
      if (!checkAdmin(req)) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="MModels Admin", charset="UTF-8"' });
        return res.end('需要管理员登录');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD' && !adminOriginAllowed(req)) {
        return send(res, 403, { ok: false, code: 'ADMIN_ORIGIN_REJECTED', error: '管理请求来源不受信任，请从后台页面重试' });
      }
      if ((url === ADMIN_PREFIX || url === `${ADMIN_PREFIX}/`) && req.method === 'GET') {
        try {
          const html = fs.readFileSync(ADMIN_HTML);
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'same-origin',
          });
          return res.end(html);
        } catch { return send(res, 500, { ok: false, error: 'admin.html 缺失' }); }
      }
      if (req.method === 'GET' && url === ADMIN_PREFIX + '/api/overview') {
        db = loadDb();
        const now = Date.now();
        const users = Object.values(db.users);
        users.forEach((user) => ensureUser(user));
        saveSoon();
        const day = 86_400_000;
        const todayStartDate = new Date(now);
        todayStartDate.setHours(0, 0, 0, 0);
        const todayStart = todayStartDate.getTime();
        const events = Array.isArray(db.events) ? db.events : [];
        const countType = (type, since = 0) => events.filter((e) => e.type === type && e.t >= since).length;
        const sumPointDetails = (pattern, since = 0) => events
          .filter((e) => e.t >= since && pattern.test(String(e.detail || '')))
          .reduce((sum, e) => sum + (Number(String(e.detail || '').match(pattern)?.[1]) || 0), 0);
        const days7 = Array.from({ length: 7 }, (_, i) => {
          const dStart = new Date(now - (6 - i) * day); dStart.setHours(0, 0, 0, 0);
          const dEnd = dStart.getTime() + day;
          const label = `${dStart.getMonth() + 1}/${dStart.getDate()}`;
          return {
            label,
            registers: db.events.filter((e) => e.type === 'register' && e.t >= dStart.getTime() && e.t < dEnd).length,
            redeems: db.events.filter((e) => e.type === 'redeem' && e.t >= dStart.getTime() && e.t < dEnd).length,
            checkins: db.events.filter((e) => e.type === 'checkin' && e.t >= dStart.getTime() && e.t < dEnd).length,
            aiUses: db.events.filter((e) => e.type === 'ai-consume' && e.t >= dStart.getTime() && e.t < dEnd).length,
          };
        });
        const vipUsers = users.filter((u) => !u.banned && u.plan === 'vip' && Number(u.expiresAt) > now).length;
        const trialUsers = users.filter((u) => !u.banned && u.plan === 'free' && Number(u.trialExpiresAt) > now).length;
        const expiredUsers = users.filter((u) => !u.banned && Number(u.trialExpiresAt || 0) <= now && Number(u.expiresAt || 0) <= now).length;
        const pointsEarned = sumPointDetails(/\+\d+\s*积分/);
        const aiPointsSpent = sumPointDetails(/消耗\s+(\d+)\s*(?:AI\s*)?积分/);
        const legacyExchangeSpent = events.filter((e) => e.type === 'points-redeem').reduce((sum, e) => sum + (Number(String(e.detail || '').match(/使用\s+(\d+)\s*积分/)?.[1]) || 0), 0);
        const pointsSpent = aiPointsSpent + legacyExchangeSpent;
        const invitePending = users.filter((u) => u.inviteStatus === 'pending').length;
        const inviteSettled = countType('invite-settled');
        // 只把真正叠加过有效期的账号计为转化，避免把后台手工延期算成试用转化。
        const trialConvertedUsers = users.filter((u) => Number(u.trialGrantedAt) > 0 && Number(u.expiresAt) > Number(u.trialGrantedAt)).length;
        return send(res, 200, {
          ok: true,
          totalUsers: users.length,
          activeUsers: users.filter((u) => !u.banned && ((u.plan === 'vip' && Number(u.expiresAt) > now) || (u.plan !== 'vip' && Number(u.trialExpiresAt) > now))).length,
          bannedUsers: users.filter((u) => u.banned).length,
          trialUsers,
          vipUsers,
          expiredUsers,
          trialStarted: countType('trial-start'),
          trialExpired: countType('trial-expired'),
          loginCount: countType('login'),
          checkinCount: countType('checkin'),
          aiUsage: countType('ai-consume'),
          todayRegisters: countType('register', todayStart),
          todayRedeems: countType('redeem', todayStart),
          todayCheckins: countType('checkin', todayStart),
          todayAiUsage: countType('ai-consume', todayStart),
          todayQuotaExhausted: countType('quota-exhausted', todayStart),
          todayPointsEarned: sumPointDetails(/\+\d+\s*积分/, todayStart),
          todayPointsSpent: sumPointDetails(/消耗\s+(\d+)\s*(?:AI\s*)?积分/, todayStart),
          quotaExhausted: countType('quota-exhausted'),
          vipBlocks: countType('vip-block'),
          paperExports: countType('paper-export'),
          feedbackCount: (Array.isArray(db.feedbacks) ? db.feedbacks : []).length,
          feedbackPending: (Array.isArray(db.feedbacks) ? db.feedbacks : []).filter((f) => (f.reviewStatus || 'pending') === 'pending').length,
          feedbackApproved: (Array.isArray(db.feedbacks) ? db.feedbacks : []).filter((f) => f.reviewStatus === 'approved').length,
          feedbackRewarded: (Array.isArray(db.feedbacks) ? db.feedbacks : []).filter((f) => Number(f.awarded) > 0).length,
          reportCount: (Array.isArray(db.reports) ? db.reports : []).length,
          pointsEarned,
          pointsSpent,
          aiPointsSpent,
          // 对外统一显示可用积分：包含当天基础/签到积分与奖励积分。
          pointsBalance: users.reduce((sum, u) => sum + aiPointsSnapshot(u, now).balance, 0),
          pointsRewardEvents: countType('points-earn'),
          pointsExchangeEvents: countType('points-redeem'),
          checkinUsers: new Set(events.filter((e) => e.type === 'checkin').map((e) => e.username)).size,
          invitePending,
          inviteSettled,
          trialConvertedUsers,
          expiringUsers: users.filter((u) => {
            if (u.banned) return false;
            const expiry = u.plan === 'vip' ? Number(u.expiresAt) : Number(u.trialExpiresAt);
            return expiry > now && expiry < now + 7 * day;
          }).length,
          totalDays: users.reduce((s, u) => s + Math.max(0, (u.expiresAt - now) / day), 0),
          cardsTotal: Object.keys(db.cards).length,
          cardsUsed: Object.values(db.cards).filter((c) => c.usedBy).length,
          cardsRevoked: Object.values(db.cards).filter((c) => c.revoked).length,
          days7,
        });
      }
      if (req.method === 'GET' && url === ADMIN_PREFIX + '/api/users') {
        db = loadDb();
        const now = Date.now();
        return send(res, 200, {
          ok: true,
          users: Object.values(db.users).map((u) => {
            ensureUser(u);
            const ai = aiPointsSnapshot(u, now);
            return {
            name: u.name, createdAt: u.createdAt,
            expiresAt: u.expiresAt, plan: u.plan === 'vip' && Number(u.expiresAt) > now ? 'vip' : 'free',
            trialExpiresAt: u.trialExpiresAt,
            trialActive: Number(u.trialExpiresAt) > now && u.plan !== 'vip',
            banned: u.banned, deviceBound: Boolean(u.deviceId), lastLoginAt: u.lastLoginAt,
            note: u.note || '', passwordStored: Boolean(u.passHash || u.passEnc),
            points: Math.max(0, Number(u.points) || 0),
            pointsBalance: ai.balance,
            inviteStatus: u.inviteStatus || '',
            vipSource: u.vipSource || '',
          };
          }).sort((a, b) => b.createdAt - a.createdAt),
        });
      }
      if (req.method === 'POST' && url === ADMIN_PREFIX + '/api/users/adjust-points') {
        db = loadDb();
        const b = await readBody(req);
        const u = db.users[String(b.username || '')];
        const delta = Number(b.delta);
        if (!u) return send(res, 404, { ok: false, error: '用户不存在' });
        if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000) {
          return send(res, 400, { ok: false, error: '积分变动需为非 0 整数（±1~1000000）' });
        }
        const before = Math.max(0, Number(u.points) || 0);
        u.points = Math.max(0, before + delta);
        const actual = u.points - before;
        logEvent('admin', u.name, { ip, detail: `积分调整 ${delta > 0 ? '+' : ''}${delta}（实发 ${actual > 0 ? '+' : ''}${actual}），余额 ${u.points}` });
        saveDb();
        return send(res, 200, { ok: true, points: u.points, delta: actual });
      }
      if (req.method === 'GET' && url === ADMIN_PREFIX + '/api/cards') {
        db = loadDb();
        return send(res, 200, {
          ok: true,
          cards: Object.entries(db.cards).map(([code, c]) => ({ code, ...c }))
            .sort((a, b) => b.createdAt - a.createdAt),
        });
      }
      if (req.method === 'POST' && url === ADMIN_PREFIX + '/api/cards/gen') {
        db = loadDb();
        const b = await readBody(req);
        const days = Number(b.days); const count = b.count === undefined ? 1 : Number(b.count);
        if (!Number.isInteger(days) || days < 1 || days > 3650 || !Number.isInteger(count) || count < 1 || count > 200) {
          return send(res, 400, { ok: false, error: '天数和数量必须是合法整数（天数 1~3650，数量 1~200）' });
        }
        const made = [];
        for (let i = 0; i < count; i++) {
          const code = genCardCode();
          db.cards[code] = { days, createdAt: Date.now(), usedBy: null, usedAt: null, revoked: false };
          made.push(code);
        }
        logEvent('admin', 'admin', { ip, detail: `生成 ${count} 张 ${days} 天卡密` });
        saveDb();
        return send(res, 200, { ok: true, codes: made });
      }
      if (req.method === 'POST' && url === ADMIN_PREFIX + '/api/cards/revoke') {
        db = loadDb();
        const b = await readBody(req);
        const card = db.cards[String(b.code || '').toUpperCase()];
        if (!card) return send(res, 404, { ok: false, error: '卡密不存在' });
        if (card.usedBy) return send(res, 409, { ok: false, error: '已兑换卡密不能作废' });
        if (card.revoked) return send(res, 409, { ok: false, error: '卡密已经作废' });
        card.revoked = true;
        logEvent('admin', 'admin', { ip, detail: `作废卡密 ${cardLabel(String(b.code || '').toUpperCase())}` });
        saveDb();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url === ADMIN_PREFIX + '/api/users/ban') {
        db = loadDb();
        const b = await readBody(req);
        const u = db.users[String(b.username || '')];
        if (!u) return send(res, 404, { ok: false, error: '用户不存在' });
        if (typeof b.banned !== 'boolean') return send(res, 400, { ok: false, error: '封禁状态参数不合法' });
        u.banned = b.banned;
        logEvent('admin', u.name, { ip, detail: u.banned ? '封禁账号' : '解封账号' });
        saveDb();
        return send(res, 200, { ok: true, banned: u.banned });
      }
      if (req.method === 'POST' && url === ADMIN_PREFIX + '/api/users/reset-pass') {
        db = loadDb();
        const b = await readBody(req);
        const u = db.users[String(b.username || '')];
        const np = String(b.newPassword || '');
        if (!u) return send(res, 404, { ok: false, error: '用户不存在' });
        if (!PASSWORD_RE.test(np)) return send(res, 400, { ok: false, error: '密码需为 8-128 位且不能含控制字符' });
        u.passHash = hashPass(np);
        delete u.passEnc;
        u.tokenVersion = (Number(u.tokenVersion) || 1) + 1;
        logEvent('admin', u.name, { ip, detail: '重置用户密码' });
        saveDb();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url === ADMIN_PREFIX + '/api/users/unbind') {
        db = loadDb();
        const b = await readBody(req);
        const u = db.users[String(b.username || '')];
        if (!u) return send(res, 404, { ok: false, error: '用户不存在' });
        u.deviceId = '';
        logEvent('admin', u.name, { ip, detail: '解绑设备' });
        saveDb();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url === ADMIN_PREFIX + '/api/users/extend') {
        db = loadDb();
        const b = await readBody(req);
        const u = db.users[String(b.username || '')];
        const days = Number(b.days);
        if (!u) return send(res, 404, { ok: false, error: '用户不存在' });
        if (!Number.isInteger(days) || days === 0 || Math.abs(days) > 3650) {
          return send(res, 400, { ok: false, error: '天数需为非 0 整数（±1~3650）' });
        }
        // 关键：延期必须同步 plan，否则免费用户加了 expiresAt 也不是 VIP
        //（VIP 判定 = plan==='vip' && expiresAt > now）。
        const now = Date.now();
        const base = Math.max(Number(u.expiresAt) || 0, now);
        const next = base + days * DAY_MS;
        if (next > now) {
          u.plan = 'vip';
          u.vipSource = 'admin';
          u.expiresAt = next;
        } else {
          u.plan = 'free';
          delete u.vipSource;
          u.expiresAt = now;
          u.trialExpiresAt = now;
        }
        logEvent('admin', u.name, { ip, detail: `调整会员 ${days > 0 ? '+' : ''}${days} 天 → ${u.plan === 'vip' ? `到期 ${new Date(u.expiresAt).toLocaleString('zh-CN', { hour12: false })}` : '已取消会员'}` });
        saveDb();
        return send(res, 200, { ok: true, expiresAt: u.expiresAt, plan: u.plan });
      }
      if (req.method === 'POST' && url === ADMIN_PREFIX + '/api/users/expire') {
        // 一键取消会员：同时清掉 VIP 试用，回到纯免费态（与客户端「免费版」口径一致）。
        db = loadDb();
        const b = await readBody(req);
        const u = db.users[String(b.username || '')];
        if (!u) return send(res, 404, { ok: false, error: '用户不存在' });
        const now = Date.now();
        u.plan = 'free';
        delete u.vipSource;
        u.expiresAt = now;
        u.trialExpiresAt = now;
        logEvent('admin', u.name, { ip, detail: '取消会员与试用（降为免费版）' });
        saveDb();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url === ADMIN_PREFIX + '/api/users/note') {
        db = loadDb();
        const b = await readBody(req);
        const u = db.users[String(b.username || '')];
        if (!u) return send(res, 404, { ok: false, error: '用户不存在' });
        u.note = String(b.note || '').slice(0, 200);
        logEvent('admin', u.name, { ip, detail: `设置备注：${u.note || '（清空）'}` });
        saveDb();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url === ADMIN_PREFIX + '/api/config') {
        // 把服务端口径的会员/积分/权益定义暴露给后台，保证后台展示与客户端完全一致，
        // 任何一处规则调整后后台会自动跟随，不会出现「后台说的和软件做的不一样」。
        return send(res, 200, {
          ok: true,
          trialHours: TRIAL_HOURS,
          trialDays: TRIAL_DAYS,
          points: {
            dailyGrant: FREE_DAILY_POINTS,
            checkinBonus: CHECKIN_BONUS_POINTS,
            perConversation: AI_CHAT_POINTS_COST,
            conversationCosts: CHAT_POINT_COSTS,
            rewards: POINT_REWARDS,
            exchange: POINT_EXCHANGE,
            exchangeDisabled: true,
          },
          // 兼容字段保留，避免历史管理页无法渲染。
          quota: { base: FREE_BASE_QUOTA, checkinBonus: CHECKIN_BONUS_QUOTA, checkinVipPoints: CHECKIN_VIP_POINTS },
          vipFeatures: [...VIP_FEATURES],
          plans: [
            { id: 'sprint', title: '冲刺卡', price: '¥9.9', days: 7 },
            { id: 'monthly', title: '月卡', price: '¥29', days: 30 },
            { id: 'season', title: '赛季卡', price: '¥59', days: 90 },
            { id: 'annual', title: '年度卡', price: '¥99', days: 365 },
            { id: 'legacy-lifetime', title: '早期长期权益', price: '¥99', days: 3650, legacy: true },
          ],
          adminPath: ADMIN_PREFIX,
        });
      }
      if (req.method === 'GET' && url === ADMIN_PREFIX + '/api/logs') {
        db = loadDb();
        const q = new URLSearchParams((req.url || '').split('?')[1] || '');
        const rawLimit = Number(q.get('limit'));
        const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 1000)) : 300;
        const type = q.get('type') || '';
        const qs = (q.get('q') || '').toLowerCase();
        let logs = db.events.slice().reverse(); // 最新在前
        if (type) logs = logs.filter((e) => e.type === type);
        if (qs) logs = logs.filter((e) => (e.username || '').toLowerCase().includes(qs) || (e.detail || '').toLowerCase().includes(qs) || (e.ip || '').includes(qs));
        return send(res, 200, { ok: true, logs: logs.slice(0, limit) });
      }
      if (req.method === 'GET' && url === ADMIN_PREFIX + '/api/feedback') {
        db = loadDb();
        const list = db.feedbacks.slice().reverse();
        return send(res, 200, { ok: true, feedbacks: list.slice(0, 500), total: list.length });
      }
      if (req.method === 'POST' && url === ADMIN_PREFIX + '/api/feedback/review') {
        db = loadDb();
        const b = await readBody(req);
        const id = String(b.id || '').trim();
        const useful = b.useful === true || b.useful === 'true';
        if (!id || id.length > 80) return send(res, 400, { ok: false, error: '反馈编号不合法' });
        const feedback = db.feedbacks.find((item) => item && item.id === id);
        if (!feedback) return send(res, 404, { ok: false, error: '反馈不存在' });
        if (!['pending', 'approved', 'rejected'].includes(feedback.reviewStatus)) feedback.reviewStatus = 'pending';
        // 审核操作幂等：重复点击不会再次加分，也不会把已拒绝的反馈改成已通过。
        if (feedback.reviewStatus !== 'pending') {
          return send(res, 200, { ok: true, feedback, awarded: Number(feedback.awarded) || 0, duplicate: true });
        }
        const now = Date.now();
        feedback.reviewStatus = useful ? 'approved' : 'rejected';
        feedback.reviewedAt = now;
        feedback.reviewedBy = 'admin';
        feedback.handled = true;
        feedback.awarded = 0;
        if (useful) {
          const user = db.users[feedback.username];
          if (user) {
            ensureUser(user);
            const alreadyAwarded = Object.keys(user.pointsAwards || {}).some((awardKey) => awardKey.startsWith('feedback:'));
            const caps = POINT_EARN_CAPS.feedback;
            const stats = pointAwardStats(user, 'feedback');
            if (!alreadyAwarded && (!caps || (stats.day < caps.day && stats.total < caps.total))) {
              const key = `feedback:${feedback.id}`;
              if (awardPoints(user, key, POINT_REWARDS.feedback)) {
                feedback.awarded = POINT_REWARDS.feedback;
                feedback.rewardedAt = now;
                logEvent('points-earn', user.name, { ip, detail: `反馈审核通过奖励 +${POINT_REWARDS.feedback} 积分（${feedback.id}）` });
              }
            }
          }
        }
        logEvent('feedback-review', feedback.username, {
          ip,
          detail: `${feedback.id} 审核${useful ? '通过' : '未采纳'}${feedback.awarded ? `，奖励 +${feedback.awarded} 积分` : ''}`,
        });
        saveDb();
        return send(res, 200, { ok: true, feedback, awarded: feedback.awarded, duplicate: false });
      }
      if (req.method === 'POST' && url === ADMIN_PREFIX + '/api/feedback/remove') {
        db = loadDb();
        const b = await readBody(req);
        const id = String(b.id || '');
        const before = db.feedbacks.length;
        db.feedbacks = db.feedbacks.filter((f) => f.id !== id);
        if (db.feedbacks.length === before) return send(res, 404, { ok: false, error: '反馈不存在' });
        logEvent('admin', 'admin', { ip, detail: `删除反馈 ${id}` });
        saveDb();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url === ADMIN_PREFIX + '/api/reports') {
        db = loadDb();
        const q = new URLSearchParams((req.url || '').split('?')[1] || '');
        const kind = q.get('kind') || '';
        let list = db.reports.slice().reverse();
        if (kind) list = list.filter((r) => r.kind === kind);
        return send(res, 200, { ok: true, reports: list.slice(0, 500), total: list.length });
      }
      if (req.method === 'POST' && url === ADMIN_PREFIX + '/api/reports/clear') {
        db = loadDb();
        const n = db.reports.length;
        db.reports = [];
        logEvent('admin', 'admin', { ip, detail: `清空诊断上报 ${n} 条` });
        saveDb();
        return send(res, 200, { ok: true, cleared: n });
      }
      if (req.method === 'POST' && url === ADMIN_PREFIX + '/api/admin-passwd') {
        const b = await readBody(req);
        const np = String(b.newPassword || '');
        if (!PASSWORD_RE.test(np)) return send(res, 400, { ok: false, error: '密码需为 8-128 位且不能含控制字符' });
        writeAdminAuth(np);
        logEvent('admin', 'admin', { ip, detail: '修改管理后台密码' });
        saveDb();
        return send(res, 200, { ok: true, hint: '密码已生效，请刷新页面用新密码重新登录' });
      }
      if (req.method === 'GET' && url === ADMIN_PREFIX + '/api/backup') {
        // 备份会写入服务端文件并记录审计事件，不能被第三方页面借助已缓存的
        // Basic Auth 凭据跨站触发；命令行请求仍可在没有 Origin 时正常使用。
        if (!adminOriginAllowed(req)) return send(res, 403, { ok: false, code: 'ADMIN_ORIGIN_REJECTED', error: '管理请求来源不受信任，请从后台页面重试' });
        const name = backupNow();
        logEvent('admin', 'admin', { ip, detail: `手动备份 ${name}` });
        saveDb();
        const buf = fs.readFileSync(path.join(BACKUP_DIR, name));
        res.writeHead(200, {
          'content-type': 'application/gzip',
          'content-disposition': `attachment; filename="${name}"`,
          'content-length': buf.length,
          'cache-control': 'no-store',
        });
        return res.end(buf);
      }
      return send(res, 404, { ok: false, error: 'not found' });
    }

    return send(res, 404, { ok: false, error: 'not found' });
  } catch {
    return send(res, 500, { ok: false, error: '服务暂时没有完成这次请求，请稍后重试' });
  }
}

// 业务读取、修改、落盘必须按请求串行化。原实现每个请求都会先 loadDb()，
// 两个并发注册/兑换可能各自读取旧快照，后写入的一方覆盖前一方。
let requestQueue = Promise.resolve();
const server = http.createServer((req, res) => {
  // 队列中的请求不能无限等待慢客户端上传，避免一个半开 POST 卡住授权服务。
  req.setTimeout(15_000, () => req.destroy());
  const task = requestQueue.then(() => handleRequest(req, res), () => handleRequest(req, res));
  requestQueue = task.catch(() => undefined);
});

// ---------- CLI ----------
function migrateDb() {
  db = loadDb();
  if (!db.users || typeof db.users !== 'object' || Array.isArray(db.users)) throw new Error('授权数据库 users 结构异常，已停止迁移');
  if (!db.cards || typeof db.cards !== 'object' || Array.isArray(db.cards)) throw new Error('授权数据库 cards 结构异常，已停止迁移');
  const before = JSON.stringify(db);
  let migratedUsers = 0;
  let expiredVip = 0;
  for (const user of Object.values(db.users)) {
    const previous = JSON.stringify(user);
    const previousPlan = user?.plan;
    ensureUser(user);
    if (previousPlan === 'vip' && user.plan === 'free') expiredVip += 1;
    if (previous !== JSON.stringify(user)) migratedUsers += 1;
  }
  // 只为历史卡密补齐可选字段，不改天数、使用者和作废状态。
  for (const card of Object.values(db.cards)) {
    if (!card || typeof card !== 'object') throw new Error('授权数据库 cards 中存在异常记录，已停止迁移');
    if (card.usedBy === undefined) card.usedBy = null;
    if (card.usedAt === undefined) card.usedAt = null;
    if (card.revoked === undefined) card.revoked = false;
  }
  db.schemaVersion = Math.max(Number(db.schemaVersion) || 0, DB_SCHEMA_VERSION);
  const changed = before !== JSON.stringify(db);
  if (changed) saveDb();
  console.log(JSON.stringify({ ok: true, changed, schemaVersion: db.schemaVersion, users: Object.keys(db.users).length, migratedUsers, expiredVip, cards: Object.keys(db.cards).length }, null, 2));
}
function cli() {
  db = loadDb();
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'gen') {
    const days = Number(a); const count = Number(b || 1);
    if (!Number.isFinite(days) || days <= 0 || days > 3650 || count < 1 || count > 200) {
      console.error('usage: gen <days 1-3650> [count 1-200]'); process.exit(2);
    }
    const made = [];
    for (let i = 0; i < count; i++) {
      const code = genCardCode();
      db.cards[code] = { days, createdAt: Date.now(), usedBy: null, usedAt: null, revoked: false };
      made.push(code);
    }
    saveDb(); console.log(made.join('\n')); return;
  }
  if (cmd === 'list') {
    console.log('users:', Object.keys(db.users).length, 'cards:', Object.keys(db.cards).length);
    for (const u of Object.values(db.users)) {
      console.log(`${u.banned ? 'BANNED' : u.expiresAt > Date.now() ? 'ACTIVE' : 'EXPIRED'} ${u.name} 到期=${new Date(u.expiresAt).toISOString()}`);
    }
    return;
  }
  if (cmd === 'passwd') {
    const np = String(a || '');
    if (!PASSWORD_RE.test(np)) { console.error('新密码需为 8-128 位且不能含控制字符'); process.exit(2); }
    writeAdminAuth(np);
    console.log('管理后台密码已更新'); return;
  }
  if (cmd === 'migrate') {
    migrateDb(); return;
  }
  console.error('usage: server.cjs [gen|list|passwd|migrate] ...（不带参数则以服务模式启动）');
  process.exit(2);
}

if (process.argv.length > 2) {
  cli();
} else {
  server.listen(PORT, '127.0.0.1', () => console.log(`mmodels-license v4 listening on 127.0.0.1:${PORT}`));
  // 每日自动备份：启动 30s 后首备一次，此后每小时检查是否跨天
  let lastBackupDay = '';
  const maybeBackup = () => {
    const d = new Date().toISOString().slice(0, 10);
    if (d === lastBackupDay) return;
    lastBackupDay = d;
    try { const n = backupNow(); console.log('auto backup:', n); } catch (e) { console.error('auto backup failed:', e.message); }
  };
  setTimeout(maybeBackup, 30_000);
  setInterval(maybeBackup, 3600_000);
}
