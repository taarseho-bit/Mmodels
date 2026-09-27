/**
 * `keybindings/dispatch.ts` —— **统一快捷键分发器**的分支与判据。
 *
 * ── 为什么能在 node 环境里测（本仓没有 jsdom / happy-dom，且冻结期不许装依赖）──
 * 分发器**只碰事件的 5 个字段**（`code` / 四个修饰键）和 `preventDefault()`，
 * 它连 `target` 都不看（那是**故意的**，见下面判据③的回归护栏）。
 * 所以：造一个"只记监听器"的假 target，直接调用那个监听器、传一个假事件对象即可。
 * **测的是产品代码里那一份匹配逻辑**，不是我的想象力。
 *
 * ── 四条硬判据（team-lead 点名，每条都要能证伪）──
 *   ① 命中 ⇒ 处理函数**恰好 1 次**；
 *   ② 未命中 ⇒ **不许 `preventDefault`**（否则会坏掉用户正常打字/复制粘贴）；
 *   ③ 在 `<textarea>` 里打**普通字母键** ⇒ 不触发任何命令；
 *   ④ 分清楚"能接的"和"被缺失功能挡住的"（`RULES[].unwired`，见最后一组用例）。
 *
 * ── 每条用例都带「回归护栏」与「反恒真」──
 *   反恒真 = 证明这个判定**不是永远返回同一个值**（写死 true / 写死 false 都会红）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_COMMANDS,
  RULES,
  candidateBindings,
  captureBinding,
  dispatchOrder,
  effectiveBinding,
  eventKeyToken,
  installKeybindings,
  isMacPlatform,
  matchCommand,
  matchesBinding,
  normalizeBinding,
  registerCommand,
  registeredCommands,
  type KeyEventLike,
  type KeyTarget,
} from './dispatch';

// ───────────────────────── 测试替身 ─────────────────────────

/** 假 target：只记录监听器（**不依赖 DOM**） */
function fakeTarget(): KeyTarget & { size: number; fire: (ev: unknown) => void } {
  const listeners = new Set<(ev: Event) => void>();
  const self = {
    addEventListener: (_type: string, cb: (ev: Event) => void): void => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: (ev: Event) => void): void => {
      listeners.delete(cb);
    },
    get size(): number {
      return listeners.size;
    },
    fire: (ev: unknown): void => {
      for (const cb of [...listeners]) cb(ev as Event);
    },
  };
  return self;
}

/** 假键盘事件：记录 `preventDefault` 的调用次数与"回调 vs prevent"的先后顺序 */
interface FakeKey {
  code: string;
  key?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** 事件目标（判据③要用 —— 分发器本身**不读它**，见那条用例的说明） */
  target?: { tagName?: string };
  prevented: number;
  log: string[];
  preventDefault: () => void;
}

function key(code: string, mods: Partial<Pick<FakeKey, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key' | 'target'>> = {}): FakeKey {
  const ev: FakeKey = {
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
    prevented: 0,
    log: [],
    preventDefault: () => {
      ev.prevented += 1;
      ev.log.push('prevent');
    },
  };
  return ev;
}

/** 造一个"按键处理函数被调用"的探针，并把调用也记进事件的 log（用来验"先 prevent 再回调"） */
function probe(ev: FakeKey): () => void {
  return () => {
    ev.log.push('handler');
  };
}

const unregister: Array<() => void> = [];
function reg(command: string, fn: (e: KeyEventLike) => void): void {
  unregister.push(registerCommand(command, fn));
}
afterEach(() => {
  while (unregister.length) unregister.pop()?.();
});

/** 装一个分发器，返回 {target, cmp}；`cmp` = 用户覆盖 */
function install(overrides: Record<string, string> = {}, mac = false) {
  const target = fakeTarget();
  const off = installKeybindings({ target, getOverrides: () => overrides, mac });
  return { target, off, overrides };
}

// ───────────────────────── ① 归一化 / 捕获 ─────────────────────────

