/**
 * 「Agent 提问」确认框。
 *
 * 背景（用户实机反馈）：Agent 用 AskUserQuestion 提问时，宿主没接对话框，
 * 模型只能把「需你确认的 4 个选择 + A/B/C 选项」当普通 markdown 打出来，
 * 用户得手打回复。这里把它渲染成真正的确认弹窗：点选项 → 提交 → 答案回传。
 *
 * 数据来源：`window.mathmodel.session.onAskUser`（主进程 canUseTool 发出），
 * 作答走 `session.answerUser`，主进程那条 promise 才会 resolve。
 *
 * 每个问题同时给一个自由输入框 —— 这是 AskUserQuestion 工具本身的约定
 * （「always includes a Skip button and a free-text input box for custom answers」），
 * 所以 i18n 里的 customAnswerHint 才是「也可以在下方输入框中填写自定义回答」。
 *
 * 文案对接原版已有的 i18n 键（`notifications.*` / `composer.composerPendingUserInputPanel.*`，
 * 见 i18n/zh.ts），不新造一套词。
 */
import { useEffect, useMemo, useState } from 'react';
import type { AskUserRequest } from '@shared/types';
import { tx } from '../i18n';
import { Icon } from './Icon';

interface Props {
  request: AskUserRequest;
  /** 提交作答（answers: 问题原文 → 答案字符串） */
  onSubmit: (answers: Record<string, string>) => void;
  /** 取消（模型会收到「用户未作答」） */
  onCancel: () => void;
}

/**
 * 组装单个问题的最终答案 —— **追加语义**（2026-09-20，用户需求）。
 *
 * 所选选项原样保留，自由输入的文字**追加**在选项之后一起提交，
 * 而不是「填了自定义就把所选选项丢掉」。单选与多选行为一致；
 * 什么都没选、也没填字时返回空串（由「全部作答」校验拦住）。
 * 抽成纯函数是为了在 node 测试环境（无 DOM）下也能钉死这条语义。
 */
export function composeAnswer(picked: string[], freeText: string): string {
  const text = freeText.trim();
  return [...picked, ...(text ? [text] : [])].join(', ');
}

export function AskUserDialog({ request, onSubmit, onCancel }: Props): JSX.Element {
  const questions = request.questions;
  const blank = useMemo(() => questions.map(() => ({ picked: [] as string[], text: '' })), [
    questions,
  ]);
  const [state, setState] = useState(blank);

  // 换了一条请求（新一轮提问）就重置选择
  useEffect(() => {
    setState(blank);
  }, [request.requestId, blank]);

  // Esc 关闭 = 取消
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const answerOf = (i: number): string => {
    const s = state[i];
    if (!s) return '';
    return composeAnswer(s.picked, s.text);
  };

  const answeredAll = questions.every((_, i) => answerOf(i) !== '');

  const toggle = (qIdx: number, label: string, multi: boolean): void => {
    setState((prev) =>
      prev.map((s, i) => {
        if (i !== qIdx) return s;
        if (multi) {
          return {
            ...s,
            picked: s.picked.includes(label)
              ? s.picked.filter((l) => l !== label)
              : [...s.picked, label],
          };
        }
        return { ...s, picked: s.picked[0] === label ? [] : [label] };
      }),
    );
  };

  const setText = (qIdx: number, text: string): void => {
    setState((prev) => prev.map((s, i) => (i === qIdx ? { ...s, text } : s)));
  };

  const submit = (): void => {
    if (!answeredAll) return;
    const answers: Record<string, string> = {};
    questions.forEach((q, i) => {
      answers[q.question] = answerOf(i);
    });
    onSubmit(answers);
  };

  return (
    // ⚠️ 遮罩**故意不绑 onClick**（别再改成点背景即取消）。
    //    这是阻断「弹窗莫名其妙没了」的唯一机械通道：遮罩铺满整个视口，
    //    任何一次误点/外部真实鼠标点击（实机采集时验证过：一次落在
    //    `.ask-option` 之外的点击就会被 backdrop 吃掉）都会把这次提问
    //    变成「用户关闭了提问，没有作答」，模型随即按"没拿到答案"继续。
    //    取消只能由用户显式触发：Esc 或「取消」按钮。
    <div className="modal-backdrop">
      <div
        className="modal ask-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tx('integrations.taskCompletion.questionFromAgent')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="ask-dialog-heading">
            <Icon name="message-square" size={16} />
            <span className="modal-title">{tx('integrations.taskCompletion.questionFromAgent')}</span>
            {questions.length > 1 && (
              <span className="ask-dialog-progress">
                {tx('composer.composerPendingUserInputPanel.questionProgress', {
                  current: 1,
                  total: questions.length,
                })}
              </span>
            )}
          </div>
        </div>

        <div className="modal-body ask-dialog-body">
          {questions.map((q, qIdx) => {
            const multi = q.multiSelect === true;
            const chosen = state[qIdx]?.picked ?? [];
            return (
              <section className="ask-question" key={`${q.question}-${qIdx}`}>
                {q.header && <div className="ask-question-header">{q.header}</div>}
                <div className="ask-question-text">{q.question}</div>
                <div className="ask-options" data-question-index={qIdx}>
                  {q.options.map((opt) => {
                    const selected = chosen.includes(opt.label);
                    return (
                      <button
                        type="button"
                        key={opt.label}
                        className={`ask-option${selected ? ' is-selected' : ''}`}
                        aria-pressed={selected}
                        onClick={() => toggle(qIdx, opt.label, multi)}
                      >
                        <span className={`ask-option-mark${multi ? ' is-multi' : ''}`}>
                          {selected && <Icon name="check" size={12} />}
                        </span>
                        <span className="ask-option-body">
                          <span className="ask-option-label">{opt.label}</span>
                          {opt.description && (
                            <span className="ask-option-desc">{opt.description}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <input
                  className="input ask-question-input"
                  value={state[qIdx]?.text ?? ''}
                  placeholder={tx('composer.composer.placeholderPendingUserInput')}
                  onChange={(e) => setText(qIdx, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit();
                  }}
                />
                <div className="ask-question-hint">
                  {multi
                    ? tx('composer.composerPendingUserInputPanel.customAnswerHintMultiSelect')
                    : tx('composer.composerPendingUserInputPanel.customAnswerHint')}
                </div>
              </section>
            );
          })}
        </div>

        <div className="modal-foot ask-dialog-foot">
          <span className="ask-dialog-foot-hint">{tx('integrations.taskCompletion.waitingForAnswer')}</span>
          <div className="grow" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            {tx('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!answeredAll}
            title={tx('composer.composer.submitAnswerTooltip')}
            onClick={submit}
          >
            {tx('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
