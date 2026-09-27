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
// 注意：不设 MATHMODEL_E2E —— 本验证要确认 anti-tamper 对正常用户路径放行

let stderrBuf = '';
let stdoutBuf = '';
const child = spawn(EXE, [], { cwd: path.dirname(EXE), env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (c) => (stdoutBuf += c));
child.stderr.on('data', (c) => (stderrBuf += c));
let exitInfo = 'running';
child.on('exit', (code, signal) => (exitInfo = `exit=${code} signal=${signal}`));

function countRenderers() {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"name=\'MModels.exe\'\\").CommandLine | Select-String \'--type=renderer\' | Measure-Object | Select-Object -ExpandProperty Count"',
      { encoding: 'utf8', shell: 'cmd.exe' },
    );
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
const timer = setInterval(() => {
  const renderers = countRenderers();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (renderers > 0 || elapsed > 40 || exitInfo !== 'running') {
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
    fs.writeFileSync(path.join(__dirname, '.pack-verify.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(`renderers=${renderers} elapsed=${elapsed}s ${exitInfo} fatal=${fatalHits.length}`);
    try {
      // 只杀本验证启动的进程树（taskkill /PID 树）
      execSync(`taskkill /F /PID ${child.pid} /T 2>nul`, { shell: 'cmd.exe', stdio: 'ignore' });
    } catch {}
    process.exit(fatalHits.length === 0 && renderers > 0 ? 0 : 1);
  }
}, 1500);
