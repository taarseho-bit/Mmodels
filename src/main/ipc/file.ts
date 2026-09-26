/**
 * 文件操作 IPC。
 *
 * 安全要点：**所有路径必须落在项目根目录内**。
 * 渲染层传来的相对路径要先 resolve 再校验前缀，
 * 否则一个 `../../..` 就能读写用户整个硬盘。
 */
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { join, resolve, relative, isAbsolute, extname, dirname, basename, parse } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, unlinkSync, cpSync } from 'node:fs';
import { IPC, type FileNode, type FilePreview, type PdfInfo } from '@shared/types';
import { mediaMime, mediaUrlFor } from '../media/protocol';
import { getDb } from '../db';
import { getSettings } from '../store/config';
import { safeWrap, type IpcContext } from './index';

/** 单次预览的最大字节数 —— 超过就只给提示，不往渲染层塞大文件 */
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
/** 目录树最多遍历这么多节点，防止 node_modules 之类卡死界面 */
const TREE_MAX_NODES = 4000;
/** 目录树深度上限 */
const TREE_MAX_DEPTH = 8;

const TEXT_EXTS = new Set([
  '.txt', '.md', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.R', '.r', '.m', '.tex', '.bib', '.yml', '.yaml', '.toml',
  '.csv', '.tsv', '.xml', '.html', '.css', '.sh', '.ps1', '.sql', '.c', '.cpp', '.h',
]);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
/** 音视频：走 mm-media:// 流式协议，不内联 base64（见 main/media/protocol.ts） */
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']);

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.idea', '.vscode']);

/**
 * 保存对话框的扩展名过滤器：只保留当前产品支持的文件类型和筛选语义：
 *
 * 项目契约按**默认文件名的扩展名**挑过滤器，所以用户看到的是「JSON 文件」而不是「所有文件」；
 * 不认识就退成 `All Files`。
 */
const SAVE_FILTERS: Record<string, { name: string; extensions: string[] }> = {
  '.json': { name: 'JSON', extensions: ['json'] },
  '.html': { name: 'HTML', extensions: ['html'] },
  '.zip': { name: 'ZIP', extensions: ['zip'] },
};

/** 按默认文件名的扩展名挑过滤器；不认识就退成项目契约的 All Files */
function saveFiltersFor(defaultPath: string): Array<{ name: string; extensions: string[] }> {
  return [SAVE_FILTERS[extname(defaultPath).toLowerCase()] ?? { name: 'All Files', extensions: ['*'] }];
}

/** 把用户给的相对路径安全地解析到项目根内 */
function safeJoin(rootAbs: string, relPath: string): string {
  if (isAbsolute(relPath)) {
    // 绝对路径：必须已经在项目根内
    const abs = resolve(relPath);
    const rel = relative(rootAbs, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('路径超出项目目录范围');
    }
    return abs;
  }
  const abs = resolve(rootAbs, relPath);
  const rel = relative(rootAbs, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('路径超出项目目录范围');
  }
  return abs;
}

function currentProjectRoot(): string {
  const id = getSettings().recentProjectId;
  if (!id) throw new Error('尚未打开任何项目');
  const row = getDb().prepare<[string], { root: string }>('SELECT root FROM projects WHERE id = ?').get(id);
  if (!row) throw new Error('当前项目不存在');
  return row.root;
}

