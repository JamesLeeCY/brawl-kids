import { describe, expect, it } from 'vitest';
import { Lockstep, decodeSnapshot, encodeSnapshot, type InputPacket } from '../src/net/lockstep';
import { Rng } from '../src/sim/rng';
import { ACTIONS, emptySnapshot, type Snapshot } from '../src/sim/snapshot';
import { World, type MatchSetup } from '../src/sim/world';
import { data } from './helpers';

interface Peer {
  w: World;
  ls: Lockstep;
  rng: Rng;
  held: Snapshot;
  inbox: { at: number; pkt: InputPacket }[];
  hashAt: string;
}

/** 星狀拓撲模擬：房主（slot 0）轉送所有封包；每段網路有 1–9 tick 隨機延遲 */
function simulate(n: number, opts: { dropSlot?: number; dropAt?: number } = {}) {
  const ids = data.selectable;
  const setup: MatchSetup = {
    mode: 'versus',
    stageId: 'xinyi',
    seed: 77 + n,
    players: Array.from({ length: n }, (_, i) => ({ slot: i, charId: ids[i], team: 0, controller: 'human' as const, difficulty: 'normal' as const })),
  };
  const slots = setup.players.map((p) => p.slot);
  const peers: Peer[] = slots.map((slot) => ({
    w: new World(data, setup),
    ls: new Lockstep(4, slot, slots),
    rng: new Rng(100 + slot),
    held: emptySnapshot(),
    inbox: [],
    hashAt: '',
  }));
  const net = new Rng(9);
  const target = 600;
  const alive = new Set(slots);
  for (let clock = 0; clock < 3000; clock++) {
    // 指定時間讓某位加入者斷線：房主宣告斷線起點並轉告其他人
    if (opts.dropSlot !== undefined && clock === opts.dropAt && alive.has(opts.dropSlot)) {
      alive.delete(opts.dropSlot);
      const from = peers[0].ls.lastReceived(opts.dropSlot) + 1;
      for (const p of peers) p.ls.drop(opts.dropSlot, from);
    }
    for (const p of peers) {
      const slot = p.ls.mySlot;
      if (!alive.has(slot)) continue;
      const s: Snapshot = { ...p.held };
      for (const a of ACTIONS) if (p.rng.chance(0.06)) s[a] = !s[a];
      p.held = s;
      const pkt = p.ls.produce(p.w.tick, s);
      if (pkt) {
        if (slot === 0) for (const q of peers.slice(1)) q.inbox.push({ at: clock + net.int(1, 9), pkt });
        else peers[0].inbox.push({ at: clock + net.int(1, 9), pkt });
      }
      while (p.inbox.length && p.inbox[0].at <= clock) {
        const { pkt: got } = p.inbox.shift()!;
        p.ls.receive(got);
        // 房主轉送給其他加入者
        if (slot === 0) for (const q of peers.slice(1)) if (q.ls.mySlot !== got.s && alive.has(q.ls.mySlot)) q.inbox.push({ at: clock + net.int(1, 9), pkt: got });
      }
      // 確保佇列依抵達時間排序（模擬可靠有序通道）
      p.inbox.sort((a, b) => a.at - b.at);
      const inputs = p.ls.take(p.w.tick);
      if (inputs) {
        p.w.step(inputs);
        if (p.w.tick === target) p.hashAt = p.w.hash();
      }
    }
  }
  return { peers: peers.filter((p) => alive.has(p.ls.mySlot)), target };
}

describe('lockstep 連線', () => {
  it('按鍵編碼可還原', () => {
    const r = new Rng(3);
    for (let i = 0; i < 50; i++) {
      const s = emptySnapshot();
      for (const a of ACTIONS) s[a] = r.chance(0.5);
      expect(decodeSnapshot(encodeSnapshot(s))).toEqual(s);
    }
  });

  for (const n of [2, 3, 4]) {
    it(`${n} 人在隨機網路延遲下跑出相同的世界`, () => {
      const { peers, target } = simulate(n);
      for (const p of peers) expect(p.w.tick).toBeGreaterThanOrEqual(target);
      const h = peers[0].hashAt;
      expect(h).not.toBe('');
      for (const p of peers) expect(p.hashAt).toBe(h);
    });
  }

  it('有人中途斷線，其餘玩家仍同步前進', () => {
    const { peers, target } = simulate(4, { dropSlot: 2, dropAt: 300 });
    expect(peers.length).toBe(3);
    for (const p of peers) expect(p.w.tick).toBeGreaterThanOrEqual(target);
    for (const p of peers) expect(p.hashAt).toBe(peers[0].hashAt);
  });

  it('對手封包未到時暫停等待', () => {
    const ls = new Lockstep(3, 0, [0, 1]);
    const s = emptySnapshot();
    let tick = 0;
    for (let i = 0; i < 10; i++) {
      ls.produce(tick, s);
      if (ls.take(tick)) tick++;
    }
    expect(tick).toBe(3);
  });
});
