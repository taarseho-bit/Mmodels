import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionStream } from '../store/chat-stream';
import {
  EMPTY_STREAM,
  applyStreamEvent,
  emptySessionStream,
  toView,
} from '../store/chat-stream';
import { PET_COPY, petStateFor } from '../lib/modeling-activity';
import { Icon } from './Icon';

export function DesktopPetWindow(): JSX.Element {
  const streams = useRef(new Map<string, SessionStream>());
  const [view, setView] = useState(EMPTY_STREAM);

  useEffect(() => {
    return window.mathmodel.session.onStream((sessionId, event) => {
      const previous = streams.current.get(sessionId) ?? emptySessionStream(sessionId);
      const next = applyStreamEvent(previous, event);
      streams.current.set(sessionId, next);
      const running = [...streams.current.values()]
        .filter((entry) => entry.phase === 'running' || entry.phase === 'stopping')
        .sort((a, b) => b.updatedAt - a.updatedAt);
      setView(toView(running[0] ?? next));
    });
  }, []);

  useEffect(() => {
    let interactive = false;
    const update = (next: boolean): void => {
      if (next === interactive) return;
      interactive = next;
      window.mathmodel.pet.setInteractive(next);
    };
    const onMove = (event: MouseEvent): void => {
      const target = event.target;
      update(target instanceof Element && !!target.closest('[data-pet-interactive="true"]'));
    };
    const onLeave = (): void => update(false);
    window.addEventListener('mousemove', onMove);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      update(false);
    };
  }, []);

  const state = useMemo(
    () => petStateFor({
      active: view.active,
      stopping: view.stopping,
      blocks: view.blocks.filter(Boolean),
      agents: view.agents,
    }),
    [view],
  );

  return (
    <main className={`desktop-pet-stage is-${state}`} data-pet-state={state}>
      <section className="desktop-pet-speech" data-pet-interactive="true">
        <div className="desktop-pet-speech-head">
          <strong><span className="desktop-pet-status-dot" />小模</strong>
          <span className="desktop-pet-actions">
            <button type="button" title="打开 MModels" onClick={() => void window.mathmodel.pet.showMain()}>
              <Icon name="app-window" size={13} />
            </button>
            <button
              type="button"
              title="让小模休息"
              onClick={() => void window.mathmodel.settings.set({ modelingPetEnabled: false })}
            >
              <Icon name="x" size={13} />
            </button>
          </span>
        </div>
        <p>{PET_COPY[state]}</p>
      </section>

      <div
        className="desktop-pet-character"
        data-pet-interactive="true"
        title="拖动小模到桌面的任意位置"
        aria-label={`桌面数学建模伙伴：${PET_COPY[state]}`}
      >
        <span className="desktop-pet-orbit" />
        <span className="desktop-pet-antenna"><i /></span>
        <span className="desktop-pet-arm is-left" />
        <span className="desktop-pet-arm is-right" />
        <span className="desktop-pet-shell">
          <Icon name={state === 'collaborating' ? 'brain' : 'sigma'} size={31} strokeWidth={2.35} />
          <span className="desktop-pet-eyes"><i /><i /></span>
        </span>
        <span className="desktop-pet-feet"><i /><i /></span>
      </div>
    </main>
  );
}
