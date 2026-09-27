/**
 * 表格数据预览 —— 当前实现应用约定 `DataFilePreview`（应用约定用 papaparse + worker）。
 *
 * 本项目不引 papaparse，自实现一个**引号感知**的 CSV/TSV 解析器：
 *   - 支持 `"` 包裹的字段（内含分隔符与换行）
 *   - 支持 `""` 转义引号
 *   - 自动识别分隔符（逗号 / 制表符 / 分号）
 *
 * 安全上限与应用约定一致：行数、列数、单元格长度都设上限，
 * 并如实告知用户「原文件不会被修改」（`truncated` 文案）。
 */
import { useMemo, useState } from 'react';
import { t, tx } from '../i18n';
import type { FilePreview } from '@shared/types';

/** 安全上限（对齐应用约定「按安全上限显示部分数据」的说法） */
const MAX_ROWS = 500;
const MAX_COLS = 80;
const MAX_CELL = 400;

export type Delimiter = ',' | '\t' | ';';

export interface ParsedTable {
  rows: string[][];
  /** 实际存在的总行数（可能大于展示行数） */
  totalRows: number;
  totalCols: number;
  delimiter: Delimiter;
  truncatedRows: boolean;
  truncatedCols: boolean;
}

/** 猜测分隔符：看首行哪种分隔符出现次数最多 */
export function guessDelimiter(sample: string): Delimiter {
  const firstLine = sample.split(/\r?\n/).slice(0, 5).join('\n');
  const count = (ch: string): number => {
    let n = 0;
    let inQuote = false;
    for (const c of firstLine) {
      if (c === '"') inQuote = !inQuote;
      else if (c === ch && !inQuote) n++;
    }
    return n;
  };
  const tab = count('\t');
  const comma = count(',');
  const semi = count(';');
  if (tab >= comma && tab >= semi) return '\t';
  if (semi > comma) return ';';
  return ',';
}

/**
 * 引号感知的定界符解析器。
 * 状态机一次遍历，遇到未闭合的引号内的分隔符不算分隔。
 */
export function parseDelimited(text: string, delim: Delimiter): ParsedTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuote = false;
  let totalRows = 0;
  let totalCols = 0;

  const pushCell = (): void => {
    row.push(cell.length > MAX_CELL ? cell.slice(0, MAX_CELL) + '…' : cell);
    cell = '';
  };
  const pushRow = (): void => {
    pushCell();
    totalRows++;
    if (row.length > totalCols) totalCols = row.length;
    // 只保留前 MAX_ROWS 行、前 MAX_COLS 列
    if (rows.length < MAX_ROWS) rows.push(row.slice(0, MAX_COLS));
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') {
      inQuote = true;
      continue;
    }
    if (c === delim) {
      pushCell();
      continue;
    }
    if (c === '\r') continue;
    if (c === '\n') {
      pushRow();
      continue;
    }
    cell += c;
  }
  // 收尾：最后一行没有换行符结尾
  if (cell.length > 0 || row.length > 0) pushRow();

  // 丢掉完全空白的尾行（文件末尾的换行造成）
  while (rows.length && rows[rows.length - 1].every((x) => x === '')) rows.pop();

  return {
    rows,
    totalRows,
    totalCols,
    delimiter: delim,
    truncatedRows: totalRows > rows.length,
    truncatedCols: totalCols > MAX_COLS,
  };
}

/** 是否是数值（用于右对齐） */
function isNumeric(s: string): boolean {
  if (!s) return false;
  return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s.trim());
}

