/**
 * 「分享论文」浮层 —— 原版是**投稿信息表单浮层**（不是路由、不是往输入框塞 prompt）。
 *
 * ⚠️ 本地化改造：原版「开始分享」会把论文上传到 MModels 数模广场（云端），
 *    本复刻排除云端服务，因此提交后**只在本机登记一条投稿记录**
 *    （`registerSubmission()`，数模广场 →「我的投稿」可看到），
 *    并同时把原版的 `/paper-sharing` Agent 指令填进输入框，
 *    让 Agent 继续处理本地打包流程。
 *
 * 本浮层是**唯一**的分享入口：数模广场页头与顶栏都打开它，
 * 保证两条路径的登记行为一致。
 *
 * 文案逐字取自 `papers.share.form.*`。
 */
import { useState } from 'react';
import { useApp } from '../store/app';
import { registerSubmission } from '../store/paper-submissions';
import { tx } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PaperShareDialog({ open, onClose }: Props): JSX.Element | null {
  const fillPrompt = useApp((s) => s.fillPrompt);
  const project = useApp((s) => s.currentProject);
  const [cost, setCost] = useState('');

  if (!open) return null;

  const submit = (): void => {
    const input = cost.trim();
    // 原版语义：Agent 指令 + 花费参数
    const prompt = tx('papers.share.prompt') + (input ? tx('papers.share.promptCost', { cost: input }) : '');
    // 先落一条本机投稿记录（标题用项目名占位，原版由 Agent 读出 PDF 标题后回填），
    // 再填 Agent 指令 —— 这样在数模广场点分享和在顶栏点分享结果完全一致。
    registerSubmission({
      title: project?.name ?? tx('papers.share.sessionTitle'),
      cost: input ? Number(input) : undefined,
    });
    fillPrompt(prompt);
    setCost('');
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel col share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="share-dialog-title">{tx('papers.share.form.title')}</div>

        {/* 原版：说明文字在字段**上方** */}
        <p className="share-dialog-desc">{tx('papers.share.form.description')}</p>

        <label className="share-dialog-label">{tx('papers.share.form.cost')}</label>
        <input
          className="input share-dialog-input"
          autoFocus
          type="number"
          min={0}
          placeholder={tx('papers.share.form.costPlaceholder')}
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />

        <div className="share-dialog-actions">
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            {tx('common.cancel')}
          </button>
          <button className="btn btn-sm btn-light" onClick={submit}>
            {tx('papers.share.form.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
