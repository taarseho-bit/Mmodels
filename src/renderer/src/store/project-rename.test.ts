/**
 * 项目重命名：侧栏项目行 hover 出的「重命名」按钮走的就是这条链路。
 *
 * 这里断言的是「重命名真的生效」——不是只画个图标：
 * 调一次 IPC、刷新 `projects`、若改的是当前项目还要同步 `currentProject`。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectMeta } from '@shared/types';
import { useApp } from './app';

const meta = (name: string): ProjectMeta => ({
  id: 'p1',
  name,
  root: 'D:/p1',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
});

const rename = vi.fn(async (id: string, name: string): Promise<ProjectMeta | null> =>
  id === 'p1' ? { ...meta(name), updatedAt: 2 } : null,
);

beforeEach(() => {
  rename.mockClear();
  // `api()` 在调用时读 window.mathmodel，所以在用例里临时挂一个即可
  (globalThis as unknown as { window: unknown }).window = { mathmodel: { project: { rename } } };
  useApp.setState({ projects: [meta('Workspace')], currentProject: meta('Workspace') });
});

describe('项目重命名', () => {
  it('改名后 projects 与 currentProject 同步更新', async () => {
    await useApp.getState().renameProject('p1', '2024 国赛 A 题');
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith('p1', '2024 国赛 A 题');
    expect(useApp.getState().projects[0].name).toBe('2024 国赛 A 题');
    expect(useApp.getState().currentProject?.name).toBe('2024 国赛 A 题');
  });

  it('首尾空白会被裁掉', async () => {
    await useApp.getState().renameProject('p1', '  我的项目  ');
    expect(rename).toHaveBeenCalledWith('p1', '我的项目');
  });

  it('空名字直接忽略，不打 IPC', async () => {
    await useApp.getState().renameProject('p1', '   ');
    expect(rename).not.toHaveBeenCalled();
    expect(useApp.getState().projects[0].name).toBe('Workspace');
  });

  it('改的不是当前项目时，currentProject 不受影响', async () => {
    useApp.setState({
      projects: [meta('Workspace'), { ...meta('另一个'), id: 'p2' }],
      currentProject: meta('Workspace'),
    });
    rename.mockResolvedValueOnce({ ...meta('另一个改名'), id: 'p2' });
    await useApp.getState().renameProject('p2', '另一个改名');
    expect(useApp.getState().projects.map((p) => p.name)).toEqual(['Workspace', '另一个改名']);
    expect(useApp.getState().currentProject?.name).toBe('Workspace');
  });
});
