# 追问行为（排队 / 调整当前任务）实机验证 · followup-e2e

- 状态：**已通过**。假上游链路 **38 passed / 0 failed**；真模型（DeepSeek）链路独立复验通过。
- 产物：`dist/win-unpacked/MModels.exe`（app.asar 12:06:49，含 6 处修复）
- 结论一句话：**"排队"与"调整当前任务"都是真功能** —— 排队会在回合结束后按 FIFO 真的把消息打到模型；调整会真的打断当前回合并补发。修复前 `调整` 这条路径是"假功能"（消息被静默丢弃）。

> 这份文档的目的不是复述一次跑分，而是给后面**别的功能**做同类验证时留下一套可抄的做法：
> 怎么造判据、怎么读时间线、以及**为什么不能只看 DOM**。

---

## 1. 复跑

```bash
# 全套（C1→C4 + C5 + 时间线），约 2 分钟
node .workbuddy/ui-audit/tmp-followup-e2e.mjs

# 只准备隔离 userData、不起 GUI（不抢前台焦点），报告写 tmp-prep-only-out.txt
node .workbuddy/ui-audit/tmp-followup-e2e.mjs --prep-only

# 其它开关
node .workbuddy/ui-audit/tmp-followup-e2e.mjs --exe=<path> --port=9333 --fakePort=8787 --feedback=900
```

- 必须先有 team-lead 打好的新包。脚本会比对 `src/renderer/src/pages/*` 最新 mtime 与 exe mtime，源码更新会打 `[warn] ⚠️ 源码比 exe 新 → 测的是旧产物！`。
- 隔离性：把 `%APPDATA%/mmodels-desktop/{config.json,mmodels.db}` 复制到 `.workbuddy/ui-audit/e2e-userdata/`，只改**副本**；Electron 用 `--user-data-dir` 指过去，**不碰** team-lead 的 userData 与单实例锁。
- 退出码：`0` = 全过；`1` = 有断言红 / FATAL / 一条断言都没跑到。**没有全局超时**（分步超时叠加最坏 ≈ 13 分钟）；若它几分钟就被杀掉，那是外部工具超时，`finally` 不执行 → 报告文件会保持上一次内容，要配 mtime 看。
- 报告与截图：`.workbuddy/ui-audit/tmp-followup-e2e-out.txt`（脚本 finally 覆盖写）、`.workbuddy/ui-audit/e2e-shots/*.png`（10 张）。
- 文件命名约定（踩坑后定的）：**报告文件名带模式**，`-full` / `-prep` 分开，别让两种运行模式复用同一个名字。当前 `--prep-only` 已单独写 `tmp-prep-only-out.txt`。

### 为什么不配真 key 也能跑
无 provider 时 `src/main/ipc/session.ts:179 buildRunOptions()` 会在 `runner.run()` **之前**抛错（`:186` 文案「尚未配置任何模型供应商…」）→ 永远不会有 `session-end` → `isRunning` 永远为 true，「回合结束后 FIFO 自动消化」和「打断后补发」两条路径根本走不到。
所以配一个本地假上游 `.workbuddy/ui-audit/tmp-fake-anthropic.mjs`（`127.0.0.1:8787`，最小合法 Anthropic SSE：`message_start → content_block_start → content_block_delta×N → content_block_stop → message_delta(end_turn) → message_stop`），并带一个 `/__stats` 端点返回 `{calls, times, bodies}` —— 这是后面所有判据的地基。

---

## 2. 验收判据（C1–C5）

