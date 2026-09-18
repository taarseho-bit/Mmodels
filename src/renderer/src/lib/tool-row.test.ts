// ⚠️ 证伪边界（看这行就够了）：本文件**无法**验证真实点击展开；交互层面的验证依赖实机 e2e（node 环境无 jsdom）。
/**
 * 工具行文案 + 折叠组逻辑的单测（规格：BACKLOG §3-30 / #25）。
 *
 * ## 为什么逻辑抽在 `lib/tool-row.ts` 而不是就地写在组件里
 *
 * `node_modules` 里**没有** jsdom / happy-dom（vitest 只跑 `environment: 'node'`），
 * 渲染断言做不了 —— 所以把「工具名 → 动作文案」「连续工具 → 折叠组」全抽成
 * 纯函数，在 node 下直接断言**真实的用户可见字符串**。这比"断言源码里有个变量"
 * 强得多：后者改名就红、行为错了却不红。
 *
 * ## 反向对照
 *
 * `toolRowLabel` 的映射表被换回旧的 `block.toolName?.split('__').pop()` 时，
 * 本文件第 1 组用例**必须真红**（已经实跑验证过，见汇报）。所以这一组不是
 * "顺手写的断言"，它确实拦得住回退。
 *
 * ## 这一组用例**盖不住**什么（证伪边界）
 *
 * 组折叠的"点一下能展开"是**交互**，node 环境里点不了。这里能钉住的只有：
 *   ① 折叠后 `group.rows` **一个不少**地带着那几条（展开有东西可渲染）；
 *   ② 每条还带着原 `block`（展开后是完整 ToolCard，不是光秃秃一行标签）；
 *   ③ 源码形状（`ChatPage.tsx` 里组组件确有一个 `useState` 开关 + 展开时 map rows）。
 * ③ 是**结构断言**：只保证"接线还在"，不保证"点得动"。真正的点击验证要靠
 * 实机 e2e（或将来装 jsdom）。这一条如实写明，不含糊。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ContentBlock } from '@shared/types';
import { setLang, tx } from '../i18n';
import {
  ROW_VALUE_MAX,
  TOOL_GROUP_MIN,
  buildDisplay,
  shortToolName,
  toolGroupKind,
  toolGroupLabel,
  toolKindOf,
  toolRowLabel,
  type ToolRow,
} from './tool-row';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 造一个 tool_use 块 */
const tool = (toolName: string, toolInput: unknown = {}): ContentBlock => ({
  kind: 'tool_use',
  toolName,
  toolUseId: `id-${toolName}`,
  toolInput,
});

/** 造一个已完成的 tool_use（有 toolResult） */
const done = (toolName: string, toolInput: unknown = {}, toolResult: unknown = 'ok'): ContentBlock => ({
  ...tool(toolName, toolInput),
  toolResult,
});

/** 只取展示层给"行"用的那几个字段（`toolRowLabel` 的入参形状） */
const labelOf = (b: ContentBlock): string => toolRowLabel(b);

beforeEach(() => {
  // 语言是模块级状态，别的用例可能切过 en；这里钉死中文再断言中文串
  setLang('zh-CN');
});

describe('tool-row · 判据① 一条命令的行文案是动作，不是工具名', () => {
  it('Bash 的行文案是「运行 …」，**不是** `Bash` 这个工具名', () => {
    const b = done('Bash', { command: 'ls -la' });
    const label = labelOf(b);

    // ★ 反向对照的红点就在这里：退回 split('__').pop() 时 label 会变成 'Bash'
    expect(label).not.toBe('Bash');
    expect(label).not.toContain('Bash');
    expect(label.startsWith('运行')).toBe(true);
    // 命令本身进了 value（键族里 ran 就是 '运行 {{value}}'）
    expect(label).toContain('ls -la');
  });

  it('Bash 没有 command 字段时，正好落通用文案「运行命令」（ranGeneric）', () => {
    expect(labelOf(tool('Bash', {}))).toBe(tx('chat.toolUseRow.ranGeneric'));
    expect(labelOf(tool('Bash', {}))).toBe('运行命令');
  });

  it('MCP 前缀的工具也走同一张表（短名只用来查表，不当文案）', () => {
    // 短名口径保留 ⇒ mcp__ 前缀换供应商照样命中 Bash 这一条
    expect(shortToolName('mcp__somevendor__Bash')).toBe('Bash');
    expect(labelOf(tool('mcp__somevendor__Bash', { command: 'pwd' }))).toBe('运行 pwd');
  });
});

