import { describe, expect, it } from 'vitest';
import { projectRunFile, validateWebhookUrl } from './native-connectors';

describe('原生连接器安全边界', () => {
  it('运行脚本文件名始终落在项目 .mathmodel 目录', () => {
    const file = projectRunFile('D:/demo/project', '../outside.py', 'py').replaceAll('\\', '/');
    expect(file).toBe('D:/demo/project/.mathmodel/outside.py');
    expect(file.startsWith('D:/demo/project/.mathmodel/')).toBe(true);
  });

  it('拒绝不安全的 Webhook 地址', async () => {
    await expect(validateWebhookUrl('ftp://example.com/hook')).rejects.toThrow('HTTP 或 HTTPS');
    await expect(validateWebhookUrl('http://localhost/hook')).rejects.toThrow('本机');
    await expect(validateWebhookUrl('https://user:pass@example.com/hook')).rejects.toThrow('登录信息');
    await expect(validateWebhookUrl('https://example.com/hook?token=secret')).rejects.toThrow('查询参数');
  });
});
