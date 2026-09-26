/**
 * 设置页 ⑥ 运行环境
 *
 * 页面结构：**一张卡**里依次是
 *   ① 「运行环境检查」头（左侧标题 + 「上次检查：时间」，右侧「重新检查」按钮）
 *   ② 「让 Agent 配置运行环境」说明行（长描述 + 绿色「让 Agent 配置」按钮）
 *   ③ 5 行工具明细（uv / Python / Git / LaTeX / draw.io）
 *   ④ 「模型供应商」状态行
 *
 * ⚠️ 项目契约工具行是**粗粒度 5 行**，而 `env.check()` 返回的是 15 项细粒度探测结果，
 * 所以这里要归并（映射关系见 `TOOL_ROWS`）：
 *   - `uv`      ← `uv`
 *   - `Python`  ← `python`
 *   - `Git`     ← `git`
 *   - `LaTeX`   ← `xelatex` + `latexmk` + `bibtex` 三项合并成一行，主项取 `xelatex`
 *   - `draw.io` ← `drawio`
 * Python 科学计算包（numpy/scipy/pandas/matplotlib/seaborn/python-dateutil）项目契约
 * **不单列一行**；为了不丢信息，只在有缺失时于 Python 行内补一行提示，
 * 同时原样进入「让 Agent 配置」的任务描述与确认框清单。
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../store/app';
import { t, tx } from '../../i18n';
import { openRoute } from '../../lib/settings-nav';
import { ConfirmDialog } from '../ConfirmDialog';
import { Icon } from '../Icon';
import { friendlyError } from '../../lib/friendly-error';

interface EnvItem {
  id: string;
  name: string;
  level: 'required' | 'recommended';
  status: 'ok' | 'missing' | 'unknown';
  detail?: string;
  /** 归一化版本号（主进程给，如 `0.11.6` / `TeX Live 2024`） */
  version?: string;
  /** 可执行文件绝对路径（主进程给） */
  path?: string;
  purpose: string;
}

/** 工具行状态：ok=绿点，warn=橙点（项目契约的「未找到（可选）」），pending=检测中 */
type RowStatus = 'ok' | 'warn' | 'pending';

interface ToolRow {
  id: string;
  /** 行标题（项目契约逐字） */
  name: string;
  status: RowStatus;
  /** 标题右侧的补充说明（项目契约只在未找到时显示「未找到（可选）」） */
  note?: string;
  /** 用途说明（项目契约逐字） */
  purpose: string;
  /** 次行「版本 · 绝对路径」；未找到或检测中为空 */
  spec?: string;
  /** 追加的一行提示（目前只有 Python 包缺失） */
  extra?: string;
  /** 行尾动作按钮 */
  action?: { label: string; onClick: () => void };
}

/** 项目契约顺序与标题 */
const TOOL_ROWS = [
  { id: 'uv', name: 'uv' },
  { id: 'python', name: 'Python' },
  { id: 'git', name: 'Git' },
  { id: 'latex', name: 'LaTeX' },
  { id: 'drawio', name: 'draw.io' },
] as const;

/** Python 科学计算包在 `env.check()` 里的 id 前缀 */
const PY_PKG_PREFIX = 'py:';

/** 「上次检查」时间戳的落点：localStorage（项目契约这个时间是持久化的，不随重进设置页丢失） */
const LAST_CHECKED_KEY = 'mathmodel.env.lastChecked';

function readLastChecked(): string | null {
  try {
    return window.localStorage.getItem(LAST_CHECKED_KEY);
  } catch {
    // 隐私模式 / 存储被禁用：退化成「尚未检查」，不影响检测本身
    return null;
  }
}

function writeLastChecked(iso: string): void {
  try {
    window.localStorage.setItem(LAST_CHECKED_KEY, iso);
  } catch {
    /* 忽略 */
  }
}

