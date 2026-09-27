import { describe, expect, it } from 'vitest';
import { CONNECTOR_CATALOG } from './connector-catalog';

describe('连接器目录', () => {
  it('覆盖文献、数据、科研资料、代码和本地计算', () => {
    expect(CONNECTOR_CATALOG.length).toBeGreaterThanOrEqual(18);
    for (const category of ['literature', 'datasets', 'research', 'files', 'code', 'compute']) {
      expect(CONNECTOR_CATALOG.some(item => item.category === category)).toBe(true);
    }
  });

  it('连接器名称可以安全映射为 MCP 名称', () => {
    const names = CONNECTOR_CATALOG.map(item => item.key);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every(name => /^[\w-]+$/.test(name))).toBe(true);
  });
});
