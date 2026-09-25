/**
 * 论文模板**受管库**的 fork / delete 回归测试（规格：BACKLOG §3-3 #16，含 B22）。
 *
 * ## 为什么这层要单独真测
 *
 * 用户实机抱怨的是「模板只能浏览，不能用它开新会话、不能派生、不能删」——
 * 那部分是 UI；但**真正会出事**的是下面这条：
 *
 *   ★ 内置模板的"删除"必须是**拒绝**，不是"UI 上不渲染按钮"。
 *
 * 原版把它做成了服务端错误码 `builtin_template_readonly`(403)，意思就是
 * 「这条约束在**服务端**成立，界面藏按钮只是顺带」。如果只在渲染层不渲染按钮，
 * 从别处直接调通道仍然能删掉内置模板（本仓的模板目录就是 `resources/` 下的
 * 真实文件，删了要重装才能回来）。
 *
 * 所以本文件**在磁盘上真跑**：调的就是 IPC 通道体
 * `deletePaperTemplate`（`src/main/ipc/paper.ts` 的删除处理里唯一的一行逻辑），
 * 用**真实的** `resources/builtin-skills/write-paper/assets/template` 当内置库、
 * 临时目录当受管库，然后逐条断言：
 *   ① fork 后「我的模板」多一条、内置**一条不少**（集合断言）
 *   ② 拿内置模板 id 删 → 被拒（403）且**磁盘上没有任何模板文件被删**
 *   ③ 删掉一条自定义模板后，内置列表**不能跟着少**
 *
 * ## 反向对照（真跑过）
 *
 * 把 `deletePaperTemplate` 里那行 `if (rec.source !== 'custom') return ...403`
 * 去掉 → 第 2 组用例**必须真红**（而且会真的把 `resources/.../cumcm/` 删掉）。
 * 已经实跑验证过一次，红/绿输出见汇报；文件里不留任何"注释掉才能过"的开关。
 *
 * ## 这一组用例**盖不住**什么（证伪边界）
 *
 * · **点一下按钮**这条交互盖不住：`node_modules` 里没有 jsdom / happy-dom，
 *   vitest 只跑 `environment: 'node'`，渲染层点不动。按钮在不在、
 *   点下去有没有反应，只能靠实机 e2e（或将来装 jsdom）。
 * · **通道有没有被注册**也盖不住「真 IPC 往返」：本文件只能做**结构断言**
 *   （读 `src/main/ipc/paper.ts` 源码，确认它把这条通道接上了、且没有另写一套
 *   绕过围栏的删除逻辑）。真正的端到端要靠实机。
 * · 「内置模板目录不可写」这种**环境**失败不在覆盖范围内（本机可写）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CUSTOM_TEMPLATE_PREFIX,
  TEMPLATE_REL_DIR,
  deletePaperTemplate,
  forkPaperTemplate,
  listPaperTemplateLibrary,
  listPaperTemplates,
  sanitizeTemplateDirName,
} from './paper-templates';

/**
 * 仓库里的真实资源目录（开发期 `resourcesDir()` 就是 <appPath>/resources）。
 *
 * `MM_TEST_RESOURCES` 是给**反向对照**用的：把"内置模板拒绝删除"那道闸摘掉之后，
 * 这组用例里的删除会被真的执行 —— 若不换根，它删的就是仓库里那份**真实模板资源**
 * （重装才能回来）。换成一份临时副本，红一样红，仓库不受损。
 * 平时不设这个变量，测的就是真资源目录。
 */
const RESOURCES_DIR = process.env.MM_TEST_RESOURCES
  ? resolve(process.env.MM_TEST_RESOURCES)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../../../resources');
/** 真实内置模板根 */
const BUILTIN_ROOT = join(RESOURCES_DIR, TEMPLATE_REL_DIR);

/** 一条内置模板的 id（真实存在，用它当"内置模板"的攻击面样本） */
const BUILTIN_ID = 'cumcm';

