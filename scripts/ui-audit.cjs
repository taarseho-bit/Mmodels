/**
 * 通用双开 UI 采集驱动。
 *
 * 用法：node scripts/ui-audit.cjs <config.json>
 * config: { exe, userData, port, outDir, env?, actions: [...] }
 * action 类型：
 *   { "clickText": "设置" }           —— 点包含该文本的 button/[role]/a/div
 *   { "clickSel": ".settings-nav-item >> 外观" }  —— 在匹配 .settings-nav-item 的元素里点含"外观"的
 *   { "hoverText": "Workspace" }       —— 真实鼠标移到该元素上（触发 CSS :hover）后截图
 *   { "hoverSel": "..." , "hoverText": "..." }
 *   { "key": "Escape" }
 *   { "eval": "..." }                 —— 执行 JS，返回值不关心
 *   { "wait": 800 }
 *   { "waitForText": "个人资料", "timeout": 6000 }
 *   { "shot": "01-main" }             —— 截图到 outDir/01-main.png
 *   { "note": "xxx" }                 —— 打日志
 * 每步同时把 document.body.innerText 存 outDir/<shot>.txt（有 shot 时）。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[ui-audit]', ...a);

function waitForBrowserWs(ref, timeoutMs = 45000) {
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

const CLICK_JS = (text, exact) => `(function(){
  var want = ${JSON.stringify(text)};
  var els = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], [role="menuitem"], a, .settings-nav-item, .cz-chip, li, span, div'));
  var el = els.reverse().find(function(e){
    if (e.children.length > 6) return false;
    var t = (e.textContent || '').trim();
    return ${exact ? 't === want' : 't.includes(want)'} && e.offsetParent !== null;
  });
  if (!el) return 'no-el:' + want;
  el.click();
  return 'clicked:' + want;
})()`;

const CLICK_SEL_JS = (sel, text) => `(function(){
  var els = Array.from(document.querySelectorAll(${JSON.stringify(sel)}));
  var el = els.find(function(e){ return (e.textContent || '').includes(${JSON.stringify(text)}); });
  if (!el) return 'no-el';
  el.click();
  return 'clicked';
})()`;

/** 按文本找最合适的可点元素并返回其中心坐标（真实鼠标事件用）；scope 限定搜索范围 */
const FIND_RECT_JS = (text, exact, scope) => `(function(){
  var want = ${JSON.stringify(text)};
  var root = ${scope ? `document.querySelector(${JSON.stringify(scope)}) || document` : 'document'};
  var els = Array.from(root.querySelectorAll('button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], a, label, li, div, span'));
  var cands = els.filter(function(e){
    var t = (e.textContent || '').trim();
    if (!(${exact ? 't === want' : 't.includes(want)'})) return false;
    var r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var st = getComputedStyle(e);
    if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) < 0.2) return false;
    if (r.x < 0 || r.y < 0 || r.x > innerWidth || r.y > innerHeight) return false;
    if (e.querySelectorAll('*').length > 40) return false;
    return true;
  });
  if (!cands.length) return null;
  // 优先 BUTTON/A/[role=button]，再按面积最小（最贴近文本的元素）
  var rank = function(e){
    var tag = e.tagName;
    if (tag === 'BUTTON' || tag === 'A') return 0;
    var role = e.getAttribute('role');
    if (role === 'button' || role === 'tab' || role === 'menuitem' || role === 'option') return 1;
    return 2;
  };
  cands.sort(function(a,b){
    var ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    var rectA = a.getBoundingClientRect(), rectB = b.getBoundingClientRect();
    return rectA.width*rectA.height - rectB.width*rectB.height;
  });
  var el = cands[0];
  var r = el.getBoundingClientRect();
  var cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
  // 命中测试：真实鼠标点击会落到「最顶层元素」上。若命中的不是目标（或其祖先/后代），
  // 说明该元素被裁切/覆盖/布局塌陷 —— 真实点击必然失效（程序化 el.click() 却看不出来）。
  var top = document.elementFromPoint(cx, cy);
  var hitOk = !!top && (top === el || el.contains(top) || top.contains(el));
  return JSON.stringify({ x: cx, y: cy, tag: el.tagName, cls: String(el.className).slice(0, 50), txt: (el.innerText || '').slice(0, 30), hitOk: hitOk, hitCls: top ? String(top.className).slice(0, 40) : 'null' });
})()`;

