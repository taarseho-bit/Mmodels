// ⚠️ 证伪边界（看这行就够了）：本文件只能证明「系统提示词里确实写了这条规矩」，**不能**证明模型会遵守它 —— 行为验证必须靠实机 e2e。
/**
 * `buildSystemPrompt()` 里「长时任务：不要交还回合去等通知」这一节的回归测试。
 *
 * ## 这条规矩要防的是什么（实机观察到两次的缺陷）
 *
 * 模型会在真正干活的中途把回合交还，等一个「后台任务跑完唤醒我」——但那个唤醒永远不来：
 *   1. 一次在后台下载进度 28/77 时交还，之后再也没醒（产物不完整：README 声称"67 个月"，
 *      实际 csv 只有 13 个月有值）；
 *   2. 一次在抓取 45/77 时交还，明确写着"它跑完会**自动通知我**接着做"，之后 8 条心跳全是"未在运行"。
 *
 * 根因（已定死，不在本文件覆盖范围）：`agent/session.ts` 把 prompt 当**字符串**传给 `query()`，
 * SDK 据此判 `isSingleUserTurn=true`，首个 `result` 一到就 `endInput()` 关掉 stdin，
 * CLI 随即退出，**后台任务被连坐收掉**。那个文件的正式修法（常驻队列）由另一个人负责。
 *
 * 本文件只管**止血**：系统提示词里必须立下"不许许空承诺、不许为等通知而交还回合"的规矩。
 * 所以这里钉住的是**提示词文本**，不是模型行为 —— 见下面「这一组用例盖不住什么」。
 *
 * ## 反向对照（真跑过）
 *
 * 把新增的那一节整段删掉，第 1 组用例**必须真红**（已实跑验证，红色输出见汇报）。
 * 所以它不是"顺手写的断言"，它确实拦得住回退。
 *
 * ## 这一组用例**盖不住**什么（证伪边界）
 *
 * 能钉住的：提示词里写了这个约定，且没把旧的中文解说/成品报路径两节挤掉。
 * 钉不住的：**模型会不会遵守**。要验证行为，得在实机上跑一个必然产生长后台任务的提示词，
 * 然后断言「末条助手消息不含'我会接着做 / 会自动通知我'这类措辞，且回合在后台任务结束时仍是活的」。
 * 在那条实机判据落地之前，**不要**把本文件当成"这个缺陷已经修好了"的证据。
 *
 * ## 为什么这个文件要打这么多桩
 *
 * `ipc/session.ts` 是 IPC 装配层：它 import `electron`、`better-sqlite3`（按 Electron ABI 编译，
 * 纯 Node 下 require 会抛 NODE_MODULE_VERSION 不匹配）、以及整个 IPC 注册链。
 * 但 `buildSystemPrompt` 本身是**纯函数**（只依赖 `getSettings()` 与入参 cwd），
 * 所以把重依赖逐个替换成空壳、只让真正被测的那份代码跑 —— 断言的是**真实的用户可见字符串**，
 * 而不是"源码里有个变量"（后者改名就红、行为错了却不红）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/** 可变小黑板：让 `getSettings()` 的返回值在用例里能被改写（注意 factory 会被提升，必须走 vi.hoisted） */
const board = vi.hoisted(() => ({
  systemPrompt: undefined as string | undefined,
  multiAgentEnabled: undefined as boolean | undefined,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: () => {}, on: () => {} },
  app: { getPath: () => '/tmp/mmodels-test', isPackaged: false },
}));
vi.mock('../db', () => ({ getDb: () => ({}) }));
vi.mock('../store/config', () => ({
  getSettings: () => ({
    systemPrompt: board.systemPrompt,
    multiAgentEnabled: board.multiAgentEnabled,
  }),
  findProvider: () => undefined,
  activeProvider: () => undefined,
}));
// 另一个队友正在改 agent/session.ts：这里换成空壳，既避开模块级副作用，也不跟他撞车。
vi.mock('../agent/session', () => ({ SessionRegistry: class {} }));
vi.mock('../agent/bridge-registry', () => ({ bridgeRegistry: {} }));
// 整个 IPC 注册链（含 electron dialog/BrowserWindow、native 模块）在这里不需要被求值。
vi.mock('./index', () => ({ safeWrap: (fn: unknown) => fn, pushToRenderer: () => {} }));
vi.mock('./file', () => ({ currentProjectRoot: () => null }));

