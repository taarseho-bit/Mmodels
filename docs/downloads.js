/*
 * 官网下载渠道配置。
 *
 * 所有客户端下载渠道共用 download-config.js 中的百度网盘分享。
 * 查看源码仍指向项目仓库。
 */
(function () {
  var SHARE = window.MM_DOWNLOAD_SHARE;
  if (!SHARE || !SHARE.url) return;
  var CONFIG = {
    setup: SHARE.url,
    portable: SHARE.url,
    baidu: SHARE.url,
    lanzou: SHARE.url,
    direct: SHARE.url,
    source: 'https://github.com/taarseho-bit/Mmodels'
  };

  function setDownload(key, url) {
    var nodes = document.querySelectorAll('[data-mm-download="' + key + '"]');
    nodes.forEach(function (node) {
      if (url) {
        node.href = url;
        node.target = '_blank';
        node.rel = 'noopener';
        if (key !== 'source') node.title = SHARE.name + ' · 百度网盘 · 提取码：' + SHARE.code;
        node.classList.remove('is-unconfigured');
        if (/待配置|联系获取/.test(node.textContent || '')) node.textContent = '立即下载';
      } else {
        node.href = '#community';
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
    setDownload('baidu', CONFIG.baidu);
    setDownload('source', CONFIG.source);
    var label = '百度网盘 · 提取码：' + SHARE.code;
    setChannel('baidu', CONFIG.baidu, label);
    setChannel('lanzou', CONFIG.lanzou, label);
    setChannel('direct', CONFIG.direct, label);

  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
