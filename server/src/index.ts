/**
 * MModels Desktop 诊断/遥测接收服务。
 *
 * 零构建步骤：Node ≥22.18 能直接执行 .ts（内置类型剥离），
 * 所以 `node src/index.ts` 就是生产启动命令，Docker 里也不需要 tsc。
 *
 * 安全模型（见 ../诊断服务-自建指南.md 第二节）：
 *   客户端 token 一定会随安装包泄露，**不把它当机密**。
 *   真正的防线是：体积上限 + 字段白名单 + 限流 + 只存必要字段。
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { adminHtml } from './admin.ts';
import { initMailer, mailerEnabled, notifyNewReport } from './mailer.ts';
import {
  appendEvents,
  dataSizeBytes,
  deleteReport,
  getReport,
  initStore,
  listReports,
  runRetention,
  saveReport,
  stats,
} from './store.ts';
import { sanitizeEvent, sanitizeReport } from './validate.ts';

// ─────────────────────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────────────────────

const STARTED_AT = Date.now();
const VERSION = '1.0.0';

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DIAG_DATA_DIR ?? 'data';
const RETENTION_DAYS = Number(process.env.DIAG_RETENTION_DAYS ?? 30);
const TOKEN = (process.env.DIAG_TOKEN ?? '').trim();
/** 每分钟每 IP 的请求数上限。按客户端数量调整。 */
const RATE_PER_MIN = Number(process.env.DIAG_RATE_PER_MIN ?? 120);

if (!TOKEN) {
  // ⚠️ 直接拒绝启动，而不是"用个默认值继续跑"。
  //    没有 token 的服务一旦公网可达，等于给全世界开了个写接口。
  console.error('[fatal] 未设置 DIAG_TOKEN。请先生成：openssl rand -hex 32');
  process.exit(1);
}
if (TOKEN.length < 16) {
  console.error('[fatal] DIAG_TOKEN 太短（至少 16 字符）。请用：openssl rand -hex 32');
  process.exit(1);
}

initStore(DATA_DIR);
{
  const r = runRetention(RETENTION_DAYS);
  console.log('[retention] 清理完成：遥测分片 ' + r.telemetry + ' 个，报告 ' + r.reports + ' 份');
}
// 每 6 小时再清一次，避免长期不重启导致数据无限增长
setInterval(
  () => {
    const r = runRetention(RETENTION_DAYS);
    if (r.telemetry || r.reports) {
      console.log('[retention] 定期清理：遥测分片 ' + r.telemetry + '，报告 ' + r.reports);
    }
  },
  6 * 3600 * 1000,
).unref();

const MAIL_ON = initMailer();
/** 邮件里那个「去诊断台看」的链接前缀；没配就用域名/本机地址兜底 */
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');

// ─────────────────────────────────────────────────────────────
// 限流（内存计数够用：单实例 + 起步量级）
// ─────────────────────────────────────────────────────────────

const hits = new Map<string, { n: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || now > cur.resetAt) {
    hits.set(ip, { n: 1, resetAt: now + 60_000 });
    return false;
  }
  cur.n++;
  return cur.n > RATE_PER_MIN;
}

// 定期清掉过期桶，防止 Map 无限增长（被扫描时这一点很重要）
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
}, 5 * 60_000).unref();

// ─────────────────────────────────────────────────────────────
// 应用
// ─────────────────────────────────────────────────────────────

const app = new Hono();

