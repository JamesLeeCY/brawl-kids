// 連線（最多 4 人，星狀拓撲）：房主是中心，每位加入者只連房主，房主把每個人的按鍵轉送給其他人。
// 兩種通道，自動選擇：
//   1. 直連：PeerJS（WebRTC DataChannel）點對點，延遲最低。PeerJS 的免費雲端 broker 只負責「介紹」雙方。
//   2. 中繼：直連建立不起來時（行動網路的電信級 NAT、公司 / 學校防火牆），改經公用 MQTT broker（WebSocket / 443）轉送。
// 兩者都不需要自架伺服器或註冊帳號。
import Peer, { type DataConnection } from 'peerjs';
import type { Difficulty } from '../config';
import type { MatchSetup } from '../sim/world';
import { Lockstep, MAX_SLOTS, type InputPacket } from './lockstep';
import { MiniMqtt } from './mqtt';
import { fetchLatestBuild, reloadToBuild } from '../version';

export interface LobbySlot {
  kind: 'empty' | 'human' | 'ai';
  charIdx: number;
  team: number;
  ready: boolean;
  difficulty: Difficulty;
}

export type NetMsg =
  | { type: 'hello'; v: string }
  | { type: 'welcome'; slot: number }
  | { type: 'reject'; reason: string; stale?: boolean }
  | { type: 'lobbystate'; slots: LobbySlot[]; opt: number }
  | { type: 'sel'; charIdx: number; team: number; ready: boolean }
  | { type: 'start'; setup: MatchSetup; epoch: number; delay: number }
  | { type: 'rematch'; setup: MatchSetup; epoch: number; delay: number }
  | { type: 'lobby' }
  | { type: 'in'; e: number; s: number; t: number; b: number }
  | { type: 'hash'; e: number; s: number; t: number; h: string }
  | { type: 'drop'; e: number; s: number; t: number }
  | { type: 'ping'; ts: number }
  | { type: 'pong'; ts: number }
  | { type: 'bye' }
  /** 本機事件（不經網路）：加入者連上 / 離開房主 */
  | { type: 'peer-join'; slot: number }
  | { type: 'peer-leave'; slot: number };

export interface Inbound {
  /** 訊息來源欄位（加入者端一律為 0 = 房主） */
  from: number;
  msg: NetMsg;
}

export type NetStatus = 'connecting' | 'waiting' | 'open' | 'closed' | 'error';
export type LinkKind = 'p2p' | 'relay';

const ID_PREFIX = 'brawlkids-tw-';

/** STUN：讓雙方找出自己的公網位址以嘗試直連（免費公用 TURN 已失效，改由 MQTT 中繼補位） */
const PEER_OPTIONS = {
  debug: 0,
  config: {
    iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }],
  },
};

/**
 * 中繼用公用 MQTT broker（WebSocket over TLS）。房主同時在全部 broker 上等人，加入者用最先連上的那個。
 * 順序依台灣實測延遲：EMQX 亞洲節點（約 155 ms 來回）優先，連不上再用全球節點。
 */
