/**
 * 论文模板扫描 —— **纯 Node 逻辑，不依赖 electron / 数据库**。
 * 见 `src/main/scan/diagram.ts` 顶部关于「为什么单独一个文件」的说明。
 *
 * 数据源：`<resources>/builtin-skills/write-paper/assets/template/<id>/template.json`
 * 每个模板自带元数据（名称、语言、入口文件、需要提前填写的字段）。
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  makeLocalizedText,
  pickLocalizedText,
  type PaperConfig,
  type PaperContestField,
  type PaperPageLimit,
  type PaperTemplate,
  type PaperTemplateDeleteResult,
  type PaperTemplateError,
  type PaperTemplateErrorCode,
  type PaperTemplateField,
  type PaperTemplateForkResult,
  type PaperTemplateOption,
  type PaperTemplateRef,
  type PaperTeamProfileSnapshot,
} from '@shared/types';

// ⚠️ `PaperTemplate` / `PaperTemplateField` 的定义**只在 `@shared/types` 一份**。
//    这里曾经各留一份本地副本（注释自称"镜像关系"），结果历史上漏同步字段直接
//    踩出 TS2353；类型形状改动（如 `label` 改本地化对象）会同时打到两处，极易只改一半。
//    本文件只 import，不再定义。

/** 相对 resources 根目录的模板路径 */
export const TEMPLATE_REL_DIR = 'builtin-skills/write-paper/assets/template';

// 文案解析统一走 `pickLocalizedText`（`@shared/types`）—— template.json 的
// `name` / `description` / `fields[].label` 本来就是应用约定 `Np` 对象，
// 与项目配置文件里的 `template.name` / `contestFields[].label` 是同一种形状。
// 历史上这里有一份本地 `pickLang`，与共享版重复 —— 已合并，不再各写一遍。

/**
 * 解析模板元数据的 `fields[].options`（应用约定 `Sre.options: ht(wre).max(30)`）。
 *
 * 应用约定靠 `options.length > 0` 决定这个字段渲染**下拉框**还是文本框；
 * 这里丢了 `options`，长三角 / 东三省 / 五一杯三个比赛就只能填文本框（应用约定是下拉）。
 *
 * 规则：逐项要 `value`（非空字符串）与 `label`（`Np`，中文缺则回退 `value`）；
 * **非法项直接丢掉**；一项都不剩就**返回 `undefined` 而不是 `[]`** ——
 * 渲染层只判一次 `?.length`，不用区分「没这个键」与「空数组」两种空。
 */
function parseFieldOptions(v: unknown): PaperTemplateOption[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: PaperTemplateOption[] = [];
  for (const raw of v) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const value = typeof o.value === 'string' ? o.value.trim() : '';
    if (!value) continue;
    out.push({
      value,
      label: makeLocalizedText(pickLocalizedText(o.label) || value, pickLocalizedText(o.label, 'en')),
    });
  }
  return out.length ? out : undefined;
}

/** 模板元数据文件名（每个模板目录下必须有一份） */
export const PAPER_TEMPLATE_MANIFEST = 'template.json';

/**
 * 扫描**一个**模板根目录。
 *
 * 内置库与受管自定义库用的是同一套目录约定（`<root>/<id>/template.json`），
 * 所以两处共用这一个函数 —— 应用约定也是同一个 `scanRoot(root, source)` 被调用两次。
 *
 * @param root   模板根目录
 * @param source 这批模板的来源标记（内置 `'builtin'` / 自定义 `'custom'`）
 */