| # | 操作（设置 × 按键） | 必须成立 |
|---|---|---|
| **C1** | 设置=排队，运行中按 Enter | ① 第一条发出后确认 `running=true` ② 第 2 条出现徽标真实文本「**已排队 1 条**」③ 第 3/4 条 → 「已排队 2 条 / 3 条」，`.cz-queue-item` 计数 = 3 ④ 回合结束后**自动**发出：上游 `+4` 且连续 3 次采样 `running=false` ⑤ 消息表里 B、C、D 都在且 **idx(B) < idx(C) < idx(D)**（真 FIFO）⑥ `.cz-queue` 消失 |
| **C2** | 设置=排队，运行中按 **Ctrl+Enter** | 取反 = **打断，不入队**：① 无队列徽标 ② 上游 `+2`（第二条真的补发到上游）③ 第二条在消息列表里（**没被吞**） |
| **C3** | 设置=调整当前任务，运行中按 Enter | **打断，不入队**：① 无徽标 ② 上游 `+2` ③ 第二条在消息列表里 |
| **C4** | 设置=调整当前任务，运行中按 **Ctrl+Enter** | 取反 = **入队**：① 徽标「已排队 1 条」② 回合结束自动发出，上游 `+2` ③ 第二条在消息列表里 |
| **C5** | 队列里两条 + 中途**删掉供应商** | 12 条：① C5-A 进入运行中 ② 两条都进队列（徽标 2 条）③ `.cz-queue-item.is-failed` 条数 = 1 ④ 标红条目文本含「**发送失败**」⑤ `.cz-queue-retry` 按钮 = 1 ⑥ 徽标没消失（仍 2 条）⑦ 上游只 `+1`（发不出去就是发不出去）⑧ 消息列表里**没有**第三条（后面的没被跳过，队列停住了）⑨ 恢复供应商 + 点「重试」→ `settle` 通过（队列恢复消化）⑩ 上游 `+3` ⑪ 队列最终清空 ⑫ 重试后两条都进消息列表 |

**反例（修复前的红）**：C2/C3 的「打断后补发」是 ✗ —— 界面看起来正常（消息乐观插入了、徽标也不出现），但第二条**从未到达上游**，且库里留下 `sessions.error = 该会话已有正在执行的任务，请先中断或等待完成`。

**造错方式的坑**：C5 用 `window.mathmodel.llm.deleteProvider('p_fake_e2e')`（用户真实动作 → 走 `buildRunOptions()` 抛错路径），**不要**把 provider 指死端口 —— 死端口只让 SDK 在 `runner.run()` **内部**失败，被 `run()` 自己 catch → IPC 正常 resolve → `dispatch` 返回 `true` → 测不到失败语义。

---

## 3. 13 条上游调用时间线怎么读

报告末尾 `[时间线]` 段，来自**假上游服务端**记录的 `/__stats`：

```
  # 1  +    0ms  最后一条用户消息="no agent name is typed. (Tools: *)\n- Explore: Read-only sear"
  # 2  + 6005ms  最后一条用户消息="C1-B"
  # 3  +11619ms  最后一条用户消息="C1-C"
  # 4  +17812ms  最后一条用户消息="C1-D"
  # 5  +25298ms  最后一条用户消息="C2-A"
  # 6  +28522ms  最后一条用户消息="C2-B"
  # 7  +36877ms  最后一条用户消息="C3-A"
  # 8  +39633ms  最后一条用户消息="C3-B"
  # 9  +47015ms  最后一条用户消息="C4-A"
  #10  +52754ms  最后一条用户消息="C4-B"
  #11  +61296ms  最后一条用户消息="o add new tasks and TaskUpdate to update task status (set to"
  #12  +121210ms 最后一条用户消息="C5-B"
  #13  +128027ms 最后一条用户消息="C5-C"
```

