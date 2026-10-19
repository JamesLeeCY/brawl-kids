import { describe, expect, it } from 'vitest';
import { CELL_H, CELL_W, gridCols, gridHit, moveGridCursor } from '../src/scenes/charGrid';

const k = (dir: 'up' | 'down' | 'left' | 'right') => ({ up: false, down: false, left: false, right: false, [dir]: true });

describe('選角頭像格', () => {
  it('15 名角色排成 5×3', () => {
    expect(gridCols(15)).toBe(5);
    expect(gridCols(16)).toBe(6);
  });

  it('左右在同一列循環、上下在同一欄循環', () => {
    expect(moveGridCursor(0, k('left'), 15)).toBe(4);
    expect(moveGridCursor(4, k('right'), 15)).toBe(0);
    expect(moveGridCursor(2, k('up'), 15)).toBe(12);
    expect(moveGridCursor(12, k('down'), 15)).toBe(2);
    expect(moveGridCursor(7, k('down'), 15)).toBe(12);
  });

  it('最後一列不滿時跳過空格', () => {
    // 13 名：5 欄，最後一列只有 10、11、12
    expect(moveGridCursor(13 - 1, k('right'), 13)).toBe(10);
    expect(moveGridCursor(4, k('up'), 13)).toBe(9);
    expect(moveGridCursor(9, k('down'), 13)).toBe(4);
  });

  it('點擊位置對應格子', () => {
    expect(gridHit(10, 10, 0, 0, 15)).toBe(0);
    expect(gridHit(CELL_W + 4, CELL_H + 4, 0, 0, 15)).toBe(6);
    expect(gridHit(CELL_W + 1, 5, 0, 0, 15)).toBe(-1);
    expect(gridHit(-3, 5, 0, 0, 15)).toBe(-1);
  });
});
