/** Immutable per-provider/model routes; switching another conversation cannot stop this one. */
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { ProviderConfig } from '@shared/types';
import { createAnthropicBridgeHandler, type BridgeOptions } from './bridge';
export class BridgeRegistry {
  private routes = new Map<string, Promise<{ server: Server; url: string }>>();
  private lastUrl: string | null = null;
  async ensureFor(provider: ProviderConfig, selection: { model: string; effort?: string; disableThinking?: boolean }): Promise<string | null> {
    if (provider.apiFormat === 'anthropic') return null;
    const opts: BridgeOptions = { openaiBaseUrl: provider.baseUrl, apiKey: provider.apiKey,
      forceModel: selection.model, effort: selection.effort, disableThinking: selection.disableThinking };
    const key = createHash('sha256').update(JSON.stringify([provider.id, opts])).digest('hex');
    let pending = this.routes.get(key);
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        const handler = createAnthropicBridgeHandler(opts);
        const server = createServer((req, res) => { void handler(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }).catch(() => res.destroy()); });
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          if (!address || typeof address === 'string') { server.close(); reject(new Error('模型接口未能启动')); return; }
          resolve({ server, url: `http://127.0.0.1:${address.port}` });
        });
      });
      this.routes.set(key, pending);
      void pending.catch(() => this.routes.delete(key));
    }
    return this.lastUrl = (await pending).url;
  }
  getBaseUrl(): string | null { return this.lastUrl; }
  async stop(): Promise<void> {
    const routes = [...this.routes.values()]; this.routes.clear(); this.lastUrl = null;
    await Promise.all(routes.map(async pending => {
      try { const { server } = await pending; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } catch { /* failed startup */ }
    }));
  }
}
export const bridgeRegistry = new BridgeRegistry();
