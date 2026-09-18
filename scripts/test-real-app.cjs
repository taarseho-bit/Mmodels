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
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + USER_DATA,
      '--disable-gpu',
      '--no-sandbox',
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
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
      var before = (await api.session.list(project.id)).length;
      var newTask = document.querySelector('.rail-create-strip button');
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
      var buttons = Array.from(document.querySelectorAll('.cz-btn'));
      var collab = buttons.find(function(el){ return el.textContent.trim() === '协作'; });
      var petToggle = buttons.find(function(el){ return el.textContent.trim() === '小模'; });
      var petBefore = document.querySelector('.modeling-pet');
      var petBody = document.querySelector('.modeling-pet-body');
      var beforeSettings = await window.mathmodel.settings.get();
      if (petToggle) petToggle.click();
      var hidden = false;
      for (var i = 0; i < 30; i++) {
        var hiddenSettings = await window.mathmodel.settings.get();
        hidden = !document.querySelector('.modeling-pet') && hiddenSettings.modelingPetEnabled === false;
        if (hidden) break;
        await new Promise(function(r){ setTimeout(r, 50); });
      }
      var nextButtons = Array.from(document.querySelectorAll('.cz-btn'));
      var petToggleAfter = nextButtons.find(function(el){ return el.textContent.trim() === '小模'; });
      if (petToggleAfter) petToggleAfter.click();
      var restored = false;
      for (var j = 0; j < 30; j++) {
        var restoredSettings = await window.mathmodel.settings.get();
        restored = !!document.querySelector('.modeling-pet') && restoredSettings.modelingPetEnabled === true;
        if (restored) break;
        await new Promise(function(r){ setTimeout(r, 50); });
      }
      var petAfter = document.querySelector('.modeling-pet');
      var afterSettings = await window.mathmodel.settings.get();
      return {
        collab: !!collab && collab.getAttribute('aria-pressed') === 'true',
        petToggle: !!petToggle,
        petVisible: !!petBefore && !!petBody && petBefore.getAttribute('data-pet-state') === 'resting',
        hidden: hidden,
        restored: restored && !!petAfter && afterSettings.modelingPetEnabled === true,
        defaults: beforeSettings.multiAgentEnabled === true && beforeSettings.modelingPetEnabled === true
      };
    })()`,
  );
  ok(agentPetUi.collab && agentPetUi.defaults, '多智能体协作默认启用且可见');
  ok(agentPetUi.petToggle && agentPetUi.petVisible, '数学建模伙伴按真实空闲状态显示');
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
        var result = await window.mathmodel.paper.getConfig();
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
    // 先关宠物、再关刚唤回的主窗口，确保 Portable 解压出来的子进程一并退出。
    await cdp.send('Target.closeTarget', { targetId: remainingPetTarget.targetId }, null);
    if (returnedMainTarget) {
      await cdp.send('Target.closeTarget', { targetId: returnedMainTarget.targetId }, null);
    }
    await sleep(400);
    log('');
  }

  cdp.close();
  try {
    child.kill();
  } catch {
    /* 忽略 */
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
