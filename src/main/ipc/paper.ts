/**
 * 论文模板与比赛信息 IPC —— 支撑 Composer 的「比赛模板 / 比赛信息」选择器。
 *
 * ⚠️ 扫描与读写逻辑在 `src/main/scan/paper-templates.ts`（纯 Node，可被验证脚本直接 import）。
 *    本文件只做「取资源目录 → 调 scan → 包 IPC 结果」。
 *
 * 安全约定（对齐原版 `chat.newChatPage.paperConfig*` 那几条文案）：
 *   - **绝不覆盖用户手写的配置**：已存在的 config.json 若 `managedBy !== 'mathmodel'`
 *     就拒绝写入并回 `config-conflict`（原版 `project_config_conflict`，见 capability-diff.md B19）。
 *     判定见 `paperConfigOwnership`。
 *   - `.mathmodel` 已存在但不是普通目录（软链/联接）时拒绝写入
 *     （原版 `project_config_unsafe_path` / `paperConfigUnsafePath`）
 *   - 保存时**只更新本次真正要改的键**，其余字段原样保留（含用户手写的额外键）
 *   - 只写 `.mathmodel/paper/` 下的文件；遗留目录 `.mmodels` **只读不写**（见 `LEGACY_MM_DIR`）
 *
 * schema 见 `@shared/types` 的 `PaperConfig`（逐字对齐原版 zod schema）。
 */
import { ipcMain, app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  IPC,
  type PaperConfig,
  type PaperConfigPatch,
  type PaperTemplateDeleteResult,
  type PaperTemplateForkResult,
  type PaperTemplateLibraryResult,
} from '@shared/types';
import { safeWrap, type IpcContext } from './index';
import { resolveResourcesRoot } from '../resources';
import { currentProjectRoot } from './file';
import { getSettings } from '../store/config';
import {
  LEGACY_MM_DIR,
  MM_DIR,
  customTemplatesRootIn,
  defaultTemplateRef,
  deletePaperTemplate,
  forkPaperTemplate,
  listPaperTemplateLibrary,
  listPaperTemplates,
  mmodelsDirIsSafe,
  normalizePaperConfig,
  paperConfigPath,
  planPaperConfigSave,
  readPaperConfig,
  resolvePaperConfigFile,
  writeAtomic,
} from '../scan/paper-templates';

/** 随包资源目录（打包后是 process.resourcesPath，开发期是 <appPath>/resources） */
function resourcesDir(): string {
  return resolveResourcesRoot(
    ['builtin-skills', 'mma-paper', 'assets', 'template'],
    '论文模板',
  );
}

/**
 * 受管自定义模板库根目录（原版 `customTemplatesRoot`）——
 * 存在**用户数据目录**下，与项目无关，每个项目都能用。
 *
 * ⚠️ 这与设置页「自定义模板」那个"指一个本地目录当模板源"的入口**不是一回事**：
 *    那个把路径写进当前项目的 `.mathmodel/paper/config.json`（只对该项目生效，
 *    是我们有意的增强）；这里是原版语义的受管库（fork 出来的模板存这儿）。
 *    两套并存，谁都不替换谁。
 */
function customTemplatesRoot(): string {
  return customTemplatesRootIn(app.getPath('userData'));
}

