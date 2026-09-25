/**
 * 数据绘图面板（2026-09-26 深度审查 P0：DataChartStudio 此前只有 25 行壳，
 * "只能看模板不能画图"）。echarts 按需引入，读项目数据文件即时绘图，
 * 导出三件套：PNG / SVG / 剪贴板。
 *
 * 数据链路复用 DatabasePage 的管线：
 *   dataset.list() → file.preview(relPath)（text）→ parseDelimited → 列选择。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import { parseDelimited, type Delimiter } from './DataFilePreview';
import { Icon } from './Icon';

echarts.use([BarChart, LineChart, PieChart, ScatterChart, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer, SVGRenderer]);

type PlotType = 'line' | 'scatter' | 'bar' | 'pie';

const PLOT_LABEL: Record<PlotType, string> = { line: '折线图', scatter: '散点图', bar: '柱状图', pie: '饼图' };

interface DatasetFileInfo {
  relPath: string;
  name: string;
  ext: string;
}

interface Props {
  /** 选中文件后把面板切到绘图 Tab（由父页面控制挂载时机） */
  active?: boolean;
}

/** 判断一列是否可作数值轴：非空单元格里 parseFloat 成功的占比 ≥ 0.8 */
function isNumericColumn(rows: string[][], col: number): boolean {
  let numeric = 0;
  let total = 0;
  for (let r = 1; r < rows.length; r++) {
    const v = rows[r]?.[col];
    if (v === undefined || v === '') continue;
    total++;
    if (Number.isFinite(Number(v))) numeric++;
  }
  return total > 0 && numeric / total >= 0.8;
}

