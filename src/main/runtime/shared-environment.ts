/** Application-owned, project-independent runtime locations. No installation on project creation. */
import { join, delimiter, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let runtimeRoot: string | undefined;
let detectedPythonDir: string | undefined;

function usablePython(executable: string): boolean {
  if (!existsSync(executable)) return false;
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
  return result.status === 0 && /python\s+3/i.test(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
}

/** 找出 PATH 中真实可运行的 Python，跳过 Windows 商店占位程序。 */
export function usablePythonDirectory(
  pathValue = process.env.PATH ?? '',
  platform = process.platform,
  probe: (executable: string) => boolean = usablePython,
): string | undefined {
  const filename = platform === 'win32' ? 'python.exe' : 'python3';
  for (const raw of pathValue.split(delimiter)) {
    const dir = raw.trim().replace(/^"|"$/g, '');
    if (!dir || (platform === 'win32' && /microsoft\\windowsapps/i.test(dir))) continue;
    const executable = join(dir, filename);
    if (probe(executable)) return dir;
  }
  return undefined;
}

export function configureSharedEnvironment(userData: string): void {
  runtimeRoot = join(userData, 'runtime');
  detectedPythonDir = usablePythonDirectory();
}
export function sharedEnvironmentRoot(): string | undefined { return runtimeRoot; }
export function sharedPythonPath(): string | undefined {
  return runtimeRoot && join(runtimeRoot, 'python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}
export function managedPythonPath(): string | undefined {
  return runtimeRoot && join(runtimeRoot, 'python-base', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
}
export function sharedRuntimeEnv(): NodeJS.ProcessEnv {
  if (!runtimeRoot) return {};
  const py = sharedPythonPath()!;
  const base = managedPythonPath()!;
  const dirs = [py, base].filter(existsSync).map(dirname);
  if (detectedPythonDir && !dirs.includes(detectedPythonDir)) dirs.push(detectedPythonDir);
  return {
    ...(dirs.length ? { PATH: [...dirs, process.env.PATH ?? ''].join(delimiter) } : {}),
    MMODELS_RUNTIME_ROOT: runtimeRoot,
    MMODELS_SHARED_PYTHON: py,
    UV_PROJECT_ENVIRONMENT: join(runtimeRoot, 'python'),
    UV_CACHE_DIR: join(runtimeRoot, 'cache', 'uv'),
    UV_PYTHON_INSTALL_DIR: join(runtimeRoot, 'uv-python'),
    PIP_CACHE_DIR: join(runtimeRoot, 'cache', 'pip'),
    PIP_INDEX_URL: 'https://pypi.tuna.tsinghua.edu.cn/simple',
    UV_DEFAULT_INDEX: 'https://pypi.tuna.tsinghua.edu.cn/simple',
  };
}
export function sharedEnvironmentInstructions(): string {
  return [
    '# 运行环境：本机安装一次，所有项目共用',
    `软件共用目录：${runtimeRoot ?? '由设置 → 运行环境确定'}。项目目录只放数据、代码、论文和产物。`,
    '- 先检测并复用本机已有 Python、Git、LaTeX、绘图与 PDF 工具；不要因新建/切换项目重复安装或复制。',
    '- Python 优先使用可运行的 MMODELS_SHARED_PYTHON，否则使用 PATH 中已有 Python。先 import 任务需要的库；成功就直接工作。',
    '- 缺库时，只在获得安装授权后，用已有 Python 执行 python -m venv --system-site-packages "$UV_PROJECT_ENVIRONMENT" 创建一次软件共用环境，再用其解释器补装缺少的库。共享环境已存在时不要重建。',
    '- 不默认创建项目 .venv，不使用 uv run/uv sync 将项目依赖同步或清理到共享环境；运行脚本用明确的 Python 路径。不要自动升级、降级或卸载共享依赖。',
    '- 旧项目 .venv 保留不删除；确有不兼容的版本要求，先说明冲突，用户同意后才使用项目隔离环境。',
    '- 所有子智能体沿用同一环境；安装由主助手串行处理，避免多人同时安装。首次下载默认国内镜像。',
    '- 不把运行环境装进免安装版的临时解压目录；已有系统工具保留原位置，不搬动、不卸载。',
  ].join('\n');
}
