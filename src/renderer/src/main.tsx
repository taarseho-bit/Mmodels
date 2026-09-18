import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { DesktopPetWindow } from './components/DesktopPetWindow';
import './styles/theme.css';
import './styles/layout.css';
import './styles/pages.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 不存在');

const desktopPetWindow = new URLSearchParams(window.location.search).get('window') === 'desktop-pet';
if (desktopPetWindow) {
  document.documentElement.classList.add('desktop-pet-document');
  document.body.classList.add('desktop-pet-document');
}

/**
 * 全局拖拽兜底。
 *
 * ⚠️ Electron 里把一个文件拖到窗口上，默认行为是**让渲染层导航到该文件** ——
 *    整页被替换成文件内容（PDF 直接显示、其它类型触发下载），
 *    用户看到的现象是「拖一下界面就没了 / 没反应」，而控制台没有任何报错。
 *    必须在 window 上拦下默认行为。
 *
 * 只拦默认行为，**不 stopPropagation** —— 输入区自己还会处理 drop
 * 并把它变成附件，在这里掐掉冒泡会把这个能力一起废掉。
 */
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => {
    e.preventDefault();
  });
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {desktopPetWindow ? <DesktopPetWindow /> : <App />}
  </React.StrictMode>,
);
