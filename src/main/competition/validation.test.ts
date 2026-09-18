import { expect, it } from 'vitest';
import { makeProject } from '../../shared/competition-studio';
import { validateProject } from './validation';

it('接受完整工作台和未填写的截止时间', () => {
  const p = makeProject('project', '比赛'); expect(validateProject(p)).toEqual(p);
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
