// NetSession 連線測試：直連（PeerJS）與中繼（MQTT）都換成假網路，用假計時器推進時間，
// 每位玩家跑真的 Lockstep 與 World，最後比對世界雜湊確認各端一致。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetSession, type Inbound } from '../src/net/session';
import { fetchLatestBuild, reloadToBuild } from '../src/version';
import { Rng } from '../src/sim/rng';
import { ACTIONS, emptySnapshot, type Snapshot } from '../src/sim/snapshot';
import { World, type MatchSetup } from '../src/sim/world';
import { data } from './helpers';
import { FakeNet, relayItems, type Node } from './net-fakes';

vi.mock('peerjs', () => ({ default: class {} }));
vi.mock('../src/version', () => ({
  fetchLatestBuild: vi.fn(() => Promise.resolve(null)),
  reloadToBuild: vi.fn(() => true),
}));

const FRAME = 16;
const HASH_EVERY = 30;
const GENERIC_VERSION = '你和房主的遊戲版本不同。請兩人都關掉分頁、重新打開網頁後再試。';

interface Player {
  node: Node;
  net: NetSession;
  world: World | null;
  rng: Rng;
  held: Snapshot;
  hashes: Map<number, string>;
  inbox: Inbound[];
}

let sessions: NetSession[] = [];

function makePlayer(node: Node, net: NetSession, seed: number): Player {
  sessions.push(net);
  return { node, net, world: null, rng: new Rng(seed), held: emptySnapshot(), hashes: new Map(), inbox: [] };
}

function hostOn(fake: FakeNet, version = 'v1'): Player {
  const node = fake.node('host');
  return makePlayer(node, NetSession.host(version, node.transport()), 1);
}

function guestOn(fake: FakeNet, code: string, name: string, version = 'v1'): Player {
  const node = fake.node(name);
  return makePlayer(node, NetSession.join(code, version, node.transport()), 10 + sessions.length);
}

/** 模擬 BattleScene.updateNet 的一個畫面：收訊、產生按鍵、湊齊就前進（每畫面最多 3 tick） */
function frame(p: Player): void {
  for (const ib of p.net.drain()) {
    p.inbox.push(ib);
    if (p.net.role === 'guest' && (ib.msg.type === 'start' || ib.msg.type === 'rematch')) p.world = new World(data, ib.msg.setup);
  }
  const ls = p.net.lockstep;
  if (!p.world || !ls || p.net.status !== 'open') return;
  const s: Snapshot = { ...p.held };
  for (const a of ACTIONS) if (p.rng.chance(0.06)) s[a] = !s[a];
  p.held = s;
  const pkt = ls.produce(p.world.tick, s);
  if (pkt) p.net.sendInput(pkt);
  for (let steps = 0; steps < 3; steps++) {
    const inputs = ls.take(p.world.tick);
    if (!inputs) break;
    p.world.step(inputs);
    if (p.world.tick % HASH_EVERY === 0) p.hashes.set(p.world.tick, p.world.hash());
  }
}

async function run(players: Player[], ms: number): Promise<void> {
  for (let t = 0; t < ms; t += FRAME) {
    for (const p of players) frame(p);
    await vi.advanceTimersByTimeAsync(FRAME);
  }
}

async function runUntil(players: Player[], cond: () => boolean, maxMs: number, what: string): Promise<void> {
  for (let t = 0; t < maxMs; t += FRAME) {
    if (cond()) return;
    for (const p of players) frame(p);
    await vi.advanceTimersByTimeAsync(FRAME);
  }
  if (!cond()) throw new Error(`逾時：${what}`);
}

/** 房主開賽（同 startOnlineMatch） */
function startMatch(host: Player, all: Player[]): void {
  const setup: MatchSetup = {
    mode: 'versus',
    stageId: 'xinyi',
    seed: 42,
    players: all.map((p) => ({ slot: p.net.mySlot, charId: data.selectable[p.net.mySlot], team: 0, controller: 'human' as const, difficulty: 'normal' as const })),
  };
  const net = host.net;
  const epoch = net.epoch + 1;
  const delay = net.suggestDelay();
  net.beginMatch(epoch, delay, setup.players.map((p) => p.slot));
  net.inMatch = true;
  net.broadcast({ type: 'start', setup, epoch, delay });
  host.world = new World(data, setup);
}

