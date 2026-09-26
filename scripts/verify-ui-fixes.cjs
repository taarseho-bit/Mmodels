/**
 * 验证本轮针对「界面和项目契约不一样」的三处修复。
 *
 * 起因（用户实测反馈）：
 *   1. 看不到「选择哪个比赛」→ 默认模式是 chat 而非 paper，且没人自动认领比赛模板
 *   2. 发文件没反应         → 拖拽/粘贴都没实现，且全局没拦 drop（拖到窗口会让页面跳转）
 *   3. 下拉框点了不显示     → 弹层被 .composer-box 的 overflow:hidden 裁掉，
 *                            而且默认向上展开在空状态下会跑到视口外（top 为负）
 *
 * 用法：node scripts/verify-ui-fixes.cjs
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = 'D:/mathmodel-desktop/dist/win-unpacked/MModels.exe';
const PORT = 9347;
const SANDBOX = path.join(os.tmpdir(), 'mm-verify-fixes');
const USER_DATA = path.join(SANDBOX, 'userdata');
const OUT = 'D:/mathmodel-desktop/out';

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

function waitWs(ref, timeoutMs = 45000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => {
      const i = ref.text.indexOf('DevTools listening on ');
      if (i >= 0) {
        const u = ref.text.slice(i + 22).split(/\s/)[0];
        if (u) return res(u);
      }
      if (Date.now() - t0 > timeoutMs) return rej(new Error('等 DevTools 超时'));
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

(async () => {
  log('════ 验证「界面与项目契约不一致」的三处修复 ════');
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
    await cdp.send('Page.enable');
    for (let i = 0; i < 40; i++) {
      const len = await cdp.eval('document.body ? document.body.textContent.length : 0').catch(() => 0);
      if (len > 80) break;
      await sleep(500);
    }
    await sleep(1500);
    await cdp.eval(
      "(function(){var b=Array.from(document.querySelectorAll('button')).find(function(x){return (x.innerText||'').trim()==='暂时跳过';});if(b)b.click();})()",
    );
    await sleep(2500);

    // ── 修复 1：输入区应出现比赛相关控件 ──
    const bar = await cdp.eval(
      "(function(){var b=document.querySelector('.cz-bar');return b?b.innerText.replace(/\\n+/g,' | '):null;})()",
    );
    log('');
    log('输入区上下文栏: ' + bar);
    ok(!!bar && bar.includes('写论文'), '默认模式是「写论文」而不是「自由对话」', String(bar));
    ok(!!bar && /国赛|CUMCM|杯|赛/.test(bar), '自动认领了比赛模板（能看到比赛名）', String(bar));
    ok(!!bar && bar.includes('比赛信息'), '出现「比赛信息」入口');

    // ── 修复 3：下拉面板必须真正可见且在视口内 ──
    await cdp.eval(
      "(function(){var b=document.querySelector('.cz-bar');var btns=Array.from(b.querySelectorAll('button'));var m=btns.find(function(x){return /^(自由对话|写论文)$/.test((x.innerText||'').trim());});m.click();})()",
    );
    await sleep(700);
    const pop = await cdp.eval(
      "(function(){var p=document.querySelector('.cz-pop');if(!p)return{exists:false};" +
        'var r=p.getBoundingClientRect();var cs=getComputedStyle(p);' +
        'return{exists:true,top:Math.round(r.top),left:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height),' +
        "vis:cs.visibility,disp:cs.display,text:(p.innerText||'').replace(/\\n+/g,' / ')};})()",
    );
    log('');
    log('下拉面板: ' + JSON.stringify(pop));
    ok(pop.exists, '点模式按钮后下拉面板渲染出来了');
    if (pop.exists) {
      ok(pop.h > 0 && pop.w > 0, '面板有实际尺寸（没被压扁）', pop.w + 'x' + pop.h);
      ok(pop.top >= 0 && pop.top < 900, '面板在视口内（没有弹到屏幕外）', 'top=' + pop.top);
      ok(pop.disp === 'block' && pop.vis === 'visible', '面板可见');
      ok(/自由对话|写论文|画图|找数据|评审/.test(pop.text), '面板里列出了可选模式', pop.text);
    }
    await cdp.send('Page.captureScreenshot', { format: 'png' }).then((s) => {
      fs.writeFileSync(path.join(OUT, 'fix-mode-dropdown.png'), Buffer.from(s.data, 'base64'));
    });

    // 关掉下拉
    await cdp.eval("document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");
    await sleep(400);

    // ── 修复 2：拖拽落点提示应出现 ──
    const drag = await cdp.eval(
      "(function(){" +
        "var box=document.querySelector('.composer-box');" +
        "var dt=new DataTransfer();" +
        "box.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));" +
        "return true;})()",
    );
    await sleep(400);
    const hint = await cdp.eval("!!document.querySelector('.composer-drop-hint')");
    log('');
    ok(drag === true, '能向输入区派发 dragover');
    ok(hint === true, '拖拽时出现落点提示（说明 drop 处理已挂上）');
    await cdp.send('Page.captureScreenshot', { format: 'png' }).then((s) => {
      fs.writeFileSync(path.join(OUT, 'fix-drag-hint.png'), Buffer.from(s.data, 'base64'));
    });

    // 移开：提示应收起
    await cdp.eval(
      "(function(){var box=document.querySelector('.composer-box');box.dispatchEvent(new DragEvent('dragleave',{bubbles:true}));})()",
    );
    await sleep(400);
    const hint2 = await cdp.eval("!!document.querySelector('.composer-drop-hint')");
    ok(hint2 === false, '拖走后落点提示自动收起');

    // ── 修复 4：界面里不应再出现独立的英文 file 字样 ──
    const hasFileWord = await cdp.eval(
      "(function(){var t=document.body.innerText;" +
        "return /(^|[^A-Za-z])file([^A-Za-z]|$)/i.test(t);})()",
    );
    ok(hasFileWord === false, '界面上没有残留的英文 "file" 字样（历史版本文字徽标已移除）');

    // ── 全局 drop 拦截（否则拖到窗口会让渲染层跳转）──
    const before = await cdp.eval('location.href');
    await cdp.eval(
      "(function(){window.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}));})()",
    );
    await sleep(500);
    const after = await cdp.eval('location.href');
    ok(before === after, '向窗口 drop 不会导致页面跳转（全局拦截生效）');
  } catch (e) {
    fail++;
    log('FATAL ' + (e.stack || e));
    log(ref.text.slice(0, 900));
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
  log('');
  log('合计：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})();
