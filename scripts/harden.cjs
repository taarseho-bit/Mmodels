/**
 * 加固管线 —— 把 electron-vite 构建产物升级为「反逆向形态」。
 *
 * 必须在 `electron-vite build` 之后、`electron-builder` 之前运行：
 *   npm run build:harden  ==  clean-env(npm run build) && clean-env(node scripts/harden.cjs)
 *
 * 四步（对应四层防线里的前两层）：
 *   ① 混淆 out/main/*.js（ESM，含动态 import 的 chunk）
 *      javascript-obfuscator：字符串 RC4 加密 + 控制流平坦化 + 死代码注入 +
 *      selfDefending（格式化即自毁）。对抗「把 JS 喂给 AI 去混淆」。
 *   ② 混淆 out/preload/index.cjs（CJS）
 *   ③ preload 保留 CJS 加载器，但经过强混淆：
 *      Electron renderer 的 preload 字节码会让 DevTools Runtime.enable 无响应，
 *      影响真实应用验收和部分调试工具。因此优先保证运行时兼容，敏感逻辑不放在 preload。
 *   ④ 反篡改模块 → V8 字节码（_security.jsc）：
 *      src/main/security/anti-tamper.ts 经 esbuild 打成 CJS 再编译，
 *      防止「直接删掉 anti-tamper 代码」的业余篡改。
 *      ⚠️ main 进程加载：必须用 compileElectronMainCode（真 main 进程编译，
 *         ELECTRON_RUN_AS_NODE 编出的字节码在 Electron ≥42 会 SIGTRAP）。
 *
 * ⚠️ ESM 限制：main 主 bundle 是 ESM，bytenode 不支持 ESM，故 main 走强混淆
 *    而非字节码；敏感逻辑应放入 security 模块（CJS 字节码）或服务端。
 * ⚠️ 运行环境：本脚本要过 clean-env（宿主 NODE_OPTIONS/ELECTRON_RUN_AS_NODE
 *    污染会假故障）；bytenode 内部自行 spawn electron.exe 编译。
 */
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'out');
const ELECTRON_EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const obfuscator = require('javascript-obfuscator');
const bytenode = require('bytenode');
const esbuild = require('esbuild');

