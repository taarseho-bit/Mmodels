/**
 * 「追问行为」的回归测试 —— 设置里那一条不该是摆设。
 *
 * 分两层测：
 *   ① 决策：运行中又发消息时，走「直接发 / 入队 / 打断」哪条（穷举三档设置 ×
 *      是否 Ctrl/Cmd+Enter × 是否运行中）。这层是纯函数，能百分百断言。
 *   ② 队列：入队 → FIFO 取走 → 失败卡住 → 重试恢复 → 移除/清空。
 *      这层直接打真 store（zustand），不是 mock。
 *
 * 另有渲染证据：输入区确实会渲染出「已排队 N 条」徽标。
 * node 环境没有 DOM，所以下面按 sections-structure.test.tsx 的做法打最小桩。
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let kv: Map<string, string>;

beforeAll(() => {
  kv = new Map<string, string>();
  const el = {
    dataset: {} as Record<string, string>,
    style: { setProperty() {}, removeProperty() {} },
  };
  (globalThis as unknown as { document: unknown }).document = {
    documentElement: el,
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  (globalThis as unknown as { window: unknown }).window = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: (fn: () => void) => {
      fn();
      return 0;
    },
    clearTimeout() {},
    addEventListener() {},
    removeEventListener() {},
    mathmodel: {
      app: {
        setNativeTheme: async () => true,
        openPath: async () => true,
        showItemInFolder: async () => true,
        keybindingsFile: async () => 'C:/tmp/keybindings.json',
        getPathForFile: () => '',
      },
      settings: { set: async () => ({}) },
      session: { send: async () => ({ messageId: 'x' }), abort: async () => true },
    },
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => kv.get(k) ?? null,
    setItem: (k: string, v: string) => void kv.set(k, v),
    removeItem: (k: string) => void kv.delete(k),
    clear: () => kv.clear(),
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform: 'Win32' },
    configurable: true,
    writable: true,
  });
});

beforeEach(() => {
  kv.clear();
});

describe('追问行为 · 决策（运行中又发一条消息该怎么处理）', () => {
  it('不在运行时永远直接发（设置与 Ctrl+Enter 都不影响）', async () => {
    const { decideFollowUpAction } = await import('./app');
    expect(decideFollowUpAction({ isRunning: false, behavior: 'queue' })).toBe('send');
    expect(decideFollowUpAction({ isRunning: false, behavior: 'steer' })).toBe('send');
    // 取反标记在「没在运行」时同样不起作用
    expect(decideFollowUpAction({ isRunning: false, behavior: 'queue', invert: true })).toBe('send');
  });

  it('设置 = 排队 → 运行中发第二条进队列，不打断', async () => {
    const { decideFollowUpAction } = await import('./app');
    expect(decideFollowUpAction({ isRunning: true, behavior: 'queue' })).toBe('queue');
  });

  it('设置 = 调整当前任务 → 运行中发第二条打断当前回合', async () => {
    const { decideFollowUpAction } = await import('./app');
    expect(decideFollowUpAction({ isRunning: true, behavior: 'steer' })).toBe('steer');
  });

  it('Ctrl/Cmd+Enter = 取反（原版「临时使用相反行为」）：两条设置各取反一次', async () => {
    const { decideFollowUpAction, invertBehavior } = await import('./app');
    // 设置是「排队」→ 这一次改成打断
    expect(decideFollowUpAction({ isRunning: true, behavior: 'queue', invert: true })).toBe('steer');
    // 设置是「调整当前任务」→ 这一次改成排队
    expect(decideFollowUpAction({ isRunning: true, behavior: 'steer', invert: true })).toBe('queue');
    // 纯函数本身
    expect(invertBehavior('queue')).toBe('steer');
    expect(invertBehavior('steer')).toBe('queue');
    // 不带取反标记时严格按设置走，不受影响
    expect(decideFollowUpAction({ isRunning: true, behavior: 'queue' })).toBe('queue');
    expect(decideFollowUpAction({ isRunning: true, behavior: 'steer' })).toBe('steer');
  });

  it('设置项落在 localStorage 的同一个键上（设置页写、输入区读）', async () => {
    const { FOLLOW_UP_KEY, readFollowUpBehavior, writeFollowUpBehavior } = await import('./app');
    // 缺省 = 排队（原版下拉的当前值就是「排队」）
    expect(readFollowUpBehavior()).toBe('queue');
    writeFollowUpBehavior('steer');
    expect(globalThis.localStorage.getItem(FOLLOW_UP_KEY)).toBe('steer');
    expect(readFollowUpBehavior()).toBe('steer');
    writeFollowUpBehavior('queue');
    expect(readFollowUpBehavior()).toBe('queue');
  });
});

describe('追问行为 · 队列（FIFO / 失败不静默丢弃）', () => {
  it('入队两条 → 取走是先进先出，取走即出队', async () => {
    const { useApp } = await import('./app');
    const s = useApp.getState();
    s.clearFollowUps();
    const first = s.enqueueFollowUp('第二条进来时我还想补充：用中文字体');
    const second = s.enqueueFollowUp('另外图表统一用科创板配色');

    expect(useApp.getState().followUpQueue.map((q) => q.text)).toEqual([
      '第二条进来时我还想补充：用中文字体',
      '另外图表统一用科创板配色',
    ]);

    const taken = useApp.getState().takeFollowUp();
    expect(taken?.id).toBe(first);
    expect(useApp.getState().followUpQueue.map((q) => q.text)).toEqual([
      '另外图表统一用科创板配色',
    ]);
    // 队首已经被取走，再取就是第二条
    expect(useApp.getState().takeFollowUp()?.id).toBe(second);
    expect(useApp.getState().followUpQueue).toEqual([]);
  });

  /**
   * ⚠️ 这条用例原本是**假阳性**，2026-09-17 由 E2E 实测翻出来后才改成现在这样。
   *
   * 旧写法是 `enqueue → mark（条目还在队列里）→ 断言`，
   * 但 ChatPage 的真实调用顺序**恰好相反**：
   *     takeFollowUp()（先出队）→ dispatch() → 失败才 markFollowUpError()
   * 于是旧实现（`map` 找 id）在实机上永远找不到那条条目 → 标记落空、条目凭空消失，
   * 而单测全绿。教训：用例必须照抄**真实调用顺序**，否则测的是自己想象的世界。
   */
  it('发送失败（真实顺序：take 出队 → 打标）→ 条目补回队首、阻断消化；重试后恢复', async () => {
    const { useApp } = await import('./app');
    const s = useApp.getState();
    s.clearFollowUps();
    const first = s.enqueueFollowUp('这条会失败');
    s.enqueueFollowUp('排在后面的一条');

    // ① 真实顺序的第一步：出队
    const taken = useApp.getState().takeFollowUp();
    expect(taken?.id).toBe(first);
    expect(useApp.getState().followUpQueue.map((q) => q.text)).toEqual(['排在后面的一条']);

    // ② 发送失败 → 打标。此刻条目已不在队列里，实现必须把它补回来
    useApp.getState().markFollowUpError(taken!, '发送失败');
    const q = useApp.getState().followUpQueue;
    expect(q).toHaveLength(2);
    expect(q[0].id).toBe(first); // 补回**队首**，不是队尾
    expect(q[0].text).toBe('这条会失败');
    expect(q[0].error).toBe('发送失败');
    expect(q[1].text).toBe('排在后面的一条'); // 后面的顺序不受影响

    // ③ 幂等：同一条被 mark 第二次不能插出第三条
    useApp.getState().markFollowUpError(taken!, '发送失败');
    useApp.getState().markFollowUpError(taken!, '换一个原因');
    const q2 = useApp.getState().followUpQueue;
    expect(q2).toHaveLength(2);
    expect(q2[0].error).toBe('换一个原因');

    // ④ 失败条目卡住自动消化（不对同一条无限重试）
    expect(useApp.getState().takeFollowUp()).toBeNull();
    expect(useApp.getState().followUpQueue).toHaveLength(2);

    // ⑤ 重试 → 摘掉 error、顺序不变 → 恢复可消化
    useApp.getState().retryFollowUp(first);
    expect(useApp.getState().followUpQueue[0].error).toBeUndefined();
    expect(useApp.getState().takeFollowUp()?.id).toBe(first);
    expect(useApp.getState().followUpQueue.map((q) => q.text)).toEqual(['排在后面的一条']);
  });

  it('移除单条 / 全部清除', async () => {
    const { useApp } = await import('./app');
    const s = useApp.getState();
    s.clearFollowUps();
    const a = s.enqueueFollowUp('A');
    s.enqueueFollowUp('B');
    s.removeFollowUp(a);
    expect(useApp.getState().followUpQueue.map((q) => q.text)).toEqual(['B']);
    useApp.getState().clearFollowUps();
    expect(useApp.getState().followUpQueue).toEqual([]);
  });

  it('渲染证据：输入区的徽标显示「已排队 N 条」+ 每条内容 + 失败条的重试', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const React = await import('react');
    const { FollowUpQueueBadge } = await import('../components/Composer');

    const html = renderToStaticMarkup(
      React.createElement(FollowUpQueueBadge, {
        queue: [
          { id: 'q1', text: '排队中的第一条', sessionId: 's1' },
          { id: 'q2', text: '排队中的第二条', sessionId: 's1' },
          { id: 'q3', text: '这条失败了', sessionId: 's1', error: '发送失败' },
        ],
        onRemove: () => undefined,
        onRetry: () => undefined,
        onClear: () => undefined,
      }),
    );

    expect(html).toContain('cz-queue');
    expect(html).toContain('已排队 3 条');
    expect(html).toContain('排队中的第一条');
    expect(html).toContain('排队中的第二条');
    // 三条都在（失败的那条**不许**被丢掉）
    expect((html.match(/cz-queue-item/g) ?? []).length).toBe(3);
    // 失败那条：标红 + 原因 + 重试入口
    expect(html).toContain('is-failed');
    expect(html).toContain('发送失败');
    expect(html).toContain('重试');
    // 每条都有移除入口
    expect((html.match(/cz-chip-x/g) ?? []).length).toBe(3);
  });

  it('渲染证据：队列为空时不渲染徽标（不占位）', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const React = await import('react');
    const { FollowUpQueueBadge } = await import('../components/Composer');

    const html = renderToStaticMarkup(
      React.createElement(FollowUpQueueBadge, {
        queue: [],
        onRemove: () => undefined,
        onRetry: () => undefined,
        onClear: () => undefined,
      }),
    );
    expect(html).not.toContain('cz-queue');
  });
});

