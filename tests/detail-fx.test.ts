// 畫面細節：震地留下裂痕、天降攻擊留下坑洞、飛行物命中噴碎片、出招頭幾格記錄手腳位置
import { describe, expect, it } from 'vitest';
import { BattleRenderer } from '../src/render/battle';
import { emptySnapshot, snapshotFrom } from '../src/sim/snapshot';
import { duel } from './helpers';

type Peek = { decals: { kind: string }[]; frags: unknown[] };

function cast(charA: string, cmd: string, bx: number, ticks: number) {
  const { w, b } = duel(charA, 'jiang');
  b.x = bx;
  const r = new BattleRenderer(w);
  const dir = cmd[1] === '^' ? 'up' : cmd[1] === 'v' ? 'down' : 'right';
  const seq = [snapshotFrom({ D: true, [dir]: true }), snapshotFrom({ D: true, [dir]: true, [cmd[2]]: true })];
  let maxFrags = 0;
  for (let i = 0; i < ticks; i++) {
    w.step([seq[i] ?? emptySnapshot(), emptySnapshot()]);
    r.consume(w.events);
    r.tick(w);
    maxFrags = Math.max(maxFrags, (r as unknown as Peek).frags.length);
  }
  return { r: r as unknown as Peek, maxFrags };
}

describe('地面痕跡與命中碎片', () => {
  it('震地招留下裂痕', () => {
    expect(cast('gym', 'DvA', 470, 40).r.decals.some((d) => d.kind === 'crack')).toBe(true);
  });
  it('天降攻擊留下坑洞', () => {
    expect(cast('adi', 'DvJ', 600, 80).r.decals.some((d) => d.kind === 'crater')).toBe(true);
  });
  it('高麗菜打中人噴出碎片', () => {
    expect(cast('han', 'D>A', 620, 80).maxFrags).toBeGreaterThan(0);
  });
});
