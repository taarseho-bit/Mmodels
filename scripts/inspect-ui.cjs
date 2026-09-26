/**
 * 驱动打包后的真实应用，跳过首启向导，抓「主界面」的真实样子 + DOM 事实。
 *
 * 起因：用户反馈「界面和项目契约完全不一样，没有选择比赛/模式，发文件没反应」。
 * 不能靠读源码回答，必须看**真实渲染出来的界面**。
 *
 * 用法：node scripts/inspect-ui.cjs
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = 'D:/mathmodel-desktop';
const APP = path.join(ROOT, 'dist', 'win-unpacked', 'mathmodel.exe');
const PORT = 9335;
const SANDBOX = path.join(os.tmpdir(), 'mm-ui-inspect');
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

async function main() {
  log('════ 检查真实主界面 ════');

  try {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  } catch {
    /* 占用就继续 */
  }
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
    ['--remote-debugging-port=' + PORT, '--user-data-dir=' + USER_DATA, '--disable-gpu', '--no-sandbox'],
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
    for (let i = 0; i < 50; i++) {
      const r = await cdp.send('Target.getTargets');
      page = (r.targetInfos || []).find(
        (t) => t.type === 'page' && t.url.indexOf('devtools://') !== 0,
      );
      if (page) break;
      await sleep(400);
    }
    const att = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    cdp.sessionId = att.sessionId;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    for (let i = 0; i < 40; i++) {
      const t = await cdp.eval('document.body.textContent.length');
      if (t > 80) break;
      await sleep(500);
    }

    // ── 第一屏：首次启动看到什么 ──
    await cdp.send('Page.captureScreenshot', { format: 'png' }).then((s) => {
      fs.writeFileSync(path.join(OUT, 'ui-01-first-launch.png'), Buffer.from(s.data, 'base64'));
    });
    log('');
    log('── 首屏正文（前 400 字）──');
    log(
      String(await cdp.eval('document.body.innerText')).split('\n').filter(Boolean).slice(0, 20).join('\n'),
    );

    // ── 跳过引导：直接落盘设置 ──
    await cdp.eval(
      `(async function(){
        try {
          await window.mathmodel.settings.set({
            onboardingDone: true, tourDone: true,
            activeProviderId: 'anthropic',
            defaultModel: 'claude-sonnet-5'
          });
          return 'patched';
        } catch (e) { return 'ERR ' + (e && e.message); }
      })()`,
    );
    // 重新加载让引导不再出现
    await cdp.send('Page.reload');
    await sleep(3500);
    for (let i = 0; i < 40; i++) {
      const t = await cdp.eval('document.body.textContent.length');
      if (t > 80) break;
      await sleep(500);
    }

    await cdp.send('Page.captureScreenshot', { format: 'png' }).then((s) => {
      fs.writeFileSync(path.join(OUT, 'ui-02-main.png'), Buffer.from(s.data, 'base64'));
    });

    log('');
    log('── 主界面正文 ──');
    log(
      String(await cdp.eval('document.body.innerText')).split('\n').filter(Boolean).slice(0, 40).join('\n'),
    );

    // ── DOM 事实：输入区有哪些控件 ──
    const dom = await cdp.eval(
      `(function(){
        var out = {};
        out.hasTextarea = !!document.querySelector('textarea');
        out.hasFileInput = !!document.querySelector('input[type=file]');
        // 按 class 前缀找输入区与弹层
        out.czClasses = Array.from(document.querySelectorAll('[class*="cz-"]'))
          .map(function(e){ return e.className; }).slice(0, 40);
        out.brClasses = Array.from(document.querySelectorAll('[class*="br-"]'))
          .map(function(e){ return e.className; }).slice(0, 20);
        var ta = document.querySelector('textarea');
        out.placeholder = ta ? ta.getAttribute('placeholder') : null;
        return out;
      })()`,
    );
    log('');
    log('── DOM 事实 ──');
    log('  有 textarea       : ' + dom.hasTextarea);
    log('  有 file input     : ' + dom.hasFileInput);
    log('  textarea 占位文字 : ' + domest(dom.placeholder));
    log('  输入区 class 抽样 : ' + (dom.czClasses || []).slice(0, 12).join(' | '));
  } catch (e) {
    log('FATAL ' + String((e && e.stack) || e));
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

function domest(v) {
  return v === null || v === undefined ? '(无)' : String(v);
}

main();