import { buildSystemPrompt, multiAgentTriggerForPrompt, staleTaskReminder } from './session';

afterEach(() => {
  board.systemPrompt = undefined;
  board.multiAgentEnabled = undefined;
});

const CWD = 'C:\\proj\\demo';

describe('长时任务与多智能体协作', () => {
  it('提示词要求等待真实后台结果并自行汇总', () => {
    const text = buildSystemPrompt(CWD);
    expect(text).toContain('# 长时任务与后台协作');
    expect(text).toContain('后台命令或子智能体完成后继续当前运行');
    expect(text).toContain('等全部结果回来后再汇总');
    expect(text).toContain('不要让用户额外回复“继续”');
    expect(text).toContain('# 数学建模协作组');
    expect(text).toContain('一次最多并行 3 个');
    expect(text).toContain('正式代码、图表和论文文件由主智能体统一写入');
  });

  it('先规划模式明确只给方案，不修改文件', () => {
    const text = buildSystemPrompt(CWD, true);
    expect(text).toContain('# 当前工作方式：先规划');
    expect(text).toContain('不修改文件');
    expect(text).toContain('完成方案后结束本轮');
    expect(buildSystemPrompt(CWD, false)).not.toContain('# 当前工作方式：先规划');
    expect(text).toContain('# 数学建模协作组');
  });

  it('完整论文、评阅、多附件综合解题会自动触发协作，简单修改不会滥用', () => {
    expect(multiAgentTriggerForPrompt('/mma-paper\n参考以下文件：\n- C:\\题目.pdf\n解决问题')).toBe('paper');
    expect(multiAgentTriggerForPrompt('/mma-review 请完整评阅当前论文')).toBe('review');
    expect(multiAgentTriggerForPrompt('/competition-audit 检查提交材料')).toBe('audit');
    expect(multiAgentTriggerForPrompt('请启动多智能体协作，重新检查当前结果')).toBe('complex');
    expect(multiAgentTriggerForPrompt('/mma-paper\n重新运行')).toBe('paper');
    expect(multiAgentTriggerForPrompt('把标题改短一点')).toBeNull();

    const required = buildSystemPrompt(
      CWD,
      false,
      false,
      '/mma-paper\n参考以下文件：\n- C:\\题目.pdf\n解决问题',
    );
    expect(required).toContain('# 本轮自动协作（已触发）');
    expect(required).toContain('必须实际调用 Agent 工具组织协作');
    expect(required).toContain('先派发 1 至 2 个最有价值');
    expect(required).toContain('绝不为展示效果凑人数');
    expect(required).toContain('不要使用“协作研究员”');
    expect(buildSystemPrompt(CWD, false, false, '把标题改短一点')).not.toContain('# 本轮自动协作（已触发）');
  });

  it('关闭多智能体开关后，即使用户明确要求也不注册本轮协作规则', () => {
    board.multiAgentEnabled = false;
    const text = buildSystemPrompt(CWD, false, false, '请启动多智能体协作完成整篇论文');
    expect(text).not.toContain('# 数学建模协作组');
    expect(text).not.toContain('# 本轮自动协作（已触发）');
  });

  it('停止后继续会明确结束旧成员，并按剩余工作重新组织协作', () => {
    const text = buildSystemPrompt(CWD, false, true);
    expect(text).toContain('# 停止后的继续执行');
    expect(text).toContain('旧的协作成员已经结束');
    expect(text).toContain('立即重新调用 Agent 组建协作组');
    expect(text).toContain('不要重复已经确认完成的工作');
    expect(buildSystemPrompt(CWD, false, false)).not.toContain('# 停止后的继续执行');
  });

  it('新增一节插在末尾（在旧的「提问与继续执行」之后）', () => {
    const text = buildSystemPrompt(CWD);
    expect(text).toContain('# 长时任务与后台协作');
    expect(text.indexOf('# 长时任务与后台协作')).toBeGreaterThan(
      text.indexOf('# 提问与继续执行'),
    );
  });

  it('不回归：原有的「中文解说」「产出成品必须报出它在哪」两节仍在', () => {
    const text = buildSystemPrompt(CWD);
    expect(text).toContain('# 交流语言与过程解说（本地版要求）');
    expect(text).toContain('**所有面向用户的文字一律用简体中文**');
    expect(text).toContain('**产出成品时必须明确报出它在哪**');
    expect(text).toContain('# 提问与继续执行');
    expect(text).toContain('**拿到用户答案就直接继续执行**');
    expect(text).toContain('不要一个工具调用发一条说明');
    expect(text).toContain('默认隐藏 PATH、MSI、退出码、下载速度');
    expect(text).toContain('正在换一种办法');
    expect(text).toContain('只有确定是软件自身故障时才明确提示错误');
    expect(text).toContain('`description`、`summary`、`reason`');
    expect(text).toContain('不得把英文旁白藏进工具参数');
  });

  it('用户附加指令仍排在最后（新增一节没把它挤到前面去）', () => {
    board.systemPrompt = '这是用户的附加指令 X';
    const text = buildSystemPrompt(CWD);
    expect(text).toContain('【用户附加指令】');
    expect(text.indexOf('这是用户的附加指令 X')).toBeGreaterThan(
      text.indexOf('# 长时任务与后台协作'),
    );
  });
});

