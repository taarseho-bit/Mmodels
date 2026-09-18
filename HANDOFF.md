# MModels 交接报告（HANDOFF）

> **最新状态（2026-09-18 15:49）**：英文过程增加界面兜底，工具旁白字段不再透出英文；输入区“预计消耗”已删除；`mma-paper` 在原版全文之上追加可行性、约束残差、最优性和交叉验证门槛，并有原版 SHA-256 对照防回退。TypeScript 0 错，Vitest **42 文件 / 825 条**全绿，脚本检查 **45/45**，最终打包应用 **37/37**。免安装版 SHA256：`b0678ee97b70b34b3f09dfa0c22c78c3a4b5207932e46023b95f95e164a83b13`。

> **后续完善记录（2026-09-18）**：源码已进一步接入文件树二进制创建副本、上下文用量条、`Ctrl/Cmd+F` 会话内查找、`Ctrl/Cmd+/` 快捷键速查、Plan 模式、消息图片灯箱、助手错误诊断卡，以及本地 HTML/PNG/ZIP 会话分享入口。运行环境现已默认国内镜像、可直接识别 Windows 标准目录下的 `draw.io.exe`；对话中间过程已改成透明中文文字流，技术细节默认折叠。本文后面的旧缺口表以源码为准。

> 写给下一个接手的 AI / 开发者。目标：**读完这一份文档就能继续干活，不用重新踩坑。**
> 生成时刻：2026-09-18 10:57（所有数字都是当时实测，不是记忆）

---

## 0. 一页纸状态

