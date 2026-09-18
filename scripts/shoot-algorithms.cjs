/**
 * 功能级验证：算法市场（algorithms:list 真实调用 + 界面截图）。
 * 用法：node scripts/shoot-algorithms.cjs
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = 'D:/mathmodel-desktop';
const APP = path.join(ROOT, 'dist', 'win-unpacked', 'MModels.exe');
const PORT = 9351;
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-shoot-alg-'));
const USER_DATA = path.join(SANDBOX, 'userdata');
const OUT = path.join(ROOT, 'out');

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
      try { msg = JSON.parse(data.toString()); } catch { return; }
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
  const child = spawn(APP, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`, '--disable-gpu', '--no-sandbox'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const ref = { text: '' };
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => (ref.text += d.toString()));
  const wsUrl = await waitForBrowserWs(ref);
  const cdp = await connect(wsUrl);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const send = (method, params = {}) => cdp.send(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;

  for (let i = 0; i < 40; i++) {
    if (await evalJs('!!document.body && document.body.textContent.length > 100')) break;
    await sleep(300);
  }
  await sleep(800);

  // ── 功能级验证 1：目录真实加载 ──
  const snap = await evalJs(`window.mathmodel.algorithms.list().then(function(s){
    return { source: s.source, count: s.algorithms.length, python: s.python.state, pyVersion: s.python.version,
             pipOk: s.python.pipOk,
             installedSample: s.algorithms.filter(function(a){return a.installed;}).slice(0,5).map(function(a){return a.packageName;}) };
  })`);
  console.log('algorithms:list →', JSON.stringify(snap));

  // ── 打开扩展页 → 算法市场 tab → 截图 ──
  await evalJs(`(function(){
    var btn = Array.from(document.querySelectorAll('button')).find(function(el){ return el.textContent.includes('扩展'); });
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(800);
  await evalJs(`(function(){
    var btn = Array.from(document.querySelectorAll('button')).find(function(el){ return el.textContent.includes('算法市场'); });
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(1200);
  await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    fs.writeFileSync(path.join(OUT, 'mine-algorithms.png'), Buffer.from(r.data, 'base64'));
  });

  // 展开一个算法卡片截详情
  await evalJs(`(function(){
    var card = Array.from(document.querySelectorAll('.panel')).find(function(el){ return el.textContent.includes('NSGA-II'); });
    if (card) card.click();
    return !!card;
  })()`);
  await sleep(500);
  await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    fs.writeFileSync(path.join(OUT, 'mine-algorithms-detail.png'), Buffer.from(r.data, 'base64'));
  });

  console.log('截图完成：mine-algorithms.png / mine-algorithms-detail.png');
  cdp.close();
  child.kill();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
