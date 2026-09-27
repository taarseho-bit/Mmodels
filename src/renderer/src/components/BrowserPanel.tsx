/**
 * 浏览器面板 —— 当前实现应用约定 `BrowserPanel` 的**内嵌后端**（`dock.browserPanel.backendInApp`）。
 *
 * 应用约定有两个后端：
 *   - `backendInApp` 内嵌浏览器（独立登录态，功能完整）→ 本文件实现
 *   - `backendChrome` 复用你自己的 Chrome（需要装扩展配对）→ **当前版本不实现**，
 *     它依赖应用约定的 MCP Bridge 扩展，与本项目「不联网、不自建账号体系」的前提冲突。
 *
 * 为什么用 `document.createElement('webview')` 而不是 JSX：
 *   React 不认识 `<webview>`，要额外补 JSX 类型声明；而且命令式创建
 *   能直接挂 Electron 的原生事件（did-navigate / page-title-updated …），
 *   比把事件透传成 props 更可靠。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState } from './PageShell';
import { Icon } from './Icon';
import { tx } from '../i18n';

interface Tab {
  id: string;
  /** 当前地址（空 = 新标签页） */
  url: string;
  /** 页面标题 */
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** 只允许 http/https —— 挡掉 file:// 与自定义协议 */
function normalize(input: string): string {
  const s = input.trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  // 看着像域名就补 https，否则走搜索
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s) && !s.includes(' ')) return `https://${s}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(s)}`;
}

let seq = 0;
const newId = (): string => `tab-${Date.now().toString(36)}-${++seq}`;

/**
 * webview 的原生事件回调（Electron 用 `addEventListener` 暴露，
 * 事件对象上的方法不在标准 DOM 类型里，这里按需收窄）。
 */
type WvEvent = { url?: string } & Event;

interface WvElement extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  getWebContentsId(): number;
  /** 打开该 webview 的 DevTools（独立窗口），对应应用约定 browser.openDevTools */
  openDevTools(): void;
  isDevToolsOpened(): boolean;
  closeDevTools(): void;
}

/**
 * ⚠️ **在 `dom-ready` 之前调用 webview 的 getURL / getTitle / canGoBack 会抛异常**：
 *     「The WebView must be attached to the DOM and the dom-ready event emitted
 *       before this method can be called.」
 *    而且这个异常会冒泡成 React 未捕获错误，**整个面板崩掉**。
 *    所以所有读取方法一律包一层 try。
 */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** 由宿主组件维护的「已 dom-ready」标记 */
const readyMap = new WeakMap<WvElement, boolean>();

