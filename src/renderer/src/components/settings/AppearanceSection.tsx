/**
 * 设置页 ⑨ 外观
 *
 * 对照原版（original/s08-appearance）逐控件复刻：
 *   1. 主题分段控件（跟随系统 / 浅色 / 深色）+ 语言下拉
 *   2. 深色主题卡 / 浅色主题卡 —— 各 9 个控件：
 *      主题方案下拉（Aa + mathmodel）、导入、复制、说明行、
 *      强调色 / 背景色 / 前景色、界面字体、代码字体、半透明侧栏、对比度
 *   3. 「字体与间距」整组：使用系统界面字体、界面密度、基础字号、终端字号、终端字体
 *   4. 分区标题右侧「恢复默认」
 *
 * 改动实时生效：状态与 DOM 应用逻辑都在 store/app.ts（applyAppearance），
 * 这里只负责改状态 + 持久化。
 */
import { useState } from 'react';
import { PetDeskAvatar, PET_APPEARANCES, resolvePetAppearance } from '../PetDeskAvatar';
import { tx } from '../../i18n';
import {
  getAppearance,
  resetAppearance,
  setAppearance,
  useApp,
  type AppearanceDensity,
  type AppearanceMode,
  type AppearanceState,
  type ThemeVariant,
} from '../../store/app';

