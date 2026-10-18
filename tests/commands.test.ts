import { describe, expect, it } from 'vitest';
import { matchCommand, matchHeld, recordPresses } from '../src/sim/commands';
import type { CmdEvent } from '../src/sim/entity';
import { snapshotFrom } from '../src/sim/snapshot';
import type { MoveDef } from '../src/data/schema';

const moves: MoveDef[] = [
  { command: 'D>A', name: 'fwd', mp: 0, startFrame: 'a', air: false },
  { command: 'DvA', name: 'down', mp: 0, startFrame: 'b', air: false },
  { command: 'D^A', name: 'up', mp: 0, startFrame: 'c', air: false },
  { command: 'D>J', name: 'dash', mp: 0, startFrame: 'd', air: false },
];

function feed(events: [string, number][]): CmdEvent[] {
  const buf: CmdEvent[] = [];
  const map: Record<string, string> = { D: 'D', '^': 'up', v: 'down', '<': 'left', '>': 'right', A: 'A', J: 'J' };
  for (const [k, t] of events) recordPresses(buf, snapshotFrom({ [map[k]]: true } as never), t);
  return buf;
}

describe('指令解析', () => {
  it('D → 前 → A 觸發飛行道具招式並面向右', () => {
    const buf = feed([['D', 10], ['>', 14], ['A', 18]]);
    const m = matchCommand(buf, 18, moves);
    expect(m?.move.name).toBe('fwd');
    expect(m?.facing).toBe(1);
  });

  it('按左代表面向左的「前」', () => {
    const buf = feed([['D', 10], ['<', 12], ['A', 14]]);
    const m = matchCommand(buf, 14, moves);
    expect(m?.move.name).toBe('fwd');
    expect(m?.facing).toBe(-1);
  });

  it('D↓A、D↑A、D→J 各自正確觸發', () => {
    expect(matchCommand(feed([['D', 1], ['v', 2], ['A', 3]]), 3, moves)?.move.name).toBe('down');
    expect(matchCommand(feed([['D', 1], ['^', 2], ['A', 3]]), 3, moves)?.move.name).toBe('up');
    expect(matchCommand(feed([['D', 1], ['>', 2], ['J', 3]]), 3, moves)?.move.name).toBe('dash');
  });

  it('超過 30 tick 逾時不觸發', () => {
    const buf = feed([['D', 10], ['>', 20], ['A', 41]]);
    expect(matchCommand(buf, 41, moves)).toBeNull();
  });

  it('30 tick 內觸發', () => {
    const buf = feed([['D', 10], ['>', 20], ['A', 40]]);
    expect(matchCommand(buf, 40, moves)).not.toBeNull();
  });

  it('中間夾雜其他按鍵仍可觸發', () => {
    const buf = feed([['D', 1], ['J', 3], ['>', 5], ['^', 6], ['A', 8]]);
    // 最靠近攻擊鍵的方向是 ↑，因此成立的是 D↑A
    expect(matchCommand(buf, 8, moves)?.move.name).toBe('up');
    const buf2 = feed([['D', 1], ['J', 3], ['>', 5], ['A', 8]]);
    expect(matchCommand(buf2, 8, moves)?.move.name).toBe('fwd');
  });

  it('按住防禦＋方向再按攻擊 / 跳躍', () => {
    const held = (k: Record<string, boolean>) => ({ ...snapshotFrom({}), ...k });
    expect(matchHeld(held({ D: true, left: true }), snapshotFrom({ A: true }), moves)).toEqual({ move: moves[0], facing: -1 });
    expect(matchHeld(held({ D: true, down: true }), snapshotFrom({ A: true }), moves)?.move.name).toBe('down');
    expect(matchHeld(held({ D: true, right: true }), snapshotFrom({ J: true }), moves)?.move.name).toBe('dash');
    // 沒按方向、或沒按住防禦都不成立
    expect(matchHeld(held({ D: true }), snapshotFrom({ A: true }), moves)).toBeNull();
    expect(matchHeld(held({ right: true }), snapshotFrom({ A: true }), moves)).toBeNull();
  });

  it('順序錯誤不觸發', () => {
    expect(matchCommand(feed([['>', 1], ['D', 2], ['A', 3]]), 3, moves)).toBeNull();
    expect(matchCommand(feed([['D', 1], ['A', 3]]), 3, moves)).toBeNull();
  });

  it('最後一鍵不是本 tick 按下時不觸發', () => {
    const buf = feed([['D', 1], ['>', 2], ['A', 3]]);
    expect(matchCommand(buf, 4, moves)).toBeNull();
  });

  it('緩衝只保留最近 40 tick', () => {
    const buf = feed([['D', 1], ['>', 2], ['A', 50]]);
    expect(buf.length).toBe(1);
  });
});