describe('键位串归一化（应用约定 `Yw`：小写 + 去空白 + 别名展开）', () => {
  it('别名展开：`cmd`→`meta`、`return`→`enter`、`ArrowLeft`→`left`、空白被吃掉', () => {
    expect(normalizeBinding('Ctrl + N')).toBe('ctrl+n');
    expect(normalizeBinding('cmd+k')).toBe('meta+k');
    expect(normalizeBinding('Return')).toBe('enter');
    expect(normalizeBinding('ArrowLeft')).toBe('left');
    // 反恒真：证明它真的在归一，不是原样返回（写死 return binding 会红在上面几条）
    expect(normalizeBinding('Ctrl + N')).not.toBe('Ctrl + N');
  });

  it('`mod` / `meta` / `ctrl` 是三个**不同**的 token（不能互相折叠）', () => {
    // 回归护栏：若把 `mod` 归一成 `ctrl`，Mac 上 ⌘ 系的键位就会全部落到 Ctrl 上 → 这三条不等 → 红。
    expect(normalizeBinding('mod+b')).not.toBe(normalizeBinding('ctrl+b'));
    expect(normalizeBinding('meta+b')).not.toBe(normalizeBinding('ctrl+b'));
  });

  it('`eventKeyToken` 用 `code`（布局无关）；`code` 缺失 ⇒ null（不匹配任何命令）', () => {
    expect(eventKeyToken({ code: 'KeyK' })).toBe('k');
    expect(eventKeyToken({ code: 'Slash' })).toBe('slash');
    expect(eventKeyToken({ code: 'ArrowLeft' })).toBe('left');
    expect(eventKeyToken({ code: 'Digit3' })).toBe('3');
    // 反恒真 + 负分支：没有 code 时必须是 null 而不是空串/undefined 混过去
    expect(eventKeyToken({})).toBeNull();
    expect(eventKeyToken({ code: '' })).toBeNull();
  });
});

describe('录制（`captureBinding`，应用约定 `z6e`）', () => {
  it('裸字母键**不许**录成键位（否则用户打字会被吃掉）', () => {
    const ev = key('KeyA', { key: 'a' });
    expect(captureBinding(ev as unknown as KeyboardEvent)).toBeNull();
  });

  it('功能键/方向键**允许**裸键', () => {
    expect(captureBinding(key('F5', { key: 'F5' }) as unknown as KeyboardEvent)).toBe('f5');
    expect(captureBinding(key('ArrowLeft', { key: 'ArrowLeft' }) as unknown as KeyboardEvent)).toBe('left');
  });

  it('只按修饰键 ⇒ null（不能把 Ctrl 本身录成一条键位）', () => {
    expect(captureBinding(key('ControlLeft', { key: 'Control', ctrlKey: true }) as unknown as KeyboardEvent)).toBeNull();
  });

  it('非 Mac 上 Ctrl+/ 录成 `mod+slash`（应用约定 `Vk` 里那条就是这个形状）', () => {
    // 本机（Windows / CI）走的是"非 Mac"分支
    const got = captureBinding(key('Slash', { key: '/', ctrlKey: true }) as unknown as KeyboardEvent);
    if (isMacPlatform()) return; // 真在 Mac 上跑时这条不适用（⌘ 才是 mod）
    expect(got).toBe('mod+slash');
  });
});

// ───────────────────────── ② 匹配 ─────────────────────────