读法：
1. **`#n` 是上游收到的一次 `/v1/messages` 请求**，只会增不会减 —— 前端 DOM 可以骗人，服务端收包计数骗不了（HTTP 真的发出去才会有）。`calls` 就是我们所有断言的锚。
2. **`+Xms` 是相对第一次调用的时刻**。配合假上游参数（`FAKE_DELAY=700` × `FAKE_CHUNKS=6`）可推出单个回合 ≈ 5.6s。
3. 关键判读一：**`#5 → #6` 只差 3.2s**（C2-A → C2-B）。3.2s **短于**一个完整回合（5.6s）→ 说明第二条是在**abort 掉第一轮之后立刻**发出的，而不是等第一轮自然结束。这就是「打断当前任务」的硬证据。
4. 关键判读二：**`#11 → #12` 差 ≈60s**，中间夹着「删供应商 → 恢复供应商 → 点重试」。这 60s 的空白证明失败条目**卡住了整条队列**，第三条没有偷偷溜过去（否则 `#12` 会是 C5-C 而不是 C5-B）。
5. 关键判读三：`#2 → #3 → #4` 间隔 ≈ 5.6s 且顺序 = B→C→D，与消息表 `idx(B) < idx(C) < idx(D)` 互证 → 真 FIFO。

**诚实 caveat**：`#1` 与 `#11` 抓到的"最后一条用户消息"是 **CLI 自己注入的文本**（不是我们的测试消息，其中 `#11` 那条是 SDK 注入的系统说明片段）。所以**这两行的文字不可引用**。判定用「调用次数的增量」+「消息表里的顺序」，不受影响。`#11` 对应 C5-A 那一轮。

---

## 4. 真正的判据是「上游调用次数 + 库层 error」，不是 DOM

前端 DOM 只是**用户感知层**，它可以因为样式回退、类名拼错、乐观更新而**假绿**（看起来对，其实消息没发出去）或**假红**。
这套验证里**不可撒谎**的证据只有三类：

| 证据 | 在哪 | 为什么不可撒谎 |
|---|---|---|
| 上游收到的请求数 `calls` | 假上游 `/__stats` | 只有真 SDK 真的发了 HTTP 才会 +1 |
| 上游收到的请求体 `lastUser` | 假上游 `/__stats` | 服务端读到的字节 |
| `sessions.error` + `messages` 表 | 隔离副本 `mmodels.db` | 主进程写的，绕过渲染层 |

**库层怎么 dump**（示例，当时用的一次性命令，未留脚本）：
```bash
node --experimental-sqlite -e "
const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync(process.argv[1]);
console.log('--- sessions ---');
for (const r of d.prepare('select id,title,status,error,message_count from sessions order by rowid desc limit 5').all())
  console.log(JSON.stringify(r));
console.log('--- messages 概要 ---');
const rows = d.prepare('select role,length(content) as n from messages order by rowid').all();
console.log('count=' + rows.length, rows.map(r => r.role + ':' + r.n).join(' | '));
" "<userData>/mmodels.db"
```
（`node:sqlite` 在 Node 22 需要 `--experimental-sqlite`；E2E 脚本已把这条自重启处理掉了，见脚本顶部 `MM_E2E_SQLITE_OK` 哨兵。）

**修复前的库层铁证**（`.workbuddy/ui-audit/tmp-dbdump.txt`）：
```
{"id":"82c0ed28-…","title":"/mma-review\n\nC1-A","status":"idle",
 "error":"该会话已有正在执行的任务，请先中断或等待完成","message_count":16}
--- messages 概要 ---
count=16
user:46 | assistant:55 | user:46 | assistant:55 | user:46 | assistant:55 | user:46 | assistant:55
| user:46 | user:46 | user:46 | user:46 | user:46 | assistant:55 | user:46 | assistant:55
（= 16 条：4 组正常问答，随后 **5 条连续 `user:46`**，再一条 assistant）
```
两个要点：
- `sessions.error` 直接写着主进程那句 guard → 回合**在跑的时候**又被塞了一条消息进去（说明渲染层提前开火了）。
- **连续 5 条 `user` 后面都没有 `assistant` 回复** → 这些排队消息**从未被执行**，是静默丢弃的痕迹。同时刻的 DOM 是"看起来一切正常"的。
  这就是"只看 DOM 会漏掉真 bug"的实例。
  （注：那次 dump 的 assistant 文本是 `Unknown command: /mma-review`，源于当时配置里 `composerMode='review'`；E2E 脚本后来改成 `'chat'`。上述两条证据与该配置无关。）

