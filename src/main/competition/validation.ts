import { z } from 'zod';
import type { Project } from '../../shared/competition-studio';
import { calendarCompetition, competitionDeadline } from '../../shared/competition-countdown';

const short = z.string().max(2000);
const id = z.string().min(1).max(200);
const projectSchema = z.object({
  id, name: z.string().trim().min(1).max(300),
  competition: z.string().trim().min(1).max(200),
  calendarId: z.string().max(200).optional(),
  year: z.number().int().min(1950).max(2100), problem: short,
  deadline: z.string().max(40).refine(v => !v || Number.isFinite(new Date(v).getTime())),
  pageLimit: short, phase: z.enum(['读题', '求解', '写作', '核验', '提交']),
  rules: z.string().max(30000),
  checklist: z.array(z.object({ id, text: short, done: z.boolean() })).max(100),
  alternatives: z.array(z.object({ id, name: short, score: short, risks: short })).max(100),
  evidence: z.array(z.object({ id, claim: short, source: short, checked: z.boolean() })).max(100),
  deliveryAudit: z.object({
    checkedAt: z.string().max(40).refine(v => Number.isFinite(new Date(v).getTime())),
    status: z.enum(['准备较好', '仍需处理']),
    items: z.array(z.object({ id, label: short, status: z.enum(['通过', '待补充', '需深度核验']), detail: short })).max(20),
    note: short,
  }).optional(),
});

export function validateProject(value: unknown): Project {
  const parsed = projectSchema.safeParse(value);
  if (!parsed.success || JSON.stringify(parsed.data).length > 200000) {
    throw new Error('请检查比赛名称、年份、截止时间和填写内容；记录过多时请分开整理');
  }
  const contest = calendarCompetition(parsed.data);
  if (parsed.data.calendarId && !contest) throw new Error('该竞赛不在日历中，请重新选择');
  return contest ? { ...parsed.data, calendarId: contest.id, competition: contest.name, year: contest.year, deadline: competitionDeadline(contest) } : parsed.data;
}
