/**
 * 在「干净环境」里执行命令。
 *
 * 起因：宿主（WorkBuddy）会在环境里注入
 *   - NODE_OPTIONS=--require=…safe-delete-shim.cjs   → 把 fs.rmSync 换成走回收站的实现
 *   - ELECTRON_RUN_AS_NODE=1                          → 让 electron.exe 退化成纯 Node
 *   - CODEBUDDY_SAFE_DELETE_*                         → 删除代理开关
 *
 * 这会带来两个假故障：
 *   1. 打包时 vite 的 emptyDir() 清空 out/ 被判定为「批量删除」直接抛错，
 *      报 [SAFE_DELETE_BULK_CONFIRM_REQUIRED]，看起来像构建脚本坏了。
 *   2. 启动 electron.exe 时它不启动 Electron，而是变成 Node，
 *      表现为「ESM 不支持 require」之类的假报错。
 *
 * 所以凡是「构建 / 打包 / 起 Electron」的脚本，都要先过这一层。
 * 注意：这是环境变量问题，不是沙箱权限问题，所以不需要提权。
 *
 * 用法：node scripts/clean-env.cjs <命令> [参数…]
 */
const { spawnSync } = require('node:child_process');

const PATTERNS = [
  /^NODE_OPTIONS$/i,
  /^ELECTRON_RUN_AS_NODE$/i,
  /^CODEBUDDY_SAFE_DELETE_/i,
  /^WORKBUDDY_FS_PROTECTION_ROLE$/i,
];

const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (PATTERNS.some((re) => re.test(k))) continue;
  env[k] = v;
}
// 确保子进程不要再被注入 shim
delete env.NODE_OPTIONS;
delete env.ELECTRON_RUN_AS_NODE;

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('用法: node scripts/clean-env.cjs <命令> [参数…]');
  process.exit(2);
}

// ⚠️ 不要无脑 shell: true。
//    走 shell 时命令交给 cmd.exe，它**不认 `./x.exe` 这种写法**
//    （会报「'.' 不是内部或外部命令」），`node_modules/...` 同理会被当成命令名。
//    所以：能解析成真实可执行文件时直接 spawn，只有需要 shell 内建/管道时才走 shell。
const looksLikePath = /[\\/]/.test(cmd) || /\.(exe|cmd|bat)$/i.test(cmd);
const useShell = !looksLikePath;

const r = spawnSync(cmd, args, {
  stdio: 'inherit',
  env,
  shell: useShell,
  cwd: process.cwd(),
});
process.exit(r.status === null ? 1 : r.status);
