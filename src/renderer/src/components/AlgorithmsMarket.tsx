/**
 * 算法市场 —— 对应原版 ExtensionsPage 的 algorithmsSection。
 *
 * 原版语义（从 chunk 还原）：
 *   - 目录来源 remote/cache/bundled，本地版固定 bundled（离线可用，既定优化）
 *   - 7 类任务筛选：全部/决策/预测/分类/聚类/优化/多目标/统计
 *   - Python 运行时状态机：ready / installable / no-python / broken
 *     → no-python 时显示「一键安装 Python」（走 npmmirror 镜像静默安装）
 *   - 每个条目：依赖包/许可证/适用场景/输入/输出/不适用 + 安装按钮（pip 直装）
 *   - 「在项目中使用」→ 把算法用法提示填进输入框（原版 useInProject 语义）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/app';
import { Icon } from './Icon';
import { tx, t } from '../i18n';
import { friendlyError } from '../lib/friendly-error';

type RuntimeState = 'ready' | 'installable' | 'no-python' | 'broken';

interface AlgoEntry {
  id: string;
  name: string;
  task: string;
  packageName: string;
  versionRange: string;
  license: string;
  summary: string;
  suitableFor: string[];
  inputs: string[];
  outputs: string[];
  notFor: string[];
  docs: string;
  installed: boolean;
  installing: boolean;
}

interface Snapshot {
  source: string;
  catalogVersion: number;
  python: { state: RuntimeState; cmd: string | null; version: string; pipOk: boolean };
  algorithms: AlgoEntry[];
}

export function AlgorithmsMarket(): JSX.Element {
  const fillPrompt = useApp((s) => s.fillPrompt);
  // 语言切换后随重渲染重建（模块顶层调用 t()/tx() 只求值一次，切语言不生效）
  const tasks: Array<{ key: string; label: string }> = [
    { key: 'all', label: tx('extensions.algorithmsSection.tasks.all') },
    { key: 'decision', label: t('决策评价') },
    { key: 'prediction', label: tx('extensions.algorithmsSection.tasks.prediction') },
    { key: 'classification', label: tx('extensions.algorithmsSection.tasks.classification') },
    { key: 'clustering', label: tx('extensions.algorithmsSection.tasks.clustering') },
    { key: 'optimization', label: tx('extensions.algorithmsSection.tasks.optimization') },
    { key: 'multiObjective', label: tx('extensions.algorithmsSection.tasks.multiObjective') },
    { key: 'statistics', label: tx('extensions.algorithmsSection.tasks.statistics') },
  ];
  const runtimeLabel: Record<RuntimeState, string> = {
    ready: t('就绪'),
    installable: tx('extensions.extensionsPage.groupAvailable'),
    'no-python': t('未检测到 Python'),
    broken: t('Python 异常'),
  };
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [pyInstalling, setPyInstalling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback((): void => {
    setLoading(true);
    void window.mathmodel.algorithms
      .list()
      .then(setSnap)
      .catch((e) => setError(friendlyError(e, '算法目录暂时没有读取成功，可以重试。')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  // 安装日志流
  useEffect(() => {
    const off = window.mathmodel.algorithms.onInstallProgress((line) => {
      setLogs((prev) => [...prev.slice(-200), line]);
    });
    return off;
  }, []);

  useEffect(() => {
    const box = logBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [logs]);

  const filtered = useMemo(() => {
    if (!snap) return [];
    let list = snap.algorithms;
    if (task !== 'all') list = list.filter((a) => a.task === task);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.packageName.toLowerCase().includes(q) ||
          a.summary.toLowerCase().includes(q),
      );
    }
    return list;
  }, [snap, task, query]);

  const installPkg = useCallback(
    async (a: AlgoEntry): Promise<void> => {
      setInstalling(a.id);
      setError(null);
      setLogs([]);
      try {
        const r = await window.mathmodel.algorithms.install(a.packageName);
        if (!r.ok) setError(t('「{{pkg}}」安装失败（退出码 {{code}}），可查看下方日志。', { pkg: a.packageName, code: r.code }));
        // 装完刷新安装状态
        refresh();
      } catch (e) {
        setError(friendlyError(e, '算法安装没有完成，可以重试。'));
      } finally {
        setInstalling(null);
      }
    },
    [refresh],
  );

  const installPython = useCallback(async (): Promise<void> => {
    setPyInstalling(true);
    setError(null);
    setLogs([]);
    try {
      const r = await window.mathmodel.algorithms.installPython();
      if (!r.ok) setError(t('Python 静默安装未完成，请查看日志或手动安装后重启应用。'));
      refresh();
    } catch (e) {
      setError(friendlyError(e, '算法操作没有完成，可以重试。'));
    } finally {
      setPyInstalling(false);
    }
  }, [refresh]);

  const useInProject = useCallback(
    (a: AlgoEntry): void => {
      fillPrompt(
        `请使用「${a.name}」（${a.packageName}）完成建模分析：\n` +
          `- 适用：${a.suitableFor.join('、')}\n` +
          `- 输入：${a.inputs.join('；')}\n` +
          `- 输出：${a.outputs.join('；')}\n` +
          `先检查依赖是否已安装（缺了就 pip 安装），再结合当前项目数据实现并给出结果解读。`,
      );
    },
    [fillPrompt],
  );

  const py = snap?.python;
  const runtimeReady = py?.state === 'ready' && py?.pipOk;

  return (
    <div className="col" style={{ gap: 14 }}>
      {/* ── Python 运行时状态条 ── */}
      <div className="panel row" style={{ padding: '10px 14px', gap: 10, alignItems: 'center' }}>
        <span
          style={{
            color: runtimeReady ? 'var(--success)' : py?.state === 'broken' ? 'var(--danger)' : 'var(--warning)',
          }}
        >
          <Icon name="circle" size={10} style={{ fill: 'currentColor' }} />
        </span>
        <div className="col" style={{ gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {t('Python 运行时：{{state}}', { state: py ? runtimeLabel[py.state] : t('检测中…') })}
            {py?.version ? ` · v${py.version}` : ''}
          </span>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {runtimeReady
              ? py?.pipOk
                ? t('pip 可用，算法依赖可一键安装。')
                : t('检测到 Python 但 pip 不可用。')
              : t('算法依赖需要 Python 环境；一键安装走 npmmirror 镜像，静默装入当前用户。')}
          </span>
        </div>
        <div className="grow" />
        {!runtimeReady && (
          <button className="btn btn-sm btn-primary" disabled={pyInstalling || loading} onClick={() => void installPython()}>
            {pyInstalling ? (
              t('安装中…（见日志）')
            ) : (
              <>
                <Icon name="zap" size={13} />
                {t('一键安装 Python')}
              </>
            )}
          </button>
        )}
        <button className="btn btn-sm btn-ghost" onClick={refresh} disabled={loading}>
          {loading ? (
            t('读取中…')
          ) : (
            <>
              <Icon name="refresh-cw" size={13} />
              {t('刷新')}
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="panel" style={{ padding: 12, color: 'var(--danger)', fontSize: 12.5 }}>
          {error}
        </div>
      )}

      {/* ── 任务分类 + 搜索 ── */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {tasks.map((tk) => (
          <button key={tk.key} className={`btn btn-sm${task === tk.key ? ' btn-primary' : ''}`} onClick={() => setTask(tk.key)}>
            {tk.label}
          </button>
        ))}
        <div className="grow" />
        <input
          className="input"
          style={{ width: 200, fontSize: 12 }}
          placeholder={t('搜索算法或依赖包…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* ── 目录 ── */}
      {filtered.length === 0 ? (
        <div className="empty">{loading ? t('正在读取算法目录…') : t('没有匹配的算法。')}</div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          <div className="row muted" style={{ fontSize: 11, gap: 8 }}>
            <span>{t('目录来源：内置（离线可用）')}</span>
            <span>·</span>
            <span>{t('{{n}} 个算法', { n: filtered.length })}</span>
          </div>
          {filtered.map((a) => {
            const open = expanded === a.id;
            return (
              <div
                key={a.id}
                className="panel col"
                style={{ padding: 12, gap: 8, cursor: 'pointer' }}
                onClick={() => setExpanded(open ? null : a.id)}
                role="presentation"
              >
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{a.name}</span>
                  <span className="badge">{tasks.find((tk) => tk.key === a.task)?.label ?? a.task}</span>
                  {a.installed ? (
                    <span className="badge badge-success">{t('依赖已就绪')}</span>
                  ) : (
                    <span className="badge badge-warning">{t('需安装 {{pkg}}', { pkg: a.packageName })}</span>
                  )}
                  <div className="grow" />
                  {open ? <span className="muted">▾</span> : <span className="muted">▸</span>}
                </div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
                  {a.summary}
                </div>

                {open && (
                  <div className="col" style={{ gap: 8, fontSize: 12 }} onClick={(e) => e.stopPropagation()}>
                    <div className="row muted" style={{ fontSize: 11, gap: 10, flexWrap: 'wrap' }}>
                      <span>{t('依赖 · {{pkg}} {{ver}}', { pkg: a.packageName, ver: a.versionRange })}</span>
                      <span>{t('许可证 · {{name}}', { name: a.license })}</span>
                    </div>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {a.suitableFor.map((s) => (
                        <span key={s} className="badge"><Icon name="check" size={11} />{s}</span>
                      ))}
                    </div>
                    <div className="muted" style={{ lineHeight: 1.8 }}>
                      <div>
                        <Icon
                          name="download"
                          size={12}
                          style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 5 }}
                        />
                        {t('输入：{{list}}', { list: a.inputs.join('；') })}
                      </div>
                      <div>
                        <Icon
                          name="upload"
                          size={12}
                          style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 5 }}
                        />
                        {t('输出：{{list}}', { list: a.outputs.join('；') })}
                      </div>
                      <div>
                        <Icon
                          name="circle-slash"
                          size={12}
                          style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 5 }}
                        />
                        {t('不适用：{{list}}', { list: a.notFor.join('；') })}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      {!a.installed && (
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={installing !== null || !runtimeReady}
                          title={runtimeReady ? '' : t('先安装 Python 运行时')}
                          onClick={() => void installPkg(a)}
                        >
                          {installing === a.id ? t('安装中…') : t('安装 {{pkg}}', { pkg: a.packageName })}
                        </button>
                      )}
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          useInProject(a);
                          setExpanded(null);
                        }}
                      >
                        <Icon name="bot" size={13} />
                        {t('在项目中使用（让 Agent 建模）')}
                      </button>
                      <a className="btn btn-sm btn-ghost" href={a.docs} target="_blank" rel="noreferrer">
                        {tx('extensions.algorithmsSection.officialDocs') + ' ↗'}
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── 安装日志 ── */}
      {logs.length > 0 && (
        <div className="panel col" style={{ padding: 10, gap: 4 }}>
          <span className="muted" style={{ fontSize: 11 }}>{t('安装日志')}</span>
          <div
            ref={logBoxRef}
            className="mono"
            style={{ maxHeight: 160, overflowY: 'auto', fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}
          >
            {logs.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
