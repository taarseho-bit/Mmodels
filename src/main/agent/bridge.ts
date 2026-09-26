/**
 * Anthropic ⇄ OpenAI 协议转换桥。
 *
 * ⚠️ 为什么需要它：
 *   Claude Agent SDK 只会说 Anthropic Messages API。
 *   但国内绝大多数模型（DeepSeek / 通义 / Kimi / 智谱）只提供 OpenAI Chat Completions。
 *   项目契约引入 `@jtabet/anthropic-openai-bridge` 做这件事。
 *
 * 我们自己实现一份，理由：
 *   1. 项目契约那个包不在公开 npm 上，无法依赖
 *   2. 自己实现才能控制**流式转换的边界情况**（这是最容易出错的地方）
 *   3. 可以按需裁剪，只支持真正需要的字段
 *
 * ── 覆盖范围（刻意保守）─────────────────────────────────────
 * 支持：system / user / assistant 消息、多模态文本、tool_use / tool_result、
 *      流式 SSE 的 text_delta / input_json_delta / message_delta / message_stop
 * 支持图片与推理回传。无法转换的内容须明确报错，不能静默丢弃。
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
  content?: string | Array<AnthropicTextBlock | AnthropicImageBlock | AnthropicDocumentBlock>;
  is_error?: boolean;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string };
}
/** Claude Code 读取 PDF 时可能产生的内容块；兼容接口需要降级成文字。 */
export interface AnthropicDocumentBlock {
  type: 'document';
  title?: string;
  source:
    | { type: 'text'; media_type?: string; data: string }
    | { type: 'content'; content: string | Array<{ type: string; text?: string }> }
    | { type: 'base64'; media_type?: string; data: string }
    | { type: 'url'; url: string };
}
export interface AnthropicThinkingBlock { type: 'thinking'; thinking: string; signature?: string }

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock | AnthropicImageBlock | AnthropicDocumentBlock | AnthropicThinkingBlock;

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
  thinking?: { type: string };
  output_config?: { effort?: string };
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
  content: string | null | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  reasoning_content?: string;
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
  stream_options?: { include_usage: boolean };
  thinking?: { type: string };
  reasoning_effort?: string;
}

function documentAsText(block: AnthropicDocumentBlock): string {
  const label = block.title?.trim() ? `“${block.title.trim()}”` : 'PDF/文档';
  if (block.source.type === 'text') return block.source.data;
  if (block.source.type === 'content') {
    if (typeof block.source.content === 'string') return block.source.content;
    const text = block.source.content
      .filter((item): item is { type: string; text: string } => item.type === 'text' && typeof item.text === 'string')
      .map(item => item.text)
      .join('\n');
    if (text.trim()) return text;
  }
  return `[兼容处理：${label}没有直接嵌入当前模型接口。请继续本轮任务，改用用户消息中的原始文件路径在本地读取：PDF 优先使用 pdftotext，Excel 优先使用 Python 的 pandas/openpyxl。不要再次把该文件作为 document 内容发送。]`;
}

