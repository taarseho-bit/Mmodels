import { describe, expect, it } from 'vitest';
import { COMPETITIONS } from './competitions-data';
import { calendarCompetition, competitionDeadline, countdownFor } from './competition-countdown';
import { makeProject } from './competition-studio';
const contest = COMPETITIONS.find(c => c.id === 'A01-2026')!;
describe('竞赛日历驱动的倒计时', () => {
  it('旧工作台国赛名称可关联到当年日历，不再沿用人工截止时间', () => {
    expect(calendarCompetition({ ...makeProject('p', 'p'), year: 2026 })?.id).toBe(contest.id);
    expect(competitionDeadline(contest)).toBe('2026-09-13T20:00:00+08:00');
  });
  it('未开赛到开赛后自动切换倒计时目标，时区使用原始时间', () => {
    expect(countdownFor(contest, Date.parse('2026-09-10T17:00:00+08:00'))).toEqual({ label: '距离开赛', text: '0 天 1 时 0 分' });
    expect(countdownFor(contest, Date.parse('2026-09-13T19:30:00+08:00'))).toEqual({ label: '距离提交', text: '0 天 0 时 30 分' });
    expect(countdownFor(contest, Date.parse('2026-09-14T00:00:00+08:00')).text).toBe('本届已结束');
  });
  it('不把报名截止当提交截止，未公布与预计赛程明确区分', () => {
    const c = { ...contest, events: [{ kind: 'registration' as const, label: '', start: '2026-10-01', end: null }] };
    expect(competitionDeadline(c)).toBe('');
    expect(countdownFor(c, 0).text).toBe('等待赛程公布');
    expect(countdownFor({ ...contest, status: 'estimated' }, 0).label).toContain('预计');
    expect(countdownFor({ ...contest, status: 'tba' }, 0).text).toBe('等待赛程公布');
  });
});