export function scanTemplateRoot(root: string, source: 'builtin' | 'custom'): PaperTemplate[] {
  if (!existsSync(root)) return [];

  const out: PaperTemplate[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(root, e.name);
    const manifest = join(dir, PAPER_TEMPLATE_MANIFEST);
    if (!existsSync(manifest)) continue;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    } catch {
      // 单个模板元数据坏了不影响其它模板
      continue;
    }

    const fieldsRaw = Array.isArray(raw.fields) ? raw.fields : [];
    const fields: PaperTemplateField[] = [];
    for (const f of fieldsRaw) {
      const o = (f ?? {}) as Record<string, unknown>;
      const id = typeof o.id === 'string' ? o.id : '';
      if (!id) continue;
      const item: PaperTemplateField = {
        id,
        label: pickLocalizedText(o.label) || id,
        required: o.required === true,
      };
      // 英文标签单独留一份：写 `contestFields` 时要落成应用约定 `Np` 对象，`en` 就取这里
      // （内置 template.json 自带，如 cumcm 的「题号」→「Problem」）。
      const labelEn = pickLocalizedText(o.label, 'en');
      if (labelEn) item.labelEn = labelEn;
      const ph = pickLocalizedText(o.placeholder);
      if (ph) item.placeholder = ph;
      // 可选项 —— 应用约定靠它决定下拉框还是文本框。模板数据本来就带
      // （如长三角赛「赛道」的 本科生 / 研究生），之前在这里被丢掉。
      const options = parseFieldOptions(o.options);
      if (options) item.options = options;
      fields.push(item);
    }

    /**
     * 模板 id：**清单里的 `id` 优先，没有才退回目录名**。
     *
     * 为什么不能只用目录名：应用约定 fork 出来的模板，目录名是
     * `sanitize(名称)-<id 后 8 位>`（为了在资源管理器里可读），而 `id` 是
     * `custom-<随机>` —— 两者**不相等**。应用约定 fork 结束后就是靠
     * `scanRoot(root,'custom').find(t => t.id === id)` 找回新建的那条，
     * 只认目录名会让它找不到、直接把刚建好的模板回滚删掉。
     *
     * 内置模板的 template.json 里**没有**顶层 `id`（只有 `fields[].id`），
     * 所以这条回退对内置库是零影响（行为与改动前字段一致）。
     */
    const manifestId = typeof raw.id === 'string' && raw.id ? raw.id : e.name;

    out.push({
      id: manifestId,
      name: pickLocalizedText(raw.name) || manifestId,
      nameEn: pickLocalizedText(raw.name, 'en') || undefined,
      descriptionEn: pickLocalizedText(raw.description, 'en') || undefined,
      description: pickLocalizedText(raw.description) || '',
      language: typeof raw.language === 'string' ? raw.language : 'zh-CN',
      entryFile: typeof raw.entryFile === 'string' ? raw.entryFile : 'document.tex',
      order: typeof raw.order === 'number' ? raw.order : 999,
      // `defaultFor` 标出这个模板是哪些语言的默认项（如 cumcm → ['zh-CN']、
      // mcm → ['en']）。应用约定就是靠它决定首屏默认选中哪个比赛 ——
      // 丢了它，界面就只能显示"暂无模板"，用户看不到比赛选择。
      defaultFor: Array.isArray(raw.defaultFor)
        ? raw.defaultFor.filter((x): x is string => typeof x === 'string')
        : [],
      fields,
      profileFields: Array.isArray(raw.profileFields)
        ? raw.profileFields.filter((x): x is string => typeof x === 'string')
        : [],
      dir,
      // 来源由**调用方**指定（不是从清单里读的）：
      // 同一份目录换个根就是另一批模板，清单自己说了不算。
      source,
    });
  }

  // 按 order 升序，同 order 按 id
  out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return out;
}

/**
 * 扫描全部内置论文模板。
 * @param resourcesDir `process.resourcesPath`（打包后）或项目 `resources/`（开发期）
 */
export function listPaperTemplates(resourcesDir: string): PaperTemplate[] {
  return scanTemplateRoot(join(resourcesDir, TEMPLATE_REL_DIR), 'builtin');
}

// ─────────────────────────────────────────────────────────────
// 受管自定义模板库（应用约定 `customTemplatesRoot` + fork / delete）
//
// ⚠️ 与设置页那个「指一个本地目录当模板源」的增强入口**不是一回事**，两者并存：
//   · 这里 = 应用约定语义的**受管库** —— fork 出来的模板归我们管，存在用户数据目录下，
//     与项目无关，任何项目都能用（就是扩展页「我的模板」分组里那些）。
//   · 设置页那个 = 本项目**有意偏离**的增强 —— 用户指一个已有目录，
//     路径写进当前项目的 `.mathmodel/paper/config.json`（`source='custom'` + `sourcePath`），
//     只对那个项目生效。**它不经过本文件，也不该被本文件替换掉。**
// ─────────────────────────────────────────────────────────────

/** 受管自定义模板库在用户数据目录下的子目录名 */
export const CUSTOM_TEMPLATES_DIR_NAME = 'paper-templates';

/** 自定义模板 id 前缀（应用约定 `'custom-' + <随机>`） */
export const CUSTOM_TEMPLATE_PREFIX = 'custom-';

/**
 * 自定义模板的排序权重（应用约定写死 `order: 1000`）。
 * 内置模板的 order 是 10～130 —— 所以「我的模板」天然排在内置之后。
 */
export const CUSTOM_TEMPLATE_ORDER = 1000;

/** 模板名上限（应用约定 `name.length > 0x50` 即拒绝） */
export const MAX_TEMPLATE_NAME_LENGTH = 80;

/** 目录名里名称部分的长度上限（应用约定 `slice(0, 0x30)`） */
const MAX_TEMPLATE_DIR_STEM = 48;

/** 受管库根目录 —— 由调用方给出用户数据目录（纯函数，便于单测） */
export function customTemplatesRootIn(userDataDir: string): string {
  return join(userDataDir, CUSTOM_TEMPLATES_DIR_NAME);
}

/**
 * 错误码 → 应用约定 HTTP 状态码。
 *
 * 应用约定是 REST（`DELETE /api/paper-templates/:id` 等），当前实现走 IPC 没有状态码，
 * 但**分派关系要保住**（403 = 内置只读、404 = 找不到、500 = 删失败、503 = 库不可用），
 * 否则「被拒绝」和「删失败了」会混成同一个错误，用户看到的提示就错了。
 */
const PAPER_TEMPLATE_ERROR_STATUS: Record<PaperTemplateErrorCode, number> = {
  template_not_found: 404,
  builtin_template_readonly: 403,
  delete_failed: 500,
  custom_template_library_unavailable: 503,
  invalid_template_name: 400,
  unsafe_template: 400,
};

/** 造一个错误对象（结果类型里只有这一种失败形态） */
export function paperTemplateError(code: PaperTemplateErrorCode): PaperTemplateError {
  return { code, status: PAPER_TEMPLATE_ERROR_STATUS[code] };
}

