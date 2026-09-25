import { describe, expect, it } from 'vitest';
import { userTextBlock } from './user-message';
describe('模式指令与用户可见消息分离', () => {
  it.each(['/write-paper', '/review-paper', '/draw-figures'])('保留 %s 执行内容，气泡只有用户原文', (command) => {
    const prompt = `${command}\n\n比赛信息：示例\n\n请处理附件`;
    const block = userTextBlock(prompt, '请处理附件');
    expect(block.text).toBe('请处理附件');
    expect(block.modelText).toBe(prompt);
    expect(JSON.parse(JSON.stringify(block))).toEqual(block);
  });
  it('用户自己输入的命令以及旧消息保持原样', () => {
    expect(userTextBlock('/review-paper 手动指令').text).toBe('/review-paper 手动指令');
    expect(userTextBlock('/review-paper 手动指令', '/review-paper 手动指令').modelText).toBeUndefined();
  });
});
