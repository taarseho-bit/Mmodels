/**
 * 更新日志（whatsnew）—— 对应应用约定 whatsNewDialog / whatsNewPopoutCard / changelogAccordion。
 *
 * 应用约定从服务器拉 changelog；当前版本改为**随包内置**（本文件），离线可用。
 * 展示逻辑对齐应用约定：
 *   - 新版本首次启动 → 主界面右下角弹出卡片「此版本有什么新功能」
 *   - 点开 → 对话框：按版本折叠的更新记录（当前版本标记 + 条数）
 *   - 点「知道了」→ 写入 lastSeenVersion，不再打扰
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { tx, t } from '../i18n';

export interface WhatsNewEntry {
  version: string;
  date: string;
  items: string[];
}

export const CHANGELOG: WhatsNewEntry[] = [
  {
      version: '0.1.26',
    date: '2026-09-29',
    items: [
      '会员权益与卡密兑换流程更新，试用、积分和 VIP 状态显示更清楚',
      '项目工作流支持协作状态、技能记录和成果回溯',
      '运行环境检查补充 Python、R、Octave、draw.io 等建模工具',
      '模型供应商支持多个模型池、兼容接口和连接测试',
      '设置页重新整理比赛、资源、模型和运行环境入口',
    ],
  },
];

/** 判断是否有未读的新版本内容 */
export function hasUnseenWhatsNew(currentVersion: string, lastSeen: string | undefined): boolean {
  if (!lastSeen) return false; // 首次启动不弹（避免打断新用户）
  return lastSeen !== currentVersion;
}

/** 当前版本的更新条目（没有就取最近一版） */
export function entryFor(version: string): WhatsNewEntry | null {
  return CHANGELOG.find((c) => c.version === version) ?? CHANGELOG[0] ?? null;
}

/** 「此版本有什么新功能」弹出卡片 + 对话框（App 挂载） */
export function WhatsNew(): JSX.Element | null {
  const [version, setVersion] = useState<string | null>(null);
  const [lastSeen, setLastSeen] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void window.mathmodel.app.version().then((v) => {
      setVersion(v.app);
      setLastSeen(localStorage.getItem('mm-whatsnew-seen'));
      // 非首次启动且版本变了 → 自动展开对话框（应用约定 popout 行为的简化：直接给内容）
      const seen = localStorage.getItem('mm-whatsnew-seen');
      if (seen && seen !== v.app) setOpen(true);
    });
  }, []);

  const dismiss = (): void => {
    if (version) localStorage.setItem('mm-whatsnew-seen', version);
    setOpen(false);
  };

  if (!version || !open) {
    // 版本变了但用户没点开 → 右下角小卡片（应用约定 popoutCard 语义）
    if (version && lastSeen && lastSeen !== version && !open) {
      const e = entryFor(version);
      return (
        <div
          className="panel col"
          style={{ position: 'fixed', right: 18, bottom: 44, zIndex: 60, padding: 14, gap: 6, width: 280, boxShadow: 'var(--shadow-lg, 0 8px 30px rgba(0,0,0,.25))' }}
        >
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="row" style={{ fontSize: 13, fontWeight: 600, gap: 5 }}>
              <Icon name="sparkles" size={13} />
              {t('v{{v}} 有什么新功能', { v: version })}
            </span>
            <span className="badge badge-accent">NEW</span>
          </div>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {e ? t('{{n}} 项更新 · 看看变了什么', { n: e.items.length }) : t('看看变了什么')}
          </span>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>{t('看看变了什么')}</button>
            <button className="btn btn-sm btn-ghost" onClick={dismiss}>{tx('whatsnew.whatsNewDialog.gotIt')}</button>
          </div>
        </div>
      );
    }
    return null;
  }

  const current = entryFor(version);

  return (
    <div className="modal-backdrop" onClick={dismiss} role="presentation">
      <div className="modal" style={{ width: 460, maxHeight: '80vh' }} onClick={(ev) => ev.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title row" style={{ gap: 6 }}>
            <Icon name="sparkles" size={14} />
            {t('此版本有什么新功能')}
          </span>
          <button className="btn btn-sm btn-ghost" onClick={dismiss}>
            ✕
          </button>
        </div>
        <div className="modal-body col" style={{ gap: 14, overflowY: 'auto' }}>
          {CHANGELOG.map((c) => (
            <details key={c.version} open={c.version === version} className="col" style={{ gap: 6 }}>
              <summary className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>v{c.version}</span>
                {c.version === version && <span className="badge badge-accent">{t('当前')}</span>}
                <span className="muted" style={{ fontSize: 11 }}>{c.date}</span>
                <span className="muted" style={{ fontSize: 11 }}>{tx('whatsnew.changelogAccordion.updateCount_other', { count: c.items.length })}</span>
              </summary>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.9 }}>
                {c.items.map((it, i) => (
                  <li key={i}>{t(it)}</li>
                ))}
              </ul>
            </details>
          ))}
          {current && CHANGELOG.length === 0 && <div className="muted">{t('暂无更新记录。')}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-sm btn-primary" onClick={dismiss}>
            {tx('whatsnew.whatsNewDialog.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
}
