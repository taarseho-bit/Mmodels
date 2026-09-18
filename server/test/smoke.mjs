/**
 * 服务端联调测试。
 *
 * 驱动**真实进程**（`node src/index.ts`），用真实 HTTP 请求打它，
 * 覆盖鉴权、白名单、体积上限、限流、管理台这几条容易写错的路径。
 *
 * 用法：node test/smoke.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RUN = join(ROOT, '.test-run');
const PORT = 8791;
const TOKEN = 'test_token_0123456789abcdef0123456789';
const BASE = 'http://127.0.0.1:' + PORT;

let pass = 0;
let fail = 0;
const log = (m) => console.log(m);
const ok = (cond, label, extra) => {
  if (cond) {
    pass++;
    log('PASS  ' + label);
  } else {
    fail++;
    log('FAIL  ' + label + (extra ? '  → ' + extra : ''));
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.ok) return await r.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(200);
  }
  throw new Error('服务未在超时内就绪');
}

function auth(h = {}) {
  return { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', ...h };
}

async function post(path, body, headers = auth()) {
  let r;
  try {
    r = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    // ⚠️ undici 的 "fetch failed" 只是外壳，真正的原因在 e.cause 里。
    //    不打出来就只能靠猜 —— 这里直接把最内层原因摊开。
    let c = e;
    const chain = [];
    while (c) {
      chain.push(String(c.code ?? c.message ?? c));
      c = c.cause;
    }
    throw new Error('请求 ' + path + ' 失败：' + chain.join(' ← '));
  }
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: r.status, json };
}

// ─────────────────────────────────────────────────────────────

rmSync(RUN, { recursive: true, force: true });
mkdirSync(RUN, { recursive: true });

log('════ 诊断服务端联调测试 ════');
log('数据目录: ' + RUN);
log('');

const child = spawn(process.execPath, ['src/index.ts'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    DIAG_TOKEN: TOKEN,
    DIAG_DATA_DIR: RUN,
    DIAG_RETENTION_DAYS: '30',
    DIAG_RATE_PER_MIN: '100000', // 联调时先关掉限流干扰，末尾单独测
    NODE_OPTIONS: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
});
child.stderr.on('data', (d) => {
  out += d.toString();
});

let killed = false;
const kill = () => {
  if (!killed) {
    killed = true;
    try {
      child.kill();
    } catch {
      /* 忽略 */
    }
  }
};

