import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(resolve(__dirname, 'ChatPage.tsx'), 'utf8');
const layout = readFileSync(resolve(__dirname, '..', 'styles', 'layout.css'), 'utf8');
const pages = readFileSync(resolve(__dirname, '..', 'styles', 'pages.css'), 'utf8');

function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\{([^}]+)\\}`).exec(source)?.[1] ?? '';
}

describe('对话过程 UI', () => {
  it('工具与思考过程是透明文字流，不再画独立卡片', () => {
    for (const selector of ['.tool-card', '.thinking-block']) {
      const css = rule(layout, selector);
      expect(css).toContain('border: 0');
      expect(css).toContain('background: transparent');
      expect(css).not.toContain('border: 1px');
    }
  });

  it('运行中显示由真实活动派生的等待文案，工具细节默认折叠', () => {
    expect(page).toContain('<WaitingLine blocks={stream.blocks} userText={latestUserText} />');
    expect(page).toContain('activityMessagesFor(blocks, userText)');
    expect(page).toContain('localizeProcessNarration');
    expect(page).toContain("t('查看详情')");
    expect(page).toContain('open && (');
    expect(page).toContain('toolInputForDisplay');
  });

  it('输入区不再显示预计 token 消耗', () => {
    const composer = readFileSync(resolve(__dirname, '..', 'components', 'Composer.tsx'), 'utf8');
    expect(composer).not.toContain('estTokens');
    expect(composer).not.toContain('预计消耗 ≈');
    expect(pages).not.toContain('.cz-cost');
  });

  it('原始失败内容只进入详情，不直接作为正文显示', () => {
    expect(page).not.toContain('error-notice-body">{message}');
    expect(page).not.toContain('title={b.text}');
    expect(page).toContain('<InlineRetryNotice');
    expect(page).toContain('activity-inline-details">{message}');
    expect(rule(pages, '.error-notice')).toContain('background: transparent');
  });
});