function tick(p: Player): number {
  return p.world?.tick ?? 0;
}

/** 各端在共同經過的 tick 上世界雜湊完全相同，且都至少跑到 minTick */
function expectSameWorlds(players: Player[], minTick: number): void {
  const [a, ...rest] = players;
  for (const b of rest) {
    const common = [...a.hashes.keys()].filter((t) => b.hashes.has(t));
    expect(Math.max(0, ...common)).toBeGreaterThanOrEqual(minTick);
    for (const t of common) expect(b.hashes.get(t), `tick ${t}`).toBe(a.hashes.get(t));
  }
}

/** 房主與加入者都連上，並在大廳待一下（量到往返延遲，房主才能決定輸入延遲） */
async function connectAll(host: Player, guests: Player[], all: Player[]): Promise<void> {
  await runUntil(all, () => guests.every((g) => g.net.status === 'open') && host.net.guestSlots().length === guests.length, 20000, '加入者連上');
  await run(all, 3000);
}

function hostLinkHub(host: Player, slot: number): string | undefined {
  // 測試檢查用：房主對這個欄位目前使用的中繼 broker
  return (host.net as any).links.get(slot)?.conn.hub?.url;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('addEventListener', () => undefined);
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: () => undefined });
  vi.mocked(fetchLatestBuild).mockReset().mockImplementation(() => Promise.resolve(null));
  vi.mocked(reloadToBuild).mockReset().mockImplementation(() => true);
  sessions = [];
});