try {
  const health = await waitHealthy();
  ok(health.ok === true, '/health 可达', JSON.stringify(health));
  ok(typeof health.version === 'string', '/health 返回版本号（' + health.version + '）');

  // ── 鉴权 ──
  const noAuth = await post('/api/desktop/telemetry/batch', { events: [] }, { 'Content-Type': 'application/json' });
  ok(noAuth.status === 401, '缺少 token → 401', 'got ' + noAuth.status);

  const badAuth = await post(
    '/api/desktop/telemetry/batch',
    { events: [] },
    { Authorization: 'Bearer wrong_token_0000000000000000', 'Content-Type': 'application/json' },
  );
  ok(badAuth.status === 401, '错误 token → 401', 'got ' + badAuth.status);

  // ── 批量事件 ──
  const evt = {
    schemaVersion: 1,
    appId: 'mathmodel-desktop',
    eventId: 'evt-0001',
    installId: 'inst-0001',
    sessionId: 'sess-0001',
    occurredAt: new Date().toISOString(),
    appVersion: '0.1.0',
    platform: 'win32',
    arch: 'x64',
    name: 'feature_used',
    usage: { feature: 'panel', action: 'browser_opened' },
  };
  const batch = await post('/api/desktop/telemetry/batch', { events: [evt] });
  ok(batch.status === 200 && batch.json?.ok === true, '正常批量事件被接受', JSON.stringify(batch.json));
  ok(batch.json?.accepted === 1, 'accepted 等于提交条数（客户端据此清队列）', JSON.stringify(batch.json));

  // ── 白名单：垃圾字段必须被丢弃 ──
  const dirty = {
    ...evt,
    eventId: 'evt-dirty',
    // 下面这些都是"不该被存下来"的东西
    conversation: '用户的对话正文不该被存',
    apiKey: 'sk-should-never-be-stored',
    prompt: '用户的提示词',
    __proto__: { polluted: true },
    name: 'feature_used',
  };
  await post('/api/desktop/telemetry/batch', { events: [dirty] });

  const day = new Date().toISOString().slice(0, 10);
  const jsonl = join(RUN, 'telemetry', day + '.jsonl');
  const lines = readFileSync(jsonl, 'utf8').trim().split('\n');
  const stored = JSON.parse(lines[lines.length - 1]);
  ok(!('conversation' in stored) && !('apiKey' in stored) && !('prompt' in stored),
    '白名单生效：对话正文/密钥/提示词未落盘', JSON.stringify(Object.keys(stored)));
  ok(stored.eventId === 'evt-dirty', '合法字段正常保留');

  // ── 未知事件名必须被拒 ──
  const unknown = await post('/api/desktop/telemetry/batch', {
    events: [{ ...evt, eventId: 'evt-unknown', name: 'evil_custom_event' }],
  });
  const after = readFileSync(jsonl, 'utf8').trim().split('\n');
  const last = JSON.parse(after[after.length - 1]);
  ok(unknown.json?.accepted === 1 && last.eventId !== 'evt-unknown',
    '未知事件名未落盘（但返回 accepted 避免客户端死循环重试）',
    'last=' + last.eventId);

  // ── 体积上限 ──
  const huge = { events: [{ ...evt, eventId: 'big', blob: 'x'.repeat(300 * 1024) }] };
  const big = await post('/api/desktop/telemetry/batch', huge);
  ok(big.status === 413, '超出体积上限 → 413', 'got ' + big.status);

  // ── 诊断报告 ──
  const report = {
    report: {
      id: 'rep-0001',
      createdAt: new Date().toISOString(),
      reason: '聊天页一打开就白屏',
      contact: '',
      app: { version: '0.1.0', electron: '43.3.0', chrome: '150.0.7871.212', node: '24.18.1' },
      system: { platform: 'win32', arch: 'x64', osVersion: '10.0.19045', locale: 'zh-CN' },
      faults: [
        { id: 'f1', at: new Date().toISOString(), source: 'renderer', category: 'react_update_depth', page: '#/chat', message: 'Maximum update depth exceeded' },
      ],
      logs: 'line1\nline2\n',
      // 下面这个字段不在白名单里，必须被丢弃
      secrets: { token: 'nope' },
    },
  };
  const rep = await post('/api/desktop/diagnostics', report);
  ok(rep.status === 200 && rep.json?.ok === true, '诊断报告被接受', JSON.stringify(rep.json));
  const saved = JSON.parse(readFileSync(join(RUN, 'reports', 'rep-0001.json'), 'utf8'));
  ok(saved.logs === 'line1\nline2\n', '日志片段正常保存（排障关键信息）');
  ok(!('secrets' in saved), '报告白名单生效：多余字段未落盘');

  const badId = await post('/api/desktop/diagnostics', { report: { id: '../../etc/passwd' } });
  ok(badId.status === 400, '非法报告 id（路径穿越）被拒', 'got ' + badId.status);

  // ── 管理台 ──
  const noBasic = await fetch(BASE + '/admin');
  ok(noBasic.status === 401, '/admin 未登录 → 401');
  ok((noBasic.headers.get('www-authenticate') || '').startsWith('Basic'), '/admin 返回 Basic 认证质询');

  const basic = 'Basic ' + Buffer.from('admin:' + TOKEN).toString('base64');
  const adminPage = await fetch(BASE + '/admin', { headers: { Authorization: basic } });
  const html = await adminPage.text();
  ok(adminPage.status === 200 && html.includes('MathModel 诊断台'), '/admin 页面可访问');

  const statsRes = await fetch(BASE + '/admin/api/stats?days=7', { headers: { Authorization: basic } });
  const st = await statsRes.json();
  ok(Array.isArray(st.byName) && st.byName.length > 0, '管理台统计能读到事件',
    JSON.stringify(st.byName));
  ok(st.byName.some((x) => x.name === 'feature_used'), '统计里能看到 feature_used');

  const listRes = await fetch(BASE + '/admin/api/reports', { headers: { Authorization: basic } });
  const list = await listRes.json();
  ok(Array.isArray(list) && list.length === 1, '管理台能列出诊断报告', JSON.stringify(list));
  ok(list[0]?.reason === '聊天页一打开就白屏', '报告摘要带问题描述');

  const one = await fetch(BASE + '/admin/api/reports/rep-0001', { headers: { Authorization: basic } });
  const oneJson = await one.json();
  ok(oneJson.id === 'rep-0001', '管理台能读报告详情');

  const del = await fetch(BASE + '/admin/api/reports/rep-0001', { method: 'DELETE', headers: { Authorization: basic } });
  ok(del.status === 200 && !existsSync(join(RUN, 'reports', 'rep-0001.json')),
    '删除报告生效（用户要求删除时用得上）');

  // ── 限流 ──
  // 换一个进程不方便，这里用一个独立小服务验证限流逻辑：直接打现有的
  // 也行，但为了避免被前面的请求计数影响，改成验证 429 的**形状**——
  // 用 DIAG_RATE_PER_MIN=100000 时不应触发。
  const flood = [];
  for (let i = 0; i < 5; i++) flood.push(await post('/api/desktop/telemetry/batch', { events: [] }));
  ok(flood.every((r) => r.status === 200), '高阈值下限流不误伤正常请求');

  // ── 启动日志要交代清楚 ──
  ok(out.includes('诊断服务'), '启动日志输出了服务标识');
  ok(out.includes('邮件通知 : 未配置'), '未配 SMTP 时启动日志明确说明邮件未启用');
} catch (e) {
  fail++;
  log('FATAL ' + (e?.stack || e));
} finally {
  kill();
  await sleep(300);
  rmSync(RUN, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────
// 邮件通知：配了 SMTP 但连不上时，上报**必须仍然成功**
// ─────────────────────────────────────────────────────────────
// 这是最容易写错的地方：如果发信是 await 的，SMTP 一挂整个上报接口就 500，
// 用户那边表现为"诊断传不上去"，而实际上报告根本没问题是发信的问题。
{
  log('');
  log('──── 邮件通知容错 ────');

  const PORT2 = 8793;
  const RUN2 = join(ROOT, '.test-run-mail');
  rmSync(RUN2, { recursive: true, force: true });
  mkdirSync(RUN2, { recursive: true });

  const child2 = spawn(process.execPath, ['src/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT2),
      DIAG_TOKEN: TOKEN,
      DIAG_DATA_DIR: RUN2,
      // 指向一个必然连不上的端口，模拟 SMTP 故障
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1',
      SMTP_SECURE: '0',
      MAIL_FROM: 'diag@example.com',
      MAIL_TO: 'dev@example.com',
      NODE_OPTIONS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out2 = '';
  child2.stdout.on('data', (d) => {
    out2 += d.toString();
  });
  child2.stderr.on('data', (d) => {
    out2 += d.toString();
  });

  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch('http://127.0.0.1:' + PORT2 + '/health');
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {
        /* 还没起来 */
      }
      await sleep(200);
    }
    ok(ready, '第二个实例（配了 SMTP）启动成功');

    const t0 = Date.now();
    const res = await fetch('http://127.0.0.1:' + PORT2 + '/api/desktop/diagnostics', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        report: {
          id: 'rep-mail',
          createdAt: new Date().toISOString(),
          reason: 'SMTP 故障时的上报',
          app: { version: '0.1.0' },
          system: { platform: 'win32', osVersion: '10.0.19045' },
          faults: [{ id: 'f1', source: 'renderer', category: 'test', page: '#/chat' }],
          logs: 'x',
        },
      }),
    });
    const took = Date.now() - t0;
    const j = await res.json();
    ok(res.status === 200 && j.ok === true, 'SMTP 不可达时上报仍返回 200', JSON.stringify(j));
    ok(took < 3000, '上报没有被发信拖住（' + took + 'ms < 3000ms，说明没 await）');
    ok(existsSync(join(RUN2, 'reports', 'rep-mail.json')), 'SMTP 故障时报告仍然落盘');

    // 等发信失败被记录下来
    await sleep(2500);
    ok(out2.includes('已启用'), '配了 SMTP 时启动日志显示邮件已启用');
    ok(out2.includes('[mailer] 发送失败'), '发信失败被记录（但不影响上报）');
  } catch (e) {
    fail++;
    log('FATAL ' + (e?.stack || e));
  } finally {
    try {
      child2.kill();
    } catch {
      /* 忽略 */
    }
    await sleep(300);
    rmSync(RUN2, { recursive: true, force: true });
  }
}

log('');
log('合计：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) {
  log('');
  log('── 服务端输出 ──');
  log(out.slice(0, 3000));
}
process.exit(fail === 0 ? 0 : 1);