(async () => {
  fs.mkdirSync(cfg.outDir, { recursive: true });
  // 清理上次崩溃留下的 profile 锁（否则 Chromium 会拒绝启动或立刻退出）
  for (const f of ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const p = path.join(cfg.userData, f);
    try { if (fs.existsSync(p)) fs.rmSync(p, { force: true }); } catch (e) { log('lock cleanup skip', f, e.message); }
  }
  const env = {};
  for (const k of Object.keys(process.env)) {
    if (/ELECTRON_RUN_AS_NODE|NODE_OPTIONS/i.test(k)) continue;
    env[k] = process.env[k];
  }
  if (cfg.env) Object.assign(env, cfg.env);

  const child = spawn(
    cfg.exe,
    [`--remote-debugging-port=${cfg.port}`, `--user-data-dir=${cfg.userData}`, '--disable-gpu', '--no-sandbox'],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const textRef = { text: '', exited: false, code: null };
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => (textRef.text += d.toString()));
  child.on('exit', (code) => { textRef.exited = true; textRef.code = code; });

  const wsUrl = await waitForBrowserWs(textRef);
  const cdp = await connect(wsUrl);

  // 轮询等窗口 target 出现（应用约定启动后可能先做鉴权/迁移，窗口晚于 DevTools 端点）
  let targetInfos = [];
  for (let i = 0; i < 60; i++) {
    const r = await cdp.send('Target.getTargets');
    targetInfos = r.targetInfos || [];
    if (targetInfos.some((t) => t.type === 'page' || t.type === 'webview' || t.type === 'other')) break;
    if (textRef.exited) {
      throw new Error(`应用已退出（code=${textRef.code}）。stderr 末尾：${textRef.text.slice(-800)}`);
    }
    await sleep(1000);
  }
  log('targets:', JSON.stringify(targetInfos.map((t) => ({ type: t.type, url: (t.url || '').slice(0, 60), title: (t.title || '').slice(0, 40) })), null, 1));
  const page =
    targetInfos.find((t) => t.type === 'page' && !/devtools/.test(t.url)) ??
    targetInfos.find((t) => t.type === 'page') ??
    targetInfos.find((t) => t.type === 'webview') ??
    targetInfos.find((t) => t.type === 'other');
  if (!page) throw new Error('找不到可用 target。stderr 末尾：' + textRef.text.slice(-800));
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  /**
   * ⚠️ 看门狗：任何一次 CDP 调用都可能永久挂住（页面重载后旧执行上下文、渲染进程卡住、
   * 截图等待合成帧……实测出现过整轮采集 15 分钟只拍到 1 张）。这里统一加超时：
   * 超时的调用 resolve 成 `{__timeout: true}`，让流程继续走下一步，而不是整轮卡死。
   */
  const CALL_TIMEOUT_MS = 20000;
  let timeoutCount = 0;
  const rawSend = (method, params = {}) => cdp.send(method, params, sessionId);
  const send = (method, params = {}) => {
    let timer = null;
    return new Promise((resolve) => {
      // ⚠️ 真响应到了必须 clearTimeout，否则每个调用的定时器都会在 20s 后打一条**假超时**日志
      timer = setTimeout(() => {
        timeoutCount++;
        log(`⏱ CDP 真超时（${CALL_TIMEOUT_MS}ms）：${method} —— 已跳过，继续后续步骤`);
        resolve({ __timeout: true });
      }, CALL_TIMEOUT_MS);
      Promise.resolve(rawSend(method, params)).then(
        (v) => {
          if (timer) clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          if (timer) clearTimeout(timer);
          log(`⚠️ CDP 调用失败：${method} —— ${String(e && e.message).slice(0, 120)}`);
          resolve({ __error: true });
        },
      );
    });
  };

  await send('Page.enable');
  await send('Runtime.enable');
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (!r || r.__timeout) return 'EVAL_TIMEOUT';
    if (r.exceptionDetails) return 'JS_ERR:' + (r.exceptionDetails.exception?.description || '').slice(0, 200);
    return r.result?.value;
  };
  const crypto = require('node:crypto');
  let lastHash = null;
  /** 页面文本指纹（用于「点击是否真的改变了页面」断言） */
  let textHash = null;
  const snapshotText = async () => {
    const t = await evalJs(`document.body.innerText`);
    textHash = crypto.createHash('md5').update(String(t)).digest('hex').slice(0, 10);
    return textHash;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (!r || r.__timeout || !r.data) {
      log('⚠️ 截图失败/超时，跳过 →', name);
      return;
    }
    const buf = Buffer.from(r.data, 'base64');
    const hash = crypto.createHash('md5').update(buf).digest('hex').slice(0, 10);
    fs.writeFileSync(path.join(cfg.outDir, name + '.png'), buf);
    const text = await evalJs(`document.body.innerText.slice(0, 8000)`);
    if (typeof text === 'string') fs.writeFileSync(path.join(cfg.outDir, name + '.txt'), text);
    const dup = lastHash === hash ? '  ⚠️ 与上一张完全相同（点击可能未生效！）' : '';
    lastHash = hash;
    log('shot →', name, `[${hash}]${dup}`);
  };

  // 等应用就绪
  let ready = false;
  for (let i = 0; i < 50; i++) {
    const ok = await evalJs(`!!document.body && document.body.innerText.length > 30`);
    if (ok === true) { ready = true; break; }
    await sleep(300);
  }
  log('ready =', ready);
  await sleep(1200);

  // ⚠️ 崩溃检测：React 错误边界或 Electron 崩溃页 —— 防止把白屏/报错页当正常页面截下去
  const crash = await evalJs(
    `(function(){var t=document.body?document.body.innerText:'';var m=/界面出现异常|Something went wrong|Uncaught|ReferenceError|TypeError:/.exec(t);return m?m[0]+' :: '+(t.match(/[A-Za-z]*Error: [^\\n]{0,120}/)||[''])[0]:''})()`,
  );
  if (crash) {
    log('🛑 检测到界面崩溃/错误边界 →', String(crash).slice(0, 200));
    throw new Error('界面处于错误状态，采集结果不可信：' + String(crash).slice(0, 200));
  }

  // 自动关掉首屏可能自动弹出的浮层（引导巡览 / 首次运行向导 / 更新日志），
  // 否则 modal-backdrop 会盖住整个界面，真实鼠标点击全部命中到 backdrop。
  for (let i = 0; i < 2; i++) {
    const hasBackdrop = await evalJs(`!!document.querySelector('.modal-backdrop, [role="dialog"], .tour-overlay')`);
    if (!hasBackdrop) break;
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    log('自动关闭首屏浮层（Escape）');
    await sleep(600);
  }

  /**
   * 关闭当前弹层。有些弹层不响应 Escape（只有点背景才关），所以：
   *   ① 先按真实 Escape；② 若仍有 `.modal-backdrop`，就在左上/左下角发一次真实点击（落在背景上）。
   * `与 ready 阶段共用，也可作为 action：{ "dismissModal": true }`
   */
  const dismissModal = async (label) => {
    for (let i = 0; i < 3; i++) {
      const has = await evalJs(`!!document.querySelector('.modal-backdrop')`);
      if (!has) return true;
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await sleep(400);
      if (!(await evalJs(`!!document.querySelector('.modal-backdrop')`))) return true;
      const vh = await evalJs(`window.innerHeight`);
      const y = Math.max(4, Math.round((vh || 800) - 8));
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 6, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 6, y, button: 'left', clickCount: 1 });
      await sleep(400);
    }
    const still = await evalJs(`!!document.querySelector('.modal-backdrop')`);
    log(`dismissModal(${label}) → ${still ? '⚠️ 仍有遮罩未关闭' : '已关闭'}`);
    return !still;
  };

  for (const [i, act] of (cfg.actions || []).entries()) {
    const tag = `${String(i).padStart(2, '0')}`;
    try {
      /** 拖拽文件到界面（CDP Input.dispatchDragEvent，带真实磁盘路径的 files 列表） */
      if (act.dragFiles) {
        const raw = await evalJs(
          `(function(){var el=document.querySelector(${JSON.stringify(act.dragFiles.sel)}); if(!el) return 'no-el'; var r=el.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)})})()`,
        );
        if (!raw || typeof raw !== 'string' || !raw.startsWith('{')) {
          log('dragFiles ✗ 找不到落点:', act.dragFiles.sel);
        } else {
          const pos = JSON.parse(raw);
          const data = { items: [], files: act.dragFiles.files, dragOperationsMask: 1 };
          await send('Input.dispatchDragEvent', { type: 'dragEnter', x: pos.x, y: pos.y, data });
          await send('Input.dispatchDragEvent', { type: 'dragOver', x: pos.x, y: pos.y, data });
          await sleep(250);
          await send('Input.dispatchDragEvent', { type: 'drop', x: pos.x, y: pos.y, data });
          log('dragFiles →', (act.dragFiles.files || []).map((f) => f.split(/[\\/]/).pop()).join(', '), '@', pos.x + ',' + pos.y);
        }
      }
      /** 右键点击（触发上下文菜单）：按文本找元素 → 在中心发真实右键 */
      if (act.rightClickText) {
        const raw = await evalJs(FIND_RECT_JS(act.rightClickText, act.exact === true, act.scope));
        if (!raw || typeof raw !== 'string' || !raw.startsWith('{')) {
          log('rightClickText ✗ 找不到元素:', act.rightClickText);
        } else {
          const pos = JSON.parse(raw);
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y });
          await sleep(120);
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'right', clickCount: 1 });
          await sleep(80);
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'right', clickCount: 1 });
          log(`rightClickText ✓ "${act.rightClickText}" @(${pos.x},${pos.y}) <${pos.tag}> ${pos.txt}`);
        }
      }
      /**
       * 只悬停不点击：给「hover 才出现」的元素用（CSS `:hover` 必须靠真实鼠标移动触发，
       * 合成 mouseover 事件不生效），悬停后通常紧跟一个 `shot`。
       */
      if (act.hoverText) {
        const raw = await evalJs(FIND_RECT_JS(act.hoverText, act.exact === true, act.scope));
        if (!raw || typeof raw !== 'string' || !raw.startsWith('{')) {
          log('hoverText ✗ 找不到元素:', act.hoverText);
        } else {
          const pos = JSON.parse(raw);
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y });
          await sleep(act.hoverWait ?? 300);
          const hovered = await evalJs(`(function(){
            var el = document.elementFromPoint(${pos.x}, ${pos.y});
            if (!el) return 'none';
            var row = el.closest('.rail-sub-row') || el.closest('.file-row') || el;
            return JSON.stringify({
              on: (el.matches(':hover') ? 1 : 0),
              showing: row.querySelectorAll('button').length,
              visible: Array.from(row.querySelectorAll('button')).filter(function(b){return b.offsetParent !== null && b.getBoundingClientRect().width > 0}).length
            });
          })()`);
          log(`hoverText ✓ "${act.hoverText}" @(${pos.x},${pos.y}) <${pos.tag}> →`, hovered);
        }
      }
      /** 往输入框键入文本（走 React 原生 setter + input 事件，再补一次真实 Enter） */
      if (act.typeText) {
        const ok = await evalJs(`(function(){
          var el = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]') || document.querySelector('input[type=text]');
          if (!el) return 'no-input';
          el.focus();
          if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            setter.call(el, ${JSON.stringify(act.typeText)});
          } else {
            el.textContent = ${JSON.stringify(act.typeText)};
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return 'typed:' + (el.value !== undefined ? el.value.length : el.textContent.length);
        })()`);
        log('typeText →', ok);
      }
      /** 真实回车（发送） */
      if (act.pressEnter) {
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
        await send('Input.dispatchKeyEvent', { type: 'char', text: '\r' });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
        log('pressEnter(real)');
      }
      if (act.note) log('note:', act.note);
      /** 关闭当前弹层（Escape 关不掉的会点背景）—— 拍完浮层后必须调用，否则遮罩会吞掉后续点击 */
      if (act.dismissModal) await dismissModal(String(i));
      /** 真实按键事件（Radix 等只认真实 Input 事件，合成 KeyboardEvent 无效） */
      if (act.pressKey) {
        const keyMap = { Escape: { code: 'Escape', vk: 27 }, Enter: { code: 'Enter', vk: 13 } };
        const k = keyMap[act.pressKey] || { code: act.pressKey, vk: 0 };
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: act.pressKey, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: act.pressKey, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk });
        log('pressKey(real)', act.pressKey);
      }
      /** 记录当前页面文本指纹 */
      if (act.snapshot) log('snapshot', await snapshotText());
      /** 与上一次 snapshot 对比，页面没变就告警（防"点了没生效"） */
      if (act.assertChanged) {
        const before = textHash;
        const after = await snapshotText();
        log(after !== before ? `assertChanged ✓ (${before} → ${after})` : `assertChanged ⚠️ 页面文本未变化（${after}）——点击可能未生效`);
      }
      if (act.clickText) log(await evalJs(CLICK_JS(act.clickText, act.exact === true)));
      else if (act.mouseText) {
        // 真实鼠标事件（Radix / Tailwind 菜单必须走 pointer 事件才响应）
        const raw = await evalJs(FIND_RECT_JS(act.mouseText, act.exact === true, act.scope));
        if (!raw || typeof raw !== 'string' || raw.startsWith('JS_ERR')) {
          log('mouseText ✗ 找不到元素:', act.mouseText);
        } else {
          const pos = JSON.parse(raw);
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y });
          await sleep(120);
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
          await sleep(60);
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
          if (pos.hitOk === false) {
            log(`mouseText ⚠️ 命中测试失败 "${act.mouseText}" @(${pos.x},${pos.y}) 命中的是 <${pos.hitCls}> —— 元素被裁切/覆盖/布局塌陷，真实点击无效！已回退为程序化点击`);
            await evalJs(`(function(){var el=Array.from(document.querySelectorAll('button,a,[role=button]')).find(function(e){return (e.textContent||'').includes(${JSON.stringify(act.mouseText)}) && e.offsetParent!==null}); if(el) el.click(); return 'fallback'})()`);
          } else {
            log(`mouseText ✓ "${act.mouseText}" @(${pos.x},${pos.y}) <${pos.tag}> ${pos.txt}`);
          }
        }
      } else if (act.clickSel) log(await evalJs(CLICK_SEL_JS(act.clickSel[0], act.clickSel[1])));
      else if (act.clickNth) {
        log('clickNth', await evalJs(`(function(){
          var els = Array.from(document.querySelectorAll(${JSON.stringify(act.clickNth.sel)}));
          var idx = ${act.clickNth.index};
          var el = idx < 0 ? els[els.length + idx] : els[idx];
          if (!el) return 'no-el#' + idx;
          el.click();
          return 'clicked#' + idx;
        })()`));
      } else if (act.clickXY) {
        const [x, y] = act.clickXY;
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        log('clickXY', x, y);
      } else if (act.key) log('key', await evalJs(`(function(){document.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(act.key)}, bubbles:true})); return 'sent'})()`));
      else if (act.eval) {
        const v = await evalJs(act.eval);
        const sv = typeof v === 'string' ? v : JSON.stringify(v);
        if (sv && sv.length > 200) {
          const f = path.join(cfg.outDir, `eval-${String(i).padStart(2, '0')}.txt`);
          fs.writeFileSync(f, sv);
          log('eval → 结果已写入', path.basename(f), `(${sv.length} 字符)`);
        } else {
          log('eval →', sv);
        }
      }
      if (act.waitForText) {
        let ok = false;
        for (let k = 0; k < Math.ceil((act.timeout || 6000) / 300); k++) {
          const v = await evalJs(`document.body.innerText.includes(${JSON.stringify(act.waitForText)})`);
          if (v === true) { ok = true; break; }
          await sleep(300);
        }
        log('waitForText', act.waitForText, '→', ok);
      }
      if (act.wait) await sleep(act.wait);
      if (act.expectText) {
        const ok = await evalJs(`document.body.innerText.includes(${JSON.stringify(act.expectText)})`);
        log(ok === true ? `expectText ✓ "${act.expectText}"` : `expectText ⚠️ 未出现: "${act.expectText}"`);
      }
      if (act.shot) await shot(act.shot);
    } catch (e) {
      log('step', tag, 'error:', e.message);
    }
  }

  cdp.close();
  child.kill();
  process.exit(0);
})().catch((e) => {
  console.error('[ui-audit] FATAL', e);
  process.exit(1);
});
