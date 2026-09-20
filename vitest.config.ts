import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * 单元测试配置。
 *
 * ⚠️ 为什么必须显式写 include / exclude：
 *   项目根目录下有 `.vendor/node-pty` —— 那是为了绕开 pnpm 不跑构建脚本
 *   而放的一份 node-pty 源码副本，里面带着**上游自带的** `.test.ts`。
 *   vitest 默认会在整个项目里找 `*.test.ts`，于是把这些第三方测试也收进来：
 *     - 它们在 jest 语义下写（用到未配置的 `describe`），必然报 "describe is not defined"
 *     - 结果是 `npm test` 一片红，而**自家测试一个都没跑**
 *   这个假失败会掩盖真实回归，比没有测试更危险。所以范围必须钉死在 src/ 内。
 *
 * 项目的重头验证不在这里，而在 `scripts/test-*.cjs`（真实 git / 真实 Electron /
 * 打包产物端到端），由 `npm test:harness` 与 `npm test:e2e` 驱动。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  /**
   * ⚠️ react / react-dom / zustand 在测试里必须共享**同一份 react 实例**，
   * 否则 `renderToStaticMarkup` 渲染任何带 hooks 的组件都会炸
   * 「Cannot read properties of null (reading 'useRef')」+ Invalid hook call 警告
   * （曾影响 PlusMenu 静态渲染 6 例、settings 分区渲染 2 例）。
   *
   * 根因有两层，缺一不可：
   *
   * ① **双实例**：`react-dom/server`（渲染器）把 server dispatcher 写进它 require 的
   *    那份 react 的 `ReactCurrentDispatcher.current`，组件 hooks 读的是自己 import 的
   *    那份 —— 两份不同实例时永远是 null。
   *
   * ② **Windows 盘符大小写**（真正的元凶）：vite/vite-node 的模块 id 用 `pathe`
   *    规范化，盘符被小写成 `d:/...`；Node 原生 require 链 realpath 到真实大小写
   *    `D:/...`。`Module._cache` 按路径字符串做 key —— 同一个 react 文件两份实例
   *    （已实测：cache 里 `d:\...react.development.js` 与 `D:\...` 各一份）。
   *
   * 修复 = 下面的**正则 inline**（把三包拉进 vite 管道，① 不再分裂）+
   * `scripts/test-react-singleton.cjs`（setupFiles，patch `Module._resolveFilename`
   * 统一盘符大小写，② cache key 只剩一个）。
   *
   * ⚠️ inline **必须写正则**不能写字符串：vite-node 的 `matchExternalizePattern`
   *    对字符串 pattern 是 `id.includes(path.join('/node_modules/', ex))` ——
   *    Windows 上 join 产出反斜杠，永远不命中（正则走 `ex.test(id)`，不受影响）。
   *    实测 `ssr.noExternal` 字符串、`test.server.deps.inline` 字符串、
   *    `deps.optimizer.node`（2.x 的键名是 `ssr`/`web`，`node` 是 vitest 3 的）
   *    三种写法全部静默无效。
   *    zustand 也要带上：store 的 hook 经它自己 import 的 react。
   */
  test: {
    setupFiles: ['./scripts/test-react-singleton.cjs'],
    server: {
      deps: {
        inline: [
          /node_modules[\\/]react[\\/]/,
          /node_modules[\\/]react-dom[\\/]/,
          /node_modules[\\/]zustand[\\/]/,
        ],
      },
    },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/.vendor/**', '**/dist/**', '**/out/**'],
    environment: 'node',
    // src/ 下暂时没有单测（验证主力在 scripts/ 的 harness），
    // 所以没有测试文件时不应报错。
    passWithNoTests: true,
  },
});
