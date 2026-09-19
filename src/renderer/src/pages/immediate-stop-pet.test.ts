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
const petWindow = readFileSync(
  fileURLToPath(new URL('../../../main/windows/desktop-pet.ts', import.meta.url)),
  'utf8',
);
const petIpc = readFileSync(
  fileURLToPath(new URL('../../../main/ipc/pet.ts', import.meta.url)),
  'utf8',
);
const composer = readFileSync(
  fileURLToPath(new URL('../components/Composer.tsx', import.meta.url)),
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

  it('停止后的下一条消息会重新评估并组织多智能体', () => {
    expect(sessionIpc).toContain('sessionsResumingAfterStop.add(turn.sessionId)');
    expect(sessionIpc).toContain('sessionsResumingAfterStop.has(sessionId)');
    expect(sessionIpc).toContain("# 停止后的继续执行");
  });
});

describe('比赛信息入口', () => {
  it('模板暂时没有读到时仍保留入口，并允许用户重新检查', () => {
    expect(composer).toContain('<span>{tx(\'composer.composerContextBar.paperSetup\')}</span>');
    expect(composer).not.toContain("{effectiveTpl && (mode === 'paper' || mode === 'review') && (");
    expect(composer).toContain('if (templates.length === 0 && !tplLoading) void loadTemplates()');
    expect(composer).toContain("t('重新检查')");
  });

  it('切项目立即重建输入区，并在当前项目配置读完前禁止保存旧值', () => {
    expect(chat).toContain('key={currentProject.id}');
    expect(composer).toContain('setPaperConfigProjectId(null)');
    expect(composer).toContain('setPaperFields({})');
    expect(composer).toContain('paperConfigProjectId !== targetProjectId');
    expect(composer).toContain('disabled={paperConfigProjectId !== project?.id}');
    expect(composer).toContain("window.mathmodel.paper.getConfig(targetProjectId)");
    expect(composer).toContain("window.mathmodel.paper.saveConfig(patch, targetProjectId)");
  });
});

describe('桌面小模', () => {
  it('聊天页不再挂载软件内小模', () => {
    expect(chat).not.toContain("from '../components/ModelingPet'");
    expect(chat).not.toContain('<ModelingPet');
  });

  it('桌面窗口使用可切换的桌前角色，并通过明确的屏幕坐标移动真实窗口', () => {
    expect(desktopPet).toContain('<PetDeskAvatar appearance={appearance} />');
    expect(desktopPet).toContain('playGesture(\'wave\')');
    expect(desktopPet).toContain('dragStart({ x: event.screenX, y: event.screenY })');
    expect(desktopPet).toContain('dragMove({ x: event.screenX, y: event.screenY })');
    expect(desktopPet).toContain('window.mathmodel.pet.dragEnd()');
    expect(petIpc).toContain('IPC.PET_DRAG_START');
    expect(petIpc).toContain('IPC.PET_DRAG_MOVE');
    expect(petWindow).toContain('validScreenPoint(input)');
    expect(petWindow).toContain('cursor.y - current.offsetY');
    expect(petWindow).toContain('win.setBounds(');
    expect(css).toContain('.desktop-pet-stage.gesture-celebrate');
    expect(css).toContain('.desktop-pet-stage.is-writing .pet-human-arm-right');
  });
});
