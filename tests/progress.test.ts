// 成就與戰績（Node 沒有 localStorage：只用記憶體快取，邏輯一樣）
import { beforeEach, describe, expect, it } from 'vitest';
import { loadProgress, recordMatch, recordPractice, recordTutorial, resetProgressCache } from '../src/progress';

const total = { characters: 3, stages: 2, maxCampaign: 10 };
const match = (charId: string, won: boolean, stageId = 'ntu', extra = {}) => recordMatch({ stageId, online: false, players: [{ charId, won }], ...extra }, total);

describe('成就與戰績', () => {
  beforeEach(() => resetProgressCache());

  it('記錄角色場數與勝場，第一勝解鎖一次就好', () => {
    expect(match('a', false).map((a) => a.id)).toEqual([]);
    expect(match('a', true).map((a) => a.id)).toContain('first_win');
    expect(match('a', true).map((a) => a.id)).not.toContain('first_win');
    expect(loadProgress().chars.a).toEqual({ played: 3, wins: 2 });
  });

  it('全部角色各贏一場、每個場地都打過', () => {
    match('a', true, 'ntu');
    match('b', true, 'ntu');
    const last = match('c', true, 'dome').map((a) => a.id);
    expect(last).toContain('all_chars');
    expect(last).toContain('stages_all');
  });

  it('闖關全破：記錄難度與關數，10 關與困難各自解鎖', () => {
    const a = match('a', true, 'ntu', { campaignClear: { difficulty: 'normal', length: 4 } }).map((x) => x.id);
    expect(a).toContain('campaign_clear');
    expect(a).not.toContain('campaign_10');
    const b = match('a', true, 'ntu', { campaignClear: { difficulty: 'hard', length: 10 } }).map((x) => x.id);
    expect(b).toEqual(expect.arrayContaining(['campaign_10', 'campaign_hard']));
  });

  it('連線勝利、練習連段、全部招式、新手教學', () => {
    expect(recordMatch({ stageId: 'ntu', online: true, players: [{ charId: 'a', won: true }] }, total).map((x) => x.id)).toContain('online_win');
    expect(recordPractice({ combo: 150 }, total)).toEqual([]);
    expect(recordPractice({ combo: 320 }, total).map((x) => x.id)).toEqual(['combo_200', 'combo_300']);
    expect(loadProgress().bestCombo).toBe(320);
    expect(recordPractice({ combo: 100 }, total)).toEqual([]);
    expect(loadProgress().bestCombo).toBe(320);
    expect(recordPractice({ allMoves: true }, total).map((x) => x.id)).toEqual(['all_moves']);
    expect(recordPractice({ allMoves: true }, total)).toEqual([]);
    expect(recordTutorial(total).map((x) => x.id)).toEqual(['tutorial']);
    expect(recordTutorial(total)).toEqual([]);
  });
});
