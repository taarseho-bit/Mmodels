/**
 * 驱动打包后的 MModels.exe，进入「设置 → 个人资料」截图。
 *
 * 用途：与项目契约设置页截图做双开对照（界面样例由用户提供）。
 * 用法：node scripts/shoot-settings.cjs
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = 'D:/mathmodel-desktop';
const APP = path.join(ROOT, 'dist', 'win-unpacked', 'MModels.exe');
const PORT = 9349;
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-shoot-settings-'));
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
  // 与 test-real-app.cjs 一致：清掉会干扰 Electron 启动的环境变量，开 E2E 模式
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

  // 确认进入设置分区（默认就是「个人资料」）
  const inProfile = await evalJs(`document.body.textContent.includes('个人资料')`);
  log('个人资料分区可见:', inProfile);

  // ── 功能级验证（不是只看界面）──
  const stats = await evalJs(`window.mathmodel.stats.get().then(function(s){
    return { totalTokens: s.totalTokens, promptCount: s.promptCount, sessionCount: s.sessionCount,
             activeDays: s.activeDays, heatmapDays: s.heatmap.length, skillCount: s.skillCount,
             byModel: s.byModel.length, byProject: s.byProject.length };
  })`);
  log('stats:get 功能验证 →', JSON.stringify(stats));

  const notifySupported = await evalJs(`window.mathmodel.notifications.isSupported()`);
  log('notifications.isSupported →', notifySupported);

  // 分享图生成：真跑一次 HTML → PNG（E2E 直通落盘，不弹原生对话框），验证文件真实生成
  const e2eShare = path.join(SANDBOX, 'share-test.png');
  const share = await evalJs(`window.mathmodel.file.saveShareImage({
    defaultName: 'mm-share-test.png',
    e2eAutoPath: ${JSON.stringify(e2eShare.split('\\').join('/'))},
    html: '<html><body style="width:800px;font:32px sans-serif;padding:40px"><h1>MModels share-image check</h1><p>' + Date.now() + '</p></body></html>'
  })`);
  let shareOk = false;
  if (share && share.path) {
    shareOk = fs.existsSync(share.path) && fs.statSync(share.path).size > 1000;
    log('saveShareImage →', share.path, '大小', fs.statSync(share.path).size, '字节', shareOk ? '✓ 真实生成' : '✗ 内容异常');
  } else {
    log('saveShareImage → 返回 null ✗');
  }

  // open-text: 只验证方法注册（真调用会弹原生对话框卡住自动化）
  const openTextExists = await evalJs(`typeof window.mathmodel.file.openText === 'function'`);
  log('file.openText 已注册:', openTextExists);

  // 滚动截两屏：顶部（资料卡+统计）与热力图
  await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    fs.writeFileSync(path.join(OUT, 'mine-settings-profile.png'), Buffer.from(r.data, 'base64'));
  });
  await evalJs(`window.scrollTo(0, 400); document.querySelector('.settings-main')?.scrollTo?.(0, 420); true`);
  await sleep(400);
  await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    fs.writeFileSync(path.join(OUT, 'mine-settings-profile-2.png'), Buffer.from(r.data, 'base64'));
  });

  // 再切「键盘快捷键」分区截一张
  await evalJs(`(function(){
    var btn = Array.from(document.querySelectorAll('.settings-nav-item')).find(function(el){
      return el.textContent.includes('键盘快捷键');
    });
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(500);
  await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    fs.writeFileSync(path.join(OUT, 'mine-settings-keys.png'), Buffer.from(r.data, 'base64'));
  });

  log('截图完成：mine-settings-profile.png / mine-settings-profile-2.png / mine-settings-keys.png');
  cdp.close();
  child.kill();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