export function BrowserPanel(): JSX.Element {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  /** webview 元素按标签 id 挂在容器里，切标签只切显隐，不重建（否则状态全丢） */
  const wvRefs = useRef<Map<string, WvElement>>(new Map());
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const active = tabs.find((t) => t.id === activeId) ?? null;

  // 地址栏跟随当前标签
  useEffect(() => {
    setAddress(active?.url ?? '');
  }, [active?.id, active?.url]);

  const patch = useCallback((id: string, p: Partial<Tab>): void => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }, []);

  /** 创建 webview 元素并挂原生事件 */
  const attach = useCallback(
    (id: string, el: WvElement | null): void => {
      if (!el) {
        wvRefs.current.delete(id);
        return;
      }
      if (wvRefs.current.get(id) === el) return;
      wvRefs.current.set(id, el);

      // 标记就绪：只有 dom-ready 之后才能安全调用 getURL/getTitle/canGoBack
      el.addEventListener('dom-ready', () => {
        readyMap.set(el, true);
      });

      el.addEventListener('did-start-loading', () => patch(id, { loading: true }));
      el.addEventListener('did-stop-loading', () => {
        const wv = wvRefs.current.get(id);
        if (!wv) return;
        patch(id, {
          loading: false,
          url: safe(() => wv.getURL(), ''),
          title: safe(() => wv.getTitle(), ''),
          canGoBack: safe(() => wv.canGoBack(), false),
          canGoForward: safe(() => wv.canGoForward(), false),
        });
      });
      el.addEventListener('did-navigate', (e) => {
        const wv = wvRefs.current.get(id);
        patch(id, {
          url: (e as WvEvent).url ?? safe(() => wv?.getURL() ?? '', ''),
          canGoBack: safe(() => wv?.canGoBack() ?? false, false),
          canGoForward: safe(() => wv?.canGoForward() ?? false, false),
        });
      });
      el.addEventListener('did-navigate-in-page', (e) => {
        patch(id, { url: (e as WvEvent).url ?? '' });
      });
      el.addEventListener('page-title-updated', (e) => {
        patch(id, { title: (e as WvEvent & { title?: string }).title ?? '' });
      });
      el.addEventListener('did-fail-load', (e) => {
        // -3 是用户主动中断（点停止/跳转），不算失败
        const code = (e as WvEvent & { errorCode?: number }).errorCode;
        if (code === -3) return;
        patch(id, { loading: false });
      });
    },
    [patch],
  );

  const addTab = useCallback(
    (url = ''): string => {
      const id = newId();
      setTabs((prev) => [
        ...prev,
        { id, url, title: '', loading: false, canGoBack: false, canGoForward: false },
      ]);
      setActiveId(id);
      return id;
    },
    [],
  );

  // 首次进入给一个空白标签
  useEffect(() => {
    if (tabs.length === 0) addTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeTab = (id: string): void => {
    const wv = wvRefs.current.get(id);
    if (wv) {
      try {
        wv.remove();
      } catch {
        /* 元素已分离 */
      }
      wvRefs.current.delete(id);
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) setActiveId(next.length ? next[next.length - 1].id : null);
      // 关掉最后一个标签就再开一个空白页，避免面板变空
      if (next.length === 0) {
        const nid = newId();
        setActiveId(nid);
        return [{ id: nid, url: '', title: '', loading: false, canGoBack: false, canGoForward: false }];
      }
      return next;
    });
  };

  /**
   * 地址栏回车 → 只更新状态，**真正的导航交给 WebviewHost**。
   * 这里绝不直接调 `wv.loadURL()`：一旦 webview 尚未 dom-ready，
   * 那个调用会抛异常并掀掉整个面板（踩过）。统一走一条导航路径。
   */
  const go = (raw: string): void => {
    const url = normalize(raw);
    if (!url || !active) return;
    patch(active.id, { url, loading: true });
  };
  if (!active) {
    return (
      <EmptyState
        icon={<Icon name="globe" size={22} />}
        title={tx('dock.rightPanel.browser')}
        description={tx('dock.browserPanel.blankHint')}
      />
    );
  }

  return (
    <div className="col" style={{ height: '100%', minHeight: 0, position: 'relative' }}>
      {/* ── 标签栏 ── */}
      <div className="br-tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`br-tab${t.id === activeId ? ' active' : ''}`}
            onClick={() => setActiveId(t.id)}
            role="presentation"
            title={t.url || tx('dock.browserPanel.untitledPage')}
          >
            {t.loading ? <span className="br-tab-spin" /> : <span className="br-tab-dot" />}
            <span className="truncate grow">{t.title || tx('dock.browserPanel.untitledPage')}</span>
            <button
              className="br-tab-x"
              title={tx('dock.browserPanel.closeTab')}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button className="br-newtab" title={tx('dock.browserPanel.newTab')} onClick={() => addTab()}>
          ＋
        </button>
      </div>

      {/* ── 地址栏 ── */}
      <div className="br-bar">
        <button
          className="btn btn-sm btn-ghost"
          disabled={!active.canGoBack}
          title={tx('common.previous')}
          onClick={() => {
            const wv = wvRefs.current.get(active.id);
            if (wv) safe(() => wv.goBack(), undefined);
          }}
        >
          ‹
        </button>
        <button
          className="btn btn-sm btn-ghost"
          disabled={!active.canGoForward}
          title={tx('common.next')}
          onClick={() => {
            const wv = wvRefs.current.get(active.id);
            if (wv) safe(() => wv.goForward(), undefined);
          }}
        >
          ›
        </button>
        <button
          className="btn btn-sm btn-ghost"
          title={active.loading ? tx('common.cancel') : tx('common.refresh')}
          onClick={() => {
            const wv = wvRefs.current.get(active.id);
            if (!wv) return;
            safe(() => (active.loading ? wv.stop() : wv.reload()), undefined);
          }}
        >
          {active.loading ? '✕' : '⟳'}
        </button>

        <input
          className="input grow"
          style={{ height: 26, fontSize: 12 }}
          placeholder={tx('dock.browserPanel.addressPlaceholder')}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(address);
          }}
        />

        <button
          className="btn btn-sm btn-ghost"
          title={tx('dock.browserPanel.copyLink')}
          onClick={() => {
            void navigator.clipboard?.writeText(active.url).then(
              () => setToast(tx('common.copied')),
              () => setToast(tx('common.copyFailed')),
            );
          }}
        >
          <Icon name="link-2" size={14} />
        </button>
        <button
          className="btn btn-sm btn-ghost"
          title={tx('dock.browserPanel.copyScreenshot')}
          onClick={() => {
            const wv = wvRefs.current.get(active.id);
            if (!wv) return;
            void (async () => {
              try {
                const id = safe(() => wv.getWebContentsId(), -1);
                if (id < 0) {
                  setToast(tx('common.copyFailed'));
                  return;
                }
                const r = (await window.mathmodel.browser.capture(id)) as { ok: boolean };
                setToast(r.ok ? tx('common.copied') : tx('common.copyFailed'));
              } catch {
                setToast(tx('common.copyFailed'));
              }
            })();
          }}
        >
          <Icon name="camera" size={14} />
        </button>
        <button
          className="btn btn-sm btn-ghost"
          title={tx('dock.browserPanel.openDevTools')}
          onClick={() => {
            const wv = wvRefs.current.get(active.id);
            if (!wv) return;
            // 对应应用约定 browser.openDevTools：给当前标签开独立 DevTools 窗口；
            // 已打开时再点一次就关闭（与应用约定 toggle 行为一致）
            safe(() => {
              if (wv.isDevToolsOpened()) wv.closeDevTools();
              else wv.openDevTools();
            }, undefined);
          }}
        >
          <Icon name="wrench" size={14} />
        </button>
      </div>

      {/* ── 页面容器：每个标签一个 webview，切标签只切显隐 ── */}
      <div className="br-host" ref={hostRef}>
        {tabs.map((t) => (
          <WebviewHost key={t.id} tabId={t.id} url={t.url} hidden={t.id !== activeId} attach={attach} />
        ))}

        {!active.url && !active.loading ? (
          <div className="br-blank">{tx('dock.browserPanel.blankHint')}</div>
        ) : null}
      </div>

      {toast ? <div className="panel-toast">{toast}</div> : null}
    </div>
  );
}