export function registerPaperHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.PAPER_TEMPLATES,
    safeWrap(async () => {
      // ⚠️ 这条通道**只报内置模板**，消费方是输入区的比赛模板选择器
      //    （`Composer.tsx` 整段渲染在 `builtinTemplatesGroup` 下、选中时写死
      //    `source: 'builtin'`）。混进自定义模板会让用户在那儿点一条 fork 出来的
      //    模板时被记成内置 —— 合并列表走 `PAPER_TEMPLATE_LIBRARY`（只给扩展页）。
      const list = listPaperTemplates(resourcesDir());
      return {
        available: list.length > 0,
        dir: resourcesDir(),
        templates: list,
      };
    }, '读取论文模板'),
  );

  /**
   * 受管模板库的**合并**列表（内置 + 我的模板）—— 原版 `PaperTemplateService.list()`
   * 返回的就是 `records()`（两个根一起扫、同 id 去重）。
   *
   * 只有扩展页读它：那里的详情区要按 `source` 分「内置 · mma-paper」与「我的模板」两段。
   */
  ipcMain.handle(
    IPC.PAPER_TEMPLATE_LIBRARY,
    safeWrap(async (): Promise<PaperTemplateLibraryResult> => {
      const customRoot = customTemplatesRoot();
      return {
        customRoot,
        templates: listPaperTemplateLibrary({ resourcesDir: resourcesDir(), customRoot }),
      };
    }, '读取模板库'),
  );

  /**
   * 基于某条模板派生一条自定义模板（原版 `POST /api/paper-templates/fork`）。
   *
   * 实现全在 `scan/paper-templates.ts#forkPaperTemplate`（纯 Node，单测直接钉它）——
   * 这里只负责把「资源目录 + 受管库根目录」这两个 electron 侧的事实喂进去。
   */
  ipcMain.handle(
    IPC.PAPER_TEMPLATE_FORK,
    safeWrap(
      async (_e, input: { templateId: string; name: string }): Promise<PaperTemplateForkResult> =>
        forkPaperTemplate({
          resourcesDir: resourcesDir(),
          customRoot: customTemplatesRoot(),
          templateId: String(input?.templateId ?? ''),
          name: String(input?.name ?? ''),
        }),
      '新建自定义模板',
    ),
  );

  /**
   * 删除一条**自定义**模板（原版 `DELETE /api/paper-templates/:id`）。
   *
   * ⚠️ 内置模板必须在这里被**拒绝**（`builtin_template_readonly` → 403），
   *    不是"UI 上不渲染按钮"。拒绝的判断在 `deletePaperTemplate` 内部
   *    **重新扫库**得出，不信任调用方 —— 从任何地方直接调这条通道，
   *    拿内置模板 id 进来一样会被挡住，磁盘上一个字节都不动。
   */
  ipcMain.handle(
    IPC.PAPER_TEMPLATE_DELETE,
    safeWrap(
      async (_e, templateId: string): Promise<PaperTemplateDeleteResult> =>
        deletePaperTemplate({
          resourcesDir: resourcesDir(),
          customRoot: customTemplatesRoot(),
          templateId: String(templateId ?? ''),
        }),
      '删除自定义模板',
    ),
  );

  ipcMain.handle(
    IPC.PAPER_GET_CONFIG,
    safeWrap(async () => {
      const root = currentProjectRoot();
      if (!root) return { config: null, path: null };
      // 传模板列表：老配置文件只有 templateId 时，靠它补出 name / entryFile
      return {
        config: readPaperConfig(root, listPaperTemplates(resourcesDir())),
        // ⚠️ 报「实际读的那份」的磁盘真值：canonical 没有、只有遗留 `.mmodels` 时
        //    这里要如实指向遗留文件（面板上的路径要能被用户拿去核对）
        path: resolvePaperConfigFile(root)?.path ?? paperConfigPath(root),
      };
    }, '读取比赛信息'),
  );

  ipcMain.handle(
    IPC.PAPER_SAVE_CONFIG,
    safeWrap(async (_e, patch: PaperConfigPatch) => {
      const root = currentProjectRoot();
      if (!root) return { ok: false, reason: 'no-project' };

      // 原版 project_config_unsafe_path：`.mathmodel` 不能是软链/目录联接
      if (!mmodelsDirIsSafe(root)) return { ok: false, reason: 'unsafe-path' };

      const dir = join(root, MM_DIR, 'paper');
      const file = paperConfigPath(root);

      /**
       * 保存决策（纯逻辑在 `planPaperConfigSave`，单测直接钉它）：
       *   · conflict —— 已存在的 config.json 不是我们写的（`managedBy !== 'mathmodel'`）⇒
       *     原版 `project_config_conflict`：**拒绝写入**，把决定权交回用户
       *     （原版文案就是「先移走或重命名该文件后重试」）。
       *   · merge —— 不存在 / 我们写的 / 坏 JSON（坏的原文件先备份成 `.broken.bak`）。
       *   基线若来自遗留 `.mmodels`（`legacy: true`），这次写入顺带完成迁移，**旧文件不删**。
       */
      const plan = planPaperConfigSave(root);
      if (plan.action === 'conflict') return { ok: false, reason: 'config-conflict', path: plan.file };
      if (plan.broken) {
        try {
          writeAtomic(plan.file + '.broken.bak', plan.broken);
        } catch {
          /* 备份失败也继续，至少不静默覆盖 */
        }
      }
      const merged = plan.merged;

      // 先按原版 schema 规整（老结构就地换算），再把本次补丁盖上去
      const templates = listPaperTemplates(resourcesDir());
      const base = normalizePaperConfig(merged, templates);
      const settings = getSettings();
      // 模板只在两种情况下来自 patch：用户在输入区换模板 / 在设置页换模板源。
      // 渲染层「比赛信息」弹层只编辑字段，不下发 template —— 它手里的 template 是
      // 打开项目时的快照，拿它回写会把设置页刚选好的自定义模板源静默打回内置。
      // 磁盘上确实还没有模板时（从没发过论文消息就填了字段）在这里补一个默认值。
      const template =
        patch?.template ??
        (base.template.id
          ? base.template
          : defaultTemplateRef(templates, settings.paperTemplateId, settings.locale));
      if (!template) return { ok: false, reason: 'no-template' };

      const next: PaperConfig = {
        schemaVersion: 1,
        managedBy: 'mathmodel',
        template,
        contestFields: patch?.contestFields ?? base.contestFields,
        teamProfile: patch?.teamProfile !== undefined ? patch.teamProfile : base.teamProfile,
        pageLimit: patch?.pageLimit !== undefined ? patch.pageLimit : base.pageLimit,
      };

      // 写入前再拦一次原版那条约束：custom 必须有 sourcePath，builtin 不能带 sourcePath
      if (next.template.source === 'custom' && !next.template.sourcePath) {
        return { ok: false, reason: 'custom-needs-sourcePath' };
      }

      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeAtomic(
          file,
          JSON.stringify(
            {
              ...merged,
              ...next,
              template: next.template,
              updatedAt: new Date().toISOString(),
              // 从遗留 `.mmodels` 带过来的内容留个痕（旧文件不删，仍在磁盘上）
              ...(plan.legacy ? { migratedFrom: `${LEGACY_MM_DIR}/paper/config.json` } : {}),
            },
            null,
            2,
          ),
        );
      } catch (e) {
        return { ok: false, reason: 'write-failed: ' + String(e) };
      }
      return { ok: true, path: file };
    }, '保存比赛信息'),
  );
}
