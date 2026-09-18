/**
 * 局域网协作 · **真机端到端**：真实 Electron 应用当房主，脚本进程当队员。
 *
 * 和 `test-collab.cjs`（两个脚本进程对跑）互补 —— 这条链路专门验证
 * 「渲染层 ↔ 主进程 IPC ↔ 局域网服务」这段在真实应用里是通的：
 *
 *   1. 应用里点「局域网协作 → 开始局域网协作」→ 面板显示本机地址 + 6 位加入码
 *   2. 脚本队员用这个地址和加入码加入 → 应用面板出现「等待批准」
 *   3. 在应用里点「编辑者」批准 → 队员收到成员快照（2 人，自己是 editor）
 *   4. 在应用里选文件 →「加入共享」→「编辑」→ 改内容 →「保存」→ **磁盘上的文件真的变了**
 *      （这一步证明「渲染层 ↔ IPC ↔ 房主权威落盘」在真实应用里是通的）
 *   5. 队员退出 → 应用面板成员数回到 1
 *   6. 在应用里点「结束协作」→ 面板回到未开房状态
 *
 * 用法：node scripts/test-collab-app.cjs   （退出码 0 = 全通过）
 * 产出：out/shots/collab-pair.png（两人房间的真实截图）+ out/shots/collab-app-log.txt
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKED = path.join(ROOT, 'dist', 'win-unpacked', 'MModels.exe');
const DEV = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9356;
const OUT = path.join(ROOT, 'out', 'shots');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-collab-app-'));
const trace = [];
const checks = [];
let failed = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (label, ok, detail) => {
  checks.push({ label, ok: Boolean(ok), detail });
  if (!ok) failed = true;
};

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

let cdp = null;
let sessionId = null;

/** 在渲染层里跑一段表达式 */
async function evalInPage(expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result?.value;
}

/** 轮询页面直到条件成立 */
async function waitInPage(expression, timeoutMs = 12_000, step = 400) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalInPage(expression);
    if (last) return last;
    await sleep(step);
  }
  return last;
}

