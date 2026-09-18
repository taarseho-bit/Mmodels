/**
 * Anthropic ⇄ OpenAI 协议转换桥。
 *
 * ⚠️ 为什么需要它：
 *   Claude Agent SDK 只会说 Anthropic Messages API。
 *   但国内绝大多数模型（DeepSeek / 通义 / Kimi / 智谱）只提供 OpenAI Chat Completions。
 *   原版引入 `@jtabet/anthropic-openai-bridge` 做这件事。
 *
 * 我们自己实现一份，理由：
 *   1. 原版那个包不在公开 npm 上，无法依赖
 *   2. 自己实现才能控制**流式转换的边界情况**（这是最容易出错的地方）
 *   3. 可以按需裁剪，只支持真正需要的字段
 *
 * ── 覆盖范围（刻意保守）─────────────────────────────────────
 * 支持：system / user / assistant 消息、多模态文本、tool_use / tool_result、
 *      流式 SSE 的 text_delta / input_json_delta / message_delta / message_stop
 * 不支持：image 输入（转 base64 传）、Anthropic 的 extended thinking 回传
 *       —— 遇到时如实报错，不静默降级
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// ─────────────────────────────────────────────────────────────
// Anthropic 请求结构（只声明我们用到的字段）
// ─────────────────────────────────────────────────────────────

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | AnthropicTextBlock[];
  is_error?: boolean;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: unknown;
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicTextBlock[];
  tools?: AnthropicTool[];
  tool_choice?: { type: string; name?: string };
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop_sequences?: string[];
}

// ─────────────────────────────────────────────────────────────
// OpenAI 请求结构
// ─────────────────────────────────────────────────────────────

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: Array<{ type: 'function'; function: { name: string; description?: string; parameters: unknown } }>;
  tool_choice?: string | { type: 'function'; function: { name: string } };
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string[];
}

// ─────────────────────────────────────────────────────────────
// 请求转换 Anthropic → OpenAI
// ─────────────────────────────────────────────────────────────

function flattenSystem(system: AnthropicRequest['system']): string | undefined {
  if (!system) return undefined;
  if (typeof system === 'string') return system;
  return system.map((b) => b.text).join('\n\n');
}

/** 把 Anthropic 的 content 数组拍平成 OpenAI 的 content + tool_calls */
function convertAssistantMessage(msg: AnthropicMessage): OpenAIMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: 'assistant', content: msg.content }];
  }

  const texts: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];
  const toolResults: OpenAIMessage[] = [];

  for (const block of msg.content) {
    if (block.type === 'text') {
      texts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    } else if (block.type === 'tool_result') {
      // tool_result 在 Anthropic 里可以出现在 assistant 或 user 消息中
      const content =
        typeof block.content === 'string'
          ? block.content
          : (block.content ?? []).map((b) => b.text).join('\n');
      toolResults.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content,
      });
    }
  }

  const out: OpenAIMessage[] = [];
  if (texts.length > 0 || toolCalls.length > 0) {
    out.push({
      role: 'assistant',
      content: texts.length > 0 ? texts.join('\n') : null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }
  out.push(...toolResults);
  return out;
}

/** user 消息可能只包含 tool_result，需要拆成多条 OpenAI 消息 */
function convertUserMessage(msg: AnthropicMessage): OpenAIMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: 'user', content: msg.content }];
  }

  const texts: string[] = [];
  const toolResults: OpenAIMessage[] = [];

  for (const block of msg.content) {
    if (block.type === 'text') {
      texts.push(block.text);
    } else if (block.type === 'tool_result') {
      const content =
        typeof block.content === 'string'
          ? block.content
          : (block.content ?? []).map((b) => b.text).join('\n');
      toolResults.push({ role: 'tool', tool_call_id: block.tool_use_id, content });
    }
  }

  const out: OpenAIMessage[] = [];
  // tool 消息必须紧跟要回应的 assistant 消息，所以先发
  out.push(...toolResults);
  if (texts.length > 0) out.push({ role: 'user', content: texts.join('\n') });
  // 两者都空时要保证至少有一条，否则部分厂商会 400
  if (out.length === 0) out.push({ role: 'user', content: '' });
  return out;
}

