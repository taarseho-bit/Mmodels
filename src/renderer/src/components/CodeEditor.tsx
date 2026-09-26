/**
 * 带语法高亮的代码编辑器（2026-09-26 用户需求：代码要有代码的颜色，
 * 不同文件类型要有区分）。
 *
 * 结构：底层 <pre class="ap-hl">（token 着色，aria-hidden）+ 上层透明 <textarea>。
 *   - textarea 文字 color: transparent，只留光标色（caret-color）；
 *   - 两层用完全相同的字体/行高/padding/white-space，滚动时把 textarea 的
 *     scrollTop/Left 同步给 pre —— 视觉上就是「文字被染色了」；
 *   - dirty 编辑照常（受控 value 走 ArtifactPanes 原有保存/冲突链路，零改动）。
 *
 * 降级策略：
 *   - 识别不了的扩展名（langOf → null）→ 纯 textarea，与现状一致；
 *   - 超大文本（> 300KB）不做 tokenize —— 避免每次按键全量重着色卡顿；
 *   - 只读（truncated）文件不高亮 —— 只读层的 muted 灰与高亮叠加会出双影。
 */
import { useMemo, useRef } from 'react';
import { langOf, tokenize } from '../lib/syntax';

/** 超过这个大小不做高亮（纯文本，避免逐键重染卡顿） */
const HIGHLIGHT_MAX = 300 * 1024;

export interface CodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  /** 文件路径（决定语言） */
  path: string;
}

export function CodeEditor({ value, onChange, readOnly = false, path }: CodeEditorProps): JSX.Element {
  const preRef = useRef<HTMLPreElement | null>(null);
  const lang = langOf(path);
  const enabled = !!lang && !readOnly && value.length <= HIGHLIGHT_MAX;

  const tokens = useMemo(
    () => (enabled && lang ? tokenize(value, lang) : null),
    [enabled, lang, value],
  );

  const syncScroll = (el: HTMLTextAreaElement): void => {
    const pre = preRef.current;
    if (pre) {
      pre.scrollTop = el.scrollTop;
      pre.scrollLeft = el.scrollLeft;
    }
  };

  return (
    <div className="ap-code">
      {tokens ? (
        <pre className="ap-hl" ref={preRef} aria-hidden>
          <code>
            {tokens.map((t, i) =>
              t.t === 'plain' ? (
                t.v
              ) : (
                <span key={i} className={`tok-${t.t}`}>
                  {t.v}
                </span>
              ),
            )}
            {'\n'}
          </code>
        </pre>
      ) : null}
      <textarea
        className={`ap-editor${tokens ? ' ap-editor-hl' : ''}`}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => syncScroll(e.currentTarget)}
      />
    </div>
  );
}
