/**
 * 「让 Agent 配置运行环境 → 开始安装」的**顺序判据** —— `A5d` / `A5e` 的回归护栏。
 *
 * 背景（`final-acceptance/INDEX.md` §2 ⑤）：点「开始安装」后跳到了对话页，但**用户自己那条
 * 消息在整轮结束前不渲染**（等满 10.27s 仍是 0；一旦中止 `.msg-user` 立刻变 1）。
 * 需求原话是「发送后跳到对话页让用户**立刻看到**」——所以这是需求级判据，不是判据过期。
 *
 * 根因是**两个 async 的顺序**：
 *   `SESSION_SEND` 在落库**之前**还有一次 `await captureCheckpoint(cwd)`（P0 的工作区快照），
 *   实测「点击 → 这条用户消息能查到」要 **546ms**（`p5c` 的 `L5a`）；而 `openRoute('chat')`
 *   是 0ms。`ChatPage` **只在挂载时**拉一次历史 ⇒ 先跳页的话它读到的历史里**没有**这条消息，
 *   之后再没人读它，要等 agent 整轮跑完 `session-end` 才冒出来。
 *
 * ⇒ **本文件钉的就是那一条**：`openRoute('chat')` 必须发生在用户消息**落库之后**。
 *
 * ⚠️ 本仓库 `vitest.config.ts` 是 `environment: 'node'`，且**没有** jsdom / happy-dom /
 *    @testing-library（验收冻结期也不允许装依赖）⇒ 没法真的挂载 DOM、真的点按钮。
 *    这里的做法是：只打桩 React 的三个 hook（`useState` / `useCallback` / `useEffect`），
 *    **直接调用 `EnvSection()`** 拿到它返回的元素树，再从树里取出确认框的 `onConfirm` 调一次。
 *    ⇒ 跑的仍然是 `EnvSection.tsx` 里那个**真的 `startInstall` 闭包**（不是复制到测试里的一段），
 *      只是"谁来调它"从 React 的 onClick 换成了我们。
 *    ⇒ 副作用（发 IPC、跳页）全是真的：`openRoute` 真的往 `window` 派发 `mm:open-route`，
 *      我们监听它，并**在那一刻**检查"库里有没有那条用户消息"。
 *
 * ⚠️ 每条用例都要能回答：「**如果这段逻辑是坏的，这个观测值会不一样吗？**」
 *    —— 主判据的观测值是 `events` 数组；把顺序换回旧写法，它立刻变成
 *       `['send','navigate','send:resolved']`，两条断言同时红。
 *
 * ⚠️ 本文件**只加测试**；产品代码的改动见 `EnvSection.startInstall`（本次 A5d/A5e 修复）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────
// 可注入的桩（`vi.hoisted` ⇒ 能被被提升的 `vi.mock` 工厂引用）
// ─────────────────────────────────────────────────────────────
const H = vi.hoisted(() => ({
  /** `useState` 第 0 次调用的值（= `items`）。null 表示用组件自己的初始值 */
  items: null as unknown,
  /**
   * ⚠️ `useState` 的**调用计数**。必须放在这里、并且每个用例重置：
   *    它最初是 mock 工厂里的一个局部 `let`，跨渲染/跨用例都不会归零 ——
   *    于是第 2 个用例里"第 0 次 `useState`"其实是第 6 次，
   *    注入的 `items` 没生效，判据红在一个**假原因**上（`正文缺缺失项 pandas`）。
   *    **又是"错的是观测工具"**：产品没坏，是我的桩件状态没重置。
   */
  callIndex: 0,
  /** `useApp.getState().activeSessionId` */
  activeSessionId: 'sid-1' as string | null,
  /** 假 `createSession`。返回 null 用来测"建会话失败"那条分支 */
  createSession: async (_title?: string) => ({ id: 'sid-new' }) as { id: string } | null,
  /** 记录所有 `setXxx(...)` 的调用值 */
  setCalls: [] as unknown[],
}));

