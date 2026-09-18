/// <reference types="vite/client" />

/**
 * Vite 客户端类型：提供 `import.meta.glob` / `import.meta.env` 等。
 * 渲染层用了 `import.meta.glob` 来批量载入科研绘图模板缩略图，
 * 没有这个引用 tsc 会报 TS2339。
 */

/** 图片资源 URL（vite 静态资源导入） */
declare module '*.webp' {
  const src: string;
  export default src;
}
declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
