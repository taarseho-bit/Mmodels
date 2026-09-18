/**
 * 驱动打包后的 MModels.exe 验证英文界面（i18n）。
 *
 * 流程：启动 → 设置 → 外观 → 点 English → 验证界面变英文 → 截图 →
 *       刷新页面验证持久化 → 扩展页/对话页英文截图。
 * 用法：node scripts/shoot-i18n.cjs
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = 'D:/mathmodel-desktop';
const APP = path.join(ROOT, 'dist', 'win-unpacked', 'MModels.exe');
const PORT = 9351;
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-shoot-i18n-'));
const USER_DATA = path.join(SANDBOX, 'userdata');
const OUT = path.join(ROOT, 'out');

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForBrowserWs(ref, timeoutMs = 40000) {
  const MARK = 'DevTools listening on ';
  return new Promise((resolve, reject) => {
    const tick = () => {
      const i = ref.text.indexOf(MARK);
      if (i >= 0) {
        const url = ref.text.slice(i + MARK.length).split(/\s/)[0];
        if (url) return resolve(url);
      }
      if (Date.now() - ref.t0 > timeoutMs) return reject(new Error('等 DevTools 超时'));
      setTimeout(tick, 300);
    };
    ref.t0 = Date.now();
    tick();
  });
}

function connect(wsUrl) {
  const WS = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl, { perMessageDeflate: false });
    let id = 0;
    const pending = new Map();
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    });
    ws.on('open', () => {
      resolve({
        send: (method, params = {}, sessionId) =>
          new Promise((res, rej) => {
            const mid = ++id;
            const msg = { id: mid, method, params };
            if (sessionId) msg.sessionId = sessionId;
            pending.set(mid, { resolve: res, reject: rej });
            ws.send(JSON.stringify(msg));
          }),
        close: () => ws.close(),
      });
    });
    ws.on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(USER_DATA, { recursive: true });
  const env = {};
  for (const k of Object.keys(process.env)) {
    if (/ELECTRON_RUN_AS_NODE|SAFE_DELETE|NODE_OPTIONS/i.test(k)) continue;
    env[k] = process.env[k];
  }
  env.NODE_OPTIONS = '';
  env.MATHMODEL_E2E = '1';

  const child = spawn(
    APP,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${USER_DATA}`,
      '--disable-gpu',
      '--no-sandbox',
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const textRef = { text: '' };
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => (textRef.text += d.toString()));

  const wsUrl = await waitForBrowserWs(textRef);
  const cdp = await connect(wsUrl);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const send = (method, params = {}) => cdp.send(method, params, sessionId);

  await send('Page.enable');
  await send('Runtime.enable');

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result?.value;
  };
  const shot = async (name) => {
    await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
      fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    });
    log('截图 →', name);
  };

  // 等应用就绪
  for (let i = 0; i < 40; i++) {
    const ok = await evalJs(`!!document.body && document.body.textContent.length > 100`);
    if (ok) break;
    await sleep(300);
  }
  await sleep(800);

  // 点侧栏「设置」
  const clicked = await evalJs(`(function(){
    var btn = Array.from(document.querySelectorAll('button')).find(function(el){
      return el.textContent.trim() === '设置' || el.textContent.includes('设置');
    });
    if (!btn) return 'no-settings-btn';
    btn.click();
    return 'clicked';
  })()`);
  log('侧栏设置按钮:', clicked);
  await sleep(900);

  // 切到「外观」分区
  const nav = await evalJs(`(function(){
    var btn = Array.from(document.querySelectorAll('.settings-nav-item')).find(function(el){
      return el.textContent.includes('外观');
    });
    if (!btn) return 'no-appearance-nav';
    btn.click();
    return 'clicked';
  })()`);
  log('外观分区:', nav);
  await sleep(500);

  // 点 English
  const en = await evalJs(`(function(){
    var btn = Array.from(document.querySelectorAll('button')).find(function(el){
      return el.textContent.includes('English');
    });
    if (!btn) return 'no-english-btn';
    btn.click();
    return 'clicked';
  })()`);
  log('English 按钮:', en);
  await sleep(900);

  // 验证界面已变英文（常见中文锚点应消失，英文锚点应出现）
  const probe = await evalJs(`(function(){
    var text = document.body.textContent;
    return {
      hasEnglishAnchor: /Profile|Settings|Appearance|Theme/i.test(text),
      chineseLeft: (text.match(/[\u4e00-\u9fff]/g) || []).length
    };
  })()`);
  log('英文探针 →', JSON.stringify(probe));
  await shot('mine-i18n-settings-en.png');

  // ── 持久化验证：刷新后仍是英文 ──
  await send('Page.reload');
  await sleep(2500);
  for (let i = 0; i < 20; i++) {
    const ok = await evalJs(`!!document.body && document.body.textContent.length > 100`);
    if (ok) break;
    await sleep(300);
  }
  const persisted = await evalJs(`(function(){
    var text = document.body.textContent;
    return {
      hasEnglishAnchor: /Profile|Settings|Appearance|Theme|New Chat/i.test(text),
      chineseLeft: (text.match(/[\u4e00-\u9fff]/g) || []).length
    };
  })()`);
  log('刷新后持久化探针 →', JSON.stringify(persisted));
  await shot('mine-i18n-after-reload-en.png');

  // ── 扩展页英文截图（顶栏/侧栏导航到扩展）──
  const ext = await evalJs(`(function(){
    var btn = Array.from(document.querySelectorAll('button')).find(function(el){
      return /Extensions|Skill/i.test(el.textContent);
    });
    if (!btn) return 'no-extensions-btn';
    btn.click();
    return 'clicked';
  })()`);
  log('扩展页导航:', ext);
  await sleep(900);
  await shot('mine-i18n-extensions-en.png');

  log('完成。英文残留中文字符数（刷新后）:', persisted.chineseLeft);
  cdp.close();
  child.kill();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
