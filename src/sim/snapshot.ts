// 每 tick 的按鍵快照：玩家鍵盤與 AI 都產生同一格式。
export const ACTIONS = ['up', 'down', 'left', 'right', 'A', 'J', 'D'] as const;
export type Action = (typeof ACTIONS)[number];
export type Snapshot = Record<Action, boolean>;

export function emptySnapshot(): Snapshot {
  return { up: false, down: false, left: false, right: false, A: false, J: false, D: false };
}

export function pressedEdges(cur: Snapshot, prev: Snapshot): Snapshot {
  const o = emptySnapshot();
  for (const a of ACTIONS) o[a] = cur[a] && !prev[a];
  return o;
}

export function snapshotFrom(keys: Partial<Snapshot>): Snapshot {
  return { ...emptySnapshot(), ...keys };
}
