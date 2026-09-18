/**
 * 技能 IPC。
 */
import { ipcMain, dialog } from 'electron';
import { IPC } from '@shared/types';
import {
  listSkills,
  toggleSkill,
  readSkillDoc,
  importSkill,
  deleteSkill,
} from '../skills';
import { invalidateSkillsPluginCache } from '../agent/skills-plugin';
import { safeWrap, pushToRenderer, type IpcContext } from './index';
import { getCapabilities } from '../agent/capabilities';
import { getSettings, updateSettings } from '../store/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 技能增删/启停后要让下次会话重新物化插件目录。
 * （物化结果在进程内缓存，否则每次发消息都要重算一遍 130MB 技能资源的摘要。）
 */
function afterSkillsChanged(): void {
  invalidateSkillsPluginCache();
}

export function registerSkillHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.SKILL_RUNTIME, safeWrap((_e, sessionId?: string) => getCapabilities(sessionId), '读取实际可用能力'));
  ipcMain.handle(IPC.PLUGIN_ADD, safeWrap(async () => {
    const result = await dialog.showOpenDialog({ title: '选择本地插件目录（包含 .claude-plugin/plugin.json）', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0];
    try {
      const manifest = JSON.parse(readFileSync(join(path, '.claude-plugin', 'plugin.json'), 'utf8'));
      if (typeof manifest.name !== 'string' || !manifest.name.trim()) throw new Error();
    } catch { throw new Error('该目录没有有效的插件清单，请选择插件根目录'); }
    const plugins = getSettings().localPlugins ?? [];
    const updated = updateSettings({ localPlugins: [...plugins.filter(p => p.path !== path), { path, enabled: true }] });
    pushToRenderer(IPC.SETTINGS_CHANGED, updated);
    return updated;
  }, '启用本地插件'));
  ipcMain.handle(
    IPC.SKILL_LIST,
    safeWrap(() => listSkills(), '读取技能列表'),
  );

  ipcMain.handle(
    IPC.SKILL_TOGGLE,
    safeWrap((_e, dirName: string, enabled: boolean) => {
      const next = toggleSkill(dirName, enabled);
      afterSkillsChanged();
      return next;
    }, '切换技能状态'),
  );

  ipcMain.handle(
    IPC.SKILL_READ,
    safeWrap((_e, dirName: string) => readSkillDoc(dirName), '读取技能文档'),
  );

  ipcMain.handle(
    IPC.SKILL_IMPORT,
    safeWrap(async () => {
      const win = ctx.getMainWindow();
      const result = await dialog.showOpenDialog(win ?? undefined!, {
        title: '选择技能目录（需包含 SKILL.md）',
        properties: ['openDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const next = importSkill(result.filePaths[0]);
      afterSkillsChanged();
      return next;
    }, '导入技能'),
  );

  ipcMain.handle(
    IPC.SKILL_DELETE,
    safeWrap((_e, dirName: string) => {
      const next = deleteSkill(dirName);
      afterSkillsChanged();
      return next;
    }, '删除技能'),
  );
}
