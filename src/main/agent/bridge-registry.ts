/**
 * 协议桥注册中心。
 *
 * 职责：当用户选中的供应商是 **OpenAI 协议**时，起一个本地小 HTTP 服务，
 * 它对外说 Anthropic Messages API、对内转成 OpenAI Chat Completions。
 * 然后我们把 `ANTHROPIC_BASE_URL` 指向这个本地地址，
 * Claude Agent SDK 就完全不知道自己连的是谁。
 *
 * 为什么要做成「注册中心」而不是一个函数：
 *   1. 供应商可能中途切换（用户改设置）→ 需要能重新起
 *   2. 桥的端口只有渲染层通过 IPC 读到，需要一个稳定的读取点
 *   3. 应用退出时要能统一关掉
 *
 * 生命周期：
 *   ensureFor(provider)  → 若该供应商需要桥，且参数变了，就重启
 *   getBaseUrl()         → 拿当前桥的地址（无桥时返回 null）
 *   stop()               → 退出时调用
 */
import { createServer, type Server } from 'node:http';
import type { ProviderConfig } from '@shared/types';
import { createAnthropicBridgeHandler, type BridgeOptions } from './bridge';

interface ActiveBridge {
  server: Server;
  port: number;
  /** 用参数指纹判断要不要重启 */
  fingerprint: string;
}

function fingerprintOf(p: ProviderConfig): string {
  return `${p.id}|${p.baseUrl}|${p.apiKey}`;
}

class BridgeRegistry {
  private active: ActiveBridge | null = null;

  /**
   * 确保当前有一个合适的桥在跑。
   * - 供应商是 anthropic 协议 → 关掉已有的桥，返回 null（不需要）
   * - 供应商是 openai 协议 → 起桥（或复用）
   */
  async ensureFor(provider: ProviderConfig, debug = false): Promise<string | null> {
    if (provider.apiFormat === 'anthropic') {
      await this.stop();
      return null;
    }

    const fp = fingerprintOf(provider);
    if (this.active && this.active.fingerprint === fp) {
      return `http://127.0.0.1:${this.active.port}`;
    }

    await this.stop();

    const opts: BridgeOptions = {
      openaiBaseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      forceModel: provider.models?.[0],
      debug,
    };
    const handler = createAnthropicBridgeHandler(opts);

    const server = createServer((req, res) => {
      void handler(req, res).then((handled) => {
        if (!handled) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
        }
      });
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('无法获取桥的端口'));
      });
    });

    this.active = { server, port, fingerprint: fp };
    if (debug) console.log(`[bridge] listening on http://127.0.0.1:${port} → ${provider.baseUrl}`);
    return `http://127.0.0.1:${port}`;
  }

  getBaseUrl(): string | null {
    return this.active ? `http://127.0.0.1:${this.active.port}` : null;
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    const srv = this.active.server;
    this.active = null;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
}

export const bridgeRegistry = new BridgeRegistry();
