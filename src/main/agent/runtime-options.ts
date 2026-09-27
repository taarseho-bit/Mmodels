import type { McpServerConfig, ProviderConfig } from '@shared/types';
import type { McpServerConfig as SdkMcpConfig } from '@anthropic-ai/claude-agent-sdk';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Endpoint-specific model hint. Never apply it to arbitrary gateways. */
export function sdkModel(provider: ProviderConfig, model: string): string {
  // OpenAI 桥固定上游原始模型名，后缀仅给本地运行器提供窗口提示。
  if (provider.apiFormat === 'openai' && (knownContextWindow(provider, model) ?? 0) > 200_000) return `${model}[1m]`;
  return provider.apiFormat === 'anthropic'
    && provider.baseUrl.trim().replace(/\/+$/, '') === 'https://api.deepseek.com/anthropic'
    && ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-flash'].includes(model) ? `${model}[1m]` : model;
}

/**
 * 识别当前产品明确支持的长窗口模型。
 * 用户可能通过 OpenAI/Anthropic 兼容网关接入 DeepSeek，不能因为网关改了域名
 * 就退回 SDK 默认窗口；模型名本身已经是用户选择的容量依据。
 */
export function knownContextWindow(provider: ProviderConfig, model: string): number | undefined {
  const configured = provider.contextWindows?.[model];
  if (Number.isFinite(configured) && configured! >= 128_000) return Math.min(1_000_000, Math.floor(configured!));
  const normalizedModel = model.trim().toLowerCase().replace(/\[1m\]$/, '');
  if (['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro'].includes(normalizedModel)) return 1_000_000;
  try {
    if (new URL(provider.baseUrl).hostname === 'api.deepseek.com'
      && ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro'].includes(normalizedModel)) return 1_000_000;
  } catch { /* invalid URL is reported when connecting */ }
  return undefined;
}

export function boundedContextWindow(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(1_000_000, Math.floor(value)) : 200_000;
}

export function resolveStdioLauncher(
  command: string,
  args: string[] = [],
  roots: string[] = [process.resourcesPath, join(process.cwd(), 'resources')],
): { command: string; args: string[] } {
  if (command.trim().toLowerCase() !== 'uvx') return { command, args };
  for (const root of roots.filter(Boolean)) {
    const executable = join(root, 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv');
    if (existsSync(executable)) return { command: executable, args: ['tool', 'run', ...args] };
  }
  return { command, args };
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
      const launcher = resolveStdioLauncher(m.command, m.args);
      result[name] = { type: 'stdio', command: launcher.command, args: launcher.args, env: m.env };
    }
  }
  return result;
}

/**
 * 项目范围过滤：没有 projectIds 的历史连接器继续全局生效；
 * 新连接器可以只绑定到一个或多个项目，避免不同竞赛项目互相串数据。
 */
export function mcpServersForProject(servers: McpServerConfig[], projectId?: string): McpServerConfig[] {
  return servers.filter(server => {
    const ids = server.projectIds?.filter(Boolean);
    return !ids?.length || (!!projectId && ids.includes(projectId));
  });
}
