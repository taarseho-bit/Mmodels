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

  it('主进程立即保存半截内容并更换 runner，让下一条指令无需等待', () => {
    const start = sessionIpc.indexOf('IPC.SESSION_ABORT');
    const end = sessionIpc.indexOf("}, '中断会话')", start);
    const handler = sessionIpc.slice(start, end);

    expect(handler).toContain('finishInterruptedTurn(turn)');
    expect(sessionIpc).toContain('sessionRegistry.replace(turn.sessionId)');
    expect(sessionIpc).toContain("UPDATE sessions SET status = 'idle', error = NULL");
    expect(sessionIpc).toContain("event: { type: 'session-end', sessionId: turn.sessionId }");
    expect(handler).not.toContain("type: 'session-stopping'");
  });

  it('停止令牌先于运行参数准备，准备期间点击停止也不会重新启动', () => {
    const registerAt = sessionIpc.indexOf('activeTurns.set(sessionId, activeTurn)');
    const prepareAt = sessionIpc.indexOf('await buildRunOptions(sessionId, text, cwd)');
    const runAt = sessionIpc.indexOf('.run(opts as Parameters<typeof runner.run>[0])');
    const guardAt = sessionIpc.indexOf('if (activeTurn.finalized) return { messageId: userMsg.id }', prepareAt);

    expect(registerAt).toBeGreaterThan(-1);
    expect(registerAt).toBeLessThan(prepareAt);
    expect(guardAt).toBeGreaterThan(prepareAt);
    expect(guardAt).toBeLessThan(runAt);
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
