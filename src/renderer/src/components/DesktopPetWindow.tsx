import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { SessionStream } from '../store/chat-stream';
import {
  EMPTY_STREAM,
  applyStreamEvent,
  emptySessionStream,
  toView,
} from '../store/chat-stream';
import { PET_COPY, petStateFor } from '../lib/modeling-activity';
import { Icon } from './Icon';
import { PetDeskAvatar, resolvePetAppearance, type PetAppearance } from './PetDeskAvatar';

type PetGesture = 'idle' | 'wave' | 'think' | 'celebrate' | 'stretch';

const GESTURE_COPY: Record<Exclude<PetGesture, 'idle'>, string> = {
  wave: '嗨，我在这里。拖住我就能搬到你喜欢的位置。',
  think: '换个角度想一想，也许能找到更简单的模型。',
  celebrate: '这一小步完成啦，继续把结果和结论对齐！',
  stretch: '活动一下，回来继续拆问题。',
};

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  character: boolean;
}

export function DesktopPetWindow(): JSX.Element {
  const streams = useRef(new Map<string, SessionStream>());
  const gestureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<DragState | null>(null);
  const [view, setView] = useState(EMPTY_STREAM);
  const [appearance, setAppearance] = useState<PetAppearance>('student');

  useEffect(() => {
    let live = true;
    let changed = false;
    const unsubscribe = window.mathmodel.settings.onChanged((settings) => {
      changed = true;
      setAppearance(resolvePetAppearance(settings.modelingPetAppearance));
    });
    void window.mathmodel.settings.get().then((settings) => {
      if (live && !changed) setAppearance(resolvePetAppearance(settings.modelingPetAppearance));
    });
    return () => { live = false; unsubscribe(); };
  }, []);
  const [gesture, setGesture] = useState<PetGesture>('idle');
  const [gestureCopy, setGestureCopy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [look, setLook] = useState({ x: 0, y: 0 });

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
    const onLeave = (): void => {
      if (!drag.current) update(false);
    };
    window.addEventListener('mousemove', onMove);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      update(false);
    };
  }, []);

  useEffect(() => () => {
    if (gestureTimer.current) clearTimeout(gestureTimer.current);
    window.mathmodel.pet.dragEnd();
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

  const playGesture = useCallback((next: Exclude<PetGesture, 'idle'>): void => {
    if (gestureTimer.current) clearTimeout(gestureTimer.current);
    setGesture(next);
    setGestureCopy(GESTURE_COPY[next]);
    gestureTimer.current = setTimeout(() => {
      setGesture('idle');
      setGestureCopy(null);
    }, next === 'celebrate' ? 3200 : 2600);
  }, []);

  useEffect(() => {
    if (state !== 'resting' || gesture !== 'idle') return;
    const timer = setTimeout(() => {
      playGesture(Math.random() > 0.48 ? 'stretch' : 'think');
    }, 9000 + Math.round(Math.random() * 5000));
    return () => clearTimeout(timer);
  }, [gesture, playGesture, state]);

  const beginDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      moved: false,
      character: event.currentTarget.dataset.petPart === 'character',
    };
    setDragging(true);
    window.mathmodel.pet.dragStart({ x: event.screenX, y: event.screenY });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (Math.hypot(event.screenX - current.startX, event.screenY - current.startY) > 4) {
      current.moved = true;
    }
    window.mathmodel.pet.dragMove({ x: event.screenX, y: event.screenY });
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
    setDragging(false);
    window.mathmodel.pet.dragEnd();
    if (!current.moved && current.character) playGesture('wave');
  };

  const followPointer = (event: ReactPointerEvent<HTMLElement>): void => {
    if (drag.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.38;
    setLook({
      x: Math.max(-2.2, Math.min(2.2, x * 5)),
      y: Math.max(-1.6, Math.min(1.6, y * 4)),
    });
  };

  const stageStyle = {
    '--pet-look-x': `${look.x}px`,
    '--pet-look-y': `${look.y}px`,
  } as CSSProperties;

  return (
    <main
      className={`desktop-pet-stage is-${state} gesture-${gesture}${dragging ? ' is-dragging' : ''}`}
      data-pet-state={state}
      style={stageStyle}
    >
      <section
        className="desktop-pet-speech"
        data-pet-interactive="true"
        data-pet-part="speech"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="desktop-pet-speech-head">
          <strong><span className="desktop-pet-status-dot" />小模</strong>
          <span className="desktop-pet-actions">
            <button type="button" title="和小模打招呼" onClick={() => playGesture('wave')}>
              <Icon name="hand" size={12} />
            </button>
            <button type="button" title="一起想想" onClick={() => playGesture('think')}>
              <Icon name="brain" size={12} />
            </button>
            <button type="button" title="庆祝一下" onClick={() => playGesture('celebrate')}>
              <Icon name="sparkles" size={12} />
            </button>
            <button type="button" title="打开 MModels" onClick={() => void window.mathmodel.pet.showMain()}>
              <Icon name="app-window" size={12} />
            </button>
            <button
              type="button"
              title="让小模休息"
              onClick={() => void window.mathmodel.settings.set({ modelingPetEnabled: false })}
            >
              <Icon name="x" size={12} />
            </button>
          </span>
        </div>
        <p>{gestureCopy ?? PET_COPY[state]}</p>
        <small>按住可拖动 · 双击回到工作台</small>
      </section>

      <div
        className="desktop-pet-character"
        data-pet-interactive="true"
        data-pet-part="character"
        title="点击互动，按住拖动，双击打开 MModels"
        aria-label={`桌面数学建模伙伴：${gestureCopy ?? PET_COPY[state]}`}
        onPointerDown={beginDrag}
        onPointerMove={(event) => {
          moveDrag(event);
          followPointer(event);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => !drag.current && setLook({ x: 0, y: 0 })}
        onDoubleClick={() => void window.mathmodel.pet.showMain()}
        onContextMenu={(event) => {
          event.preventDefault();
          playGesture('celebrate');
        }}
      >
        <span className="pet-math-symbol pet-math-symbol-one">∑</span>
        <span className="pet-math-symbol pet-math-symbol-two">π</span>
        <span className="pet-math-symbol pet-math-symbol-three">↗</span>
        <PetDeskAvatar appearance={appearance} />
        <span className="pet-celebration"><i /><i /><i /><i /><i /></span>
      </div>
    </main>
  );
}
