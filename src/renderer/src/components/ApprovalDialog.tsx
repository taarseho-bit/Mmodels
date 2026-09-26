/**
 * 「工具审批」确认框 —— 权限模式选「需要批准」时，canUseTool 拦下工具调用后弹这个。
 *
 * 背景：输入区那个「完全访问 / 需要批准」选择器**长期是装饰品**
 *   （`settings.permissionMode` 在主进程零读取点，切过去不改变任何行为）。
 *   `agent/session.ts` 的 canUseTool 现在会真的拦下工具、发审批请求，
 *   这里就是把那条请求变成用户能点的界面。
 *
 * 数据来源：`window.mathmodel.session.onApprovalAsk`（主进程 canUseTool 发出），
 * 决定走 `session.answerApproval`，主进程那条 promise 才会 resolve。
 *
 * ── 文案：**零新增 i18n 键** ──
 * 全部取自项目契约词典里**早就存在、调用点为 0** 的 `composer.composerPendingApprovalPanel.*`
 * （`zh.ts:741-754`）。这套键本来就是项目契约审批面板的词，逐条对得上：
 *   `promptCommand` / `promptFileRead` / `promptFileChange` ← 项目契约 requestKind 三种
 *   `approveOnce` / `alwaysAllowSession` / `decline` / `cancelTurn` ← 项目契约四个决定
 *   `reviewToContinue` ← 项目契约面板脚注
 * 所以**不要新增键、也不要改成 t('中文')** —— 改了就与英文界面下的项目契约文案脱钩。
 *
 * ── 视觉：**复用 AskUserDialog 的类名，不新增 CSS** ──
 * 审批框与提问框是同一层级的模态，用同一套 `modal / ask-dialog / ask-option` 类，
 * 外观自动一致，也不用碰样式表（碰了就可能撞上别人正在改的 css）。
 */
import { useEffect } from 'react';
import type { ApprovalDecision, ApprovalKind, ApprovalRequest } from '@shared/types';
import { tx } from '../i18n';
import { Icon } from './Icon';

/**
 * requestKind → 标题键。**三种对应项目契约 zod 的三种枚举**
 * （`{type:'approval-request', …, requestKind: z.enum(['command','file-read','file-change'])}`
 * ）。
 *
 * ⚠️ 这些字面量会被 `i18n/keys.test.ts` 的 B 类规则扫到并断言"在 zh.ts 里真的存在"，
 *    所以改键名会当场红 —— 不用另外写测试来守。
 */
const PROMPT_KEY: Record<ApprovalKind, string> = {
  command: 'composer.composerPendingApprovalPanel.promptCommand',
  'file-read': 'composer.composerPendingApprovalPanel.promptFileRead',
  'file-change': 'composer.composerPendingApprovalPanel.promptFileChange',
  plan: 'composer.composerPendingApprovalPanel.promptPlan',
};

/**
 * 四个决定。顺序照项目契约的视觉顺序（先批准、后拒绝、最后"取消整个回合"）。
 *
 * `decision` 是**送进主进程的线上值**，必须与项目契约 `buildCanUseTool` 的
 * `switch(decision)` 分支一致（`'accept'` / `'acceptForSession'` / `'cancel'`，
 * 其余落 `default` = 拒绝）。
 *
 * ⚠️ 注意最后一个按钮的**键名与线上值不同名**：词典里这套键叫 `cancelTurn*`
 *    （项目契约的按钮名），而协议值是 `'cancel'`（项目契约 switch 的 case）。
 *    两个名字都对，差别只是"项目契约的界面词" vs "项目契约的协议词" ——
 *    直接采用项目契约就得到这种不同名，别为了整齐去改任何一边。
 */
const OPTIONS: Array<{ decision: ApprovalDecision; labelKey: string; descKey: string }> = [
  {
    decision: 'accept',
    labelKey: 'composer.composerPendingApprovalPanel.approveOnce',
    descKey: 'composer.composerPendingApprovalPanel.approveOnceDescription',
  },
  {
    decision: 'acceptForSession',
    labelKey: 'composer.composerPendingApprovalPanel.alwaysAllowSession',
    descKey: 'composer.composerPendingApprovalPanel.alwaysAllowSessionDescription',
  },
  {
    decision: 'decline',
    labelKey: 'composer.composerPendingApprovalPanel.decline',
    descKey: 'composer.composerPendingApprovalPanel.declineDescription',
  },
  {
    decision: 'cancel',
    labelKey: 'composer.composerPendingApprovalPanel.cancelTurn',
    descKey: 'composer.composerPendingApprovalPanel.cancelTurnDescription',
  },
];

interface Props {
  request: ApprovalRequest;
  /** 提交决定 */
  onDecide: (decision: ApprovalDecision) => void;
}

export function ApprovalDialog({ request, onDecide }: Props): JSX.Element {
  /**
   * Esc = 拒绝（`decline`），**不是**取消回合。
   *
   * ⚠️ 这条是刻意选的，别再改成 `cancelTurn`：`cancel` 在主进程会带
   *    `interrupt: true`，等于**把用户整轮任务掐掉**。而 Esc 是个太容易误触的键
   *    （AskUserDialog 里 Esc 也只是"取消这次提问"），让它连带停掉整个回合
   *    是惩罚性的。要停回合请点那个按钮（它的 description 写明了"停止当前回合"）。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDecide('decline');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDecide]);

  /**
   * ⚠️ 遮罩**故意不绑 onClick**（与 AskUserDialog 同一条教训）：
   *    遮罩铺满视口，任何一次误点都会把这次审批变成"用户拒绝了"，
   *    模型随即带着"被拒绝"的前提继续 —— 而用户其实什么都没选。
   *    而且这里的代价更高：主进程那条 promise 会一直挂着等决定，
   *    静默丢掉等于把回合卡死。取消只能是显式的（Esc / 点按钮）。
   */
  return (
    <div className="modal-backdrop">
      <div
        className="modal ask-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tx('composer.composerPendingApprovalPanel.reviewToContinue')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="ask-dialog-heading">
            <Icon name="shield-check" size={16} />
            <span className="modal-title">{tx(PROMPT_KEY[request.kind])}</span>
          </div>
        </div>

        <div className="modal-body ask-dialog-body">
          <section className="ask-question">
            {/* 工具名单独一行 —— 项目契约只显示"有命令等待审批"，用户看不出在批准哪个工具 */}
            <div className="ask-question-header">{request.toolName}</div>
            {/*
              `detail` 是机器生成的（`工具名: <JSON 输入>`，超 400 字符截断），**不是 i18n 文案**。
              用现成的 `ask-question-text` 类，**不新增 CSS 类**（样式表正被别的队友改，
              碰了容易撞车）。长 JSON 的折行用内联样式解决：`detail` 最长 400 字符，
              默认不折行会横向顶出模态框。
            */}
            <div
              className="ask-question-text"
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {request.detail}
            </div>

            <div className="ask-options">
              {OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.decision}
                  className="ask-option"
                  data-approval={opt.decision}
                  onClick={() => onDecide(opt.decision)}
                >
                  <span className="ask-option-body">
                    <span className="ask-option-label">{tx(opt.labelKey)}</span>
                    <span className="ask-option-desc">{tx(opt.descKey)}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="modal-foot ask-dialog-foot">
          <span className="ask-dialog-foot-hint">
            {tx('composer.composerPendingApprovalPanel.reviewToContinue')}
          </span>
        </div>
      </div>
    </div>
  );
}
