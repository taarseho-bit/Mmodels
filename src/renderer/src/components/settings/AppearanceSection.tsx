/**
 * 设置页 ⑨ 外观（2026-09-26 v3：主题 11 选 1）
 *
 *   ① 主题 —— 经典白 / 经典黑 / 跟随系统 + 8 款花纹风格，11 个平级选项一键切换
 *      （用户定稿：不再分「皮肤」「主题模式」两层，全部都叫主题）
 *   ② 语言
 *   ③ 桌面小模 —— 8 个角色（含 4 个写实 3D 风）+ 大小/动作/气泡偏好
 *   ④ 字体与间距
 *
 * 底层仍由 AppearanceState.mode（亮度）+ .skin（风格）双字段驱动，
 * THEME_PRESETS 负责把 11 个选项映射到这两者；风格主题固定 mode='system'。
 */
import { useState } from 'react';
import { PetDeskAvatar, PET_APPEARANCES, resolvePetAppearance } from '../PetDeskAvatar';
import { tx } from '../../i18n';
import { THEME_PRESETS } from '../../lib/skins';
import {
  getAppearance,
  resetAppearance,
  setAppearance,
  useApp,
  type AppearanceDensity,
  type AppearanceMode,
} from '../../store/app';

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
      {/* ── ① 主题：11 选 1（经典白 / 经典黑 / 跟随系统 + 8 款花纹风格），全部平级一键切换 ── */}
      <div className="appearance-card">
        <div className="appearance-row">
          <div className="appearance-row-main">
            <div className="appearance-row-label">主题</div>
            <div className="appearance-row-hint">
              经典白 / 经典黑 / 跟随系统，或选一款带花纹的风格主题。全部平级，点击立即全局生效；风格主题随系统亮暗自动适配，文字始终清晰。
            </div>
          </div>
        </div>
        <div className="skin-grid" role="group" aria-label="主题">
          {THEME_PRESETS.map((preset) => {
            const active = app.skin !== 'classic' ? app.skin === preset.id : app.mode === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className={`skin-chip${active ? ' active' : ''}`}
                style={{ ['--skin-accent' as string]: preset.accent, ['--skin-tint' as string]: preset.tint }}
                onClick={() =>
                  commit(
                    preset.kind === 'brightness'
                      ? { ...app, mode: preset.mode!, skin: 'classic' }
                      : { ...app, mode: 'system', skin: preset.skinId! },
                  )
                }
                title={preset.hint}
                aria-pressed={active}
              >
                <span className="skin-chip-preview" data-pattern={preset.pattern} data-split={preset.tint === 'split' ? '1' : undefined} />
                <span className="skin-chip-body">
                  <span className="skin-chip-dot" />
                  <strong>{preset.name}</strong>
                  {active ? <span className="badge">使用中</span> : null}
                </span>
                <span className="skin-chip-hint">{preset.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── ② 语言 ── */}
      <div className="appearance-card">
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
