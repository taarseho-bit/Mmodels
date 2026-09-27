/**
 * 「环境」浮层菜单 —— 锚定在顶栏「环境」按钮下方的浮层（**不是**整页跳设置页）。
 *
 * 结构按当前环境菜单规范组织：
 *   ┌────────────────────────────────┐
 *   │ 环境                        ⚙  │  ← 头部：标题 + 设置入口
 *   ├────────────────────────────────┤
 *   │ ↻ 项目版本                     │
 *   ├────────────────────────────────┤
 *   │ 编辑器                       ˅ │  ← 分组标题（可折叠）
 *   │ ▤ 编辑器视图                   │
 *   │ </> 在 Cursor 中打开         ˅ │  ← 可展开其他启动器
 *   ├────────────────────────────────┤
 *   │ 记事本                       ˅ │
 *   │ ┌────────────────────────────┐ │
 *   │ │ 在此输入                    │ │  ← 多行文本域
 *   │ └────────────────────────────┘ │
 *   └────────────────────────────────┘
 *
 * 文案全部走 `tx()`，键取自 i18n 里应用约定已有的 `composer.environmentPanel.*`
 * （`title` / `versions` / `editor` / `editorView` / `openInEditorNamed` /
 * `openInEditor` / `notepad` / `notepadPlaceholder` / `settings`），启动器与
 * 「在文件夹中显示」复用 `dock.editorLaunchers.systemDefault` 与
 * `dock.explorerPanel.revealInFolder`。
 *
 * ⚠️ 命名空间是 `composer.environmentPanel`，**不是** `chat.environmentPanel`：
 *    已用 esbuild 打包 zh.ts / en.ts 逐键验证过（diff 报告里那条路径有误）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { tx } from '../i18n';

/** 记事本内容落 localStorage（应用约定记事本在同一台机器上长期保留） */
const NOTEPAD_KEY = 'mm-env-notepad';

/**
 * 本机解析出的外部编辑器名。应用约定是运行时探测（`openInEditorNamed` 是插值键），
 * 当前版本没有编辑器探测 IPC，统一显示编辑器入口；
 * 展开后的「默认应用」走系统默认程序。
 */
const EDITOR_NAME = 'Cursor';

