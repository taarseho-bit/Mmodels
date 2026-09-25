/**
 * Markdown 渲染 —— 带公式（KaTeX）与图表（Mermaid）。
 *
 * 用 `marked` + 自研 HTML 消毒 + 渐进增强的 KaTeX / Mermaid。
 *
 * ⚠️ 为什么必须消毒
 *    Markdown 的内容来自**模型和项目文件** —— 都是不可信输入。
 *    理论上渲染层有 contextIsolation + 严格 CSP 兜底，但「能执行就别让它有机会执行」
 *    才是正确的纵深防御姿态。`marked` 默认允许原始 HTML 透传，
 *    所以这里在输出后统一剥掉 script / 内联事件 / 危险 URL 协议。
 *
 * ⚠️ 为什么不用 DOMPurify
 *    又是一个依赖，而且我们只需要拦掉一小撮明确危险的东西（不是完整 HTML 白名单场景）。
 *    真要严谨的话应该走白名单，但这里产物主要是论文/代码/公式，收益不抵成本。
 *
 * ⚠️ Mermaid 走**动态 import**
 *    mermaid 打包后 1 MB 出头，而绝大多数消息里没有图表。
 *    放进主 bundle 会让启动多背 1 MB 且拖慢首屏 —— 只有真的出现 mermaid 代码块时才加载。
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Icon } from './Icon';
import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import 'katex/dist/katex.min.css';
import { useApp } from '../store/app';
import { t } from '../i18n';
import { findStableSplit } from '../lib/markdown-split';
import { friendlyError } from '../lib/friendly-error';

/** 危险片段消毒 */
function sanitize(html: string): string {
  return (
    html
      // 1. script / style / iframe / object / embed / form 整块干掉
      .replace(
        /<\s*(script|style|iframe|object|embed|form|link|meta|base)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
        '',
      )
      .replace(/<\s*(script|style|iframe|object|embed|form|link|meta|base)\b[^>]*\/?>/gi, '')
      // 2. 内联事件处理器 on*（注意：KaTeX 用的是 mathvariant，不会命中）
      .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
      .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
      // 3. javascript: / vbscript: / data:text/html 协议
      .replace(
        /(href|src|xlink:href)\s*=\s*"(?:\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^"]*)"/gi,
        '$1="#"',
      )
      .replace(
        /(href|src|xlink:href)\s*=\s*'(?:\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^']*)'/gi,
        "$1='#'",
      )
  );
}

/** marked 配置：GFM + 公式 */
marked.setOptions({ gfm: true, breaks: true, pedantic: false });

/**
 * KaTeX 扩展。
 * `throwOnError: false` 很关键 —— 模型偶尔会写出不合法的 LaTeX，
 * 抛错会让**整条消息**渲染失败，代价远大于某条公式显示成红字。
 * `nonStandard: true` 让 `$` 紧贴数字时也当公式处理（中文语境常见）。
 */
marked.use(
  markedKatex({
    throwOnError: false,
    nonStandard: true,
    output: 'htmlAndMathml',
  }),
);

interface Props {
  source: string;
  className?: string;
}

/** 提取 HTML 里的 mermaid 代码块数量（用于决定要不要加载 mermaid） */
function countMermaid(html: string): number {
  return (html.match(/<code[^>]*class="[^"]*language-mermaid[^"]*"/gi) ?? []).length;
}

/**
 * marked.parse + 消毒 + 失败降级，纯函数。
 * B1 性能优化的基石：稳定前缀与活跃尾部可以分别调用它，
 * 结果与整篇解析在块边界处等价（marked 的块级解析按空行分块独立进行）。
 */
function renderMarkdown(source: string): string {
  if (!source) return '';
  try {
    const raw = marked.parse(source, { async: false }) as string;
    return sanitize(raw);
  } catch (e) {
    // 渲染失败绝不能白屏 —— 退化成纯文本
    const msg = friendlyError(e, '预览没有生成成功。');
    return `<pre>${escapeHtml(source)}\n\n（${t('Markdown 渲染失败')}：${escapeHtml(msg)}）</pre>`;
  }
}

/** mermaid 渐进渲染（B1 前后共用）：把 host 内未处理的 mermaid 代码块替换成图 */
async function renderMermaidInHost(host: HTMLElement, theme: string, salt: number): Promise<void> {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({
    startOnLoad: false,
    // 跟随应用主题，否则暗色下图表会是刺眼的白底
    theme: theme === 'dark' ? 'dark' : 'default',
    securityLevel: 'strict',
    fontFamily: 'inherit',
  });
  const blocks = host.querySelectorAll<HTMLElement>('code.language-mermaid:not([data-mm-done])');
  let i = 0;
  for (const code of blocks) {
    const src = code.textContent ?? '';
    code.setAttribute('data-mm-done', '1');
    try {
      const { svg } = await mermaid.render(`mm-${salt}-${i++}`, src);
      // 用渲染结果替换整个 <pre>，避免残留代码块边框
      const pre = code.closest('pre') ?? code;
      const box = document.createElement('div');
      box.className = 'md-mermaid';
      box.innerHTML = sanitize(svg);
      pre.replaceWith(box);
    } catch (e) {
      // 单个图渲染失败不影响其它内容
      const msg = friendlyError(e, '预览没有生成成功。');
      code.setAttribute('data-mm-error', '1');
      code.title = `${t('Mermaid 渲染失败')}：${msg}`;
    }
  }
}

