/**
 * 本地 HTTP 服务。
 *
 * ⚠️ 这是复刻原版的关键设计之一：
 *   原版把**核心业务 API 放在本地 HTTP 服务上，而不是全部塞进 IPC**。
 *   好处：
 *     1. 可用 curl / Postman 直接调试，二次开发极其友好
 *     2. 渲染层、未来的移动端、外部工具可以共用同一套 API
 *     3. 流式响应天然适合 SSE，比 IPC 推送更好处理背压
 *
 *   安全：随机端口 + 随机 token，token 通过 preload 注入渲染层。
 *   所有请求必须带 `x-mathmodel-token`，否则 401。
 *   只监听 127.0.0.1，不暴露到局域网。
 */
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';

export interface ServerInfo {
  port: number;
  token: string;
  baseUrl: string;
}

export interface ServerDeps {
  /** 由 main 注入的各个 API 分组 */
  registerRoutes: (app: Hono) => void;
  debug?: boolean;
}

export class LocalServer {
  private server: Server | null = null;
  private info: ServerInfo | null = null;

  getInfo(): ServerInfo | null {
    return this.info;
  }

  async start(deps: ServerDeps): Promise<ServerInfo> {
    if (this.info) return this.info;

    const token = randomBytes(24).toString('hex');
    const app = new Hono();

    // 只允许本机渲染层访问
    app.use(
      '*',
      cors({
        origin: (origin) => {
          // electron 渲染层在 dev 下是 http://localhost:5173，
          // 生产下是 file:// (origin 为 null)。两者都放行，但必须带 token。
          if (!origin) return '*';
          if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
            return origin;
          }
          return null;
        },
        allowHeaders: ['content-type', 'x-mathmodel-token'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      }),
    );

    // ── 鉴权中间件 ──
    app.use('*', async (c, next) => {
      // 健康检查不需要 token
      if (c.req.path === '/health') return next();
      const provided = c.req.header('x-mathmodel-token');
      if (provided !== token) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      return next();
    });

    app.get('/health', (c) =>
      c.json({ ok: true, name: 'mmodels-desktop', ts: Date.now() }),
    );

    // 由外部注册业务路由
    deps.registerRoutes(app);

    // ── 启动 ──
    const port = await new Promise<number>((resolve, reject) => {
      const srv = serve(
        { fetch: app.fetch, hostname: '127.0.0.1', port: 0 },
        (info) => {
          this.server = (info as unknown as { server: Server }).server ?? null;
          resolve(info.port);
        },
      );
      srv.on?.('error', reject);
    });

    this.info = { port, token, baseUrl: `http://127.0.0.1:${port}` };

    if (deps.debug) {
      console.log(`[server] listening on ${this.info.baseUrl}`);
    }
    return this.info;
  }

  async stop(): Promise<void> {
    this.server?.close();
    this.server = null;
    this.info = null;
  }
}
