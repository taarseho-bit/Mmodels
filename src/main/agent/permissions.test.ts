/**
 * 权限模式的判定测试（任务 B）。
 *
 * ## 这条测试要防的是什么
 *
 * 输入区那个「完全访问 / 需要批准」选择器**长期是装饰品**：
 * `settings.permissionMode` 在主进程**零读取点**，切过去不改变任何行为。
 * 更糟的是"直接透传"这条捷径会**静默失效** —— 原版只认字面量 `'approval-required'`，
 * 而复刻的设置值是 `'approval'`，透进去会 fallthrough 到 `bypassPermissions`
 * （＝用户切到"需要批准"，实际仍然全放行）。
 *
 * 所以这里的每条断言都成对：**正面**（该变的变了）+ **反面**（不该变的没变）。
 *
 * ## 为什么判定要放在纯函数里
 *
 * 真跑一遍"切模式 → 发消息 → 看 agent 是否停下来问"需要 electron + 真 SDK + 真 CLI。
 * 把**判定**抽成纯函数后，这些判据能在毫秒级跑完，且不依赖任何环境。
 * 真 CLI 那一侧单独靠结构级断言钉顺序（本文件最后一节）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  READONLY_TOOLS,
  approvalDetailOf,
  approvalKindOf,
  canonicalPermissionMode,
  gateStepFor,
  sdkPermissionModeFor,
  type AppPermissionMode,
} from './permissions';

// ─────────────────────────────────────────────────────────────
// 口径映射：复刻值 → 原版值（**静默失效**就死在这一步）
// ─────────────────────────────────────────────────────────────

describe('canonicalPermissionMode —— 复刻口径 → 原版口径', () => {
  it('`approval` → `approval-required`（**原版字面量，不是 `approval`**）', () => {
    // 这条就是"静默失效"的回归判据：如果这里返回 `'approval'`，
    // 原版 `jh()` 的三元会 fallthrough 成 bypassPermissions。
    expect(canonicalPermissionMode('approval')).toBe('approval-required');
    expect(canonicalPermissionMode('approval')).not.toBe('approval');
  });

  it('`full` 与 `undefined` 都 → `full-access`（默认值分支）', () => {
    expect(canonicalPermissionMode('full')).toBe('full-access');
    // ⚠️ 默认值分支：设置里没这个字段时**必须**是完全访问。
    //    反过来的话，老用户升级后全部工具都会开始弹审批框 —— 那是灾难性的回归。
    expect(canonicalPermissionMode(undefined)).toBe('full-access');
  });
});

// ─────────────────────────────────────────────────────────────
// SDK permissionMode（原版 jh() 的等价物）
// ─────────────────────────────────────────────────────────────

describe('sdkPermissionModeFor —— 等价原版 jh() @669203', () => {
  it('`approval` → `default`（**这是本轮修的核心**）', () => {
    // 改造前这一行是硬编码 `'bypassPermissions'`，所以选择器切了没反应。
    expect(sdkPermissionModeFor('approval')).toBe('default');
    expect(sdkPermissionModeFor('approval')).not.toBe('bypassPermissions');
  });

  it('`full` → `bypassPermissions`（完全访问 = 全自动放行，原行为不变）', () => {
    expect(sdkPermissionModeFor('full')).toBe('bypassPermissions');
  });

  it('**默认值分支**：`undefined` → `bypassPermissions`（不是 `default`）', () => {
    // 本项目栽过"默认值坏了、只测非默认路径就误判成功能正常"。
    // 这条与上一条的"approval → default"是**成对**的：一个证明切了有效果，
    // 一个证明没设置时行为不变。
    expect(sdkPermissionModeFor(undefined)).toBe('bypassPermissions');
    expect(sdkPermissionModeFor(undefined)).not.toBe('default');
  });

  it('plan **优先于**权限：三种权限值在 plan 下都得 `plan`', () => {
    // ⚠️ 顺序不能换（原版 jh 的三元里 plan 是第一个分支）。
    //    写成权限优先的话，"plan + 完全访问" 会得 bypassPermissions，plan 当场失效。
    expect(sdkPermissionModeFor('full', 'plan')).toBe('plan');
    expect(sdkPermissionModeFor('approval', 'plan')).toBe('plan');
    expect(sdkPermissionModeFor(undefined, 'plan')).toBe('plan');
  });

  it('反恒真：plan 确实**压过**权限值（两种权限在 plan 下结果相同，且与不带 plan 时不同）', () => {
    // 若实现是"恒返回某个值"，这两条会同时成立 —— 所以必须一起断言。
    expect(sdkPermissionModeFor('approval', 'plan')).toBe(sdkPermissionModeFor('full', 'plan'));
    expect(sdkPermissionModeFor('approval', 'plan')).not.toBe(sdkPermissionModeFor('approval'));
    expect(sdkPermissionModeFor('full', 'plan')).not.toBe(sdkPermissionModeFor('full'));
  });

  it('反恒真：值域穷举 —— 不是"永远返回同一个值"', () => {
    const domain: Array<AppPermissionMode | undefined> = ['full', 'approval', undefined];
    const got = domain.map((m) => sdkPermissionModeFor(m));

    expect(got).toEqual(['bypassPermissions', 'default', 'bypassPermissions']);
    expect(new Set(got).size).toBe(2); // 至少两个不同结果 ⇒ 不是恒等函数
  });
});

// ─────────────────────────────────────────────────────────────
// requestKind / detail（逐字照抄原版 Oh / Dh）
// ─────────────────────────────────────────────────────────────

describe('approvalKindOf —— 逐字等价原版 Oh() @675592', () => {
  it('Read / Glob / Grep → `file-read`', () => {
    for (const t of ['Read', 'Glob', 'Grep']) expect(approvalKindOf(t)).toBe('file-read');
  });

  it('Edit / Write / NotebookEdit → `file-change`', () => {
    for (const t of ['Edit', 'Write', 'NotebookEdit']) expect(approvalKindOf(t)).toBe('file-change');
  });

  it('Bash → `command`（**不是只读、也不是文件修改**）', () => {
    expect(approvalKindOf('Bash')).toBe('command');
    // 反恒真：Bash 若被判成 file-read，它就会落进只读白名单被静默放行。
    expect(approvalKindOf('Bash')).not.toBe('file-read');
  });

  it('`MultiEdit` → `command`：**原版 quirk，照抄不改**', () => {
    // 原版 `Oh` 的 file-change 分支里没有 MultiEdit（虽然原版另一处的 `Mh`
    // 集合里有它）。这是原版自身的不一致；这里照抄，改成"更合理"会让
    // 同一份行为在原版与复刻里对不上。真要修应当单开一条并在原版侧确认。
    expect(approvalKindOf('MultiEdit')).toBe('command');
  });

  it('未知工具 → `command`（兜底询问，不是静默放行）', () => {
    expect(approvalKindOf('SomeFutureTool')).toBe('command');
  });
});

describe('approvalDetailOf —— 逐字等价原版 Dh() @675812', () => {
  it('形状是 `工具名: <JSON>`', () => {
    expect(approvalDetailOf('Bash', { command: 'ls' })).toBe('Bash: {"command":"ls"}');
  });

  it('超长输入截断到 400 字符 + `…`（0x190）', () => {
    const detail = approvalDetailOf('Bash', { command: 'x'.repeat(1000) });
    // 400 个原文 + 1 个省略号
    expect(detail).toHaveLength(401);
    expect(detail.endsWith('…')).toBe(true);
    expect(detail.slice(0, 6)).toBe('Bash: ');
  });

  it('边界：总长 400 **不截**、401 才截（不是"≥400 就截"）', () => {
    const prefix = 'Bash: ';
    // `JSON.stringify('y'.repeat(n))` 的长度 = n + 2（首尾一对引号；无转义字符）
    const jsonLenOf = (n: number): number => JSON.stringify('y'.repeat(n)).length;

    // 让 `工具名 + ': ' + JSON` 正好 400 → 不加省略号
    const exact = 400 - prefix.length - 2;
    const noCut = approvalDetailOf('Bash', 'y'.repeat(exact));
    expect(prefix.length + jsonLenOf(exact)).toBe(400);
    expect(noCut).toHaveLength(400);
    expect(noCut.endsWith('…')).toBe(false);

    // 再多一个字符 → 截到前 400 后补 `…`（所以总长 401，最后一个字符是省略号）
    const raw = prefix + JSON.stringify('y'.repeat(exact + 1));
    const over = approvalDetailOf('Bash', 'y'.repeat(exact + 1));
    expect(raw).toHaveLength(401);
    expect(over).toHaveLength(401);
    expect(over.endsWith('…')).toBe(true);
    // 截的是**原文**：前 400 个字符就是原串的前 400 个，只把尾巴换成省略号
    expect(over).toBe(`${raw.slice(0, 400)}…`);
    // 反向对照：上面那条若写成 `over.slice(0,400) === noCut` 是错的 ——
    // 两个输入的内容本身不同（一个 393 个 y、一个 394 个），
    // 拿"截断结果的前缀"跟另一个输入的结果比，比的是两回事。
  });

  it('`JSON.stringify` 会抛的输入（循环引用 / BigInt）→ 不抛，回落到 String()', () => {
    // 这里若无 try/catch，一个畸形 input 会把整条审批链抛穿 ——
    // 用户看到的不是审批框，而是"卡死"。
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    expect(() => approvalDetailOf('Bash', cyclic)).not.toThrow();
    expect(approvalDetailOf('Bash', cyclic)).toContain('Bash:');

    expect(() => approvalDetailOf('Bash', { n: BigInt(1) })).not.toThrow();
    expect(approvalDetailOf('Bash', { n: BigInt(1) })).toContain('Bash:');
  });
});

// ─────────────────────────────────────────────────────────────
// 权限门（canUseTool 的 if 链判定）
// ─────────────────────────────────────────────────────────────

describe('gateStepFor —— 等价原版 buildCanUseTool() @771414 的 if 链', () => {
  const none: ReadonlySet<string> = new Set<string>();

  it('完全访问：连 Bash 都放行（不是"危险工具就拦"）', () => {
    expect(gateStepFor('full-access', 'Bash', none)).toBe('full-access');
    expect(gateStepFor('full-access', 'Write', none)).toBe('full-access');
  });

  it('需要批准 + 内置只读工具（Read/Glob/Grep）→ **仍然发审批**（反向对照）', () => {
    // ⚠️ 这是我第一版写反的地方，专门留一条反向对照钉住。
    // 原版白名单 `Fp` @756802 里**没有任何内置工具**（只有 10 个 MCP 名），
    // 所以"读文件"在原版里**是会弹框的** —— 渲染层那条 promptFileRead 文案
    // 与 `Oh` 的 'file-read' 一一对应，若 Read 免审批这条文案就永远不可能出现。
    // 写成 'readonly'（放行）= 比原版更宽松，而审批门错的方向不能是"更宽松"。
    for (const t of ['Read', 'Glob', 'Grep']) {
      expect(gateStepFor('approval-required', t, none)).toBe('approval');
    }
  });

  it('需要批准 + 原版白名单里的 MCP 只读工具 → 放行', () => {
    for (const t of [...READONLY_TOOLS]) {
      expect(gateStepFor('approval-required', t, none)).toBe('readonly');
    }
    // 再具体点名两个：防"集合被清空 ⇒ 上面的循环零次执行 ⇒ 恒真通过"
    expect(gateStepFor('approval-required', 'mcp__mathmodel__get_settings', none)).toBe('readonly');
    expect(gateStepFor('approval-required', 'mcp__mathmodel-browser__browser_snapshot', none)).toBe(
      'readonly',
    );
  });

  it('需要批准 + 本次会话已允许 → 放行', () => {
    expect(gateStepFor('approval-required', 'Bash', new Set(['Bash']))).toBe('session-allowed');
  });

  it('需要批准 + Bash → **发审批**（这是本轮修的另一半）', () => {
    // 改造前 canUseTool 是"除 AskUserQuestion 外一律 allow" ⇒ 这里会放行。
    expect(gateStepFor('approval-required', 'Bash', none)).toBe('approval');
  });

  it('需要批准 + 未知工具 → 发审批（兜底询问，不是放行）', () => {
    expect(gateStepFor('approval-required', 'SomeFutureTool', none)).toBe('approval');
  });

  it('反恒真：同一个工具在两种权限值下结果**必须不同**', () => {
    for (const tool of ['Bash', 'Write', 'Edit', 'SomeFutureTool']) {
      expect(gateStepFor('full-access', tool, none)).not.toBe(
        gateStepFor('approval-required', tool, none),
      );
    }
    expect(gateStepFor('full-access', 'Bash', none)).toBe('full-access');
    expect(gateStepFor('approval-required', 'Bash', none)).toBe('approval');
  });

  it('只读白名单 = 原版那 10 个 MCP 名（逐字对照 Ju + _u）', () => {
    // 原版 @638492：Ju = 6 个 mcp__mathmodel__*；@622345：_u = 4 个 mcp__mathmodel-browser__*
    // 原版 10 个逐字保留；复刻侧新增 browser_wait（内置浏览器等待轮询，无副作用只读）。
    // 2026-09-26：内置 MCP 已真实注册（builtin-mcp.ts / browser-tools.ts），白名单实际生效。
    expect([...READONLY_TOOLS].sort()).toEqual([
      'mcp__mathmodel-browser__browser_logs',
      'mcp__mathmodel-browser__browser_screenshot',
      'mcp__mathmodel-browser__browser_snapshot',
      'mcp__mathmodel-browser__browser_status',
      'mcp__mathmodel-browser__browser_wait',
      'mcp__mathmodel__check_environment',
      'mcp__mathmodel__get_settings',
      'mcp__mathmodel__list_automations',
      'mcp__mathmodel__list_keybindings',
      'mcp__mathmodel__list_projects',
      'mcp__mathmodel__list_skills',
    ]);
    expect(READONLY_TOOLS.size).toBe(11);
  });

  it('反向对照：**任何内置工具都不在白名单里**（最易错的是 Read/Glob/Grep）', () => {
    // `Read`/`Glob`/`Grep` 是 `Oh` 判 'file-read' 的三个，最容易被误读成
    // "只读 ⇒ 免审批"。它们其实走审批（见上一条）。TodoWrite/TaskCreate/TaskUpdate
    // 同理：`Oh` 函数体里根本没有它们的分支，落 else → 与 Bash 同类的 'command'。
    for (const t of [
      'Read',
      'Glob',
      'Grep',
      'Bash',
      'Write',
      'Edit',
      'MultiEdit',
      'NotebookEdit',
      'Task',
      'WebFetch',
      'WebSearch',
      'TodoWrite',
      'TaskCreate',
      'TaskUpdate',
    ]) {
      expect(READONLY_TOOLS.has(t)).toBe(false);
    }
  });

  it('会话已允许**不会**绕过只读判定之外的东西 —— 未记忆的工具仍然要问', () => {
    const allowed = new Set(['Bash']);
    expect(gateStepFor('approval-required', 'Bash', allowed)).toBe('session-allowed');
    // 没记忆过的 Write 仍然问
    expect(gateStepFor('approval-required', 'Write', allowed)).toBe('approval');
    // ⚠️ 反向对照（这条才是"Read 不在白名单"的判据）：
    //    · 用户没点过「始终允许」⇒ 每次都要问
    expect(gateStepFor('approval-required', 'Read', new Set())).toBe('approval');
    //    · 用户显式点过「始终允许」⇒ 走 session-allowed
    //      若误把 Read 加回白名单，这里会变成 'readonly' ⇒ 这条断言会红。
    expect(gateStepFor('approval-required', 'Read', new Set(['Read']))).toBe('session-allowed');
  });

  it('顺序：只读判定排在 session-allowed **之前**（原版 if 链同序）', () => {
    // 用一个真的在白名单里的工具来测这个顺序 —— 它同时也在 session-allowed 里，
    // 但必须先命中 readonly（若两分支顺序写反，结果同样是 'readonly' 也是放行，
    // 所以这条的真正价值是**钉住分支存在且可达**；'Read' 那条则钉住它不该被放行）。
    const both = new Set(['mcp__mathmodel__get_settings']);
    expect(gateStepFor('approval-required', 'mcp__mathmodel__get_settings', both)).toBe('readonly');
  });

  it('完全访问 + 空白名单：不因为"没记忆过"就去问', () => {
    // 顺序判据：full-access 分支在原版里排在 readonly / session-allowed **之前**，
    // 所以它必须能直接放行任意工具。
    expect(gateStepFor('full-access', 'AnythingAtAll', new Set())).toBe('full-access');
  });
});

// ─────────────────────────────────────────────────────────────
// 结构级判据 —— 钉住「顺序」这个纯函数管不到的东西
// ─────────────────────────────────────────────────────────────

describe('结构级判据 —— agent/session.ts 里的顺序与"别跟着改"的东西', () => {
  const SRC = readFileSync(join(process.cwd(), 'src', 'main', 'agent', 'session.ts'), 'utf8');

  it('`AskUserQuestion` 的判定排在权限门**之前**（否则会先问"能不能问你问题"）', () => {
    const askAt = SRC.indexOf("toolName === 'AskUserQuestion'");
    const gateAt = SRC.indexOf('gateStepFor(');

    expect(askAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    expect(askAt).toBeLessThan(gateAt);
  });

  it('权限门排在"发审批请求"之前（先放行再问，顺序反了会把放行分支饿死）', () => {
    // B2（2026-09-26）：② 位 ExitPlanMode 走 requestApproval，合法地出现在权限门之前；
    // 这里钉的是 ③~⑥ 的关系 —— gateStepFor（③④⑤ 判定）必须在⑥ 兜底审批之前。
    const gateAt = SRC.indexOf('gateStepFor(');
    const planAt = SRC.indexOf("toolName === 'ExitPlanMode'");
    const approvalAt = SRC.lastIndexOf('this.requestApproval(');
    expect(gateAt).toBeGreaterThan(-1);
    expect(planAt).toBeGreaterThan(-1);
    expect(planAt).toBeLessThan(gateAt);
    expect(approvalAt).toBeGreaterThan(gateAt);
  });

  it('`permissionMode` 是**算出来的**，不再是硬编码的 `bypassPermissions`', () => {
    expect(SRC).toContain('permissionMode: sdkMode');
    // 反向对照：硬编码那行必须消失（它曾经让选择器变成装饰品）
    expect(SRC).not.toContain("permissionMode: 'bypassPermissions',");
  });

  it('`allowDangerouslySkipPermissions: true` **无条件保留**（plan 下也是 true）', () => {
    // 原版 @668260 同对象里它也是无条件的。拦不拦工具是 permissionMode 的事，
    // 这个开关只管"允不允许用 bypassPermissions 这个模式本身"。
    expect(SRC).toContain('allowDangerouslySkipPermissions: true');
    // 它不得被写成依赖任何变量的形式
    expect(SRC).not.toMatch(/allowDangerouslySkipPermissions:\s*(opts|canonical|sdkMode)/);
  });

  it('`abort()` 里审批与提问**都**被松开，且都在 abort 之前', () => {
    const abortStart = SRC.indexOf('  abort(): void {');
    const abortEnd = SRC.indexOf('  answerUserQuestion(', abortStart);
    const abortBody = SRC.slice(abortStart, abortEnd);
    const qAt = abortBody.indexOf('settleAllQuestions(null)');
    const aAt = abortBody.indexOf("settleAllApprovals('cancel')");
    const ctrlAt = abortBody.indexOf('this.abortController?.abort()');

    expect(qAt).toBeGreaterThan(-1);
    expect(aAt).toBeGreaterThan(-1);
    expect(ctrlAt).toBeGreaterThan(-1);
    expect(qAt).toBeLessThan(ctrlAt);
    expect(aAt).toBeLessThan(ctrlAt);
  });

  it('审批被 abort 松开时给的是 `cancel`（中断本轮），不是 `decline`', () => {
    expect(SRC).toContain("this.settleAllApprovals('cancel')");
    expect(SRC).not.toContain("this.settleAllApprovals('decline')");
  });

  it('canUseTool 的第三个参数（signal / suggestions）被转发进来', () => {
    // 少了 signal ⇒ SDK 取消时挂着的审批永不 resolve；
    // 少了 suggestions ⇒「本次会话始终允许」拿不到 updatedPermissions。
    expect(SRC).toContain('ctx?: CanUseToolContext');
    expect(SRC).toContain('this.canUseTool(toolName, input, ctx ?? {})');
    expect(SRC).toContain('ctx.signal?.addEventListener');
    expect(SRC).toContain('updatedPermissions: ctx.suggestions');
  });

  it('`ipc/session.ts` 把设置里的 permissionMode 真的传给了 RunOptions', () => {
    // 只做"判定对了"没用 —— 设置值必须真的一路传到 agent 侧。
    // （`settings.permissionMode` 之前**零主进程读取点**，这才是装饰品的根因。）
    const IPC_SRC = readFileSync(join(process.cwd(), 'src', 'main', 'ipc', 'session.ts'), 'utf8');
    expect(IPC_SRC).toContain('permissionMode: settings.permissionMode');
  });

  it('`buildCanUseTool` 的四个决定与审批框的四个按钮对齐', () => {
    // 主进程 switch 的三个具名分支 + 兜底 default
    expect(SRC).toContain("case 'accept'");
    expect(SRC).toContain("case 'acceptForSession'");
    expect(SRC).toContain("case 'cancel'");
  });
});
