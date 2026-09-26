import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const skillPath = resolve(process.cwd(), 'resources', 'builtin-skills', 'write-paper', 'SKILL.md');

describe('write-paper 独立流程', () => {
  it('包含从建模到交付的完整质量门槛', () => {
    const skill = readFileSync(skillPath, 'utf8');
    for (const required of [
      'problem-parser',
      'problem-classifier',
      'method-selector',
      'model-selection-audit',
      'baseline-comparison',
      'python-model-code-generator',
      'robustness-checker',
      'result-reproducibility',
      'table-layout-audit',
      'paper-page-fit',
      'submission-package-audit',
    ]) {
      expect(skill).toContain(required);
    }
  });

  it('要求证据链、中文过程输出和失败项分级', () => {
    const skill = readFileSync(skillPath, 'utf8');
    expect(skill).toContain('同一版通过验证的结果');
    expect(skill).toContain('已确认');
    expect(skill).toContain('简体中文');
    expect(skill).not.toContain('MMODELS-LOCAL-START');
    expect(skill).not.toContain('原版');
  });
});
