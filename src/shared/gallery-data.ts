/** 数学建模图表参考目录：本地预览来自 Apache ECharts 官方示例。 */

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

export const GALLERY: GalleryTemplate[] = [
  { id: 'echarts-line-simple', title: '单指标趋势与预测', description: '适合展示时间序列、误差变化、需求量或气象指标的趋势。', category: '趋势与预测', tags: ['时间序列', '趋势', '预测'], library: SOURCE, createdAt: DATE, image: 'echarts-line-simple.png' },
  { id: 'echarts-line-stack', title: '多来源趋势叠加', description: '比较多个地区、方案或分组随时间的变化，并观察总量贡献。', category: '趋势与预测', tags: ['多组趋势', '累计', '对比'], library: SOURCE, createdAt: DATE, image: 'echarts-line-stack.png' },
  { id: 'echarts-bar-simple', title: '方案指标横向比较', description: '用于不同方案、地区、模型结果的直观排序与对比。', category: '方案比较与排序', tags: ['方案比较', '排序', '指标'], library: SOURCE, createdAt: DATE, image: 'echarts-bar-simple.png' },
  { id: 'echarts-bar-stack', title: '资源构成与贡献分解', description: '展示总量由哪些因素构成，适合成本、资源、风险分解。', category: '方案比较与排序', tags: ['构成', '贡献', '资源配置'], library: SOURCE, createdAt: DATE, image: 'echarts-bar-stack.png' },
  { id: 'echarts-radar', title: '多指标方案画像', description: '同时比较准确率、成本、稳定性、效率等多个评价维度。', category: '方案比较与排序', tags: ['综合评价', '多指标', '雷达图'], library: SOURCE, createdAt: DATE, image: 'echarts-radar.png' },
  { id: 'echarts-scatter-simple', title: '变量关系与回归检验', description: '观察两个变量的关系、离群点和拟合趋势，适合相关性分析。', category: '变量关系与聚类', tags: ['相关性', '回归', '离群点'], library: SOURCE, createdAt: DATE, image: 'echarts-scatter-simple.png' },
  { id: 'echarts-scatter-clustering', title: '样本聚类与分群', description: '按样本特征显示自然分组，辅助聚类模型与典型样本解释。', category: '变量关系与聚类', tags: ['聚类', '样本', '分群'], library: SOURCE, createdAt: DATE, image: 'echarts-scatter-clustering.png' },
  { id: 'echarts-boxplot', title: '误差与方案稳健性', description: '比较不同方案的分布、中位数和异常值，适合稳健性检验。', category: '分布与稳健性', tags: ['箱线图', '误差', '稳健性'], library: SOURCE, createdAt: DATE, image: 'echarts-boxplot-light-velocity.png' },
  { id: 'echarts-heatmap', title: '相关系数与敏感性矩阵', description: '用颜色深浅呈现变量之间的相关性或参数敏感性。', category: '相关性与矩阵', tags: ['热力图', '相关矩阵', '敏感性'], library: SOURCE, createdAt: DATE, image: 'echarts-heatmap-cartesian.png' },
  { id: 'echarts-parallel', title: '多指标约束与权衡', description: '在同一张图上查看多指标、约束条件和方案权衡关系。', category: '多指标与路径', tags: ['平行坐标', '约束', '权衡'], library: SOURCE, createdAt: DATE, image: 'echarts-parallel-simple.png' },
  { id: 'echarts-sankey', title: '资源流向与过程分配', description: '追踪资源、人口、能量或任务在各环节之间的流向。', category: '多指标与路径', tags: ['桑基图', '流向', '过程'], library: SOURCE, createdAt: DATE, image: 'echarts-sankey-simple.png' },
  { id: 'echarts-graph', title: '网络关系与影响路径', description: '呈现节点、依赖关系和关键路径，适合网络模型与协同关系。', category: '网络与结构', tags: ['网络', '关系', '路径'], library: SOURCE, createdAt: DATE, image: 'echarts-graph-simple.png' },
];

export const MATHMODEL_GALLERY_IDS = new Set(GALLERY.map((item) => item.id));
export const MATHMODEL_GALLERY = GALLERY;
export const GALLERY_CATEGORIES: string[] = ['趋势与预测', '方案比较与排序', '变量关系与聚类', '分布与稳健性', '相关性与矩阵', '多指标与路径', '网络与结构'];
export const DIAGRAM_THEMES: Array<'mono' | 'color'> = ['mono', 'color'];
export const DEFAULT_DIAGRAM_THEME: 'mono' | 'color' = 'mono';

export function galleryPrompt(title: string): string {
  return `/mathmodel-figure-templates 在 LaTeX sandbox 中复刻「${title}」。请根据当前数学建模题目的真实数据选择合适的变量与坐标，不要照搬示例数据，输出 PNG/PDF/SVG，并返回脚本和图片路径。`;
}

export function paperDiagramPrompt(templateKey: string, topic: string, theme: 'mono' | 'color' = DEFAULT_DIAGRAM_THEME): string {
  const themeName = theme === 'mono' ? '灰白论文版' : '彩色演示版';
  return `/paper-diagram 套用内置模板「${templateKey}」绘制本题的${topic}。采用「${themeName}」主题，从当前题目与已完成的建模内容中提取真实材料填写模板，渲染出可编辑 .drawio，再校验布局并导出 PNG/PDF。`;
}

export function templatePrompt(item: GalleryTemplate, theme: 'mono' | 'color' = DEFAULT_DIAGRAM_THEME): string {
  if (item.diagramKey && item.diagramTopic) return paperDiagramPrompt(item.diagramKey, item.diagramTopic, theme);
  return galleryPrompt(item.title);
}
