/**
 * 「允许系统通知」开关（`settings.notifyEnabled`）的回归测试 —— 这个开关曾经是**假的**。
 *
 * 背景（功能缺口核查里证据最硬的一条）：
 *   修之前 `notifyEnabled` 全仓只有 3 处 —— 写设置的 `NotifySection.tsx`、类型声明
 *   `types.ts` —— **零读取点**；而 `ipc/automation.ts` 与 `ipc/app.ts` 都**无条件**
 *   `new Notification(...)`。于是用户把开关关掉，通知照样弹。
 *
 * 判据设计（每条都带**回归护栏**，只看"没报错"不算数）：
 *   - 开关 `false` → 断言**通知构造器调用 0 次**、返回 `null`；
 *   - 开关 `true` → 断言**调用 1 次**、入参逐字对上；
 *   - 开关"未设置" → 断言仍然创建（对齐项目契约 `?.notifications ?? true` 的默认值）；
 *   - 再加一条**结构级**断言：主进程里"绕过门禁直接 new Notification"要能被测出来
 *     —— 这正是「漏一个等于没修」的失守形态，靠人眼 review 是靠不住的。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 被 mock 的 electron / 设置层共用的小黑板（vi.hoisted 保证在 vi.mock 工厂之前就绪） */
const h = vi.hoisted(() => ({
  /** 当前"设置"里的 notifyEnabled（undefined = 用户从没动过这个开关） */
  settings: {} as { notifyEnabled?: boolean },
  /** 系统层面是否支持通知 */
  supported: true,
  /** 默认工厂真正构造出来的通知对象（只记初始参数） */
  constructed: [] as unknown[],
  /** `app.setBadgeCount` 收到的每一次入参（未读徽标） */
  badgeCalls: [] as number[],
  /** `BrowserWindow.getAllWindows()` 返回的假窗口列表 */
  windows: [] as unknown[],
}));

vi.mock('electron', () => ({
  Notification: class {
    static isSupported(): boolean {
      return h.supported;
    }
    constructor(init: unknown) {
      h.constructed.push(init);
    }
    on(): void {
      /* 事件监听在单测里不需要真的生效 */
    }
    show(): void {
      /* 单测里不真的弹 */
    }
  },
  // `createSystemNotification` 的默认注意力探测会读它们；不提供就会在单测里抛
  BrowserWindow: {
    getAllWindows: (): unknown[] => h.windows,
  },
  app: {
    setBadgeCount: (n: number): boolean => {
      h.badgeCalls.push(n);
      return true;
    },
  },
}));

vi.mock('./store/config', () => ({
  getSettings: () => h.settings,
}));

import {
  MAX_BADGE_COUNT,
  bumpUnreadBadge,
  clearUnreadBadge,
  createSystemNotification,
  isWindowAttentive,
  notificationsEnabled,
  resetUnreadBadgeForTest,
  unreadBadgeCount,
  type NotificationFactory,
  type SystemNotificationHandle,
  type SystemNotificationInit,
} from './notify';

/** 造假窗口：只实现 `isWindowAttentive` 会读的四个方法 */
function fakeWindow(o: { destroyed?: boolean; visible?: boolean; minimized?: boolean; focused?: boolean }): unknown {
  return {
    isDestroyed: () => o.destroyed ?? false,
    isVisible: () => o.visible ?? true,
    isMinimized: () => o.minimized ?? false,
    isFocused: () => o.focused ?? true,
  };
}

/** 假的通知构造器：既当 spy 用（数调用次数），又把每次入参记下来 */
function fakeFactory(): {
  factory: NotificationFactory;
  calls: SystemNotificationInit[];
  handle: SystemNotificationHandle & { shown: number; fireClick: () => void };
} {
  const calls: SystemNotificationInit[] = [];
  let clickListener: (() => void) | null = null;
  const handle = {
    shown: 0,
    on: (_event: 'click', listener: () => void): void => {
      clickListener = listener;
    },
    show: (): void => {
      handle.shown += 1;
    },
    fireClick: (): void => clickListener?.(),
  };
  const factory: NotificationFactory = vi.fn((init: SystemNotificationInit) => {
    calls.push(init);
    return handle;
  });
  return { factory, calls, handle };
}

