/**
 * 终端面板 —— 真实 PTY，不是黑箱执行。
 *
 * 复刻原版的取舍：agent 跑数学建模任务时要执行 python / latex / git，
 * 用户希望**看得见**它在跑什么，所以给一个真终端，而不是把命令藏起来。
 *
 * ⚠️ 关于 xterm.js
 *   本文件刻意**不引入 xterm.js 依赖**，而是自己实现了一个极简终端：
 *   用 <pre> 累积输出 + 一个隐形 input 捕获按键，ANSI 序列做最小化处理。
 *
 *   为什么不直接上 xterm.js：
 *     1. xterm.js 需要额外 3 个包（xterm / xterm-addon-fit / xterm-addon-web-links），
 *        而 terminal 面板在原版里是**次要功能**，不值得为它增加打包体积；
 *     2. 我们的 node-pty 后端已经把 PTY 语义做好了，前端只需要「显示 + 回传按键」；
 *     3. 极简实现能保证**零新依赖即可编译通过** —— 先让骨架跑起来，
 *        后续若要更完整的终端仿真（vim / htop），再把这里替换成 xterm.js 即可，
 *        后端 IPC 契约完全不用动。
 *
 * ⚠️ 关键交互：Ctrl+C 必须能发给子进程
 *   终端的价值一半在于能中断。这里对 Ctrl+C / Ctrl+D / Ctrl+L / Ctrl+Z
 *   做了显式映射，不依赖浏览器的默认行为（Chromium 会拦截一部分）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../store/app';
import { t, tx } from '../i18n';

/** 可打印的最小 ANSI 清理：把颜色/光标控制序列去掉，保留换行与制表 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s
    .replace(/\u001b\][^\u0007]*\u0007/g, '') // OSC ... BEL
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '') // CSI
    .replace(/\u001b[()][A-Za-z0-9]/g, '') // 字符集选择
    .replace(/\u001b[=>]/g, '')
    .replace(/\r(?!\n)/g, '\n'); // 裸 CR 当作换行
}

const MAX_CHARS = 400_000;

export function TerminalPanel(): JSX.Element {
  const project = useApp((s) => s.currentProject);

  const [termId, setTermId] = useState<string | null>(null);
  const [pid, setPid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exited, setExited] = useState<number | null>(null);
  const [input, setInput] = useState('');

  /** 输出缓冲 —— 用 ref 攒，按帧刷到 state，避免每个数据块都触发渲染 */
  const bufRef = useRef('');
  const flushRef = useRef<number | null>(null);
  const [output, setOutput] = useState('');

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const scheduleFlush = useCallback(() => {
    if (flushRef.current !== null) return;
    flushRef.current = window.setTimeout(() => {
      flushRef.current = null;
      let text = stripAnsi(bufRef.current);
      if (text.length > MAX_CHARS) text = text.slice(text.length - MAX_CHARS);
      setOutput(text);
      // 自动滚到底
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }, 40);
  }, []);

  // ── 订阅终端输出 ────────────────────────────────────────
  useEffect(() => {
    const offData = window.mathmodel.terminal.onData((id, data) => {
      if (id !== termId) return;
      bufRef.current += data;
      scheduleFlush();
    });
    const offExit = window.mathmodel.terminal.onExit((id, code) => {
      if (id !== termId) return;
      setExited(code);
      bufRef.current += `\n${tx('dock.terminalPanel.processExited', { code })}\n`;
      scheduleFlush();
    });
    return () => {
      offData();
      offExit();
    };
  }, [termId, scheduleFlush]);

  // ── 卸载时清掉终端 ──────────────────────────────────────
  useEffect(() => {
    return () => {
      if (flushRef.current !== null) window.clearTimeout(flushRef.current);
    };
  }, []);

  const start = useCallback(async () => {
    if (!project) return;
    setError(null);
    setExited(null);
    bufRef.current = '';
    setOutput('');
    try {
      const res = await window.mathmodel.terminal.create(project.root, 100, 30);
      setTermId(res.termId);
      setPid(res.pid);
      // 等一帧让 ref 挂上
      setTimeout(() => inputRef.current?.focus(), 60);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [project]);

  const stop = useCallback(async () => {
    if (!termId) return;
    await window.mathmodel.terminal.kill(termId).catch(() => undefined);
    setTermId(null);
    setPid(null);
    setExited(null);
  }, [termId]);

  const send = useCallback(
    async (data: string) => {
      if (!termId) return;
      await window.mathmodel.terminal.write(termId, data).catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
    },
    [termId],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!termId) return;
    // Ctrl 组合键：既要发给子进程，也要阻止 Chromium 抢走
    if (e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'c') {
        e.preventDefault();
        void send('\u0003');
        return;
      }
      if (k === 'd') {
        e.preventDefault();
        void send('\u0004');
        return;
      }
      if (k === 'l') {
        e.preventDefault();
        void send('\u000c');
        return;
      }
      if (k === 'z') {
        e.preventDefault();
        void send('\u001a');
        return;
      }
      if (k === 'u') {
        e.preventDefault();
        void send('\u0015');
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      void send(`${input}\r`);
      setInput('');
      return;
    }
    if (e.key === 'Backspace' && input.length === 0) {
      e.preventDefault();
      void send('\u007f');
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      void send('\t');
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      void send('\u001b[A');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      void send('\u001b[B');
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      void send('\u001b');
    }
  };

  if (!project) {
    return <div className="empty">{t('先打开一个项目，终端才有工作目录。')}</div>;
  }

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row" style={{ padding: '8px 10px', gap: 6, flexShrink: 0 }}>
        {termId ? (
          <>
            <span className="statusbar-dot ok" />
            <span className="muted mono" style={{ fontSize: 10 }}>
              PID {pid ?? '—'}
            </span>
            <div className="grow" />
            <button className="btn btn-sm btn-ghost" title={tx('dock.terminalPanel.restartTerminal')} onClick={() => void stop().then(start)}>
              ⟳
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => void stop()}>
              {t('结束')}
            </button>
          </>
        ) : (
          <>
            <span className="muted grow" style={{ fontSize: 11 }}>
              {exited !== null ? t('已退出（{{code}}）', { code: exited }) : t('终端未启动')}
            </span>
            <button className="btn btn-sm btn-primary" onClick={() => void start()}>
              {t('启动')}
            </button>
          </>
        )}
      </div>

      <div className="divider" style={{ margin: 0 }} />

      {error && (
        <div
          style={{
            padding: '10px 12px',
            fontSize: 11,
            lineHeight: 1.7,
            color: 'var(--danger)',
            background: 'var(--bg-sunken)',
            borderBottom: '1px solid var(--border-weak)',
          }}
        >
          {error}
        </div>
      )}

      {/* ── 输出区 ── */}
      <div
        ref={scrollRef}
        onClick={() => inputRef.current?.focus()}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          background: 'var(--code-bg)',
          cursor: 'text',
        }}
      >
        {!termId && !output && !error && (
          <div className="empty" style={{ padding: 24, fontSize: 12 }}>
            {t('点「启动」开一个 PowerShell。')}
            <br />
            {t('可以用它跑 python、装依赖、编译 LaTeX。')}
          </div>
        )}
        <pre
          style={{
            margin: 0,
            padding: '8px 10px',
            fontSize: 11,
            lineHeight: 1.45,
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: 'var(--fg-secondary)',
          }}
        >
          {output}
        </pre>
      </div>

      {/* ── 输入行（隐形 input 承接键盘）── */}
      <div
        className="row"
        style={{
          flexShrink: 0,
          padding: '4px 8px',
          gap: 6,
          borderTop: '1px solid var(--border-weak)',
          background: 'var(--bg-panel)',
        }}
      >
        <span className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>
          ›
        </span>
        <input
          ref={inputRef}
          className="composer-input"
          style={{ minHeight: 24, padding: '2px 4px', flex: 1, fontSize: 12 }}
          value={input}
          disabled={!termId}
          spellCheck={false}
          autoComplete="off"
          placeholder={termId ? t('输入命令，回车执行（Ctrl+C 中断）') : t('终端未启动')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