app.use('*', async (c, next) => {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown';
  if (rateLimited(ip)) {
    return c.json({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': '60' });
  }
  await next();
});

// ── 探活（不鉴权：给负载均衡/监控用） ──
app.get('/health', (c) =>
  c.json({
    ok: true,
    version: VERSION,
    uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
    dataBytes: dataSizeBytes(),
    retentionDays: RETENTION_DAYS,
  }),
);

// ─────────────────────────────────────────────────────────────
// 客户端上报接口（Bearer 鉴权）
// ─────────────────────────────────────────────────────────────

const api = new Hono();

api.use('*', async (c, next) => {
  const auth = c.req.header('authorization') ?? '';
  const got = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  // 定长比较意义不大（token 不是机密），但常量时间比较成本为零，顺手做掉
  if (!got || !timingSafeEqual(got, TOKEN)) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }
  await next();
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 体积超限的统一响应。
 *
 * ⚠️ 必须带 `Connection: close`。
 *    超限时我们直接回 413 而没有读完请求体，Node 随后会销毁这个连接；
 *    但客户端的连接池（undici/axios 都是）并不知道，会把这条即将断掉的
 *    socket 拿去复用**下一个**请求 —— 表现为一个毫不相关的请求随机报
 *    `UND_ERR_SOCKET`，排查时极难联想到"上一次超限"。
 *    显式告诉客户端别复用，就消除了这个连带故障。
 *    （这个 bug 是本项目的联调测试真实抓到的，别去掉。）
 */
function tooLarge(c: { json: (o: unknown, s: number, h: Record<string, string>) => Response }): Response {
  return c.json({ ok: false, error: 'payload_too_large' }, 413, { Connection: 'close' });
}

// 体积上限：遥测批量对齐客户端契约的 96 KB，给一倍余量
api.post(
  '/telemetry/batch',
  bodyLimit({ maxSize: 192 * 1024, onError: tooLarge }),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid_json' }, 400);
    }
    const raw = (body as { events?: unknown })?.events;
    if (!Array.isArray(raw)) return c.json({ ok: false, error: 'events_required' }, 400);

    const clean: Record<string, unknown>[] = [];
    for (const e of raw.slice(0, 500)) {
      const s = sanitizeEvent(e);
      if (s) clean.push(s);
    }

    // ⚠️ 即使清洗后为空也要写「收下了」：否则客户端会永远重试一批
    //    它认为合法、而我们全丢掉的垃圾事件，形成死循环。
    const accepted = appendEvents(clean);
    return c.json({ ok: true, accepted: raw.length, stored: accepted });
  },
);

api.post(
  '/diagnostics',
  bodyLimit({ maxSize: 4 * 1024 * 1024, onError: tooLarge }),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid_json' }, 400);
    }
    const clean = sanitizeReport(body);
    if (!clean) return c.json({ ok: false, error: 'invalid_report' }, 400);
    try {
      saveReport(clean);
    } catch {
      return c.json({ ok: false, error: 'invalid_report_id' }, 400);
    }
    console.log('[report] 收到诊断报告 ' + clean.id);

    // 邮件通知：**不 await**。
    // 发信要走外网、可能耗时数秒，而报告已经落盘了 ——
    // 让客户端为了一封通知多等几秒毫无意义，发信失败也不该让上报失败。
    if (mailerEnabled()) {
      const app = (clean.app ?? {}) as Record<string, unknown>;
      const system = (clean.system ?? {}) as Record<string, unknown>;
      const faults = Array.isArray(clean.faults) ? (clean.faults as Record<string, unknown>[]) : [];
      void notifyNewReport({
        id: String(clean.id),
        reason: String(clean.reason ?? ''),
        contact: typeof clean.contact === 'string' ? clean.contact : undefined,
        appVersion: String(app.version ?? ''),
        platform: String(system.platform ?? ''),
        osVersion: String(system.osVersion ?? ''),
        faultCount: faults.length,
        faultLines: faults
          .slice(0, 8)
          .map((f) => String(f.category ?? '') + (f.page ? ' @ ' + String(f.page) : '')),
        adminUrl: (PUBLIC_BASE_URL || '') + '/admin',
      });
    }

    return c.json({ ok: true, id: clean.id, receivedAt: new Date().toISOString() });
  },
);

app.route('/api/desktop', api);

// ─────────────────────────────────────────────────────────────
// 管理台（Basic 鉴权：浏览器能原生弹框，不用做登录页）
// ─────────────────────────────────────────────────────────────

const admin = new Hono();

admin.use('*', async (c, next) => {
  const auth = c.req.header('authorization') ?? '';
  if (!auth.startsWith('Basic ')) return basicChallenge();
  let decoded = '';
  try {
    decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  } catch {
    return basicChallenge();
  }
  const idx = decoded.indexOf(':');
  const user = idx >= 0 ? decoded.slice(0, idx) : '';
  const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
  // 用户名固定 admin；密码就是 DIAG_TOKEN，少一个要记的东西
  if (user !== 'admin' || !timingSafeEqual(pass, TOKEN)) return basicChallenge();
  await next();
});

function basicChallenge(): Response {
  return new Response('需要登录', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="MModels Diagnostics", charset="UTF-8"' },
  });
}

admin.get('/', (c) => c.html(adminHtml()));
admin.get('/api/stats', (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? 7)));
  return c.json(stats(days));
});
admin.get('/api/reports', (c) => {
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') ?? 100)));
  return c.json(listReports(limit));
});
admin.get('/api/reports/:id', (c) => {
  const r = getReport(c.req.param('id'));
  return r ? c.json(r) : c.json({ ok: false, error: 'not_found' }, 404);
});
admin.delete('/api/reports/:id', (c) =>
  deleteReport(c.req.param('id')) ? c.json({ ok: true }) : c.json({ ok: false, error: 'not_found' }, 404),
);

app.route('/admin', admin);

// 根路径给个指引，避免访问到的人以为是坏掉的
app.get('/', (c) =>
  c.text(
    'MModels 诊断接收服务已运行。\n' +
      '探活：GET /health\n' +
      '查看台：GET /admin（Basic 登录，用户名 admin，密码为 DIAG_TOKEN）\n',
  ),
);

// ─────────────────────────────────────────────────────────────
// 启动
// ─────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log('──────────────────────────────────────────');
  console.log(' MModels 诊断服务 v' + VERSION);
  console.log(' 监听     : http://0.0.0.0:' + info.port);
  console.log(' 数据目录 : ' + DATA_DIR);
  console.log(' 保留期   : ' + RETENTION_DAYS + ' 天');
  console.log(' 限流     : ' + RATE_PER_MIN + ' 次/分钟/IP');
  console.log(' 邮件通知 : ' + (MAIL_ON ? '已启用' : '未配置（设置 SMTP_HOST / MAIL_TO 后启用）'));
  console.log(' 查看台   : /admin （用户 admin，密码 = DIAG_TOKEN）');
  console.log('──────────────────────────────────────────');
});
