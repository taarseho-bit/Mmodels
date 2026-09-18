/**
 * 局域网协作的**真实联调对端**（配合 `scripts/test-collab.cjs` 使用）。
 *
 * 这个脚本直接 import `src/main/collab/server.ts` —— 服务层不依赖 electron，
 * 所以能用普通 node 起两个进程，跑真实的 HTTP + WebSocket + UDP 广播，
 * 而不是 mock。Node 22 会自己做类型剥离（无需编译）。
 *
 * 用法：
 *   node scripts/collab-peer.mjs host                      ← 房主（自带一个临时项目目录）
 *   node scripts/collab-peer.mjs guest   <address> <code> <name> <accountId>
 *   node scripts/collab-peer.mjs guest-lite <address> <code> <name> <accountId>
 *
 * 输出：每行 `@@ <KEY> <json>`，父进程据此断言。
 *
 * 编排（父进程用 stdin 打拍子，保证两端不抢跑）：
 *   房主开房 → 队员加入 → 房主批准为编辑者 → 房主共享 notes.md 并写入 A-EDIT
 *   → 队员读到 A-EDIT → 队员写 B-EDIT → 队员用过期基版本再写（应被拒）
 *   → 队员报 GUEST_FILES_DONE → 父进程让房主跑错误语义+查看者写入探测
 *   → 房主报 PROBES → 父进程让队员退出 → 房主成员回到 1 人 → 收摊
 */
import { request as httpRequest } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollabService } from '../src/main/collab/server.ts';

const out = (key, value) => {
  process.stdout.write(`@@ ${key} ${value === undefined ? '' : JSON.stringify(value)}\n`);
};

const watchdog = setTimeout(() => {
  out('TIMEOUT');
  process.exit(1);
}, 60_000);
watchdog.unref?.();

/** 共享笔记的初始内容（房主项目目录里真实存在的一个文件） */
const NOTES_INITIAL = '# 共享笔记\n\n（初始内容）\n';
const NOTES_BY_HOST = '# 共享笔记\n\nA-EDIT：房主把第一问的模型写成了 y = ax + b\n';
const NOTES_BY_GUEST = '# 共享笔记\n\nB-EDIT：队员补上了约束 x >= 0\n';
const NOTES_STALE = '# 共享笔记\n\n这一笔用的是过期基版本，房主应当拒绝\n';
/** 冲突处置①「用我的内容覆盖」之后的样子 */
const NOTES_OVERWRITE = '# 共享笔记\n\nOVERWRITE：我用磁盘版本当新基版本，把这版写进去了\n';
/** 冲突处置③「另存为副本」的内容 */
const NOTES_COPY = '# 共享笔记（副本）\n\nCOPY：我的改动先留在这里，不动原文件\n';

/**
 * 第二个共享文件 —— 专门用来验证「队员在房间里的时候，房主改文件会实时推给他」。
 * （notes.md 在队员加入时就已经是 v2 了，队员是**从房间快照**看到的，不算实时推送。）
 */
const PLAN_INITIAL = '# 分工计划\n\n（待定）\n';
const PLAN_BY_HOST = '# 分工计划\n\nPLAN-EDIT：房主写论文，队员跑数据\n';

/**
 * 探测用的裸 HTTP 客户端（`agent: false` —— 每次一条新连接，不复用连接池）。
 * 房主进程一边在跑 HTTP 服务、一边向自己发包时，全局 fetch 的连接复用会打结，
 * 这里用最朴素的方式发请求，行为可预测。
 */
function httpJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = httpRequest(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: payload === null ? 'GET' : 'POST',
        agent: false,
        headers:
          payload === null
            ? {}
            : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
        timeout: 3_000,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (text += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error(`非 JSON 响应：${text.slice(0, 120)}`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('探测请求超时')));
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function wrongCode(code) {
  return code === '000000' ? '111111' : '000000';
}

/** 等父进程在 stdin 上发一条指令（用来卡两端的先后顺序） */
function awaitCommand(word) {
  return new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    const onData = (chunk) => {
      if (!String(chunk).includes(word)) return;
      process.stdin.off('data', onData);
      resolve();
    };
    process.stdin.on('data', onData);
  });
}

