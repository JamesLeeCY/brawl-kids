import { describe, expect, it } from 'vitest';
import { Lockstep, decodeSnapshot, encodeSnapshot, type InputPacket } from '../src/net/lockstep';
import { Rng } from '../src/sim/rng';
import { ACTIONS, emptySnapshot, type Snapshot } from '../src/sim/snapshot';
import { World, type MatchSetup } from '../src/sim/world';
import { data } from './helpers';

describe('lockstep 連線', () => {
  it('按鍵編碼可還原', () => {
    const r = new Rng(3);
    for (let i = 0; i < 50; i++) {
      const s = emptySnapshot();
      for (const a of ACTIONS) s[a] = r.chance(0.5);
      expect(decodeSnapshot(encodeSnapshot(s))).toEqual(s);
    }
  });

  it('兩端在隨機網路延遲下跑出相同的世界', () => {
    const setup: MatchSetup = {
      mode: 'versus',
      stageId: 'xinyi',
      seed: 77,
      players: [
        { slot: 0, charId: 'jiang', team: 0, controller: 'human', difficulty: 'normal' },
        { slot: 1, charId: 'ko', team: 0, controller: 'human', difficulty: 'normal' },
      ],
    };
    const peers = [0, 1].map((slot) => ({
      w: new World(data, setup),
      ls: new Lockstep(4, slot as 0 | 1),
      rng: new Rng(100 + slot),
      held: emptySnapshot(),
      inbox: [] as { at: number; pkt: InputPacket }[],
      hashAt600: '',
    }));
    const net = new Rng(9);
    for (let clock = 0; clock < 2000; clock++) {
      peers.forEach((p, i) => {
        // 本機按鍵隨機變化
        const s: Snapshot = { ...p.held };
        for (const a of ACTIONS) if (p.rng.chance(0.06)) s[a] = !s[a];
        p.held = s;
        const pkt = p.ls.produce(p.w.tick, s);
        if (pkt) peers[1 - i].inbox.push({ at: clock + net.int(1, 9), pkt });
        // 收到已抵達的封包（依序）
        while (p.inbox.length && p.inbox[0].at <= clock) p.ls.receive(p.inbox.shift()!.pkt);
        const inputs = p.ls.take(p.w.tick);
        if (inputs) {
          p.w.step(inputs);
          if (p.w.tick === 600) p.hashAt600 = p.w.hash();
        }
      });
    }
    expect(peers[0].w.tick).toBeGreaterThanOrEqual(600);
    expect(peers[1].w.tick).toBeGreaterThanOrEqual(600);
    expect(peers[0].hashAt600).toBe(peers[1].hashAt600);
  });

  it('對手封包未到時暫停等待', () => {
    const ls = new Lockstep(3, 0);
    const s = emptySnapshot();
    let tick = 0;
    for (let i = 0; i < 10; i++) {
      ls.produce(tick, s);
      if (ls.take(tick)) tick++;
    }
    expect(tick).toBe(3);
  });
});
