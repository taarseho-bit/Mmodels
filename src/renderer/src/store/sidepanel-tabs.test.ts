/** 临时验证：右栏多标签（原版 addTab / closeTab）的开关与激活语义 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useApp, SIDE_PANEL_TABS } from './app';

const reset = (): void =>
  useApp.setState({ sidePanel: null, sidePanelTabs: [...SIDE_PANEL_TABS], activeArtifact: null });

describe('右栏多标签', () => {
  beforeEach(reset);

  it('默认 7 个标签，顺序与原版一致', () => {
    expect([...SIDE_PANEL_TABS]).toEqual([
      'files',
      'terminal',
      'browser',
      'changes',
      'versions',
      'gallery',
      'diagrams',
    ]);
    expect(useApp.getState().sidePanelTabs).toHaveLength(7);
  });

  it('关闭非激活标签：只移除该项，激活项不变', () => {
    useApp.setState({ sidePanel: 'terminal' });
    useApp.getState().closeSidePanelTab('browser');
    expect(useApp.getState().sidePanelTabs).not.toContain('browser');
    expect(useApp.getState().sidePanel).toBe('terminal');
  });

  it('关闭激活标签：激活右邻居；无右邻居则激活左邻居', () => {
    useApp.setState({ sidePanel: 'browser' });
    useApp.getState().closeSidePanelTab('browser');
    expect(useApp.getState().sidePanel).toBe('changes');

    useApp.setState({ sidePanel: 'diagrams' });
    useApp.getState().closeSidePanelTab('diagrams');
    expect(useApp.getState().sidePanel).toBe('gallery');
  });

  it('关掉最后一个标签：收起面板', () => {
    for (const k of SIDE_PANEL_TABS.slice(0, -1)) useApp.getState().closeSidePanelTab(k);
    expect(useApp.getState().sidePanelTabs).toEqual(['diagrams']);
    useApp.getState().closeSidePanelTab('diagrams');
    expect(useApp.getState().sidePanelTabs).toEqual([]);
    expect(useApp.getState().sidePanel).toBeNull();
  });

  it('重新打开已关闭的标签：按原版顺序归位', () => {
    useApp.getState().closeSidePanelTab('versions');
    useApp.getState().setSidePanel('versions');
    expect(useApp.getState().sidePanel).toBe('versions');
    expect(useApp.getState().sidePanelTabs.indexOf('versions')).toBe(4);
  });

  it('打开产物：留在「文件」标签（标签条始终有高亮项）', () => {
    useApp.setState({ sidePanel: 'terminal' });
    useApp.getState().openArtifact('figures/roc.png');
    expect(useApp.getState().activeArtifact).toBe('figures/roc.png');
    expect(useApp.getState().sidePanel).toBe('files');
    expect(useApp.getState().sidePanelTabs).toContain('files');

    useApp.getState().openArtifact(null);
    expect(useApp.getState().activeArtifact).toBeNull();
    expect(useApp.getState().sidePanel).toBe('files');
  });

  it('「文件」标签被关掉后再打开文件：标签会自动补回来', () => {
    useApp.getState().closeSidePanelTab('files');
    expect(useApp.getState().sidePanelTabs).not.toContain('files');
    useApp.getState().openArtifact('report.md');
    expect(useApp.getState().sidePanel).toBe('files');
    expect(useApp.getState().sidePanelTabs).toContain('files');
  });
});
