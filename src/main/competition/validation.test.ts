import { expect, it } from 'vitest';
import { makeProject } from '../../shared/competition-studio';
import { validateProject } from './validation';

it('接受完整工作台，日历中的比赛自动补齐日期', () => {
  const p = { ...makeProject('project', '比赛'), year: 2026 };
  expect(validateProject(p)).toMatchObject({ id: p.id, calendarId: 'A01-2026', deadline: '2026-09-13T20:00:00+08:00' });
  const custom = { ...p, competition: '自主练习' }; expect(validateProject(custom)).toEqual(custom);
});
it('拒绝错误年份、日期、阶段和缺失字段，避免写坏索引', () => {
  const p = makeProject('project', '比赛');
  for (const invalid of [null, {}, { ...p, year: NaN }, { ...p, deadline: 'not-date' }, { ...p, phase: 'fake' }, { ...p, evidence: [{}] }]) {
    expect(() => validateProject(invalid)).toThrow('请检查');
  }
});
it('丢弃未知字段并限制文本与记录数量', () => {
  const p = makeProject('project', '比赛');
  expect(validateProject({ ...p, extra: 'ignored' })).not.toHaveProperty('extra');
  expect(() => validateProject({ ...p, rules: 'a'.repeat(30001) })).toThrow('请检查');
  expect(() => validateProject({ ...p, checklist: Array(101).fill(p.checklist[0]) })).toThrow('请检查');
});
