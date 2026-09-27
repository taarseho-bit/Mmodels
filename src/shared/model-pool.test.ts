import { describe, expect, it } from 'vitest';
import { chooseModelRoute, normalizeContextWindow, normalizeModelIds } from './model-pool';

describe('模型池路由', () => {
  it('去重并忽略带空格的模型名', () => {
    expect(normalizeModelIds([' a ', 'a', '', 'bad id', 'b'])).toEqual(['a', 'b']);
  });

  it('优先当前默认模型，显式备用排在池内推断备用之前', () => {
    expect(chooseModelRoute({
      models: ['a', 'b', 'c'],
      modelPool: ['a', 'b', 'c'],
      defaultModel: 'b',
      fallbackModels: ['c'],
    })).toMatchObject({ primary: 'b', fallbacks: ['c', 'a'] });
  });

  it('默认值不在池内时选择池首项，并过滤不存在的备用', () => {
    expect(chooseModelRoute({
      models: ['a', 'b'],
      modelPool: ['b'],
      defaultModel: 'missing',
      fallbackModels: ['missing', 'b'],
    })).toMatchObject({ primary: 'b', fallbacks: [] });
  });

  it('上下文容量最大限制为 1M', () => {
    expect(normalizeContextWindow(1_500_000)).toBe(1_000_000);
    expect(normalizeContextWindow(100_000)).toBeUndefined();
  });
});

