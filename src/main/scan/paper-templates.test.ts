/**
 * 「初始化论文项目配置」+ 比赛信息 schema 的回归测试 —— 设置里那个开关不该是摆设。
 *
 * 背景（用户运行测试抱怨的原始现象）：
 *   `.mathmodel/paper/config.json` 在项目里**永远不存在**，于是 agent 读不到比赛字段、
 *   也定不出模板来源，用户拿不到可粘贴的 LaTeX 字段。
 *   根因是 `paperInitProjectConfig` 只有默认值 / 类型 / 界面开关，全仓没有消费方。
 *
 * 为什么这层要单独测（而不是只靠运行测试 E2E）：
 *   运行测试跑一次要构建、要抢 GUI；而"写文件"的语义本身（创建 / 不覆盖 / 路径安全 /
 *   老结构兼容）是**纯 Node 逻辑**，可以在这里逐条钉死。
 *   运行测试 E2E 负责另外两件事：这条链路在真 IPC + 真 UI 上确实被触发。
 *
 * ⚠️ 本文件还承担**老数据兼容**的判据（B9 目录名迁移 / B19 用户手写文件不覆盖）：
 *   这两条的失效形态都只在"老项目"上才出现 —— 用全新的空目录测**永远测不出来**，
 *   所以下面每个用例都**先手工造出一个老状态**再跑。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LEGACY_MM_DIR,
  MM_DIR,
  initPaperProjectConfig,
  legacyPaperConfigPath,
  listPaperTemplates,
  normalizePaperConfig,
  paperConfigOwnership,
  paperConfigPath,
  pickDefaultTemplateId,
  planPaperConfigSave,
  readPaperConfig,
  resolvePaperConfigFile,
  TEMPLATE_REL_DIR,
} from './paper-templates';
import { pickLocalizedText, type PaperTemplate } from '@shared/types';

/** 造一份最小模板元数据（字段与 cumcm 一致，便于断言 profileFields 预填） */
function tpl(id: string, defaultFor: string[]): PaperTemplate {
  return {
    id,
    name: id.toUpperCase(),
    /**
     * 英文名 —— 对应 template.json 的 `name.en`。
     * 刻意与中文名不同，才能证明写进配置的 `Np.en` 是**从这里取的**、不是拿中文顶的。
     */
    nameEn: `${id.toUpperCase()}-EN`,
    description: '',
    language: 'zh-CN',
    entryFile: 'document.tex',
    order: 10,
    defaultFor,
    fields: [
      { id: 'problemNumber', label: '题号', labelEn: 'Problem', required: true },
      { id: 'teamNumber', label: '参赛队号', labelEn: 'Team number', required: true },
    ],
    profileFields: ['school', 'members', 'advisor'],
    dir: `/fake/${id}`,
    source: 'builtin',
  };
}

const TEMPLATES = [tpl('cumcm', ['zh-CN']), tpl('mcm', ['en'])];
const NO_PROFILE = null;

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mm-paper-'));
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* 宿主 safe-delete 垫片可能拦批量删除，忽略即可 */
  }
});

describe('pickDefaultTemplateId（模板兜底规则）', () => {
  it('设置里选过且模板存在 → 用设置里的', () => {
    expect(pickDefaultTemplateId(TEMPLATES, 'mcm', 'zh-CN')).toBe('mcm');
  });

  it('设置里没选 / 选了个不存在的 → 按语言默认（中文 cumcm、英文 mcm）', () => {
    expect(pickDefaultTemplateId(TEMPLATES, null, 'zh-CN')).toBe('cumcm');
    expect(pickDefaultTemplateId(TEMPLATES, 'nope', 'zh-CN')).toBe('cumcm');
    expect(pickDefaultTemplateId(TEMPLATES, null, 'en-US')).toBe('mcm');
  });

  it('defaultFor 全不命中 → 退回第一个（宁可给个能用的，也不要空 id）', () => {
    const only = [tpl('weird', [])];
    expect(pickDefaultTemplateId(only, null, 'zh-CN')).toBe('weird');
  });

  it('一个模板都没有 → null（不硬编一个假 id 进配置）', () => {
    expect(pickDefaultTemplateId([], null, 'zh-CN')).toBeNull();
  });
});

