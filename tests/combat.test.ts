import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { setState } from '../src/sim/fsm';
import { emptySnapshot, snapshotFrom } from '../src/sim/snapshot';
import { duel, idle, play, tap } from './helpers';

describe('戰鬥', () => {
  it('攻擊框命中扣血', () => {
    const { w, b } = duel();
    play(w, tap({ A: true }));
    idle(w, 12);
    expect(b.hp).toBe(b.maxHp - 20);
    expect(b.state === 'hurt' || b.state === 'idle').toBe(true);
  });

  it('同一動作不重複命中', () => {
    const { w, a, b } = duel();
    play(w, tap({ A: true }));
    idle(w, 30);
    expect(b.hp).toBe(b.maxHp - 20);
    expect(a.stats.damage).toBe(20);
  });

  it('三段連擊可擊倒', () => {
    const { w, b } = duel();
    for (let i = 0; i < 3; i++) {
      play(w, tap({ A: true }));
      idle(w, 6);
    }
    let fell = false;
    for (let i = 0; i < 40; i++) {
      idle(w, 1);
      if (b.state === 'falling' || b.state === 'lying') fell = true;
    }
    expect(fell).toBe(true);
  });

  it('z 差超過容差打不中', () => {
    const { w, b } = duel();
    b.z = 60 + CONFIG.physics.hitZTolerance + 1;
    play(w, tap({ A: true }));
    idle(w, 20);
    expect(b.hp).toBe(b.maxHp);
  });

  it('同隊不互傷', () => {
    const { w, a, b } = duel();
    b.team = a.team;
    play(w, tap({ A: true }));
    idle(w, 20);
    expect(b.hp).toBe(b.maxHp);
  });

  it('防禦減傷 90%', () => {
    const { w, b } = duel();
    const p2 = snapshotFrom({ D: true });
    w.step([emptySnapshot(), p2]);
    expect(b.state).toBe('defend');
    play(w, tap({ A: true }), p2);
    for (let i = 0; i < 12; i++) w.step([emptySnapshot(), p2]);
    expect(b.maxHp - b.hp).toBeCloseTo(2, 5);
  });

  it('命中停頓凍結雙方', () => {
    const { w, a, b } = duel();
    play(w, [snapshotFrom({ A: true })]);
    let frozen = false;
    for (let i = 0; i < 10 && !frozen; i++) {
      idle(w, 1);
      if (a.freeze > 0 && b.freeze > 0) frozen = true;
    }
    expect(frozen).toBe(true);
  });

  it('起身後 30 tick 無敵', () => {
    const { w, b } = duel();
    setState(b, 'lying');
    idle(w, CONFIG.combat.lyingTicks);
    expect(b.state).toBe('idle');
    expect(b.invuln).toBe(CONFIG.combat.invulnAfterGetUp);
    const hp = b.hp;
    play(w, tap({ A: true }));
    idle(w, 8);
    expect(b.hp).toBe(hp);
  });

  it('擊倒值超過 40 暈眩', () => {
    const { w, b } = duel();
    b.fall = 30;
    play(w, tap({ A: true }));
    idle(w, 6);
    expect(b.state).toBe('dizzy');
  });

  it('按住防禦＋前再按攻擊即可放出必殺技', () => {
    const { w, a } = duel('puma');
    const mp = a.mp;
    play(w, [snapshotFrom({ D: true }), snapshotFrom({ D: true, right: true }), snapshotFrom({ D: true, right: true, A: true })]);
    expect(a.mp).toBeLessThan(mp - 70);
    expect(a.state).toBe('attack');
  });

  it('指令技消耗 MP 並產生飛行物', () => {
    const { w, a } = duel('puma');
    const mp = a.mp;
    play(w, [...tap({ D: true }), ...tap({ right: true }), ...tap({ A: true })]);
    expect(a.mp).toBeLessThan(mp - 70);
    idle(w, 25);
    expect(w.entities.some((e) => e.kind === 'proj')).toBe(true);
  });
});
