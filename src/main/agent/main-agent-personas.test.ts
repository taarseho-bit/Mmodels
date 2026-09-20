import { describe, expect, it } from 'vitest';
import { mainAgentPersonaSection, taskKindForPrompt } from './main-agent-personas';

/**
 * 主智能体领衔角色（2026-09-21 用户需求）：
 * 写论文/评审/找数据/绘图四种模式各有领衔主智能体，不再"写谁都是论文那套"。
 * 判定来自本轮提示词的斜杠命令（渲染层 Composer 的 MODE_COMMAND 自动预填），
 * chat 与无命令消息不注入 —— 通用主智能体零漂移。
 *
 * 本文件只测纯函数；buildSystemPrompt 的集成断言在
 * `src/main/ipc/main-agent-persona-prompt.test.ts`（那边要垫 electron/db 桩）。
 */
describe('taskKindForPrompt —— 斜杠命令反推任务类型', () => {
  it('四种模式命令各自命中', () => {
    expect(taskKindForPrompt('/mma-paper 完成一篇完整论文')).toBe('paper');
    expect(taskKindForPrompt('/mma-review 按评审标准审读')).toBe('review');
    expect(taskKindForPrompt('/data-search 查找并核验公开数据')).toBe('data');
    expect(taskKindForPrompt('/mma-figure 绘制投稿级图表')).toBe('figure');
  });

  it('命令在消息中部也命中（渲染层预填后用户在前面补了文字）', () => {
    expect(taskKindForPrompt('请开始：\n/mma-review 输出评分')).toBe('review');
  });

  it('chat 与识别不出命令的消息 → chat（不注入角色）', () => {
    expect(taskKindForPrompt('')).toBe('chat');
    expect(taskKindForPrompt('帮我看看这段代码')).toBe('chat');
    expect(taskKindForPrompt('/unknown-cmd 试试')).toBe('chat');
  });
});

describe('mainAgentPersonaSection —— 注入与零漂移', () => {
  it('四种模式各含对应的领衔角色标题与技能口径', () => {
    const paper = mainAgentPersonaSection('/mma-paper 写论文');
    expect(paper.join('\n')).toContain('论文写作主智能体');
    expect(paper.join('\n')).toContain('paper-section-writer');

    const review = mainAgentPersonaSection('/mma-review 评审');
    expect(review.join('\n')).toContain('评审主智能体');
    expect(review.join('\n')).toContain('claim-evidence-audit');

    const data = mainAgentPersonaSection('/data-search 找数据');
    expect(data.join('\n')).toContain('数据检索主智能体');
    expect(data.join('\n')).toContain('data-auditor-cleaner');

    const figure = mainAgentPersonaSection('/mma-figure 绘图');
    expect(figure.join('\n')).toContain('图表制作主智能体');
    expect(figure.join('\n')).toContain('figure-table-planner');
  });

  it('chat 返回空数组（通用主智能体零漂移）', () => {
    expect(mainAgentPersonaSection('随便聊聊')).toEqual([]);
  });
});