describe('匹配：修饰键必须**精确**相等（应用约定没开 `ignoreModifiers`）', () => {
  it('`mod+b` 命中 Ctrl+B（非 Mac）与 ⌘+B（Mac）', () => {
    expect(matchesBinding(key('KeyB', { ctrlKey: true }), 'mod+b', false)).toBe(true);
    expect(matchesBinding(key('KeyB', { metaKey: true }), 'mod+b', true)).toBe(true);
  });

  it('★ 反恒真：多按一个修饰键就不算命中（Ctrl+Shift+B ≠ mod+b）', () => {
    // 回归护栏：若把"修饰键精确相等"退化成"包含即命中"，这条会变 true → 红。
    expect(matchesBinding(key('KeyB', { ctrlKey: true, shiftKey: true }), 'mod+b', false)).toBe(false);
    expect(matchesBinding(key('KeyB', { ctrlKey: true, altKey: true }), 'mod+b', false)).toBe(false);
    // 少按也不命中
    expect(matchesBinding(key('KeyB'), 'mod+b', false)).toBe(false);
  });

  it('★ Mac 上 `mod` ≠ Ctrl：Ctrl+B 不命中 `mod+b`（但命中 `ctrl+b`）', () => {
    expect(matchesBinding(key('KeyB', { ctrlKey: true }), 'mod+b', true)).toBe(false);
    expect(matchesBinding(key('KeyB', { ctrlKey: true }), 'ctrl+b', true)).toBe(true);
  });

  it('★ 裸键 `left` 只认"没有修饰键的 ←"；Ctrl+← **不**命中（光标移动不该被吃掉）', () => {
    expect(matchesBinding(key('ArrowLeft'), 'left', false)).toBe(true);
    expect(matchesBinding(key('ArrowLeft', { ctrlKey: true }), 'left', false)).toBe(false);
    expect(matchesBinding(key('ArrowLeft', { shiftKey: true }), 'left', false)).toBe(false);
  });

  it('★ 兼容历史配置格式：非 Mac 上 `ctrl+n` 与 `mod+n` 都命中 Ctrl+N', () => {
    // 为什么要在意：`new-chat` 的历史默认值是字面量 `'Ctrl + N'`（归一成 `ctrl+n`），
    // 而 `RULES` 里的默认值写作 `mod+n` 风格。Windows 上两者**必须都能用**，否则改一处会悄悄失效。
    expect(matchesBinding(key('KeyN', { ctrlKey: true }), 'Ctrl + N', false)).toBe(true);
    expect(matchesBinding(key('KeyN', { ctrlKey: true }), 'mod+n', false)).toBe(true);
  });

  it('★ 长按产生的重复事件**照常触发**（应用约定 `N_` 不忽略 `e.repeat`）', () => {
    // 应用约定依据：`N_`（第 44399 行）keydown 路径里"这是不是重复事件"那个变量**恒为 false**，
    // 于是长按会持续触发 —— `gallery.prev` 长按连续翻页正需要它。
    // 回归护栏：若谁给分发器加一道 `if (e.repeat) return;` 的"好意"过滤，这条立刻红。
    const calls: number[] = [];
    reg('gallery.prev', () => calls.push(1));
    const { target } = install();
    target.fire({ ...key('ArrowLeft'), repeat: true });
    target.fire({ ...key('ArrowLeft'), repeat: true });
    expect(calls).toHaveLength(2);
  });

  it('★ 两处**有意**偏离应用约定中的地方也钉住（偏离是有理由的，不能被"顺手改回去"）', () => {
    // D1：应用约定 `$xe` 第 40216 行 `if (o.length === 0) return true;` —— 只按修饰键的键位串
    //     会匹配**任意**按键（连 Ctrl+C / Ctrl+V 都会被吃掉）。本实现判为不命中。
    expect(matchesBinding(key('KeyC', { ctrlKey: true }), 'ctrl', false)).toBe(false);
    // D2：应用约定第 40217 行只取第一个主键（`mod+b+k` 等价 `mod+b`）。本实现判为脏数据 ⇒ 不命中。
    expect(matchesBinding(key('KeyB', { ctrlKey: true }), 'mod+b+k', false)).toBe(false);
    // 回归护栏：同一批用例里"正常的键位串"必须照常命中，证明上面两条不是"一律返回 false"
    expect(matchesBinding(key('KeyC', { ctrlKey: true }), 'mod+c', false)).toBe(true);
    expect(matchesBinding(key('KeyB', { ctrlKey: true }), 'mod+b', false)).toBe(true);
  });

  it('反恒真（负分支）：键名不对、空键位串、多个主键的串 ⇒ 一律不命中', () => {
    expect(matchesBinding(key('KeyM', { ctrlKey: true }), 'mod+b', false)).toBe(false);
    expect(matchesBinding(key('KeyB', { ctrlKey: true }), '', false)).toBe(false);
    expect(matchesBinding(key('KeyB', { ctrlKey: true }), null, false)).toBe(false);
    expect(matchesBinding(key('KeyB', { ctrlKey: true }), 'mod+b+k', false)).toBe(false); // 两个主键 = 脏数据
  });
});

// ───────────────────────── ③ 用户覆盖的合并 ─────────────────────────