/**
 * 内置 + 自定义合并成**一个模板库**（应用约定 `records()`）。
 *
 * · 内置先扫、自定义后扫，同 id **内置优先**（与 `records()` 里的 Set 去重同序）
 * · 按 order 升序 → 自定义（1000）排在内置（10～130）之后
 *
 * @param customRoot 受管库根目录；null = 库不可用（只返回内置）
 */
export function listPaperTemplateLibrary(opts: {
  resourcesDir: string;
  customRoot: string | null;
}): PaperTemplate[] {
  const all = listPaperTemplates(opts.resourcesDir);
  if (opts.customRoot) all.push(...scanTemplateRoot(opts.customRoot, 'custom'));

  const seen = new Set<string>();
  const deduped = all.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  deduped.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return deduped;
}

/** `child` 是否就是 `parent` 本身或在其内部（应用约定 fork/delete 的路径围栏） */
export function isInsideDir(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

/**
 * 目录树里有没有符号链接/联接 —— 有就不许 fork（应用约定 `unsafe_template`）。
 *
 * 理由：复制时 `dereference: false` 会把链接原样带过去，指向模板目录外面的文件；
 * 之后 Agent 把模板复制进项目，等于把一个不受控的路径引进了用户项目。
 */
export function hasUnsafeLink(dir: string): boolean {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) return true;
    if (!e.isDirectory()) continue;
    const p = join(dir, e.name);
    // 目录联接（Windows junction）在 `readdir` 的 dirent 上不一定标成 symlink，
    // 所以再 lstat 一次按真身判断。
    try {
      if (lstatSync(p).isSymbolicLink()) return true;
    } catch {
      /* 读不到就当没有：真正的失败会在复制那一步暴露 */
    }
    if (hasUnsafeLink(p)) return true;
  }
  return false;
}

/** Windows 保留设备名（不能当目录名） */
const RESERVED_DIR_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/**
 * 把模板名变成一个**可读且安全**的目录名片段（应用约定 fork 里那串 replace 的等价物）。
 *
 * 规则：控制字符 → 空格；`< > : " / \ | ? *` → 空格；折叠空白；去掉开头的点；
 * 截断到 48 字符；去掉结尾的空格与点；空则回落 `template`；命中保留设备名则加下划线。
 *
 * ⚠️ 与应用约定有一处**有意**差异：应用约定按行 split 后再 `join('')`，多行名称会被
 *    **拼成一坨**（"国赛\n模板" → "国赛模板"）；这里换成"换行 → 空格"（→ "国赛 模板"）。
 *    影响面只有目录名，显示名存的是原样的名字，不丢信息。
 */
export function sanitizeTemplateDirName(name: string): string {
  let s = String(name)
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();
  s = Array.from(s).slice(0, MAX_TEMPLATE_DIR_STEM).join('').replace(/[ .]+$/, '');
  if (!s) s = 'template';
  if (RESERVED_DIR_NAMES.has(s.toLowerCase())) s = `${s}_`;
  return s;
}

/** 受管库里的模板 id（应用约定 `'custom-' + 随机`） */
function newCustomTemplateId(): string {
  return `${CUSTOM_TEMPLATE_PREFIX}${randomBytes(6).toString('hex')}`;
}

/**
 * **基于某条模板派生一条自定义模板**（应用约定 `POST /api/paper-templates/fork`）。
 *
 * 顺序逐条对齐应用约定 `PaperTemplateService.fork()`：
 *   ① 没有受管库 → `custom_template_library_unavailable`(503)
 *   ② 来源模板找不到 → `template_not_found`(404)
 *   ③ 来源含符号链接 → `unsafe_template`(400)
 *   ④ 名字 trim 后为空或 > 80 → `invalid_template_name`(400)
 *   ⑤ 复制整份模板目录 → 写新的 `template.json`（`order: 1000`、`defaultFor: []`）
 *   ⑥ 复制/写盘失败 → 清掉半成品 + `custom_template_library_unavailable`(503)
 *
 * 复制走**临时目录 + rename**：中途失败不会在库里留下半个模板
 * （应用约定也是先拷到 `.custom-xxx.tmp` 再 rename）。
 *
 * @param idFactory 仅测试注入用；默认 `custom-<12 位随机>`
 */
