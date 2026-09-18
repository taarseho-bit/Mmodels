import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resourceRoots, resolveResource, resolveResourcesRoot } from './resources';

function fixture(): string {
  return mkdtempSync(join(tmpdir(), 'mmodels-resources-'));
}

describe('随包资源定位', () => {
  it('打包版 app.asar 会回到同级 resources，而不是拼成 app.asar/resources', () => {
    const root = fixture();
    const resources = join(root, 'resources');
    mkdirSync(join(resources, 'algorithms'), { recursive: true });
    writeFileSync(join(resources, 'algorithms', 'catalog.json'), '{}');
    const locations = {
      resourcesPath: null,
      appPath: join(resources, 'app.asar'),
      exePath: join(root, 'MModels.exe'),
      cwd: join(root, 'elsewhere'),
    };

    expect(resolveResource(['algorithms', 'catalog.json'], locations))
      .toBe(join(resources, 'algorithms', 'catalog.json'));
    expect(resourceRoots(locations)).not.toContain(join(resources, 'app.asar', 'resources'));
  });

  it('免安装版可从 exe 同级 resources 找到资源', () => {
    const root = fixture();
    mkdirSync(join(root, 'resources', 'builtin-skills'), { recursive: true });
    expect(resolveResourcesRoot(['builtin-skills'], '技能资源', {
      resourcesPath: join(root, 'temp-missing'),
      appPath: null,
      exePath: join(root, 'MModels.exe'),
      cwd: null,
    })).toBe(join(root, 'resources'));
  });

  it('开发版可从项目 resources 找到资源', () => {
    const root = fixture();
    mkdirSync(join(root, 'resources', 'pdfjs'), { recursive: true });
    expect(resolveResourcesRoot(['pdfjs'], 'PDF 资源', {
      resourcesPath: null,
      appPath: root,
      exePath: null,
      cwd: root,
    })).toBe(join(root, 'resources'));
  });

  it('缺失时只给中文恢复提示，不暴露内部候选路径', () => {
    const root = fixture();
    let text = '';
    try {
      resolveResourcesRoot(['missing'], '算法资源', {
        resourcesPath: join(root, 'secret-temp'),
        appPath: join(root, 'resources', 'app.asar'),
        exePath: null,
        cwd: null,
      });
    } catch (error) {
      text = String(error);
    }
    expect(text).toContain('没有找到内置算法资源');
    expect(text).not.toContain('secret-temp');
  });
});
