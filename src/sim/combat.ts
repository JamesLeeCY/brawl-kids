// 碰撞判定、傷害、擊退。
import { CONFIG } from '../config';
import type { Box, Itr } from '../data/schema';
import { attackMul, inflict, removeBuff } from './effects';
import { buffValue, effTeam, getBuff, hasBuff, isAlive, type Entity } from './entity';
import { afterDamage, enterFrame, releaseGrab, setState } from './fsm';
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

/** 分身（傳承精神）站的位置：本尊身後偏一側 */
export function clonePos(a: Entity): { x: number; z: number } {
  const z = a.z + (a.z > CONFIG.physics.zMax - 22 ? -20 : 20);
  return { x: a.x - a.facing * 6, z };
}

export function resolveCombat(w: World): void {
  const list = w.entities.slice();
  for (const a of list) {
    if (a.removed || a.freeze > 0) continue;
    const itrs = activeItrs(w, a);
    if (!itrs) continue;
    const frameBefore = a.frame;
    let hitAny = hitPass(w, list, a, a, itrs, '', 1);
    // 分身跟著打：同樣的攻擊框，從分身的位置再判定一次（傷害減半）
    if (a.kind === 'char' && hasBuff(a, 'clone') && !a.removed) {
      const c = clonePos(a);
      hitAny = hitPass(w, list, a, { ...a, x: c.x, z: c.z }, itrs, 'c', 0.5) || hitAny;
    }
    if (hitAny && a.kind === 'char' && a.frame === frameBefore) {
      const f = w.currentFrame(a);
      if (f?.onHitNext) enterFrame(w, a, f.onHitNext);
    }
  }
}

function hitPass(w: World, list: Entity[], a: Entity, at: Entity, itrs: Itr[], prefix: string, mul: number): boolean {
  let hitAny = false;
  const team = effTeam(a);
  const heals = itrs.some((it) => it.healAlly);
  for (const t of list) {
    if (t.kind !== 'char' || t === a || t.id === a.ownerId || a.removed) continue;
    const ally = effTeam(t) === team;
    if ((ally && !heals) || !canBeHit(t)) continue;
    for (let i = 0; i < itrs.length; i++) {
      const itr = itrs[i];
      if (ally && !itr.healAlly) continue;
      const key = `${prefix}${a.chain}:${a.frame ?? ''}:${i}:${t.id}`;
      const last = a.hitSet[key];
      if (last !== undefined && (!itr.rehit || w.tick - last < itr.rehit)) continue;
      if (Math.abs(at.z - t.z) >= (itr.zRange ?? CONFIG.physics.hitZTolerance)) continue;
      const ar = worldRect(at, itr);
      if (!bodyBoxes(w, t).some((b) => overlaps(ar, worldRect(t, b)))) continue;
      a.hitSet[key] = w.tick;
      if (ally) healAlly(w, a, t, itr.healAlly!);
      else applyHit(w, at, t, mul === 1 ? itr : { ...itr, damage: itr.damage * mul });
      hitAny = true;
      break;
    }
    if (a.removed) break;
  }
  return hitAny;
}

/** 疫苗針筒打到隊友：補血 */
function healAlly(w: World, a: Entity, t: Entity, hp: number): void {
  if (!isAlive(t)) return;
  t.hp = Math.min(t.maxHp, t.hp + hp);
  w.emit({ type: 'say', id: t.id, text: `+${hp}` });
  w.emit({ type: 'sound', key: 'special' });
  if (a.kind === 'proj') onProjectileHit(w, a);
}

