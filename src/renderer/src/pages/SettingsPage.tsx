/**
 * 设置页 —— 复刻原版的**分区导航**结构（左侧栏 + 右侧内容）。
 *
 * 原版侧栏：返回应用 / 搜索设置 / 个人资料 / 论文与比赛 / 对话 / 模型 / 供应商 /
 *           运行环境 / 网络 / 系统提示词 / 外观 / 键盘快捷键 / 通知 / 机器人 / 新手教程 / 关于
 *
 * ⚠️ 全部本地化：
 *   - 个人资料的用量统计从本地 SQLite 聚合（stats:get），不出网
 *   - 没有账号体系：显示名/句柄存本地设置
 *   - 订阅状态：本地版 = 永久 VIP（不接计费）
 *
 * 各分区已拆分到 `../components/settings/*`，本文件只负责导航 / 搜索 / 分区切换 / 滚动容器。
 */
import { useEffect, useState } from 'react';
import { useApp } from '../store/app';
import { tx, t } from '../i18n';
import { Icon } from '../components/Icon';
import { onOpenSettings } from '../lib/settings-nav';
import { ProfileSection } from '../components/settings/ProfileSection';
import { PaperSection } from '../components/settings/PaperSection';
import { ChatSection } from '../components/settings/ChatSection';
import { ModelSection } from '../components/settings/ModelSection';
import { ProvidersSection } from '../components/settings/ProvidersSection';
import { EnvSection } from '../components/settings/EnvSection';
import { NetworkSection } from '../components/settings/NetworkSection';
import { SysPromptSection } from '../components/settings/SysPromptSection';
import { AppearanceSection } from '../components/settings/AppearanceSection';
import { KeysSection } from '../components/settings/KeysSection';
import { NotifySection } from '../components/settings/NotifySection';
import { BotsSection } from '../components/settings/BotsSection';
import { TourSection } from '../components/settings/TourSection';
import { AboutSection } from '../components/settings/AboutSection';
import { GalleryPage } from './GalleryPage';
import { CompetitionsPage } from './CompetitionsPage';
import { DatabasePage } from './DatabasePage';
import { AutomationPage } from './AutomationPage';
import { ExtensionsPage } from './ExtensionsPage';
import type { Route } from '../App';

type SectionId =
  | 'gallery' | 'competitions' | 'datasets' | 'automation' | 'extensions'
  | 'profile'
  | 'paper'
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