export function forkPaperTemplate(opts: {
  resourcesDir: string;
  customRoot: string | null;
  templateId: string;
  name: string;
  idFactory?: () => string;
}): PaperTemplateForkResult {
  if (!opts.customRoot) {
    return { ok: false, error: paperTemplateError('custom_template_library_unavailable') };
  }

  const source = listPaperTemplateLibrary(opts).find((t) => t.id === opts.templateId);
  if (!source) return { ok: false, error: paperTemplateError('template_not_found') };
  if (hasUnsafeLink(source.dir)) return { ok: false, error: paperTemplateError('unsafe_template') };

  const trimmed = opts.name.trim();
  if (!trimmed || trimmed.length > MAX_TEMPLATE_NAME_LENGTH) {
    return { ok: false, error: paperTemplateError('invalid_template_name') };
  }

  const id = opts.idFactory ? opts.idFactory() : newCustomTemplateId();
  const root = resolve(opts.customRoot);
  let realRoot: string;
  try {
    mkdirSync(root, { recursive: true });
    realRoot = realpathSync(root);
  } catch {
    return { ok: false, error: paperTemplateError('custom_template_library_unavailable') };
  }

  const dest = join(realRoot, `${sanitizeTemplateDirName(trimmed)}-${id.slice(-8)}`);
  const staging = join(realRoot, `.${id}.tmp`);
  try {
    rmSync(staging, { recursive: true, force: true });
    cpSync(source.dir, staging, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
    });
    // 清单字段对齐应用约定 fork 写下的那份：
    // name 是应用约定 `Np` 对象（用户只输一个名字 → zh-CN 与 en 同值）、
    // order 1000（排在内置之后）、defaultFor 空（新模板不抢任何语言的默认位）。
    const meta = {
      schemaVersion: 1,
      id,
      name: { 'zh-CN': trimmed, en: trimmed },
      description: source.description,
      language: source.language,
      entryFile: source.entryFile,
      order: CUSTOM_TEMPLATE_ORDER,
      defaultFor: [] as string[],
      fields: source.fields,
      profileFields: source.profileFields,
    };
    writeFileSync(join(staging, PAPER_TEMPLATE_MANIFEST), JSON.stringify(meta, null, 2) + '\n', 'utf8');
    renameSync(staging, dest);
  } catch {
    // 半成品一律清掉：留下它 = 库里多一条扫不出元数据的空目录
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      /* 清不掉也不影响返回值 */
    }
    return { ok: false, error: paperTemplateError('custom_template_library_unavailable') };
  }

  const created = scanTemplateRoot(realRoot, 'custom').find((t) => t.id === id);
  if (!created) {
    // 拷完了但扫不出来（元数据坏）→ 回滚，别给用户留一条看不见的模板
    try {
      rmSync(dest, { recursive: true, force: true });
    } catch {
      /* 同上 */
    }
    return { ok: false, error: paperTemplateError('custom_template_library_unavailable') };
  }
  return { ok: true, template: created };
}

/**
 * **删除一条自定义模板**（应用约定 `DELETE /api/paper-templates/:id`）。
 *
 * ★★ 这是本功能的关键那道闸（BACKLOG §3-3 的风险段）★★
 *
 * 判据要求「内置模板的删除必须是**拒绝**，不是 UI 上不渲染按钮」。
 * 所以 `source` 是**本函数自己重新扫库得出的**，不接受调用方传入的
 * 「这是自定义模板」标记 —— 从任何地方（含直接调通道）拿内置模板的 id 进来，
 * 都会在第 ② 步被 `builtin_template_readonly`(403) 挡掉，**一个字节都不动**。
 *
 * 顺序逐条对齐应用约定：① 找不到 → 404；② 不是 custom → **403**；
 * ③ 库不可用 → 503；④ 路径越界/被解析改写 → `unsafe_template`；⑤ 删不掉 → 500。
 */
export function deletePaperTemplate(opts: {
  resourcesDir: string;
  customRoot: string | null;
  templateId: string;
}): PaperTemplateDeleteResult {
  // ① + ② 先查库再判只读 —— 顺序与应用约定一致：内置的库不可用也照样回 403
  const rec = listPaperTemplateLibrary(opts).find((t) => t.id === opts.templateId);
  if (!rec) return { ok: false, error: paperTemplateError('template_not_found') };
  if (rec.source !== 'custom') {
    return { ok: false, error: paperTemplateError('builtin_template_readonly') };
  }

  // ③ 到这里已经确定是自定义模板，才轮到"库在不在"
  if (!opts.customRoot) {
    return { ok: false, error: paperTemplateError('custom_template_library_unavailable') };
  }

  try {
    const root = resolve(opts.customRoot);
    const dir = resolve(rec.dir);
    // ④ 双重围栏：resolved 路径不能与库里记的不一致（中途被换成软链），
    //    且必须**正好是库根目录的下一层**（不许删到库外面去）。
    if (dir !== rec.dir || dirname(dir) !== root || !isInsideDir(root, dir)) {
      return { ok: false, error: paperTemplateError('unsafe_template') };
    }
    // ⑤ 删不掉（被占用 / 权限）→ 500。应用约定同样是"围栏错误原样上抛、其它归 delete_failed"，
    //    这里围栏那步是 return 不是 throw，所以 catch 只剩"真的没删掉"这一种。
    rmSync(dir, { recursive: true, force: false });
  } catch {
    return { ok: false, error: paperTemplateError('delete_failed') };
  }
  return { ok: true, id: rec.id };
}

/**
 * 项目内的配置目录名 —— **`.mathmodel`，与应用约定字段一致**。
 *
 * 依据（应用约定 asar）：
 *   · 协议实现 `Li = '.mathmodel/paper/config.json'`
 *   · 协议实现 `const Tre = ".mathmodel/paper/config.json"`
 *   · 应用约定 zod 枚举 `['.mathmodel/paper/config.json','AGENTS.md','CLAUDE.md']`
 *   · 应用约定中文文案 「项目中已有 .mathmodel/paper/config.json。为避免覆盖你的文件…」
 *
 * ⚠️ 这里曾经用 `.mmodels`（本项目早期自造的名字），导致两个真实后果：
 *   1. 用户拿应用约定建过的项目，我们用 `.mmodels` 找不到、应用约定也读不到我们写的；
 *   2. 同一个项目被两个应用各写一份，比赛信息"分成两半"。
 *   现在 canonical 对齐应用约定；`.mmodels` 降级为**遗留只读兼容**（见 `LEGACY_MM_DIR`）。
 */
export const MM_DIR = '.mathmodel';

