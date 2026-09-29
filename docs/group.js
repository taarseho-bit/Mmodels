// 技术交流群入口：低调挂在页脚，点击才展开二维码。
// 不放在主视觉、不做强购买引导，仅作为交流群自然露出。
(function () {
  var QQ = '1125310795';
  var IMG = './assets/qq-group.png';
  var foot = document.querySelector('.site-foot, .ffoot');
  if (!foot) return;

  var wrap = document.createElement('span');
  wrap.style.cssText = 'position:relative;display:inline-flex;align-items:center;';

  var link = document.createElement('a');
  link.href = 'javascript:void(0)';
  link.textContent = '技术交流群';
  link.style.cssText = 'color:inherit;opacity:.7;text-decoration:underline dotted;text-underline-offset:3px;cursor:pointer;';
  wrap.appendChild(link);

  var panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;bottom:150%;left:50%;transform:translateX(-50%);width:186px;padding:10px;' +
    'border-radius:12px;background:#fff;border:1px solid #e6e8ef;box-shadow:0 12px 32px rgba(20,24,40,.16);' +
    'display:none;z-index:80;text-align:center;';
  var img = document.createElement('img');
  img.src = IMG;
  img.alt = '技术交流群二维码';
  img.style.cssText = 'width:100%;display:block;border-radius:8px;';
  var tip = document.createElement('div');
  tip.innerHTML = '扫一扫加入交流群<br>群号 ' + QQ;
  tip.style.cssText = 'font-size:12px;color:#6b7280;margin-top:6px;line-height:1.6;';
  panel.appendChild(img);
  panel.appendChild(tip);
  wrap.appendChild(panel);

  link.addEventListener('click', function (e) {
    e.preventDefault();
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', function (e) {
    if (!wrap.contains(e.target)) panel.style.display = 'none';
  });

  foot.appendChild(wrap);
})();