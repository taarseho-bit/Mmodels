/**
 * 攻击面验证 —— 证明防线真实生效：
 *   T1  ELECTRON_RUN_AS_NODE 注入 → fuse 应挡掉（不执行 JS、不当 Node）
 *   T2  篡改 app.asar → 应被拒（Electron fuse 层 / _security.jsc 层，任一触发即防线成立）
 *   T3  --remote-debugging-port → anti-tamper 应拒绝启动
 * 每个用例独立 userData，T2 结束还原 asar。
 */
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const EXE = process.env.MATHMODEL_TEST_APP || path.join(ROOT, 'dist', 'win-unpacked', 'MModels.exe');
const ASAR = path.join(path.dirname(EXE), 'resources', 'app.asar');

const results = [];

function mkUserData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmodels-atk-'));
  return dir;
}

function cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.MATHMODEL_E2E;
  delete env.MATHMODEL_UNHARDENED;
  delete env.MATHMODEL_DEBUG;
  return env;
}

/** 跑一次启动，返回 { exited, exitCode, stderr, stdout, aliveAfterMs } */
function runOnce(args, envExtra, waitMs, expectAlive) {
  return new Promise((resolve) => {
    const userData = mkUserData();
    const env = { ...cleanEnv(), MATHMODEL_USERDATA: userData, ...envExtra };
    let stderr = '';
    let stdout = '';
    let exited = false;
    let exitCode = null;
    const child = spawn(EXE, args, { cwd: path.dirname(EXE), env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', (c) => (stderr += c));
    child.stdout.on('data', (c) => (stdout += c));
    child.on('exit', (code) => {
      exited = true;
      exitCode = code;
    });
    setTimeout(() => {
      const alive = !exited;
      try {
        execSync(`taskkill /F /PID ${child.pid} /T 2>nul`, { shell: 'cmd.exe', stdio: 'ignore' });
      } catch {}
      setTimeout(() => resolve({ exited, exitCode, stderr, stdout, alive, userData }), 800);
    }, waitMs);
  });
}

async function main() {
  // ── T1: ELECTRON_RUN_AS_NODE 注入 ────────────────────────────
  {
    const userData = mkUserData();
    const env = { ...cleanEnv(), ELECTRON_RUN_AS_NODE: '1', MATHMODEL_USERDATA: userData };
    let stdout = '';
    let exited = false;
    const child = spawn(EXE, ['-e', 'console.log("PWNED_RUN_AS_NODE")'], {
      cwd: path.dirname(EXE),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (c) => (stdout += c));
    child.on('exit', (code) => (exited = true));
    await new Promise((r) => setTimeout(r, 6000));
    try {
      execSync(`taskkill /F /PID ${child.pid} /T 2>nul`, { shell: 'cmd.exe', stdio: 'ignore' });
    } catch {}
    // fuse OFF 的表现：run_as_node 无效 → 忽略 -e 作为 GUI 启动（进程活着）或退出但绝不打印 PWNED
    const pwned = stdout.includes('PWNED_RUN_AS_NODE');
    results.push({
      id: 'T1 run_as_node',
      pass: !pwned,
      detail: pwned ? '❌ JS 被当 Node 执行（fuse 未生效）' : `✓ 未执行（进程 ${exited ? '已退出' : '转 GUI 存活'}）`,
    });
  }

  // ── T2: 篡改 app.asar ───────────────────────────────────────
  {
    const backup = ASAR + '.atk-backup';
    fs.copyFileSync(ASAR, backup);
    try {
      // 破坏 asar 尾部 1 字节（不影响 header 长度结构的读法，但 hash 必变）
      const buf = fs.readFileSync(ASAR);
      buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;
      fs.writeFileSync(ASAR, buf);

      const r = await runOnce([], {}, 12000);
      // 防线成立 = 进程退出（fuse 层拒绝）或 stderr 有 integrity 字样；不能正常存活
      const rejected = !r.alive || /integrity|Integrity|checksum/i.test(r.stderr);
      results.push({
        id: 'T2 asar tamper',
        pass: rejected,
        detail: rejected
          ? `✓ 被拒（${r.alive ? 'stderr 命中' : `exit=${r.exitCode}`}）`
          : '❌ 篡改后仍正常存活（防线失效）',
        stderrSample: r.stderr.slice(0, 200),
        userData: r.userData,
      });
    } finally {
      fs.copyFileSync(backup, ASAR);
      fs.unlinkSync(backup);
    }
  }

  // ── T3: 调试端口 ────────────────────────────────────────────
  {
    const r = await runOnce(['--remote-debugging-port=9333'], {}, 10000);
    const rejected = !r.alive;
    results.push({
      id: 'T3 debug argv',
      pass: rejected,
      detail: rejected
        ? `✓ 被拒（exit=${r.exitCode}）`
        : '❌ 带 CDP 参数仍存活（anti-tamper 未拦）',
      stderrSample: r.stderr.slice(0, 200),
      userData: r.userData,
    });
  }

  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail}${r.stderrSample ? '  | stderr: ' + r.stderrSample.replace(/\n/g, ' ') : ''}`);
  fs.writeFileSync(path.join(__dirname, '.atk-report.json'), JSON.stringify(results, null, 2), 'utf8');
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
