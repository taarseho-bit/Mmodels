import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { configureSharedEnvironment, sharedEnvironmentRoot, sharedPythonPath, sharedRuntimeEnv, sharedEnvironmentInstructions, usablePythonDirectory } from './shared-environment';

describe('软件共用环境', () => {
  it('目录只由软件数据位置决定，与项目和免安装解压目录无关', () => {
    configureSharedEnvironment('C:/app-data/MModels');
    expect(sharedEnvironmentRoot()).toBe(join('C:/app-data/MModels', 'runtime'));
    expect(sharedPythonPath()).toContain(join('runtime', 'python'));
    expect(sharedRuntimeEnv().UV_PROJECT_ENVIRONMENT).toBe(join(sharedEnvironmentRoot()!, 'python'));
  });
  it('下载缓存共用，默认国内镜像，明确禁止逐项目重装和同步清理', () => {
    const env = sharedRuntimeEnv();
    expect(env.PIP_CACHE_DIR).toContain(join('runtime', 'cache'));
    expect(env.UV_CACHE_DIR).toContain(join('runtime', 'cache'));
    expect(env.PIP_INDEX_URL).toContain('tuna.tsinghua.edu.cn');
    expect(sharedEnvironmentInstructions()).toContain('不默认创建项目 .venv');
    expect(sharedEnvironmentInstructions()).toContain('主助手串行处理');
  });
  it('跳过 Windows 商店占位程序，把真正可用的 Python 放到命令搜索最前面', () => {
    const path = ['C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps', 'D:\\Anaconda3'].join(';');
    const dir = usablePythonDirectory(path, 'win32', executable => executable === 'D:\\Anaconda3\\python.exe');
    expect(dir).toBe('D:\\Anaconda3');
  });
});
