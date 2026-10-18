// 指令技解析：每位玩家保留最近 N tick 的「按下事件」緩衝，每 tick 由長到短比對指令表。
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

/**
 * 指令字串的 ">" 表示「前」。依 3.4 節「→ 指角色面向的前方」：玩家按下左或右的同時即轉向該方向，
 * 因此 "D、←、A" 會讓角色面向左並放出 D>A。
 */
export function matchCommand(buf: CmdEvent[], tick: number, moves: readonly MoveDef[]): CommandMatch | null {
  const sorted = [...moves].sort((a, b) => b.command.length - a.command.length);
  for (const move of sorted) {
    const pattern = move.command.split('');
    if (buf.length < pattern.length) continue;
    const tail = buf.slice(buf.length - pattern.length);
    if (tail[tail.length - 1].t !== tick) continue;
    if (tick - tail[0].t > CONFIG.combat.commandWindow) continue;
    let facing: 1 | -1 | 0 = 0;
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      const p = pattern[i];
      const k = tail[i].k;
      if (p === '>') {
        if (k === '>') facing = 1;
        else if (k === '<') facing = -1;
        else ok = false;
      } else if (p !== k) ok = false;
      if (!ok) break;
    }
    if (ok) return { move, facing };
  }
  return null;
}