export function DataPlotPanel({ active = true }: Props): JSX.Element {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);

  const [files, setFiles] = useState<DatasetFileInfo[]>([]);
  const [activeRel, setActiveRel] = useState<string | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plotType, setPlotType] = useState<PlotType>('line');
  const [xCol, setXCol] = useState(0);
  const [yCols, setYCols] = useState<number[]>([1]);

  // ── 数据文件列表 ──
  useEffect(() => {
    if (!active) return;
    void (async () => {
      try {
        const res = (await window.mathmodel.dataset.list()) as { files?: DatasetFileInfo[] };
        const table = (res.files ?? []).filter((f) => /\.(csv|tsv)$/i.test(f.ext || f.relPath));
        setFiles(table);
      } catch {
        setFiles([]);
      }
    })();
  }, [active]);

  // ── 读选中文件 → 解析表格 ──
  useEffect(() => {
    if (!activeRel) {
      setRows([]);
      return;
    }
    void (async () => {
      try {
        setError(null);
        const preview = (await window.mathmodel.file.preview(activeRel)) as { kind: string; text?: string; truncated?: boolean };
        if (preview.kind !== 'text' || !preview.text) {
          setError('该文件不是文本表格（仅支持 CSV/TSV）。');
          setRows([]);
          return;
        }
        setTruncated(!!preview.truncated);
        const delim: Delimiter = /\.tsv$/i.test(activeRel) ? '\t' : ',';
        const parsed = parseDelimited(preview.text, delim);
        const filtered = parsed.rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ''));
        setRows(filtered.slice(0, 2000));
        // 默认列选择：X=0，Y=第一个数值列
        setXCol(0);
        const firstNumeric = filtered.length > 1 ? filtered[0].findIndex((_, c) => c > 0 && isNumericColumn(filtered, c)) : -1;
        setYCols(firstNumeric >= 0 ? [firstNumeric] : filtered[0].length > 1 ? [1] : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setRows([]);
      }
    })();
  }, [activeRel]);

  const headers = rows[0] ?? [];
  const numericFlags = useMemo(() => headers.map((_, c) => (rows.length > 1 ? isNumericColumn(rows, c) : false)), [rows, headers]);

  // ── echarts option ──
  const option = useMemo(() => {
    if (rows.length < 2 || yCols.length === 0) return null;
    const header = rows[0];
    const body = rows.slice(1);
    const xName = header[xCol] ?? `列${xCol + 1}`;
    const xVals = body.map((r) => r[xCol] ?? '');
    const numericX = isNumericColumn(rows, xCol);
    const seriesName = (c: number): string => header[c] ?? `列${c + 1}`;

    if (plotType === 'pie') {
      const c = yCols[0];
      return {
        tooltip: { trigger: 'item' },
        legend: { bottom: 0, type: 'scroll' },
        series: [{
          type: 'pie',
          radius: ['35%', '68%'],
          data: body.map((r, i) => ({ name: String(xVals[i] ?? `#${i + 1}`), value: Number(r[c]) || 0 })),
        }],
      };
    }

    const ySeries = yCols.map((c) => {
      const values = body.map((r) => (Number.isFinite(Number(r[c])) ? Number(r[c]) : null));
      if (plotType === 'bar') return { name: seriesName(c), type: 'bar' as const, data: values };
      if (plotType === 'scatter') return { name: seriesName(c), type: 'scatter' as const, data: values };
      return {
        name: seriesName(c),
        type: 'line' as const,
        data: values,
        smooth: true,
        connectNulls: true,
      };
    });
    return {
      tooltip: { trigger: plotType === 'scatter' ? 'item' : 'axis' },
      legend: { top: 0, type: 'scroll' },
      grid: { left: 48, right: 24, top: 36, bottom: numericX ? 56 : 36 },
      dataZoom: numericX ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 8 }] : undefined,
      xAxis: { type: numericX ? 'value' : 'category', name: xName, data: numericX ? undefined : xVals },
      yAxis: { type: 'value', scale: true },
      series: ySeries,
    };
  }, [rows, plotType, xCol, yCols]);

  // ── 渲染 / 自适应 ──
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    if (!chartInst.current) chartInst.current = echarts.init(el);
    if (option) chartInst.current.setOption(option, true);
    else chartInst.current.clear();
    const onResize = (): void => chartInst.current?.resize();
    window.addEventListener('resize', onResize);
    const t = window.setTimeout(onResize, 50);
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(t);
    };
  }, [option]);

  useEffect(() => () => {
    chartInst.current?.dispose();
    chartInst.current = null;
  }, []);

  // ── 导出三件套 ──
  const download = (href: string, name: string): void => {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
  };

  const baseName = (activeRel?.split('/').pop() ?? 'chart').replace(/\.(csv|tsv)$/i, '');

  const exportPng = (): void => {
    const url = chartInst.current?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
    if (url) download(url, `${baseName}-${plotType}.png`);
  };

  const exportSvg = (): void => {
    const inst = chartInst.current;
    if (!inst) return;
    const svg = inst.renderToSVGString({ backgroundColor: '#ffffff' });
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    download(url, `${baseName}-${plotType}.svg`);
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const copyPng = async (): Promise<void> => {
    const url = chartInst.current?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
    if (!url) return;
    const blob = await (await fetch(url)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  };

  const toggleY = (c: number): void =>
    setYCols((prev) => (prev.includes(c) ? prev.filter((v) => v !== c) : [...prev, c].sort((a, b) => a - b)));

  return (
    <div className="data-plot" style={{ display: 'flex', gap: 12, height: '100%', minHeight: 0 }}>
      {/* 文件列表 */}
      <aside style={{ width: 200, overflowY: 'auto', borderRight: '1px solid var(--border)', paddingRight: 8 }}>
        {files.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: '8px 2px' }}>
            项目里还没有 CSV/TSV 数据。先在「当前项目数据」页导入。
          </div>
        ) : (
          files.map((f) => (
            <button
              key={f.relPath}
              type="button"
              className="ds-row"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setActiveRel(f.relPath)}
            >
              <div className="ds-name truncate" title={f.relPath}>{f.name}</div>
            </button>
          ))
        )}
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 8 }}>
        {/* 控制行 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <select className="select" value={plotType} onChange={(e) => setPlotType(e.target.value as PlotType)} aria-label="图表类型" style={{ width: 100 }}>
            {(Object.keys(PLOT_LABEL) as PlotType[]).map((t) => (
              <option key={t} value={t}>{PLOT_LABEL[t]}</option>
            ))}
          </select>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            X
            <select className="select" value={xCol} onChange={(e) => setXCol(Number(e.target.value))} disabled={!headers.length} style={{ width: 130 }}>
              {headers.map((h, c) => (
                <option key={c} value={c}>{h || `列${c + 1}`}</option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12 }}>
            Y：
            {headers.map((h, c) => (c === xCol ? null : (
              <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, opacity: numericFlags[c] || plotType === 'pie' ? 1 : 0.55 }}>
                <input type="checkbox" checked={yCols.includes(c)} onChange={() => toggleY(c)} disabled={!headers.length} />
                {h || `列${c + 1}`}
              </label>
            )))}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={exportPng} disabled={!option} title="导出 PNG（2x）">
              <Icon name="download" size={12} /> PNG
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={exportSvg} disabled={!option} title="导出 SVG（矢量）">
              <Icon name="download" size={12} /> SVG
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copyPng()} disabled={!option} title="复制到剪贴板">
              <Icon name="copy" size={12} /> 复制
            </button>
          </div>
        </div>

        {/* 画布 */}
        {error ? (
          <div style={{ color: 'var(--fg-muted)', fontSize: 12.5, padding: 16 }}>{error}</div>
        ) : rows.length < 2 ? (
          <div style={{ color: 'var(--fg-muted)', fontSize: 12.5, padding: 16 }}>
            {activeRel ? '该文件没有可绘制的数据行。' : '从左侧选择一个 CSV/TSV 文件开始绘图。'}
          </div>
        ) : null}
        <div
          ref={chartRef}
          style={{ flex: 1, minHeight: 0, display: option ? 'block' : 'none' }}
          role="img"
          aria-label="数据图表预览"
        />
        {truncated ? (
          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>文件过大，仅绘制预览范围内的前 2000 行。</div>
        ) : null}
      </div>
    </div>
  );
}
