/**
 * 连接器（MCP 服务器管理）—— 对应项目契约 ExtensionsPage 的 connectorsSection。
 *
 * 项目契约语义（从 chunk 还原）：
 *   - 条目形状：{ name, transport: 'stdio'|'http', command, args, env, url, headers }
 *   - 预设表（key/displayName/group/description/capabilities/server/credentials）：
 *     arxiv(uvx arxiv-mcp-server)、zotero(uvx zotero-mcp + env 凭据)、
 *     fetch(uvx mcp-server-fetch)、context7(http) … 按 group 分组展示
 *   - 内置（builtin: 前缀）只读；自定义可增删；凭据写进 server.env
 *   - 持久化：项目契约走 /api/mcp；当前版本存 settings.mcpServers（本地优化，形态一致）
 *
 * 注入点：agent/session.ts 把 mcpServers 映射为 SDK 的 mcpServers 选项。
 */
import { useCallback, useState } from 'react';
import type { McpServerConfig } from '@shared/types';
import { useApp } from '../store/app';
import { Icon } from './Icon';
import { tx, t } from '../i18n';

interface Preset {
  key: string;
  displayName: string;
  group: string;
  description: string;
  capabilities: string[];
  server: Omit<McpServerConfig, 'name'>;
  credentials: Array<{ key: string; label: string; placeholder: string }>;
}

/** 预设连接器表（对齐项目契约 mt=[...]；命令用 uvx —— 随包 bin/ 里带 uv 运行时） */
const PRESETS: Preset[] = [
  {
    key: 'arxiv',
    displayName: 'arXiv',
    group: '文献',
    description: '检索与下载 arXiv 论文摘要与全文，做相关工作调研。',
    capabilities: ['按关键词/作者检索论文', '拉取摘要与元数据', '下载 PDF 全文'],
    server: { transport: 'stdio', command: 'uvx', args: ['arxiv-mcp-server'], env: {} },
    credentials: [],
  },
  {
    key: 'zotero',
    displayName: 'Zotero',
    group: '文献',
    description: '读取本机 Zotero 文献库，引用管理一步到位。',
    capabilities: ['列出文献库条目', '按标签/关键词检索', '读取附件笔记'],
    server: { transport: 'stdio', command: 'uvx', args: ['zotero-mcp'], env: {} },
    credentials: [
      { key: 'ZOTERO_LOCAL', label: '本地模式', placeholder: 'true' },
      { key: 'ZOTERO_API_KEY', label: 'API Key', placeholder: '（本地模式可留空）' },
      { key: 'ZOTERO_LIBRARY_ID', label: 'Library ID', placeholder: '（本地模式可留空）' },
    ],
  },
  {
    key: 'fetch',
    displayName: 'Fetch 网页抓取',
    group: '网络',
    description: '抓取网页并转成 Markdown 给模型阅读。',
    capabilities: ['URL 内容抓取', 'HTML → Markdown', 'robots.txt 遵循'],
    server: { transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch'], env: {} },
    credentials: [],
  },
  {
    key: 'context7',
    displayName: 'Context7',
    group: '网络',
    description: '实时拉取各类库的最新官方文档，避免模型凭旧记忆写 API。',
    capabilities: ['库文档检索', '版本感知的 API 示例'],
    server: { transport: 'http', url: 'https://mcp.context7.com/mcp', env: {} },
    credentials: [],
  },
  {
    key: 'memory',
    displayName: 'Memory 知识图谱',
    group: '效率',
    description: '给 Agent 一个跨会话的长期记忆图谱（本机 JSON 存储）。',
    capabilities: ['记事实/关系', '跨会话检索'],
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: {} },
    credentials: [],
  },
  {
    key: 'filesystem',
    displayName: 'Filesystem 扩展文件访问',
    group: '效率',
    description: '把项目目录之外的白名单目录也交给 Agent 读写。',
    capabilities: ['白名单目录读写', '目录树浏览'],
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'], env: {} },
    credentials: [],
  },
  {
    key: 'github',
    displayName: 'GitHub 项目协作',
    group: '协作',
    description: '读取代码仓库、Issue 和提交记录，适合把建模脚本与论文版本放进同一条工作流。',
    capabilities: ['仓库文件检索', 'Issue 与讨论整理', '提交记录回顾'],
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: {} },
    credentials: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: '访问令牌', placeholder: '只保存在本机设置中' }],
  },
  {
    key: 'time',
    displayName: '时间与时区',
    group: '效率',
    description: '统一比赛截止时间、队伍协作时间和自动化提醒的时区。',
    capabilities: ['时区转换', '当前时间查询', '截止时间换算'],
    server: { transport: 'stdio', command: 'uvx', args: ['mcp-server-time'], env: {} },
    credentials: [],
  },
];