/**
 * 遗留目录名（本项目 0.1.x 早期版本写的），**只读兼容 + 迁移，永不删除**。
 *
 * 迁移规则（两个写入口都遵守）：
 *   · 读：canonical 存在就用 canonical；不存在才回落到这里（`resolvePaperConfigFile`）
 *   · 写：只写 canonical。canonical 不存在而这里有内容时，先把这里的内容读成基线
 *     （`initPaperProjectConfig` / `saveConfig` 都是这个语义）⇒ 内容被"带"到 canonical
 *   · 旧文件**保持原样留在磁盘上**（用户自己删，或者干脆留着当备份）
 */
export const LEGACY_MM_DIR = '.mmodels';

/** canonical 的论文配置路径（`<项目>/.mathmodel/paper/config.json`） */
export function paperConfigPath(projectRoot: string): string {
  return join(projectRoot, MM_DIR, 'paper', 'config.json');
}

/** 遗留的论文配置路径（`<项目>/.mmodels/paper/config.json`） */
export function legacyPaperConfigPath(projectRoot: string): string {
  return join(projectRoot, LEGACY_MM_DIR, 'paper', 'config.json');
}

/**
 * 当前项目**实际该读哪个**配置文件。
 *
 * canonical 优先：`.mathmodel` 一旦存在就以它为准（哪怕遗留文件更新 —— 迁移过之后
 * 就该只看新的那一份，否则用户改了新的、旧的还在拖后腿）。
 *
 * @returns 命中的文件（含 `legacy` 标记）或 null（两边都没有）
 */
export function resolvePaperConfigFile(
  projectRoot: string,
): { path: string; legacy: boolean } | null {
  const canonical = paperConfigPath(projectRoot);
  if (existsSync(canonical)) return { path: canonical, legacy: false };
  const legacy = legacyPaperConfigPath(projectRoot);
  if (existsSync(legacy)) return { path: legacy, legacy: true };
  return null;
}

/** 配置文件的归属：我们的 / 用户手写的 / 坏掉了 */
export type PaperConfigOwnership = 'ours' | 'foreign' | 'broken';

/**
 * 判定一份配置文件的归属 —— 对齐应用约定 `project_config_conflict` 的判据。
 *
 * 应用约定（协议实现，见 capability-diff.md B19）：写项目配置前，
 * 若文件已存在且 `JSON.parse(...).managedBy !== 'mathmodel'` → 抛
 * `project_config_conflict`；渲染层映射成 `chat.newChatPage.paperConfigConflict`
 * （：`n?.error==="project_config_conflict"?new Error(ft("...paperConfigConflict"))`）。
 *
 * 为什么要这么判：`managedBy: 'mathmodel'`（应用约定 zod 是 `literal("mathmodel")`）
 * 是**我们写的**唯一标记；缺这个标记的文件是用户手写的，**改它就等于偷改用户的文件**。
 */
export function paperConfigOwnership(text: string): PaperConfigOwnership {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 解析不了 → 无法判断归属。调用方按"备份后重写"处理（见 ipc/paper.ts），
    // 不静默丢弃即可，这里不冒充 'foreign'（否则用户手写的坏 JSON 永远写不进去）。
    return 'broken';
  }
  const managedBy = (parsed as Record<string, unknown> | null)?.managedBy;
  return managedBy === 'mathmodel' ? 'ours' : 'foreign';
}

export type { PaperConfig, PaperTemplateRef };

// ─────────────────────────────────────────────────────────────
// 读写 —— 应用约定 schema 见 @shared/types 的 PaperConfig 注释
// ─────────────────────────────────────────────────────────────

/**
 * 配置目录安全性检查 —— **从 `ipc/paper.ts` 原样搬来，两处共用一份**。
 *
 * 应用约定也拦这个（`chat.newChatPage.paperConfigUnsafePath`：
 * 「项目中的 .mathmodel 配置目录不能是软链接或目录联接」）——
 * 否则等于把配置写到项目外面去。
 *
 * 检查的是 **canonical 目录**（`.mathmodel`）——那是我们唯一会写的地方。
 *
 * @returns true = 可以安全写入
 */