export function SettingsPage({
  onBack,
  onOpenAutomations,
  requestedSection,
  requestedExtensionTab,
  onNavigate,
}: {
  /** 「返回应用」——回到对话页 */
  onBack: () => void;
  /** 「机器人」分区里跳自动化管理 */
  onOpenAutomations: () => void;
  /** 外部请求打开设置页时指定的分区（见 lib/settings-nav.ts）；null = 用默认分区 */
  requestedSection?: string | null;
  requestedExtensionTab?: string | null;
  onNavigate: (route: Route) => void;
}): JSX.Element {
  const settings = useApp((s) => s.settings);

  const [section, setSection] = useState<SectionId>('profile');
  const [query, setQuery] = useState('');

  // 冷启动进设置页时把 App 带进来的分区用上（此时下面的事件监听还没注册）
  useEffect(() => {
    if (requestedSection) setSection(requestedSection as SectionId);
  }, [requestedSection]);

  // 外部（如扩展页的「跳到运行环境」）通过事件总线指定分区
  useEffect(() => {
    return onOpenSettings(({ section: s }) => {
      if (s) setSection(s as SectionId);
    });
  }, []);

  /**
   * 分区导航 —— 与原版实机一致：**线性图标**（不是 emoji），
   * 顺序即原版侧栏顺序（个人资料 → 关于）。
   */
  const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
    { id: 'gallery', label: '科研绘图', icon: 'chart-column' },
    { id: 'competitions', label: '竞赛日历', icon: 'calendar-days' },
    { id: 'datasets', label: '数据集', icon: 'database' },
    { id: 'automation', label: '自动化', icon: 'clock' },
    { id: 'extensions', label: '扩展 · 技能与模板', icon: 'blocks' },
    { id: 'profile', label: tx('settings.settingsPage.nav.profile'), icon: 'user' },
    { id: 'paper', label: tx('settings.settingsPage.nav.paperCompetition'), icon: 'file-text' },
    { id: 'chat', label: tx('settings.settingsPage.nav.conversation'), icon: 'message-square' },
    { id: 'model', label: tx('settings.settingsPage.nav.models'), icon: 'cpu' },
    { id: 'providers', label: tx('settings.settingsPage.nav.providers'), icon: 'plug' },
    { id: 'env', label: tx('settings.settingsPage.nav.environment'), icon: 'monitor' },
    { id: 'network', label: tx('settings.settingsPage.nav.network'), icon: 'globe' },
    { id: 'sysprompt', label: tx('settings.settingsPage.nav.systemPrompt'), icon: 'text-quote' },
    { id: 'appearance', label: tx('settings.settingsPage.nav.appearance'), icon: 'sun-moon' },
    { id: 'keys', label: tx('settings.settingsPage.nav.shortcuts'), icon: 'keyboard' },
    { id: 'notify', label: tx('settings.settingsPage.nav.notifications'), icon: 'bell' },
    { id: 'bots', label: tx('settings.settingsPage.nav.bots'), icon: 'bot' },
    { id: 'tour', label: tx('settings.settingsPage.nav.tutorial'), icon: 'graduation-cap' },
    { id: 'about', label: tx('settings.settingsPage.nav.about'), icon: 'info' },
  ];

  const q = query.trim().toLowerCase();
  const visible = q ? SECTIONS.filter((s) => s.label.toLowerCase().includes(q)) : SECTIONS;

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
      {/* ── 左侧导航（复刻原版）── */}
      <aside className="settings-side">
        <button className="settings-back" onClick={onBack}>
          ← {tx('settings.settingsPage.backToApp')}
        </button>
        <input
          className="input settings-search"
          placeholder={tx('settings.settingsPage.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="settings-group-label">工具与偏好 · {settings.profileName ?? 'MModels'}</div>
        <nav className="settings-nav">
          {visible.map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item${section === s.id ? ' active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              <span className="settings-nav-icon">
                <Icon name={s.icon} size={15} />
              </span>
              <span>{s.label}</span>
            </button>
          ))}
          {visible.length === 0 && <div className="muted" style={{ padding: '8px 12px', fontSize: 12 }}>{t('没有匹配的设置项')}</div>}
        </nav>
      </aside>

      {/* ── 右侧内容 ── */}
      <div className="settings-main page">
        <div className="page-head">
          <span className="page-title">{SECTIONS.find((s) => s.id === section)?.label ?? t('设置')}</span>
        </div>
        <div className={`page-scroll${['gallery', 'competitions', 'datasets', 'automation', 'extensions'].includes(section) ? ' settings-tool-scroll' : ''}`}>
          <div className={`settings-content${['gallery', 'competitions', 'datasets', 'automation', 'extensions'].includes(section) ? ' settings-tool-content' : ''}`}>
            {section === 'gallery' && <GalleryPage />}
            {section === 'competitions' && <CompetitionsPage />}
            {section === 'datasets' && <DatabasePage />}
            {section === 'automation' && <AutomationPage />}
            {section === 'extensions' && <ExtensionsPage requestedTab={requestedExtensionTab} onNavigate={onNavigate} />}
            {section === 'profile' && <ProfileSection />}
            {section === 'paper' && <PaperSection />}
            {section === 'chat' && <ChatSection />}
            {section === 'model' && <ModelSection />}
            {section === 'providers' && <ProvidersSection />}
            {section === 'env' && <EnvSection />}
            {section === 'network' && <NetworkSection />}
            {section === 'sysprompt' && <SysPromptSection />}
            {section === 'appearance' && <AppearanceSection />}
            {section === 'keys' && <KeysSection />}
            {section === 'notify' && <NotifySection />}
            {section === 'bots' && <BotsSection onOpenAutomations={onOpenAutomations} />}
            {section === 'tour' && <TourSection />}
            {section === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
