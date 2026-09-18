/**
 * 默认文件名的回归测试 —— 逐字对齐原版 `uw()`（decoded main @852731）。
 *
 * 这条规则是**用户可见**的：导出的文件名对不上，用户在原版与复刻之间来回导就会
 * 得到两套命名。而且它有几个容易"顺手改坏"的点（见下），所以钉死。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportFileName } from './export-name';

afterEach(() => {
  vi.useRealTimers();
});

/** 把时钟固定到 UTC 2026-09-17T12:00:00Z，让日期段可断言 */
function freeze(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-17T12:00:00Z'));
}

describe('exportFileName —— 原版 uw() 规则', () => {
  it('常规：mathmodel-chat-{标题}-{YYYYMMDD}.{ext}', () => {
    freeze();

    expect(exportFileName('2026 年 A 题', 'json')).toBe('mathmodel-chat-2026 年 A 题-20260917.json');
  });

  it('**保留中文与空格**（原版只清 Windows 非法字符，不做 slug 化）', () => {
    freeze();

    expect(exportFileName('数学建模 国赛', 'json')).toBe('mathmodel-chat-数学建模 国赛-20260917.json');
  });

  it('清掉 Windows 非法字符 / \\ : * ? " < > |', () => {
    freeze();

    expect(exportFileName('a/b\\c:d*e?f"g<h>i|j', 'zip')).toBe('mathmodel-chat-abcdefghij-20260917.zip');
  });

  it('反向对照：清洗后为空 → untitled（不是空串、不是 mathmodel-chat--日期）', () => {
    freeze();

    expect(exportFileName('', 'json')).toBe('mathmodel-chat-untitled-20260917.json');
    expect(exportFileName('   ', 'json')).toBe('mathmodel-chat-untitled-20260917.json');
    // 全是非法字符 → 清完只剩空白 → trim 后为空 → 同样走 untitled
    expect(exportFileName('///', 'json')).toBe('mathmodel-chat-untitled-20260917.json');
  });

  it('标题截断到 48 个字符（在清洗与 trim **之后**数）', () => {
    freeze();

    const long = 'x'.repeat(60);
    const name = exportFileName(long, 'json');

    expect(name).toBe(`mathmodel-chat-${'x'.repeat(48)}-20260917.json`);
    // 反向对照：49 个字符就已经被切掉了
    expect(exportFileName('y'.repeat(49), 'json')).toContain(`-${'y'.repeat(48)}-`);
  });

  it('扩展名原样拼接（不补点、不改大小写）', () => {
    freeze();

    expect(exportFileName('t', 'html')).toContain('.html');
    expect(exportFileName('t', 'zip')).toContain('.zip');
  });

  it('日期取 UTC —— 与本地时区无关（照抄原版，别改成 toLocaleDateString）', () => {
    // UTC 的 2026-09-17 23:30 在 UTC+8 已是 18 日，但文件名仍应是 20260917
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T23:30:00Z'));

    expect(exportFileName('t', 'json')).toBe('mathmodel-chat-t-20260917.json');

    // 反向对照：UTC 跨到第二天后才会变成 18
    vi.setSystemTime(new Date('2026-09-18T00:10:00Z'));
    expect(exportFileName('t', 'json')).toBe('mathmodel-chat-t-20260918.json');
  });
});