export function DataFilePreview({
  text,
  truncatedSource,
}: {
  text: string;
  /** 上游（主进程）已经把源文件截断过 */
  truncatedSource?: boolean;
}): JSX.Element {
  const table = useMemo(() => {
    const delim = guessDelimiter(text);
    return parseDelimited(text, delim);
  }, [text]);

  if (table.rows.length === 0) {
    return (
      <div className="muted" style={{ padding: 12, fontSize: 12 }}>
        {tx('dock.dataPreview.empty')}
      </div>
    );
  }

  const header = table.rows[0];
  const body = table.rows.slice(1);

  return (
    <div className="pv">
      <div className="pv-head">
        <span className="muted" style={{ fontSize: 11 }}>
          {tx('dock.dataPreview.dimensions', {
            rows: table.totalRows,
            columns: table.totalCols,
          })}
        </span>
        <span className="muted mono" style={{ fontSize: 10 }}>
          {table.delimiter === '\t' ? 'TSV' : table.delimiter === ';' ? 'SSV' : 'CSV'}
        </span>
      </div>

      <div className="pv-body">
        <table className="dt-table">
          <thead>
            <tr>
              <th className="dt-rownum">#</th>
              {header.map((h, i) => (
                <th key={i} title={h}>
                  {h || t('列 {{n}}', { n: i + 1 })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>
                <td className="dt-rownum">{ri + 1}</td>
                {header.map((_, ci) => {
                  const v = r[ci] ?? '';
                  return (
                    <td key={ci} className={isNumeric(v) ? 'num' : ''} title={v}>
                      {v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(table.truncatedRows || table.truncatedCols || truncatedSource) && (
        <div
          className="muted"
          style={{ padding: '5px 10px', fontSize: 10.5, lineHeight: 1.6, flexShrink: 0 }}
        >
          {tx('dock.dataPreview.truncated')}
        </div>
      )}
    </div>
  );
}

/** Excel 工作簿预览：工作表切换、尺寸提示和安全截断均在本地完成。 */
export function WorkbookPreview({ workbook }: { workbook: NonNullable<FilePreview['workbook']> }): JSX.Element {
  const [sheetIndex, setSheetIndex] = useState(0);
  const sheet = workbook.sheets[Math.min(sheetIndex, Math.max(0, workbook.sheets.length - 1))];
  if (!sheet) {
    return <div className="muted" style={{ padding: 16, fontSize: 12, lineHeight: 1.7 }}>{workbook.message ?? '没有读取到工作表。'}</div>;
  }
  const header = sheet.rows[0] ?? [];
  const body = sheet.rows.slice(1);
  return <div className="pv workbook-preview">
    <div className="pv-head" style={{ gap: 6, flexWrap: 'wrap' }}>
      <span className="muted" style={{ fontSize: 11 }}>工作表 {sheetIndex + 1}/{workbook.sheets.length} · {sheet.totalRows} 行 · {sheet.totalCols} 列</span>
      <span className="muted mono" style={{ fontSize: 10 }}>{workbook.parser === 'openpyxl' ? 'Excel' : '兼容读取'}</span>
    </div>
    <div className="workbook-tabs" role="tablist" aria-label="Excel 工作表">
      {workbook.sheets.map((item, index) => <button key={`${item.name}-${index}`} className={`btn btn-sm${index === sheetIndex ? ' btn-primary' : ''}`} role="tab" aria-selected={index === sheetIndex} onClick={() => setSheetIndex(index)}>{item.name || `工作表 ${index + 1}`}</button>)}
    </div>
    <div className="pv-body"><table className="dt-table"><thead><tr><th className="dt-rownum">#</th>{header.map((h, i) => <th key={i} title={h}>{h || t('列 {{n}}', { n: i + 1 })}</th>)}</tr></thead><tbody>{body.map((row, ri) => <tr key={ri}><td className="dt-rownum">{ri + 1}</td>{header.map((_, ci) => { const value = row[ci] ?? ''; return <td key={ci} className={isNumeric(value) ? 'num' : ''} title={value}>{value}</td>; })}</tr>)}</tbody></table></div>
    {(sheet.truncatedRows || sheet.truncatedCols) && <div className="muted" style={{ padding: '5px 10px', fontSize: 10.5, lineHeight: 1.6 }}>这里只显示前 500 行和前 80 列，原文件没有被修改。</div>}
  </div>;
}
