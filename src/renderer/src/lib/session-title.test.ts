import { describe, expect, it } from 'vitest';
import { sessionTitleFromPrompt } from './session-title';

describe('任务标题', () => {
  it('去掉论文命令，只保留用户真正的问题', () => {
    expect(sessionTitleFromPrompt('/mma-paper 建立一个合理的种植策略模型')).toBe('建立一个合理的种植策略模型');
  });

  it('附件任务不显示“参考以下文件”和磁盘路径', () => {
    expect(sessionTitleFromPrompt('/mma-paper\n参考以下文件：\n- H:\\比赛题目.pdf'))
      .toBe('论文写作');
  });

  it('普通长标题会稳定截断', () => {
    expect(sessionTitleFromPrompt('分析这组数据并给出可以直接用于论文的完整结论', 10))
      .toBe('分析这组数据并给出可…');
  });
});