function loadNote(): string {
  try {
    return localStorage.getItem(NOTEPAD_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveNote(text: string): void {
  try {
    localStorage.setItem(NOTEPAD_KEY, text);
  } catch {
    // 隐私模式等场景写不进去，忽略即可
  }
}

interface Props {
  /** 浮层是否展开 */
  open: boolean;
  /** 关闭浮层（点击外部 / Esc / 执行完某个动作后调用） */
  onClose: () => void;
  /** 头部 ⚙ → 环境相关设置 */
  onOpenSettings: () => void;
  /** 分组「项目版本」→ 右栏「项目版本」标签 */
  onOpenVersions: () => void;
  /** 当前是否处于编辑器视图 */
  editorView: boolean;
  /** 切换编辑器视图 */
  onToggleEditorView: () => void;
  /** 有没有可打开的项目目录（没有则编辑器/启动器条目置灰） */
  hasProject: boolean;
  /** 用外部程序打开当前项目目录 */
  onOpenProjectIn: (target: 'editor' | 'systemDefault') => void;
  /** 在系统文件管理器中显示当前项目目录 */
  onRevealInFolder: () => void;
}

export function EnvironmentMenu({
  open,
  onClose,
  onOpenSettings,
  onOpenVersions,
  editorView,
  onToggleEditorView,
  hasProject,
  onOpenProjectIn,
  onRevealInFolder,
}: Props): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  /** 「编辑器」「记事本」两个分组可折叠（应用约定分组标题右侧带 chevron） */
  const [editorGroupOpen, setEditorGroupOpen] = useState(true);
  const [notepadOpen, setNotepadOpen] = useState(true);
  /** 启动器列表（应用约定「在 Cursor 中打开」行尾的 chevron） */
  const [launchersOpen, setLaunchersOpen] = useState(false);
  const [note, setNote] = useState(loadNote);

  // 每次重新展开都回到应用约定默认形态，避免上次的折叠状态让人以为菜单缺项
  useEffect(() => {
    if (!open) return;
    setEditorGroupOpen(true);
    setNotepadOpen(true);
    setLaunchersOpen(false);
  }, [open]);

  /** 点击外部 / Esc 关闭 */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const onNoteChange = useCallback((text: string): void => {
    setNote(text);
    saveNote(text);
  }, []);

  if (!open) return null;

  const title = tx('composer.environmentPanel.title');

  return (
    <div className="envmenu" ref={ref} role="menu" aria-label={title}>
      {/* ── 头部：标题 + ⚙ ── */}
      <div className="envmenu-head">
        <span className="envmenu-title">{title}</span>
        <button
          type="button"
          className="envmenu-icon-btn"
          title={tx('composer.environmentPanel.settings')}
          aria-label={tx('composer.environmentPanel.settings')}
          onClick={() => {
            onClose();
            onOpenSettings();
          }}
        >
          <Icon name="settings" size={14} />
        </button>
      </div>

      {/* ── 分组：项目版本 ── */}
      <div className="envmenu-group">
        <button
          type="button"
          className="envmenu-row"
          onClick={() => {
            onClose();
            onOpenVersions();
          }}
        >
          <Icon name="refresh-cw" size={14} />
          <span>{tx('composer.environmentPanel.versions')}</span>
        </button>
      </div>

      {/* ── 分组：编辑器 ── */}
      <div className="envmenu-group">
        <button
          type="button"
          className="envmenu-group-title"
          aria-expanded={editorGroupOpen}
          onClick={() => setEditorGroupOpen((v) => !v)}
        >
          <span>{tx('composer.environmentPanel.editor')}</span>
          <Icon name="chevron-down" size={13} />
        </button>

        {editorGroupOpen && (
          <>
            {/* 编辑器视图（激活时右侧打勾，便于看出当前模式） */}
            <button
              type="button"
              className={`envmenu-row${editorView ? ' is-active' : ''}`}
              onClick={() => {
                onToggleEditorView();
                onClose();
              }}
            >
              <Icon name="columns-2" size={14} />
              <span>{tx('composer.environmentPanel.editorView')}</span>
              {editorView && <Icon name="check" size={13} className="envmenu-check" />}
            </button>

            {/* 在 <编辑器> 中打开（行尾 chevron 展开其他启动器） */}
            <div className="envmenu-row-wrap">
              <button
                type="button"
                className="envmenu-row envmenu-row-grow"
                disabled={!hasProject}
                onClick={() => {
                  onOpenProjectIn('editor');
                  onClose();
                }}
              >
                <Icon name="code-xml" size={14} />
                <span>{tx('composer.environmentPanel.openInEditorNamed', { editor: EDITOR_NAME })}</span>
              </button>
              <button
                type="button"
                className="envmenu-caret"
                disabled={!hasProject}
                aria-expanded={launchersOpen}
                aria-label={tx('composer.environmentPanel.openInEditor')}
                title={tx('composer.environmentPanel.openInEditor')}
                onClick={() => setLaunchersOpen((v) => !v)}
              >
                <Icon name="chevron-down" size={13} className={launchersOpen ? 'is-open' : ''} />
              </button>
            </div>

            {/*
              行尾 chevron 展开的是应用约定的「编辑器选择器」——对应
              `dock.openInPicker.*`（chooseEditor / openWith / revealInFolder /
              noEditorsFound），不是文件浏览器面板的 `dock.explorerPanel.*`。
              当前版本探测不到已安装编辑器，列表里固定给「默认应用」+「在文件夹中显示」。
            */}
            {launchersOpen && (
              <div className="envmenu-picker">
                <div className="envmenu-picker-title">
                  {tx('dock.openInPicker.chooseEditor')}
                </div>
                <button
                  type="button"
                  className="envmenu-row envmenu-row-sub"
                  disabled={!hasProject}
                  onClick={() => {
                    onOpenProjectIn('systemDefault');
                    onClose();
                  }}
                >
                  <Icon name="notebook-tabs" size={12} />
                  <span>
                    {tx('dock.openInPicker.openWith', {
                      name: tx('dock.editorLaunchers.systemDefault'),
                    })}
                  </span>
                </button>
                <button
                  type="button"
                  className="envmenu-row envmenu-row-sub"
                  disabled={!hasProject}
                  onClick={() => {
                    onRevealInFolder();
                    onClose();
                  }}
                >
                  <Icon name="folder-open" size={12} />
                  <span>{tx('dock.openInPicker.revealInFolder')}</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 分组：记事本 ── */}
      <div className="envmenu-group">
        <button
          type="button"
          className="envmenu-group-title"
          aria-expanded={notepadOpen}
          onClick={() => setNotepadOpen((v) => !v)}
        >
          <span>{tx('composer.environmentPanel.notepad')}</span>
          <Icon name="chevron-down" size={13} />
        </button>

        {notepadOpen && (
          <textarea
            className="envmenu-notepad"
            value={note}
            placeholder={tx('composer.environmentPanel.notepadPlaceholder')}
            aria-label={tx('composer.environmentPanel.notepadPlaceholder')}
            onChange={(e) => onNoteChange(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}
