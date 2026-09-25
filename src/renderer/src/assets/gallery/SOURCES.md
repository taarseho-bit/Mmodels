# 本地图表参考来源

本目录 PNG / SVG 仅用于数学建模图表选型与界面预览，实际生成时必须使用当前项目数据重新绘制。

## 1. Apache ECharts 官方示例（`echarts-*.png`，80 张）

示例代码与图表项目遵循 Apache 2.0 许可：

- 示例页：https://echarts.apache.org/examples/en/index.html
- 统一来源目录：https://echarts.apache.org/examples/data/thumb/
- 文件名与本地 `echarts-*.png` 一一对应。

## 2. Matplotlib 官方 Gallery（`mpl-*.png`，62 张）

Matplotlib 官方文档 gallery 缩略图（Matplotlib license，PSF 系开源许可）：

- 图库首页：https://matplotlib.org/stable/gallery/index.html
- 图片规则：`https://matplotlib.org/stable/_images/sphx_glr_<示例名>_thumb.png`
- 本地 `mpl-<示例名>.png` 与 `<示例名>` 一一对应。
- 覆盖：分布与直方、箱线/小提琴、散点与拟合、置信椭圆、误差带、堆叠与构成、等高线与优化路径、向量场/流线、三维曲面、频谱、对数坐标、桑基等。

## 3. Graphviz 官方 Gallery（`gv-*.png`，12 张，由官方 SVG 栅格化）

Graphviz 官网 Gallery 的经典成图（gallery 页面明确供参考引用）：

- 图库首页：https://graphviz.org/gallery/
- 本地 `gv-<语义名>.png`（720px 宽白底位图，规避 SVG 缩略图跨主题渲染问题），覆盖：过程流程、算法流程（遗传算法）、状态机、分支决策、
  分层架构、神经网络结构、ER 实体关系、网络拓扑、聚类层级、谱系树等。
- 用途：**建模技术路线图与流程图的成型参考** —— 论文里的"技术路线图"可直接对照这些范式让 Agent 用 /paper-diagram 复刻。

## 分类口径

按数学建模工作流分为十类：建模流程图 / 数据探索与分布 / 变量关系与拟合 / 相关与矩阵 /
趋势与预测 / 比较与构成 / 综合评价与决策 / 网络与资源流向 / 等高线场与三维 / 层级与分解。
每项另标注适配的数据类型（单变量分布、时间序列、两变量关系、组成占比……），
界面里可以按"手里是什么数据"反向筛图。