export function mmodelsDirIsSafe(projectRoot: string): boolean {
  const dir = join(projectRoot, MM_DIR);
  if (!existsSync(dir)) return true; // 还不存在 → 待会儿 mkdir 出来
  try {
    const st = lstatSync(dir);
    return !st.isSymbolicLink() && st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 原子写：先写 .tmp 再 rename，避免中途失败留下半截文件（原样搬自 `ipc/paper.ts`）。
 *
 * `mode` 对齐应用约定：应用约定写这份配置用 `0o600`、建目录用 `0o700`
 * （见 capability-diff.md B19）—— 比赛信息含队伍联系方式，不该对同机其他账号可读。
 * Windows 上 mode 被忽略（无副作用），macOS/Linux 上是真实收紧。
 */
export function writeAtomic(file: string, content: string, mode = 0o600): void {
  const tmp = file + '.tmp';
  writeFileSync(tmp, content, { encoding: 'utf8', mode });
  renameSync(tmp, file);
}

/** 按模板列表挑「当前该用哪个模板」：设置里的优先，其次按语言默认，最后取第一个 */
export function pickDefaultTemplateId(
  templates: PaperTemplate[],
  preferId: string | null | undefined,
  locale = 'zh-CN',
): string | null {
  if (preferId && templates.some((t) => t.id === preferId)) return preferId;
  const base = locale.split('-')[0];
  const hit =
    templates.find((t) => t.defaultFor.includes(locale)) ??
    templates.find((t) => t.defaultFor.some((l) => l.split('-')[0] === base));
  // `defaultFor` 没命中就退回第一个 —— 与输入区 Composer 的兜底同款，
  // 保证「永远能定出一个模板」，否则配置里 template.id 会是空的。
  return hit?.id ?? templates[0]?.id ?? null;
}

function toTemplateRef(
  id: string,
  source: 'builtin' | 'custom',
  sourcePath: string | null,
  templates?: PaperTemplate[],
): PaperTemplateRef {
  const meta = templates?.find((t) => t.id === id);
  return {
    id,
    // 应用约定 `Np`：中文用模板显示名、英文取 template.json 的 `name.en`
    // （如 cumcm → {'zh-CN':'国赛 CUMCM', en:'CUMCM'}）。
    // 模板挑不到时（自定义模板源 / 空 id 占位）退回目录名 —— 仍是两个非空键。
    name: makeLocalizedText(meta?.name ?? id, meta?.nameEn),
    entryFile: meta?.entryFile ?? 'document.tex',
    source,
    sourcePath: source === 'custom' ? sourcePath : null,
  };
}

/** 挑出「当前该用的内置模板」并转成可落盘的 ref（挑不到返回 null） */
export function defaultTemplateRef(
  templates: PaperTemplate[],
  preferId?: string | null,
  locale = 'zh-CN',
): PaperTemplateRef | null {
  const id = pickDefaultTemplateId(templates, preferId, locale);
  return id ? toTemplateRef(id, 'builtin', null, templates) : null;
}

/** 只接受能落到真实 PDF 页码上的页数规则；坏值按“尚未设置”处理。 */
function parsePageLimit(value: unknown): PaperPageLimit | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const maxPages = Number(raw.maxPages);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 999) return null;
  const scope: PaperPageLimit['scope'] = raw.scope === 'total' ? 'total' : 'body';
  const page = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 9999 ? n : undefined;
  };
  const startPage = page(raw.startPage);
  const endPage = page(raw.endPage);
  if (startPage && endPage && endPage < startPage) return null;
  return {
    maxPages,
    scope,
    ...(scope === 'body' && startPage ? { startPage } : {}),
    ...(scope === 'body' && endPage ? { endPage } : {}),
  };
}

/**
 * 把磁盘上的原始 JSON 规整成 `PaperConfig`。
 *
 * 兼容两种历史写法（否则老项目一读就 null，用户的比赛信息会"消失"）：
 *   · 应用约定结构：`{ template:{...}, contestFields:[{id,label,value}], teamProfile }` —— 直接用
 *   · 本项目早期结构：`{ templateId, fields:{k:v}, profileId }` —— 就地换算成应用约定结构
 */
export function normalizePaperConfig(
  raw: Record<string, unknown>,
  templates?: PaperTemplate[],
): PaperConfig {
  const rawTpl = raw.template as Record<string, unknown> | undefined;
  let template: PaperTemplateRef | null = null;

  if (rawTpl && typeof rawTpl === 'object' && typeof rawTpl.id === 'string') {
    const src = rawTpl.source === 'custom' ? 'custom' : 'builtin';
    template = toTemplateRef(
      rawTpl.id,
      src,
      typeof rawTpl.sourcePath === 'string' && rawTpl.sourcePath ? rawTpl.sourcePath : null,
      templates,
    );
    // 应用约定的 name / entryFile 是写进文件的，优先用文件里的值（自定义模板目录名 ≠ 显示名）。
    // ⚠️ `name` 两种形态都收：应用约定 `Np` 对象 / 早期版本写下的普通字符串 ——
    //    只认一种就会把用户磁盘上已有的模板名读没。
    const nameZh = pickLocalizedText(rawTpl.name);
    if (nameZh) template.name = makeLocalizedText(nameZh, pickLocalizedText(rawTpl.name, 'en'));
    if (typeof rawTpl.entryFile === 'string' && rawTpl.entryFile) template.entryFile = rawTpl.entryFile;
  } else if (typeof raw.templateId === 'string' && raw.templateId) {
    template = toTemplateRef(raw.templateId, 'builtin', null, templates);
  }
  if (!template) {
    // 连 templateId 都没有：拿不到模板就不要硬编 —— 交给调用方决定是否补一个默认
    template = toTemplateRef('', 'builtin', null, templates);
  }

  // contestFields：应用约定数组 > 早期 map
  let contestFields: PaperContestField[] = [];
  if (Array.isArray(raw.contestFields)) {
    contestFields = raw.contestFields
      .map((f) => {
        const o = (f ?? {}) as Record<string, unknown>;
        const id = typeof o.id === 'string' ? o.id : '';
        if (!id) return null;
        // `label` 同样两种形态都收（应用约定 `Np` 对象 / 早期字符串）；
        // 缺了就退回字段 id —— 有 id 可用，绝不编造一个字段名。
        const labelZh = pickLocalizedText(o.label) || id;
        return {
          id,
          label: makeLocalizedText(labelZh, pickLocalizedText(o.label, 'en')),
          value: typeof o.value === 'string' ? o.value : String(o.value ?? ''),
        };
      })
      .filter((f): f is PaperContestField => f !== null);
  } else if (raw.fields && typeof raw.fields === 'object') {
    for (const [k, v] of Object.entries(raw.fields as Record<string, unknown>)) {
      contestFields.push({ id: k, label: makeLocalizedText(k), value: typeof v === 'string' ? v : String(v ?? '') });
    }
  }

  const tp = raw.teamProfile as Record<string, unknown> | null | undefined;
  const teamProfile: PaperTeamProfileSnapshot | null =
    tp && typeof tp === 'object' && typeof tp.id === 'string'
      ? {
          id: tp.id,
          name: typeof tp.name === 'string' ? tp.name : tp.id,
          school: typeof tp.school === 'string' ? tp.school : undefined,
          members: Array.isArray(tp.members) ? tp.members.filter((m): m is string => typeof m === 'string') : undefined,
          advisor: typeof tp.advisor === 'string' ? tp.advisor : undefined,
          phone: typeof tp.phone === 'string' ? tp.phone : undefined,
          email: typeof tp.email === 'string' ? tp.email : undefined,
        }
      : null;

  const pageLimit = parsePageLimit(raw.pageLimit);

  return { schemaVersion: 1, managedBy: 'mathmodel', template, contestFields, teamProfile, pageLimit };
}