function buildTree(dirAbs: string, rootAbs: string, depth: number, counter: { n: number }): FileNode[] {
  if (depth > TREE_MAX_DEPTH || counter.n >= TREE_MAX_NODES) return [];
  let entries: string[];
  try {
    entries = readdirSync(dirAbs);
  } catch {
    return [];
  }

  const nodes: FileNode[] = [];
  for (const name of entries) {
    if (counter.n >= TREE_MAX_NODES) break;
    // 隐藏目录一律不展示，但**我们的配置目录要露出来**：
    // `.mathmodel` 是合法名（与项目契约一致），`.mmodels` 是早期版本的遗留名 ——
    // 它只读兼容、迁移时也不删，所以也得让用户看得见（否则用户以为数据没了）。
    if (name.startsWith('.') && name !== '.mathmodel' && name !== '.mmodels') continue;
    if (SKIP_DIRS.has(name)) continue;

    const full = join(dirAbs, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    counter.n += 1;

    const relPath = relative(rootAbs, full).split('\\').join('/');
    if (st.isDirectory()) {
      nodes.push({
        name,
        relPath,
        isDirectory: true,
        size: 0,
        mtimeMs: st.mtimeMs,
        children: buildTree(full, rootAbs, depth + 1, counter),
      });
    } else {
      nodes.push({
        name,
        relPath,
        isDirectory: false,
        size: st.size,
        mtimeMs: st.mtimeMs,
      });
    }
  }

  // 目录在前，同类按名称排
  nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  return nodes;
}

function makePreview(abs: string, relPath: string): FilePreview {
  const st = statSync(abs);
  const ext = extname(abs).toLowerCase();
  const size = st.size;

  // 音视频：只回一个流式 URL，二进制不进 IPC 响应（几 MB 的文件 base64 会炸内存）
  if (AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)) {
    return {
      kind: AUDIO_EXTS.has(ext) ? 'audio' : 'video',
      relPath,
      size,
      mtimeMs: st.mtimeMs,
      mime: mediaMime(ext),
      mediaUrl: mediaUrlFor(relPath),
    };
  }

  if (IMAGE_EXTS.has(ext)) {
    if (size > 8 * 1024 * 1024) {
      return { kind: 'too-large', relPath, size };
    }
    const buf = readFileSync(abs);
    const mime =
      ext === '.png' ? 'image/png'
      : ext === '.svg' ? 'image/svg+xml'
      : ext === '.gif' ? 'image/gif'
      : ext === '.webp' ? 'image/webp'
      : ext === '.bmp' ? 'image/bmp'
      : 'image/jpeg';
    return { kind: 'image', relPath, size, dataUrl: `data:${mime};base64,${buf.toString('base64')}`, mime };
  }

  if (ext === '.pdf') {
    if (size > 30 * 1024 * 1024) return { kind: 'too-large', relPath, size };
    const buf = readFileSync(abs);
    return {
      kind: 'pdf',
      relPath,
      size,
      dataUrl: `data:application/pdf;base64,${buf.toString('base64')}`,
      mime: 'application/pdf',
    };
  }

  if (TEXT_EXTS.has(ext)) {
    if (size > PREVIEW_MAX_BYTES) {
      // 大文件只读头部，并明确标注已截断
      const buf = readFileSync(abs).subarray(0, PREVIEW_MAX_BYTES);
      return {
        kind: 'text',
        relPath,
        size,
        mtimeMs: st.mtimeMs,
        text: buf.toString('utf8'),
        truncated: true,
      };
    }
    return { kind: 'text', relPath, size, mtimeMs: st.mtimeMs, text: readFileSync(abs, 'utf8'), truncated: false };
  }

  return { kind: 'binary', relPath, size };
}

