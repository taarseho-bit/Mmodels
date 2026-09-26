/**
 * **真实应用测试**：驱动打包后的 MModels.exe（不是桩环境）。
 *
 * 与其他验证脚本的区别：
 *   - 冒烟/截图脚本跑的是「源码产物 + 假 IPC」—— 只验渲染层，验不到打包后的真实链路
 *   - 这个脚本启动 **dist/win-unpacked/MModels.exe**，走**真实主进程**：
 *     真数据库、真文件系统、真 IPC、真 skill 扫描、真 git 层、真环境探测
 *
 * 原理：Electron 支持 `--remote-debugging-port`，用 CDP 驱动真实应用。
 *
 * ⚠️ 两个踩过的坑：
 *   1. **不能用 HTTP 的 `/json/list`** —— Chromium 150 起该端点不再响应
 *      （端口在 listen，但 HTTP 请求没回，表现为「连不上」）。
 *      改为从子进程 stderr 的 `DevTools listening on ws://…` 拿 **browser 级** ws 地址，
 *      再用 `Target.getTargets` + `Target.attachToTarget` 拿到页面会话。
 *   2. **本文件里不要写正则反斜杠与模板字面量** —— 之前用脚本改这个文件时，
 *      反斜杠被吃掉了三次（`\/` 变 `/`、`\n` 变真换行），每次都是语法错误。
 *      需要的字符串一律用 `split` 之类的无转义写法。
 *
 * ⚠️ 隔离：用独立的 `--user-data-dir`，不碰用户真实数据。
 *
 * 用法：node scripts/test-real-app.cjs
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = 'D:/mathmodel-desktop';
const APP = process.env.MATHMODEL_TEST_APP || path.join(ROOT, 'dist', 'win-unpacked', 'MModels.exe');
const PORT = 9333;
// 每轮使用独立 userData；Portable 外壳异常退出时，旧进程也不会抢走新一轮的单实例锁。
const SANDBOX = path.join(os.tmpdir(), 'mm-real-test-' + process.pid);
const USER_DATA = path.join(SANDBOX, 'userdata');
const PROJECT_DIR = path.join(SANDBOX, 'project');
const LOGFILE = path.join(ROOT, 'out', 'real-app-test.txt');

const out = [];
let fails = 0;
const log = (m) => {
  out.push(String(m));
  console.log(String(m));
  // 逐行落盘：脚本卡住时也能看到停在哪一步
  try {
    fs.writeFileSync(LOGFILE, out.join('\n'), 'utf8');
  } catch {
    /* 忽略 */
  }
};
const ok = (cond, label) => {
  if (!cond) fails++;
  log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForChildExit(child, timeoutMs = 12000) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', () => finish(true));
  });
}

/** 从 stderr 或 Chromium 的 DevToolsActivePort 文件等 browser 级 ws 地址。 */
function waitForBrowserWs(ref, timeoutMs = 40000) {
  const MARK = 'DevTools listening on ';
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const i = ref.text.indexOf(MARK);
      if (i >= 0) {
        const rest = ref.text.slice(i + MARK.length);
        const url = rest.split(/\s/)[0];
        if (url) return resolve(url);
      }
      // electron-builder 的 portable 外壳会吞掉已解压子进程的 stderr，端口文件仍可靠可用。
      try {
        const portFile = path.join(USER_DATA, 'DevToolsActivePort');
        if (fs.existsSync(portFile)) {
          const parts = fs.readFileSync(portFile, 'utf8').trim().split(/\s+/);
          if (parts[0] && parts[1]) return resolve('ws://127.0.0.1:' + parts[0] + parts[1]);
        }
      } catch {
        /* 文件可能正在写入，下一轮重试 */
      }
      if (Date.now() - t0 > timeoutMs) return reject(new Error('等 DevTools ws 地址超时'));
      setTimeout(tick, 300);
    };
    tick();
  });
}

/** 极简 CDP 客户端：连 browser ws，用 sessionId 操作页面 target */
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
    ws.on('open', () => {
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
            throw new Error(
              (d.exception && d.exception.description) || d.text || 'JS 执行异常',
            );
          }
          return r.result && r.result.value;
        },
        close() {
          ws.close();
        },
      });
    });
  });
}

