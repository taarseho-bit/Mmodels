/**
 * 对比复刻版与原版的**输入区（Composer）**。
 *
 * 用法：
 *   node scripts/compare-ui.cjs mine
 *   node scripts/compare-ui.cjs orig
 *
 * 做三件事：
 *   1. 跳过首启向导后截图主界面
 *   2. 点开「模式」下拉，截出可选项清单
 *   3. 列出输入区的全部按钮
 *
 * ⚠️ 原版必须用空数据目录启动（遥测强制开启，带登录态会真的出网）。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WHICH = process.argv[2] === 'orig' ? 'orig' : 'mine';
const CONF =
  WHICH === 'orig'
    ? {
        app: require('./installed-baseline.cjs').installedApp,
        port: 9341,
        sandbox: fs.mkdtempSync(path.join(os.tmpdir(), 'mm-cmp-orig-')),
        tag: 'orig',
        e2e: false,
      }
    : {
        app: 'D:/mathmodel-desktop/dist/win-unpacked/MModels.exe',
        port: 9343,
        sandbox: fs.mkdtempSync(path.join(os.tmpdir(), 'mm-cmp-mine-')),
        tag: 'mine',
        e2e: true,
      };

const OUT = 'D:/mathmodel-desktop/out';
const USER_DATA = path.join(CONF.sandbox, 'userdata');
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForBrowserWs(ref, timeoutMs = 45000) {
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
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        sessionId: null,
        send(method, params, sessionId) {
          const myId = ++id;
          const payload = { id: myId, method, params: params || {} };
          const sid = sessionId === undefined ? this.sessionId : sessionId;
          if (sid) payload.sessionId = sid;
          return new Promise((res, rej) => {
            pending.set(myId, { resolve: res, reject: rej });
            ws.send(JSON.stringify(payload));
            setTimeout(() => {
              if (pending.has(myId)) {
                pending.delete(myId);
                rej(new Error('CDP 超时: ' + method));
              }
            }, 25000);
          });
        },
        async eval(expr) {
          const r = await this.send('Runtime.evaluate', {
            expression: expr,
            awaitPromise: true,
            returnByValue: true,
          });
          if (r.exceptionDetails) {
            const d = r.exceptionDetails;
            throw new Error((d.exception && d.exception.description) || d.text || 'JS 异常');
          }
          return r.result && r.result.value;
        },
        close() {
          ws.close();
        },
      }),
    );
  });
}

/** 点掉首启向导：找「跳过」类按钮点它，点不着就直接改设置后 reload */
async function dismissOnboarding(cdp) {
  const clicked = await cdp.eval(
    `(function(){
      var btns = Array.from(document.querySelectorAll('button'));
      var skip = btns.find(function(b){
        var t = (b.innerText||'').trim();
        return t === '暂时跳过' || t === '跳过' || t.indexOf('跳过') === 0;
      });
      if (skip) { skip.click(); return 'clicked:' + skip.innerText.trim(); }
      return 'notfound';
    })()`,
  );
  await sleep(1200);
  return clicked;
}

