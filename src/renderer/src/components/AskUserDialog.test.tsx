/**
 * AskUserDialog 的「追加」语义 + 静态渲染冒烟（2026-09-20，用户需求）。
 *
 * 背景：用户反馈「对话框里面每个选择的下面有一个自定义的对话，那个对话改成追加，
 * 也就是我选择了选项，对话框的选择内容也要进去」——即自由输入与所选选项
 * **同时生效**（追加拼接），而不是以前单选分支的「填了自定义就丢掉所选选项」。
 *
 * 测试环境是 node（无 DOM），交互测试跑不了；核心语义抽在纯函数
 * `composeAnswer` 里直接单测，渲染侧用 renderToStaticMarkup 做冒烟。
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AskUserDialog, composeAnswer } from './AskUserDialog';
import type { AskUserRequest } from '@shared/types';

describe('composeAnswer —— 选项 + 自定义输入的追加语义', () => {
  it('选了选项 + 填了自定义 → 两者都进答案（选项在前，自定义追加在后）', () => {
    expect(composeAnswer(['灰色预测模型'], '补充：误差用 MAPE 评估')).toBe(
      '灰色预测模型, 补充：误差用 MAPE 评估',
    );
  });

  it('只选选项、没填自定义 → 就是选项本身（不拖尾巴）', () => {
    expect(composeAnswer(['灰色预测模型'], '')).toBe('灰色预测模型');
    expect(composeAnswer(['灰色预测模型'], '   ')).toBe('灰色预测模型');
  });

  it('只填自定义、没选选项 → 就是自定义本身（原 Skip 行为不回归）', () => {
    expect(composeAnswer([], '我都听你的，选最稳的')).toBe('我都听你的，选最稳的');
  });

  it('多选：多个选项 + 自定义，全部按序追加', () => {
    expect(composeAnswer(['残差检验', 'F 检验'], '再加交叉验证')).toBe(
      '残差检验, F 检验, 再加交叉验证',
    );
  });

  it('自定义文字首尾空白被裁掉，但选项之间的顺序保持', () => {
    expect(composeAnswer(['A 选项'], '  带空白的补充  ')).toBe('A 选项, 带空白的补充');
  });

  it('什么都不选不填 → 空串（由「全部作答」校验拦住，不产生假答案）', () => {
    expect(composeAnswer([], '')).toBe('');
  });
});

describe('AskUserDialog 渲染冒烟（node 环境 renderToStaticMarkup）', () => {
  const request: AskUserRequest = {
    requestId: 'req-1',
    sessionId: 'sess-1',
    questions: [
      {
        header: '模型选择',
        question: '用哪个模型？',
        options: [
          { label: '灰色预测模型', description: '适合小样本' },
          { label: 'ARIMA', description: '适合平稳序列' },
        ],
      },
    ],
  };

  it('问题、选项与「追加」提示文案都出现在首屏标记里', () => {
    const html = renderToStaticMarkup(
      <AskUserDialog request={request} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(html).toContain('用哪个模型？');
    expect(html).toContain('灰色预测模型');
    expect(html).toContain('ARIMA');
    // 追加语义的提示（composer.composerPendingUserInputPanel.customAnswerHint）
    expect(html).toContain('追加');
  });
});
