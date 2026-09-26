import { expect, it } from 'vitest';
import type { ProviderConfig } from '@shared/types';
import { knownContextWindow, boundedContextWindow, sdkModel } from './runtime-options';
const provider: ProviderConfig = { id:'p', name:'test', apiKey:'', apiFormat:'openai', baseUrl:'https://api.deepseek.com', enabled:true };
it('Flash识别1M，旧名称不冒充长窗口', () => {
  expect(knownContextWindow(provider,'deepseek-flash')).toBe(1_000_000);
  expect(knownContextWindow(provider,'deepseek-chat')).toBeUndefined();
  expect(knownContextWindow({...provider,baseUrl:'https://example.com'},'deepseek-flash[1m]')).toBe(1_000_000);
});
it('1M为上限，兼容300K和200K模型', () => {
  for (const n of [128000,200000,300000,1000000]) expect(knownContextWindow({...provider,contextWindows:{custom:n}},'custom')).toBe(n);
  expect(boundedContextWindow(2_000_000)).toBe(1_000_000);
  expect(boundedContextWindow(128000)).toBe(128000);
  expect(boundedContextWindow(NaN)).toBe(200000);
});
it('本地桥使用长窗口提示，上游forceModel仍为原始名称', () => {
  expect(sdkModel(provider,'deepseek-flash')).toBe('deepseek-flash[1m]');
  expect(sdkModel({...provider,contextWindows:{custom:300000}},'custom')).toBe('custom[1m]');
  expect(sdkModel({...provider,contextWindows:{custom:200000}},'custom')).toBe('custom');
});
