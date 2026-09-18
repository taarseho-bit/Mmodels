import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared'),
        '@core': resolve('src/core'),
      },
    },
    build: {
      rollupOptions: {
        // node-pty / better-sqlite3 是原生模块，必须保持 external
        external: ['node-pty', 'better-sqlite3'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          /**
           * ⚠️ 必须是 cjs 格式 **且扩展名为 .cjs**。
           *
           * 踩过的坑：项目 package.json 里有 `"type": "module"`，
           * 于是所有 `.js` 文件都被 Node 当成 ES Module。
           * 如果这里输出 `.js`，Electron 的 preload 加载器用 `require()` 读它，
           * 直接抛 `ERR_REQUIRE_ESM: require() of ES Module not supported` ——
           * 现象是 **preload 静默不执行，window.mathmodel 为 undefined，
           * 界面永远停在启动画面**。
           *
           * 用 `.cjs` 扩展名绕开 package.json 的 type 推断，语义明确且不依赖打包工具。
           * 对应地在 main/index.ts 里 preload 路径也要指向 index.cjs。
           * （注意：preload 无法改用 ESM —— Electron 的 preload 走 require 加载，
           *   不支持 ES Module。）
           */
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [react()],
  },
});
