import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../src/sim/snapshot';
import type { Difficulty } from '../src/config';
import { World, type MatchSetup } from '../src/sim/world';
import { data } from './helpers';

function runUntilResult(w: World, maxTicks: number): void {
  const none = [emptySnapshot(), emptySnapshot(), emptySnapshot(), emptySnapshot()];
  for (let i = 0; i < maxTicks && !w.result; i++) w.step(none);
}

describe('電腦對手', () => {
  for (const id of data.selectable) {
    it(`困難 AI（${id}）能贏過不操作的玩家`, () => {
      const setup: MatchSetup = {
        mode: 'versus',
        stageId: 'ntu',
        seed: 7,
        players: [
          { slot: 0, charId: 'lai', team: 0, controller: 'human', difficulty: 'normal' },
          { slot: 1, charId: id, team: 0, controller: 'ai', difficulty: 'hard' },
        ],
      };
      const w = new World(data, setup);
      runUntilResult(w, 60 * 120);
      expect(w.result?.winnerTeam).toBe(101);
    });
  }
});

describe('闖關模式', () => {
  const cases: [Difficulty, number][] = [
    ['easy', 100],
    ['normal', 100],
    ['normal', 200],
    ['normal', 300],
  ];
  it.each(cases)('難度 %s：4 關可全破（由困難 AI 代打，種子 %i）', (diff, base) => {
    let carry: MatchSetup['carry'];
    for (let idx = 0; idx < data.campaign.length; idx++) {
      const setup: MatchSetup = {
        mode: 'campaign',
        stageId: data.campaign[idx].stage,
        seed: base + idx,
        campaignIndex: idx,
        campaignDifficulty: diff,
        carry,
        players: [
          { slot: 0, charId: 'lai', team: 0, controller: 'ai', difficulty: 'hard' },
          { slot: 1, charId: 'jiang', team: 0, controller: 'ai', difficulty: 'hard' },
        ],
      };
      const w = new World(data, setup);
      runUntilResult(w, 60 * 300);
      const expected = idx === data.campaign.length - 1 ? 'win' : 'stageClear';
      expect(w.result?.outcome, `第 ${idx + 1} 關`).toBe(expected);
      carry = w.chars().filter((c) => c.slot >= 0).map((c) => ({ slot: c.slot, hp: c.hp > 0 ? Math.min(c.maxHp, c.hp + 200) : 200, mp: 500, damage: 0, kos: 0, downs: 0 }));
    }
  });

  it('困難難度：敵人更多、血量更高、AI 升級', () => {
    const mk = (d: Difficulty) => {
      const w = new World(data, {
        mode: 'campaign', stageId: data.campaign[0].stage, seed: 1, campaignIndex: 0, campaignDifficulty: d,
        players: [{ slot: 0, charId: 'lai', team: 0, controller: 'human', difficulty: 'normal' }],
      });
      runUntilWave(w);
      return w.chars().filter((c) => c.team === 99);
    };
    const normal = mk('normal');
    const hard = mk('hard');
    expect(hard.length).toBe(normal.length + 1);
    expect(hard[0].maxHp).toBeGreaterThan(normal[0].maxHp);
    expect(hard[0].ai?.difficulty).toBe('normal');
    expect(normal[0].ai?.difficulty).toBe('easy');
  });
});

function runUntilWave(w: World): void {
  const none = [emptySnapshot()];
  for (let i = 0; i < 200 && w.waveIndex < 0; i++) w.step(none);
}
