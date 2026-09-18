/**
 * 极简查看页。
 *
 * ⚠️ 这不是"可选项"。没有查看界面的上报服务等于没收数据 ——
 * 真出问题时你要么打不开库、要么查不动，收集就白收了。
 *
 * 刻意做成**服务端渲染的单页 HTML + 原生 JS**：
 *   · 没有构建步骤，改完刷新即可
 *   · 没有前端框架依赖，镜像不会因此变大
 *   · 在这个量级上，一个表格加一个详情面板就够了
 */

export function adminHtml(): string {
  // 注意：下面这段 HTML 本身是 TS 模板字符串，
  // 内嵌的浏览器端 JS **一律不用模板字符串**（改用字符串拼接），
  // 否则 ${...} 会被外层提前求值，是这里最容易踩的坑。
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MathModel 诊断台</title>
<style>
  :root {
    --bg:#f7f7f8; --panel:#fff; --fg:#1c1c1e; --muted:#6b7280;
    --border:#e5e7eb; --accent:#2563eb; --warn:#b45309;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#16181d; --panel:#1e2027; --fg:#e8eaed; --muted:#9aa0a6;
      --border:#2f323a; --accent:#6ea8fe; --warn:#f0b429;
    }
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--fg);
    font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;
  }
  header {
    padding:16px 20px; border-bottom:1px solid var(--border); background:var(--panel);
    display:flex; align-items:baseline; gap:12px;
  }
  h1 { font-size:16px; margin:0; font-weight:600; }
  .muted { color:var(--muted); font-size:12px; }
  main { padding:20px; max-width:1200px; margin:0 auto; display:grid; gap:20px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; }
  .card {
    background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:14px 16px;
  }
  .card .k { font-size:12px; color:var(--muted); }
  .card .v { font-size:22px; font-weight:600; margin-top:4px; }
  section {
    background:var(--panel); border:1px solid var(--border); border-radius:10px; overflow:hidden;
  }
  section > h2 {
    font-size:13px; font-weight:600; margin:0; padding:12px 16px;
    border-bottom:1px solid var(--border); color:var(--muted);
  }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:9px 16px; border-bottom:1px solid var(--border); font-size:13px; }
  th { color:var(--muted); font-weight:500; font-size:12px; }
  tr:last-child td { border-bottom:none; }
  tr.click { cursor:pointer; }
  tr.click:hover { background:color-mix(in srgb, var(--accent) 8%, transparent); }
  a { color:var(--accent); text-decoration:none; }
  button {
    font:inherit; padding:5px 10px; border:1px solid var(--border); border-radius:6px;
    background:transparent; color:var(--fg); cursor:pointer;
  }
  button:hover { border-color:var(--accent); color:var(--accent); }
  pre {
    margin:0; padding:14px 16px; overflow:auto; max-height:420px;
    font:12px/1.5 ui-monospace,Consolas,monospace; white-space:pre-wrap; word-break:break-word;
  }
  .empty { padding:24px 16px; color:var(--muted); font-size:13px; }
  .bar { display:flex; gap:8px; align-items:center; padding:12px 16px; }
  .bar input { flex:1; padding:6px 10px; border:1px solid var(--border); border-radius:6px;
               background:transparent; color:var(--fg); font:inherit; }
  dialog {
    border:1px solid var(--border); border-radius:12px; background:var(--panel); color:var(--fg);
    width:min(900px,92vw); padding:0;
  }
  dialog::backdrop { background:rgba(0,0,0,.45); }
  .dlg-head {
    display:flex; justify-content:space-between; align-items:center; gap:12px;
    padding:14px 16px; border-bottom:1px solid var(--border);
  }
  .dlg-body { max-height:70vh; overflow:auto; }
  .warn { color:var(--warn); }
</style>
</head>
<body>
<header>
  <h1>MathModel 诊断台</h1>
  <span class="muted" id="meta">加载中…</span>
</header>

<main>
  <div class="cards" id="cards"></div>

  <section>
    <h2>按事件名统计</h2>
    <div id="byName"></div>
  </section>

  <section>
    <h2>诊断报告</h2>
    <div class="bar">
      <input id="q" placeholder="按问题描述 / 版本过滤…">
      <button id="reload">刷新</button>
    </div>
    <div id="reports"></div>
  </section>
</main>

<dialog id="dlg">
  <div class="dlg-head">
    <strong id="dlgTitle">报告</strong>
    <span>
      <button id="dlgDel">删除</button>
      <button id="dlgClose">关闭</button>
    </span>
  </div>
  <div class="dlg-body"><pre id="dlgBody"></pre></div>