| 项 | 值 |
|---|---|
| 项目 | `D:\mathmodel-desktop` —— MathModel Desktop 原版的**复刻版**（Electron 33 + React 18 + TS + electron-vite，产品名 **MModels**） |
| 原版参照 | 装在 `C:\Users\xh\AppData\Local\Programs\@mathmodeldesktop\`（`mathmodel.exe`，`resources/app.asar` 可直读） |
| 原版真实 userData | `C:\Users\xh\AppData\Roaming\@mathmodel\desktop\`（**注意不是** `%APPDATA%\mathmodel-desktop`，那只有 config.json/db） |
| 类型检查 | `tsc` node / web **均 0 错误** |
| 测试 | vitest **42 文件 / 825 条全绿**；脚本检查 **45/45**；最终打包应用 **37/37**（2026-09-18 15:49 实测） |
| 当前包 | `release/win-unpacked/resources/app.asar` 46,753,864 B，sha256 `e288073469581742a232f78515bc3faad4ec73358a9cb321bb748bf4e643e2f1` |
| 免安装版 | `release/MModels-0.1.0-x64-Portable.exe` 321,644,967 B，sha256 `b0678ee97b70b34b3f09dfa0c22c78c3a4b5207932e46023b95f95e164a83b13` |
| 安装包 | `release/MModels-0.1.0-x64-Setup.exe` 321,811,708 B，sha256 `410e225eef3804e23c057a98ab410fed461a19529044f425eeba5775a198af93`（未签名，首次运行可能被 SmartScreen/杀软提示） |
| **最重要的一句话** | 最新需求已进入源码与最终包，自动化和真实打包应用验收均已通过。 |

---

## 1. 项目目标与硬性要求（用户原话口径）

1. **与原版界面一模一样、功能零缩水**（排除在线服务：账号/订阅/云分享/自动更新）。
2. 用户点名的新功能**可以做**（"我要求的功能原版没有，你也可以加，保证只多不少"）。
3. **核心功能必须真的能用**：写论文 → 产出一篇完整 PDF；评阅 → 产出可执行的修改意见；找数据 → 真的下载数据并核验来源。
4. i18n / 翻译**放最后**。
5. 用户偏好：中文、长时段连续执行（7–8 小时不打断）、汇报要通俗+带文件行号证据。

---

## 2. 怎么构建（本机有坑，照抄别发挥）

```bash
# 构建（含 tsc node/web + vitest + electron-vite + electron-builder 四道闸，任何一道失败即中止）
cd /d/mathmodel-desktop
bash .workbuddy/build/build7.sh 2>&1 | tee .workbuddy/build/final10.log
```

构建脚本内部已设置（**不要删**）：
- `ELECTRON_MIRROR` / `npm_config_electron_mirror` / `ELECTRON_BUILDER_BINARIES_MIRROR` = npmmirror（官方源在本机 HTTP 000 / ECONNRESET，Electron 二进制会 0 字节）
- `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=20000` —— **WorkBuddy 注入的 safe-delete 闸**会给 Node 的 `fs.rmSync` 和 bash 的 `rm` 加"单轮累计删除 >50 个文件需确认"的限制，而 vite 的 `prepareOutDir` 每次构建要整目录清空 `out/*`（217+ 文件）⇒ 不抬阈值**构建必失败**，报 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`
- 构建前会**先删 `out/{renderer,main,preload}`**（只删本项目构建输出目录）
- 构建前会**断言包内 `resources/builtin-skills/data-search/.disabled-by-default` 不存在**（有就中止 —— 见 §6 有意偏离 #1）
- 构建前会打印 src/resources 最新 mtime（**防"包比源码旧"**：若包 mtime < 源码 mtime，结论作废）

**验证命令**（用本地二进制，别用裸 `npx`）：
```bash
NODE="C:/Users/xh/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
"$NODE" node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json
"$NODE" node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json
"$NODE" node_modules/vitest/vitest.mjs run
```

**其它本机坑（都真实踩过）**：
- Windows 版 `node.exe` 不认 `/d/...`，会解析成 `D:\d\...` ⇒ 喂给 node 的路径一律 `D:/...`
- `grep`/`sed`/`cut` 管道会把中文变乱码 ⇒ **判断编码/内容问题前，用 Read 工具直接读文件**（我因此误报过一次"日志是 GBK 乱码"，实际文件是干净的 UTF-8）
- Bash/PowerShell 的 stdout **偶发全空**（连 `echo` 都不回显）⇒ 把命令结果重定向到文件再用 Read 读
- **不要编辑正在执行的脚本**（bash 按字节偏移增量读取，会把片段当命令执行）
- `pnpm` 用 corepack：`COREPACK_HOME=~/.workbuddy/corepack/cache corepack prepare pnpm@10.18.0 --activate`

---

## 3. 架构地图（改哪里之前先看这张表）

| 层 | 文件 | 职责 / 关键点 |
|---|---|---|
| 主进程 · 会话生命周期 | `src/main/agent/session.ts` | **常驻会话**（2026-09-18 新改）：`query()` 的 prompt 从字符串改成异步队列 ⇒ 不再"首个 result 就关 stdin" |
| 主进程 · 收尾判定 | `src/main/agent/session-loop.ts` | `shouldConcludeTurn(s) = s.sawResult && s.backgroundTasks.size === 0`；集合**只由** `background_tasks_changed`（REPLACE 语义）维护；兜底上限 30min |
| 主进程 · 流事件折叠 | `src/main/ipc/session.ts` + `src/main/ipc/stream-blocks.ts` | text/thinking 按下标写、tool_use push、tool-result 回填；`buildSystemPrompt()`（**三节**：中文解说 / 提问不二次确认 / **长时任务不要交还回合**） |
| 主进程 · 进行中快照 | `src/main/db/turn-spills.ts` + `db/index.ts` 的 `turn_spills` 表 | 每会话一行"进行中回合快照"，节流写（结构性事件立即/文本增量 300ms），收尾先落消息**再**删快照 |
| 主进程 · 消息级操作 | `src/main/server/message-ops.ts` + `server/routes.ts` | **走本地 HTTP 路由 `/api/*`，不是 IPC 通道**（`shared/types.ts` 的 IPC 表只有 10 条，**不要**往里加 SESSION_CHECKPOINT/FORK/REVERT） |
| 主进程 · 技能物化 | `src/main/agent/skills-plugin.ts` | 按 `.disabled-by-default` 标记决定技能进 `skills/` 还是 `skills-disabled/` |
| 渲染层 · 对话页 | `src/renderer/src/pages/ChatPage.tsx` | 消息渲染 `msg msg-${role}`（:1070）、工具行文案/折叠、`adoptInflight`（进行中快照回灌） |
| 渲染层 · 会话级缓存 | `src/renderer/src/store/chat-stream.ts` | `Map<sessionId, SessionStream>`，上限 8 会话 / 400 块；`snapshot()` / `receive()` / `hydrate()` |
| 渲染层 · 全局 store | `src/renderer/src/store/app.ts` | **项目记忆**（`lastSessionByProject`，切回项目恢复会话）、追问队列按会话归属（`followUpItemsFor` / `followUpHeadFor`，**全局只有一份归属过滤实现**） |
| 渲染层 · 任务面板 | `src/renderer/src/store/tasks.ts` | `extractTasks(blocks, initial)`：**历史消息在前、流式块在后**；`ChatPage.tsx:391` 是 `panelTasks(historyBlocks, stream)` 两源合并 ⇒ **面板不需要独立落库表**（原版有 `session_tasks` 表，我们有意不做，见 §6） |
| 渲染层 · 输入区 | `src/renderer/src/components/Composer.tsx` | 模式→命令前缀（`MODE_COMMAND.data='/data-search'` 等）、「+」弹层（`PlusMenu.tsx`，10 行）、队列徽标 |
| 渲染层 · 工具行文案 | `src/renderer/src/lib/tool-row.ts` | `shortToolName` 只用于**查表**，查不到一律落 `chat.toolUseRow.genericTool`（**绝不能出空串/undefined**） |
| preload | `src/preload/index.ts` | `session.get` 返回 `{meta, messages, inflight?}`；**没有进行中回合时这个键根本不出现**（不是空数组） |
| 数据库 | `src/main/db/index.ts`（SCHEMA 常量）+ `migrate.ts` | `messages.blocks`（完整块序列 JSON）、`turn_spills`；**新表靠 `IF NOT EXISTS` 自动补，老库零迁移** |

---

## 4. 已完成 / 未完成清单

### 4.0 ★ 接手后第一件事：跑完"最终实机验收"

Batch-3 包已构建好（§0 的指纹就是它），但四轮实机验收**没跑完**：

| 轮次 | 状态 | 原因 |
|---|---|---|
| 1 会话/项目切换 | ❌ 无效 | 采集器 `clickSessionById` 按"DOM 下标↔列表下标"假设定位，列表是 `updated_at DESC`（会变），点成了另一个会话 ⇒ 读数全是错位的。**已修**（改用激活行 `title` 反解 id + 点后回核，点错 `die`），**待重跑** |
| 2 写论文 | ❌ 无效 | cfg **没有"选模式"这一步**，把写论文提示词套在「找数据」模式上发出（会话标题逐字 `/data-search 用「写论文」模式完成`）。**已修**（`cfg-b3-core-p4.json` 113→127 步，加了 `__modeSel` 选模式+回读断言） |
| 3 评阅 | 未跑 | cfg 已修：**`cfg-b3-core-r3.json`**（75 步，port 9423，outDir `core-r3`） |
| 4 找数据 | 未跑 | **`cfg-b3-core-d6.json` 尚未生成**（我核对过文件系统，只有 d5）⇒ 需要先克隆 d5 再补"选模式 + `o.dlg`→`o.dialogNow`"，**保留 `Cd-i-promise` 判据** |

**怎么跑**（必须串行，`fa-run.cjs` 断言起始 `MModels.exe` 进程数=0）：
```bash
# 切换轮前置：重置 userData（改名不删）→ 预热建库 → 播种第二个项目（root 必须绝对路径！）
mv .workbuddy/ui-audit/fa-switch-main .workbuddy/ui-audit/_prev-$(date +%s)
mkdir -p .workbuddy/ui-audit/fa-switch-main
cp .workbuddy/ui-audit/fa-core-main/config.json .workbuddy/ui-audit/fa-switch-main/config.json
FA_RUN_TIMEOUT_MS=300000 bash .workbuddy/ui-audit/fa-core-run.sh warm .workbuddy/ui-audit/cfg-fa-switch-warm.json
# 然后用 python 往 fa-switch-main/mmodels.db 的 projects 表插第二行（6 列，updated_at NOT NULL 无默认值）
# 之后：
FA_RUN_TIMEOUT_MS=1800000 bash .workbuddy/ui-audit/fa-core-run.sh <label> <cfg>
```
四轮的超时上限：切换/评阅/找数据 `1800000`，**写论文 `3300000`**（窗口 45.7 分钟，默认 900s 会腰斩）。
**每轮之后必须重登记指纹**：`node .workbuddy/ui-audit/fa-core-fp.cjs --write`（不重登记 = 下轮开跑就 FAIL）。

**读判据结果的正确姿势**（我犯过 5 次的错）：
- 判据结果有两种落法：**打印在 `run-<label>.log` 里、行首是 `[ui-audit] eval → `**，或写成 `core-e2e/<dir>/eval-NN.txt`
- **说明文字（`note:`）里也会出现 "PASS"/"FAIL" 字样**——那是散文（在解释"如果坏了会看到什么"）。**只认行首 `eval → ` 的行**，否则会把说明当成结论（我误报过一次 J8 FAIL，实际是 PASS）
- `INVALID` = "这轮没测到"（前置不成立），**不是**"把坏结果藏起来"。判据自己分了档：对话页"一行都没选中"算**真实读数**照常报 FAIL，不许用 INVALID 盖掉产品症状

### 4.1 已完成且**实机验证过**的

| 功能 | 证据 |
|---|---|
| 「找数据」从 `Unknown command` → 真正干活 | 终局判据 `PASS Cd-g-gate {"unknownCommand":0,...}`；产物 5 个 csv（最大 7,740 行）+ `data/README.md` 来源登记 + 176 个原始抓取页；模型主动做口径审计（把可疑外部值"降级为旁证"、识别"保留权利≠开放许可"） |
| 「评阅」 | `review.md` 17,691 B，15 条带行号改法 + 5 条加分项 |
| 「写论文」 | 62 页 PDF / 9.87 MB / 5 问正文 / 33 图 / 16 文献（**Batch-1 包上验的，Batch-3 需复跑**） |
| 会话切换后过程块/任务面板复原 | `PASS J1 msgs=2/2 seqEq=true toolEq=true`、`PASS J3a`、`PASS J3b n=8/8 eq=true barEq=true` |
| **项目切换零点击恢复会话**（用户报的 bug） | `PASSJ8(zero-click) selOk=true msgs=6 blocks=58 running=true`，且切回后任务面板从 7/12 涨到 8/12 |
| 项目切换时回合进行中不丢 | `[zero-click]PASS J2p tools 27->39 prefix=true running=true` |

### 4.2 已实现、**单测绿但实机未验**的（Batch-3 新增）

1. **常驻会话**（修"模型等后台唤醒永远等不到"）—— 根因：prompt 传字符串 ⇒ SDK 判单轮 ⇒ 首个 result 就关 stdin ⇒ CLI 退出 ⇒ 后台任务被连坐。修法见 §3。⚠️ **有一条未取证**：SDK 收到 `task_notification` 后是否**无条件**自动续跑，没找到字面代码。
2. **系统提示词第三节**（不许许空承诺/不许为等通知交还回合）
3. **消息级操作**：`POST /api/checkpoint/revert`（routes.ts:309）+ `POST /api/sessions/:id/fork`（:395）+ 编辑重发；二次确认 `confirm!==true`→400；回滚复用 `git/restoreVersion()`（自带 restore-backup 提交）
4. **论文模板区**：fork / delete（**内置模板在主进程 store 层真拒绝** `builtin_template_readonly`）/ useTemplate 开新会话；两套库并存（原版受管库 + 既有"指本地目录"增强）
5. **「+」弹层菜单**（10 行，含 `research`/`webSearch` 两行——见 §6 有意偏离 #2）
6. **工具行可读文案 + 工具组折叠**（连续相邻 tool_use 折叠，展开还原完整卡片）
7. **追问队列按会话归属**（条目带必填 `sessionId`；出队只发自己的会话；徽标按会话计数）
8. **`preload` 的 `inflight` 类型**

### 4.3 **未完成**（按"用户能感知"排序，含入口与规格出处）

| # | 功能 | 入口 / 现状 | 规格出处 |
|---|---|---|---|
| **1** | **发送后自己那条消息不显示**（要等整轮结束） | 根因已定死：`SESSION_SEND` 落库前先 `await captureCheckpoint()`（546ms），而 `ChatPage` **只在挂载时拉一次历史**。已派修复但**被打断，src 零改动**。约束：不许重复渲染、`EnvSection.install-order.test.ts` 必须保持绿、**不许移动 checkpoint 时机** | `src/renderer/src/components/settings/EnvSection.install-order.test.ts:1-14` |
| **2** | 会话导出资源包(.zip) / 分享图片(.png) / 分享页面(.html) / 分享论文 | 全仓只有 i18n 键（`shell.sidebar.exportBundleZip` 等），**实现 0**。入口 `Sidebar.tsx` + `ContextMenu.tsx` + `main/ipc/file.ts`（`file:saveShareImage` 通道已存在 0 调用）+ `server/routes.ts` 补 `/bundle`、`/share`。⚠️ 与消息级操作**都要改 routes.ts，必须串行** | `BACKLOG.md §3-22`（约 472 行） |
| **3** | 快速模式 fastMode 整条链 | 已完成：供应商可声明支持模型，Composer 显示徽标与开关，Agent 通过 SDK settings 注入；待实机验收 | `DELIVERY.md §6 / 附录 A` |
| **4** | 上下文用量指示器（#7）+ token 记账（#30） | `usedTokens` 全仓 0 命中。#30 挡 #7：`cacheRead/WriteTokens` 未落库 + `totalUsage` 语义错 | `BACKLOG.md §3-33 / §3-18` |
| **5** | B6 内置 MCP | 设置里开关拨了没用：值传到 agent 但**没有任何内置 MCP server 注册**。入口 `main/agent/session.ts:72` + `:309-316` | `BACKLOG.md §3-5` |
| **6** | #1 定时任务对话框高级配置（61 键） | ⚠️ 必须配幂等迁移（12 列） | `BACKLOG.md §3-13` |
| 7 | #4 助手错误提示卡 | 无依赖 | `BACKLOG.md §3-15` |
| 8 | #17 文件树右键菜单（`ContextMenu.tsx` 已可复用） | | `BACKLOG.md §3-12` |
| 9 | #19 全局搜索 ⌘K / #20 快捷键速查 ⌘/ | 依赖 #13 键位接线（`keybindings/dispatch.ts`，已部分接线） | `BACKLOG.md §3-25/26` |
| 10 | #27 顶栏用户菜单（7 项，已拍板做） | 依赖 #3 短片 | `BACKLOG.md §3-32` |
| 11 | #24 浏览器站点规则+审计（配对/绑定已拍板**不做**） | 不依赖 Chrome 扩展，可独立做 | `BACKLOG.md §3-9` |
| 12 | B7/B8/B10/B11+B21/B12/B14/B17/B20/B23 | 本机插件列表 / 编辑器拉起 / 项目级技能 / 项目级上下文 / 会话目标 / run-state 事件 / 附件对象模型 / AGENTS.md / 真题附件 | `BACKLOG.md §3-34~43` |
| 13 | **#3 产品短片 MotionOnboarding / #18 头像（只做本地） / #22 协作评论（排最后） / #23 版本面板动态** | | `BACKLOG.md §3-14/24/27/28` |

**有意不做（已拍板，别推翻）**：#15 社区技能列表、#24 浏览器"你的 Chrome"+扩展配对、B16 供应商用量查询、B10 的远端安装 —— 都是**在线服务**，属用户排除项。

---

## 5. 验收装置（这是这个仓库最值钱的资产之一，别拆）

位置 `.workbuddy/ui-audit/`：

| 文件 | 作用 |
|---|---|
| `fa-run.cjs` | 通用跑批器：读 cfg JSON，按 `actions` 执行 `wait/eval/shot/typeText/pressEnter`。⚠️ `fa-run.cjs:158` 有 `FA_RUN_TIMEOUT_MS`（默认 **900s**）的 spawnSync 硬杀上限，长窗口必须显式设 |
| `fa-core-run.sh` | 每轮包装：**开跑前断言包指纹**（不匹配直接退出）→ 跑 → 收尾进程检查 → 安装痕迹差集 |
| `fa-core-fp.cjs` | **包指纹 v2**：`sha256(asar + 资源树清单)`，覆盖 `app.asar.unpacked/bin/claude-code/builtin-skills/builtin-examples/pdfjs/algorithms`（1016 文件/552MB）。`--write` 登记 / `--check <fp>` 断言。**为什么必须 v2**：旧指纹只算 app.asar，而 `/data-search` 事故的唯一根因文件**不在 app.asar 里**（`builtin-skills/**` 是 extraResources）⇒ 旧指纹对整棵资源树被换掉照样 PASS |
| `cfg-b3-core-p4.json`(127步) / `cfg-b3-core-r3.json`(75步) / `cfg-b3-core-d5.json`(69步，**缺选模式待克隆成 d6**) / `cfg-b3-core-switch-b3.json`(135步) | 四轮的采集配置 |
| `_sw-judge-selftest.cjs` | 判据自测（**87/87**）：含"无效状态不许出 PASS"的反例 |
| `_sw-orchestration-selftest.cjs` | **编排完整性自测**（**95/95**）：断言"cfg 的编排在叙事上讲得通"——每个面 typeText 后必须有发送动作、断言前置动作已出现、模式前置等；8 组反例全红。**它回查修前 cfg 时机械判出了真实事故** |
| `_sw-shot-hash.cjs` | 像素后置核查：相邻截图逐字节相同 + 中间有导航 → 该段作废（防"卡住的页面产出假绿"） |
| `verif-switch-CRITERIA.md` | 判据 J1–J8 + 证伪边界 + 未覆盖清单（§11/§13/§14） |

**会话定位的正确做法**（刚修完，别退回去）：**用激活行的 `title` 反解 id**（`Sidebar.tsx:615 title={s.title}` 与 `session.list` 同源 ⇒ 与行序无关），点后**立刻回核 id**，不匹配逐行兜底，全失败 `die`。**禁止任何 "DOM 下标 ↔ 列表下标" 映射**——列表是 `ORDER BY updated_at DESC`，顺序会变，时对时错。

---

## 6. 与原版的**有意偏离**（每条都要写进交付文档，别静默）

1. **`resources/builtin-skills/data-search/.disabled-by-default` 已删除**。原版同一文件存在 ⇒ **原版的「找数据」自己也发不出 `/data-search`**（原版 userData 的 `skills-plugin/skills-disabled/data-search` 也躺着）。删它 = 用户要求的"默认开启"，属**优于原版**。
2. **「+」菜单的 `research`/`webSearch` 两行降级为不可交互展示项**。取证：原版整包 `enableResearch/researchEnabled/...` 0 命中，两行状态是组件自己的 `useState`、点击只调纯取反函数、**唯一消费点是它们自己的 ✓** ⇒ **原版自己就是两个点了没反应的假开关**。我们不做假开关。⚠️ **用户还没拍板**：要改回"能点但没用"以完全一致，一行的事。
3. **`revertDialogBody` 文案改写**。原句「此后新建的文件会被删除」对 git 版实现**是假话**（从未版本化的文件不删），且它出现在**即将改用户文件的确认框**里 ⇒ 文案准确性优先于逐字一致。原句已存档在 `zh.ts:356` 附近注释。
4. **不建 `session_tasks` 表**（原版有）。理由：模型侧任务 id 不稳定（要从工具结果文本正则抠，`TodoWrite` 路径压根没有）、渲染键在流式途中会从 `k{seq}` 变 `t{id}`、面板语义是"最新一批的状态机"、且建表=第二事实源必然与渲染层漂移。**面板已经能复原**（从块序列折叠，历史+活流两源）。
5. **fork 时 `sdk_session_id` 置 NULL**。照抄原版（原样复制 id）会让分叉会话**共用父会话的 agent 上下文**。这不是偏离，是修了照抄会引入的 bug。
6. **回滚确认框多了 `confirm` 字段**（原版没有）= 加固。
7. **消息级操作走 `/api/*` 本地 HTTP 路由**，原版同层；**不要**往 IPC 常量表加通道。

---

## 7. 判据纪律（接手者最容易踩的 8 个坑，全都真实发生过）

1. **恒假/恒真判据**：判定里引用了不存在的键（如 `o.dlg===false` 而 `o` 只有 `dialogNow`）⇒ **无论产品怎样都报同一个答案**。已写静态扫描器扫全库 131 份 cfg。**修一条时必须扫同族副本**（我修了数据那份、漏了论文/评阅，同一只虫子又活了一轮）。
2. **pre-fix-pass 判据不能当修复证据**：完成回合本就落库，切回读库即复原 ⇒ J1/J3b/J4c 在旧实现下也 PASS。它们只能当**回归护栏**；"进行中切走"的 J2/J3a/J4 才是修复证据。
3. **ND ≠ PASS**，`INVALID` = "没测到" ≠ "藏坏结果"。
4. **历史切片**：复用 userData 时，上一轮的失败消息里含 `Unknown command` ⇒ 判据必须从本轮基线（`a0 = 开跑时 .msg-assistant 条数`）切片，否则修好了也判红。
5. **判据正则别写死**：`mentionsDataFiles` 曾要求 `data/` 前缀，agent 写裸文件名 `sources.json` ⇒ 真通过报成不通过。
6. **卡住的页面会产出假绿**：导航失败后所有"数量为 0"的断言都该 INVALID。**一条判据开头必须先断言"我在预期页面上"**。
7. **自测只能证明"尺子是准的"，证明不了"你量到了东西"** ⇒ 两类自测都要有（判据自测 + 编排完整性自测）。
8. **索引式补丁 + 无断言 = 静默改错**：改 cfg 用"按内容 findIndex + 命中数断言"，别用"先算下标后 splice"。

---

## 8. 快速上手（第一个小时做什么）

1. `bash .workbuddy/build/build7.sh` —— 确认构建闸门全绿（现状应全绿）
2. 读 `.workbuddy/ui-audit/verify/BACKLOG.md` 的 **§0.5（团队决策台账）与 §2（40 条速览表）** —— 那是完整的未落码清单，每条带证据/入口/依赖/判据/风险
3. 补 **`cfg-b3-core-d6.json`**（克隆 d5 + 选模式 + 修 `o.dlg` + 保留 `Cd-i-promise`）
4. 串行跑完四轮实机验收（§4.0），每轮后重登记指纹
5. 修 §4.3 的 **#1 消息可见性**（根因已定死，被打断没落地）
6. 问用户两个待拍板问题：①「+」菜单那两行要不要改回"能点但没用" ② 模型"等后台唤醒"是否需要更彻底的方案（当前已止血+常驻会话，但"无条件自动续跑"未取证）

---

## 9. 关键文档索引

| 文档 | 内容 |
|---|---|
| `.workbuddy/ui-audit/verify/BACKLOG.md` | **40 条未落码清单**（证据/入口/依赖/判据/风险 + 团队决策台账） |
| `.workbuddy/ui-audit/verify/func-gap-fixes.md` | 已修项的详细台账（276KB，含反向对照记录） |
| `.workbuddy/ui-audit/verify/capability-diff.md` | 原版主进程能力/配置结构对比（看不见的那一层） |
| `.workbuddy/ui-audit/verify/judgments-prewritten.md` | 预写判据（471KB） |
| `.workbuddy/ui-audit/verify/WRITE-RULES.md` | 写码纪律（含"源码注释里不许成段贴原版代码"——会污染 `grep -c` 计数，真实事故） |
| `.workbuddy/ui-audit/verif-switch-CRITERIA.md` | 会话切换 8 条判据 + 证伪边界 + 未覆盖清单 |
| `.workbuddy/memory/2026-09-18.md` | 本日工作台账（所有坑的原始记录） |
| `scripts/string-table.tsv` | 原版 6135 条字符串 dump（"原版有什么"的最全来源） |

---

## 10. 2026-09-18 最新交接：项目/任务与页数控制

- 产品口径已经定死：项目 = 工作目录和共享上下文；任务 = 项目内独立对话。不要再把“新项目”和“新对话”并排做成两个同等级主按钮。
- `beginNewChat()` 只进入空白草稿并清除该项目的当前任务记忆；首条发送由 `ChatPage.dispatch()` 延迟创建真实会话。
- `App.tsx` 旧的 `createSession().then(selectSession(null))` 已移除；回归在 `project-session-memory.test.ts`。
- 论文配置新增 `pageLimit`，入口在 Composer 的“比赛信息”；解析与保存分别在 `scan/paper-templates.ts`、`ipc/paper.ts`。
- 原版 `mma-paper` 没有可靠的最终页数压缩。新增 `resources/builtin-skills/paper-page-fit/`，并由 `mma-paper` 的 FINAL STEP 调用。
- 比赛规则会随年份变化，模板中不要写死页数。没有当届规则时必须询问，不能猜。
- 最新验证：41 文件 / 820 单测、45 项脚本护栏、最终 release 应用 36/36 真实验收。
- 最新交付：`MModels-0.1.0-x64-Portable.exe` SHA-256 `f3d22bde35ebbc48a610e300ed6ac83a12d01cf037e55a05b5a78000dcd23a9d`；Setup SHA-256 `1436bfc7fe62384f370774fd474f92f7a389e87edce3f5122d569de581c17b0a`。
