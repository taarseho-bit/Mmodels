/**
 * 一键发布加固版：安装版与便携版使用同一份加固产物。
 *
 * 商业发布构建默认开启在线授权。若要做本地开发包，请使用 npm run dist
 * （该脚本不会生成可交付的商业安装包）。发布时可通过 MM_LICENSE_URL 覆盖地址，
 * 但必须是 HTTPS；这样不会因为忘记环境变量而误发“无需授权”的安装包。
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
  const prefix = `MModels-${pkg.version}-`;
  const artifacts = fs.readdirSync(DIST)
    .filter((name) => /\.exe$/i.test(name) && name.startsWith(prefix))
    .map((name) => {
      const file = path.join(DIST, name);
      return { file: name, bytes: fs.statSync(file).size, sha256: sha256(file) };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
  const expected = [`${prefix}x64-Portable.exe`, `${prefix}x64-Setup.exe`];
  const missing = expected.filter((name) => !artifacts.some((a) => a.file === name || (a.file === name && a.bytes > 0)));
  if (missing.length || artifacts.some((a) => !a.bytes)) {
    throw new Error(`发布产物不完整或为空：${missing.join(', ') || '存在空文件'}`);
  }
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

function assertCommercialPolicy() {
  const policyPath = path.join(DIST, 'win-unpacked', 'resources', 'license-policy.json');
  if (!fs.existsSync(policyPath)) throw new Error('win-unpacked 缺少 license-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  if (policy.required !== true || !/^https:\/\//i.test(String(policy.endpoint || '')) || !/\/api\/license\/check\/?$/i.test(String(policy.endpoint || ''))) {
    throw new Error(`商业授权策略未锁定：${JSON.stringify(policy)}`);
  }
  console.log('[release] 商业授权策略已锁定：required=true / HTTPS / license-check');
}

function main() {
  const env = cleanEnv();
  env.MM_RELEASE_HARDENED = '1';
  env.MM_LICENSE_REQUIRED = '1';
  env.MM_LICENSE_URL = env.MM_LICENSE_URL || 'https://api.mmodel.top/api/license/check';
  if (!/^https:\/\//i.test(env.MM_LICENSE_URL)) {
    throw new Error(`商业发布必须使用 HTTPS 授权地址：${env.MM_LICENSE_URL}`);
  }
  run('构建混淆、字节码和资源指纹', ['npm', 'run', 'build:harden'], env);
  run('生成安装版与便携版', ['node', 'node_modules/electron-builder/cli.js', '--win', '--x64'], env);
  assertCommercialPolicy();
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
