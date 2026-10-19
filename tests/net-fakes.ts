// 連線測試用的假網路：PeerJS 配對伺服器 / 直連通道，以及 MQTT 中繼 broker。
// 全部用計時器（搭配 vi.useFakeTimers）模擬延遲，不碰真的網路。
import type { MqttClient, NetTransport, PeerClient, PeerConnection } from '../src/net/session';

type Listener = (...args: any[]) => void;

class Emitter {
  private ls = new Map<string, { cb: Listener; once: boolean }[]>();
  on(ev: string, cb: Listener): this {
    const list = this.ls.get(ev) ?? [];
    list.push({ cb, once: false });
    this.ls.set(ev, list);
    return this;
  }
  once(ev: string, cb: Listener): this {
    const list = this.ls.get(ev) ?? [];
    list.push({ cb, once: true });
    this.ls.set(ev, list);
    return this;
  }
  emit(ev: string, ...args: unknown[]): void {
    const list = this.ls.get(ev);
    if (!list) return;
    this.ls.set(
      ev,
      list.filter((l) => !l.once),
    );
    for (const l of list) l.cb(...args);
  }
}

/** 一個「裝置」：可整台離線（所有直連與中繼都收不到、送不出，新連線也建立不起來） */
export class Node {
  offline = false;
  peers: FakePeer[] = [];
  constructor(
    readonly net: FakeNet,
    readonly name: string,
  ) {}

  transport(): NetTransport {
    return {
      peer: (id) => {
        const p = new FakePeer(this, id);
        this.peers.push(p);
        return p;
      },
      mqtt: (url, clientId) => new FakeMqtt(this, this.net.broker(url), clientId),
      brokers: this.net.brokers.map((b) => b.url),
    };
  }
}

// ---------------- PeerJS ----------------
export class FakeConn extends Emitter implements PeerConnection {
  open = false;
  other!: FakeConn;
  /** 通道默默中斷（不觸發 close，像手機切換網路） */
  cut = false;
  closed = false;

  constructor(
    readonly node: Node,
    readonly peer: string,
  ) {
    super();
  }

  send(data: unknown): void {
    if (!this.open || this.cut || this.node.offline) return;
    const payload = JSON.stringify(data); // serialization: 'json'
    const other = this.other;
    setTimeout(() => {
      if (this.cut || other.closed || other.node.offline) return;
      other.emit('data', JSON.parse(payload));
    }, this.node.net.p2pDelay);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit('close');
    const o = this.other;
    if (!o.closed && !this.cut)
      setTimeout(() => {
        if (o.closed) return;
        o.closed = true;
        o.open = false;
        o.emit('close');
      }, this.node.net.p2pDelay);
  }
}

let autoId = 0;

export class FakePeer extends Emitter implements PeerClient {
  destroyed = false;
  disconnected = false;
  readonly id: string;
  conns: FakeConn[] = [];

  constructor(
    readonly node: Node,
    id?: string,
  ) {
    super();
    this.id = id ?? `auto-${++autoId}`;
    const net = node.net;
    setTimeout(() => {
      if (net.peerServerDown || node.offline) {
        this.disconnected = true;
        this.emit('error', { type: 'network' });
        return;
      }
      if (net.peers.has(this.id)) {
        this.emit('error', { type: 'unavailable-id' });
        return;
      }
      net.peers.set(this.id, this);
      this.emit('open', this.id);
    }, net.signalDelay);
  }

  connect(id: string): FakeConn {
    const net = this.node.net;
    const mine = new FakeConn(this.node, id);
    this.conns.push(mine);
    setTimeout(() => {
      const target = net.peers.get(id);
      if (!target || target.destroyed) {
        this.emit('error', { type: 'peer-unavailable' });
        return;
      }
      const theirs = new FakeConn(target.node, this.id);
      target.conns.push(theirs);
      mine.other = theirs;
      theirs.other = mine;
      target.emit('connection', theirs);
      if (net.p2pBlocked || this.node.offline || target.node.offline) {
        // 打洞失敗：永遠開不起來
        setTimeout(() => mine.emit('iceStateChanged', 'failed'), 2000);
        return;
      }
      setTimeout(() => {
        if (mine.closed || theirs.closed) return;
        mine.open = theirs.open = true;
        theirs.emit('open');
        mine.emit('open');
      }, net.p2pDelay);
    }, net.signalDelay);
    return mine;
  }

