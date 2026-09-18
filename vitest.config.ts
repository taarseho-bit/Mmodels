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
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/.vendor/**', '**/dist/**', '**/out/**'],
    environment: 'node',
    // src/ 下暂时没有单测（验证主力在 scripts/ 的 harness），
    // 所以没有测试文件时不应报错。
    passWithNoTests: true,
  },
});
