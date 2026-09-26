/**
 * 渲染层系统通知的判据（对应 `taskNotify.ts`）。
 *
 * 判据设计（三条纪律，每条都有**回归护栏**）：
 *   ① **三态 × 调用点**：`开关开 + 正看着这个会话` → 不弹；
 *      `开关开 + 窗口在后台` / `开关开 + 看着别的会话` → 弹；`开关关` → 一律不弹。
 *   ② **每条都断言 `sessionId`**：通知不带 `sessionId` 点击就不跳会话 ——
 *      只看"弹了几次"会漏掉这个错法，所以断言的是 `show` 收到的整个载荷。
 *   ③ **反恒真**：断言"不弹"时同时断言"换一个态就会弹"，
 *      否则"永远返回 false"也能让"不弹"那几条全绿。
 *
 * ⚠️ 本仓没有 jsdom（`vitest.config.ts` = `environment: 'node'`），
 *    所以这里只测纯函数；真正的 `useEffect` 接线在 `pages/ChatPage.tsx`，
 *    由报告里的「未验证」栏如实登记。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatMessage, SessionMeta } from '@shared/types';
import {
  MAX_NOTIFY_BODY,
  approvalKindKey,
  condense,
  lastAssistantText,
  messageText,
  notificationsEnabledFromSettings,
  notifyAgentQuestion,
  notifyApprovalNeeded,
  notifyTurnFinished,
  sessionTitleFor,
  shouldNotifyForSession,
  shouldNotifyGlobally,
  type NotifyShowPayload,
  type TaskNotifyContext,
} from './taskNotify';

// ── 夹具 ─────────────────────────────────────────────────────

const SESSIONS = [{ id: 's1', title: '会话一' } as SessionMeta];

/** 一条正常的两轮历史；assistant 那条**故意带多余空白**，用来证明压过空白 */
const MESSAGES: ChatMessage[] = [
  { id: 'm1', role: 'user', blocks: [{ kind: 'text', text: '跑一下' }], createdAt: 1 },
  {
    id: 'm2',
    role: 'assistant',
    blocks: [
      { kind: 'thinking', text: '先看数据' },
      { kind: 'text', text: '  跑完了，\n结果在 out/report.pdf  ' },
    ],
    createdAt: 2,
  },
];

/** 记下每一次 `show` 的**整个载荷**（不是只数次数） */
function spy(): { calls: NotifyShowPayload[]; show: (p: NotifyShowPayload) => void } {
  const calls: NotifyShowPayload[] = [];
  return {
    calls,
    show: (p: NotifyShowPayload): void => {
      calls.push(p);
    },
  };
}

/**
 * 造一个 context。默认值是**最保守的那一态**（开关开 + 正看着这个会话 + 聚焦）
 * ⇒ 默认**不弹**；要让它弹必须显式改掉某一项。
 */
function env(
  over: Partial<Omit<TaskNotifyContext, 'show'>>,
  show: TaskNotifyContext['show'],
): TaskNotifyContext {
  return { enabled: true, attentive: true, sameChat: true, sessions: SESSIONS, show, ...over };
}

/** 三态。`SAME` 是门控里最关键的一格：三条都为真时**必须**不弹 */
const SAME = { attentive: true, sameChat: true };
const BACKGROUND = { attentive: false, sameChat: true };
const OTHER_CHAT = { attentive: true, sameChat: false };

/** 断言"确实弹了，且每一条都带着正确的 sessionId" */
function expectFired(calls: NotifyShowPayload[], sid: string): void {
  // ★ 先钉住"非空"：否则下面那个 for 循环在空数组上恒真
  expect(calls.length).toBeGreaterThan(0);
  for (const c of calls) expect(c.sessionId).toBe(sid);
}

// ── ① 三态 × 三个渲染层调用点 ────────────────────────────────

interface Callsite {
  name: string;
  run: (ctx: TaskNotifyContext, sid: string) => Promise<boolean>;
}

const CALLSITES: Callsite[] = [
  {
    name: '① 一轮完成',
    run: (ctx, sid) => notifyTurnFinished(ctx, sid, async () => MESSAGES),
  },
  {
    name: '② 待审批',
    run: (ctx, sid) => Promise.resolve(notifyApprovalNeeded(ctx, sid, 'command')),
  },
  {
    name: '③ Agent 提问',
    run: (ctx, sid) => Promise.resolve(notifyAgentQuestion(ctx, sid, '用哪个题目？')),
  },
];

