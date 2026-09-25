/**
 * 数学建模图表参考目录。
 * 图片来自 Apache ECharts 官方示例，放在应用本地仅作选型参考；真正生成论文图表时，
 * 技能必须使用当前项目数据重新绘制，不能照搬示例数据。
 */
export interface GalleryTemplate {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  library: string;
  createdAt: string;
  diagramKey?: string;
  diagramTopic?: string;
  image: string;
}

const SOURCE = 'Apache ECharts 官方示例';
const DATE = '2026-09-25';
const item = (id: string, title: string, category: string, description: string, tags: string[]): GalleryTemplate => ({
  id: `echarts-${id}`, title, category, description, tags, library: SOURCE, createdAt: DATE, image: `echarts-${id}.png`,
});

export const GALLERY: GalleryTemplate[] = [
  item('area-basic', '指标变化面积图', '趋势与预测', '展示指标随时间的变化范围，适合需求量、库存量和环境指标。', ['趋势', '时间序列']),
  item('area-stack', '多因素累计趋势', '趋势与预测', '比较多个来源对总量变化的贡献，适合分区、分组和资源累计。', ['累计', '分组']),
  item('area-time-axis', '连续时间序列', '趋势与预测', '适合带时间轴的观测值、预测值和模型输出对照。', ['时间轴', '预测']),
  item('confidence-band', '预测区间与置信带', '趋势与预测', '同时展示预测曲线和不确定范围，适合模型结果的可信度表达。', ['置信区间', '预测']),
  item('line-aqi', '环境指标趋势', '趋势与预测', '展示空气质量、温度、降雨等环境变量的变化规律。', ['环境', '趋势']),
  item('line-log', '数量级变化曲线', '趋势与预测', '数据跨度很大时使用对数坐标，避免小量级变化被压扁。', ['对数坐标', '尺度']),
  item('line-markline', '关键节点趋势', '趋势与预测', '在趋势中标出阈值、峰值、政策节点或模型切换点。', ['阈值', '标记']),
  item('line-race', '方案排名变化', '趋势与预测', '观察各方案排名随时间变化，适合动态评价与竞赛结果对比。', ['排名', '动态']),
  item('line-smooth', '平滑变化曲线', '趋势与预测', '用于观测数据降噪、趋势拟合和多个模型输出的平滑比较。', ['平滑', '拟合']),
  item('line-step', '阶段性决策变化', '趋势与预测', '展示分阶段策略、离散控制量或阶梯式决策。', ['阶段', '决策']),
  item('line-stack', '多来源趋势叠加', '趋势与预测', '比较多个地区、方案或分组随时间变化，并观察总量贡献。', ['多组趋势', '对比']),
  item('multiple-x-axis', '多时间尺度对照', '趋势与预测', '将不同时间尺度或不同采样频率的结果放在同一张图中。', ['多轴', '尺度']),
  item('mix-line-bar', '趋势与数量联合图', '趋势与预测', '用柱状图呈现数量、折线呈现比例或趋势，适合综合指标汇报。', ['组合图', '对照']),
  item('bar-simple', '方案指标横向比较', '方案比较与排序', '用于不同方案、地区、模型结果的直观排序与比较。', ['排序', '方案']),
  item('bar-stack', '资源构成与贡献分解', '方案比较与排序', '展示总量由哪些因素构成，适合成本、资源和风险分解。', ['构成', '贡献']),
  item('bar-waterfall', '成本收益瀑布图', '方案比较与排序', '把增量收益、成本和最终结果串起来，突出每一步影响。', ['瀑布图', '成本']),
  item('bar-negative', '正负影响对照', '方案比较与排序', '同时展示促进因素和抑制因素，适合政策、风险和敏感性结果。', ['正负贡献', '影响']),
  item('bar-large', '大量对象快速排序', '方案比较与排序', '对象较多时快速查看最高、最低和长尾分布。', ['大样本', '排序']),
  item('bar-race', '动态方案竞赛', '方案比较与排序', '用动画展示方案排名变化，适合演示阶段性竞争结果。', ['排名', '动画']),
  item('bar-stack-normalization', '比例构成比较', '方案比较与排序', '把不同规模对象归一化后比较内部构成比例。', ['归一化', '比例']),
  item('bar-polar-stack', '环形资源分布', '方案比较与排序', '在极坐标中展示周期、方向或分区资源的构成。', ['极坐标', '资源']),
  item('bar-histogram', '样本频数直方图', '分布与误差', '查看样本集中区间、偏态和异常区间。', ['直方图', '分布']),
  item('bar-multi-drilldown', '分层指标下钻', '方案比较与排序', '从总体指标下钻到地区、方案或子任务，适合复杂项目汇报。', ['下钻', '分层']),
  item('bump-chart', '排名升降图', '方案比较与排序', '突出对象排名升降，比普通柱状图更容易看出名次变化。', ['排名', '变化']),
  item('pie-doughnut', '比例构成环图', '方案比较与排序', '展示指标构成比例，适合资源、成本、风险占比。', ['构成', '比例']),
  item('pie-nest', '多层构成环图', '方案比较与排序', '同时展示大类和子类构成，适合多级资源分解。', ['层级', '构成']),
  item('pie-roseType', '周期比例玫瑰图', '方案比较与排序', '强调不同类别的数量和比例差异，适合周期性或分区数据。', ['玫瑰图', '周期']),
  item('pie-simple', '类别占比图', '方案比较与排序', '展示少量类别的比例关系，适合结果摘要。', ['比例', '摘要']),
  item('radar', '多指标方案画像', '方案比较与排序', '同时比较准确率、成本、稳定性、效率等多个评价维度。', ['雷达图', '综合评价']),
  item('radar-aqi', '多维环境评价', '方案比较与排序', '从多个环境指标比较地区或方案的综合表现。', ['环境', '多指标']),
  item('radar-multiple', '多方案能力对照', '方案比较与排序', '在同一坐标系查看多个候选方案的优势和短板。', ['方案', '能力']),
  item('boxplot-light-velocity', '误差与稳健性箱线图', '分布与误差', '比较不同方案的分布、中位数和异常值，适合稳健性检验。', ['箱线图', '稳健性']),
  item('boxplot-multi', '多组误差分布', '分布与误差', '比较不同模型、地区或实验组的误差分布和离群点。', ['分布', '误差']),
  item('candlestick-simple', '区间波动图', '分布与误差', '展示每个阶段的开端、收尾、最高和最低值，适合波动性分析。', ['区间', '波动']),
  item('candlestick-sh', '连续区间走势', '分布与误差', '查看连续阶段的波动、极值和反转趋势。', ['走势', '极值']),
  item('custom-error-bar', '误差棒与不确定度', '分布与误差', '把均值与误差范围放在一起，适合实验和模型比较。', ['误差棒', '不确定度']),
  item('custom-error-scatter', '带误差散点', '分布与误差', '同时查看变量关系和观测误差，适合测量数据与回归检验。', ['散点', '误差']),
  item('scatter-simple', '变量关系与回归检验', '变量关系与聚类', '观察两个变量的关系、离群点和拟合趋势。', ['相关性', '回归']),
  item('scatter-aggregate-bar', '散点聚合比较', '变量关系与聚类', '将大量散点聚合成分组统计，兼顾细节和整体趋势。', ['聚合', '散点']),
  item('scatter-anscombe-quartet', '关系形态对照', '变量关系与聚类', '提醒使用者不能只看相关系数，还要检查真实分布形态。', ['相关性', '诊断']),
  item('scatter-aqi-color', '颜色编码散点', '变量关系与聚类', '用颜色或大小同时编码第三个指标，适合多变量关系探索。', ['多变量', '散点']),
  item('scatter-clustering', '样本聚类与分群', '变量关系与聚类', '按样本特征显示自然分组，辅助聚类模型与典型样本解释。', ['聚类', '样本']),
  item('scatter-exponential-regression', '指数关系拟合', '变量关系与聚类', '适合增长、衰减和扩散类问题的指数回归参考。', ['指数回归', '拟合']),
  item('scatter-linear-regression', '线性关系拟合', '变量关系与聚类', '用于线性回归、相关性分析和模型残差初查。', ['线性回归', '拟合']),
  item('scatter-logarithmic-regression', '对数关系拟合', '变量关系与聚类', '适合边际收益递减、尺度变化和对数关系建模。', ['对数回归', '拟合']),
  item('scatter-matrix', '变量散点矩阵', '相关性与矩阵', '一次查看多个变量之间的关系、分组和异常点。', ['散点矩阵', '多变量']),
  item('scatter-polynomial-regression', '非线性回归拟合', '变量关系与聚类', '适合具有弯曲趋势的变量关系和模型对比。', ['非线性', '回归']),
  item('heatmap-cartesian', '相关系数与敏感性矩阵', '相关性与矩阵', '用颜色深浅呈现变量之间的相关性或参数敏感性。', ['热力图', '敏感性']),
  item('heatmap-large', '大规模矩阵热力图', '相关性与矩阵', '适合大量变量、空间网格和密集关系数据。', ['大矩阵', '热力图']),
  item('heatmap-large-piecewise', '分段阈值热力图', '相关性与矩阵', '按照区间或阈值突出高风险、高相关和高敏感区域。', ['分段', '阈值']),
  item('matrix-correlation-heatmap', '相关矩阵总览', '相关性与矩阵', '集中展示多个变量的相关系数和正负关系。', ['相关矩阵', '变量']),
  item('matrix-correlation-scatter', '相关矩阵散点版', '相关性与矩阵', '同时保留矩阵关系和原始散点，方便核查相关性是否可靠。', ['相关矩阵', '散点']),
  item('matrix-covariance', '协方差矩阵', '相关性与矩阵', '展示变量共同变化的方向和程度，适合降维与风险分析。', ['协方差', '降维']),
  item('matrix-confusion', '分类结果混淆矩阵', '模型评价', '查看分类模型每一类的正确与误判情况。', ['混淆矩阵', '分类']),
  item('parallel-simple', '多指标约束与权衡', '多指标与路径', '在同一张图上查看多指标、约束条件和方案权衡关系。', ['平行坐标', '约束']),
  item('parallel-aqi', '多指标环境画像', '多指标与路径', '查看地区或方案在多个环境指标上的整体差异。', ['平行坐标', '环境']),
  item('parallel-nutrients', '资源指标平行比较', '多指标与路径', '对比多个对象的资源、营养或投入产出指标。', ['平行坐标', '资源']),
  item('sankey-energy', '能量与资源流向', '多指标与路径', '追踪资源、能量或任务在各环节之间的流向。', ['桑基图', '资源']),
  item('sankey-itemstyle', '过程分配流向', '多指标与路径', '把输入、处理中间环节和输出结果连成可解释的路径。', ['过程', '流向']),
  item('sankey-levels', '分层资源流向', '多指标与路径', '展示多级任务、部门或区域之间的资源分配。', ['分层', '流向']),
  item('sankey-simple', '方案输入输出流', '多指标与路径', '适合展示模型输入、决策分配和最终产出的逻辑链。', ['输入输出', '流向']),
  item('chord-simple', '群体相互影响', '网络与结构', '展示地区、部门或对象之间的相互作用和联系强度。', ['弦图', '关系']),
  item('graph-force', '网络关系与关键节点', '网络与结构', '展示节点、依赖关系和关键路径，适合网络模型。', ['网络', '节点']),
  item('graph-grid', '网格关系结构', '网络与结构', '用规则布局呈现对象之间的连接和分组关系。', ['网络', '结构']),
  item('graph-life-expectancy', '关系网络与指标', '网络与结构', '把网络关系和数值指标放在一起，适合复杂系统分析。', ['网络', '指标']),
  item('graph-npm', '依赖关系网络', '网络与结构', '展示模块、任务或指标之间的依赖关系。', ['依赖', '网络']),
  item('graph-simple', '简单关系网络', '网络与结构', '快速表达节点、边和关键连接，适合模型结构说明。', ['关系', '结构']),
  item('custom-gantt-flight', '任务时间排程图', '过程与排程', '展示任务开始、持续时间、资源占用和冲突。', ['甘特图', '排程']),
  item('custom-hexbin', '空间密度六边形', '空间与分布', '把大量空间点聚合成密度区域，适合位置和覆盖问题。', ['空间', '密度']),
  item('custom-polar-heatmap', '极坐标风险热图', '空间与分布', '展示方向、距离或周期维度下的强度变化。', ['极坐标', '风险']),
  item('calendar-heatmap', '日历热力图', '时间与空间', '查看每天的活动、需求、风险或误差强度。', ['日历', '热力图']),
  item('calendar-graph', '日历关系图', '时间与空间', '在日期维度上查看节点关系和事件密度。', ['日历', '网络']),
  item('calendar-simple', '周期任务日历', '时间与空间', '展示比赛周期、任务节点和关键日期。', ['周期', '任务']),
  item('gauge-simple', '指标完成度仪表', '模型评价', '用一个清晰的进度和阈值表达模型或任务完成程度。', ['仪表盘', '进度']),
  item('gauge-progress', '目标达成率', '模型评价', '适合交付检查、目标完成率和风险阈值展示。', ['完成度', '阈值']),
  item('sunburst-simple', '多层指标分解', '层级与结构', '展示总体指标由多级因素构成的层次结构。', ['旭日图', '层级']),
  item('sunburst-visualMap', '层级权重分布', '层级与结构', '用颜色和面积同时表达层级、权重和贡献。', ['旭日图', '权重']),
  item('tree-basic', '模型变量树', '层级与结构', '展示问题、变量、子模型和结论之间的层级关系。', ['树图', '变量']),
  item('tree-polyline', '研究任务树', '层级与结构', '把总任务拆成数据、模型、验证和论文交付分支。', ['树图', '任务']),
  item('tree-radial', '环形层级结构', '层级与结构', '适合展示复杂系统中的层级、模块和影响范围。', ['树图', '层级']),
  item('treemap-simple', '资源层级矩形图', '层级与结构', '按面积查看资源、成本、样本或工作量构成。', ['矩形树图', '资源']),
  item('treemap-visual', '层级权重热度图', '层级与结构', '同时比较层级结构和每个节点的权重、风险或贡献。', ['矩形树图', '权重']),
  item('themeRiver-basic', '主题随时间变化', '趋势与预测', '展示多个主题、因素或风险随时间的变化和交替。', ['主题河流', '时间']),
];

