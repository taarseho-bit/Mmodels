/**
 * 设置页 —— 本地设计的**分区导航**结构（左侧栏 + 右侧内容）。
 *
 * 现在按数学建模工作流分为六组：比赛与论文 / 建模资源 / 模型与协作 /
 *           运行环境 / 自动化与通知 / 外观与帮助。
 *
 * ⚠️ 全部本地化：
 *   - 个人资料的用量统计从本地 SQLite 聚合（stats:get），不出网
 *   - 账号与授权：会员状态、注册/登录、卡密兑换由独立账号分区承载
 *   - 凭证只由主进程安全存储，渲染层不接触服务端密钥
 *
 * 各分区已拆分到 `../components/settings/*`，本文件只负责导航 / 搜索 / 分区切换 / 滚动容器。
 */
import { useEffect, useState } from 'react';
import { useApp } from '../store/app';
import { tx, t } from '../i18n';
import { Icon } from '../components/Icon';
import { ResizeHandle } from '../components/ResizeHandle';
import { onOpenSettings } from '../lib/settings-nav';
import { ProfileSection } from '../components/settings/ProfileSection';
import { PaperSection } from '../components/settings/PaperSection';
import { ModelingQualitySection } from '../components/settings/ModelingQualitySection';
import { ChatSection } from '../components/settings/ChatSection';
import { ModelSection } from '../components/settings/ModelSection';
import { ProvidersSection } from '../components/settings/ProvidersSection';
import { EnvSection } from '../components/settings/EnvSection';
import { NetworkSection } from '../components/settings/NetworkSection';
import { SysPromptSection } from '../components/settings/SysPromptSection';
import { AppearanceSection } from '../components/settings/AppearanceSection';
import { KeysSection } from '../components/settings/KeysSection';
import { NotifySection } from '../components/settings/NotifySection';
import { TourSection } from '../components/settings/TourSection';
import { AboutSection } from '../components/settings/AboutSection';
import { AccountSection } from '../components/settings/AccountSection';
import { MembershipModal } from '../components/membership/MembershipModal';
import type { AccountStatusInfo } from '@shared/types';
import { DataChartStudioPage } from './DataChartStudioPage';
import { CompetitionsPage } from './CompetitionsPage';
import { AutomationPage } from './AutomationPage';
import { ExtensionsPage } from './ExtensionsPage';
import type { Route } from '../App';

type SectionId =
  | 'account'
  | 'gallery' | 'competitions' | 'datasets' | 'automation' | 'extensions'
  | 'profile'
  | 'paper'
  | 'quality'
  | 'chat'
  | 'model'
  | 'providers'
  | 'env'
  | 'network'
  | 'sysprompt'
  | 'appearance'
  | 'keys'
  | 'notify'
  | 'bots'
  | 'tour'
  | 'about';

type SectionItem = { id: SectionId; label: string; icon: string };
type SectionGroup = { id: string; label: string; icon: string; items: SectionItem[] };

/** 旧入口仍可能由插件或历史链接传入，但不再把“机器人”作为假功能展示。 */
function normalizeSection(value: string | null | undefined): SectionId | null {
  if (!value) return null;
  if (value === 'bots') return 'about';
  if (value === 'gallery') return 'datasets';
  const ids: SectionId[] = [
    'account', 'gallery', 'competitions', 'datasets', 'automation', 'extensions', 'profile', 'paper', 'quality',
    'chat', 'model', 'providers', 'env', 'network', 'sysprompt', 'appearance', 'keys',
    'notify', 'tour', 'about',
  ];
  return ids.includes(value as SectionId) ? (value as SectionId) : null;
}

function groupForSection(section: SectionId): string {
  if (section === 'account') return 'membership';
  if (['competitions', 'paper', 'quality'].includes(section)) return 'competition';
  if (['extensions', 'datasets'].includes(section)) return 'resources';
  if (['model', 'providers', 'chat', 'sysprompt'].includes(section)) return 'model';
  if (['env', 'network'].includes(section)) return 'runtime';
  if (['automation', 'notify'].includes(section)) return 'automation';
  return 'appearance';
}

