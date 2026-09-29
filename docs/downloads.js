/*
 * 官网下载渠道配置。
 *
 * 运营方只需要修改下面的 URL，再重新发布 docs/：
 * - setup / portable：安装版与便携版
 * - baidu / lanzou / direct：对应网盘和官方直链
 * 留空时页面保留“待配置”状态，避免把不存在的地址展示给用户。
 */
(function () {
  var CONFIG = {
    setup: '',
    portable: '',
    baidu: '',
    lanzou: '',
    direct: '',
    source: 'https://github.com/taarseho-bit/Mmodels'
  };

  function setDownload(key, url) {
    var nodes = document.querySelectorAll('[data-mm-download="' + key + '"]');
    nodes.forEach(function (node) {
      if (url) {
        node.href = url;
        node.target = '_blank';
        node.rel = 'noopener';
        node.classList.remove('is-unconfigured');
        if (/待配置|联系获取/.test(node.textContent || '')) node.textContent = '立即下载';
      } else {
        node.href = '#contact';
        node.removeAttribute('target');
        node.classList.add('is-unconfigured');
      }
    });
  }

  function setChannel(key, url, label) {
    var node = document.querySelector('[data-mm-channel="' + key + '"]');
    if (!node) return;
    if (url) {
      node.innerHTML = '<a href="' + String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '" target="_blank" rel="noopener">' + label + ' · 打开</a>';
      node.classList.add('is-ready');
    }
  }

  function mount() {
    setDownload('setup', CONFIG.setup);
    setDownload('portable', CONFIG.portable);
    setDownload('source', CONFIG.source);
    setChannel('baidu', CONFIG.baidu, '百度网盘');
    setChannel('lanzou', CONFIG.lanzou, '蓝奏云');
    setChannel('direct', CONFIG.direct, '官方直链');

    document.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-copy-qq]') : null;
      if (!button) return;
      var value = button.getAttribute('data-copy-qq') || '';
      var done = function () {
        var old = button.textContent;
        button.textContent = '已复制群号';
        setTimeout(function () { button.textContent = old; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(done, done);
      } else {
        done();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
