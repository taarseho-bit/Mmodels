#!/usr/bin/env node
/**
 * 局域网协作 · 端到端联调（真实两进程，非 mock）
 *
 * 房主与队员各起一个 node 进程（`scripts/collab-peer.mjs`），跑真实的
 * HTTP 加入链路、WebSocket 推送、UDP 广播发现，逐项断言项目契约承诺的语义：
 *   - 开房拿到「本机地址 + 6 位加入码」，加入码必须是 6 位数字
 *   - 地址不通 → joinFailed；加入码不对 → joinInvalidCode
 *   - 同账号重复加入 → joinSameAccountNotAllowed；协议版本不一致 → joinIncompatibleRoom
 *   - 加入先进待批准队列，房主批准为「编辑者」后队员才收到成员快照（2 人）
 *   - 队员提交 Agent 任务 → 房主批准 → 全房间看到状态变为排队
 *   - **项目文件协作编辑**（房主权威 + 版本号乐观并发）：
 *       ① 房主写 → 队员读到新内容     ② 队员写 → 房主收到 file-changed 且磁盘真的变了
 *       ③ 过期基版本的写被拒 + 返回冲突现场
 *       ④ 冲突处置「覆盖」真实生效（用磁盘版本当新基版本重写成功）
 *       ⑤ 冲突处置「另存」真实生效（原文件不动，副本落盘并进共享清单）
 *       ⑥ 查看者（只读）写入被拒   ⑦ 队员在房间时房主改文件 → 队员实时收到 file-changed
 *   - 队员退出 → 房主成员回到 1 人 → 房主结束协作、端口释放
 *
 * 用法：node scripts/test-collab.cjs         （退出码 0 = 全通过）
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PEER = path.join(__dirname, 'collab-peer.mjs');
const GUEST_ACCOUNT = 'acct-guest';

const records = [];       // 两个进程产出的全部 @@ 记录
const rawLines = [];      // 原始输出（报告里贴）
const checks = [];
let failed = false;

function check(label, ok, detail) {
  checks.push({ label, ok: Boolean(ok), detail });
  if (!ok) failed = true;
}

function startPeer(tag, args) {
  const child = spawn(process.execPath, [PEER, ...args], {
    cwd: ROOT,
    // 两个进程的 stdin 都要留出来 —— 父进程靠它给两端打拍子，避免文件读写
    // 与房主自测（错误语义探测）互相抢跑
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.err = '';
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      rawLines.push(`[${tag}] ${line}`);
      if (line.startsWith('@@ ')) {
        const rest = line.slice(3);
        const sp = rest.indexOf(' ');
        const key = sp === -1 ? rest : rest.slice(0, sp);
        const payload = sp === -1 ? '' : rest.slice(sp + 1);
        let value = null;
        try {
          value = payload ? JSON.parse(payload) : null;
        } catch {
          value = payload;
        }
        records.push({ tag, key, value });
        onRecord(tag, key, value, child);
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    child.err += String(chunk);
  });
  return child;
}

const find = (tag, key) => records.filter((r) => r.tag === tag && r.key === key);
const first = (tag, key) => find(tag, key)[0]?.value ?? null;

let guest = null;
let host = null;

function onRecord(tag, key, value, child) {
  if (tag === 'host' && key === 'HOST_READY' && !guest) {
    check('房主开房：拿到本机地址 + 6 位数字加入码',      /^\d{6}$/.test(String(value.code)) && Number(value.port) > 0,
      `address=${value.address} code=${value.code}`);
    guest = startPeer('guest', ['guest', value.address, value.code, '小李', GUEST_ACCOUNT]);
  }
  if (key === 'TIMEOUT') check(`${tag} 未超时`, false, '对端脚本超时');
  // 队员的共享文件三步（读→写→过期写）都验完了，才让房主跑错误语义 + 查看者写入探测
  if (tag === 'guest' && key === 'GUEST_FILES_DONE' && host && host.stdin.writable) {
    host.stdin.write('probes\n');
  }
  // 房主自测跑完了，才放队员退出 —— 否则「同账号重复加入」这条会
  // 因为队员已经离开房间而变成「可以加入」，断言会飘。
  if (tag === 'host' && key === 'PROBES' && guest && guest.stdin.writable) {
    guest.stdin.write('go\n');
  }
  // 探测自己出错时也得把队员放走，否则整轮只能等超时
  if (tag === 'host' && key === 'PROBES_ERROR' && guest && guest.stdin.writable) {
    guest.stdin.write('go\n');
  }
  if (child && key.endsWith('STOPPED')) child.__stopped = true;
}

function killAll() {
  for (const c of [guest, host]) {
    if (c && c.exitCode === null && c.signalCode === null) {
      try {
        c.kill();
      } catch {
        /* ignore */
      }
    }
  }
}

