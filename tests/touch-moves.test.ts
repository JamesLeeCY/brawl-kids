// 模擬手機觸控的施放方式：推搖桿（或不推）→ 點「必殺 / 必殺跳」。
// 觸控按鈕會在同一個 tick 同時按下「防禦＋攻擊/跳躍」（沒推搖桿時再補上面向方向），
// 這裡確認 10 名角色的每一招都能這樣放出來。
import { describe, expect, it } from 'vitest';
import { setState } from '../src/sim/fsm';
import { snapshotFrom, type Snapshot } from '../src/sim/snapshot';
import { World, type MatchSetup } from '../src/sim/world';
import { data } from './helpers';

function arena(charId: string) {
  const setup: MatchSetup = {
    mode: 'versus',
    stageId: 'ntu',
    seed: 3,
    players: [
      { slot: 0, charId, team: 0, controller: 'human', difficulty: 'normal' },
      { slot: 1, charId: 'jiang', team: 0, controller: 'human', difficulty: 'normal' },
    ],
  };
  const w = new World(data, setup);
  w.itemTimer = 1e9;
  const [me, dummy] = w.chars();
  me.x = 400;
  me.z = 60;
  me.facing = 1;
  dummy.x = 1300;
  dummy.z = 60;
  setState(me, 'idle');
  return { w, me };
}

type Stick = 'up' | 'down' | 'right' | 'left' | null;

/** 推住搖桿數個 tick 後點必殺鈕；回傳施放當下的角色 */
function castByTouch(charId: string, stick: Stick, fin: 'A' | 'J', lastHorizontal: 'left' | 'right' = 'right') {
  const { w, me } = arena(charId);
  // 有血量條件的招（例如爆氣摔器材）：先把血壓低
  if (data.characters[charId].moves.some((m) => m.hpBelow)) me.hp = me.maxHp * 0.2;
  const held: Partial<Snapshot> = stick ? { [stick]: true } : {};
  for (let i = 0; i < 3; i++) w.step([snapshotFrom(held), undefined]);
  const press: Partial<Snapshot> = { ...held, D: true, [fin]: true };
  if (!stick) press[lastHorizontal] = true; // 沒推搖桿 → 觸控層補上最後面向
  const mp = me.mp;
  w.step([snapshotFrom(press), undefined]);
  return { me, mpBefore: mp };
}

const stickFor = (dir: string): Stick => (dir === '^' ? 'up' : dir === 'v' ? 'down' : 'right');

describe('手機觸控：每一招都能放出', () => {
  for (const id of data.selectable) {
    const def = data.characters[id];
    for (const m of def.moves) {
      const fin = m.command[2] as 'A' | 'J';
      it(`${def.name} ${m.name}（推搖桿${m.command[1] === '^' ? '↑' : m.command[1] === 'v' ? '↓' : '→'} + ${fin === 'A' ? '必殺' : '必殺跳'}）`, () => {
        const { me, mpBefore } = castByTouch(id, stickFor(m.command[1]), fin);
        expect(me.state).toBe('attack');
        expect(me.frame).toBe(m.startFrame);
        expect(mpBefore - me.mp).toBeCloseTo(m.mp, 5);
      });
      if (m.command[1] === '>') {
        it(`${def.name} ${m.name}（不推搖桿直接點，朝左）`, () => {
          const { me } = castByTouch(id, null, fin, 'left');
          expect(me.frame).toBe(m.startFrame);
          expect(me.facing).toBe(-1);
        });
      }
    }
  }

  it('斜推（右上）時以上下方向為準', () => {
    const lai = data.characters.lai;
    const up = lai.moves.find((m) => m.command === 'D^A')!;
    const { w, me } = arena('lai');
    for (let i = 0; i < 3; i++) w.step([snapshotFrom({ up: true, right: true }), undefined]);
    w.step([snapshotFrom({ up: true, right: true, D: true, A: true }), undefined]);
    expect(me.frame).toBe(up.startFrame);
  });
});
