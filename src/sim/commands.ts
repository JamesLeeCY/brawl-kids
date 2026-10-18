// 指令技解析：每位玩家保留最近 N tick 的「按下事件」緩衝，每 tick 由長到短比對指令表。
// 兩種施放方式（任一成立即可）：
//   1. 依序按：防禦 → 方向 → 攻擊/跳躍（時間窗內，中間夾雜其他按鍵也沒關係）
//   2. 按住：按住防禦 + 方向，再按攻擊/跳躍
import { CONFIG } from '../config';
import type { MoveDef } from '../data/schema';
import type { CmdEvent } from './entity';
import type { Snapshot } from './snapshot';

/** 按鍵事件記號：D 防禦、A 攻擊、J 跳躍、^ 上、v 下、< 左、> 右 */
const KEY_TOKENS: [keyof Snapshot, string][] = [
  ['D', 'D'],
  ['up', '^'],
  ['down', 'v'],
  ['left', '<'],
  ['right', '>'],
  ['A', 'A'],
  ['J', 'J'],
];

export function recordPresses(buf: CmdEvent[], pressed: Snapshot, tick: number): void {
  for (const [key, tok] of KEY_TOKENS) if (pressed[key]) buf.push({ k: tok, t: tick });
  const oldest = tick - CONFIG.combat.commandBufferTicks;
  while (buf.length && buf[0].t <= oldest) buf.shift();
}

export interface CommandMatch {
  move: MoveDef;
  /** 指令中的「前」決定施放方向；不含前方向的指令為 0 */
  facing: 1 | -1 | 0;
}

const DIRS = new Set(['^', 'v', '<', '>']);

/**
 * 依序輸入：最後一鍵（攻擊 / 跳躍）必須是本 tick 按下；往前在時間窗內，
 * 「最靠近最後一鍵的方向」決定招式，再往前找到防禦鍵即成立，中間其他按鍵忽略。
 * 左 / 右都算「前」，角色同時轉向該方向。
 */
export function matchCommand(buf: CmdEvent[], tick: number, moves: readonly MoveDef[]): CommandMatch | null {
  const last = buf[buf.length - 1];
  if (!last || last.t !== tick || (last.k !== 'A' && last.k !== 'J')) return null;
  const oldest = tick - CONFIG.combat.commandWindow;
  let dir = '';
  let facing: 1 | -1 | 0 = 0;
  for (let i = buf.length - 2; i >= 0; i--) {
    const ev = buf[i];
    if (ev.t < oldest) return null;
    if (!dir) {
      if (DIRS.has(ev.k)) {
        dir = ev.k === '<' || ev.k === '>' ? '>' : ev.k;
        if (ev.k === '>') facing = 1;
        if (ev.k === '<') facing = -1;
      }
    } else if (ev.k === 'D') {
      const move = moves.find((m) => m.command === `D${dir}${last.k}`);
      return move ? { move, facing } : null;
    }
  }
  return null;
}

/** 按住防禦 + 方向，再按攻擊 / 跳躍 */
export function matchHeld(cur: Snapshot, pressed: Snapshot, moves: readonly MoveDef[]): CommandMatch | null {
  if (!cur.D || !(pressed.A || pressed.J)) return null;
  let dir: string;
  let facing: 1 | -1 | 0 = 0;
  if (cur.up) dir = '^';
  else if (cur.down) dir = 'v';
  else if (cur.left || cur.right) {
    dir = '>';
    facing = cur.right ? 1 : -1;
  } else return null;
  const fin = pressed.A ? 'A' : 'J';
  const move = moves.find((m) => m.command === `D${dir}${fin}`);
  return move ? { move, facing } : null;
}