---

## 5. 修复前后对照与 gating 代码位置

| | 修复前 | 修复后 |
|---|---|---|
| 假上游 E2E | **20 passed / 6 failed**（12:01，`.workbuddy/ui-audit/tmp-e2e-report-before-fix.txt`） | **38 passed / 0 failed**（12:09 启动 / 12:11 落盘，`tmp-e2e-run.txt`，耗时 2m08s） |
| C1 排队 FIFO | ✓ | ✓ |
| C2 排队+Ctrl（打断补发） | ✗ | ✓（上游 `4 → 6`，`+28522ms C2-B`） |
| C3 调整+Enter（打断补发） | ✗ | ✓（上游 `6 → 8`） |
| C4 调整+Ctrl（取反入队） | ✓ | ✓（上游 `8 → 10`） |
| C5 失败保留 + 重试 | 不存在 | ✓ 12/12（上游 `10 → 11`，重试后 `10 → 13`） |

**根因**：`isRunning = stream.active || activeSession?.status === 'running'`，而 `dispatch()` 不刷新 `sessions`，主进程写 `status='running'` 渲染层并不知情 → `activeSession.status` 常年是**过期的 `'idle'`**。
于是只要回合中途有人 `setStream({active:false})`（steer 分支 / 点停止键），`isRunning` 立刻变 false → 队列**提前开火** → 撞上主进程 guard `src/main/agent/session.ts:116`（`running=true` 在 `:118`，`finally` 里 `:199` 才放回）→ 而 steer 路径的 `pendingSteerRef` 已经被清空 → **消息静默丢失**。

**6 处 gating（修复）**：

| # | 位置 | 改了什么 |
|---|---|---|
| ① | `src/renderer/src/pages/ChatPage.tsx:408` | 新增 `settledRef = useRef(true)` —— "**真的收到过 session-end**"才是正向证据，取代不可靠的 `!isRunning` |
| ② | `ChatPage.tsx:457` | session-end handler 里置 `settledRef.current = true` |
| ③ | `ChatPage.tsx:531` / `:538-541` | `dispatch()` 开头置 `false`；`sendMessage` 返回 `false`（主进程连 `run()` 都没进去，永远不会有 session-end）时**放回 true** + `setStream(active:false)`，否则队列永久卡死 |
| ④ | `ChatPage.tsx:576-590` | steer 分支**删掉**提前的 `setStream(s => ({...s, active:false}))`（提前 flush 的元凶），只保留 `pendingSteerRef` + `abort` + `refreshSessions` |
| ⑤ | `ChatPage.tsx:603` | 队列消化门槛：`if (isRunning \|\| !settledRef.current \|\| flushingRef.current) return;` |
| ⑥ | `src/renderer/src/store/app.ts:750`（接口 `:562`，调用点 `ChatPage.tsx:626`） | `markFollowUpError` 改为收**整条** `QueuedFollowUp`；条目已被 `takeFollowUp()` 出队时**补回队首**；同一 id 重复 mark 只更新 error（**幂等**）。修前是 `map` 找 id，而条目早已出队 → 标记落空、消息凭空消失 |

**单元测试同步（防假阳性）**：`src/renderer/src/store/follow-up-queue.test.ts:144`
原用例是**假阳性**：`enqueue → mark（条目还在队列里）→ 断言`，但 `ChatPage` 的真实调用顺序**恰好相反**（`enqueue → takeFollowUp()`（先出队）→ `dispatch()` → 失败才 `markFollowUpError()`）。
现按真实顺序改写，并在测试头写明教训。鉴别力已用旧实现语义重放验证（`.workbuddy/ui-audit/tmp-old-impl-sim.mjs`：旧实现 1/7、新实现 7/7）。
> 教训：用例必须照抄**真实调用顺序**，否则测的是自己想象的世界。

