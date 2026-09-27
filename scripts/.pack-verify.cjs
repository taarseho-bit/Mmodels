/**
 * 加固打包产物（dist/win-unpacked/MModels.exe）启动验证。
 * 验证点：
 *   1. fuses 生效下正常启动（asar integrity + only_load_app_from_asar 不误杀）
 *   2. anti-tamper（_security.jsc）放行正常包、integrity.meta 匹配
 *   3. renderer 出现 = preload 字节码在打包态加载成功
 * 轮询 renderer >= 1 即成功；超时 40s 失败。
 */
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const EXE = process.env.MATHMODEL_TEST_APP || path.join(ROOT, 'dist', 'win-unpacked', 'MModels.exe');

if (!fs.existsSync(EXE)) {
  console.error('找不到 ' + EXE + ' —— 先打包');
  process.exit(2);
}

const env = { ...process.env };
delete env.NODE_OPTIONS;
env.MATHMODEL_DEBUG = '1';
// 独立 userData：不与用户开着的正式版抢锁；也让 boot 日志隔离可查
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'mmodels-packverify-'));
env.MATHMODEL_USERDATA = tmpUserData;
// 项目目录也必须隔离：否则首次启动播种会落到真实的「MModels Projects」目录。
// 反篡改仍会执行；E2E 只额外允许本验证所需的 remote-debugging-port。
env.MATHMODEL_E2E = '1';

let stderrBuf = '';
let stdoutBuf = '';
const child = spawn(EXE, [], { cwd: path.dirname(EXE), env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (c) => (stdoutBuf += c));
child.stderr.on('data', (c) => (stderrBuf += c));
let exitInfo = 'running';
child.on('exit', (code, signal) => (exitInfo = `exit=${code} signal=${signal}`));

function countRenderers() {
  try {
    // 只统计本次启动的进程树，避免用户同时打开正式版时把旧 renderer
    // 误算成当前包已启动。CIM 能拿到 Electron 子进程的 ParentProcessId。
    const ps = [
      '$root = ' + child.pid + ';',
      '$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine);',
      '$ids = New-Object System.Collections.Generic.HashSet[uint32];',
      '[void]$ids.Add([uint32]$root);',
      'do { $added = $false; foreach ($p in $all) { if ($ids.Contains([uint32]$p.ParentProcessId) -and $ids.Add([uint32]$p.ProcessId)) { $added = $true } } } while ($added);',
      "@($all | Where-Object { $ids.Contains([uint32]$_.ProcessId) -and [string]$_.CommandLine -match '--type=renderer' }).Count",
    ].join(' ');
    const out = execSync('powershell -NoProfile -Command "' + ps + '"', { encoding: 'utf8', shell: 'cmd.exe' });
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return -1;
  }
}

const FATAL_PATTERNS = [
  /Integrity check failed/i,
  /cachedDataRejected/i,
  /SIGTRAP|Fatal error|CHECK\(.*\) failed/i,
  /ERR_REQUIRE_ESM/i,
  /Cannot find module/i,
];

const t0 = Date.now();
let rendererSeenAt = 0;
const timer = setInterval(() => {
  const renderers = countRenderers();
  if (renderers > 0 && !rendererSeenAt) rendererSeenAt = Date.now();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const stable = rendererSeenAt > 0 && Date.now() - rendererSeenAt >= 3000;
  if (stable || elapsed > 40 || exitInfo !== 'running') {
    clearInterval(timer);
    const fatalHits = FATAL_PATTERNS.filter((re) => re.test(stderrBuf));
    const report = {
      renderers,
      elapsed,
      exitInfo,
      fatalHits: fatalHits.map((r) => r.toString()),
      userData: tmpUserData,
      stderrTail: stderrBuf.split('\n').slice(-25).join('\n'),
      stdoutTail: stdoutBuf.split('\n').slice(-40).join('\n'),
    };
    const startupLog = path.join(tmpUserData, 'startup-error.log');
    const startupText = fs.existsSync(startupLog) ? fs.readFileSync(startupLog, 'utf8') : '';
    report.startupError = startupText.slice(-4000);
    const startupFatal = /启动失败|数据库尚未初始化|数据库初始化失败|本地服务启动失败/.test(startupText);
    report.startupFatal = startupFatal;
    const isolatedWorkspace = path.join(tmpUserData, 'projects', 'MModels Workspace');
    report.workspacePath = isolatedWorkspace;
    report.workspaceIsolated = fs.existsSync(isolatedWorkspace);
    fs.writeFileSync(path.join(__dirname, '.pack-verify.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(`renderers=${renderers} elapsed=${elapsed}s ${exitInfo} fatal=${fatalHits.length} startupFatal=${startupFatal} workspaceIsolated=${report.workspaceIsolated}`);
    try {
      // 只杀本验证启动的进程树（taskkill /PID 树）
      execSync(`taskkill /F /PID ${child.pid} /T 2>nul`, { shell: 'cmd.exe', stdio: 'ignore' });
    } catch {}
    process.exit(fatalHits.length === 0 && startupFatal === false && renderers > 0 && report.workspaceIsolated === true ? 0 : 1);
  }
}, 1500);
