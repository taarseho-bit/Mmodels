/**
 * 模型供应商 IPC。
 *
 * 包含「测试连通性」—— 这是原版也有、而且极其实用的功能：
 * 用户填完密钥点一下就知道通不通，而不是跑一次完整任务才发现配错。
 */
import { ipcMain } from 'electron';
import { IPC, type ProviderConfig } from '@shared/types';
import {
  listProviders,
  upsertProvider,
  deleteProvider,
  findProvider,
} from '../store/config';
import { PRESET_PROVIDERS } from '@shared/providers';
import { safeWrap, type IpcContext } from './index';

/**
 * 连通性测试。
 *
 * 策略：直接打供应商的 models 端点（OpenAI 协议）或 messages 端点（Anthropic 协议）。
 * 不经过 SDK —— 因为 SDK 启动一次要几秒且会真的跑一轮对话，
 * 而我们只是想验证「地址 + 密钥」对不对。
 */
async function testProvider(p: ProviderConfig): Promise<{ ok: boolean; detail: string }> {
  const base = p.baseUrl.replace(/\/+$/, '');
  const timeout = AbortSignal.timeout(20000);

  try {
    if (p.apiFormat === 'openai') {
      const url = base.endsWith('/v1') ? `${base}/models` : `${base}/models`;
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${p.apiKey}` },
        signal: timeout,
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { data?: unknown[] } | null;
        const count = Array.isArray(data?.data) ? data.data.length : 0;
        return { ok: true, detail: `连接成功${count ? `，可用模型 ${count} 个` : ''}` };
      }
      return { ok: false, detail: `HTTP ${res.status}：${(await res.text().catch(() => '')).slice(0, 200)}` };
    }

    // Anthropic 协议：用 messages 端点发一个极小请求
    const url = `${base.endsWith('/v1') ? base : `${base}/v1`}/messages`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (p.anthropicAuthMode === 'authToken') {
      headers['authorization'] = `Bearer ${p.apiKey}`;
    } else {
      headers['x-api-key'] = p.apiKey;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: p.models?.[0] ?? 'claude-3-5-haiku-20241022',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: timeout,
    });
    if (res.ok) {
      return {
        ok: true,
        detail: '连接成功',
      };
    }
    return { ok: false, detail: `HTTP ${res.status}：${(await res.text().catch(() => '')).slice(0, 200)}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `无法连接：${msg}` };
  }
}

export function registerLlmHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.LLM_LIST_PROVIDERS,
    safeWrap(() => listProviders(), '读取供应商列表'),
  );

  ipcMain.handle(
    IPC.LLM_UPSERT_PROVIDER,
    safeWrap((_e, p: ProviderConfig) => upsertProvider(p), '保存供应商'),
  );

  ipcMain.handle(
    IPC.LLM_DELETE_PROVIDER,
    safeWrap((_e, id: string) => deleteProvider(id), '删除供应商'),
  );

  ipcMain.handle(
    IPC.LLM_PRESETS,
    safeWrap(() => PRESET_PROVIDERS, '读取预设'),
  );

  ipcMain.handle(
    IPC.LLM_TEST_PROVIDER,
    safeWrap((_e, id: string) => {
      const p = findProvider(id);
      if (!p) throw new Error('供应商不存在');
      return testProvider(p);
    }, '测试连通性'),
  );

  ipcMain.handle(
    IPC.LLM_LIST_MODELS,
    // 2026-09-25：第三个参数支持**未保存**的内联配置 —— 用户刚填完 baseUrl + apiKey
    // 就能立刻拉模型列表，不用先保存再回头点（实机反馈「自动分析有哪些模型可用」）。
    safeWrap(async (_e, id: string, refresh = false, inline?: ProviderConfig) => {
      const p = findProvider(id) ?? (inline?.baseUrl ? inline : null);
      if (!p) throw new Error('供应商不存在');
      // 已配置过模型列表的直接返回（内联模式永远现拉）
      if (p.models?.length && !refresh && !inline) return p.models;
      return fetchRemoteModelList(p);
    }, '拉取模型列表'),
  );
}

/** 从远端接口拉模型清单：OpenAI 兼容走 GET /models，Anthropic 兼容走 GET /v1/models */
async function fetchRemoteModelList(p: ProviderConfig): Promise<string[]> {
  // OpenAI 兼容接口：GET /models
  if (p.apiFormat === 'openai') {
    const base = p.baseUrl.replace(/\/+$/, '');
    try {
      const res = await fetch(`${base}/models`, {
        headers: { authorization: `Bearer ${p.apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id?: string }> };
        return (data.data ?? []).map((m) => m.id).filter((x): x is string => !!x);
      }
    } catch {
      /* 拉不到就返回空，让用户手填 */
    }
  }
  // Anthropic 官方及兼容接口：GET /v1/models
  if (p.apiFormat === 'anthropic') {
    const base = p.baseUrl.replace(/\/+$/, '');
    const root = base.endsWith('/v1') ? base : `${base}/v1`;
    const headers = (): Record<string, string> => {
      const h: Record<string, string> = { 'anthropic-version': '2023-06-01' };
      if (p.anthropicAuthMode === 'authToken') h.authorization = `Bearer ${p.apiKey}`;
      else h['x-api-key'] = p.apiKey;
      return h;
    };
    try {
      const res = await fetch(`${root}/models`, { headers: headers(), signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id?: string }> };
        const ids = (data.data ?? []).map((m) => m.id).filter((x): x is string => !!x);
        if (ids.length) return ids;
      }
    } catch {
      /* 落到下面的回退 */
    }
    // 2026-09-25 回退：很多「Anthropic 兼容」端点并不提供 /models（如 DeepSeek 的
    // /anthropic 路径）——试源站的 OpenAI 风格 /models，把真实可用的模型捞回来。
    try {
      const origin = new URL(base).origin;
      const authVariants: Record<string, string>[] = [
        { authorization: `Bearer ${p.apiKey}` },
        { 'x-api-key': p.apiKey },
      ];
      for (const url of [`${origin}/v1/models`, `${origin}/models`]) {
        for (const h of authVariants) {
          try {
            const res = await fetch(url, { headers: h, signal: AbortSignal.timeout(12000) });
            if (res.ok) {
              const data = (await res.json()) as { data?: Array<{ id?: string }> };
              const ids = (data.data ?? []).map((m) => m.id).filter((x): x is string => !!x);
              if (ids.length) return ids;
            }
          } catch {
            /* 下一个组合 */
          }
        }
      }
    } catch {
      /* base 不是合法 URL 就彻底放弃 */
    }
  }
  return [];
}