let tmpRoot = '';
/** 受管库根（等价于 `customTemplatesRootIn(userDataDir)` 的结果） */
let customRoot = '';

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/** 内置模板库的"磁盘指纹"：目录名 + 该目录下所有文件名，逐字可比 */
function builtinDiskSnapshot(): string[] {
  const out: string[] = [];
  for (const e of readdirSync(BUILTIN_ROOT, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const files = readdirSync(join(BUILTIN_ROOT, e.name)).sort();
    out.push(`${e.name}:${files.join(',')}`);
  }
  return out.sort();
}

function builtinIds(): string[] {
  return listPaperTemplates(RESOURCES_DIR).map((t) => t.id);
}

function customIds(): string[] {
  return listPaperTemplateLibrary({ resourcesDir: RESOURCES_DIR, customRoot }).filter(
    (t) => t.source === 'custom',
  ).map((t) => t.id);
}

/** 在受管库里手工造一条模板（不走 fork），用于测"自定义模板"这一侧 */
function seedCustomTemplate(id: string, nameZh: string): string {
  const dir = join(customRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'template.json'),
    JSON.stringify({
      schemaVersion: 1,
      name: { 'zh-CN': nameZh, en: nameZh },
      description: '手工造的测试模板',
      language: 'zh-CN',
      entryFile: 'document.tex',
      order: 1000,
      defaultFor: [],
      fields: [],
      profileFields: [],
    }),
    'utf8',
  );
  writeFileSync(join(dir, 'document.tex'), '\\documentclass{article}\n', 'utf8');
  return dir;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'mm-paper-tpl-'));
  customRoot = join(tmpRoot, 'paper-templates');
});

afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* 临时目录清不掉不影响判据 */
  }
});

// ─────────────────────────────────────────────────────────────
// 前置：内置库真的在（否则后面全是假绿）
// ─────────────────────────────────────────────────────────────

