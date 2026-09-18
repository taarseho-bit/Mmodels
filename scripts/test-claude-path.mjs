/**
 * 验证 claude 可执行文件定位（开发期 + 模拟打包期）。
 *
 * 这是个**打包后才会暴露的坑**：原来用 `process.cwd()` 拼路径，
 * 开发期能跑，打包后 cwd 是启动目录、且 asar 内路径不可执行 → 静默返回 null
 * → Agent 完全起不来，但界面看不出问题。
 *
 * ⚠️ 打成 **ESM**（不是 CJS）：生产主进程产物就是 ESM，
 *    而 `import.meta.url` 在 CJS 下会被 esbuild 替换成 undefined ——
 *    用 CJS 测就测不到真实形态。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esbuild = require('D:/mathmodel-desktop/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild');

const ROOT = 'D:/mathmodel-desktop';
const BUNDLE = path.join(ROOT, 'out', 'claude-path-bundle.mjs');

esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src', 'main', 'agent', 'env.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['electron'],
  outfile: BUNDLE,
  logLevel: 'error',
});

const env = await import(pathToFileURL(BUNDLE).href);

const out = [];
let fails = 0;
const ok = (c, l) => {
  if (!c) fails++;
  out.push(`${c ? 'PASS' : 'FAIL'}  ${l}`);
};

// ── 1) 开发期：应命中 <项目根>/resources/claude-code/claude.exe ──
const dev = env.resolveClaudeExecutable(ROOT);
out.push('开发期解析 = ' + dev);
ok(!!dev, '开发期能定位 claude');
ok(dev && dev.includes('claude-code'), '开发期优先用随包那份（resources/claude-code）');
ok(dev && fs.existsSync(dev), '解析出的路径真实存在');
ok(dev && fs.statSync(dev).size > 200 * 1024 * 1024, '文件体积是完整二进制（>200MB）');

// ── 2) 平台包名 ──
out.push('平台包名 = ' + env.platformPkgName());
const platTag = process.platform === 'win32' ? 'win32' : process.platform;
ok(env.platformPkgName().includes(platTag), '平台包名含平台标识');
ok(env.platformPkgName().startsWith('@anthropic-ai/'), '平台包名属于 @anthropic-ai 作用域');

// ── 3) 模拟打包期：伪造 process.resourcesPath ──
const fakeRes = path.join(ROOT, 'dist', 'win-unpacked', 'resources');
const saved = process.resourcesPath;
try {
  Object.defineProperty(process, 'resourcesPath', { value: fakeRes, configurable: true });
  const packed = env.resolveClaudeExecutable();
  out.push('打包期解析 = ' + packed);
  if (fs.existsSync(path.join(fakeRes, 'claude-code', 'claude.exe'))) {
    ok(packed && packed.startsWith(fakeRes), '打包期优先用 process.resourcesPath');
    ok(
      packed && packed.includes(path.join('claude-code', 'claude.exe')),
      '打包期命中 claude-code/claude.exe',
    );
  } else {
    out.push('SKIP  打包产物尚未生成，跳过打包期断言');
  }
} finally {
  if (saved === undefined) delete process.resourcesPath;
  else Object.defineProperty(process, 'resourcesPath', { value: saved, configurable: true });
}

// ── 4) 不存在的根不应抛异常 ──
try {
  const r = env.resolveClaudeExecutable('Z:/definitely/not/here');
  out.push('不存在的根 → ' + (r ?? 'null'));
  ok(true, '传入不存在的项目根不抛异常');
} catch (e) {
  ok(false, '传入不存在的项目根抛了异常：' + e.message);
}

out.push('');
out.push(`合计：${out.filter((l) => l.startsWith('PASS')).length} 通过 / ${fails} 失败`);
fs.writeFileSync(path.join(ROOT, 'out', 'claude-path-test.txt'), out.join('\n'), 'utf8');
console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILED`);
