import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { IPC } from '@shared/types';
import type { RunOptions } from './session';
import { getSettings, updateSettings, listProviders, findProvider, upsertProvider } from '../store/config';
import { listSkills, importSkill, userSkillsRoot } from '../skills';
import { invalidateSkillsPluginCache } from './skills-plugin';
import { getCapabilities } from './capabilities';
import { checkEnvironment } from '../scan/environment';
import { listProjects, findProjectByRoot } from '../ipc/project';
import { listAutomations, nextRunAt } from '../ipc/automation';
import { getDb } from '../db';
import { pushToRenderer } from '../ipc';
import { browserServer } from './browser-tools';

const settingsPatch = z.object({
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  disableThinking: z.boolean().optional(),
  systemPrompt: z.string().optional(),
  multiAgentEnabled: z.boolean().optional(),
});

export async function buildBuiltinMcp(opts: RunOptions) {
  const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v) }] });
  const wrap = (fn: (a: any) => any, mutation = false) => async (args: any) => {
    try {
      if (mutation && opts.interactionMode === 'plan') throw new Error('当前只做规划，不能修改设置或项目');
      return text(await fn(args));
    } catch (error) { return { ...text(error instanceof Error ? error.message : String(error)), isError: true }; }
  };
  const saveSettings = (patch: Parameters<typeof updateSettings>[0]) => {
    updateSettings(patch); pushToRenderer(IPC.SETTINGS_CHANGED, getSettings()); return { updated: Object.keys(patch), effective: '下一轮生效' };
  };
  const currentProject = () => {
    const project = findProjectByRoot(opts.cwd); if (!project) throw new Error('当前项目不存在'); return project;
  };
  const schedule = { name: z.string().min(1), prompt: z.string().min(1), cron: z.string(), enabled: z.boolean().default(true) };
  return {
    mathmodel: createSdkMcpServer({ name: 'mathmodel', version: '1.0.0', tools: [
      tool('get_settings', '读取应用偏好和可用模型，不返回密钥或连接器凭据。', {}, wrap(() => {
        const s = getSettings();
        return { effort: s.effort, disableThinking: s.disableThinking,
          activeProviderId: s.activeProviderId, defaultModel: s.defaultModel, multiAgentEnabled: s.multiAgentEnabled,
          builtinMcpEnabled: s.builtinMcpEnabled,
          providers: listProviders().map(p => ({ id: p.id, name: p.name, models: p.models, apiFormat: p.apiFormat })),
          runtime: getCapabilities(opts.sessionId) };
      })),
      tool('update_settings', '仅当用户要求时修改应用偏好；不会修改访问权限、密钥或安全设置。', settingsPatch.shape, wrap(a => saveSettings(a), true)),
      tool('set_active_model', '按用户要求选择供应商与模型，下一轮开始生效。', { providerId: z.string(), model: z.string() }, wrap(a => {
        const p = findProvider(a.providerId); if (!p || !p.models?.includes(a.model)) throw new Error('模型未在该供应商中登记');
        return saveSettings({ activeProviderId: p.id, defaultModel: a.model });
      }, true)),
      tool('add_provider_model', '在现有供应商中添加用户指定的模型名，不更改密钥。', { providerId: z.string(), model: z.string().min(1) }, wrap(a => {
        const p = findProvider(a.providerId); if (!p) throw new Error('供应商不存在');
        upsertProvider({ ...p, models: [...new Set([...(p.models ?? []), a.model.trim()])] }); return { added: a.model };
      }, true)),
      tool('check_environment', '检查当前项目的数学建模运行环境，不安装软件。', {}, wrap(() => checkEnvironment(opts.cwd, process.resourcesPath))),
      tool('list_skills', '列出技能库启用状态和本轮实际注册的技能，按任务选择，不为数量而调用。', {}, wrap(() => ({
        skills: listSkills().map(s => ({ name: s.name, description: s.description, enabled: s.enabled, source: s.source, path: s.path })),
        runtime: getCapabilities(opts.sessionId),
      }))),
      tool('install_skill', '仅按用户要求导入本地技能目录。不覆盖已有用户技能。', { path: z.string() }, wrap(a => {
        if (existsSync(join(userSkillsRoot(), basename(a.path)))) throw new Error('已有同名用户技能，请先在扩展页确认如何处理');
        const result = importSkill(a.path); invalidateSkillsPluginCache(); return { installed: basename(a.path), skills: result.map(s => s.name), effective: '下一轮生效' };
      }, true)),
      tool('list_projects', '列出本机工作项目。', {}, wrap(() => listProjects())),
      tool('list_keybindings', '列出用户自定义快捷键。', {}, wrap(() => getSettings().keybindings ?? {})),
      tool('set_keybinding', '按用户要求修改一个快捷键。', { action: z.string(), key: z.string() }, wrap(a => saveSettings({ keybindings: { ...getSettings().keybindings, [a.action]: a.key } }), true)),
      tool('list_automations', '查看当前项目的定时任务。', {}, wrap(() => listAutomations(currentProject().id))),
      tool('create_automation', '仅在用户明确要求定时执行时，为当前项目创建定时任务。', schedule, wrap(a => {
        const id = randomUUID(), now = Date.now(), project = currentProject(), next = nextRunAt(a.cron);
        getDb().prepare('INSERT INTO automations (id,project_id,name,prompt,cron,enabled,created_at,updated_at,next_run_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(id, project.id, a.name, a.prompt, a.cron, a.enabled ? 1 : 0, now, now, a.enabled ? next : null);
        pushToRenderer(IPC.AUTOMATION_CHANGED, { automationId: id }); return { id };
      }, true)),
      tool('update_automation', '按用户要求修改当前项目的定时任务。', { id: z.string(), ...schedule }, wrap(a => {
        const next = nextRunAt(a.cron), project = currentProject();
        const r = getDb().prepare('UPDATE automations SET name=?,prompt=?,cron=?,enabled=?,updated_at=?,next_run_at=? WHERE id=? AND project_id=?')
          .run(a.name, a.prompt, a.cron, a.enabled ? 1 : 0, Date.now(), a.enabled ? next : null, a.id, project.id);
        if (!r.changes) throw new Error('当前项目没有这个定时任务');
        pushToRenderer(IPC.AUTOMATION_CHANGED, { automationId: a.id }); return { updated: a.id };
      }, true)),
      tool('delete_automation', '仅按用户明确要求删除当前项目的一个定时任务。', { id: z.string() }, wrap(a => {
        const r = getDb().prepare('DELETE FROM automations WHERE id=? AND project_id=?').run(a.id, currentProject().id);
        if (!r.changes) throw new Error('当前项目没有这个定时任务');
        pushToRenderer(IPC.AUTOMATION_CHANGED, { automationId: a.id }); return { deleted: a.id };
      }, true)),
      tool('report_app_issue', '保存用户要求记录的软件问题到本机，不向外发送数据。', { title: z.string(), description: z.string() }, wrap(a => {
        const dir = join(app.getPath('userData'), 'issue-reports'); mkdirSync(dir, { recursive: true });
        const file = join(dir, `${Date.now()}-${randomUUID()}.json`);
        writeFileSync(file, JSON.stringify({ title: a.title, description: a.description, version: app.getVersion() }, null, 2));
        return { path: file, delivery: '已保存本地问题报告，尚未发送给任何外部服务' };
      }, true)),
    ] }),
    'mathmodel-browser': browserServer(opts.sessionId, opts.cwd, opts.interactionMode === 'plan'),
  };
}
