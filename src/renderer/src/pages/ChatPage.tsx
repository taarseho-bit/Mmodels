/**
 * 对话页 —— 应用的心脏。
 *
 * 数据流（与 main/ipc/session.ts 严格对应）：
 *   1. 用户回车 → session.send(sessionId, text)  （主进程立刻落库并返回）
 *   2. 主进程把 StreamEvent 推到 SESSION_STREAM
 *   3. 这里累积事件 → 实时渲染
 *   4. 流结束后 main 才把 assistant 消息落库；我们收到 session-end 后再拉一次历史做对账
 *
 * ⚠️ 为什么流式消息**不进 zustand store**：
 *   text-delta 一秒能来几十次。放进全局 store 会让 TopBar / Sidebar / StatusBar
 *   全部重渲染 —— 输入框会卡。所以流式状态用**组件内 useState**，
 *   而且刻意和「已落库的历史消息」分开存，避免两套数据打架。
 *
 * ⚠️ 但"不进 zustand" ≠ "活在组件里就完事"：组件一卸载/一换会话，state 就没了。
 *   所以过程块另有归属 —— `store/chat-stream.ts` 的**会话级槽位**（模块级 Map，
 *   组件之外）：切走写进槽位、切回 `snapshot()` 取回。组件内这份 state 只是
 *   当前会话的**渲染视图**（`toView` 派生），不是那份数据的家。
 *
 * ⚠️ 为什么收到 session-end 要重新拉历史：
 *   流式期间我们渲染的是「临时拼出来的消息」，它的 id 是 'streaming'。
 *   主进程落库后 id 会变。如果不重新拉，用户滚动到上方再切回来会看到重复消息。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ContentBlock, InflightTurn } from '@shared/types';
import { decideFollowUpAction, followUpHeadFor, readFollowUpBehavior, useApp } from '../store/app';
import { latestTaskBlocks } from '../store/tasks';
import {
  EMPTY_STREAM,
  chatStreamStore,
  panelTasks,
  toView,
  type StreamView,
} from '../store/chat-stream';
import { Composer } from '../components/Composer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TaskProgressPanel } from '../components/TaskProgress';
import { AgentCollaboration } from '../components/AgentCollaboration';
import { sessionTitleFromPrompt } from '../lib/session-title';
import { t, tx } from '../i18n';
import {
  forkErrorText,
  forkSuccessText,
  revertErrorText,
  revertSuccessText,
} from '../lib/session-ops';
import {
  notifyAgentQuestion,
  notifyApprovalNeeded,
  notifyTurnFinished,
  notificationsEnabledFromSettings,
  windowAttentive,
  type NotifyShowPayload,
  type TaskNotifyContext,
} from '../notifications/taskNotify';
import { Markdown } from '../components/Markdown';
import { Icon } from '../components/Icon';
import { buildDisplay, toolRowLabel, type ToolGroup } from '../lib/tool-row';
import {
  activityMessagesFor,
  friendlyGroupActivity,
  friendlyStreamError,
  friendlyToolActivity,
  localizeProcessNarration,
  localizeThinkingDetail,
  toolInputForDisplay,
} from '../lib/activity-copy';
import { registerCommand } from '../keybindings/dispatch';

/**
 * `session.get` 的**真实**返回。
 *
 * 主进程已经会挂上可选的 `inflight`（进行中那一轮的快照，见
 * `main/ipc/session.ts:440-453`）；preload 的类型声明还没跟上这一项
 * （那一半场另有人在改，本轮不许碰 `src/preload/**`），所以这里用交叉类型补上。
 *
 * 这样写的好处是**不会静默漂**：preload 落地后两边自动合并成同一个形状；
 * 万一它把这项声明成别的类型，tsc 会在用到 `res.inflight` 的地方直接报出来，
 * 而不是让渲染层悄悄读到一个不存在的字段。
 */
type SessionGetResult = Awaited<ReturnType<typeof window.mathmodel.session.get>> & {
  inflight?: InflightTurn;
};

// ─────────────────────────────────────────────────────────────
// 流式累积器
// ─────────────────────────────────────────────────────────────

/**
 * 过程块与任务面板数据现在活在 `store/chat-stream.ts` 的**会话级槽位**里
 * （模块级 Map，组件卸载也不丢）。这里不再自带 `applyEvent`/`EMPTY_STREAM`：
 *   切会话 → `chatStreamStore.snapshot(sid)` 原样恢复；
 *   收事件 → `chatStreamStore.receive(sid, ev, 当前会话)` 一律写入，只有当前会话同步进 state。
 */

// ─────────────────────────────────────────────────────────────
// 内容块渲染
// ─────────────────────────────────────────────────────────────