</dialog>

<script>
(function () {
  var currentId = null;

  function el(id) { return document.getElementById(id); }

  function fmtTime(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString('zh-CN', { hour12: false });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function getJson(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function renderCards(health, stats) {
    var today = stats.byDay.length ? stats.byDay[stats.byDay.length - 1] : null;
    var total = stats.byDay.reduce(function (a, d) { return a + d.total; }, 0);
    var cards = [
      ['运行时长', Math.round(health.uptimeSec / 60) + ' 分钟'],
      ['数据体积', (health.dataBytes / 1048576).toFixed(2) + ' MB'],
      ['本统计窗口事件数', total],
      ['今日事件数', today ? today.total : 0],
      ['保留期', health.retentionDays + ' 天']
    ];
    el('cards').innerHTML = cards.map(function (c) {
      return '<div class="card"><div class="k">' + esc(c[0]) + '</div><div class="v">' + esc(c[1]) + '</div></div>';
    }).join('');
  }

  function renderByName(items) {
    if (!items.length) { el('byName').innerHTML = '<div class="empty">暂无数据</div>'; return; }
    var rows = items.map(function (x) {
      return '<tr><td>' + esc(x.name) + '</td><td>' + x.count + '</td></tr>';
    }).join('');
    el('byName').innerHTML =
      '<table><thead><tr><th>事件名</th><th>数量</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderReports(items) {
    if (!items.length) { el('reports').innerHTML = '<div class="empty">暂无诊断报告</div>'; return; }
    var rows = items.map(function (r) {
      return '<tr class="click" data-id="' + esc(r.id) + '">' +
        '<td>' + esc(fmtTime(r.createdAt || r.receivedAt)) + '</td>' +
        '<td>' + esc(r.appVersion) + '</td>' +
        '<td>' + esc(r.platform) + '</td>' +
        '<td>' + r.faultCount + '</td>' +
        '<td>' + esc((r.reason || '').slice(0, 60)) + '</td></tr>';
    }).join('');
    el('reports').innerHTML =
      '<table><thead><tr><th>时间</th><th>版本</th><th>平台</th><th>故障数</th><th>问题描述</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';

    Array.prototype.forEach.call(el('reports').querySelectorAll('tr.click'), function (tr) {
      tr.addEventListener('click', function () { openReport(tr.getAttribute('data-id')); });
    });
  }

  function openReport(id) {
    currentId = id;
    el('dlgTitle').textContent = '报告 ' + id;
    el('dlgBody').textContent = '加载中…';
    el('dlg').showModal();
    getJson('/admin/api/reports/' + encodeURIComponent(id)).then(function (r) {
      var copy = JSON.parse(JSON.stringify(r));
      if (copy.logs) { copy._logs_note = '（日志片段，最尾部 ' + copy.logs.length + ' 字符）'; }
      el('dlgBody').textContent = JSON.stringify(copy, null, 2);
    }).catch(function (e) {
      el('dlgBody').textContent = '读取失败：' + e.message;
    });
  }

  function loadReports() {
    var q = el('q').value.trim().toLowerCase();
    getJson('/admin/api/reports?limit=100').then(function (list) {
      if (q) {
        list = list.filter(function (r) {
          return (r.reason || '').toLowerCase().indexOf(q) >= 0 ||
                 (r.appVersion || '').toLowerCase().indexOf(q) >= 0;
        });
      }
      renderReports(list);
    }).catch(function (e) {
      el('reports').innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>';
    });
  }

  function refresh() {
    Promise.all([getJson('/health'), getJson('/admin/api/stats?days=7')])
      .then(function (res) {
        el('meta').textContent = 'v' + res[0].version + ' · 运行 ' + Math.round(res[0].uptimeSec) + ' 秒';
        renderCards(res[0], res[1]);
        renderByName(res[1].byName);
      })
      .catch(function (e) {
        el('meta').textContent = '健康检查失败：' + e.message;
      });
    loadReports();
  }

  el('reload').addEventListener('click', loadReports);
  el('q').addEventListener('input', loadReports);
  el('dlgClose').addEventListener('click', function () { el('dlg').close(); });
  el('dlgDel').addEventListener('click', function () {
    if (!currentId) return;
    if (!confirm('确认删除报告 ' + currentId + ' ？此操作不可撤销。')) return;
    fetch('/admin/api/reports/' + encodeURIComponent(currentId), { method: 'DELETE' })
      .then(function () { el('dlg').close(); loadReports(); });
  });

  refresh();
})();
</script>
</body>
</html>`;
}
