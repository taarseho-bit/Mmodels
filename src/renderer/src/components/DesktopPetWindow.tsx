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
import { activityMessagesFor } from '../lib/activity-copy';
import { Icon } from './Icon';
import type { AppSettings } from '@shared/types';
import { PET_APPEARANCES, PetDeskAvatar, resolvePetAppearance, type PetAppearance } from './PetDeskAvatar';

type PetGesture = 'idle' | 'wave' | 'think' | 'celebrate' | 'stretch';

const GESTURE_COPY: Record<Exclude<PetGesture, 'idle'>, string> = {
  wave: '嗨，我在这里。拖住我就能搬到你喜欢的位置。',
  think: '换个角度想一想，也许能找到更简单的模型。',
  celebrate: '给努力的你加个油！',
  stretch: '活动一下，回来继续拆问题。',
};

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  character: boolean;
  prop: boolean;
}

export function DesktopPetWindow(): JSX.Element {
  const streams = useRef(new Map<string, SessionStream>());
  const gestureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<DragState | null>(null);
  const [view, setView] = useState(EMPTY_STREAM);
  const [appearance, setAppearance] = useState<PetAppearance>('student');
  const [preferences, setPreferences] = useState<Partial<AppSettings>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [bubbleVisible, setBubbleVisible] = useState(true);
  const [landed, setLanded] = useState(false);
  const landingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactionCount = useRef(0);

  useEffect(() => {
    let live = true;
    let changed = false;
    const unsubscribe = window.mathmodel.settings.onChanged((settings) => {
      changed = true;
      setAppearance(resolvePetAppearance(settings.modelingPetAppearance));
      setPreferences(settings);
    });
    void window.mathmodel.settings.get().then((settings) => {
      if (live && !changed) {
        setAppearance(resolvePetAppearance(settings.modelingPetAppearance));
        setPreferences(settings);
      }
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
    if (landingTimer.current) clearTimeout(landingTimer.current);
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

  /** 实时状态行（2026-09-25 用户要求）：与对话页同一套本地推导，不消耗 token。
      停止/待命回落到 PET_COPY；工作态优先显示真实动作。 */
  const liveActivity = useMemo(() => {
    if (state === 'resting' || state === 'stopping') return null;
    const blocks = view.blocks.filter(Boolean);
    const lines = activityMessagesFor(blocks, '');
    return lines[0] ?? null;
  }, [view, state]);

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
    // 工作态时气泡常显并随实时状态刷新（每次活动变化重新计时 6.5s）；待命时照旧自动收起
    if (state === 'resting') {
      setBubbleVisible(true);
      const timer = setTimeout(() => setBubbleVisible(false), 6500);
      return () => clearTimeout(timer);
    }
    setBubbleVisible(true);
    return undefined;
  }, [state, gestureCopy, appearance, liveActivity]);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent): void => {
      if (!(event.target as Element)?.closest('.pet-context-menu')) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape); };
  }, [menuOpen]);

  useEffect(() => {
    if (state !== 'resting' || gesture !== 'idle' || preferences.modelingPetQuiet || dragging) return;
    const timer = setTimeout(() => {
      playGesture(Math.random() > 0.48 ? 'stretch' : 'think');
    }, (preferences.modelingPetMotion === 'gentle' ? 60000 : 22000) + Math.round(Math.random() * 15000));
    return () => clearTimeout(timer);
  }, [gesture, playGesture, state, preferences.modelingPetQuiet, preferences.modelingPetMotion, dragging]);

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
      prop: !!(event.target as Element).closest('.desk-computer, .pixel-map, .pixel-treasure, .research-book, .research-lens, .space-planet, .space-sample'),
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
    // 先清除状态，释放捕获触发的 lostpointercapture 不再重复收尾。
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    window.mathmodel.pet.dragEnd();
    if (event.type !== 'pointerup') return;
    if (current.moved) {
      setLanded(true);
      if (landingTimer.current) clearTimeout(landingTimer.current);
      landingTimer.current = setTimeout(() => setLanded(false), 500);
    } else if (current.character) {
      interactionCount.current += 1;
      playGesture(current.prop ? 'think' : interactionCount.current % 2 ? 'wave' : 'stretch');
      if (current.prop) setGestureCopy({
        student: '看看图表，再想想数据之间的关系。',
        pixel: '地图展开啦，下一条路从哪里出发？',
        researcher: '放大一点看看，说不定藏着新线索。',
        astronaut: '发现一颗小晶体，靠近看看！',
        'owl-3d': '深夜推演，我最清醒。',
        'robot-3d': '计算完成，结果已同步。',
        'fox-3d': '数据线索都在这里。',
        'bear-3d': '稳住，一步步来。',
      }[appearance]);
    }
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
      className={`desktop-pet-stage is-${state} gesture-${gesture}${dragging ? ' is-dragging' : ''}${landed ? ' is-landed' : ''}${preferences.modelingPetQuiet ? ' pet-quiet' : ''}${preferences.modelingPetMotion === 'gentle' ? ' pet-gentle' : ''}${preferences.modelingPetSize === 'small' ? ' pet-small' : ''}`}
      data-pet-state={state}
      style={stageStyle}
    >
      <section
        className={`desktop-pet-speech${!menuOpen && (preferences.modelingPetQuiet || (preferences.modelingPetBubble !== 'always' && !bubbleVisible)) ? ' pet-bubble-hidden' : ''}`}
        data-pet-interactive="true"
        data-pet-part="speech"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
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
        <p>{gestureCopy ?? liveActivity ?? PET_COPY[state]}</p>
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
        onLostPointerCapture={endDrag}
        onPointerLeave={() => !drag.current && setLook({ x: 0, y: 0 })}
        onDoubleClick={() => void window.mathmodel.pet.showMain()}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen((open) => !open);
        }}
      >
        <span className="pet-math-symbol pet-math-symbol-one">∑</span>
        <span className="pet-math-symbol pet-math-symbol-two">π</span>
        <span className="pet-math-symbol pet-math-symbol-three">↗</span>
        <PetDeskAvatar appearance={appearance} />
        <span className="pet-celebration"><i /><i /><i /><i /><i /></span>
      </div>
      {menuOpen && <div className="pet-context-menu" data-pet-interactive="true" role="group" aria-label="小模快捷操作">
        <button type="button" onClick={() => { setMenuOpen(false); void window.mathmodel.pet.showMain(); }}>回到工作台</button>
        <div className="pet-menu-looks">{PET_APPEARANCES.map((item) => <button key={item.id} type="button" aria-pressed={appearance === item.id}
          onClick={() => { void window.mathmodel.settings.set({ modelingPetAppearance: item.id }); setMenuOpen(false); }}>{item.name}</button>)}</div>
        <button type="button" onClick={() => { void window.mathmodel.settings.set({ modelingPetQuiet: !preferences.modelingPetQuiet }); setMenuOpen(false); }}>{preferences.modelingPetQuiet ? '恢复陪伴' : '进入安静模式'}</button>
        <button type="button" onClick={() => void window.mathmodel.settings.set({ modelingPetEnabled: false })}>隐藏小模</button>
      </div>}
    </main>
  );
}