describe('三态 × 调用点：开关开 + 正看着这个会话 → 不弹', () => {
  for (const cs of CALLSITES) {
    it(`${cs.name}：三者皆真时不弹（项目契约 n4 的核心一格）`, async () => {
      const s = spy();
      const fired = await cs.run(env(SAME, s.show), 's1');

      expect(fired).toBe(false);
      expect(s.calls).toEqual([]);
    });
  }
});

describe('三态 × 调用点：开关开 + 后台 / 别的会话 → 弹（且带 sessionId）', () => {
  for (const cs of CALLSITES) {
    it(`${cs.name}：窗口在后台 → 弹，载荷带 sessionId`, async () => {
      const s = spy();
      const fired = await cs.run(env(BACKGROUND, s.show), 's1');

      expect(fired).toBe(true);
      expectFired(s.calls, 's1');
      expect(s.calls[0].title).toBeTruthy();
      expect(s.calls[0].body).toBeTruthy();
    });

    it(`${cs.name}：看着**别的**会话 → 弹，且 sessionId 是事件那个会话`, async () => {
      const s = spy();
      // sameChat=false ⇒ 用户看的是别的会话；通知必须带**事件里的** sid
      const fired = await cs.run(env(OTHER_CHAT, s.show), 's1');

      expect(fired).toBe(true);
      expectFired(s.calls, 's1');
    });
  }
});

describe('三态 × 调用点：开关关 → 一律不弹', () => {
  for (const cs of CALLSITES) {
    for (const [label, state] of [
      ['正看着这个会话', SAME],
      ['窗口在后台', BACKGROUND],
      ['看着别的会话', OTHER_CHAT],
    ] as const) {
      it(`${cs.name}：开关关 + ${label} → 0 次`, async () => {
        const s = spy();
        const fired = await cs.run(env({ enabled: false, ...state }, s.show), 's1');

        expect(fired).toBe(false);
        expect(s.calls).toEqual([]);
      });
    }
  }
});

describe('反恒真：把三维真值表整个走一遍，判据必须只在"该弹"的那两格为真', () => {
  // 8 种组合；只有 (enabled=true) && !(attentive && sameChat) 的两格该弹
  const cases: { enabled: boolean; attentive: boolean; sameChat: boolean; expect: boolean }[] = [];
  for (const enabled of [true, false]) {
    for (const attentive of [true, false]) {
      for (const sameChat of [true, false]) {
        cases.push({ enabled, attentive, sameChat, expect: enabled && !(attentive && sameChat) });
      }
    }
  }

  it('shouldNotifyForSession 与真值表逐格一致（8 格）', () => {
    const actual = cases.map((c) => shouldNotifyForSession(c));
    expect(actual).toEqual(cases.map((c) => c.expect));
    // 回归护栏：这 8 格里**既有** true 也有 false，否则"恒 false"也能过。
    // 数一下该弹的格：(T,T,F) / (T,F,T) / (T,F,F) —— 开关开且「不同时满足聚焦+同会话」，共 3 格
    expect(actual.filter(Boolean).length).toBe(3);
  });

  it('载荷里的 sessionId 是真从参数来的，不是写死的（换一个 id 就换一个）', () => {
    const s1 = spy();
    const s2 = spy();
    void notifyApprovalNeeded(env(BACKGROUND, s1.show), 's1', 'command');
    void notifyAgentQuestion(env(BACKGROUND, s2.show), 'session-zzz', 'q');

    expect(s1.calls[0].sessionId).toBe('s1');
    expect(s2.calls[0].sessionId).toBe('session-zzz');
  });
});

// ── ② 文案组装（项目契约 t4 / i4 / Ice / zce）────────────────────

