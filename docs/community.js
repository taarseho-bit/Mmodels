/* 链接与二维码以静态 HTML 展示，关闭 JS 也可使用。 */
(function () {
  var timer;
  function notify(message) {
    var node = document.querySelector('.mm-copy-status');
    if (!node) { node = document.createElement('div'); node.className = 'mm-copy-status'; node.setAttribute('role','status'); document.body.appendChild(node); }
    node.textContent = message; node.hidden = false;
    clearTimeout(timer); timer = setTimeout(function () { node.hidden = true; }, 3000);
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-copy-qq]');
    if (!button) return;
    var number = button.getAttribute('data-copy-qq');
    if (!navigator.clipboard || !navigator.clipboard.writeText) { notify('请手动复制群号：' + number); return; }
    navigator.clipboard.writeText(number).then(function () { notify('群号已复制：' + number); }, function () { notify('剪贴板不可用，请手动复制群号：' + number); });
  });
})();
