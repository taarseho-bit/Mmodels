import { describe, expect, it } from 'vitest';
import { resolve, join } from 'node:path';
import { projectPathRelation } from './project-paths';
describe('独立项目目录', () => {
  const base = resolve('test-independent-projects');
  it('相邻名称不是上下级', () => expect(projectPathRelation(join(base, '论文'), join(base, '论文C题'))).toBe('separate'));
  it('同父目录项目相互独立', () => expect(projectPathRelation(join(base, 'A'), join(base, 'B'))).toBe('separate'));
  it('真实子目录能被发现', () => expect(projectPathRelation(join(base, 'A'), join(base, 'A', 'B'))).toBe('inside'));
  it('规范化后相同位置不重复登记', () => expect(projectPathRelation(join(base, 'A'), join(base, 'B', '..', 'A'))).toBe('same'));
});
