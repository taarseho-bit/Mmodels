/**
 * 流事件 → 待落库的 `ContentBlock[]` —— 从 `ipc/session.ts` 的事件回调里抽出来的**纯逻辑**。
 *
 * ## 为什么要抽出来
 *
 * 这段逻辑原来内联在 `ipc/session.ts` 的 `runner.on('event', …)` 里，于是：
 *   · **无法单测**（那个回调在 IPC handler 内部，要跑它就得拉起 electron + 真 SDK）；
 *   · 所以里面的 bug 只能靠运行测试发现 —— 而这里**真的漏过一个字段**：
 *     `tool-result` 只写了 `toolResult`，把 `ev.isError` 丢了，
 *     于是失败的 Bash / Write 在界面上和成功的长得一模一样（见本文件 `applyStreamEvent` 的注释）。
 *
 * 抽成纯函数后，"`isError` 到底有没有传到块里"变成一条能跑的单测，
 * 而不是一条只能靠肉眼在界面上比对的期望。
 *
 * ⚠️ 只搬逻辑、不改语义：`collected` 是**调用方传入的同一数组引用**，
 *    text / thinking 按 `ev.index` **写下标**（不是 push），tool_use 才是 push ——
 *    这个不对称是原实现就有的（`block-start` 先占位、delta 再累加），照搬。
 */
import type { ContentBlock, StreamEvent } from '@shared/types';

/**
 * 把一个流事件累加进 `collected`。
 *
 * 只处理"要落库的内容"，其余事件（`usage` / `message-stop` / `session-*` …）是纯通知，
 * 到这里是 no-op。
 */
export function applyStreamEvent(collected: ContentBlock[], ev: StreamEvent): void {
  if (ev.type === 'block-start') {
    if (ev.kind === 'text' || ev.kind === 'thinking') {
      collected[ev.index] = { kind: ev.kind, text: '' };
    }
    return;
  }

  if (ev.type === 'text-delta' || ev.type === 'thinking-delta') {
    const block = collected[ev.index];
    if (block) block.text = (block.text ?? '') + ev.delta;
    return;
  }

  if (ev.type === 'tool-use') {
    collected.push({
      kind: 'tool_use',
      toolName: ev.toolName,
      toolUseId: ev.toolUseId,
      toolInput: ev.input,
    });
    return;
  }

  if (ev.type === 'tool-result') {
    // 找到对应的 tool_use，补上结果
    const target = collected.find((b) => b.kind === 'tool_use' && b.toolUseId === ev.toolUseId);
    if (!target) return;
    target.toolResult = ev.result;
    /**
     * 透传「这次工具调用失败了」。
     *
     * ⚠️ 这是修一个**本轮之前就存在**的折损，不是新功能：
     *   `StreamEvent`（`shared/types.ts:146`）与 `ContentBlock`（`:77`）**本来就有**
     *   `isError` 字段，agent 侧也一直在填（`agent/session.ts` 里
     *   `isError: Boolean(b.is_error)`），但这里组装落库块时**没往下写**
     *   ⇒ 渲染层与数据库里这个字段恒为 `undefined`，
     *     失败的 Bash/Write 在界面上和成功的长得一模一样。
     *   同一轮里把它补上（导出侧 `flattenToolResult` 也跟着带上，
     *   应用约定 `Vn` 的形状里本来就有 `isError`）。
     *
     * 用 `Boolean(...)` 而不是直接赋值：`ContentBlock.isError` 是 `boolean | undefined`，
     * 收紧成明确的 `true/false`，下游判 `if (block.isError)` 与 `=== true` 都成立。
     */
    target.isError = Boolean(ev.isError);
  }
}