export function Markdown({ source, className }: Props): JSX.Element {
  const theme = useApp((s) => s.theme);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const html = useMemo(() => renderMarkdown(source), [source]);

  const mermaidCount = useMemo(() => countMermaid(html), [html]);

  /**
   * 把 mermaid 代码块渲染成图。
   *
   * 用 `data-mm-done` 标记已处理的块，避免重复渲染
   * （源变化 / 主题切换时都会重跑这个 effect）。
   */
  useEffect(() => {
    if (mermaidCount === 0) return;
    const host = hostRef.current;
    if (!host) return;

    void (async () => {
      try {
        await renderMermaidInHost(host, theme, Date.now());
      } catch {
        /* mermaid 加载失败就保持代码块原样，至少内容没丢 */
      }
    })();
  }, [html, mermaidCount, theme]);

  return (
    <>
      <div
        ref={hostRef}
        className={`md${className ? ` ${className}` : ''}`}
        onClick={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLImageElement) || !target.src) return;
          setLightbox({ src: target.src, alt: target.alt || t('图片预览') });
        }}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {lightbox ? (
        <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={lightbox.alt} onClick={() => setLightbox(null)}>
          <div className="image-lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
            <a className="btn btn-sm btn-ghost" href={lightbox.src} download>
              <Icon name="download" size={13} /> {t('下载')}
            </a>
            <button type="button" className="btn btn-sm btn-ghost" aria-label={t('关闭')} onClick={() => setLightbox(null)}><Icon name="x" size={13} /></button>
          </div>
          <img src={lightbox.src} alt={lightbox.alt} onClick={(e) => e.stopPropagation()} />
        </div>
      ) : null}
    </>
  );
}

/**
 * B1 流式版 Markdown：稳定前缀 + 活跃尾部双段渲染。
 *
 * - stable 段：字符串不变时 useMemo 直接命中，DOM 子树不重建
 *   （图片不闪、mermaid 不重渲、选区不丢）；
 * - tail 段：每 token 只解析这一小段。
 *
 * 拼接边界的间距由 `.md > *:first-child/:last-child` 的 margin 清零规则兜住
 * （theme.css），视觉上与单 div 等价。非流式场景继续用上面的 `Markdown`。
 */
export function MarkdownStreaming({ source, className }: Props): JSX.Element {
  const theme = useApp((s) => s.theme);
  const stableRef = useRef<HTMLDivElement | null>(null);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const split = useMemo(() => findStableSplit(source), [source]);
  const stable = split > 0 ? source.slice(0, split) : '';
  const tail = split > 0 ? source.slice(split) : source;

  const stableHtml = useMemo(() => renderMarkdown(stable), [stable]);
  const tailHtml = useMemo(() => renderMarkdown(tail), [tail]);

  const mermaidCount = useMemo(() => countMermaid(stableHtml) + countMermaid(tailHtml), [stableHtml, tailHtml]);

  useEffect(() => {
    if (mermaidCount === 0) return;
    void (async () => {
      const salt = Date.now();
      for (const host of [stableRef.current, tailRef.current]) {
        if (!host) continue;
        try {
          await renderMermaidInHost(host, theme, salt);
        } catch {
          /* 同上：加载失败保持代码块原样 */
        }
      }
    })();
  }, [stableHtml, tailHtml, mermaidCount, theme]);

  const onImgClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !target.src) return;
    setLightbox({ src: target.src, alt: target.alt || t('图片预览') });
  };

  return (
    <>
      {stable ? (
        <div
          ref={stableRef}
          className={`md md-stable${className ? ` ${className}` : ''}`}
          onClick={onImgClick}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: stableHtml }}
        />
      ) : null}
      <div
        ref={tailRef}
        className={`md md-tail${className ? ` ${className}` : ''}`}
        onClick={onImgClick}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: tailHtml }}
      />
      {lightbox ? (
        <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={lightbox.alt} onClick={() => setLightbox(null)}>
          <div className="image-lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
            <a className="btn btn-sm btn-ghost" href={lightbox.src} download>
              <Icon name="download" size={13} /> {t('下载')}
            </a>
            <button type="button" className="btn btn-sm btn-ghost" aria-label={t('关闭')} onClick={() => setLightbox(null)}><Icon name="x" size={13} /></button>
          </div>
          <img src={lightbox.src} alt={lightbox.alt} onClick={(e) => e.stopPropagation()} />
        </div>
      ) : null}
    </>
  );
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
