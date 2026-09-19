import { describe, expect, it } from 'vitest';
import { draggedSize, panelSize } from './panel-size';

describe('面板拖动边界', () => {
  it('左右边缘按实际方向增减宽度', () => {
    expect(draggedSize(340, -50, 'left')).toBe(390);
    expect(draggedSize(240, 50, 'right')).toBe(290);
  });
  it('上下边缘按实际方向增减高度', () => {
    expect(draggedSize(96, -40, 'top')).toBe(136);
    expect(draggedSize(180, 40, 'bottom')).toBe(220);
  });
  it('不会拖到看不见，也不会吞掉主区', () => {
    expect(panelSize(-200, 220, 480, 1000, .4)).toBe(220);
    expect(panelSize(900, 220, 480, 1000, .4)).toBe(400);
    expect(panelSize(900, 220, 480, 2000, .4)).toBe(480);
  });
  it('容忍过小容器和无效尺寸', () => {
    expect(panelSize(300, 220, 480, 0, .4)).toBe(220);
    expect(panelSize(NaN, 220, 480, 1000, .4)).toBe(220);
  });
});