function report() {
  // ── 断言 ──
  const hello = first('host', 'HOST_READY');
  const discover = first('guest', 'DISCOVER');
  const badAddress = first('guest', 'JOIN_BAD_ADDRESS');
  const badCode = first('guest', 'JOIN_BAD_CODE');
  const join = first('guest', 'JOIN');
  const guestRooms = find('guest', 'GUEST_ROOM').map((r) => r.value);
  const approvedRoom = guestRooms.find((r) => r && r.members === 2) ?? null;
  const probes = first('host', 'PROBES');
  const queued = first('guest', 'TASK_QUEUED');

  // ── 项目文件协作编辑的证据 ──
  const sharedList = first('host', 'HOST_SHARED');
  const hostWrote = first('host', 'HOST_WROTE');
  const guestRead = first('guest', 'GUEST_FILE_READ');
  const guestWrote = first('guest', 'GUEST_FILE_WRITE');
  const guestConflict = first('guest', 'GUEST_FILE_CONFLICT');
  const hostFileEvents = find('host', 'HOST_FILE_EVENT').map((r) => r.value);
  const hostFileEvent = hostFileEvents.find((e) => e && e.by === '小李') ?? null;
  const guestFileEvents = find('guest', 'GUEST_FILE_EVENT').map((r) => r.value);
  const guestSawHostEdit = guestFileEvents.find((e) => e && e.by === '队长' && e.path === 'plan.md') ?? null;
  const hostPushed = first('host', 'HOST_PUSHED');
  const guestOverwrite = first('guest', 'GUEST_FILE_OVERWRITE');
  const guestCopy = first('guest', 'GUEST_FILE_COPY');
  /** 房主每次落盘后立刻回读磁盘的现场：version → 磁盘真实内容 */
  const diskSnaps = find('host', 'HOST_DISK_SNAP').map((r) => r.value);
  const diskAt = (version, path) =>
    (diskSnaps.find((s) => s && s.version === version && (!path || s.path === path)) ?? null);
  const disk = first('host', 'HOST_DISK');

  check('附近房间：UDP 广播能发现房主',
    discover && discover.available === true && (discover.rooms ?? []).some((r) => hello && r.address === hello.address),
    JSON.stringify(discover));
  check('地址不通 → joinFailed', badAddress?.error === 'joinFailed', JSON.stringify(badAddress));
  check('加入码不对 → joinInvalidCode', badCode?.error === 'joinInvalidCode', JSON.stringify(badCode));
  check('首次加入 → 送达房主、进入待批准',
    join?.ok === true && join?.pending === true, JSON.stringify(join));
  check('房主侧出现待批准请求',
    find('host', 'HOST_ROOM').some((r) => (r.value?.pending ?? 0) > 0),
    `${find('host', 'HOST_ROOM').length} 条房主快照`);
  check('批准为编辑者后，队员侧成员数 2 且角色为 editor',
    Boolean(approvedRoom) && approvedRoom.names.some((n) => n.includes('小李') && n.includes('editor')),
    JSON.stringify(approvedRoom));
  check('错误语义探测（过期码 / 同账号 / 重复加入 / 版本过旧 / 拒绝后不留痕）',
    probes &&
      probes.invalidCode === 'joinInvalidCode' &&
      probes.sameAccount === 'joinSameAccountNotAllowed' &&
      probes.duplicateGuest === 'joinSameAccountNotAllowed' &&
      probes.incompatible === 'joinIncompatibleRoom' &&
      probes.helloProtocol === 1 &&
      probes.rejectFlow === 'accepted' &&
      probes.pendingAfterReject === 0,
    JSON.stringify(probes));
  check('Agent 任务：队员提交 → 房主批准 → 状态变排队',
    first('guest', 'GUEST_TASK_SUBMITTED') === true &&
      find('host', 'HOST_TASK_DECIDED').length > 0 &&
      Array.isArray(queued) && queued.includes('queued'),
    JSON.stringify({ submitted: first('guest', 'GUEST_TASK_SUBMITTED'), queued }));

  // ── 共享文件：四条核心语义 ──
  check('① 房主写 → 队员读到新内容（房主权威 · 版本号 v2）',
    Array.isArray(sharedList) && sharedList.some((f) => f.path === 'notes.md') &&
      hostWrote?.ok === true && hostWrote?.version === 2 &&
      guestRead?.ok === true && guestRead?.version === 2 &&
      String(guestRead?.content ?? '').includes('A-EDIT'),
    JSON.stringify({ shared: sharedList, hostWrote, guestRead }));

  check('② 队员写 → 房主收到 file-changed 广播，且磁盘上真的是队员那一版',
    guestWrote?.ok === true && guestWrote?.version === 3 &&
      hostFileEvent?.version === 3 &&
      String(hostFileEvent?.content ?? '').includes('B-EDIT') &&
      String(diskAt(3, 'notes.md')?.content ?? '').includes('B-EDIT'),
    JSON.stringify({ guestWrote, hostFileEvent, diskV3: String(diskAt(3, 'notes.md')?.content ?? '').slice(0, 60) }));

  check('③ 过期基版本的写被拒，并回冲突现场（磁盘版本 + 磁盘全文）',
    guestConflict?.ok === false &&
      guestConflict?.error === 'fileConflict' &&
      guestConflict?.version === 3 &&
      guestConflict?.diskVersion === 3 &&
      String(guestConflict?.content ?? '').includes('B-EDIT'),
    JSON.stringify(guestConflict));

  check('④ 冲突处置「覆盖」真实生效：用磁盘版本当基版本重写 → v4 且磁盘跟着变',
    guestOverwrite?.ok === true &&
      guestOverwrite?.version === 4 &&
      String(diskAt(4, 'notes.md')?.content ?? '').includes('OVERWRITE'),
    JSON.stringify({ guestOverwrite, diskV4: String(diskAt(4, 'notes.md')?.content ?? '').slice(0, 60) }));

  check('⑤ 冲突处置「另存」真实生效：原文件不动，副本落盘并自动进共享清单',
    guestCopy?.ok === true &&
      guestCopy?.savedAs === 'notes-副本.md' &&
      guestCopy?.version === 1 &&
      String(diskAt(1, 'notes-副本.md')?.content ?? '').includes('COPY'),
    JSON.stringify({ guestCopy, diskCopy: String(diskAt(1, 'notes-副本.md')?.content ?? '').slice(0, 60) }));

  check('⑥ 查看者写入被拒（只读），但读得到；未共享的文件读不到',
    probes?.viewerWrite === 'fileReadOnly' &&
      probes?.viewerRead === true &&
      probes?.unsharedRead === 'fileNotShared' &&
      probes?.membersAfterViewer === 2,
    JSON.stringify({ viewerWrite: probes?.viewerWrite, viewerRead: probes?.viewerRead, unsharedRead: probes?.unsharedRead, membersAfterViewer: probes?.membersAfterViewer }));

  check('⑦ 队员在房间时房主改文件 → 队员实时收到 file-changed（推的是全文）',
    hostPushed?.ok === true && hostPushed?.version === 2 &&
      guestSawHostEdit?.version === 2 &&
      String(guestSawHostEdit?.content ?? '').includes('PLAN-EDIT'),
    JSON.stringify({ hostPushed, guestSawHostEdit }));
  check('退出协作后房主成员回到 1 人并结束房间',
    first('guest', 'GUEST_LEFT') !== undefined || find('guest', 'GUEST_LEFT').length > 0
      ? first('host', 'HOST_MEMBERS_AFTER_LEAVE') === 1 && find('host', 'HOST_STOPPED').length > 0
      : false,
    JSON.stringify({ afterLeave: first('host', 'HOST_MEMBERS_AFTER_LEAVE'), stopped: find('host', 'HOST_STOPPED').length }));
  check('两个进程都正常退出（exit 0）',
    host?.exitCode === 0 && guest?.exitCode === 0,
    `host=${host?.exitCode ?? 'running'} guest=${guest?.exitCode ?? 'running'}`);

  // ── 输出 ──
  console.log('\n──────── 对端原始输出 ────────');
  for (const l of rawLines) console.log(l);
  console.log('\n──────── 断言 ────────');
  for (const c of checks) {
    console.log(`${c.ok ? '✔' : '✘'} ${c.label}${c.detail ? `\n    ${c.detail}` : ''}`);
  }
  const pass = checks.filter((c) => c.ok).length;
  console.log(`\n结果：${pass}/${checks.length} 通过`);
  const errs = [host, guest].filter((c) => c && c.err);
  for (const c of errs) console.log(`[stderr] ${c.err.trim().slice(0, 600)}`);
  process.exit(failed ? 1 : 0);
}

host = startPeer('host', ['host']);

const deadline = setTimeout(() => {
  check('整体流程在 75s 内跑完', false, '超时');
  killAll();
  report();
}, 75_000);
deadline.unref();

let exited = 0;
for (const c of [host]) {
  c.on('exit', () => {
    exited += 1;
    // 房主退出后再等队员收尾
    setTimeout(() => {
      killAll();
      clearTimeout(deadline);
      report();
    }, 400);
  });
}

process.on('uncaughtException', (err) => {
  check('父进程无异常', false, String(err));
  killAll();
  report();
});
