/**
 * 音视频预览用的自定义协议 —— `mm-media://`。
 *
 * 为什么不用 data URL（像 image/pdf 那样内联 base64）：
 *   一段 30 秒的 mp4 就有几 MB，base64 还要再膨胀 33%，
 *   一次性塞进 IPC 响应会同时压爆主进程与渲染层内存，且无法拖动进度条。
 *
 * 为什么不用 `file://`：
 *   渲染层在 dev 下是 http://localhost:5173，打包后是 file:// 页面；
 *   直接给 file:// 会被 CSP（`media-src 'self' data: blob:`）挡掉，
 *   而且等于把「任意路径可读」暴露给渲染层。
 *
 * 方案：主进程注册 `mm-media` 协议，用 `net.fetch(pathToFileURL(...))` **流式**转发磁盘文件：
 *   - 不进内存（Chromium 按需读盘、支持 Range 拖动）
 *   - 每次都按「当前项目根目录」校验路径（复用 file.ts 的 safeJoin 规则）
 *   - 渲染层只拿到相对路径，绝对路径不出主进程
 */
import { protocol, net } from 'electron';
import { pathToFileURL } from 'node:url';
import { existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { currentProjectRoot, safeJoin } from '../ipc/file';

/** 协议名（渲染层 URL 前缀） */
export const MEDIA_SCHEME = 'mm-media';

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

/** 扩展名 → MIME；未知扩展名回退 octet-stream */
export function mediaMime(ext: string): string {
  return MIME[ext.toLowerCase()] ?? 'application/octet-stream';
}

/** 把项目相对路径编成渲染层可用的 URL（host 固定为 `file`，路径做 URL 编码） */
export function mediaUrlFor(relPath: string): string {
  const posix = relPath.split('\\').join('/');
  const encoded = posix
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${MEDIA_SCHEME}://file/${encoded}`;
}

/**
 * 必须在 `app.whenReady()` **之前**调用 —— 声明协议特权。
 * `stream: true` 让 <audio>/<video> 能按 Range 分段取流（否则大视频无法拖动进度）。
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
    },
  ]);
}

/** app ready 之后注册处理器 */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      // URL 形态：mm-media://file/<项目相对路径>
      const url = new URL(request.url);
      const relRaw = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (!relRaw) return new Response('bad request', { status: 400 });

      // 路径校验：必须落在当前项目根内（与 file:* IPC 同一套规则）
      const root = currentProjectRoot();
      const abs = safeJoin(root, relRaw);
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        return new Response('not found', { status: 404 });
      }

      // 转发 Range —— 没这一步 <video> 拖进度条会整段重下
      const range = request.headers.get('range');
      const res = await net.fetch(pathToFileURL(abs).toString(), {
        headers: range ? { Range: range } : undefined,
      });
      // 补上正确 MIME，否则 Chromium 可能拒绝播放（尤其 .mkv / .flac）
      const headers = new Headers(res.headers);
      headers.set('Content-Type', mediaMime(extname(abs)));
      headers.set('Cache-Control', 'no-store');
      return new Response(res.body, { status: res.status, headers });
    } catch {
      // 项目未打开 / 路径越界 / 读盘失败 —— 一律 404，由渲染层显示「无法播放」文案
      return new Response('not found', { status: 404 });
    }
  });
}
