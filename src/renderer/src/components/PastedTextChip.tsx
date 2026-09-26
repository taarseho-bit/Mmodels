/**
 * 粘贴长文本的折叠 chip —— 使用输入框上方的紧凑两行布局。
 *
 * ⚠️ 与附件 chip（`.cz-chip`）**不是同一个东西**：那个是 22px 单行、带扩展名图标；
 *    这个是 56px 双行、带「首行标题」+「显示在输入框中」+ 悬停才出现的删除按钮。
 */
import { Icon } from './Icon';
import { tx } from '../i18n';
import { pastedTitle, type PastedText } from '../lib/pasted-text';

export interface PastedTextChipProps {
  item: PastedText;
  /** 把这段文本展开进输入框正文，并移除本 chip（项目契约 `onShowInTextField`） */
  onShowInTextField: () => void;
  onRemove: () => void;
}

export function PastedTextChip({ item, onShowInTextField, onRemove }: PastedTextChipProps): JSX.Element {
  // 全空白文本时 pastedTitle 返回 ''，回落到通用标题「粘贴的文本」
  const title = pastedTitle(item.text) || tx('chat.pastedText.fallbackTitle');

  return (
    <div className="cz-paste-chip">
      <Icon name="clipboard-list" size={16} />
      <div className="cz-paste-chip-body">
        <span className="cz-paste-chip-title" title={title}>
          {title}
        </span>
        <button
          type="button"
          className="cz-paste-chip-act"
          // ★ 项目契约 `Sxe = t => t.preventDefault()`：防止点按钮时 textarea 失焦
          //   （少了它，点完「显示在输入框中」光标会跑掉，用户接着打字打不进去）
          onMouseDown={(e) => e.preventDefault()}
          onClick={onShowInTextField}
        >
          {tx('chat.pastedText.showInTextField')}
          <Icon name="corner-down-right" size={10} />
        </button>
      </div>
      <button type="button" className="cz-paste-chip-x" title={tx('chat.pastedText.remove')} onClick={onRemove}>
        <Icon name="x" size={10} />
      </button>
    </div>
  );
}
