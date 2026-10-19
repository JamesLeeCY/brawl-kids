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
  /** 加入者打招呼；id 用來在斷線重連時認回原本的欄位，e / have 告訴房主自己收到哪裡 */
  | { type: 'hello'; v: string; id?: string; e?: number; have?: number[]; r?: boolean }
  /** 房主回應；重連時附上房主收到這位加入者的最後 tick，讓對方補送 */
  | { type: 'welcome'; slot: number; e?: number; have?: number }
  | { type: 'reject'; reason: string; stale?: boolean }
  /** route / stages：合作闖關的場景路線（ROUTES 的索引）與自選的各關場景 */
  | { type: 'lobbystate'; slots: LobbySlot[]; opt: number; route?: number; stages?: string[]; len?: number }
  | { type: 'sel'; charIdx: number; team: number; ready: boolean }
  | { type: 'start'; setup: MatchSetup; epoch: number; delay: number }
  | { type: 'rematch'; setup: MatchSetup; epoch: number; delay: number }
  | { type: 'lobby' }
  | { type: 'in'; e: number; s: number; t: number; b: number }
  | { type: 'hash'; e: number; s: number; t: number; h: string }
  | { type: 'drop'; e: number; s: number; t: number }
  /** 世界卡在第 t tick 等按鍵：請對方從 t 起補送（中繼掉包或重連後的缺口） */
  | { type: 'need'; e: number; t: number }
  | { type: 'ping'; ts: number }
  /** 房主每 3 秒在各中繼 broker 廣播「我在這裡」，附上版本：加入者據此判斷房主在不在、版本是否相同 */
  | { type: 'beacon'; v: string }
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

