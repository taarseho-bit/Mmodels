#!/usr/bin/env node
/**
 * 从 .tmp-skills-src（git clone 的源仓库）搬运精选技能到 resources/builtin-skills/。
 *
 * 处理内容：
 *   1. 按清单整目录复制（过滤 .git/.github 等杂物）
 *   2. 生成 modeling-algorithms（算法资源库路由技能，源：XiaoMaColtAI/math-modeling-skill assets）
 *   3. 英文描述替换为中文双语描述（提升 UI 可读性与模型触发命中率）
 *   4. LICENSE 随技能搬运；无 LICENSE 的源仓库写 ATTRIBUTION.md 署名
 *   5. 全量自校验：SKILL.md 存在、frontmatter 可解析、name 与目录名一致、description 非空
 *
 * 源仓库（2026-09-20 浅克隆）：
 *   Haojae/scipilot-figure-skill, williamli-15/figures4papers, sai-tv/academic-figures,
 *   zhnnky329/MathModeling-skills, anthropics/skills, Liuyuan999/claude-skill-paper-writing,
 *   lingzhi227/agent-research-skills, chgagne/claude-skills-research, XiaoMaColtAI/math-modeling-skill
 */
const fs = require('node:fs');
const path = require('node:path');

const SRC = 'D:/mathmodel-desktop/.tmp-skills-src';
const DST = 'D:/mathmodel-desktop/resources/builtin-skills';