/** ISO 时间 → 项目契约的 `03:02:51` */
function formatClock(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** draw.io 的安装命令（按平台给一条可直接粘进终端的命令） */
function drawioInstallCommand(): string {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) {
    return 'winget install --id JGraph.Draw --exact --source winget --silent --accept-source-agreements --accept-package-agreements';
  }
  if (/Mac/i.test(ua)) return 'brew install --cask drawio';
  return tx('integrations.environmentSection.fixPrompt.drawioLinuxCommand');
}

export function EnvSection(): JSX.Element {
  const createSession = useApp((s) => s.createSession);
  const providers = useApp((s) => s.providers);
  const settings = useApp((s) => s.settings);
  const [items, setItems] = useState<EnvItem[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(readLastChecked);
  /** 确认弹窗是否打开（点「让 Agent 配置」先确认再动手） */
  const [confirming, setConfirming] = useState(false);
  /** 正在把任务交给 Agent（建会话 / 发送中） */
  const [installing, setInstalling] = useState(false);
  /** 页内轻提示：失败时用户还停在本页就看得见 */
  const [toast, setToast] = useState<{ title: string; detail?: string } | null>(null);

  const notify = useCallback((title: string, detail?: string): void => {
    setToast({ title, detail });
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const run = useCallback((): void => {
    setChecking(true);
    void window.mathmodel.env
      .check()
      .then((r) => {
        setItems((r as { items: EnvItem[] }).items ?? []);
        const iso = new Date().toISOString();
        writeLastChecked(iso);
        setLastChecked(iso);
      })
      .catch(() => setItems([]))
      .finally(() => setChecking(false));
  }, []);

  useEffect(run, [run]);

  const list = items ?? [];
  const byId = new Map(list.map((it) => [it.id, it]));
  const missing = list.filter((it) => it.status !== 'ok');
  const hasMissing = missing.length > 0;

  const pyPkgs = list.filter((it) => it.id.startsWith(PY_PKG_PREFIX));
  const missingPyPkgs = pyPkgs.filter((it) => it.status !== 'ok');

  /** 取某一行对应的探测项状态（未检测完 / 未拿到结果一律 pending） */
  const statusOf = (it: EnvItem | undefined): RowStatus => {
    if (!it || it.status === 'unknown') return 'pending';
    return it.status === 'ok' ? 'ok' : 'warn';
  };

  /** 项目契约次行格式：`版本 · 绝对路径`（拿不到 version 时退化成 detail） */
  const specOf = (it: EnvItem | undefined): string | undefined => {
    if (!it || it.status !== 'ok') return undefined;
    return [it.version, it.path].filter(Boolean).join(' · ') || it.detail;
  };

  const copyDrawioCommand = (): void => {
    const cmd = drawioInstallCommand();
    void navigator.clipboard?.writeText(cmd).then(
      () =>
        notify(
          tx('integrations.environmentSection.installCommandCopied'),
          tx('integrations.environmentSection.installCommandCopiedDescription'),
        ),
      () => notify(t('复制失败，请手动安装 draw.io 桌面版。')),
    );
  };

  /** 5 行工具明细（项目契约粒度） */
  const rows: ToolRow[] = TOOL_ROWS.map(({ id, name }) => {
    const purpose = tx(`integrations.environmentSection.toolDescriptions.${id}`);
    if (id === 'latex') {
      // 三项合并成一行：主项 xelatex（版本与路径都用它），latexmk/bibtex 只参与状态
      const xe = byId.get('xelatex');
      const merged = [xe, byId.get('latexmk'), byId.get('bibtex')].filter(Boolean) as EnvItem[];
      const status: RowStatus = merged.length
        ? merged.every((m) => m.status === 'ok')
          ? 'ok'
          : 'warn'
        : 'pending';
      return {
        id,
        name,
        status,
        purpose,
        spec: specOf(xe),
        // 合并项里主项（xelatex）缺失时给一行说明；只缺 latexmk/bibtex 时
        // 只留橙点（项目契约没有这种组合，不额外造文案）
        note: xe && xe.status !== 'ok' ? tx('integrations.environmentSection.notFound') : undefined,
      };
    }

    if (id === 'drawio') {
      const it = byId.get('drawio');
      const status = statusOf(it);
      return {
        id,
        name,
        status,
        purpose,
        spec: specOf(it),
        // 项目契约：draw.io 未找到时标题后就地显示「未找到（可选）」，且不给版本行
        note: status === 'warn' ? tx('integrations.environmentSection.notFoundOptional') : undefined,
        action: status === 'warn' ? { label: tx('integrations.environmentSection.copyInstallCommand'), onClick: copyDrawioCommand } : undefined,
      };
    }

    const it = byId.get(id);
    const status = id === 'python' && missingPyPkgs.length > 0 ? 'warn' : statusOf(it);
    return {
      id,
      name,
      status,
      purpose,
      spec: specOf(it),
      extra:
        id === 'python' && missingPyPkgs.length > 0
          ? t('建模包不完整，缺少 {{count}} 个：{{names}}', {
              count: missingPyPkgs.length,
              names: missingPyPkgs.map((p) => p.name).join('、'),
            })
          : undefined,
    };
  });

  // ── 模型供应商（项目契约列表末行）──
  const activeProvider = providers.find((p) => p.id === settings?.activeProviderId) ?? null;
  const providerConfigured = Boolean(activeProvider?.apiKey);
  const providerName = activeProvider?.name ?? 'Anthropic';
  const providerSpec = providerConfigured
    ? [settings?.defaultModel ?? activeProvider?.models?.[0], activeProvider?.baseUrl].filter(Boolean).join(' · ')
    : undefined;
  const providerStatus = providerSpec ?? 'No model API configured — connect a provider in Settings → Providers';

  const checkedClock = lastChecked ? formatClock(lastChecked) : null;

  /** 把缺失项拼成一段「交给 Agent 的安装任务」（对应项目契约 fixPrompt 的语义） */
  const buildRepairPrompt = (): string => {
    const broken = missing.length
      ? missing.map((it) => `- ${it.name}（${it.level === 'required' ? '必需' : '推荐'}）：${it.purpose}`).join('\n')
      : '- 全部通过则做一次冒烟验证即可';
    return (
      `请修复本机建模运行环境。环境检测发现以下问题：\n${broken}\n` +
      `我已经在运行环境页确认允许安装，不要再次询问是否开始。\n` +
      `要求：\n1. 所有首次下载默认走国内镜像：Python 包和 uv 用清华源 https://pypi.tuna.tsinghua.edu.cn/simple，Git 用 npmmirror，LaTeX 用清华 CTAN；镜像不可用时再自动换官方源；\n` +
      `2. draw.io 优先走可信的国内加速并核对官方哈希与签名；不可用时再用 winget。Windows 安装包必须通过 PowerShell 调用，不要从 Git Bash 直接运行 msiexec；\n` +
      `3. 只安装检测到的缺失项，使用当前用户级安装；每完成一类就重新检测，安装完成后自动做一次完整复检；\n` +
      `4. 对话中的过程和总结全部使用简短中文。不要逐条展示命令、下载速度、PATH、退出码或大段日志；可恢复的问题说“正在重试”或“正在换一种办法”，原始信息只在需要排查时提供；\n` +
      `5. 最后只用几句话说明装好了什么、还有什么没完成。只有需要密码或新的用户选择时才停下来询问。`
    );
  };

  /**
   * 真·一键：确认后由本函数把安装任务**直接发给 Agent**（喂进输入框再自动发送）。
   *
   * ⚠️ **顺序就是这个函数的判据：必须是「先 `await send` 落库 → 再跳页」，不许改成并发。**
   *
   * 为什么（A5d/A5e 报的就是这条，运行测试 10.27s 等不到自己那句话）：
   *   `ChatPage` **只在挂载时**拉一次历史（`useEffect` → `session.get`），
   *   之后只认 `session-end` 那一次对账。所以「跳页那一刻库里有没有这条消息」就是全部。
   *   而 `SESSION_SEND` 在落库**之前**还有一次 `await captureCheckpoint(cwd)`
   *   （给这条消息打工作区快照，P0 的分叉要用），实测「点击 → 这条用户消息能查到」
   *   要 **546ms**（`p5c` 的 `L5a`）；跳页本身是 0ms。
   *   ⇒ 先跳页的话，ChatPage 挂载时库里**还没有**这条消息，之后再没人去读它，
   *     用户看到的是一个**空对话**；要等 agent 整轮跑完 `session-end` 触发对账才冒出来。
   *     装环境恰恰是长任务（几十分钟），用户全程看不到自己发的那句话 = 「点了像没反应」。
   *
   *   ⚠️ 本函数上面这段注释**曾经写着相反的顺序**（「send 由主进程同步落库…所以先 send 再跳页是对的」）——
   *   那句在写下的当时成立，但后来 `SESSION_SEND` 里插入了 `await captureCheckpoint`，
   *   **落库不再与 send 同步**，假设被打破而注释没跟着改。A5d/A5e 就是这条过期假设的判据。
   *
   * `await sent` 等的是「用户消息落库 + CLI 已经起跑」，**不是**等整轮跑完：
   * 主进程 `runner.run()` 是 fire-and-forget，`SESSION_SEND` 落下用户消息后立刻返回
   * `{ messageId }`。所以最多多等那 ~546ms，期间确认框处于 `busy` 态（`installing`）。
   *
   * 流式增量不会丢：真正的 agent 事件要等 CLI 起来（数百 ms）才有，
   * 而 ChatPage 一个渲染帧内就订阅好了；且 `session-end` 还会再拉一次历史对账。
   */
  const startInstall = async (): Promise<void> => {
    /** 只用于 catch 里选择报错通道：跳页之后页内 toast 就看不见了 */
    let navigated = false;
    setInstalling(true);
    try {
      const text = buildRepairPrompt();
      let sid = useApp.getState().activeSessionId;
      if (!sid) {
        const meta = await createSession(tx('integrations.environmentSection.configureTitle'));
        if (!meta) throw new Error(tx('integrations.environmentSection.fixSessionFailed'));
        sid = meta.id;
      }
      // ★ 先落库（见上面注释：这一 await 是 A5d/A5e 的修复本体）
      await window.mathmodel.session.send(sid, text);
      // 走到这里用户那条消息已经在库里了 —— 现在跳页，ChatPage 挂载拉到的历史里就有它
      openRoute('chat');
      navigated = true;
      setConfirming(false);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e ?? '');
      const msg = friendlyError(e, '环境操作没有完成，可以重试。');
      // A5e 护栏：失败提示必须带上底层原因（没有被友好化覆盖时原样追加），绝不静默吞掉。
      const detail = raw.trim() && !msg.includes(raw) ? `${msg}（${raw}）` : msg;
      // 正常路径下失败时**还停在运行环境分区**（跳页在 send 成功之后），页内 toast 看得见；
      // 只有 `openRoute` 派发之后那一小段（`navigated=true`，极窄）才需要 alert 兜底。
      // 两条通道都保留：绝不静默。
      if (navigated) window.alert(t('发送失败：{{msg}}', { msg: detail }));
      else notify(t('启动安装失败：{{msg}}', { msg: detail }));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="col env-root" style={{ gap: 16 }}>
      <div className="panel env-card">
        {/* ── ① 运行环境检查 + 上次检查 + 重新检查 ── */}
        <div className="env-head">
          {/* 标题与「上次检查」之间不加 gap：项目契约两行的间距就是两行盒的高度（见 pages.css 注释） */}
          <div className="col" style={{ minWidth: 0 }}>
            <span className="env-head-title">{tx('integrations.environmentSection.runtimeCheck')}</span>
            <span className="env-head-meta">
              {checkedClock
                ? tx('integrations.environmentSection.lastChecked', { time: checkedClock })
                : tx('integrations.environmentSection.notCheckedYet')}
            </span>
          </div>
          <button className="btn env-btn env-row-action" onClick={run} disabled={checking}>
            <Icon name="refresh-cw" size={13} className={checking ? 'env-spin' : undefined} />
            {tx('integrations.environmentSection.recheck')}
          </button>
        </div>

        {/* ── ② 让 Agent 配置运行环境 ── */}
        <div className="env-row">
          <div className="env-row-main">
            <span className="env-row-title">{tx('integrations.environmentSection.configureTitle')}</span>
            <span className="env-row-desc">本机安装一次，所有项目共用。优先复用已有工具，只补缺少的依赖，不再为新项目重复安装。新增 Python 库保存在软件数据目录的 runtime 中，已有系统工具不搬动。</span>
          </div>
          <button
            className="btn env-btn btn-primary env-row-action"
            onClick={() => setConfirming(true)}
            disabled={checking || items === null || installing}
            title={tx('integrations.environmentSection.issuesDetectedDescription')}
          >
            <Icon name="sparkles" size={13} />
            {tx('integrations.environmentSection.configureWithAgent')}
          </button>
        </div>

        {/* ── ③ 5 行工具明细（项目契约粒度）── */}
        {rows.map((r) => (
          <div className="env-row" key={r.id}>
            <div className="env-row-main">
              <div className="env-row-head">
                <span className={`env-dot ${r.status}`} />
                <span className="env-row-title">{r.name}</span>
                {r.note ? <span className="env-row-note">{r.note}</span> : null}
              </div>
              <span className="env-row-desc">{r.purpose}</span>
              {r.spec ? <span className="env-row-spec">{r.spec}</span> : null}
              {r.extra ? <span className="env-row-extra">{r.extra}</span> : null}
            </div>
            {r.action ? (
              <button className="btn env-btn env-row-action" onClick={r.action.onClick}>
                {r.action.label}
              </button>
            ) : null}
          </div>
        ))}

        {/* ── ④ 模型供应商 ── */}
        <div className="env-row">
          <div className="env-row-main">
            <div className="env-row-head">
              <span className={`env-dot ${providerConfigured ? 'ok' : 'warn'}`} />
              <span className="env-row-title">{tx('integrations.environmentSection.apiConnectivity')}</span>
              <span className="env-row-note">{providerName}</span>
            </div>
            <span className="env-row-desc">{providerStatus}</span>
          </div>
        </div>
      </div>

      {/* 检测彻底失败（IPC 报错）时的兜底：正常路径下走不到这里 */}
      {items !== null && items.length === 0 ? (
        <div className="panel muted" style={{ padding: 14, fontSize: 12.5 }}>
          {t('没有拿到检测结果。')}
        </div>
      ) : null}

      {/* ── 页内轻提示（复制安装命令 / 建会话失败 / 发送失败）── */}
      {toast ? (
        <div className="panel-toast">
          <div>{toast.title}</div>
          {toast.detail ? <div style={{ opacity: 0.75 }}>{toast.detail}</div> : null}
        </div>
      ) : null}

      {/* ── 一键安装前的确认框：先把「要装什么」摊开给用户看 ── */}
      <ConfirmDialog
        open={confirming}
        title={tx('integrations.environmentSection.configureTitle')}
        description={tx('integrations.environmentSection.issuesDetectedDescription')}
        items={missing.map(
          (it) => `${it.name} · ${it.level === 'required' ? t('必需') : t('推荐')} —— ${it.purpose}`,
        )}
        itemsLabel={t('将交给 Agent 安装以下缺失项：')}
        footnote={
          hasMissing
            ? t(
                'Agent 会在本机执行安装：所有首次下载默认走国内镜像，镜像不可用时再换官方源。只有需要密码或新的选择时才会问你。',
              )
            : t('本次检测没有发现缺失项。仍可让 Agent 复核一遍整机环境，确认建模工作流所需配置齐全。')
        }
        confirmLabel={hasMissing ? t('开始安装') : t('让 Agent 复核')}
        cancelLabel={tx('common.cancel')}
        busy={installing}
        busyLabel={tx('integrations.environmentSection.installing')}
        onConfirm={() => void startInstall()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
