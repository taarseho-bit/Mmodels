---
name: draw-figures
description: 数学建模论文配图的统一入口。用户提出数据可视化、问题求解流程、模型结构、验证闭环或图表排版需求时使用。本 skill 只负责选型和质量门槛，具体绘制交给对应的建模绘图技能。
---

# 论文配图路由

先判断要画的是哪一类图，再调用对应技能完成；不要把装饰性科研图片当成建模证据图。
一次请求里混有多类图时，逐类分派，最后统一汇总产物清单。

## 1. 分类与分派

| 需求特征 | 分派到 | 触发方式 |
|---|---|---|
| 折线 / 柱状 / 散点 / 热力图 / 小提琴 / ROC / SHAP 等**由数据生成**的图表 | `scientific-figure-making` | 默认使用 Python；先根据数据形态选择图表，再按项目统一风格绘制 |
| 用户点名某个**建模图表模板**或要从图库选择风格 | `mathmodel-figure-templates` | 先在其图表目录匹配模板，再用当前项目真实数据渲染 |
| 问题求解流程图 / 研究框架图 / 算法流程图 / 模型架构图 / 验证闭环图 | `paper-diagram` | 优先使用 problem-flow、model-architecture、optimization-decision、validation-loop，产出可编辑 `.drawio` + PNG |
| 物理/几何示意图（受力、光路、坐标系） | 直接用 TikZ 写进 LaTeX | 不走上面三个 skill |

拿不准归哪类时按"图是不是由一组数值算出来的"判断：是 → 数据图表；否 → 示意图。

## 2. 产物约定（所有分支都遵守）

- 图片保存到当前项目根下的 `figures/`（不存在就创建），文件名用英文小写加下划线，如 `figures/sensitivity_tornado.png`。
- 同时保留脚本或源文件：Python 脚本放 `figures/scripts/`，draw.io 源文件与 PNG 同名放 `figures/`。
- 中文字体用 SimSun，DPI ≥ 300；同一批图共用一套配色与字号。
- 项目里存在 `document.tex` 时，每张图附一段可直接粘贴的插图片段，并给出建议插入的章节：

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.8\textwidth]{figures/sensitivity_tornado.png}
  \caption{灵敏度分析龙卷风图}
  \label{fig:sensitivity-tornado}
\end{figure}
```

- `\caption{}` 只写一句 ≤20 字的图题；"图说明了什么、能得出什么结论"写成正文段落，不塞进图注。
- 只画图、不改动用户已有的数据、模型与结论。

## 3. 收尾

用一张表汇总：图名 → 文件路径 → 生成方式（哪个 skill / 脚本）→ 建议插入位置。
某个 skill 未启用或运行环境缺失（如没有 Python 绘图库）时，如实说明，并给出退路：
数据图表退回 seaborn/matplotlib 自绘，示意图退回手写 draw.io XML。

## 选型先行

- **开工宣言**：先列「要画哪几张图、各自支撑正文哪个结论」，经确认后逐张绘制。
- **数据类型选型**：按数据形态挑图——时序用趋势/置信带、多指标用雷达/平行坐标、流向用桑基、层级用树/旭日；参考应用内图表目录的十类范式。
- **真实数据**：只用当前项目数据重绘，示例数据仅作样式参考；坐标、图例、标注全部简体中文。
- **统一风格**：同篇论文的图共享配色、字号与线宽；输出到 figures/ 并附 LaTeX 插图片段。