const JUNK = new Set(['.git', '.github', '.gitignore', '.gitattributes', 'node_modules', '.DS_Store', 'Thumbs.db']);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (JUNK.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** 覆写 frontmatter 里的 description（含 >- 多行块形态） */
function replaceDescription(skillDir, newDesc) {
  const mdPath = path.join(skillDir, 'SKILL.md');
  let raw = fs.readFileSync(mdPath, 'utf8');
  if (!raw.startsWith('---')) return false;
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return false;
  const head = raw.slice(0, end + 1); // 含首个 --- 与末尾换行
  const tail = raw.slice(end + 1);
  const lines = head.split(/\r?\n/);
  const out = [];
  let i = 0;
  let replaced = false;
  for (; i < lines.length; i++) {
    if (replaced) { out.push(lines[i]); continue; }
    const m = /^description\s*:/.exec(lines[i]);
    if (!m) { out.push(lines[i]); continue; }
    // 跳过原 description 块（多行块=缩进行；或同行标量）
    const isBlock = /^\s*description\s*:\s*(>|>-|\|).*$/.test(lines[i]);
    let j = i + 1;
    if (isBlock) {
      while (j < lines.length && (lines[j] === '' || /^\s/.test(lines[j]))) j++;
    }
    out.push(`description: "${newDesc.replace(/"/g, "'")}"`);
    replaced = true;
    i = j - 1;
  }
  if (!replaced) out.splice(1, 0, `description: "${newDesc.replace(/"/g, "'")}"`);
  // out 末尾保证恰好一个换行：description 若是 frontmatter 最后一个字段，
  // 多行块消费会把结尾空行吃掉，直接拼 tail('---...') 会粘行（2026-09-20 实测踩坑）
  let joined = out.join('\n');
  if (!joined.endsWith('\n')) joined += '\n';
  fs.writeFileSync(mdPath, joined + tail, 'utf8');
  return true;
}

/** 把 frontmatter 的 name 改为目录名（保持目录名=技能名约定） */
function fixName(skillDir) {
  const dirName = path.basename(skillDir);
  const mdPath = path.join(skillDir, 'SKILL.md');
  let raw = fs.readFileSync(mdPath, 'utf8');
  const headEnd = raw.indexOf('\n---', 3);
  if (headEnd < 0) return;
  const head = raw.slice(0, headEnd);
  const tail = raw.slice(headEnd);
  const fixed = head.replace(/^name\s*:.*$/m, `name: ${dirName}`);
  fs.writeFileSync(mdPath, fixed + tail, 'utf8');
}

function writeAttribution(skillDir, repoUrl, note) {
  const content = [
    '# 来源署名',
    '',
    `本技能内容整理自：${repoUrl}`,
    '检索日期：2026-09-20（git clone --depth 1）。',
    note || '版权归原作者所有，感谢原作者的开源贡献；如需移除请联系维护者。',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(skillDir, 'ATTRIBUTION.md'), content, 'utf8');
}

function findLicense(repoDir) {
  for (const name of fs.readdirSync(repoDir)) {
    if (/^(LICENSE|LICENCE|COPYING)(\.\w+)?$/i.test(name)) return path.join(repoDir, name);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// 复制清单：{ dst 目录名: 源路径 }
// ─────────────────────────────────────────────────────────────
const COPIES = {
  // 保留面向数据证据的绘图技能；泛科研示意图已从数学建模入口下线
  'scipilot-figure-skill': `${SRC}/scipilot-figure-skill`,
  'scientific-figure-making': `${SRC}/figures4papers/scientific-figure-making`,
  // 官方 PDF 技能（用户点名 PDF 读取）
  'pdf': `${SRC}/skills/skills/pdf`,
  // zhnnky329 数模工作流（精选 16 个）
  'problem-parser': `${SRC}/MathModeling-skills/.claude/skills/problem-parser`,
  'problem-classifier': `${SRC}/MathModeling-skills/.claude/skills/problem-classifier`,
  'method-selector': `${SRC}/MathModeling-skills/.claude/skills/method-selector`,
  'data-auditor-cleaner': `${SRC}/MathModeling-skills/.claude/skills/data-auditor-cleaner`,
  'model-assumptions-builder': `${SRC}/MathModeling-skills/.claude/skills/model-assumptions-builder`,
  'symbol-table-builder': `${SRC}/MathModeling-skills/.claude/skills/symbol-table-builder`,
  'robustness-checker': `${SRC}/MathModeling-skills/.claude/skills/robustness-checker`,
  'figure-table-planner': `${SRC}/MathModeling-skills/.claude/skills/figure-table-planner`,
  'paper-section-writer': `${SRC}/MathModeling-skills/.claude/skills/paper-section-writer`,
  'quality-assurance-auditor': `${SRC}/MathModeling-skills/.claude/skills/quality-assurance-auditor`,
  'decision-prompt-builder': `${SRC}/MathModeling-skills/.claude/skills/decision-prompt-builder`,
  'modeler-decision-logger': `${SRC}/MathModeling-skills/.claude/skills/modeler-decision-logger`,
  'reference-manager': `${SRC}/MathModeling-skills/.claude/skills/reference-manager`,
  'related-paper-analyzer': `${SRC}/MathModeling-skills/.claude/skills/related-paper-analyzer`,
  'paper-polisher': `${SRC}/MathModeling-skills/.claude/skills/paper-polisher`,
  'python-model-code-generator': `${SRC}/MathModeling-skills/.claude/skills/python-model-code-generator`,
  // 学术写作纪律（Liuyuan999 全家 7 个）
  'paper-writing': `${SRC}/claude-skill-paper-writing/skills/paper-writing`,
  'paper-review': `${SRC}/claude-skill-paper-writing/skills/paper-review`,
  'proof-audit': `${SRC}/claude-skill-paper-writing/skills/proof-audit`,
  'claim-evidence-audit': `${SRC}/claude-skill-paper-writing/skills/claim-evidence-audit`,
  'literature-positioning': `${SRC}/claude-skill-paper-writing/skills/literature-positioning`,
  'experiment-audit': `${SRC}/claude-skill-paper-writing/skills/experiment-audit`,
  'latex-paper-audit': `${SRC}/claude-skill-paper-writing/skills/latex-paper-audit`,
  // 文献查阅 / 调研（lingzhi227）
  'literature-search': `${SRC}/agent-research-skills/skills/literature-search`,
  'deep-research': `${SRC}/agent-research-skills/skills/deep-research`,
  'literature-review': `${SRC}/agent-research-skills/skills/literature-review`,
  'citation-management': `${SRC}/agent-research-skills/skills/citation-management`,
  'novelty-assessment': `${SRC}/agent-research-skills/skills/novelty-assessment`,
  // 引用真实性核验（chgagne）
  'verifying-bibliography': `${SRC}/claude-skills-research/verifying-bibliography`,
};

// 每个技能对应的源仓库根目录（用于找 LICENSE / 写署名）
const REPO_OF = {
  'scipilot-figure-skill': [`${SRC}/scipilot-figure-skill`, 'https://github.com/Haojae/scipilot-figure-skill'],
  'scientific-figure-making': [`${SRC}/figures4papers`, 'https://github.com/williamli-15/figures4papers（scientific-figure-making 子目录）'],
  'pdf': [`${SRC}/skills`, 'https://github.com/anthropics/skills（skills/pdf）'],
  'verifying-bibliography': [`${SRC}/claude-skills-research`, 'https://github.com/chgagne/claude-skills-research（verifying-bibliography）'],
};

function repoOf(dstName) {
  if (REPO_OF[dstName]) return REPO_OF[dstName];
  if (COPIES[dstName].includes('MathModeling-skills')) return [`${SRC}/MathModeling-skills`, 'https://github.com/zhnnky329/MathModeling-skills'];
  if (COPIES[dstName].includes('claude-skill-paper-writing')) return [`${SRC}/claude-skill-paper-writing`, 'https://github.com/Liuyuan999/claude-skill-paper-writing'];
  if (COPIES[dstName].includes('agent-research-skills')) return [`${SRC}/agent-research-skills`, 'https://github.com/lingzhi227/agent-research-skills'];
  return null;
}

// 中文双语描述（全量替换 frontmatter description）
const DESCRIPTIONS = {
  'pdf': '读取、解析、生成与修复 PDF：文本和表格抽取、扫描件 OCR、表单填写、拆分合并、加水印、页数统计。任务涉及 PDF 附件阅读、论文 PDF 解析、pdftotext、pypdf 等时使用。',
  'scientific-figure-making': '为学术论文/报告制作出版级 matplotlib 数据图：分组柱状、趋势线、热力图、多面板组合，PDF/SVG 矢量与高 DPI 导出，统一字体、配色与图例风格。写论文配图时使用；不做交互式仪表盘与纯探索性画图。',
  'problem-parser': '通读数模竞赛题目，抽取目标、对象、约束、数据、要求输出与子问题清单，产出结构化题意解析。解题第一步使用，防止答非所问。',
  'problem-classifier': '把每个子问题归类为评价、预测、优化、分类聚类、机理模拟等题型并标注依赖关系，为模型选择铺路。',
  'method-selector': '为每个子问题筛选小而可靠的方法组合：一个主候选模型、一个可用基线、至多一个带触发条件的备选，并做数据假设、退化、敏感性与规模风险预检。模型选择必用；先完成题意解析与数据画像，再生成方法卡与风险探针摘要。',
  'data-auditor-cleaner': '审计数据集：字段口径、缺失、异常、不平衡、基数与分布，产出清洗后的数据副本与数据报告；不修改原始数据。',
  'model-assumptions-builder': '把建模假设逐条列明：来源、依据、影响范围与失效信号，产出假设清单供求解与核验引用。',
  'symbol-table-builder': '统一全篇符号表：变量、参数、下标、单位的定义与出处，避免论文与代码符号不一致。',
  'robustness-checker': '对已求解结果做灵敏度分析、误差检查与基线对比，验证结论稳健性；没有基线与灵敏度证据不得声称模型更优。',
  'figure-table-planner': '规划论文真正需要的图表清单：每张图/表支撑哪条结论、放在哪、展示什么，避免堆图与图文脱节。',
  'paper-section-writer': '只用已存在的结果与验证过的产物撰写论文章节草稿，数值必须有据可查，不编造结论。',
  'quality-assurance-auditor': '提交前终审：查前后不一致、缺失证据、无支撑论断与失效引用，产出按严重程度排序的问题清单。',
  'decision-prompt-builder': '在方法选择前生成决策问题清单：向用户询问的是权衡取舍而非算法名词，答案进入决策台账。',
  'modeler-decision-logger': '把用户的关键建模决策追加记录到决策台账（jsonl），保证选型与方案变化全程可追溯。',
  'reference-manager': '管理参考文献：检索、去重、格式化、与正文引用一致性核对。',
  'related-paper-analyzer': '分析相关论文与题目的方法谱系，提炼可借鉴思路、适用条件与常见坑。',
  'paper-polisher': '对已成稿论文章节做语言润色与学术风格统一，不改变技术内容与数值结论。',
  'python-model-code-generator': '按已确认的方法计划生成模块化 Python 求解代码：数据读取、预处理、模型、验证、输出分层，参数与随机种子可复现。',
  'paper-writing': '学术论文字级写作纪律：章节结构、段落论证、学术措辞与句式规范，用于提升论文写作质量。',
  'paper-review': '以审稿人视角评审论文：贡献、方法、实验、写作四个维度打分并给出可执行的修改意见。',
  'proof-audit': '逐条审计论文中的证明与推导：每一步依据是否充分、结论是否真正成立。',
  'claim-evidence-audit': '审计论断与证据的对应关系：每个 claim 是否有支撑、表述强度是否与证据匹配，清除过度声明。',
  'literature-positioning': '基于文献梳理研究定位：相关工作对比、差异点与创新点表述，撰写引言与相关工作章时使用。',
  'experiment-audit': '审计实验设置与结果完整性：基线、消融、统计显著性、可复现性是否齐备。',
  'latex-paper-audit': '审计 LaTeX 论文工程：编译问题、引用完整性、图表规范与格式合规。',
  'literature-search': '多库文献检索：Semantic Scholar、arXiv、OpenAlex、CrossRef 组合检索、筛选与元数据核验，产出带真实来源的文献清单。查文献、找参考、综述前置检索时使用。',
  'deep-research': '对开放性研究问题做多轮深度调研：拆解子问题、多源检索、交叉验证、综合成带引用的研究报告。',
  'literature-review': '把检索到的文献综合成结构化综述：分类梳理、演进脉络、方法对比与研究空白。',
  'citation-management': '管理引用：BibTeX 生成与清洗、引用格式统一（APA/IEEE/GB）、文中引用与参考文献表一致性核对。',
  'novelty-assessment': '评估想法与方法的新颖性：与已知工作逐维对比，判断增量贡献，避免重复造轮子。',
  'verifying-bibliography': '核验参考文献真实性：逐条检查 .bib 与文末列表中的条目是否真实存在、题录字段是否正确，专抓编造引用。',
};

// ─────────────────────────────────────────────────────────────
// 执行
// ─────────────────────────────────────────────────────────────
const report = { copied: [], descReplaced: 0, nameFixed: [], attribution: 0, license: 0, errors: [] };

for (const [name, src] of Object.entries(COPIES)) {
  const dst = path.join(DST, name);
  try {
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
      report.errors.push(`${name}: 源缺 SKILL.md（${src}）`);
      continue;
    }
    copyDir(src, dst);
    report.copied.push(name);

    if (DESCRIPTIONS[name] && replaceDescription(dst, DESCRIPTIONS[name])) report.descReplaced++;
    fixName(dst);
    report.nameFixed.push(name);

    const repo = repoOf(name);
    if (repo) {
      const lic = findLicense(repo[0]);
      if (lic) { fs.copyFileSync(lic, path.join(dst, path.basename(lic))); report.license++; }
      else { writeAttribution(dst, repo[1]); report.attribution++; }
    }
  } catch (e) {
    report.errors.push(`${name}: ${e.message}`);
  }
}

// modeling-algorithms：算法资源库路由技能（自写 SKILL.md + 搬运算法说明）
try {
  const dst = path.join(DST, 'modeling-algorithms');
  fs.mkdirSync(path.join(dst, 'references'), { recursive: true });
  const assets = `${SRC}/math-modeling-skill/assets`;
  for (const f of fs.readdirSync(assets)) {
    if (JUNK.has(f)) continue;
    fs.copyFileSync(path.join(assets, f), path.join(dst, 'references', f));
  }
  fs.writeFileSync(path.join(dst, 'SKILL.md'), `---
name: modeling-algorithms
description: "数学建模常用算法资源库与选型索引：按问题特征（优化、预测、评价、图论网络、统计处理、综合模拟、机器学习）路由到对应算法说明，含适用场景、假设前提、实现要点与验证方式。建模求解、算法选型、撰写模型章节时使用；先查索引表，只读匹配的算法文件。"
---

# 数学建模算法资源库

先按问题特征查索引表，**只读取与当前子问题匹配的算法文件**，不要一次性加载全部算法资料。

| 问题特征 | 参考文件 |
|---|---|
| 约束优化、调度、路径、资源分配 | [references/01-优化算法说明.md](references/01-优化算法说明.md) |
| 时间序列、回归预测、灰色预测 | [references/02-预测类算法说明.md](references/02-预测类算法说明.md) |
| 多指标评价、排序、效率分析 | [references/03-评价类算法说明.md](references/03-评价类算法说明.md) |
| 最短路、网络流、复杂网络 | [references/04-图论与网络分析算法说明.md](references/04-图论与网络分析算法说明.md) |
| 检验、降维、聚类前处理、统计推断 | [references/05-统计分析与数据处理算法说明.md](references/05-统计分析与数据处理算法说明.md) |
| 模拟、系统动力学、元胞自动机 | [references/06-综合类算法说明.md](references/06-综合类算法说明.md) |
| 分类、聚类、集成学习、神经网络 | [references/07-机器学习算法说明.md](references/07-机器学习算法说明.md) |

选用算法前必须核对：假设前提、数据规模、目标函数、约束条件、验证方式和所需依赖。每道子问题最多两个独立模型体系；同一物理机制的不同精度展开按一个模型族计数。

与 \`method-selector\` 技能配合：用本库候选算法生成主候选与基线，再按其流程做风险探针与人工确认。
`, 'utf8');
  writeAttribution(dst, 'https://github.com/XiaoMaColtAI/math-modeling-skill（assets/ 算法说明与索引）');
  report.copied.push('modeling-algorithms');
  report.attribution++;
} catch (e) {
  report.errors.push(`modeling-algorithms: ${e.message}`);
}

// ─────────────────────────────────────────────────────────────
// 自校验：扫描 DST 全部技能
// ─────────────────────────────────────────────────────────────
function parseFrontmatter(raw) {
  const fm = {};
  if (!raw.startsWith('---')) return fm;
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return fm;
  for (const line of raw.slice(3, end).split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v === '|' || v === '>' || v === '|-') continue;
    fm[m[1]] = v.replace(/^["'](.*)["']$/, '$1');
  }
  return fm;
}

const scan = [];
for (const dir of fs.readdirSync(DST)) {
  const full = path.join(DST, dir);
  if (!fs.statSync(full).isDirectory()) continue;
  const mdPath = path.join(full, 'SKILL.md');
  if (!fs.existsSync(mdPath)) { scan.push([dir, 'MISSING SKILL.md']); continue; }
  const fm = parseFrontmatter(fs.readFileSync(mdPath, 'utf8'));
  const issues = [];
  if (!fm.name) issues.push('no name');
  else if (fm.name !== dir) issues.push(`name!=dir (${fm.name})`);
  if (!fm.description || fm.description.length < 8) issues.push('bad description');
  else if (!/[\u4e00-\u9fff]/.test(fm.description)) issues.push('desc not chinese');
  let bytes = 0, files = 0;
  const stack = [full];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else { files++; bytes += fs.statSync(p).size; }
    }
  }
  scan.push([dir, issues.join('; ') || 'OK', `${files} files ${(bytes / 1024).toFixed(0)}K`]);
}

console.log('=== 复制完成 ===');
console.log('copied:', report.copied.length, report.copied.join(', '));
console.log('desc replaced:', report.descReplaced, '| name fixed:', report.nameFixed.length, '| license:', report.license, '| attribution:', report.attribution);
if (report.errors.length) console.log('ERRORS:\n' + report.errors.join('\n'));
console.log('\n=== 全量校验（builtin-skills 共 ' + scan.length + ' 个技能）===');
for (const [dir, status, size] of scan) console.log(`${status === 'OK' ? ' ✓' : ' ✗'} ${dir}  ${size || ''}  ${status === 'OK' ? '' : status}`);