beforeEach(() => {
  h.settings = {};
  h.supported = true;
  h.constructed.length = 0;
  h.badgeCalls.length = 0;
  h.windows = [];
  resetUnreadBadgeForTest();
});

describe('notificationsEnabled —— 开关语义与默认值', () => {
  it('默认值对齐项目契约：只有显式 false 才拦，未设置视为开启', () => {
    // 项目契约 asar dump: `function YI(t){return t.getQueryData(["settings"])?.notifications??!0}`
    expect(notificationsEnabled({})).toBe(true);
    expect(notificationsEnabled({ notifyEnabled: undefined })).toBe(true);
    expect(notificationsEnabled({ notifyEnabled: true })).toBe(true);
    // 回归护栏：关掉就是关掉
    expect(notificationsEnabled({ notifyEnabled: false })).toBe(false);
  });

  it('不传参数时读的是当前设置（getSettings），不是写死的常量', () => {
    h.settings = {};
    expect(notificationsEnabled()).toBe(true);
    h.settings = { notifyEnabled: false };
    expect(notificationsEnabled()).toBe(false);
    h.settings = { notifyEnabled: true };
    expect(notificationsEnabled()).toBe(true);
  });
});

describe('createSystemNotification —— 关掉开关必须【不创建】通知对象', () => {
  it('notifyEnabled=false → 构造器调用 0 次、返回 null（不是弹一个空的）', () => {
    h.settings = { notifyEnabled: false };
    const f = fakeFactory();

    const n = createSystemNotification({ title: 'T', body: 'B' }, f.factory);

    expect(n).toBeNull();
    // ★ 关键：数是"构造器调用次数"，不是"有没有抛错"
    expect(f.calls.length).toBe(0);
    expect(f.handle.shown).toBe(0);
  });

  it('notifyEnabled=true → 构造器调用 1 次、入参逐字对上（回归护栏）', () => {
    h.settings = { notifyEnabled: true };
    const f = fakeFactory();

    // 第三个参数钉住"用户正看着窗口"，本条只测门禁与句柄透出，不掺徽标
    const n = createSystemNotification({ title: 'T', body: 'B', silent: true }, f.factory, () => true);

    expect(f.calls.length).toBe(1);
    expect(f.calls[0]).toEqual({ title: 'T', body: 'B', silent: true });
    // ⚠️ 句柄**不再原样透出**（原实现是 `return factory(init)`）：外面包了一层
    //    "点击先清零徽标"（见 `notify.ts`）。所以这里断言的是"包完之后还能用"。
    expect(n).not.toBeNull();
    expect(n).not.toBe(f.handle); // 回归护栏：确认确实被包过，免得以后有人把它改回去
    // 门禁只管"创建"，show() 由调用方决定 —— 这里断言它没有越权替调用方弹
    expect(f.handle.shown).toBe(0);
    n!.show();
    expect(f.handle.shown).toBe(1);
    // click 能转发到调用方的监听器（`ipc/app.ts` / `automation.ts` 靠它跳会话）
    let clicks = 0;
    n!.on('click', () => {
      clicks += 1;
    });
    f.handle.fireClick();
    expect(clicks).toBe(1);
  });

  it('notifyEnabled 未设置 → 仍然创建（项目契约默认开启）', () => {
    h.settings = {};
    const f = fakeFactory();

    expect(createSystemNotification({ title: 'T' }, f.factory, () => true)).not.toBeNull();
    expect(f.calls.length).toBe(1);
  });

  it('系统不支持通知时同样不创建（开关开着也不创建）', () => {
    h.settings = { notifyEnabled: true };
    h.supported = false;
    const f = fakeFactory();

    expect(createSystemNotification({ title: 'T' }, f.factory)).toBeNull();
    expect(f.calls.length).toBe(0);
  });

  it('默认构造器就是 electron 的 Notification：构造次数随开关变化', () => {
    h.settings = { notifyEnabled: true };
    const on = createSystemNotification({ title: 'T' });
    expect(on).not.toBeNull();
    expect(h.constructed.length).toBe(1);

    // 回归护栏：关掉之后**一个都不许再构造出来**
    h.settings = { notifyEnabled: false };
    const off = createSystemNotification({ title: 'T' });
    expect(off).toBeNull();
    expect(h.constructed.length).toBe(1);
  });
});