async function main() {
  log('════ 输入区对比：' + WHICH + ' ════');
  if (!fs.existsSync(CONF.app)) {
    log('✗ 找不到应用：' + CONF.app);
    process.exit(1);
  }
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  const env = {};
  for (const k of Object.keys(process.env)) {
    if (/ELECTRON_RUN_AS_NODE|SAFE_DELETE|NODE_OPTIONS/i.test(k)) continue;
    env[k] = process.env[k];
  }
  env.NODE_OPTIONS = '';
  if (CONF.e2e) env.MATHMODEL_E2E = '1';

  const child = spawn(
    CONF.app,
    [
      '--remote-debugging-port=' + CONF.port,
      '--user-data-dir=' + USER_DATA,
      '--disable-gpu',
      '--no-sandbox',
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const ref = { text: '' };
  child.stderr.on('data', (d) => {
    ref.text += d.toString();
  });
  child.stdout.on('data', () => {});

  let cdp;
  try {
    const wsUrl = await waitForBrowserWs(ref);
    cdp = await connect(wsUrl);
    let page = null;
    for (let i = 0; i < 60; i++) {
      const r = await cdp.send('Target.getTargets');
      page = (r.targetInfos || []).find(
        (t) => t.type === 'page' && t.url.indexOf('devtools://') !== 0,
      );
      if (page) break;
      await sleep(500);
    }
    const att = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    cdp.sessionId = att.sessionId;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    for (let i = 0; i < 50; i++) {
      const t = await cdp.eval('document.body.textContent.length');
      if (t > 80) break;
      await sleep(600);
    }
    await sleep(2000);

    log('首启向导：' + (await dismissOnboarding(cdp)));
    await sleep(1500);

    // 截图：跳过向导后的主界面
    let shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, CONF.tag + '-main.png'), Buffer.from(shot.data, 'base64'));

    // ── 点开「模式」下拉 ──
    // ⚠️ 必须限定在输入区的 .cz-bar 里找，不能在整页找 ——
    //    顶栏也有「分享论文」，按 /论文/ 匹配会点到它，测试等于没测。
    const opened = await cdp.eval(
      `(function(){
        var bar = document.querySelector('[class*="cz-bar"]');
        if (!bar) return 'no-cz-bar';
        var btns = Array.from(bar.querySelectorAll('button'));
        var mode = btns.find(function(b){
          var t = (b.innerText||'').trim();
          return /^(自由对话|写论文|科研绘图|论文评审|数据检索)$/.test(t);
        });
        if (!mode) return 'no-mode-button:' + btns.map(function(b){return (b.innerText||'').trim();}).join(',');
        mode.click();
        return 'clicked:' + mode.innerText.trim();
      })()`,
    );
    log('模式下拉：' + opened);
    await sleep(1000);

    shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, CONF.tag + '-mode-open.png'), Buffer.from(shot.data, 'base64'));

    // 下拉是否真的可见（拿到几何信息，而不只是"存在"）
    const pop = await cdp.eval(
      `(function(){
        var p = document.querySelector('[class*="cz-pop"]');
        if (!p) return { exists: false };
        var r = p.getBoundingClientRect();
        var cs = getComputedStyle(p);
        return {
          exists: true,
          top: Math.round(r.top), left: Math.round(r.left),
          w: Math.round(r.width), h: Math.round(r.height),
          display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
          position: cs.position, zIndex: cs.zIndex,
          text: (p.innerText||'').replace(/\\n+/g,' / ').slice(0,120)
        };
      })()`,
    );
    log('');
    log('── 下拉面板实测 ──');
    if (!pop.exists) {
      log('  ✗ 面板根本没渲染出来');
    } else {
      log('  尺寸 : ' + pop.w + ' x ' + pop.h + '  位置(' + pop.left + ',' + pop.top + ')');
      log('  可见性: display=' + pop.display + ' visibility=' + pop.visibility + ' opacity=' + pop.opacity);
      log('  定位 : ' + pop.position + '  z-index=' + pop.zIndex);
      log('  内容 : ' + pop.text);
      if (pop.h === 0 || pop.w === 0) log('  ✗ 尺寸为 0 —— 被压扁/裁掉了');
      else if (pop.top < 0) log('  ✗ top 为负 —— 面板弹到了视口外');
    }

    // ── 输入区按钮清单 ──
    const btns = await cdp.eval(
      `(function(){
        var bar = document.querySelector('[class*="cz-bar"]');
        if (!bar) return null;
        return {
          buttons: Array.from(bar.querySelectorAll('button'))
            .map(function(b){ return (b.innerText||b.getAttribute('title')||'').trim(); })
            .filter(Boolean),
          hasPlus: !!bar.querySelector('[class*="cz-icon-btn"]'),
          placeholders: Array.from(bar.querySelectorAll('textarea,input'))
            .map(function(e){ return e.getAttribute('placeholder'); }).filter(Boolean)
        };
      })()`,
    );
    log('');
    log('── 输入区结构 ──');
    if (btns) {
      log('  按钮      : ' + btns.buttons.join(' / '));
      log('  有 ＋ 按钮 : ' + btns.hasPlus);
      log('  占位文字  : ' + btns.placeholders.join(' / '));
    } else {
      log('  （没找到 cz-bar，可能是原版结构不同 —— 看截图）');
    }

    // 整个输入区文本（含上下文栏）
    const composerText = await cdp.eval(
      `(function(){
        var bar = document.querySelector('[class*="cz-bar"]') || document.querySelector('textarea')?.parentElement;
        return bar ? (bar.innerText||'').replace(/\\n+/g,' | ') : '(未找到)';
      })()`,
    );
    log('');
    log('  输入区全文 : ' + composerText);
  } catch (e) {
    log('FATAL ' + String((e && e.stack) || e));
    log(ref.text.slice(0, 1200));
  } finally {
    try {
      if (cdp) cdp.close();
    } catch {
      /* 忽略 */
    }
    try {
      child.kill();
    } catch {
      /* 忽略 */
    }
  }
}

main();
