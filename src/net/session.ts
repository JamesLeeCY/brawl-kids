// P2P 連線：用 PeerJS（WebRTC DataChannel）直接連接兩位玩家的瀏覽器，不需要自架遊戲伺服器。
// PeerJS 的免費雲端 broker 只負責「介紹」雙方（交換連線資訊），遊戲資料不經過它。
import Peer, { type DataConnection } from 'peerjs';
import type { MatchSetup } from '../sim/world';
import { Lockstep, type InputPacket } from './lockstep';

export type NetMsg =
  | { type: 'hello'; v: string }
  | { type: 'sel'; charIdx: number; ready: boolean }
  | { type: 'cfg'; opt: number }
  | { type: 'start'; setup: MatchSetup; epoch: number; delay: number }
  | { type: 'rematch'; setup: MatchSetup; epoch: number; delay: number }
  | { type: 'lobby' }
  | { type: 'in'; e: number; t: number; b: number }
  | { type: 'hash'; e: number; t: number; h: string }
  | { type: 'ping'; ts: number }
  | { type: 'pong'; ts: number }
  | { type: 'bye' };

export type NetStatus = 'connecting' | 'waiting' | 'open' | 'closed' | 'error';

const ID_PREFIX = 'brawlkids-tw-';
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

export class NetSession {
  status: NetStatus = 'connecting';
  error = '';
  code = '';
  rtt = 0;
  epoch = 0;
  lockstep: Lockstep | null = null;
  /** 對手回報的世界雜湊：tick → hash（只保留目前 epoch） */
  remoteHashes = new Map<number, string>();
  private inbox: NetMsg[] = [];
  private pending = new Map<number, InputPacket[]>();
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private pingTimer = 0;
  private retries = 0;

  private constructor(
    readonly role: 'host' | 'guest',
    private version: string,
  ) {}

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

  get mySlot(): 0 | 1 {
    return this.role === 'host' ? 0 : 1;
  }

  private openHost(): void {
    this.code = randomCode();
    const peer = new Peer(ID_PREFIX + this.code, { debug: 0 });
    this.peer = peer;
    peer.on('open', () => {
      this.status = 'waiting';
    });
    peer.on('connection', (c) => {
      if (this.conn) {
        c.on('open', () => c.close());
        return;
      }
      this.attach(c);
    });
    peer.on('error', (err: { type?: string; message?: string }) => {
      if (err.type === 'unavailable-id' && this.retries++ < 5) {
        peer.destroy();
        this.openHost();
        return;
      }
      this.fail(describeError(err));
    });
    peer.on('disconnected', () => {
      // 與 broker 斷線不影響已建立的 P2P 連線；尚未有人加入時嘗試重連
      if (!this.conn && !peer.destroyed) peer.reconnect();
    });
  }

  private openGuest(): void {
    const peer = new Peer({ debug: 0 });
    this.peer = peer;
    peer.on('open', () => {
      const c = peer.connect(ID_PREFIX + this.code, { reliable: true, serialization: 'json' });
      this.attach(c);
    });
    peer.on('error', (err: { type?: string; message?: string }) => this.fail(describeError(err)));
  }

  private attach(c: DataConnection): void {
    this.conn = c;
    c.on('open', () => {
      this.send({ type: 'hello', v: this.version });
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping', ts: performance.now() }), 1000);
    });
    c.on('data', (d) => this.onData(d as NetMsg));
    c.on('close', () => this.onClosed());
    c.on('error', () => this.onClosed());
  }

  private onData(m: NetMsg): void {
    switch (m.type) {
      case 'hello':
        if (m.v !== this.version) {
          this.fail('雙方遊戲版本不同，請兩人都重新整理網頁後再試。');
          return;
        }
        this.status = 'open';
        return;
      case 'in':
        if (m.e === this.epoch) this.lockstep?.receive(m);
        else if (m.e > this.epoch) {
          const list = this.pending.get(m.e) ?? [];
          list.push(m);
          this.pending.set(m.e, list);
        }
        return;
      case 'hash':
        if (m.e === this.epoch) this.remoteHashes.set(m.t, m.h);
        return;
      case 'ping':
        this.send({ type: 'pong', ts: m.ts });
        return;
      case 'pong':
        this.rtt = this.rtt ? this.rtt * 0.7 + (performance.now() - m.ts) * 0.3 : performance.now() - m.ts;
        return;
      case 'bye':
        this.onClosed();
        return;
      case 'start':
      case 'rematch':
        // 立刻切換 epoch，之後送達的按鍵才不會被丟掉
        this.beginMatch(m.epoch, m.delay);
        break;
    }
    this.inbox.push(m);
  }

  /** 開始一段新的 lockstep（新比賽或闖關下一關） */
  beginMatch(epoch: number, delay: number): void {
    this.epoch = epoch;
    this.lockstep = new Lockstep(delay, this.mySlot);
    this.remoteHashes.clear();
    for (const e of [...this.pending.keys()]) if (e < epoch) this.pending.delete(e);
    for (const pkt of this.pending.get(epoch) ?? []) this.lockstep.receive(pkt);
    this.pending.delete(epoch);
  }

  /** 依目前延遲決定輸入延遲 tick 數（房主決定，雙方共用） */
  suggestDelay(): number {
    const oneWayTicks = this.rtt / 2 / (1000 / 60);
    return Math.max(3, Math.min(12, Math.ceil(oneWayTicks) + 2));
  }

  send(m: NetMsg): void {
    if (this.conn?.open) this.conn.send(m);
  }

  drain(): NetMsg[] {
    const q = this.inbox;
    this.inbox = [];
    return q;
  }

  private fail(msg: string): void {
    if (this.status === 'closed') return;
    this.status = 'error';
    this.error = msg;
  }

  private onClosed(): void {
    if (this.status === 'error') return;
    this.status = 'closed';
    window.clearInterval(this.pingTimer);
  }

  close(): void {
    this.send({ type: 'bye' });
    window.clearInterval(this.pingTimer);
    this.status = 'closed';
    setTimeout(() => {
      this.conn?.close();
      this.peer?.destroy();
    }, 100);
  }
}

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
