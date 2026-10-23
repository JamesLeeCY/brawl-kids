import { describe, expect, it } from 'vitest';
import { SIGNATURES, signatureOf } from '../src/render/signature';
import { data } from './helpers';

describe('角色招牌特效', () => {
  it('每名可選角色都有自己的招牌圖示、代表色與氣場', () => {
    for (const id of data.selectable) {
      const s = SIGNATURES[id];
      expect(s, id).toBeDefined();
      for (const c of s.colors) expect(c, id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it('沒設定的角色用自己的代表色', () => {
    expect(signatureOf('nobody', '#123456').colors[0]).toBe('#123456');
  });
  it('命中事件帶有攻擊者', async () => {
    const { duel } = await import('./helpers');
    const { snapshotFrom, emptySnapshot } = await import('../src/sim/snapshot');
    const { w, a } = duel();
    w.step([snapshotFrom({ A: true }), emptySnapshot()]);
    let by: number | undefined;
    for (let i = 0; i < 12 && by === undefined; i++) {
      w.step([emptySnapshot(), emptySnapshot()]);
      for (const ev of w.events) if (ev.type === 'hit') by = ev.by;
    }
    expect(by).toBe(a.id);
  });
});
