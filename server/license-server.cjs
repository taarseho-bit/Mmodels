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
 *   POST /api/license/check Bearer token + x-mmodels-device         授权校验
 *
 * 邮件配置：/opt/mmodels/data/mail.json → {"host":"smtp.qq.com","port":465,"user":"...","pass":"授权码","from":"..."}
 *           未配置时 send-code 返回 503「邮件服务暂未开通」
 *
 * 管理后台（HTTP Basic Auth，凭证 /opt/mmodels/data/admin-auth）：
 *   GET  /admin                       管理页（单文件 HTML）
 *   GET  /admin/api/overview          统计 + 近7天趋势
 *   GET  /admin/api/users             用户列表（不返回密码/备注/最近IP——密码只做单向校验）
 *   POST /admin/api/users/ban         {username, banned}
 *   POST /admin/api/users/reset-pass  {username, newPassword}
 *   POST /admin/api/users/unbind      {username}   解绑设备（换机）
 *   POST /admin/api/users/extend      {username, days}   手动延期（可为负）
 *   POST /admin/api/users/note        {username, note}   客服备注
 *   GET  /admin/api/logs?limit=300    审计日志（注册/登录/兑换/校验失败/管理操作，含 IP）
 *   GET  /admin/api/cards
 *   POST /admin/api/cards/gen         {days, count}
 *   POST /admin/api/cards/revoke      {code}
 *   POST /admin/api/admin-passwd      {newPassword}      网页端改管理密码
 *   GET  /admin/api/backup            立即备份并下载 db.json.gz（每日自动备份，保留 14 份）
 *
 * CLI：
 *   gen <days> [count]        生成卡密
 *   list                      查看数据
 *   passwd <newpass>          重设管理后台密码
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
const PORT = Number(process.env.MM_PORT || 80);

