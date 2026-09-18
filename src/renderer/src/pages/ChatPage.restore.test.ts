/**
 * `ChatPage` 的「切会话复原」接线 —— **结构断言**（读源码，不做真渲染）。
 *
 * ## 为什么不是真渲染
 *
 * 本仓 vitest 是 `environment: 'node'`（`vitest.config.ts:28`），而 `node_modules`
 * 里**没有** jsdom / happy-dom / linkedom / @testing-library/react（已逐个核实）。
 * 补一个要动 `package.json`，超出本轮划定的边界 —— 所以退一步钉"接线"。
 *
 * ## 这个做法能证明什么、不能证明什么（别高估它）
 *
 * 能证明（都是用户报的 bug 的**具体形态**，改回旧写法就会红）：
 *   ① 切会话分支恢复数据用的是 `chatStreamStore.snapshot(sessionId)`，
 *      而不是把窗口置空 —— 旧 `ChatPage.tsx:485` 的 `setStream(EMPTY_STREAM)`；
 *   ② 流事件回调走 `chatStreamStore.receive(...)`，且回调里**没有**
 *      `if (sid !== …) return` —— 旧 `:493` 的"非当前会话直接丢"；
 *   ③ 订阅 effect 的依赖里**没有** `activeSessionId`（切会话不重订，不会漏收事件）；
 *   ④ 新一轮开始走 `beginTurn()`，而不是又拼一个空窗口字面量；
 *   ⑤ 任务面板数据走 `panelTasks(historyBlocks, stream)`；
 *   ⑥ 收尾销号按 sessionId 归属，且写在"非当前会话就返回"之前
 *      （旧写法只有当前会话会置位 → 切走期间收尾的会话回来后追问队列卡死）；
 *   ⑦ 队列消化 effect 的依赖含 `activeSessionId`（切回已收尾的会话才会重新评估）；
 *   ⑧ 读会话时把 `res.inflight`（进行中那一轮的快照）灌进槽位，且响应回来时
 *      已切走就整份丢掉 —— 少了前者，切回正在跑的会话看不见过程；
 *      少了后者，A 的历史会被写到 B 的界面上。
 *
 * **不能**证明：这些调用在运行时接对了（参数顺序对不对、当前会话判定对不对、
 * 渲染出来的 DOM 是不是真恢复了）。那一层只能靠实机 e2e / 人工点击，
 * 本文件替代不了 —— 所以它只当"接线护栏"，不当"功能已验收"的证据。
 *
 * ## 反橡皮图章
 *
 * 末尾 8 条**反向对照**用同一套检查器跑故意改坏的源码（每种改法对应上面一条断言），
 * 断言必须被抓出来。只断言"真源码通过"是橡皮图章 —— 检查器本身必须能红。
 * （这不是摆设：第 3 条对照第一次跑就真红了 —— 它抓出 `effectBody` 没把依赖数组
 *   纳入取样，导致第 ③ 条断言当时是死代码。修好后才绿。）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_PATH = fileURLToPath(new URL('./ChatPage.tsx', import.meta.url));
const RAW = readFileSync(SRC_PATH, 'utf8');

/** 去掉注释：注释里出现 `setStream(EMPTY_STREAM)` 之类的"说明性文字"不算接线 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1'); // 跳过 `https://` 这类（`//` 前是冒号）
}

/**
 * 取某个 `useEffect(() => { … })` 的**函数体 + 依赖数组**
 * （从锚点往前找最近的那个 useEffect；切片一直取到 effect 调用的右括号）。
 *
 * ⚠️ 必须把依赖数组也包进来 —— 只取 `{…}` 的话"往依赖里塞 activeSessionId"
 *    这种改法根本不在取样范围内，那条断言就成了死代码（本文件的第 3 条
 *    反向对照正是这么把它抓出来的）。
 */
function effectBody(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`锚点没找到：${anchor}`);
  const start = src.lastIndexOf('useEffect(() => {', at);
  if (start < 0) throw new Error(`锚点前面没有 useEffect：${anchor}`);
  let depth = 0;
  let i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error(`effect 花括号没闭合：${anchor}`);
  const end = src.indexOf(')', i); // effect 调用的右括号（依赖数组之后）
  if (end < 0) throw new Error(`effect 调用没收尾：${anchor}`);
  return src.slice(start, end + 1);
}

/** 取 effect 的依赖数组文本 */
function effectDeps(body: string): string {
  const m = /\}\s*,\s*\[([^\]]*)\]/.exec(body);
  return m ? m[1] : '';
}

/**
 * 取某个 `useCallback(...)` 的整段源码（含参数与依赖数组）。
 * 区别于 `effectBody`：`loadHistory` 是 `useCallback(async (sid) => …)` 不是 `useEffect`，
 * 且**不能**只取花括号 —— 参数表与依赖数组都在取样范围内才算数。
 */
