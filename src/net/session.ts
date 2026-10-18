// P2P 連線（最多 4 人，星狀拓撲）：用 PeerJS（WebRTC DataChannel）連接玩家的瀏覽器，不需要自架遊戲伺服器。
// 房主是中心：每位加入者只連房主，房主把每個人的按鍵轉送給其他人。
// PeerJS 的免費雲端 broker 只負責「介紹」雙方（交換連線資訊），遊戲資料不經過它。
import Peer, { type DataConnection } from 'peerjs';
import type { Difficulty } from '../config';
import type { MatchSetup } from '../sim/world';
import { Lockstep, MAX_SLOTS, type InputPacket } from './lockstep';

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
  | { type: 'reject'; reason: string }
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

const ID_PREFIX = 'brawlkids-tw-';

/**
 * ICE 伺服器：STUN 找出公網位址；TURN 在雙方無法直連（對稱型 NAT、公司 / 學校網路）時中繼。
 * 含 TCP 443 的 TURN，可穿過只開放網頁埠的防火牆。
 */
const PEER_OPTIONS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
      {
        urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ],
  },
};

/** 建立 / 加入的逾時（毫秒） */
const BROKER_TIMEOUT = 12000;
const CONNECT_TIMEOUT = 20000;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

function randomCode(): string {
  let s = '';
  const buf = new Uint32Array(CODE_LENGTH);
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

interface Link {
  conn: DataConnection;
  rtt: number;
  verified: boolean;
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
  private retries = 0;
  private timeout = 0;
  /** 房主是否曾成功登記房間（之後斷線只重連、不換代碼） */
  private registered = false;

  private constructor(
    readonly role: 'host' | 'guest',
    private version: string,
  ) {
    // 關閉分頁時通知其他人，避免對方等到 WebRTC 逾時才發現
    window.addEventListener('pagehide', () => {
      if (this.status !== 'closed') this.broadcast({ type: 'bye' });
    });
  }

  static host(version: string): NetSession {
    const s = new NetSession('host', version);
    s.openHost();
    return s;
  }

  static join(code: string, version: string): NetSession {
    const s = new NetSession('guest', version);
    s.code = code.toUpperCase();
    s.openGuest();
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

  // ---------------- 建立連線 ----------------
  private openHost(): void {
    if (!this.registered) this.code = randomCode();
    const peer = new Peer(ID_PREFIX + this.code, PEER_OPTIONS);
    this.peer = peer;
    window.clearTimeout(this.timeout);
    if (!this.registered)
      this.timeout = window.setTimeout(() => {
        if (!this.registered) this.fail('連不上配對伺服器（逾時）。請檢查網路，或稍後再試。');
      }, BROKER_TIMEOUT);
    peer.on('open', () => {
      this.registered = true;
      window.clearTimeout(this.timeout);
      this.status = 'open';
      this.startPing();
    });
    peer.on('connection', (c) => this.acceptGuest(c));
    peer.on('error', (err: { type?: string; message?: string }) => {
      if (err.type === 'unavailable-id') {
        if (this.registered) {
          // 已發出去的連結要繼續有效：舊連線還沒被伺服器釋放，稍後用同一個代碼重連
          window.setTimeout(() => {
            if (!peer.destroyed) peer.reconnect();
          }, 3000);
          return;
        }
        if (this.retries++ < 5) {
          peer.destroy();
          this.openHost();
          return;
        }
      }
      if (err.type === 'peer-unavailable') return; // 某位加入者消失，不影響房間
      const brokerTrouble = err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed';
      if (this.registered && brokerTrouble) {
        // 手機切到別的 App（例如去 LINE 分享連結）時常見：已連線的玩家不受影響，背景重連即可
        window.setTimeout(() => {
          if (!peer.destroyed && peer.disconnected) peer.reconnect();
        }, 2000);
        return;
      }
      this.fail(describeError(err));
    });
    peer.on('disconnected', () => {
      // 與 broker 斷線不影響已建立的 P2P 連線；用同一個代碼重連，讓新玩家仍能用原連結加入
      window.setTimeout(() => {
        if (!peer.destroyed && peer.disconnected) peer.reconnect();
      }, 1000);
    });
    // 從背景回到前景時檢查一次
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !peer.destroyed && peer.disconnected) peer.reconnect();
    });
  }

  private acceptGuest(c: DataConnection): void {
    c.on('open', () => {
      const free = [1, 2, 3].find((s) => !this.links.has(s));
      if (this.inMatch || free === undefined) {
        c.send({ type: 'reject', reason: this.inMatch ? '房間正在比賽中，請等這場結束再加入。' : '房間已滿（最多 4 人）。' } satisfies NetMsg);
        setTimeout(() => c.close(), 300);
        return;
      }
      const link: Link = { conn: c, rtt: 0, verified: false };
      this.links.set(free, link);
      c.on('data', (d) => this.onData(free, d as NetMsg));
      c.on('close', () => this.onLinkClosed(free));
      c.on('error', () => this.onLinkClosed(free));
      c.send({ type: 'hello', v: this.version } satisfies NetMsg);
    });
  }

  private openGuest(): void {
    const peer = new Peer(PEER_OPTIONS);
    this.peer = peer;
    this.timeout = window.setTimeout(() => {
      if (this.status === 'connecting')
        this.fail('連線逾時：找得到房間但無法建立點對點連線，可能是網路防火牆擋住。請換網路（例如手機熱點）再試。');
    }, CONNECT_TIMEOUT);
    peer.on('open', () => {
      const c = peer.connect(ID_PREFIX + this.code, { reliable: true, serialization: 'json' });
      this.links.set(0, { conn: c, rtt: 0, verified: false });
      c.on('open', () => {
        c.send({ type: 'hello', v: this.version } satisfies NetMsg);
        this.startPing();
      });
      c.on('data', (d) => this.onData(0, d as NetMsg));
      c.on('close', () => this.onLinkClosed(0));
      c.on('error', () => this.onLinkClosed(0));
      c.on('iceStateChanged', (state: RTCIceConnectionState) => {
        if (state === 'failed' && this.status === 'connecting')
          this.fail('無法建立點對點連線（網路防火牆或 NAT 限制）。請換網路（例如手機熱點）再試。');
      });
    });
    peer.on('error', (err: { type?: string; message?: string }) => this.fail(describeError(err)));
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
          if (this.role === 'guest') this.fail('你和房主的遊戲版本不同。請兩人都重新整理網頁（手機請關掉分頁重開）後再試。');
          else {
            link.conn.send({ type: 'reject', reason: '你和房主的遊戲版本不同。請兩人都重新整理網頁（手機請關掉分頁重開）後再試。' } satisfies NetMsg);
            setTimeout(() => link.conn.close(), 300);
          }
          return;
        }
        if (this.role === 'host' && !link.verified) {
          link.verified = true;
          link.conn.send({ type: 'welcome', slot: from } satisfies NetMsg);
          this.inbox.push({ from, msg: { type: 'peer-join', slot: from } });
        }
        return;
      case 'welcome':
        link.verified = true;
        this.mySlot = m.slot;
        this.status = 'open';
        window.clearTimeout(this.timeout);
        return;
      case 'reject':
        this.fail(m.reason);
        return;
      case 'ping':
        link.conn.send({ type: 'pong', ts: m.ts } satisfies NetMsg);
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
    for (const [slot, l] of this.links) if (slot !== from && l.verified && l.conn.open) l.conn.send(m);
  }

  private onLinkClosed(slot: number): void {
    const link = this.links.get(slot);
    if (!link) return;
    this.links.delete(slot);
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

  /** 依目前延遲決定輸入延遲 tick 數（房主決定，大家共用） */
  suggestDelay(): number {
    const oneWayTicks = this.rtt / 2 / (1000 / 60);
    // 經房主轉送的玩家要走兩段，因此多留一些
    return Math.max(3, Math.min(14, Math.ceil(oneWayTicks * (this.role === 'host' ? 2 : 1)) + 2));
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

  private fail(msg: string): void {
    if (this.status === 'closed') return;
    this.status = 'error';
    this.error = msg;
  }

  close(): void {
    this.broadcast({ type: 'bye' });
    window.clearInterval(this.pingTimer);
    this.status = 'closed';
    setTimeout(() => {
      for (const l of this.links.values()) l.conn.close();
      this.peer?.destroy();
    }, 100);
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
