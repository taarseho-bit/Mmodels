/**
 * 本地用量统计 —— 对应原版「个人资料」页的数据层。
 *
 * ⚠️ 全部从本地 SQLite 聚合，**一次网络请求都不发**：
 *   - 累计 Token / 提示词总数 / 会话总数 ← sessions、messages 表
 *   - 活跃度热力图 / 连续天数 ← messages 按天聚合（本地时区）
 *   - 最活跃时段 / 最常用供应商 / 最常处理项目 ← 分组聚合
 *
 * 原版这些数字来自云端账号体系；本项目没有账号（也不做），
 * 所以改由本地会话库计算 —— 数字口径一致，来源不同。
 */
import { ipcMain } from 'electron';
import { IPC, type ContentBlock, type UsageDay, type UsageStats } from '@shared/types';
import { getDb } from '../db';
import { listProviders } from '../store/config';
import { listSkills } from '../skills';
import { safeWrap } from './index';

/** 本地时区的 YYYY-MM-DD */
function dayLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function registerStatsHandlers(): void {
  ipcMain.handle(
    IPC.STATS_GET,
    safeWrap((): UsageStats => {
      const db = getDb();

      // ── 总量 ──
      const totals = db
        .prepare<
          [],
          { sessions: number; tokens: number }
        >(
          `SELECT COUNT(*) AS sessions, COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
           FROM sessions`,
        )
        .get() ?? { sessions: 0, tokens: 0 };

      const promptCount =
        db.prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM messages WHERE role = 'user'`).get()
          ?.c ?? 0;

      // ── 按天聚合（消息维度，含 token 与条数）──
      type DayRow = { day: number; tokens: number; msgs: number };
      const dayRows = db
        .prepare<[], DayRow>(
          `SELECT created_at AS day,
                  SUM(input_tokens + output_tokens) AS tokens,
                  COUNT(*) AS msgs
           FROM messages
           GROUP BY day`,
        )
        .all();

      const byDay = new Map<string, UsageDay>();
      for (const r of dayRows) {
        const key = dayLocal(r.day);
        const prev = byDay.get(key) ?? { day: key, tokens: 0, messages: 0 };
        prev.tokens += r.tokens ?? 0;
        prev.messages += r.msgs ?? 0;
        byDay.set(key, prev);
      }

      // 热力图：以今天为终点往前 300 天
      const heatmap: UsageDay[] = [];
      const now = new Date();
      for (let i = 299; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const key = dayLocal(d.getTime());
        heatmap.push(byDay.get(key) ?? { day: key, tokens: 0, messages: 0 });
      }

      // 连续天数：从今天（或昨天）往前数有活动的天
      const has = (d: Date): boolean => byDay.has(dayLocal(d.getTime())) && (byDay.get(dayLocal(d.getTime()))?.messages ?? 0) > 0;
      let currentStreak = 0;
      {
        const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (!has(cursor)) cursor.setDate(cursor.getDate() - 1); // 今天还没动，从昨天起算
        while (has(cursor)) {
          currentStreak++;
          cursor.setDate(cursor.getDate() - 1);
        }
      }
      let longestStreak = 0;
      {
        const sorted = [...byDay.values()].filter((d) => d.messages > 0).map((d) => d.day).sort();
        let run = 0;
        let prev: Date | null = null;
        for (const key of sorted) {
          const [y, m, dd] = key.split('-').map(Number);
          const cur = new Date(y, m - 1, dd);
          if (prev && (cur.getTime() - prev.getTime()) === 86400000) run++;
          else run = 1;
          longestStreak = Math.max(longestStreak, run);
          prev = cur;
        }
      }

      // 最高活跃日
      let peakDay: UsageDay | null = null;
      for (const d of byDay.values()) {
        if (d.messages > 0 && (!peakDay || d.tokens > peakDay.tokens)) peakDay = d;
      }

      // 最活跃时段
      const hourRows = db
        .prepare<[], { h: number; c: number }>(
          `SELECT strftime('%H', created_at / 1000, 'unixepoch', 'localtime') AS h, COUNT(*) AS c
           FROM messages GROUP BY h ORDER BY c DESC LIMIT 1`,
        )
        .get();
      const peakHour = hourRows ? Number(hourRows.h) : null;

      // ── 按模型 / 供应商 / 项目 ──
      const byModel = db
        .prepare<
          [],
          { model: string; tokens: number; sessions: number }
        >(
          `SELECT COALESCE(NULLIF(model, ''), '未记录') AS model,
                  COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
                  COUNT(*) AS sessions
           FROM sessions GROUP BY model ORDER BY tokens DESC`,
        )
        .all();

      const providerNames = new Map<string, string>();
      try {
        for (const p of listProviders()) providerNames.set(p.id, p.name);
      } catch {
        /* 设置读不到就退化为 id */
      }
      const byProvider = db
        .prepare<
          [],
          { provider_id: string; tokens: number }
        >(
          `SELECT COALESCE(NULLIF(provider_id, ''), '未记录') AS provider_id,
                  COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
           FROM sessions GROUP BY provider_id ORDER BY tokens DESC`,
        )
        .all()
        .map((r) => ({ providerId: r.provider_id, name: providerNames.get(r.provider_id) ?? r.provider_id, tokens: r.tokens }));

      const byProject = db
        .prepare<
          [],
          { project_id: string; name: string; tokens: number; sessions: number }
        >(
          `SELECT s.project_id, COALESCE(p.name, s.project_id) AS name,
                  COALESCE(SUM(s.input_tokens + s.output_tokens), 0) AS tokens,
                  COUNT(*) AS sessions
           FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
           GROUP BY s.project_id ORDER BY tokens DESC`,
        )
        .all()
        .map((r) => ({ projectId: r.project_id, name: r.name, tokens: r.tokens, sessions: r.sessions }));

      // 已安装技能数（内置 + 用户目录）
      let skillCount = 0;
      try {
        skillCount = listSkills().length;
      } catch {
        skillCount = 0;
      }

      // ── 最常用插件（Skill / Agent / 连接器）──
      // 原版从云端账号统计；本地版改为扫描本地消息块里的 tool_use。
      const pluginRuns = new Map<string, { runs: number; sessions: Set<string> }>();
      try {
        const rows = db
          .prepare<[], { session_id: string; blocks: string }>(
            `SELECT session_id, blocks FROM messages
             WHERE role = 'assistant' AND blocks LIKE '%"tool_use"%'`,
          )
          .all();
        for (const r of rows) {
          let blocks: ContentBlock[];
          try {
            blocks = JSON.parse(r.blocks) as ContentBlock[];
          } catch {
            continue;
          }
          if (!Array.isArray(blocks)) continue;
          for (const b of blocks) {
            if (b?.kind !== 'tool_use') continue;
            const name = pluginName(b);
            if (!name) continue;
            const prev = pluginRuns.get(name) ?? { runs: 0, sessions: new Set<string>() };
            prev.runs += 1;
            prev.sessions.add(r.session_id);
            pluginRuns.set(name, prev);
          }
        }
      } catch {
        /* 表结构不符或解析失败 → 退化为空列表 */
      }
      const byPlugin = [...pluginRuns.entries()]
        .map(([name, v]) => ({ name, runs: v.runs, sessions: v.sessions.size }))
        .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name))
        .slice(0, 20);

      return {
        totalTokens: totals.tokens,
        promptCount,
        sessionCount: totals.sessions,
        activeDays: [...byDay.values()].filter((d) => d.messages > 0).length,
        peakDay,
        currentStreak,
        longestStreak,
        heatmap,
        peakHour,
        byModel,
        byProvider,
        byProject,
        byPlugin,
        skillsExplored: byPlugin.length,
        skillsUsed: byPlugin.reduce((sum, p) => sum + p.runs, 0),
        skillCount,
      };
    }, '统计用量'),
  );
}

/**
 * 从一个 tool_use 块里取出「插件名」——不是插件（普通 Bash/Read/Edit 等）返回 null。
 *
 * 判定口径对齐原版「最常用插件」：Skill 调用、子 Agent 调用、MCP 连接器工具。
 */
function pluginName(b: ContentBlock): string | null {
  const tool = String(b.toolName ?? '');
  if (!tool) return null;
  const input = (b.toolInput ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null;

  if (tool === 'Skill') return str(input.skill) ?? str(input.command) ?? 'Skill';
  if (tool === 'Task' || tool === 'Agent') {
    return str(input.subagent_type) ?? str(input.agent) ?? str(input.description) ?? 'Agent';
  }
  // 连接器（MCP）工具：mcp__<server>__<tool>
  if (tool.startsWith('mcp__')) return tool.split('__')[1] ?? tool;
  return null;
}
