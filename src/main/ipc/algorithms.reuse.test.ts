import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), spawn: vi.fn(), download: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: (key: string, fn: (...args: any[]) => any) => state.handlers.set(key, fn) } }));
vi.mock('./index', () => ({ safeWrap: (fn: unknown) => fn, pushToRenderer: vi.fn() }));
vi.mock('../scan/environment', () => ({ findPython: vi.fn(async () => ({ cmd: 'existing-python', prefixArgs: [] })) }));
vi.mock('../resources', () => ({ resolveResource: () => 'resources/algorithms/catalog.json' }));
vi.mock('node:https', () => ({ get: state.download }));
vi.mock('node:child_process', () => ({ spawn: state.spawn, execFile: (_cmd: string, args: string[], _opts: unknown, callback: Function) => {
  callback(null, args.includes('--version') ? 'Python 3.12.10' : '', '');
} }));
import { IPC } from '@shared/types';
import { registerAlgorithmHandlers } from './algorithms';

describe('环境安装先复用', () => {
  registerAlgorithmHandlers({} as never);
  it('本机已有 Python，不下载安装器', async () => {
    expect(await state.handlers.get(IPC.ALG_INSTALL_PYTHON)!()).toMatchObject({ ok: true, version: '3.12.10' });
    expect(state.download).not.toHaveBeenCalled();
    expect(state.spawn).not.toHaveBeenCalled();
  });
  it('依赖已可导入，不创建环境、不运行 pip', async () => {
    expect(await state.handlers.get(IPC.ALG_INSTALL)!(null, 'numpy')).toMatchObject({ ok: true });
    expect(state.spawn).not.toHaveBeenCalled();
  });
  it('拒绝目录外包名，防止将任意 pip 参数写入共用环境', async () => {
    await expect(state.handlers.get(IPC.ALG_INSTALL)!(null, '--upgrade')).rejects.toThrow('目录');
  });
});
