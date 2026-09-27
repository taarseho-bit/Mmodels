/**
 * 流程图扫描 —— **纯 Node 逻辑，不依赖 electron / 数据库**。
 *
 * 为什么单独一个文件：
 *   验证脚本（`scripts/smoke.mjs` / `shots.mjs`）要 import 这段逻辑做真实断言。
 *   如果它留在 `ipc/diagram.ts` 里，而那个文件又 import `./file`，
 *   就会顺着 `./file → ../db → better-sqlite3` 把原生模块拖进 ESM bundle，
 *   运行时报 `Dynamic require of "fs" is not supported` —— 整个 bundle 起不来。
 *
 * 所以约定：**凡是要被验证脚本直接跑的逻辑，都必须能独立 import**，
 *   不碰 electron、不碰数据库。IPC 层只做「取参数 → 调这里 → 包结果」。
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** 最多返回多少张（对齐应用约定「流程图太多，只显示了最近修改的一部分」） */
export const MAX_DIAGRAMS = 60;
/** 扫描深度上限，避免在巨型目录里卡死 */
const MAX_DEPTH = 6;
/** 跳过的目录 */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.ipynb_checkpoints',
  'dist',
  'build',
  'out',
]);

export interface DiagramEntry {
  /** 源文件相对路径（.drawio） */
  relPath: string;
  /** 展示名（去掉扩展名） */
  name: string;
  /** 所在目录（相对路径，末尾带 /） */
  dir: string;
  /** 源文件修改时间 */
  sourceMtime: number;
  /** 导出图（PNG）相对路径，没有则 null */
  pngRelPath: string | null;
  /** 导出 PDF 相对路径，没有则 null */
  pdfRelPath: string | null;
  /**
   * 导出图比源文件旧 → 需要重新导出。
   * 源文件存在但没有任何导出图时也算「待导出」。
   */
  stale: boolean;
  /** 源文件大小 */
  size: number;
}

/**
 * 递归收集 `.drawio`。
 *
 * ⚠️ 这里**不能**按"已收集条数"提前退出。原来写的是
 *   `if (depth > MAX_DEPTH || out.length > MAX_DIAGRAMS * 4) return;`
 * 后果：一旦收够 240 条就**整棵子树不再进**，于是 `total = all.length` 少报。
 * 实测 305 张的目录树显示成"共 244 张"（`DiagramsPanel` 直接渲染这个数）。
 * 更糟的是它**与 readdir 顺序无关地稳定少报**——不是抖动，是稳定给出一个错的数字。
 *
 * 真正的开销边界是 **`MAX_DEPTH` + `SKIP_DIRS`**，不是条数：
 * 条数上限只该用在"最后返回多少条"（`all.slice(0, MAX_DIAGRAMS)`），
 * 不该用来决定"看不看得到"。要挑"最近修改的 60 张"，就必须知道全部候选的 mtime。
 */
function walk(root: string, dir: string, depth: number, out: string[]): void {
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
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(root, abs, depth + 1, out);
      continue;
    }
    if (e.isFile() && e.name.toLowerCase().endsWith('.drawio')) out.push(abs);
  }
}

/**
 * 导出图（同名 `.png` / `.pdf`）的修改时间；**没有可用的导出图**时返回 `null`。
 *
 * ⚠️ 三种"没有"都要挡住，`existsSync` 只能挡第一种（原实现就是只用了它）：
 *   1. **文件不存在**；
 *   2. **同名的是个目录** —— `x.drawio` 旁边恰好有个叫 `x.png` 的**目录**（导出时建了子目录、
 *      或用户手工整理过）。原实现会把它当成"已导出的图"：
 *        - `pngRelPath` 指向一个目录 ⇒ 面板拿它当图片路径，缩略图**永远加载不出来**；
 *        - `stale` 算成 `false` ⇒ 也**不会**提示"需要重新导出"。
 *      ⇒ 用户看到的是一张坏图 + 一个错的"已导出"状态，且没有任何提示。
 *   3. **`statSync` 读不到**（扫描期间被删掉、权限不足）—— 原实现这里**没有 try/catch**，
 *      会直接把异常抛出去 ⇒ **整个流程图面板"加载失败"**。
 *      对比源文件那次 `statSync(abs)` 是包了 try/catch 的（注释写着"扫描期间被删掉，跳过"），
 *      两处不对称，这里补齐。
 *
 * 返回时间戳而不是布尔：调用方要用 `mtimeMs` 判 `stale`，一次 `statSync` 拿两个信息，
 * 顺带避免"判了存在、再去 stat 又不存在"的二次竞态。
 */
function exportedAt(abs: string): number | null {
  try {
    const st = statSync(abs);
    return st.isFile() ? st.mtimeMs : null;
  } catch {
    return null;
  }
}

/** 收集项目里的全部流程图条目（按源文件修改时间倒序） */
export function collectDiagrams(root: string): { diagrams: DiagramEntry[]; total: number } {
  const hits: string[] = [];
  walk(root, root, 0, hits);

  const all: DiagramEntry[] = [];
  for (const abs of hits) {
    let st: import('node:fs').Stats;
    try {
      st = statSync(abs);
    } catch {
      continue; // 扫描期间被删掉，跳过
    }
    const rel = relative(root, abs).replace(/\\/g, '/');
    const base = abs.slice(0, -'.drawio'.length);

    const pngAbs = base + '.png';
    const pdfAbs = base + '.pdf';
    const pngMtime = exportedAt(pngAbs);
    const pdfMtime = exportedAt(pdfAbs);

    // 只要有一张导出图比源文件新，就算「已导出」
    const newestExport = Math.max(pngMtime ?? 0, pdfMtime ?? 0);
    const stale = newestExport === 0 || newestExport < st.mtimeMs;

    const idx = rel.lastIndexOf('/');
    all.push({
      relPath: rel,
      name: (idx < 0 ? rel : rel.slice(idx + 1)).replace(/\.drawio$/i, ''),
      dir: idx < 0 ? '' : rel.slice(0, idx + 1),
      sourceMtime: st.mtimeMs,
      pngRelPath: pngMtime === null ? null : relative(root, pngAbs).replace(/\\/g, '/'),
      pdfRelPath: pdfMtime === null ? null : relative(root, pdfAbs).replace(/\\/g, '/'),
      stale,
      size: st.size,
    });
  }

  all.sort((a, b) => b.sourceMtime - a.sourceMtime);
  return { diagrams: all.slice(0, MAX_DIAGRAMS), total: all.length };
}
