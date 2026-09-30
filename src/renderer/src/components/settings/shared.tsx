/**
 * 设置页共用小件 —— 从 SettingsPage.tsx 原样搬出，供各分区复用。
 *
 * 注意：本文件不得 import 任何 section，避免循环依赖。
 */

export function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }): JSX.Element {
  return (
    <section className="col settings-section" style={{ gap: 10 }}>
      <span className="settings-section-title" style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
      {hint ? <div className="muted settings-section-hint" style={{ fontSize: 12, lineHeight: 1.7 }}>{hint}</div> : null}
      {children}
    </section>
  );
}

export function Switch({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="field">
      <label className="row" style={{ gap: 10, cursor: 'pointer', alignItems: 'flex-start' }}>
        <button
          className={`switch${on ? ' on' : ''}`}
          style={{ marginTop: 1, flexShrink: 0 }}
          onClick={(e) => {
            e.preventDefault();
            onChange(!on);
          }}
        >
          <span className="switch-knob" />
        </button>
        <div className="col">
          <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
          {hint ? (
            <span className="field-hint" style={{ marginTop: 3 }}>
              {hint}
            </span>
          ) : null}
        </div>
      </label>
    </div>
  );
}
