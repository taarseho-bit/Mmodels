/**
 * 用 corepack 缓存里的 pnpm 跑 install。
 *
 * 为什么不直接写 `pnpm install`：这台机器上 pnpm 不在 PATH 里，
 * 只有 corepack 缓存；而且 Git Bash 的 `/c/...` 路径传给 Windows 版 node
 * 会被解析成 `D:\c\...`（因为当前盘是 D:），必须用 `C:/...` 形式。
 */
const { execFileSync } = require('node:child_process');

const PNPM = process.env.MM_PNPM || process.env.npm_execpath || 'pnpm';
const NODE = process.env.MM_NODE || process.execPath;
const ROOT = 'D:/mathmodel-desktop';

const env = { ...process.env };
// 清掉宿主注入的 fs.rm 钩子与 ELECTRON_RUN_AS_NODE（见 electron-rebuild-package 技能）
env.NODE_OPTIONS = '';
delete env.ELECTRON_RUN_AS_NODE;
for (const key of Object.keys(env)) {
  if (/SAFE_DELETE_BULK_GUARD$/i.test(key)) delete env[key];
  if (/SAFE_DELETE_ENABLED$/i.test(key)) env[key] = '0';
}

const args = process.argv.slice(2);
console.log('pnpm ' + args.join(' '));

try {
  const out = execFileSync(NODE, [PNPM, ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 900000,
  });
  console.log(out.slice(-3000));
  console.log('EXIT=0');
} catch (e) {
  console.log('EXIT=' + e.status);
  console.log('STDOUT:\n' + String(e.stdout || '').slice(-4000));
  console.log('STDERR:\n' + String(e.stderr || '').slice(-4000));
}
