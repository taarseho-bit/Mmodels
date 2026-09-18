import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentActivity, ContentBlock } from '@shared/types';
import { Icon } from './Icon';
import { PET_COPY, petStateFor } from '../lib/modeling-activity';

const STORAGE_KEY = 'mmodels:modeling-pet-position';
const PET_WIDTH = 92;
const PET_HEIGHT = 118;

interface Point { x: number; y: number }
interface StoredPoint extends Point { side?: 'left' | 'right' }

function initialPoint(): StoredPoint {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredPoint;
      if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        const side = parsed.side ?? (parsed.x <= 40 ? 'left' : 'right');
        return { ...parsed, side };
      }
    }
  } catch {
    // 存储损坏时回到右下角，不影响聊天。
  }
  return { x: Math.max(12, window.innerWidth - PET_WIDTH - 24), y: Math.max(80, window.innerHeight - PET_HEIGHT - 150), side: 'right' };
}

function clampPoint(point: Point): Point {
  return {
    x: Math.min(Math.max(8, point.x), Math.max(8, window.innerWidth - PET_WIDTH - 8)),
    y: Math.min(Math.max(52, point.y), Math.max(52, window.innerHeight - PET_HEIGHT - 100)),
  };
}

export function ModelingPet({
  active,
  stopping,
  blocks,
  agents,
  onClose,
}: {
  active: boolean;
  stopping: boolean;
  blocks: ContentBlock[];
  agents: AgentActivity[];
  onClose: () => void;
}): JSX.Element {
  const state = useMemo(() => petStateFor({ active, stopping, blocks, agents }), [active, stopping, blocks, agents]);
  const initial = useMemo(() => initialPoint(), []);
  const [point, setPoint] = useState<Point>(() => clampPoint(initial));
  const [side, setSide] = useState<'left' | 'right'>(initial.side ?? 'right');
  const [open, setOpen] = useState(active);
  const drag = useRef<{ id: number; dx: number; dy: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (active) setOpen(true);
  }, [active, state]);

  useEffect(() => {
    const resize = (): void => setPoint((current) => {
      const clamped = clampPoint(current);
      return { ...clamped, x: side === 'left' ? 8 : window.innerWidth - PET_WIDTH - 8 };
    });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [side]);

  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    const moved = drag.current.moved;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const clamped = clampPoint(point);
    const nextSide = clamped.x + PET_WIDTH / 2 < window.innerWidth / 2 ? 'left' : 'right';
    const docked = { ...clamped, x: nextSide === 'left' ? 8 : window.innerWidth - PET_WIDTH - 8 };
    setSide(nextSide);
    setPoint(docked);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...docked, side: nextSide }));
    if (!moved) setOpen((value) => !value);
  };

  return (
    <aside
      className={`modeling-pet is-${state} is-${side}${open ? ' is-open' : ''}`}
      style={{ left: point.x, top: point.y }}
      data-pet-state={state}
      aria-label={`数学建模伙伴：${PET_COPY[state]}`}
    >
      {open ? <div className="modeling-pet-copy">{PET_COPY[state]}</div> : null}
      <button
        type="button"
        className="modeling-pet-close"
        title="隐藏小模"
        onClick={(event) => { event.stopPropagation(); onClose(); }}
      >
        <Icon name="x" size={11} />
      </button>
      <button
        type="button"
        className="modeling-pet-body"
        title="拖动小模；点击查看当前状态"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, dx: event.clientX - point.x, dy: event.clientY - point.y, moved: false };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.id !== event.pointerId) return;
          const next = clampPoint({ x: event.clientX - current.dx, y: event.clientY - current.dy });
          if (Math.abs(next.x - point.x) + Math.abs(next.y - point.y) > 3) current.moved = true;
          setPoint(next);
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <span className="modeling-pet-aura" />
        <span className="modeling-pet-shell">
          <Icon name={state === 'collaborating' ? 'brain' : 'sigma'} size={30} strokeWidth={2.4} />
          <span className="modeling-pet-eyes"><i /><i /></span>
        </span>
        <span className="modeling-pet-feet"><i /><i /></span>
      </button>
    </aside>
  );
}
