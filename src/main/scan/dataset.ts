/**
 * 数据集扫描 —— **纯 Node 逻辑，不依赖 electron / 数据库**。
 * 见 `src/main/scan/diagram.ts` 顶部关于「为什么单独一个文件」的说明。
 */
import { readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

/** 允许的数据类扩展名 */
export const DATA_EXT = new Set([
  '.csv',
  '.tsv',
  '.txt',
  '.xlsx',
  '.xls',
  '.json',
  '.parquet',
]);

/** 扫描深度与数量上限 */
const MAX_DEPTH = 5;
export const MAX_DATASETS = 200;

export interface DatasetFile {
  relPath: string;
  name: string;
  dir: string;
  ext: string;
  size: number;
  mtimeMs: number;
}

export function collectDataFiles(root: string): { files: DatasetFile[]; truncated: boolean } {
  // ── 第一步：只遍历、只收「候选路径」，**不在这里截断** ──
  // ⚠️ 原实现在 `walk` 里写着 `if (depth > MAX_DEPTH || out.length >= MAX_DATASETS) return;`
  //    并在循环里也 `return` —— 于是 `out` 是"**按遍历顺序**先撞上的 200 个"，
  //    `out.sort(...)` 是对这 200 个再排序。结果：**保留的不是"最近修改的 200 个"**。
  //    而 `DatabasePage` 直接展示这 200 条、且不读 `truncated`（既不提示也不按时间挑）
  //    ⇒ 项目里数据文件超过 200 个时，用户看到的是一批**较旧**的文件，
  //      刚放进项目里的那个（最新）反而**找不到**。这是可见缺陷。
  //    ⇒ 截断必须挪到**排序之后**：先全收，再排序，最后切片。
  const hits: { abs: string; ext: string }[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        walk(abs, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = extname(e.name).toLowerCase();
      if (!DATA_EXT.has(ext)) continue;
      hits.push({ abs, ext });
    }
  };

  walk(root, 0);

  // ── 第二步：取每个候选的大小/时间（要 mtime 才能排序） ──
  const all: DatasetFile[] = [];
  for (const { abs, ext } of hits) {
    let st: import('node:fs').Stats;
    try {
      st = statSync(abs);
    } catch {
      continue; // 扫描期间被删掉，跳过
    }
    const rel = relative(root, abs).replace(/\\/g, '/');
    const idx = rel.lastIndexOf('/');
    all.push({
      relPath: rel,
      name: rel.slice(idx + 1),
      dir: idx < 0 ? '' : rel.slice(0, idx + 1),
      ext,
      size: st.size,
      mtimeMs: st.mtimeMs,
    });
  }

  // ── 第三步：排序 → 切片 → 用**全量**判断有没有被截断 ──
  all.sort((a, b) => b.mtimeMs - a.mtimeMs);
  // ⚠️ `truncated` 回答的是「**是否真的还有没读完的**」。
  //    原来写的是 `out.length >= MAX_DATASETS`，而 `out.length` 永远 ≤ 200
  //    ⇒ 磁盘上**恰好 200 个**（一个都没丢）时也会报 `true`，等于骗用户"被截断了"。
  return { files: all.slice(0, MAX_DATASETS), truncated: all.length > MAX_DATASETS };
}