/**
 * 队列的**会话归属** —— 用户在 A 排队、切到 B、再切回来那一族问题。
 *
 * 判据的核心是一条不变量：**只消化属于当前会话的条目**。
 * 取不到的语义是"什么都不做"（不发、也不从队列里删）——
 * 删了就等于把用户那句悄悄吃掉，比发错会话更难发现。
 */
describe('追问队列 · 会话归属（切会话不会被别处消化）', () => {
  beforeEach(async () => {
    const { useApp } = await import('./app');
    useApp.setState({ activeSessionId: null, followUpQueue: [] });
  });

  it('入队时记下归属：条目带着当时的 activeSessionId', async () => {
    const { useApp } = await import('./app');
    useApp.setState({ activeSessionId: 's-A' });
    useApp.getState().enqueueFollowUp('给 A 的补充');
    useApp.setState({ activeSessionId: 's-B' });
    useApp.getState().enqueueFollowUp('给 B 的补充');

    const q = useApp.getState().followUpQueue;
    expect(q.map((x) => [x.sessionId, x.text])).toEqual([
      ['s-A', '给 A 的补充'],
      ['s-B', '给 B 的补充'],
    ]);
  });

  it('★ 目标会话 ≠ 当前会话：取不到（没被发出去），且条目**还在队列里**', async () => {
    const { useApp } = await import('./app');
    useApp.setState({ activeSessionId: 's-A' });
    const idA = useApp.getState().enqueueFollowUp('给 A 的补充');

    // 切到 B（A 那条还在队列里等着）
    useApp.setState({ activeSessionId: 's-B' });

    // ① 取不到 —— 渲染层拿到 null 就什么都不做（不发消息）
    expect(useApp.getState().takeFollowUp()).toBeNull();
    // ② 队列**原样**：没被吃掉，也没被挪位置
    const q = useApp.getState().followUpQueue;
    expect(q).toHaveLength(1);
    expect(q[0].id).toBe(idA);
    expect(q[0].sessionId).toBe('s-A');
    // ③ 换个会话再试还是取不到
    useApp.setState({ activeSessionId: 's-C' });
    expect(useApp.getState().takeFollowUp()).toBeNull();
    expect(useApp.getState().followUpQueue).toHaveLength(1);
  });

  it('★ 切回目标会话之后才发出（时机）', async () => {
    const { useApp } = await import('./app');
    useApp.setState({ activeSessionId: 's-A' });
    const idA = useApp.getState().enqueueFollowUp('给 A 的补充');

    useApp.setState({ activeSessionId: 's-B' });
    expect(useApp.getState().takeFollowUp()).toBeNull(); // B 上不发

    useApp.setState({ activeSessionId: 's-A' }); // 切回 A
    const taken = useApp.getState().takeFollowUp();
    expect(taken?.id).toBe(idA);
    expect(taken?.text).toBe('给 A 的补充');
    expect(taken?.sessionId).toBe('s-A');
    expect(useApp.getState().followUpQueue).toEqual([]); // 取走即出队
  });

  it('两个会话交错入队：各取各的，且**会话内**顺序不变', async () => {
    const { useApp } = await import('./app');
    useApp.setState({ activeSessionId: 's-A' });
    useApp.getState().enqueueFollowUp('A1');
    useApp.setState({ activeSessionId: 's-B' });
    useApp.getState().enqueueFollowUp('B1');
    useApp.setState({ activeSessionId: 's-A' });
    useApp.getState().enqueueFollowUp('A2');

    // 物理顺序是 A1, B1, A2 —— 但 B1 不该插在 A 的队伍里
    expect(useApp.getState().followUpQueue.map((x) => x.text)).toEqual(['A1', 'B1', 'A2']);

    // 在 A：先 A1，再 A2（跳过 B1）
    expect(useApp.getState().takeFollowUp()?.text).toBe('A1');
    expect(useApp.getState().followUpQueue.map((x) => x.text)).toEqual(['B1', 'A2']);
    expect(useApp.getState().takeFollowUp()?.text).toBe('A2');
    expect(useApp.getState().followUpQueue.map((x) => x.text)).toEqual(['B1']);
    expect(useApp.getState().takeFollowUp()).toBeNull(); // A 没得取了，B1 不许被 A 拿走

    // 到 B：B1 还在
    useApp.setState({ activeSessionId: 's-B' });
    expect(useApp.getState().takeFollowUp()?.text).toBe('B1');
    expect(useApp.getState().followUpQueue).toEqual([]);
  });

  it('别的会话的失败条目不该挡住当前会话的消化（卡住是**按会话**的）', async () => {
    const { useApp } = await import('./app');
    useApp.setState({ activeSessionId: 's-A' });
    const idA = useApp.getState().enqueueFollowUp('A 这条会失败');
    useApp.setState({ activeSessionId: 's-B' });
    useApp.getState().enqueueFollowUp('B 这条是好的');

    // A 那条失败并补回队首（真实顺序见上一节那条用例）
    useApp.setState({ activeSessionId: 's-A' }); // 回到 A 才取得到它
    const takenA = useApp.getState().takeFollowUp();
    expect(takenA?.id).toBe(idA);
    useApp.getState().markFollowUpError(takenA!, '发送失败');
    expect(useApp.getState().followUpQueue.map((x) => [x.text, x.error])).toEqual([
      ['A 这条会失败', '发送失败'],
      ['B 这条是好的', undefined],
    ]);

    // 在 A：被自己的失败条目卡住
    expect(useApp.getState().takeFollowUp()).toBeNull();
    // 在 B：不受 A 的失败影响
    useApp.setState({ activeSessionId: 's-B' });
    expect(useApp.getState().takeFollowUp()?.text).toBe('B 这条是好的');
    expect(useApp.getState().followUpQueue.map((x) => x.text)).toEqual(['A 这条会失败']);
  });

  it('retryFollowUp 只摘 error，**归属不能被弄丢**（丢了就永远排不到）', async () => {
    const { useApp } = await import('./app');
    useApp.setState({ activeSessionId: 's-A' });
    const idA = useApp.getState().enqueueFollowUp('失败后重试');
    const taken = useApp.getState().takeFollowUp();
    useApp.getState().markFollowUpError(taken!, '发送失败');

    useApp.getState().retryFollowUp(idA);
    const after = useApp.getState().followUpQueue[0];
    expect(after.error).toBeUndefined();
    expect(after.sessionId).toBe('s-A'); // ★ 归属还在
    expect(useApp.getState().takeFollowUp()?.id).toBe(idA); // 且真的还能取到
  });

  it('followUpHeadFor：出队与渲染层准入判定共用同一口径', async () => {
    const { followUpHeadFor } = await import('./app');
    const queue = [
      { id: '1', text: 'A1', sessionId: 's-A' },
      { id: '2', text: 'B1', sessionId: 's-B' },
    ];
    expect(followUpHeadFor(queue, 's-B')?.id).toBe('2');
    expect(followUpHeadFor(queue, 's-A')?.id).toBe('1');
    expect(followUpHeadFor(queue, 's-C')).toBeNull();
    expect(followUpHeadFor([], 's-A')).toBeNull();
  });

  /**
   * 徽标的「已排队 N 条」必须**按会话数**，不能数全局 ——
   * 在 B 里显示 3 条却一条也发不出去、点开还管不了，是拿数字骗人。
   *
   * ⚠️ 这里渲染的是 `FollowUpQueueBadge`，输入用 `followUpItemsFor` 过滤
   *    （= `Composer.tsx` 里传给它的那一份）。**组件真接线**另有结构断言兜底
   *    （见下面「徽标接线」那条）—— 两者缺一不可：
   *    只渲染叶子组件，改坏 Composer 那一行是不会红的。
   */
  it('渲染证据：徽标只显示**当前会话**的排队条目（数的是自己那份）', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const React = await import('react');
    const { FollowUpQueueBadge } = await import('../components/Composer');
    const { followUpItemsFor } = await import('./app');

    const queue = [
      { id: 'q1', text: '给 A 的第一条', sessionId: 's-A' },
      { id: 'q2', text: '给 B 的那条', sessionId: 's-B' },
      { id: 'q3', text: '给 A 的第二条', sessionId: 's-A' },
    ];

    const render = (sid: string): string =>
      renderToStaticMarkup(
        React.createElement(FollowUpQueueBadge, {
          queue: followUpItemsFor(queue, sid),
          onRemove: () => undefined,
          onRetry: () => undefined,
          onClear: () => undefined,
        }),
      );

    // 在 A：只有 A 的两条（不是 3 条）
    const inA = render('s-A');
    expect(inA).toContain('已排队 2 条');
    expect(inA).toContain('给 A 的第一条');
    expect(inA).toContain('给 A 的第二条');
    expect(inA).not.toContain('给 B 的那条'); // ★ 别的会话的条目不出现
    expect((inA.match(/cz-queue-item/g) ?? []).length).toBe(2);

    // 在 B：只有 B 的一条
    const inB = render('s-B');
    expect(inB).toContain('已排队 1 条');
    expect(inB).toContain('给 B 的那条');
    expect(inB).not.toContain('给 A 的第一条');

    // 在 C（没有任何排队）：徽标整个不出现
    const inC = render('s-C');
    expect(inC).not.toContain('cz-queue');
  });

  /**
   * 徽标的**接线**护栏：`Composer.tsx` 必须把过滤后的那份传给徽标。
   *
   * 为什么需要它：上面那条渲染用例只证明"徽标组件本身是好的"，
   * 证明不了 Composer 真的把这过滤后的一份传了进去（本仓踩过
   * "判据测的是旁边那个东西"这个坑）。node 环境渲染不了 Composer
   * （它有几十个 hook + 依赖 window），所以退一步读源码钉这一行。
   */
  it('徽标接线：Composer 传的是 followUpItemsFor(...) 的结果，不是全局队列', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../components/Composer.tsx', import.meta.url)),
      'utf8',
    );
    const problems: string[] = [];
    if (!/const myFollowUps = followUpItemsFor\(followUpQueue, activeSessionId\);/.test(src)) {
      problems.push('没有用 followUpItemsFor(当前队列, 当前会话) 算出自己那份');
    }
    if (/queue=\{followUpQueue\}/.test(src)) {
      problems.push('徽标仍在吃全局队列（在别的会话里会数出不存在的条数）');
    }
    if (!/queue=\{myFollowUps\}/.test(src)) {
      problems.push('徽标没有收到过滤后的那份（myFollowUps）');
    }
    expect(problems).toEqual([]);

    // 反向对照：把过滤去掉（退回全局队列）必须被抓住
    const broken = src
      .replace('queue={myFollowUps}', 'queue={followUpQueue}')
      .replace(
        'const myFollowUps = followUpItemsFor(followUpQueue, activeSessionId);',
        'const myFollowUps = followUpQueue;',
      );
    expect(broken, '替换没生效，这条反向对照不成立').not.toBe(src);
    const brokenProblems: string[] = [];
    if (!/const myFollowUps = followUpItemsFor\(followUpQueue, activeSessionId\);/.test(broken)) {
      brokenProblems.push('no-filter');
    }
    if (/queue=\{followUpQueue\}/.test(broken)) brokenProblems.push('global-queue');
    expect(brokenProblems, '过滤去掉后护栏没红 → 它就是橡皮图章').not.toEqual([]);
  });
});