function callbackBody(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`锚点没找到：${anchor}`);
  const start = src.lastIndexOf('useCallback(', at);
  if (start < 0) throw new Error(`锚点前面没有 useCallback：${anchor}`);
  let depth = 0;
  let i = src.indexOf('(', start);
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error(`useCallback 括号没闭合：${anchor}`);
  return src.slice(start, i + 1);
}

/** 检查器：返回空数组 = 接线正确 */
function checkWiring(raw: string): string[] {
  const src = stripComments(raw);
  const problems: string[] = [];

  if (!src.includes('export function ChatPage')) {
    problems.push('找不到 `export function ChatPage` —— 锚点可能已经失效，本检查不再成立');
  }

  // ① 切会话：恢复，而不是清空
  try {
    const restore = effectBody(src, '[activeSessionId, loadHistory]');
    // 空会话分支（`if (!activeSessionId) { … return; }`）本来就该清空，只看它之后
    const afterNullGuard = restore.slice(restore.indexOf('return;'));
    if (!afterNullGuard.includes('chatStreamStore.snapshot(activeSessionId)')) {
      problems.push('切会话分支没调用 `chatStreamStore.snapshot(activeSessionId)`：恢复入口被换掉了');
    }
    if (afterNullGuard.includes('EMPTY_STREAM')) {
      problems.push('切会话分支还在把窗口置空（旧 :485 的 bug 形态）');
    }
  } catch (e) {
    problems.push(`切会话 effect 读不出来：${(e as Error).message}`);
  }

  // ② 收流：一律写 store + 不提前 return；③ 订阅只挂一次
  try {
    // 锚点用 body 里的稳定标记（不依赖依赖数组文本，否则"往依赖里塞东西"这种改法
    // 会因为锚点消失而报"读不出来"，测不到真正的断言）。indexOf → 第一个订阅（渲染用的那个）。
    const sub = effectBody(src, 'window.mathmodel.session.onStream((sid, ev) => {');
    if (!sub.includes('chatStreamStore.receive(')) {
      problems.push('收流回调没走 `chatStreamStore.receive(...)`');
    }
    if (/if\s*\(\s*sid\s*!==/.test(sub)) {
      problems.push('收流回调还在丢弃非当前会话的事件（旧 :493 的 `if (sid !== …) return`）');
    }
    if (effectDeps(sub).includes('activeSessionId')) {
      problems.push('订阅 effect 依赖了 `activeSessionId`：切会话会重订订阅，两次调用之间的事件会丢');
    }
  } catch (e) {
    problems.push(`订阅 effect 读不出来：${(e as Error).message}`);
  }

  // ④ 新一轮：beginTurn
  if (!src.includes('chatStreamStore.beginTurn(sid)')) {
    problems.push('新一轮开始没走 `chatStreamStore.beginTurn(sid)`');
  }
  if (/\{\s*\.\.\.EMPTY_STREAM,\s*active:\s*true/.test(src)) {
    problems.push('还在自己拼 `{ ...EMPTY_STREAM, active: true }` 当新一轮起点（不落 store）');
  }

  // ⑤ 任务面板：panelTasks
  if (!src.includes('panelTasks(historyBlocks, stream)')) {
    problems.push('任务面板数据没走 `panelTasks(historyBlocks, stream)`');
  }

  // ⑥ 队列收尾判定按 sessionId 归属：销号必须在"非当前会话就返回"**之前**，
  //    且不能被 `isCurrent` 拦住（旧写法只有当前会话会置位 → 切走期间收尾的
  //    会话回来后队列永不开火，正是用户说的"回去之后和原来不一样"）
  try {
    const sub = effectBody(src, 'window.mathmodel.session.onStream((sid, ev) => {');
    const clear = /if\s*\(\s*pendingTurnRef\.current === sid([^;]*)\)/.exec(sub);
    if (!clear) {
      problems.push('session-end 里没有按 sessionId 销号（pendingTurnRef）');
    } else {
      if (clear[1].includes('isCurrent')) {
        problems.push('销号被 isCurrent 拦住了：只有当前会话算收尾 → 切回来队列卡死');
      }
      const bail = sub.indexOf('if (!isCurrent) return;');
      if (bail >= 0 && clear.index > bail) {
        problems.push('销号写在"非当前会话就返回"之后：后台会话的收尾永远不销号');
      }
    }
  } catch (e) {
    problems.push(`收尾销号读不出来：${(e as Error).message}`);
  }

  // ⑦ 队列消化 effect 必须在切会话时重新评估门槛
  try {
    const flush = effectBody(src, 'pendingTurnRef.current !== null');
    if (!effectDeps(flush).includes('activeSessionId')) {
      problems.push('队列消化 effect 的依赖里没有 activeSessionId：切回已收尾的会话不会重新评估门槛');
    }
  } catch (e) {
    problems.push(`队列消化 effect 读不出来：${(e as Error).message}`);
  }

  // ⑧ 读会话：把 inflight（进行中那一轮的快照）灌进槽位 + 已切走的响应整份丢掉
  try {
    const lh = callbackBody(src, 'await window.mathmodel.session.get(sid)');
    if (!lh.includes('chatStreamStore.adoptInflight(')) {
      problems.push('loadHistory 没把 inflight 灌进槽位：切回正在跑的会话看不到过程');
    }
    if (!lh.includes('res.inflight')) {
      problems.push('loadHistory 没读 `res.inflight`（快照分支被跳过了）');
    }
    if (!lh.includes('activeSessionIdRef.current !== sid')) {
      problems.push('响应回来时没有"已切走就整份丢掉"的守卫：A 的历史会被写到 B 的界面上');
    }
  } catch (e) {
    problems.push(`loadHistory 读不出来：${(e as Error).message}`);
  }

  return problems;
}

describe('ChatPage 接线护栏 —— 切会话复原（结构断言，非真渲染）', () => {
  it('真源码：八条接线全部在位', () => {
    expect(checkWiring(RAW)).toEqual([]);
  });

  it('真源码确实被读到了（防"读了个空文件然后全绿"）', () => {
    expect(RAW.length).toBeGreaterThan(4000);
    expect(RAW).toContain('export function ChatPage');
  });
});

describe('ChatPage 接线护栏 —— 反向对照（检查器必须能红）', () => {
  const MUTATIONS: Array<{ name: string; mutate: (s: string) => string }> = [
    {
      // ① 旧 :485：切会话直接清空
      name: '把切会话的恢复入口换回 setStream(EMPTY_STREAM)',
      mutate: (s) =>
        s.replace(
          'setStream(toView(chatStreamStore.snapshot(activeSessionId)));',
          'setStream(EMPTY_STREAM);',
        ),
    },
    {
      // ② 旧 :493：非当前会话的事件直接丢
      name: '在收流回调里加回 `if (sid !== activeSessionIdRef.current) return;`',
      mutate: (s) =>
        s.replace(
          'const { entry, isCurrent } = chatStreamStore.receive(',
          'if (sid !== activeSessionIdRef.current) return;\n      const { entry, isCurrent } = chatStreamStore.receive(',
        ),
    },
    {
      // ③ 订阅 effect 依赖当前会话 → 切会话重订
      name: '把 activeSessionId 塞进订阅 effect 的依赖',
      mutate: (s) => s.replace('}, [loadHistory, refreshSessions]);', '}, [activeSessionId, loadHistory, refreshSessions]);'),
    },
    {
      // ④ 新一轮不落 store
      name: '把 beginTurn 换回 `{ ...EMPTY_STREAM, active: true }`',
      mutate: (s) =>
        s.replace(
          'setStream(toView(chatStreamStore.beginTurn(sid)));',
          "setStream({ ...EMPTY_STREAM, active: true, sessionId: sid });",
        ),
    },
    {
      // ⑤ 任务面板不吃存活窗口
      name: '任务面板拿空历史当输入',
      mutate: (s) => s.replace('panelTasks(historyBlocks, stream)', 'panelTasks([], stream)'),
    },
    {
      // ⑥ 旧语义：只有"当前会话"的收尾才算数
      name: '把销号改成只有当前会话才销（旧 settledRef 语义）',
      mutate: (s) =>
        s.replace(
          'if (pendingTurnRef.current === sid) pendingTurnRef.current = null;',
          'if (pendingTurnRef.current === sid && isCurrent) pendingTurnRef.current = null;',
        ),
    },
    {
      // ⑦ 旧依赖：切回会话不会重新评估门槛
      name: '把 activeSessionId 从队列消化 effect 的依赖里拿掉',
      mutate: (s) =>
        s.replace(
          '}, [activeSessionId, dispatch, followUpQueue, isRunning, markFollowUpError, takeFollowUp]);',
          '}, [dispatch, followUpQueue, isRunning, markFollowUpError, takeFollowUp]);',
        ),
    },
    {
      // ⑧ 进行中回合快照不灌界面（切回正在跑的会话是空的）
      name: '把 inflight 灌槽位那一行去掉',
      mutate: (s) =>
        s.replace(
          'chatStreamStore.adoptInflight(sid, res.inflight, res.messages.map((m) => m.id))',
          'null',
        ),
    },
  ];

  it.each(MUTATIONS.map((m) => [m.name, m] as const))(
    '改坏「%s」必须被检查器抓出来',
    (_name, mutation) => {
      const broken = mutation.mutate(RAW);
      // 先保证替换**真的生效**了，否则这条对照是假的
      expect(broken, '替换没生效，这条反向对照不成立').not.toBe(RAW);
      expect(checkWiring(broken), '检查器没抓出来 → 它就是橡皮图章').not.toEqual([]);
    },
  );

  it('检查器不是"凡有输入就报错"：改一处与接线无关的文案，仍然通过', () => {
    const harmless = RAW.replace("t('操作内容')", "t('具体操作')");
    expect(harmless, '替换没生效').not.toBe(RAW);
    expect(checkWiring(harmless)).toEqual([]);
  });
});
