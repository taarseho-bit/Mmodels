/**
 * 代码块语法高亮（2026-09-26 深度审查 P1：建模产物大量 Python/MATLAB/LaTeX，
 * 此前纯文本渲染）。shiki 按需加载，单例 highlighter，双主题随 data-theme 切换。
 *
 * 接入方式与 mermaid 一致：DOM 后处理（Markdown.tsx 的 effect 里调用
 * highlightInHost），对每个未处理的 `<pre><code class="language-x">` 做替换。
 * 流式渲染天然安全：markdown 只有 **闭合** 的 fence 才会生成 code 块，
 * 中间态文本不会进入这里。
 */
import type { Highlighter } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;

/** 数模场景常用语言；未列出的语言跳过高亮（保持纯文本，不报错） */
const LANGS = [
  'python',
  'matlab',
  'latex',
  'bash',
  'json',
  'javascript',
  'typescript',
  'r',
  'markdown',
  'c',
  'cpp',
  'java',
  'yaml',
  'html',
  'css',
  'diff',
] as const;

const THEMES = { light: 'github-light', dark: 'one-dark-pro' } as const;

function getHighlighter(): Promise<Highlighter> | null {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki')
      .then((shiki) =>
        shiki.createHighlighter({
          themes: [THEMES.light, THEMES.dark],
          langs: [...LANGS],
        }),
      )
      .catch(() => {
        // shiki 加载失败（磁盘/内存异常）时置回 null 外层静默降级为纯文本
        highlighterPromise = null;
        throw new Error('shiki unavailable');
      });
  }
  return highlighterPromise;
}

/** class="language-xxx" → shiki 语言 id；返回 null 表示不支持，跳过 */
function normalizeLang(className: string): string | null {
  const m = /language-([\w+-]+)/.exec(className);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  if (raw === 'mermaid') return null; // mermaid 有自己的渲染管线
  const alias: Record<string, string> = { tex: 'latex', latex: 'latex', py: 'python', shell: 'bash', sh: 'bash', ts: 'typescript', js: 'javascript', 'c++': 'cpp', golang: 'go' };
  const lang = alias[raw] ?? raw;
  return (LANGS as readonly string[]).includes(lang) ? lang : null;
}

/**
 * 扫描 host 内所有未高亮的代码块并替换为 shiki 输出。
 * 幂等：已处理的块带 data-shiki-done，不会重复处理。
 * 任何单块失败只影响那一块（标记 done 跳过），不影响其他块。
 */
export async function highlightInHost(host: HTMLElement): Promise<void> {
  const codes = host.querySelectorAll<HTMLElement>('pre > code[class*="language-"]:not([data-shiki-done])');
  if (codes.length === 0) return;

  let highlighter: Highlighter;
  try {
    const loaded = getHighlighter();
    if (!loaded) return;
    highlighter = await loaded;
  } catch {
    // 加载失败：把本次扫到的块全部标记 done，避免每次渲染都重试
    codes.forEach((code) => code.setAttribute('data-shiki-done', '1'));
    return;
  }

  for (const code of Array.from(codes)) {
    const lang = normalizeLang(code.className);
    if (!lang) {
      code.setAttribute('data-shiki-done', '1');
      continue;
    }
    try {
      const out = await highlighter.codeToHtml(code.textContent ?? '', {
        lang,
        themes: THEMES,
        defaultColor: false,
      });
      const holder = document.createElement('div');
      holder.innerHTML = out;
      const newPre = holder.firstElementChild as HTMLElement | null;
      const oldPre = code.closest('pre');
      if (newPre && oldPre) {
        // 保留原 pre 的类（md 代码块容器样式不丢），叠加 shiki 标记
        newPre.className = `${oldPre.className} shiki-host`.trim();
        newPre.setAttribute('data-shiki-done', '1');
        oldPre.replaceWith(newPre);
      } else {
        code.setAttribute('data-shiki-done', '1');
      }
    } catch {
      code.setAttribute('data-shiki-done', '1');
    }
  }
}