/** 假 `window` 上要用的共享状态（每个用例在 `beforeEach` 里重置） */
const S = {
  /** 假"数据库"里的用户消息 */
  db: [] as { sid: string; text: string }[],
  /** 事件流水：顺序判据的观测值 */
  events: [] as string[],
  /** 每次 `mm:open-route` 派发时，`db` 的**长度** */
  dbLenAtNavigate: [] as number[],
  /** 每次 `mm:open-route` 派发时的 route */
  routes: [] as string[],
  alerts: [] as string[],
  /** 假 send 的时延（真实值约 546ms，这里缩短到 30ms 让用例快） */
  sendDelayMs: 30,
  sendShouldFail: false,
};

// ── React hooks 打桩：只替换 3 个，其余（含 jsx-runtime 要用的 internals）原样保留 ──
vi.mock('react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useState: (init: unknown) => {
      const idx = H.callIndex;
      H.callIndex += 1;
      // 只覆盖第 0 次（组件的 `items`）：其余走组件自己的初始值，
      // 保证"我们注入的东西"是显式的、可数的一处，而不是到处打补丁。
      const value =
        idx === 0 && H.items !== null
          ? H.items
          : typeof init === 'function'
            ? (init as () => unknown)()
            : init;
      const setter = (v: unknown): void => {
        H.setCalls.push(v);
      };
      return [value, setter];
    },
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
  } as unknown;
});

// ── store 打桩：组件只用它取 `createSession` / `providers` / `settings`，外加 `getState()` ──
vi.mock('../../store/app', () => ({
  useApp: Object.assign(
    (sel: (s: unknown) => unknown) =>
      sel({
        createSession: (title?: string) => H.createSession(title),
        providers: [],
        settings: {},
      }),
    { getState: () => ({ activeSessionId: H.activeSessionId }) },
  ),
}));

/** 最小 sleep（真异步：让"落库"确实晚于"发起 send"） */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 从 React 元素树里按 **props 形状**（而不是组件身份）找确认框。
 * 用形状而不是 `type === ConfirmDialog`：这样组件被包一层、或换成别的对话框，判据仍然有效。
 */
function findByProps(node: unknown, match: (p: Record<string, unknown>) => boolean): any[] {
  const out: any[] = [];
  const walk = (n: unknown): void => {
    if (n === null || n === undefined || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
      return;
    }
    const el = n as { props?: Record<string, unknown> };
    if (el.props) {
      if (match(el.props)) out.push(el);
      walk(el.props.children);
    }
  };
  walk(node);
  return out;
}

/** 渲染一次 `EnvSection`（用打桩的 hooks 直接调组件函数），返回元素树 */
async function renderEnv(): Promise<unknown> {
  const { EnvSection } = await import('./EnvSection');
  return (EnvSection as unknown as () => unknown)();
}

/** 取出确认框的 `onConfirm`（组件把它写成 `() => void startInstall()`，故无返回值） */
function confirmHandler(tree: unknown): () => void {
  const dialogs = findByProps(
    tree,
    (p) => typeof p.onConfirm === 'function' && p.confirmLabel !== undefined,
  );
  expect(dialogs, '必须在元素树里找到一个「确认框」（带 onConfirm + confirmLabel）').toHaveLength(1);
  return dialogs[0].props.onConfirm as () => void;
}

