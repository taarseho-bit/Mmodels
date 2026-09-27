/**
 * 数据集 IPC —— 支撑 `DatabasePage`。
 *
 * 职责：把外部文件**复制**进项目的数据目录。
 * （扫描逻辑在 `src/main/scan/dataset.ts`，纯 Node，可被验证脚本直接 import。）
 *
 * 设计要点：
 *  1. **导入 = 复制，不是引用**。应用约定说「导入 CSV/Excel 数据文件」，
 *     且项目目录要能整体拷走续作 —— 引用外部绝对路径会在换机后失效。
 *  2. **重名不覆盖**：自动加 `-1`、`-2` 后缀，避免用户的数据被静默替换。
 *  3. 只放行数据类扩展名，避免把 exe/脚本导进来当数据。
 */
import { ipcMain, dialog } from 'electron';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { IPC } from '@shared/types';
import { safeWrap, type IpcContext } from './index';
import { currentProjectRoot } from './file';
import { collectDataFiles, DATA_EXT } from '../scan/dataset';

/** 项目里存放数据的默认目录 */
const DATA_DIR = 'data';

/** 在目标目录里找一个不冲突的文件名 */
function uniqueName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const cand = `${stem}-${i}${ext}`;
    if (!existsSync(join(dir, cand))) return cand;
  }
  return `${stem}-${Date.now()}${ext}`;
}

export function registerDatasetHandlers(ctx: IpcContext): void {
  ipcMain.handle(
    IPC.DATASET_LIST,
    safeWrap(async () => {
      const root = currentProjectRoot();
      if (!existsSync(root)) return { files: [], truncated: false };
      return collectDataFiles(root);
    }, '扫描数据集'),
  );

  ipcMain.handle(
    IPC.DATASET_IMPORT,
    safeWrap(async () => {
      const root = currentProjectRoot();
      const win = ctx.getMainWindow();
      if (!win) return { imported: [], canceled: true };

      const r = await dialog.showOpenDialog(win, {
        title: '导入数据文件',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '数据文件', extensions: ['csv', 'tsv', 'txt', 'xlsx', 'xls', 'json', 'parquet'] },
          { name: '全部文件', extensions: ['*'] },
        ],
      });
      if (r.canceled || r.filePaths.length === 0) return { imported: [], canceled: true };

      const destDir = join(root, DATA_DIR);
      mkdirSync(destDir, { recursive: true });

      const imported: string[] = [];
      const skipped: string[] = [];
      for (const src of r.filePaths) {
        const ext = extname(src).toLowerCase();
        if (!DATA_EXT.has(ext)) {
          skipped.push(`${basename(src)}（不支持的类型）`);
          continue;
        }
        try {
          const target = uniqueName(destDir, basename(src));
          copyFileSync(src, join(destDir, target));
          imported.push(`${DATA_DIR}/${target}`);
        } catch (e) {
          skipped.push(`${basename(src)}（${e instanceof Error ? e.message : '复制失败'}）`);
        }
      }
      return { imported, skipped, canceled: false };
    }, '导入数据文件'),
  );
}
