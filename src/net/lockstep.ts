// 延遲式 lockstep：兩端只交換按鍵，各自跑同一個決定論世界。
// 本地在第 t tick 收集的按鍵會被排到第 t + delay tick 才生效，留時間給網路傳輸；
// 世界只有在雙方該 tick 的按鍵都到齊時才前進，因此兩端狀態永遠一致。
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
  t: number;
  b: number;
}

export class Lockstep {
  private local = new Map<number, number>();
  private remote = new Map<number, number>();
  private nextSend: number;

  constructor(
    readonly delay: number,
    /** 本機玩家欄位：房主 0、加入者 1 */
    readonly mySlot: 0 | 1,
  ) {
    this.nextSend = delay + 1;
  }

  /**
   * 每個本地 tick 呼叫一次：把目前按鍵排進「worldTick + delay」並回傳要送給對手的封包。
   * 世界卡住（等待對手）時不會再往前排，避免本機領先太多。
   */
  produce(worldTick: number, snap: Snapshot): InputPacket | null {
    if (this.nextSend > worldTick + this.delay + 1) return null;
    const pkt = { t: this.nextSend, b: encodeSnapshot(snap) };
    this.local.set(pkt.t, pkt.b);
    this.nextSend++;
    return pkt;
  }

  receive(pkt: InputPacket): void {
    this.remote.set(pkt.t, pkt.b);
  }

  /** 若下一個 tick 雙方按鍵都到齊，回傳依欄位排列的快照；否則 null（需等待） */
  take(worldTick: number): Snapshot[] | null {
    const t = worldTick + 1;
    const pre = t <= this.delay;
    const mine = pre ? 0 : this.local.get(t);
    const theirs = pre ? 0 : this.remote.get(t);
    if (mine === undefined || theirs === undefined) return null;
    this.local.delete(t);
    this.remote.delete(t);
    const a = decodeSnapshot(mine);
    const b = decodeSnapshot(theirs);
    return this.mySlot === 0 ? [a, b] : [b, a];
  }

  /** 對手的按鍵領先 / 落後量，用於顯示 */
  get pendingRemote(): number {
    return this.remote.size;
  }
}