describe('未读徽标 —— 当前主进程通知创建路径里的那一段', () => {
  it('isWindowAttentive：三个条件缺一不可（逐个反证，不是只看"全真"那一格）', () => {
    h.windows = [fakeWindow({})];
    expect(isWindowAttentive()).toBe(true);

    for (const broken of [
      { destroyed: true },
      { visible: false },
      { minimized: true },
      { focused: false },
    ]) {
      h.windows = [fakeWindow(broken)];
      expect(isWindowAttentive(), JSON.stringify(broken)).toBe(false);
    }

    // 回归护栏：**一个窗口都没有**也是 false（不是"没有窗口就算在看"）
    h.windows = [];
    expect(isWindowAttentive()).toBe(false);
  });

  it('用户没在看窗口 → 未读 +1 并且刷一次系统徽标', () => {
    h.settings = { notifyEnabled: true };
    h.windows = [fakeWindow({ focused: false })]; // 窗口在后台
    const f = fakeFactory();

    expect(createSystemNotification({ title: 'T' }, f.factory)).not.toBeNull();

    expect(unreadBadgeCount()).toBe(1);
    expect(h.badgeCalls).toEqual([1]);
  });

  it('用户正看着窗口 → 不加未读，连系统调用都不发（项目契约 `||` 的另一支）', () => {
    h.settings = { notifyEnabled: true };
    h.windows = [fakeWindow({})]; // 三项皆真
    const f = fakeFactory();

    expect(createSystemNotification({ title: 'T' }, f.factory)).not.toBeNull();

    expect(unreadBadgeCount()).toBe(0);
    expect(h.badgeCalls).toEqual([]);
  });

  it('封顶 99：连加 120 次仍是 99（项目契约 `Math.min(MA + 1, 0x63)`）', () => {
    expect(MAX_BADGE_COUNT).toBe(99);
    for (let i = 0; i < 120; i += 1) bumpUnreadBadge();

    expect(unreadBadgeCount()).toBe(99);
    expect(h.badgeCalls[h.badgeCalls.length - 1]).toBe(99);
    expect(h.badgeCalls.length).toBe(120); // 每次都刷（项目契约没有去抖）
  });

  it('点击通知 → 清零；已经是 0 时**不再**重复刷系统调用', () => {
    h.settings = { notifyEnabled: true };
    h.windows = [fakeWindow({ focused: false })];
    const f = fakeFactory();

    const n = createSystemNotification({ title: 'T' }, f.factory);
    n!.on('click', () => undefined);
    expect(unreadBadgeCount()).toBe(1);

    f.handle.fireClick();
    expect(unreadBadgeCount()).toBe(0);
    expect(h.badgeCalls).toEqual([1, 0]);

    // 回归护栏：清零后再点一次 —— 项目契约 `0 !== MA && (...)` 短路，不该再刷一次 0
    f.handle.fireClick();
    expect(h.badgeCalls).toEqual([1, 0]);
  });

  it('clearUnreadBadge 单独调也幂等：0 时不刷，非 0 时刷一次 0', () => {
    clearUnreadBadge(); // 本来就是 0
    expect(h.badgeCalls).toEqual([]);

    bumpUnreadBadge();
    expect(h.badgeCalls).toEqual([1]);

    clearUnreadBadge();
    expect(h.badgeCalls).toEqual([1, 0]);

    clearUnreadBadge(); // 反复清
    expect(h.badgeCalls).toEqual([1, 0]);
  });

  it('点击时**先**清零、**再**交给调用方的监听器（顺序会影响"跳会话后还挂着红点"）', () => {
    h.settings = { notifyEnabled: true };
    h.windows = [fakeWindow({ focused: false })];
    const f = fakeFactory();

    let seen = -1;
    const n = createSystemNotification({ title: 'T' }, f.factory);
    n!.on('click', () => {
      seen = unreadBadgeCount(); // 调用方看到的那一刻，徽标必须已经是 0
    });

    f.handle.fireClick();
    expect(seen).toBe(0);
  });

  it('开关关掉时连徽标都不动（不创建 ⇒ 没有副作用）', () => {
    h.settings = { notifyEnabled: false };
    h.windows = [fakeWindow({ focused: false })]; // 就算用户在后台也不加
    const f = fakeFactory();

    expect(createSystemNotification({ title: 'T' }, f.factory)).toBeNull();

    expect(unreadBadgeCount()).toBe(0);
    expect(h.badgeCalls).toEqual([]);
  });

  it('系统不支持通知时也不加未读（同上一格）', () => {
    h.settings = { notifyEnabled: true };
    h.supported = false;
    h.windows = [fakeWindow({ focused: false })];
    const f = fakeFactory();

    expect(createSystemNotification({ title: 'T' }, f.factory)).toBeNull();
    expect(unreadBadgeCount()).toBe(0);
  });

  it('★ 平台事实：setBadgeCount 在 Windows 上是 no-op —— 证据取自**本仓安装的** electron 类型声明', () => {
    const dts = readFileSync(
      join(process.cwd(), 'node_modules', 'electron', 'electron.d.ts'),
      'utf8',
    );
    const i = dts.indexOf('setBadgeCount(count?: number): boolean;');
    expect(i).toBeGreaterThan(-1);

    const doc = dts.slice(dts.lastIndexOf('/**', i), i);
    expect(doc).toContain('@platform linux,darwin'); // ← 只支持这两个平台
    expect(doc).not.toContain('win32');
  });
});

