/**
 * 权限模式的纯逻辑层。
 *
 * 这里不依赖 SDK、Electron 或文件系统，只负责把设置值映射为运行时权限、
 * 归类审批请求，并判断一个工具能否直接执行。主进程负责接入，单元测试
 * 负责锁定边界，避免权限档位在不同入口出现不一致。
 */

/** 应用设置侧的值域（写进 `settings.permissionMode`） */
export type AppPermissionMode = 'full' | 'approval';

/** SDK 侧的标准设置值域 —— 所有判定都在这个口径上做 */
export type CanonicalPermissionMode = 'full-access' | 'approval-required';

/** 每条消息的交互模式（B2/plan 用；本文件只负责"它优先于权限"这个顺序） */
export type InteractionMode = 'default' | 'plan';

/** 最终交给 SDK `options.permissionMode` 的值（`sdk.d.ts:2145` 的 `PermissionMode` 子集） */
export type SdkPermissionMode = 'default' | 'plan' | 'bypassPermissions';

/** 审批类别分类函数的值域，对应渲染层的三条提示文案。 */
export type ApprovalKind = 'command' | 'file-read' | 'file-change' | 'plan';

/** 工具门里 `switch(decision)` 的四个分支。 */
export type ApprovalDecision = 'accept' | 'acceptForSession' | 'cancel' | 'decline';

/**
 * 应用设置口径 → 标准口径。**唯一的映射点。**
 *
 * 注意 `'approval'` 之外的一切（含 `undefined`＝设置里没这个字段）都算 `'full-access'`：
 * 这与 SDK "不等于 `approval-required` 就走 `bypassPermissions`"的语义一致，
 * 也保证**老用户的库/配置升级后行为不变**（默认仍是完全访问）。
 */
export function canonicalPermissionMode(
  app: AppPermissionMode | undefined,
): CanonicalPermissionMode {
  return app === 'approval' ? 'approval-required' : 'full-access';
}

/**
 * 交给 SDK 的 `permissionMode` —— 这里只保留**顺序**这条最容易改错的规则：
 *
 * ⚠️ **顺序不能换**：先判 `plan`，再判权限档。写成权限优先的话，
 *    "plan + 完全访问" 会得到 `bypassPermissions`，plan 模式当场失效。
 */
export function sdkPermissionModeFor(
  app: AppPermissionMode | undefined,
  interaction?: InteractionMode,
): SdkPermissionMode {
  if (interaction === 'plan') return 'plan';
  return canonicalPermissionMode(app) === 'approval-required' ? 'default' : 'bypassPermissions';
}

/**
 * 只读工具白名单 —— 两个内置工具集合的并集。
 *
 * ⚠️ 这些都是 **MCP 工具名**，不包含文件编辑工具。在
 *    "需要批准"模式下，`Read` / `Glob` / `Grep` **同样会弹审批框**
 *    （渲染层 `promptFileRead` 那条文案就是给它们用的）。
 *    `Bash` 更不在里面（落分类函数的 else → `'command'`）——
 *    数学建模任务里 Bash 能写文件、能联网，绝不能因为"看起来只是跑个命令"就免审批。
 */
export const READONLY_TOOLS: ReadonlySet<string> = new Set([
  // 来源一（）：内置 mathmodel MCP 服务器的只读工具
  'mcp__mathmodel__get_settings',
  'mcp__mathmodel__list_keybindings',
  'mcp__mathmodel__list_automations',
  'mcp__mathmodel__check_environment',
  'mcp__mathmodel__list_skills',
  'mcp__mathmodel__list_projects',
  // 来源二（）：内置浏览器 MCP 服务器的只读工具
  'mcp__mathmodel-browser__browser_status',
  'mcp__mathmodel-browser__browser_snapshot',
  'mcp__mathmodel-browser__browser_screenshot',
  'mcp__mathmodel-browser__browser_logs',
  'mcp__mathmodel-browser__browser_wait',
]);

