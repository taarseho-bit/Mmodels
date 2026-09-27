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
import { useCallback, useMemo, useState } from 'react';
import type { McpServerConfig } from '@shared/types';
import { CONNECTOR_CATALOG, CONNECTOR_CATEGORY_LABELS, type ConnectorCatalogEntry } from '@shared/connector-catalog';
import { useApp } from '../store/app';
import { Icon } from './Icon';
import { tx, t } from '../i18n';

export function ConnectorsSection(): JSX.Element {
  const settings = useApp((s) => s.settings);
  const currentProject = useApp((s) => s.currentProject);
  const patchSettings = useApp((s) => s.patchSettings);
  const servers = settings?.mcpServers ?? [];
  const [presetCred, setPresetCred] = useState<ConnectorCatalogEntry | null>(null);
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<McpServerConfig | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [projectOnly, setProjectOnly] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);

  const save = useCallback(
    (next: McpServerConfig[]): void => {
      void patchSettings({ mcpServers: next });
      setNotice(next.length ? t('已保存 {{n}} 个连接器，下一个会话生效。', { n: next.length }) : t('已清空连接器。'));
    },
    [patchSettings],
  );

  const addPreset = useCallback(
    (p: ConnectorCatalogEntry, creds: Record<string, string>): void => {
      if (servers.some((s) => s.name === p.key)) {
        setNotice(t('「{{name}}」已在列表中。', { name: p.displayName }));
        return;
      }
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(creds)) {
        if (v.trim()) env[k] = v.trim();
      }
      save([...servers, { name: p.key, ...p.server, displayName: p.displayName, description: p.description,
        category: p.category, capabilities: p.capabilities, readOnly: p.readOnly,
        permission: p.readOnly ? 'read' : 'project-write',
        projectIds: projectOnly && currentProject ? [currentProject.id] : undefined, env }]);
      setPresetCred(null);
      setCredValues({});
    },
    [currentProject, projectOnly, servers, save],
  );

  const remove = useCallback(
    (name: string): void => {
      save(servers.filter((s) => s.name !== name));
    },
    [servers, save],
  );

  const updateServer = useCallback((name: string, patch: Partial<McpServerConfig>): void => {
    save(servers.map(server => server.name === name ? { ...server, ...patch } : server));
  }, [save, servers]);

  // 按 group 分组展示（项目契约语义）
  const groups = new Map<string, McpServerConfig[]>();
  for (const s of servers) {
    const p = CONNECTOR_CATALOG.find(item => item.key === s.name);
    const g = p ? CONNECTOR_CATEGORY_LABELS[p.category] : tx('extensions.connectorsSection.groupCustom');
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  const addable = useMemo(() => CONNECTOR_CATALOG.filter((p) => !servers.some((s) => s.name === p.key)), [servers]);

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
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{CONNECTOR_CATALOG.find((p) => p.key === s.name)?.displayName ?? s.displayName ?? s.name}</span>
                      <span className="badge">{s.native ? '内置' : s.transport === 'http' ? 'HTTP' : 'stdio'}</span>
                      <span className="badge">{s.projectIds?.length ? '本项目' : '全局'}</span>
                      <span className="badge">{s.permission === 'project-write' ? '项目可写' : s.permission === 'external-write' ? '外部可写' : '只读'}</span>
                    </div>
                    <span className="muted mono truncate" style={{ fontSize: 10.5 }}>
                      {s.transport === 'http' ? s.url : `${s.command} ${(s.args ?? []).join(' ')}`}
                    </span>
                  </div>
                  <label className="row" style={{ gap: 5, fontSize: 11 }} title="关闭后本轮不会把这个连接器交给模型">
                    <input type="checkbox" checked={s.enabled !== false} onChange={e => updateServer(s.name, { enabled: e.target.checked })} />启用
                  </label>
                  {!s.readOnly && (
                    <select className="select" style={{ width: 94, fontSize: 11 }} value={s.permission ?? 'read'} onChange={e => updateServer(s.name, { permission: e.target.value as McpServerConfig['permission'] })}>
                      <option value="read">只读</option>
                      <option value="project-write">项目可写</option>
                      <option value="external-write">外部可写</option>
                    </select>
                  )}
                  <button className="btn btn-sm btn-ghost" disabled={testing === s.name} onClick={() => {
                    setTesting(s.name);
                    void window.mathmodel.connectors.test(s.name)
                      .then(result => setNotice(`${result.displayName ?? s.name}：${result.detail}`))
                      .catch(error => setNotice(error instanceof Error ? error.message : '连接测试失败'))
                      .finally(() => setTesting(null));
                  }}>{testing === s.name ? '测试中…' : '测试连接'}</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => remove(s.name)}>{t('移除')}</button>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {/* ── 可添加的预设 ── */}
      <section className="col" style={{ gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t('添加连接器')}</span>
        <label className="row" style={{ gap: 8, fontSize: 12 }}>
          <input type="checkbox" checked={projectOnly} onChange={e => setProjectOnly(e.target.checked)} disabled={!currentProject} />
          只在当前项目启用{currentProject ? `（${currentProject.name}）` : '（当前没有项目）'}
        </label>
        <div className="col" style={{ gap: 6 }}>
          {addable.map((p) => (
            <div key={p.key} className="panel col" style={{ padding: 12, gap: 6 }}>
              <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t(p.displayName)}</span>
                <span className="badge">{CONNECTOR_CATEGORY_LABELS[p.category]}</span>
                <span className="badge">{p.native ? '内置适配' : p.auth === 'none' ? '无需密钥' : '需要配置'}</span>
                <div className="grow" />
                <button className="btn btn-sm btn-primary" onClick={() => (p.credentials?.length ? setPresetCred(p) : addPreset(p, {}))}>
                  {t('添加')}
                </button>
              </div>
              <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>{t(p.description)}</span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {p.capabilities.map((c) => (
                  <span key={c} className="badge">{t(c)}</span>
                ))}
              </div>
              {presetCred?.key === p.key && (
                <div className="col" style={{ gap: 8, paddingTop: 6 }} onClick={(e) => e.stopPropagation()}>
                  {(p.credentials ?? []).map((c) => (
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
                  save([...servers, { ...custom, readOnly: false, permission: 'project-write', projectIds: projectOnly && currentProject ? [currentProject.id] : undefined }]);
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
