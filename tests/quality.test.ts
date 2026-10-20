// 畫質自動降級
import { beforeEach, describe, expect, it } from 'vitest';
import { AutoQuality, lowQuality, setLowQuality } from '../src/render/quality';

describe('自動畫質', () => {
  beforeEach(() => setLowQuality(false));

  it('戰鬥中連續 4 個區間低於 48 FPS 才降成低畫質', () => {
    const q = new AutoQuality();
    for (let i = 0; i < 3; i++) expect(q.sample(30, 'auto', true, i)).toBe(false);
    expect(q.sample(55, 'auto', true, 3)).toBe(false); // 中間回穩就重新計算
    for (let i = 0; i < 3; i++) q.sample(30, 'auto', true, 4 + i);
    expect(lowQuality).toBe(false);
    expect(q.sample(30, 'auto', true, 10)).toBe(true);
    expect(lowQuality).toBe(true);
    expect(q.noticeUntil).toBeGreaterThan(10);
  });

  it('選單畫面、或手動設定為高畫質時不會自動降級', () => {
    const q = new AutoQuality();
    for (let i = 0; i < 10; i++) q.sample(20, 'auto', false, i);
    expect(lowQuality).toBe(false);
    for (let i = 0; i < 10; i++) q.sample(20, 'high', true, i);
    expect(lowQuality).toBe(false);
  });
});
