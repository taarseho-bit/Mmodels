/**
 * 技能显示名（2026-09-25 用户要求「改个名字」）。
 *
 * ⚠️ 斜杠命令名 = 目录名 = frontmatter name，被 mode-commands.test.ts 钉死，
 *    **不能**改目录 —— 改了整条命令链（模板/提示词/协作触发/测试）都会断。
 *    所以「改名」落在**显示层**：列表/菜单/详情里展示中文名，
 *    命令名（/mma-paper 等）作为辅助信息保留在副标题与 tooltip 里。
 */
export const SKILL_DISPLAY_NAMES: Record<string, string> = {
  'mma-paper': '论文写作',
  'mma-review': '论文评审',
  'mma-figure': '建模绘图',
  'data-search': '数据检索',
  'competition-audit': '交付审计',
  'method-selector': '方法选型',
  'doctor': '环境医生',
  'paper-search': '文献检索',
  'paper-review': '审稿评审',
  'problem-parser': '题意解析',
  'problem-classifier': '题型分类',
  'model-assumptions-builder': '假设清单',
  'symbol-table-builder': '符号表',
  'data-auditor-cleaner': '数据体检',
  'modeling-algorithms': '算法资源库',
  'python-model-code-generator': '求解代码生成',
  'robustness-checker': '稳健性检验',
  'paper-writing': '写作纪律',
  'paper-section-writer': '分章起草',
  'paper-polisher': '语言润色',
  'literature-search': '文献检索',
  'citation-management': '引用管理',
  'reference-manager': '参考文献',
  'figure-table-planner': '图表规划',
  'scientific-figure-making': '出版级图表',
  'academic-figures': '科研示意图',
  'nature-figure': '高级图表',
  'paper-diagram': '流程示意图',
  'mathmodel-figure-templates': '赛事图表模板',
  'table-layout-audit': '表格排版核验',
  'paper-page-fit': '页数核验',
  'proof-audit': '推导审计',
  'claim-evidence-audit': '论断-证据审计',
  'verifying-bibliography': '引用核真',
  'quality-assurance-auditor': '终审清单',
  'novelty-assessment': '查新',
  'metaheuristic-optimization': '智能优化算法',
  'deep-research': '深度调研',
  'related-paper-analyzer': '相关工作分析',
  'literature-review': '综述整理',
  'literature-positioning': '文献定位',
  'paper-sharing': '论文分享',
  'skill-creator': '技能创建器',
};

/** 显示名：有中文名的显示中文，没有的原样返回命令名 */
export function skillDisplayName(name: string): string {
  return SKILL_DISPLAY_NAMES[name] ?? name;
}
