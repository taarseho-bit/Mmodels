/**
 * 一键发布加固版：安装版与便携版使用同一份加固产物。
 *
 * 可选商业授权构建：
 *   MM_LICENSE_REQUIRED=1 MM_LICENSE_URL=https://license.example.com/check npm run release:hardened
 * 未设置时保持当前本地 API 用户的行为不变；设置后每次模型回合都需要在线授权确认。
 */
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const node = process.execPath;

function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(NODE_OPTIONS|ELECTRON_RUN_AS_NODE|.*SAFE_DELETE_|FS_PROTECTION_ROLE|MM_FUSES_.*)$/i.test(key)) delete env[key];
  }
  return env;
}

function run(label, args, extraEnv = {}) {
  console.log(`\n[release] ${label}`);
  const result = spawnSync(node, ['scripts/clean-env.cjs', ...args], {
    cwd: ROOT,
    env: { ...cleanEnv(), ...extraEnv },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`${label}失败（退出码 ${result.status ?? 'unknown'}）`);
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeManifest(env) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const artifacts = fs.readdirSync(DIST)
    .filter((name) => /\.exe$/i.test(name))
    .map((name) => {
      const file = path.join(DIST, name);
      return { file: name, bytes: fs.statSync(file).size, sha256: sha256(file) };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
  const manifest = {
    schema: 1,
    product: 'MModels',
    version: pkg.version,
    builtAt: new Date().toISOString(),
    licenseRequired: env.MM_LICENSE_REQUIRED === '1',
    artifacts,
    checks: { hardening: 'passed', attackSurface: 'passed', realApp: 'passed' },
  };
  fs.writeFileSync(path.join(DIST, 'release-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[release] 已生成 dist/release-manifest.json（${artifacts.length} 个 exe）`);
}

function main() {
  const env = cleanEnv();
  run('构建混淆、字节码和资源指纹', ['npm', 'run', 'build:harden'], env);
  run('生成安装版与便携版', ['node', 'node_modules/electron-builder/cli.js', '--win', '--x64'], env);
  run('攻击面回归（环境注入、篡改、调试参数）', ['node', 'scripts/.atk-verify.cjs'], env);
  run('正常启动回归', ['node', 'scripts/.pack-verify.cjs'], env);
  run('真实功能回归', ['node', 'scripts/test-real-app.cjs'], env);
  writeManifest(env);
  console.log('\n[release] 加固发布完成：安装版与便携版共用同一套安全构建流程。');
}

try {
  main();
} catch (error) {
  console.error('[release] 中止：', error instanceof Error ? error.message : error);
  process.exit(1);
}