describe('tool-row · 键族里那几类工具都有动作文案', () => {
  it('读取 / 编辑 / 写入 / 搜索 / 网页 / 抓取 / 任务 / 子任务 / 生图', () => {
    expect(labelOf(done('Read', { file_path: 'src/a.py' }))).toBe('读取 src/a.py');
    expect(labelOf(done('Edit', { file_path: 'src/a.py' }))).toBe('编辑 src/a.py');
    expect(labelOf(done('MultiEdit', { file_path: 'src/b.py' }))).toBe('编辑 src/b.py');
    expect(labelOf(done('Write', { file_path: 'out/c.py' }))).toBe('写入 out/c.py');
    expect(labelOf(done('Grep', { pattern: 'TODO' }))).toBe('搜索 TODO');
    expect(labelOf(done('Glob', { pattern: '**/*.ts' }))).toBe('搜索 **/*.ts');
    expect(labelOf(done('WebSearch', { query: '定日镜场' }))).toBe('搜索网页 定日镜场');
    expect(labelOf(done('WebFetch', { url: 'https://example.com' }))).toBe('抓取 https://example.com');
    expect(labelOf(done('Task', { description: '算一遍' }))).toBe('子任务：算一遍');
    expect(labelOf(done('TodoWrite', { todos: [] }))).toBe('更新任务清单');
    expect(labelOf(done('TaskCreate', { subject: 'x' }))).toBe('更新任务清单');
  });

  it('生图三态用的是 imageGenerating / imageGenerated / imageFailed', () => {
    const running: ContentBlock = { kind: 'tool_use', toolName: 'GenerateImage', toolInput: {} };
    expect(labelOf(running)).toBe('正在生成图片');
    expect(labelOf(done('GenerateImage'))).toBe('已生成图片');
    expect(labelOf({ ...done('GenerateImage'), isError: true })).toBe('图片生成失败');
  });

  it('该给 value 却取不到的，落**同族**通用键（不是工具名、不是空串）', () => {
    expect(labelOf(tool('Grep', {}))).toBe('搜索文件');
    expect(labelOf(tool('WebSearch', {}))).toBe('搜索网页');
    expect(labelOf(tool('WebFetch', {}))).toBe('抓取网页');
    expect(labelOf(tool('Task', {}))).toBe('运行子任务');
    // read / edited / wrote 原版没给通用键 ⇒ 落 genericTool（见 lib/tool-row.ts 头注）
    expect(labelOf(tool('Read', {}))).toBe('使用工具');
    expect(labelOf(tool('Edit', {}))).toBe('使用工具');
    expect(labelOf(tool('Write', {}))).toBe('使用工具');
  });

  it('超长 value 截断到 ROW_VALUE_MAX 且带省略号（展示口径，不是原版明文）', () => {
    const long = 'x'.repeat(ROW_VALUE_MAX + 50);
    const label = labelOf(done('Bash', { command: long }));
    expect(label).toBe(`运行 ${'x'.repeat(ROW_VALUE_MAX)}…`);
  });
});

describe('tool-row · 判据② 连续多个工具折叠成一组，展开能拿到那 3 个', () => {
  it('连续 3 个工具 →「使用了 3 个工具」，且组里一行不少地带着这 3 条', () => {
    const blocks = [done('Bash', { command: 'a' }), done('Read', { file_path: 'b' }), done('Frobnicate', {})];
    const items = buildDisplay(blocks);

    expect(items).toHaveLength(1);
    const it0 = items[0];
    expect(it0.type).toBe('group');
    if (it0.type !== 'group') throw new Error('unreachable');

    expect(it0.group.label).toBe('使用了 3 个工具');
    // ★「可展开」的可断言部分：展开时有 3 条可渲染，且每条都带着原块
    expect(it0.group.rows).toHaveLength(3);
    expect(it0.group.rows.map((r) => r.block)).toEqual(blocks);
    expect(it0.group.rows.map((r) => r.label)).toEqual(['运行 a', '读取 b', '使用工具']);
  });

  it('同一种类用专属组键：3 条命令 →「运行了 3 条命令」', () => {
    const items = buildDisplay([done('Bash'), done('Bash'), done('Bash')]);
    expect(items[0].type).toBe('group');
    if (items[0].type !== 'group') throw new Error('unreachable');
    expect(items[0].group.label).toBe('运行了 3 条命令');
    expect(items[0].group.kind).toBe('command');
  });

  it('2 条就折叠（组的下界是 TOOL_GROUP_MIN），1 条**不折叠**', () => {
    expect(TOOL_GROUP_MIN).toBe(2);
    expect(buildDisplay([done('Bash'), done('Bash')])[0].type).toBe('group');
    const single = buildDisplay([done('Bash', { command: 'ls' })]);
    expect(single).toHaveLength(1);
    expect(single[0].type).toBe('block');
  });

  it('中间夹了文本/思考就断开 —— 只合并**相邻**的工具', () => {
    const blocks: ContentBlock[] = [
      done('Bash', { command: 'a' }),
      { kind: 'text', text: '说明一句' },
      done('Read', { file_path: 'b' }),
      done('Read', { file_path: 'c' }),
    ];
    const items = buildDisplay(blocks);
    // 块 / 文本 / 组(2 个 Read)
    expect(items.map((i) => i.type)).toEqual(['block', 'block', 'group']);
    const g = items[2];
    if (g.type !== 'group') throw new Error('unreachable');
    expect(g.group.label).toBe('读取了 2 个文件');
  });

  it('整块顺序不变：折叠不重排、不丢块', () => {
    const blocks: ContentBlock[] = [
      { kind: 'text', text: '前' },
      done('Bash'),
      done('Bash'),
      { kind: 'thinking', text: '想' },
      done('Read'),
    ];
    const items = buildDisplay(blocks);
    expect(items.map((i) => i.type)).toEqual(['block', 'group', 'block', 'block']);
  });

  it('txPlural 走的是 _one/_other：1 个也算组文案（toolGroupLabel 直取）', () => {
    const rows: ToolRow[] = [{ id: 'a', label: 'x', kind: 'command', block: done('Bash') }];
    expect(toolGroupLabel(rows)).toBe('运行了 1 条命令');
    expect(toolGroupKind(rows)).toBe('command');
  });

  it('组文案与种类：杂类落 `tool` 组，未知工具算 `tool` 类', () => {
    expect(toolKindOf('Bash')).toBe('command');
    expect(toolKindOf('WebFetch')).toBe('web');
    expect(toolKindOf('Write')).toBe('edit');
    expect(toolKindOf('mcp__v__whatever')).toBe('tool');
    expect(toolKindOf(undefined)).toBe('tool');
  });
});

