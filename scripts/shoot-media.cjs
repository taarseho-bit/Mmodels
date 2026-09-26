/**
 * 音视频预览自测驱动（真机跑打包版 MModels.exe）。
 *
 * 验证链路：主进程 makePreview 判定 → mm-media:// 流式协议 → CSP media-src → <audio>/<video> 解码。
 *
 * 样本来源（本机无 ffmpeg）：
 *   · 音频：项目契约基线里的真实 wav（.baseline/app/out/renderer/assets/complete-*.wav）
 *   · 视频：渲染层用 MediaRecorder + canvas.captureStream 现场录一段 webm（Chromium 自带编码器）
 *   · 坏样本：随机字节冒充 .mp4，用来验证「无法播放」兜底文案可达
 *
 * 用法：node scripts/shoot-media.cjs
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = 'D:/mathmodel-desktop';
const APP = path.join(ROOT, 'dist', 'win-unpacked', 'MModels.exe');
const PORT = 9357;
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-shoot-media-'));
const USER_DATA = path.join(SANDBOX, 'userdata');
const OUT = path.join(ROOT, 'out');

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForBrowserWs(ref, timeoutMs = 40000) {
  const MARK = 'DevTools listening on ';
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const i = ref.text.indexOf(MARK);
      if (i >= 0) {
        const url = ref.text.slice(i + MARK.length).split(/\s/)[0];
        if (url) return resolve(url);
      }
      if (Date.now() - t0 > timeoutMs) return reject(new Error('等 DevTools 超时'));
      setTimeout(tick, 300);
    };
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
    ws.on('open', () =>
      resolve({
        send: (method, params = {}, sessionId) =>
          new Promise((res, rej) => {
            const mid = ++id;
            const m = { id: mid, method, params };
            if (sessionId) m.sessionId = sessionId;
            pending.set(mid, { resolve: res, reject: rej });
            ws.send(JSON.stringify(m));
          }),
        close: () => ws.close(),
      }),
    );
    ws.on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  const env = {};
  for (const k of Object.keys(process.env)) {
    if (/ELECTRON_RUN_AS_NODE|SAFE_DELETE|NODE_OPTIONS/i.test(k)) continue;
    env[k] = process.env[k];
  }
  env.NODE_OPTIONS = '';
  env.MATHMODEL_E2E = '1';

  const child = spawn(
    APP,
    [`--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`, '--disable-gpu', '--no-sandbox'],
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
    if (r.exceptionDetails) throw new Error('eval 异常: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails));
    return r.result?.value;
  };

  for (let i = 0; i < 60; i++) {
    const ok = await evalJs(`!!document.body && document.body.textContent.length > 100`);
    if (ok) break;
    await sleep(300);
  }
  await sleep(800);

  // ── 1. 目标项目根 + 落样本 ──
  const proj = await evalJs(`window.mathmodel.project.current()`);
  if (!proj || !proj.root) throw new Error('拿不到当前项目根');
  log('项目根:', proj.root);

  const wavSrc = fs
    .readdirSync(path.join(ROOT, '.baseline/app/out/renderer/assets'))
    .find((f) => f.endsWith('.wav'));
  const wavDst = path.join(proj.root, 'mm-audio-test.wav');
  fs.copyFileSync(path.join(ROOT, '.baseline/app/out/renderer/assets', wavSrc), wavDst);
  log('音频样本:', wavSrc, '→', fs.statSync(wavDst).size, '字节');

  // 视频：渲染层现录一段 webm（Chromium 自带 VP8 编码器，本机无 ffmpeg 也能造真样本）
  const webmB64 = await evalJs(`(async function(){
    var c = document.createElement('canvas'); c.width = 320; c.height = 240;
    var ctx = c.getContext('2d');
    var stream = c.captureStream(25);
    var mime = ['video/webm;codecs=vp8', 'video/webm'].find(function(m){
      return window.MediaRecorder && MediaRecorder.isTypeSupported(m);
    });
    if (!mime) return '';
    var rec = new MediaRecorder(stream, { mimeType: mime });
    var chunks = [];
    rec.ondataavailable = function(e){ if (e.data.size) chunks.push(e.data); };
    var stopped = new Promise(function(res){ rec.onstop = res; });
    rec.start();
    var t0 = performance.now();
    await new Promise(function(res){
      (function draw(){
        var t = performance.now() - t0;
        ctx.fillStyle = 'hsl(' + ((t/8) % 360) + ',70%,35%)';
        ctx.fillRect(0,0,320,240);
        ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
        ctx.fillText('MModels media test', 20, 130);
        if (t < 1500) requestAnimationFrame(draw); else res();
      })();
    });
    rec.stop();
    await stopped;
    var blob = new Blob(chunks, { type: 'video/webm' });
    var buf = new Uint8Array(await blob.arrayBuffer());
    var s = '';
    for (var i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  })()`);
  if (!webmB64) throw new Error('MediaRecorder 不可用，无法造视频样本');
  const webmDst = path.join(proj.root, 'mm-video-test.webm');
  fs.writeFileSync(webmDst, Buffer.from(webmB64, 'base64'));
  log('视频样本: MediaRecorder →', fs.statSync(webmDst).size, '字节');

  // 坏样本：随机字节冒充 mp4（验证「无法播放」文案可达）
  const badDst = path.join(proj.root, 'mm-broken.mp4');
  fs.writeFileSync(badDst, Buffer.from(Array.from({ length: 4096 }, () => Math.floor(Math.random() * 256))));
  log('坏样本:', fs.statSync(badDst).size, '字节');

  // ── 2. 主进程判定（IPC 契约）──
  for (const rel of ['mm-audio-test.wav', 'mm-video-test.webm', 'mm-broken.mp4']) {
    const p = await evalJs(`window.mathmodel.file.preview(${JSON.stringify(rel)})`);
    log(
      `preview(${rel}) → kind=${p.kind} mime=${p.mime} mediaUrl=${p.mediaUrl}` +
        (p.dataUrl ? ' ⚠️ 竟然内联了 base64' : ' ✓ 未内联二进制'),
    );
  }

  // ── 3. 解码链路：mm-media:// + CSP media-src（真挂元素等 metadata）──
  const probe = (rel, tag) => `(function(){
    return new Promise(function(resolve){
      var el = document.createElement(${JSON.stringify(tag)});
      el.id = 'mm-probe-' + ${JSON.stringify(tag)};
      el.style.position = 'fixed'; el.style.left = '-9999px';
      var done = false;
      var finish = function(ok, why){ if (done) return; done = true; resolve({ ok: ok, why: why,
        readyState: el.readyState, duration: el.duration, w: el.videoWidth || 0, h: el.videoHeight || 0,
        src: el.currentSrc }); };
      el.onloadedmetadata = function(){ finish(true, 'loadedmetadata'); };
      el.onerror = function(){ finish(false, el.error ? ('media-error ' + el.error.code) : 'error'); };
      setTimeout(function(){ finish(el.readyState >= 1, 'timeout-readyState=' + el.readyState); }, 8000);
      document.body.appendChild(el);
      window.mathmodel.file.preview(${JSON.stringify(rel)}).then(function(p){ el.src = p.mediaUrl; el.load(); });
    });
  })()`;

  const audioProbe = await evalJs(probe('mm-audio-test.wav', 'audio'));
  log('音频解码 →', JSON.stringify(audioProbe));
  const videoProbe = await evalJs(probe('mm-video-test.webm', 'video'));
  log('视频解码 →', JSON.stringify(videoProbe));

  // ── 4. UI 层：右栏「文件」→ 点文件 → 出播放器 + 截图 ──
  // 首启向导/浮层会挡住右栏，先关掉
  const dismissed = await evalJs(`(function(){
    var words = ['跳过','稍后','关闭','Skip','Close','Got it','知道了'];
    var hits = [];
    Array.from(document.querySelectorAll('button')).forEach(function(b){
      var s = (b.textContent || '').trim();
      if (words.some(function(w){ return s === w || s.indexOf(w) === 0; })) { hits.push(s); b.click(); }
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return hits.join(' | ') || 'none';
  })()`);
  log('关闭首启浮层:', dismissed);
  await sleep(500);

  // 右栏默认是关闭的（store.sidePanel = null）→ 点顶栏「打开面板」
  const opened = await evalJs(`(function(){
    if (document.querySelector('.sidepanel')) return 'already-open';
    var btn = Array.from(document.querySelectorAll('.topbar-action')).find(function(el){
      return (el.textContent || '').includes('打开面板');
    });
    if (!btn) return 'no-toggle:' + Array.from(document.querySelectorAll('.topbar-action')).map(function(e){return e.textContent.trim();}).join('/');
    btn.click();
    return 'clicked';
  })()`);
  log('打开右栏:', opened);
  await sleep(700);

  const openFilesTab = `(function(){
    var tab = Array.from(document.querySelectorAll('.sidepanel-tab')).find(function(el){
      return (el.textContent || '').includes('文件');
    });
    if (!tab) {
      var add = document.querySelector('.sidepanel-tab-add');
      if (add) add.click();
      var item = Array.from(document.querySelectorAll('.sidepanel-menu-item')).find(function(el){
        return (el.textContent || '').includes('文件');
      });
      if (item) { item.click(); return 'via-menu'; }
      return 'no-files-tab';
    }
    tab.click();
    return 'clicked';
  })()`;
  log('打开「文件」标签:', await evalJs(openFilesTab));
  await sleep(900);

  const clickFile = (name) => `(function(){
    var row = Array.from(document.querySelectorAll('.file-row')).find(function(el){
      var n = el.querySelector('.file-row-name');
      return n && n.textContent.trim() === ${JSON.stringify(name)};
    });
    if (!row) return 'no-row';
    row.click();
    return 'clicked';
  })()`;

  const shoot = async (file) => {
    log(`点文件 ${file}:`, await evalJs(clickFile(file)));
    await sleep(1600);
    const state = await evalJs(`(function(){
      var a = document.querySelector('audio.ap-media'), v = document.querySelector('video.ap-media');
      var txt = document.body.textContent || '';
      return {
        audio: !!a, video: !!v,
        audioReady: a ? a.readyState : -1, audioDur: a ? a.duration : -1,
        videoReady: v ? v.readyState : -1, videoW: v ? v.videoWidth : -1,
        audioFailCopy: txt.includes('音频无法播放'),
        videoFailCopy: txt.includes('视频无法播放'),
      };
    })()`);
    return state;
  };

  const s1 = await shoot('mm-audio-test.wav');
  log('UI 音频状态 →', JSON.stringify(s1));
  await send('Page.captureScreenshot', { format: 'png' }).then((r) =>
    fs.writeFileSync(path.join(OUT, 'mine-media-audio.png'), Buffer.from(r.data, 'base64')),
  );

  const s2 = await shoot('mm-video-test.webm');
  log('UI 视频状态 →', JSON.stringify(s2));
  await send('Page.captureScreenshot', { format: 'png' }).then((r) =>
    fs.writeFileSync(path.join(OUT, 'mine-media-video.png'), Buffer.from(r.data, 'base64')),
  );

  const s3 = await shoot('mm-broken.mp4');
  log('UI 坏样本状态 →', JSON.stringify(s3));
  await send('Page.captureScreenshot', { format: 'png' }).then((r) =>
    fs.writeFileSync(path.join(OUT, 'mine-media-broken.png'), Buffer.from(r.data, 'base64')),
  );

  log('截图：out/mine-media-audio.png / mine-media-video.png / mine-media-broken.png');

  // ── 5. 清理样本 ──
  for (const f of [wavDst, webmDst, badDst]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }

  cdp.close();
  child.kill();
  process.exit(0);
})().catch((e) => {
  console.error('✗ 自测失败:', e);
  process.exit(1);
});