describe('condense —— 项目契约 t4（压空白 / ≤140 / 空串 → null）', () => {
  it('空串与纯空白都返回 null（不是空字符串）', () => {
    expect(condense('')).toBeNull();
    expect(condense('   \n\t ')).toBeNull();
  });

  it('连续空白压成一个空格并去首尾', () => {
    expect(condense('  a\n\n b\t c  ')).toBe('a b c');
  });

  it('恰好 140 字不动；141 字截成 137 + "..."（总长仍是 140）', () => {
    const at = 'x'.repeat(MAX_NOTIFY_BODY);
    const over = 'y'.repeat(MAX_NOTIFY_BODY + 1);

    expect(condense(at)).toBe(at);
    const cut = condense(over);
    expect(cut).not.toBeNull();
    expect(cut!.length).toBe(MAX_NOTIFY_BODY);
    expect(cut!.endsWith('...')).toBe(true);
    // 回归护栏：截断的是**尾巴**，不是开头
    expect(cut!.startsWith('y'.repeat(10))).toBe(true);
  });
});

describe('lastAssistantText —— 项目契约 Ice（从后往前找非空 assistant）', () => {
  it('取最后一条 assistant 的 text 块，thinking 不算正文（换行被压成一个空格）', () => {
    // 夹具里那条正文是 `'  跑完了，\n结果在 out/report.pdf  '`：
    // 去首尾空白 + 换行压空格 ⇒ 中间那个空格**是**预期的一部分
    expect(lastAssistantText(MESSAGES)).toBe('跑完了， 结果在 out/report.pdf');
  });

  it('只有 thinking 的 assistant 被跳过，继续往前找', () => {
    const msgs: ChatMessage[] = [
      { id: 'a', role: 'assistant', blocks: [{ kind: 'text', text: '旧回答' }], createdAt: 1 },
      { id: 'b', role: 'assistant', blocks: [{ kind: 'thinking', text: '只有思考' }], createdAt: 2 },
    ];
    expect(lastAssistantText(msgs)).toBe('旧回答');
  });

  it('一条 assistant 都没有 → null（调用方用 finishedWorking 兜底）', () => {
    expect(lastAssistantText([])).toBeNull();
    expect(lastAssistantText(MESSAGES.filter((m) => m.role === 'user'))).toBeNull();
  });

  it('user 消息里的长文本不会被误当成回答', () => {
    const msgs: ChatMessage[] = [
      { id: 'u', role: 'user', blocks: [{ kind: 'text', text: '这是用户说的' }], createdAt: 1 },
    ];
    expect(lastAssistantText(msgs)).toBeNull();
  });
});

describe('messageText —— blocks 拼纯文本（当前实现独有的结构）', () => {
  it('只拼 text 块，tool_use / thinking 不计入', () => {
    const m: ChatMessage = {
      id: 'x',
      role: 'assistant',
      blocks: [
        { kind: 'text', text: 'A' },
        { kind: 'tool_use', toolName: 'Bash' },
        { kind: 'thinking', text: 'B' },
        { kind: 'text', text: 'C' },
      ],
      createdAt: 1,
    };
    expect(messageText(m)).toBe('A C');
  });
});

describe('sessionTitleFor —— 项目契约 i4（空标题回落「未命名会话」）', () => {
  it('找得到就用标题', () => {
    expect(sessionTitleFor(SESSIONS, 's1')).toBe('会话一');
  });

  it('找不到 / 标题是空白 → 回落（不是空字符串）', () => {
    expect(sessionTitleFor(SESSIONS, 'nope')).toBe('未命名会话');
    expect(sessionTitleFor([{ id: 's1', title: '   ' } as SessionMeta], 's1')).toBe('未命名会话');
  });
});

describe('approvalKindKey —— 项目契约 zce（三个类别 + **故意不兜底**）', () => {
  it('三个类别各自映射到自己的文案键', () => {
    expect(approvalKindKey('command')).toBe('integrations.taskCompletion.approvalCommand');
    expect(approvalKindKey('file-read')).toBe('integrations.taskCompletion.approvalFileRead');
    expect(approvalKindKey('file-change')).toBe('integrations.taskCompletion.approvalFileChange');
  });

  it('未知类别 → undefined（当前没有 default 分支，我们直接采用不兜底）', () => {
    expect(approvalKindKey('unknown' as never)).toBeUndefined();
  });

  it('直接采用的后果也钉住：未知类别会让正文出现字面量 "undefined"', () => {
    const s = spy();
    void notifyApprovalNeeded(env(BACKGROUND, s.show), 's1', 'oops' as never);

    // 这是**有意**保留的行为：协议漂移时看得见，比静默换成通用文案好
    expect(s.calls[0].body).toBe('会话一: undefined');
  });
});

