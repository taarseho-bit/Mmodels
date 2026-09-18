/**
 * 内置供应商预设。
 *
 * 只放**已验证**的端点与模型名；不确定的一律用注释标注，不编造。
 * 新增预设时的检查清单：
 *   1. baseUrl 是否真的是 SDK 期望的形态（Anthropic 协议要精确到 /v1 前缀）
 *   2. 模型名是否真实存在
 *   3. 是否需要特殊 header（如某些厂商要 anthropic-version / user-agent 绕过）
 */
import type { PresetProvider } from './types';

export const PRESET_PROVIDERS: PresetProvider[] = [
  // ── Anthropic 官方 ──────────────────────────────────────────
  {
    key: 'anthropic',
    name: 'Anthropic 官方',
    apiFormat: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5-20250929',
    docsUrl: 'https://docs.anthropic.com',
    note: '官方直连，需要海外网络环境',
  },

  // ── MiniMax（原版默认走这家）────────────────────────────────
  {
    key: 'minimax',
    name: 'MiniMax',
    apiFormat: 'anthropic',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    defaultModel: 'MiniMax-M2',
    docsUrl: 'https://platform.minimaxi.com',
    note: '国内可直连，提供 Anthropic 兼容端点',
  },

  // ── DeepSeek ───────────────────────────────────────────────
  {
    key: 'deepseek',
    name: 'DeepSeek',
    apiFormat: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    docsUrl: 'https://platform.deepseek.com',
    note: '⚠️ V4 系列默认开思考(high)会烧光输出预算导致正文为空，务必在设置里关掉思考',
  },

  // ── 智谱 GLM ───────────────────────────────────────────────
  {
    key: 'zhipu',
    name: '智谱 GLM',
    apiFormat: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.6',
    docsUrl: 'https://open.bigmodel.cn',
    note: '注意端点不是 /v1 结尾，是 /api/paas/v4',
  },

  // ── 通义千问 ───────────────────────────────────────────────
  {
    key: 'dashscope',
    name: '通义千问',
    apiFormat: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3-max',
    docsUrl: 'https://help.aliyun.com/zh/model-studio',
    note: '兼容模式端点',
  },

  // ── Kimi ───────────────────────────────────────────────────
  {
    key: 'moonshot',
    name: '月之暗面 Kimi',
    apiFormat: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2-turbo-preview',
    docsUrl: 'https://platform.moonshot.cn',
  },

  // ── 自定义 ─────────────────────────────────────────────────
  {
    key: 'ollama',
    name: 'Ollama（本地）',
    apiFormat: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5:14b',
    docsUrl: 'https://ollama.com',
    note: '本地推理，apiKey 随便填',
  },
];

/** 供应商 key → 预设 */
export const PRESET_BY_KEY = new Map(PRESET_PROVIDERS.map((p) => [p.key, p]));