describe('工作流协作优化（2026-09-19）', () => {
  it('常驻协作组：显式并行派发、抽查式复算、任务同步契约与执行型角色', () => {
    const text = buildSystemPrompt(CWD);
    // 方向 5：无依赖成员一把并行派出
    expect(text).toContain('同一条消息里一次性并行派发');
    // 方向 4：抽查制替代全量复算，旧的双重计算措辞必须消失
    expect(text).toContain('抽查式复算');
    expect(text).not.toContain('主智能体必须检查冲突、复算关键结果');
    // A1：任务同步契约
    expect(text).toContain('每完成一项立即');
    expect(text).toContain('禁止做完几件事后批量补记');
    // 方向 2：执行型角色进入角色清单
    expect(text).toContain('paper-writer（论文写作员）');
    expect(text).toContain('figure-maker（图表制作员）');
    // 「开始时」限定词已去掉（阶段无关）
    expect(text).not.toContain('系统核验开始时，先评估');
  });

  it('阶段感知：本轮不命中但会话有记忆时，注入长任务协作要求而非强触发', () => {
    const text = buildSystemPrompt(CWD, false, false, '继续下一步', 'paper');
    expect(text).toContain('# 阶段感知协作（长任务进行中）');
    expect(text).toContain('协作要求在整个任务期间持续生效');
    expect(text).toContain('剩余可独立推进的部分');
    expect(text).not.toContain('# 本轮自动协作（已触发）');
  });

  it('无触发且无会话记忆时不注入任何协作变体（简单问答不滥用）', () => {
    const text = buildSystemPrompt(CWD, false, false, '把标题改短一点');
    expect(text).not.toContain('# 阶段感知协作');
    expect(text).not.toContain('# 本轮自动协作（已触发）');
  });

  it('A3 对账：创建了却从未 TaskUpdate 的任务会触发提醒，正常维护不提醒', () => {
    const db = (blocks: unknown[]) => ({
      prepare: () => ({ get: () => ({ blocks: JSON.stringify(blocks) }) }),
    }) as unknown as never;
    const created = (id: number, subject: string) => ({
      kind: 'tool_use', toolName: 'TaskCreate', toolUseId: `tu${id}`,
      toolInput: { subject }, toolResult: `Task #${id} created successfully: ${subject}`,
    });
    const updated = (id: number, status: string) => ({
      kind: 'tool_use', toolName: 'TaskUpdate', toolUseId: `up${id}${status}`,
      toolInput: { taskId: String(id), status },
      toolResult: `Updated task #${id} status`,
    });
    // 10 个任务创建了，模型只更新过 1、2 —— 3 之后全部滞后
    const hint = staleTaskReminder(db([created(1, 'a'), created(2, 'b'), created(3, 'c'),
      updated(1, 'completed'), updated(2, 'in_progress')]), 's1');
    expect(hint).toContain('# 任务状态同步提醒（自动检测）');
    expect(hint).toContain('#3');
    // 全部任务都有更新记录 → 不提醒
    expect(staleTaskReminder(db([created(1, 'a'), updated(1, 'completed')]), 's1')).toBeNull();
    // 没有 assistant 消息 → 不提醒
    const empty = { prepare: () => ({ get: () => undefined }) };
    expect(staleTaskReminder(empty as unknown as never, 's1')).toBeNull();
  });
});