describe('initPaperProjectConfig（自动初始化）', () => {
  it('首次发起论文任务 → 真的落盘，且含 template.source=builtin', () => {
    const r = initPaperProjectConfig({
      projectRoot: root,
      templates: TEMPLATES,
      preferTemplateId: null,
      locale: 'zh-CN',
      profile: NO_PROFILE,
    });

    expect(r.created).toBe(true);
    expect(r.templateId).toBe('cumcm');

    const p = paperConfigPath(root);
    expect(existsSync(p)).toBe(true);

    const onDisk = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    expect(onDisk.schemaVersion).toBe(1);
    expect(onDisk.managedBy).toBe('mathmodel');
    const t = onDisk.template as Record<string, unknown>;
    expect(t.id).toBe('cumcm');
    expect(t.source).toBe('builtin');
    expect(t.sourcePath).toBe(null);
    expect(t.entryFile).toBe('document.tex');
    // `name` 必须是**应用约定 `Np` 对象**（两个键都非空），**不是**字符串 ——
    // 应用约定 zod 是 `z.object({ 'zh-CN': min(1), en: min(1) })`，字符串过不了 schema。
    expect(typeof t.name).toBe('object');
    expect(t.name).not.toBeNull();
    expect(pickLocalizedText(t.name, 'zh-CN')).toBe('CUMCM');
    expect(pickLocalizedText(t.name, 'en')).toBe('CUMCM-EN');
    // 没有队伍档案 → 字段留空数组，不编造
    expect(onDisk.contestFields).toEqual([]);
    expect(onDisk.teamProfile).toBe(null);
  });

  it('**已存在就不动**（反向保护：不能把用户的比赛信息冲掉）', () => {
    const p = paperConfigPath(root);
    mkdirSync(join(root, MM_DIR, 'paper'), { recursive: true });
    const mine = {
      schemaVersion: 1,
      managedBy: 'mathmodel',
      template: { id: 'mcm', name: 'MCM', entryFile: 'main.tex', source: 'custom', sourcePath: '/my/tpl' },
      contestFields: [{ id: 'problemNumber', label: '题号', value: 'A' }],
      teamProfile: null,
    };
    writeFileSync(p, JSON.stringify(mine, null, 2), 'utf8');

    const r = initPaperProjectConfig({
      projectRoot: root,
      templates: TEMPLATES,
      preferTemplateId: 'cumcm',
      locale: 'zh-CN',
      profile: NO_PROFILE,
    });

    expect(r.created).toBe(false);
    expect(r.reason).toBe('already-exists');
    // 磁盘内容逐字未变（尤其 custom / sourcePath 没被打回 builtin）
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual(mine);
  });

  it('队伍档案：只预填模板 profileFields 要的键，且写成「名字、名字」', () => {
    const r = initPaperProjectConfig({
      projectRoot: root,
      templates: TEMPLATES,
      preferTemplateId: null,
      locale: 'zh-CN',
      profile: {
        id: 'tp1',
        name: '2026 国赛队',
        school: '某某大学',
        members: ['甲', '乙', '丙'],
        advisor: '张老师',
        contact: '13800000000',
      },
    });
    expect(r.created).toBe(true);

    const cfg = readPaperConfig(root, TEMPLATES)!;
    // cumcm.profileFields = ['school','members','advisor'] —— contact 不在里面，不得写进来
    expect(cfg.contestFields.map((f) => f.id)).toEqual(['school', 'members', 'advisor']);
    expect(cfg.contestFields.find((f) => f.id === 'members')!.value).toBe('甲、乙、丙');
    // 档案预填出来的字段名只有中文 → `en` 用原文兜底；但**形状必须是对象、两键都非空**
    // （应用约定 `Np` 的 `min(1)`，塞空串或写字符串都会被应用约定判非法）。
    for (const f of cfg.contestFields) {
      expect(typeof f.label).toBe('object');
      expect(pickLocalizedText(f.label, 'zh-CN')).not.toBe('');
      expect(pickLocalizedText(f.label, 'en')).not.toBe('');
    }
    expect(JSON.stringify(cfg.contestFields)).not.toContain('13800000000');
    // 档案快照进 teamProfile（contact 落到 phone）
    expect(cfg.teamProfile?.school).toBe('某某大学');
    expect(cfg.teamProfile?.phone).toBe('13800000000');
  });

  it('没有可用模板 → 不写文件（宁可不写，也不写一个空模板进去）', () => {
    const r = initPaperProjectConfig({
      projectRoot: root,
      templates: [],
      preferTemplateId: null,
      locale: 'zh-CN',
      profile: NO_PROFILE,
    });
    expect(r.created).toBe(false);
    expect(r.reason).toBe('no-template');
    expect(existsSync(paperConfigPath(root))).toBe(false);
  });

  it('`.mathmodel` 是符号链接 → 拒绝写入（应用约定 paperConfigUnsafePath 同义）', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mm-paper-outside-'));
    try {
      try {
        symlinkSync(outside, join(root, MM_DIR), 'junction');
      } catch {
        // Windows 上建 junction 可能因权限失败 —— 那这条判据在本机不可测，
        // 明确记为跳过，而不是静默通过（否则是假绿）。
        console.warn('[skip] 无法创建 junction，本机跳过 unsafe-path 判据');
        return;
      }
      const r = initPaperProjectConfig({
        projectRoot: root,
        templates: TEMPLATES,
        preferTemplateId: null,
        locale: 'zh-CN',
        profile: NO_PROFILE,
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('unsafe-path');
      expect(existsSync(paperConfigPath(outside))).toBe(false);
    } finally {
      try {
        rmSync(outside, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});

describe('normalizePaperConfig（老结构兼容）', () => {
  it('本项目早期结构 { templateId, fields:{k:v} } → 换算成应用约定新结构', () => {
    const cfg = normalizePaperConfig(
      {
        templateId: 'cumcm',
        fields: { problemNumber: 'B', teamNumber: '2026001' },
        profileId: 'tp1',
      },
      TEMPLATES,
    );
    expect(cfg.template.id).toBe('cumcm');
    expect(cfg.template.source).toBe('builtin');
    expect(pickLocalizedText(cfg.template.name, 'zh-CN')).toBe('CUMCM'); // 靠模板列表补出显示名
    expect(pickLocalizedText(cfg.template.name, 'en')).toBe('CUMCM-EN');
    expect(cfg.contestFields.map((f) => f.id)).toEqual(['problemNumber', 'teamNumber']);
    // 早期 `fields:{k:v}` map 本来就没有 label → 退回字段 id；**但仍要落成对象**
    expect(cfg.contestFields.map((f) => pickLocalizedText(f.label))).toEqual(['problemNumber', 'teamNumber']);
  });

  it('应用约定新结构原样保留（含 custom / sourcePath / 自定义字段 label）', () => {
    const cfg = normalizePaperConfig(
      {
        schemaVersion: 1,
        managedBy: 'mathmodel',
        template: { id: 'my-tpl', name: '我的模板', entryFile: 'main.tex', source: 'custom', sourcePath: 'D:/tpl' },
        contestFields: [
          { id: 'problemNumber', label: '题号', value: 'A' },
          // 自定义字段的 id 要满足应用约定 schema `^[a-z][A-Za-z0-9]*$`（不能带下划线）
          { id: 'customAbc1', label: '组别', value: '研究生组' },
        ],
        teamProfile: { id: 'tp1', name: '队' },
      },
      TEMPLATES,
    );
    expect(cfg.template.source).toBe('custom');
    expect(cfg.template.sourcePath).toBe('D:/tpl');
    expect(cfg.template.entryFile).toBe('main.tex');
    // 自定义字段的 label 必须原样带回来 —— 否则重开弹层用户填的字段名就丢了。
    // ⚠️ 磁盘上写的是**早期版本的字符串**，读侧必须兼容并补成两键非空的对象。
    const custom = cfg.contestFields.find((f) => f.id === 'customAbc1')!;
    expect(pickLocalizedText(custom.label, 'zh-CN')).toBe('组别');
    expect(typeof custom.label).toBe('object');
    expect(pickLocalizedText(custom.label, 'en')).not.toBe('');
  });

  it('应用约定 `Np` 对象形态（应用约定写下的配置）读回来 en 不被中文化', () => {
    const cfg = normalizePaperConfig(
      {
        schemaVersion: 1,
        managedBy: 'mathmodel',
        template: {
          id: 'cumcm',
          name: { 'zh-CN': '国赛 CUMCM', en: 'CUMCM' },
          entryFile: 'document.tex',
          source: 'builtin',
          sourcePath: null,
        },
        contestFields: [{ id: 'problemNumber', label: { 'zh-CN': '题号', en: 'Problem' }, value: 'A' }],
        teamProfile: null,
      },
      TEMPLATES,
    );
    expect(cfg.template.name).toEqual({ 'zh-CN': '国赛 CUMCM', en: 'CUMCM' });
    expect(cfg.contestFields[0]!.label).toEqual({ 'zh-CN': '题号', en: 'Problem' });
  });

  it('文件坏掉 → readPaperConfig 返回 null（不抛，不阻断会话）', () => {
    const p = paperConfigPath(root);
    mkdirSync(join(root, MM_DIR, 'paper'), { recursive: true });
    writeFileSync(p, '{ 这不是 JSON', 'utf8');
    expect(readPaperConfig(root, TEMPLATES)).toBe(null);
  });

  it('页数规则合法时保留，坏值与反向范围不进入配置', () => {
    const good = normalizePaperConfig(
      {
        templateId: 'cumcm',
        pageLimit: { maxPages: 20, scope: 'body', startPage: 3, endPage: 22 },
      },
      TEMPLATES,
    );
    expect(good.pageLimit).toEqual({ maxPages: 20, scope: 'body', startPage: 3, endPage: 22 });

    const bad = normalizePaperConfig(
      { templateId: 'cumcm', pageLimit: { maxPages: 0, scope: 'body', startPage: 9, endPage: 2 } },
      TEMPLATES,
    );
    expect(bad.pageLimit).toBeNull();
  });
});

/**
 * ── 老数据兼容（硬纪律一族）────────────────────────────────────
 * `MM_DIR` 曾经是 `.mmodels`（本项目早期自造），现已对齐应用约定的 `.mathmodel`。
 * 下面每条都**先手工造出"老项目"的样子**再跑 —— 全新空目录测不出这类 bug。
 */
describe('B9：目录名对齐 `.mathmodel` + 遗留 `.mmodels` 只读兼容', () => {
  /** 造一份"早期版本写的"配置（内容合法、managedBy 是我们） */
  function legacyConfig(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      managedBy: 'mathmodel',
      template: {
        id: 'mcm',
        name: { 'zh-CN': 'MCM', en: 'MCM' },
        entryFile: 'main.tex',
        source: 'custom',
        sourcePath: '/my/legacy/tpl',
      },
      contestFields: [{ id: 'problemNumber', label: { 'zh-CN': '题号', en: 'Problem' }, value: 'B' }],
      teamProfile: null,
    };
  }

  function writeLegacy(text: string): string {
    const p = legacyPaperConfigPath(root);
    mkdirSync(join(root, LEGACY_MM_DIR, 'paper'), { recursive: true });
    writeFileSync(p, text, 'utf8');
    return p;
  }

  it('目录常量就是应用约定那个字符串（不是别的写法）', () => {
    // 应用约定 协议实现 `Li='.mathmodel/paper/config.json'`
    expect(MM_DIR).toBe('.mathmodel');
    expect(paperConfigPath('/p')).toBe(join('/p', '.mathmodel', 'paper', 'config.json'));
    expect(legacyPaperConfigPath('/p')).toBe(join('/p', '.mmodels', 'paper', 'config.json'));
  });

  it('老项目只有 `.mmodels/paper/config.json` → 读得到，且报的是**那份文件**的真值路径', () => {
    const lp = writeLegacy(JSON.stringify(legacyConfig(), null, 2));

    const hit = resolvePaperConfigFile(root);
    expect(hit?.legacy).toBe(true);
    expect(hit?.path).toBe(lp);

    // 回归护栏：读出来的内容就是老文件里那份（模板 source=custom / sourcePath 没丢）
    const cfg = readPaperConfig(root, TEMPLATES)!;
    expect(cfg.template.id).toBe('mcm');
    expect(cfg.template.source).toBe('custom');
    expect(cfg.template.sourcePath).toBe('/my/legacy/tpl');
    expect(cfg.contestFields[0]!.value).toBe('B');
  });

  it('迁移：canonical 不存在 + 遗留文件是我们的 → 内容带到 `.mathmodel`，**旧文件一个字节没动**', () => {
    const legacyText = JSON.stringify(legacyConfig(), null, 2);
    const lp = writeLegacy(legacyText);

    const r = initPaperProjectConfig({
      projectRoot: root,
      templates: TEMPLATES,
      preferTemplateId: 'cumcm',
      locale: 'zh-CN',
      profile: NO_PROFILE,
    });

    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(r.reason).toBe('migrated-from-legacy');
    expect(r.path).toBe(paperConfigPath(root));

    // canonical 出来了，且**不是**被默认模板顶掉的：用户的 mcm/custom 原样带过来
    const onDisk = JSON.parse(readFileSync(paperConfigPath(root), 'utf8')) as Record<string, unknown>;
    expect(onDisk.managedBy).toBe('mathmodel');
    expect((onDisk.template as Record<string, unknown>).id).toBe('mcm');
    expect((onDisk.template as Record<string, unknown>).sourcePath).toBe('/my/legacy/tpl');
    expect(onDisk.migratedFrom).toBe('.mmodels/paper/config.json');

    // ★ 旧文件仍在，且**逐字未变**（这是"迁移不删旧文件"的判据）
    expect(existsSync(lp)).toBe(true);
    expect(readFileSync(lp, 'utf8')).toBe(legacyText);

    // 迁移后再读：以 canonical 为准（legacy 标记消失）
    expect(resolvePaperConfigFile(root)?.legacy).toBe(false);
  });

  it('两个都在 → canonical 优先（迁移过之后旧文件不再拖后腿）', () => {
    writeLegacy(JSON.stringify(legacyConfig(), null, 2));
    const canonical = {
      ...legacyConfig(),
      template: { id: 'cumcm', name: { 'zh-CN': '国赛', en: 'CUMCM' }, entryFile: 'document.tex', source: 'builtin', sourcePath: null },
    };
    mkdirSync(join(root, MM_DIR, 'paper'), { recursive: true });
    writeFileSync(paperConfigPath(root), JSON.stringify(canonical, null, 2), 'utf8');

    const hit = resolvePaperConfigFile(root);
    expect(hit?.legacy).toBe(false);
    // 回归护栏：如果读的是旧文件，这里会是 'mcm'
    expect(readPaperConfig(root, TEMPLATES)!.template.id).toBe('cumcm');
  });

  it('canonical 已存在 → 初始化照旧跳过（迁移只管"只有旧文件"的情形）', () => {
    writeLegacy(JSON.stringify(legacyConfig(), null, 2));
    mkdirSync(join(root, MM_DIR, 'paper'), { recursive: true });
    writeFileSync(paperConfigPath(root), JSON.stringify(legacyConfig(), null, 2), 'utf8');

    const r = initPaperProjectConfig({
      projectRoot: root,
      templates: TEMPLATES,
      preferTemplateId: null,
      locale: 'zh-CN',
      profile: NO_PROFILE,
    });
    expect(r.reason).toBe('already-exists');
  });
});

/**
 * ── B19：用户手写的配置**不许覆盖**（应用约定 `project_config_conflict`）──
 */
describe('B19：论文配置归属判定与保存决策', () => {
  function userConfig(): Record<string, unknown> {
    // 用户手抄的：有应用约定的键，但**没有** `managedBy`（应用约定 zod 是 literal('mathmodel')）
    return {
      template: { id: 'cumcm', name: '我自己的模板', entryFile: 'paper.tex' },
      contestFields: [{ id: 'problemNumber', label: '题号', value: 'C' }],
    };
  }

  it('paperConfigOwnership：有 managedBy=mathmodel 才算我们的', () => {
    expect(paperConfigOwnership('{"managedBy":"mathmodel"}')).toBe('ours');
    // 回归护栏：缺键 / 别的值 / 不是对象 → 都不是我们的
    expect(paperConfigOwnership('{"template":{}}')).toBe('foreign');
    expect(paperConfigOwnership('{"managedBy":"someone-else"}')).toBe('foreign');
    expect(paperConfigOwnership('null')).toBe('foreign');
    // 坏 JSON 既不冒充"我们的"也不冒充"别人的"（否则用户手滑写坏就再也存不进去）
    expect(paperConfigOwnership('{ 半个 JSON')).toBe('broken');
  });

  it('canonical 里是**用户手写的** → 决策为 conflict，且一个字节都不动', () => {
    const p = paperConfigPath(root);
    mkdirSync(join(root, MM_DIR, 'paper'), { recursive: true });
    const text = JSON.stringify(userConfig(), null, 2);
    writeFileSync(p, text, 'utf8');

    const plan = planPaperConfigSave(root);
    expect(plan.action).toBe('conflict');
    if (plan.action === 'conflict') expect(plan.file).toBe(p);

    // ★ 关键：决策阶段不写盘
    expect(readFileSync(p, 'utf8')).toBe(text);
  });

  it('遗留 `.mmodels` 里是**用户手写的** → 同样 conflict（不拿别人的文件当迁移源）', () => {
    const lp = legacyPaperConfigPath(root);
    mkdirSync(join(root, LEGACY_MM_DIR, 'paper'), { recursive: true });
    const text = JSON.stringify(userConfig(), null, 2);
    writeFileSync(lp, text, 'utf8');

    const plan = planPaperConfigSave(root);
    expect(plan.action).toBe('conflict');
    // 回归护栏：内容换成"我们的"（补上 managedBy）→ 立刻变成可迁移
    writeFileSync(lp, JSON.stringify({ ...userConfig(), managedBy: 'mathmodel' }, null, 2), 'utf8');
    const plan2 = planPaperConfigSave(root);
    expect(plan2.action).toBe('merge');
    if (plan2.action === 'merge') expect(plan2.legacy).toBe(true);
  });

  it('文件是**我们写的** → merge，且原文件里的额外键（用户手加的）带得下去', () => {
    const p = paperConfigPath(root);
    mkdirSync(join(root, MM_DIR, 'paper'), { recursive: true });
    writeFileSync(
      p,
      JSON.stringify({ ...userConfig(), managedBy: 'mathmodel', myOwnNote: '用户手加的键' }, null, 2),
      'utf8',
    );

    const plan = planPaperConfigSave(root);
    expect(plan.action).toBe('merge');
    if (plan.action === 'merge') {
      expect(plan.legacy).toBe(false);
      // 合并基线保留了用户手加的键 → 调用方 `{...merged, ...next}` 写回时不会把它抹掉
      expect(plan.merged.myOwnNote).toBe('用户手加的键');
      expect(plan.broken).toBeUndefined();
    }
  });

  it('坏 JSON → 仍 merge，但把原文交回去让调用方先备份（不静默丢弃）', () => {
    const p = paperConfigPath(root);
    mkdirSync(join(root, MM_DIR, 'paper'), { recursive: true });
    writeFileSync(p, '{ 这不是 JSON', 'utf8');

    const plan = planPaperConfigSave(root);
    expect(plan.action).toBe('merge');
    if (plan.action === 'merge') expect(plan.broken).toBe('{ 这不是 JSON');
  });

  it('什么都没有 → merge + 空基线（正常新建）', () => {
    const plan = planPaperConfigSave(root);
    expect(plan.action).toBe('merge');
    if (plan.action === 'merge') {
      expect(plan.merged).toEqual({});
      expect(plan.legacy).toBe(false);
      expect(plan.file).toBe(paperConfigPath(root));
    }
  });
});

describe('listPaperTemplates（template.json → 模板元数据）', () => {
  it('`name.en` 与 `fields[].label` / `label.en` 都要带出来（写配置时 en 从这儿取）', () => {
    const dir = join(root, TEMPLATE_REL_DIR, 'cumcm');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'template.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: { 'zh-CN': '国赛 CUMCM', en: 'CUMCM' },
        description: { 'zh-CN': '全国大学生数学建模竞赛中文论文模板', en: 'China Undergraduate …' },
        language: 'zh-CN',
        entryFile: 'document.tex',
        order: 10,
        defaultFor: ['zh-CN'],
        fields: [{ id: 'problemNumber', label: { 'zh-CN': '题号', en: 'Problem' }, required: true }],
        profileFields: [],
      }),
      'utf8',
    );

    const list = listPaperTemplates(root);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('国赛 CUMCM');
    expect(list[0]!.nameEn).toBe('CUMCM');
    // 字段侧：中文给界面渲染用，英文留给写盘时的 `Np.en`（如「题号」→「Problem」）
    expect(list[0]!.fields[0]!.label).toBe('题号');
    expect(list[0]!.fields[0]!.labelEn).toBe('Problem');
    // 没有 `options` 的字段 → `undefined`，**不是空数组**（渲染层只判一次 `?.length`）
    expect(list[0]!.fields[0]!.options).toBeUndefined();
  });

  it('`fields[].options`：非法项丢掉、`label` 缺失退回 value、一项不剩就给 `undefined`', () => {
    const dir = join(root, TEMPLATE_REL_DIR, 'csj');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'template.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: { 'zh-CN': '长三角赛', en: 'Yangtze' },
        language: 'zh-CN',
        entryFile: 'main.tex',
        order: 100,
        defaultFor: [],
        fields: [
          {
            id: 'category',
            label: { 'zh-CN': '赛道', en: 'Division' },
            options: [
              { value: '本科生', label: { 'zh-CN': '本科生', en: 'Undergraduate' } },
              { value: '研究生' }, // 没有 label → 退回 value，且两个键都非空
              { value: '   ' }, // value 全空白 → 非法，丢掉
              null, // 整项非法 → 丢掉
            ],
          },
          { id: 'allBad', label: { 'zh-CN': '全坏' }, options: [{ value: '' }, null] },
          { id: 'notArray', label: { 'zh-CN': '不是数组' }, options: 'x' },
        ],
        profileFields: [],
      }),
      'utf8',
    );

    const t = listPaperTemplates(root)[0]!;
    const category = t.fields.find((f) => f.id === 'category')!;
    expect(category.options?.map((o) => o.value)).toEqual(['本科生', '研究生']);
    expect(pickLocalizedText(category.options![0]!.label, 'en')).toBe('Undergraduate');
    expect(pickLocalizedText(category.options![1]!.label, 'zh-CN')).toBe('研究生');
    // 非法项被丢光 → `undefined`（不是 `[]`）；`options` 不是数组 → 同样 `undefined`
    expect(t.fields.find((f) => f.id === 'allBad')!.options).toBeUndefined();
    expect(t.fields.find((f) => f.id === 'notArray')!.options).toBeUndefined();
  });
});

