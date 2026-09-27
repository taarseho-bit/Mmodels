import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { McpServerConfig } from '@shared/types';
import type { RunOptions } from './session';

const execFileAsync = promisify(execFile);
type Result = { content: [{ type: 'text'; text: string }]; isError?: boolean };
const text = (value: unknown): Result => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const publicCache = new Map<string, { expiresAt: number; value: any }>();

/** 本地连接器的硬上限，避免模型生成的脚本拖垮桌面进程。 */
const LOCAL_TIMEOUT_MS = 60_000;
const LOCAL_STDOUT_LIMIT = 64 * 1024;
const LOCAL_STDERR_LIMIT = 32 * 1024;
const LOCAL_SCRIPT_LIMIT = 2 * 1024 * 1024;

type ToolExtra = { signal?: AbortSignal };

function toolSignal(extra: unknown): AbortSignal | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  const signal = (extra as ToolExtra).signal;
  return signal && typeof signal.aborted === 'boolean' ? signal : undefined;
}

/** 把用户提供的文件名限制在项目的 .mathmodel 目录内。 */
export function projectRunFile(projectRoot: string, requested: string, extension: string): string {
  const root = resolve(projectRoot);
  if (!isAbsolute(root)) throw new Error('项目目录必须是绝对路径');
  const cleaned = basename(String(requested || '').trim()).replace(/[^\w.-]/g, '_');
  const fallback = `connector-run-${Date.now()}.${extension}`;
  const name = cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : fallback;
  const file = resolve(root, '.mathmodel', name);
  const rel = relative(resolve(root, '.mathmodel'), file);
  if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).length !== 1) {
    throw new Error('脚本文件只能写入当前项目的运行记录目录');
  }
  return file;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd');
  }
  return false;
}

/**
 * 校验 Webhook 目的地址，防止把项目内容发往本机、内网和带凭据的 URL。
 * 可用 WEBHOOK_ALLOWED_HOSTS（逗号分隔）进一步收窄域名范围。
 */
export async function validateWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Webhook 地址格式不正确'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Webhook 只支持 HTTP 或 HTTPS 地址');
  if (url.username || url.password) throw new Error('Webhook 地址不能包含登录信息');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) {
    throw new Error('Webhook 不能指向本机或局域网地址');
  }
  const hostAllowlist = (process.env.WEBHOOK_ALLOWED_HOSTS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostAllowlist.length && !hostAllowlist.includes(hostname)) throw new Error('Webhook 地址不在允许的域名范围内');
  if (isPrivateAddress(hostname)) throw new Error('Webhook 不能指向本机或局域网地址');
  for (const key of [...url.searchParams.keys()]) {
    if (/(token|secret|password|passwd|api[_-]?key|access[_-]?key|signature)/i.test(key)) {
      throw new Error('Webhook 地址不能把密钥放在查询参数中');
    }
  }
  // 对域名再做一次解析，避免通过公网域名解析到内网地址（基础 SSRF 防护）。
  if (!isIP(hostname)) {
    try {
      const records = await lookup(hostname, { all: true, verbatim: true });
      if (records.some(record => isPrivateAddress(record.address))) throw new Error('Webhook 解析到了本机或局域网地址');
    } catch (error) {
      if (error instanceof Error && /本机|局域网/.test(error.message)) throw error;
      // DNS 暂时失败交给 fetch 返回可重试错误，不在校验阶段把普通网络波动误报成配置错误。
    }
  }
  return url;
}

