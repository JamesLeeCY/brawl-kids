import { describe, expect, it } from 'vitest';
import { CELL_H, CELL_W, gridCols, gridHit, moveGridCursor, gridCells, isRandomIdx, resolveCharId, rerollRandom } from '../src/scenes/charGrid';

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

describe('隨機選角', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('最後一格是隨機', () => {
    expect(gridCells(ids.length)).toBe(5);
    expect(isRandomIdx(4, ids.length)).toBe(true);
    expect(isRandomIdx(3, ids.length)).toBe(false);
  });
  it('一般格子回傳該角色，隨機格依亂數抽', () => {
    expect(resolveCharId(ids, 2)).toBe('c');
    expect(resolveCharId(ids, 4, () => 0)).toBe('a');
    expect(resolveCharId(ids, 4, () => 0.99)).toBe('d');
  });
  it('再來一場只重抽選了隨機的玩家', () => {
    const ps = [
      { charId: 'a', random: true },
      { charId: 'b' },
    ];
    expect(rerollRandom(ps, ids, () => 0.6)).toEqual([{ charId: 'c', random: true }, { charId: 'b' }]);
  });
  it('20 名角色 + 隨機剛好 7×3', () => {
    expect(gridCols(gridCells(20))).toBe(7);
    expect(gridHit(6 * (CELL_W + 2) + 5, 2 * (CELL_H + 2) + 5, 0, 0, gridCells(20))).toBe(20);
  });
});
