/**
 * 测试环境的 react 单实例守卫（vitest setupFiles 第一项）。
 *
 * ⚠️ 为什么需要它：Windows 上 vite/vite-node 的模块 id 用 `pathe` 规范化，
 * **盘符被小写化**（`d:/...`），而 Node 原生 require 链 resolve 到真实大小写（`D:/...`）。
 * `Module._cache` 按**路径字符串**做 key —— 同一个 `react/cjs/react.development.js`
 * 会出现两个 entry（`d:\...` 与 `D:\...`），各自执行一遍、各自一套 internals：
 *
 *   - `react-dom/server`（渲染器）把 server dispatcher 写进它 require 的那份 react；
 *   - 组件里 `import { useRef } from 'react'` 读的是另一份的 `ReactCurrentDispatcher.current`
 *     —— 永远是 null → 「Cannot read properties of null (reading 'useRef')」
 *     + Invalid hook call 警告（曾影响 PlusMenu 静态渲染 6 例、settings 分区渲染 2 例）。
 *
 * 修法：patch `Module._resolveFilename`，把解析结果的小写盘符统一成**真实大小写**，
 * 让所有链路（vite 管道内的 require、Node 原生 require、ESM import 的 CJS 互操作）
 * 落到同一个 cache entry 上 —— 全进程只有一份 react / react-dom / zustand 实例。
 * 非 Windows 或盘符本就大写时是零开销直通。
 */
'use strict';

const Module = require('node:module');

const origResolveFilename = Module._resolveFilename;

/**
 * 只对 react 系包（react / react-dom / zustand，含其内部相对 require）
 * 做盘符统一，其余请求**完全直通** —— 全局改写会波及别的测试链路
 * （曾导致 collab/server.test 9 例假失败），范围必须钉死。
 */
const REACT_FAMILY_DIR_RE = /[\\/]node_modules[\\/](react|react-dom|zustand)[\\/]/;

function isReactFamilyRequest(request, parent) {
  if (typeof request === 'string') {
    if (
      request === 'react' ||
      request === 'react-dom' ||
      request === 'zustand' ||
      request.startsWith('react/') ||
      request.startsWith('react-dom/') ||
      request.startsWith('zustand/')
    ) {
      return true;
    }
  }
  const parentFile = parent && typeof parent.filename === 'string' ? parent.filename : '';
  return REACT_FAMILY_DIR_RE.test(parentFile);
}

Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
  if (!isReactFamilyRequest(request, parent)) {
    return origResolveFilename.call(this, request, parent, isMain, options);
  }
  const resolved = origResolveFilename.call(this, request, parent, isMain, options);
  // Windows：Node 原生链会 realpath 到真实盘符大小写（通常大写），
  // 而 pathe/vite 链保持小写。统一成大写，cache key 只剩一个。
  if (
    typeof resolved === 'string' &&
    resolved.length >= 2 &&
    resolved[1] === ':' &&
    resolved[0] >= 'a' &&
    resolved[0] <= 'z'
  ) {
    return resolved[0].toUpperCase() + resolved.slice(1);
  }
  return resolved;
};

// patch 之前可能已经产生了小写 key 的 entry（setup 自身依赖链）：
// 把它们迁移到对应的大写 key（若大写 key 已存在则让小写条目共享同一 module 对象），
// 保证后续命中两种形态都拿到同一实例。
// const cache = Module._cache;
// for (const key of Object.keys(cache)) {
//   if (
//     key.length >= 2 &&
//     key[1] === ':' &&
//     key[0] >= 'a' &&
//     key[0] <= 'z'
//   ) {
//     const upper = key[0].toUpperCase() + key.slice(1);
//     if (!cache[upper]) {
//       cache[upper] = cache[key];
//     } else {
//       cache[key] = cache[upper];
//     }
//   }
// }
