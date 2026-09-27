/**
 * electron-builder afterPack —— 第三、四层防线落位点。
 *
 * 在 win-unpacked 产物就绪后（nsis/portable 封装之前）执行：
 *   ① Electron Fuses（官方二进制级运行时锁，烧录进 electron exe）：
 *      - RunAsNode           OFF  → ELECTRON_RUN_AS_NODE 失效，
 *                                   根治「宿主注入让 electron 退化成 Node」类假故障
 *      - NODE_OPTIONS        OFF  → 环境变量注入 --require 失效
 *      - NodeCliInspect      OFF  → --inspect 调试失效
 *      - EmbeddedAsarIntegrity ON → exe 内嵌 app.asar 指纹，改动即拒绝启动
 *      - OnlyLoadAppFromAsar    ON → 应用必须从 asar 加载（防散文件替换）
 *   ② resources/integrity.meta —— app.asar + 关键技能/算法文件的 sha256 指纹，
 *      由字节码化的 _security.jsc 启动时二次校验（双保险）。
 *
 * ⚠️ fuses 只烧进发布产物（win-unpacked/MModels.exe），
 *    开发用 node_modules/electron 不受影响 —— clean-env/test:native 等照常。
 * ⚠️ 关键资源只收录小型、会影响执行逻辑的文件（SKILL.md、模板元数据、算法目录），
 *    不在启动时重新哈希数百 MB 的模型运行时，避免影响首屏速度。
 */
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { flipFuses, FuseV1Options, FuseVersion } = require('@electron/fuses');

function collectCriticalResources(resourcesDir) {
  const files = [];
  const add = (relative) => {
    const absolute = path.join(resourcesDir, relative);
    if (!existsSync(absolute)) return;
    const stat = require('node:fs').statSync(absolute);
    if (!stat.isFile()) return;
    files.push({
      path: relative.replaceAll(path.sep, '/'),
      hash: createHash('sha256').update(readFileSync(absolute)).digest('hex'),
      size: stat.size,
    });
  };
  const walk = (relativeDir, predicate) => {
    const absoluteDir = path.join(resourcesDir, relativeDir);
    if (!existsSync(absoluteDir)) return;
    for (const entry of require('node:fs').readdirSync(absoluteDir, { withFileTypes: true })) {
      const relative = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) walk(relative, predicate);
      else if (predicate(relative)) add(relative);
    }
  };
  walk('builtin-skills', (relative) => {
    const name = path.basename(relative).toLowerCase();
    return name === 'skill.md' || name === 'plugin.json' || name === 'template.json';
  });
  add('algorithms/catalog.json');
  add('license-policy.json');
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** asar 完整性 fuse 是否启用 —— 若 electron-builder 未写指纹导致启动失败，可临时关掉排查 */
const ENABLE_ASAR_INTEGRITY = process.env.MM_FUSES_NO_INTEGRITY !== '1';
/** 分层排查开关：MM_FUSES_DISABLE_ALL=1 时全关 fuses（保留混淆+字节码层），用于二分定位 */
const DISABLE_ALL = process.env.MM_FUSES_DISABLE_ALL === '1';

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir; // .../dist/win-unpacked
  const exeName = context.packager.appInfo.productFilename; // MModels
  const exePath = path.join(appOutDir, `${exeName}.exe`);
  const resourcesDir = path.join(appOutDir, 'resources');
  const asarPath = path.join(resourcesDir, 'app.asar');

  if (!existsSync(exePath)) throw new Error(`afterPack: 找不到 ${exePath}`);

  // ── ① Electron Fuses ────────────────────────────────────────
  // ⚠️ FuseVersion 的键是大写 V1（@electron/fuses 2.1.3），写 v1 会得到
  //    undefined → flipFuses 抛 "Unsupported fuse version number: undefined"。
  const fusesConfig = DISABLE_ALL
    ? {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: true,
        [FuseV1Options.EnableNodeCliInspectArguments]: true,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
        [FuseV1Options.OnlyLoadAppFromAsar]: false,
      }
    : {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: ENABLE_ASAR_INTEGRITY,
        [FuseV1Options.OnlyLoadAppFromAsar]: ENABLE_ASAR_INTEGRITY,
      };
  await flipFuses(exePath, fusesConfig);
  console.log('[after-pack] fuses 烧录完成:', JSON.stringify(fusesConfig));

  // 商业发布脚本会显式注入 required=1；不把令牌写入安装包，只写策略与服务地址。
  // 这里仍做最后一道硬校验，防止有人绕过 release-hardened 直接用错误配置打包。
  if (process.env.MM_RELEASE_HARDENED === '1' && process.env.MM_LICENSE_REQUIRED !== '1') {
    throw new Error('商业发布缺少 MM_LICENSE_REQUIRED=1，已拒绝生成无授权安装包');
  }
  const licensePolicy = {
    schema: 1,
    required: process.env.MM_LICENSE_REQUIRED === '1',
    endpoint: process.env.MM_LICENSE_URL || '',
    cacheTtlMs: 300000,
  };
  if (process.env.MM_RELEASE_HARDENED === '1' && !/^https:\/\//i.test(licensePolicy.endpoint)) {
    throw new Error(`商业发布授权地址必须是 HTTPS：${licensePolicy.endpoint || '（空）'}`);
  }
  if (process.env.MM_RELEASE_HARDENED === '1' && !/\/api\/license\/check\/?$/i.test(licensePolicy.endpoint)) {
    throw new Error(`商业发布授权地址必须是 /api/license/check：${licensePolicy.endpoint}`);
  }
  writeFileSync(path.join(resourcesDir, 'license-policy.json'), JSON.stringify(licensePolicy, null, 2), 'utf8');
  console.log(`[after-pack] license-policy 写入完成 (required=${licensePolicy.required})`);

  // ── ② asar 指纹 ─────────────────────────────────────────────
  if (existsSync(asarPath)) {
    const hash = createHash('sha256').update(readFileSync(asarPath)).digest('hex');
    const meta = {
      schema: 2,
      algo: 'sha256',
      hash,
      builtAt: new Date().toISOString(),
      version: context.packager.appInfo.version,
      files: collectCriticalResources(resourcesDir),
    };
    writeFileSync(path.join(resourcesDir, 'integrity.meta'), JSON.stringify(meta, null, 2), 'utf8');
    console.log(`[after-pack] integrity.meta 写入完成 (sha256=${hash.slice(0, 16)}…)`);
  } else {
    console.warn('[after-pack] 未找到 app.asar，跳过指纹写入');
  }

};
