---
name: paper-diagram
description: 制作与修改可编辑的 draw.io / diagrams.net 数学建模示意图（.drawio XML），产出 .drawio + PNG/PDF。优先使用问题求解流程、模型结构、优化决策和验证闭环；也支持从零创建算法流程和实验结构图。画折线图、热图等数据图表请改用科学绘图技能。
---

# 论文与研究示意图（draw.io）

主产物是**可编辑的 .drawio**，PNG/PDF 是附带导出。模板、手写、校验、预览和导出全在本目录内。

## 先判断走哪条路

| 情况 | 路径 | 入口 |
|---|---|---|
| 全文脉络、研究框架、执行流程，或课题的任务分解 | **A 套模板** | 下方模板索引 |
| 其他示意图：算法流程、模型架构、实验设计、机制示意… | **B 从零手写 XML** | `references/authoring.md` |

模板和手写图使用同一套 XML 约定，产物可以继续编辑和复用。

## A. 套模板

| 模板 id | 版式 | 适合表达 | 说明 |
|---|---|---|---|
| `problem-flow` | 1400×900，两行主流程 + 一条回修虚线 | 题目/数据 → 假设 → 模型 → 求解 → 检验 → 结论 | `assets/problem-flow/example.json` |
| `model-architecture` | 1400×900，中间变量流 + 上方假设 + 下方检验 | 输入如何进入变量、目标、约束和模型输出 | `assets/model-architecture/example.json` |
| `optimization-decision` | 1400×900，场景到方案的决策链 + 敏感性反馈 | 优化题的目标、约束、求解、方案比较和取舍 | `assets/optimization-decision/example.json` |
| `validation-loop` | 1400×900，验证主环 + 失败回到模型的虚线 | 基线、运行、误差、稳健性、证据闭环 | `assets/validation-loop/example.json` |

历史版本 `roadmap-*`、`framework-3col`、`stageflow-3col`、`taskflow-land` 脚本仍可读取历史项目，但不再作为新任务的首选模板。它们偏“项目路线/汇报总览”，不应该替代论文中的问题求解逻辑图。

1. 读模板说明的两节：**语义约定**（哪些槽位并列、哪些汇流、哪两组必须可对比）与**字数预算**。语义放错比字数超框严重。
2. 从用户材料抽内容，**不要编**；有源文件（`.tex`/`.md`/代码）时逐个核对数值，术语用原文。
3. 复制 `assets/<template_id>/example.json` 改写，`"\n"` 手动断行。
4. 渲染（写文件前逐槽校验字数，超框报出具体预算）：

```bash
python3 scripts/modeling_flow.py assets/problem-flow/example.json -o out.drawio
python3 scripts/modeling_flow.py assets/model-architecture/example.json -o out.drawio
python3 scripts/modeling_flow.py assets/optimization-decision/example.json -o out.drawio
python3 scripts/modeling_flow.py assets/validation-loop/example.json -o out.drawio
```

五个模板默认输出灰白论文版；需要原彩色演示风格时统一加 `--theme color`。

新增模板见 `references/adding-templates.md`。

## B. 从零手写 XML

读 `references/authoring.md`：骨架、样式速查、中文字宽预算、连接器写法、四个必踩的坑。图标与特殊图元见 `references/icons.md`。

三条最容易翻车的：

- **先排栅格再写图元**：定死画布、列基线、步距；同族同宽同步距，数量可变的组用等分公式。
- **中文手动断行**：全角≈字号、半角≈字号/2、行高≈字号+3；16px 字号下 160px 宽的盒子每行最多 9 个汉字。竖排逐字 `&lt;br&gt;` 堆叠，**不要用 `horizontal=0`**（中文会躺倒）。
- **连接器端点离盒边 1px**；一分多/多合一画成"竖线+横母线+分支"，不要画成 N 条独立斜线。

画之前想清楚每根箭头的语义（谁到谁、单向还是双向、扇入还是扇出）；说不出含义的箭头不要画。

## 通用：校验、预览、导出

```bash
python3 scripts/check_layout.py fig.drawio      # 溢出/越界/重复 id/重叠/穿盒/位图（--strict 作门禁）
python3 scripts/export_figure.py fig.drawio     # 1:1 PNG + 矢量 PDF（需 drawio 命令行）
python3 scripts/preview_html.py fig.drawio      # 浏览器预览，无需 drawio 命令行
```

`check_layout` 用中文字宽模型、噪声低，正常的图应当 **FAIL 0 / WARN 0**；报警就值得认真看。它刻意不查紧密堆叠的行列间距和同族尺寸对齐（前者是刻意排版，后者机器判族必然误报）——这两项交给眼睛。规则详解与四个规避手法见 `references/preflight-rules.md`。

**不看渲染图不算画完**：XML 里看不出文字溢出、箭头压字、盒子挤扁。打开 PNG 至少过两轮：① 文字溢出/压线；② 箭头方向与语义；③ 同族元素对齐同宽；④ 数值有没有抄错。完整的九区盘点与交付清单见 `references/self-check.md`。

交付 `.drawio` + PNG/PDF；走模板路径时保留 content JSON 作为可复现源。尺寸提醒：954px 宽、16px 字号的图压到 A4 正文 `0.97\textwidth` 约 6.5pt，建议整页横排或答辩使用，正文小图另做精简版。

## 参考索引

| 文件 | 何时读 |
|---|---|
| `scripts/modeling_flow.py` | 新建数学建模问题流程、模型结构、优化决策或验证闭环图 |
| `references/modeling-flow.md` | 四种版式的选择、箭头语义和证据对应要求 |
| `assets/problem-flow/example.json` | 题目 → 数据 → 假设 → 模型 → 求解 → 检验 → 结论 |
| `assets/model-architecture/example.json` | 输入、变量、目标、约束、输出和检验的模型结构 |
| `assets/optimization-decision/example.json` | 优化题的方案生成、比较和敏感性反馈 |
| `assets/validation-loop/example.json` | 基线、运行、误差、稳健性和结论的验证闭环 |
| `authoring.md` | 手写示意图：骨架、样式串、字宽预算、连接器 |
| `icons.md` | 需要图标、旗标、块箭头、弯箭头等特殊图元 |
| `roadmap-5band.md` | 用五带路线图模板 |
| `roadmap-3phase.md` | 用三阶段问题驱动路线图模板 |
| `framework-3col.md` | 用三栏研究框架模板（内容全景）|
| `stageflow-3col.md` | 用三栏阶段流程模板（执行流程）|
| `taskflow-land.md` | 用横版任务流水线模板 |
| `adding-templates.md` | 新增一个模板 |
| `self-check.md` | 九区盘点、红队复审、自评分卡、交付清单 |
| `preflight-rules.md` | 静态检查在查什么、误报如何绕开 |

## 不适用

- 折线图、热图、统计图等**数据图表** → 用绘图类技能；
- 需要 LaTeX 排版的公式推导链 → 用 TikZ 或写进正文。
