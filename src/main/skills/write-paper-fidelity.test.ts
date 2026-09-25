import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const skillPath = resolve(process.cwd(), 'resources', 'builtin-skills', 'write-paper', 'SKILL.md');
const LOCAL_BLOCK = /<!-- MMODELS-LOCAL-START: [^>]+ -->\r?\n[\s\S]*?<!-- MMODELS-LOCAL-END: [^>]+ -->\r?\n?/g;
const ORIGINAL_SHA256 = '60f8a5e383365a8adbce3fda163d425539422ee4b95d7d968aecf1ab0b5285fc';

function originalBodyFromCurrent(): string {
  return readFileSync(skillPath, 'utf8').replace(LOCAL_BLOCK, '').replace(/\r\n/g, '\n');
}

describe('write-paper 原版兼容', () => {
  it('去掉明确标记的本地追加后，与原版 SKILL.md 逐字一致', () => {
    const hash = createHash('sha256').update(originalBodyFromCurrent(), 'utf8').digest('hex');
    expect(hash).toBe(ORIGINAL_SHA256);
  });

  it('追加了建模、可行性、约束残差、最优性与交叉验证闭环', () => {
    const skill = readFileSync(skillPath, 'utf8');
    for (const required of ['先完整建模再求解', '可行性检查', '最大约束残差', '确认最优性', '独立交叉验证']) {
      expect(skill).toContain(required);
    }
    expect(skill).toContain('description`、`summary`、`reason`');
  });
});
