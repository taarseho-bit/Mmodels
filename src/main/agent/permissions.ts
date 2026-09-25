/**
 * 权限模式 —— 把「完全访问 / 需要批准」从**装饰品**变成**真生效**。
 *
 * ⚠️ 这个文件是**纯逻辑**（不 import SDK、不 import electron、不碰 fs），
 *    目的是让"切了模式到底会不会改变判定"可以用单测钉死。真跑 CLI 的那半边在
 *    `agent/session.ts`。两者共享的唯一真源就是这里的几个函数。
 *
 * ⚠️ **本文件用到的"原版逐字代码片段"已集中搬出到
 *    `.workbuddy/ui-audit/verify/original-code-dumps.md §1`** ——
 *    不是嫌它长，是**它会污染搜索与计数**：`grep -c` 会把注释里的原文一起数上，
 *    给出一个**看起来像样的错数字**（真实事故：期望 10、实跑 15；
 *    机制与规则见 `WRITE-RULES.md §8`）。
 *    本文件**只留结论与"容易错在哪"**，要核原文请去那个参照文件。
 *    `permissions.test.ts` 有一条结构级断言盯着"源码里不许再有成段原版代码引用"。
 *
 * ────────────────────────────────────────────────────────────────
 * 一、口径映射（**只在这里映射一次**）
 * ────────────────────────────────────────────────────────────────
 * 原版与复刻的**设置值域名字不同**，这是这条链最容易错的地方：
 *
 *   原版（@377716 的 zod / @379136 的默认值对象，两处一致）：
 *     值域是 `full-access` 与 `approval-required` 两个，默认 `full-access`。
 *   复刻（`shared/types.ts:276` / `store/config.ts:46` / `Composer.tsx:34`）：
 *     `permissionMode?: 'full' | 'approval'`，默认 `'full'`。
 *
 * 原版那个算 SDK 值的函数（@669203，原文见参照文件 §1.2）**只认字面量 `'approval-required'`**：
 *   → 若把复刻的 `'approval'` 直接透进去，会 **fallthrough 到 `bypassPermissions`**，
 *     也就是"用户切到需要批准，实际仍然全放行" —— **静默失效**，正是本轮要修的 bug。
 *
 * ⇒ 所以统一先经 `canonicalPermissionMode()` 换成原版口径，再由它派生两处消费：
 *      · SDK 的 `permissionMode`（`sdkPermissionModeFor()`）
 *      · `canUseTool` 门内比的 `'full-access'`（`gateStepFor()`）
 *   **不许两处各写一半** —— 那样迟早有一处漏改。
 *
 * ────────────────────────────────────────────────────────────────
 * 二、两处消费用的**不是同一个值**（这点很反直觉，但原版就是这样）
 * ────────────────────────────────────────────────────────────────
 *   原版给 SDK 的（@668260）：`permissionMode` 取的是上面那个函数的**结果**
 *                              → `'plan' | 'default' | 'bypassPermissions'`
 *   原版门内比的（@771414）：**app 级口径**的 `permissionMode` ——
 *                              原版写的是"与字面量 `'full-access'` 相等才全放行"
 *                              → `'full-access' | 'approval-required'`
 *
 * 后果：**plan 模式下，门内仍然按 app 级权限值判定**。若用户在 plan 模式下选了
 * 「完全访问」，门内照样全放行 —— plan 的"不许写"是 SDK 的 plan 档在 CLI 侧拦的，
 * **不是**这个回调拦的。
 *
 * ⚠️ 所以**不要**把 `sdkPermissionModeFor()` 的结果喂给 `gateStepFor()`
 *    （会得到一个恒等于 `'approval'` 或者错判的门）。两者都从 `canonicalPermissionMode()` 出发。
 *
 * ⚠️ 顺带钉死一个**别跟着权限档改**的东西：原版给 SDK 的那个对象里，
 *    `allowDangerouslySkipPermissions` 是**无条件 `true`**（@668260，原文见参照文件 §1.3），
 *    **与权限档无关**（连 plan 模式下也是 `true`）。它管的是"允许不允许用
 *    `bypassPermissions` 这个模式本身"，**不是**"跳不跳工具门"。
 *    `permissions.test.ts` 有结构级断言钉住它不被改成引用变量。
 *
 * ────────────────────────────────────────────────────────────────
 * 三、只读白名单是什么（**第一版我写错了，错因留在下面**）
 * ────────────────────────────────────────────────────────────────
 * 原版把**两个常量集合**合起来，当 `readonlyTools` 传进工具门的 ctx（@756802 定义、
 * @771399 消费，全仓库只有这一处消费）。两个来源集合的真身（@638492 / @622345）
 * **都是 MCP 工具名**，一共 **10 个**（6 个内置 `mathmodel` 服务器
 * + 4 个内置浏览器服务器）。原文见参照文件 §1.4。
 *
 * ⇒ **原版白名单里一个内置工具都没有**。也就是说原版在"需要批准"模式下，
 *   `Read` / `Glob` / `Grep` **同样会弹审批框**。
 *
 * ⚠️ **我第一版写错在哪（记住这个错，它很容易再犯）**：先前那两个来源集合定位不到，
 *    我就退而拿 `Oh` 判为 `file-read` 的 `Read`/`Glob`/`Grep` 当白名单 ——
 *    **那是把 `Oh`（给审批请求打标签的函数）当成了白名单**。两者回答的不是同一个问题：
 *      · `Oh` → "**真要弹框的话，弹成哪一类**"（`requestKind`）
 *      · 白名单 → "**哪些工具压根不用弹框**"
 *    反证很直接：渲染层三条现成文案
 *    `composerPendingApprovalPanel.promptFileRead / promptFileChange / promptCommand`
 *    与 `Oh` 的三个返回值**一一对应**（`zh.ts:741-754`）。若 `Read` 真免审批，
 *    `promptFileRead` 就永远不可能出现；它存在，正说明**读文件也会弹框**。
 *
 * ⇒ 修前那把三个内置工具与原版清单是**零交集**（既不是子集也不是超集）：
 *   等于在"需要批准"模式下**静默放行了原版会弹框的每一次读文件**。
 *   对一个审批门来说，**错的方向是"更宽松"**，必须纠正成原版清单。
 *
 * ⚠️ 状态更新（2026-09-26）：复刻侧**已经内置注册** `mcp__mathmodel`（15 工具，
 *   `agent/builtin-mcp.ts`）与 `mcp__mathmodel-browser`（12 工具，`agent/browser-tools.ts`），
 *   下面这批只读名字**全部真实存在**，白名单在"需要批准"模式下实际生效。
 *   原先"复刻侧不注册内置 MCP、白名约等于空集"的说明已过时。
 *   ⚠️ 另注：`settings.builtinMcpEnabled` 在 `session.ts` 里**只有接口声明、没有读取点**
 *   （与 `notifyEnabled` 同类的"假开关"），这条不在本轮范围内，已另行上报。
 */

