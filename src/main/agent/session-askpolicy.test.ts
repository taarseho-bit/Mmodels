/**
 * askPolicy 接线 —— 结构级钉子（2026-09-20 实机教训）。
 *
 * 事故：「AI 自动」决策模式下仍弹提问框。根因是 `run()` 里的
 * `this.askPolicy = opts.askPolicy ?? 'ask'` 赋值行被同文件的并行编辑
 * **静默覆盖丢失** —— 产物里字段恒为初始值 'ask'，deny 兜底永远不生效，
 * 而 typecheck（字段/分支都在）与打包验证（deny 文案在 asar 里）全部绿灯，
 * 唯独链路中间断了一截。
 *
 * 所以这里不测行为，直接钉**接线本身**：四处缺一不可。
 * 与 `permissions.test.ts` 的结构级断言同一流派。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'session.ts'), 'utf8');

describe('askPolicy 接线 —— 结构钉子', () => {
  it('RunOptions 声明了 askPolicy（ipc 层才有地方传）', () => {
    expect(SRC).toContain("askPolicy?: 'ask' | 'auto'");
  });

  it('AgentSession 类字段存在，默认 ask', () => {
    expect(SRC).toContain("private askPolicy: 'ask' | 'auto' = 'ask'");
  });

  it('★ run() 里从 opts 刷新 askPolicy（曾被并行编辑吞掉的那一行）', () => {
    expect(SRC).toContain('this.askPolicy = opts.askPolicy');
  });

  it('deny 兜底排在 emit("ask-user") 之前 —— auto 模式不许弹窗', () => {
    const denyAt = SRC.indexOf("if (this.askPolicy === 'auto')");
    const emitAt = SRC.indexOf("this.emit('ask-user'");
    expect(denyAt).toBeGreaterThan(-1);
    expect(emitAt).toBeGreaterThan(denyAt);
  });
});
