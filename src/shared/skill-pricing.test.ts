import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SKILL_POINT_CATALOG, SKILL_POINT_BY_ID, skillIdFromPrompt, skillPointCost } from './skill-pricing';

describe('数学建模技能积分目录', () => {
  it('覆盖当前全部内置技能且 id 唯一', () => {
    expect(SKILL_POINT_CATALOG.length).toBe(62);
    expect(new Set(SKILL_POINT_CATALOG.map((entry) => entry.id)).size).toBe(SKILL_POINT_CATALOG.length);
    expect(Object.keys(SKILL_POINT_BY_ID)).toHaveLength(SKILL_POINT_CATALOG.length);
    expect(SKILL_POINT_CATALOG.every((entry) => entry.cost >= 10 && entry.cost <= 40)).toBe(true);

    // 技能目录是收费规则的唯一产品入口；新增/删除内置技能时，测试必须逼着
    // 维护者同步共享目录和服务端白名单，避免 UI 显示一个价格而服务器按普通档扣费。
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const resourceIds = readdirSync(join(repoRoot, 'resources', 'builtin-skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(SKILL_POINT_CATALOG.map((entry) => entry.id).sort()).toEqual(resourceIds);

    const serverSource = readFileSync(join(repoRoot, 'server', 'license-server.cjs'), 'utf8');
    const serverBlock = serverSource.match(/const SKILL_POINT_COSTS = Object\.freeze\(\{([\s\S]*?)\}\);/u)?.[1] ?? '';
    const serverCosts = new Map<string, number>();
    for (const match of serverBlock.matchAll(/'([^']+)'\s*:\s*(\d+)/gu)) serverCosts.set(match[1], Number(match[2]));
    expect(Object.fromEntries(serverCosts)).toEqual(Object.fromEntries(SKILL_POINT_CATALOG.map((entry) => [entry.id, entry.cost])));
  });

  it('从斜杠命令和中文技能指令提取稳定 id', () => {
    expect(skillIdFromPrompt('/paper-page-fit 请压缩论文')).toBe('paper-page-fit');
    expect(skillIdFromPrompt('#paper-page-fit 请压缩论文')).toBe('paper-page-fit');
    expect(skillIdFromPrompt('请使用 problem-parser 技能解析题目')).toBe('problem-parser');
    expect(skillIdFromPrompt('请使用不存在的技能')).toBeUndefined();
    expect(skillPointCost('paper-page-fit')).toBe(20);
    expect(skillPointCost('unknown')).toBeUndefined();
  });
});