function ToolCard({
  block,
  label,
  streaming = false,
}: {
  block: ContentBlock;
  /** 预计算好的动作文案（折叠组展开时由 `ToolRow` 直接带来，省一次重算） */
  label?: string;
  streaming?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const inputText = useMemo(() => {
    try {
      return JSON.stringify(toolInputForDisplay(block.toolInput ?? {}), null, 2);
    } catch {
      return String(toolInputForDisplay(block.toolInput));
    }
  }, [block.toolInput]);

  const resultText = useMemo(() => {
    if (block.toolResult === undefined) return '';
    if (typeof block.toolResult === 'string') return block.toolResult;
    try {
      return JSON.stringify(block.toolResult, null, 2);
    } catch {
      return String(block.toolResult);
    }
  }, [block.toolResult]);

  /**
   * 行文案 = **动作**（「运行命令」/「读取 a.py」/「搜索网页 X」），不是工具名。
   * 映射表与兜底口径见 `lib/tool-row.ts`（未知工具落 `genericTool`，
   * 永远不回落到 `mcp__xxx__yyy` 这种内部标识符，也不会是空串）。
   */
  const title = label ?? toolRowLabel(block);
  const summary = friendlyToolActivity(block, streaming);

  return (
    <div className={`tool-card activity-line${block.isError ? ' activity-retrying' : ''}`}>
      <button type="button" className="tool-head activity-summary" onClick={() => setOpen((v) => !v)}>
        <span className="activity-dot" aria-hidden="true" />
        <span className="tool-name">{summary}</span>
        <span className="activity-detail-label">{open ? t('收起详情') : t('查看详情')}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={11} />
      </button>

      {open && (
        <div className="tool-body">
          <div className="activity-technical-title">{title}</div>
          <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>
            {t('操作内容')}
          </div>
          <pre style={preStyle}>{inputText}</pre>
          {resultText && (
            <>
              <div className="muted" style={{ fontSize: 10, margin: '8px 0 4px' }}>
                {t('处理结果')}
              </div>
              <pre style={{ ...preStyle, maxHeight: 240, overflow: 'auto' }}>
                {resultText.length > 6000 ? `${resultText.slice(0, 6000)}\n${t('…（已截断）')}` : resultText}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 连续多个工具 → 一个可展开的折叠组（「使用了 3 个工具」）。
 *
 * 展开后逐行渲染回完整的 `ToolCard`（不是只把标签列一遍）——
 * 折叠的意义是"别把过程铺满屏幕"，不是"把过程藏掉"。
 */
function ToolGroupCard({ group, streaming }: { group: ToolGroup; streaming: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-card tool-group activity-line">
      <button type="button" className="tool-head activity-summary" onClick={() => setOpen((v) => !v)}>
        <span className="activity-dot" aria-hidden="true" />
        <span className="tool-name">{friendlyGroupActivity(group.rows, streaming)}</span>
        <span className="activity-detail-label">{open ? t('收起详情') : t('查看详情')}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={11} />
      </button>
      {open && (
        <div className="tool-body">
          {group.rows.map((row) => (
            <ToolCard key={row.id} block={row.block} label={row.label} streaming={streaming} />
          ))}
        </div>
      )}
    </div>
  );
}

const preStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 10.5,
  lineHeight: 1.55,
  fontFamily: 'var(--font-mono)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  color: 'var(--fg-secondary)',
};

function ThinkingBlock({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const detail = localizeThinkingDetail(text);
  return (
    <div className="thinking-block activity-line">
      <button type="button" className="thinking-head activity-summary" onClick={() => setOpen((v) => !v)}>
        <span className="activity-dot" aria-hidden="true" />
        <span>{t('已梳理思路')}</span>
        <span className="activity-detail-label">{open ? t('收起详情') : t('查看详情')}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={11} />
      </button>
      {open && <div className="thinking-body">{detail}</div>}
    </div>
  );
}

function ErrorNotice({ message, sessionId }: { message: string; sessionId: string | null }): JSX.Element {
  const [details, setDetails] = useState(false);
  const friendly = useMemo(() => friendlyStreamError(message), [message]);
  const faultId = useMemo(() => {
    let hash = 2166136261;
    for (let i = 0; i < message.length; i += 1) hash = Math.imul(hash ^ message.charCodeAt(i), 16777619);
    return `MM-${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  }, [message]);
  const diagnostic = useMemo(() => JSON.stringify({ faultId, sessionId, message, at: new Date().toISOString() }, null, 2), [faultId, sessionId, message]);
  return (
    <div className={`error-notice${friendly.softwareFault ? ' software-fault' : ' retryable'}`} role={friendly.softwareFault ? 'alert' : 'status'}>
      <div className="error-notice-head">
        <Icon name={friendly.softwareFault ? 'circle-alert' : 'refresh-cw'} size={15} />
        <strong>{friendly.title}</strong>
        {friendly.softwareFault ? <span className="error-fault-id">{faultId}</span> : null}
      </div>
      <div className="error-notice-body">{friendly.description}</div>
      <div className="error-notice-actions">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDetails((v) => !v)}>
          <Icon name={details ? 'chevron-up' : 'chevron-down'} size={12} />
          {details ? t('隐藏详情') : t('查看详情')}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void navigator.clipboard.writeText(diagnostic)}>
          <Icon name="copy" size={12} /> {t('复制诊断信息')}
        </button>
      </div>
      {details ? <pre className="error-notice-details">{diagnostic}</pre> : null}
    </div>
  );
}

function WaitingLine({ blocks, userText }: { blocks: ContentBlock[]; userText: string }): JSX.Element {
  const messages = useMemo(() => activityMessagesFor(blocks, userText), [blocks, userText]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
    if (messages.length <= 1) return undefined;
    const timer = window.setInterval(
      () => setIndex((value) => (value + 1) % messages.length),
      5200,
    );
    return () => window.clearInterval(timer);
  }, [messages]);
  return (
    <div className="activity-waiting" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{messages[index] ?? messages[0]}</span>
    </div>
  );
}

function InlineRetryNotice({ message }: { message: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="activity-inline-retry">
      <button type="button" className="activity-summary" onClick={() => setOpen((value) => !value)}>
        <span className="activity-dot" aria-hidden="true" />
        <span>{t('这一步没走通，正在换一种办法…')}</span>
        <span className="activity-detail-label">{open ? t('收起详情') : t('查看详情')}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={11} />
      </button>
      {open ? <pre className="activity-inline-details">{message}</pre> : null}
    </div>
  );
}

function BlockList({
  blocks,
  streaming,
}: {
  blocks: ContentBlock[];
  streaming: boolean;
}): JSX.Element {
  const visible = blocks.filter(Boolean);
  const hasToolActivity = visible.some((block) => block.kind === 'tool_use');
  /** 最后一段有正文的文本块 —— 流式光标画在它上面（用**引用相等**判定，
   *  比下标稳：折叠组会吃掉若干个块，下标已经对不上了） */
  const lastTextBlock = (() => {
    for (let i = visible.length - 1; i >= 0; i--) {
      if (visible[i].kind === 'text' && visible[i].text) return visible[i];
    }
    return null;
  })();

  // 「连续工具折叠成一组」的判断收在纯函数里（`lib/tool-row.ts`），
  // 组件只管渲染 —— 这样折叠口径能脱离 jsdom 直接单测。
  const items = buildDisplay(visible);

  return (
    <>
      {items.map((it, i) => {
        if (it.type === 'group') {
          return <ToolGroupCard key={`g-${it.group.rows[0]?.id ?? i}`} group={it.group} streaming={streaming} />;
        }
        const b = it.block;
        if (b.kind === 'thinking') {
          return <ThinkingBlock key={`t-${i}`} text={b.text ?? ''} />;
        }
        if (b.kind === 'tool_use') {
          return <ToolCard key={b.toolUseId ?? `tu-${i}`} block={b} streaming={streaming} />;
        }
        if (b.kind === 'error') {
          return <InlineRetryNotice key={`e-${i}`} message={b.text ?? ''} />;
        }
        if (b.kind === 'text') {
          const isLast = streaming && b === lastTextBlock;
          const source = streaming || hasToolActivity
            ? localizeProcessNarration(b.text ?? '')
            : b.text ?? '';
          return (
            <div key={`x-${i}`} className={isLast ? 'caret' : undefined}>
              <Markdown source={source} />
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// 引导卡片 —— 逐字对齐原版内置的三个真实赛题例题
//   （原版 renderer 中文串：2023 华数杯 C 题 / 2024 高教杯 C 题 / 2023 国赛 A 题）
//   原版说明："不知道输入什么？点一张例题卡片，题目和数据会自动填好，发送就能看到完整流程。"
// ─────────────────────────────────────────────────────────────

export const STARTER_HINT =
  '不知道输入什么？点一张例题卡片，题目和数据会自动填好，发送就能看到完整流程。';

/**
 * 解析文案里的轻量标记 `<muted>…</muted>`。
 * 原版把这类文案当富文本渲染；我们不做 dangerouslySetInnerHTML，
 * 只识别这一个受控标签，避免注入风险。
 */
function renderMuted(raw: string): React.ReactNode[] {
  return raw
    .split(/(<muted>[\s\S]*?<\/muted>)/g)
    .filter(Boolean)
    .map((part, i) => {
      const m = /^<muted>([\s\S]*?)<\/muted>$/.exec(part);
      return m ? (
        <span key={i} className="muted">
          {m[1]}
        </span>
      ) : (
        <span key={i}>{part}</span>
      );
    });
}

const STARTERS: Array<{ title: string; desc: string; tags: string[]; prompt: string }> = [
  {
    title: '2023 华数杯 C 题',
    desc: '母亲身心健康对婴儿成长的影响',
    // 标签逐字取自原版卡片
    tags: ['统计', '回归分析', '分类预测'],
    prompt:
      '/mma-paper 完成 2023 年华数杯 C 题「母亲身心健康对婴儿成长的影响」的完整建模求解与论文撰写。',
  },
  {
    title: '2024 高教杯 C 题',
    desc: '农作物的种植策略',
    tags: ['优化', '规划', '种植策略'],
    prompt:
      '/mma-paper 完成 2024 年高教杯 C 题「农作物的种植策略」的完整建模求解与论文撰写。',
  },
  {
    title: '2023 国赛 A 题',
    desc: '定日镜场的优化设计',
    tags: ['优化', '物理建模', '几何计算'],
    prompt:
      '/mma-paper 完成 2023 年全国大学生数学建模竞赛 A 题「定日镜场的优化设计」的完整建模求解与论文撰写。',
  },
];

// ─────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────

/**
 * 品牌标记 —— 原版 hero 左侧的图标：白色圆角方块 + 蓝色「∫∞」手写符号。
 *
 * 复刻早期是「蓝底 + 白色字母 M」，与原版一眼可辨（00-main P1-4）。
 * 原版是内联 SVG 品牌图，仓库里没有对应资产，这里按原版截图重绘：
 * 50×50 源 px 的方块中，∫ 从左上斜貫到左下（笔画宽约 2.5/32），
 * ∞ 压在右下角，两者都是 #6285C7 描边（采自原版截图）。
 */
function BrandMark({ size = 40 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      data-brand="mathmodel"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <rect x="0.5" y="0.5" width="31" height="31" rx="9.5" fill="#f3f3f3" />
      <g
        fill="none"
        stroke="#6285c7"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* ∫ */}
        <path d="M17.2 6C13.2 3.8 10.8 5.6 10.4 9.4l-2 11.8C7.9 25 5.6 26.4 2.6 24.8" />
        {/* ∞ */}
        <path d="M22.5 19.8C18.5 13.6 15.5 15.5 15.5 19.8C15.5 24.1 18.5 26 22.5 19.8C26.5 13.6 29.5 15.5 29.5 19.8C29.5 24.1 26.5 26 22.5 19.8" />
      </g>
    </svg>
  );
}

export function ChatPage(): JSX.Element {
  const currentProject = useApp((s) => s.currentProject);
  const sessions = useApp((s) => s.sessions);
  const activeSessionId = useApp((s) => s.activeSessionId);
  const newChatRequest = useApp((s) => s.newChatRequest);
  const settings = useApp((s) => s.settings);
  const createSession = useApp((s) => s.createSession);
  const refreshSessions = useApp((s) => s.refreshSessions);
  const selectSession = useApp((s) => s.selectSession);
  const consumePendingPrompt = useApp((s) => s.consumePendingPrompt);
  const sendMessage = useSendMessage();

  // ── 追问行为（设置 → 对话）───────────────────────────────
  /**
   * 回合运行中发消息的两条路：
   *   「排队」→ 进 followUpQueue，本回合结束后按 FIFO 自动依次发出；
   *   「调整当前任务」→ 打断当前回合，等它真的停下再把这条发出去。
   *
   * 队列放 store，因为输入区的「已排队 N 条」徽标（Composer）要读它，
   * 而 Composer 与 ChatPage 是兄弟组件。
   */
  const followUpQueue = useApp((s) => s.followUpQueue);
  const enqueueFollowUp = useApp((s) => s.enqueueFollowUp);
  const takeFollowUp = useApp((s) => s.takeFollowUp);
  const markFollowUpError = useApp((s) => s.markFollowUpError);
  /** 防重入：一次只消化一条（发送后 isRunning 会变 true，但状态更新是异步的） */
  const flushingRef = useRef(false);
  /**
   * 「调整当前任务」里被打断后要补发的那条。
   * 不能紧接着 abort 就发 —— `main/agent/session.ts:115` 在上一轮 `run()` 的
   * finally 之前 `running` 仍为 true，直接发会撞上「该会话已有正在执行的任务」。
   * 所以先记在这里，等**回合真的结束**由下面的 effect 补发。
   */
  const pendingSteerRef = useRef<string | null>(null);
  /**
   * 「哪一轮还没收尾」—— 记的是**会话 id**，不是"当前会话收到过 session-end 没有"。
   *
   * 为什么不能用 `!isRunning` 当门槛（E2E 实测踩过）：
   *   `isRunning = stream.active || activeSession?.status === 'running'`，
   *   而 `dispatch()` 不会刷新 `sessions`，主进程写 `status='running'` 渲染层并不知情
   *   → `activeSession.status` 经常是**过期的 'idle'**。
   *   于是只要有人在回合中途把窗口置成非 running（steer 分支 / 点停止），
   *   `isRunning` 立刻变 false，队列就会**提前**开火，撞上主进程那句 guard：
   *   `sessions.error = 该会话已有正在执行的任务，请先中断或等待完成`，
   *   而消息被静默丢弃。
   *   「收到过 session-end」才是正向证据。
   *
   * ⚠️ 为什么是 id 而不是布尔（用户反馈的第二个面）：
   *   "在 A 排队 → 切到 B → A 在后台跑完 → 切回 A"时，旧写法那个布尔只在
   *   **当前会话**的 session-end 置位，A 的那次收尾被丢弃 → 切回来队列永不开火，
   *   表现就是"回去之后和原来不一样"。改成记 id：谁结束就销谁的号，
   *   切回 A 时已经销号 → 队列立刻消化。
   *
   * 初值 null：应用空闲时队列本来就该能正常消化。
   */
  const pendingTurnRef = useRef<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stream, setStream] = useState<StreamView>(EMPTY_STREAM);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement | null>(null);

  // ── 消息级操作（编辑重发 / 回到此消息之前 / 从此分叉）──────────
  /**
   * 正在内联编辑的那条用户消息 id + 编辑中的草稿文本。
   *
   * 原版是「点编辑 → 这条气泡原地变成 textarea → 回车提交」（decoded renderer
   * ChatPage-BhNUYas6 @57500 那段：textarea + `chat.messageList.editMessage` 的 aria-label
   * + 取消/发送两个按钮）。这里照同一套，只是提交后**先弹确认**（见下）。
   */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  /**
   * 「回到此消息之前」的二次确认弹窗。
   *
   * ⚠️ 这个状态就是**那道安全闸的 UI 半边**：只有用户在这里点了「回滚」，
   *    `runRevert` 才会带上 `confirm: true` 发请求。取消 = 关掉弹窗 + 什么都不发，
   *    所以"没确认时零文件改动"在渲染层也是成立的（主进程那半边是硬门槛，
   *    就算有人绕过界面直接 curl，没 confirm 一样 400）。
   *
   * `editedText` 有值时表示这次确认来自「编辑后重发」—— 回滚成功后要把改好的
   * 内容发出去，不是只回滚。
   */
  const [revertAsk, setRevertAsk] = useState<{ messageId: string; editedText?: string } | null>(
    null,
  );
  /** 回滚/分叉进行中：按钮全禁用，防同一条被点两次 */
  const [opsBusy, setOpsBusy] = useState(false);
  /** 操作结果提示（原版是 toast；这里用一条可关闭的条，避免引 UI 库） */
  const [opsNotice, setOpsNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** 用户是否手动往上滚了 —— 决定要不要自动吸底 */
  const stickRef = useRef(true);

  /**
   * 「当前是哪个会话」—— 给**只需订阅一次**的流事件回调读。
   *
   * ⚠️ 为什么不用闭包里的 `activeSessionId`：那样订阅 effect 就得把它列进依赖，
   *    每切一次会话都要 `off()` + `on()` 重订一遍；两次调用之间到达的事件
   *    （IPC 是异步的）会**静默丢掉** —— 这正是"切回来过程块少了"的成因之一。
   *    改成 ref 之后订阅只挂一次，任何会话的事件都不会漏收。
   */
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  });

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  // 用户点过停止后，存活窗口会立刻进入 done。会话列表里的 running 是异步快照，
  // 不能让它把停止按钮又顶回来；真正的后台收尾仍由 pendingTurnRef 把关。
  const isRunning = stream.phase === 'done'
    ? false
    : stream.active || activeSession?.status === 'running';

  const findMatches = useMemo(() => {
    const needle = findQuery.trim().toLowerCase();
    if (!needle) return [] as number[];
    return messages.reduce<number[]>((out, m, i) => {
      const text = m.blocks.map((b) => b.text ?? '').join(' ').toLowerCase();
      if (text.includes(needle)) out.push(i);
      return out;
    }, []);
  }, [messages, findQuery]);

  const jumpToFind = useCallback((nextIndex: number) => {
    if (findMatches.length === 0) return;
    const normalized = (nextIndex + findMatches.length) % findMatches.length;
    setFindIndex(normalized);
    document.querySelector(`[data-search-index="${findMatches[normalized]}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [findMatches]);

  useEffect(() => {
    const offFind = registerCommand('chat.find', () => {
      setFindOpen(true);
      requestAnimationFrame(() => findInputRef.current?.focus());
    });
    const offNext = registerCommand('chat.findNext', () => jumpToFind(findIndex + 1));
    return () => { offFind(); offNext(); };
  }, [findIndex, jumpToFind]);

  useEffect(() => {
    if (findOpen) requestAnimationFrame(() => findInputRef.current?.focus());
  }, [findOpen]);

  // ── 任务进度面板的数据 ────────────────────────────────────
  /**
   * agent 用 TaskCreate / TaskUpdate（或 TodoWrite）拆出来的子任务，折叠成有序清单。
   *
   * 数据来自两处（合并规则抽在 `store/chat-stream.ts:panelTasks`，纯函数、有单测）：
   *   ① 已落库的历史消息 —— 会话切走再回来、甚至重启应用，只要消息还在库里就能复原；
   *   ② **本会话的存活窗口**（`chatStreamStore` 的槽位）—— 本轮还没落库的那些工具调用。
   *
   * ⚠️ 为什么第②部分不再用组件内的 `stream`：组件内的 state 在切换会话时会被换掉，
   *    而 store 的槽位是按 sessionId 存的 —— 切回来取到的是**同一份**块序列，
   *    子任务的文本与勾选状态因此逐一相等（不是"看起来差不多"）。
   */
  const historyBlocks = useMemo(() => latestTaskBlocks(messages), [messages]);
  const taskState = useMemo(
    () => panelTasks(historyBlocks, stream),
    [historyBlocks, stream],
  );

  // 只展示 SDK 实测值。历史 token 累加是账单口径，不等于当前上下文窗口。
  const contextUsage = stream.contextUsage
    ? { ...stream.contextUsage, compacted: stream.lastCompaction !== null }
    : undefined;

  const latestUserText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role !== 'user') continue;
      return messages[i].blocks.map((block) => block.text ?? '').join(' ');
    }
    return input;
  }, [messages, input]);

  // ── 载入历史 ──────────────────────────────────────────────
  const loadHistory = useCallback(async (sid: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = (await window.mathmodel.session.get(sid)) as SessionGetResult;
      /**
       * ⚠️ 结果回来时用户可能已经切走了（IPC 是异步的）——
       * 那就**整份丢掉**，不许把 A 的消息/过程写到 B 的界面上。
       * 这跟"切走再切回来"是同一族问题，只是发生在响应返回的那一瞬间。
       */
      if (activeSessionIdRef.current !== sid) return;
      setMessages(res.messages);
      /**
       * 进行中那一轮的快照 → 灌进本会话的槽位（phase = running）。
       * 取舍规则见 `chatStreamStore.adoptInflight`：**库里的那份优先**，
       * 历史里已经有这个 messageId 就整份丢掉（否则同一过程会画两遍）。
       */
      const adopted = res.inflight
        ? chatStreamStore.adoptInflight(sid, res.inflight, res.messages.map((m) => m.id))
        : null;
      if (adopted) {
        setStream(toView(adopted));
      } else if (chatStreamStore.snapshot(sid).phase === 'done') {
        // session-end 现在保证在最终消息落库后才到达。历史与临时窗口在同一批更新里
        // 完成交接，避免停止/收尾时答案先消失、过一会又重新出现。
        setStream(toView(chatStreamStore.settleFromHistory(sid)));
      }
    } catch (e) {
      if (activeSessionIdRef.current !== sid) return;
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      setStream(EMPTY_STREAM);
      setInput('');
      return;
    }
    /**
     * ⚠️ 这里**不再** `setStream(EMPTY_STREAM)` —— 那是"切走就看不到过程"的主因。
     *    改为从 store 恢复该会话的存活窗口：
     *      切走期间它在后台继续产生块（`onStream` 回调一律写 store），
     *      切回时 `snapshot()` 原样取出，顺序与条数都不变。
     */
    setStream(toView(chatStreamStore.snapshot(activeSessionId)));
    /**
     * 换会话时把消息级操作的临时状态清干净。
     *
     * ⚠️ 尤其 `revertAsk`：它是"待确认的回滚"。切到别的会话后如果还留着，
     *    用户会对着**新会话**点确认，而那个 messageId 属于旧会话 ——
     *    主进程会回 message_not_found（挡住），但那是一次毫无必要的惊吓。
     *    编辑草稿同理：它的正文属于上一条会话的那条消息。
     */
    setEditing(null);
    setRevertAsk(null);
    setOpsNotice(null);
    void loadHistory(activeSessionId);
  }, [activeSessionId, loadHistory]);

  // 项目切换与会话切换是两件事：单独清草稿，不改动上面的会话恢复依赖链。
  useEffect(() => {
    setInput('');
  }, [currentProject?.id]);

  // 已经停在空白页时再点“新任务”，activeSessionId 不会变化；计数器保证草稿仍会清空。
  useEffect(() => {
    if (newChatRequest > 0) setInput('');
  }, [newChatRequest]);

  /**
   * 「编辑后重发」只对**最后一条用户消息**开放 —— 与主进程
   * `message-ops.ts` 的 `editableUserMessageId()` 同一口径（都是"最后一条 user 行"）。
   * 为什么不是"所有用户消息"：编辑重发会删掉这条之后的全部对话，
   * 只有尾部那条才符合直觉（改中间那条 = 丢弃后面所有问答）。
   */
  const lastUserId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') return messages[i].id;
    }
    return null;
  }, [messages]);

  // ── 订阅流式事件 ──────────────────────────────────────────
  useEffect(() => {
    const off = window.mathmodel.session.onStream((sid, ev) => {
      /**
       * ① **不再丢弃**非当前会话的事件（旧代码在这里 `return`）。
       *    一律写进它自己的槽位：用户在 A 发一轮、切到 B、再切回 A，
       *    A 这一轮的块与任务都在。
       *    这一步的判断抽在 store 的 `receive()` 里，有单测盯着（见文件头注释）。
       */
      const { entry, isCurrent } = chatStreamStore.receive(
        sid,
        ev,
        activeSessionIdRef.current,
      );

      // ② 只有"当前会话"才同步进 React state 触发重渲染（后台会话照写不误）
      if (isCurrent) setStream(toView(entry));

      if (ev.type === 'session-end') {
        /**
         * 这一轮**真的**收尾了 —— 队列消化 / 打断补发都要等这个标记。
         * ⚠️ 按 **sessionId** 归属（旧写法只有一个布尔，且只有"当前会话"会置位：
         *    切走期间收尾的会话回来后永远不算收尾，追问队列就卡死了）。
         */
        if (pendingTurnRef.current === sid) pendingTurnRef.current = null;
        /**
         * 收尾即清掉内联错误面板 —— 与改动前一致（原版收尾语义无证据支持"粘住红条"，
         * 这一处按"与原版一模一样"的硬要求回退）。
         * 块照留：那才是本 bug 的正题（主进程 catch 分支不落块时它是唯一可见的过程）。
         */
        const cleaned = chatStreamStore.clearError(sid);
        if (isCurrent) setStream(toView(cleaned));
        if (!isCurrent) return;
        // 流结束 → 拉一次历史做对账（主进程此时才落库）
        void (async () => {
          await loadHistory(sid);
          await refreshSessions();
        })();
        return;
      }
      if (ev.type === 'session-error') {
        void refreshSessions();
      }
    });
    return off;
  }, [loadHistory, refreshSessions]);

  // ── 系统通知（任务完成 / 待审批 / Agent 提问）───────────────
  /**
   * 对应原版 renderer 的三个调用点（`Fce` @19728 / `jce` @19741 / `Bce` @19744），
   * 门控同源（原版 `n4` @19711）：`开关开 && !(窗口可见且有焦点 && 正是在这个会话)`。
   * 判据与文案组装都抽在 `../notifications/taskNotify.ts`（纯函数，有单测）。
   *
   * ⚠️ 为什么在这里**再订阅一次** `onApprovalAsk` / `onAskUser`：
   *    `App.tsx` 已经订阅了同一对 IPC（用来弹模态框）。通知是"顺手再发一条"，
   *    与模态框**没有共享状态**，`ipcRenderer.on` 天然支持多订阅者 ⇒ 各订各的，
   *    既不用把通知逻辑塞进 App.tsx，也不用动那两个弹窗。
   *
   * ⚠️ **已知边界（如实登记）**：这三条订阅的生命周期 = ChatPage 挂载期。
   *    用户切到设置页/图库等**别的路由**时 ChatPage 卸载，此时跑完的会话不发通知；
   *    原版是全局的（react-query 流状态 + 全局 hash 判断）所以会发。
   *    要覆盖那种情况，得把 `installXxx` 提到 `App.tsx` 挂（一行），
   *    那超出本轮划定的文件边界，已上报 team-lead 由他裁决。
   */
  const notifyLatestRef = useRef({ settings, activeSessionId, sessions });
  // 每次渲染后同步一次最新值；事件回调里读 ref，避免 effect 因依赖变化反复退订/重订
  useEffect(() => {
    notifyLatestRef.current = { settings, activeSessionId, sessions };
  });

  /** 取一次"此刻要不要弹"所需的全部环境（事件到达时才调，不预先缓存） */
  const notifyContextFor = useCallback((sessionId: string): TaskNotifyContext => {
    const d = notifyLatestRef.current;
    return {
      enabled: notificationsEnabledFromSettings(d.settings),
      attentive: windowAttentive(),
      sameChat: d.activeSessionId === sessionId,
      sessions: d.sessions,
      show: (p: NotifyShowPayload) => void window.mathmodel.notifications.show(p),
    };
  }, []);

  /**
   * ①「一轮完成」。
   *
   * ⚠️ 这个订阅**刻意不过滤 `sid !== activeSessionId`**（上面那个渲染用的订阅才过滤）：
   *    原版的后台会话跑完也要弹通知，而"用户在会话 A 发完、切到会话 B、A 跑完"
   *    恰恰是系统通知最有用的场景。过滤掉就只剩"窗口失焦"这一种情况了。
   */
  const erroredSessionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const off = window.mathmodel.session.onStream((sid, ev) => {
      if (ev.type === 'session-error') {
        // 原版 `case "error"` 给流状态打上 error，`case "done"` 判 `!o?.error` 才弹
        erroredSessionsRef.current.add(sid);
        return;
      }
      if (ev.type !== 'session-end') return;
      // 只判 `ev.reason` 不够：`case 'result'` 的 error_max_turns 走 `session-error`
      // （`main/agent/session.ts:678`），后面跟的是一条**无 reason** 的 `session-end`。
      const hadError = erroredSessionsRef.current.delete(sid) || ev.reason === 'error';
      if (hadError) return;
      void notifyTurnFinished(notifyContextFor(sid), sid, async () => {
        const { messages: history } = await window.mathmodel.session.get(sid);
        return history;
      });
    });
    return off;
  }, [notifyContextFor]);

  /** ②「待审批」（`session-error` 那套理由同上：审批走独立 IPC，不在流事件里） */
  useEffect(() => {
    return window.mathmodel.session.onApprovalAsk((req) => {
      notifyApprovalNeeded(notifyContextFor(req.sessionId), req.sessionId, req.kind);
    });
  }, [notifyContextFor]);

  /** ③「Agent 提问」（原版取 `questions[0]?.question ?? ""`，我们也照抄这个取值） */
  useEffect(() => {
    return window.mathmodel.session.onAskUser((req) => {
      notifyAgentQuestion(
        notifyContextFor(req.sessionId),
        req.sessionId,
        req.questions[0]?.question ?? '',
      );
    });
  }, [notifyContextFor]);

  // ── 自动吸底 ──────────────────────────────────────────────
  useEffect(() => {
    if (!stickRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, stream.blocks]);

  // ── 取走外部「待填入的提示词」 ─────────────────────────────
  // 科研绘图模板页点「使用此模板」时写入 store，App 已切到本页，
  // 挂载后取走并填入输入框（原版行为：绘图要求自动填入）。
  useEffect(() => {
    const pending = consumePendingPrompt();
    if (!pending) return;
    setInput(pending);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
      }
    });
  }, [consumePendingPrompt]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // ── 发送 ──────────────────────────────────────────────────
  /**
   * 真正把一条消息送出去 —— **不做**排队 / 打断决策（那是 doSend 的事）。
   * 抽出来是因为队列消化要复用同一条路径，且需要知道「送没送成」
   * （返回 false 时给队列那条打失败标记，不静默丢）。
   */
  const dispatch = useCallback(
    async (content: string): Promise<boolean> => {
      let sid = activeSessionId;
      if (!sid) {
        const meta = await createSession(sessionTitleFromPrompt(content));
        if (!meta) return false;
        sid = meta.id;
      }

      setInput('');
      // 乐观插入用户消息，不等主进程回包
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          role: 'user',
          blocks: [{ kind: 'text', text: content }],
          createdAt: Date.now(),
        },
      ]);
      stickRef.current = true;
      // 新一轮开始 → 该会话的槽位清空重开（对应旧代码那句 `{...EMPTY_STREAM, active:true}`）
      setStream(toView(chatStreamStore.beginTurn(sid)));
      // 这一轮还没收尾：在收到**这个会话**的 session-end 之前，队列 / 补发都不许开火
      pendingTurnRef.current = sid;

      // ⚠️ 不要写 try/catch：`useSendMessage` 已经把异常吞成 `return false`，
      //    这里只需判返回值。失败时**必须**把号销掉 ——
      //    主进程连 run() 都没进去（如未配供应商），永远不会来 session-end，
      //    不销号队列就永久卡死。
      const ok = await sendMessage(sid, content);
      if (!ok) {
        if (pendingTurnRef.current === sid) pendingTurnRef.current = null;
        // 同样要落进 store：否则切回来这个槽位还是 running，界面会一直转圈
        setStream(toView(chatStreamStore.interrupt(sid)));
      }
      return ok;
    },
    [activeSessionId, createSession, sendMessage],
  );

  // ─────────────────────────────────────────────────────────────
  // 消息级操作：回到此消息之前 / 从此分叉 / 编辑后重发
  // ─────────────────────────────────────────────────────────────

  /**
   * 真正执行回滚 —— **只有在用户点过确认弹窗之后才会被调到这里**。
   *
   * 链路（与原版逐段对应）：
   *   渲染层 `POST /api/checkpoint/revert`（主进程：过确认门槛 → 恢复工作区 → 删消息）
   *   → 重新拉历史（界面上的消息必须跟着少掉那几条）
   *   → 刷新会话列表（侧栏的条数/时间变了）
   *
   * ⚠️ `confirm: true` 是硬要求：主进程的 `checkRevertRequest` 用 `z.literal(true)` 卡它，
   *    少这个字段就 400 `confirm_required`，**一个文件都不会动**。
   *    也就是说：即使这里写错成"不弹窗直接调"，请求也会被拒 —— 双保险是有意的。
   */
  const runRevert = useCallback(
    async (ask: { messageId: string; editedText?: string }) => {
      const sid = activeSessionId;
      if (!sid) return;
      setOpsBusy(true);
      try {
        await window.mathmodel.http.request('/api/checkpoint/revert', {
          method: 'POST',
          body: { sessionId: sid, messageId: ask.messageId, confirm: true },
        });
        // 回滚成功后界面必须跟着回退：重拉历史（内部带 activeSessionIdRef 校验，
        // 用户中途切走时不会把结果画到别的会话上）
        await loadHistory(sid);
        await refreshSessions();
        setEditing(null);
        setRevertAsk(null);
        setOpsNotice({ kind: 'ok', text: revertSuccessText() });

        /**
         * 「编辑后重发」的后半截：把改好的内容发出去。
         *
         * ⚠️ 发送失败时要把文本**放回输入框**：`dispatch()` 一进去就 `setInput('')`
         *    并乐观插了一条本地消息，失败后那条本地消息会被 `interrupt()` 收尾，
         *    用户如果看不到自己刚写的字，等于白写了一遍。
         */
        if (ask.editedText !== undefined) {
          const ok = await dispatch(ask.editedText);
          if (!ok) {
            setInput(ask.editedText);
            setEditing({ id: ask.messageId, text: ask.editedText });
          }
        }
      } catch (e) {
        setRevertAsk(null);
        setOpsNotice({ kind: 'error', text: revertErrorText(e) });
      } finally {
        setOpsBusy(false);
      }
    },
    [activeSessionId, dispatch, loadHistory, refreshSessions],
  );

  /**
   * 从此消息分叉出一个新会话。
   *
   * ⚠️ **没有二次确认，这是刻意的**：分叉只做 INSERT（新会话 + 一批新 id 的消息行），
   *    一个用户文件都不碰、原会话也不动（判据见 `main/server/message-ops.test.ts §5`）。
   *    对"只增不改"的操作弹确认只会训练用户无脑点"确定"，反而削弱真正危险的那道确认。
   */
  const forkFromMessage = useCallback(
    async (messageId: string) => {
      const sid = activeSessionId;
      if (!sid) return;
      setOpsBusy(true);
      try {
        const res = (await window.mathmodel.http.request(`/api/sessions/${sid}/fork`, {
          method: 'POST',
          body: { messageId },
        })) as { session?: { id?: string }; copiedMessages?: number; draft?: string | null };

        const newId = res.session?.id;
        if (!newId) throw new Error('fork returned no session');
        // 先刷新再切 —— `selectSession` 只是把 activeSessionId 指过去，
        // 会话对象得先在 `sessions` 里存在（见 store 的 activeSession 派生）
        await refreshSessions();
        selectSession(newId);
        // 从**用户消息**分叉时，那条原文要预填到新会话的输入框（原版行为）
        if (typeof res.draft === 'string') setInput(res.draft);
        setOpsNotice({ kind: 'ok', text: forkSuccessText(res.copiedMessages ?? 0) });
      } catch (e) {
        setOpsNotice({ kind: 'error', text: forkErrorText(e) });
      } finally {
        setOpsBusy(false);
      }
    },
    [activeSessionId, refreshSessions, selectSession],
  );

  /**
   * 用户发消息的入口（输入区的 Enter / 发送键都走这里）。
   *
   * @param opts.invertFollowUp Ctrl/Cmd+Enter —— 本次**取反**：
   *   设置是「排队」时打断，设置是「调整当前任务」时排队。
   */
  const doSend = useCallback(
    async (text: string, opts?: { invertFollowUp?: boolean }) => {
      const content = text.trim();
      if (!content) return;

      // 停止按钮已经让界面立即回到可输入状态，但旧 runner 可能还在做最后几毫秒的
      // 清理。此时的新消息先入队，收到真正的 session-end 后自动发送，避免撞上
      // “该会话已有正在执行的任务”。
      if (activeSessionId && pendingTurnRef.current === activeSessionId && !isRunning) {
        enqueueFollowUp(content);
        setInput('');
        return;
      }

      // 运行中又发了一条 → 三选一（决策抽在 store 里，便于穷举单测）
      const action = decideFollowUpAction({
        isRunning,
        behavior: readFollowUpBehavior(),
        invert: opts?.invertFollowUp,
      });

      if (action === 'queue') {
        enqueueFollowUp(content);
        // 已经进队列了，清空输入框让用户接着排下一条
        setInput('');
        return;
      }

      if (action === 'steer') {
        // 调整当前任务：先打断，再等**真的**收到 session-end 由 effect 补发
        // （见 pendingSteerRef / pendingTurnRef 注释）。
        //
        // ⚠️ 这里**不能**自己 `setStream({active:false})` —— 那样 isRunning 会立刻
        //    变 false（activeSession.status 是过期值），effect 提前补发就撞上
        //    主进程那句「该会话已有正在执行的任务」，消息被静默丢弃。
        //    E2E 实测就是这个原因让 C2/C3 全挂（库层证据见 sessions.error）。
        //    回合结束的真相只有一个来源：主进程发来的 session-end。
        pendingSteerRef.current = content;
        setInput('');
        if (activeSessionId) {
          await window.mathmodel.session.abort(activeSessionId).catch(() => undefined);
        }
        await refreshSessions();
        return;
      }

      await dispatch(content);
    },
    [activeSessionId, dispatch, enqueueFollowUp, isRunning, refreshSessions],
  );

  /**
   * 队列消化：**没有待收尾的回合**（`pendingTurnRef` 已销号）且有积压时自动发下一条。
   * 顺序：先补发「调整当前任务」那条，再按 FIFO 消化队列。
   *
   * 门槛为什么不是 `!isRunning`：见 `pendingTurnRef` 的注释 —— isRunning 会被
   * 过期的 session.status 骗到 `false`，那正是「消息被静默丢弃」的成因。
   *
   * ⚠️ 依赖里必须带 `activeSessionId`：切回一个"已经收尾"的会话时，`isRunning`
   *    可能前后都是 false（依赖值没变 → effect 不重跑），只有会话变了才重新评估门槛。
   */
  useEffect(() => {
    if (isRunning || pendingTurnRef.current !== null || flushingRef.current) return;

    // ① 打断后要补发的那条
    const steerText = pendingSteerRef.current;
    if (steerText) {
      pendingSteerRef.current = null;
      flushingRef.current = true;
      void dispatch(steerText).finally(() => {
        flushingRef.current = false;
      });
      return;
    }

    // ② 队列：**属于当前会话**的队首失败过就停在这里 —— 不静默丢弃，也不对同一条无限重试。
    //    ⚠️ 不能看 `followUpQueue[0]`：队首可能是给**别的会话**排的，
    //    它的失败不该挡住当前会话的消化（口径与 takeFollowUp 同源：followUpHeadFor）。
    const head = followUpHeadFor(followUpQueue, activeSessionId);
    if (!head || head.error) return;
    const taken = takeFollowUp();
    if (!taken) return;
    flushingRef.current = true;
    void dispatch(taken.text)
      .then((ok) => {
        // 传整条而不是 id：takeFollowUp 已经把它在队列里摘掉了，
        // store 需要靠 text 才能把它补回队首（见 markFollowUpError 注释）
        if (!ok) markFollowUpError(taken, t('发送失败'));
      })
      .finally(() => {
        flushingRef.current = false;
      });
  }, [activeSessionId, dispatch, followUpQueue, isRunning, markFollowUpError, takeFollowUp]);


  const onAbort = (): void => {
    if (!activeSessionId) return;
    const sid = activeSessionId;
    // 当前帧立刻退出运行态，同时完整保留已经显示的文字、工具结果和任务。
    // 主进程继续在后台把这些内容落库；真正收尾前 pendingTurnRef 会阻止并发发送。
    setStream(toView(chatStreamStore.interrupt(sid)));
    void window.mathmodel.session.abort(sid)
      .then(() => refreshSessions())
      .catch(() => undefined);
  };

  if (!currentProject) {
    return <div className="empty">{t('请先打开一个项目。')}</div>;
  }

  const streamingMessage: ChatMessage | null = stream.phase !== 'idle' && stream.blocks.filter(Boolean).length > 0
    ? {
        id: 'streaming',
        role: 'assistant',
        blocks: stream.blocks.filter(Boolean),
        createdAt: Date.now(),
      }
    : null;

  const isEmpty = messages.length === 0 && stream.blocks.filter(Boolean).length === 0;

  /** 输入区（空会话居中 / 有消息固定底部，用同一份配置） */
  const composerNode = (inline: boolean): JSX.Element => (
    <Composer
      inline={inline}
      value={input}
      onChange={setInput}
      onSend={(text, opts) => void doSend(text, opts)}
      onAbort={() => void onAbort()}
      isRunning={isRunning}
      isStopping={stream.stopping}
      textareaRef={textareaRef}
      contextUsage={contextUsage}
    />
  );

  return (
    <div className="chat-page">
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className={`chat-inner${isEmpty ? ' is-empty' : ''}`}>
          {findOpen ? (
            <div className="transcript-find" role="search">
              <Icon name="search" size={13} />
              <input
                ref={findInputRef}
                value={findQuery}
                onChange={(e) => { setFindQuery(e.target.value); setFindIndex(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setFindOpen(false); }
                  if (e.key === 'Enter') { e.preventDefault(); jumpToFind(findIndex + (e.shiftKey ? -1 : 1)); }
                }}
                placeholder={t('搜索当前会话')}
                aria-label={t('搜索当前会话')}
              />
              <span className="transcript-find-count">{findQuery.trim() ? `${findMatches.length ? findIndex + 1 : 0}/${findMatches.length}` : ''}</span>
              <button type="button" className="msg-op" title={t('上一个')} onClick={() => jumpToFind(findIndex - 1)}><Icon name="chevron-up" size={12} /></button>
              <button type="button" className="msg-op" title={t('下一个')} onClick={() => jumpToFind(findIndex + 1)}><Icon name="chevron-down" size={12} /></button>
              <button type="button" className="msg-op" title={t('关闭')} onClick={() => setFindOpen(false)}><Icon name="x" size={12} /></button>
            </div>
          ) : null}
          {loadError && (
            <div className="panel" style={{ padding: 12, color: 'var(--danger)', fontSize: 12 }}>
              {t('读取会话失败：')}{loadError}
            </div>
          )}

          {loading && messages.length === 0 && (
            <div className="muted" style={{ fontSize: 12, padding: 12 }}>
              {t('载入历史消息…')}
            </div>
          )}

          {isEmpty && (
            <div className="newchat">
              {/* ── 居中的品牌标题（逐字取自 chat.newChatPage.titleWithProject）── */}
              <div className="newchat-hero">
                <BrandMark />
                <h1 className="newchat-title">
                  {renderMuted(
                    tx('chat.newChatPage.titleWithProject', {
                      name: currentProject?.name ?? tx('shell.sidebar.projects'),
                    }),
                  )}
                </h1>
              </div>

              {/* ── 输入区：空会话时居中（与原版一致）── */}
              <div className="composer composer-inline">
                <div className="composer-inner">
                  {composerNode(true)}
                </div>
              </div>

              {/* ── 真题案例 ── */}
              <div className="newchat-examples">
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  {tx('chat.newChatPage.examplesTitle')}
                </div>

                <div className="starters" id="tour-examples">
                  {STARTERS.map((s) => (
                    <button
                      key={s.title}
                      className="starter"
                      onClick={() => void doSend(s.prompt)}
                      disabled={isRunning}
                    >
                      <span className="starter-title">{t(s.title)}</span>
                      <span className="starter-desc">{t(s.desc)}</span>
                      <span className="starter-tags">
                        {s.tags.map((tg) => (
                          <span key={tg} className="starter-tag">
                            {t(tg)}
                          </span>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="newchat-beta">
                  {tx('chat.newChatPage.betaNotice')}
                  <a
                    className="newchat-beta-link"
                    href="https://qm.qq.com/"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {tx('chat.newChatPage.betaFeedback')}
                  </a>
                </div>
              </div>
            </div>
          )}

          {messages.map((m, messageIndex) => (
            <div key={m.id} data-search-index={messageIndex} className={`msg msg-${m.role}`}>
              <div className={`msg-avatar ${m.role}`}>
                {m.role === 'user' ? t('我') : <Icon name="bot" size={13} />}
              </div>
              <div className="msg-body">
                {editing?.id === m.id ? (
                  /**
                   * 内联编辑器 —— 原版是"这条气泡原地变成 textarea"。
                   * Enter 提交（Shift+Enter 换行）、Escape 取消，与原版一致。
                   */
                  <div className="msg-edit">
                    <textarea
                      className="msg-edit-input"
                      aria-label={tx('chat.messageList.editMessage')}
                      value={editing.text}
                      rows={1}
                      autoFocus
                      onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditing(null);
                          return;
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          const text = editing.text.trim();
                          // 空内容不提交（原版也把提交按钮置灰）
                          if (text) setRevertAsk({ messageId: m.id, editedText: text });
                        }
                      }}
                    />
                    <div className="msg-edit-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => setEditing(null)}
                      >
                        {tx('common.cancel')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={!editing.text.trim() || opsBusy}
                        onClick={() => {
                          const text = editing.text.trim();
                          if (text) setRevertAsk({ messageId: m.id, editedText: text });
                        }}
                      >
                        {tx('chat.messageList.send')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <BlockList blocks={m.blocks} streaming={false} />
                )}
                {m.usage && (m.usage.inputTokens || m.usage.outputTokens) ? (
                  <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>
                    ↑{m.usage.inputTokens} ↓{m.usage.outputTokens}
                    {m.usage.reasoningTokens ? (
                      <>
                        {' '}
                        <Icon
                          name="brain"
                          size={10}
                          style={{ display: 'inline-block', verticalAlign: '-1px' }}
                        />
                        {m.usage.reasoningTokens}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {/**
               * 消息操作行 —— 原版每条消息下面都有一行（复制 / 编辑后重发 /
               * 回到此消息之前 / 从此分叉），不是 hover 才出现。
               *
               * 三个按钮的可见条件照原版：
               *   · 编辑后重发：只有**最后一条用户消息**（`canEdit`）
               *   · 回到此消息之前：只有用户消息（原版还有 `!!G.checkpointRef`，
               *     但复刻的 `ChatMessage` DTO **不带** checkpointRef —— 那是 P0 的
               *     刻意选择"两列只在主进程内部读写"。所以这里放行点击，
               *     由主进程回 `no_checkpoint` 并给出那句确定文案
               *     "此消息没有可恢复的检查点"，比"按钮灰着但不说为什么"更好）
               *   · 从此分叉：用户消息与助手消息都有，但**分叉方向不对称**
               *     （用户消息 → 本条进 draft；助手消息 → 本条进新会话）
               * 回合运行中一律禁用（原版 `ie` 就是这个门槛），避免与 agent 并发改工作区。
               */}
              {editing?.id === m.id ? null : (
                <div className="msg-ops">
                  {/**
                   * 分叉：用户消息与助手消息都有这个按钮，但**文案不同**
                   * （`forkFromUserMessage` 明说"这条原文会预填到输入框"，
                   *  `forkFromReply` 明说"新会话继承截至这里的对话"）——
                   * 两者的切片方向是反的，用同一句话会让用户预期错。
                   */}
                  <button
                    type="button"
                    className="msg-op"
                    disabled={isRunning || opsBusy}
                    title={tx(
                      m.role === 'user'
                        ? 'chat.messageList.forkFromUserMessage'
                        : 'chat.messageList.forkFromReply',
                    )}
                    aria-label={tx(
                      m.role === 'user'
                        ? 'chat.messageList.forkFromUserMessage'
                        : 'chat.messageList.forkFromReply',
                    )}
                    onClick={() => void forkFromMessage(m.id)}
                  >
                    <Icon name="git-fork" size={12} />
                  </button>
                  {m.role === 'user' && m.id === lastUserId ? (
                    <button
                      type="button"
                      className="msg-op"
                      disabled={isRunning || opsBusy}
                      title={tx('chat.messageList.editResend')}
                      aria-label={tx('chat.messageList.editResend')}
                      onClick={() => {
                        /**
                         * 草稿取**纯文本**（只拼 text 块）—— 原版预填的是 `content` 列。
                         * 把 thinking / 工具块也塞进 textarea 会让用户误以为那些
                         * 也是他写的，而且重发时又会当成正文发出去。
                         */
                        setEditing({
                          id: m.id,
                          text: m.blocks
                            .filter((b) => b.kind === 'text')
                            .map((b) => b.text ?? '')
                            .join('')
                            .trim(),
                        });
                      }}
                    >
                      <Icon name="square-pen" size={12} />
                    </button>
                  ) : null}
                  {m.role === 'user' ? (
                    <button
                      type="button"
                      className="msg-op"
                      disabled={isRunning || opsBusy}
                      title={tx('chat.messageList.revertToMessage')}
                      aria-label={tx('chat.messageList.revertToMessage')}
                      onClick={() => setRevertAsk({ messageId: m.id })}
                    >
                      <Icon name="rotate-ccw-clock" size={12} />
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ))}

          {streamingMessage && (
            <div className="msg msg-assistant">
              <div className="msg-avatar assistant">
                <Icon name="bot" size={13} />
              </div>
              <div className="msg-body">
                {stream.blocks.filter(Boolean).length > 0 ? <BlockList blocks={stream.blocks} streaming /> : null}
                {stream.stopping ? (
                  <div className="stream-stopping" role="status">
                    <span className="stream-stopping-ring" aria-hidden />
                    <span>{t('正在停下，当前内容已经保留')}</span>
                  </div>
                ) : stream.active ? (
                  <WaitingLine blocks={stream.blocks} userText={latestUserText} />
                ) : null}
              </div>
            </div>
          )}

          {stream.error ? <ErrorNotice message={stream.error} sessionId={activeSessionId} /> : null}

          {/**
           * 消息级操作的结果条。
           *
           * 为什么不只在成功时提示：原版对**每一个**失败码都给了一句单独的话
           * （回合在跑 / 没有检查点 / 恢复失败 / 消息不存在 / 会话不存在），
           * 一律吞成"操作失败"会把用户推向错误的自救方向。文案映射见 `lib/session-ops.ts`。
           */}
          {opsNotice ? (
            <div className={`msg-ops-notice ${opsNotice.kind}`} role="status">
              <Icon
                name={opsNotice.kind === 'ok' ? 'circle-check' : 'circle-alert'}
                size={13}
              />
              <span style={{ flex: 1 }}>{opsNotice.text}</span>
              <button
                type="button"
                className="msg-op"
                aria-label={tx('common.cancel')}
                onClick={() => setOpsNotice(null)}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/**
       * 「回到此消息之前」的二次确认 —— 这套能力里唯一会改用户文件的动作。
       *
       * ⚠️ 弹窗的确认键是**唯一**会把 `confirm: true` 发出去的地方；
       *    取消（或点背景）只是 `setRevertAsk(null)`，一个请求都不发。
       *    「编辑后重发」走的是同一个弹窗（`editedText` 有值），
       *    因为它的第一步同样是回滚 —— 文案要把"会重发"这件事说清楚。
       */}
      <ConfirmDialog
        open={revertAsk !== null}
        title={tx('chat.messageList.revertDialogTitle')}
        description={
          revertAsk?.editedText !== undefined
            ? tx('chat.messageList.editResendDialogBody')
            : tx('chat.messageList.revertDialogBody')
        }
        confirmLabel={tx('chat.messageList.revertConfirm')}
        cancelLabel={tx('common.cancel')}
        busy={opsBusy}
        onCancel={() => setRevertAsk(null)}
        onConfirm={() => {
          const ask = revertAsk;
          if (ask) void runRevert(ask);
        }}
      />

      {/* ── 输入区（有消息时固定在底部；空会话时在 newchat 区块里居中）── */}
      {!isEmpty && (
        <div className="composer">
          {/* 任务进度面板：紧贴输入卡片上方 —— 用户要的「在对话框上面」 */}
          <div className="composer-inner">
            <AgentCollaboration activities={stream.agents} active={isRunning} />
            <TaskProgressPanel state={taskState} />
          </div>
          <div className="composer-inner">{composerNode(false)}</div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 发送助手
// ─────────────────────────────────────────────────────────────

/**
 * 把「发送」拆成独立 hook，是为了让 ChatPage 的渲染逻辑干净 ——
 * 发送要处理会话不存在、并发拦截、错误 toast 三件事，混在 JSX 里会很乱。
 */
/**
 * 发送一条消息。
 * @returns 是否成功送出 —— 队列消化用它决定要不要给这条打失败标记
 */
function useSendMessage(): (sid: string, text: string) => Promise<boolean> {
  const setToast = useToast();
  return useCallback(
    async (sid: string, text: string) => {
      try {
        await window.mathmodel.session.send(sid, text);
        return true;
      } catch (e) {
        setToast(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [setToast],
  );
}

/** 极简 toast：错误用系统 alert 就够，不引 UI 库 */
function useToast(): (msg: string) => void {
  return useCallback((msg: string) => {
    window.alert(t('发送失败：{{msg}}', { msg }));
  }, []);
}
