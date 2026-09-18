/** 用 esbuild 把冒烟脚本打成 ESM bundle（项目 package.json 有 "type":"module"） */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'D:\\mathmodel-desktop';
const NODE = 'C:\\Users\\xh\\.workbuddy\\binaries\\node\\versions\\22.22.2-3\\node.exe';

// 找 esbuild 的入口
const candidates = [
  path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild'),
  path.join(ROOT, 'node_modules', '.bin', 'esbuild.cmd'),
];
let esbuild = candidates.find((c) => fs.existsSync(c));
if (!esbuild) {
  // pnpm 藏在 .pnpm 里
  const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmDir)) {
    const hit = fs.readdirSync(pnpmDir).find((d) => d.startsWith('esbuild@'));
    if (hit) {
      const p = path.join(pnpmDir, hit, 'node_modules', 'esbuild', 'bin', 'esbuild');
      if (fs.existsSync(p)) esbuild = p;
    }
  }
}

const log = [];
log.push('esbuild = ' + esbuild);
if (!esbuild) {
  log.push('❌ 找不到 esbuild');
  fs.writeFileSync(path.join(ROOT, 'out', 'bundle-log.txt'), log.join('\n'), 'utf8');
  process.exit(1);
}

const outFile = path.join(ROOT, 'out', 'smoke.mjs');
try {
  const out = execFileSync(
    NODE,
    [
      esbuild,
      path.join(ROOT, 'scripts', 'smoke.mjs'),
      '--bundle',
      '--platform=node',
      '--format=esm',
      '--external:electron',
      // ⚠️ 必须补路径别名。验证脚本现在会 import 真实的主进程模块，
      //    而那些模块用了 @shared / @core 别名；esbuild 不认识 tsconfig 的 paths。
      //    漏了这行会让打包**失败**，然后跑到上一版产物上 —— 表现为
      //    「明明加了新桩，却报 No handler registered」。
      '--alias:@shared=./src/shared',
      '--alias:@renderer=./src/renderer/src',
      '--outfile=' + outFile,
    ],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  log.push('OK');
  log.push(out);
} catch (e) {
  log.push('status=' + e.status);
  log.push('stdout=' + String(e.stdout || ''));
  log.push('stderr=' + String(e.stderr || ''));
  // ⚠️ 必须显式失败退出。以前这里只是记一笔日志就继续，
  //    结果跑的是**上一版旧 bundle**，验证结论全是假的。
  fs.writeFileSync(path.join(ROOT, 'out', 'bundle-log.txt'), log.join('\n'), 'utf8');
  console.error('❌ 冒烟脚本打包失败，请查看 out/bundle-log.txt');
  process.exit(1);
}

const size = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
log.push('bundle size = ' + size + ' bytes');
if (size === 0) {
  fs.writeFileSync(path.join(ROOT, 'out', 'bundle-log.txt'), log.join('\n'), 'utf8');
  console.error('❌ 打包产物为空');
  process.exit(1);
}
fs.writeFileSync(path.join(ROOT, 'out', 'bundle-log.txt'), log.join('\n'), 'utf8');
console.log('done');
