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

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const APP = process.env.MATHMODEL_SITE_APP || path.join(ROOT, 'dist', 'win-unpacked', 'MModels.exe');
const PORT = Number(process.env.MATHMODEL_SITE_PORT || 9367);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-site-shots-'));
const USER_DATA = path.join(SANDBOX, 'userdata');
const OUT = path.join(ROOT, 'out', 'site-shots');
const DOCS_OUT = path.join(ROOT, 'docs', 'assets', 'screenshots', 'site');
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
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SAFE_DELETE;

  const child = spawn(APP, [
    `--remote-debugging-port=${PORT}`,
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
    await evaluate(`(() => {
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
    await sleep(450);

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
        if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return true;
        await sleep(180);
      }
      return false;
    };
    const screenshot = async (name, selector = null) => {
      try {
        if (selector && !(await waitFor(selector))) throw new Error(`页面未出现 ${selector}`);
        await sleep(250);
        const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const outPath = path.join(OUT, `${name}.png`);
        fs.writeFileSync(outPath, Buffer.from(image.data, 'base64'));
        fs.copyFileSync(outPath, path.join(DOCS_OUT, `${name}.png`));
        console.log(`[site-shots] ${name}.png`);
      } catch (error) {
        failures.push(`${name}: ${error.message}`);
        console.warn(`[site-shots] 跳过 ${name}：${error.message}`);
      }
    };

    await route('chat');
    await screenshot('workspace-chat', '.chat-page');

    await route('workbench');
    await screenshot('competition-workbench', '.studio-workbench');

    await route('extensions', 'skills');
    await evaluate(`(() => { const style=document.createElement('style'); style.id='mm-site-extension-fit'; style.textContent='.ext-page{height:100%!important;display:flex!important;flex-direction:column!important}.ext-layout{height:100%!important;min-height:0!important;display:grid!important;grid-template-columns:300px minmax(0,1fr)!important;grid-template-rows:auto minmax(0,1fr)!important}.ext-nav{grid-column:1 / -1!important;grid-row:1!important}.ext-list{grid-column:1!important;grid-row:2!important;min-height:0!important}.ext-detail{grid-column:2!important;grid-row:2!important;min-height:0!important}'; document.head.appendChild(style); return true; })()`);
    await sleep(800);
    await evaluate(`(() => { const item = document.querySelector('.ext-item'); if (item) item.click(); return !!item; })()`);
    await sleep(500);
    await screenshot('skills-detail', '.ext-page');

    await route('extensions', 'templates');
    await sleep(800);
    await evaluate(`(() => { const item = document.querySelector('.ext-item'); if (item) item.click(); return !!item; })()`);
    await sleep(500);
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

    // 记录截图清单，官网和后续接手者可快速判断素材是否来自当前版本。
    const manifest = {
      generatedAt: new Date().toISOString(),
      // 清单会随官网源码一起提交，不记录开发机的绝对路径。
      app: path.relative(ROOT, APP).replace(/\\/g, '/'),
      viewport: { width: 1440, height: 900 },
      files: fs.readdirSync(OUT).filter((file) => file.endsWith('.png')).sort(),
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
  }
}

main().catch((error) => {
  console.error('[site-shots] 失败：', error.message);
  process.exit(1);
});