/** 連線各步驟的狀態（加入畫面顯示，方便判斷卡在哪一步） */
export type Step = 'wait' | 'ok' | 'fail' | 'skip';
export interface JoinDiag {
  /** PeerJS 配對伺服器 */
  peer: Step;
  /** 點對點直連 */
  p2p: Step;
  /** 已連上的中繼伺服器數 / 失敗數 */
  relay: number;
  relayFail: number;
  /** 在中繼伺服器上看到房主（收到房主的廣播） */
  hostSeen: boolean;
  /** 收到房主的回應 */
  host: boolean;
}
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
/** 加入的總時限：期間持續向房主打招呼，房主從別的 App 回來時也能自動接上 */
const CONNECT_TIMEOUT = 60000;
/** 中繼通道多久沒收到任何訊息視為斷線（每秒都有 ping） */
const RELAY_SILENCE = 10000;
/** 中繼訊息合併送出的間隔：EMQX 公用 broker 每個連線約限 10 則 / 秒（實測超過就丟包），用 8 則 / 秒保留餘裕 */
const RELAY_FLUSH_MS = 125;
/** 每批附帶的最近按鍵封包數（約涵蓋 3 批），某一批被丟掉時下一批可補上 */
const RELAY_REDUNDANCY = 24;
/** 直連多久沒收到訊息視為斷線（每秒都有 ping） */
const P2P_SILENCE = 6000;
/** 斷線後保留欄位、等對方重連的時間：比賽中大家會暫停等待，所以較短 */
const RESUME_GRACE_MATCH = 20000;
const RESUME_GRACE_LOBBY = 45000;
/** 加入者重連的總時限 */
const RECONNECT_TIMEOUT = 30000;
/** 每段比賽保留的按鍵紀錄筆數（重連時補送用，約 4 人 × 30 秒） */
const LOG_KEEP = 4 * 60 * 30;

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
  private reopenTimer = 0;
  private lastPublish = 0;
  private watch = 0;

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
    // 自己發出的訊息也會從房間主題收回來：有在發卻好幾秒都沒收到任何東西 = 連線已死（手機背景常見），強制重連
    window.clearInterval(this.watch);
    this.watch = window.setInterval(() => {
      const mq = this.mq;
      const now = performance.now();
      if (!mq?.connected) return;
      // 有在發卻收不到；或閒置時連每 20 秒一次的心跳回應都沒有
      if ((now - this.lastPublish < 6000 && now - mq.lastRx > 6000) || now - mq.lastRx > 45000) mq.close();
    }, 2000);
    return this.open().then(() => this);
  }

  /** 回到前景時呼叫：若已斷線就立刻重連，不等退避時間 */
  revive(): void {
    if (this.closed || this.mq?.connected || !this.handler) return;
    window.clearTimeout(this.reopenTimer);
    this.backoff = 1000;
    this.open().catch(() => undefined);
  }

  private open(): Promise<void> {
    window.clearTimeout(this.reopenTimer);
    const old = this.mq;
    const mq = new MiniMqtt(this.url, `${this.clientId}-${Math.floor(Math.random() * 1e6)}`);
    this.mq = mq;
    old?.close();
    mq.onClose = () => {
      if (this.closed || this.mq !== mq) return;
      this.reopenTimer = window.setTimeout(() => {
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
    this.lastPublish = performance.now();
    this.out = [];
  }

  close(): void {
    this.flush();
    this.closed = true;
    window.clearInterval(this.watch);
    window.clearTimeout(this.reopenTimer);
    this.mq?.close();
  }
}

/** 對某一位對象的中繼通道（實際走所屬 hub 的房間主題） */
class RelayChannel implements Channel {
  readonly kind = 'relay' as const;
  private closed = false;

  constructor(
    readonly hub: RelayHub,
    readonly to: string,
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
  /** 房主：加入者 id → 欄位（直連與中繼共用，重連時據此認回原欄位） */
  private guestIds = new Map<string, number>();
  /** 房主：暫時斷線、等待重連的加入者（欄位 → 期限與原本的連線） */
  private lost = new Map<number, { until: number; link: Link }>();
  /** 加入者：與房主斷線，正在重新連線 */
  reconnecting = false;
  private reconnectTimer = 0;
  private reconnectRelay = false;
  private beaconTimer = 0;
  private greetTimer = 0;
  /** 房主：最近一次認回某欄位的時間（同一批重連招呼可能從多個 broker 進來，只採用第一個） */
  private resumedAt = new Map<number, number>();
  /** 加入者的連線步驟（畫面顯示用） */
  diag: JoinDiag = { peer: 'wait', p2p: 'wait', relay: 0, relayFail: 0, hostSeen: false, host: false };
  /** 各段比賽的按鍵 / 斷線紀錄（重連時補送） */
  private inLog = new Map<number, Map<string, NetMsg>>();
  /** 房主最近一次送出的開賽訊息（重連的加入者若錯過可補送） */
  private lastStart: NetMsg | null = null;
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
    // （進入 bfcache 的 persisted 情況可能還會回來，不算離開）
    window.addEventListener('pagehide', (e) => {
      if (this.status !== 'closed' && !e.persisted) this.broadcast({ type: 'bye' });
    });
    // 手機從背景回來：中繼連線可能已被系統關掉，立刻重連
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') for (const h of this.hubs) h.revive();
    });
    // 一段時間沒收到訊息就視為斷線（中繼沒有底層斷線事件；手機切換網路時直連也常默默中斷）
    this.watchTimer = window.setInterval(() => {
      const now = performance.now();
      for (const [slot, l] of this.links) {
        const limit = l.conn.kind === 'relay' ? RELAY_SILENCE : P2P_SILENCE;
        if (l.verified && now - l.lastSeen > limit) this.onLinkClosed(slot);
      }
      for (const [slot, rec] of this.lost) if (now > rec.until) this.finalizeLeave(slot);
      // 世界卡住超過 1.2 秒：請大家從缺的那個 tick 起補送（中繼一次掉太多包時，備援封包補不回來）
      const ls = this.lockstep;
      if (ls && ls.stalledMs(now) > 1200) this.broadcast({ type: 'need', e: this.epoch, t: ls.nextNeeded() });
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
    if (forceRelay()) {
      s.diag.peer = s.diag.p2p = 'skip';
      s.startRelayJoin();
    }
    else s.openGuest();
    s.timeout = window.setTimeout(() => {
      if (s.status !== 'connecting') return;
      const d = s.diag;
      s.fail(
        d.hostSeen
          ? '房主在線但沒有回應。請房主關掉分頁、重新打開網頁並建立新房間後再試。'
          : d.relay > 0
            ? s.roomMissing
              ? '找不到這個房間：房主可能已離開。請確認代碼，或請房主重新建立房間。'
              : '房主沒有出現在中繼伺服器上：請房主回到遊戲畫面（停在 LINE 等 App 時無法接受加入）。若仍不行，請房主關掉分頁重開、重新建立房間。'
            : '連線逾時：直連與中繼伺服器都連不上。請換個網路（例如手機熱點）再試。',
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

  /** 房主：目前連上的中繼伺服器數 */
  relayUp(): string {
    return `${this.hubs.filter((h) => h.connected).length}/${RELAY_BROKERS.length}`;
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

  /** 房主：每 3 秒在各中繼 broker 廣播自己在線（含版本），也順便讓閒置的連線保持有流量、死掉時能被發現 */
  private startBeacon(): void {
    window.clearInterval(this.beaconTimer);
    const beat = () => {
      if (this.status === 'closed') return;
      for (const h of this.hubs) if (h.connected) h.send('*', { type: 'beacon', v: this.version });
    };
    this.beaconTimer = window.setInterval(beat, 3000);
  }

  /** 房主在所有中繼 broker 上等待加入者 */
  private listenRelay(): void {
    this.relayStarted = true;
    this.startBeacon();
    const topic = `${TOPIC_BASE}/${this.code}/r`;
    RELAY_BROKERS.forEach((url, i) => {
      const hub = new RelayHub(url, `bkh${i}-${this.myId}`, topic, 'h');
      this.hubs.push(hub);
      // 連不上的 broker 每 5 秒再試，房主在越多 broker 上等，加入者越容易找到
      const attempt = () => {
        if (this.status === 'closed') return;
        if (hub.connected) {
          // 已經自動重連成功
          if (!this.registered) this.markRegistered();
          return;
        }
        hub
          .connect((payload) => this.onRelayHost(hub, payload))
          .then(() => {
            // PeerJS 連不上時也能只靠中繼開房
            if (!this.registered) this.markRegistered();
          })
          .catch(() => window.setTimeout(attempt, 5000));
      };
      attempt();
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
    let slot = this.relaySlot(hub, env.f);
    if (slot === null) {
      const hello = mine.find((m): m is Extract<NetMsg, { type: 'hello' }> => m.type === 'hello');
      if (!hello) return;
      this.onGuestHello(new RelayChannel(hub, env.f), hello, env.f);
      slot = this.relaySlot(hub, env.f);
      if (slot === null) return;
    }
    const link = this.links.get(slot);
    if (link) link.lastSeen = performance.now();
    for (const m of mine) this.onData(slot, m);
  }

  /** 這位中繼加入者（在這個 broker 上）目前的欄位；暫時斷線中的會被救回 */
  private relaySlot(hub: RelayHub, f: string): number | null {
    const slot = this.guestIds.get(f);
    if (slot === undefined) return null;
    const conn = this.links.get(slot)?.conn ?? this.lost.get(slot)?.link.conn;
    if (!(conn instanceof RelayChannel) || conn.hub !== hub || conn.to !== f) return null;
    return this.slotOf(conn);
  }

  /** 找出通道所在的欄位；若它被誤判為斷線（例如手機短暫凍結）而又收到訊息，直接救回 */
  private slotOf(ch: Channel): number | null {
    for (const [slot, l] of this.links) if (l.conn === ch) return slot;
    for (const [slot, rec] of this.lost)
      if (rec.link.conn === ch) {
        this.lost.delete(slot);
        rec.link.lastSeen = performance.now();
        this.links.set(slot, rec.link);
        return slot;
      }
    return null;
  }

  private acceptP2P(c: DataConnection): void {
    c.on('open', () => {
      const ch = p2pChannel(c);
      c.on('data', (d) => {
        const m = d as NetMsg;
        const slot = this.slotOf(ch);
        if (slot === null) {
          // 還沒認識的連線：先等對方打招呼（新玩家或斷線重連）
          if (m.type === 'hello') this.onGuestHello(ch, m);
          return;
        }
        const l = this.links.get(slot);
        if (l) l.lastSeen = performance.now();
        this.onData(slot, m);
      });
      const closed = () => {
        for (const [slot, l] of this.links) if (l.conn === ch) this.onLinkClosed(slot);
      };
      c.on('close', closed);
      c.on('error', closed);
    });
  }

  /** 房主收到尚未配對通道的招呼：版本檢查後，認回斷線重連的玩家，或分配新欄位 */
  private onGuestHello(ch: Channel, m: Extract<NetMsg, { type: 'hello' }>, fallbackId?: string): void {
    if (m.v !== this.version) {
      this.onVersionMismatch(ch);
      return;
    }
    const id = m.id ?? fallbackId;
    const known = id === undefined ? undefined : this.guestIds.get(id);
    if (known !== undefined && (this.links.has(known) || this.lost.has(known))) {
      const live = this.links.get(known);
      const now = performance.now();
      // 加入者同時在多個 broker 打招呼：已連著就忽略其他 broker 的重複招呼；重連時只採用最先到的那個
      if (live && live.conn !== ch && (!m.r || now - (this.resumedAt.get(known) ?? -1e9) < 3000)) return;
      this.resumedAt.set(known, now);
      this.resume(known, ch, m);
      return;
    }
    const slot = this.admit(ch);
    if (slot === null) return;
    if (id !== undefined) this.guestIds.set(id, slot);
    this.links.get(slot)!.verified = true;
    ch.send({ type: 'welcome', slot });
    this.inbox.push({ from: slot, msg: { type: 'peer-join', slot } });
  }

  /** 斷線重連：換上新通道，並補送對方錯過的按鍵 */
  private resume(slot: number, ch: Channel, m: Extract<NetMsg, { type: 'hello' }>): void {
    const old = this.links.get(slot) ?? this.lost.get(slot)?.link;
    this.lost.delete(slot);
    this.links.delete(slot);
    if (old && old.conn !== ch) old.conn.close();
    this.links.set(slot, { conn: ch, rtt: old?.rtt ?? 0, verified: true, lastSeen: performance.now() });
    ch.send({ type: 'hello', v: this.version });
    ch.send({ type: 'welcome', slot, e: this.epoch, have: this.lockstep ? this.lockstep.nextNeeded() - 1 : -1 });
    const from = m.e ?? this.epoch;
    // 對方錯過了這一場的開賽訊息：先補送
    if (from < this.epoch && this.lastStart && 'epoch' in this.lastStart && this.lastStart.epoch === this.epoch) {
      ch.send(this.lastStart);
      this.resendLog(ch, this.epoch, () => -1);
    } else this.resendLog(ch, from, (s) => m.have?.[s] ?? -1);
  }

  /** 收一位新加入者：分配欄位並打招呼；房間滿或比賽中則拒絕 */
  private admit(ch: Channel): number | null {
    const free = [1, 2, 3].find((s) => !this.links.has(s) && !this.lost.has(s));
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
  private helloMsg(): NetMsg {
    const ls = this.lockstep;
    const have = ls ? ls.nextNeeded() - 1 : -1;
    return { type: 'hello', v: this.version, id: this.myId, e: this.epoch, have: [have, have, have, have], r: this.reconnecting || undefined };
  }

  private openGuest(): void {
    const peer = new Peer(PEER_OPTIONS);
    this.peer = peer;
    let conn: DataConnection | null = null;
    const giveUpP2P = () => {
      if (this.relayStarted) return;
      if (this.diag.p2p === 'wait') this.diag.p2p = 'fail';
      conn?.close();
      this.startRelayJoin();
    };
    const grace = window.setTimeout(() => {
      if (this.status === 'connecting') giveUpP2P();
    }, P2P_GRACE);
    peer.on('open', () => {
      this.diag.peer = 'ok';
      if (conn) return; // 與配對伺服器重連時也會觸發
      const c = peer.connect(ID_PREFIX + this.code, { reliable: true, serialization: 'json' });
      conn = c;
      c.on('open', () => {
        window.clearTimeout(grace);
        if (!this.relayStarted) this.diag.p2p = 'ok';
      });
      this.wireGuestP2P(c, giveUpP2P);
      c.on('iceStateChanged', (state: RTCIceConnectionState) => {
        if (state === 'failed' && this.status === 'connecting') giveUpP2P();
      });
    });
    peer.on('error', (err: { type?: string; message?: string }) => {
      if (this.status !== 'connecting') return;
      if (err.type === 'peer-unavailable') this.roomMissing = true;
      // 配對伺服器有回應（只是找不到房間）算連得上；其他錯誤（含瀏覽器不支援直連，例如部分 App 內建瀏覽器）改走中繼
      this.diag.peer = err.type === 'peer-unavailable' ? 'ok' : 'fail';
      // 房間在 PeerJS 上找不到、或 PeerJS 連不上：仍嘗試中繼（房主可能只靠中繼開房）
      window.clearTimeout(grace);
      giveUpP2P();
    });
    peer.on('disconnected', () => {
      window.setTimeout(() => {
        if (!peer.destroyed && peer.disconnected) peer.reconnect();
      }, 1000);
    });
  }

  /** 加入者的直連通道：第一次連線與斷線重連共用 */
  private wireGuestP2P(c: DataConnection, onEarlyClose?: () => void): void {
    const ch = p2pChannel(c);
    c.on('open', () => {
      const cur = this.links.get(0);
      // 第一次連線時中繼已接手、或重連時已改用中繼：不再用這條直連
      if ((!this.reconnecting && (this.relayStarted || cur?.verified)) || (this.reconnecting && this.reconnectRelay)) {
        c.close();
        return;
      }
      this.links.set(0, { conn: ch, rtt: cur?.rtt ?? 0, verified: false, lastSeen: performance.now() });
      ch.send(this.helloMsg());
      this.startPing();
    });
    c.on('data', (d) => {
      const l = this.links.get(0);
      if (l?.conn !== ch) return;
      l.lastSeen = performance.now();
      this.onData(0, d as NetMsg);
    });
    const closed = () => {
      const l = this.links.get(0);
      if (l?.conn !== ch) return;
      if (!l.verified && this.status === 'connecting' && onEarlyClose) {
        this.links.delete(0);
        onEarlyClose();
      } else this.onLinkClosed(0);
    };
    c.on('close', closed);
    c.on('error', closed);
  }

  /**
   * 加入者同時連上所有中繼 broker，並在每一個上打招呼：房主可能只連得上其中幾個，
   * 先收到房主回覆的那個 broker 就是之後使用的通道。斷掉的 broker 會自動重連。
   */
  private startGuestRelay(): void {
    const topic = `${TOPIC_BASE}/${this.code}/r`;
    const have = new Set(this.hubs.map((h) => h.url));
    RELAY_BROKERS.forEach((url, i) => {
      if (have.has(url)) return;
      const hub = new RelayHub(url, `bkg${i}-${this.myId}`, topic, this.myId);
      this.hubs.push(hub);
      hub
        .connect((payload) => this.onRelayGuest(hub, payload))
        .then(() => {
          this.diag.relay++;
          this.greetAll();
        })
        .catch(() => {
          // 已選定通道後被主動關掉的 broker 不算失敗
          if (!this.hubs.includes(hub)) return;
          this.diag.relayFail++;
          this.hubs = this.hubs.filter((h) => h !== hub);
          hub.close();
          if (this.hubs.length) return;
          if (this.reconnecting) window.setTimeout(() => this.reconnecting && this.startGuestRelay(), 3000);
          else if (this.status === 'connecting' && this.diag.p2p !== 'ok')
            this.fail('直連失敗，中繼伺服器也全部連不上。可能是網路擋住了，請換個網路（例如手機熱點）再試。');
        });
    });
    // 等待期間每 2.5 秒打一次招呼，直到房主回應（訂閱生效需要時間，房主也可能晚點才回到畫面）
    [800, 2000].forEach((ms) => window.setTimeout(() => this.greetAll(), ms));
    window.clearInterval(this.greetTimer);
    this.greetTimer = window.setInterval(() => {
      const waiting = (this.status === 'connecting' || this.reconnecting) && !this.links.get(0)?.verified;
      if (waiting) this.greetAll();
      else window.clearInterval(this.greetTimer);
    }, 2500);
  }

  /** 在每個已連上的 broker 向房主打招呼（直到房主回應為止） */
  private greetAll(): void {
    if (!(this.status === 'connecting' || this.reconnecting) || this.links.get(0)?.verified) return;
    const hello = this.helloMsg();
    for (const h of this.hubs) if (h.connected) h.send('h', hello);
  }

  /** 已選定通道：關掉其他 broker（各自都會收到整個房間的訊息，留著浪費流量） */
  private pruneHubs(keep: RelayHub | null): void {
    for (const h of this.hubs) if (h !== keep) h.close();
    this.hubs = keep ? [keep] : [];
  }

  /** 加入者改走中繼 */
  private startRelayJoin(): void {
    if (this.relayStarted) return;
    this.relayStarted = true;
    this.startGuestRelay();
  }

  /**
   * 加入者與房主斷線（手機切換網路、螢幕關掉、切到別的 App…）：先試直連 4 秒，不行就走中繼。
   * 房主會保留欄位一段時間；重連後雙方補送錯過的按鍵，比賽接著進行。
   */
  private startReconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.reconnectRelay = false;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      if (!this.reconnecting) return;
      this.reconnecting = false;
      this.links.get(0)?.conn.close();
      this.links.delete(0);
      this.fail('與房主的連線中斷，重新連線失敗。請確認網路後重新加入。');
    }, RECONNECT_TIMEOUT);
    const peer = this.peer;
    if (peer && !peer.destroyed && !forceRelay()) {
      const go = () => {
        if (this.reconnecting && !this.reconnectRelay) this.wireGuestP2P(peer.connect(ID_PREFIX + this.code, { reliable: true, serialization: 'json' }));
      };
      if (peer.disconnected) {
        peer.once('open', go);
        peer.reconnect();
      } else go();
    }
    const viaRelay = () => {
      if (!this.reconnecting) return;
      this.reconnectRelay = true;
      this.startGuestRelay();
      this.greetAll();
    };
    window.setTimeout(viaRelay, peer && !forceRelay() ? 4000 : 0);
  }

  private onRelayGuest(hub: RelayHub, payload: string): void {
    const env = this.parseRelay(payload);
    if (!env || env.f === this.myId) return;
    let link = this.links.get(0);
    const onThisHub = link?.conn instanceof RelayChannel && link.conn.hub === hub;
    if (env.f === 'h') {
      const items = env.b.filter((it) => it.to === this.myId || it.to === '*');
      if (!items.length) return;
      const beacon = items.find((it) => it.m.type === 'beacon')?.m;
      if (beacon?.type === 'beacon') {
        this.diag.hostSeen = true;
        // 版本不同：自動判斷誰是舊版（加入者舊 → 自動更新後回到房間；房主舊 → 提示房主重開）
        if (beacon.v !== this.version && this.status === 'connecting') this.onVersionMismatch(null);
      }
      if (!onThisHub) {
        // 還沒有通道（或直連還沒成功）時，房主第一個「回覆給我」的 broker 就成為通道
        const waiting = this.status === 'connecting' || this.reconnecting;
        if (!waiting || link?.verified || !items.some((it) => it.to === this.myId)) return;
        link?.conn.close();
        link = { conn: new RelayChannel(hub, 'h'), rtt: link?.rtt ?? 0, verified: false, lastSeen: performance.now() };
        this.links.set(0, link);
        this.diag.host = true;
        this.startPing();
      }
      link!.lastSeen = performance.now();
      for (const it of items) this.onData(0, it.m);
    } else if (onThisHub) {
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
        // 房主：新玩家的招呼在 onGuestHello 處理；已認識的通道再打招呼 = 對方以為斷線而重連（例如只有單向收不到），再歡迎一次並補送
        if (this.role === 'host') {
          if (link.verified && m.v === this.version) this.resume(from, link.conn, m);
          return;
        }
        if (m.v !== this.version) this.onVersionMismatch(link.conn);
        return;
      case 'welcome':
        if (link.verified) return; // 中繼重送的招呼可能讓房主回多次
        link.verified = true;
        this.mySlot = m.slot;
        this.status = 'open';
        this.diag.host = true;
        window.clearTimeout(this.timeout);
        if (this.role === 'guest') this.pruneHubs(link.conn instanceof RelayChannel ? link.conn.hub : null);
        if (this.reconnecting) {
          this.reconnecting = false;
          window.clearTimeout(this.reconnectTimer);
          // 補送房主錯過的自己的按鍵
          if (m.e !== undefined && m.have !== undefined && m.have >= 0) {
            const have = m.have;
            this.resendLog(link.conn, m.e, (s) => (s === this.mySlot ? have : Infinity));
          }
        }
        return;
      case 'reject':
        if (m.stale) this.onVersionMismatch(null);
        else this.fail(m.reason);
        return;
      case 'beacon':
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
        this.onLinkClosed(from, true);
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
      case 'need':
        // 房主補送所有人的按鍵；加入者只補自己的
        this.resendLog(link.conn, m.e, this.role === 'host' ? () => m.t - 1 : (s) => (s === this.mySlot ? m.t - 1 : Infinity), true);
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
    this.record(m);
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

  /** 通道斷了。hard = 對方明確離開（關掉分頁）；否則先保留欄位等對方重連 */
  private onLinkClosed(slot: number, hard = false): void {
    const link = this.links.get(slot);
    if (!link) return;
    this.links.delete(slot);
    if (this.role === 'guest') {
      link.conn.close();
      if (!hard && link.verified && this.status === 'open') {
        this.startReconnect();
        return;
      }
      if (this.status !== 'error') this.status = 'closed';
      window.clearInterval(this.pingTimer);
      return;
    }
    if (!link.verified) {
      link.conn.close();
      return;
    }
    if (!hard) {
      // 通道先不關：若只是短暫凍結又收到訊息，可直接救回
      this.lost.set(slot, { until: performance.now() + (this.inMatch ? RESUME_GRACE_MATCH : RESUME_GRACE_LOBBY), link });
      return;
    }
    link.conn.close();
    this.finalizeLeave(slot);
  }

  /** 房主：確定某位加入者離開了 */
  private finalizeLeave(slot: number): void {
    this.lost.get(slot)?.link.conn.close();
    this.lost.delete(slot);
    for (const [id, s] of this.guestIds) if (s === slot) this.guestIds.delete(id);
    // 比賽中有人斷線 → 宣告其按鍵從某 tick 起為空，其他人繼續
    if (this.lockstep && this.lockstep.humanSlots.includes(slot) && !this.lockstep.isDropped(slot)) {
      const t = this.lockstep.lastReceived(slot) + 1;
      this.lockstep.drop(slot, t);
      this.broadcast({ type: 'drop', e: this.epoch, s: slot, t });
    }
    this.inbox.push({ from: slot, msg: { type: 'peer-leave', slot } });
  }

  /** 房主：正在等待重連的欄位 */
  lostSlots(): number[] {
    return [...this.lost.keys()];
  }

  /** 記下按鍵 / 斷線訊息，重連時補送 */
  private record(m: Extract<NetMsg, { type: 'in' | 'drop' }>): void {
    let log = this.inLog.get(m.e);
    if (!log) {
      log = new Map();
      this.inLog.set(m.e, log);
      for (const e of [...this.inLog.keys()]) if (e < m.e - 2) this.inLog.delete(e);
    }
    log.set(m.type === 'in' ? `${m.s}:${m.t}` : `d${m.s}`, m);
    if (log.size > LOG_KEEP) log.delete(log.keys().next().value as string);
  }

  /** 補送 fromEpoch（只送對方還沒有的 tick）及之後各段的紀錄 */
  private resendLog(ch: Channel, fromEpoch: number, have: (slot: number) => number, onlyThisEpoch = false): void {
    for (const [e, log] of this.inLog) {
      if (e < fromEpoch || (onlyThisEpoch && e !== fromEpoch)) continue;
      for (const m of log.values()) {
        if (m.type === 'in' && (e === fromEpoch ? m.t <= have(m.s) : have(m.s) === Infinity)) continue;
        ch.send(m);
      }
    }
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
    if (m.type === 'in' || m.type === 'drop') this.record(m);
    if (m.type === 'start' || m.type === 'rematch') this.lastStart = m;
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
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.beaconTimer);
    window.clearInterval(this.greetTimer);
    this.reconnecting = false;
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
