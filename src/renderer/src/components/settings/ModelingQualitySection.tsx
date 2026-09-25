/**
 * 数学建模专属默认策略。
 *
 * 这里保存的是全局默认值；当前项目的比赛规则仍然由“比赛信息”管理。
 * 对话框中的临时选择可以覆盖这些默认值，避免把运行时控制塞进设置页。
 */
import { useApp } from '../../store/app';
import { Section, Switch } from './shared';

export function ModelingQualitySection(): JSX.Element {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const parallel = Math.min(4, Math.max(1, settings?.maxParallelAgents ?? 2));
  const total = Math.min(8, Math.max(parallel, settings?.maxTotalAgents ?? 4));
  const scale = total <= 3 ? 'light' : total <= 5 ? 'standard' : 'dense';

  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="panel col" style={{ padding: 14, gap: 5 }}>
        <strong style={{ fontSize: 13.5 }}>建模质量与交付</strong>
        <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
          这是数学建模任务的默认策略。严格程度越高，智能体越会主动检查数据、模型、图表和论文交付；简单问答不会因此变慢。
        </span>
      </div>

      <Section title="默认检查强度" hint="可以在对话框中临时切换，当前项目的比赛规则优先于这里的默认值。">
        <div className="panel col" style={{ padding: 14, gap: 8 }}>
          <label className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="radio"
              name="modeling-quality-mode"
              checked={(settings?.modelingQualityMode ?? 'balanced') === 'fast'}
              onChange={() => void patchSettings({ modelingQualityMode: 'fast' })}
            />
            <span className="col" style={{ gap: 2 }}><strong style={{ fontSize: 12.5 }}>快速</strong><span className="muted" style={{ fontSize: 11 }}>优先给出方案，适合探索和头脑风暴。</span></span>
          </label>
          <label className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="radio"
              name="modeling-quality-mode"
              checked={(settings?.modelingQualityMode ?? 'balanced') === 'balanced'}
              onChange={() => void patchSettings({ modelingQualityMode: 'balanced' })}
            />
            <span className="col" style={{ gap: 2 }}><strong style={{ fontSize: 12.5 }}>标准</strong><span className="muted" style={{ fontSize: 11 }}>兼顾速度和验证，适合日常建模与论文写作。</span></span>
          </label>
          <label className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="radio"
              name="modeling-quality-mode"
              checked={(settings?.modelingQualityMode ?? 'balanced') === 'strict'}
              onChange={() => void patchSettings({ modelingQualityMode: 'strict' })}
            />
            <span className="col" style={{ gap: 2 }}><strong style={{ fontSize: 12.5 }}>严格交付</strong><span className="muted" style={{ fontSize: 11 }}>主动做验证、敏感性分析、引用核对和提交前检查。</span></span>
          </label>
        </div>
      </Section>

      <Section title="技能选择" hint="关闭后，智能体仍可使用你在对话中明确指定的技能。">
        <div className="panel" style={{ padding: 14 }}>
          <Switch
            on={settings?.skillAutoSelect !== false}
            onChange={(enabled) => void patchSettings({ skillAutoSelect: enabled })}
            label="根据题目自动选择技能"
            hint="会根据题目、附件和当前比赛阶段选择数据分析、建模、绘图、论文排版或交付检查技能。"
          />
        </div>
      </Section>

      <Section title="协作规模" hint="用三档控制协同密度；智能体会优先复用已有成员，不为了展示而堆很多节点。">
        <div className="panel col" style={{ padding: 14, gap: 12 }}>
          <select className="select" value={scale} onChange={(e) => {
            const value = e.target.value;
            const next = value === 'light' ? { maxParallelAgents: 1, maxTotalAgents: 2 } : value === 'dense' ? { maxParallelAgents: 4, maxTotalAgents: 8 } : { maxParallelAgents: 2, maxTotalAgents: 4 };
            void patchSettings(next);
          }}>
            <option value="light">轻量协作 · 1–2 位</option>
            <option value="standard">标准协作 · 2–4 位</option>
            <option value="dense">密集协作 · 3–6 位</option>
          </select>
          <span className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>轻量适合快速试算，标准适合论文写作，密集只在题目确实需要多个专业分工时启用。</span>
        </div>
      </Section>
    </div>
  );
}
