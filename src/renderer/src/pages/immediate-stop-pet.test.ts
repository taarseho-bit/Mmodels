import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const chat = readFileSync(fileURLToPath(new URL('./ChatPage.tsx', import.meta.url)), 'utf8');
const desktopPet = readFileSync(
  fileURLToPath(new URL('../components/DesktopPetWindow.tsx', import.meta.url)),
  'utf8',
);
const css = readFileSync(fileURLToPath(new URL('../styles/pages.css', import.meta.url)), 'utf8');
const sessionIpc = readFileSync(
  fileURLToPath(new URL('../../../main/ipc/session.ts', import.meta.url)),
  'utf8',
);

describe('立即停止', () => {
  it('点击后立刻把当前窗口置为 done，并在后台请求取消', () => {
    const start = chat.indexOf('const onAbort = (): void =>');
    const end = chat.indexOf('\n  };', start);
    const handler = chat.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(handler).toContain('chatStreamStore.interrupt(sid)');
    expect(handler).toContain('void window.mathmodel.session.abort(sid)');
    expect(handler).not.toContain('requestStop');
    expect(handler).not.toContain('await window.mathmodel.session.abort');
  });

  it('主进程立即写入空闲状态，再取消 runner；最终结束事件仍由收尾路径发送', () => {
    const start = sessionIpc.indexOf('IPC.SESSION_ABORT');
    const end = sessionIpc.indexOf("}, '中断会话')", start);
    const handler = sessionIpc.slice(start, end);
    const idleAt = handler.indexOf("UPDATE sessions SET status = 'idle'");
    const abortAt = handler.indexOf('runner.abort()');

    expect(idleAt).toBeGreaterThan(-1);
    expect(abortAt).toBeGreaterThan(idleAt);
    expect(handler).not.toContain("type: 'session-stopping'");
  });
});

describe('桌面小模', () => {
  it('聊天页不再挂载软件内小模', () => {
    expect(chat).not.toContain("from '../components/ModelingPet'");
    expect(chat).not.toContain('<ModelingPet');
  });

  it('桌面窗口复用原小模形象，并允许拖动身体和气泡', () => {
    expect(desktopPet).toContain('className="modeling-pet-shell"');
    expect(desktopPet).toContain('className="modeling-pet-eyes"');
    expect(desktopPet).toContain('className="modeling-pet-feet"');
    expect(desktopPet).not.toContain('desktop-pet-antenna');
    expect(css).toMatch(/\.desktop-pet-character\s*\{[\s\S]*?-webkit-app-region:\s*drag;/);
    expect(css).toMatch(/\.desktop-pet-speech\s*\{[\s\S]*?-webkit-app-region:\s*drag;/);
    expect(css).toMatch(/\.desktop-pet-actions button\s*\{[\s\S]*?-webkit-app-region:\s*no-drag;/);
  });
});
