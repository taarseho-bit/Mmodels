import { describe, expect, it } from 'vitest';
import { mcpServersForProject, userMcpOptions } from './runtime-options';
import type { McpServerConfig } from '@shared/types';

describe('连接器运行配置', () => {
  const base: McpServerConfig[] = [
    { name: 'global', transport: 'stdio', command: 'node', args: [], env: {} },
    { name: 'project-a', transport: 'http', url: 'https://example.com/mcp', projectIds: ['a'] },
    { name: 'project-b', transport: 'http', url: 'https://example.com/mcp', projectIds: ['b'] },
  ];

  it('历史全局连接器继续生效，项目连接器按项目过滤', () => {
    expect(mcpServersForProject(base, 'a').map(v => v.name)).toEqual(['global', 'project-a']);
    expect(mcpServersForProject(base, 'b').map(v => v.name)).toEqual(['global', 'project-b']);
    expect(mcpServersForProject(base).map(v => v.name)).toEqual(['global']);
  });

  it('只把有效的 MCP 配置交给 SDK', () => {
    const result = userMcpOptions([base[0], { name: 'disabled', enabled: false, transport: 'stdio', command: 'node' }]);
    expect(Object.keys(result)).toEqual(['global']);
    expect(result.global).toMatchObject({ type: 'stdio', command: 'node' });
  });
});