const SHARE_PREFIX = 'codex-theme-v1:';

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
  const [app, setApp] = useState<AppearanceState>(() => getAppearance());
  /** 正在导入分享字符串的主题（null = 没展开导入框） */
  const [importing, setImporting] = useState<'dark' | 'light' | null>(null);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 语言走的是 settings.locale（不是外观状态）
  const locale = useApp((s) => s.settings?.locale ?? 'zh-CN');
  const patchSettings = useApp((s) => s.patchSettings);
  const petAppearance = useApp((s) => resolvePetAppearance(s.settings?.modelingPetAppearance));
  const petEnabled = useApp((s) => s.settings?.modelingPetEnabled !== false);
  /** 当前生效的浅/深（决定两张卡片的说明文案：正在用 / 切到某模式时用） */
  const activeTheme =
    (document.documentElement.dataset.theme as 'light' | 'dark' | undefined) ?? 'light';

  const commit = (next: AppearanceState): void => {
    setApp(next);
    setAppearance(next);
  };

  const patchVariant = (key: 'dark' | 'light', patch: Partial<ThemeVariant>): void => {
    // 任何一次编辑都视作「这张主题卡已被用户接管」
    commit({ ...app, [key]: { ...app[key], ...patch, touched: true } });
  };

  const flash = (msg: string): void => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const copyVariant = async (key: 'dark' | 'light'): Promise<void> => {
    const payload = { variant: key, preset: app[key].preset, tokens: app[key] };
    const token = `${SHARE_PREFIX}${btoa(encodeURIComponent(JSON.stringify(payload)))}`;
    try {
      await navigator.clipboard.writeText(token);
      flash(tx('settings.settingsPage.appearance.copiedTitle'));
    } catch {
      flash(tx('settings.settingsPage.appearance.copyFailed'));
    }
  };

  const doImport = (key: 'dark' | 'light'): void => {
    try {
      const raw = importText.trim();
      if (!raw.startsWith(SHARE_PREFIX)) throw new Error('bad prefix');
      const payload = JSON.parse(decodeURIComponent(atob(raw.slice(SHARE_PREFIX.length)))) as {
        variant?: string;
        tokens?: Partial<ThemeVariant>;
      };
      // 原版行为：字符串里的模式必须与目标卡一致
      if (payload.variant && payload.variant !== key) throw new Error('variant mismatch');
      patchVariant(key, { ...(payload.tokens ?? {}), touched: true });
      setImporting(null);
      setImportText('');
      setImportError(false);
      flash(tx('settings.settingsPage.appearance.importedTitle'));
    } catch {
      setImportError(true);
    }
  };

  return (
    <section className="appearance-sec">
      <div className="appearance-card pet-appearance-settings">
        <div className="appearance-row">
          <div className="appearance-row-main">
            <div className="appearance-row-label">桌面小模</div>
            <div className="appearance-row-hint">选择你的建模伙伴，外观立即生效并自动保存。按住人物或气泡可一起拖动。</div>
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
      </div>
      {/* ── 分区头：恢复默认（原版在标题行右侧）── */}
      <div className="appearance-head">
        <div className="grow" />
        <button className="btn btn-sm btn-ghost" onClick={() => resetAppearance()}>
          <span aria-hidden>↺</span>
          {tx('settings.settingsPage.appearance.restoreDefaults')}
        </button>
      </div>

      {/* ── 主题 + 语言 ── */}
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

      {/* ── 深色 / 浅色主题编辑器 ── */}
      {(['dark', 'light'] as const).map((key) => (
        <div className="appearance-card" key={key}>
          <div className="appearance-card-head">
            <span className="appearance-card-title">
              {tx(
                key === 'dark'
                  ? 'settings.settingsPage.appearance.darkTheme'
                  : 'settings.settingsPage.appearance.lightTheme',
              )}
            </span>
            <div className="grow" />
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setImporting(key);
                setImportText('');
                setImportError(false);
              }}
            >
              {tx('settings.settingsPage.appearance.import')}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => void copyVariant(key)}>
              {tx('settings.settingsPage.appearance.copy')}
            </button>
            <span className="appearance-preset">
              <span className="appearance-aa" aria-hidden>
                Aa
              </span>
              <select
                className="appearance-preset-select"
                value={app[key].preset}
                onChange={(e) => patchVariant(key, { preset: e.target.value })}
              >
                <option value="mathmodel">mathmodel</option>
              </select>
            </span>
          </div>

          <div className="appearance-card-desc">
            {key === activeTheme
              ? tx('settings.settingsPage.appearance.systemUsingSlot', { variant: key })
              : tx('settings.settingsPage.appearance.usedWhenSystem', { variant: key })}
          </div>

          {importing === key && (
            <div className="appearance-import">
              <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
                {tx('settings.settingsPage.appearance.importHint', { variant: key })}
              </div>
              <textarea
                className="textarea"
                style={{ minHeight: 56, fontSize: 11.5, fontFamily: 'var(--font-mono)' }}
                value={importText}
                placeholder={`${SHARE_PREFIX}…`}
                onChange={(e) => setImportText(e.target.value)}
              />
              {importError && (
                <div style={{ color: 'var(--danger)', fontSize: 11.5 }}>
                  {tx('settings.settingsPage.appearance.importInvalid')}
                </div>
              )}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-sm btn-primary" onClick={() => doImport(key)}>
                  {tx('settings.settingsPage.appearance.import')}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setImporting(null)}>
                  {tx('common.cancel')}
                </button>
              </div>
            </div>
          )}

          <div className="appearance-row">
            <div className="appearance-row-main">
              <div className="appearance-row-label">
                {tx('settings.settingsPage.appearance.accent')}
              </div>
            </div>
            <div className="appearance-row-ctl">
              <ColorChip
                value={app[key].accent}
                onChange={(v) => patchVariant(key, { accent: v })}
              />
            </div>
          </div>

          <div className="appearance-row">
            <div className="appearance-row-main">
              <div className="appearance-row-label">
                {tx('settings.settingsPage.appearance.background')}
              </div>
            </div>
            <div className="appearance-row-ctl">
              <ColorChip
                value={app[key].background}
                onChange={(v) => patchVariant(key, { background: v })}
              />
            </div>
          </div>

          <div className="appearance-row">
            <div className="appearance-row-main">
              <div className="appearance-row-label">
                {tx('settings.settingsPage.appearance.foreground')}
              </div>
            </div>
            <div className="appearance-row-ctl">
              <ColorChip
                value={app[key].foreground}
                onChange={(v) => patchVariant(key, { foreground: v })}
              />
            </div>
          </div>

          <div className="appearance-row">
            <div className="appearance-row-main">
              <div className="appearance-row-label">
                {tx('settings.settingsPage.appearance.uiFont')}
              </div>
            </div>
            <div className="appearance-row-ctl">
              <input
                className="input appearance-text"
                value={app[key].uiFont}
                placeholder={tx('settings.settingsPage.appearance.uiFontPlaceholder')}
                onChange={(e) => patchVariant(key, { uiFont: e.target.value })}
              />
            </div>
          </div>

          <div className="appearance-row">
            <div className="appearance-row-main">
              <div className="appearance-row-label">
                {tx('settings.settingsPage.appearance.codeFont')}
              </div>
            </div>
            <div className="appearance-row-ctl">
              <input
                className="input appearance-text"
                value={app[key].codeFont}
                placeholder={tx('settings.settingsPage.appearance.uiFontPlaceholder')}
                onChange={(e) => patchVariant(key, { codeFont: e.target.value })}
              />
            </div>
          </div>

          <div className="appearance-row">
            <div className="appearance-row-main">
              <div className="appearance-row-label">
                {tx('settings.settingsPage.appearance.translucentSidebar')}
              </div>
            </div>
            <div className="appearance-row-ctl">
              <button
                type="button"
                className={`switch${app[key].translucentSidebar ? ' on' : ''}`}
                aria-pressed={app[key].translucentSidebar}
                onClick={() =>
                  patchVariant(key, { translucentSidebar: !app[key].translucentSidebar })
                }
              >
                <span className="switch-knob" />
              </button>
            </div>
          </div>

          <div className="appearance-row">
            <div className="appearance-row-main">
              <div className="appearance-row-label">
                {tx('settings.settingsPage.appearance.contrast')}
              </div>
            </div>
            <div className="appearance-row-ctl">
              <input
                className="appearance-slider"
                type="range"
                min={0}
                max={100}
                step={1}
                value={app[key].contrast}
                onChange={(e) => patchVariant(key, { contrast: Number(e.target.value) })}
              />
              <span className="appearance-slider-value">{app[key].contrast}</span>
            </div>
          </div>
        </div>
      ))}

      {/* ── 字体与间距 ── */}
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
      </div>

      {toast ? <div className="panel-toast">{toast}</div> : null}
    </section>
  );
}

function clampNum(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 色值胶囊：圆形色块（点击唤起系统取色器）+ 等宽色值文本 */
function ColorChip({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <span className="appearance-color-chip">
      <span className="appearance-swatch" style={{ background: value }}>
        <input
          type="color"
          value={normInput(value)}
          aria-label={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
      </span>
      <span>{value}</span>
    </span>
  );
}

/** <input type=color> 只吃 #rrggbb，三位简写补全 */
function normInput(v: string): string {
  const s = (v || '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : '#000000';
}
