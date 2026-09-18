/**
 * 设置页 ⑩ 键盘快捷键
 *
 * 对照原版（original/s09-keys）复刻：
 *   - 「自定义快捷键」卡（说明 + keybindings.json 路径 + 「编辑」按钮）
 *   - 搜索框（按名称/按键过滤，无命中给提示）
 *   - 4 组共 14 条快捷键（全局 3 / 会话 8 / 文件预览 1 / 图库 2）
 *   - 点击行进入录制态：捕获组合键、Esc 取消、冲突提示、恢复默认
 *
 * 条目、分组、默认键位、键帽文案**全部取自原版**：
 *   文案   → zh.ts `shell.keymap.*` / `settings.keyboardShortcutsSection.*`
 *   默认键 → 原版渲染层常量（mod+slash / mod+k / mod+b / mod+u / mod+enter /
 *            mod+f / mod+o / left / right；其余 5 条为不可自定义的展示键）
 *
 * ⚠️ **条目表 `RULES` 已搬到 `../../keybindings/dispatch.ts`**，本文件 import 它。
 *    原因：这张表以前只活在本文件里 —— 于是它成了**纯展示**、按下没反应（本项的病灶）。
 *    现在它与"唯一的那个 `keydown` 监听"共用同一份表（**单一事实来源**）：
 *    这里显示什么键位、按下就按什么键位匹配，不可能再漂移。
 *    `RULES` 里每条还带一个 `unwired` 字段，标明"这条现在为什么按了没用"。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../store/app';
import { t, tx } from '../../i18n';
import {
  RULES,
  captureBinding,
  keycapParts,
  normalizeBinding,
  previewParts,
  type KeyRule,
  type SectionId,
} from '../../keybindings/dispatch';

const SECTION_ORDER: SectionId[] = ['global', 'chat', 'preview', 'gallery'];

const SECTION_LABEL: Record<SectionId, string> = {
  global: 'shell.keymap.sections.global',
  chat: 'shell.keymap.sections.chat',
  preview: 'shell.keymap.sections.preview',
  gallery: 'shell.keymap.sections.gallery',
};

function Keycaps({ parts }: { parts: string[] }): JSX.Element {
  return (
    <span className="keys-caps">
      {parts.map((p, i) => (
        <kbd className="keys-cap" key={`${p}-${i}`}>
          {p}
        </kbd>
      ))}
    </span>
  );
}

export function KeysSection(): JSX.Element {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const overrides = useMemo(() => settings?.keybindings ?? {}, [settings?.keybindings]);

  const [query, setQuery] = useState('');
  const [recording, setRecording] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[]>([]);
  /** 冲突命中的 command（显示 conflictsWith 提示） */
  const [conflict, setConflict] = useState<string | null>(null);
  const [filePath, setFilePath] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);

  /** 当前键位：覆盖值优先，否则用原版默认 */
  const bindingOf = (rule: KeyRule): string =>
    overrides[rule.command] || rule.defaultBinding || '';
  const isOverridden = (rule: KeyRule): boolean =>
    !!rule.defaultBinding &&
    !!overrides[rule.command] &&
    normalizeBinding(overrides[rule.command]) !== normalizeBinding(rule.defaultBinding);

  // keybindings.json 落盘（原版「编辑」打开的就是这份文件）
  const syncFile = (rules: Record<string, string>): void => {
    void window.mathmodel.app
      .keybindingsFile(rules)
      .then(setFilePath)
      .catch(() => setFilePath(''));
  };
  useEffect(() => {
    void window.mathmodel.app
      .keybindingsFile()
      .then(setFilePath)
      .catch(() => setFilePath(''));
  }, []);

  const save = (command: string, binding: string | null): void => {
    const next = { ...overrides };
    if (binding) next[command] = binding;
    else delete next[command];
    void patchSettings({ keybindings: next })
      .then(() => {
        setSaveFailed(false);
        syncFile(next);
      })
      .catch(() => setSaveFailed(true));
  };

  // 录制态：捕获阶段监听 window，Esc 取消（原版 lo 的做法）
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(null);
        setPreview([]);
        return;
      }
      const binding = captureBinding(e);
      if (!binding) {
        setPreview(previewParts(e));
        return;
      }
      // 冲突检测：与其它条目的当前键位相同则拒绝保存（原版 Qi）
      const hit = RULES.find(
        (r) => r.command !== recording && !!r.defaultBinding && normalizeBinding(bindingOf(r)) === normalizeBinding(binding),
      );
      if (hit) {
        setConflict(hit.command);
        setRecording(null);
        setPreview([]);
        return;
      }
      saveRef.current(recording, binding);
      setRecording(null);
      setPreview([]);
      setConflict(null);
    };
    const onKeyUp = (): void => setPreview([]);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [recording, overrides]);

  const q = query.trim().toLowerCase();
  const groups = SECTION_ORDER.map((id) => ({
    id,
    rows: RULES.filter((r) => {
      if (r.section !== id) return false;
      if (!q) return true;
      const label = tx(r.labelKey).toLowerCase();
      const caps = (r.defaultBinding ? keycapParts(bindingOf(r)) : (r.display ?? []))
        .join(' ')
        .toLowerCase();
      return label.includes(q) || caps.includes(q);
    }),
  })).filter((g) => g.rows.length > 0);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <section className="keys-sec">
      {/* ── 自定义快捷键卡 ── */}
      <div className="keys-card">
        <div className="keys-card-body">
          <div className="keys-card-text">
            <div className="keys-card-title">
              {tx('settings.keyboardShortcutsSection.customKeybindings')}
            </div>
            <div className="keys-card-desc">
              {tx('settings.keyboardShortcutsSection.customKeybindingsDescription')}
            </div>
            <div className="keys-path mono" title={filePath}>
              {filePath || '…'}
            </div>
          </div>
          <div className="keys-card-actions">
            <button
              className="btn btn-sm"
              disabled={!filePath}
              onClick={() => void window.mathmodel.app.openPath(filePath)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
              {tx('common.edit')}
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={!filePath}
              title={t('打开所在目录')}
              onClick={() => void window.mathmodel.app.showItemInFolder(filePath)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            </button>
          </div>
        </div>
        {saveFailed && (
          <div className="keys-warn">{tx('settings.useKeybindings.saveFailed')}</div>
        )}
      </div>

      {/* ── 搜索 ── */}
      <input
        className="input keys-search"
        value={query}
        placeholder={tx('settings.keyboardShortcutsSection.searchPlaceholder')}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.preventDefault();
            setQuery('');
          }
        }}
      />

      {total === 0 && (
        <div className="keys-empty">
          {tx('settings.keyboardShortcutsSection.noMatch', { query: query.trim() })}
        </div>
      )}

      {/* ── 分组 ── */}
      {groups.map((g) => (
        <div className="keys-group" key={g.id}>
          <div className="keys-group-title">{tx(SECTION_LABEL[g.id])}</div>
          <div className="keys-card">
            {g.rows.map((rule) => {
              const isRec = recording === rule.command;
              const overridden = isOverridden(rule);
              const hitConflict = conflict === rule.command;
              return (
                <div className="keys-row" key={rule.command}>
                  <span className="keys-row-label">{tx(rule.labelKey)}</span>
                  <div className="grow" />
                  {hitConflict && (
                    <span className="keys-conflict">
                      {tx('settings.shortcutRecorder.conflictsWith', {
                        label: tx(RULES.find((r) => r.command === conflict)?.labelKey ?? ''),
                      })}
                    </span>
                  )}
                  {!rule.defaultBinding ? (
                    <Keycaps parts={rule.display ?? []} />
                  ) : isRec ? (
                    preview.length > 0 ? (
                      <span className="keys-caps">
                        <Keycaps parts={preview} />
                        <span className="keys-plus">+ …</span>
                      </span>
                    ) : (
                      <span className="keys-recording">
                        {tx('settings.shortcutRecorder.pressNewShortcut')}
                      </span>
                    )
                  ) : (
                    <>
                      {overridden && (
                        <button
                          className="keys-reset"
                          title={tx('settings.shortcutRecorder.resetToDefault', {
                            keys: keycapParts(rule.defaultBinding).join(' '),
                          })}
                          onClick={() => {
                            setConflict(null);
                            save(rule.command, null);
                          }}
                        >
                          ↺
                        </button>
                      )}
                      <button
                        className="keys-record-btn"
                        title={tx('settings.shortcutRecorder.clickToRecord')}
                        onClick={() => {
                          setConflict(null);
                          setPreview([]);
                          setRecording(rule.command);
                        }}
                      >
                        <Keycaps parts={keycapParts(bindingOf(rule))} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