---

## 6. 真模型（DeepSeek）独立复验

假上游证明"协议层通了"，真模型证明"真实链路也通"。记录见 `.workbuddy/ui-audit/real-deepseek-test.md`：

- 基础对话：真回复落地 + 「思考过程」折叠块正常 + 用量 `↑80334 ↓65` ✓
- **排队档**：第 2 条 → 徽标「已排队 1 条 | 回合结束后按顺序自动发出 | 全部清除 | 1 | …」→ 75s 后队列清空、`running=false`、两条用户消息都在列表 ✓（自动消化在真模型上也成立）
- **调整档**：第 2 条打断第一条 → `errText=0`（不再有「该会话已有正在执行的任务」）→ 最后一条助手回复**正是打断消息的答案**「2」 ✓（修复前这条被静默丢弃）

相关副产物（已单独报给 team-lead）：
1. 内置 DeepSeek 预设模型名与线上 id 不一致（预设 `deepseek-v4-flash` / 线上 `deepseek-flash`）→ 用户照预设添加会选不到可用模型。
2. 输入 token 达 8 万（`↑80334`）：系统提示 / skills 注入量偏大，值得看成本。

---

## 7. 辅助证据文件

| 文件 | 内容 |
|---|---|
| `.workbuddy/ui-audit/tmp-followup-e2e.mjs` | E2E 驱动（C1–C5 + 时间线） |
| `.workbuddy/ui-audit/tmp-fake-anthropic.mjs` | 假 Anthropic SSE + `/__stats`（`FAKE_PORT`/`FAKE_DELAY`/`FAKE_CHUNKS`） |
| `.workbuddy/ui-audit/tmp-sdk-probe.mjs` | SDK 层探针 **7/7**：假上游流被真 SDK 接受；`abort` 能终止流（2316ms）；每轮 CLI 启动开销 ≈ 2.8s |
| `.workbuddy/ui-audit/tmp-old-impl-sim.mjs` | 用旧实现语义重放新单测序列 → 证明新用例**有鉴别力** |
| `.workbuddy/ui-audit/e2e-shots/` | 10 张截图（`00-ready`、`01/02/03-c1-*`、`04-c2-steer`、`05/06-c4-*`、`07-c5-failed`、`08-c5-recovered`、`99-fail-no-textarea`） |
| `.workbuddy/ui-audit/tmp-e2e-report-before-fix.txt` | 修复前完整报告（20/6） |
| `.workbuddy/ui-audit/tmp-e2e-run.txt` | 修复后完整报告（38/0，含 13 条时间线） |
| `.workbuddy/ui-audit/tmp-dbdump.txt` | 修复前的库层铁证（`sessions.error` + 连续无回复的 user 消息） |
| `.workbuddy/ui-audit/real-deepseek-test.md` | 真模型复验记录 |

---

## 8. 可复用的做法（给下一个功能）

1. **先找"不可撒谎的证据源"**：网络收包计数、DB 行、文件系统副作用。DOM 只用来验"用户看得见"的部分。
2. **给被判定的动作造一个确定的锚**：这里是"上游调用次数增量"，因为它单调、离线可读、与 UI 无关。
3. **不稳定等待不要用"一次为真"**：`waitIdle`（`running===false` 一次）在回合间空隙会误判；用 `settle()` = **达到目标计数 且 连续 3 次采样空闲**。
4. **断言要在"真实调用顺序"上写**：先照抄 UI 里的调用次序（含出队这类状态变更），再断言。顺序写反 → 假阳性（本次单测就踩过）。
5. **报告文件名带运行模式**，否则一次 `--prep-only` 会把完整报告覆盖成 3 行，误导判断。
6. **别用"验证动作"毁掉证据**：验证前先另存一份原始报告。
7. **造错要造"用户真能做出来的错"**：删 provider（走 `buildRunOptions` 抛错）> 指死端口（被内部 catch，测不到）。