describe('前置', () => {
  it('真实内置模板库可读到，且 cumcm 在里面', () => {
    const ids = builtinIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain(BUILTIN_ID);
    expect(existsSync(join(BUILTIN_ROOT, BUILTIN_ID, 'template.json'))).toBe(true);
  });

  it('自定义库为空时，合并列表与内置列表逐条相同', () => {
    const merged = listPaperTemplateLibrary({ resourcesDir: RESOURCES_DIR, customRoot });
    expect(merged.map((t) => t.id)).toEqual(builtinIds());
    expect(merged.every((t) => t.source === 'builtin')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// ① fork：派生一条自定义模板
// ─────────────────────────────────────────────────────────────

describe('① fork 模板', () => {
  it('派生后「我的模板」多一条，且内置列表**一条不少**（集合断言）', () => {
    const before = builtinIds();
    expect(customIds()).toEqual([]);

    const r = forkPaperTemplate({
      resourcesDir: RESOURCES_DIR,
      customRoot,
      templateId: BUILTIN_ID,
      name: '我的国赛模板',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.code);

    const merged = listPaperTemplateLibrary({ resourcesDir: RESOURCES_DIR, customRoot });
    const afterBuiltin = merged.filter((t) => t.source === 'builtin').map((t) => t.id);
    const afterCustom = merged.filter((t) => t.source === 'custom');

    // ★ 集合断言（不是数量断言）：内置那批 id **逐个都还在**
    expect(new Set(afterBuiltin)).toEqual(new Set(before));
    for (const id of before) expect(afterBuiltin).toContain(id);

    // 自定义恰好多出派生出来的那一条
    expect(afterCustom.map((t) => t.id)).toEqual([r.template.id]);
    expect(r.template.id.startsWith(CUSTOM_TEMPLATE_PREFIX)).toBe(true);
    expect(r.template.source).toBe('custom');

    // 派生出来的元数据对齐原版 fork：名字用用户输入、order 1000、defaultFor 空
    expect(r.template.name).toBe('我的国赛模板');
    expect(r.template.order).toBe(1000);
    expect(r.template.defaultFor).toEqual([]);
    // 入口文件与字段从来源模板继承（cumcm 是 document.tex + 4 个字段）
    expect(r.template.entryFile).toBe('document.tex');
    expect(r.template.fields.length).toBeGreaterThan(0);
    expect(r.template.fields.map((f) => f.id)).toContain('problemNumber');
  });

  it('派生是**真复制文件**：新目录里有 template.json 与整份模板内容', () => {
    const r = forkPaperTemplate({
      resourcesDir: RESOURCES_DIR,
      customRoot,
      templateId: BUILTIN_ID,
      name: '复制检查',
    });
    if (!r.ok) throw new Error(r.error.code);

    expect(existsSync(join(r.template.dir, 'template.json'))).toBe(true);
    expect(existsSync(join(r.template.dir, r.template.entryFile))).toBe(true);

    // 磁盘上的清单里 id / name / order 与扫描结果一致（不是靠目录名冒充的）
    const meta = readJson(join(r.template.dir, 'template.json'));
    expect(meta.id).toBe(r.template.id);
    expect(meta.order).toBe(1000);
    expect(meta.name).toEqual({ 'zh-CN': '复制检查', en: '复制检查' });

    // 目录名可读：以「清洗后的名字-id 后 8 位」结尾（原版就是这么起名的）
    expect(basename(r.template.dir)).toBe(
      `${sanitizeTemplateDirName('复制检查')}-${r.template.id.slice(-8)}`,
    );
  });

  it('来源模板不存在 → 404 `template_not_found`（不会顺手建出空目录）', () => {
    const r = forkPaperTemplate({
      resourcesDir: RESOURCES_DIR,
      customRoot,
      templateId: 'no-such-template',
      name: '随便',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('不该成功');
    expect(r.error).toEqual({ code: 'template_not_found', status: 404 });
    expect(existsSync(customRoot)).toBe(false);
  });

  it('名字空 / 超 80 字 → 400 `invalid_template_name`', () => {
    for (const name of ['', '   ', 'x'.repeat(81)]) {
      const r = forkPaperTemplate({
        resourcesDir: RESOURCES_DIR,
        customRoot,
        templateId: BUILTIN_ID,
        name,
      });
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('不该成功');
      expect(r.error).toEqual({ code: 'invalid_template_name', status: 400 });
    }
    // 80 字整好是上限内（边界不能写反）
    const ok = forkPaperTemplate({
      resourcesDir: RESOURCES_DIR,
      customRoot,
      templateId: BUILTIN_ID,
      name: 'y'.repeat(80),
    });
    expect(ok.ok).toBe(true);
  });

  it('自定义库不可用（customRoot=null）→ 503，且不报成别的错', () => {
    const r = forkPaperTemplate({
      resourcesDir: RESOURCES_DIR,
      customRoot: null,
      templateId: BUILTIN_ID,
      name: '无库',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('不该成功');
    expect(r.error).toEqual({ code: 'custom_template_library_unavailable', status: 503 });
  });

  it('来源模板含符号链接 → 400 `unsafe_template`（不把链接复制进用户的模板库）', () => {
    const srcDir = seedCustomTemplate('linked', '带链接的模板');
    try {
      symlinkSync(join(srcDir, 'template.json'), join(srcDir, 'link.json'));
    } catch {
      // Windows 上建符号链接需要开发者模式/管理员 —— 建不出来就如实跳过这一条，
      // 不拿一个"其实没造出链接"的绿来冒充覆盖。
      return;
    }
    const r = forkPaperTemplate({
      resourcesDir: RESOURCES_DIR,
      customRoot,
      templateId: 'linked',
      name: '不该成功',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('不该成功');
    expect(r.error.code).toBe('unsafe_template');
  });
});

// ─────────────────────────────────────────────────────────────
// ② 内置模板的删除必须被**拒绝**（且磁盘一个字节不动）
// ─────────────────────────────────────────────────────────────

describe('② 内置模板删除必须被拒绝（通道体这一层，不是 UI 层）', () => {
  it('拿内置模板 id 调删除 → 403 `builtin_template_readonly`，磁盘毫无变化', () => {
    const beforeIds = builtinIds();
    const beforeDisk = builtinDiskSnapshot();

    // 通道体：`src/main/ipc/paper.ts` 的删除处理里唯一的一行逻辑就是调它
    const r = deletePaperTemplate({
      resourcesDir: RESOURCES_DIR,
      customRoot,
      templateId: BUILTIN_ID,
    });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('内置模板被删掉了 —— 这道闸没拦住');
    expect(r.error).toEqual({ code: 'builtin_template_readonly', status: 403 });

    // ★ 磁盘断言：内置模板**一条不少、文件一个不丢**
    expect(builtinIds()).toEqual(beforeIds);
    expect(builtinDiskSnapshot()).toEqual(beforeDisk);
    expect(existsSync(join(BUILTIN_ROOT, BUILTIN_ID, 'template.json'))).toBe(true);
    expect(existsSync(join(BUILTIN_ROOT, BUILTIN_ID, 'document.tex'))).toBe(true);
  });

  it('**每一条**内置模板都被拒（不是只拦住了 cumcm）', () => {
    const beforeDisk = builtinDiskSnapshot();
    for (const id of builtinIds()) {
      const r = deletePaperTemplate({ resourcesDir: RESOURCES_DIR, customRoot, templateId: id });
      expect(r.ok, `内置模板 ${id} 竟然被允许删除`).toBe(false);
      if (r.ok) throw new Error('不该成功');
      expect(r.error.code).toBe('builtin_template_readonly');
    }
    expect(builtinDiskSnapshot()).toEqual(beforeDisk);
  });

  it('即使受管库不可用，内置模板仍是 403 而不是 503（顺序与原版一致）', () => {
    const r = deletePaperTemplate({
      resourcesDir: RESOURCES_DIR,
      customRoot: null,
      templateId: BUILTIN_ID,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('不该成功');
    expect(r.error.code).toBe('builtin_template_readonly');
  });

  it('id 不存在 → 404 `template_not_found`', () => {
    const r = deletePaperTemplate({
      resourcesDir: RESOURCES_DIR,
      customRoot,
      templateId: 'nope-nope',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('不该成功');
    expect(r.error).toEqual({ code: 'template_not_found', status: 404 });
  });

  /**
   * ★ 这一条是"这道闸到底是不是承重墙"的**证伪用例**。
   *
   * 造一个极端布局：内置模板目录**恰好就是受管库根的直接子目录**
   * （`customRoot == 内置模板根`）。此时后面那道路径围栏
   * （`dirname(dir) === root`）**会通过** —— 也就是说，能拦住这次删除的
   * 只剩"来源必须是 custom"这一条判断。
   *
   * 反向对照实跑记录：把 `deletePaperTemplate` 里这行判断摘掉 →
   * 本条用例红，而且**临时副本里的内置模板目录被真的删掉了**（`existsSync` 变 false）。
   * 所以它证明的不是"恰好没删成"，而是"这道闸就是承重墙"。
   */
  it('内置模板**正好躺在受管库根下**时也照样 403（不是靠路径围栏碰巧拦住）', () => {
    const flat = join(tmpRoot, 'flat');
    const builtinRoot = join(flat, TEMPLATE_REL_DIR);
    const builtinDir = join(builtinRoot, BUILTIN_ID);
    mkdirSync(builtinDir, { recursive: true });
    writeFileSync(
      join(builtinDir, 'template.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: { 'zh-CN': '伪内置', en: 'fake builtin' },
        language: 'zh-CN',
        entryFile: 'document.tex',
        order: 10,
        defaultFor: ['zh-CN'],
        fields: [],
        profileFields: [],
      }),
      'utf8',
    );
    writeFileSync(join(builtinDir, 'document.tex'), '% builtin\n', 'utf8');

    // customRoot 就是内置模板根 ⇒ 路径围栏会通过，只有来源判断能挡住
    const r = deletePaperTemplate({
      resourcesDir: flat,
      customRoot: builtinRoot,
      templateId: BUILTIN_ID,
    });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('内置模板被物理删掉了 —— 来源判断那道闸没拦住');
    expect(r.error).toEqual({ code: 'builtin_template_readonly', status: 403 });
    expect(existsSync(builtinDir)).toBe(true);
    expect(existsSync(join(builtinDir, 'document.tex'))).toBe(true);
  });

  it('自定义模板能删，且**只删那一条**（目录真从磁盘上消失）', () => {
    const dir = seedCustomTemplate('mine-1', '我的模板一');
    seedCustomTemplate('mine-2', '我的模板二');
    expect(customIds().sort()).toEqual(['mine-1', 'mine-2']);

    const r = deletePaperTemplate({ resourcesDir: RESOURCES_DIR, customRoot, templateId: 'mine-1' });
    expect(r).toEqual({ ok: true, id: 'mine-1' });
    expect(existsSync(dir)).toBe(false);
    expect(customIds()).toEqual(['mine-2']);
  });
});

// ─────────────────────────────────────────────────────────────
// ③ 反例：删自定义模板不能连累内置
// ─────────────────────────────────────────────────────────────

describe('③ 反例：删掉自定义模板后，内置列表不能跟着少', () => {
  it('fork → 删这条 fork 出来的 → 内置集合逐条不变', () => {
    const beforeIds = builtinIds();
    const beforeDisk = builtinDiskSnapshot();

    const f = forkPaperTemplate({
      resourcesDir: RESOURCES_DIR,
      customRoot,
      templateId: BUILTIN_ID,
      name: '待删除的自定义模板',
    });
    if (!f.ok) throw new Error(f.error.code);
    expect(customIds()).toEqual([f.template.id]);

    const d = deletePaperTemplate({
      resourcesDir: RESOURCES_DIR,
      customRoot,
      templateId: f.template.id,
    });
    expect(d.ok).toBe(true);
    expect(customIds()).toEqual([]);

    // 内置**集合**不变（逐条含 + 数量同）
    const afterIds = builtinIds();
    expect(new Set(afterIds)).toEqual(new Set(beforeIds));
    expect(afterIds.length).toBe(beforeIds.length);
    expect(builtinDiskSnapshot()).toEqual(beforeDisk);
  });

  it('删自定义模板**不会**把内置模板的 id 从合并列表里带走', () => {
    seedCustomTemplate('tmp-x', '临时');
    const mergedBefore = listPaperTemplateLibrary({ resourcesDir: RESOURCES_DIR, customRoot });
    const builtinSetBefore = new Set(mergedBefore.filter((t) => t.source === 'builtin').map((t) => t.id));

    const d = deletePaperTemplate({ resourcesDir: RESOURCES_DIR, customRoot, templateId: 'tmp-x' });
    expect(d.ok).toBe(true);

    const mergedAfter = listPaperTemplateLibrary({ resourcesDir: RESOURCES_DIR, customRoot });
    const builtinSetAfter = mergedAfter.filter((t) => t.source === 'builtin').map((t) => t.id);
    expect(new Set(builtinSetAfter)).toEqual(builtinSetBefore);
    expect(mergedAfter.some((t) => t.source === 'custom')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// ⑤ 防回归：输入区那条通道（`paper:templates`）的数据源必须**只有内置**
//
// 背景：`Composer.tsx` 的比赛模板选择器整段渲染在一个「内置模板」标签下，
// 且**选中时写死 `source: 'builtin'`**。只要自定义模板混进那条通道，
// 用户在那儿点一条 fork 出来的模板就会被记成内置（`sourcePath` 一起被清空）——
// 一条本来能用的模板被写坏，而且要到写论文时才暴露。
//
// 这一组钉的是**数据源**：`PAPER_TEMPLATES` 的实现就是 `listPaperTemplates`。
// ─────────────────────────────────────────────────────────────

describe('⑤ 防回归：`paper:templates`（输入区用）仍是只报内置', () => {
  it('fork 之后，只报内置的那份列表里**看不到**这条自定义模板', () => {
    const f = forkPaperTemplate({
      resourcesDir: RESOURCES_DIR,
      customRoot,
      templateId: BUILTIN_ID,
      name: '不该出现在输入区',
    });
    if (!f.ok) throw new Error(f.error.code);

    // `paper:templates` 通道体读的就是这一份
    const forComposer = listPaperTemplates(RESOURCES_DIR);
    expect(forComposer.some((t) => t.id === f.template.id)).toBe(false);
    expect(forComposer.every((t) => t.source === 'builtin')).toBe(true);

    // 合并库（扩展页那条通道读的）里才有它
    const merged = listPaperTemplateLibrary({ resourcesDir: RESOURCES_DIR, customRoot });
    expect(merged.some((t) => t.id === f.template.id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// ④ 结构断言：通道真的接上了（**证伪边界见文件头**）
//
// 这一组只保证"接线还在"（channel 注册 + 走的是同一个被围栏保护的函数），
// **不保证**真 IPC 往返、更不保证界面点得动 —— 那要靠实机 e2e。
// ─────────────────────────────────────────────────────────────

describe('④ 结构断言（通道接线，真 IPC 往返不在此覆盖范围）', () => {
  const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  it('`ipc/paper.ts` 注册了 library / fork / delete 三条通道，且都走 scan 层的同一个函数', () => {
    const src = readFileSync(join(SRC, 'ipc', 'paper.ts'), 'utf8');
    expect(src).toContain('IPC.PAPER_TEMPLATE_LIBRARY');
    expect(src).toContain('IPC.PAPER_TEMPLATE_FORK');
    expect(src).toContain('IPC.PAPER_TEMPLATE_DELETE');
    expect(src).toContain('listPaperTemplateLibrary(');
    expect(src).toContain('forkPaperTemplate(');
    expect(src).toContain('deletePaperTemplate(');
    // 删除处理里不许出现"另写一套 rimraf/mkdir 的删除逻辑"——
    // 一旦出现，就说明有人绕开围栏自己删目录了。
    expect(src).not.toMatch(/rmSync\(\s*templateId/);
  });

  it('preload 把三条通道暴露给了渲染层（名字与 UI 调用一致）', () => {
    const src = readFileSync(join(SRC, '..', 'preload', 'index.ts'), 'utf8');
    expect(src).toContain('IPC.PAPER_TEMPLATE_LIBRARY');
    expect(src).toContain('IPC.PAPER_TEMPLATE_FORK');
    expect(src).toContain('IPC.PAPER_TEMPLATE_DELETE');
    expect(src).toContain('library:');
    expect(src).toContain('forkTemplate:');
    expect(src).toContain('deleteTemplate:');
  });

  it('扩展页的模板 tab 真的调了这些方法（不是只在文案上写了按钮）', () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../renderer/src/pages/ExtensionsPage.tsx'),
      'utf8',
    );
    expect(src).toContain('window.mathmodel.paper.library()');
    expect(src).toContain('window.mathmodel.paper.forkTemplate(');
    expect(src).toContain('window.mathmodel.paper.deleteTemplate(');
    expect(src).toContain('window.mathmodel.paper.saveConfig({ template: ref })');
    // 文案键来自原版那一族，且都是已存在的键（i18n 的零豁免名单会另测一遍）
    expect(src).toContain('extensions.paperTemplatesSection.useTemplate');
    expect(src).toContain('extensions.paperTemplatesSection.forkTemplate');
    expect(src).toContain('extensions.paperTemplatesSection.customGroup');
  });
});
