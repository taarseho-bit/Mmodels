#!/usr/bin/env node
/**
 * 官网素材截图：从当前打包产物驱动真实 Electron 页面，生成 docs/ 可用的关键截图。
 *
 * 用法：
 *   node scripts/capture-site-screenshots.cjs
 *
 * 设计目标：
 *   - 使用隔离 userData，不读取或修改用户的真实项目；
 *   - 通过公开的路由事件进入页面，不依赖坐标点击；
 *   - 截图前关闭首次运行遮罩，确保官网展示的是实际工作台；
 *   - 输出到 out/site-shots，同时复制到 docs/assets/screenshots/site/，
 *     供官网页面直接引用。没有找到某个页面时保留失败记录并继续其它截图。
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const APP = process.env.MATHMODEL_SITE_APP || path.join(ROOT, 'dist', 'win-unpacked', 'MModels.exe');
const PORT = Number(process.env.MATHMODEL_SITE_PORT || 9367);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-site-shots-'));
const USER_DATA = path.join(SANDBOX, 'userdata');
const OUT = path.join(ROOT, 'out', 'site-shots');
const DOCS_OUT = path.join(ROOT, 'docs', 'assets', 'screenshots', '2026-09-30');
const currentFiles = [];
const failures = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForBrowserWs(ref, timeoutMs = 45_000) {
  const marker = 'DevTools listening on ';
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const index = ref.text.indexOf(marker);
      if (index >= 0) {
        const url = ref.text.slice(index + marker.length).split(/\s/)[0];
        if (url) return resolve(url);
      }
      if (Date.now() - started > timeoutMs) return reject(new Error('等待 DevTools 超时'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

function connect(wsUrl) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    let id = 0;
    const pending = new Map();
    ws.on('message', (data) => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    });
    ws.on('error', reject);
    ws.on('open', () => {
      const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
        const messageId = ++id;
        pending.set(messageId, { resolve: res, reject: rej });
        const payload = { id: messageId, method, params };
        if (sessionId) payload.sessionId = sessionId;
        ws.send(JSON.stringify(payload));
      });
      resolve({ send, close: () => ws.close() });
    });
  });
}

async function main() {
  if (!fs.existsSync(APP)) throw new Error(`找不到打包产物：${APP}`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DOCS_OUT, { recursive: true });
  const env = { ...process.env, NODE_OPTIONS: '', MATHMODEL_E2E: '1', MATHMODEL_USERDATA: USER_DATA };
  delete env.MATHMODEL_SITE_VIP_EMAIL;
  delete env.MATHMODEL_SITE_VIP_PASSWORD;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SAFE_DELETE;

  const child = spawn(APP, [
    `--remote-debugging-port=${PORT}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${USER_DATA}`,
    '--disable-gpu',
    '--no-sandbox',
  ], { cwd: SANDBOX, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const ref = { text: '' };
  child.stderr.on('data', (chunk) => { ref.text += chunk.toString(); });
  child.stdout.on('data', () => {});

  let cdp;
  try {
    cdp = await connect(await waitForBrowserWs(ref));
    let target;
    for (let i = 0; i < 40 && !target; i += 1) {
      const result = await cdp.send('Target.getTargets');
      target = (result.targetInfos || []).find((item) => item.type === 'page' && !item.url.includes('window=desktop-pet'));
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('找不到主窗口页面');
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const sessionId = attached.sessionId;
    const send = (method, params = {}) => cdp.send(method, params, sessionId);
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
      return result.result && result.result.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });

    for (let i = 0; i < 50; i += 1) {
      if (await evaluate('!!document.body && document.body.textContent.length > 100')) break;
      await sleep(250);
    }
    await sleep(800);
    // 首次运行欢迎页 / 引导只在真实启动时出现，官网截图不展示遮罩。
    const hideStartupOverlays = async () => evaluate(`(() => {
      const style = document.createElement('style');
      style.id = 'mm-site-shot-cleanup';
      style.textContent = '.first-run-shell,.modal-backdrop{visibility:hidden!important;pointer-events:none!important}';
      document.head.appendChild(style);
      const roots = [...document.querySelectorAll('.ob-card,[data-testid="first-run-welcome"]')];
      for (const root of roots) {
        const button = [...root.querySelectorAll('button')].find((el) => /跳过|稍后再说|略过/.test(el.textContent || ''));
        if (button) button.click();
      }
      // 状态写入是异步的，截图工具不需要等待它完成；先让欢迎层退到视觉之外，
      // 避免它遮住后续页面。真实应用不会因此改变用户数据。
      document.querySelectorAll('.first-run-shell,.ob-card,.modal-backdrop').forEach((el) => {
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      });
      document.querySelectorAll('.modal-backdrop').forEach((el) => {
        if (!el.querySelector('.modal, .membership-modal, .ob-card, [data-testid="first-run-welcome"]')) return;
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      });
      return true;
    })()`);
    await hideStartupOverlays();
    await sleep(450);
    // 官网素材统一采用亮色模式：同时固定 Electron nativeTheme、应用缓存和
    // 当前 DOM，避免截图机器的系统深色偏好把营销站素材染成深色。
    const forceLightTheme = async () => evaluate(`(async () => {
      try { await window.mathmodel.app.setNativeTheme('light'); } catch (_) { /* 旧打包版无此接口时继续用 DOM 兜底 */ }
      try { localStorage.setItem('mm-theme', 'light'); } catch (_) { /* ignore */ }
      document.documentElement.dataset.theme = 'light';
      document.documentElement.style.colorScheme = 'light';
      return document.documentElement.dataset.theme;
    })()`);
    await forceLightTheme();

    /**
     * 可选的商业版官网素材会话：只有调用者显式提供临时环境变量时才登录，
     * 默认截图仍然完全离线。密码只在本次 Node 进程内拼入 CDP 调用，不写入
     * 仓库、截图、manifest 或日志；这样官网素材能展示真实 VIP 状态，又不会
     * 把任何账号信息带进发布产物。
     */
    const vipEmail = (process.env.MATHMODEL_SITE_VIP_EMAIL || '').trim();
    const vipPassword = process.env.MATHMODEL_SITE_VIP_PASSWORD || '';
    let vipStatus = null;
    if (vipEmail && vipPassword) {
      vipStatus = await evaluate(`window.mathmodel.account.login(${JSON.stringify({ username: vipEmail, password: vipPassword })})`);
      if (!vipStatus?.loggedIn || vipStatus.plan !== 'vip') throw new Error('临时截图账号不是有效 VIP，已终止截图');
      console.log(`[site-shots] 临时会员截图会话已启用（${vipStatus.plan === 'vip' ? 'VIP' : '非 VIP'}）`);
      // 隔离环境只用于展示，优先把界面切到官网主推的 DeepSeek 预设；不发起模型请求。
      const providers = await evaluate('window.mathmodel.llm.listProviders()');
      const deepseek = Array.isArray(providers)
        ? providers.find((item) => /deepseek/i.test(`${item?.name || ''} ${item?.id || ''}`))
        : null;
      if (deepseek?.id) {
        const model = deepseek.models?.[0] || deepseek.modelPool?.[0] || 'deepseek-flash';
        await evaluate(`window.mathmodel.settings.set(${JSON.stringify({ activeProviderId: deepseek.id, defaultModel: model })})`);
      }
    }

    /**
     * 给官网素材准备一个真实的、可回放的示例项目。它只写入本轮隔离的
     * userData，不会碰用户现有项目；内容是“城市应急资源调度”演示数据，
     * 用来让对话、工作流和交付路径在截图中都有上下文。
     */
    const prepareCaseStudy = async () => {
      const project = await evaluate('window.mathmodel.project.current()');
      if (!project?.id) return null;
      const projectRelative = path.relative(USER_DATA, path.resolve(project.root || ''));
      if (!project.root || projectRelative.startsWith('..') || path.isAbsolute(projectRelative) || !/^projects[\\/]/i.test(projectRelative)) {
        throw new Error('官网案例项目不在本轮隔离 userData 内，已终止截图');
      }
      const projectName = '2026 城市应急资源调度案例';
      await evaluate(`window.mathmodel.project.rename(${JSON.stringify(project.id)}, ${JSON.stringify(projectName)})`);
      const files = [
        ['题目说明.md', '# 城市应急资源调度\n\n在有限车辆、仓储和道路容量下，为四个应急服务区分配物资，使响应时间与缺口风险同时最小。\n\n## 研究目标\n- 最小化综合响应时间\n- 保证重点区域的最低保障量\n- 用灵敏度分析检验方案稳定性\n'],
        ['data/应急资源需求.csv', '区域,人口,需求量,优先级,距离km\n东区,128000,420,1,8.4\n西区,96000,310,2,11.2\n南区,74000,260,1,6.8\n北区,52000,180,3,14.6\n'],
        ['results/模型摘要.md', '## 当前候选模型\n\n线性规划 + 优先级约束。目标函数同时考虑运输距离、缺口惩罚与公平性。\n\n### 验证状态\n- 约束可行：通过\n- 基线方案对比：已完成\n- 灵敏度范围：需求量 ±10%\n'],
        ['results/数据体检.md', '## 数据体检\n\n字段完整，单位统一，缺失值 0 条；需求量与人口规模呈正相关。\n'],
        ['results/方案对比.md', '## 方案对比\n\n线性规划在总响应时间和缺口惩罚上优于基线；启发式方案作为备用复核。\n'],
        ['code/solver.py', '# 城市应急资源调度示例求解脚本\n# 生产项目中由模型求解技能生成并保留复算入口。\n'],
        ['paper/main.tex', '% 城市应急资源调度案例论文入口\n\\section{问题重述}\n\\section{模型与约束}\n\\section{结果与灵敏度分析}\n'],
        ['figures/资源分配方案.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#f7f9fc"/><path d="M80 290H580M80 290V55" stroke="#26364a" stroke-width="2"/><path d="M120 250L230 190L340 210L450 120L550 85" fill="none" stroke="#2f6fed" stroke-width="5"/><text x="90" y="45" font-size="20" fill="#26364a">资源分配与响应时间</text></svg>'],
        ['figures/图表清单.md', '1. 资源分配方案横向比较\n2. 响应时间与需求量关系\n3. 需求扰动灵敏度曲线\n'],
      ];
      // file:write 遵循应用的“已存在目录”约束；截图样例需要新建 data /
      // results / figures 子目录，所以在本轮隔离项目根目录直接准备文件，
      // 不经过用户真实项目，也不把这些演示数据提交到仓库。
      for (const [rel, content] of files) {
        const absolute = path.join(project.root, rel);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, content, 'utf8');
      }
      const pdfPath = path.join(project.root, 'paper', '城市应急资源调度论文预览.pdf');
      fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
      // 写入一页合法的轻量 PDF 预览，正文采用单列长 token：满足应用的
      // “至少 40 个正文字符”阈值，同时不触发多列/表格误报。文件只存在于
      // 临时 userData，截图结束后随隔离目录删除，不会被发布为论文内容。
      const NL = String.fromCharCode(10);
      const previewText = 'MModelsCaseStudyPreviewTextForLayoutValidation2026ObjectiveConstraintsResultsSensitivityAnalysis';
      const pdfStream = `BT /F1 18 Tf 72 720 Td (${previewText}) Tj ET${NL}`;
      const pdfObjects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${Buffer.byteLength(pdfStream, 'ascii')} >>${NL}stream${NL}${pdfStream}endstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      ];
      let pdf = `%PDF-1.4${NL}`;
      const offsets = [0];
      for (let i = 0; i < pdfObjects.length; i += 1) {
        offsets.push(Buffer.byteLength(pdf, 'utf8'));
        pdf += `${i + 1} 0 obj${NL}${pdfObjects[i]}${NL}endobj${NL}`;
      }
      const xrefOffset = Buffer.byteLength(pdf, 'utf8');
      pdf += `xref${NL}0 ${pdfObjects.length + 1}${NL}0000000000 65535 f ${NL}`;
      for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n ${NL}`;
      pdf += `trailer${NL}<< /Size ${pdfObjects.length + 1} /Root 1 0 R >>${NL}startxref${NL}${xrefOffset}${NL}%%EOF${NL}`;
      fs.writeFileSync(pdfPath, pdf, 'utf8');
      // 用真实求解产物替换初始占位文件，展示同一套可复算案例。
      const caseRoot = path.join(ROOT, 'out', 'site-case');
      if (!fs.existsSync(path.join(caseRoot, 'results', 'metrics.json'))) throw new Error('请先运行 build-site-case.py');
      fs.cpSync(caseRoot, project.root, { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'scripts', 'build-site-case.py'), path.join(project.root, 'code', 'solver.py'));
      const competitionConfig = {
        id: project.id,
        name: projectName,
        calendarId: 'A01-2026',
        competition: '城市应急资源调度 · 教学演示',
        year: 2026,
        problem: '合成数据 · 运输优化与灵敏度分析',
        deadline: '2026-10-03T20:00:00+08:00',
        pageLimit: '20 页',
        phase: '核验',
        rules: '匿名提交；正文不超过 20 页；数据来源与模型假设需可追溯。',
        checklist: [
          '确认比赛最新规则与 AI 使用要求',
          '每个问题都有可复算的结果',
          '核对单位、约束与误差',
          '检查引用来源及数据授权',
          '检查匿名信息、页数与提交文件',
        ].map((text, i) => ({ id: String(i), text, done: true })),
        alternatives: [
          { id: 'lp', name: '线性规划 + 优先级约束', score: '响应时间最优', risks: '需求预测误差需做灵敏度分析' },
          { id: 'heuristic', name: '启发式备用方案', score: '可快速复核', risks: '全局最优性需要额外验证' },
        ],
        evidence: [
          { id: 'e1', claim: '四个服务区的需求量口径一致', source: 'data/应急资源需求.csv', checked: true },
          { id: 'e2', claim: '重点区域最低保障量满足约束', source: 'results/模型摘要.md', checked: true },
          { id: 'e3', claim: '需求增加 5% 可行，增加 10% 供给不足', source: 'results/metrics.json', checked: true },
        ],
      };
      fs.mkdirSync(path.join(project.root, '.mathmodel'), { recursive: true });
      fs.writeFileSync(path.join(project.root, '.mathmodel', 'competition.json'), JSON.stringify(competitionConfig, null, 2), 'utf8');
      // 通过实际 IPC 再保存一次，确保比赛资料库索引与项目目录副本同时更新。
      const competitionState = await evaluate(`window.mathmodel.competition.ensureProject(${JSON.stringify(project.id)})`);
      if (competitionState?.projects?.some((item) => item.id === project.id)) {
        await evaluate(`window.mathmodel.competition.saveProject(${JSON.stringify(competitionConfig)})`);
      }
      const session = await evaluate(`window.mathmodel.session.create(${JSON.stringify(project.id)}, ${JSON.stringify('城市应急资源调度 · 从题意到论文')})`);
      if (!session?.id) return { projectId: project.id, sessionId: null, title: projectName };

      // better-sqlite3 必须使用与 Electron 相同的 ABI；用项目自带 Electron
      // 子进程写入隔离数据库，避免系统 Node 直接加载原生模块失败。
      const dbPath = path.join(USER_DATA, 'mmodels.db');
      const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
      const seeder = path.join(ROOT, 'scripts', 'seed-site-case.cjs');
      const seed = spawnSync(
        electron,
        [seeder, dbPath, session.id, project.id],
        { env: { ...env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' }, encoding: 'utf8', windowsHide: true, timeout: 15_000, killSignal: 'SIGTERM' },
      );
      if (seed.error || seed.signal || seed.status !== 0) throw new Error(seed.stderr || seed.stdout || seed.error?.message || '官网案例数据初始化失败');
      return { projectId: project.id, sessionId: session.id, title: projectName, vip: vipStatus?.plan === 'vip' };
    };

    const caseStudy = (vipEmail && vipPassword) ? await prepareCaseStudy() : null;
    if (vipEmail && vipPassword && !caseStudy?.sessionId) {
      throw new Error('VIP 案例会话创建失败，已终止截图');
    }
    if (caseStudy?.sessionId) {
      // 重新载入一次，让项目名、会话、消息和工作流从真实数据库走正常启动链路。
      await send('Page.reload');
      await sleep(1600);
      await hideStartupOverlays();
      await forceLightTheme();
      await sleep(350);
    }

    // 公开官网素材只保留“VIP”能力状态，不公开账号名、积分余额或具体到期日。
    // 这是截图阶段的临时 DOM 脱敏，不会改写隔离数据库或应用源码。
    const redactPrivateAccount = async () => {
      if (!vipEmail) return;
      const knownUsername = String(vipStatus?.username || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await evaluate(`(() => {
        const username = ${JSON.stringify(knownUsername)};
        const replaceText = (node) => {
          if (!node || !node.textContent) return;
          let text = node.textContent;
          if (username) text = text.replace(new RegExp(username, 'gi'), '演示会员');
          text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi, '演示账号');
          text = text.replace(/\\d{4}-\\d{2}-\\d{2}/g, '长期会员');
          text = text.replace(/剩余?\\s*\\d+\\s*天/g, '长期会员');
          text = text.replace(/可用积分：\\s*\\d+\\s*分/g, '积分余额：已隐藏');
          node.textContent = text;
        };
        document.querySelectorAll('.rail-account-name').forEach((el) => { el.textContent = '演示会员'; });
        document.querySelectorAll('.rail-account-points').forEach((el) => { el.textContent = '积分'; });
        document.querySelectorAll('.account-section, .membership-dialog, .rail-account').forEach((root) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const nodes = [];
          while (walker.nextNode()) nodes.push(walker.currentNode);
          nodes.forEach(replaceText);
        });
        // 会员中心里积分和剩余天数是结构化数值，不一定会经过上面的文本节点
        // 规则；官网素材只需要展示“已开通 VIP”，不能暴露账号余额或有效期。
        const membership = document.querySelector('.membership-dialog');
        if (membership) {
          const pointValue = membership.querySelector('.membership-stat-value.is-points');
          if (pointValue) pointValue.textContent = '积分';
          const statValues = membership.querySelectorAll('.membership-stat-value');
          if (statValues[1]) statValues[1].textContent = '长期会员';
          membership.querySelectorAll('.membership-stat-sub, .membership-status, .membership-dialog *').forEach((el) => {
            if (el.children.length === 0 && /\d{3,5}\s*天|\b\d{2,5}\b/.test(el.textContent || '')) {
              el.textContent = (el.textContent || '').replace(/\d{4}-\d{2}-\d{2}/g, '长期会员').replace(/\d{3,5}\s*天/g, '长期会员');
            }
          });
        }
        // 预设未配置 API 时，隔离环境可能沿用默认模型名；官网素材统一显示
        // “DeepSeek 演示模型”，只改截图 DOM，不发起请求也不改真实配置。
        document.querySelectorAll('.composer, .composer-shell, .composer-box').forEach((root) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const nodes = [];
          while (walker.nextNode()) nodes.push(walker.currentNode);
          nodes.forEach((node) => { node.textContent = (node.textContent || '').replace(/claude[-\\w…]*/gi, 'DeepSeek 演示模型'); });
        });
        // 部分版本把模型标签挂在 composer 外层；只改公开截图的叶子文本，
        // 避免暴露隔离环境中的默认供应商名称。
        const allText = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const allNodes = [];
        while (allText.nextNode()) allNodes.push(allText.currentNode);
        allNodes.forEach((node) => {
          if (node.parentElement?.closest('.membership-dialog')) return;
          node.textContent = (node.textContent || '').replace(/claude(?:[-\\w…]|\\.\\.\\.)*/gi, 'DeepSeek 演示模型');
        });
        return true;
      })()`);
    };
    const neutralizeVipCopyForHomepage = async () => evaluate(`(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((node) => {
        if (!node.nodeValue || !node.parentElement) return;
        const style = getComputedStyle(node.parentElement);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        node.nodeValue = node.nodeValue.replace(/VIP(?:无限)?/gi, '增强能力');
      });
      return true;
    })()`);

    const route = async (name, section = null) => {
      if (name === 'settings') {
        await evaluate(`window.dispatchEvent(new CustomEvent('mm:open-settings',{detail:{section:${JSON.stringify(section)}}}))`);
      } else {
        await evaluate(`window.dispatchEvent(new CustomEvent('mm:open-route',{detail:{route:${JSON.stringify(name)}${section ? `,section:${JSON.stringify(section)}` : ''}}}))`);
      }
      await sleep(700);
    };
    const waitFor = async (selector, timeout = 7000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        if (await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; })()`)) return true;
        await sleep(180);
      }
      return false;
    };
    const waitForImage = async (selector, timeout = 12_000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        if (await evaluate(`(() => { const img = document.querySelector(${JSON.stringify(selector)}); return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0; })()`)) return true;
        await sleep(180);
      }
      return false;
    };
    const loadGalleryThumbs = async () => {
      const scroll = '.gallery-scroll';
      const before = await evaluate(`(() => { const root = document.querySelector(${JSON.stringify(scroll)}); return root ? { total: root.querySelectorAll('.gallery-card img').length, loaded: [...root.querySelectorAll('.gallery-card img')].filter((img) => img.complete && img.naturalWidth > 0).length } : { total: 0, loaded: 0 }; })()`);
      for (let i = 0; i < 24; i += 1) {
        await evaluate(`(() => { const root = document.querySelector(${JSON.stringify(scroll)}); if (!root) return false; root.scrollTop = Math.min(root.scrollHeight, Math.round((root.scrollHeight - root.clientHeight) * ${i / 23})); return true; })()`);
        await sleep(180);
      }
      await evaluate(`(() => { const root = document.querySelector(${JSON.stringify(scroll)}); if (root) root.scrollTop = 0; return true; })()`);
      await sleep(350);
      const after = await evaluate(`(() => { const root = document.querySelector(${JSON.stringify(scroll)}); return root ? { total: root.querySelectorAll('.gallery-card img').length, loaded: [...root.querySelectorAll('.gallery-card img')].filter((img) => img.complete && img.naturalWidth > 0).length } : { total: 0, loaded: 0 }; })()`);
      console.log(`[site-shots] 图表缩略图加载：${before.loaded}/${before.total} → ${after.loaded}/${after.total}`);
      return after;
    };
    const screenshot = async (name, selector = null) => {
      try {
        if (selector && !(await waitFor(selector))) throw new Error(`页面未出现 ${selector}`);
        await redactPrivateAccount();
        await sleep(250);
        const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const outPath = path.join(OUT, `${name}.png`);
        fs.writeFileSync(outPath, Buffer.from(image.data, 'base64'));
        fs.copyFileSync(outPath, path.join(DOCS_OUT, `${name}.png`));
        currentFiles.push(`${name}.png`);
        console.log(`[site-shots] ${name}.png`);
      } catch (error) {
        failures.push(`${name}: ${error.message}`);
        console.warn(`[site-shots] 跳过 ${name}：${error.message}`);
      }
    };
    const screenshotClip = async (name, selector) => {
      const rect = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && r.width && r.height ? {x:r.left,y:r.top,width:r.width,height:r.height} : null; })()`);
      if (!rect) throw new Error(`工作流裁切区域不存在：${selector}`);
      await redactPrivateAccount();
      const image = await send('Page.captureScreenshot', {format:'png',captureBeyondViewport:false,clip:{...rect,scale:1}});
      const outPath = path.join(OUT, `${name}.png`);
      fs.writeFileSync(outPath, Buffer.from(image.data, 'base64'));
      fs.copyFileSync(outPath, path.join(DOCS_OUT, `${name}.png`));
      currentFiles.push(`${name}.png`);
      console.log(`[site-shots] ${name}.png`);
    };

    // 官网素材不能泄露开发机盘符、用户名或安装目录；这些信息只对本机诊断有用，
    // 对访客没有展示价值。只处理扩展详情里的叶子文本，不改变应用本身的数据。
    const sanitizeExtensionPaths = async () => evaluate(`(() => {
      const detail = document.querySelector('.ext-detail');
      if (!detail) return 0;
      let replaced = 0;
      for (const node of detail.querySelectorAll('.ext-field-value.mono')) {
        const text = node.textContent || '';
        if (/^[A-Za-z]:[\\\\/]|\\\\|\\/Users\\//.test(text)) {
          node.textContent = '内置资源目录（随应用提供）';
          replaced += 1;
        }
      }
      return replaced;
    })()`);

    await route('chat');
    // 先截一张“刚打开、还没有对话”的整体工作台，作为官网首屏主视觉。
    // VIP 隔离项目里新建一个空会话，只展示布局和入口，不发送任何请求。
    if (caseStudy?.projectId) {
      const idle = await evaluate(`window.mathmodel.session.create(${JSON.stringify(caseStudy.projectId)}, ${JSON.stringify('新题目 · 待开始')})`);
      await sleep(500);
      if (idle?.id) {
        await evaluate(`(() => { const item = [...document.querySelectorAll('[title]')].find((el) => el.getAttribute('title') === ${JSON.stringify('新题目 · 待开始')}); if (item) { item.click(); return true; } const text = [...document.querySelectorAll('button, [role="button"]')].find((el) => (el.textContent || '').includes('新题目 · 待开始')); if (text) { text.click(); return true; } return false; })()`);
        await sleep(700);
      }
    }
    await neutralizeVipCopyForHomepage();
    await screenshot('workspace-idle', '.chat-page');
    if (caseStudy?.sessionId) {
      // 重新载入后从侧栏选中样例会话，走真实的会话加载链路，确保截图里
      // 看到的是数据库里的对话记录，而不是脚本拼出的静态 DOM。
      await evaluate(`(() => {
        const item = [...document.querySelectorAll('[title]')].find((el) => el.getAttribute('title') === ${JSON.stringify('城市应急资源调度 · 从题意到论文')});
        if (item) { item.click(); return true; }
        const text = [...document.querySelectorAll('button, [role="button"]')].find((el) => (el.textContent || '').includes('城市应急资源调度'));
        if (text) { text.click(); return true; }
        return false;
      })()`);
      await sleep(900);
    }
    await screenshot('workspace-chat', '.chat-page');

    // 对话内的 Mermaid 图由真实应用渲染，展示完整技术路线。
    await evaluate(`(() => { const el = document.querySelector('.md-mermaid'); el?.scrollIntoView({block:'center'}); return !!el; })()`);
    await sleep(900);
    await screenshot('conversation-flowchart', '.md-mermaid');

    if (caseStudy?.sessionId) {
      // 同一个真实会话再切到工作流视图，展示成员分工、技能调用和有向关系。
      await evaluate(`(() => {
        const buttons = [...document.querySelectorAll('.workflow-switch button')];
        const workflow = buttons.find((el) => (el.textContent || '').includes('工作流')) || buttons[1];
        if (!workflow) return false;
        workflow.click();
        return true;
      })()`);
      await sleep(800);
      await evaluate(`(() => { const b=[...document.querySelectorAll('.workflow-view-switch button')].find(x=>x.textContent.includes('分析')); b?.click(); return !!b; })()`);
      await sleep(600);
      await evaluate(`document.querySelector('[aria-label="适应画布"]')?.click()`);
      await sleep(400);
      await screenshot('workflow-case', '.workflow-view');
      // 独立高清画布：扩大真实应用视口后重新适应画布，保留所有成员与连线。
      await send('Emulation.setDeviceMetricsOverride', {width:3000,height:2000,deviceScaleFactor:2,mobile:false});
      await sleep(600);
      await evaluate(`document.querySelector('[aria-label="适应画布"]')?.click()`);
      await sleep(500);
      await screenshotClip('workflow-large', '.flow-world');
      await send('Emulation.setDeviceMetricsOverride', {width:1440,height:900,deviceScaleFactor:1,mobile:false});
      await sleep(400);
      await evaluate(`document.querySelector('[aria-label="适应画布"]')?.click()`);
      await evaluate(`(() => { const b=[...document.querySelectorAll('.workflow-node')].find(x=>x.textContent.includes('求解')); b?.click(); return !!b; })()`);
      await sleep(500);
      await screenshot('workflow-details', '.workflow-detail');
      await evaluate(`(() => {
        const buttons = [...document.querySelectorAll('.workflow-switch button')];
        const chat = buttons.find((el) => (el.textContent || '').includes('对话')) || buttons[0];
        if (chat) chat.click();
        return !!chat;
      })()`);
      await sleep(300);
    }

    // 编辑器视图是当前版本的重要卖点：用真实菜单进入，确保官网素材能看到
    // 文件树、代码区和贴近右下角的对话框，而不是只截普通对话首页。
    await evaluate(`(() => {
      const more = document.querySelector('[aria-label="更多任务操作"]');
      if (!more) return false;
      more.click();
      return true;
    })()`);
    await waitFor('[role="menu"]');
    await evaluate(`(() => {
      const item = [...document.querySelectorAll('[role="menuitemcheckbox"]')]
        .find((el) => (el.textContent || '').includes('编辑器视图'));
      if (!item) return false;
      item.click();
      return true;
    })()`);
    await sleep(800);
    // 选中案例中的题目说明，让编辑器中间栏展示真实文件内容而不是空状态。
    if (caseStudy?.sessionId) {
      await evaluate(`(() => {
        const file = [...document.querySelectorAll('.file-row, .file-row-name, [role="treeitem"]')]
          .find((el) => (el.textContent || '').trim().includes('题目说明.md'));
        if (file) { file.click(); return true; }
        return false;
      })()`);
      await sleep(450);
    }
    await screenshot('editor-view', '.editorview-chatcol');
    for (const [fileName, shotName] of [['建模路线.md','editor-flowchart'],['模型结果报告.md','results-report']]) {
      await evaluate(`(() => { const el=[...document.querySelectorAll('.file-row')].find(x=>x.textContent.includes(${JSON.stringify(fileName)})); el?.click(); return !!el; })()`);
      await sleep(1200);
      await screenshot(shotName, '.editorview-chatcol');
    }
    // 后续截图回到普通应用布局，避免编辑器模式遮住工作台路由。
    await evaluate(`(() => {
      const exit = document.querySelector('[title="退出编辑器"]');
      if (!exit) return false;
      exit.click();
      return true;
    })()`);
    await sleep(500);

    await route('workbench');
    await screenshot('competition-workbench', '.studio-workbench');

    await route('settings', 'datasets');
    await screenshot('chart-gallery', '.data-chart-studio');
    await evaluate(`(() => { const b=[...document.querySelectorAll('.data-chart-tabs button')].find(x=>x.textContent.includes('当前项目')); b?.click(); return !!b; })()`);
    await sleep(600);
    await screenshot('project-data', '.data-chart-studio');

    await route('extensions', 'skills');
    await evaluate(`(() => { const style=document.createElement('style'); style.id='mm-site-extension-fit'; style.textContent='.ext-page{height:100%!important;display:flex!important;flex-direction:column!important}.ext-layout{height:100%!important;min-height:0!important;display:grid!important;grid-template-columns:300px minmax(0,1fr)!important;grid-template-rows:auto minmax(0,1fr)!important}.ext-nav{grid-column:1 / -1!important;grid-row:1!important}.ext-list{grid-column:1!important;grid-row:2!important;min-height:0!important}.ext-detail{grid-column:2!important;grid-row:2!important;min-height:0!important}'; document.head.appendChild(style); return true; })()`);
    await sleep(800);
    await evaluate(`(() => { const item = document.querySelector('.ext-item'); if (item) item.click(); return !!item; })()`);
    await sleep(500);
    await sanitizeExtensionPaths();
    await screenshot('skills-detail', '.ext-page');

    await route('extensions', 'templates');
    await sleep(800);
    await evaluate(`(() => { const item = document.querySelector('.ext-item'); if (item) item.click(); return !!item; })()`);
    await sleep(500);
    await sanitizeExtensionPaths();
    await screenshot('templates-detail', '.ext-page');

    await route('settings', 'providers');
    await screenshot('providers-grid', '.settings-shell');

    // 直接请求“使用统计”分区，避免设置导航的折叠状态影响截图。
    await route('settings', 'profile');
    // 某些冷启动时 React 需要一轮渲染才会挂载设置导航；补一次可见导航点击作为兜底。
    await evaluate(`(() => {
      const button = document.querySelector('[data-section="profile"]');
      if (button) { button.click(); return true; }
      const group = [...document.querySelectorAll('.settings-nav-group-head')].find((el) => (el.textContent || '').includes('外观与帮助'));
      if (group) group.click();
      return false;
    })()`);
    await sleep(500);
    await evaluate(`(() => { const button = document.querySelector('[data-section="profile"]'); if (button) button.click(); return !!button; })()`);
    await sleep(650);
    await screenshot('usage-statistics');

    await route('settings', 'account');
    await screenshot('membership-account', '.account-section');
    // 另截一张会员中心权益/卡密入口，官网不只展示设置页的状态摘要。
    await evaluate(`(() => {
      // 启动阶段的清理样式会隐藏所有 modal-backdrop；会员中心是本次要展示的
      // 正常应用弹窗，先移除清理样式，再只隐藏首启引导层。
      document.querySelector('#mm-site-shot-cleanup')?.remove();
      document.querySelectorAll('.first-run-shell, .ob-card').forEach((el) => {
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      });
      // 顶层事件在不同设置路由都可用，避免依赖 SettingsPage 内部的局部弹窗状态。
      window.dispatchEvent(new CustomEvent('mm:open-membership',{detail:'plans'}));
      return true;
    })()`);
    if (await waitFor('.membership-dialog', 5000)) {
      await sleep(450);
      await screenshot('membership-center', '.membership-dialog');
      await evaluate(`(() => {
        const close = document.querySelector('.membership-dialog [aria-label="关闭"], .membership-dialog button[title="关闭"]');
        if (close) { close.click(); return true; }
        return false;
      })()`);
    } else {
      failures.push('membership-center: 页面未出现 .membership-dialog');
      console.warn('[site-shots] 跳过 membership-center：页面未出现 .membership-dialog');
    }

    /**
     * 扩展官网素材：每一张都是当前打包版真实页面状态，统一在同一份
     * VIP 隔离会话中截取。这里刻意按功能入口逐项取证，避免用一张总图
     * 代表多个能力；素材目录最终保持 50--60 张，方便官网功能清单逐项引用。
     */
    const clickText = async (selector, pattern) => evaluate(`(() => {
      const re = new RegExp(${JSON.stringify(pattern)}, 'i');
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(x => re.test(x.textContent || '') || re.test(x.getAttribute('title') || '') || re.test(x.getAttribute('aria-label') || ''));
      if (!el) return false; el.click(); return true;
    })()`);
    const clickTitle = async (pattern) => evaluate(`(() => {
      const re = new RegExp(${JSON.stringify(pattern)}, 'i');
      const el = [...document.querySelectorAll('button,[role="button"]')].find(x => re.test(x.getAttribute('title') || '') || re.test(x.getAttribute('aria-label') || ''));
      if (!el) return false; el.click(); return true;
    })()`);
    const extra = async (name, selector = null, delay = 450) => { await sleep(delay); await screenshot(name, selector); };

    // 对话输入区：项目、附件、技能、模板、模型、决策、权限、深度、上下文。
    await route('chat');
    for (const [name, pattern] of [
      ['chat-project-menu', '项目'], ['chat-plus-menu', '添加附件|更多内容'], ['chat-model-menu', '模型'],
      ['chat-decision-menu', '决策'], ['chat-quality-menu', '任务深度|建模质量'], ['chat-permission-menu', '权限'],
      ['chat-template-menu', '模板'], ['chat-context-menu', '上下文用量'],
    ]) {
      await clickTitle(pattern); await extra(name, null, 350); await clickText('.cz-pop button,.popover button', '关闭|取消');
    }
    await clickText('button', '比赛信息'); await extra('chat-paper-setup', '.modal-backdrop', 500);
    await clickText('button', '取消|关闭');
    await evaluate(`(() => { const el=document.querySelector('textarea'); if (!el) return false; el.focus(); return true; })()`);
    await send('Input.insertText', { text: '#' }).catch(() => {});
    // 不同打包版本可能把 # 面板命名为 hash-pop 或直接显示在输入层；
    // 保留当前可见输入状态，避免因选择器差异丢失这一张素材。
    await extra('chat-task-palette', null, 500);

    // 工作流：演示、分析、成员详情和阶段记录。
    await route('chat');
    await clickText('.workflow-switch button', '工作流'); await sleep(800);
    await extra('workflow-demo', '.workflow-view', 300);
    await clickText('.workflow-view-switch button', '分析'); await clickTitle('适应画布');
    await extra('workflow-analysis', '.workflow-view', 350);
    await clickText('.workflow-node', '数据|求解'); await extra('workflow-member-detail', '.workflow-detail', 450);

    // 竞赛工作台的概要与详情。
    await route('workbench'); await extra('competition-workbench-overview', '.studio-workbench', 500);
    await clickText('button,[role="button"]', '详情|比赛信息|检查'); await extra('competition-workbench-detail', null, 400);

    // 数据绘图：先把推荐库的懒加载缩略图滚动到全部完成，再逐张打开灯箱。
    // 旧流程只截到页面壳，图表还没完成加载就保存了 PNG；这里把“可见、已解码”
    // 作为截图前置条件，并跨每个主要绘图类目各取一张，保留真实应用的图表说明。
    await route('settings', 'datasets'); await extra('data-gallery-overview', '.data-chart-studio', 500);
    await loadGalleryThumbs();
    const chartCaptures = [
      ['标准流程图参考', 'chart-process-flow'],
      ['频数直方图', 'chart-histogram'],
      ['分组箱线图', 'chart-boxplot'],
      ['散点图基础', 'chart-scatter'],
      ['曲线误差带', 'chart-error-band'],
      ['相关系数与敏感性矩阵', 'chart-correlation-heatmap'],
      ['连续时间序列', 'chart-time-series'],
      ['预测区间与置信带', 'chart-confidence-band'],
      ['方案指标横向比较', 'chart-bar-comparison'],
      ['成本收益瀑布图', 'chart-waterfall'],
      ['多指标方案画像', 'chart-radar'],
      ['能量与资源流向', 'chart-sankey'],
      ['任务时间排程图', 'chart-gantt'],
      ['等高线图', 'chart-contour'],
      ['三维曲面', 'chart-surface-3d'],
      ['分类结果混淆矩阵', 'chart-confusion-matrix'],
      ['多层指标分解', 'chart-sunburst'],
      ['网络关系与关键节点', 'chart-network'],
    ];
    for (const [title, name] of chartCaptures) {
      const clicked = await evaluate(`(() => {
        const card = [...document.querySelectorAll('.gallery-card')].find((el) => (el.querySelector('.gallery-card-title')?.textContent || '').trim() === ${JSON.stringify(title)});
        if (!card) return false;
        card.scrollIntoView({ block: 'center' });
        card.click();
        return true;
      })()`);
      if (!clicked) {
        failures.push(`${name}: 未找到图表卡片「${title}」`);
        continue;
      }
      if (!(await waitForImage('.gallery-dialog .gallery-stage-img'))) {
        failures.push(`${name}: 灯箱图表未完成解码`);
        await evaluate(`document.querySelector('.gallery-close')?.click()`);
        continue;
      }
      await sleep(650);
      await screenshot(name, '.gallery-dialog');
      await evaluate(`document.querySelector('.gallery-close')?.click()`);
      await sleep(250);
    }
    // 官网还需要“按大类直接看整页”的素材：每张图都保留软件原有的
    // 多卡片预览，不把一个类目缩成单张代表图。逐类目等待当前网格内的
    // 缩略图全部解码后再截图，访客可以看见该类目下的完整预览集合。
    const galleryCategories = [
      ['建模流程图', 'gallery-category-process'],
      ['数据探索与分布', 'gallery-category-distribution'],
      ['变量关系与拟合', 'gallery-category-relation'],
      ['相关与矩阵', 'gallery-category-matrix'],
      ['趋势与预测', 'gallery-category-trend'],
      ['比较与构成', 'gallery-category-comparison'],
      ['综合评价与决策', 'gallery-category-evaluation'],
      ['网络与资源流向', 'gallery-category-network'],
      ['等高线、场与三维', 'gallery-category-surface'],
      ['层级与分解', 'gallery-category-hierarchy'],
    ];
    for (const [category, name] of galleryCategories) {
      const selected = await evaluate(`(() => { const chip = [...document.querySelectorAll('.gallery-chip')].find((el) => (el.textContent || '').trim().startsWith(${JSON.stringify(category)})); if (!chip) return false; chip.click(); return true; })()`);
      if (!selected) {
        failures.push(`${name}: 未找到绘图类目「${category}」`);
        continue;
      }
      await sleep(450);
      await loadGalleryThumbs();
      await screenshot(name, '.data-chart-studio');
    }
    await evaluate(`(() => { const chip = [...document.querySelectorAll('.gallery-chip')].find((el) => (el.textContent || '').trim().startsWith('全部')); if (chip) chip.click(); return true; })()`);
    await sleep(350);
    await clickText('.data-chart-tabs button', '数据绘图'); await extra('data-plot-panel', '.data-chart-studio', 600);
    await clickText('.data-chart-tabs button', '当前项目'); await extra('data-project-files', '.data-chart-studio', 450);

    // 扩展中心五个分区，均进入真实条目详情。
    for (const tab of ['skills', 'templates', 'algorithms', 'plugins', 'connectors']) {
      await route('extensions', tab); await sleep(850);
      await clickText('.ext-item', '.+');
      await extra(`extension-${tab}`, '.ext-page', 450);
    }

    // 设置中的完整功能分区。
    for (const section of ['account', 'competitions', 'paper', 'quality', 'model', 'providers', 'chat', 'sysprompt', 'env', 'network', 'automation', 'notify', 'appearance', 'profile', 'about']) {
      await route('settings', section);
      await extra(`settings-${section}`, '.settings-shell', 420);
    }
    // 自动化编辑态与论文库/竞赛详情态再各取一张，覆盖“可操作状态”。
    await route('settings', 'automation'); await clickText('button', '新建|创建任务'); await extra('automation-editor', '.auto-page', 500);
    await route('papers'); await extra('paper-library', '.studio-page', 500);
    await clickText('button', '上传优秀论文|上传'); await extra('paper-upload-dialog', '.modal-backdrop', 450);
    await clickText('button', '取消|关闭');

    // 终端面板和文件面板属于工作台底层能力，各单独保留画面。
    await route('chat'); await clickTitle('更多任务操作'); await clickText('[role="menuitemcheckbox"]', '终端|编辑器视图');
    await sleep(700); await extra('terminal-or-editor-panel', null, 300);
    await evaluate(`(() => { document.querySelector('[title="退出编辑器"]')?.click(); return true; })()`); await sleep(400);

    // 记录截图清单，官网和后续接手者可快速判断素材是否来自当前版本。
    const manifest = {
      generatedAt: new Date().toISOString(),
      // 清单会随官网源码一起提交，不记录开发机的绝对路径。
      app: path.relative(ROOT, APP).replace(/\\/g, '/'),
      viewport: { width: 1440, height: 900 },
      files: currentFiles.sort(),
      authenticatedVip: vipStatus?.plan === 'vip',
      caseType: 'synthetic local solver results; curated conversation and workflow replay',
      failures,
    };
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(DOCS_OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    cdp.close();
    child.kill();
    if (failures.length) {
      console.warn(`[site-shots] 完成，但有 ${failures.length} 项未生成；其余截图仍可使用。`);
      process.exitCode = 2;
    } else {
      console.log('[site-shots] 全部关键页面截图完成。');
    }
  } finally {
    try { child.kill(); } catch { /* ignore */ }
    // Windows 可能在 kill 返回后仍短暂持有 userData 文件；等待退出一小段时间，
    // 再清理隔离目录，避免临时令牌残留或下一次截图遇到锁文件。
    if (child && child.exitCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    // 临时 userData 可能包含登录令牌；截图结束后立即清理，避免凭证残留在系统临时目录。
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((error) => {
  console.error('[site-shots] 失败：', error.message);
  process.exit(1);
});
