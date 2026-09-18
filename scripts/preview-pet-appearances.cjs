// 从实际角色组件生成预览，避免展示与软件不一致的概念图。
const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/renderer/src/components/PetDeskAvatar.tsx'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const mod = { exports: {} };
new Function('require', 'exports', 'module', js)((name) => name.endsWith('.css') ? {} : require(name), mod.exports, mod);
const { PetDeskAvatar, PET_APPEARANCES } = mod.exports;
const cards = PET_APPEARANCES.map((item, index) => `<article>${renderToStaticMarkup(React.createElement(PetDeskAvatar, { appearance: item.id }))}<h2>0${index + 1} · ${item.name}</h2><p>${item.description}</p></article>`).join('');
const html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><style>body{margin:0;padding:42px;background:#f3f0eb;color:#343347;font-family:'Microsoft YaHei',sans-serif}h1{margin:0;font-size:30px}header p{color:#777381;margin-bottom:30px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}article{padding:22px 16px;background:#ffffff;border:1px solid #e4dfeb;border-radius:24px}svg{width:100%;height:225px}h2{font-size:18px;margin:15px 0 8px}p{font-size:13px;line-height:1.8}footer{margin-top:24px;font-size:13px;color:#777381}</style><header><h1>小模的四间工作室</h1><p>桌面真实角色预览 · 在「设置 → 外观 → 桌面小模」随时切换</p></header><div class="grid">${cards}</div><footer>点击打招呼 · 按住一起拖动 · 双击回到工作台 · 工作时自动变换动作</footer></html>`;
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 640, show: false, webPreferences: { sandbox: true, offscreen: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await win.webContents.executeJavaScript('document.fonts.ready');
    const picture = await win.webContents.capturePage();
    fs.mkdirSync(path.join(root, 'out'), { recursive: true });
    fs.writeFileSync(path.join(root, 'out/pet-appearance-preview.png'), picture.toPNG());
    console.log('已生成 out/pet-appearance-preview.png');
    const css = ['src/renderer/src/components/pet-desk.css', 'src/renderer/src/styles/theme.css', 'src/renderer/src/styles/layout.css', 'src/renderer/src/styles/pages.css'].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
    const layout = `<html class="desktop-pet-document"><style>${css}</style><body class="desktop-pet-document"><div id="root"><main class="desktop-pet-stage"><section class="desktop-pet-speech">小模在旁边待命</section><div class="desktop-pet-character">${renderToStaticMarkup(React.createElement(PetDeskAvatar))}</div></main></div></body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(layout));
    const measure = () => win.webContents.executeJavaScript(`(() => { const stage=document.querySelector('.desktop-pet-stage'); const person=document.querySelector('.desktop-pet-character'); const speech=document.querySelector('.desktop-pet-speech'); return { width:stage.offsetWidth,height:stage.offsetHeight,personTop:person.offsetTop,speechTop:speech.offsetTop,drag:getComputedStyle(person).getPropertyValue('-webkit-app-region') }; })()`);
    const before = await measure();
    win.setBounds({ x: 100, y: 100, width: 340, height: 260 });
    const after = await measure();
    if (JSON.stringify(before) !== JSON.stringify(after) || after.height !== 260 || after.drag !== 'no-drag') throw new Error('桌面角色布局随窗口变化');
    console.log('通过：气泡与角色相对位置固定，系统拖动已关闭。');
  } finally { win.destroy(); app.quit(); }
});