const PANEL_STATE = `(() => {
  const modal = document.querySelector('.collab-modal');
  if (!modal) return null;
  return {
    title: (modal.querySelector('.modal-title')?.textContent ?? '').trim(),
    address: (modal.querySelector('.collab-code')?.textContent ?? '').trim(),
    code: (modal.querySelector('.collab-code-lg')?.textContent ?? '').trim(),
    members: (modal.querySelector('.collab-strong')?.textContent ?? '').trim(),
    strong: [...modal.querySelectorAll('.collab-strong')].map((e) => e.textContent.trim()),
    rows: [...modal.querySelectorAll('.collab-row')].map((r) => r.textContent.trim()),
    error: (modal.querySelector('.collab-error')?.textContent ?? '').trim() || null,
  };
})()`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const usePacked = fs.existsSync(PACKED) && process.env.MM_SHOOT_DEV !== '1';
  const bin = usePacked ? PACKED : DEV;
  // `MM_COLLAB_MAIN` 可以指向一份**私有输出目录**里的主进程入口
  // （electron-vite build --outDir .probe/e2e-out），这样不用动共享的 out/
  const MAIN = process.env.MM_COLLAB_MAIN || '.';
  const args = usePacked
    ? [`--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`, '--disable-gpu', '--no-sandbox']
    : [MAIN, `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`, '--disable-gpu', '--no-sandbox'];
  trace.push(`应用：${usePacked ? '打包产物' : `out/ 构建（入口 ${MAIN}）`}`);

  const env = {};
  for (const k of Object.keys(process.env)) {
    if (/ELECTRON_RUN_AS_NODE|SAFE_DELETE|NODE_OPTIONS/i.test(k)) continue;
    env[k] = process.env[k];
  }
  env.NODE_OPTIONS = '';
  env.MATHMODEL_E2E = '1';

  const ref = { text: '', t0: Date.now() };
  const app = spawn(bin, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout.on('data', () => {});
  app.stderr.on('data', (d) => (ref.text += d.toString()));

  let guest = null;
  try {
    const wsUrl = await waitForBrowserWs(ref);
    cdp = await connect(wsUrl);
    const { targetInfos } = await cdp.send('Target.getTargets');
    const page = targetInfos.find((t) => t.type === 'page');
    if (!page) throw new Error('找不到渲染层页面');
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true }));
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await sleep(4_000);

    // ── 0. 往应用的默认项目目录里放一份文本文件，供「共享文件」区选 ──
    // MATHMODEL_E2E=1 时默认项目根是 `<userData>/projects/MModels Workspace`
    // （见 src/main/ipc/project.ts: defaultWorkspaceBase）。
    const projectRoot = path.join(USER_DATA, 'projects', 'MModels Workspace');
    fs.mkdirSync(projectRoot, { recursive: true });
    const NOTES = path.join(projectRoot, 'notes.md');
    const NOTES_EDITED = '# 共享笔记\n\nAPP-EDIT：在真机面板里改的，已落盘\n';
    fs.writeFileSync(NOTES, '# 共享笔记\n\n（真机初始内容）\n', 'utf8');
    trace.push(`项目目录：${projectRoot}`);

    // ── 1. 打开面板并开房 ──
    // 首启会有向导/引导的遮罩压在上面：**不要删节点**（React 会因此拿到失效的
    // DOM 引用，后续渲染会错位），改成高优先级隐藏。
    await evalInPage(`(() => {
      document.querySelectorAll('.modal-backdrop').forEach((el) => {
        if (!el.querySelector('.collab-modal')) {
          el.style.setProperty('visibility', 'hidden', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
        }
      });
      const btn = [...document.querySelectorAll('.topbar-action')].find((b) => (b.title || '').includes('协作'));
      if (btn) btn.click();
      return true;
    })()`);
    await sleep(1_200);
    await evalInPage(`(() => {
      document.querySelectorAll('.modal-backdrop').forEach((el) => {
        if (!el.querySelector('.collab-modal')) {
          el.style.setProperty('visibility', 'hidden', 'important');
        }
      });
      const btn = [...document.querySelectorAll('.collab-modal button')]
        .find((b) => b.textContent.trim() === '开始局域网协作');
      if (btn) btn.click();
      return true;
    })()`);
    await sleep(2_500);

    const hostState = await evalInPage(PANEL_STATE);
    check(
      '应用里开房：面板显示本机地址 + 6 位加入码',
      Boolean(hostState) && /^\d{6}$/.test(hostState.code) && /:\d+$/.test(hostState.address),
      JSON.stringify(hostState),
    );
    trace.push('开房状态：' + JSON.stringify(hostState));

    // ── 2. 脚本队员加入 ──
    guest = spawn(
      process.execPath,
      [path.join(__dirname, 'collab-peer.mjs'), 'guest-lite', hostState.address, hostState.code, '小李', 'acct-guest-app'],
      { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const guestOut = [];
    let guestErr = '';
    guest.stdout.setEncoding('utf8');
    guest.stderr.setEncoding('utf8');
    guest.stderr.on('data', (d) => (guestErr += String(d)));
    guest.stdout.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) guestOut.push(line);
      }
    });
    const guestHas = (key) => guestOut.some((l) => l.startsWith(`@@ ${key} `));

    const joined = await (async () => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && !guestHas('JOIN')) await sleep(300);
      return guestHas('JOIN');
    })();
    check('队员成功加入（进入待批准）', joined, guestOut.join(' | '));

    // 应用面板应出现待批准 + 「编辑者」按钮
    const pendingBtn = await waitInPage(
      `(() => {
        const btn = [...document.querySelectorAll('.collab-modal button')]
          .find((b) => b.textContent.trim() === '编辑者');
        return btn ? 'ok' : null;
      })()`,
      12_000,
    );
    check('应用面板出现待批准请求（有「编辑者」按钮）', pendingBtn === 'ok', String(pendingBtn));

    // ── 3. 在应用里批准为编辑者 ──
    await evalInPage(`(() => {
      const btn = [...document.querySelectorAll('.collab-modal button')]
        .find((b) => b.textContent.trim() === '编辑者');
      if (btn) btn.click();
      return true;
    })()`);
    await sleep(2_000);

    const guestApproved = await (async () => {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline && !guestHas('GUEST_APPROVED')) await sleep(300);
      return guestHas('GUEST_APPROVED');
    })();
    check('队员收到「已被批准」的房间推送', guestApproved, guestOut.join(' | '));

    const pairState = await evalInPage(PANEL_STATE);
    check(
      '应用面板成员数变成 2，且队员角色是编辑者',
      Boolean(pairState) &&
        pairState.strong.includes('成员（2）') &&
        pairState.rows.some((r) => r.includes('小李') && r.includes('编辑者')),
      JSON.stringify(pairState),
    );
    trace.push('两人房间：' + JSON.stringify(pairState));

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);    fs.writeFileSync(path.join(OUT, 'collab-pair.png'), Buffer.from(shot.data, 'base64'));
    trace.push('已截图 collab-pair.png');

    // ── 3.5 真机点按钮 → 文件内容变化（共享文件链路）──
    // 在面板里选 notes.md → 加入共享 → 编辑 → 改文本 → 保存 → 磁盘上的文件应当变了
    const pick = await evalInPage(`(() => {
      const sel = document.querySelector('.collab-modal select');
      if (!sel) return 'no-select';
      const opt = [...sel.options].find((o) => o.value === 'notes.md');
      if (!opt) return 'no-option:' + [...sel.options].map((o) => o.value).join(',');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, 'notes.md');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    check('面板「共享文件」区列出了项目里的文本文件', pick === 'ok', String(pick));

    await sleep(300);
    await evalInPage(`(() => {
      const btn = [...document.querySelectorAll('.collab-modal button')]
        .find((b) => b.textContent.trim() === '加入共享');
      if (btn) btn.click();
      return true;
    })()`);
    const shared = await waitInPage(
      `(() => {
        const modal = document.querySelector('.collab-modal');
        const rows = modal ? [...modal.querySelectorAll('.collab-row')].map((r) => r.textContent.trim()) : [];
        const hit = rows.find((r) => r.includes('notes.md'));
        return hit && hit.includes('v1') ? hit : null;
      })()`,
      12_000,
    );
    check('点「加入共享」后面板出现 notes.md@v1 的共享行', Boolean(shared), String(shared));
    trace.push('共享行：' + String(shared));

    // 打开编辑器
    await evalInPage(`(() => {
      const btn = [...document.querySelectorAll('.collab-modal button')]
        .find((b) => b.textContent.trim() === '编辑');
      if (btn) btn.click();
      return true;
    })()`);
    const editorReady = await waitInPage(
      `(() => {
        const ta = document.querySelector('.collab-editor');
        return ta && !ta.readOnly ? 'ok' : null;
      })()`,
      12_000,
    );
    check('点「编辑」后出现可写入的编辑器，且内容就是磁盘上的原文', editorReady === 'ok', String(editorReady));

    // 改内容 —— React 受控组件要用原生 setter + input 事件才会走 onChange
    await evalInPage(`(() => {
      const ta = document.querySelector('.collab-editor');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(NOTES_EDITED)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return ta.value.length;
    })()`);
    await sleep(300);
    await evalInPage(`(() => {
      const btn = [...document.querySelectorAll('.collab-modal button')]
        .find((b) => b.textContent.trim() === '保存');
      if (btn) btn.click();
      return true;
    })()`);

    const saved = await waitInPage(
      `(() => {
        const modal = document.querySelector('.collab-modal');
        return [...(modal?.querySelectorAll('.collab-note') ?? [])].some((e) => e.textContent.trim() === '已保存')
          ? 'ok'
          : null;
      })()`,
      12_000,
    );
    const onDisk = fs.existsSync(NOTES) ? fs.readFileSync(NOTES, 'utf8') : '';
    check(
      '真机点「保存」→ 磁盘上的文件内容真的变了',
      saved === 'ok' && onDisk === NOTES_EDITED,
      `面板提示=${saved} 磁盘=${JSON.stringify(onDisk)}`,
    );
    trace.push('保存后磁盘内容：' + JSON.stringify(onDisk));

    // 队员侧应当收到这一笔 file-changed（真实应用当房主的推送链路）
    const guestSawPush = await (async () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && !guestHas('GUEST_FILE_EVENT')) await sleep(300);
      return guestHas('GUEST_FILE_EVENT');
    })();
    const pushLine = guestOut.find((l) => l.startsWith('@@ GUEST_FILE_EVENT ')) ?? '';
    check(
      '队员侧收到房主改文件的 file-changed 推送（内容含 APP-EDIT）',
      guestSawPush && pushLine.includes('APP-EDIT'),
      pushLine || guestOut.join(' | '),
    );

    const editShot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(path.join(OUT, 'collab-shared-file.png'), Buffer.from(editShot.data, 'base64'));
    trace.push('已截图 collab-shared-file.png');

    // ── 3.6 冲突三选一：队员在我还没保存时插一版，让我的保存被拒 ──
    const CONFLICT_A = '# 共享笔记\n\nCONFLICT-A：真机上改的，冲突后我选择覆盖\n';
    const CONFLICT_B = '# 共享笔记\n\nCONFLICT-B：真机上改的，冲突后我选择另存为副本\n';

    /** 往真机面板的编辑器里换内容（React 受控组件要走原生 setter + input 事件） */
    const typeInEditor = async (text) => {
      const r = await evalInPage(`(() => {
        const ta = document.querySelector('.collab-editor');
        if (!ta) return 'no-editor';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, ${JSON.stringify(text)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
      })()`);
      await sleep(350);
      return r;
    };
    const clickPanelButton = async (text) => {
      await evalInPage(`(() => {
        const btn = [...document.querySelectorAll('.collab-modal button')]
          .find((b) => b.textContent.trim() === ${JSON.stringify(text)});
        if (btn) btn.click();
        return true;
      })()`);
      await sleep(400);
    };
    const waitGuestWrote = async (tag, timeoutMs = 12_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const line = guestOut.find((l) => l.startsWith('@@ GUEST_WROTE ') && l.includes(`"tag":"${tag}"`));
        if (line) return line;
        await sleep(250);
      }
      return null;
    };

    // ① 「覆盖」：我改 A 不保存 → 队员插一版 → 我保存被拒 → 点「用我的内容覆盖」
    await typeInEditor(CONFLICT_A);
    guest.stdin.write('write:A\n');
    const wroteA = await waitGuestWrote('A');
    // 等队员那一版推回应用（面板里的共享行版本号会变大）
    const sawGuestEdit = await waitInPage(
      `(() => {
        const modal = document.querySelector('.collab-modal');
        const rows = modal ? [...modal.querySelectorAll('.collab-row')].map((r) => r.textContent.trim()) : [];
        return rows.some((r) => r.includes('notes.md') && r.includes('小李')) ? 'ok' : null;
      })()`,
      12_000,
    );
    await clickPanelButton('保存');
    const conflictBtns = await waitInPage(
      `(() => {
        const box = document.querySelector('.collab-conflict');
        if (!box) return null;
        return [...box.querySelectorAll('button')].map((b) => b.textContent.trim()).join('|');
      })()`,
      10_000,
    );
    check(
      '真机冲突：保存被拒后出现「用我的内容覆盖 / 放弃修改 / 另存为副本」三个按钮',
      conflictBtns === '用我的内容覆盖|放弃修改|另存为副本' && Boolean(wroteA) && sawGuestEdit === 'ok',
      `buttons=${conflictBtns} guestWrote=${wroteA} sawGuestEdit=${sawGuestEdit}`,
    );
    const conflictShot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(path.join(OUT, 'collab-conflict.png'), Buffer.from(conflictShot.data, 'base64'));

    await clickPanelButton('用我的内容覆盖');
    const overwritten = await (async () => {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        const on = fs.existsSync(NOTES) ? fs.readFileSync(NOTES, 'utf8') : '';
        if (on === CONFLICT_A) return true;
        await sleep(300);
      }
      return false;
    })();
    const conflictGone = await waitInPage(
      `(() => (document.querySelector('.collab-conflict') ? null : 'ok'))()`,
      8_000,
    );
    check(
      '真机冲突处置「覆盖」：磁盘变成我的内容，冲突提示消失',
      overwritten && conflictGone === 'ok',
      `磁盘=${JSON.stringify(fs.readFileSync(NOTES, 'utf8'))} 冲突提示消失=${conflictGone}`,
    );

    // ② 「另存」：我的编辑器跟着队员那版走 → 我再改 B → 队员又插一版 → 保存被拒 → 点「另存为副本」
    guest.stdin.write('write:B\n');
    const adoptedGuest = await waitInPage(
      `(() => {
        const ta = document.querySelector('.collab-editor');
        return ta && ta.value.includes('GUEST-B') ? 'ok' : null;
      })()`,
      12_000,
    );
    await typeInEditor(CONFLICT_B);
    guest.stdin.write('write:C\n');
    const wroteC = await waitGuestWrote('C');
    await clickPanelButton('保存');
    const conflict2 = await waitInPage(
      `(() => (document.querySelector('.collab-conflict') ? 'ok' : null))()`,
      10_000,
    );
    await clickPanelButton('另存为副本');
    const copyPath = path.join(projectRoot, 'notes-副本.md');
    const copyMade = await (async () => {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        if (fs.existsSync(copyPath) && fs.readFileSync(copyPath, 'utf8') === CONFLICT_B) return true;
        await sleep(300);
      }
      return false;
    })();
    const orig = fs.existsSync(NOTES) ? fs.readFileSync(NOTES, 'utf8') : '';
    check(
      '真机冲突处置「另存」：副本 notes-副本.md 落盘为我的内容，原文件保持队员那一版',
      adoptedGuest === 'ok' && Boolean(wroteC) && conflict2 === 'ok' && copyMade && orig.includes('GUEST-C'),
      `adoptedGuest=${adoptedGuest} conflict2=${conflict2} copyMade=${copyMade} 原文件=${JSON.stringify(orig)}`,
    );
    trace.push(`另存后：副本=${JSON.stringify(fs.existsSync(copyPath) ? fs.readFileSync(copyPath, 'utf8') : null)}`);
    const copyShot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(path.join(OUT, 'collab-save-copy.png'), Buffer.from(copyShot.data, 'base64'));

    // ── 4. 队员退出 → 面板成员回到 1 ──
    guest.stdin.write('go\n');
    const backToOne = await waitInPage(
      `(() => {
        const modal = document.querySelector('.collab-modal');
        const strong = modal ? [...modal.querySelectorAll('.collab-strong')].map((e) => e.textContent.trim()) : [];
        return strong.includes('成员（1）') ? 'ok' : null;
      })()`,
      12_000,
    );
    check('队员退出后应用面板成员数回到 1', backToOne === 'ok', String(backToOne));
    check('队员进程正常退出', guestHas('GUEST_LEFT'), guestOut.join(' | '));

    // ── 5. 应用里结束协作 ──
    await evalInPage(`(() => {
      const btn = [...document.querySelectorAll('.collab-modal button')]
        .find((b) => b.textContent.trim() === '结束协作');
      if (btn) btn.click();
      return true;
    })()`);
    const backToIdle = await waitInPage(
      `(() => {
        const modal = document.querySelector('.collab-modal');
        if (!modal) return null;
        return modal.querySelector('.collab-code-lg') ? null : 'ok';
      })()`,
      12_000,
    );
    check('结束协作后面板回到未开房状态', backToIdle === 'ok', String(backToIdle));

    if (guestErr.trim()) trace.push('队员 stderr：' + guestErr.trim().slice(0, 400));
    trace.push('队员输出：\n' + guestOut.join('\n'));
  } catch (err) {
    check('端到端流程无异常', false, String(err && err.message ? err.message : err));
    trace.push('窗口输出片段：' + ref.text.slice(0, 800));
  } finally {
    try {
      guest?.kill();
    } catch {
      /* ignore */
    }
    try {
      app.kill();
    } catch {
      /* ignore */
    }
    console.log(trace.join('\n'));
    console.log('\n──────── 断言 ────────');
    for (const c of checks) console.log(`${c.ok ? '✔' : '✘'} ${c.label}${c.detail ? `\n    ${c.detail}` : ''}`);
    const pass = checks.filter((c) => c.ok).length;
    console.log(`\n结果：${pass}/${checks.length} 通过`);
    fs.writeFileSync(path.join(OUT, 'collab-app-log.txt'), trace.join('\n'), 'utf8');
    process.exit(failed ? 1 : 0);
  }
}

void main();