describe('`effectiveBinding`：用户值优先（应用约定 `r6`）', () => {
  it('有用户值就用用户值，没有才回落默认', () => {
    expect(effectiveBinding('sidebar.toggle', { 'sidebar.toggle': 'mod+j' }, 'mod+b')).toBe('mod+j');
    expect(effectiveBinding('sidebar.toggle', {}, 'mod+b')).toBe('mod+b');
  });

  it('★ 显式写空串 = **解绑**；键不存在 = 用默认（两者不能混为一谈）', () => {
    // 应用约定依据：`Yw('')` 得到空串，空串匹配不到任何键 ⇒ 等价于"这条命令没有快捷键"。
    // 回归护栏：若把两者都写成 `?? default`（或都用 `||`），第一条会变成 `mod+b` → 红。
    expect(effectiveBinding('sidebar.toggle', { 'sidebar.toggle': '   ' }, 'mod+b')).toBeNull();
    expect(effectiveBinding('sidebar.toggle', { 'sidebar.toggle': '' }, 'mod+b')).toBeNull();
    expect(effectiveBinding('sidebar.toggle', undefined, 'mod+b')).toBe('mod+b');
  });

  it('既没有用户值也没有默认 ⇒ null（不许退化成"匹配任意键"）', () => {
    expect(effectiveBinding('不存在的命令', {}, undefined)).toBeNull();
  });
});

// ───────────────────────── ④ 分发器本身 ─────────────────────────