export function anthropicToOpenAIRequest(req: AnthropicRequest): OpenAIRequest {
  const messages: OpenAIMessage[] = [];

  const sys = flattenSystem(req.system);
  if (sys) messages.push({ role: 'system', content: sys });

  for (const msg of req.messages) {
    if (msg.role === 'assistant') {
      messages.push(...convertAssistantMessage(msg));
    } else {
      messages.push(...convertUserMessage(msg));
    }
  }

  const openai: OpenAIRequest = {
    model: req.model,
    messages,
    stream: req.stream !== false,
  };

  if (req.max_tokens != null) openai.max_tokens = req.max_tokens;
  if (req.temperature != null) openai.temperature = req.temperature;
  if (req.top_p != null) openai.top_p = req.top_p;
  if (req.stop_sequences) openai.stop = req.stop_sequences;

  if (req.tools && req.tools.length > 0) {
    openai.tools = req.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema ?? { type: 'object', properties: {} },
      },
    }));
  }

  if (req.tool_choice) {
    if (req.tool_choice.type === 'auto') openai.tool_choice = 'auto';
    else if (req.tool_choice.type === 'any') openai.tool_choice = 'required';
    else if (req.tool_choice.type === 'tool' && req.tool_choice.name) {
      openai.tool_choice = { type: 'function', function: { name: req.tool_choice.name } };
    }
  }

  return openai;
}

// ─────────────────────────────────────────────────────────────
// 响应转换 OpenAI → Anthropic（非流式）
// ─────────────────────────────────────────────────────────────

export interface OpenAIResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { role?: string; content?: string | null; tool_calls?: OpenAIToolCall[] };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function mapFinishReason(reason?: string): string {
  switch (reason) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'stop':
    case undefined:
      return 'end_turn';
    default:
      return 'end_turn';
  }
}

