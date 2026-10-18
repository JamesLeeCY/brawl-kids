import { getGameData } from '../src/data';
import { setState } from '../src/sim/fsm';
import { World, type MatchSetup } from '../src/sim/world';
import { emptySnapshot, snapshotFrom, type Snapshot } from '../src/sim/snapshot';
import type { Entity } from '../src/sim/entity';

export const data = getGameData();

export function duel(charA = 'jiang', charB = 'jiang', seed = 1): { w: World; a: Entity; b: Entity } {
  const setup: MatchSetup = {
    mode: 'versus',
    stageId: 'ntu',
    seed,
    players: [
      { slot: 0, charId: charA, team: 0, controller: 'human', difficulty: 'normal' },
      { slot: 1, charId: charB, team: 0, controller: 'human', difficulty: 'normal' },
    ],
  };
  const w = new World(data, setup);
  w.itemTimer = 1e9; // 測試中不掉道具
  const [a, b] = w.chars();
  a.x = 400;
  a.z = 60;
  a.facing = 1;
  b.x = 430;
  b.z = 60;
  b.facing = -1;
  setState(a, 'idle');
  setState(b, 'idle');
  return { w, a, b };
}

/** 依序輸入：每一項是 P1 的快照，P2 不動 */
export function play(w: World, seq: Snapshot[], p2: Snapshot = emptySnapshot()): void {
  for (const s of seq) w.step([s, p2]);
}

export function idle(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.step([emptySnapshot(), emptySnapshot()]);
}

/** 按一下（1 tick 按下 + 1 tick 放開） */
export function tap(keys: Partial<Snapshot>): Snapshot[] {
  return [snapshotFrom(keys), emptySnapshot()];
}
