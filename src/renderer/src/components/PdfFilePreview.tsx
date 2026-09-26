/**
 * PDF 预览 —— 当前实现项目契约 `PdfFilePreview`。
 *
 * 实现取舍（**如实说明**）：
 *   项目契约自带 pdf.js（`pdf-*.js` 474 KB + `pdf_viewer` 220 KB + 1.28 MB worker）
 *   做分页渲染。本项目**不引 pdf.js**，改用 Electron 内核内置的
 *   Chromium PDF 查看器（`<iframe>` 承载主进程返回的 data URL）。
 *   好处：零依赖、翻页/缩放/搜索/打印都由内核提供，比自绘更完整。
 *   代价：外观是浏览器原生样式，而不是项目契约那套自绘工具栏。
 *
 * 本组件提供项目契约的外层交互：加载态、失败态（`dock.pdfViewer.*`）、
 * 新窗口打开、系统程序打开。
 */
import { useState } from 'react';
import { t, tx } from '../i18n';

export function PdfFilePreview({
  dataUrl,
  relPath,
  onOpenExternal,
}: {
  dataUrl: string;
  relPath: string;
  onOpenExternal?: () => void;
}): JSX.Element {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  return (
    <div className="pv">
      <div className="pv-head">
        <span className="pv-name truncate" title={relPath}>
          {relPath}
        </span>
        <span className="row" style={{ gap: 4, flexShrink: 0 }}>
          <a
            className="btn btn-sm btn-ghost"
            href={dataUrl}
            target="_blank"
            rel="noreferrer noopener"
            title={t('在浏览器标签页打开')}
          >
            ↗
          </a>
          {onOpenExternal ? (
            <button className="btn btn-sm btn-ghost" onClick={onOpenExternal} title={t('用系统程序打开')}>
              ⧉
            </button>
          ) : null}
        </span>
      </div>

      <div className="pv-body" style={{ position: 'relative' }}>
        {status === 'loading' && (
          <div className="muted" style={{ padding: 12, fontSize: 12 }}>
            {tx('dock.pdfViewer.loading')}
          </div>
        )}

        {status === 'failed' ? (
          <div className="col" style={{ padding: 16, gap: 8, alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{tx('dock.pdfViewer.loadFailed')}</div>
            {onOpenExternal ? (
              <button className="btn btn-sm" onClick={onOpenExternal}>
                {t('用系统程序打开')}
              </button>
            ) : null}
          </div>
        ) : (
          <iframe
            src={dataUrl}
            title={relPath}
            onLoad={() => setStatus('ready')}
            onError={() => setStatus('failed')}
            style={{
              width: '100%',
              height: '100%',
              minHeight: 320,
              border: 'none',
              display: 'block',
              background: 'var(--bg-sunken)',
            }}
          />
        )}
      </div>
    </div>
  );
}