const RELAY_BROKERS = ['wss://broker-cn.emqx.io:8084/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const TOPIC_BASE = 'brawlkids-tw/v3';

/** 逾時（毫秒） */
const HOST_TIMEOUT = 12000;
/** 直連多久沒成功就改走中繼 */
const P2P_GRACE = 6000;
const CONNECT_TIMEOUT = 25000;
/** 中繼通道多久沒收到任何訊息視為斷線（每秒都有 ping） */
const RELAY_SILENCE = 10000;
/** 中繼訊息合併送出的間隔：EMQX 公用 broker 每個連線約限 10 則 / 秒（實測超過就丟包），用 8 則 / 秒保留餘裕 */
const RELAY_FLUSH_MS = 125;
/** 每批附帶的最近按鍵封包數（約涵蓋 3 批），某一批被丟掉時下一批可補上 */
const RELAY_REDUNDANCY = 24;

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

function randomCode(len = CODE_LENGTH): string {
  let s = '';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (const n of buf) s += CODE_CHARS[n % CODE_CHARS.length];
  return s;
}

export function isValidCodeChar(ch: string): boolean {
  return CODE_CHARS.includes(ch);
}

export function shareUrl(code: string): string {
  const u = new URL(window.location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', code);
  return u.toString();
}

/** 測試 / 疑難排解用：網址加上 ?relay=1 直接走中繼 */
function forceRelay(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('relay') === '1';
  } catch {
    return false;
  }
}

// ---------------- 通道 ----------------
interface Channel {
  readonly kind: LinkKind;
  readonly open: boolean;
  send(m: NetMsg): void;
  close(): void;
}

function p2pChannel(c: DataConnection): Channel {
  return {
    kind: 'p2p',
    get open() {
      return c.open;
    },
    send: (m) => c.send(m),
    close: () => c.close(),
  };
}

/** 中繼信封：一則 MQTT 訊息帶多筆，每筆標明收件者（'h' 房主、加入者 id、'*' 所有加入者） */
interface RelayItem {
  to: string;
  m: NetMsg;
}

/**
 * 一個 broker 上的中繼連線。全房間只用一個主題：大家都訂閱、都發到這裡，
 * 每 125 ms 合併成一則送出（公用 broker 有頻率限制），並附上最近的按鍵封包以防掉包；斷線會自動重連。
 */
class RelayHub {
  private mq: MiniMqtt | null = null;
  private handler: ((payload: string) => void) | null = null;
  private out: RelayItem[] = [];
  private recent: RelayItem[] = [];
  private timer = 0;
  private closed = false;
  private backoff = 1000;

  constructor(
    readonly url: string,
    private clientId: string,
    private topic: string,
    private myId: string,
  ) {}

  get connected(): boolean {
    return !this.closed && !!this.mq?.connected;
  }

  /** 連線並訂閱房間主題；之後若被 broker 斷線會自動重連 */
  connect(onMessage: (payload: string) => void): Promise<RelayHub> {
    this.handler = onMessage;
    return this.open().then(() => this);
  }

  private open(): Promise<void> {
    const mq = new MiniMqtt(this.url, `${this.clientId}-${Math.floor(Math.random() * 1e6)}`);
    this.mq = mq;
    mq.onClose = () => {
      if (this.closed || this.mq !== mq) return;
      window.setTimeout(() => {
        if (this.closed) return;
        this.open().catch(() => undefined);
      }, this.backoff);
      this.backoff = Math.min(this.backoff * 2, 8000);
    };
    return mq.ready.then(() => {
      this.backoff = 1000;
      mq.subscribe(this.topic, (payload) => this.handler?.(payload));
    });
  }

  send(to: string, m: NetMsg): void {
    if (this.closed) return;
    // 同一則訊息同時送給多位加入者 → 合併成一筆廣播
    const dup = this.out.find((it) => it.m === m);
    if (dup) dup.to = '*';
    else this.out.push({ to, m });
    if (m.type === 'in' && !dup) {
      this.recent.push({ to: '*', m });
      if (this.recent.length > RELAY_REDUNDANCY) this.recent.shift();
    }
    if (m.type === 'bye') this.flush();
    else if (!this.timer) this.timer = window.setTimeout(() => this.flush(), RELAY_FLUSH_MS);
  }

  private flush(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    if (!this.out.length || !this.mq?.connected) return;
    const extra = this.recent.filter((r) => !this.out.some((o) => o.m === r.m));
    this.mq.publish(this.topic, JSON.stringify({ f: this.myId, b: [...extra, ...this.out] }));
    this.out = [];
  }

  close(): void {
    this.flush();
    this.closed = true;
    this.mq?.close();
  }
}

/** 對某一位對象的中繼通道（實際走所屬 hub 的房間主題） */
class RelayChannel implements Channel {
  readonly kind = 'relay' as const;
  private closed = false;

  constructor(
    readonly hub: RelayHub,
    private to: string,
  ) {}

  get open(): boolean {
    return !this.closed && this.hub.connected;
  }

  send(m: NetMsg): void {
    if (!this.closed) this.hub.send(this.to, m);
  }

  close(): void {
    this.closed = true;
  }
}

interface Link {
  conn: Channel;
  rtt: number;
  verified: boolean;
  lastSeen: number;
}

export class NetSession {
  status: NetStatus = 'connecting';
  error = '';
  code = '';
  mySlot = 0;
  epoch = 0;
  lockstep: Lockstep | null = null;
  /** 比賽進行中（房主據此拒絕新加入者） */
  inMatch = false;
  /** 其他人回報的世界雜湊：`${slot}:${tick}` → hash */
  remoteHashes = new Map<string, string>();
  private inbox: Inbound[] = [];
  private pending = new Map<number, NetMsg[]>();
  private peer: Peer | null = null;
  /** 房主：欄位 → 連線；加入者：只有 0（房主） */
  private links = new Map<number, Link>();
  private pingTimer = 0;
  private watchTimer = 0;
  private retries = 0;
  private timeout = 0;
  /** 房主是否曾成功登記房間（之後斷線只重連、不換代碼） */
  private registered = false;
  /** 中繼：已連上的 broker 用戶端 */
  private hubs: RelayHub[] = [];
  /** 房主：中繼加入者 id → 欄位 */
  private relaySlots = new Map<string, number>();
  private relayStarted = false;
  /** 加入者只處理一次版本不同 */
  private versionChecked = false;
  private roomMissing = false;
  private readonly myId = randomCode(10);

  private constructor(
    readonly role: 'host' | 'guest',
    private version: string,
  ) {
    // 關閉分頁時通知其他人，避免對方等到逾時才發現
    window.addEventListener('pagehide', () => {
      if (this.status !== 'closed') this.broadcast({ type: 'bye' });
    });
    // 中繼通道沒有底層斷線事件：一段時間沒收到訊息就視為離線
    this.watchTimer = window.setInterval(() => {
      const now = performance.now();
      for (const [slot, l] of this.links) if (l.conn.kind === 'relay' && now - l.lastSeen > RELAY_SILENCE) this.onLinkClosed(slot);
    }, 1000);
  }

  static host(version: string): NetSession {
    const s = new NetSession('host', version);
    s.code = randomCode();
    s.openHost();
    s.listenRelay();
    return s;
  }

  static join(code: string, version: string): NetSession {
    const s = new NetSession('guest', version);
    s.code = code.toUpperCase();
    if (forceRelay()) s.startRelayJoin();
    else s.openGuest();
    s.timeout = window.setTimeout(() => {
      if (s.status !== 'connecting') return;
      s.fail(
        s.roomMissing
          ? '找不到這個房間代碼，請確認代碼或請房主重新建立房間。'
          : '連線逾時：直連與中繼都沒有成功。請確認房主還在房間裡，或換個網路（例如手機熱點）再試。',
      );
    }, CONNECT_TIMEOUT);
    return s;
  }

  /** 已連上並通過版本檢查的加入者欄位（房主端） */
  guestSlots(): number[] {
    return [...this.links.entries()].filter(([, l]) => l.verified).map(([s]) => s);
  }

  /** 與房主（或最慢加入者）的往返延遲 */
  get rtt(): number {
    let m = 0;
    for (const l of this.links.values()) m = Math.max(m, l.rtt);
    return m;
  }

  /** 連線方式：加入者看與房主的通道；房主看是否有人走中繼 */
  linkKind(slot = 0): LinkKind | null {
    return this.links.get(slot)?.conn.kind ?? null;
  }

  transportLabel(): string {
    const kinds = [...this.links.values()].filter((l) => l.verified).map((l) => l.conn.kind);
    if (!kinds.length) return this.role === 'host' ? '等待玩家' : '連線中';
    if (kinds.every((k) => k === 'p2p')) return '直連';
    if (kinds.every((k) => k === 'relay')) return '中繼';
    return '直連＋中繼';
  }

  // ---------------- 房主 ----------------
  private openHost(): void {
    const peer = new Peer(ID_PREFIX + this.code, PEER_OPTIONS);
    this.peer = peer;
    window.clearTimeout(this.timeout);
    if (!this.registered)
      this.timeout = window.setTimeout(() => {
        if (this.status === 'connecting') this.fail('連不上配對伺服器（逾時）。請檢查網路，或稍後再試。');
      }, HOST_TIMEOUT);
    peer.on('open', () => this.markRegistered());
    peer.on('connection', (c) => this.acceptP2P(c));
    peer.on('error', (err: { type?: string; message?: string }) => {
      if (err.type === 'unavailable-id') {
        if (this.registered) {
          // 已發出去的連結要繼續有效：舊連線還沒被伺服器釋放，稍後用同一個代碼重連
          window.setTimeout(() => {
            if (!peer.destroyed) peer.reconnect();
          }, 3000);
          return;
        }
        if (this.retries++ < 5 && !this.relayStarted) {
          peer.destroy();
          this.code = randomCode();
          this.openHost();
          return;
        }
      }
      if (err.type === 'peer-unavailable') return; // 某位加入者消失，不影響房間
      const brokerTrouble = err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed';
      if (brokerTrouble) {
        // 手機切到別的 App（例如去 LINE 分享連結）時常見：已連線的玩家不受影響，背景重連即可；
        // 就算一直連不上 PeerJS，中繼仍可讓玩家加入
        window.setTimeout(() => {
          if (!peer.destroyed && peer.disconnected) peer.reconnect();
        }, 2000);
        return;
      }
      if (!this.registered) this.fail(describeError(err));
    });
    peer.on('disconnected', () => {
      window.setTimeout(() => {
        if (!peer.destroyed && peer.disconnected) peer.reconnect();
      }, 1000);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !peer.destroyed && peer.disconnected) peer.reconnect();
    });
  }

  private markRegistered(): void {
    this.registered = true;
    window.clearTimeout(this.timeout);
    if (this.status === 'connecting') this.status = 'open';
    this.startPing();
  }

  /** 房主在所有中繼 broker 上等待加入者 */
  private listenRelay(): void {
    this.relayStarted = true;
    const topic = `${TOPIC_BASE}/${this.code}/r`;
    RELAY_BROKERS.forEach((url, i) => {
      const hub = new RelayHub(url, `bkh${i}-${this.myId}`, topic, 'h');
      hub
        .connect((payload) => this.onRelayHost(hub, payload))
        .then(() => {
          this.hubs.push(hub);
          // PeerJS 連不上時也能只靠中繼開房
          if (!this.registered) this.markRegistered();
        })
        .catch(() => undefined);
    });
  }

  private parseRelay(payload: string): { f: string; b: RelayItem[] } | null {
    try {
      const d = JSON.parse(payload);
      return d && typeof d.f === 'string' && Array.isArray(d.b) ? d : null;
    } catch {
      return null;
    }
  }

  private onRelayHost(hub: RelayHub, payload: string): void {
    const env = this.parseRelay(payload);
    if (!env || env.f === 'h') return;
    // 給房主的訊息，加上加入者附帶的備援按鍵封包（收件者為 '*'）
    const mine = env.b.filter((it) => it.to === 'h' || (it.to === '*' && it.m.type === 'in')).map((it) => it.m);
    if (!mine.length) return;
    let slot = this.relaySlots.get(env.f);
    if (slot === undefined || !this.links.has(slot)) {
      if (!mine.some((m) => m.type === 'hello')) return;
      const s = this.admit(new RelayChannel(hub, env.f));
      if (s === null) return;
      slot = s;
      this.relaySlots.set(env.f, s);
    }
    const link = this.links.get(slot);
    if (link) link.lastSeen = performance.now();
    for (const m of mine) this.onData(slot, m);
  }

  private acceptP2P(c: DataConnection): void {
    c.on('open', () => {
      const ch = p2pChannel(c);
      const slot = this.admit(ch);
      if (slot === null) return;
      c.on('data', (d) => {
        const l = this.links.get(slot);
        if (l) l.lastSeen = performance.now();
        this.onData(slot, d as NetMsg);
      });
      c.on('close', () => this.onLinkClosed(slot));
      c.on('error', () => this.onLinkClosed(slot));
    });
  }

  /** 收一位新加入者：分配欄位並打招呼；房間滿或比賽中則拒絕 */
  private admit(ch: Channel): number | null {
    const free = [1, 2, 3].find((s) => !this.links.has(s));
    if (this.inMatch || free === undefined) {
      ch.send({ type: 'reject', reason: this.inMatch ? '房間正在比賽中，請等這場結束再加入。' : '房間已滿（最多 4 人）。' });
      setTimeout(() => ch.close(), 300);
      return null;
    }
    this.links.set(free, { conn: ch, rtt: 0, verified: false, lastSeen: performance.now() });
    ch.send({ type: 'hello', v: this.version });
    return free;
  }

  // ---------------- 加入者 ----------------
  private openGuest(): void {
    const peer = new Peer(PEER_OPTIONS);
    this.peer = peer;
    let conn: DataConnection | null = null;
    const giveUpP2P = () => {
      if (this.relayStarted) return;
      conn?.close();
      this.startRelayJoin();
    };
    const grace = window.setTimeout(() => {
      if (this.status === 'connecting') giveUpP2P();
    }, P2P_GRACE);
    peer.on('open', () => {
      const c = peer.connect(ID_PREFIX + this.code, { reliable: true, serialization: 'json' });
      conn = c;
      c.on('open', () => {
        if (this.relayStarted) {
          c.close();
          return;
        }
        window.clearTimeout(grace);
        this.links.set(0, { conn: p2pChannel(c), rtt: 0, verified: false, lastSeen: performance.now() });
        c.send({ type: 'hello', v: this.version } satisfies NetMsg);
        this.startPing();
      });
      c.on('data', (d) => {
        if (this.links.get(0)?.conn.kind !== 'p2p') return;
        this.links.get(0)!.lastSeen = performance.now();
        this.onData(0, d as NetMsg);
      });
      c.on('close', () => this.links.get(0)?.conn.kind === 'p2p' && this.onLinkClosed(0));
      c.on('error', () => this.links.get(0)?.conn.kind === 'p2p' && this.onLinkClosed(0));
      c.on('iceStateChanged', (state: RTCIceConnectionState) => {
        if (state === 'failed' && this.status === 'connecting') giveUpP2P();
      });
    });
    peer.on('error', (err: { type?: string; message?: string }) => {
      if (this.status !== 'connecting') return;
      if (err.type === 'peer-unavailable') this.roomMissing = true;
      if (err.type === 'browser-incompatible') {
        this.fail(describeError(err));
        return;
      }
      // 房間在 PeerJS 上找不到、或 PeerJS 連不上：仍嘗試中繼（房主可能只靠中繼開房）
      window.clearTimeout(grace);
      giveUpP2P();
    });
  }

  /** 加入者改走中繼：優先用延遲最低的 broker */
  private startRelayJoin(): void {
    if (this.relayStarted) return;
    this.relayStarted = true;
    const topic = `${TOPIC_BASE}/${this.code}/r`;
    const hubs = RELAY_BROKERS.map((url, i) => new RelayHub(url, `bkg${i}-${this.myId}`, topic, this.myId));
    const attempts = hubs.map((hub) => hub.connect((payload) => this.onRelayGuest(payload)));
    // 優先用第一個 broker（最多等 2.5 秒），連不上才用其他最先連上的
    const preferred = Promise.race([attempts[0], new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error('slow')), 2500))]);
    preferred
      .catch(() => Promise.any(attempts))
      .then((hub) => {
        this.hubs.push(hub);
        hubs.forEach((h, i) => h !== hub && attempts[i].then(() => h.close()).catch(() => h.close()));
        const ch = new RelayChannel(hub, 'h');
        this.links.set(0, { conn: ch, rtt: 0, verified: false, lastSeen: performance.now() });
        // 訂閱生效需要一點時間；打招呼重送幾次直到房主回應
        const greet = () => {
          if (this.status === 'connecting' && this.links.get(0)?.conn === ch) ch.send({ type: 'hello', v: this.version });
        };
        greet();
        [800, 2000, 4000, 7000].forEach((ms) => window.setTimeout(greet, ms));
        this.startPing();
      })
      .catch(() => {
        if (this.status === 'connecting') this.fail('直連失敗，中繼伺服器也連不上。請檢查網路，或換個網路（例如手機熱點）再試。');
      });
  }

  private onRelayGuest(payload: string): void {
    const env = this.parseRelay(payload);
    if (!env || env.f === this.myId) return;
    const link = this.links.get(0);
    if (!link || link.conn.kind !== 'relay') return;
    if (env.f === 'h') {
      link.lastSeen = performance.now();
      for (const it of env.b) if (it.to === this.myId || it.to === '*') this.onData(0, it.m);
    } else {
      // 其他中繼加入者的按鍵：同一個 broker 上直接收到，不必等房主轉送
      for (const it of env.b) if (it.m.type === 'in' && it.m.s !== this.mySlot) this.routeEpoch(it.m);
    }
  }

  private startPing(): void {
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => this.broadcast({ type: 'ping', ts: performance.now() }), 1000);
  }

  // ---------------- 收訊 ----------------
  private onData(from: number, m: NetMsg): void {
    const link = this.links.get(from);
    if (!link) return;
    switch (m.type) {
      case 'hello':
        if (m.v !== this.version) {
          this.onVersionMismatch(link.conn);
          return;
        }
        if (this.role === 'host' && !link.verified) {
          link.verified = true;
          link.conn.send({ type: 'welcome', slot: from });
          this.inbox.push({ from, msg: { type: 'peer-join', slot: from } });
        }
        return;
      case 'welcome':
        if (link.verified) return; // 中繼重送的招呼可能讓房主回多次
        link.verified = true;
        this.mySlot = m.slot;
        this.status = 'open';
        window.clearTimeout(this.timeout);
        return;
      case 'reject':
        if (m.stale) this.onVersionMismatch(null);
        else this.fail(m.reason);
        return;
      case 'ping':
        link.conn.send({ type: 'pong', ts: m.ts });
        return;
      case 'pong': {
        const r = performance.now() - m.ts;
        link.rtt = link.rtt ? link.rtt * 0.7 + r * 0.3 : r;
        return;
      }
      case 'bye':
        this.onLinkClosed(from);
        return;
      case 'in':
        if (this.role === 'host') {
          if (m.s !== from) return;
          this.relay(from, m);
        }
        this.routeEpoch(m);
        return;
      case 'drop':
        this.routeEpoch(m);
        return;
      case 'hash':
        if (this.role === 'host' && m.s !== from) return;
        if (m.e === this.epoch) this.remoteHashes.set(`${m.s}:${m.t}`, m.h);
        return;
      case 'start':
      case 'rematch':
        // 立刻切換 epoch，之後送達的按鍵才不會被丟掉
        this.beginMatch(m.epoch, m.delay, m.setup.players.filter((p) => p.controller === 'human').map((p) => p.slot));
        break;
    }
    this.inbox.push({ from, msg: m });
  }

  /** 依 epoch 分派按鍵 / 斷線訊息；未來 epoch 先暫存 */
  private routeEpoch(m: Extract<NetMsg, { type: 'in' | 'drop' }>): void {
    if (m.e === this.epoch) this.applyEpochMsg(m);
    else if (m.e > this.epoch) {
      const list = this.pending.get(m.e) ?? [];
      list.push(m);
      this.pending.set(m.e, list);
    }
  }

  private applyEpochMsg(m: NetMsg): void {
    if (!this.lockstep) return;
    if (m.type === 'in') this.lockstep.receive(m as InputPacket);
    else if (m.type === 'drop') this.lockstep.drop(m.s, m.t);
  }

  /** 房主把某位加入者的訊息轉送給其他加入者 */
  private relay(from: number, m: NetMsg): void {
    const src = this.links.get(from)?.conn;
    for (const [slot, l] of this.links) {
      if (slot === from || !l.verified || !l.conn.open) continue;
      // 同一個 broker 上的中繼加入者已經直接收到了，不必重送
      if (m.type === 'in' && src instanceof RelayChannel && l.conn instanceof RelayChannel && src.hub === l.conn.hub) continue;
      l.conn.send(m);
    }
  }

  private onLinkClosed(slot: number): void {
    const link = this.links.get(slot);
    if (!link) return;
    this.links.delete(slot);
    for (const [id, s] of this.relaySlots) if (s === slot) this.relaySlots.delete(id);
    link.conn.close();
    if (this.role === 'guest') {
      if (this.status !== 'error') this.status = 'closed';
      window.clearInterval(this.pingTimer);
      return;
    }
    if (!link.verified) return;
    // 房主：比賽中有人斷線 → 宣告其按鍵從某 tick 起為空，其他人繼續
    if (this.lockstep && this.lockstep.humanSlots.includes(slot) && !this.lockstep.isDropped(slot)) {
      const t = this.lockstep.lastReceived(slot) + 1;
      this.lockstep.drop(slot, t);
      this.broadcast({ type: 'drop', e: this.epoch, s: slot, t });
    }
    this.inbox.push({ from: slot, msg: { type: 'peer-leave', slot } });
  }

  // ---------------- 比賽 ----------------
  /** 開始一段新的 lockstep（新比賽或闖關下一關） */
  beginMatch(epoch: number, delay: number, humanSlots: number[]): void {
    this.epoch = epoch;
    this.lockstep = new Lockstep(delay, this.mySlot, humanSlots);
    this.remoteHashes.clear();
    for (const e of [...this.pending.keys()]) if (e < epoch) this.pending.delete(e);
    for (const m of this.pending.get(epoch) ?? []) this.applyEpochMsg(m);
    this.pending.delete(epoch);
  }

  /** 闖關下一關：沿用同一批玩家與延遲，已斷線的玩家維持斷線 */
  nextSegment(): void {
    const ls = this.lockstep;
    if (!ls) return;
    const dropped = ls.humanSlots.filter((s) => ls.isDropped(s));
    this.beginMatch(this.epoch + 1, ls.delay, [...ls.humanSlots]);
    for (const s of dropped) this.lockstep!.drop(s, 0);
  }

  /**
   * 依目前延遲決定輸入延遲 tick 數（房主決定，大家共用）。
   * 星狀拓撲最慢的路徑是「最慢的兩位加入者」經房主互傳：單程 ≈ (rtt1 + rtt2) / 2。中繼延遲較高，上限放寬。
   */
  suggestDelay(): number {
    const live = [...this.links.values()].filter((l) => l.verified);
    let path = 0;
    for (let i = 0; i < live.length; i++) {
      path = Math.max(path, live[i].rtt / 2); // 房主 ↔ 加入者
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        const sameBroker = a.conn instanceof RelayChannel && b.conn instanceof RelayChannel && a.conn.hub === b.conn.hub;
        // 同一個 broker 的中繼加入者走全房間主題直達；其餘經房主轉送
        path = Math.max(path, sameBroker ? Math.max(a.rtt, b.rtt) / 2 : (a.rtt + b.rtt) / 2);
      }
    }
    const relay = live.some((l) => l.conn.kind === 'relay');
    return Math.max(3, Math.min(relay ? 30 : 14, Math.ceil(path / (1000 / 60)) + 2));
  }

  sendInput(pkt: InputPacket): void {
    this.broadcast({ type: 'in', e: this.epoch, s: pkt.s, t: pkt.t, b: pkt.b });
  }

  /** 加入者：送給房主；房主：送給所有加入者 */
  broadcast(m: NetMsg): void {
    for (const l of this.links.values()) if (l.conn.open && (l.verified || m.type === 'ping')) l.conn.send(m);
  }

  drain(): Inbound[] {
    const q = this.inbox;
    this.inbox = [];
    return q;
  }

  /**
   * 雙方版本不同：先問伺服器誰才是最新版。
   * 自己是舊版 → 自動換到新版（加入者會帶著房間代碼回來）；對方是舊版 → 告訴大家是誰要重開網頁。
   */
  private onVersionMismatch(conn: Channel | null): void {
    if (this.versionChecked) return;
    this.versionChecked = this.role === 'guest';
    const reject = (reason: string) => {
      if (!conn) return;
      conn.send({ type: 'reject', reason, stale: true });
      setTimeout(() => conn.close(), 300);
    };
    const generic = '你和房主的遊戲版本不同。請兩人都關掉分頁、重新打開網頁後再試。';
    fetchLatestBuild().then((latest) => {
      const meStale = !!latest && latest !== __BUILD_ID__;
      if (this.role === 'guest') {
        if (meStale) {
          this.fail('發現新版本，正在自動更新，更新後會自動回到這個房間…');
          if (!reloadToBuild(latest, { room: this.code })) this.fail('你的網頁是舊版，自動更新沒成功。請關掉分頁、重新打開分享連結。');
        } else this.fail(latest ? '房主的網頁是舊版。請房主關掉分頁、重新打開網頁再建立房間（會有新的房間代碼）。' : generic);
        return;
      }
      // 房主
      if (meStale) {
        reject('房主的網頁是舊版，正在更新。請等房主傳新的分享連結。');
        this.fail('你的網頁是舊版，朋友連不進來。正在自動更新，更新後請重新建立房間並分享新連結…');
        reloadToBuild(latest);
      } else reject(latest ? '你的網頁是舊版。請關掉分頁、重新打開分享連結（手機也一樣）。' : generic);
    });
  }

  private fail(msg: string): void {
    if (this.status === 'closed') return;
    this.status = 'error';
    this.error = msg;
  }

  close(): void {
    this.broadcast({ type: 'bye' });
    window.clearInterval(this.pingTimer);
    window.clearInterval(this.watchTimer);
    this.status = 'closed';
    setTimeout(() => {
      for (const l of this.links.values()) l.conn.close();
      this.peer?.destroy();
      for (const h of this.hubs) h.close();
    }, 150);
  }
}

export { MAX_SLOTS };

function describeError(err: { type?: string; message?: string }): string {
  switch (err.type) {
    case 'peer-unavailable':
      return '找不到這個房間代碼，請確認代碼或請房主重新建立房間。';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return '無法連上配對伺服器，請檢查網路後再試。';
    case 'browser-incompatible':
      return '這個瀏覽器不支援 WebRTC 連線。';
    default:
      return `連線失敗（${err.type ?? err.message ?? '未知錯誤'}）`;
  }
}