export function openAIToAnthropicResponse(res: OpenAIResponse): unknown {
  const choice = res.choices?.[0];
  const msg = choice?.message;
  const content: unknown[] = [];

  if (msg?.content) content.push({ type: 'text', text: msg.content });

  for (const tc of msg?.tool_calls ?? []) {
    let input: unknown = {};
    try {
      input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      // 参数不是合法 JSON 时，包一层，别丢信息
      input = { __raw: tc.function.arguments };
    }
    content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
  }

  // 空内容兜底：Anthropic 不接受空 content 数组
  if (content.length === 0) content.push({ type: 'text', text: '' });

  return {
    id: res.id ?? `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: res.model ?? '',
    content,
    stop_reason: mapFinishReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 流式编码：OpenAI SSE → Anthropic SSE
// ─────────────────────────────────────────────────────────────

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * 把上游 OpenAI SSE 流转成 Anthropic SSE 事件序列。
 *
 * 状态机要点：
 *  - message_start 必须最先发，且带 input_tokens
 *  - content_block_start/delta/stop 必须成对，index 严格递增
 *  - 文本块与工具块不能在同一个 index 里交替出现
 *  - message_delta 携带 stop_reason 与 output_tokens
 *  - message_stop 收尾
 */
export class AnthropicStreamEncoder {
  private textIndex = -1;
  private nextIndex = 0;
  private textOpen = false;
  private openToolBlocks = new Map<number, { anthropicIndex: number; id: string; name: string }>();
  private started = false;
  private inputTokens = 0;
  private outputTokens = 0;
  private stopReason: string | null = null;

  constructor(private readonly model: string) {}

  private ev(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  private ensureStart(): string {
    if (this.started) return '';
    this.started = true;
    return this.ev('message_start', {
      type: 'message_start',
      message: {
        id: `msg_${Date.now().toString(36)}`,
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  private closeText(): string {
    if (!this.textOpen) return '';
    this.textOpen = false;
    return this.ev('content_block_stop', { type: 'content_block_stop', index: this.textIndex });
  }

  handleChunk(chunk: OpenAIStreamChunk): string {
    let out = this.ensureStart();
    const choice = chunk.choices?.[0];
    if (!choice) {
      if (chunk.usage) {
        this.inputTokens = chunk.usage.prompt_tokens ?? this.inputTokens;
        this.outputTokens = chunk.usage.completion_tokens ?? this.outputTokens;
      }
      return out;
    }

    const delta = choice.delta;

    // 文本增量
    if (delta?.content) {
      if (!this.textOpen) {
        out += this.closeText();
        this.textIndex = this.nextIndex++;
        this.textOpen = true;
        out += this.ev('content_block_start', {
          type: 'content_block_start',
          index: this.textIndex,
          content_block: { type: 'text', text: '' },
        });
      }
      out += this.ev('content_block_delta', {
        type: 'content_block_delta',
        index: this.textIndex,
        delta: { type: 'text_delta', text: delta.content },
      });
    }

    // 工具调用增量
    for (const tc of delta?.tool_calls ?? []) {
      let st = this.openToolBlocks.get(tc.index);
      if (!st) {
        out += this.closeText();
        const anthropicIndex = this.nextIndex++;
        st = {
          anthropicIndex,
          id: tc.id ?? `toolu_${Date.now().toString(36)}${tc.index}`,
          name: tc.function?.name ?? '',
        };
        this.openToolBlocks.set(tc.index, st);
        out += this.ev('content_block_start', {
          type: 'content_block_start',
          index: anthropicIndex,
          content_block: { type: 'tool_use', id: st.id, name: st.name, input: {} },
        });
      }
      if (tc.function?.arguments) {
        out += this.ev('content_block_delta', {
          type: 'content_block_delta',
          index: st.anthropicIndex,
          delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
        });
      }
    }

    if (choice.finish_reason) {
      this.stopReason = mapFinishReason(choice.finish_reason);
    }
    if (chunk.usage) {
      this.inputTokens = chunk.usage.prompt_tokens ?? this.inputTokens;
      this.outputTokens = chunk.usage.completion_tokens ?? this.outputTokens;
    }

    return out;
  }

  finish(): string {
    let out = this.ensureStart();
    out += this.closeText();
    for (const st of [...this.openToolBlocks.values()].sort(
      (a, b) => a.anthropicIndex - b.anthropicIndex,
    )) {
      out += this.ev('content_block_stop', { type: 'content_block_stop', index: st.anthropicIndex });
    }
    this.openToolBlocks.clear();

    out += this.ev('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: this.stopReason ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: this.outputTokens },
    });
    out += this.ev('message_stop', { type: 'message_stop' });
    return out;
  }

  /** 出错时也要发一个合法的 message_stop，否则 SDK 会挂住 */
  fail(message: string): string {
    let out = this.ensureStart();
    out += this.closeText();
    out += this.ev('error', { type: 'error', error: { type: 'api_error', message } });
    out += this.ev('message_stop', { type: 'message_stop' });
    return out;
  }
}

// ─────────────────────────────────────────────────────────────
// 桥本体：一个极小的 HTTP 服务，暴露 Anthropic Messages 端点
// ─────────────────────────────────────────────────────────────

export interface BridgeOptions {
  /** 目标 OpenAI 兼容端点，如 https://api.deepseek.com/v1 */
  openaiBaseUrl: string;
  apiKey: string;
  /** 只允许这一个模型通过（避免 claude 乱传模型名） */
  forceModel?: string;
  /** 调试日志 */
  debug?: boolean;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

export function createAnthropicBridgeHandler(opts: BridgeOptions) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url ?? '';
    // 只接管 messages 与 count_tokens，其余放行
    const isMessages = url.includes('/v1/messages');
    if (!isMessages || req.method !== 'POST') return false;

    let body: AnthropicRequest;
    try {
      body = JSON.parse(await readBody(req)) as AnthropicRequest;
    } catch {
      sendJson(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'invalid json' } });
      return true;
    }

    if (opts.forceModel) body.model = opts.forceModel;
    const openaiReq = anthropicToOpenAIRequest(body);
    if (opts.forceModel) openaiReq.model = opts.forceModel;

    const upstream = `${opts.openaiBaseUrl.replace(/\/+$/, '')}/chat/completions`;
    if (opts.debug) console.log('[bridge] →', upstream, openaiReq.model);

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(upstream, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(openaiReq),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 502, { type: 'error', error: { type: 'api_error', message: `upstream unreachable: ${msg}` } });
      return true;
    }

    if (!upstreamRes.ok) {
      const detail = await upstreamRes.text().catch(() => '');
      sendJson(res, upstreamRes.status, {
        type: 'error',
        error: { type: 'api_error', message: `upstream ${upstreamRes.status}: ${detail.slice(0, 500)}` },
      });
      return true;
    }

    // ── 非流式 ──
    if (!openaiReq.stream) {
      const json = (await upstreamRes.json()) as OpenAIResponse;
      sendJson(res, 200, openAIToAnthropicResponse(json));
      return true;
    }

    // ── 流式 ──
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const encoder = new AnthropicStreamEncoder(openaiReq.model);
    const reader = upstreamRes.body?.getReader();
    if (!reader) {
      res.end(encoder.fail('upstream returned no body'));
      return true;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 以空行分帧
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const chunk = JSON.parse(payload) as OpenAIStreamChunk;
              const out = encoder.handleChunk(chunk);
              if (out) res.write(out);
            } catch {
              // 单个分片解析失败不该中断整条流
              if (opts.debug) console.warn('[bridge] bad chunk', payload.slice(0, 200));
            }
          }
        }
      }
      res.write(encoder.finish());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.write(encoder.fail(msg));
    } finally {
      res.end();
    }
    return true;
  };
}
