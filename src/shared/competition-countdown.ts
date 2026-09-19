import { COMPETITIONS, type Competition } from './competitions-data';
import type { Project } from './competition-studio';
export function calendarCompetition(project: Project): Competition | undefined {
  if (project.calendarId) return COMPETITIONS.find(c => c.id === project.calendarId);
  const series = project.competition === '全国大学生数学建模竞赛' ? 'A01' : project.competition === '中国研究生数学建模竞赛' ? 'A02' : undefined;
  return COMPETITIONS.find(c => c.year === project.year && (c.name === project.competition || c.shortName === project.competition || c.seriesId === series));
}
export function competitionDeadline(c: Competition): string {
  const submission = c.events.filter(e => e.kind === 'submission').map(e => e.end || e.start).filter(v => Number.isFinite(Date.parse(v))).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return submission || c.events.find(e => e.kind === 'competition')?.end || '';
}
export function countdownFor(c: Competition | undefined, now: number): { label: string; text: string } {
  if (!c) return { label: '比赛倒计时', text: '请选择竞赛' };
  if (c.status === 'paused' || c.status === 'tba') return { label: '比赛倒计时', text: '等待赛程公布' };
  const start = Date.parse(c.events.find(e => e.kind === 'competition')?.start || '');
  const end = Date.parse(competitionDeadline(c)), upcoming = start > now, target = upcoming ? start : end;
  if (!Number.isFinite(target)) return { label: '比赛倒计时', text: '等待赛程公布' };
  if (target <= now) return { label: `${c.year} 年赛程`, text: '本届已结束' };
  const minutes = Math.ceil((target - now) / 60000);
  return { label: `${c.status === 'estimated' ? '预计 · ' : ''}${upcoming ? '距离开赛' : '距离提交'}`,
    text: `${Math.floor(minutes / 1440)} 天 ${Math.floor(minutes % 1440 / 60)} 时 ${minutes % 60} 分` };
}