export function ConnectorsSection(): JSX.Element {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const servers = settings?.mcpServers ?? [];
  const [presetCred, setPresetCred] = useState<Preset | null>(null);
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<McpServerConfig | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = useCallback(
    (next: McpServerConfig[]): void => {
      void patchSettings({ mcpServers: next });
      setNotice(next.length ? t('已保存 {{n}} 个连接器，下一个会话生效。', { n: next.length }) : t('已清空连接器。'));
    },
    [patchSettings],
  );

  const addPreset = useCallback(
    (p: Preset, creds: Record<string, string>): void => {
      if (servers.some((s) => s.name === p.key)) {
        setNotice(t('「{{name}}」已在列表中。', { name: p.displayName }));
        return;
      }
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(creds)) {
        if (v.trim()) env[k] = v.trim();
      }
      save([...servers, { name: p.key, ...p.server, env }]);
      setPresetCred(null);
      setCredValues({});
    },
    [servers, save],
  );

  const remove = useCallback(
    (name: string): void => {
      save(servers.filter((s) => s.name !== name));
    },
    [servers, save],
  );

  // 按 group 分组展示（项目契约语义）
  const groups = new Map<string, McpServerConfig[]>();
  for (const s of servers) {
    const g = PRESETS.find((p) => p.key === s.name)?.group ?? tx('extensions.connectorsSection.groupCustom');
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  const addable = PRESETS.filter((p) => !servers.some((s) => s.name === p.key));

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
        {t('连接器 = MCP 服务器：给 Agent 挂外部工具（文献检索、网页抓取…）。配置只存本机；stdio 型命令在本机执行（uvx 由随包的 uv 运行时提供），http 型直连远端 URL。下一个会话生效。')}
      </div>

      {notice && (
        <div className="panel" style={{ padding: 10, fontSize: 12.5 }}>
          {notice}
        </div>
      )}

      {/* ── 已启用 ── */}
      {servers.length > 0 && (
        <section className="col" style={{ gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t('已启用（{{n}}）', { n: servers.length })}</span>
          {[...groups.entries()].map(([group, list]) => (
            <div key={group} className="col" style={{ gap: 6 }}>
              <span className="muted" style={{ fontSize: 11 }}>{t(group)}</span>
              {list.map((s) => (
                <div key={s.name} className="panel row" style={{ padding: 12, gap: 10, alignItems: 'center' }}>
                  <Icon name="plug" size={14} />
                  <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                    <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{PRESETS.find((p) => p.key === s.name)?.displayName ?? s.name}</span>
                      <span className="badge">{s.transport === 'http' ? 'HTTP' : 'stdio'}</span>
                    </div>
                    <span className="muted mono truncate" style={{ fontSize: 10.5 }}>
                      {s.transport === 'http' ? s.url : `${s.command} ${(s.args ?? []).join(' ')}`}
                    </span>
                  </div>
                  <button className="btn btn-sm btn-ghost" onClick={() => remove(s.name)}>
                    {t('移除')}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {/* ── 可添加的预设 ── */}
      <section className="col" style={{ gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t('添加连接器')}</span>
        <div className="col" style={{ gap: 6 }}>
          {addable.map((p) => (
            <div key={p.key} className="panel col" style={{ padding: 12, gap: 6 }}>
              <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t(p.displayName)}</span>
                <span className="badge">{t(p.group)}</span>
                <div className="grow" />
                <button className="btn btn-sm btn-primary" onClick={() => (p.credentials.length ? setPresetCred(p) : addPreset(p, {}))}>
                  {t('添加')}
                </button>
              </div>
              <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>{t(p.description)}</span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {p.capabilities.map((c) => (
                  <span key={c} className="badge">{t(c)}</span>
                ))}
              </div>
              {presetCred === p && (
                <div className="col" style={{ gap: 8, paddingTop: 6 }} onClick={(e) => e.stopPropagation()}>
                  {p.credentials.map((c) => (
                    <div key={c.key} className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <span className="muted" style={{ fontSize: 11.5, width: 90 }}>{t(c.label)}</span>
                      <input
                        className="input mono"
                        style={{ fontSize: 12 }}
                        placeholder={t(c.placeholder)}
                        value={credValues[c.key] ?? ''}
                        onChange={(e) => setCredValues({ ...credValues, [c.key]: e.target.value })}
                      />
                    </div>
                  ))}
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn-sm btn-primary" onClick={() => addPreset(p, credValues)}>
                      {t('确认添加')}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setPresetCred(null)}>
                      {t('取消')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── 自定义 ── */}
      <section className="col" style={{ gap: 8 }}>
        <div className="row" style={{ alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t('自定义 MCP 服务器')}</span>
          <div className="grow" />
          <button className="btn btn-sm" onClick={() => setCustom({ name: '', transport: 'stdio', command: '', args: [], env: {} })}>
            {'＋ ' + t('添加自定义')}
          </button>
        </div>
        {custom && (
          <div className="panel col" style={{ padding: 14, gap: 10 }} onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ gap: 10 }}>
              <div className="field grow">
                <label className="field-label">{t('名称')}</label>
                <input className="input mono" style={{ fontSize: 12 }} value={custom.name} placeholder="my-server" onChange={(e) => setCustom({ ...custom, name: e.target.value.replace(/\s/g, '-') })} />
              </div>
              <div className="field" style={{ width: 130 }}>
                <label className="field-label">{t('传输')}</label>
                <select className="select" value={custom.transport} onChange={(e) => setCustom({ ...custom, transport: e.target.value as 'stdio' | 'http' })}>
                  <option value="stdio">{t('stdio（本机命令）')}</option>
                  <option value="http">{t('http（远端 URL）')}</option>
                </select>
              </div>
            </div>
            {custom.transport === 'stdio' ? (
              <>
                <div className="field">
                  <label className="field-label">{t('命令')}</label>
                  <input className="input mono" style={{ fontSize: 12 }} value={custom.command ?? ''} placeholder="uvx / npx / python…" onChange={(e) => setCustom({ ...custom, command: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label">{t('参数（空格分隔）')}</label>
                  <input className="input mono" style={{ fontSize: 12 }} value={(custom.args ?? []).join(' ')} placeholder="some-mcp-server --flag" onChange={(e) => setCustom({ ...custom, args: e.target.value.split(/\s+/).filter(Boolean) })} />
                </div>
              </>
            ) : (
              <div className="field">
                <label className="field-label">URL</label>
                <input className="input mono" style={{ fontSize: 12 }} value={custom.url ?? ''} placeholder="https://…/mcp" onChange={(e) => setCustom({ ...custom, url: e.target.value })} />
              </div>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn-sm btn-primary"
                disabled={!custom.name.trim() || (custom.transport === 'stdio' ? !custom.command?.trim() : !custom.url?.trim())}
                onClick={() => {
                  save([...servers, custom]);
                  setCustom(null);
                }}
              >
                {t('保存')}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setCustom(null)}>
                {t('取消')}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