describe('结构级判据 —— 主进程里不许绕过门禁直接 new Notification', () => {
  const MAIN_DIR = join(process.cwd(), 'src', 'main');

  function tsFiles(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) tsFiles(p, acc);
      else if (name.endsWith('.ts')) acc.push(p);
    }
    return acc;
  }

  it('全主进程只有 notify.ts 里能出现 new Notification', () => {
    const offenders = tsFiles(MAIN_DIR)
      .filter((f) => !f.endsWith('notify.ts') && !f.endsWith('.test.ts'))
      .filter((f) => /new\s+Notification\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(MAIN_DIR.length + 1).replace(/\\/g, '/'));

    // 有新增创建点却忘了读开关时，这条会红 —— 那正是"漏一个等于没修"
    expect(offenders).toEqual([]);
  });

  it('未读徽标同理：全主进程只有 notify.ts 里能出现 setBadgeCount', () => {
    const offenders = tsFiles(MAIN_DIR)
      .filter((f) => !f.endsWith('notify.ts') && !f.endsWith('.test.ts'))
      .filter((f) => /\.setBadgeCount\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(MAIN_DIR.length + 1).replace(/\\/g, '/'));

    // 各自去调 = 迟早有人只调了 setBadgeCount 而忘了清零（或反过来）
    expect(offenders).toEqual([]);
  });

  it('两个已知创建点（自动化跑完 / notify:show）都经由本文件的门禁', () => {
    for (const rel of ['ipc/automation.ts', 'ipc/app.ts']) {
      const src = readFileSync(join(MAIN_DIR, rel), 'utf8');
      expect(src, rel).toContain('createSystemNotification(');
      expect(src, rel).toContain("from '../notify'");
    }
  });
});
