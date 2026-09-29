(() => {
  'use strict';
  const data = window.MM_CATALOG;
  if (!data) return;

  const $ = (selector) => document.querySelector(selector);
  const grid = $('#catalog-grid');
  const empty = $('#catalog-empty');
  const search = $('#catalog-search');
  const category = $('#catalog-category');
  let kind = 'all';

  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const list = (items, className = 'tag-list') => items?.length ? `<div class="${className}">${items.map((item) => `<span>${escape(item)}</span>`).join('')}</div>` : '';
  const sourceLink = (url) => url ? `<a class="source-link" href="${escape(url)}" target="_blank" rel="noopener">查看官方资料 ↗</a>` : '';

  const categoryLabels = {
    decision: '决策与评价', prediction: '预测与拟合', classification: '分类', clustering: '聚类',
    statistics: '统计分析', optimization: '优化配置', multiObjective: '多目标优化',
    literature: '文献与引用', research: '科研资料', datasets: '公开数据', files: '项目文件',
    code: '代码协作', compute: '本地计算', collaboration: '协作通知', utility: '通用工具',
    'zh-CN': '中文', en: '英文',
  };
  const collections = {
    skills: data.skills.map((item) => ({ ...item, kind: 'skills', category: item.group, title: item.name, summary: item.description })),
    algorithms: data.algorithms.map((item) => ({ ...item, kind: 'algorithms', category: categoryLabels[item.task] || item.task, title: item.name, summary: item.summary })),
    charts: data.charts.map((item) => ({ ...item, kind: 'charts', category: item.category, title: item.name, summary: item.description })),
    connectors: data.connectors.map((item) => ({ ...item, kind: 'connectors', category: categoryLabels[item.category] || item.category, title: item.name, summary: item.description })),
    templates: data.templates.map((item) => ({ ...item, kind: 'templates', category: categoryLabels[item.language] || item.language, title: item.name, summary: item.description })),
  };

  const labels = { skills: '技能', algorithms: '算法', charts: '图表', connectors: '连接器', templates: '论文模板' };
  const all = Object.values(collections).flat();

  function renderStats() {
    const stats = $('#catalog-stats');
    stats.innerHTML = Object.entries(data.counts).map(([key, value]) => `<div><strong>${escape(value)}</strong><span>${escape(labels[key] || key)}</span></div>`).join('');
    document.querySelectorAll('[data-count]').forEach((node) => { node.textContent = data.counts[node.dataset.count] ?? ''; });
  }

  function renderCategoryOptions() {
    const values = [...new Set(all.map((item) => item.category).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
    category.insertAdjacentHTML('beforeend', values.map((value) => `<option value="${escape(value)}">${escape(value)}</option>`).join(''));
  }

  function card(item) {
    const type = labels[item.kind];
    let detail = '';
    if (item.kind === 'skills') {
      detail = `<div class="card-meta"><span>${escape(item.group)}</span><span class="point-cost">${item.cost == null ? '按任务' : `${escape(item.cost)} 积分/次`}</span></div>`;
    } else if (item.kind === 'algorithms') {
      detail = `${list(item.suitableFor, 'tag-list compact')}<details><summary>查看输入、输出与限制</summary><div class="detail-body"><p><b>输入：</b>${escape((item.inputs || []).join('、') || '按任务说明')}</p><p><b>输出：</b>${escape((item.outputs || []).join('、') || '按算法结果')}</p><p><b>不适合：</b>${escape((item.notFor || []).join('、') || '需结合题目判断')}</p><p class="license">${escape(item.packageName || '')} ${escape(item.versionRange || '')} · ${escape(item.license || '')}</p></div></details>`;
    } else if (item.kind === 'charts') {
      detail = `${list(item.dataTypes, 'tag-list compact')}${list(item.tags, 'tag-list compact')}<div class="source-caption">${escape(item.library || item.source || '')}</div>`;
    } else if (item.kind === 'connectors') {
      detail = `${list(item.capabilities, 'tag-list compact')}<div class="card-meta"><span>${item.native ? '内置适配' : '可配置连接'}</span><span>${item.readOnly ? '默认只读' : '可读写（需授权）'}</span></div>${sourceLink(item.sourceUrl)}`;
    } else if (item.kind === 'templates') {
      detail = `<div class="card-meta"><span>${escape(item.language || '中文')}</span><span>入口 ${escape(item.entryFile || 'document.tex')}</span></div>${list(item.fields, 'tag-list compact')}`;
    }
    const image = item.kind === 'charts' && item.imageAvailable ? `<img loading="lazy" src="./assets/gallery/${escape(item.image)}" alt="${escape(item.title)}参考图" />` : '';
    return `<article class="catalog-card kind-${escape(item.kind)}">${image}<div class="card-body"><div class="card-top"><span class="kind-label">${escape(type)}</span><span class="card-id">${escape(item.id)}</span></div><h2>${escape(item.title)}</h2><p>${escape(item.summary)}</p>${detail}</div></article>`;
  }

  function update() {
    const query = search.value.trim().toLowerCase();
    const selectedCategory = category.value;
    const source = kind === 'all' ? all : collections[kind];
    const filtered = source.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
      if (!query) return true;
      return JSON.stringify(item).toLowerCase().includes(query);
    });
    grid.innerHTML = filtered.map(card).join('');
    empty.hidden = filtered.length !== 0;
  }

  document.querySelectorAll('.catalog-tabs button').forEach((button) => button.addEventListener('click', () => {
    kind = button.dataset.kind;
    document.querySelectorAll('.catalog-tabs button').forEach((item) => { item.classList.toggle('is-active', item === button); item.setAttribute('aria-selected', item === button ? 'true' : 'false'); });
    const source = kind === 'all' ? all : collections[kind];
    const values = [...new Set(source.map((item) => item.category).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
    category.innerHTML = '<option value="all">全部场景</option>' + values.map((value) => `<option value="${escape(value)}">${escape(value)}</option>`).join('');
    update();
  }));
  search.addEventListener('input', update);
  category.addEventListener('change', update);
  renderStats();
  renderCategoryOptions();
  update();
})();