/** 复刻侧的设置值域（写进 `settings.permissionMode`） */
export type AppPermissionMode = 'full' | 'approval';

/** **原版侧**的设置值域 —— 所有判定都在这个口径上做 */
export type CanonicalPermissionMode = 'full-access' | 'approval-required';

/** 每条消息的交互模式（B2/plan 用；本文件只负责"它优先于权限"这个顺序） */
export type InteractionMode = 'default' | 'plan';

/** 最终交给 SDK `options.permissionMode` 的值（`sdk.d.ts:2145` 的 `PermissionMode` 子集） */
export type SdkPermissionMode = 'default' | 'plan' | 'bypassPermissions';

/** 原版审批类别分类函数的值域，对应渲染层的三条 prompt 文案（`zh.ts:741-754`） */
export type ApprovalKind = 'command' | 'file-read' | 'file-change';

/** 原版工具门里 `switch(decision)` 的四个分支（原版 `case` 字面量） */
export type ApprovalDecision = 'accept' | 'acceptForSession' | 'cancel' | 'decline';

/**
 * 复刻口径 → 原版口径。**唯一的映射点。**
 *
 * 注意 `'approval'` 之外的一切（含 `undefined`＝设置里没这个字段）都算 `'full-access'`：
 * 这与原版"不等于 `approval-required` 就走 `bypassPermissions`"的语义一致，
 * 也保证**老用户的库/配置升级后行为不变**（默认仍是完全访问）。
 */
export function canonicalPermissionMode(
  app: AppPermissionMode | undefined,
): CanonicalPermissionMode {
  return app === 'approval' ? 'approval-required' : 'full-access';
}

/**
 * 交给 SDK 的 `permissionMode` —— **逐字等价原版那个三态函数**（@669203）。
 * 原文见参照文件 §1.2；这里只留**顺序**这条最容易改错的东西：
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
 * 只读工具白名单 —— **逐字照抄原版那两个来源集合的并集**（见文件头"三"，原文见参照文件 §1.4）。
 *
 * ⚠️ 这 10 个全是 **MCP 工具名**，**没有任何内置工具**。也就是说原版在
 *    "需要批准"模式下，`Read` / `Glob` / `Grep` **同样会弹审批框**
 *    （渲染层 `promptFileRead` 那条文案就是给它们用的）。
 *    `Bash` 更不在里面（落分类函数的 else → `'command'`）——
 *    数学建模任务里 Bash 能写文件、能联网，绝不能因为"看起来只是跑个命令"就免审批。
 */