// ─────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.resetModules();
  H.items = null;
  H.callIndex = 0;
  H.activeSessionId = 'sid-1';
  H.createSession = async () => ({ id: 'sid-new' });
  H.setCalls = [];
  S.db = [];
  S.events = [];
  S.dbLenAtNavigate = [];
  S.routes = [];
  S.alerts = [];
  S.sendDelayMs = 30;
  S.sendShouldFail = false;

  const bus = new EventTarget();
  bus.addEventListener('mm:open-route', (e) => {
    // ★ 观测点：**跳页发生的那一刻**，假"数据库"里已经有几条用户消息？
    S.events.push('navigate');
    S.dbLenAtNavigate.push(S.db.length);
    S.routes.push((e as CustomEvent<{ route: string }>).detail?.route ?? '');
  });

  (globalThis as unknown as { window: unknown }).window = Object.assign(bus, {
    mathmodel: {
      session: {
        send: async (sid: string, text: string) => {
          S.events.push('send');
          if (S.sendShouldFail) {
            await sleep(S.sendDelayMs);
            S.events.push('send:rejected');
            throw new Error('模拟 IPC 失败');
          }
          // 真实的 `SESSION_SEND` 是「先 await captureCheckpoint(≈546ms) 再落库」，
          // 所以这里的"落库"必须**晚于** send 被调用 —— 这正是竞态的成因。
          await sleep(S.sendDelayMs);
          S.db.push({ sid, text });
          S.events.push('send:resolved');
          return { messageId: `m${S.db.length}` };
        },
      },
      env: { check: async () => ({ items: [] }) },
    },
    alert: (m: string) => {
      S.alerts.push(m);
    },
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms) as unknown,
    localStorage: { getItem: () => null, setItem: () => {} },
  });
});

// ─────────────────────────────────────────────────────────────
describe('一键装环境 · 顺序（A5d/A5e 的护栏）', () => {
  it('★ 跳页发生在用户消息**落库之后** —— 这样 ChatPage 挂载时拉到的历史里就有它', async () => {
    const tree = await renderEnv();
    confirmHandler(tree)();

    await vi.waitFor(() => expect(S.dbLenAtNavigate, '一直没跳页').toHaveLength(1));

    // 如果观测到的不是 1，会清楚地打印成 0 —— 那就是旧写法（先跳页、再落库）。
    expect(
      S.dbLenAtNavigate[0],
      '跳页那一刻库里已经有 1 条用户消息；0 = 顺序反了（用户会看到空对话）',
    ).toBe(1);
    expect(S.routes[0]).toBe('chat');

    // 更直观的一条：事件流水必须严格是 发起 send → 落库 → 跳页
    expect(S.events).toEqual(['send', 'send:resolved', 'navigate']);

    // 发的是当前活动会话，且带上了安装任务正文
    expect(S.db[0].sid).toBe('sid-1');
    expect(S.db[0].text).toContain('请修复本机建模运行环境');
  });

  it('★ 反向对照：send 失败时**不许**跳页（错误提示必须留在用户看得见的页面上）', async () => {
    S.sendShouldFail = true;
    const tree = await renderEnv();
    confirmHandler(tree)();

    // 等它跑完（失败后 catch 会同步走到 finally）
    await vi.waitFor(() => expect(S.events).toContain('send:rejected'));
    await sleep(20);

    expect(S.dbLenAtNavigate, '失败时不该跳页').toEqual([]);
    expect(S.routes).toEqual([]);
    // 还在设置页 ⇒ 走页内 alert 之外的通道：`window.alert` 不该被用（那个才是页面看不见时的兜底）
    expect(S.alerts, '没跳页就该用页内提示，不该 alert').toEqual([]);

    // ★ 这一条是**变异探针补出来**的（A5-6 第一次跑是全绿 = 覆盖缺口）：
    //   "不许跳页"只证明它**没做**什么，没证明它**做了**什么。
    //   把 catch 里那两行提示整段删掉，上面两条断言照样通过 —— 那才是最难查的形态：
    //   **静默失败**（用户看到的就是"点了没反应"）。
    //   `notify()` 的实现是 `setToast({title, detail})`，所以从 `setCalls` 里能捞到它。
    const notices = H.setCalls.filter(
      (c): c is { title: string; detail?: string } =>
        Boolean(c) && typeof c === 'object' && Object.prototype.hasOwnProperty.call(c, 'title'),
    );
    expect(notices, '失败必须留下**用户看得见**的提示，绝不静默').toHaveLength(1);
    expect(notices[0].title).toContain('模拟 IPC 失败');
  });

  it('★ 没有活动会话时：先建会话 → 再 send → 再跳页（三步顺序都要在跳页之前）', async () => {
    H.activeSessionId = null;
    const created: string[] = [];
    H.createSession = async (title?: string) => {
      created.push(String(title));
      return { id: 'sid-new' };
    };

    const tree = await renderEnv();
    confirmHandler(tree)();

    await vi.waitFor(() => expect(S.dbLenAtNavigate).toHaveLength(1));

    expect(created).toHaveLength(1);
    expect(S.db[0].sid, 'send 必须落到新建的那个会话上').toBe('sid-new');
    expect(S.dbLenAtNavigate[0], '建会话 + 落库都必须发生在跳页之前').toBe(1);
    expect(S.events).toEqual(['send', 'send:resolved', 'navigate']);
  });

  it('★ 建会话失败 → 直接报错、不 send、不跳页（不是"点了没反应"）', async () => {
    H.activeSessionId = null;
    H.createSession = async () => null;

    const tree = await renderEnv();
    confirmHandler(tree)();

    await sleep(20);
    expect(S.events, '既没有 send 也没有跳页').toEqual([]);
    expect(H.setCalls.length).toBeGreaterThan(0); // 至少关过一次"安装中"的 busy 态
  });
});