export function applyHit(w: World, a: Entity, t: Entity, itr: Itr): void {
  // a 可能是分身用的複本：攻擊者一律找回本尊
  const attacker = a.kind === 'char' ? (w.get(a.id) ?? a) : w.get(a.ownerId);

  // 識讀護盾：把飛行物反彈回去
  if (a.kind === 'proj' && hasBuff(t, 'reflect') && w.data.projectiles[a.projId]?.blockable) {
    a.vx = -a.vx || -a.facing * 6;
    a.facing = a.vx > 0 ? 1 : -1;
    a.team = effTeam(t);
    a.ownerId = t.id;
    a.chain++;
    a.hitSet = {};
    a.homingTarget = attacker?.id ?? 0;
    a.life = Math.max(a.life, 40);
    w.emit({ type: 'hit', x: a.x, y: a.y, z: a.z, heavy: false, blocked: true });
    w.emit({ type: 'sound', key: 'hit_light' });
    return;
  }

  // 都有掌握：自動擋下這一下，近身的攻擊者被反擊
  if (hasBuff(t, 'counter') && !itr.unblockable) {
    removeBuff(t, 'counter');
    w.emit({ type: 'say', id: t.id, text: '都有掌握！' });
    w.emit({ type: 'hit', x: (a.x + t.x) / 2, y: t.y + 36, z: t.z, heavy: false, blocked: true });
    w.emit({ type: 'sound', key: 'hit_heavy' });
    t.invuln = Math.max(t.invuln, 12);
    if (a.kind === 'proj') a.removed = true;
    if (attacker && attacker.kind === 'char' && isAlive(attacker) && Math.abs(attacker.x - t.x) < 140 && canBeHit(attacker)) {
      t.facing = attacker.x >= t.x ? 1 : -1;
      const dmg = 36 * (1 - buffValue(attacker, 'dmgReduce'));
      attacker.hp = Math.max(0, attacker.hp - dmg);
      t.stats.damage += dmg;
      attacker.flash = C.flashTicks;
      knockDown(attacker, t.facing * 5, 6);
      afterDamage(w, attacker, t);
    }
    return;
  }

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

  let dmg = itr.damage * (1 - buffValue(t, 'dmgReduce')) * (1 + buffValue(t, 'vuln'));
  let dvx = itr.dvx;
  let fall = itr.fall;
  if (attacker && attacker.kind === 'char') {
    dmg *= attackMul(attacker);
    if (itr.chargeMul) dmg *= 1 + (itr.chargeMul * attacker.charge) / 60;
    if (itr.bonusVs && t.charId === itr.bonusVs.char) {
      dmg *= itr.bonusVs.mul;
      if (itr.bonusVs.say) w.emit({ type: 'say', id: attacker.id, text: itr.bonusVs.say });
    }
    const crit = getBuff(attacker, 'crit');
    if (crit) {
      removeBuff(attacker, 'crit');
      dmg *= 1.57;
      w.emit({ type: 'say', id: t.id, text: '157！', status: true });
    }
    const knock = getBuff(attacker, 'knock');
    if (knock && a.kind === 'char') {
      dvx = Math.max(Math.abs(dvx), 3) * 2;
      fall += 30;
      if (--knock.n <= 0) removeBuff(attacker, 'knock');
    }
  }
  let hitstop = itr.hitstop ?? (itr.fall >= 50 ? C.hitstopHeavy : C.hitstopLight);
  const weight = w.charDef(t).stats.weight;
  let blocked = false;

  if (t.state === 'defend' && !itr.unblockable && !itr.throw) {
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
    t.fall += fall;
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
    if (itr.throw && a.kind === 'char') {
      // 過肩摔：摔到身後
      t.x = a.x - a.facing * 18;
      t.z = a.z;
      knockDown(t, (-a.facing * 4) / weight, 8);
      w.clampToStage(t);
    } else if (itr.pullToOwner && attacker && t.hp > 0) {
      // 舌頭勾：拉到施放者面前，暈一下
      t.x = attacker.x + attacker.facing * 30;
      t.z = attacker.z;
      t.y = 0;
      t.facing = attacker.facing === 1 ? -1 : 1;
      setState(t, 'dizzy');
      t.stateTime = C.dizzyTicks - 45;
      t.vx = 0;
      w.clampToStage(t);
    } else if (t.hp <= 0 || t.fall > C.fallKnock || airborne) {
      knockDown(t, (dir * Math.max(Math.abs(dvx), C.knockVx)) / weight, itr.dvy > 0 ? itr.dvy : C.knockVy);
    } else if (t.fall > C.fallDizzy) {
      setState(t, 'dizzy');
      t.vx = (dir * dvx) / weight;
    } else {
      setState(t, 'hurt');
      t.vx = (dir * dvx) / weight;
    }
    if (itr.inflict) inflict(w, t, itr.inflict, attacker);
    if (itr.drainMp) t.mp = Math.max(0, t.mp - itr.drainMp);
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

