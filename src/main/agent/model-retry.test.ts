import { describe, expect, it } from 'vitest';
import { isRetryableModelError } from './model-retry';

describe('模型池故障判定', () => {
  it.each([
    'HTTP 429：请求太多',
    '连接失败：fetch failed',
    'upstream timeout',
    'API status 503',
    '模型暂时不可用',
  ])('把 %s 视为可切换故障', (message) => {
    expect(isRetryableModelError(new Error(message))).toBe(true);
  });

  it.each(['技能库未能加载', '没有权限写入文件', '工具参数不正确'])('不重试 %s', (message) => {
    expect(isRetryableModelError(new Error(message))).toBe(false);
  });
});
