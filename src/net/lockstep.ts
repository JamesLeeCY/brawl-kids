// 延遲式 lockstep（最多 4 人）：各端只交換按鍵，各自跑同一個決定論世界。
// 本地在第 t tick 收集的按鍵會被排到第 t + delay tick 才生效，留時間給網路傳輸；
// 世界只有在「所有真人玩家」該 tick 的按鍵都到齊時才前進，因此各端狀態永遠一致。
// 斷線的玩家由房主宣告「從第 T tick 起視為不按鍵」，其餘玩家可繼續。
import { ACTIONS, emptySnapshot, type Snapshot } from '../sim/snapshot';

export function encodeSnapshot(s: Snapshot): number {
  let b = 0;
  ACTIONS.forEach((a, i) => {
    if (s[a]) b |= 1 << i;
  });
  return b;
}

export function decodeSnapshot(b: number): Snapshot {
  const s = emptySnapshot();
  ACTIONS.forEach((a, i) => {
    s[a] = (b & (1 << i)) !== 0;
  });
  return s;
}

export interface InputPacket {
  /** 玩家欄位 */
  s: number;
  t: number;
  b: number;
}

export const MAX_SLOTS = 4;

export class Lockstep {
  private inputs = new Map<number, Map<number, number>>();
  private dropped = new Map<number, number>();
  private lastSeen = new Map<number, number>();
  private nextSend: number;

  constructor(
    readonly delay: number,
    readonly mySlot: number,
    /** 本場所有真人玩家的欄位（含自己） */
    readonly humanSlots: readonly number[],
  ) {
    this.nextSend = delay + 1;
    for (const s of humanSlots) this.inputs.set(s, new Map());
  }

  /**
   * 每個本地 tick 呼叫一次：把目前按鍵排進「worldTick + delay」並回傳要送出的封包。
   * 世界卡住（等待對手）時不會再往前排，避免本機領先太多。
   */
  produce(worldTick: number, snap: Snapshot): InputPacket | null {
    if (this.nextSend > worldTick + this.delay + 1) return null;
    const pkt = { s: this.mySlot, t: this.nextSend, b: encodeSnapshot(snap) };
    this.inputs.get(this.mySlot)?.set(pkt.t, pkt.b);
    this.nextSend++;
    return pkt;
  }

  receive(pkt: InputPacket): void {
    if (pkt.s === this.mySlot) return;
    const m = this.inputs.get(pkt.s);
    if (!m) return;
    m.set(pkt.t, pkt.b);
    this.lastSeen.set(pkt.s, Math.max(this.lastSeen.get(pkt.s) ?? 0, pkt.t));
  }

  /** 該玩家從 fromTick 起視為不按鍵（斷線） */
  drop(slot: number, fromTick: number): void {
    this.dropped.set(slot, fromTick);
  }

  /** 已收到該玩家最遠的 tick（房主決定斷線起點用） */
  lastReceived(slot: number): number {
    return this.lastSeen.get(slot) ?? this.delay;
  }

  isDropped(slot: number): boolean {
    return this.dropped.has(slot);
  }

  /** 若下一個 tick 所有真人玩家的按鍵都到齊，回傳依欄位排列的快照；否則 null（需等待） */
  take(worldTick: number): (Snapshot | undefined)[] | null {
    const t = worldTick + 1;
    const out: (Snapshot | undefined)[] = new Array(MAX_SLOTS).fill(undefined);
    for (const s of this.humanSlots) {
      const from = this.dropped.get(s);
      if (t <= this.delay || (from !== undefined && t >= from)) {
        out[s] = emptySnapshot();
        continue;
      }
      const b = this.inputs.get(s)!.get(t);
      if (b === undefined) return null;
      out[s] = decodeSnapshot(b);
    }
    for (const s of this.humanSlots) this.inputs.get(s)!.delete(t);
    return out;
  }
}
