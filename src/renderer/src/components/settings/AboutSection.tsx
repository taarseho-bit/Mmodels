/**
 * 设置页 ⑭ 关于
 *
 * 对齐原版 s13-about：
 *   - 顶部「版本 x.x.x」行 + 「检查更新」按钮（自动更新 → 按既定决策保留骨架并置灰）
 *   - 「版本更新」changelog 区块（最近 3 个版本）+「在网页查看全部更新」
 *   - 外部链接 2×2 网格（官网 / 小红书 / QQ 群 / GitHub）
 *   - 「参加测试版」「帮助排查问题」两张卡（同属自动更新 / 诊断上传 → 骨架 + 置灰）
 *   - 复刻自有的本机环境信息表保留在末尾
 */
import { useEffect, useState } from 'react';
import { tx, txPlural, t } from '../../i18n';
import { Section } from './shared';
import { Icon } from '../Icon';
import { CHANGELOG } from '../WhatsNew';

/** changelog 里展示的版本数（原版为「最近 3 个版本」） */
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

  useEffect(() => {
    void window.mathmodel.app.version().then(setInfo).catch(() => undefined);
  }, []);

  const releases = CHANGELOG.slice(0, RELEASE_WINDOW);
  const currentVersion = info?.app ?? null;

  /** 外部链接：本地版没有可用的云端落点，统一按原版「即将推出」态展示 */
  const links: { key: string; icon: string; name: string; desc: string }[] = [
    { key: 'website', icon: 'globe', name: tx('settings.socialLinks.website'), desc: tx('settings.socialLinks.websiteDescription') },
    { key: 'xiaohongshu', icon: 'book-open', name: tx('settings.socialLinks.xiaohongshu'), desc: tx('settings.socialLinks.xiaohongshuDescription') },
    { key: 'qq', icon: 'message-circle', name: tx('settings.socialLinks.qqGroup'), desc: tx('settings.socialLinks.qqGroupDescription') },
    { key: 'github', icon: 'git-fork', name: 'GitHub', desc: tx('settings.socialLinks.githubDescription') },
  ];

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
            {t('自动更新按既定决策未提供，当前为本地版。')}
          </span>
        </div>
        <button className="btn btn-sm" disabled title={tx('settings.socialLinks.soon')}>
          {t('检查更新')}
        </button>
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
          <button className="btn btn-sm btn-ghost" disabled style={{ alignSelf: 'flex-start' }} title={tx('settings.socialLinks.soon')}>
            {tx('whatsnew.releaseHistoryCard.viewAll')} ↗
          </button>
        </div>
      </Section>

      {/* ── 外部链接 2×2 网格 ── */}
      <div className="col" style={{ gap: 8 }}>
        {[0, 1].map((rowIdx) => (
          <div key={rowIdx} className="row" style={{ gap: 8 }}>
            {links.slice(rowIdx * 2, rowIdx * 2 + 2).map((l) => (
              <div
                key={l.key}
                className="panel row"
                style={{ padding: 12, gap: 10, alignItems: 'center', flex: 1, minWidth: 0, opacity: 0.6 }}
                title={tx('settings.socialLinks.comingSoon', { name: l.name })}
              >
                <span style={{ fontSize: 16, display: 'inline-flex', alignItems: 'center' }}>
                  <Icon name={l.icon} size={16} />
                </span>
                <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{l.name}</span>
                  <span className="muted truncate" style={{ fontSize: 11 }}>
                    {l.desc}
                  </span>
                </div>
                <span className="badge" style={{ flexShrink: 0 }}>
                  {tx('settings.socialLinks.soon')}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── 参加测试版（自动更新范畴 → 骨架 + 置灰）── */}
      <div className="panel row" style={{ padding: 14, gap: 12, alignItems: 'flex-start', opacity: 0.6 }}>
        <span style={{ fontSize: 14, lineHeight: 1.4, display: 'inline-flex', alignItems: 'center' }}>
          <Icon name="sparkles" size={14} />
        </span>
        <div className="col grow" style={{ gap: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{t('参加测试版')}</span>
          <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
            {t('加入后优先收到测试版本；本地版不提供自动更新通道。')}
          </span>
        </div>
        <button className="btn btn-sm" disabled title={tx('settings.socialLinks.soon')}>
          {t('暂不可用')}
        </button>
      </div>

      {/* ── 帮助排查问题（诊断上传 → 骨架 + 置灰）── */}
      <Section title={tx('settings.diagnostics.title')} hint={tx('settings.diagnostics.description')}>
        <div className="panel row" style={{ padding: 14, gap: 12, alignItems: 'center', opacity: 0.6 }}>
          <div className="col grow" style={{ gap: 3 }}>
            <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
              {tx('settings.diagnostics.more')}
            </span>
          </div>
          <button className="btn btn-sm" disabled title={tx('settings.socialLinks.soon')}>
            {tx('settings.diagnostics.upload')}
          </button>
        </div>
      </Section>

      {/* ── 本机环境信息（复刻自有，保留）── */}
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
      </div>
    </div>
  );
}