async function json(url: string, init?: RequestInit, signal?: AbortSignal): Promise<any> {
  const hasSecret = Object.keys((init?.headers ?? {}) as Record<string, unknown>).some(key => /authorization|api-key|token/i.test(key));
  const cached = !hasSecret && (init?.method ?? 'GET') === 'GET' ? publicCache.get(url) : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted) throw new Error('连接器任务已停止');
    const timeout = AbortSignal.timeout(18_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(url, { ...init, signal: requestSignal, headers: { accept: 'application/json', ...(init?.headers ?? {}) } });
    const body = await response.text();
    if (response.ok) {
      try { const value = JSON.parse(body); if (!hasSecret && (init?.method ?? 'GET') === 'GET') publicCache.set(url, { expiresAt: Date.now() + 120_000, value }); return value; } catch { throw new Error('数据源返回格式不正确'); }
    }
    lastStatus = response.status;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
    const retryAfter = Number(response.headers.get('retry-after') ?? '0');
    const waitMs = Math.min(4_000, retryAfter > 0 ? retryAfter * 1000 : 350 * (attempt + 1));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, waitMs);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('连接器任务已停止')); }, { once: true });
    });
  }
  throw new Error(`数据源暂时无法访问（${lastStatus || '网络异常'}），已自动重试`);
}

function env(config: McpServerConfig, key: string): string | undefined {
  const value = config.env?.[key]?.trim();
  return value || undefined;
}