/**
 * 工具名 → 审批类别（给审批请求打标签）。
 *
 * ⚠️ **它的全部返回值只有 3 个**（`'file-read' | 'file-change' | 'command'`），
 *    函数体里**没有任何 `TodoWrite` / `TaskCreate` / `TaskUpdate` 的分支** ——
 *    它们落 else，与 `Bash` 同归 `'command'`，在"需要批准"模式下会弹窗。
 *
 * ⚠️⚠️ **这个函数不是白名单，别拿它当白名单用**（我在第一版就是这么错的，见文件头"三"）：
 *    它回答的是"**真要弹框的话，弹成哪一类**"，不是"哪些工具不用弹框"。
 *    `Read`/`Glob`/`Grep` 被判成 `'file-read'`，恰恰说明它们**会**弹框。
 *
 * ⚠️ `MultiEdit` 目前按命令类处理，以免编辑操作绕过审批；如需改变策略，
 *    请同步更新分类函数和测试。
 */
export function approvalKindOf(toolName: string): ApprovalKind {
  if (toolName === 'ExitPlanMode') return 'plan';
  if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') return 'file-read';
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit') {
    return 'file-change';
  }
  return 'command';
}

/** 审批细节串的截断长度：`0x190` = 400。 */
const DETAIL_MAX = 0x190;

/**
 * 审批弹窗里的细节串（让用户看见到底要批准什么）。这里只留**为什么要留 try/catch**：
 *
 * `JSON.stringify` 会抛的场景是**真存在的**（循环引用、BigInt）—— 这里保留 try/catch，
 * 这里也保留，否则一个畸形 input 会把整条审批链抛穿、用户看到的是"卡死"。
 */
export function approvalDetailOf(toolName: string, input: unknown): string {
  // ExitPlanMode：detail 就是计划全文（不截断、不走 JSON 串）—— 用户要审的就是它
  if (toolName === 'ExitPlanMode' && input && typeof input === 'object' && typeof (input as Record<string, unknown>).plan === 'string') {
    return (input as Record<string, unknown>).plan as string;
  }
  let json: string;
  try {
    json = JSON.stringify(input);
  } catch {
    json = String(input);
  }
  const text = `${toolName}: ${json}`;
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}…` : text;
}

/**
 * `canUseTool` 走到哪一步 —— 判定结果本身，**与 SDK 解耦**，因此可以单测。
 *
 * ⚠️ 这里**故意不包含** `'ask-user-question'` 与 `'exit-plan-mode'` 两步：
 *    那两步的行为（弹提问框 / 捕获计划）与"放行还是问"不是一回事，实现在
 *    `agent/session.ts` 的 `canUseTool` 里、且**必须排在这个门之前**。
 *    因为本函数产出不了它们，枚举里留两个取不到的值只会让人以为"某个分支没测到"。
 *    顺序的钉死在 `canUseTool` 的注释里 + `permissions.test.ts` 的结构级断言里。
 *
 * 顺序按工具门的处理链排列，其中 ③④⑤ 是本函数的三个分支：
 *   ① `AskUserQuestion` → 弹提问框
 *   ② `ExitPlanMode` → 捕获计划并拒绝（当前实现没有 plan 模式，B2 再接）
 *   ③ 完全访问 → 全放行
 *   ④ 只读白名单 → 放行
 *   ⑤ 本次会话已允许 → 放行
 *   ⑥ 其余 → 发审批请求并等待
 */
export type GateStep = 'full-access' | 'readonly' | 'session-allowed' | 'approval';

/**
 * 算出该走哪一步。
 *
 * @param canonical **标准口径**的权限值。⚠️ 不要传 `sdkPermissionModeFor()` 的结果
 *                  （那是给 SDK 的，见文件头"二"）。
 * @param sessionAllowed 本次会话内用户点过「始终允许」的工具名集合
 *                       （系统按 sessionId 分组存，当前进程用单会话集合）
 */
export function gateStepFor(
  canonical: CanonicalPermissionMode,
  toolName: string,
  sessionAllowed: ReadonlySet<string>,
): GateStep {
  // ③ 完全访问：全放行
  if (canonical === 'full-access') return 'full-access';
  // ④ 只读白名单
  if (READONLY_TOOLS.has(toolName)) return 'readonly';
  // ⑤ 本次会话已允许
  if (sessionAllowed.has(toolName)) return 'session-allowed';
  // ⑥ 其余——发审批请求
  return 'approval';
}
