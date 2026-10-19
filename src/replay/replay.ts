// 重播：模擬是決定論的，存下 MatchSetup 與每 tick 的真人按鍵就能完整重現一場比賽。
// 純邏輯（不碰 DOM / Canvas）；壓縮用瀏覽器與 Node 都有的 CompressionStream。
import { decodeSnapshot, encodeSnapshot, MAX_SLOTS } from '../net/lockstep';
import type { Snapshot } from '../sim/snapshot';
import type { MatchSetup } from '../sim/world';

export interface Replay {
  /** 錄製時的 dataVersion()：不同就無法保證重現 */
  version: string;
  setup: MatchSetup;
  /** 共幾個 tick（最後一個 tick 世界剛好出現勝負） */
  ticks: number;
  /** 有錄按鍵的欄位（真人玩家），依序對應 inputs */
  slots: number[];
  /** inputs[i][t] = slots[i] 在第 t + 1 tick 的 7-bit 按鍵 */
  inputs: Uint8Array[];
  /** 錄製結束時的 World.hash()，播放到最後用來確認沒有跑掉 */
  finalHash: string;
}

/** 二進位格式：'R' + 格式版本 + varint 標頭長度 + 標頭 JSON + 各欄位的 run-length（按鍵 1 byte + varint 長度） */
const MAGIC = 0x52;
const FORMAT = 1;
/** 分享網址的 hash 前綴 */
export const HASH_PREFIX = '#replay=';

export class ReplayRecorder {
  readonly slots: number[];
  private inputs: number[][];
  private setup: MatchSetup;
  ticks = 0;

  constructor(
    setup: MatchSetup,
    private version: string,
  ) {
    // 深拷貝：之後畫面層改到 setup 也不影響錄好的內容
    this.setup = JSON.parse(JSON.stringify(setup)) as MatchSetup;
    this.slots = setup.players.filter((p) => p.controller === 'human').map((p) => p.slot);
    this.inputs = this.slots.map(() => []);
  }

  /** 每次 world.step(inputs) 之前（或之後）以同一份 inputs 呼叫一次 */
  record(inputs: readonly (Snapshot | undefined)[]): void {
    this.slots.forEach((s, i) => {
      const snap = inputs[s];
      this.inputs[i].push(snap ? encodeSnapshot(snap) : 0);
    });
    this.ticks++;
  }

  finish(finalHash: string): Replay {
    return {
      version: this.version,
      setup: this.setup,
      ticks: this.ticks,
      slots: [...this.slots],
      inputs: this.inputs.map((a) => Uint8Array.from(a)),
      finalHash,
    };
  }
}

/** 第 tick 個 step（0 起算）要餵給 world.step 的按鍵 */
export function replayInputs(r: Replay, tick: number): (Snapshot | undefined)[] {
  const out: (Snapshot | undefined)[] = new Array(MAX_SLOTS).fill(undefined);
  r.slots.forEach((s, i) => {
    out[s] = decodeSnapshot(r.inputs[i][tick] ?? 0);
  });
  return out;
}

// ---------- 二進位 ----------

interface Header {
  v: string;
  s: MatchSetup;
  n: number;
  k: number[];
  h: string;
}

class Writer {
  private buf: number[] = [];
  byte(b: number): void {
    this.buf.push(b & 0xff);
  }
  varint(n: number): void {
    while (n >= 0x80) {
      this.buf.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    this.buf.push(n);
  }
  bytes(b: Uint8Array): void {
    for (const x of b) this.buf.push(x);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.buf);
  }
}

class Reader {
  private i = 0;
  constructor(private b: Uint8Array) {}
  byte(): number {
    if (this.i >= this.b.length) throw new Error('重播資料不完整');
    return this.b[this.i++];
  }
  varint(): number {
    let n = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      n += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return n;
      shift += 7;
      if (shift > 35) throw new Error('重播資料格式錯誤');
    }
  }
  bytes(n: number): Uint8Array {
    if (this.i + n > this.b.length) throw new Error('重播資料不完整');
    const out = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return out;
  }
}

export function replayToBytes(r: Replay): Uint8Array {
  const w = new Writer();
  w.byte(MAGIC);
  w.byte(FORMAT);
  const header: Header = { v: r.version, s: r.setup, n: r.ticks, k: r.slots, h: r.finalHash };
  const hb = new TextEncoder().encode(JSON.stringify(header));
  w.varint(hb.length);
  w.bytes(hb);
  for (const arr of r.inputs) {
    let t = 0;
    while (t < r.ticks) {
      const v = arr[t] & 0x7f;
      let run = 1;
      while (t + run < r.ticks && arr[t + run] === v) run++;
      w.byte(v);
      w.varint(run);
      t += run;
    }
  }
  return w.done();
}

export function replayFromBytes(b: Uint8Array): Replay {
  const rd = new Reader(b);
  if (rd.byte() !== MAGIC) throw new Error('這不是重播資料');
  if (rd.byte() !== FORMAT) throw new Error('重播格式版本不支援');
  const h = JSON.parse(new TextDecoder().decode(rd.bytes(rd.varint()))) as Partial<Header>;
  const s = h.s;
  if (
    typeof h.v !== 'string' ||
    typeof h.n !== 'number' ||
    !Number.isInteger(h.n) ||
    h.n < 0 ||
    h.n > 60 * 60 * 60 ||
    !Array.isArray(h.k) ||
    !h.k.every((x) => Number.isInteger(x) && x >= 0 && x < MAX_SLOTS) ||
    typeof h.h !== 'string' ||
    !s ||
    typeof s !== 'object' ||
    typeof s.stageId !== 'string' ||
    typeof s.seed !== 'number' ||
    !Array.isArray(s.players)
  )
    throw new Error('重播資料格式錯誤');
  const inputs = h.k.map(() => {
    const arr = new Uint8Array(h.n!);
    let t = 0;
    while (t < h.n!) {
      const v = rd.byte() & 0x7f;
      const run = rd.varint();
      if (run < 1 || t + run > h.n!) throw new Error('重播資料格式錯誤');
      arr.fill(v, t, t + run);
      t += run;
    }
    return arr;
  });
  return { version: h.v, setup: s, ticks: h.n, slots: h.k, inputs, finalHash: h.h };
}

// ---------- 壓縮 + base64url ----------

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export function toBase64Url(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 重播 → 可放進網址的文字（deflate + base64url） */
export async function encodeReplay(r: Replay): Promise<string> {
  return toBase64Url(await pipe(replayToBytes(r), new CompressionStream('deflate')));
}

export async function decodeReplay(code: string): Promise<Replay> {
  let raw: Uint8Array;
  try {
    raw = await pipe(fromBase64Url(code.trim()), new DecompressionStream('deflate'));
  } catch {
    throw new Error('重播資料損毀或不完整');
  }
  return replayFromBytes(raw);
}

/** 從網址、hash 或單純的代碼文字取出重播代碼；找不到回傳 null */
export function extractReplayCode(s: string): string | null {
  const t = s.trim();
  const i = t.indexOf('replay=');
  const code = i >= 0 ? t.slice(i + 7) : t;
  const m = /^[A-Za-z0-9_-]{16,}/.exec(code);
  return m ? m[0] : null;
}