// ── 混淆配置 ─────────────────────────────────────────────────
// 强度的取舍：字符串 RC4 + selfDefending + 平坦化全开会让启动变慢数倍，
// controlFlowFlatteningThreshold=0.5 / deadCodeInjectionThreshold=0.3 是
// 「可读性抹除收益 vs 运行时开销」的平衡点（实测启动可接受再调）。
const OBFUSCATE_OPTS = {
  compact: true,
  simplify: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false, // ESM 顶层改名有 external 引用风险，不开
  selfDefending: true, // 代码被美化/格式化后自我失效
  stringArray: true,
  stringArrayEncoding: ['rc4'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 1,
  splitStrings: true,
  splitStringsChunkLength: 10,
  transformObjectKeys: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.3,
  numbersToExpressions: true,
  unicodeEscapeSequence: false, // 中文字符串转义会体积膨胀；rc4 已覆盖
};

/** 收集待混淆的 main 侧 ESM 产物（index.js + 动态 chunk） */
function listMainBundles() {
  return fs
    .readdirSync(path.join(OUT, 'main'))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.min.js'))
    .map((f) => path.join(OUT, 'main', f));
}

function obfuscateFile(file) {
  const before = fs.statSync(file).size;
  const code = fs.readFileSync(file, 'utf8');
  const result = obfuscator.obfuscate(code, {
    ...OBFUSCATE_OPTS,
    inputFileName: path.basename(file),
  });
  fs.writeFileSync(file, result.getObfuscatedCode(), 'utf8');
  const after = fs.statSync(file).size;
  console.log(`[harden] obfuscated ${path.relative(ROOT, file)}  ${(before / 1024).toFixed(1)}KB -> ${(after / 1024).toFixed(1)}KB`);
}

/**
 * 字节码编译 —— ⚠️ 必须走 bytenode.compileFile 高层 API。
 *
 * 踩坑记录（2026-09-27）：直接调 compileElectronMainCode/compileElectronRendererCode
 * 会产出「裸 vm.Script(code)」的字节码 —— 没包 CJS wrapper，加载端
 * Module._extensions['.jsc'] apply 时 module/exports 全是自由变量，
 * 运行时抛 ReferenceError: module is not defined（showErrorBox 模态卡死）。
 * compileFile 内部会 Module.wrap(code) 包 wrapper，且 createLoader 直接
 * 生成 stub（require('bytenode') + require('./xxx.jsc')）。
 */
async function compileBytecodeFile(cjsFile, outputJsc, flavor) {
  await bytenode.compileFile({
    filename: cjsFile,
    output: outputJsc,
    electronPath: ELECTRON_EXE,
    ...(flavor === 'main' ? { electronMain: true } : { electronRenderer: true }),
    createLoader: 'commonjs',
    loaderFilename: path.basename(cjsFile), // loader 覆盖原 .cjs 位置 → 原文件变 stub
  });
  if (!fs.existsSync(outputJsc)) throw new Error(`bytenode 编译无产物：${outputJsc}`);
}

/** esbuild 打包 anti-tamper.ts 为 CJS（敏感逻辑进字节码的源头） */
function bundleSecurity() {
  const entry = path.join(ROOT, 'src', 'main', 'security', 'anti-tamper.ts');
  const outFile = path.join(OUT, 'main', '_security.cjs');
  esbuild.buildSync({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
    sourcemap: false,
    minify: true,
    legalComments: 'none',
    logLevel: 'silent',
  });
  console.log(`[harden] bundled security -> ${path.relative(ROOT, outFile)} (${fs.statSync(outFile).size}B)`);
  return outFile;
}

async function main() {
  const t0 = Date.now();
  if (!fs.existsSync(path.join(OUT, 'main', 'index.js'))) {
    throw new Error('out/main/index.js 不存在 —— 请先运行 electron-vite build');
  }
  // ⚠️ 防重入：本脚本只能跑在「干净的 electron-vite build 产物」上。
  //    在已加固产物上重跑会把 preload stub 当源码字节码化（真实逻辑丢失）、
  //    在混淆代码上再叠混淆（体积爆炸）。2026-09-27 实测踩坑。
  //    加固后 index.cjs 是 bytenode loader（require('./index.jsc')）。
  const preloadNow = fs.readFileSync(path.join(OUT, 'preload', 'index.cjs'), 'utf8');
  if (preloadNow.includes("require('./index.jsc')") || fs.existsSync(path.join(OUT, 'main', '_security.jsc'))) {
    throw new Error('out/ 已是加固产物 —— 请先 electron-vite build 覆盖后再跑本脚本（npm run build:harden）');
  }

  // ① main 侧 ESM bundle 全量混淆
  for (const f of listMainBundles()) obfuscateFile(f);

  // ② preload 混淆
  const preloadCjs = path.join(OUT, 'preload', 'index.cjs');
  obfuscateFile(preloadCjs);

  // ③ security → main 字节码
  const securityCjs = bundleSecurity();
  const securityJsc = securityCjs.replace(/\.cjs$/, '.jsc');
  await compileBytecodeFile(securityCjs, securityJsc, 'main');
  fs.unlinkSync(securityCjs); // 中间 CJS 删除（源码不随包）

  // 产物校验与清单
  if (!fs.existsSync(securityJsc)) throw new Error(`字节码产物缺失：${securityJsc}`);
  console.log('[harden] 产物：');
  for (const f of [path.join(OUT, 'main', 'index.js'), preloadCjs, securityJsc]) {
    console.log(`  ${path.relative(ROOT, f)}  ${(fs.statSync(f).size / 1024).toFixed(1)}KB`);
  }
  console.log(`[harden] 完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('[harden] 失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