export const MATHMODEL_GALLERY_IDS = new Set(GALLERY.map((entry) => entry.id));
export const MATHMODEL_GALLERY = GALLERY;
export const GALLERY_CATEGORIES = Array.from(new Set(GALLERY.map((entry) => entry.category)));
export const DIAGRAM_THEMES: Array<'mono' | 'color'> = ['mono', 'color'];
export const DEFAULT_DIAGRAM_THEME: 'mono' | 'color' = 'mono';

export function galleryPrompt(title: string): string {
  return `/mathmodel-figure-templates 在 LaTeX sandbox 中绘制「${title}」。请根据当前数学建模题目的真实数据选择变量、坐标和标注，不要照搬示例数据，保证图例、标题、刻度和注释使用简体中文，避免遮挡，输出 PNG/PDF/SVG，并返回脚本和图片路径。`;
}

export function paperDiagramPrompt(templateKey: string, topic: string, theme: 'mono' | 'color' = DEFAULT_DIAGRAM_THEME): string {
  const themeName = theme === 'mono' ? '灰白论文版' : '彩色演示版';
  return `/paper-diagram 套用内置模板「${templateKey}」绘制本题的${topic}。采用「${themeName}」主题，使用当前题目真实材料，所有节点、图例和说明使用简体中文，避免文字重叠，导出可编辑 .drawio 与 PNG/PDF。`;
}

export function templatePrompt(item: GalleryTemplate, theme: 'mono' | 'color' = DEFAULT_DIAGRAM_THEME): string {
  if (item.diagramKey && item.diagramTopic) return paperDiagramPrompt(item.diagramKey, item.diagramTopic, theme);
  return galleryPrompt(item.title);
}
