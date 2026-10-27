// 電腦對手看得懂新機制：繞過 / 跳過牆、遠距離時蓄力、被質詢時不放招、對手開反擊時不近身
import { describe, expect, it } from 'vitest';
import { addBuff } from '../src/sim/effects';
import { setState, startAction } from '../src/sim/fsm';
import { spawnProjectile } from '../src/sim/projectiles';
import { World, type MatchSetup } from '../src/sim/world';
import { data } from './helpers';

/** 困難電腦 a 對上不動的真人 b */
function vsDummy(a: string, b = 'jiang', seed = 9) {
  const setup: MatchSetup = {
    mode: 'versus',
    stageId: 'ntu',
    seed,
    players: [
      { slot: 0, charId: a, team: 1, controller: 'ai', difficulty: 'hard' },
      { slot: 1, charId: b, team: 2, controller: 'human', difficulty: 'normal' },
    ],
  };
  const w = new World(data, setup);
  w.itemTimer = 1e9;
  const [ai, dummy] = w.chars();
  ai.x = 300;
  ai.z = 60;
  dummy.x = 700;
  dummy.z = 60;
  setState(ai, 'idle');
  setState(dummy, 'idle');
  ai.mp = 0; // 先不讓電腦放招，專心看走位
  return { w, ai, dummy };
}

const run = (w: World, n: number, each?: () => void) => {
  for (let i = 0; i < n; i++) {
    w.step([undefined, undefined]);
    each?.();
  }
};

describe('電腦對手：實體牆', () => {
  it('川噗的高牆跳不過：電腦會繞到旁邊走過去', () => {
    const { w, ai, dummy } = vsDummy('jiang', 'trump');
    // 由川噗（目標方）在中間立一道高牆
    const wall = spawnProjectile(w, dummy, 'trump.bigwall', 500, 0, 60, 0, 0, 0)!;
    wall.life = 1e6;
    run(w, 600, () => (ai.mp = 0));
    expect(ai.x).toBeGreaterThan(wall.x);
  });

  it('習大包的矮牆：電腦會跳過去', () => {
    const { w, ai, dummy } = vsDummy('jiang', 'xi');
    const wall = spawnProjectile(w, dummy, 'xi.greatwall', 500, 0, 60, 0, 0, 0)!;
    wall.life = 1e6;
    let jumped = false;
    run(w, 600, () => {
      ai.mp = 0;
      if (ai.state === 'jump') jumped = true;
    });
    expect(jumped).toBe(true);
    expect(ai.x).toBeGreaterThan(wall.x);
  });
});

describe('電腦對手：新機制', () => {
  it('敵人離得遠時會按住蓄力（好吃好吃補更多血）', () => {
    const { w, ai } = vsDummy('aga');
    ai.hp = 200;
    startAction(w, ai, 'yummy_1');
    run(w, 120);
    expect(ai.charge).toBeGreaterThan(30);
    expect(ai.hp).toBeGreaterThan(240);
  });

  it('頭上有質詢倒數時不放必殺', () => {
    const { w, ai } = vsDummy('jiang');
    ai.mp = 500;
    addBuff(ai, { type: 'mark', value: 45, duration: 170, to: 'self' });
    const hp = ai.hp;
    run(w, 160);
    expect(ai.hp).toBe(hp); // 沒有放招被取消而受傷
  });

  it('對手開「都有掌握」時不貼身出拳被反擊', () => {
    let countered = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { w, ai, dummy } = vsDummy('gym', 'jiang', seed);
      dummy.x = 360;
      addBuff(dummy, { type: 'counter', value: 1, duration: 600, to: 'self' });
      run(w, 300, () => (ai.mp = 0));
      if (ai.hp < ai.maxHp) countered++;
    }
    expect(countered).toBeLessThanOrEqual(1);
  });
});

describe('電腦對手：不會誤放招', () => {
  it('防禦、閃避留下的按鍵不會誤組成必殺指令', () => {
    let accidental = 0;
    let total = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const w = new World(data, {
        mode: 'versus',
        stageId: 'ntu',
        seed,
        players: [
          { slot: 0, charId: 'jiang', team: 1, controller: 'ai', difficulty: 'hard' },
          { slot: 1, charId: 'gym', team: 2, controller: 'ai', difficulty: 'hard' },
        ],
      });
      w.itemTimer = 1e9;
      const prev = new Map<number, string | null>();
      const lastQueued = new Map<number, number>();
      while (!w.result && w.tick < 2400) {
        w.step([undefined, undefined]);
        for (const c of w.chars()) {
          if (c.ai && c.ai.plan.length >= 4) lastQueued.set(c.id, w.tick);
          const mv = data.characters[c.charId].moves.find((m) => m.startFrame === c.frame);
          if (mv && prev.get(c.id) !== c.frame) {
            total++;
            if (w.tick - (lastQueued.get(c.id) ?? -999) > 8) accidental++;
          }
          prev.set(c.id, c.frame);
        }
      }
    }
    expect(total).toBeGreaterThan(20);
    expect(accidental).toBe(0);
  });
});