async function main() {
  log('════ 真实应用测试：驱动打包产物 ════');
  log('');

  if (!fs.existsSync(APP)) {
    log('✗ 找不到打包产物：' + APP);
    log('  先运行 npm run pack:dir');
    process.exit(1);
  }
  log('应用: ' + APP);
  log('体积: ' + (fs.statSync(APP).size / 1048576).toFixed(0) + ' MB');

  try {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  } catch {
    /* 被占用就继续 */
  }
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.mkdirSync(PROJECT_DIR, { recursive: true });
  log('沙箱: ' + SANDBOX);

  // 清掉会干扰的环境变量（ELECTRON_RUN_AS_NODE 会让 electron 退化成普通 Node）
  const env = {};
  for (const k of Object.keys(process.env)) {
    if (/ELECTRON_RUN_AS_NODE|SAFE_DELETE|NODE_OPTIONS/i.test(k)) continue;
    env[k] = process.env[k];
  }
  env.NODE_OPTIONS = '';
  // 开 E2E 模式：默认项目落 userData 而非用户主目录，避免污染真实工作区
  env.MATHMODEL_E2E = '1';

  const child = spawn(
    APP,
    [
      ...(process.env.MATHMODEL_TEST_ENTRY ? [process.env.MATHMODEL_TEST_ENTRY] : []),
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + USER_DATA,
      '--disable-gpu',
      '--no-sandbox',
    ],
    {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // 不允许打包应用从仓库 cwd 借用 resources/。这样 Portable 漏资源会
      // 在验收中直接失败，而不是被开发目录里的模板、技能和算法假装通过。
      cwd: SANDBOX,
    },
  );

  const stderrRef = { text: '' };
  child.stderr.on('data', (d) => {
    stderrRef.text += d.toString();
  });
  child.stdout.on('data', () => {});

  let browserWs = '';
  try {
    browserWs = await waitForBrowserWs(stderrRef);
    log('✓ DevTools 已就绪');
  } catch (e) {
    log('✗ ' + e.message);
    log('  stderr:\n' + stderrRef.text.slice(0, 1200));
    try {
      child.kill();
    } catch {
      /* 忽略 */
    }
    process.exit(1);
  }

  const cdp = await connect(browserWs);

  let pageTarget = null;
  let pageTargets = [];
  let petSessionId = null;
  for (let i = 0; i < 50; i++) {
    const r = await cdp.send('Target.getTargets');
    const infos = (r && r.targetInfos) || [];
    pageTargets = infos.filter((t) => t.type === 'page' && t.url.indexOf('devtools://') !== 0);
    // 桌面小模也是 page target；真实应用测试必须明确连接主窗口。
    pageTarget = pageTargets.find((t) => t.url.indexOf('window=desktop-pet') < 0);
    if (pageTarget) break;
    await sleep(400);
  }
  if (!pageTarget) {
    log('✗ 没找到页面 target');
    try {
      child.kill();
    } catch {
      /* 忽略 */
    }
    process.exit(1);
  }

  const att = await cdp.send('Target.attachToTarget', {
    targetId: pageTarget.targetId,
    flatten: true,
  });
  cdp.sessionId = att.sessionId;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  log('✓ 已 attach 真实页面');
  log('  URL: ' + String(pageTarget.url).slice(0, 90));
  const petTarget = pageTargets.find((t) => t.url.indexOf('window=desktop-pet') >= 0);
  ok(
    !!petTarget,
    '桌面小模使用独立透明窗口运行',
  );
  if (petTarget) {
    const petAttachment = await cdp.send('Target.attachToTarget', {
      targetId: petTarget.targetId,
      flatten: true,
    });
    petSessionId = petAttachment.sessionId;
    await cdp.send('Runtime.enable', {}, petSessionId);
    await cdp.send('Page.enable', {}, petAttachment.sessionId);
    await sleep(500);
    const petShot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    }, petAttachment.sessionId);
    fs.writeFileSync(path.join(ROOT, 'out', 'real-app-desktop-pet.png'), Buffer.from(petShot.data, 'base64'));
    log('✓ 桌面小模截图已保存: out/real-app-desktop-pet.png');
  }
  log('');

  // ── 等界面挂载 ──
  let mounted = false;
  for (let i = 0; i < 40; i++) {
    const t = await cdp.eval('document.body.textContent.length');
    if (t > 80) {
      mounted = true;
      break;
    }
    await sleep(500);
  }
  ok(mounted, '界面已挂载');

  // ── 1. 运行时（验证真的是打包后的 Electron 43） ──
  const info = await cdp.eval(
    `(function(){
      var ua = navigator.userAgent;
      return {
        electron: (ua.split('Electron/')[1] || '').split(' ')[0],
        chrome: (ua.split('Chrome/')[1] || '').split(' ')[0],
        hasApi: typeof window.mathmodel === 'object',
        apiKeys: window.mathmodel ? Object.keys(window.mathmodel).sort() : [],
        textLen: document.body.textContent.length,
        title: document.title,
      };
    })()`,
  );
  log('运行时: Electron ' + info.electron + ' / Chrome ' + info.chrome);
  log('preload API: ' + info.apiKeys.join(', '));
  ok(info.hasApi, 'preload 注入成功（真实 contextBridge）');
  ok(String(info.electron).indexOf('43') === 0, '运行的是 Electron 43（' + info.electron + '）');
  ok(info.apiKeys.length >= 18, 'API 命名空间 ' + info.apiKeys.length + ' 个 >= 18');
  log('');

  // ── 2. 真实主进程通道 ──
  const mp = await cdp.eval(
    `(async function(){
      var r = {};
      var f = async function(name, fn) { try { r[name] = await fn(); } catch (e) { r[name + 'Err'] = String(e && e.message || e); } };
      await f('version', function(){ return window.mathmodel.app.version(); });
      await f('projects', async function(){ return (await window.mathmodel.project.list()).length; });
      await f('defaultId', function(){ return window.mathmodel.project.defaultId(); });
      await f('current', async function(){ var p = await window.mathmodel.project.current(); return p ? p.name + ' @ ' + p.root : null; });
      await f('skills', async function(){ return (await window.mathmodel.skill.list()).length; });
      await f('presets', async function(){ return (await window.mathmodel.llm.presets()).length; });
      await f('templates', async function(){ return (await window.mathmodel.paper.templates()).templates.length; });
      await f('algorithms', async function(){ return (await window.mathmodel.algorithms.list()).algorithms.length; });
      await f('environment', async function(){
        var result = await window.mathmodel.env.check();
        return { count: result.items.length, drawio: result.items.find(function(item){ return item.id === 'drawio'; }) || null };
      });
      await f('git', function(){ return window.mathmodel.git.info(); });
      return r;
    })()`,
  );
  log('真实主进程调用（不是桩）：');
  log('  app.version    : ' + JSON.stringify(mp.version));
  log('  project.list   : ' + mp.projects + ' 个');
  log('  project.default: ' + JSON.stringify(mp.defaultId));
  log('  project.current: ' + JSON.stringify(mp.current));
  log('  skill.list     : ' + mp.skills + ' 个（真实读盘）');
  log('  llm.presets    : ' + mp.presets + ' 个');
  log('  paper.templates: ' + mp.templates + ' 套（真实读 resources）');
  log('  algorithms.list : ' + mp.algorithms + ' 个（真实读 resources）');
  log('  env.check      : ' + mp.environment.count + ' 项（真实探测本机）');
  log('  draw.io        : ' + JSON.stringify(mp.environment.drawio));
  log('  git.info       : ' + JSON.stringify(mp.git));
  ok(!mp.versionErr, 'app.version 可用');
  ok(mp.projects >= 1, '首次启动已播种默认项目（' + mp.projects + ' 个）');
  ok(!!mp.defaultId, '默认项目 id 可读（' + mp.defaultId + '）');
  ok(!!mp.current, '当前项目已认领');
  ok(mp.skills > 0, '技能扫描返回结果');
  ok(mp.presets > 0, 'LLM 预设返回结果');
  ok(mp.templates > 0, '论文模板扫描返回结果');
  ok(mp.algorithms > 0, '算法目录扫描返回结果');
  ok(mp.environment.count > 0, '环境检测返回结果');
  ok(
    mp.environment.drawio && mp.environment.drawio.status === 'ok',
    'draw.io 标准安装目录可识别',
  );
  log('');

  // ── 3. 真实数据库（better-sqlite3 在打包后能用吗） ──
  if (process.env.MATHMODEL_TEST_CORE_ONLY === '1') {
    if (process.env.MATHMODEL_TEST_SIDEBAR_UI === '1') {
      const click = async selector => { await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(180); };
      const size = async (selector, axis = 'width') => cdp.eval(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().${axis}`);
      const dragPane = async (label, dx, dy) => {
        const box = await cdp.eval(`document.querySelector('[role="separator"][aria-label="${label}"]').getBoundingClientRect().toJSON()`);
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        for (let i = 1; i <= 5; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx * i / 5, y: y + dy * i / 5, button: 'left', buttons: 1 }); await sleep(40); }
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', clickCount: 1 });
        await sleep(150);
        log(label + ': ' + JSON.stringify(await cdp.eval(`(()=>{const h=document.querySelector('[role="separator"][aria-label="${label}"]'); return {size:h.parentElement.getBoundingClientRect().toJSON(),value:h.getAttribute('aria-valuenow'),style:h.parentElement.getAttribute('style')};})()`)));
      };
      await cdp.eval(`window.dispatchEvent(new CustomEvent('mm:open-route',{detail:{route:'chat'}}))`); await sleep(350);
      await cdp.eval('window.__sidebarDraftNode=document.querySelector(".composer-input"); true');
      await cdp.eval('document.querySelector(".composer-input").focus()');
      await cdp.send('Input.insertText', { text: '布局调整保留草稿' });
      await dragPane('调整左侧栏宽度', 55, 0);
      const wide = await size('.sidebar');
      ok(wide > 260, '左侧栏向右拖动变宽');
      await click('[data-sidebar-toggle]');
      ok(await size('.sidebar') === 64, '收起后使用64像素独立图标栏');
      ok(await cdp.eval('document.querySelector(".composer-input")===window.__sidebarDraftNode && window.__sidebarDraftNode.value.includes("布局调整保留草稿")'), '拖动和折叠不卸载输入框，不丢草稿');
      ok(await cdp.eval(`(()=>{const side=document.querySelector('.sidebar').getBoundingClientRect();return [...document.querySelectorAll('.sidebar button')].filter(b=>b.getBoundingClientRect().width>0).every(b=>{const r=b.getBoundingClientRect();return b.title && r.left>=side.left && r.right<=side.right && r.width>=30;});})()`), '窄栏所有可见按钮都有悬停说明，图标不被裁切');
      ok(await cdp.eval('!document.querySelector(".sidebar [data-missing-icon]")'), '所有侧栏图标均有实际图形');
      await click('.rail-nav [data-route="papers"]');
      ok(await cdp.eval('!!document.querySelector(".studio-papers") || document.body.innerText.includes("尚未添加论文")'), '收起状态可直接进入论文库');
      await click('.rail-nav [data-route="chat"]');
      await click('.rail-search-trigger');
      ok(await cdp.eval('!document.querySelector(".sidebar.collapsed") && document.querySelector(".rail-search input")===document.activeElement'), '收起状态点击搜索可展开并聚焦');
      await click('[data-sidebar-toggle]');
      await click('.rail-compact-projects [aria-label="工作项目"]');
      ok(await cdp.eval('!!document.querySelector(".rail-project-section.is-open") && !document.querySelector(".sidebar.collapsed")'), '收起状态可展开项目列表');
      const projectBefore = await size('.rail-project-section', 'height');
      await dragPane('调整项目列表高度', 0, 35);
      ok(await size('.rail-project-section', 'height') > projectBefore, '项目列表可上下调整高度');
      await click('[data-sidebar-toggle]'); await click('[data-sidebar-toggle]');
      ok(Math.abs(await size('.sidebar') - wide) < 2, '重新展开恢复用户宽度');
      await click('.studio-panel-toggle');
      if (await cdp.eval('!document.querySelector(".sidepanel")')) await click('.studio-panel-toggle');
      const rightBefore = await size('.sidepanel');
      await dragPane('调整右侧面板宽度', -45, 0);
      ok(await size('.sidepanel') > rightBefore, '右侧面板向左拖动变宽，方向不再反转');
      const treeBefore = await size('.sidepanel .fp-tree-region', 'height');
      await dragPane('调整文件列表高度', 0, 40);
      ok(await size('.sidepanel .fp-tree-region', 'height') > treeBefore, '文件列表与下方预览之间可以上下拖动');
      await click('.studio-panel-toggle');
      const inputBefore = await size('.composer-input-region', 'height');
      await dragPane('调整输入区高度', 0, -55);
      ok(await size('.composer-input-region', 'height') > inputBefore, '输入区上缘向上拖动增高');
      await cdp.eval('document.querySelector(".composer-input").focus()');
      await cdp.send('Input.insertText', { text: '继续输入' });
      ok(await cdp.eval('document.querySelector(".composer-input").value.includes("继续输入") && !document.querySelector(".pane-drag-shield")'), '拖动结束恢复正常输入，没有遗留透明遮罩');
      await cdp.eval('document.querySelector("[aria-label=调整输入区高度]").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');
      ok(await cdp.eval('!document.querySelector(".composer-input-region").style.getPropertyValue("--pane-height")'), '双击恢复输入区自动高度');
      await click('[aria-label="更多任务操作"]');
      await cdp.eval('[...document.querySelectorAll(".studio-task-menu button")].find(b=>b.textContent.includes("编辑器视图")).click()'); await sleep(250);
      const filesBefore = await size('.editorview-col');
      await dragPane('调整编辑器文件栏宽度', 35, 0);
      ok(await size('.editorview-col') > filesBefore, '编辑器文件栏可以左右调整');
      const chatBefore = await size('.editorview-chatcol');
      await dragPane('调整编辑器对话宽度', -35, 0);
      ok(await size('.editorview-chatcol') > chatBefore, '编辑器对话栏可以左右调整');
      await click('[aria-label="更多任务操作"]');
      await cdp.eval('[...document.querySelectorAll(".studio-task-menu button")].find(b=>b.textContent.includes("编辑器视图")).click()'); await sleep(200);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 980, height: 560, deviceScaleFactor: 1, mobile: false });
      await click('[data-sidebar-toggle]');
      ok(await cdp.eval(`(()=>{const b=document.querySelector('.rail-foot [aria-label="设置"]');const r=b.getBoundingClientRect();return r.bottom<=innerHeight && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b && document.documentElement.scrollWidth<=innerWidth;})()`), '矮窗口设置仍可点击，无横向溢出');
      const img = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(ROOT, 'out', 'sidebar-compact.png'), Buffer.from(img.data, 'base64'));
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      await cdp.send('Page.reload'); await sleep(1400);
      ok(await cdp.eval('!!document.querySelector(".sidebar.collapsed")'), '重载后记住侧栏收起状态');
      await click('[data-sidebar-toggle]');
      ok(Math.abs(await size('.sidebar') - wide) < 2, '重载后记住展开宽度');
      const resizeFixture = await cdp.eval(`(async()=>{const p=await window.mathmodel.project.current();return (await window.mathmodel.session.create(p.id,'工作流界面验证样例（非真实解题）')).id})()`);
      const seededResize = require('node:child_process').spawnSync(path.join(ROOT, 'node_modules/electron/dist/electron.exe'),
        [path.join(ROOT, 'scripts/seed-workflow-test.cjs'), path.join(USER_DATA, 'mmodels.db'), resizeFixture],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' }, encoding: 'utf8', windowsHide: true });
      if (seededResize.status !== 0) throw new Error(seededResize.stderr || '布局测试记录准备失败');
      await cdp.send('Page.reload'); await sleep(1400);
      await click('[title="工作流界面验证样例（非真实解题）"]');
      await click('.workflow-switch button:last-child');
      await sleep(250);
      await click('.flow-agent');
      const detailBefore = await size('.workflow-detail');
      await dragPane('调整成员详情宽度', -30, 0);
      ok(await size('.workflow-detail') > detailBefore, '成员详情可拖宽，技能列表仍可读');
      await click('[aria-label="关闭成员详情"]');
      await cdp.eval('document.querySelector("[aria-label=调整工作流画布高度]").scrollIntoView({block:"center"})');
      const canvasBefore = await size('.flow-canvas-shell', 'height');
      await dragPane('调整工作流画布高度', 0, -40);
      ok(await size('.flow-canvas-shell', 'height') < canvasBefore - 20, '工作流画布可上下调节，和画布内部平移不冲突');
      await cdp.eval(`window.mathmodel.session.remove(${JSON.stringify(resizeFixture)})`);
      await click('.rail-foot [aria-label="设置"]');
      const settingsBefore = await size('.settings-side');
      await dragPane('调整设置导航宽度', 30, 0);
      ok(await size('.settings-side') > settingsBefore, '设置页分隔栏也可拖动');
    }
    if (process.env.MATHMODEL_TEST_STUDIO_UI === '1') {
      const route = async name => { await cdp.eval(`window.dispatchEvent(new CustomEvent('mm:open-route',{detail:{route:${JSON.stringify(name)}}}))`); await sleep(450); };
      const shot = async name => {
        await sleep(350);
        await cdp.eval('document.querySelector(".studio-page")?.scrollTo(0,0)');
        const img = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(ROOT, 'out', 'studio-' + name + '.png'), Buffer.from(img.data, 'base64'));
      };
      await route('workbench');
      ok(await cdp.eval('!!document.querySelector(".studio-workbench")'), '比赛工作台真实挂载');
      ok(await cdp.eval('document.querySelectorAll(".rail-nav [data-route]").length === 3'), '主导航仅保留工作台、对话、论文库');
      await cdp.eval('document.documentElement.setAttribute("data-theme","light")');
      await shot('workbench');
      ok(await cdp.eval('!document.querySelector("input[type=datetime-local]") && !document.querySelector(".studio-workbench-more").open && !!document.querySelector(".studio-countdown")'), '工作台只突出竞赛选择和倒计时，其他功能折叠，无手填日期');
      await cdp.eval('(()=>{const s=document.querySelector("#workbench-contest");s.value="A02-2026";s.dispatchEvent(new Event("change",{bubbles:true}))})()');
      await sleep(180);
      ok(await cdp.eval('(async()=>{const p=await window.mathmodel.project.current();const s=await window.mathmodel.competition.state();return s.projects.find(v=>v.id===p.id).calendarId==="A02-2026"})()'), '选择竞赛自动保存并关联日历，无需填写时间');
      const workbench = await cdp.eval(`(async()=>{ const p=await window.mathmodel.project.current();const s=await window.mathmodel.competition.ensureProject(p.id);const d=s.projects.find(v=>v.id===p.id);d.rules='仅用于隔离测试的规则';await window.mathmodel.competition.saveProject(d);return (await window.mathmodel.competition.state()).projects.find(v=>v.id===p.id).rules;})()`);
        ok(workbench === '仅用于隔离测试的规则', '工作台使用真实主进程保存到当前项目记录');
        await cdp.eval('document.querySelector(".studio-workbench-more").open=true; document.querySelector(".studio-workbench textarea").focus()');
        await cdp.send('Input.insertText', { text: '页面切换保留草稿' });
        await route('papers');
        await route('workbench');
        ok(await cdp.eval('document.querySelector(".studio-workbench textarea").value.includes("页面切换保留草稿")'), '切换页面保留未保存草稿，不打断输入');
        await route('papers');
      ok(await cdp.eval('document.body.innerText.includes("优秀获奖论文") && document.body.innerText.includes("尚未添加论文")'), '论文库为空时不伪造论文或获奖信息');
      await shot('papers');
      await cdp.eval('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("上传优秀论文")).click()');
        ok(await cdp.eval('!!document.querySelector(".studio-import")'), '单篇/批量上传弹窗可打开');
        ok(await cdp.eval('!!document.activeElement.closest(".studio-import")'), '上传对话框打开时键盘焦点进入窗口');
      await shot('upload');
      await cdp.eval('document.querySelector("[aria-label=关闭上传窗口]").click()');
      for (const name of ['gallery', 'competitions', 'datasets', 'automation', 'extensions']) {
        await route(name);
          const rendered = await cdp.eval('(()=>{const p=document.querySelector(".settings-shell .settings-tool-content");return !!p && p.children.length>0 && p.innerText.trim().length>30 && document.querySelectorAll(".sidebar").length===0;})()');
          ok(rendered, name + ' 旧入口转到设置内，功能组件实际渲染');
      }
      await shot('settings');
        await route('chat');
        ok(await cdp.eval('!document.querySelector(".cz-head [title*=模板]")'), '论文模板不再占据主输入栏');
        await cdp.eval('[...document.querySelectorAll(".cz-btn")].find(b=>b.textContent.includes("比赛信息")).click()');
        ok(await cdp.eval('document.querySelector(".modal").innerText.includes("论文模板")'), '比赛信息中可以选择论文模板');
        await cdp.eval('document.querySelector(".modal .cz-slot .cz-btn").click()');
        const selectedTemplate = await cdp.eval('(()=>{const buttons=[...document.querySelectorAll(".cz-pop .cz-pop-item")];const next=buttons.find(b=>!b.classList.contains("active"));if(!next)return null;const r=next.getBoundingClientRect();if(!next.contains(document.elementFromPoint(r.x+12,r.y+r.height/2)))return null;const name=next.querySelector("span").textContent;next.click();return name;})()');
        await sleep(200);
        ok(selectedTemplate && await cdp.eval('document.querySelector(".modal .cz-slot .cz-btn").textContent.includes(' + JSON.stringify(selectedTemplate) + ')'), '比赛信息中的模板菜单可实际切换模板');
        await cdp.eval('document.querySelector(".modal-head button").click()');
        ok(await cdp.eval('document.querySelectorAll(".starter").length === 3 && !document.body.innerText.includes("2023 华数杯")'), '真题样例移除，保留三个通用任务起点');
        ok(await cdp.eval('document.querySelectorAll(".topbar-actions button").length === 4 && !document.querySelector(".topbar-new-chat")'), '顶栏保留视图切换、文件与更多，没有重复新任务');
        await shot('chat');
        await cdp.eval('document.querySelectorAll(".workflow-switch button")[1].click()');
        await sleep(300);
        ok(await cdp.eval('!!document.querySelector(".workflow-view") && getComputedStyle(document.querySelector(".chat-scroll")).display === "none"'), '工作流切换不卸载原对话');
        ok(await cdp.eval('document.querySelector(".workflow-view").innerText.includes("不会补造工作流")'), '没有真实记录时明确显示空状态');
        await shot('workflow-empty');
        await cdp.eval('document.querySelectorAll(".workflow-switch button")[0].click()');
        await cdp.eval('window.__workflowDraftNode = document.querySelector(".composer-input"); true');
        await cdp.eval('document.querySelectorAll(".workflow-switch button")[1].click()');
        await cdp.eval('document.querySelectorAll(".workflow-switch button")[0].click()');
        ok(await cdp.eval('window.__workflowDraftNode && document.querySelector(".composer-input") === window.__workflowDraftNode'), '切换视图保留原输入组件');
        await cdp.eval('document.querySelector("[aria-label=更多任务操作]").click()');
        ok(await cdp.eval('document.querySelectorAll(".studio-task-menu [role^=menuitem]").length === 8'), '低频功能完整收纳到更多菜单');
        await shot('task-menu');
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        ok(await cdp.eval('!document.querySelector(".studio-task-menu") && document.activeElement.getAttribute("aria-label")==="更多任务操作"'), '更多菜单可按 Escape 关闭并恢复焦点');
        await cdp.eval('document.querySelector("[aria-label=任务选项]").click()');
        ok(await cdp.eval('document.querySelector(".cz-pop")?.innerText.includes("多智能体协作") && !document.querySelector(".cz-foot").innerText.includes("小模")'), '任务选项保留规划和协作，小模不再挤占输入栏');
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 980, height: 700, deviceScaleFactor: 1, mobile: false });
        await sleep(200);
        await shot('chat-compact');
        ok(await cdp.eval('document.documentElement.scrollWidth <= innerWidth && document.querySelector(".cz-foot").scrollWidth <= document.querySelector(".cz-foot").clientWidth + 1'), '窄窗口没有页面或输入工具栏横向溢出');
        await cdp.send('Emulation.clearDeviceMetricsOverride');
        await cdp.eval('document.querySelector("[aria-label=更多任务操作]").click()');
        await cdp.eval('[...document.querySelectorAll(".studio-task-menu button")].find(b=>b.textContent.includes("运行环境设置")).click()');
        await sleep(450);
        ok(await cdp.eval('document.querySelector(".settings-nav-item.active")?.textContent.includes("运行环境")'), '运行环境入口直达设置的正确分区');
        await cdp.eval('document.documentElement.setAttribute("data-theme","dark")');
      await route('workbench'); await shot('workbench-dark');
      if (process.env.MATHMODEL_TEST_WORKFLOW_UI === '1') {
        const fixtureId = await cdp.eval(`(async()=>{const p=await window.mathmodel.project.current();await window.mathmodel.file.write('workflow-ui-sample.md','工作流界面测试文件，不是模型结果。');return (await window.mathmodel.session.create(p.id,'工作流界面验证样例（非真实解题）')).id})()`);
        const seed = require('node:child_process').spawnSync(path.join(ROOT, 'node_modules/electron/dist/electron.exe'),
          [path.join(ROOT, 'scripts/seed-workflow-test.cjs'), path.join(USER_DATA, 'mmodels.db'), fixtureId],
          { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' }, encoding: 'utf8', windowsHide: true });
        if (seed.status !== 0) throw new Error(seed.stderr || '工作流测试样例初始化失败');
        await cdp.send('Page.reload'); await sleep(1800);
        await route('chat');
        await cdp.eval('[...document.querySelectorAll("[title]")].find(e=>e.title==="工作流界面验证样例（非真实解题）").click()');
        await sleep(400);
        await cdp.eval('document.querySelectorAll(".workflow-switch button")[1].click()'); await sleep(400);
        ok(await cdp.eval('document.querySelectorAll(".workflow-node").length === 4'), '工作流从真实数据库读取四个测试成员（样例，不是模型执行）');
        ok(await cdp.eval('document.querySelector(".workflow-view").innerText.includes("3 项技能与流程")'), '按实际记录区分技能种类与工具次数');
        ok(await cdp.eval('document.querySelectorAll(".flow-edge").length === 4 && document.querySelectorAll(".flow-connections marker").length === 4'), '画布存在有向箭头与真实关系分类');
        ok(await cdp.eval('document.querySelectorAll(".flow-edge-motion").length === 2'), '只有正在工作的两个目标具有流动箭头（界面样例）');
        ok(await cdp.eval('new Set([...document.querySelectorAll(".flow-agent")].map(e=>e.style.getPropertyValue("--flow-color"))).size === 4'), '四个智能体使用不同主题颜色');
        ok(await cdp.eval('document.querySelectorAll(".flow-person").length === 4 && document.querySelectorAll(".flow-person.is-working").length === 2'), '成员有拟人头像，仅正在工作的成员有专注动作');
        await cdp.eval('document.documentElement.setAttribute("data-theme","light")'); await shot('workflow-sample-light');
        await cdp.eval('document.querySelectorAll(".workflow-node")[3].click()');
        ok(await cdp.eval('document.querySelector(".workflow-detail").innerText.includes("灵敏度核验员") && document.querySelector(".workflow-detail").innerText.includes("比赛交付核对")'), '点击中文成员查看所属技能，不混入其他成员记录');
        await cdp.eval('document.querySelector(".flow-skill-section details").open = true');
        ok(await cdp.eval('document.querySelector(".flow-skill-section code").textContent === "mathmodel:competition-audit" && document.querySelector(".flow-skill-section").innerText.includes("1 次")'), '点击成员后展示准确 Skill 标识、中文名及调用次数');
        ok(await cdp.eval('(()=>{const a=document.querySelector(".workflow-detail").getBoundingClientRect(),b=document.querySelector(".flow-canvas-shell").getBoundingClientRect();return a.left>=b.right-1 || a.top>=b.bottom-1})()'), '成员详情与画布分开布局，不遮住其他成员');
        await shot('workflow-skill-detail');
        await cdp.eval('document.querySelector("[aria-label=关闭成员详情]").click()');
        await cdp.eval('document.documentElement.setAttribute("data-theme","dark")'); await shot('workflow-sample-dark');
        const oldZoom = await cdp.eval('parseInt(document.querySelector(".flow-zoom-level").innerText)');
        await cdp.eval('document.querySelector("[aria-label=放大画布]").click()');
        await sleep(100);
        ok(await cdp.eval('parseInt(document.querySelector(".flow-zoom-level").innerText)') > oldZoom, '画布支持缩放，手动缩放后关闭自动跟随');
        const pan = await cdp.eval('(()=>{const r=document.querySelector(".flow-viewport").getBoundingClientRect();return {x:r.x+25,y:r.y+25,tx:document.querySelector(".flow-world").getBoundingClientRect().x}})()');
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pan.x, y: pan.y, button: 'left', buttons: 1, clickCount: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pan.x + 60, y: pan.y + 25, button: 'left', buttons: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pan.x + 60, y: pan.y + 25, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(100);
        const moved = await cdp.eval('document.querySelector(".flow-world").getBoundingClientRect().x');
        log('画布拖动：' + JSON.stringify({ before: pan.tx, after: moved, expectedDelta: 60 }));
        ok(Math.abs(moved - pan.tx - 60) < 2, '拖动空白处向右移动，画布同方向平移且无坐标累积漂移');
        const wheelBefore = await cdp.eval('parseInt(document.querySelector(".flow-zoom-level").innerText)');
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pan.x + 100, y: pan.y + 100, deltaX: 0, deltaY: -100 });
        await sleep(120);
        ok(await cdp.eval('parseInt(document.querySelector(".flow-zoom-level").innerText)') > wheelBefore, '鼠标滚轮实际放大画布');
        await cdp.eval('[...document.querySelectorAll(".flow-toolbar button")].find(b=>b.textContent==="收起已结束").click()');
        ok(await cdp.eval('document.querySelectorAll(".flow-agent.is-folded").length === 2 && document.querySelectorAll(".flow-agent").length === 4'), '已结束成员可收起但不删除，工作中的成员仍展开');
        await cdp.eval('[...document.querySelectorAll(".flow-toolbar button")].find(b=>b.textContent==="展开已结束").click()');
        await cdp.eval('document.querySelector("[aria-label=适应画布]").click()');
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        ok(await cdp.eval('getComputedStyle(document.querySelector(".flow-edge-motion")).animationName === "none"'), '减少动态效果设置会关闭流动动画');
        await cdp.send('Emulation.setEmulatedMedia', { features: [] });
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 980, height: 700, deviceScaleFactor: 1, mobile: false });
        await sleep(200); await shot('workflow-sample-compact');
        ok(await cdp.eval('document.documentElement.scrollWidth <= innerWidth && document.querySelector(".workflow-view").scrollWidth <= document.querySelector(".workflow-view").clientWidth + 1'), '工作流窄窗口无横向溢出');
        const narrowComposer = await cdp.eval('document.querySelector(".composer-inner:not([hidden])").getBoundingClientRect().width');
        await cdp.eval('document.querySelectorAll(".workflow-node")[3].click()');
        ok(await cdp.eval('(()=>{const a=document.querySelector(".workflow-detail").getBoundingClientRect(),b=document.querySelector(".flow-canvas-shell").getBoundingClientRect();return a.top>=b.bottom-1})()'), '窄窗口成员详情自动放到画布下方');
        await cdp.eval('document.querySelector("[aria-label=关闭成员详情]").click()');
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
        await sleep(150);
        const wideComposer = await cdp.eval('document.querySelector(".composer-inner:not([hidden])").getBoundingClientRect().width');
        log('输入框宽度：' + JSON.stringify({ narrowComposer, wideComposer }));
        ok(wideComposer > narrowComposer + 400, '输入框跟随窗口横向变宽，不再被固定最大宽度限制');
        await cdp.send('Emulation.clearDeviceMetricsOverride');
        const history = await cdp.eval('(()=>{const s=document.querySelector("[aria-label=工作流运行轮次]");s.value=s.options[2].value;s.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
        await sleep(200);
        ok(history && await cdp.eval('document.querySelectorAll(".workflow-node").length === 1 && document.querySelector(".workflow-status").innerText === "已停止"'), '历史轮次可切换，停止记录不会继续转圈');
        ok(await cdp.eval('document.querySelectorAll(".flow-edge-motion, .flow-agent-working").length === 0'), '停止轮次没有流动箭头或工作动画');
        await cdp.eval('document.querySelectorAll(".workflow-switch button")[0].click()');
        await cdp.eval('document.querySelector(".composer-input").focus()');
        if (process.env.MATHMODEL_TEST_INPUT_PERF === '1') {
          await cdp.eval('window.__inputPaintTimes=[]; document.querySelector(".composer-input").addEventListener("input",()=>{const start=performance.now();requestAnimationFrame(()=>{window.__inputPaintTimes.push(performance.now()-start)})}); true');
          for (const char of '中文输入应该立即出现') await cdp.send('Input.insertText', { text: char });
          await sleep(80);
          const latency = await cdp.eval('window.__inputPaintTimes');
          log('60 条富文本历史下输入到下一帧（毫秒）：' + JSON.stringify(latency.map(n=>Math.round(n))));
          ok(latency.length === 10 && Math.max(...latency) < 200, '长对话中逐字中文输入在 200ms 内进入下一帧，没有秒级等待');
          await cdp.eval('document.querySelector(".composer-input").select()');
        }
        await cdp.send('Input.insertText', { text: '切换视图后仍保留的草稿' });
        await cdp.eval('document.querySelectorAll(".workflow-switch button")[1].click()');
        ok(await cdp.eval('document.querySelector(".composer-input").value === "切换视图后仍保留的草稿"'), '有历史的工作流保留输入区与草稿');
        await cdp.eval(`window.mathmodel.session.remove(${JSON.stringify(fixtureId)})`);
        const deleted = await cdp.eval(`window.mathmodel.workflow.list(${JSON.stringify(fixtureId)})`);
        ok(deleted.length === 0, '删除测试任务时工作流记录级联删除');
        if (process.env.MATHMODEL_TEST_INPUT_PERF === '1') {
          const providerCount = await cdp.eval('(async()=> (await window.mathmodel.llm.listProviders()).length)()');
          if (providerCount !== 0) throw new Error('即时发送验证只允许没有供应商的隔离测试库，禁止调用付费模型');
          await cdp.eval('document.querySelector("[aria-label=新任务]").click()');
          await sleep(100);
          await cdp.eval('document.querySelectorAll(".workflow-switch button")[0].click(); document.querySelector(".composer-input").focus()');
          await sleep(80);
          await cdp.eval('document.querySelector(".composer-input").focus()');
          await cdp.send('Input.insertText', { text: '界面即时发送测试，不调用模型' });
          await cdp.eval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          log('发送前界面：' + JSON.stringify(await cdp.eval('({input:document.querySelector(".composer-input").value,disabled:document.querySelector(".cz-send").disabled,button:document.querySelector(".cz-send").className})')));
          await cdp.eval('window.__sendEchoMs=null; const start=performance.now(); const observer=new MutationObserver(()=>{if([...document.querySelectorAll(".msg-user")].some(e=>e.textContent.includes("界面即时发送测试"))){window.__sendEchoMs=performance.now()-start;observer.disconnect()}});observer.observe(document.querySelector(".chat-scroll"),{childList:true,subtree:true});document.querySelector(".cz-send").click();true');
          await sleep(300);
          const echoMs = await cdp.eval('window.__sendEchoMs');
          log('新任务发送到消息出现（毫秒）：' + echoMs);
          log('发送后界面：' + JSON.stringify(await cdp.eval('({input:document.querySelector(".composer-input").value,users:document.querySelectorAll(".msg-user").length,button:document.querySelector(".cz-send").className,notice:document.querySelector(".chat-ops-notice")?.textContent})')));
          await shot('send-immediate-check');
          ok(echoMs !== null && echoMs < 200, '新任务发送后先回显消息，不等待创建任务与完整列表刷新');
          ok(await cdp.eval('document.querySelector(".composer-input").value === "界面即时发送测试，不调用模型" && !document.querySelector(".cz-send.stop")'), '未配置模型时只恢复用户原文，不露出模式指令');
          ok(await cdp.eval('[...document.querySelectorAll(".msg-user")].some(e=>e.innerText.includes("界面即时发送测试")&&!e.innerText.includes("/write-paper"))'), '消息气泡只展示用户输入，不显示模式预设指令');
        }
      }
    }
    const core = await cdp.eval(`(async function(){
      return {
        runtime: await window.mathmodel.skill.runtime(),
        addPlugin: typeof window.mathmodel.skill.addPlugin === 'function',
        stats: await window.mathmodel.stats.get(),
        settings: !!(await window.mathmodel.settings.get()),
      };
    })()`);
    ok(core.runtime === null, '新资料库的能力记录为空，不伪造已加载');
    ok(core.addPlugin, '新增本地插件入口已进入实际 preload');
    ok(Array.isArray(core.stats.bySkill) && Array.isArray(core.stats.byAgent) && Array.isArray(core.stats.byConnector), '技能/子智能体/连接器真实统计通道分开');
    ok(core.settings, '设置通道可读');
      log('核心启动检查：' + out.filter(l => l.startsWith('PASS')).length + ' 通过 / ' + fails + ' 失败；未发送模型请求。');
      fs.writeFileSync(LOGFILE, out.join('\n'), 'utf8');
    await cdp.send('Browser.close', {}, null).catch(() => {});
    cdp.close();
    await sleep(1000);
    if (child.exitCode === null) child.kill();
    process.exit(fails === 0 ? 0 : 1);
  }
  const db = await cdp.eval(
    `(async function(){
      try {
        await window.mathmodel.settings.get();
        var p = await window.mathmodel.project.list();
        return { ok: true, projectCount: p.length };
      } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
    })()`,
  );
  ok(db.ok, '真实 SQLite 数据库读写正常（settings + project）');
  if (!db.ok) log('  ' + db.err);
  log('');

  // ── 4. 真实工作流（文件、会话、终端、自动化） ──
  const workflow = await cdp.eval(
    `(async function(){
      var api = window.mathmodel;
      var project = await api.project.current();
      await api.file.write('mm-workflow-test.txt', 'MModels workflow OK');
      var preview = await api.file.preview('mm-workflow-test.txt');
      var session = await api.session.create(project.id, '真实工作流测试');
      var terminalText = '';
      var offData = api.terminal.onData(function(id, data){ terminalText += data; });
      var term = await api.terminal.create(project.root, 100, 30);
      await api.terminal.write(term.termId, 'echo MM_TERMINAL_OK' + String.fromCharCode(13));
      await new Promise(function(r){ setTimeout(r, 3500); });
      await api.terminal.kill(term.termId);
      offData();
      var automations = await api.automation.upsert({
        projectId: project.id, name: '真实工作流测试', prompt: 'test',
        cron: '0 0 * * *', enabled: false
      });
      var created = automations.find(function(a){ return a.name === '真实工作流测试'; });
      if (created) await api.automation.remove(created.id);
      await api.session.remove(session.id);
      return {
        fileText: preview && preview.text,
        terminalOk: terminalText.indexOf('MM_TERMINAL_OK') >= 0,
        automationOk: !!created
      };
    })()`,
  );
  ok(workflow.fileText === 'MModels workflow OK', '项目文件真实写入与读取正常');
  ok(workflow.terminalOk, '终端真实启动、输入与输出正常');
  ok(workflow.automationOk, '自动化任务真实创建与删除正常');
  if (workflow.fileText !== 'MModels workflow OK' || !workflow.terminalOk) {
    log('  工作流诊断: ' + JSON.stringify(workflow));
  }
  log('');

  // ── 5. 可选的真实模型 API 工作流 ──
  // 密钥只写入本测试的临时 userData，不打印、不进入源码。
  if (process.env.DEEPSEEK_API_KEY) {
    log('DeepSeek Flash 真实 API 工作流：');
    const keyLiteral = JSON.stringify(process.env.DEEPSEEK_API_KEY);
    const started = await cdp.eval(
      `(async function(){
        var api = window.mathmodel;
        var provider = {
          id: 'e2e-deepseek', name: 'DeepSeek', apiFormat: 'openai',
          baseUrl: 'https://api.deepseek.com/v1', apiKey: ${keyLiteral},
          models: ['deepseek-flash'], enabled: true, builtin: true
        };
        await api.llm.upsertProvider(provider);
        var connectivity = await api.llm.testProvider(provider.id);
        await api.settings.set({ activeProviderId: provider.id,
          defaultModel: 'deepseek-flash', disableThinking: true, onboardingDone: true });
        var project = await api.project.current();
        var session = await api.session.create(project.id, 'DeepSeek Flash 真实测试');
        globalThis.__mmDeepSeekTest = { done: false, events: [], sessionId: session.id };
        var off = api.session.onStream(function(id, event){
          if (id !== session.id) return;
          globalThis.__mmDeepSeekTest.events.push(event);
          if (event.type === 'session-end') {
            globalThis.__mmDeepSeekTest.done = true;
            off();
          }
        });
        await api.session.send(session.id, '只回复四个字：连接成功');
        return { started: true, connectivity: connectivity };
      })()`,
    );
    ok(started.started && started.connectivity?.ok, 'DeepSeek 密钥与接口连通');

    let modelResult = null;
    for (let i = 0; i < 90; i++) {
      modelResult = await cdp.eval(
        `(function(){
          var t = globalThis.__mmDeepSeekTest;
          if (!t) return null;
          var errors = t.events.filter(function(e){ return e.type === 'session-error'; }).map(function(e){ return e.message; });
          var text = t.events.filter(function(e){ return e.type === 'text-delta'; }).map(function(e){ return e.delta; }).join('');
          return { done: t.done, text: text, errors: errors, eventCount: t.events.length };
        })()`,
      );
      if (modelResult?.done) break;
      await sleep(1000);
    }
    ok(modelResult?.done, 'DeepSeek Flash 会话正常结束');
    ok(modelResult && modelResult.errors.length === 0, 'DeepSeek Flash 流程无错误');
    ok(modelResult && modelResult.text.trim().length > 0, 'DeepSeek Flash 返回有效正文');
    if (modelResult?.errors?.length) log('  错误: ' + modelResult.errors.join(' | '));
    log('  回复: ' + (modelResult?.text ? modelResult.text.trim().slice(0, 120) : '(空)'));
    log('');
  }

  // ── 6. 项目 / 任务层级 + 论文页数要求 ──
  const projectTaskUi = await cdp.eval(
    `(async function(){
      var api = window.mathmodel;
      var project = await api.project.current();
      for (var i = 0; i < 30 && !document.querySelector('.sidebar'); i++) {
        await new Promise(function(r){ setTimeout(r, 100); });
      }
      var before = (await api.session.list(project.id)).length;
      var newTask = document.querySelector('.rail-create-strip button[aria-label="新任务"]');
      if (newTask) newTask.click();
      await new Promise(function(r){ setTimeout(r, 150); });
      var after = (await api.session.list(project.id)).length;
      var path = document.querySelector('.topbar-context-path');
      return {
        hasWorkProjects: document.body.textContent.includes('工作项目'),
        hasProjectTasks: document.body.textContent.includes('项目任务'),
        hasNewTask: !!newTask && newTask.textContent.includes('新任务'),
        before: before,
        after: after,
        topbarNewTask: !!path && path.textContent.includes('新任务')
      };
    })()`,
  );
  ok(
    projectTaskUi.hasWorkProjects && projectTaskUi.hasProjectTasks && projectTaskUi.hasNewTask,
    '项目与任务在侧栏中分层显示',
  );
  ok(projectTaskUi.topbarNewTask, '顶栏明确显示当前是新任务');
  ok(projectTaskUi.before === projectTaskUi.after, '点新任务不会提前创建空会话');

  const tokenEstimateRemoved = await cdp.eval(
    `(function(){
      return {
        composer: !!document.querySelector('.composer-box'),
        indicator: !!document.querySelector('.cz-cost'),
        visibleText: document.body.textContent.includes('预计消耗')
      };
    })()`,
  );
  ok(
    tokenEstimateRemoved.composer && !tokenEstimateRemoved.indicator && !tokenEstimateRemoved.visibleText,
    '输入区已移除预计 token 消耗',
  );

  const agentPetUi = await cdp.eval(
    `(async function(){
      var api = window.mathmodel;
      var beforeSettings = await api.settings.get();
      var collab = document.querySelector('[aria-label="多智能体协作"]');
      var collabEnabled = collab?.getAttribute('aria-pressed') === 'true';
      document.querySelector('[aria-label="更多任务操作"]')?.click();
      await new Promise(r => setTimeout(r, 50));
      var petToggle = [...document.querySelectorAll('.studio-task-menu button')].find(el => el.textContent.includes('桌面小模'));
      petToggle?.click();
      var hidden = false;
      for (var i = 0; i < 30; i++) {
        hidden = (await api.settings.get()).modelingPetEnabled === false;
        if (hidden) break;
        await new Promise(r => setTimeout(r, 50));
      }
      document.querySelector('[aria-label="更多任务操作"]')?.click();
      await new Promise(r => setTimeout(r, 50));
      [...document.querySelectorAll('.studio-task-menu button')].find(el => el.textContent.includes('桌面小模'))?.click();
      var restored = false;
      for (var j = 0; j < 30; j++) {
        restored = (await api.settings.get()).modelingPetEnabled === true;
        if (restored) break;
        await new Promise(r => setTimeout(r, 50));
      }
      return {
        collab: collabEnabled, petToggle: !!petToggle,
        desktopOnly: !document.querySelector('.modeling-pet'),
        hidden, restored,
        defaults: beforeSettings.multiAgentEnabled === true && beforeSettings.modelingPetEnabled === true
      };
    })()`,
  );
  ok(agentPetUi.collab && agentPetUi.defaults, '多智能体协作默认启用，可从任务选项访问');
  ok(agentPetUi.petToggle && agentPetUi.desktopOnly, '小模开关在更多菜单，主界面不重复显示宠物');
  ok(agentPetUi.hidden && agentPetUi.restored, '数学建模伙伴可以关闭并重新打开');

  const pageLimitUi = await cdp.eval(
    `(async function(){
      var button = Array.from(document.querySelectorAll('button')).find(function(el){
        return el.textContent.includes('比赛信息');
      });
      if (!button) return { button: false, dialog: false };
      button.click();
      var input = null;
      for (var i = 0; i < 40; i++) {
        input = document.querySelector('input[aria-label="页数上限"]');
        if (input) break;
        await new Promise(function(r){ setTimeout(r, 50); });
      }
      if (!input) return { button: true, dialog: false };
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '20');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(function(r){ setTimeout(r, 80); });
      return {
        button: true,
        dialog: true,
        title: document.body.textContent.includes('论文页数要求'),
        bodyScope: document.body.textContent.includes('只计算正文'),
        value: input.value
      };
    })()`,
  );
  ok(pageLimitUi.button && pageLimitUi.dialog, '比赛信息中可以设置页数要求');
  ok(pageLimitUi.title && pageLimitUi.bodyScope && pageLimitUi.value === '20', '页数上限与正文计页口径可填写');
  try {
    const pageLimitShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      path.join(ROOT, 'out', 'real-app-page-limit.png'),
      Buffer.from(pageLimitShot.data, 'base64'),
    );
    log('✓ 页数要求截图已保存: out/real-app-page-limit.png');
  } catch (e) {
    log('⚠️ 页数要求截图失败: ' + e.message);
  }
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 680,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(150);
    const narrowLayout = await cdp.eval(
      `(function(){
        var modal = document.querySelector('.modal');
        var grid = document.querySelector('.paper-page-limit-grid');
        if (!modal || !grid) return null;
        var box = modal.getBoundingClientRect();
        var labels = Array.from(grid.querySelectorAll(':scope > label')).map(function(el){
          var r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width };
        });
        return {
          fits: box.left >= 0 && box.right <= innerWidth,
          rows: new Set(labels.map(function(r){ return Math.round(r.y); })).size,
          noOverflow: labels.every(function(r){ return r.x >= box.left && r.x + r.width <= box.right; })
        };
      })()`,
    );
    ok(
      narrowLayout && narrowLayout.fits && narrowLayout.rows === 3 && narrowLayout.noOverflow,
      '窄窗口下页数设置自动改为单列且不溢出',
    );
    const narrowShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      path.join(ROOT, 'out', 'real-app-page-limit-narrow.png'),
      Buffer.from(narrowShot.data, 'base64'),
    );
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await sleep(120);
  } catch (e) {
    log('⚠️ 窄窗口页数要求检查失败: ' + e.message);
    try { await cdp.send('Emulation.clearDeviceMetricsOverride'); } catch { /* 忽略 */ }
  }
  const pageLimitSaved = await cdp.eval(
    `(async function(){
      var save = Array.from(document.querySelectorAll('.modal-foot button')).find(function(el){
        return el.textContent.includes('保存');
      });
      if (!save) return null;
      save.click();
      for (var i = 0; i < 40; i++) {
        var project = await window.mathmodel.project.current();
        var result = await window.mathmodel.paper.getConfig(project && project.id);
        if (result.config && result.config.pageLimit) return result.config.pageLimit;
        await new Promise(function(r){ setTimeout(r, 50); });
      }
      return null;
    })()`,
  );
  ok(
    pageLimitSaved && pageLimitSaved.maxPages === 20 && pageLimitSaved.scope === 'body',
    '页数要求真实保存到项目配置',
  );
  log('');

  // ── 7. 思考强度滑杆（真实渲染 + 真实设置落库） ──
  const effortSlider = await cdp.eval(
    `(async function(){
      var effortText = document.querySelector('.cz-effort');
      var button = effortText && effortText.closest('button');
      if (!button) return { button: false, slider: false };
      button.click();
      var slider = null;
      for (var i = 0; i < 30; i++) {
        slider = document.querySelector('.cz-effort-range');
        if (slider) break;
        await new Promise(function(r){ setTimeout(r, 50); });
      }
      if (!slider) return { button: true, slider: false };
      var initial = {
        min: slider.min,
        max: slider.max,
        step: slider.step,
        labelCount: document.querySelectorAll('.cz-effort-ticks span').length
      };
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(slider, '4');
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(function(r){ setTimeout(r, 250); });
      var settings = await window.mathmodel.settings.get();
      return {
        button: true,
        slider: true,
        min: initial.min,
        max: initial.max,
        step: initial.step,
        effort: settings.effort,
        labelCount: initial.labelCount,
        aria: slider.getAttribute('aria-valuetext')
      };
    })()`,
  );
  ok(effortSlider.button && effortSlider.slider, '模型菜单内显示思考强度滑杆');
  ok(
    effortSlider.min === '0' && effortSlider.max === '4' && effortSlider.step === '1' && effortSlider.labelCount === 5,
    '思考强度滑杆提供 5 个稳定档位',
  );
  ok(effortSlider.effort === 'max', '滑到最深档后设置真实保存');
  try {
    await cdp.eval(
      `(async function(){
        if (document.querySelector('.cz-effort-range')) return;
        var effortText = document.querySelector('.cz-effort');
        var button = effortText && effortText.closest('button');
        if (button) button.click();
        await new Promise(function(r){ setTimeout(r, 250); });
      })()`,
    );
    const effortVisual = await cdp.eval(
      `(function(){
        var root = document.querySelector('.cz-effort-slider');
        var track = document.querySelector('.cz-effort-visual-track');
        var particles = document.querySelector('.cz-effort-particles');
        if (!root || !track || !particles) return null;
        var levels = ['low', 'medium', 'high', 'xhigh', 'max'];
        var colors = levels.map(function(level){
          root.setAttribute('data-effort', level);
          return getComputedStyle(track).backgroundImage;
        });
        root.setAttribute('data-effort', 'max');
        return {
          uniqueColors: new Set(colors).size,
          particleAnimation: getComputedStyle(particles).animationName,
          trackHeight: Math.round(track.getBoundingClientRect().height),
          thumbSize: getComputedStyle(document.querySelector('.cz-effort-range')).height
        };
      })()`,
    );
    ok(effortVisual && effortVisual.uniqueColors === 5, '五档使用五套不同深浅的轨道颜色');
    ok(
      effortVisual && effortVisual.particleAnimation === 'effort-particle-flow',
      '最大档启用粒子流动效果',
    );
    ok(effortVisual && effortVisual.trackHeight >= 18, '思考强度轨道为加粗胶囊样式');
    const effortShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      path.join(ROOT, 'out', 'real-app-effort-slider.png'),
      Buffer.from(effortShot.data, 'base64'),
    );
    log('✓ 思考强度滑杆截图已保存: out/real-app-effort-slider.png');
  } catch (e) {
    log('⚠️ 滑杆截图失败: ' + e.message);
  }
  log('');

  // ── 8. 欢迎页的新建项目入口 ──
  // 删除测试沙箱中的默认项目并重载，只验证应用内名称弹窗；不提交表单，
  // 避免自动化过程中弹出原生目录选择器。
  await cdp.eval(
    `(async function(){
      var project = await window.mathmodel.project.current();
      if (project) await window.mathmodel.project.remove(project.id, false);
      location.reload();
      return true;
    })()`,
  );
  let welcomeReady = false;
  for (let i = 0; i < 30; i++) {
    welcomeReady = await cdp.eval(
      `!!document.body && document.body.textContent.includes('新建一个建模项目')`,
    );
    if (welcomeReady) break;
    await sleep(300);
  }
  ok(welcomeReady, '无项目时欢迎页正常显示');
  const createDialog = await cdp.eval(
    `(async function(){
      var button = Array.from(document.querySelectorAll('button')).find(function(el){
        return el.textContent.includes('新建项目');
      });
      if (!button) return { button: false, dialog: false };
      button.click();
      // ⚠️ React 渲染弹窗是异步的，点击后同步查询必然查空 —— 轮询等它出现
      var input = null;
      for (var i = 0; i < 30; i++) {
        input = document.querySelector('#new-project-name');
        if (input) break;
        await new Promise(function(r){ setTimeout(r, 50); });
      }
      return { button: true, dialog: !!input, focused: !!input && document.activeElement === input,
        defaultName: input ? input.value : '' };
    })()`,
  );
  ok(createDialog.button, '新建项目按钮可点击');
  ok(createDialog.dialog, '点击后显示项目名称弹窗');
  ok(createDialog.focused, '项目名称输入框自动获得焦点');
  ok(createDialog.defaultName.length > 0, '项目名称已提供可编辑的默认值');
  log('');

  // ── 9. 截图（真实窗口画面） ──
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      path.join(ROOT, 'out', 'real-app.png'),
      Buffer.from(shot.data, 'base64'),
    );
    log('✓ 真实应用截图已保存: out/real-app.png');
  } catch (e) {
    log('⚠️ 截图失败: ' + e.message);
  }

  // ── 5. 页面内控制台错误 ──
  const jsErr = await cdp.eval(
    'window.__mmErrCount === undefined ? -1 : window.__mmErrCount',
  );
  log('页面内记录的错误数: ' + jsErr + '（-1 表示未挂探针）');
  log('');

  // ── 10. 桌面小模独立生命周期 ──
  if (petTarget && petSessionId) {
    await cdp.send('Target.closeTarget', { targetId: pageTarget.targetId }, null);
    await sleep(500);
    const afterClose = await cdp.send('Target.getTargets', {}, null);
    const remainingPetTarget = (afterClose.targetInfos || []).find(function(t){
      return t.type === 'page' && t.url.indexOf('window=desktop-pet') >= 0;
    });
    ok(!!remainingPetTarget, '关闭主窗口后桌面小模继续留在电脑桌面');

    const remainingPetAttachment = await cdp.send('Target.attachToTarget', {
      targetId: remainingPetTarget.targetId,
      flatten: true,
    }, null);
    await cdp.send('Runtime.evaluate', {
      expression: 'window.mathmodel.pet.showMain()',
      awaitPromise: true,
      returnByValue: true,
    }, remainingPetAttachment.sessionId);
    let mainReturned = false;
    let returnedMainTarget = null;
    for (let i = 0; i < 20; i++) {
      const targets = await cdp.send('Target.getTargets', {}, null);
      returnedMainTarget = (targets.targetInfos || []).find(function(t){
        return t.type === 'page' && t.url.indexOf('devtools://') !== 0 && t.url.indexOf('window=desktop-pet') < 0;
      });
      mainReturned = !!returnedMainTarget;
      if (mainReturned) break;
      await sleep(150);
    }
    ok(mainReturned, '点击桌面小模可以重新打开主窗口');
    // 走真实的“完全退出”通道。直接杀 Portable 外壳会让外壳清理解包目录时，
    // 内层 Electron 仍然存活，最终只剩被锁定的 app.asar，模板和技能会消失。
    await cdp.send('Runtime.evaluate', {
      expression: 'window.mathmodel.app.quitCompletely()',
      awaitPromise: true,
      returnByValue: true,
    }, remainingPetAttachment.sessionId);
    await sleep(400);
    log('');
  } else {
    try { await cdp.eval('window.mathmodel.app.quitCompletely()'); } catch { /* 页面可能已经退出 */ }
  }

  cdp.close();
  const exitedCleanly = await waitForChildExit(child);
  if (!exitedCleanly) {
    try { child.kill(); } catch { /* 忽略 */ }
  }
  await sleep(600);

  const stderrText = stderrRef.text;
  const bad = stderrText
    .split('\n')
    .filter((l) => /Error|error:|Cannot|Uncaught|ERR_/i.test(l))
    .filter(
      (l) =>
        !/DevTools|Content-Security|Autofill|GPU|gpu_|dxgi|vulkan|Electron Security|AttachConsole failed/i.test(l),
    );
  if (bad.length) {
    log('主进程 stderr 可疑行:');
    for (const l of bad.slice(0, 10)) log('  ' + l.slice(0, 170));
  }
  ok(bad.length === 0, '主进程无致命错误输出');

  log('');
  log(`合计：${out.filter((l) => l.indexOf('PASS') === 0).length} 通过 / ${fails} 失败`);
  fs.writeFileSync(LOGFILE, out.join('\n'), 'utf8');
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  out.push('FATAL ' + String((e && e.stack) || e));
  try {
    fs.writeFileSync(LOGFILE, out.join('\n'), 'utf8');
  } catch {
    /* 忽略 */
  }
  console.log('FATAL: ' + String(e && e.message));
  process.exit(1);
});