export const READONLY_TOOLS: ReadonlySet<string> = new Set([
  // 来源一（@638492）：内置 mathmodel MCP 服务器的只读工具
  'mcp__mathmodel__get_settings',
  'mcp__mathmodel__list_keybindings',
  'mcp__mathmodel__list_automations',
  'mcp__mathmodel__check_environment',
  'mcp__mathmodel__list_skills',
  'mcp__mathmodel__list_projects',
  // 来源二（@622345）：内置浏览器 MCP 服务器的只读工具
  'mcp__mathmodel-browser__browser_status',
  'mcp__mathmodel-browser__browser_snapshot',
  'mcp__mathmodel-browser__browser_screenshot',
  'mcp__mathmodel-browser__browser_logs',
  'mcp__mathmodel-browser__browser_wait',
]);

/**
 * 工具名 → 审批类别（**给审批请求打标签**）。**逐字等价原版分类函数**（@675592，原文见参照文件 §1.5）。
 *
 * ⚠️ **它的全部返回值只有 3 个**（`'file-read' | 'file-change' | 'command'`），
 *    函数体里**没有任何 `TodoWrite` / `TaskCreate` / `TaskUpdate` 的分支** ——
 *    它们落 else，与 `Bash` 同归 `'command'`。所以原版**没有**把这些任务面板类工具
 *    当成无害类 ⇒ 它们在"需要批准"模式下**照弹**，这不是复刻偏离。
 *
 * ⚠️⚠️ **这个函数不是白名单，别拿它当白名单用**（我在第一版就是这么错的，见文件头"三"）：
 *    它回答的是"**真要弹框的话，弹成哪一类**"，不是"哪些工具不用弹框"。
 *    `Read`/`Glob`/`Grep` 被判成 `'file-read'`，恰恰说明它们**会**弹框。
 *
 * ⚠️ 原版**没有**把 `MultiEdit` 算进 `'file-change'`（虽然原版另一处"允许工具名集合"
 *    @391775 里有 `MultiEdit`）—— 这是原版自身的不一致。这里**照抄不改**：
 *    改成"更合理"会让同一份行为在原版与复刻里对不上，而这条链的价值就在于对得上。
 *    真要修，应该单开一条并在原版侧确认，而不是在这里顺手修。
 */
export function approvalKindOf(toolName: string): ApprovalKind {
  if (toolName === 'ExitPlanMode') return 'plan';
  if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') return 'file-read';
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit') {
    return 'file-change';
  }
  return 'command';
}

/** 原版审批细节串的截断长度：`0x190` = 400（原文见参照文件 §1.6） */
const DETAIL_MAX = 0x190;

/**
 * 审批弹窗里的细节串（"让用户看见到底要批准什么"）。**逐字等价原版那个函数**
 * （@675812，原文见参照文件 §1.6）。这里只留**为什么要留 try/catch**：
 *
 * `JSON.stringify` 会抛的场景是**真存在的**（循环引用、BigInt）—— 原版有 try/catch，
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
 * 顺序**逐字对应原版工具门的 if 链**（@771414，原文见参照文件 §1.7），其中 ③④⑤ 是本函数的三个分支：
 *   ① `AskUserQuestion` → 弹提问框
 *   ② `ExitPlanMode` → 捕获计划并拒绝（复刻没有 plan 模式，B2 再接）
 *   ③ 完全访问 → 全放行
 *   ④ 只读白名单 → 放行
 *   ⑤ 本次会话已允许 → 放行
 *   ⑥ 其余 → 发审批请求并等待
 */
export type GateStep = 'full-access' | 'readonly' | 'session-allowed' | 'approval';

/**
 * 算出该走哪一步。
 *
 * @param canonical **原版口径**的权限值。⚠️ 不要传 `sdkPermissionModeFor()` 的结果
 *                  （那是给 SDK 的，见文件头"二"）。
 * @param sessionAllowed 本次会话内用户点过「始终允许」的工具名集合
 *                       （原版按 sessionId 分组存，复刻用单会话集合）
 */
export function gateStepFor(
  canonical: CanonicalPermissionMode,
  toolName: string,
  sessionAllowed: ReadonlySet<string>,
): GateStep {
  // ③ 完全访问：全放行（原版此处写的是与字面量 `'full-access'` 相等则放行）
  if (canonical === 'full-access') return 'full-access';
  // ④ 只读白名单
  if (READONLY_TOOLS.has(toolName)) return 'readonly';
  // ⑤ 本次会话已允许
  if (sessionAllowed.has(toolName)) return 'session-allowed';
  // ⑥ 其余——发审批请求
  return 'approval';
}
