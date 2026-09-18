/**
 * 设置页 ③ 对话
 *
 * 对齐原版：本分区只有一张卡「追问行为」（`settings.settingsPage.conversation.*`）。
 * 默认任务模式在输入区的模式选择器里，Agent 权限在输入区右下角的权限选择器里，
 * 此处不再重复提供（设置字段本身仍由 Composer 读写，未删）。
 */
import { useState } from 'react';
import {
  readFollowUpBehavior,
  writeFollowUpBehavior,
  type FollowUpBehavior,
} from '../../store/app';
import { tx } from '../../i18n';

export function ChatSection(): JSX.Element {
  const [followUp, setFollowUp] = useState<FollowUpBehavior>(() => readFollowUpBehavior());

  return (
    <div className="col" style={{ gap: 22 }}>
      {/* 原版唯一一张卡：标题 + 描述在左，下拉在右 */}
      <div className="panel row chat-followup" style={{ padding: 14, gap: 14 }}>
        <div className="col grow" style={{ gap: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {tx('settings.settingsPage.conversation.followUpBehavior')}
          </span>
          <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
            {tx('settings.settingsPage.conversation.followUpBehaviorDescription')}
          </span>
        </div>
        <select
          className="select"
          style={{ width: 168, flexShrink: 0 }}
          value={followUp}
          onChange={(e) => {
            const v = e.target.value as FollowUpBehavior;
            setFollowUp(v);
            writeFollowUpBehavior(v);
          }}
        >
          <option value="queue">{tx('settings.settingsPage.conversation.queue')}</option>
          <option value="steer">{tx('settings.settingsPage.conversation.steer')}</option>
        </select>
      </div>
    </div>
  );
}
