import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { ACTIONS, emptySnapshot, type Snapshot } from '../src/sim/snapshot';
import { World, type MatchSetup } from '../src/sim/world';
import { data } from './helpers';

/** 以固定種子產生一份 600 tick 的輸入錄製檔 */
function recording(seed: number, ticks: number): Snapshot[][] {
  const r = new Rng(seed);
  const out: Snapshot[][] = [];
  let cur = [emptySnapshot(), emptySnapshot()];
  for (let t = 0; t < ticks; t++) {
    cur = cur.map((s) => {
      const n = { ...s };
      for (const a of ACTIONS) if (r.chance(0.08)) n[a] = !n[a];
      return n;
    });
    out.push(cur);
  }
  return out;
}

function run(seed: number): string {
  const setup: MatchSetup = {
    mode: 'versus',
    stageId: 'dome',
    seed,
    players: [
      { slot: 0, charId: 'jiang', team: 0, controller: 'human', difficulty: 'normal' },
      { slot: 1, charId: 'ko', team: 0, controller: 'human', difficulty: 'normal' },
      { slot: 2, charId: 'puma', team: 0, controller: 'ai', difficulty: 'hard' },
      { slot: 3, charId: 'lai', team: 0, controller: 'ai', difficulty: 'easy' },
    ],
  };
  const w = new World(data, setup);
  for (const inp of recording(seed + 7, 600)) w.step(inp);
  return w.hash();
}

describe('決定論', () => {
  it('同一種子＋同一份輸入跑 600 tick，雜湊相同', () => {
    expect(run(42)).toBe(run(42));
  });
  it('不同種子結果不同', () => {
    expect(run(42)).not.toBe(run(43));
  });
});