export function SettingsPage({
  onBack,
  requestedSection,
  requestedExtensionTab,
  onNavigate,
}: {
  /** 「返回应用」——回到对话页 */
  onBack: () => void;
  /** 外部请求打开设置页时指定的分区（见 lib/settings-nav.ts）；null = 用默认分区 */
  requestedSection?: string | null;
  requestedExtensionTab?: string | null;
  onNavigate: (route: Route) => void;
}): JSX.Element {
  const settings = useApp((s) => s.settings);

  const [section, setSection] = useState<SectionId>('paper');
  const [query, setQuery] = useState('');
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [accountStatus, setAccountStatus] = useState<AccountStatusInfo | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    resources: false,
    model: false,
    runtime: true,
    automation: true,
    appearance: true,
  });

  // 冷启动进设置页时把 App 带进来的分区用上（此时下面的事件监听还没注册）
  useEffect(() => {
    const next = normalizeSection(requestedSection);
    if (next) {
      setSection(next);
      setCollapsed((prev) => ({ ...prev, [groupForSection(next)]: false }));
    }
  }, [requestedSection]);

  // 外部（如扩展页的「跳到运行环境」）通过事件总线指定分区
  useEffect(() => {
    return onOpenSettings(({ section: s }) => {
      const next = normalizeSection(s);
      if (next) setSection(next);
    });
  }, []);

  /**
   * 分区导航 —— 使用线性图标和可折叠分组；完整工作台仍保留独立页面，
   * 只是把入口按数学建模场景重新归类。
   */
  const groups: SectionGroup[] = [
    {
      id: 'membership', label: '会员与账号', icon: 'crown', items: [
        { id: 'account', label: '账号与授权', icon: 'crown' },
      ],
    },
    {
      id: 'competition', label: '比赛与论文', icon: 'trophy', items: [
        { id: 'competitions', label: '竞赛日历', icon: 'calendar-days' },
        { id: 'paper', label: '论文默认规则', icon: 'file-text' },
        { id: 'quality', label: '建模质量与交付', icon: 'clipboard-check' },
      ],
    },
    {
      id: 'resources', label: '建模资源', icon: 'blocks', items: [
        { id: 'extensions', label: '技能、算法与模板', icon: 'blocks' },
        { id: 'datasets', label: '数据与图表', icon: 'chart-column' },
      ],
    },
    {
      id: 'model', label: '模型与协作', icon: 'cpu', items: [
        { id: 'model', label: '模型与思考强度', icon: 'cpu' },
        { id: 'providers', label: '模型供应商', icon: 'plug' },
        { id: 'chat', label: '对话与协作', icon: 'message-square' },
        { id: 'sysprompt', label: '高级提示词', icon: 'text-quote' },
      ],
    },
    {
      id: 'runtime', label: '运行环境', icon: 'monitor', items: [
        { id: 'env', label: '公共环境与项目依赖', icon: 'monitor' },
        { id: 'network', label: '网络连接（高级）', icon: 'globe' },
      ],
    },
    {
      id: 'automation', label: '自动化与通知', icon: 'clock', items: [
        { id: 'automation', label: '比赛提醒与自动化', icon: 'clock' },
        { id: 'notify', label: '通知', icon: 'bell' },
      ],
    },
    {
      id: 'appearance', label: '外观与帮助', icon: 'sun-moon', items: [
        { id: 'appearance', label: '界面与桌面小模', icon: 'sun-moon' },
        { id: 'keys', label: '快捷键', icon: 'keyboard' },
        { id: 'profile', label: '使用统计', icon: 'user' },
        { id: 'tour', label: '新手教程', icon: 'graduation-cap' },
        { id: 'about', label: '关于与诊断', icon: 'info' },
      ],
    },
  ];

  const allSections = groups.flatMap((g) => g.items);

  const q = query.trim().toLowerCase();
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: q ? group.items.filter((s) => `${group.label} ${s.label}`.toLowerCase().includes(q)) : group.items,
    }))
    .filter((group) => group.items.length > 0);
  const current = allSections.find((s) => s.id === section);

  if (!settings) {
    return (
      <div className="page">
        <div className="page-head">
          <span className="page-title">{t('设置')}</span>
        </div>
        <div className="page-scroll">
          <div className="muted" style={{ padding: 20 }}>
            {t('正在加载设置…')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-shell">
      {/* ── 左侧导航（本地设计）── */}
      <aside className="settings-side">
        <ResizeHandle storageKey="mm-settings-nav-width" label="调整设置导航宽度" min={200} max={340} fraction={.32} />
        <button className="settings-back" onClick={onBack}>
          ← {tx('settings.settingsPage.backToApp')}
        </button>
        <input
          className="input settings-search"
          placeholder={tx('settings.settingsPage.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="settings-group-label">数学建模工作台 · {settings.profileName ?? 'MModels'}</div>
        <nav className="settings-nav">
          {visibleGroups.map((group) => {
            const open = q.length > 0 || !collapsed[group.id];
            return (
              <div className="settings-nav-group" key={group.id}>
                <button
                  className="settings-nav-group-head"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                  aria-expanded={open}
                >
                  <span className="settings-nav-icon"><Icon name={group.icon} size={14} /></span>
                  <span className="grow">{group.label}</span>
                  <span className="settings-nav-chevron">{open ? '⌄' : '›'}</span>
                </button>
                {open && group.items.map((s) => (
                  <button
                    key={s.id}
                    className={`settings-nav-item settings-nav-child${section === s.id ? ' active' : ''}`}
                    onClick={() => setSection(s.id)}
                  >
                    <span className="settings-nav-icon"><Icon name={s.icon} size={14} /></span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {visibleGroups.length === 0 && <div className="muted" style={{ padding: '8px 12px', fontSize: 12 }}>{t('没有匹配的设置项')}</div>}
        </nav>
      </aside>

      {/* ── 右侧内容 ── */}
      <div className="settings-main page">
        <div className="page-head">
          <span className="page-title">{current?.label ?? t('设置')}</span>
        </div>
        <div className={`page-scroll${['gallery', 'competitions', 'datasets', 'automation', 'extensions'].includes(section) ? ' settings-tool-scroll' : ''}`}>
          <div className={`settings-content${['gallery', 'competitions', 'datasets', 'automation', 'extensions'].includes(section) ? ' settings-tool-content' : ''}`}>
            {section === 'gallery' && <DataChartStudioPage />}
            {section === 'competitions' && <CompetitionsPage />}
            {section === 'datasets' && <DataChartStudioPage />}
            {section === 'automation' && <AutomationPage />}
            {section === 'extensions' && <ExtensionsPage requestedTab={requestedExtensionTab} onNavigate={onNavigate} />}
            {section === 'account' && (
              <AccountSection
                onStatusChange={setAccountStatus}
                onOpenMembership={() => setMembershipOpen(true)}
              />
            )}
            {section === 'profile' && <ProfileSection />}
            {section === 'paper' && <PaperSection />}
            {section === 'quality' && <ModelingQualitySection />}
            {section === 'chat' && <ChatSection />}
            {section === 'model' && <ModelSection />}
            {section === 'providers' && <ProvidersSection />}
            {section === 'env' && <EnvSection />}
            {section === 'network' && <NetworkSection />}
            {section === 'sysprompt' && <SysPromptSection />}
            {section === 'appearance' && <AppearanceSection />}
            {section === 'keys' && <KeysSection />}
            {section === 'notify' && <NotifySection />}
            {section === 'tour' && <TourSection />}
            {section === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
      <MembershipModal
        open={membershipOpen}
        onClose={() => setMembershipOpen(false)}
        status={accountStatus}
        onStatusChange={setAccountStatus}
      />
    </div>
  );
}