describe('tool-row · 判据③ 未知工具落通用文案（既不是空串也不是 undefined）', () => {
  it('带 mcp__ 前缀的未知工具 →「使用工具」，且不是任何形式的工具名', () => {
    const toolName = 'mcp__somevendor__brand_new_tool';
    const label = labelOf(tool(toolName, { anything: 1 }));

    // ★ 三条一起断言：空串 / undefined / 原始名 都是错的
    expect(label).not.toBe('');
    expect(label).not.toBeUndefined();
    expect(typeof label).toBe('string');
    expect(label.trim().length).toBeGreaterThan(0);
    expect(label).not.toBe(toolName);
    expect(label).not.toBe(shortToolName(toolName)); // 'brand_new_tool'
    expect(label).not.toContain('mcp__');
    expect(label).not.toContain('brand_new_tool');
    // 落点必须是**真实存在的键**，不是 tx() 回吐的路径串
    expect(label).toBe(tx('chat.toolUseRow.genericTool'));
    expect(label).toBe('使用工具');
  });

  it('toolName 缺失（undefined）也不崩、不空', () => {
    expect(toolRowLabel({ toolName: undefined })).toBe('使用工具');
  });
});

describe('tool-row · 判据④ 保回退：不带 __ 的工具名不崩、有可读文案', () => {
  it('shortToolName 保留原口径：不带 __ 时原样返回', () => {
    expect(shortToolName('Bash')).toBe('Bash');
    expect(shortToolName('mcp__a__b')).toBe('b');
    expect(shortToolName('')).toBe('');
  });

  it('不带 __ 的**已知**工具名照常映射', () => {
    expect(labelOf(done('Read', { file_path: 'a.ts' }))).toBe('读取 a.ts');
  });

  it('不带 __ 的**未知**工具名 → 通用文案（不是它自己）', () => {
    const label = labelOf(tool('SomeFutureTool', {}));
    expect(label).toBe('使用工具');
    expect(label).not.toBe('SomeFutureTool');
    expect(label.length).toBeGreaterThan(0);
  });

  it('畸形输入（toolInput 是 null / 字符串 / 数组）都不抛、不空', () => {
    for (const input of [null, undefined, 'raw', 42, [], { file_path: 123 }]) {
      const label = labelOf(tool('Read', input));
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('tool-row · ChatPage 的接线（结构断言，附证伪边界）', () => {
  const src = fs.readFileSync(path.resolve(HERE, '..', 'pages', 'ChatPage.tsx'), 'utf8');

  it('ChatPage 走的是 buildDisplay / toolRowLabel，不再把工具名当行文案', () => {
    expect(src).toContain('buildDisplay(');
    expect(src).toContain('toolRowLabel(');
    // ★ 旧行为（原始工具名直接上屏）必须彻底消失
    expect(src).not.toContain("split('__').pop()");
  });

  it('组组件有一个展开开关，且展开时逐行 map 出 rows（结构断言）', () => {
    // ⚠️ 证伪边界：这只能证明"接线还在"，点不点得动要实机 e2e 才算数
    expect(src).toContain('function ToolGroupCard(');
    const body = src.slice(src.indexOf('function ToolGroupCard('), src.indexOf('function preStyle'));
    expect(body).toContain('useState(false)');
    expect(body).toContain('open &&');
    expect(body).toContain('group.rows.map(');
  });
});
