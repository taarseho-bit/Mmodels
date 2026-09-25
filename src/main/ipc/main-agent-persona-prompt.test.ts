// ⚠️ 证伪边界：本文件只证明「系统提示词里确实按任务模式注入了对应的领衔角色段」，
// 不能证明模型会按角色行事 —— 行为验证必须靠实机。
/**
 * buildSystemPrompt × 主智能体领衔角色 的集成断言。
 *
 * 用户需求（2026-09-21）：写论文/评审/找数据应该由各自的主智能体领衔，
 * 而不是"写谁都是论文那套"。实现在 `agent/main-agent-personas.ts`：
 * 从本轮提示词的斜杠命令反推任务类型，注入对应角色段；chat 不注入。
 *
 * 为什么打这么多桩：`ipc/session.ts` 是 IPC 装配层，import electron、better-sqlite3
 * 与整条 IPC 注册链；但 `buildSystemPrompt` 本身是纯函数 —— 桩掉重依赖后断言的
 * 是真实的用户可见字符串（与 `session.test.ts` 同一套路数）。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: () => {}, on: () => {} },
  app: { getPath: () => '/tmp/mmodels-test', isPackaged: false },
}));
vi.mock('../db', () => ({ getDb: () => ({}) }));
vi.mock('../store/config', () => ({
  getSettings: () => ({}),
  findProvider: () => undefined,
  activeProvider: () => undefined,
}));
vi.mock('../agent/session', () => ({ SessionRegistry: class {} }));
vi.mock('../agent/bridge-registry', () => ({ bridgeRegistry: {} }));
vi.mock('./index', () => ({ safeWrap: (fn: unknown) => fn, pushToRenderer: () => {} }));
vi.mock('./file', () => ({ currentProjectRoot: () => null }));

import { buildSystemPrompt } from './session';

describe('buildSystemPrompt × 领衔角色 —— 随模式出现/缺席', () => {
  const CWD = 'D:/tmp/demo-project';

  it('评审模式出现评审主智能体段', () => {
    const sys = buildSystemPrompt(CWD, false, false, '/review-paper 审读论文', null);
    expect(sys).toContain('# 你的领衔角色（当前任务模式）');
    expect(sys).toContain('评审主智能体');
    expect(sys).toContain('claim-evidence-audit');
  });

  it('找数据模式出现数据检索主智能体段', () => {
    const sys = buildSystemPrompt(CWD, false, false, '/data-search 找公开数据', null);
    expect(sys).toContain('数据检索主智能体');
    expect(sys).toContain('data-auditor-cleaner');
  });

  it('写论文模式出现论文写作主智能体段', () => {
    const sys = buildSystemPrompt(CWD, false, false, '/write-paper 完整论文', null);
    expect(sys).toContain('论文写作主智能体');
  });

  it('绘图模式出现图表制作主智能体段', () => {
    const sys = buildSystemPrompt(CWD, false, false, '/draw-figures 绘制图表', null);
    expect(sys).toContain('图表制作主智能体');
  });

  it('普通消息（chat）不含领衔角色段 —— 零漂移', () => {
    const sys = buildSystemPrompt(CWD, false, false, '你好，帮我看看题目', null);
    expect(sys).not.toContain('# 你的领衔角色（当前任务模式）');
  });
});
