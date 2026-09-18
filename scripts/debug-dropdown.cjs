/**
 * 调试：为什么点输入区的下拉按钮不弹出面板。
 *
 * 用法：node scripts/debug-dropdown.cjs
 *
 * 比起「看一眼截图」，这里分时间点采样 .cz-pop 的数量，
 * 并打印按钮的祖先链 —— 面板不显示通常是三类原因：
 *   ① 根本没渲染（React 状态没变）
 *   ② 渲染了但被裁掉（祖先有 overflow:hidden）
 *   ③ 渲染了但尺寸为 0 / 定位到视口外
 * 采样式调试能把这三类区分开。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = 'D:/mathmodel-desktop/dist/win-unpacked/MModels.exe';
const PORT = 9345;
const SANDBOX = path.join(os.tmpdir(), 'mm-dbg-dd');
const USER_DATA = path.join(SANDBOX, 'userdata');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitWs(ref) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => {
      const i = ref.text.indexOf('DevTools listening on ');
      if (i >= 0) {
        const u = ref.text.slice(i + 22).split(/\s/)[0];
        if (u) return res(u);
      }
      if (Date.now() - t0 > 40000) return rej(new Error('等 DevTools 超时'));
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
    ws.on('message', (d) => {
      let m;
      try {
        m = JSON.parse(d.toString());
      } catch {
        return;
      }
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.reject(new Error(JSON.stringify(m.error)));
        else p.resolve(m.result);
      }
    });
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        sessionId: null,
        send(method, params, sessionId) {
          const myId = ++id;
          const pl = { id: myId, method, params: params || {} };
          const sid = sessionId === undefined ? this.sessionId : sessionId;
          if (sid) pl.sessionId = sid;
          return new Promise((r, j) => {
            pending.set(myId, { resolve: r, reject: j });
            ws.send(JSON.stringify(pl));
            setTimeout(() => {
              if (pending.has(myId)) {
                pending.delete(myId);
                j(new Error('CDP 超时 ' + method));
              }
            }, 20000);
          });
        },
        async eval(e) {
          const r = await this.send('Runtime.evaluate', {
            expression: e,
            awaitPromise: true,
            returnByValue: true,
          });
          if (r.exceptionDetails) {
            throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
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

const MODE_BTN = /^(自由对话|写论文)$/;

(async () => {
  try {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
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
    cdp = await connect(await waitWs(ref));
    let page;
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
    for (let i = 0; i < 40; i++) {
      // ⚠️ 刚 attach 时 document.body 可能还是 null（页面尚在加载），
      //    直接读 textContent 会抛 "Cannot read properties of null"。
      const len = await cdp
        .eval('document.body ? document.body.textContent.length : 0')
        .catch(() => 0);
      if (len > 80) break;
      await sleep(500);
    }
    await sleep(2000);

    await cdp.eval(
      "(function(){var b=Array.from(document.querySelectorAll('button')).find(function(x){return (x.innerText||'').trim()==='暂时跳过';});if(b)b.click();})()",
    );
    await sleep(1500);

    // ── 祖先链：看有没有 overflow:hidden 把弹层裁掉 ──
    const info = await cdp.eval(
      "(function(){" +
        "var bar=document.querySelector('.cz-bar');" +
        "if(!bar)return{err:'no .cz-bar'};" +
        'var btns=Array.from(bar.querySelectorAll(\'button\'));' +
        'var mode=btns.find(function(b){return ' + MODE_BTN + ".test((b.innerText||'').trim());});" +
        "if(!mode)return{err:'no mode btn',labels:btns.map(function(b){return (b.innerText||'').trim();})};" +
        'var chain=[];var e=mode;' +
        "while(e&&e!==document.body){" +
        "var cs=getComputedStyle(e);" +
        "chain.push(e.tagName.toLowerCase()+(e.className?'.'+String(e.className).split(' ').join('.'):'')" +
        "+'  [overflow='+cs.overflow+' position='+cs.position+' z='+cs.zIndex+']');" +
        "e=e.parentElement;}" +
        'return{chain:chain,label:mode.innerText.trim()};' +
        '})()',
    );
    console.log('按钮祖先链（从按钮往外）：');
    (info.chain || []).forEach((c) => console.log('   ' + c));
    if (info.err) console.log('  ERR: ' + info.err + ' ' + JSON.stringify(info.labels));

    // ── 点击后分时间点采样 ──
    console.log('');
    console.log('点击「模式」按钮后采样 .cz-pop 数量：');
    await cdp.eval(
      "(function(){" +
        "var bar=document.querySelector('.cz-bar');" +
        'var b=Array.from(bar.querySelectorAll(\'button\')).find(function(x){return ' + MODE_BTN + ".test((x.innerText||'').trim());});" +
        "b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));" +
        "b.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));" +
        'b.click();' +
        '})()',
    );
    for (const t of [0, 50, 200, 600, 1500]) {
      if (t) await sleep(t);
      const n = await cdp.eval("document.querySelectorAll('.cz-pop').length");
      const nAll = await cdp.eval('document.querySelectorAll(\'[class*="cz-pop"]\').length');
      console.log('   ~' + t + 'ms : .cz-pop=' + n + '  [class*=cz-pop]=' + nAll);
    }

    // ── 面板几何（若存在）──
    const geo = await cdp.eval(
      "(function(){" +
        "var p=document.querySelector('.cz-pop');" +
        'if(!p)return{exists:false};' +
        'var r=p.getBoundingClientRect();var cs=getComputedStyle(p);' +
        'return{exists:true,top:Math.round(r.top),left:Math.round(r.left),' +
        'w:Math.round(r.width),h:Math.round(r.height),' +
        "display:cs.display,visibility:cs.visibility,opacity:cs.opacity};" +
        '})()',
    );
    console.log('');
    console.log('面板几何：' + JSON.stringify(geo));

    // ── 换「项目」按钮再试（对照）──
    console.log('');
    console.log('对照：点「项目」按钮（.cz-bar 第一个 button）');
    await cdp.eval(
      "(function(){var bar=document.querySelector('.cz-bar');bar.querySelectorAll('button')[0].click();})()",
    );
    await sleep(700);
    console.log('   .cz-pop=' + (await cdp.eval("document.querySelectorAll('.cz-pop').length")));

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('D:/mathmodel-desktop/out/debug-dropdown.png', Buffer.from(shot.data, 'base64'));
    console.log('   截图: out/debug-dropdown.png');
  } catch (e) {
    console.log('FATAL ' + (e.stack || e));
    console.log(ref.text.slice(0, 800));
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
})();
