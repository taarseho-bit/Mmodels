import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '@shared/types';
import {
  MODEL_WAITING_MESSAGES,
  activityMessagesFor,
  compactActivityText,
  friendlyGroupActivity,
  friendlyStreamError,
  friendlyToolActivity,
  localizeProcessNarration,
  localizeThinkingDetail,
  toolInputForDisplay,
} from './activity-copy';
import type { ToolRow } from './tool-row';

const tool = (toolName: string, extra: Partial<ContentBlock> = {}): ContentBlock => ({
  kind: 'tool_use',
  toolName,
  toolInput: {},
  ...extra,
});

describe('对话过程的通俗中文文案', () => {
  it('展示层会收紧重复标点和多余空白，但不改变正常短句', () => {
    expect(compactActivityText('  正在检查！！\n\n\n 数据……  ')).toBe('正在检查！\n\n数据…');
    expect(compactActivityText('结果已整理')).toBe('结果已整理');
    expect(compactActivityText('一二三四五六七八九十', 6)).toBe('一二三四五…');
  });
  it('等待文案简短、全为中文建模语境且不暴露工具名', () => {
    expect(MODEL_WAITING_MESSAGES.length).toBeGreaterThanOrEqual(5);
    for (const message of MODEL_WAITING_MESSAGES) {
      expect(message).toMatch(/[\u4e00-\u9fff]/u);
      expect(message).not.toMatch(/Bash|MCP|stderr|PATH|MSI/i);
      expect(message.length).toBeLessThan(30);
    }
  });

  it('工具主行只说人能看懂的动作，具体命令留在详情', () => {
    expect(friendlyToolActivity(tool('Bash'), true)).toBe('正在运行计算并检查结果是否合理…');
    expect(friendlyToolActivity(tool('Read'), true)).toBe('正在阅读材料并标出关键条件…');
    expect(friendlyToolActivity(tool('Write', { toolResult: 'ok' }), false)).toBe('已整理好相关文件');
  });

  it('等待语会读取真实文件和命令，不再固定轮换几句', () => {
    expect(activityMessagesFor([tool('Read', { toolInput: { file_path: 'paper.pdf' } })])[0])
      .toBe('正在逐页检查论文中的公式、表格和图表…');
    expect(activityMessagesFor([tool('Bash', { toolInput: { command: 'python solve.py' } })])[0])
      .toBe('正在运行模型并核对计算结果…');
    expect(activityMessagesFor([tool('Bash', { toolInput: { command: 'xelatex main.tex' } })])[0])
      .toBe('正在重新编译论文并检查版面…');
  });

  it('只把英文过程旁白转成中文，不改英文正文', () => {
    expect(localizeProcessNarration("I'll start by locating and reading the paper."))
      .toBe('正在查找并阅读相关论文和材料…');
    expect(localizeProcessNarration('Let me verify the equations first.'))
      .toBe('正在检查材料里的关键信息…');
    expect(localizeProcessNarration('The next pass compares every result against the baseline.'))
      .toBe('正在继续处理当前任务…');
    const paragraph = 'This paper proposes a robust optimization model for crop planning under uncertainty. '.repeat(8);
    expect(localizeProcessNarration(paragraph)).toBe(paragraph);
    expect(localizeProcessNarration('const objective = revenue - cost;')).toBe('const objective = revenue - cost;');
    expect(localizeThinkingDetail('I need to inspect the files and determine which model should be fitted before running the solver.'))
      .toBe('正在梳理当前步骤，详细推理过程已省略。');
    expect(localizeThinkingDetail('先检查数据列，再确定回归模型。')).toBe('先检查数据列，再确定回归模型。');
  });

  it('能拦住较长的纠错旁白，并显示与储能模型对应的中文进度', () => {
    const first = 'My forward-propagation is wrong — it lets the battery discharge before it has charged, so it drives SOC negative. Let me correct it: the battery can only discharge down to its floor, and must charge from the grid first.';
    const second = "The propagation still drives SOC negative because it assumes the battery must absorb all surplus — but that's only forced if curtailment is banned. Let me stop guessing and ask the LP directly which constraint is binding.";
    expect(localizeProcessNarration(first)).toBe('正在重新核对储能状态递推、充放电顺序和上下限…');
    expect(localizeProcessNarration(second)).toBe('正在重新核对储能状态递推、充放电顺序和上下限…');
  });

  it('工具详情隐藏英文旁白字段，但保留命令、路径与数值参数', () => {
    expect(toolInputForDisplay({
      command: 'python probe.py',
      description: 'Locate the exact binding constraint',
      timeout: 300000,
      nested: { summary: 'retry', path: 'result/out.json' },
    })).toEqual({
      command: 'python probe.py',
      timeout: 300000,
      nested: { path: 'result/out.json' },
    });
  });

  it('可恢复失败不显示“错误”，只说明正在换办法', () => {
    const failed = tool('Bash', { isError: true, toolResult: 'exit 1' });
    expect(friendlyToolActivity(failed, true)).toBe('这一步没走通，正在换一种办法…');
    expect(friendlyToolActivity(failed, true)).not.toContain('错误');

    const rows: ToolRow[] = [{ id: '1', label: '运行命令', kind: 'command', block: failed }];
    expect(friendlyGroupActivity(rows, true)).toContain('继续处理');
  });

  it('连接超时给重试提示，只有明显程序异常才称为软件问题', () => {
    const timeout = friendlyStreamError('request timed out after 30s');
    expect(timeout.softwareFault).toBe(false);
    expect(timeout.description).toContain('重试');
    expect(timeout.description).not.toContain('timed out');

    const crash = friendlyStreamError("TypeError: Cannot read properties of undefined");
    expect(crash.softwareFault).toBe(true);
    expect(crash.title).toBe('软件遇到问题');
  });
});
