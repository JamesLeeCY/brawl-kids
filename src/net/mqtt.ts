// 極簡 MQTT 3.1.1 over WebSocket 用戶端：只實作連線、訂閱、QoS 0 發佈與心跳。
// 用途：點對點（WebRTC）連不上時，透過公用 MQTT broker 中繼遊戲訊息，不需自架伺服器或註冊帳號。

const enc = new TextEncoder();
const dec = new TextDecoder();

function utf8(s: string): Uint8Array<ArrayBuffer> {
  const b = enc.encode(s);
  const out = new Uint8Array(b.length + 2);
  out[0] = b.length >> 8;
  out[1] = b.length & 255;
  out.set(b, 2);
  return out;
}

function remainingLength(n: number): number[] {
  const out: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 128;
    out.push(byte);
  } while (n > 0);
  return out;
}

function packet(header: number, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const rl = remainingLength(len);
  const out = new Uint8Array(1 + rl.length + len);
  out[0] = header;
  out.set(rl, 1);
  let o = 1 + rl.length;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export class MiniMqtt {
  private ws: WebSocket;
  private buf = new Uint8Array(0);
  private handlers = new Map<string, (payload: string) => void>();
  private pid = 1;
  private pingTimer = 0;
  private closed = false;
  /** 最後一次收到 broker 任何封包的時間（用來偵測手機背景後「看似連著、其實已死」的連線） */
  lastRx = performance.now();
  readonly ready: Promise<void>;
  onClose: (() => void) | null = null;

  constructor(
    readonly url: string,
    clientId: string,
    timeoutMs = 7000,
  ) {
    this.ws = new WebSocket(url, ['mqtt']);
    this.ws.binaryType = 'arraybuffer';
    this.ready = new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
      this.ws.onopen = () => {
        // CONNECT：協定名稱 MQTT、版本 4、clean session、keepalive 60 秒
        const vh = new Uint8Array([0, 4, 77, 81, 84, 84, 4, 0x02, 0, 60]);
        this.ws.send(packet(0x10, vh, utf8(clientId)));
      };
      this.ws.onmessage = (e) => this.onBytes(new Uint8Array(e.data as ArrayBuffer), () => {
        window.clearTimeout(t);
        resolve();
      });
      this.ws.onerror = () => {
        window.clearTimeout(t);
        reject(new Error('ws error'));
      };
      this.ws.onclose = () => {
        window.clearTimeout(t);
        reject(new Error('closed'));
        this.handleClose();
      };
    });
    this.pingTimer = window.setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(new Uint8Array([0xc0, 0]));
    }, 20000);
  }

  get connected(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  subscribe(topic: string, cb: (payload: string) => void): void {
    this.handlers.set(topic, cb);
    const id = this.pid++ & 0xffff || 1;
    this.ws.send(packet(0x82, new Uint8Array([id >> 8, id & 255]), utf8(topic), new Uint8Array([0])));
  }

  publish(topic: string, payload: string): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(packet(0x30, utf8(topic), enc.encode(payload)));
  }

  close(): void {
    if (this.closed) return;
    try {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(new Uint8Array([0xe0, 0]));
      this.ws.close();
    } catch {
      /* 忽略 */
    }
    this.handleClose();
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearInterval(this.pingTimer);
    this.onClose?.();
  }

  /** 解析資料流：一個 WebSocket 訊息可能含多個或半個 MQTT 封包 */
  private onBytes(chunk: Uint8Array, onConnack: () => void): void {
    this.lastRx = performance.now();
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    let o = 0;
    while (merged.length - o >= 2) {
      let mult = 1;
      let len = 0;
      let i = o + 1;
      let byte: number;
      do {
        if (i >= merged.length) {
          this.buf = merged.slice(o);
          return;
        }
        byte = merged[i++];
        len += (byte & 127) * mult;
        mult *= 128;
      } while (byte & 128);
      if (merged.length - i < len) break;
      const type = merged[o] >> 4;
      const body = merged.subarray(i, i + len);
      if (type === 2) onConnack();
      else if (type === 3) {
        const qos = (merged[o] >> 1) & 3;
        const tl = (body[0] << 8) | body[1];
        const topic = dec.decode(body.subarray(2, 2 + tl));
        const start = 2 + tl + (qos > 0 ? 2 : 0);
        this.handlers.get(topic)?.(dec.decode(body.subarray(start)));
      }
      o = i + len;
    }
    this.buf = merged.slice(o);
  }
}