// ---------- 存储 ----------
function loadDb() {
  try {
    const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    d.cards ||= {}; d.redemptions ||= {}; d.users ||= {}; d.events ||= [];
    return d;
  } catch (error) {
    // 只有首次部署时允许创建空库。权限错误、磁盘损坏或 JSON 截断必须让服务
    // 失败并保留现场，不能把空对象当成正常数据再覆盖掉全部账号和卡密。
    if (error && error.code === 'ENOENT') {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      return { cards: {}, redemptions: {}, users: {}, events: [] };
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
function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig !== expect) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p || typeof p.username !== 'string' || typeof p.deviceId !== 'string' || typeof p.expiresAt !== 'number') return null;
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
function activateCard(code, deviceId, username) {
  const card = db.cards[code];
  if (!card) return { status: 404, error: '卡密不存在' };
  if (card.revoked) return { status: 409, error: '卡密已作废' };
  if (card.usedBy) return { status: 409, error: '卡密已兑换，不能重复使用' };
  const now = Date.now();
  const user = db.users[username];
  const base = user && user.expiresAt > now ? user.expiresAt : now;
  const expiresAt = base + card.days * 86_400_000;
  card.usedBy = card.usedBy || deviceId;
  card.usedByUsername = card.usedByUsername || username;
  card.usedAt = card.usedAt || now;
  user.expiresAt = expiresAt;
  return { expiresAt, days: card.days }; // 日志由调用方记录（register 激活不应计入 redeem 统计）
}

function issueToken(user, deviceId) {
  user.tokenVersion = Number.isInteger(user.tokenVersion) && user.tokenVersion > 0 ? user.tokenVersion : 1;
  return signPayload({ username: user.name, deviceId, expiresAt: user.expiresAt, tokenVersion: user.tokenVersion });
}

// ---------- HTTP 基础 ----------
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
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
  return u === eu && p === ep;
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;
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

    if (req.method === 'POST' && url === '/api/auth/register') {
      db = loadDb();
      if (!rateAllowed(`reg:${ip}`, 5, 3600_000)) return send(res, 429, { ok: false, error: '注册过于频繁' });
      const b = await readBody(req);
      const username = String(b.username || '').trim();
      const password = String(b.password || '');
      const deviceId = String(b.deviceId || '').trim();
      const email = String(b.email || '').trim().toLowerCase();
      const emailCode = String(b.emailCode || '').trim();
      if (!USERNAME_RE.test(username)) return send(res, 400, { ok: false, error: '账号需 3-24 位字母/数字/下划线' });
      if (!PASSWORD_RE.test(password)) return send(res, 400, { ok: false, error: '密码需为 8-128 位且不能含控制字符' });
      if (!DEVICE_RE.test(deviceId)) return send(res, 400, { ok: false, error: '设备标识不合法，请重启客户端后重试' });
      if (!EMAIL_RE.test(email)) return send(res, 400, { ok: false, error: '邮箱格式不正确' });
      if (Object.values(db.users).some((u) => (u.email || '') === email)) return send(res, 409, { ok: false, error: '该邮箱已绑定其他账号' });
      if (db.users[username]) return send(res, 409, { ok: false, error: '账号已存在' });
      const code = String(b.code || '').trim().toUpperCase();
      if (code && !CARD_RE.test(code)) return send(res, 400, { ok: false, error: '卡密格式不正确' });
      const vr = verifyEmailCode('register', email, emailCode);
      if (vr.error) return send(res, 400, { ok: false, error: vr.error });
      const now = Date.now();
      db.users[username] = {
        name: username, passHash: hashPass(password), tokenVersion: 1, createdAt: now,
        expiresAt: now, banned: false, deviceId, lastLoginAt: now, email,
      };
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
      token = issueToken(db.users[username], deviceId);
      logEvent('register', username, { ip, detail: usedCard ? `激活卡密 ${cardLabel(usedCard)}（+${Math.round((expiresAt - now) / 86_400_000)} 天）` : '未带卡密' });
      saveDb();
      return send(res, 200, { ok: true, token, expiresAt, activated: Boolean(code) });
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
      if (!rateAllowed(`login:${ip}`, 15, 3600_000)) return send(res, 429, { ok: false, error: '尝试过于频繁' });
      const b = await readBody(req);
      const username = String(b.username || '').trim();
      const password = String(b.password || '');
      const deviceId = String(b.deviceId || '').trim();
      if (!PASSWORD_RE.test(password)) return send(res, 401, { ok: false, error: '账号或密码错误' });
      const user = db.users[username];
      if (!DEVICE_RE.test(deviceId)) return send(res, 400, { ok: false, error: '设备标识不合法，请重启客户端后重试' });
      const check = user ? verifyPass(user.passHash || user.passEnc, password) : { ok: false, migrated: null };
      if (!user || !check.ok) {
        logEvent('login-fail', username || '-', { ip, detail: '账号或密码错误' });
        return send(res, 401, { ok: false, error: '账号或密码错误' });
      }
      if (user.banned) {
        logEvent('login-fail', username, { ip, detail: '账号已被停用' });
        return send(res, 403, { ok: false, error: '账号已被停用' });
      }
      user.deviceId = deviceId; // 换设备 = 重新绑定，旧设备下次 check 失效
      if (check.migrated) { user.passHash = check.migrated; delete user.passEnc; }
      user.lastLoginAt = Date.now();
      user.lastIp = ip;
      const token = issueToken(user, deviceId);
      logEvent('login', username, { ip, detail: '登录成功' });
      saveDb();
      return send(res, 200, { ok: true, token, expiresAt: user.expiresAt });
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
      return send(res, 200, { ok: true, token, expiresAt: r.expiresAt });
    }

    if (req.method === 'POST' && url === '/api/license/check') {
      if (!rateAllowed(`check:${ip}`, 120, 60_000)) return send(res, 429, { allowed: false, reason: 'too many requests' });
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const payload = verifyToken(token);
      if (!payload) {
        logEvent('check-fail', '-', { ip, detail: '无效令牌' });
        return send(res, 401, { allowed: false, reason: 'invalid token' });
      }
      db = loadDb(); // 管理端封禁/重置设备需即时生效
      const user = db.users[payload.username];
      const device = String(req.headers['x-mmodels-device'] || '');
      if (!DEVICE_RE.test(device)) return send(res, 400, { allowed: false, reason: 'invalid device' });
      if (!user) { logEvent('check-fail', payload.username, { ip, detail: '账号不存在' }); return send(res, 401, { allowed: false, reason: '账号不存在' }); }
      if (user.banned) { logEvent('check-fail', payload.username, { ip, detail: '已封禁' }); return send(res, 403, { allowed: false, reason: 'banned' }); }
      if (device !== payload.deviceId) { logEvent('check-fail', payload.username, { ip, detail: '设备不匹配' }); return send(res, 403, { allowed: false, reason: 'device mismatch' }); }
      if (user.deviceId !== device) { logEvent('check-fail', payload.username, { ip, detail: '设备已重绑' }); return send(res, 403, { allowed: false, reason: 'device rebinding' }); }
      // 缺少 tokenVersion 的令牌也必须失效：重置密码后不能继续沿用旧会话。
      if (payload.tokenVersion !== (Number(user.tokenVersion) || 1)) {
        logEvent('check-fail', payload.username, { ip, detail: '令牌已失效' });
        return send(res, 401, { allowed: false, reason: 'token revoked' });
      }
      if (user.expiresAt <= Date.now()) { logEvent('check-fail', payload.username, { ip, detail: '已过期' }); return send(res, 401, { allowed: false, reason: 'expired' }); }
      return send(res, 200, { allowed: true, expiresAt: user.expiresAt });
    }

    // ===== 管理 =====
    if (req.method === 'GET' && url === '/admin.html') {
      res.writeHead(302, { location: '/admin', 'cache-control': 'no-store' });
      return res.end();
    }
    if (url === '/admin' || url.startsWith('/admin/')) {
      if (url === '/admin' && req.method === 'GET') {
        try {
          const html = fs.readFileSync(ADMIN_HTML);
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(html);
        } catch { return send(res, 500, { ok: false, error: 'admin.html 缺失' }); }
      }
      if (!checkAdmin(req)) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="MModels Admin", charset="UTF-8"' });
        return res.end('需要管理员登录');
      }
      if (req.method === 'GET' && url === '/admin/api/overview') {
        db = loadDb();
        const now = Date.now();
        const users = Object.values(db.users);
        const day = 86_400_000;
        const days7 = Array.from({ length: 7 }, (_, i) => {
          const dStart = new Date(now - (6 - i) * day); dStart.setHours(0, 0, 0, 0);
          const dEnd = dStart.getTime() + day;
          const label = `${dStart.getMonth() + 1}/${dStart.getDate()}`;
          return {
            label,
            registers: db.events.filter((e) => e.type === 'register' && e.t >= dStart.getTime() && e.t < dEnd).length,
            redeems: db.events.filter((e) => e.type === 'redeem' && e.t >= dStart.getTime() && e.t < dEnd).length,
          };
        });
        return send(res, 200, {
          ok: true,
          totalUsers: users.length,
          activeUsers: users.filter((u) => !u.banned && u.expiresAt > now).length,
          bannedUsers: users.filter((u) => u.banned).length,
          expiringUsers: users.filter((u) => !u.banned && u.expiresAt > now && u.expiresAt < now + 7 * day).length,
          totalDays: users.reduce((s, u) => s + Math.max(0, (u.expiresAt - now) / day), 0),
          cardsTotal: Object.keys(db.cards).length,
          cardsUsed: Object.values(db.cards).filter((c) => c.usedBy).length,
          cardsRevoked: Object.values(db.cards).filter((c) => c.revoked).length,
          days7,
        });
      }
      if (req.method === 'GET' && url === '/admin/api/users') {
        db = loadDb();
        return send(res, 200, {
          ok: true,
          users: Object.values(db.users).map((u) => ({
            name: u.name, createdAt: u.createdAt,
            expiresAt: u.expiresAt, banned: u.banned, deviceId: u.deviceId, lastLoginAt: u.lastLoginAt,
            note: u.note || '', lastIp: u.lastIp || '', passwordStored: Boolean(u.passHash || u.passEnc),
          })).sort((a, b) => b.createdAt - a.createdAt),
        });
      }
      if (req.method === 'GET' && url === '/admin/api/cards') {
        db = loadDb();
        return send(res, 200, {
          ok: true,
          cards: Object.entries(db.cards).map(([code, c]) => ({ code, ...c }))
            .sort((a, b) => b.createdAt - a.createdAt),
        });
      }
      if (req.method === 'POST' && url === '/admin/api/cards/gen') {
        db = loadDb();
        const b = await readBody(req);
        const days = Number(b.days); const count = Number(b.count || 1);
        if (!Number.isFinite(days) || days <= 0 || days > 3650 || count < 1 || count > 200) {
          return send(res, 400, { ok: false, error: '参数不合法' });
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
      if (req.method === 'POST' && url === '/admin/api/cards/revoke') {
        db = loadDb();
        const b = await readBody(req);
        const card = db.cards[String(b.code || '').toUpperCase()];
        if (!card) return send(res, 404, { ok: false, error: '卡密不存在' });
        card.revoked = true;
        logEvent('admin', 'admin', { ip, detail: `作废卡密 ${cardLabel(String(b.code || '').toUpperCase())}` });
        saveDb();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url === '/admin/api/users/ban') {
        db = loadDb();
        const b = await readBody(req);
        const u = db.users[String(b.username || '')];
        if (!u) return send(res, 404, { ok: false, error: '用户不存在' });
        u.banned = Boolean(b.banned);
        logEvent('admin', u.name, { ip, detail: u.banned ? '封禁账号' : '解封账号' });
        saveDb();
        return send(res, 200, { ok: true, banned: u.banned });
      }
      if (req.method === 'POST' && url === '/admin/api/users/reset-pass') {
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
      if (req.method === 'POST' && url === '/admin/api/users/unbind') {
        db = loadDb();
        const b = await readBody(req);
        const u = db.users[String(b.username || '')];
        if (!u) return send(res, 404, { ok: false, error: '用户不存在' });
        u.deviceId = '';
        logEvent('admin', u.name, { ip, detail: '解绑设备' });
        saveDb();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url === '/admin/api/users/extend') {
        db = loadDb();
        const b = await readBody(req);
        const u = db.users[String(b.username || '')];
        const days = Number(b.days);
        if (!u) return send(res, 404, { ok: false, error: '用户不存在' });
        if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 3650) {
          return send(res, 400, { ok: false, error: '天数需为非 0 数值（±1~3650）' });
        }
        const base = Math.max(u.expiresAt, Date.now());
        u.expiresAt = Math.max(Date.now(), base + days * 86_400_000);
        logEvent('admin', u.name, { ip, detail: `手动调整 ${days > 0 ? '+' : ''}${days} 天 → 到期 ${new Date(u.expiresAt).toLocaleString('zh-CN', { hour12: false })}` });
        saveDb();
        return send(res, 200, { ok: true, expiresAt: u.expiresAt });
      }
      if (req.method === 'POST' && url === '/admin/api/users/note') {
        db = loadDb();
        const b = await readBody(req);
        const u = db.users[String(b.username || '')];
        if (!u) return send(res, 404, { ok: false, error: '用户不存在' });
        u.note = String(b.note || '').slice(0, 200);
        logEvent('admin', u.name, { ip, detail: `设置备注：${u.note || '（清空）'}` });
        saveDb();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url === '/admin/api/logs') {
        db = loadDb();
        const q = new URLSearchParams((req.url || '').split('?')[1] || '');
        const limit = Math.min(Number(q.get('limit')) || 300, 1000);
        const type = q.get('type') || '';
        const qs = (q.get('q') || '').toLowerCase();
        let logs = db.events.slice().reverse(); // 最新在前
        if (type) logs = logs.filter((e) => e.type === type);
        if (qs) logs = logs.filter((e) => (e.username || '').toLowerCase().includes(qs) || (e.detail || '').toLowerCase().includes(qs) || (e.ip || '').includes(qs));
        return send(res, 200, { ok: true, logs: logs.slice(0, limit) });
      }
      if (req.method === 'POST' && url === '/admin/api/admin-passwd') {
        const b = await readBody(req);
        const np = String(b.newPassword || '');
        if (!PASSWORD_RE.test(np)) return send(res, 400, { ok: false, error: '密码需为 8-128 位且不能含控制字符' });
        writeAdminAuth(np);
        logEvent('admin', 'admin', { ip, detail: '修改管理后台密码' });
        return send(res, 200, { ok: true, hint: '密码已生效，请刷新页面用新密码重新登录' });
      }
      if (req.method === 'GET' && url === '/admin/api/backup') {
        const name = backupNow();
        logEvent('admin', 'admin', { ip, detail: `手动备份 ${name}` });
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
    return send(res, 500, { ok: false, error: 'internal error' });
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
  console.error('usage: server.cjs [gen|list|passwd] ...（不带参数则以服务模式启动）');
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