describe('分发器：命中/未命中的行为（判据①②）', () => {
  it('★ 判据① 命中 ⇒ 处理函数**恰好 1 次**', () => {
    const calls: number[] = [];
    reg('sidebar.toggle', () => calls.push(1));
    const { target } = install();
    target.fire(key('KeyB', { ctrlKey: true }));
    expect(calls).toHaveLength(1);
    // 反恒真：换个键再按一次，不该变成 3 次（证明计数真的在数这个处理函数）
    target.fire(key('KeyM'));
    expect(calls).toHaveLength(1);
  });

  it('★ 命中 ⇒ `preventDefault` 恰好 1 次，且**在回调之前**（应用约定先 `M_e` 再调处理函数）', () => {
    const ev = key('KeyB', { ctrlKey: true });
    reg('sidebar.toggle', probe(ev));
    const { target } = install();
    target.fire(ev);
    expect(ev.prevented).toBe(1);
    expect(ev.log).toEqual(['prevent', 'handler']);
  });

  it('★ 判据② 未命中 ⇒ 一个字节都不动：`preventDefault` 0 次、回调 0 次', () => {
    const ev = key('KeyQ', { ctrlKey: true }); // 没有任何命令绑在 mod+q
    const calls: string[] = [];
    reg('sidebar.toggle', () => calls.push('sidebar.toggle'));
    const { target } = install();
    target.fire(ev);
    expect(ev.prevented).toBe(0);
    expect(ev.log).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('★ 判据③ 在 `<textarea>` 里打普通字母键 ⇒ 0 次回调 + 0 次 preventDefault', () => {
    // 这是"打字被快捷键吃掉"的直接判据。注意：**没有任何键位是裸字母**才成立 ——
    // 所以下面还要有一条回归护栏，证明这条不是因为"把 form tag 一律忽略"才过的。
    const ta = { tagName: 'TEXTAREA' };
    const calls: string[] = [];
    for (const cmd of ['sidebar.toggle', 'search.toggle', 'gallery.prev', 'gallery.next', 'new-chat']) {
      reg(cmd, () => calls.push(cmd));
    }
    const { target } = install();
    for (const ch of ['a', 'b', 'k', 'o']) {
      const ev = key(`Key${ch.toUpperCase()}`, { key: ch, target: ta });
      target.fire(ev);
      expect(ev.prevented, `打字母 ${ch} 不该 preventDefault`).toBe(0);
    }
    expect(calls).toEqual([]);
  });

  it('★ 回归护栏：输入框里按**已绑定**的组合键**仍要触发**（应用约定 `enableOnFormTags: true`）', () => {
    // 应用约定硬证据：三处 `N_` 调用点都传 `enableOnFormTags: true / enableOnContentEditable: true`
    // （`.baseline/readable/index-OYc102qC.js:44460 / 45350`）。
    // 这条与上一条**必须同时成立** —— 只满足上一条的做法（"form tag 里一律忽略"）会让
    // "我在输入框里想按 Ctrl+B 收起侧栏"失效，那是**偏离应用约定**。
    const calls: string[] = [];
    reg('sidebar.toggle', () => calls.push('sidebar.toggle'));
    const { target } = install();
    const ev = key('KeyB', { ctrlKey: true, target: { tagName: 'TEXTAREA' } });
    target.fire(ev);
    expect(calls).toEqual(['sidebar.toggle']);
    expect(ev.prevented).toBe(1);
  });

  it('★ 没有登记处理函数的命令**完全不参与匹配**（灯箱没开时按 ← 什么都不发生）', () => {
    // 回归护栏：若匹配只看 `RULES` 而不看注册表，这条会命中 `gallery.prev` 并 preventDefault → 红。
    // 这条是"图库没打开时用户按方向键"的安全保证。
    const ev = key('ArrowLeft');
    const { target } = install();
    target.fire(ev);
    expect(ev.prevented).toBe(0);
    expect(registeredCommands()).toEqual([]);
  });

  it('注销之后不再触发（组件卸载 = 命令失效）', () => {
    const calls: number[] = [];
    const off = registerCommand('gallery.next', () => calls.push(1));
    const { target } = install();
    target.fire(key('ArrowRight'));
    expect(calls).toHaveLength(1);
    off();
    target.fire(key('ArrowRight'));
    expect(calls).toHaveLength(1); // 没有增加
    expect(registeredCommands()).toEqual([]);
  });

  it('两条命令绑同一个键 ⇒ 只触发**第一条**（恰好 1 次，不是 2 次）', () => {
    const calls: string[] = [];
    reg('sidebar.toggle', () => calls.push('sidebar.toggle'));
    reg('search.toggle', () => calls.push('search.toggle'));
    const { target } = install({ 'search.toggle': 'mod+b' }); // 用户把搜索改到 Ctrl+B（与侧栏撞了）
    // 冲突的裁决口径 = `dispatchOrder`（`RULES` 表里谁在前面谁赢）。这里显式钉住它，
    // 免得以后有人调了 `RULES` 的顺序却不知道会改变"撞键时谁生效"。
    expect(dispatchOrder(['sidebar.toggle', 'search.toggle'])).toEqual(['search.toggle', 'sidebar.toggle']);
    const ev = key('KeyB', { ctrlKey: true });
    target.fire(ev);
    expect(calls).toEqual(['search.toggle']); // 恰好 1 次 —— 不是两条都跑，也不是 2 次
    expect(ev.prevented).toBe(1);
  });

  it('★ 用户覆盖在**事件发生时**读取（不是安装时快照）', () => {
    const calls: string[] = [];
    reg('sidebar.toggle', () => calls.push('hit'));
    const overrides: Record<string, string> = {};
    const target = fakeTarget();
    const off = installKeybindings({ target, getOverrides: () => overrides, mac: false });
    target.fire(key('KeyB', { ctrlKey: true }));
    expect(calls).toHaveLength(1); // 默认 mod+b 生效
    overrides['sidebar.toggle'] = 'mod+j'; // 用户在设置页改了
    target.fire(key('KeyB', { ctrlKey: true }));
    expect(calls).toHaveLength(1); // 旧键位不再触发
    target.fire(key('KeyJ', { ctrlKey: true }));
    expect(calls).toHaveLength(2); // 新键位生效
    // 回归护栏：若在安装时把 overrides 快照下来，最后两条会反过来 → 红。
    off();
  });

  it('★ 用户显式解绑（空串）后，默认键位也不许触发', () => {
    const calls: number[] = [];
    reg('sidebar.toggle', () => calls.push(1));
    const { target } = install({ 'sidebar.toggle': '' });
    target.fire(key('KeyB', { ctrlKey: true }));
    expect(calls).toEqual([]);
    expect(registeredCommands()).toEqual(['sidebar.toggle']); // 命令还在，只是没键位
  });
});

describe('分发器：只挂一个监听（本项要修的核心）', () => {
  it('★ `installKeybindings` 只挂**一个** `keydown`，卸载后归零', () => {
    const target = fakeTarget();
    const off = installKeybindings({ target, getOverrides: () => ({}), mac: false });
    expect(target.size).toBe(1);
    off();
    expect(target.size).toBe(0);
    // 回归护栏：这正是"别在每个组件各挂一个"的判据 —— 14 条命令 + N 个面板
    // 如果是各自 `addEventListener`，这里会是两位数，退化成"谁先 preventDefault 谁赢"。
  });

  it('登记 14 条命令**不会**增加监听器数量（仍然只有 1 个）', () => {
    for (const r of RULES) reg(r.command, () => undefined);
    for (const c of APP_COMMANDS) reg(c.command, () => undefined);
    const target = fakeTarget();
    const off = installKeybindings({ target, getOverrides: () => ({}), mac: false });
    expect(target.size).toBe(1);
    expect(registeredCommands()).toHaveLength(RULES.length + APP_COMMANDS.length);
    off();
  });
});

// ───────────────────────── ⑤ 表本身（判据④） ─────────────────────────

describe('★ 判据④ `RULES` 必须把"能不能用"标出来，不许假装接上', () => {
  it('14 条、分组计数 3/8/1/2（与设置页渲染的 4 组一致）', () => {
    expect(RULES).toHaveLength(14);
    const count = (s: string): number => RULES.filter((r) => r.section === s).length;
    expect([count('global'), count('chat'), count('preview'), count('gallery')]).toEqual([3, 8, 1, 2]);
  });

  it('★ 9 条可自定义条目的默认键位**逐字等于应用约定 `Vk`**（第 19020 行）', () => {
    const VK: Record<string, string> = {
      'shortcuts.help': 'mod+slash',
      'search.toggle': 'mod+k',
      'sidebar.toggle': 'mod+b',
      'composer.attach': 'mod+u',
      'message.editSubmit': 'mod+enter',
      'chat.find': 'mod+f',
      'preview.openInEditor': 'mod+o',
      'gallery.prev': 'left',
      'gallery.next': 'right',
    };
    const mine: Record<string, string> = {};
    for (const r of RULES) if (r.defaultBinding) mine[r.command] = r.defaultBinding;
    // 回归护栏：改动任何一个默认键位（比如把 mod+b 换成 mod+\\）这条立刻红。
    expect(mine).toEqual(VK);
  });

  it('5 条不可自定义的条目只有 `display`、没有 `defaultBinding`（与 `Xxe` 一致）', () => {
    const noKey = RULES.filter((r) => !r.defaultBinding).map((r) => r.command);
    expect(noKey).toEqual([
      'composer.send',
      'composer.newline',
      'composer.planMode',
      'chat.findNext',
      'prompt.pickOption',
    ]);
    for (const r of RULES) {
      if (!r.defaultBinding) expect(r.display?.length, r.command).toBeGreaterThan(0);
    }
  });

  it('★ 每条未接线的命令都必须**写出原因**，且计数与报告一致', () => {
    const unwired = RULES.filter((r) => r.unwired);
    const by = (k: string): string[] => unwired.filter((r) => r.unwired === k).map((r) => r.command).sort();
    expect(by('pending-feature')).toEqual(['preview.openInEditor']);
    // 「功能在、但归别人」的 1 条 —— 归属者加一行登记即可（见报告里的"一行改法"）
    // （`composer.attach` 原本也在这条里，现已在 `Composer.tsx` 接线 → 见下面已接线清单）
    expect(by('other-owner')).toEqual(['message.editSubmit']);
    expect(by('product-decision')).toEqual(['prompt.pickOption']);
    // 已接线的必须**没有** `unwired`（回归护栏：如果谁把已接线的也标上，这里会多出来）
    // ⚠️ 这 7 条里前 5 条走**本分发器**；`composer.send` / `composer.newline`
    //    是 `Composer.tsx` 自己的 `onKeyDown` 处理的（应用约定这两条也只有 `display`、不可自定义）。
    expect(RULES.filter((r) => !r.unwired).map((r) => r.command)).toEqual([
      'shortcuts.help',
      'search.toggle',
      'sidebar.toggle',
      'composer.send',
      'composer.newline',
      'composer.planMode',
      'composer.attach',
      'chat.find',
      'chat.findNext',
      'gallery.prev',
      'gallery.next',
    ]);
    // 反恒真：三类相加必须**恰好**是 14（漏标 / 多标都会红）
    expect(unwired.length + RULES.filter((r) => !r.unwired).length).toBe(RULES.length);
    for (const r of unwired) {
      // 原因必须是一句人话，不是"TODO"
      expect(String(r.unwiredNote ?? '').length, r.command).toBeGreaterThan(15);
    }
  });

  it('★ 走**分发器**的可自定义命令与注册表口径对齐', () => {
    // ⚠️ 只挑"已接线 **且** 可自定义"的：`composer.send` / `composer.newline` 虽然已接线，
    //    但它们是 `display`-only（应用约定不给 `keys`）⇒ 本来就没有键位串可挂到分发器上。
    const wired = RULES.filter((r) => !r.unwired && r.defaultBinding).map((r) => r.command);
    expect(wired).toEqual([
      'shortcuts.help',
      'search.toggle',
      'sidebar.toggle',
      'composer.attach',
      'chat.find',
      'gallery.prev',
      'gallery.next',
    ]);
    const cands = candidateBindings(wired, {});
    expect(cands.map((c) => c.command)).toEqual(wired);
    expect(cands.map((c) => c.binding)).toEqual(['mod+slash', 'mod+k', 'mod+b', 'mod+u', 'mod+f', 'left', 'right']);
    // 反恒真：拿一个没登记的 command 去构造候选，它必须拿不到键位（不许凭空造出绑定）
    expect(candidateBindings(['chat.find'], {})).toEqual([{ command: 'chat.find', binding: 'mod+f' }]);
    expect(candidateBindings(['不存在的命令'], {})).toEqual([]);
    // 回归护栏：`display`-only 的两条**永远**进不了候选表（它们不是全局热键，由 textarea 自己处理）
    expect(candidateBindings(['composer.send', 'composer.newline'], {})).toEqual([]);
  });

  it('`matchCommand` 的候选里没有的命令永远不会被返回（反恒真）', () => {
    const cands = candidateBindings(['gallery.prev'], {});
    expect(matchCommand(key('ArrowRight'), cands, false)).toBeNull();
    expect(matchCommand(key('ArrowLeft'), cands, false)).toBe('gallery.prev');
  });

  it('平台判定在 node 环境下不抛（`typeof navigator` 守卫）', () => {
    // 回归护栏：去掉守卫后，本文件在 node 里 import 就会 ReferenceError ⇒ 所有用例直接失败。
    expect(typeof isMacPlatform()).toBe('boolean');
  });

  it('本文件没有被 `vi.mock` 污染（证明上面测的是真实现）', () => {
    expect(vi.isMockFunction(registerCommand)).toBe(false);
    expect(RULES[0]?.command).toBe('shortcuts.help');
  });
});

// `APP_COMMANDS` 的两条也钉一下：它们是"本仓自带、当前没有"的，别被误删
describe('`APP_COMMANDS`：本仓原有的两条（应用约定表里没有）', () => {
  it('默认键位保持历史字面量写法（`Ctrl + N` / `Ctrl + ,`），归一化后可用', () => {
    expect(APP_COMMANDS.map((c) => c.command)).toEqual(['new-chat', 'open-settings']);
    expect(normalizeBinding(APP_COMMANDS[0]!.defaultBinding)).toBe('ctrl+n');
    expect(normalizeBinding(APP_COMMANDS[1]!.defaultBinding)).toBe('ctrl+comma');
    expect(matchesBinding(key('KeyN', { ctrlKey: true }), APP_COMMANDS[0]!.defaultBinding, false)).toBe(true);
    expect(matchesBinding(key('Comma', { ctrlKey: true }), APP_COMMANDS[1]!.defaultBinding, false)).toBe(true);
  });

  it('★ 分发优先级：`RULES` 在前、`APP_COMMANDS` 在后（用户显式改过的键位压过历史的隐藏默认）', () => {
    const calls: string[] = [];
    reg('new-chat', () => calls.push('new-chat'));
    reg('sidebar.toggle', () => calls.push('sidebar.toggle'));
    const { target } = install({ 'sidebar.toggle': 'ctrl+n' }); // 用户把侧栏开关改到 Ctrl+N
    target.fire(key('KeyN', { ctrlKey: true }));
    expect(calls).toEqual(['sidebar.toggle']);
  });
});
