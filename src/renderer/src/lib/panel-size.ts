export function panelSize(value: number, min: number, max: number, available: number, fraction: number): number {
  const upper = Math.max(min, Math.min(max, available * fraction));
  return Math.round(Math.min(upper, Math.max(min, Number.isFinite(value) ? value : min)));
}

export function draggedSize(start: number, delta: number, edge: 'left' | 'right' | 'top' | 'bottom'): number {
  return start + delta * (edge === 'left' || edge === 'top' ? -1 : 1);
}
