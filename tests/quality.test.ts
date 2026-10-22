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

describe('平順動畫', () => {
  it('姿勢插值：k = 0 / 1 為兩端，中間是平均', async () => {
    const { lerpPose, getPose } = await import('../src/render/poses');
    const a = getPose('walk_0');
    const b = getPose('walk_2');
    expect(lerpPose(a, b, 0).bua).toBeCloseTo(a.bua);
    expect(lerpPose(a, b, 1).bua).toBeCloseTo(b.bua);
    expect(lerpPose(a, b, 0.5).bua).toBeCloseTo((a.bua + b.bua) / 2);
  });
  it('走路循環在格與格之間連續', async () => {
    const { cyclePose, getPose } = await import('../src/render/poses');
    expect(cyclePose('walk', 4, 1).fua).toBeCloseTo(getPose('walk_1').fua);
    expect(cyclePose('walk', 4, 4).fua).toBeCloseTo(getPose('walk_0').fua);
    const mid = cyclePose('walk', 4, 0.5).bua;
    expect(mid).toBeGreaterThan(Math.min(getPose('walk_0').bua, getPose('walk_1').bua));
    expect(mid).toBeLessThan(Math.max(getPose('walk_0').bua, getPose('walk_1').bua));
  });
});