/** 读取 PDF 页数，不把 PDF 内容传到渲染层。优先 pdfinfo，缺失时用目录页对象做保守回退。 */
function readPdfInfo(abs: string, relPath: string): PdfInfo {
  const size = statSync(abs).size;
  let pages: number | null = null;
  try {
    const text = execFileSync('pdfinfo', [abs], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const match = text.match(/^Pages:\s*(\d+)\s*$/mi);
    if (match) pages = Number(match[1]);
  } catch {
    // 没有 pdfinfo 时继续用轻量回退，不把环境缺失显示成软件错误。
    try {
      const head = readFileSync(abs).subarray(0, Math.min(size, 20 * 1024 * 1024)).toString('latin1');
      const matches = head.match(/\/Type\s*\/Page\b/g);
      if (matches?.length) pages = matches.length;
    } catch { /* 仅返回文件信息，页数显示为待核验 */ }
  }
  return { relPath, pages: Number.isFinite(pages) && (pages ?? 0) > 0 ? pages : null, size };
}

export function registerFileHandlers(ctx: IpcContext): void {
  ipcMain.handle(
    IPC.FILE_TREE,
    safeWrap(() => {
      const root = currentProjectRoot();
      return buildTree(root, root, 0, { n: 0 });
    }, '读取文件树'),
  );

  ipcMain.handle(
    IPC.FILE_READ_PREVIEW,
    safeWrap((_e, relPath: string) => {
      const root = currentProjectRoot();
      const abs = safeJoin(root, relPath);
      if (!existsSync(abs)) throw new Error(`文件不存在：${relPath}`);
      return makePreview(abs, relPath);
    }, '预览文件'),
  );

  ipcMain.handle(
    IPC.FILE_PDF_INFO,
    safeWrap((_e, relPath: string) => {
      const root = currentProjectRoot();
      const abs = safeJoin(root, relPath);
      if (!existsSync(abs)) throw new Error(`文件不存在：${relPath}`);
      if (extname(abs).toLowerCase() !== '.pdf') throw new Error('只能读取 PDF 页数');
      return readPdfInfo(abs, relPath);
    }, '读取 PDF 页数'),
  );

  ipcMain.handle(
    IPC.FILE_SELECT_DIR,
    safeWrap(async () => {
      const result = await dialog.showOpenDialog(ctx.getMainWindow() ?? undefined!, {
        title: '选择目录',
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? null : result.filePaths[0];
    }, '选择目录'),
  );

  ipcMain.handle(
    IPC.FILE_SELECT_FILES,
    safeWrap(async () => {
      const result = await dialog.showOpenDialog(ctx.getMainWindow() ?? undefined!, {
        title: '选择文件',
        properties: ['openFile', 'multiSelections'],
      });
      return result.canceled ? null : result.filePaths;
    }, '选择文件'),
  );

  ipcMain.handle(
    IPC.FILE_WRITE,
    safeWrap((_e, relPath: string, content: string) => {
      const root = currentProjectRoot();
      const abs = safeJoin(root, relPath);
      writeFileSync(abs, content, 'utf8');
      return true;
    }, '写入文件'),
  );

  ipcMain.handle(
    IPC.FILE_RENAME,
    safeWrap((_e, fromRel: string, toRel: string) => {
      const root = currentProjectRoot();
      const from = safeJoin(root, fromRel);
      const to = safeJoin(root, toRel);
      renameSync(from, to);
      return true;
    }, '重命名'),
  );

  ipcMain.handle(
    IPC.FILE_DELETE,
    safeWrap((_e, relPath: string) => {
      const root = currentProjectRoot();
      const abs = safeJoin(root, relPath);
      // 不允许删项目根本身
      if (resolve(abs) === resolve(root)) throw new Error('不能删除项目根目录');
      rmSync(abs, { recursive: true, force: true });
      return true;
    }, '删除文件'),
  );

  ipcMain.handle(
    IPC.FILE_DUPLICATE,
    safeWrap((_e, relPath: string) => {
      const root = currentProjectRoot();
      const source = safeJoin(root, relPath);
      if (!existsSync(source)) throw new Error(`文件不存在：${relPath}`);
      if (resolve(source) === resolve(root)) throw new Error('不能复制项目根目录');

      const dir = dirname(source);
      const parsed = parse(basename(source));
      let index = 1;
      let target = join(dir, `${parsed.name}-副本${parsed.ext}`);
      while (existsSync(target) && index < 10000) {
        index += 1;
        target = join(dir, `${parsed.name}-副本-${index}${parsed.ext}`);
      }
      if (existsSync(target)) throw new Error('无法创建副本：同名文件过多');
      cpSync(source, target, { recursive: true, errorOnExist: true });
      return { path: relative(root, target).split('\\').join('/'), name: basename(target) };
    }, '创建文件副本'),
  );

  ipcMain.handle(
    IPC.FILE_SAVE_TEXT,
    safeWrap(async (_e, defaultName: string, content: string) => {
      const result = await dialog.showSaveDialog(ctx.getMainWindow() ?? undefined!, {
        title: '保存文件',
        defaultPath: defaultName,
        // 对齐项目契约：按扩展名挑过滤器（导出 .json 时显示「JSON」而不是「所有文件」）
        filters: saveFiltersFor(defaultName),
      });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, content, 'utf8');
      return result.filePath;
    }, '保存文本文件'),
  );

  ipcMain.handle(
    IPC.FILE_SAVE_BINARY,
    safeWrap(async (_e, defaultName: string, base64: string) => {
      const result = await dialog.showSaveDialog(ctx.getMainWindow() ?? undefined!, {
        title: '保存文件',
        defaultPath: defaultName,
      });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
      return result.filePath;
    }, '保存二进制文件'),
  );

  /**
   * 打开外部文本文件，用于本地会话导入和项目资料读取。
   * 返回 `{path, content}`；用户取消或读取失败返回 null。
   */
  ipcMain.handle(
    IPC.FILE_OPEN_TEXT,
    safeWrap(async () => {
      const result = await dialog.showOpenDialog(ctx.getMainWindow() ?? undefined!, {
        title: '打开文件',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const p = result.filePaths[0];
      try {
        return { path: p, content: readFileSync(p, 'utf8') };
      } catch (err) {
        console.error('[file] 读取导入文件失败:', err);
        return null;
      }
    }, '打开文本文件'),
  );

  /**
   * 把一段 HTML 渲染成分享图（PNG）并保存 —— 对应项目契约 `saveShareImage`。
   *
   * 项目契约做法（逐位当前实现）：
   *   1. HTML 落到临时文件，起一个**隐藏** BrowserWindow（1640×800，2 倍缩放）
   *   2. 量出文档实际高度，把窗口撑成 1640 × min(2×scrollHeight, 16000)
   *      —— 这样整页一次截完，不会只截到可视区
   *   3. capturePage().toPNG() 写到用户选的保存位置
   *
   * ⚠️ 隐藏窗口 `show:false` + `backgroundThrottling:false`，
   *    否则离屏渲染可能被节流，截出来是空白。
   */
  ipcMain.handle(
    IPC.FILE_SAVE_SHARE_IMAGE,
    safeWrap(async (_e, payload: { defaultName?: string; html?: string; e2eAutoPath?: string } | string) => {
      // 兼容两种调用形态：对象（项目契约语义）或单字符串（html）
      const opts = typeof payload === 'string' ? { html: payload } : (payload ?? {});
      const defaultName = typeof opts.defaultName === 'string' ? opts.defaultName : 'share.png';
      const html = typeof opts.html === 'string' ? opts.html : '';

      // E2E 直通：自动化测试里原生对话框没人点会永久挂起 ——
      // 仅在 MATHMODEL_E2E=1 且显式传 e2eAutoPath 时跳过对话框直接落盘
      const e2eDirect =
        process.env.MATHMODEL_E2E === '1' && typeof opts.e2eAutoPath === 'string' && !!opts.e2eAutoPath;
      let filePath: string;
      if (e2eDirect) {
        filePath = opts.e2eAutoPath as string;
      } else {
        const result = await dialog.showSaveDialog(ctx.getMainWindow() ?? undefined!, {
          title: '保存分享图',
          defaultPath: defaultName,
          filters: [{ name: 'PNG 图片', extensions: ['png'] }],
        });
        if (result.canceled || !result.filePath) return null;
        filePath = result.filePath;
      }

      const tmp = join(tmpdir(), `mmodels-share-${Date.now()}.html`);
      writeFileSync(tmp, html, 'utf8');

      const win = new BrowserWindow({
        show: false,
        width: 1640,
        height: 800,
        frame: false,
        webPreferences: { sandbox: true, backgroundThrottling: false },
      });
      try {
        await win.loadFile(tmp);
        win.webContents.setZoomFactor(2);
        await new Promise((r) => setTimeout(r, 150));
        const scrollHeight = (await win.webContents.executeJavaScript(
          'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
        )) as number;
        const targetH = Math.min(Math.ceil(2 * scrollHeight), 16000);
        win.setSize(1640, targetH);
        await new Promise((r) => setTimeout(r, 250));
        const png = (await win.webContents.capturePage()).toPNG();
        writeFileSync(filePath, png);
        return { path: filePath };
      } finally {
        if (!win.isDestroyed()) win.destroy();
        try {
          unlinkSync(tmp);
        } catch {
          /* 临时文件清理失败无碍 */
        }
      }
    }, '保存分享图'),
  );
}

export { currentProjectRoot, safeJoin };
