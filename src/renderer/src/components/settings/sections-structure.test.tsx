/**
 * 外观 / 键盘快捷键两个分区的结构回归测试。
 *
 * 盯的是「整段空白」这类渲染期崩溃，以及原版条目是否齐（4 组 14 条）：
 * 单项文案由 i18n 保证，控件数量与分组这里兜底。
 * node 环境下没有 DOM，所以在 beforeAll 里打最小桩。
 */
import { describe, expect, it, beforeAll } from 'vitest';

beforeAll(() => {
  const el = {
    dataset: {} as Record<string, string>,
    style: { setProperty() {}, removeProperty() {} },
  };
  const store = new Map<string, string>();
  (globalThis as unknown as { document: unknown }).document = {
    documentElement: el,
    getElementById: () => null,
  };
  (globalThis as unknown as { window: unknown }).window = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: () => 0,
    mathmodel: {
      app: { setNativeTheme: async () => true, openPath: async () => true, showItemInFolder: async () => true, keybindingsFile: async () => 'C:/tmp/keybindings.json' },
      settings: { set: async () => ({}) },
    },
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform: 'Win32' },
    configurable: true,
    writable: true,
  });
});

describe('设置页 外观 / 快捷键分区结构', () => {
  it('AppearanceSection 渲染出主题编辑器与字体与间距', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const React = await import('react');
    const { AppearanceSection } = await import('./AppearanceSection');
    const html = renderToStaticMarkup(React.createElement(AppearanceSection));
    expect(html).toContain('appearance-seg');
    expect(html).toContain('mathmodel');
    expect(html).toContain('#0A84FF');
    expect(html).toContain('#007AFF');
    // node 环境里 matchMedia 返回 false → 生效主题是 light
    expect(html).toContain('系统当前正在使用 light 主题。');
    expect(html).toContain('系统切换到 dark 时使用。');
    expect(html).toContain('恢复默认');
    expect(html).toContain('使用系统界面字体');
    expect(html).toContain('终端字体');
    expect(html).toContain('界面密度');
    expect((html.match(/class="appearance-color-chip"/g) ?? []).length).toBe(6);
  });

  it('KeysSection 渲染出 4 组 14 条 + 搜索 + 文件路径', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const React = await import('react');
    const { KeysSection } = await import('./KeysSection');
    const html = renderToStaticMarkup(React.createElement(KeysSection));
    expect(html).toContain('自定义快捷键');
    expect(html).toContain('搜索快捷键…');
    expect(html).toContain('keybindings.json');
    expect((html.match(/class="keys-row"/g) ?? []).length).toBe(14);
    for (const label of [
      '键盘快捷键帮助',
      '搜索会话和页面',
      '收起或展开侧栏',
      '发送消息',
      '插入换行',
      '切换计划模式',
      '添加附件',
      '提交消息编辑',
      '在会话中查找',
      '跳到下一个命中（查找栏中按 Shift 反向）',
      '快速选择批准或问题选项',
      '使用首选编辑器打开当前文件',
      '上一张图片',
      '下一张图片',
    ]) {
      expect(html).toContain(label);
    }
    // 复刻自创的 3 条应已移除
    expect(html).not.toContain('关闭弹层');
    expect(html).not.toContain('打开设置');
  });
});