function multimodal(blocks: Array<AnthropicTextBlock | AnthropicImageBlock | AnthropicDocumentBlock>): OpenAIMessage['content'] {
  const parts = blocks.map(b => {
    if (b.type === 'text') return { type: 'text', text: b.text };
    if (b.type === 'image') return { type: 'image_url', image_url: { url: b.source.type === 'url'
      ? b.source.url : `data:${b.source.media_type};base64,${b.source.data}` } };
    if (b.type === 'document') return { type: 'text', text: documentAsText(b) };
    throw new Error('当前接口不能传递这种附件，请换用支持该格式的接口');
  });
  return parts.some(p => p.type === 'image_url') ? parts : parts.map(p => p.text).join('\n');
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
  const thoughts: string[] = [];

  for (const block of msg.content) {
    if (block.type === 'text') {
      texts.push(block.text);
    } else if (block.type === 'document') {
      texts.push(documentAsText(block));
    } else if (block.type === 'thinking') {
      thoughts.push(block.thinking);
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
          : multimodal(block.content ?? []);
      toolResults.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content,
      });
    } else throw new Error(`当前接口不能传递助手返回的 ${block.type} 内容，不能忽略后继续`);
  }

  const out: OpenAIMessage[] = [];
  if (texts.length > 0 || toolCalls.length > 0 || thoughts.length > 0) {
    out.push({
      role: 'assistant',
      content: texts.length > 0 ? texts.join('\n') : null,
      ...(thoughts.length ? { reasoning_content: thoughts.join('') } : {}),
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

  const parts: Array<AnthropicTextBlock | AnthropicImageBlock | AnthropicDocumentBlock> = [];
  const toolResults: OpenAIMessage[] = [];

  for (const block of msg.content) {
    if (block.type === 'text' || block.type === 'image' || block.type === 'document') {
      parts.push(block);
    } else if (block.type === 'tool_result') {
      const content =
        typeof block.content === 'string'
          ? block.content
          : multimodal(block.content ?? []);
      toolResults.push({ role: 'tool', tool_call_id: block.tool_use_id, content });
    } else throw new Error(`当前接口不支持 ${block.type} 内容，不能忽略后继续`);
  }

  const out: OpenAIMessage[] = [];
  // tool 消息必须紧跟要回应的 assistant 消息，所以先发
  out.push(...toolResults);
  if (parts.length > 0) out.push({ role: 'user', content: multimodal(parts) });
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
    stream: req.stream === true,
  };
  if (openai.stream) openai.stream_options = { include_usage: true };

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
    else if (req.tool_choice.type === 'none') openai.tool_choice = 'none';
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
    message?: { role?: string; content?: string | null; reasoning_content?: string; tool_calls?: OpenAIToolCall[] };
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
  if (msg?.reasoning_content) content.push({ type: 'thinking', thinking: msg.reasoning_content, signature: '' });

  if (msg?.content) content.push({ type: 'text', text: msg.content });

  for (const tc of msg?.tool_calls ?? []) {
    let input: unknown = {};
    try {
      input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      // 参数不是合法 JSON 时，包一层，别丢信息
      throw new Error('工具参数不完整，请重试这一轮');
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
    delta?: { content?: string | null; reasoning_content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
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
  private thinkingIndex = -1;
  private thinkingOpen = false;
  private openToolBlocks = new Map<number, { id: string; name: string; arguments: string }>();
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

    if (delta?.reasoning_content) {
      if (!this.thinkingOpen) {
        out += this.closeText();
        this.thinkingIndex = this.nextIndex++;
        this.thinkingOpen = true;
        out += this.ev('content_block_start', { type: 'content_block_start', index: this.thinkingIndex, content_block: { type: 'thinking', thinking: '' } });
      }
      out += this.ev('content_block_delta', { type: 'content_block_delta', index: this.thinkingIndex, delta: { type: 'thinking_delta', thinking: delta.reasoning_content } });
    }
    if (this.thinkingOpen && (delta?.content || delta?.tool_calls?.length)) out += this.closeThinking();

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
        st = {
          id: '',
          name: '',
          arguments: '',
        };
        this.openToolBlocks.set(tc.index, st);
      }
      if (tc.id) st.id = tc.id;
      if (tc.function?.name) st.name += tc.function.name;
      if (tc.function?.arguments) st.arguments += tc.function.arguments;
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
    out += this.closeThinking();
    out += this.closeText();
    for (const [, st] of [...this.openToolBlocks].sort((a, b) => a[0] - b[0])) {
      if (!st.id || !st.name) throw new Error('工具调用信息不完整，请重试这一轮');
      JSON.parse(st.arguments || '{}');
      const index = this.nextIndex++;
      out += this.ev('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: st.id, name: st.name, input: {} } });
      out += this.ev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: st.arguments || '{}' } });
      out += this.ev('content_block_stop', { type: 'content_block_stop', index });
    }
    this.openToolBlocks.clear();

    out += this.ev('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: this.stopReason ?? 'end_turn', stop_sequence: null },
      usage: { input_tokens: this.inputTokens, output_tokens: this.outputTokens },
    });
    out += this.ev('message_stop', { type: 'message_stop' });
    return out;
  }

  /** 出错时也要发一个合法的 message_stop，否则 SDK 会挂住 */
  fail(message: string): string {
    let out = this.ensureStart();
    out += this.closeThinking();
    out += this.closeText();
    out += this.ev('error', { type: 'error', error: { type: 'api_error', message } });
    out += this.ev('message_stop', { type: 'message_stop' });
    return out;
  }

  private closeThinking(): string {
    if (!this.thinkingOpen) return '';
    this.thinkingOpen = false;
    return this.ev('content_block_delta', { type: 'content_block_delta', index: this.thinkingIndex, delta: { type: 'signature_delta', signature: '' } })
      + this.ev('content_block_stop', { type: 'content_block_stop', index: this.thinkingIndex });
  }
}

