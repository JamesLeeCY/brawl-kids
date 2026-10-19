import { describe, expect, it } from 'vitest';
import { decodeReplay, encodeReplay, extractReplayCode, replayFromBytes, replayInputs, replayToBytes, ReplayRecorder, type Replay } from '../src/replay/replay';
import { Rng } from '../src/sim/rng';
import { ACTIONS, emptySnapshot, type Snapshot } from '../src/sim/snapshot';
import { World, type MatchSetup } from '../src/sim/world';
import { data } from './helpers';

/** 像真人一樣的按鍵：每個鍵按住 / 放開一段時間（約 5～40 tick） */
function humanLike(r: Rng, slots: number): () => (Snapshot | undefined)[] {
  const cur = Array.from({ length: slots }, () => emptySnapshot());
  const until = Array.from({ length: slots }, () => ACTIONS.map(() => 0));
  let t = 0;
  return () => {
    t++;
    cur.forEach((s, i) =>
      ACTIONS.forEach((a, k) => {
        if (t < until[i][k]) return;
        s[a] = r.chance(a === 'A' || a === 'right' || a === 'left' ? 0.4 : 0.15);
        until[i][k] = t + r.int(5, 40);
      }),
    );
    return cur.map((s) => ({ ...s }));
  };
}

const SETUP: MatchSetup = {
  mode: 'versus',
  stageId: 'dome',
  seed: 1234,
  players: [
    { slot: 0, charId: 'jiang', team: 0, controller: 'human', difficulty: 'normal' },
    { slot: 1, charId: 'ko', team: 0, controller: 'human', difficulty: 'normal' },
    { slot: 2, charId: 'puma', team: 0, controller: 'ai', difficulty: 'hard' },
    { slot: 3, charId: 'lai', team: 0, controller: 'ai', difficulty: 'hard' },
  ],
};

/** 錄一場比賽，直到分出勝負或 maxTicks */
function recordMatch(setup: MatchSetup, maxTicks: number, seed = 9): { replay: Replay; hash: string; world: World } {
  const w = new World(data, setup);
  const rec = new ReplayRecorder(setup, 'test-version');
  const next = humanLike(new Rng(seed), 4);
  while (!w.result && w.tick < maxTicks) {
    const inp = next();
    rec.record(inp);
    w.step(inp);
  }
  return { replay: rec.finish(w.hash()), hash: w.hash(), world: w };
}

function play(r: Replay): World {
  const w = new World(data, r.setup);
  for (let t = 0; t < r.ticks; t++) w.step(replayInputs(r, t));
  return w;
}

describe('重播', () => {
  it('錄下的按鍵重新播放，最後 World.hash() 相同', () => {
    const { replay, hash, world } = recordMatch(SETUP, 30000);
    expect(world.result).not.toBeNull();
    expect(replay.ticks).toBe(world.tick);
    const w = play(replay);
    expect(w.hash()).toBe(hash);
    expect(w.result).toEqual(world.result);
  });

  it('從第 0 tick 重建後跳到中間，與一路播放相同（倒退拖曳）', () => {
    const { replay } = recordMatch(SETUP, 1500);
    const a = new World(data, replay.setup);
    for (let t = 0; t < 900; t++) a.step(replayInputs(replay, t));
    const b = new World(data, replay.setup);
    for (let t = 0; t < 900; t++) b.step(replayInputs(replay, t));
    expect(b.hash()).toBe(a.hash());
  });

  it('闖關的單一關也能重播（含上一關帶過來的 HP）', () => {
    const setup: MatchSetup = {
      mode: 'campaign',
      stageId: 'ximen',
      seed: 77,
      campaignIndex: 1,
      players: [
        { slot: 0, charId: 'jiang', team: 0, controller: 'human', difficulty: 'normal' },
        { slot: 1, charId: 'ko', team: 0, controller: 'ai', difficulty: 'hard' },
      ],
      carry: [{ slot: 0, hp: 200, mp: 100, damage: 50, kos: 1, downs: 0 }],
    };
    const { replay, hash } = recordMatch(setup, 3000, 3);
    expect(play(replay).hash()).toBe(hash);
  });

  it('二進位與文字編碼來回不失真', async () => {
    const { replay } = recordMatch(SETUP, 2000);
    expect(replayFromBytes(replayToBytes(replay))).toEqual(replay);
    const code = await encodeReplay(replay);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = await decodeReplay(code);
    expect(back).toEqual(replay);
    expect(play(back).hash()).toBe(replay.finalHash);
    expect(extractReplayCode(`https://x.github.io/brawl/#replay=${code}`)).toBe(code);
    expect(extractReplayCode(code)).toBe(code);
  });

  it('兩分鐘、四名真人的比賽，分享網址小於 8 KB', async () => {
    const setup: MatchSetup = { ...SETUP, players: SETUP.players.map((p) => ({ ...p, controller: 'human' as const })) };
    const w = new World(data, setup);
    const rec = new ReplayRecorder(setup, 'p3-abcdefgh-12345678');
    const next = humanLike(new Rng(5), 4);
    for (let t = 0; t < 120 * 60; t++) rec.record(next());
    const code = await encodeReplay(rec.finish(w.hash()));
    expect(code.length).toBeLessThan(8000);
  });

  it('損毀的代碼丟出錯誤而不是當機', async () => {
    await expect(decodeReplay('not-a-real-replay-code-at-all')).rejects.toThrow();
    const bytes = replayToBytes(recordMatch(SETUP, 100).replay);
    expect(() => replayFromBytes(bytes.subarray(0, bytes.length - 3))).toThrow();
  });
});
