/**
 * 启动**原版**应用并截图，用于与复刻版做真实界面对比。
 *
 * ⚠️ 隐私红线：**必须用全新空数据目录启动**。
 *   原版的遥测/诊断上报是强制开启的（那个「帮助改进」开关是摆设，详见
 *   《遥测与诊断链路-逆向报告.md》第 5 节），而它出网需要账号会话 cookie。
 *   若带上真实登录态启动，它会真的把数据发到 mathmodel.top。
 *   用空目录 = 没有 cookie = 出不了网。
 *
 * 用法：node scripts/inspect-original-ui.cjs
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = require('./installed-baseline.cjs').installedApp;
const PORT = 9337;
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-orig-inspect-'));
const USER_DATA = path.join(SANDBOX, 'userdata');
const OUT = 'D:/mathmodel-desktop/out';

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

async function main() {
  log('════ 检查原版真实界面（空数据目录，零出网）════');
  if (!fs.existsSync(APP)) {
    log('✗ 找不到原版：' + APP);
    process.exit(1);
  }

  fs.mkdirSync(USER_DATA, { recursive: true });

  const env = {};
  for (const k of Object.keys(process.env)) {
    if (/ELECTRON_RUN_AS_NODE|SAFE_DELETE|NODE_OPTIONS/i.test(k)) continue;
    env[k] = process.env[k];
  }
  env.NODE_OPTIONS = '';

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
    for (let i = 0; i < 60; i++) {
      const r = await cdp.send('Target.getTargets');
      page = (r.targetInfos || []).find(
        (t) => t.type === 'page' && t.url.indexOf('devtools://') !== 0,
      );
      if (page) break;
      await sleep(500);
    }
    if (!page) throw new Error('没找到页面 target');
    const att = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    cdp.sessionId = att.sessionId;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    for (let i = 0; i < 50; i++) {
      const t = await cdp.eval('document.body.textContent.length');
      if (t > 80) break;
      await sleep(600);
    }
    await sleep(2500);

    await cdp.send('Page.captureScreenshot', { format: 'png' }).then((s) => {
      fs.writeFileSync(path.join(OUT, 'orig-01-first.png'), Buffer.from(s.data, 'base64'));
    });

    log('');
    log('── 原版首屏正文 ──');
    log(
      String(await cdp.eval('document.body.innerText'))
        .split('\n')
        .filter(Boolean)
        .slice(0, 45)
        .join('\n'),
    );

    // 输入区控件
    const dom = await cdp.eval(
      `(function(){
        var ta = document.querySelector('textarea');
        return {
          hasTextarea: !!ta,
          placeholder: ta ? ta.getAttribute('placeholder') : null,
          buttons: Array.from(document.querySelectorAll('button'))
            .map(function(b){ return (b.innerText||'').trim(); })
            .filter(Boolean).slice(0, 30),
          hash: location.hash
        };
      })()`,
    );
    log('');
    log('── 输入区 ──');
    log('  有 textarea  : ' + dom.hasTextarea);
    log('  占位文字     : ' + dom.placeholder);
    log('  按钮         : ' + (dom.buttons || []).join(' / '));
    log('  路由         : ' + dom.hash);
  } catch (e) {
    log('FATAL ' + String((e && e.stack) || e));
    log('── 进程输出 ──');
    log(ref.text.slice(0, 1500));
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
