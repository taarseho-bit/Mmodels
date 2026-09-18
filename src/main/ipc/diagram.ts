/**
 * 流程图（draw.io）IPC —— 支撑 `DiagramsPanel`。
 *
 * ⚠️ 扫描逻辑在 `src/main/scan/diagram.ts`（纯 Node，可被验证脚本直接 import）。
 *    本文件只做「取项目根 → 调扫描 → 包 IPC 结果」。
 *    不要把扫描逻辑搬回来 —— 一 import 本文件就会顺着
 *    `./file → ../db → better-sqlite3` 把原生模块拖进 ESM bundle。
 */
import { ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { IPC } from '@shared/types';
import { safeWrap, type IpcContext } from './index';
import { currentProjectRoot } from './file';
import { collectDiagrams } from '../scan/diagram';

export function registerDiagramHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.DIAGRAM_LIST,
    safeWrap(async () => {
      const root = currentProjectRoot();
      if (!existsSync(root)) return { diagrams: [], total: 0, truncated: false };
      const r = collectDiagrams(root);
      return { ...r, truncated: r.total > r.diagrams.length };
    }, '扫描流程图'),
  );
}