/**
 * 真实内置模板目录的回归 —— 判据盯的是「模板数据 + 解析器」合起来的结果，
 * 不是各自单独的样子：`options` 在 template.json 里**本来就有**（应用约定有、我们丢过）。
 */
describe('listPaperTemplates（真实内置模板目录 · 字段 options）', () => {
  const res = join(process.cwd(), 'resources');

  it('长三角赛「赛道」带出下拉选项，中英都齐', () => {
    // 目录都找不到时必须**响亮地失败**，不能因为"没数据"就静默跳过
    expect(existsSync(join(res, TEMPLATE_REL_DIR))).toBe(true);

    const list = listPaperTemplates(res);
    const csj = list.find((t) => t.id === 'changsanjiao');
    expect(csj).toBeTruthy();
    const category = csj!.fields.find((f) => f.id === 'category')!;
    expect(category.options).toHaveLength(2);
    expect(pickLocalizedText(category.options![0]!.label, 'zh-CN')).toBe('本科生');
    expect(pickLocalizedText(category.options![0]!.label, 'en')).toBe('Undergraduate');
  });

  it('没有 options 的模板与字段不受影响（仍是 `undefined`）', () => {
    const list = listPaperTemplates(res);
    // huashubei 的 fields 是空数组 —— 整个模板照常返回，不因缺少 options 出问题
    expect(list.find((t) => t.id === 'huashubei')!.fields).toEqual([]);
    // wuyi：category 是下拉（4 项），同模板的 problemNumber / date 没有 options
    const wuyi = list.find((t) => t.id === 'wuyi')!;
    expect(wuyi.fields.find((f) => f.id === 'category')!.options).toHaveLength(4);
    expect(wuyi.fields.find((f) => f.id === 'problemNumber')!.options).toBeUndefined();
    expect(wuyi.fields.find((f) => f.id === 'date')!.options).toBeUndefined();
  });
});