// ─────────────────────────────────────────────────────────────
// 房主
// ─────────────────────────────────────────────────────────────

async function runHost() {
  // 房主权威模型要有地方落盘 —— 起一个临时项目目录，放一份共享笔记
  const projectRoot = mkdtempSync(join(tmpdir(), 'mmodels-collab-e2e-'));
  writeFileSync(join(projectRoot, 'notes.md'), NOTES_INITIAL, 'utf8');
  writeFileSync(join(projectRoot, 'plan.md'), PLAN_INITIAL, 'utf8');

  const svc = new CollabService();
  const info = await svc.startHost({
    projectId: 'proj-collab-1',
    projectRoot,
    projectName: 'A 题 · 建模',
    ownerName: '队长',
    accountId: 'acct-host',
  });
  out('HOST_READY', {
    address: info.address,
    code: info.code,
    port: Number(info.address.split(':')[1]),
    projectRoot,
  });

  let approved = false;
  let shared = false;
  let probed = false;
  let probesDone = false;
  let decided = false;
  let afterLeave = false;

  /** 房主把文件加入共享 + 自己改一版（队员据此验证「读到别人改后的内容」） */
  async function filesSetup() {
    svc.shareFile('notes.md');
    svc.shareFile('plan.md');
    out('HOST_SHARED', svc.snapshot()?.sharedFiles ?? []);
    const w = await svc.writeFile('notes.md', NOTES_BY_HOST, 1);
    out('HOST_WROTE', w);
  }

  /** 错误语义 + 查看者只读：加入码不对、同账号重复加入、房主版本不一致、查看者写入被拒 */
  async function probes() {
    const base = `http://${info.address}`;

    // 第一件事：趁队员还在房间里，改一个他没见过 v2 的文件 ——
    // 这一笔会以 `{type:'file'}` 推给他，验证「别人改了我这边实时变」。
    const push = await svc.writeFile('plan.md', PLAN_BY_HOST, 1);
    out('HOST_PUSHED', push);

    const post = (body) => httpJson(`${base}/collab/join`, body);
    const results = {};
    results.invalidCode =
      (await post({ protocol: 1, code: wrongCode(info.code), name: '路人', accountId: 'acct-x' }))
        .error ?? 'unexpected-ok';
    results.sameAccount =
      (await post({ protocol: 1, code: info.code, name: '队长的小号', accountId: 'acct-host' }))
        .error ?? 'unexpected-ok';
    results.duplicateGuest =
      (await post({ protocol: 1, code: info.code, name: '队友的小号', accountId: 'acct-guest' }))
        .error ?? 'unexpected-ok';
    results.incompatible =
      (await post({ protocol: 99, code: info.code, name: '老版本', accountId: 'acct-old' })).error ??
      'unexpected-ok';
    const hello = await httpJson(`${base}/collab/hello`);
    results.helloProtocol = hello.protocol;

    // 待批准 → 拒绝 的闭环：拒绝后房间里不该留下这条请求
    const pending = await post({
      protocol: 1,
      code: info.code,
      name: '路人乙',
      accountId: 'acct-reject',
    });
    results.rejectFlow = pending.ok === true && pending.pending === true ? 'accepted' : 'unexpected';
    if (pending.requestId) svc.reject(String(pending.requestId));
    results.pendingAfterReject = svc.snapshot()?.pending.length ?? -1;

    // ── 查看者（只读）不能写共享文件 ──
    // 完全走真实链路：HTTP 申请加入 → 房主批准为 viewer → 拿这条 memberId 去写文件
    const viewerReq = await post({
      protocol: 1,
      code: info.code,
      name: '只读的同学',
      accountId: 'acct-viewer',
    });
    if (viewerReq.requestId) {
      const viewerId = String(viewerReq.requestId);
      svc.approve(viewerId, 'viewer');
      const write = await httpJson(`${base}/collab/file-write`, {
        id: viewerId,
        path: 'notes.md',
        content: 'viewer-should-not-write',
        baseVersion: 0,
      });
      results.viewerWrite = write.error ?? 'unexpected-ok';
      // 查看者读得到（只读不等于看不见）；内容不做硬编码比较 —— 到这一步
      // notes.md 已经被改过好几版了，只断言「读得通且拿得到非空全文」
      const read = await httpJson(`${base}/collab/file-read`, { id: viewerId, path: 'notes.md' });
      results.viewerRead = read.ok === true && String(read.content ?? '').length > 0;
      // 非共享文件不给读
      const other = await httpJson(`${base}/collab/file-read`, { id: viewerId, path: 'secret.md' });
      results.unsharedRead = other.error ?? 'unexpected-ok';
      // 探测完把人清出去，别影响「队员退出后成员回到 1 人」
      svc.removeMember(viewerId);
      results.membersAfterViewer = svc.snapshot()?.members.length ?? -1;
    } else {
      results.viewerWrite = 'no-request';
    }
    return results;
  }

  svc.on('event', (ev) => {
    if (ev.type !== 'room') {
      // 共享文件落盘后的广播（`{type:'file'}`）—— 队员改了文件，房主这边收到的就是它。
      // 顺手把磁盘上的真实内容也读出来：这是「房主权威落盘」最硬的证据。
      out(ev.type === 'file' ? 'HOST_FILE_EVENT' : 'HOST_EVENT', ev);
      if (ev.type === 'file') {
        try {
          out('HOST_DISK_SNAP', {
            version: ev.version,
            path: ev.path,
            content: readFileSync(join(projectRoot, ev.path), 'utf8'),
          });
        } catch (err) {
          out('HOST_DISK_SNAP_ERROR', String(err && err.message ? err.message : err));
        }
      }
      return;
    }
    const room = ev.room;
    out('HOST_ROOM', {
      members: room.members.length,
      names: room.members.map((m) => `${m.name}/${m.role}${m.online ? '' : '(offline)'}`),
      pending: room.pending.length,
      tasks: room.tasks.map((t) => `${t.from}:${t.status}`),
      files: room.sharedFiles.map((f) => `${f.path}@v${f.version}/${f.by}`),
    });

    // 有人按门铃 → 立刻批准为编辑者
    if (!approved && room.pending.length > 0) {
      approved = true;
      svc.approve(room.pending[0].id, 'editor');
      return;
    }
    // 队员成了成员 → 共享一份文件并自己改一版（这是队员要读到的那一版）
    if (approved && !shared && room.members.length >= 2) {
      shared = true;
      void filesSetup()
        .then((r) => void r)
        .catch((err) => out('HOST_FILES_ERROR', String(err && err.message ? err.message : err)));
      return;
    }
    // 队员提交了 Agent 任务 → 房主批准
    const pendingTask = room.tasks.find((t) => t.status === 'pending');
    if (approved && !decided && pendingTask) {
      decided = true;
      svc.decideTask(pendingTask.id, true);
      out('HOST_TASK_DECIDED', pendingTask.id);
      return;
    }
    // 队员退出 → 成员回到 1 人 → 结束协作
    if (approved && !afterLeave && room.members.length === 1) {
      afterLeave = true;
      out('HOST_MEMBERS_AFTER_LEAVE', room.members.length);
      void finishHost();
    }
  });

  // 队员的文件读写都验证完了，父进程才让房主跑探测（避免探测里的 viewer 进出
  // 与队员的文件断言抢跑）；探测本身保持异步（房主一边跑服务一边向自己发包）。
  void awaitCommand('probes').then(() => {
    if (probed) return;
    probed = true;
    probes()
      .then((r) => out('PROBES', r))
      .catch((err) => out('PROBES_ERROR', String(err && err.message ? err.message : err)))
      .finally(() => {
        probesDone = true;
      });
  });

  /** 收摊前先等探测跑完 —— 探测是异步的，进程提前 exit 会把结果截断 */
  async function finishHost() {
    const deadline = Date.now() + 8_000;
    while (!probesDone && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    // 落盘结果留个证据：房主项目目录里的 notes.md 应当就是队员写的那一版
    try {
      out('HOST_DISK', {
        path: join(projectRoot, 'notes.md'),
        content: readFileSync(join(projectRoot, 'notes.md'), 'utf8'),
      });
    } catch (err) {
      out('HOST_DISK_ERROR', String(err && err.message ? err.message : err));
    }
    await svc.stopHost();
    out('HOST_STOPPED');
    setTimeout(() => process.exit(0), 150);
  }
}

// ─────────────────────────────────────────────────────────────
// 队员
// ─────────────────────────────────────────────────────────────

async function runGuest() {
  const [, , , address, code, name, accountId] = process.argv;
  const svc = new CollabService();

  let submitted = false;
  let filesDone = false;
  let finished = false;

  /** 共享文件的三步：读别人的改动 → 写自己的一版 → 用过期基版本再写（应被拒） */
  async function filePhase(room) {
    filesDone = true;
    const read = await svc.readFile('notes.md');
    out('GUEST_FILE_READ', read);
    const write = await svc.writeFile('notes.md', NOTES_BY_GUEST, read.version);
    out('GUEST_FILE_WRITE', write);
    // 故意拿「读到的那个版本」（已经过期了）当基版本再写一次
    const stale = await svc.writeFile('notes.md', NOTES_STALE, read.version);
    out('GUEST_FILE_CONFLICT', stale);

    // 冲突处置①「用我的内容覆盖」—— 拿冲突现场给的磁盘版本当新基版本重写
    if (stale.error === 'fileConflict') {
      const overwrite = await svc.writeFile('notes.md', NOTES_OVERWRITE, stale.diskVersion ?? 0);
      out('GUEST_FILE_OVERWRITE', overwrite);
    }

    // 冲突处置③「另存为副本」—— 我的内容进副本文件，原文件不动
    const copy = await svc.saveCopy('notes.md', NOTES_COPY);
    out('GUEST_FILE_COPY', copy);

    out('GUEST_FILES_DONE', {
      path: 'notes.md',
      readVersion: read.version,
      writeVersion: write.version,
    });
  }

  svc.on('event', (ev) => {
    if (ev.type === 'rejected') {
      out('GUEST_REJECTED');
      process.exit(1);
      return;
    }
    if (ev.type === 'closed') {
      out('GUEST_CLOSED', ev.error ?? null);
      return;
    }
    if (ev.type === 'file') {
      // 房主落盘后推过来的 file-changed —— 面板就是靠它「实时看到别人改后的内容」
      out('GUEST_FILE_EVENT', {
        path: ev.path,
        version: ev.version,
        by: ev.by,
        content: ev.content,
      });
      return;
    }
    if (ev.type !== 'room') return;

    const room = ev.room;
    out('GUEST_ROOM', {
      members: room.members.length,
      names: room.members.map((m) => `${m.name}/${m.role}${m.self ? '(me)' : ''}`),
      tasks: room.tasks.map((t) => t.status),
      files: room.sharedFiles.map((f) => `${f.path}@v${f.version}/${f.by}`),
    });

    // 被批准（成员变 2 人）后提交一个 Agent 任务
    if (!submitted && room.members.length >= 2) {
      submitted = true;
      void svc
        .submitTask({ title: '求解 A 题第一问', prompt: '请读 data/raw.csv 并给出第一问的模型与代码' })
        .then((ok) => out('GUEST_TASK_SUBMITTED', ok));
      return;
    }
    // 房主共享的笔记已经改到 v2（那是房主写的 A-EDIT）→ 开始文件三步
    const notes = room.sharedFiles.find((f) => f.path === 'notes.md');
    if (!filesDone && notes && notes.version >= 2) {
      void filePhase(room).catch((err) =>
        out('GUEST_FILES_ERROR', String(err && err.message ? err.message : err)),
      );
      return;
    }
    // 任务被房主批准 → 排队 → 等父进程发话再退
    if (submitted && !finished && room.tasks.some((t) => t.status === 'queued')) {
      finished = true;
      out('TASK_QUEUED', room.tasks.map((t) => t.status));
      void awaitCommand('go').then(() => {
        void svc.leave().then(() => {
          out('GUEST_LEFT');
          setTimeout(() => process.exit(0), 150);
        });
      });
    }
  });

  // 1) UDP 广播找附近房间
  const disc = await svc.discover(1_200);
  out('DISCOVER', { available: disc.available, rooms: disc.rooms });

  // 2) 错误语义（地址不通 / 加入码不对）—— 都只是探测，不会真进房间
  out('JOIN_BAD_ADDRESS', await svc.join({ address: '127.0.0.1:1', code, name, accountId }));
  out('JOIN_BAD_CODE', await svc.join({ address, code: wrongCode(code), name, accountId }));

  // 3) 正式加入 → 进待批准队列
  const joined = await svc.join({ address, code, name, accountId });
  out('JOIN', joined);
  if (!joined.ok) process.exit(1);
}

/**
 * 轻量队员：只做「加入 → 等批准 → 听父进程指令读写文件 / 退出」。
 * 给 `scripts/test-collab-app.cjs` 用 —— 那边房主是**真实 Electron 应用**。
 *
 * stdin 指令（一行一条）：
 *   write:A / write:B / write:C  → 先读最新版本再写一版（内容见下面的表）
 *   go                           → 退出房间
 */
const LITE_WRITES = {
  A: '# 共享笔记\n\nGUEST-A：队员在真机上写的这一版\n',
  B: '# 共享笔记\n\nGUEST-B：队员又写了一版\n',
  C: '# 共享笔记\n\nGUEST-C：队员在应用还没保存时插了一版\n',
};

async function runGuestLite() {
  const [, , , address, code, name, accountId] = process.argv;
  const svc = new CollabService();
  let approved = false;

  svc.on('event', (ev) => {
    if (ev.type === 'rejected') {
      out('GUEST_REJECTED');
      process.exit(1);
      return;
    }
    if (ev.type === 'closed') {
      out('GUEST_CLOSED', ev.error ?? null);
      return;
    }
    if (ev.type === 'file') {
      out('GUEST_FILE_EVENT', {
        path: ev.path,
        version: ev.version,
        by: ev.by,
        content: ev.content,
      });
      return;
    }
    if (ev.type !== 'room') return;
    const room = ev.room;
    out('GUEST_ROOM', {
      members: room.members.length,
      names: room.members.map((m) => `${m.name}/${m.role}${m.self ? '(me)' : ''}`),
      files: room.sharedFiles.map((f) => `${f.path}@v${f.version}/${f.by}`),
    });
    if (!approved && room.members.length >= 2) {
      approved = true;
      out('GUEST_APPROVED', room.members.map((m) => m.role));
    }
  });

  /** 先读最新版本，再拿它当基版本写 —— 让队员这一笔必定成功 */
  async function writeNotes(tag) {
    const content = LITE_WRITES[tag];
    if (!content) {
      out('GUEST_WROTE', { ok: false, error: 'unknown-tag' });
      return;
    }
    const read = await svc.readFile('notes.md');
    if (!read.ok) {
      out('GUEST_WROTE', { tag, ok: false, error: read.error });
      return;
    }
    const res = await svc.writeFile('notes.md', content, read.version);
    out('GUEST_WROTE', { tag, ok: res.ok, version: res.version, error: res.error ?? null });
  }

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += String(chunk);
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
      if (!line) continue;
      void (async () => {
        if (line === 'go') {
          await svc.leave();
          out('GUEST_LEFT');
          setTimeout(() => process.exit(0), 150);
          return;
        }
        if (line.startsWith('write:')) {
          await writeNotes(line.slice(6).toUpperCase());
          return;
        }
        out('GUEST_UNKNOWN_COMMAND', line);
      })();
    }
  });

  const joined = await svc.join({ address, code, name, accountId });
  out('JOIN', joined);
  if (!joined.ok) process.exit(1);
}

if (process.argv[2] === 'host') await runHost();
else if (process.argv[2] === 'guest-lite') await runGuestLite();
else await runGuest();