function wrap(fn: (args: any, signal?: AbortSignal) => Promise<unknown> | unknown, planOnly = false, write = false) {
  return async (args: any, extra: unknown): Promise<Result> => {
    try {
      if (write && planOnly) throw new Error('当前只做规划，不能执行写入操作');
      // SDK 的 MCP handler 第二个参数带有本次工具调用的取消信号。
      // 这里故意从 unknown 读取，兼容不同版本 SDK 的额外上下文形状。
      return text(await fn(args, toolSignal(extra)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ...text(message || '连接器执行失败，请稍后重试'), isError: true };
    }
  };
}

function server(name: string, tools: any[]) {
  return createSdkMcpServer({ name, version: '1.0.0', tools });
}

function crossref(_config: McpServerConfig) {
  return server('crossref', [
    tool('search_papers', '搜索 Crossref 论文元数据。返回标题、作者、期刊、年份和 DOI。', { query: z.string().min(2), rows: z.number().int().min(1).max(20).default(8) }, wrap(async a => {
      const url = new URL('https://api.crossref.org/works'); url.searchParams.set('query.bibliographic', a.query); url.searchParams.set('rows', String(a.rows));
      const data = await json(url.toString(), { headers: { 'User-Agent': 'MModels/0.1 (mailto:mmodels@localhost)' } });
      return (data.message?.items ?? []).map((item: any) => ({ title: item.title?.[0], authors: item.author?.map((x: any) => `${x.given ?? ''} ${x.family ?? ''}`.trim()), journal: item['container-title']?.[0], published: item.published?.['date-parts']?.[0]?.[0], doi: item.DOI, url: item.URL, license: item.license?.[0]?.URL }));
    })),
    tool('get_work', '根据 DOI 查询论文完整元数据。', { doi: z.string().min(5) }, wrap(async a => json(`https://api.crossref.org/works/${encodeURIComponent(a.doi.replace(/^https?:\/\/doi.org\//, ''))}`))),
  ]);
}

function openalex(config: McpServerConfig) {
  const apiKey = env(config, 'OPENALEX_API_KEY');
  return server('openalex', [
    tool('search_works', '搜索 OpenAlex 科研作品。', { query: z.string().min(2), perPage: z.number().int().min(1).max(25).default(10) }, wrap(async a => {
      const url = new URL('https://api.openalex.org/works'); url.searchParams.set('search', a.query); url.searchParams.set('per-page', String(a.perPage)); if (apiKey) url.searchParams.set('api_key', apiKey);
      const data = await json(url.toString()); return (data.results ?? []).map((x: any) => ({ id: x.id, title: x.title, year: x.publication_year, citedBy: x.cited_by_count, authors: x.authorships?.slice(0, 6).map((v: any) => v.author?.display_name), concepts: x.concepts?.slice(0, 5).map((v: any) => v.display_name), doi: x.doi, url: x.primary_location?.landing_page_url }));
    })),
    tool('search_authors', '搜索 OpenAlex 作者和机构。', { query: z.string().min(2), perPage: z.number().int().min(1).max(20).default(10) }, wrap(async a => { const url = new URL('https://api.openalex.org/authors'); url.searchParams.set('search', a.query); url.searchParams.set('per-page', String(a.perPage)); if (apiKey) url.searchParams.set('api_key', apiKey); const data = await json(url.toString()); return data.results?.map((x: any) => ({ id: x.id, name: x.display_name, works: x.works_count, citedBy: x.cited_by_count, institution: x.last_known_institutions?.[0]?.display_name })); })),
  ]);
}

function semanticScholar(config: McpServerConfig) {
  const key = env(config, 'SEMANTIC_SCHOLAR_API_KEY');
  const headers: Record<string, string> = key ? { 'x-api-key': key } : {};
  return server('semantic-scholar', [
    tool('search_papers', '搜索 Semantic Scholar 论文。', { query: z.string().min(2), limit: z.number().int().min(1).max(20).default(8) }, wrap(async a => { const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search'); url.searchParams.set('query', a.query); url.searchParams.set('limit', String(a.limit)); url.searchParams.set('fields', 'title,abstract,year,authors,citationCount,externalIds,url'); const data = await json(url.toString(), { headers }); return data.data?.map((x: any) => ({ paperId: x.paperId, title: x.title, abstract: x.abstract?.slice(0, 1800), year: x.year, authors: x.authors?.map((v: any) => v.name), citations: x.citationCount, doi: x.externalIds?.DOI, url: x.url })); })),
    tool('get_paper', '读取论文的引用和参考文献。', { paperId: z.string().min(3) }, wrap(async a => json(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(a.paperId)}?fields=title,abstract,year,authors,citationCount,citations.title,citations.paperId,references.title,references.paperId`, { headers })) ),
  ]);
}

function worldBank() {
  return server('world-bank', [
    tool('search_indicators', '搜索世界银行指标。', { query: z.string().min(2), page: z.number().int().min(1).default(1) }, wrap(async a => { const data = await json(`https://api.worldbank.org/v2/indicator?format=json&per_page=100&page=${a.page}`); const rows = Array.isArray(data) ? data[1] ?? [] : []; return rows.filter((x: any) => `${x.name} ${x.sourceNote ?? ''}`.toLowerCase().includes(a.query.toLowerCase())).slice(0, 20).map((x: any) => ({ id: x.id, name: x.name, unit: x.unit, note: x.sourceNote })); })),
    tool('get_series', '读取指定指标的国家时间序列。', { indicator: z.string(), country: z.string().default('CHN'), date: z.string().default('2000:2024') }, wrap(async a => json(`https://api.worldbank.org/v2/country/${encodeURIComponent(a.country)}/indicator/${encodeURIComponent(a.indicator)}?date=${encodeURIComponent(a.date)}&format=json&per_page=200`))),
  ]);
}

function openMeteo() {
  return server('open-meteo', [
    tool('forecast', '查询地点未来天气和历史气象变量。', { latitude: z.number(), longitude: z.number(), start: z.string().optional(), end: z.string().optional(), days: z.number().int().min(1).max(16).default(7) }, wrap(async a => { const url = new URL('https://api.open-meteo.com/v1/forecast'); url.searchParams.set('latitude', String(a.latitude)); url.searchParams.set('longitude', String(a.longitude)); url.searchParams.set('hourly', 'temperature_2m,precipitation,wind_speed_10m,shortwave_radiation'); if (a.start) url.searchParams.set('start_date', a.start); if (a.end) url.searchParams.set('end_date', a.end); url.searchParams.set('forecast_days', String(a.days)); return json(url.toString()); })),
  ]);
}

function huggingFace(config: McpServerConfig) {
  const token = env(config, 'HF_TOKEN'); const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  return server('huggingface-datasets', [
    tool('search_datasets', '搜索 Hugging Face 数据集。', { query: z.string().min(2), limit: z.number().int().min(1).max(20).default(10) }, wrap(async a => json(`https://huggingface.co/api/datasets?search=${encodeURIComponent(a.query)}&limit=${a.limit}`, { headers }))),
    tool('preview_dataset', '预览公开数据集的前几行。', { dataset: z.string().min(2), config: z.string().optional(), split: z.string().default('train'), offset: z.number().int().min(0).default(0), length: z.number().int().min(1).max(20).default(5) }, wrap(async a => { const url = new URL(`https://datasets-server.huggingface.co/rows`); url.searchParams.set('dataset', a.dataset); url.searchParams.set('config', a.config ?? 'default'); url.searchParams.set('split', a.split); url.searchParams.set('offset', String(a.offset)); url.searchParams.set('length', String(a.length)); return json(url.toString(), { headers }); })),
  ]);
}

function zenodo(config: McpServerConfig) {
  const token = env(config, 'ZENODO_TOKEN'); const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  return server('zenodo', [
    tool('search_records', '搜索 Zenodo 科研资料和数据集。', { query: z.string().min(2), size: z.number().int().min(1).max(20).default(10) }, wrap(async a => json(`https://zenodo.org/api/records?q=${encodeURIComponent(a.query)}&size=${a.size}`, { headers }))),
    tool('get_record', '读取 Zenodo 记录、文件和 DOI。', { id: z.string().min(1) }, wrap(async a => json(`https://zenodo.org/api/records/${encodeURIComponent(a.id)}`, { headers }))),
  ]);
}

function orcid(config: McpServerConfig) {
  const token = env(config, 'ORCID_ACCESS_TOKEN'); const headers: Record<string, string> = { Accept: 'application/vnd.orcid+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  return server('orcid', [
    tool('search', '搜索 ORCID 公开作者记录。', { query: z.string().min(2), rows: z.number().int().min(1).max(20).default(10) }, wrap(async a => json(`https://pub.orcid.org/v3.0/search/?q=${encodeURIComponent(a.query)}&rows=${a.rows}`, { headers }))),
    tool('get_record', '读取一个 ORCID 公开记录。', { orcid: z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/) }, wrap(async a => json(`https://pub.orcid.org/v3.0/${a.orcid}/record`, { headers }))),
  ]);
}

function googleDrive(config: McpServerConfig) {
  const token = env(config, 'GOOGLE_DRIVE_ACCESS_TOKEN');
  return server('google-drive', [
    tool('list_files', '列出 Google Drive 中当前授权可见的文件。', { query: z.string().optional(), pageSize: z.number().int().min(1).max(100).default(30) }, wrap(async a => { if (!token) throw new Error('请先配置 Google Drive 访问令牌'); const q = a.query ? ` and name contains '${String(a.query).replace(/'/g, "\\'")}'` : ''; return json(`https://www.googleapis.com/drive/v3/files?pageSize=${a.pageSize}&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)&q=trashed=false${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } }); })),
  ]);
}

function gitService(config: McpServerConfig, provider: 'gitlab' | 'gitee') {
  const token = env(config, provider === 'gitlab' ? 'GITLAB_TOKEN' : 'GITEE_TOKEN');
  const base = provider === 'gitlab' ? (env(config, 'GITLAB_BASE_URL') || 'https://gitlab.com') : 'https://gitee.com';
  return server(provider, [
    tool('search_projects', '搜索代码项目。', { query: z.string().min(2), page: z.number().int().min(1).default(1) }, wrap(async a => { if (!token) throw new Error('请先配置访问令牌'); const url = provider === 'gitlab' ? `${base.replace(/\/$/, '')}/api/v4/projects?search=${encodeURIComponent(a.query)}&page=${a.page}` : `${base}/api/v5/search/repositories?q=${encodeURIComponent(a.query)}&page=${a.page}&access_token=${encodeURIComponent(token)}`; return json(url, { headers: { Authorization: `Bearer ${token}` } }); })),
  ]);
}

function webhook(config: McpServerConfig, opts: RunOptions) {
  const url = env(config, 'WEBHOOK_URL'); const token = env(config, 'WEBHOOK_TOKEN');
  return server('webhook', [tool('send', '按用户明确要求发送一条项目通知；发送前应确认收件地址和内容。', { title: z.string().min(1), message: z.string().min(1).max(4000) }, wrap(async (a, signal) => {
    if (config.permission !== 'external-write') throw new Error('通知连接器需要切换为“外部可写”后才能发送');
    if (!url) throw new Error('请先配置 Webhook 地址');
    const target = await validateWebhookUrl(url);
    const headers: Record<string, string> = { 'content-type': 'application/json' }; if (token) headers.authorization = `Bearer ${token}`;
    const timeout = AbortSignal.timeout(15_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(target, { method: 'POST', headers, body: JSON.stringify({ title: a.title, text: a.message, content: a.message }), signal: requestSignal });
    if (!response.ok) throw new Error(`通知服务返回 ${response.status}`);
    return { sent: true, at: new Date().toISOString() };
  }, opts.interactionMode === 'plan', true))]);
}

async function runLocal(command: string, args: string[], cwd: string, signal?: AbortSignal) {
  return await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false;
    const append = (current: string, chunk: Buffer, limit: number) => (current + chunk.toString('utf8')).slice(-limit);
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolvePromise({ stdout, stderr }); };
    const terminate = () => {
      if (process.platform === 'win32' && child.pid) {
        // Windows 的 SIGTERM 只结束外层解释器；taskkill /T 同时收掉它派生的
        // Python/R/Octave 子进程，保证点击停止后不会继续占用项目文件。
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.unref();
      } else {
        child.kill('SIGTERM');
      }
    };
    const abort = () => { terminate(); finish(new Error('连接器任务已停止')); };
    const timer = setTimeout(() => { terminate(); finish(new Error('本地计算超时')); }, LOCAL_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk, LOCAL_STDOUT_LIMIT); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk, LOCAL_STDERR_LIMIT); });
    child.on('error', error => finish(error));
    child.on('close', code => code === 0 ? finish() : finish(new Error(`本地计算失败（退出码 ${code ?? '未知'}）\n${stderr.slice(-2000)}`)));
  });
}

function localCompute(name: 'python' | 'r' | 'octave', opts: RunOptions, allowWrite: boolean) {
  const command = name === 'python' ? (process.platform === 'win32' ? 'python' : 'python3') : name === 'r' ? 'Rscript' : (process.platform === 'win32' ? 'octave-cli.exe' : 'octave');
  const extension = name === 'python' ? 'py' : name === 'r' ? 'R' : 'm';
  return server(name, [tool('run', `在当前项目中运行 ${name} 脚本，输出会保存到项目运行记录。`, { script: z.string().min(1).max(LOCAL_SCRIPT_LIMIT), filename: z.string().optional() }, wrap(async (a, signal) => {
    if (!allowWrite) throw new Error('这个本地计算连接器当前是只读状态，请先切换为“项目可写”');
    const file = projectRunFile(opts.cwd, a.filename || `connector-run-${Date.now()}.${extension}`, extension);
    await mkdir(join(opts.cwd, '.mathmodel'), { recursive: true }); await writeFile(file, a.script, 'utf8');
    if (name === 'octave') return runLocal(command, ['--quiet', file], opts.cwd, signal);
    return runLocal(command, [file], opts.cwd, signal);
  }, opts.interactionMode === 'plan', true))]);
}

/** 根据设置中 native=true 的连接器创建原生 MCP 服务。 */
export function buildNativeConnectors(servers: McpServerConfig[], opts: RunOptions): Record<string, any> {
  const result: Record<string, any> = {};
  for (const config of servers.filter(item => item.enabled !== false && item.native)) {
    switch (config.name) {
      case 'crossref': result[config.name] = crossref(config); break;
      case 'openalex': result[config.name] = openalex(config); break;
      case 'semantic-scholar': result[config.name] = semanticScholar(config); break;
      case 'world-bank': result[config.name] = worldBank(); break;
      case 'open-meteo': result[config.name] = openMeteo(); break;
      case 'huggingface-datasets': result[config.name] = huggingFace(config); break;
      case 'zenodo': result[config.name] = zenodo(config); break;
      case 'orcid': result[config.name] = orcid(config); break;
      case 'google-drive': result[config.name] = googleDrive(config); break;
      case 'gitlab': result[config.name] = gitService(config, 'gitlab'); break;
      case 'gitee': result[config.name] = gitService(config, 'gitee'); break;
      case 'python': case 'r': case 'octave': result[config.name] = localCompute(config.name, opts, config.permission !== 'read'); break;
      case 'webhook': result[config.name] = webhook(config, opts); break;
      default: break;
    }
  }
  return result;
}

export async function testNativeConnector(config: McpServerConfig): Promise<string> {
  switch (config.name) {
    case 'crossref': await json('https://api.crossref.org/works?rows=1'); return 'Crossref 可以访问';
    case 'openalex': await json('https://api.openalex.org/works?per-page=1'); return 'OpenAlex 可以访问';
    case 'semantic-scholar': { const headers: Record<string, string> = {}; const key = env(config, 'SEMANTIC_SCHOLAR_API_KEY'); if (key) headers['x-api-key'] = key; await json('https://api.semanticscholar.org/graph/v1/paper/search?query=mathematics&limit=1', { headers }); return 'Semantic Scholar 可以访问'; }
    case 'world-bank': await json('https://api.worldbank.org/v2/country/CHN/indicator/SP.POP.TOTL?format=json&per_page=1'); return '世界银行指标可以访问';
    case 'open-meteo': await json('https://api.open-meteo.com/v1/forecast?latitude=39.9&longitude=116.4&current=temperature_2m'); return 'Open-Meteo 可以访问';
    case 'huggingface-datasets': await json('https://huggingface.co/api/datasets?limit=1'); return 'Hugging Face 可以访问';
    case 'zenodo': await json('https://zenodo.org/api/records?size=1'); return 'Zenodo 可以访问';
    case 'orcid': await fetch('https://pub.orcid.org/v3.0/').then(r => { if (!r.ok && r.status !== 404) throw new Error(`ORCID 返回 ${r.status}`); }); return 'ORCID 可以访问';
    case 'google-drive': { const token = env(config, 'GOOGLE_DRIVE_ACCESS_TOKEN'); if (!token) throw new Error('请先配置 Google Drive 访问令牌'); await json('https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id,name)', { headers: { Authorization: `Bearer ${token}` } }); return 'Google Drive 可以访问'; }
    case 'gitlab': { const token = env(config, 'GITLAB_TOKEN'); if (!token) throw new Error('请先配置 GitLab 访问令牌'); const base = env(config, 'GITLAB_BASE_URL') || 'https://gitlab.com'; await json(`${base.replace(/\/$/, '')}/api/v4/projects?per_page=1`, { headers: { Authorization: `Bearer ${token}` } }); return 'GitLab 可以访问'; }
    case 'gitee': { const token = env(config, 'GITEE_TOKEN'); if (!token) throw new Error('请先配置 Gitee 访问令牌'); await json(`https://gitee.com/api/v5/user?access_token=${encodeURIComponent(token)}`); return 'Gitee 可以访问'; }
    case 'webhook': { const raw = env(config, 'WEBHOOK_URL'); if (!raw) throw new Error('请先配置 Webhook 地址'); const url = await validateWebhookUrl(raw); const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(12_000) }); if (!response.ok && response.status !== 405) throw new Error(`Webhook 返回 ${response.status}`); return 'Webhook 地址可以访问'; }
    case 'python': case 'r': case 'octave': await execFileAsync(config.name === 'python' ? (process.platform === 'win32' ? 'python' : 'python3') : config.name === 'r' ? 'Rscript' : (process.platform === 'win32' ? 'octave-cli.exe' : 'octave'), ['--version'], { timeout: 10_000, windowsHide: true }); return `${config.name} 已安装`;
    default: return '该连接器将在下一轮以 MCP 方式启动';
  }
}