afterEach(async () => {
  for (const s of sessions) s.close();
  await vi.advanceTimersByTimeAsync(500);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('NetSession 連線', () => {
  it('直連打不通時，加入者改走中繼加入並能同步比賽', async () => {
    const fake = new FakeNet();
    fake.p2pBlocked = true;
    const host = hostOn(fake);
    await runUntil([host], () => host.net.status === 'open', 5000, '房主開房');
    const guest = guestOn(fake, host.net.code, 'g1');
    const all = [host, guest];
    await connectAll(host, [guest], all);

    expect(guest.net.mySlot).toBe(1);
    expect(guest.net.linkKind(0)).toBe('relay');
    expect(guest.net.diag.p2p).toBe('fail');
    expect(guest.net.diag.host).toBe(true);
    expect(guest.net.relayUp()).toBe('1/3'); // 選定通道後關掉其他 broker
    expect(host.net.guestSlots()).toEqual([1]);
    expect(host.net.linkKind(1)).toBe('relay');
    await run(all, 100);
    expect(host.inbox.filter((i) => i.msg.type === 'peer-join')).toHaveLength(1);

    startMatch(host, all);
    await run(all, 6000);
    expectSameWorlds(all, 240);
  });

  it('比賽中直連默默斷掉：加入者重連回原欄位，補送後各端世界一致', async () => {
    const fake = new FakeNet();
    const host = hostOn(fake);
    await runUntil([host], () => host.net.status === 'open', 5000, '房主開房');
    const g1 = guestOn(fake, host.net.code, 'g1');
    const all = [host, g1];
    await connectAll(host, [g1], all);
    const g2 = guestOn(fake, host.net.code, 'g2');
    all.push(g2);
    await connectAll(host, [g1, g2], all);
    expect(g1.net.linkKind(0)).toBe('p2p');
    expect([g1.net.mySlot, g2.net.mySlot]).toEqual([1, 2]);

    startMatch(host, all);
    await run(all, 3000);
    const cutAt = tick(host);
    expect(cutAt).toBeGreaterThan(60);

    fake.cutP2P(g1.node);
    await runUntil(all, () => g1.net.reconnecting, 10000, '加入者發現斷線');
    await runUntil(all, () => !g1.net.reconnecting && g1.net.status === 'open', 10000, '加入者重連成功');

    expect(g1.net.mySlot).toBe(1);
    expect(g1.net.linkKind(0)).toBe('p2p');
    expect(host.net.guestSlots().sort()).toEqual([1, 2]);
    expect(host.net.lostSlots()).toEqual([]);
    expect(host.net.lockstep!.isDropped(1)).toBe(false);

    await run(all, 6000);
    expect(host.inbox.some((i) => i.msg.type === 'peer-leave')).toBe(false);
    expectSameWorlds(all, cutAt + 300);
  });

  describe('中繼掉包', () => {
    async function relayMatch(burstMs: number) {
      const fake = new FakeNet();
      fake.p2pBlocked = true;
      // 延遲夠大，輸入延遲才會超過 11 tick：lockstep 的背壓讓一次最多掉約 2 × delay + 1 個按鍵封包，
      // 要超過 RELAY_REDUNDANCY（24）才補不回來
      for (const b of fake.brokers) b.delay = 100;
      const host = hostOn(fake);
      await runUntil([host], () => host.net.status === 'open', 5000, '房主開房');
      const guest = guestOn(fake, host.net.code, 'g1');
      const all = [host, guest];
      await connectAll(host, [guest], all);
      startMatch(host, all);
      await run(all, 3000);

      // 加入者發出的中繼訊息連續丟掉 burstMs
      const from = performance.now();
      for (const b of fake.brokers) b.accept = (p) => !(p.clientId.startsWith('bkg') && p.at >= from && p.at < from + burstMs);
      const before = tick(host);
      await run(all, 9000);
      const needs = fake.brokers
        .flatMap((b) => b.log)
        .filter((p) => p.at >= from && p.clientId.startsWith('bkh'))
        .flatMap((p) => relayItems(p).b)
        .filter((it) => it.m.type === 'need');
      return { all, before, needs, delay: host.net.lockstep!.delay };
    }

    it('短暫掉包由備援封包補回，不需要 need', async () => {
      const { all, before, needs } = await relayMatch(250);
      expect(needs).toHaveLength(0);
      expectSameWorlds(all, before + 360);
    });

    it(`掉包超過備援量（RELAY_REDUNDANCY）時，靠 need 請對方補送後恢復`, async () => {
      const { all, before, needs, delay } = await relayMatch(1500);
      expect(2 * delay + 1).toBeGreaterThan(24);
      expect(needs.length).toBeGreaterThan(0);
      expectSameWorlds(all, before + 300);
    });
  });

  it('加入者失聯超過保留時間：房主宣告斷線，其他人繼續', async () => {
    const fake = new FakeNet();
    const host = hostOn(fake);
    await runUntil([host], () => host.net.status === 'open', 5000, '房主開房');
    const a = guestOn(fake, host.net.code, 'a');
    const all = [host, a];
    await connectAll(host, [a], all);
    const b = guestOn(fake, host.net.code, 'b');
    all.push(b);
    await connectAll(host, [a, b], all);
    expect(b.net.mySlot).toBe(2);

    startMatch(host, all);
    await run(all, 2000);
    b.node.offline = true;

    await runUntil(all, () => host.net.lostSlots().includes(2), 10000, '房主發現失聯');
    // 保留期間大家暫停等待
    expect(host.inbox.some((i) => i.msg.type === 'peer-leave')).toBe(false);
    await runUntil(all, () => host.inbox.some((i) => i.msg.type === 'peer-leave' && i.msg.slot === 2), 25000, '房主放棄等待');
    const leftAt = tick(host);

    expect(host.net.lostSlots()).toEqual([]);
    expect(host.net.guestSlots()).toEqual([1]);
    expect(host.net.lockstep!.isDropped(2)).toBe(true);
    await run(all, 5000);
    expect(a.net.lockstep!.isDropped(2)).toBe(true);
    expect(a.net.status).toBe('open');
    expectSameWorlds([host, a], leftAt + 240);
  });

  it('從第二個 broker 晚到的重複招呼不會讓房主換通道', async () => {
    const fake = new FakeNet();
    fake.p2pBlocked = true;
    fake.brokers[0].delay = 30;
    fake.brokers[1].delay = 150;
    fake.brokers[2].delay = 300;
    const host = hostOn(fake);
    await runUntil([host], () => host.net.status === 'open', 5000, '房主開房');
    const guest = guestOn(fake, host.net.code, 'g1');
    const all = [host, guest];
    await connectAll(host, [guest], all);
    expect(hostLinkHub(host, 1)).toBe(fake.brokers[0].url);

    await run(all, 3000);
    // 其他 broker 上確實也有送出招呼（會到達房主）
    for (const b of fake.brokers.slice(1)) {
      const hellos = b.log.filter((p) => p.clientId.startsWith('bkg')).flatMap((p) => relayItems(p).b).filter((it) => it.m.type === 'hello');
      expect(hellos.length, b.url).toBeGreaterThan(0);
    }
    expect(hostLinkHub(host, 1)).toBe(fake.brokers[0].url);
    expect(guest.net.relayUp()).toBe('1/3');
    expect(host.net.guestSlots()).toEqual([1]);
    expect(host.inbox.filter((i) => i.msg.type === 'peer-join')).toHaveLength(1);

    // 通道沒被換掉：比賽照常同步
    startMatch(host, all);
    await run(all, 4000);
    expectSameWorlds(all, 150);
  });

  describe('版本不同', () => {
    async function mismatch(opts: { relay?: boolean } = {}) {
      const fake = new FakeNet();
      fake.p2pBlocked = !!opts.relay;
      const host = hostOn(fake, 'v1');
      await runUntil([host], () => host.net.status === 'open', 5000, '房主開房');
      return { fake, host };
    }

    it('開發版（讀不到最新版本）：雙方都收到通用訊息，房主不收這位加入者', async () => {
      const { fake, host } = await mismatch();
      const guest = guestOn(fake, host.net.code, 'g1', 'v2');
      await runUntil([host, guest], () => guest.net.status === 'error', 5000, '加入者收到拒絕');
      expect(guest.net.error).toBe(GENERIC_VERSION);
      expect(host.net.status).toBe('open');
      expect(host.net.guestSlots()).toEqual([]);
      await run([host, guest], 500);
      expect(host.inbox.some((i) => i.msg.type === 'peer-join')).toBe(false);
    });

    it('加入者是舊版：自動更新並帶著房間代碼回來', async () => {
      const { fake, host } = await mismatch();
      vi.mocked(fetchLatestBuild).mockResolvedValueOnce(__BUILD_ID__).mockResolvedValueOnce('newer');
      const guest = guestOn(fake, host.net.code, 'g1', 'v2');
      await runUntil([host, guest], () => guest.net.status === 'error', 5000, '加入者收到拒絕');
      expect(guest.net.error).toBe('發現新版本，正在自動更新，更新後會自動回到這個房間…');
      expect(reloadToBuild).toHaveBeenCalledWith('newer', { room: host.net.code });
      expect(host.net.status).toBe('open');
      expect(host.net.guestSlots()).toEqual([]);
    });

    it('房主是舊版：房主自動更新，加入者看到「房主是舊版」', async () => {
      const { fake, host } = await mismatch();
      vi.mocked(fetchLatestBuild).mockResolvedValueOnce('newer').mockResolvedValueOnce(__BUILD_ID__);
      const guest = guestOn(fake, host.net.code, 'g1', 'v2');
      await runUntil([host, guest], () => guest.net.status === 'error', 5000, '加入者收到拒絕');
      expect(host.net.status).toBe('error');
      expect(host.net.error).toBe('你的網頁是舊版，朋友連不進來。正在自動更新，更新後請重新建立房間並分享新連結…');
      expect(reloadToBuild).toHaveBeenCalledWith('newer');
      expect(guest.net.error).toBe('房主的網頁是舊版。請房主關掉分頁、重新打開網頁再建立房間（會有新的房間代碼）。');
    });

    it('中繼：只看到房主廣播的版本不同，也會停下並提示', async () => {
      const { fake, host } = await mismatch({ relay: true });
      // 房主收不到這位加入者：只能靠房主的廣播發現版本不同
      for (const b of fake.brokers) b.accept = (p) => !p.clientId.startsWith('bkg');
      const guest = guestOn(fake, host.net.code, 'g1', 'v2');
      await runUntil([host, guest], () => guest.net.status === 'error', 15000, '加入者發現版本不同');
      expect(guest.net.diag.hostSeen).toBe(true);
      expect(guest.net.diag.host).toBe(false);
      expect(guest.net.error).toBe(GENERIC_VERSION);
      expect(host.net.guestSlots()).toEqual([]);
    });
  });
});