// ── ③ 惰性取历史（反恒真：不弹就不许拉一次历史）─────────────

describe('notifyTurnFinished 的 loadMessages 必须惰性', () => {
  it('★ 不该弹时 loadMessages 调用 0 次', async () => {
    let loaded = 0;
    const s = spy();

    const fired = await notifyTurnFinished(env(SAME, s.show), 's1', async () => {
      loaded += 1;
      return MESSAGES;
    });

    expect(fired).toBe(false);
    expect(loaded).toBe(0);
    expect(s.calls).toEqual([]);
  });

  it('★ 回归护栏：同一份输入只把 sameChat 翻成 false，loadMessages 必须正好 1 次', async () => {
    let loaded = 0;
    const s = spy();

    const fired = await notifyTurnFinished(env(OTHER_CHAT, s.show), 's1', async () => {
      loaded += 1;
      return MESSAGES;
    });

    expect(fired).toBe(true);
    expect(loaded).toBe(1);
    expectFired(s.calls, 's1');
  });

  it('拉历史抛错 → 用 finishedWorking 兜底，仍然弹（通知不该让调用方 try/catch）', async () => {
    const s = spy();

    const fired = await notifyTurnFinished(env(BACKGROUND, s.show), 's1', async () => {
      throw new Error('boom');
    });

    expect(fired).toBe(true);
    expect(s.calls[0].body).toBe('任务已完成。');
    expect(s.calls[0].sessionId).toBe('s1');
  });

  it('本轮没有任何 assistant 正文 → 也是 finishedWorking 兜底（语义同项目契约 Ice 返回 null）', async () => {
    const s = spy();
    void (await notifyTurnFinished(env(BACKGROUND, s.show), 's1', async () => []));

    expect(s.calls[0].body).toBe('任务已完成。');
  });
});

// ── ④ 自动化那条：口径少一项 hash 判断（当前实现落在主进程）────

describe('④ 自动化通知：门控 = enabled && !attentive（**少一项 hash 判断**）', () => {
  it('真值表 4 格：只有"开关开 + 窗口不在前台"才弹', () => {
    const table = [
      { enabled: true, attentive: true, expect: false },
      { enabled: true, attentive: false, expect: true },
      { enabled: false, attentive: true, expect: false },
      { enabled: false, attentive: false, expect: false },
    ];
    expect(table.map((t) => shouldNotifyGlobally(t))).toEqual(table.map((t) => t.expect));
  });

  it('★ 与任务完成门控的**唯一差别**就是不看"在哪个会话"', () => {
    // 同一格 (enabled=true, attentive=true)：看着别的会话 → 任务完成要弹，自动化**不弹**
    expect(shouldNotifyForSession({ enabled: true, attentive: true, sameChat: false })).toBe(true);
    expect(shouldNotifyGlobally({ enabled: true, attentive: true })).toBe(false);
  });

  it('结构级：主进程那条通知创建确实被"窗口没聚焦"包着', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'main', 'ipc', 'automation.ts'), 'utf8');

    // 门禁来源必须是共用的那一份，不能自己 new Notification
    expect(src).toContain("import { createSystemNotification } from '../notify'");
    // 窗口注意力的判断必须在，且**在创建之前**
    const guard = src.indexOf('winFocused');
    const create = src.indexOf('createSystemNotification(');
    expect(guard).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(guard);
    // 回归护栏：没有 `if (!winFocused)` 这个否定分支的话，就成了"永远弹"
    expect(src).toContain('if (!winFocused)');
  });
});

// ── ⑤ 开关默认值 ────────────────────────────────────────────

describe('notificationsEnabledFromSettings —— 未设置视为开启', () => {
  it('null / undefined / {} 都算开启，只有显式 false 才拦', () => {
    expect(notificationsEnabledFromSettings(null)).toBe(true);
    expect(notificationsEnabledFromSettings(undefined)).toBe(true);
    expect(notificationsEnabledFromSettings({})).toBe(true);
    expect(notificationsEnabledFromSettings({ notifyEnabled: undefined })).toBe(true);
    expect(notificationsEnabledFromSettings({ notifyEnabled: true })).toBe(true);
    // 回归护栏
    expect(notificationsEnabledFromSettings({ notifyEnabled: false })).toBe(false);
  });
});
