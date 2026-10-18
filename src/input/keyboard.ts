// 鍵盤 → 每 tick 的按鍵快照。以 KeyboardEvent.code 綁定，與輸入法 / 大小寫無關。
import { ACTIONS, emptySnapshot, type Action, type Snapshot } from '../sim/snapshot';

export type Binding = Record<Action, string>;

/** 兩人共用一副鍵盤：P1 坐左邊（左手 WASD、右手 J K L），P2 坐右邊（左手方向鍵、右手數字鍵盤） */
export const DEFAULT_BINDINGS: Binding[] = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', A: 'KeyJ', J: 'KeyK', D: 'KeyL' },
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', A: 'Numpad1', J: 'Numpad2', D: 'Numpad3' },
];

/** 人類玩家數上限；其餘欄位只能設為電腦 */
export const HUMAN_PLAYERS = DEFAULT_BINDINGS.length;

export const ACTION_LABELS: Record<Action, string> = {
  up: '上',
  down: '下',
  left: '左',
  right: '右',
  A: '攻擊',
  J: '跳躍',
  D: '防禦',
};

const NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Space: '空白',
  ShiftLeft: '左Shift',
  ShiftRight: '右Shift',
  ControlLeft: '左Ctrl',
  ControlRight: '右Ctrl',
  AltLeft: '左Alt',
  AltRight: '右Alt',
  Enter: 'Enter',
  Backspace: '退格',
  Tab: 'Tab',
};

export function keyName(code: string): string {
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `數字${code.slice(6)}`;
  return code;
}

export class Keyboard {
  readonly held = new Set<string>();
  /** 自上個 tick 以來按下過的鍵：即使在同一幀內放開，也至少算按住一個 tick，避免快速點擊漏鍵 */
  private latched = new Set<string>();
  /** 觸控按鈕（併入 1P 的快照） */
  private virtualHeld = new Set<Action>();
  private virtualLatched = new Set<Action>();
  /** 偵測到實體鍵盤輸入時通知（觸控介面據此自動隱藏） */
  onPhysicalKey: (() => void) | null = null;
  /** 自上次 drain 以來按下的鍵（含 Esc、Enter 等選單鍵） */
  private pressedQueue: string[] = [];
  onFirstInput: (() => void) | null = null;
  /** 重新綁定時攔截下一個按鍵 */
  capture: ((code: string) => void) | null = null;
  reserved = new Set<string>();

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      this.onFirstInput?.();
      this.onPhysicalKey?.();
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(e.code);
        return;
      }
      if (this.reserved.has(e.code) || e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.pressedQueue.push(e.code);
      this.held.add(e.code);
      this.latched.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
    });
    target.addEventListener('blur', () => {
      this.held.clear();
      this.virtualHeld.clear();
    });
  }

  setBindings(bindings: Binding[]): void {
    this.reserved = new Set(bindings.flatMap((b) => ACTIONS.map((a) => b[a])));
  }

  /** index 0（1P）會併入觸控按鈕 */
  snapshot(b: Binding, index = -1): Snapshot {
    const s = emptySnapshot();
    for (const a of ACTIONS) s[a] = this.held.has(b[a]) || this.latched.has(b[a]);
    if (index === 0) for (const a of ACTIONS) s[a] = s[a] || this.virtualHeld.has(a) || this.virtualLatched.has(a);
    return s;
  }

  /** 觸控按鈕按下 / 放開 */
  setVirtual(a: Action, down: boolean): void {
    if (down) {
      this.virtualHeld.add(a);
      this.virtualLatched.add(a);
    } else this.virtualHeld.delete(a);
  }

  /** 送出選單用按鍵（例如觸控的暫停鈕 → Escape） */
  pushCode(code: string): void {
    this.pressedQueue.push(code);
  }

  /** 每個 tick 取完快照後呼叫 */
  endTick(): void {
    this.latched.clear();
    this.virtualLatched.clear();
  }

  drainPressed(): string[] {
    const q = this.pressedQueue;
    this.pressedQueue = [];
    return q;
  }
}