/**
 * 读取项目的论文配置；不存在或损坏返回 null。
 *
 * 读的是 `resolvePaperConfigFile` 命中的那份 —— canonical（`.mathmodel`）优先，
 * 没有才回落到遗留目录（`.mmodels`），这样老项目里的比赛信息不会"消失"。
 */
export function readPaperConfig(projectRoot: string, templates?: PaperTemplate[]): PaperConfig | null {
  const hit = resolvePaperConfigFile(projectRoot);
  if (!hit) return null;
  try {
    const raw = JSON.parse(readFileSync(hit.path, 'utf8')) as Record<string, unknown>;
    return normalizePaperConfig(raw, templates);
  } catch {
    return null;
  }
}

/** 保存前的**决策**（纯逻辑，不写盘）—— 供 `ipc/paper.ts` 直接照做，也便于单测钉死 */
export type PaperConfigSavePlan =
  | { action: 'conflict'; file: string }
  | {
      action: 'merge';
      /** 最终要写入的路径（恒为 canonical） */
      file: string;
      /** 基线是从遗留目录读来的？—— true 表示这次写入会顺带完成迁移 */
      legacy: boolean;
      /** 合并基线（原文件里我们认得的字段） */
      merged: Record<string, unknown>;
      /** 原文件解析不了时的原文（调用方先备份成 .broken.bak 再写，不静默丢弃） */
      broken?: string;
    };

/**
 * 算出「这次保存该怎么办」。
 *
 * 三种结果，与应用约定 `project_config_conflict` 的分派一一对应：
 *   · 文件不存在 / 是我们写的（`managedBy === 'mathmodel'`）→ `merge`（在原文上打补丁）
 *   · 文件存在但**不是我们写的**（缺 `managedBy`，用户手写的）→ `conflict`，**一个字节都不动**
 *   · 文件解析不了 → 仍 `merge`，但把原文交回去让调用方先备份（坏 JSON ≠ 别人的文件）
 */
export function planPaperConfigSave(projectRoot: string): PaperConfigSavePlan {
  const hit = resolvePaperConfigFile(projectRoot);
  if (!hit) return { action: 'merge', file: paperConfigPath(projectRoot), legacy: false, merged: {} };

  let text = '';
  try {
    text = readFileSync(hit.path, 'utf8');
  } catch {
    /* 读不到（权限/被删）→ 当空基线处理，下面的 merge 会新建一份 */
  }
  const ownership = text ? paperConfigOwnership(text) : 'broken';
  if (ownership === 'foreign') return { action: 'conflict', file: hit.path };

  let merged: Record<string, unknown> = {};
  if (ownership === 'ours') {
    try {
      merged = JSON.parse(text) as Record<string, unknown>;
    } catch {
      merged = {};
    }
  }
  return {
    action: 'merge',
    file: paperConfigPath(projectRoot),
    // 基线来自遗留目录 ⇒ 这次写入就是迁移（旧文件不删，仍在磁盘上）
    legacy: hit.legacy,
    merged,
    ...(ownership === 'broken' && text ? { broken: text } : {}),
  };
}

/** 把一个队伍档案转成写进项目的快照（只带模板要的字段） */
export function profileToSnapshot(p: {
  id: string;
  name: string;
  school?: string;
  members?: string[];
  advisor?: string;
  contact?: string;
}): PaperTeamProfileSnapshot {
  return {
    id: p.id,
    name: p.name,
    school: p.school ?? '',
    members: (p.members ?? []).filter((m) => m.trim()),
    advisor: p.advisor ?? '',
    // 档案里的 `contact`（单字段）落到快照的 `phone`（应用约定 Mre 的字段名）
    phone: p.contact ?? '',
    email: '',
  };
}

