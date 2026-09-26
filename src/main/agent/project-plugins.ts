import { app } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppSettings } from '@shared/types';

/** Load only project-scoped plugins; do not enable unrelated host `.claude` settings. */
export function projectSkillsPlugin(cwd: string, storage = app.getPath('userData')): string | null {
  const source = join(cwd, '.claude', 'skills');
  if (!existsSync(source) || !readdirSync(source).some(n => existsSync(join(source, n, 'SKILL.md')))) return null;
  const identity = createHash('sha256').update(realpathSync(cwd)).digest('hex').slice(0, 24);
  const root = join(storage, 'project-skills-plugins', identity);
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'project-skills', version: '1.0.0' }));
  const dest = join(root, 'skills');
  if (!existsSync(dest)) symlinkSync(resolve(source), dest, process.platform === 'win32' ? 'junction' : 'dir');
  else if (realpathSync(dest) !== realpathSync(source)) throw new Error('项目技能目录关联不一致，请检查项目路径');
  return root;
}

export function extraPlugins(cwd: string, settings: Pick<AppSettings, 'localPlugins'>): string[] {
  const roots: string[] = [];
  const project = projectSkillsPlugin(cwd);
  if (project) roots.push(project);
  for (const entry of settings.localPlugins ?? []) {
    if (!entry.enabled) continue;
    const root = resolve(entry.path);
    try {
      const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
      if (!manifest.name || typeof manifest.name !== 'string') throw new Error();
    } catch { throw new Error(`插件缺少有效的清单：${root}`); }
    roots.push(root);
  }
  return [...new Set(roots)];
}

export function workspaceInstructions(cwd: string): string {
  return ['AGENTS.md', 'CLAUDE.md'].flatMap(name => {
    const file = join(cwd, name);
    if (!existsSync(file)) return [];
    return [`## 项目契约：${name}\n${readFileSync(file, 'utf8')}`];
  }).join('\n\n');
}
