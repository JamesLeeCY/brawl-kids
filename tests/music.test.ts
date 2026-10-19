import { describe, expect, it } from 'vitest';
import { SCALES, TRACKS, degreeToMidi, parseNotes, trackFor, type TrackDef } from '../src/audio/tracks';
import { data } from './helpers';

describe('背景音樂譜面', () => {
  it('每個場地都有自己的曲子', () => {
    const ids = data.stageOrder.map((id) => trackFor({ kind: 'battle', stageId: id, boss: false }));
    expect(ids).toEqual(data.stageOrder);
    expect(new Set(ids).size).toBe(data.stageOrder.length);
  });

  it('選單、頭目波、勝利、失敗各有曲子；未知場地有預設', () => {
    expect(trackFor({ kind: 'menu' })).toBe('title');
    expect(trackFor({ kind: 'battle', stageId: 'xinyi', boss: true })).toBe('boss');
    expect(trackFor({ kind: 'result', won: true })).toBe('victory');
    expect(trackFor({ kind: 'result', won: false })).toBe('defeat');
    expect(trackFor({ kind: 'battle', stageId: 'nowhere', boss: false })).toBe('ntu');
    expect(trackFor({ kind: 'battle', stageId: 'victory', boss: false })).toBe('ntu');
  });

  it.each(Object.entries(TRACKS) as [string, TrackDef][])('%s 的小節長度一致', (_id, t) => {
    const steps = t.steps ?? 16;
    const bars = t.prog.length;
    if (t.lead) expect(parseNotes(t.lead.notes).length).toBe(steps * bars);
    for (const pat of [t.bass?.pat, t.arp?.pat, t.drums?.k, t.drums?.s, t.drums?.h]) if (pat) expect(pat.length).toBe(steps);
    expect(t.bass?.pat ?? '').toMatch(/^[x5o.]*$/);
    expect(t.arp?.pat ?? '').toMatch(/^[0-3.]*$/);
  });

  it('解析延長記號與音階換算', () => {
    const p = parseNotes('0 _ _ . 4 _ . _ -1');
    expect(p.notes).toEqual([
      { step: 0, deg: 0, len: 3 },
      { step: 4, deg: 4, len: 2 },
      { step: 8, deg: -1, len: 1 },
    ]);
    expect(degreeToMidi(60, SCALES.major, 0)).toBe(60);
    expect(degreeToMidi(60, SCALES.major, 7)).toBe(72);
    expect(degreeToMidi(60, SCALES.major, -1)).toBe(59);
    expect(degreeToMidi(57, SCALES.harmonicMinor, 6)).toBe(68);
  });
});