  reconnect(): void {
    if (this.destroyed) return;
    setTimeout(() => {
      if (this.node.net.peerServerDown || this.node.offline) {
        this.emit('error', { type: 'network' });
        return;
      }
      this.disconnected = false;
      this.emit('open', this.id);
    }, this.node.net.signalDelay);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.node.net.peers.get(this.id) === this) this.node.net.peers.delete(this.id);
    for (const c of this.conns) c.close();
  }
}

// ---------------- MQTT broker ----------------
export interface Published {
  at: number;
  broker: string;
  clientId: string;
  payload: string;
}

export class FakeBroker {
  clients = new Set<FakeMqtt>();
  /** 單程延遲（毫秒） */
  delay = 30;
  /** 連上 broker 所需時間 */
  connectDelay = 60;
  /** 回傳 false 的發佈會被 broker 丟掉 */
  accept: (p: Published) => boolean = () => true;
  down = false;
  /** 所有收到的發佈（含被丟掉的），測試可檢查實際送了什麼 */
  log: Published[] = [];

  constructor(readonly url: string) {}

  publish(from: FakeMqtt, topic: string, payload: string): void {
    const p: Published = { at: performance.now(), broker: this.url, clientId: from.clientId, payload };
    this.log.push(p);
    if (this.down || !this.accept(p)) return;
    setTimeout(() => {
      for (const c of this.clients) c.deliver(topic, payload);
    }, this.delay);
  }
}

export class FakeMqtt implements MqttClient {
  connected = false;
  lastRx = performance.now();
  readonly ready: Promise<void>;
  onClose: (() => void) | null = null;
  private handlers = new Map<string, (payload: string) => void>();
  private closed = false;
  private pingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    readonly node: Node,
    readonly broker: FakeBroker,
    readonly clientId: string,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        if (this.closed) return reject(new Error('closed'));
        if (broker.down || node.offline) {
          this.closed = true;
          reject(new Error('ws error'));
          return;
        }
        this.connected = true;
        this.lastRx = performance.now();
        broker.clients.add(this);
        resolve();
      }, broker.connectDelay);
    });
    // 心跳回應（PINGRESP）
    this.pingTimer = setInterval(() => {
      if (this.connected && !node.offline && !broker.down) this.lastRx = performance.now();
    }, 20000);
  }

  subscribe(topic: string, cb: (payload: string) => void): void {
    this.handlers.set(topic, cb);
  }

  publish(topic: string, payload: string): void {
    if (!this.connected || this.node.offline) return;
    this.broker.publish(this, topic, payload);
  }

  deliver(topic: string, payload: string): void {
    if (!this.connected || this.node.offline) return;
    this.lastRx = performance.now();
    this.handlers.get(topic)?.(payload);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    clearInterval(this.pingTimer);
    this.broker.clients.delete(this);
    this.onClose?.();
  }
}

// ---------------- 整個網路 ----------------
export class FakeNet {
  peers = new Map<string, FakePeer>();
  brokers: FakeBroker[];
  /** PeerJS 配對伺服器連不上 */
  peerServerDown = false;
  /** 直連打洞失敗（電信級 NAT 等） */
  p2pBlocked = false;
  p2pDelay = 20;
  signalDelay = 50;

  constructor(brokerCount = 3) {
    this.brokers = Array.from({ length: brokerCount }, (_, i) => new FakeBroker(`wss://fake-broker-${i}/mqtt`));
  }

  broker(url: string): FakeBroker {
    const b = this.brokers.find((x) => x.url === url);
    if (!b) throw new Error(`unknown broker ${url}`);
    return b;
  }

  /** 讓某個裝置目前所有的直連默默中斷（雙向都收不到，也不觸發 close） */
  cutP2P(node: Node): void {
    for (const p of node.peers)
      for (const c of p.conns)
        if (c.open) {
          c.cut = true;
          if (c.other) c.other.cut = true;
        }
  }

  node(name: string): Node {
    return new Node(this, name);
  }
}

/** 解析中繼發佈內容 */
export function relayItems(p: Published): { f: string; b: { to: string; m: { type: string; [k: string]: unknown } }[] } {
  return JSON.parse(p.payload);
}