// ─────────────────────────────────────────────────────────────
// 桥本体：一个极小的 HTTP 服务，暴露 Anthropic Messages 端点
// ─────────────────────────────────────────────────────────────

export interface BridgeOptions {
  /** 目标 OpenAI 兼容端点，如 https://api.deepseek.com/v1 */
  openaiBaseUrl: string;
  apiKey: string;
  /** 本轮用户实际选择的模型；不能固定成供应商列表首项。 */
  forceModel?: string;
  effort?: string;
  disableThinking?: boolean;
  /** 调试日志 */
  debug?: boolean;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

export function createAnthropicBridgeHandler(opts: BridgeOptions) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!['/v1/messages', '/v1/messages/count_tokens'].includes(url) || req.method !== 'POST') return false;
    if (url.endsWith('/count_tokens')) {
      sendJson(res, 501, { type: 'error', error: { type: 'not_found_error', message: '兼容接口不提供精确计数，请使用实际用量或本地估算' } });
      return true;
    }
    const controller = new AbortController();
    const cancel = (): void => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', cancel);
    res.once('close', cancel);
    try {

    let body: AnthropicRequest;
    try {
      body = JSON.parse(await readBody(req)) as AnthropicRequest;
    } catch {
      sendJson(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: '请求内容格式不完整，请重新发送' } });
      return true;
    }

    if (opts.forceModel) body.model = opts.forceModel;
    const openaiReq = anthropicToOpenAIRequest(body);
    if (opts.forceModel) openaiReq.model = opts.forceModel;
    applyReasoning(openaiReq, body, opts);

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
        signal: controller.signal,
      });
    } catch {
      if (!controller.signal.aborted) sendJson(res, 502, { type: 'error', error: { type: 'api_error', message: '暂时未能连接模型服务，请检查网络或稍后重试' } });
      return true;
    }

    if (!upstreamRes.ok) {
      await upstreamRes.body?.cancel();
      sendJson(res, upstreamRes.status, {
        type: 'error',
        error: { type: 'api_error', message: `模型服务暂未完成请求（${upstreamRes.status}），请检查模型配置或稍后重试` },
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
      res.end(encoder.fail('模型服务没有返回内容，请稍后重试'));
      return true;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let streamDone = false;
    try {
      while (!streamDone && !controller.signal.aborted) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        if (done && buffer.trim()) buffer += '\n\n';

        // SSE 以空行分帧
        let separator: RegExpExecArray | null;
        while ((separator = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, separator.index);
          buffer = buffer.slice(separator.index + separator[0].length);

          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === '[DONE]') { streamDone = true; break; }
            const chunk = JSON.parse(payload) as OpenAIStreamChunk & { error?: { message?: string } };
            if (chunk.error) throw new Error(chunk.error.message ?? '模型服务未能完成本轮请求');
            const out = encoder.handleChunk(chunk);
            if (out) res.write(out);
          }
          if (streamDone) break;
        }
        if (done) break;
      }
      if (!controller.signal.aborted) res.write(encoder.finish());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!controller.signal.aborted && !res.destroyed) res.write(encoder.fail(msg));
    } finally {
      await reader.cancel().catch(() => undefined);
      res.end();
    }
    return true;
    } catch (error) {
      if (!controller.signal.aborted && !res.destroyed) {
        if (!res.headersSent) sendJson(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: error instanceof Error ? error.message : '本轮请求未能完成，请重试' } });
        else res.end();
      }
      return true;
    } finally {
      req.off('aborted', cancel);
      res.off('close', cancel);
    }
  };
}

/** Endpoint-aware effort mapping; DeepSeek documents low/high/max, not five distinct levels. */
export function applyReasoning(out: OpenAIRequest, req: AnthropicRequest, opts: BridgeOptions): void {
  const deepseek = /^deepseek[-/]/i.test(out.model) || new URL(opts.openaiBaseUrl).hostname === 'api.deepseek.com';
  const effort = opts.effort ?? req.output_config?.effort;
  const disabled = opts.disableThinking ?? (req.thinking?.type === 'disabled');
  if (deepseek) {
    out.thinking = { type: disabled ? 'disabled' : 'enabled' };
    if (!disabled && effort) out.reasoning_effort = effort === 'low' ? 'low' : ['max', 'xhigh'].includes(effort) ? 'max' : 'high';
  } else if (effort && !disabled) out.reasoning_effort = effort === 'max' ? 'xhigh' : effort;
}