/**
 * 承载单个 `<webview>` 的宿主。
 * 用 ref 回调在挂载时创建元素 —— 见文件顶部说明。
 *
 * ⚠️ 导航必须等 `dom-ready`。在此之前 `loadURL/getURL` 都会抛
 *    「The WebView must be attached to the DOM and the dom-ready event emitted…」，
 *    并且这个异常会掀掉整个面板（踩过一次）。
 */
function WebviewHost({
  tabId,
  url,
  hidden,
  attach,
}: {
  tabId: string;
  url: string;
  hidden: boolean;
  attach: (id: string, el: WvElement | null) => void;
}): JSX.Element {
  const elRef = useRef<HTMLDivElement | null>(null);
  const wvRef = useRef<WvElement | null>(null);
  const readyRef = useRef(false);
  /** dom-ready 之前拿到的目标地址，就绪后补投 */
  const pendingRef = useRef<string>('');

  const navigate = useCallback((target: string): void => {
    const wv = wvRef.current;
    if (!wv) return;
    if (!readyRef.current) {
      pendingRef.current = target; // 还没就绪，先挂起
      return;
    }
    // 已经在这个地址上就不重复导航（否则会打断页面状态）
    const cur = safe(() => wv.getURL(), '');
    if (cur === target) return;
    void wv.loadURL(target).catch(() => undefined);
  }, []);

  useEffect(() => {
    const host = elRef.current;
    if (!host) return;
    let wv = host.querySelector('webview') as WvElement | null;
    if (!wv) {
      wv = document.createElement('webview') as unknown as WvElement;
      // 安全基线：禁 node、关 preload、开 contextIsolation（主进程还会再加固一次）
      wv.setAttribute('nodeintegration', 'false');
      wv.setAttribute('allowpopups', 'false');
      wv.setAttribute('partition', 'persist:browser-panel');
      /**
       * ⚠️ 必须给一个初始 src。
       * 没有 src 的 webview **不会触发 `dom-ready`**，
       * 于是 readyRef 永远是 false → 所有导航被无限挂起，
       * 而地址栏那条直接调 loadURL 的路径又会抛
       * 「The WebView must be attached to the DOM and the dom-ready event emitted…」。
       * 用 about:blank 让它立即就绪。
       */
      wv.setAttribute('src', 'about:blank');
      wv.style.width = '100%';
      wv.style.height = '100%';
      wv.style.border = 'none';
      host.appendChild(wv);
      wvRef.current = wv;
    }

    // 关键：就绪前不碰任何 webview 方法
    const onReady = (): void => {
      readyRef.current = true;
      if (pendingRef.current) {
        const t = pendingRef.current;
        pendingRef.current = '';
        navigate(t);
      }
    };
    wv.addEventListener('dom-ready', onReady);

    attach(tabId, wv);

    return () => {
      wv?.removeEventListener('dom-ready', onReady);
      attach(tabId, null);
      wvRef.current = null;
      readyRef.current = false;
    };
  }, [tabId, attach, navigate]);

  // 地址变化时导航（空值不动）
  useEffect(() => {
    if (!url) return;
    navigate(url);
  }, [url, navigate]);

  return <div ref={elRef} className="br-view" style={{ display: hidden ? 'none' : 'block' }} />;
}
