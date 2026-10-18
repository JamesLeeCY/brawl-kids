// 電腦對手：不直接操控角色，而是每 tick 產生一份與玩家相同格式的虛擬按鍵快照。
import { CONFIG } from '../config';
import type { MoveDef } from '../data/schema';
import { isAlive, type AIState, type Entity } from './entity';
import { emptySnapshot, snapshotFrom, type Snapshot } from './snapshot';
import type { World } from './world';

const A = CONFIG.ai;
const BUSY = new Set(['hurt', 'dizzy', 'falling', 'lying', 'grabbed', 'dead', 'broken']);

export function aiThink(w: World, e: Entity): Snapshot {
  const ai = e.ai!;
  if (!isAlive(e) || BUSY.has(e.state)) {
    ai.plan = [];
    return emptySnapshot();
  }
  if (ai.plan.length) return ai.plan.shift()!;
  if (w.tick >= ai.nextDecision) decide(w, e, ai);
  return act(w, e, ai);
}

function nearestEnemy(w: World, e: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bd = Infinity;
  for (const c of w.chars()) {
    if (c.team === e.team || !isAlive(c)) continue;
    const d = Math.abs(c.x - e.x) + Math.abs(c.z - e.z) * 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

function incomingProjectile(w: World, e: Entity): boolean {
  for (const p of w.entities) {
    if (p.kind !== 'proj' && !(p.kind === 'item' && p.itemState === 'flying')) continue;
    if (p.team === e.team || p.removed) continue;
    const dx = e.x - p.x;
    if (Math.abs(dx) < 170 && Math.sign(dx) === Math.sign(p.vx) && Math.abs(p.z - e.z) < 18) return true;
  }
  return false;
}

function findMove(w: World, e: Entity, pred: (m: MoveDef) => boolean): MoveDef | undefined {
  return w.charDef(e).moves.find((m) => pred(m) && e.mp >= m.mp);
}

function nearbyItem(w: World, e: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bd = 220;
  for (const it of w.entities) {
    if (it.kind !== 'item' || it.itemState !== 'ground' || it.removed || it.y > 4) continue;
    const def = w.data.items[it.itemId];
    if (def.kind === 'consumable' && e.hp > e.maxHp * 0.7 && def.heal?.hp) continue;
    const d = Math.abs(it.x - e.x) + Math.abs(it.z - e.z);
    if (d < bd) {
      bd = d;
      best = it;
    }
  }
  return best;
}

function decide(w: World, e: Entity, ai: AIState): void {
  const r = w.rng;
  ai.nextDecision = w.tick + A.period[ai.difficulty];
  const target = nearestEnemy(w, e);
  ai.targetId = target?.id ?? 0;

  if (incomingProjectile(w, e) && r.chance(A.projectileDefendChance[ai.difficulty])) {
    ai.intent = 'defend';
    return;
  }
  if (!target || r.chance(A.mistake[ai.difficulty])) {
    ai.intent = 'wander';
    ai.wanderDx = r.int(-1, 1);
    ai.wanderDz = r.int(-1, 1);
    return;
  }
  const dist = Math.abs(target.x - e.x);
  const item = !e.heldItem ? nearbyItem(w, e) : undefined;
  if (item && r.chance(0.35)) {
    ai.intent = 'pickup';
    ai.targetId = item.id;
    return;
  }
  const aligned = Math.abs(target.z - e.z) < A.alignZ;
  const ranged = findMove(w, e, (m) => m.role === 'ranged');
  if (ranged && aligned && dist >= A.rangedMin && dist <= A.rangedMax && r.chance(A.specialChance[ai.difficulty])) {
    queueMove(e, ai, ranged, target);
    return;
  }
  const burst = findMove(w, e, (m) => m.role === 'burst');
  if (burst && dist < 70 && aligned && r.chance(A.specialChance[ai.difficulty] * 0.5)) {
    queueMove(e, ai, burst, target);
    return;
  }
  const rush = findMove(w, e, (m) => m.role === 'rush');
  if (rush && aligned && dist > 80 && dist < 220 && r.chance(A.specialChance[ai.difficulty] * 0.5)) {
    queueMove(e, ai, rush, target);
    return;
  }
  const extra = findMove(w, e, (m) => (m.role === 'buff' || m.role === 'area') && e.mp >= m.mp + 150);
  if (extra && r.chance(0.08)) {
    queueMove(e, ai, extra, target);
    return;
  }
  if (target.state === 'attack' && dist < 60 && r.chance(ai.difficulty === 'hard' ? 0.3 : 0.1)) {
    ai.intent = r.chance(0.5) ? 'defend' : 'evade';
    return;
  }
  ai.intent = 'approach';
}

/** 指令技：D、方向、攻擊/跳躍，每鍵之間放開一個 tick 以產生按下事件 */
function queueMove(e: Entity, ai: AIState, m: MoveDef, target: Entity): void {
  const toward = target.x >= e.x ? 'right' : 'left';
  const dirKey = m.command[1] === '>' ? toward : m.command[1] === '^' ? 'up' : 'down';
  const finKey = m.command[2] === 'A' ? 'A' : 'J';
  ai.intent = 'special';
  ai.plan = [
    snapshotFrom({ D: true }),
    emptySnapshot(),
    snapshotFrom({ [dirKey]: true }),
    emptySnapshot(),
    snapshotFrom({ [finKey]: true }),
    emptySnapshot(),
  ];
}

function act(w: World, e: Entity, ai: AIState): Snapshot {
  const s = emptySnapshot();
  const t = w.get(ai.targetId);
  switch (ai.intent) {
    case 'wander':
      if (ai.wanderDx > 0) s.right = true;
      if (ai.wanderDx < 0) s.left = true;
      if (ai.wanderDz > 0) s.down = true;
      if (ai.wanderDz < 0) s.up = true;
      return s;
    case 'defend':
      s.D = true;
      return s;
    case 'evade':
      if (e.state === 'run') {
        s.D = true;
        return s;
      }
      s.J = (w.tick & 1) === 0;
      if (t) s[t.x > e.x ? 'left' : 'right'] = true;
      return s;
    case 'pickup': {
      if (!t || t.kind !== 'item' || t.itemState !== 'ground') {
        ai.nextDecision = w.tick;
        return s;
      }
      steer(s, e, t.x, t.z, 6);
      if (Math.abs(t.x - e.x) < 16 && Math.abs(t.z - e.z) < 8) {
        s.left = s.right = s.up = s.down = false;
        s.A = (w.tick & 1) === 0;
      }
      return s;
    }
    case 'special':
      ai.intent = 'approach';
      return s;
    case 'approach':
    default: {
      if (!t || t.kind !== 'char') {
        ai.nextDecision = w.tick;
        return s;
      }
      const dx = t.x - e.x;
      const dz = t.z - e.z;
      const dist = Math.abs(dx);
      if (e.heldItem) {
        if (Math.abs(dz) < A.alignZ && dist < 260) {
          s[dx > 0 ? 'right' : 'left'] = e.facing !== (dx > 0 ? 1 : -1);
          s.A = (w.tick & 3) === 0;
          return s;
        }
      }
      if (Math.abs(dz) > A.alignZ * 0.6) s[dz > 0 ? 'down' : 'up'] = true;
      if (dist > A.meleeRange - 6) {
        const key = dx > 0 ? 'right' : 'left';
        if (ai.difficulty !== 'easy' && dist > 260 && e.state !== 'run' && e.state !== 'jump') {
          ai.plan = [snapshotFrom({ [key]: true }), emptySnapshot(), snapshotFrom({ [key]: true })];
          return emptySnapshot();
        }
        s[key] = true;
      } else {
        const want = dx >= 0 ? 1 : -1;
        if (e.facing !== want && e.state !== 'attack') s[want > 0 ? 'right' : 'left'] = true;
        else if (Math.abs(dz) < A.alignZ) s.A = (w.tick & 3) < 2;
      }
      return s;
    }
  }
}

function steer(s: Snapshot, e: Entity, x: number, z: number, tol: number): void {
  if (x > e.x + tol) s.right = true;
  else if (x < e.x - tol) s.left = true;
  if (z > e.z + tol / 2) s.down = true;
  else if (z < e.z - tol / 2) s.up = true;
}
