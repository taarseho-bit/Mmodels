'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const shots = {
  'workspace-chat':['建模对话','项目与对话','项目侧栏、对话记录、技能操作与输入区保留在同一个工作台，题目、约束和中间结论可以连续追踪。'],
  'conversation-flowchart':['对话技术路线','项目与对话','对话中的 Mermaid 流程图呈现数据体检、基线比较、规划求解、容量核验与供给不足时的反馈路径。'],
  'chat-project-menu':['项目切换','项目与对话','通过输入区的项目入口切换任务上下文，当前模型、附件与文件路径随项目集中管理。'],
  'chat-plus-menu':['附件与输入工具','项目与对话','从输入区添加附件与辅助内容，把赛题、资料和数据与当前任务一起提交。'],
  'chat-model-menu':['模型选择','项目与对话','查看当前供应商与模型候选，为分析、代码、研究和写作任务选择合适的模型。'],
  'chat-decision-menu':['决策方式','项目与对话','选择人工精细推进或自动执行，决定建模过程中的确认与执行节奏。'],
  'chat-quality-menu':['建模深度','项目与对话','按任务复杂度选择处理深度，结合数据规模、验证需求和论文目标安排计算。'],
  'chat-permission-menu':['执行权限','项目与对话','在输入区检查工具与文件操作权限，按项目的执行需求选择访问范围。'],
  'chat-template-menu':['论文模板入口','论文与交付','在对话输入区选择论文模板，让论文组织与当前比赛规则保持一致。'],
  'chat-context-menu':['上下文用量','项目与对话','查看本轮上下文状态，判断长对话与多份材料是否需要整理后再继续。'],
  'chat-paper-setup':['比赛信息登记','比赛工作台','集中登记比赛名称、题目、匿名要求与论文页数，后续交付检查依据同一份规则。'],
  'chat-task-palette':['任务输入状态','项目与对话','在输入区准备新的建模指令，配合任务入口组织分析、计算、绘图和论文操作。'],
  'workflow-case':['协作工作流','智能体工作流','15 个角色围绕题意、数据、方法、验证与交付分工，任务容器连接项目主助手和协作成员。'],
  'workflow-large':['独立高清协作图','智能体工作流','完整画布独立截取，树形分支保留成员关系、状态、技能和操作次数，可打开原图检查所有节点。'],
  'workflow-details':['求解成员记录','智能体工作流','选择规划求解成员，核对方法选择、计算、残差校验和指标保存的操作记录。'],
  'workflow-demo':['工作流演示视图','智能体工作流','演示视图聚焦分工与状态，已结束成员可以收起，便于向队友讲解整个任务。'],
  'workflow-analysis':['工作流分析视图','智能体工作流','分析视图展开成员、技能统计与阶段进度，支持缩放、拖动、适应画布和聚焦当前成员。'],
  'workflow-member-detail':['成员详情面板','智能体工作流','成员面板展示职责、状态、技能调用与文件产物，点击文件入口可以回到项目验证结果。'],
  'editor-view':['编辑器工作区','编辑器与数据','文件树、编辑区和对话列并排呈现，修改代码或报告时仍能保留当前任务上下文。'],
  'editor-flowchart':['编辑器技术路线','编辑器与数据','在项目文件中查看技术路线文档，图与对话中的建模步骤互相对应。'],
  'results-report':['模型结果报告','论文与交付','报告保留目标函数、约束、结果与敏感性边界，数字与项目复算脚本保持对应。'],
  'terminal-or-editor-panel':['工作面板入口','编辑器与数据','通过任务工具菜单进入终端或编辑器面板，在本机项目中读取文件、执行计算和查看产物。'],
  'competition-workbench':['比赛工作台','比赛工作台','按竞赛项目维护题目、研究阶段、材料与交付检查，使比赛过程有明确推进位置。'],
  'competition-workbench-overview':['比赛项目概览','比赛工作台','查看当前比赛项目的准备状态、阶段与待补材料，在开始建模前整理规则与资源。'],
  'competition-workbench-detail':['比赛操作页面','比赛工作台','进入比赛相关操作状态，检查项目信息与交付资料，减少规则遗漏。'],
  'chart-gallery':['科研图表参考库','编辑器与数据','从比较、分布、关系、网络与流程等表达方式中选择图表，结合数据类型确定表达目标。'],
  'data-gallery-overview':['数据图表总览','编辑器与数据','图表参考与数据绘图共享入口，先看图形用途，再决定字段与绘图工具。'],
  'data-plot-panel':['数据绘图面板','编辑器与数据','进入数据绘图区域，组织数据与图形参数，给模型结果选择合适的表现形式。'],
  'data-project-files':['项目数据文件','编辑器与数据','在当前项目下查看 CSV、TSV 等数据文件，保持原始数据与图表处理步骤可追溯。'],
  'project-data':['项目数据工作台','编辑器与数据','数据、科研图表与项目文件在一个入口中组织，支持从数据结构走向结果表达。'],
  'skills-detail':['建模技能详情','技能与扩展','查看技能职责、适用条件与执行说明，再把技能用于当前的题意、数据、模型或论文任务。'],
  'templates-detail':['论文模板详情','技能与扩展','查看模板入口与结构说明，按比赛语言、章节和提交规则组织论文。'],
  'extension-skills':['技能中心','技能与扩展','按类型检索内置技能，阅读输入、输出和执行范围，让建模操作有明确职责。'],
  'extension-templates':['模板中心','技能与扩展','浏览论文模板与相关说明，选择与赛事规范对应的组织方式。'],
  'extension-algorithms':['算法中心','技能与扩展','查看优化、预测、评价等算法资料，结合题目约束比较方法并保留选型依据。'],
  'extension-plugins':['插件中心','技能与扩展','检查可用插件及说明，把辅助能力接入当前工作流程。'],
  'extension-connectors':['科研连接器','技能与扩展','浏览数据与研究连接器，了解各入口提供的数据类型与使用范围。'],
  'providers-grid':['模型供应商','模型与设置','配置可用供应商与模型入口，集中管理模型服务。公开截图已经隐去账号信息。'],
  'usage-statistics':['使用统计','模型与设置','查看任务与使用情况，为长期建模工作安排模型、技能与执行节奏。'],
  'membership-account':['VIP 账号状态','VIP 服务','展示已登录的 VIP 状态与会员入口；公开截图中的账号、余额与到期信息经过脱敏。'],
  'membership-center':['独立会员中心','VIP 服务','会员服务集中介绍卡密激活、权益与相关使用规则，与基础功能说明分开查看。'],
  'paper-library':['优秀获奖论文','论文与交付','从论文库查看结构、表达和题型参考，帮助团队理解同类赛题的研究与交付方式。'],
  'paper-upload-dialog':['论文上传入口','论文与交付','通过上传入口准备论文信息与文件，集中管理用于研究参考的材料。'],
  'automation-editor':['自动化任务编辑','自动化','创建自动化任务，设置执行内容与节奏，把重复检查、整理和研究步骤组织起来。'],
  'desktop-pet-settings':['桌面小模外观','模型与设置','在外观设置中选择桌面建模伙伴，查看角色与交互选项。'],
};
const settings = {
  account:['账号与会员','查看登录状态、会员权益与账号入口，基础使用和 VIP 服务边界集中说明。'],
  competitions:['竞赛规则','维护比赛资料与规则，在建模前统一团队的交付要求。'],
  paper:['论文规则','设置论文结构、模板与页数等要求，让写作与审阅有统一标准。'],
  quality:['建模质量','调整质量与交付检查要求，明确验证深度和成果标准。'],
  model:['模型配置','维护当前供应商、模型与自定义模型，为不同任务选择合适的执行能力。'],
  providers:['供应商配置','集中管理模型供应商与可用模型，检查服务入口与配置。'],
  chat:['对话设置','调整对话行为与展示，让长任务的记录与交流更易阅读。'],
  sysprompt:['系统提示词','管理助手的系统指令，使项目处理原则与团队约定一致。'],
  env:['本地环境','查看计算和工具环境，检查脚本执行所需的基础能力。'],
  network:['网络设置','设置模型与工具访问网络的方式，按本机环境维护连接。'],
  automation:['自动化设置','管理持续任务与执行入口，让重复工作有清晰的安排。'],
  notify:['通知设置','管理任务进度和执行结果的提醒方式。'],
  appearance:['外观设置','选择亮色或深色模式、强调色、语言与桌面小模外观。'],
  profile:['个人统计','查看工作记录与使用情况，了解长期建模的投入与活动。'],
  about:['关于软件','查看软件版本、更新与产品信息，确认当前工作台版本。'],
};
for (const [id,[title,desc]] of Object.entries(settings)) shots[`settings-${id}`]=[title,'模型与设置',desc];
const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/assets/screenshots/2026-09-30/manifest.json'),'utf8').replace(/^\uFEFF/,''));
const files=manifest.files;
for (const file of files) if(!shots[file.replace('.png','')]) throw Error(`缺少截图说明：${file}`);
const seed=fs.readFileSync(path.join(root,'scripts/seed-site-case.cjs'),'utf8');
const part=seed.slice(seed.indexOf('const node ='),seed.indexOf('const writeAll ='));
const context={now:Date.now(),runStart:Date.now()-1080000,randomUUID:()=> 'demo',sessionId:'demo',projectId:'demo',session:{title:'城市应急资源调度'}};
vm.runInNewContext(part+';globalThis.snapshot=run;',context);
const run=context.snapshot;
const calls=run.nodes.reduce((n,a)=>n+a.tools.length,0);
const skillCalls=run.nodes.reduce((n,a)=>n+a.tools.filter(t=>t.skill).length,0);
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const asset=file=>`./assets/screenshots/2026-09-30/${file}`;
const roles=run.nodes.map(n=>`<tr><td>${escape(n.name)}</td><td>${escape(n.assignment)}</td><td>${n.tools.length} 次</td><td>${n.tools.filter(t=>t.skill).map(t=>escape(t.label)).join('、')||'计算与文件操作'}</td></tr>`).join('');
const categories=[...new Set(files.map(f=>shots[f.replace('.png','')][1]))];
const gallery=`<!-- mm-showcase:start --><section class="mm-showcase" id="new-screenshots"><div class="mm-showcase-heading"><span>PRODUCT TOUR / ${files.length} LIGHT CAPTURES</span><h2>从入口，到执行，再到交付。</h2><p>本轮 ${files.length} 张亮色素材来自当前客户端，在隔离的 VIP 登录会话中重新截取。每一张说明它所处的工作位置；点击图片可以打开原始大图。</p></div><details class="mm-agent-plan" open><summary>城市应急资源调度 · 15 个角色如何交接</summary><p>题意与数据先确定问题边界，文献提供方法依据；基线与规划分别计算，需求情景进入仿真；稳健性核验后交给科研图表与论文，引用和交付审计完成最后一轮检查。理想分工按推理、研究、代码、视觉与写作模型组织，实际模型可以按供应商配置选择。</p><div class="mm-demo-note">演示回放：${run.nodes.length} 个角色、${calls} 次工具操作、${skillCalls} 次技能调用、${run.exchanges.length} 条协作交接。对话与调用记录为模拟展示，不代表真实线上 API 消耗；合成数据的 SciPy / HiGHS 数值结果可复算。</div><div class="mm-role-scroll"><table><thead><tr><th>角色</th><th>模型职责 / 本轮目标</th><th>调用记录</th><th>使用技能</th></tr></thead><tbody>${roles}</tbody></table></div><a class="mm-original" href="${asset('workflow-large.png')}" target="_blank" rel="noopener">打开完整工作流高清图 ↗</a></details><div class="mm-gallery-filters" role="group" aria-label="截图分类"><button type="button" class="is-active" data-mm-category="全部">全部 <small>${files.length}</small></button>${categories.map(c=>`<button type="button" data-mm-category="${escape(c)}">${escape(c)}</button>`).join('')}</div><div class="mm-gallery">${files.map((f,i)=>{const [title,category,desc]=shots[f.replace('.png','')];return `<article class="mm-gallery-card" data-mm-group="${escape(category)}"><a href="${asset(f)}" target="_blank" rel="noopener" aria-label="放大 ${escape(title)}"><img src="${asset(f)}" alt="${escape(title)} · 亮色客户端截图" loading="lazy" width="1440" height="900"/><span>查看原图 ↗</span></a><div><small>${String(i+1).padStart(2,'0')} / ${escape(category)}</small><h3>${escape(title)}</h3><p>${escape(desc)}</p></div></article>`}).join('')}</div></section><!-- mm-showcase:end -->`;
const mapping={
 'modeling-chat':'workspace-chat','chat-running':'workspace-chat','dialog-contest-info':'chat-paper-setup','hash-palette-live':'chat-task-palette','live-run-model-picker':'chat-model-menu',
 'menu-decision':'chat-decision-menu','menu-model':'chat-model-menu','menu-permission':'chat-permission-menu','menu-project':'chat-project-menu','menu-quality':'chat-quality-menu','search-inline':'workspace-chat','task-mode-menu':'chat-task-palette','task-mode-menu2':'chat-task-palette','onboarding-tutorials':'membership-center','panel-terminal':'terminal-or-editor-panel',
 'workflow-analysis-skills':'workflow-analysis','workflow-analysis-view':'workflow-analysis','workflow-demo-view':'workflow-demo','workflow-node-details':'workflow-details','live-collab-tasks':'workflow-case','agents-all-19':'workflow-large','agents-colored':'workflow-analysis','agent-member-panel':'workflow-member-detail','agent-member-zoom':'workflow-details',
 'chart-gallery-overview':'data-gallery-overview','data-csv-1':'data-project-files','data-csv-preview':'data-project-files','data-plot-from-data':'data-plot-panel','data-plot-second':'data-plot-panel','data-project-database':'data-project-files','paper-share-dialog':'paper-upload-dialog','competition-calendar-list':'settings-competitions','competition-calendar':'settings-competitions','competition-workbench-details':'competition-workbench-detail','algorithms-library':'extension-algorithms','extensions-algorithms':'extension-algorithms','extensions-skills':'extension-skills','extensions-templates':'extension-templates','automation-runs':'settings-automation','automation-tasks':'automation-editor',
 'desktop-pet-window':'desktop-pet-settings','settings-pet-characters':'desktop-pet-settings','settings-appearance-bottom':'settings-appearance','settings-environment':'settings-env','settings-paper-rules':'settings-paper','settings-quality-delivery':'settings-quality','settings-profile-stats':'settings-profile','settings-keybindings':'settings-chat','settings-tour':'settings-appearance',
};
for(const name of ['index','features','binary','robotic']) {
 const p=path.join(root,`docs/${name}.html`);
 let html=fs.readFileSync(p,'utf8').replace(/<!-- mm-showcase:start -->[\s\S]*?<!-- mm-showcase:end -->/g,'');
 html=html.replace(/<figure\b[\s\S]*?<\/figure>/g,figure=>{
   const old=figure.match(/<img[^>]+src="([^"]+)"/)?.[1];
   if(!old?.includes('screenshots/')) return figure;
   const id=path.basename(old,'.png');
   let key=mapping[id] || (id.startsWith('gallery-')?'chart-gallery':id);
   if(key==='desktop-pet-settings'&&!files.includes('desktop-pet-settings.png')) key='settings-appearance';
   if(!shots[key]) key=old.includes('02-workflow')?'workflow-analysis':old.includes('03-agents')?'workflow-member-detail':'workspace-chat';
   if(old.endsWith('/competition-workbench.png')&&/工作流|协作.*全景/.test(figure))key='workflow-large';
   const title=shots[key][0];
   return figure.split(old).join(asset(`${key}.png`)).replace(/<figcaption>[\s\S]*?<\/figcaption>/,`<figcaption>新版客户端 · ${escape(title)} · 亮色模式</figcaption>`).replace(/(<img[^>]*alt=")[^"]*/,`$1${escape(title)}`);
 });
 html=html.replace(/\d+ 张亮色截图/g,`${files.length} 张亮色截图`).replace(/72 次(操作记录|记录)/g,`${calls} 次操作记录`).replace(/index\.html#membership/g,'index.html#vip');
 html=html.replace('</main>',gallery+'</main>');
 if(!html.includes('showcase.css'))html=html.replace('</head>','<link rel="stylesheet" href="./showcase.css"/></head>');
 if(!html.includes('showcase.js'))html=html.replace('</body>','<script src="./showcase.js"></script></body>');
 fs.writeFileSync(p,html.trimEnd()+'\n');
}
console.log(`showcase: ${files.length} light screenshots; ${run.nodes.length} roles; ${calls} tool calls; ${skillCalls} skill calls`);
