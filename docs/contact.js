// 分享与交流区块：四套页面风格共用，紧跟主视觉之后，尽量显眼。
//
// 设计原则（按使用者要求）：
//  1. 只讲「分享 · 交流 · 一起建模」，不做任何付费或购买引导
//  2. 位置靠前：插在每个页面的主视觉 / 页头之后，正文之前
//  3. 预留多个平台位：公众号、QQ、小红书、知乎、B 站、抖音
//     需要新增或启用某个平台，只改下面 CONTACTS 里的 qr / link 即可，
//     填了二维码就直接展示，填了链接就变成可点击的入口，留空则显示「留位中」。
(function () {
  // 深色页与浅色页共用同一套样式，全部用 currentColor 派生，
  // 因此无需改动四个 css 文件也能自然融入各自主题。
  var CSS = [
    '.mm-share{max-width:1080px;margin:34px auto 6px;padding:0 20px;}',
    '.mm-share-box{border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:18px;',
    'padding:22px 22px 18px;background:linear-gradient(135deg,color-mix(in srgb,currentColor 6%,transparent),transparent 62%);}',
    '.mm-share-eyebrow{margin:0 0 6px;font-size:12px;letter-spacing:.16em;opacity:.62;text-transform:uppercase;}',
    '.mm-share-title{margin:0 0 8px;font-size:21px;line-height:1.45;}',
    '.mm-share-sub{margin:0;font-size:13.5px;line-height:1.85;opacity:.78;max-width:820px;}',
    '.mm-share-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(186px,1fr));gap:12px;margin-top:18px;}',
    '.mm-share-card{display:flex;flex-direction:column;gap:9px;padding:13px;border-radius:14px;',
    'border:1px solid color-mix(in srgb,currentColor 13%,transparent);background:color-mix(in srgb,currentColor 4%,transparent);',
    'transition:transform .16s ease,border-color .16s ease,background .16s ease;}',
    '.mm-share-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,currentColor 26%,transparent);',
    'background:color-mix(in srgb,currentColor 7%,transparent);}',
    '.mm-share-card.is-soon{opacity:.62;}',
    '.mm-share-card-top{display:flex;align-items:center;gap:9px;}',
    '.mm-share-ic{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;',
    'border-radius:9px;flex:0 0 auto;color:#fff;}',
    '.mm-share-ic svg{width:17px;height:17px;display:block;fill:currentColor;}',
    '.mm-share-name{font-size:13.5px;font-weight:700;line-height:1.3;}',
    '.mm-share-handle{display:block;font-size:11px;opacity:.6;margin-top:2px;font-variant-numeric:tabular-nums;}',
    '.mm-share-qr{display:flex;align-items:center;justify-content:center;border-radius:11px;overflow:hidden;',
    'background:#fff;padding:6px;min-height:104px;}',
    '.mm-share-qr img{width:100%;max-width:132px;display:block;border-radius:7px;}',
    '.mm-share-qr.is-empty{background:transparent;border:1px dashed color-mix(in srgb,currentColor 24%,transparent);',
    'font-size:11.5px;opacity:.72;text-align:center;line-height:1.6;padding:10px;}',
    '.mm-share-desc{margin:0;font-size:11.5px;line-height:1.7;opacity:.72;}',
    '.mm-share-act{margin-top:auto;align-self:flex-start;border:0;border-radius:8px;padding:5px 10px;cursor:pointer;',
    'font-size:11.5px;font-weight:600;background:color-mix(in srgb,currentColor 12%,transparent);color:inherit;',
    'font-family:inherit;text-decoration:none;}',
    '.mm-share-act:hover{background:color-mix(in srgb,currentColor 20%,transparent);}',
    '.mm-share-badge{margin-top:auto;align-self:flex-start;font-size:11px;padding:3px 9px;border-radius:999px;',
    'border:1px solid color-mix(in srgb,currentColor 22%,transparent);opacity:.8;}',
    '.mm-share-foot{margin:14px 0 0;font-size:11.5px;opacity:.55;line-height:1.7;}',
    '.mm-share-toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:200;padding:8px 16px;',
    'border-radius:999px;background:#111;color:#fff;font-size:12.5px;display:none;}',
    '@media (max-width:640px){.mm-share-box{padding:18px 15px 15px;}.mm-share-title{font-size:18px;}}'
  ].join('');

  // 平台图标（单色填充，外层用品牌色底衬托）
  var ICONS = {
    bubble: '<svg viewBox="0 0 24 24"><path d="M12 3.5c-4.4 0-8 3-8 6.7 0 2 .9 3.8 2.4 5-.2 1-.7 2.1-1.4 2.9-.2.2 0 .5.3.4 1.2-.3 2.3-.8 3.1-1.4 1 .3 2.3.5 3.6.5 4.4 0 8-3 8-6.7s-3.6-6.7-8-6.7z"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M9.5 3.5C5.4 3.5 2 6.3 2 9.7c0 1.9 1 3.6 2.6 4.7L4 17.6l2.8-1.4c.8.2 1.6.3 2.5.3.3 0 .6 0 .9-.1a6 6 0 0 1-.3-1.9c0-3.4 3.2-6.2 7.2-6.2h.6C17 5.2 13.6 3.5 9.5 3.5z"/><path d="M22 14.4c0-2.7-2.8-4.9-6.2-4.9s-6.2 2.2-6.2 4.9 2.8 4.9 6.2 4.9c.7 0 1.4-.1 2-.3l2.3 1.1-.5-2c1.5-.9 2.4-2.3 2.4-3.7z"/></svg>',
    book: '<svg viewBox="0 0 24 24"><path d="M6.5 3h9a2.5 2.5 0 0 1 2.5 2.5V21l-7-3.4L4 21V5.5A2.5 2.5 0 0 1 6.5 3z"/></svg>',
    ask: '<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0-6 6h3.2a2.8 2.8 0 1 1 4 2.6c-1 .5-1.5 1.3-1.5 2.4v.6h3.1v-.5c0-.6.2-1 .8-1.3A6 6 0 0 0 12 3z"/><circle cx="12" cy="18.6" r="1.9"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8.6 5.2 19 12 8.6 18.8z"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M14 3h2a4 4 0 0 0 4 4v3a5.5 5.5 0 0 1-4-1.7v7.2a4.6 4.6 0 1 1-3.4-4.4V3z"/></svg>'
  };

  // ── 平台配置：填 qr（二维码图片路径）或 link（主页地址）即自动启用 ──
  var CONTACTS = [
    {
      key: 'qq', name: 'QQ 交流群', handle: '群号 1125310795', tint: '#12b7f5', icon: 'bubble',
      qr: './assets/qq-group.png', link: '',
      desc: '扫码进群，赛题讨论、组队找人、排版踩坑都在这里聊。', act: 'copy'
    },
    {
      key: 'wechat', name: '微信公众号', handle: '公众号 · 留位中', tint: '#07c160', icon: 'chat',
      qr: '', link: '',
      desc: '建模思路与版本更新的整理笔记，会放在这里。'
    },
    {
      key: 'xiaohongshu', name: '小红书', handle: '账号 · 留位中', tint: '#ff2442', icon: 'book',
      qr: '', link: '',
      desc: '实战笔记、图表美化、论文排版的经验分享。'
    },
    {
      key: 'zhihu', name: '知乎', handle: '主页 · 留位中', tint: '#0084ff', icon: 'ask',
      qr: '', link: '',
      desc: '建模问答与长文专栏，适合慢慢看、慢慢聊。'
    },
    {
      key: 'bilibili', name: 'B 站', handle: '主页 · 留位中', tint: '#fb7299', icon: 'play',
      qr: '', link: '',
      desc: '上手指南与操作演示，跟着视频走一遍就会。'
    },
    {
      key: 'douyin', name: '抖音', handle: '账号 · 留位中', tint: '#111111', icon: 'note',
      qr: '', link: '',
      desc: '短平快的功能速览，几十秒看懂一个能力。'
    }
  ];

  var QQ_GROUP = '1125310795';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function cardHtml(item) {
    var ready = Boolean(item.qr || item.link);
    var media = item.qr
      ? '<div class="mm-share-qr"><img src="' + esc(item.qr) + '" alt="' + esc(item.name) + '二维码" loading="lazy" /></div>'
      : '<div class="mm-share-qr is-empty">二维码 / 入口<br />留位中</div>';
    var foot = ready
      ? (item.act === 'copy'
        ? '<button class="mm-share-act" type="button" data-copy="' + esc(QQ_GROUP) + '">复制群号</button>'
        : '<a class="mm-share-act" href="' + esc(item.link) + '" target="_blank" rel="noopener">前往看看</a>')
      : '<span class="mm-share-badge">待开放</span>';
    return '<div class="mm-share-card' + (ready ? '' : ' is-soon') + '">' +
      '<div class="mm-share-card-top">' +
        '<span class="mm-share-ic" style="background:' + esc(item.tint) + '">' + (ICONS[item.icon] || '') + '</span>' +
        '<span><span class="mm-share-name">' + esc(item.name) + '</span>' +
        '<small class="mm-share-handle">' + esc(item.handle) + '</small></span>' +
      '</div>' +
      media +
      '<p class="mm-share-desc">' + esc(item.desc) + '</p>' +
      foot +
    '</div>';
  }

  function toast(text) {
    var el = document.getElementById('mm-share-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mm-share-toast';
      el.className = 'mm-share-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.display = 'block';
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.style.display = 'none'; }, 1800);
  }

  function render(host) {
    if (!document.getElementById('mm-share-style')) {
      var style = document.createElement('style');
      style.id = 'mm-share-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    host.className = 'mm-share';
    host.innerHTML =
      '<div class="mm-share-box">' +
        '<p class="mm-share-eyebrow">分享 · 交流 · 一起建模</p>' +
        '<h2 class="mm-share-title">先别急着往下翻，来和我们聊聊建模</h2>' +
        '<p class="mm-share-sub">赛题怎么读、数据从哪找、模型选哪个、论文怎么排——这些事一个人琢磨很慢，一群人聊起来就快。' +
        '欢迎来提问、来分享你的做法、来找一起打比赛的队友；用着顺手的地方，也欢迎转给身边同样在做建模的同学。</p>' +
        '<div class="mm-share-grid">' + CONTACTS.map(cardHtml).join('') + '</div>' +
        '<p class="mm-share-foot">更多平台会陆续开在这里；二维码和主页地址准备好后直接更新，位置已经留好了。</p>' +
      '</div>';

    host.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-copy]') : null;
      if (!btn) return;
      var text = btn.getAttribute('data-copy');
      var done = function () { toast('群号已复制：' + text); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { toast('群号：' + text); });
      } else {
        toast('群号：' + text);
      }
    });
  }

  function mount() {
    var host = document.querySelector('[data-mm-share]');
    if (!host) {
      // 页面没放占位时，退回到主视觉 / 页头之后自动插入，保证「最前面」。
      var anchor = document.querySelector('section.hero') || document.querySelector('.fhead') || document.querySelector('.lsb-nav');
      if (!anchor) return;
      host = document.createElement('section');
      host.setAttribute('data-mm-share', '');
      if (anchor.parentNode) anchor.parentNode.insertBefore(host, anchor.nextSibling);
    }
    render(host);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();