/**
 * 论文任务发起时**自动初始化**项目配置 —— 让设置项 `paperInitProjectConfig` 真正生效。
 *
 * 约束（与 `ipc/paper.ts` 顶部的安全约定一致，应用约定 `project_config_conflict` 同义）：
 *   · canonical 配置**已存在就原样不动**（返回 `skipped`，绝不覆盖用户已有配置）
 *   · 只有**遗留目录**（`.mmodels`）里有配置时 → **迁移**：内容带到 canonical，
 *     旧文件原样留着不删（见 `LEGACY_MM_DIR` 的规则）
 *   · 遗留文件是**用户手写的**（`managedBy` 不是 `mathmodel`）→ 拒绝（`config-conflict`），
 *     既不覆盖也不迁移 —— 迁移等于把用户的文件内容搬到我们名下，同样算动用户数据
 *   · `.mathmodel` 是软链/联接时拒绝写入（`unsafe-path`）
 *
 * @returns 结果（供调用方打日志取证）
 */
export function initPaperProjectConfig(opts: {
  projectRoot: string;
  templates: PaperTemplate[];
  /** 设置里已选的模板 id（优先） */
  preferTemplateId?: string | null;
  locale?: string;
  /** `paperProfileEnabled` 为真且选中档案时，把档案字段预填进 contestFields */
  profile?: {
    id: string;
    name: string;
    school?: string;
    members?: string[];
    advisor?: string;
    contact?: string;
  } | null;
}): { ok: boolean; created: boolean; reason?: string; path: string; templateId?: string } {
  const path = paperConfigPath(opts.projectRoot);

  if (!mmodelsDirIsSafe(opts.projectRoot)) {
    return { ok: false, created: false, reason: 'unsafe-path', path };
  }
  if (existsSync(path)) {
    return { ok: true, created: false, reason: 'already-exists', path };
  }

  // ── 遗留目录迁移（canonical 还没建，但历史版本的 `.mmodels` 里有配置）──
  const legacy = legacyPaperConfigPath(opts.projectRoot);
  if (existsSync(legacy)) {
    let rawText = '';
    try {
      rawText = readFileSync(legacy, 'utf8');
    } catch {
      /* 读不到就当没有：下面按"没有遗留配置"走 */
    }
    const ownership = rawText ? paperConfigOwnership(rawText) : 'broken';
    if (ownership === 'foreign') {
      // 用户手写的（或别的工具写的）→ 不碰它的内容
      return { ok: false, created: false, reason: 'config-conflict', path };
    }
    if (ownership === 'ours') {
      try {
        const carried = JSON.parse(rawText) as Record<string, unknown>;
        mkdirSync(join(opts.projectRoot, MM_DIR, 'paper'), { recursive: true, mode: 0o700 });
        writeAtomic(
          path,
          JSON.stringify(
            {
              ...carried,
              schemaVersion: 1,
              managedBy: 'mathmodel',
              // 留痕：这份配置是从遗留目录搬过来的（旧文件仍在磁盘上）
              migratedFrom: `${LEGACY_MM_DIR}/paper/config.json`,
              migratedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
        );
        return {
          ok: true,
          created: true,
          reason: 'migrated-from-legacy',
          path,
          templateId: normalizePaperConfig(carried, opts.templates).template.id || undefined,
        };
      } catch (e) {
        return { ok: false, created: false, reason: 'write-failed: ' + String(e), path };
      }
    }
    // 'broken'：遗留文件解析不了 —— 不动它，继续走下面"新建一份默认配置"
  }

  const tpl = defaultTemplateRef(opts.templates, opts.preferTemplateId, opts.locale);
  if (!tpl) {
    return { ok: false, created: false, reason: 'no-template', path };
  }
  const templateId = tpl.id;

  // 队伍档案预填：只填模板 `profileFields` 声明要的键（如 cumcm → school/members/advisor），
  // 不把联系方式硬塞进正文 —— 应用约定 contactHint 明确「不会直接拼进聊天正文」。
  const need = opts.templates.find((t) => t.id === templateId)?.profileFields ?? [];
  const contestFields: PaperContestField[] = [];
  const prof = opts.profile ?? null;
  if (prof) {
    const label: Record<string, string> = { school: '学校全称', members: '参赛队员', advisor: '指导老师' };
    const value: Record<string, string> = {
      school: prof.school ?? '',
      members: (prof.members ?? []).filter((m) => m.trim()).join('、'),
      advisor: prof.advisor ?? '',
    };
    for (const key of need) {
      const v = value[key];
      // 档案预填出来的这三个字段名是**我们起的**（应用约定没有先例），只有中文，
      // 所以 `en` 走原文兜底 —— 但两个键都必须非空（应用约定 `Np` 是 `min(1)`）。
      if (v && v.trim()) contestFields.push({ id: key, label: makeLocalizedText(label[key] ?? key), value: v });
    }
  }

  const config: PaperConfig = {
    schemaVersion: 1,
    managedBy: 'mathmodel',
    template: tpl,
    contestFields,
    teamProfile: prof ? profileToSnapshot(prof) : null,
    pageLimit: null,
  };

  try {
    // 目录 0o700 / 文件 0o600 —— 对齐应用约定（比赛信息含队伍联系方式）
    mkdirSync(join(opts.projectRoot, MM_DIR, 'paper'), { recursive: true, mode: 0o700 });
    writeAtomic(path, JSON.stringify({ ...config, createdAt: new Date().toISOString() }, null, 2));
    return { ok: true, created: true, path, templateId };
  } catch (e) {
    return { ok: false, created: false, reason: 'write-failed: ' + String(e), path };
  }
}

/** 目录是否可写（保存配置前先探一下，避免写一半失败） */
export function canWriteDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
