import { describe, expect, it } from 'vitest';
import { friendlyError } from './friendly-error';

describe('friendlyError', () => {
  it('把文件格式错误转成中文且不暴露接口术语', () => {
    const text = friendlyError(new Error('API Error: 400 document content is not supported'));
    expect(text).toContain('不能直接读取');
    expect(text).not.toContain('API Error');
  });

  it('未知错误使用可行动的保留提示', () => {
    expect(friendlyError(new Error('some internal stack'))).toBe('这一步没有完成，内容已保留，可以重试。');
  });
});