// ─────────────────────────────────────────────────────────────
describe('一键装环境 · 消息内容（A5e 的护栏）', () => {
  /** 造一份"5 项缺失"的检测结果（对齐实测：pandas/matplotlib/seaborn/python-dateutil/draw.io） */
  function itemsWith5Missing(): unknown[] {
    const missing = [
      ['py:pandas', 'pandas', 'required'],
      ['py:matplotlib', 'matplotlib', 'required'],
      ['py:seaborn', 'seaborn', 'required'],
      ['py:python-dateutil', 'python-dateutil', 'required'],
      ['drawio', 'draw.io', 'recommended'],
    ] as const;
    const ok = Array.from({ length: 10 }, (_, i) => ({
      id: `ok${i}`,
      name: `ok${i}`,
      level: 'required',
      status: 'ok',
      purpose: 'p',
    }));
    return [
      ...missing.map(([id, name, level]) => ({
        id,
        name,
        level,
        status: 'missing',
        purpose: `${name} 的用途`,
      })),
      ...ok,
    ];
  }

  it('★ 交给 Agent 的正文含：国内镜像优先 + 不二次确认 + 5 个缺失项名 + 必需/推荐标签', async () => {
    H.items = itemsWith5Missing();
    const tree = await renderEnv();
    confirmHandler(tree)();

    await vi.waitFor(() => expect(S.db).toHaveLength(1));
    const text = S.db[0].text;

    expect(text).toContain('请修复本机建模运行环境');
    expect(text).toContain('https://pypi.tuna.tsinghua.edu.cn/simple');
    expect(text).toContain('所有首次下载默认走国内镜像');
    expect(text).toContain('不要再次询问是否开始');
    expect(text).toContain('不要逐条展示命令');
    expect(text).toContain('PowerShell');
    expect(text).toContain('不要从 Git Bash 直接运行 msiexec');
    for (const name of ['pandas', 'matplotlib', 'seaborn', 'python-dateutil', 'draw.io']) {
      expect(text, `正文缺缺失项 ${name}`).toContain(name);
    }
    expect((text.match(/必需/g) ?? []).length).toBe(4);
    expect((text.match(/推荐/g) ?? []).length).toBe(1);
  });

  it('反向对照：没有缺失项时**不列清单**，改成"冒烟验证"（否则会把"没问题"说成"有问题"）', async () => {
    H.items = [
      { id: 'uv', name: 'uv', level: 'required', status: 'ok', purpose: 'p' },
      { id: 'python', name: 'Python', level: 'required', status: 'ok', purpose: 'p' },
    ];
    const tree = await renderEnv();
    confirmHandler(tree)();

    await vi.waitFor(() => expect(S.db).toHaveLength(1));
    const text = S.db[0].text;

    expect(text).toContain('请修复本机建模运行环境');
    expect(text).toContain('冒烟验证');
    expect(text).not.toContain('必需');
    expect(text).not.toContain('- uv');
  });
});
