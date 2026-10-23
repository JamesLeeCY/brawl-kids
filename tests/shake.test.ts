// 畫面搖晃不能太劇烈：震地、重擊、KO 都壓在上限以內
import { describe, expect, it } from 'vitest';
import { BattleRenderer } from '../src/render/battle';
import { emptySnapshot, snapshotFrom } from '../src/sim/snapshot';
import { data, duel } from './helpers';

const MAX = 2.5;

function run(charA: string, cmd: string | null, hpB?: number) {
  const { w, b } = duel(charA, 'jiang');
  if (hpB !== undefined) b.hp = hpB;
  const r = new BattleRenderer(w);
  let worst = 0;
  const step = (s = emptySnapshot()) => {
    w.step([s, emptySnapshot()]);
    r.consume(w.events);
    r.tick(w);
    worst = Math.max(worst, r.shakeAmp);
  };
  if (cmd) {
    const dir = cmd[1] === '^' ? 'up' : cmd[1] === 'v' ? 'down' : 'right';
    step(snapshotFrom({ D: true, [dir]: true }));
    step(snapshotFrom({ D: true, [dir]: true, [cmd[2]]: true }));
  } else step(snapshotFrom({ A: true }));
  for (let i = 0; i < 90; i++) step();
  return worst;
}

describe('畫面搖晃', () => {
  it('震地招式（管長深蹲震地）不超過上限', () => {
    expect(data.characters.gym.frames.squat_2?.itr?.some((i) => i.radial)).toBe(true);
    const a = run('gym', 'DvA');
    expect(a).toBeGreaterThan(0); // 仍有一點震動回饋
    expect(a).toBeLessThanOrEqual(MAX);
  });
  it('重擊衝刺不超過上限', () => {
    expect(run('jiang', 'D>J')).toBeLessThanOrEqual(MAX);
  });
  it('KO 不超過上限', () => {
    expect(run('gym', 'DvA', 5)).toBeLessThanOrEqual(MAX);
  });
});
