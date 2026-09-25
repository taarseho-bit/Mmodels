/**
 * 设置页 ⑨ 外观（2026-09-25 重构：像 WorkBuddy 一样简单）
 *
 *   ① 全局皮肤 —— 9 款带花纹的一键皮肤（4 助手色 + 4 新增 + 经典），全局生效
 *   ② 主题模式（跟随系统/浅/深）+ 语言
 *   ③ 桌面小模 —— 8 个角色（含 4 个写实 3D 风）+ 大小/动作/气泡偏好
 *   ④ 字体与间距
 *
 * 旧的「深色/浅色双主题卡 + 文字编码导入导出 + 逐项色值」已按用户要求移除 ——
 * 皮肤系统（lib/skins.ts + store 的 skin 字段）取代了它的日常用途。
 */
import { useState } from 'react';
import { PetDeskAvatar, PET_APPEARANCES, resolvePetAppearance } from '../PetDeskAvatar';
import { tx } from '../../i18n';
import { SKINS } from '../../lib/skins';
import {
  getAppearance,
  resetAppearance,
  setAppearance,
  useApp,
  type AppearanceDensity,
  type AppearanceMode,
} from '../../store/app';

/** 原版分段控件里的三个主题图标（线性，不用 emoji） */
function ThemeIcon({ id }: { id: AppearanceMode }): JSX.Element {
  const common = {
    width: 13,
    height: 13,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (id === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (id === 'dark') {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8.5 21h7M12 17v4" />
    </svg>
  );
}

function densityLabel(d: AppearanceDensity): string {
  if (d === 'compact') return tx('settings.settingsPage.appearance.densityCompact');
  if (d === 'spacious') return tx('settings.settingsPage.appearance.densitySpacious');
  return tx('settings.settingsPage.appearance.densityComfortable');
}

export function AppearanceSection(): JSX.Element {
  const [app, setApp] = useState(() => getAppearance());
  const commit = (next: typeof app): void => {
    setApp(next);
    setAppearance(next);
  };

  // 语言走的是 settings.locale（不是外观状态）
  const locale = useApp((s) => s.settings?.locale ?? 'zh-CN');
  const patchSettings = useApp((s) => s.patchSettings);
  const petAppearance = useApp((s) => resolvePetAppearance(s.settings?.modelingPetAppearance));
  const petEnabled = useApp((s) => s.settings?.modelingPetEnabled !== false);
  const petPreferences = useApp((s) => s.settings);

  return (
    <section className="appearance-sec">
      {/* ── ① 全局皮肤：一键切换，花纹全局生效 ── */}
      <div className="appearance-card">
        <div className="appearance-row">
          <div className="appearance-row-main">
            <div className="appearance-row-label">全局皮肤</div>
            <div className="appearance-row-hint">
              一键切换整站配色与花纹背景，浅色 / 深色模式各自适配，文字始终清晰。
            </div>
          </div>
        </div>
        <div className="skin-grid" role="group" aria-label="全局皮肤">
          {SKINS.map((skin) => {
            const active = app.skin === skin.id;
            return (
              <button
                key={skin.id}
                type="button"
                className={`skin-chip${active ? ' active' : ''}`}
                style={{ ['--skin-accent' as string]: skin.accent, ['--skin-tint' as string]: skin.tint }}
                onClick={() => commit({ ...app, skin: skin.id })}
                title={skin.hint}
                aria-pressed={active}
              >
                <span className="skin-chip-preview" data-pattern={skin.pattern} data-skin-accent={skin.accent} />
                <span className="skin-chip-body">
                  <span className="skin-chip-dot" />
                  <strong>{skin.name}</strong>
                  {active ? <span className="badge">使用中</span> : null}
                </span>
                <span className="skin-chip-hint">{skin.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── ② 主题模式 + 语言 ── */}
      <div className="appearance-card">
        <div className="appearance-row">
          <div className="appearance-row-main">
            <div className="appearance-row-label">
              {tx('settings.settingsPage.appearance.theme')}
            </div>
            <div className="appearance-row-hint">
              {tx('settings.settingsPage.appearance.themeDescription')}
            </div>
          </div>
          <div className="appearance-row-ctl">
            <div className="appearance-seg" role="group">
              {(['system', 'light', 'dark'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={app.mode === id}
                  className={`appearance-seg-btn${app.mode === id ? ' on' : ''}`}
                  onClick={() => commit({ ...app, mode: id })}
                >
                  <ThemeIcon id={id} />
                  {tx(`settings.settingsPage.theme.${id}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="appearance-row">
          <div className="appearance-row-main">
            <div className="appearance-row-label">
              {tx('settings.settingsPage.appearance.language')}
            </div>
            <div className="appearance-row-hint">
              {tx('settings.settingsPage.appearance.languageDescription')}
            </div>
          </div>
          <div className="appearance-row-ctl">
            <select
              className="select appearance-select"
              value={locale}
              onChange={(e) => void patchSettings({ locale: e.target.value as 'zh-CN' | 'en-US' })}
            >
              <option value="zh-CN">
                {tx('settings.settingsPage.appearance.languageChinese')}
              </option>
              <option value="en-US">English</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── ③ 桌面小模 ── */}
      <div className="appearance-card pet-appearance-settings">
        <div className="appearance-row">
          <div className="appearance-row-main">
            <div className="appearance-row-label">桌面小模</div>
            <div className="appearance-row-hint">选择你的建模伙伴，外观立即生效并自动保存。按住人物或气泡可一起拖动；工作时会同步汇报当前进展。</div>
          </div>
          <button type="button" className={`switch${petEnabled ? ' on' : ''}`} aria-label="显示桌面小模" aria-pressed={petEnabled}
            onClick={() => void patchSettings({ modelingPetEnabled: !petEnabled })}><span className="switch-knob" /></button>
        </div>
        <div className="pet-appearance-grid" role="group" aria-label="小模外观">
          {PET_APPEARANCES.map((item) => (
            <button key={item.id} type="button" className={`pet-appearance-option${petAppearance === item.id ? ' selected' : ''}`}
              aria-pressed={petAppearance === item.id} onClick={() => void patchSettings({ modelingPetAppearance: item.id })}>
              <PetDeskAvatar appearance={item.id} />
              <strong>{item.name}{petAppearance === item.id ? ' · 已选择' : ''}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
        <div className="pet-preference-controls">
          <label>角色大小<select className="select" value={petPreferences?.modelingPetSize ?? 'normal'} onChange={(e) => void patchSettings({ modelingPetSize: e.target.value as 'small' | 'normal' })}><option value="small">小巧</option><option value="normal">标准</option></select></label>
          <label>动作频率<select className="select" value={petPreferences?.modelingPetMotion ?? 'lively'} onChange={(e) => void patchSettings({ modelingPetMotion: e.target.value as 'gentle' | 'lively' })}><option value="lively">活泼</option><option value="gentle">轻柔</option></select></label>
          <label>提示气泡<select className="select" value={petPreferences?.modelingPetBubble ?? 'progress'} onChange={(e) => void patchSettings({ modelingPetBubble: e.target.value as 'progress' | 'always' })}><option value="progress">有进展时显示</option><option value="always">一直显示</option></select></label>
          <label><input type="checkbox" checked={petPreferences?.modelingPetQuiet ?? false} onChange={(e) => void patchSettings({ modelingPetQuiet: e.target.checked })} />安静模式（暂停动作和气泡）</label>
        </div>
      </div>

      {/* ── ④ 字体与间距 ── */}
      <div className="appearance-group-title">
        {tx('settings.settingsPage.appearance.typographyTitle')}
      </div>
      <div className="appearance-card">
        <div className="appearance-row">
          <div className="appearance-row-main">
            <div className="appearance-row-label">
              {tx('settings.settingsPage.appearance.systemUiFontTitle')}
            </div>
            <div className="appearance-row-hint">
              {tx('settings.settingsPage.appearance.systemUiFontDescription')}
            </div>
          </div>
          <div className="appearance-row-ctl">
            <button
              type="button"
              className={`switch${app.systemUiFont ? ' on' : ''}`}
              aria-pressed={app.systemUiFont}
              onClick={() => commit({ ...app, systemUiFont: !app.systemUiFont })}
            >
              <span className="switch-knob" />
            </button>
          </div>
        </div>

        <div className="appearance-row">
          <div className="appearance-row-main">
            <div className="appearance-row-label">
              {tx('settings.settingsPage.appearance.uiDensityTitle')}
            </div>
            <div className="appearance-row-hint">
              {tx('settings.settingsPage.appearance.uiDensityDescription')}
            </div>
          </div>
          <div className="appearance-row-ctl">
            <div className="appearance-seg" role="group">
              {(['compact', 'comfortable', 'spacious'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={app.density === d}
                  className={`appearance-seg-btn${app.density === d ? ' on' : ''}`}
                  onClick={() => commit({ ...app, density: d })}
                >
                  {densityLabel(d)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="appearance-row">
          <div className="appearance-row-main">
            <div className="appearance-row-label">
              {tx('settings.settingsPage.appearance.baseFontSizeTitle')}
            </div>
            <div className="appearance-row-hint">
              {tx('settings.settingsPage.appearance.baseFontSizeDescription')}
            </div>
          </div>
          <div className="appearance-row-ctl">
            <input
              className="input appearance-num"
              type="number"
              min={10}
              max={24}
              value={app.baseFontSize}
              onChange={(e) =>
                commit({ ...app, baseFontSize: clampNum(e.target.value, 10, 24, 14) })
              }
            />
            <span className="muted" style={{ fontSize: 11.5 }}>
              px
            </span>
          </div>
        </div>

        <div className="appearance-row">
          <div className="appearance-row-main">
            <div className="appearance-row-label">
              {tx('settings.settingsPage.appearance.terminalFontSizeTitle')}
            </div>
            <div className="appearance-row-hint">
              {tx('settings.settingsPage.appearance.terminalFontSizeDescription')}
            </div>
          </div>
          <div className="appearance-row-ctl">
            <input
              className="input appearance-num"
              type="number"
              min={8}
              max={24}
              value={app.terminalFontSize}
              onChange={(e) =>
                commit({ ...app, terminalFontSize: clampNum(e.target.value, 8, 24, 11) })
              }
            />
            <span className="muted" style={{ fontSize: 11.5 }}>
              px
            </span>
          </div>
        </div>

        <div className="appearance-row">
          <div className="appearance-row-main">
            <div className="appearance-row-label">
              {tx('settings.settingsPage.appearance.terminalFontTitle')}
            </div>
            <div className="appearance-row-hint">
              {tx('settings.settingsPage.appearance.terminalFontDescription')}
            </div>
          </div>
          <div className="appearance-row-ctl">
            <input
              className="input appearance-text"
              value={app.terminalFont}
              placeholder={tx('settings.settingsPage.appearance.uiFontPlaceholder')}
              onChange={(e) => commit({ ...app, terminalFont: e.target.value })}
            />
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', padding: '4px 2px 0' }}>
          <button className="btn btn-sm btn-ghost" onClick={() => resetAppearance()}>
            <span aria-hidden>↺</span>
            {tx('settings.settingsPage.appearance.restoreDefaults')}
          </button>
        </div>
      </div>

    </section>
  );
}

function clampNum(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
