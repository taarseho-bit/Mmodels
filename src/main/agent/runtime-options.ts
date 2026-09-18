import type { McpServerConfig, ProviderConfig } from '@shared/types';
import type { McpServerConfig as SdkMcpConfig } from '@anthropic-ai/claude-agent-sdk';

/** Same endpoint-specific model hint as the original. Never apply to arbitrary gateways. */
export function sdkModel(provider: ProviderConfig, model: string): string {
  return provider.apiFormat === 'anthropic'
    && provider.baseUrl.trim().replace(/\/+$/, '') === 'https://api.deepseek.com/anthropic'
    && ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-flash'].includes(model) ? `${model}[1m]` : model;
}

/** Verified official DeepSeek V4/Flash endpoint only; do not guess limits for third-party aliases. */
export function knownContextWindow(provider: ProviderConfig, model: string): number | undefined {
  try {
    if (new URL(provider.baseUrl).hostname === 'api.deepseek.com'
      && ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro'].includes(model)) return 1_000_000;
  } catch { /* invalid URL is reported when connecting */ }
  return undefined;
}

export function userMcpOptions(servers: McpServerConfig[]): Record<string, SdkMcpConfig> {
  const result: Record<string, SdkMcpConfig> = Object.create(null);
  for (const m of servers) {
    if (m.enabled === false) continue;
    const name = m.name.trim();
    if (!/^[\w-]+$/.test(name)) throw new Error(`连接器名称不合法：${name}`);
    if (result[name]) throw new Error(`连接器名称重复：${name}`);
    if (m.transport === 'http') {
      if (!/^https?:\/\//i.test(m.url ?? '')) throw new Error(`连接器 ${name} 缺少有效地址`);
      result[name] = { type: 'http', url: m.url!, headers: m.headers };
    } else {
      if (!m.command?.trim()) throw new Error(`连接器 ${name} 缺少启动命令`);
      result[name] = { type: 'stdio', command: m.command, args: m.args, env: m.env };
    }
  }
  return result;
}
