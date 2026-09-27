/**
 * 设置页 ⑭ 关于
 *
 * 对齐应用约定 s13-about：
 *   - 顶部「版本 x.x.x」行 + 「检查更新」按钮（自动更新 → 按既定决策保留骨架并置灰）
 *   - 「版本更新」changelog 区块（最近 3 个版本）+「在网页查看全部更新」
 *   - 外部链接 2×2 网格（官网 / 小红书 / QQ 群 / GitHub）
 *   - 「参加测试版」「帮助排查问题」两张卡（同属自动更新 / 诊断上传 → 骨架 + 置灰）
 *   - 当前实现自有的本机环境信息表保留在末尾
 */
import { useEffect, useState } from 'react';
import { tx, txPlural, t } from '../../i18n';
import { Section } from './shared';
import { CHANGELOG } from '../WhatsNew';

/** changelog 里展示的版本数（应用约定为「最近 3 个版本」） */
const RELEASE_WINDOW = 3;

export function AboutSection(): JSX.Element {
  const [info, setInfo] = useState<{
    app: string;
    electron: string;
    chrome: string;
    node: string;
    platform: string;
    arch: string;
    packaged: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void window.mathmodel.app.version().then(setInfo).catch(() => undefined);
  }, []);

  const releases = CHANGELOG.slice(0, RELEASE_WINDOW);
  const currentVersion = info?.app ?? null;

  const copyDiagnostics = async (): Promise<void> => {
    const lines = info
      ? [
          `MModels v${info.app}`,
          `Electron ${info.electron}`,
          `Chromium ${info.chrome}`,
          `Node ${info.node}`,
          `${info.platform} / ${info.arch}`,
          `运行方式：${info.packaged ? '打包版' : '开发版'}`,
          `本地服务：${window.mathmodel.serverBaseUrl || '未启动'}`,
        ]
      : ['MModels：版本信息暂未读取'];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // 剪贴板被系统拦截时不打断设置页操作。
    }
  };

  return (
    <div className="col" style={{ gap: 22 }}>
      {/* ── 版本行 ── */}
      <div className="panel row" style={{ padding: 14, gap: 12, alignItems: 'center' }}>
        <div className="col grow" style={{ gap: 3 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>
            {info
              ? tx('whatsnew.changelogAccordion.version', { version: info.app })
              : tx('whatsnew.changelogAccordion.version', { version: '—' })}
          </span>
          <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
            {t('自动更新按既定决策未提供，当前为当前版本。')}
          </span>
        </div>
        <span className="badge">{t('本地运行')}</span>
      </div>

      {/* ── 版本更新（changelog）── */}
      <Section
        title={tx('whatsnew.releaseHistoryCard.title')}
        hint={tx('whatsnew.releaseHistoryCard.subtitle')}
      >
        <div className="panel col" style={{ padding: 10, gap: 4 }}>
          {releases.length === 0 ? (
            <span className="muted" style={{ padding: '6px 4px', fontSize: 12 }}>
              {tx('whatsnew.changelogAccordion.empty')}
            </span>
          ) : (
            releases.map((c, i) => (
              <details key={c.version} open={i === 0} className="col" style={{ gap: 6 }}>
                <summary
                  className="row"
                  style={{ gap: 8, cursor: 'pointer', alignItems: 'baseline', padding: '6px 4px' }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {tx('whatsnew.changelogAccordion.version', { version: c.version })}
                  </span>
                  {c.version === currentVersion && (
                    <span className="badge badge-accent">
                      {tx('whatsnew.changelogAccordion.current')}
                    </span>
                  )}
                  <span className="muted" style={{ fontSize: 11 }}>
                    {txPlural('whatsnew.changelogAccordion.updateCount', c.items.length, {
                      count: c.items.length,
                    })}
                  </span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {c.date}
                  </span>
                </summary>
                <ul style={{ margin: '2px 0 6px', paddingLeft: 30, fontSize: 12.5, lineHeight: 1.9 }}>
                  {c.items.map((it, j) => (
                    <li key={j}>{t(it)}</li>
                  ))}
                </ul>
              </details>
            ))
          )}
        </div>
      </Section>

      {/* ── 本机环境信息（当前实现自有，保留）── */}
      <div className="panel" style={{ padding: 14 }}>
        {!info ? (
          <span className="muted">{t('读取版本信息…')}</span>
        ) : (
          <div className="col" style={{ gap: 5, fontSize: 12.5 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="muted" style={{ width: 110 }}>{t('应用版本')}</span>
              <span className="mono">v{info.app}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="muted" style={{ width: 110 }}>Electron</span>
              <span className="mono">{info.electron}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="muted" style={{ width: 110 }}>Chromium</span>
              <span className="mono">{info.chrome}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="muted" style={{ width: 110 }}>Node</span>
              <span className="mono">{info.node}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="muted" style={{ width: 110 }}>{t('平台')}</span>
              <span className="mono">
                {info.platform} / {info.arch}
                {info.packaged ? t('（打包版）') : t('（开发版）')}
              </span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="muted" style={{ width: 110 }}>{t('本地服务')}</span>
              <span className="mono">
                {window.mathmodel.serverBaseUrl || t('未启动')} · {window.mathmodel.serverToken ? t('已鉴权') : t('无 token')}
              </span>
            </div>
          </div>
        )}
        <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm btn-ghost" onClick={() => void copyDiagnostics()}>
            {copied ? t('已复制') : t('复制诊断信息')}
          </button>
        </div>
      </div>
    </div>
  );
}
