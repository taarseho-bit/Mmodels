/**
 * 通用确认弹窗 —— 复用全局 `.modal-*` 样式（与 ArtifactPanes 的冲突弹层、
 * ModelSection 的自定义模型弹层同一套写法），供「动手前先说清楚要做什么」的场景使用。
 *
 * 目前的使用者：设置 → 运行环境 的「一键修复（让 Agent 配置）」——
 * 点按钮先弹出本框列出**当前检测到的缺失项**，确认后才把任务交给 Agent 执行。
 */
import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  /** 正文说明（原版风格的一句话解释） */
  description?: ReactNode;
  /** 要点清单（如缺失项逐条列出）；空数组则不渲染这一段 */
  items?: string[];
  /** 清单上方的小标题 */
  itemsLabel?: string;
  /** 清单下方的补充说明（例如「Agent 会在本机执行安装…」） */
  footnote?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** 忙碌中：两个按钮都禁用，确认键显示 busyLabel */
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  items,
  itemsLabel,
  footnote,
  confirmLabel,
  cancelLabel,
  busy = false,
  busyLabel,
  onConfirm,
  onCancel,
}: Props): JSX.Element | null {
  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      // 忙碌中不允许点背景关掉 —— 安装任务正在往 Agent 那边送
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="modal confirm-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">{title}</span>
        </div>

        <div className="modal-body col" style={{ gap: 12 }}>
          {description ? <p className="confirm-dialog-desc">{description}</p> : null}

          {items && items.length > 0 ? (
            <div className="col" style={{ gap: 6 }}>
              {itemsLabel ? <span className="confirm-dialog-label">{itemsLabel}</span> : null}
              <ul className="confirm-dialog-list">
                {items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {footnote ? <p className="confirm-dialog-footnote">{footnote}</p> : null}
        </div>

        <div className="modal-foot">
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={onConfirm}>
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
