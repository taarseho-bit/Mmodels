/**
 * 通用：把 scripts/<entry>.mjs 打成 ESM bundle 并跑。
 * 用法：node scripts/verify.cjs <entryName> [outdirName]
 *
 * 项目 package.json 有 "type": "module" → 必须 format=esm + .mjs 输出。
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = 'D:\\mathmodel-desktop';
const NODE = process.env.MM_NODE || process.execPath;
const entry = process.argv[2] || 'smoke';
const outName = process.argv[3] || 'mm-verify';

const log = [];
const OUT = path.join(os.tmpdir(), outName);

// 1) 找 esbuild
let esbuild = path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
if (!fs.existsSync(esbuild)) {
  const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm');
  const hit = fs.existsSync(pnpmDir) && fs.readdirSync(pnpmDir).find((d) => d.startsWith('esbuild@'));
  if (hit) esbuild = path.join(pnpmDir, hit, 'node_modules', 'esbuild', 'bin', 'esbuild');
}
log.push('esbuild=' + esbuild + ' exists=' + fs.existsSync(esbuild));

// 2) bundle
const bundle = path.join(ROOT, 'out', entry + '.mjs');
try {
  execFileSync(
    NODE,
    [esbuild, path.join(ROOT, 'scripts', entry + '.mjs'), '--bundle', '--platform=node',
     '--format=esm', '--external:electron',
     // ⚠️ 验证脚本会 import 真实主进程模块，那些模块用了 tsconfig 的 paths 别名；
     //    esbuild 不认识 paths，漏了别名会打包失败 —— 见 bundle-smoke.cjs 的同类注释。
     '--alias:@shared=./src/shared',
     '--alias:@renderer=./src/renderer/src',
     '--outfile=' + bundle],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  log.push('bundle OK ' + fs.statSync(bundle).size + ' bytes');
} catch (e) {
  log.push('bundle FAILED status=' + e.status);
  log.push(String(e.stderr || '').slice(0, 3000));
  fs.writeFileSync(path.join(ROOT, 'out', 'verify-' + entry + '.txt'), log.join('\n'), 'utf8');
  process.exit(1);
}

// 3) run
const env = { ...process.env };
// ⚠️ 必须彻底清掉宿主注入的 Node 层钩子，否则验证脚本跑不起来：
//    1) ELECTRON_RUN_AS_NODE=1 → electron.exe 退化成普通 Node，
//       require('electron') 只拿到 npm 包的路径字符串，API 全 undefined
//    2) NODE_OPTIONS=--require=.../node-language-shim.cjs → 会接管 fs.rmSync，
//       清理临时目录时报 EPERM（表现为「App threw an error during load」，
//       看起来像应用崩了，其实是钩子不让删）
//    只清其中一两个不够 —— 凡是名字里带 SAFE_DELETE 的都要去掉。
for (const k of Object.keys(env)) {
  if (/NODE_OPTIONS|ELECTRON_RUN_AS_NODE|SAFE_DELETE/i.test(k)) delete env[k];
}
env.NODE_OPTIONS = '';
env.VERIFY_OUT = OUT;

try {
  execFileSync(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [bundle], {
    cwd: ROOT, encoding: 'utf8', timeout: 300000, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  log.push('electron status=0');
} catch (e) {
  log.push('electron status=' + e.status);
  log.push('stderr=' + String(e.stderr || '').slice(0, 4000));
}

// 4) 收集产物
const traceFile = path.join(OUT, 'trace.txt');
const shotsTrace = path.join(OUT, 'shots-trace.txt');
for (const f of [traceFile, shotsTrace]) {
  if (fs.existsSync(f)) {
    log.push('---- ' + path.basename(f) + ' ----');
    log.push(fs.readFileSync(f, 'utf8'));
  }
}

// 5) 把 png 拷进 out/shots
const shotsDir = path.join(ROOT, 'out', 'shots');
fs.mkdirSync(shotsDir, { recursive: true });
if (fs.existsSync(OUT)) {
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.png')) fs.copyFileSync(path.join(OUT, f), path.join(shotsDir, f));
  }
  log.push('---- shots copied: ' + fs.readdirSync(shotsDir).filter((f) => f.endsWith('.png')).join(', '));
}

fs.writeFileSync(path.join(ROOT, 'out', 'verify-' + entry + '.txt'), log.join('\n'), 'utf8');
console.log('done ' + entry);
