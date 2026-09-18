/**
 * 局域网协作面板 · 真机渲染冒烟（CDP 截图）
 *
 * 跑打包产物 `dist/win-unpacked/MModels.exe`（没有则退回 out/ 构建），
 * 打开「局域网协作」面板并截图，验证：
 *   ① 面板能渲染出来（不白屏、不报错）
 *   ② 点「开始局域网协作」后真的起房 —— 面板上出现本机地址与 6 位加入码
 *
 * 用法：node scripts/shoot-collab.cjs
 * 产出：out/shots/collab-idle.png、out/shots/collab-hosting.png、out/shots/collab-log.txt
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKED = path.join(ROOT, 'dist', 'win-unpacked', 'MModels.exe');
const DEV = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9355;
const OUT = path.join(ROOT, 'out', 'shots');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-collab-'));
const trace = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForBrowserWs(ref, timeoutMs = 60_000) {
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
      const msg = JSON.parse(String(data));
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    });
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        send: (method, params, sessionId) =>
          new Promise((res, rej) => {
            const mid = ++id;
            pending.set(mid, { res, rej });
            ws.send(JSON.stringify({ id: mid, method, params: params ?? {}, sessionId }));
          }),
        close: () => ws.close(),
      }),
    );
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const usePacked = fs.existsSync(PACKED) && process.env.MM_SHOOT_DEV !== '1';
  const bin = usePacked ? PACKED : DEV;
  const args = usePacked
    ? [`--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`, '--disable-gpu', '--no-sandbox']
    : ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`, '--disable-gpu', '--no-sandbox'];
  trace.push(`启动：${usePacked ? '打包产物' : 'out/ 构建'}`);

  const env = {};
  for (const k of Object.keys(process.env)) {
    if (/ELECTRON_RUN_AS_NODE|SAFE_DELETE|NODE_OPTIONS/i.test(k)) continue;
    env[k] = process.env[k];
  }
  env.NODE_OPTIONS = '';
  env.MATHMODEL_E2E = '1';

  const ref = { text: '', t0: Date.now() };
  const child = spawn(bin, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => (ref.text += d.toString()));

  try {
    const wsUrl = await waitForBrowserWs(ref);
    trace.push('DevTools 就绪');
    const cdp = await connect(wsUrl);
    const { targetInfos } = await cdp.send('Target.getTargets');
    const page = targetInfos.find((t) => t.type === 'page');
    if (!page) throw new Error('找不到渲染层页面');
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId: page.targetId,
      flatten: true,
    });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await sleep(4_000);

    // 关掉首次运行向导/引导遮罩，点开顶栏的「局域网协作」
    const opened = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(() => {
          document.querySelectorAll('.modal-backdrop').forEach((el) => {
            if (!el.querySelector('.collab-modal')) {
              el.style.setProperty('visibility', 'hidden', 'important');
              el.style.setProperty('pointer-events', 'none', 'important');
            }
          });
          const btn = [...document.querySelectorAll('.topbar-action')]
            .find((b) => (b.title || '').includes('协作'));
          if (!btn) return 'no-button';
          btn.click();
          return 'clicked';
        })()`,
        returnByValue: true,
      },
      sessionId,
    );
    trace.push('打开面板：' + JSON.stringify(opened.result?.value));
    await sleep(1_500);

    const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(path.join(OUT, 'collab-idle.png'), Buffer.from(shot1.data, 'base64'));
    trace.push('已截图 collab-idle.png');

    // 点「开始局域网协作」→ 应看到本机地址 + 6 位加入码
    const started = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(() => {
          const btn = [...document.querySelectorAll('.collab-modal button')]
            .find((b) => b.textContent.trim() === '开始局域网协作');
          if (!btn) return 'no-start-button';
          btn.click();
          return 'started';
        })()`,
        returnByValue: true,
      },
      sessionId,
    );
    trace.push('点开始：' + JSON.stringify(started.result?.value));
    await sleep(2_500);

    const state = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(() => {
          const modal = document.querySelector('.collab-modal');
          if (!modal) return { modal: false };
          return {
            modal: true,
            title: (modal.querySelector('.modal-title')?.textContent ?? '').trim(),
            address: (modal.querySelector('.collab-code')?.textContent ?? '').trim(),
            code: (modal.querySelector('.collab-code-lg')?.textContent ?? '').trim(),
            strong: [...modal.querySelectorAll('.collab-strong')].map((e) => e.textContent.trim()),
            error: (modal.querySelector('.collab-error')?.textContent ?? '').trim() || null,
          };
        })()`,
        returnByValue: true,
      },
      sessionId,
    );
    trace.push('面板状态：' + JSON.stringify(state.result?.value));

    const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(path.join(OUT, 'collab-hosting.png'), Buffer.from(shot2.data, 'base64'));
    trace.push('已截图 collab-hosting.png');
    cdp.close();
  } catch (err) {
    trace.push('失败：' + String(err && err.message ? err.message : err));
    trace.push('窗口输出片段：' + ref.text.slice(0, 800));
  } finally {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    fs.writeFileSync(path.join(OUT, 'collab-log.txt'), trace.join('\n'), 'utf8');
    console.log(trace.join('\n'));
    process.exit(trace.some((l) => l.startsWith('失败')) ? 1 : 0);
  }
}

void main();
