// 碰撞判定、傷害、擊退。
import { CONFIG } from '../config';
import type { Box, Itr } from '../data/schema';
import { buffValue, hasBuff, type Entity } from './entity';
import { afterDamage, releaseGrab, setState } from './fsm';
import { dropHeldItem, onItemHit } from './items';
import { onProjectileHit } from './projectiles';
import type { World } from './world';

const C = CONFIG.combat;

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** 相對於腳底、依面向翻轉的框 → 世界座標 */
export function worldRect(e: Entity, b: Box): Rect {
  const x0 = e.facing === 1 ? e.x + b.x : e.x - b.x - b.w;
  return { x0, x1: x0 + b.w, y0: e.y + b.y, y1: e.y + b.y + b.h };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

export function bodyBoxes(w: World, e: Entity): Box[] {
  const f = e.state === 'attack' ? w.currentFrame(e) : undefined;
  if (f?.bdy) return f.bdy;
  return [w.charDef(e).body ?? C.defaultBody];
}

/** 取得實體目前有效的攻擊框 */
export function activeItrs(w: World, a: Entity): Itr[] | null {
  if (a.kind === 'char') return a.state === 'attack' ? w.currentFrame(a)?.itr ?? null : null;
  if (a.kind === 'proj') return w.currentFrame(a)?.itr ?? null;
  if (a.kind === 'item' && a.itemState === 'flying') {
    const def = w.data.items[a.itemId];
    const s = def.size;
    return [{ x: -s / 2, y: 0, w: s, h: Math.max(s, 16), damage: def.throwDamage, fall: def.throwFall, dvx: 4, dvy: 5, hitstop: 5 }];
  }
  return null;
}

function canBeHit(t: Entity): boolean {
  if (t.removed || t.invuln > 0) return false;
  return !['lying', 'dead', 'falling', 'rolling'].includes(t.state);
}

export function resolveCombat(w: World): void {
  const list = w.entities.slice();
  for (const a of list) {
    if (a.removed || a.freeze > 0) continue;
    const itrs = activeItrs(w, a);
    if (!itrs) continue;
    for (const t of list) {
      if (t.kind !== 'char' || t === a || t.id === a.ownerId || a.removed) continue;
      if (t.team === a.team || !canBeHit(t)) continue;
      for (let i = 0; i < itrs.length; i++) {
        const itr = itrs[i];
        const key = `${a.chain}:${a.frame ?? ''}:${i}:${t.id}`;
        const last = a.hitSet[key];
        if (last !== undefined && (!itr.rehit || w.tick - last < itr.rehit)) continue;
        if (Math.abs(a.z - t.z) >= (itr.zRange ?? CONFIG.physics.hitZTolerance)) continue;
        const ar = worldRect(a, itr);
        if (!bodyBoxes(w, t).some((b) => overlaps(ar, worldRect(t, b)))) continue;
        a.hitSet[key] = w.tick;
        applyHit(w, a, t, itr);
        break;
      }
      if (a.removed) break;
    }
  }
}

export function applyHit(w: World, a: Entity, t: Entity, itr: Itr): void {
  const attacker = a.kind === 'char' ? a : w.get(a.ownerId);

  // 晶圓護盾：擋下飛行物
  if (a.kind === 'proj' && hasBuff(t, 'blockProjectile') && w.data.projectiles[a.projId]?.blockable) {
    w.emit({ type: 'hit', x: a.x, y: a.y, z: a.z, heavy: false, blocked: true });
    w.emit({ type: 'sound', key: 'hit_light' });
    a.removed = true;
    return;
  }

  let dir: 1 | -1;
  if (itr.radial) dir = t.x >= a.x ? 1 : -1;
  else if (a.kind === 'char') dir = a.facing;
  else dir = a.vx > 0 ? 1 : a.vx < 0 ? -1 : a.facing;

  let dmg = itr.damage * (1 - buffValue(t, 'dmgReduce'));
  let hitstop = itr.hitstop ?? (itr.fall >= 50 ? C.hitstopHeavy : C.hitstopLight);
  const weight = w.charDef(t).stats.weight;
  let blocked = false;

  if (t.state === 'defend' && !itr.unblockable) {
    blocked = true;
    dmg *= 1 - C.guardDamageReduction;
    t.hp = Math.max(0, t.hp - dmg);
    t.guard -= itr.damage * C.guardCostMul;
    t.vx = dir * C.guardPushback;
    hitstop = Math.min(hitstop, C.hitstopLight);
    if (t.guard <= 0) {
      t.guard = 0;
      setState(t, 'broken');
    }
    if (t.hp <= 0) knockDown(t, dir * C.knockVx / weight, C.knockVy);
  } else {
    t.hp = Math.max(0, t.hp - dmg);
    t.fall += itr.fall;
    t.flash = C.flashTicks;
    dropHeldItem(w, t);
    if (t.grabTarget) {
      const g = w.get(t.grabTarget);
      if (g) releaseGrab(t, g);
    }
    if (t.grabbedBy) {
      const g = w.get(t.grabbedBy);
      if (g) releaseGrab(g, t);
    }
    t.facing = dir === 1 ? -1 : 1;
    const airborne = t.y > 0;
    if (t.hp <= 0 || t.fall > C.fallKnock || airborne) {
      knockDown(t, (dir * Math.max(Math.abs(itr.dvx), C.knockVx)) / weight, itr.dvy > 0 ? itr.dvy : C.knockVy);
    } else if (t.fall > C.fallDizzy) {
      setState(t, 'dizzy');
      t.vx = (dir * itr.dvx) / weight;
    } else {
      setState(t, 'hurt');
      t.vx = (dir * itr.dvx) / weight;
    }
  }

  if (attacker) attacker.stats.damage += dmg;
  afterDamage(w, t, attacker);
  a.freeze = hitstop;
  t.freeze = hitstop;
  const heavy = !blocked && hitstop >= C.hitstopHeavy;
  w.emit({ type: 'hit', x: (a.x + t.x) / 2, y: t.y + 36, z: t.z, heavy, blocked });
  w.emit({ type: 'sound', key: heavy ? 'hit_heavy' : 'hit_light' });
  if (heavy) w.emit({ type: 'shake', amp: CONFIG.fx.shakeAmp, ticks: CONFIG.fx.shakeTicks });

  if (a.kind === 'proj') onProjectileHit(w, a);
  else if (a.kind === 'item') onItemHit(w, a);
}

export function knockDown(t: Entity, vx: number, vy: number): void {
  setState(t, 'falling');
  t.vx = vx;
  t.vy = vy;
  t.vz = 0;
}

