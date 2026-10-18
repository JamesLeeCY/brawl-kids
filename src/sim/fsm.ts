// 角色狀態機：任一時刻只處於一個狀態；轉移條件以外的輸入忽略（但仍寫入指令緩衝）。
import { CONFIG } from '../config';
import type { CharacterDef } from '../data/load';
import type { BuffDef } from '../data/schema';
import { matchCommand, recordPresses } from './commands';
import { hasBuff, type CharState, type Entity } from './entity';
import { findNearbyItem, heldItemDef, pickUp, throwHeldItem } from './items';
import { spawnFromFrame } from './projectiles';
import { pressedEdges, type Snapshot } from './snapshot';
import type { World } from './world';

const P = CONFIG.physics;
const C = CONFIG.combat;

export function setState(e: Entity, s: CharState): void {
  e.state = s;
  e.stateTime = 0;
  if (s !== 'attack') {
    e.frame = null;
    e.frameTime = 0;
  }
}

export function isGrounded(e: Entity): boolean {
  return e.y <= 0 && e.vy <= 0;
}

/** 動作結束：在空中回到跳躍，在地面回到站立 */
export function toNeutral(e: Entity): void {
  setState(e, isGrounded(e) ? 'idle' : 'jump');
  if (e.state === 'jump') e.airAttackUsed = true;
}

export function addBuff(e: Entity, b: BuffDef): void {
  e.buffs = e.buffs.filter((x) => x.type !== b.type);
  e.buffs.push({ type: b.type, value: b.value, time: b.duration });
}

/** 開始一個新動作（新的命中鏈） */
export function startAction(w: World, e: Entity, frame: string): void {
  e.state = 'attack';
  e.stateTime = 0;
  e.chain++;
  e.hitSet = {};
  e.comboQueued = false;
  enterFrame(w, e, frame);
}

export function enterFrame(w: World, e: Entity, name: string): void {
  const def = w.charDef(e);
  const f = def.frames[name];
  if (!f) {
    toNeutral(e);
    return;
  }
  e.frame = name;
  e.frameTime = 0;
  if (f.sound) w.emit({ type: 'sound', key: f.sound });
  if (f.selfVel) {
    if (f.selfVel.vx !== undefined) e.vx = f.selfVel.vx * e.facing;
    if (f.selfVel.vy !== undefined) e.vy = f.selfVel.vy;
    if (f.selfVel.vz !== undefined) e.vz = f.selfVel.vz;
  }
  if (f.buff) addBuff(e, f.buff);
  if (f.heal) e.hp = Math.min(e.maxHp, e.hp + f.heal);
  if (f.spawn) spawnFromFrame(w, e, f.spawn);
  if (f.throwItem) throwHeldItem(w, e);
  if (f.shake) w.emit({ type: 'shake', amp: CONFIG.fx.shakeAmp, ticks: CONFIG.fx.shakeTicks });
}

function canCommand(w: World, e: Entity): boolean {
  if (!['idle', 'walk', 'run', 'defend', 'jump'].includes(e.state)) return false;
  return heldItemDef(w, e)?.kind !== 'heavy';
}

export function updateChar(w: World, e: Entity, cur: Snapshot): void {
  const def = w.charDef(e);
  const pressed = pressedEdges(cur, e.prevInput);
  e.prevInput = cur;
  recordPresses(e.cmdBuf, pressed, w.tick);
  if (e.state === 'attack' && pressed.A) e.comboQueued = true;

  if (e.freeze > 0) {
    e.freeze--;
    return;
  }

  // ---- 計時器 ----
  if (e.flash > 0) e.flash--;
  if (e.invuln > 0) e.invuln--;
  for (const b of e.buffs) b.time--;
  e.buffs = e.buffs.filter((b) => b.time > 0);
  if (e.state !== 'dead') e.mp = Math.min(C.mpMax, e.mp + C.mpRegen);
  e.fall = Math.max(0, e.fall - C.fallDecay);
  if (e.state !== 'defend' && e.state !== 'broken') e.guard = Math.min(C.guardMax, e.guard + C.guardRegen);
  e.stateTime++;

  const dx = (cur.right ? 1 : 0) - (cur.left ? 1 : 0);
  const dz = (cur.down ? 1 : 0) - (cur.up ? 1 : 0);
  let moving = false;

  // ---- 指令技 ----
  if (canCommand(w, e) && (pressed.A || pressed.J)) {
    const m = matchCommand(e.cmdBuf, w.tick, def.moves);
    if (m && e.mp >= m.move.mp && (isGrounded(e) || m.move.air)) {
      e.mp -= m.move.mp;
      e.cmdBuf.length = 0;
      if (m.facing) e.facing = m.facing;
      if (isGrounded(e)) {
        e.vx = 0;
        e.vz = 0;
      }
      startAction(w, e, m.move.startFrame);
      physics(w, e, false);
      return;
    }
  }

  const ws = def.stats.walkSpeed;
  const wsz = ws * (P.walkSpeedZ / P.walkSpeedX);
  const held = heldItemDef(w, e);
  const heavy = held?.kind === 'heavy';

  switch (e.state) {
    case 'idle':
    case 'walk': {
      if (pressed.A) {
        tryAttack(w, e, 'ground');
        break;
      }
      if (pressed.J && !heavy) {
        doJump(w, e, def, dx * ws, dz * wsz);
        break;
      }
      if (cur.D && !heavy) {
        setState(e, 'defend');
        break;
      }
      if ((pressed.left || pressed.right) && !heavy) {
        const d = pressed.right ? 1 : -1;
        if (e.lastTapDir === d && w.tick - e.lastTapTick <= P.doubleTapWindow) {
          e.facing = d;
          e.lastTapDir = 0;
          setState(e, 'run');
          moving = true;
          break;
        }
        e.lastTapDir = d;
        e.lastTapTick = w.tick;
      }
      if (dx || dz) {
        const mul = heavy ? P.heavyCarrySpeedMul : 1;
        e.vx = dx * ws * mul;
        e.vz = dz * wsz * mul;
        if (dx) e.facing = dx > 0 ? 1 : -1;
        if (e.state !== 'walk') setState(e, 'walk');
        moving = true;
        if (dx) tryGrab(w, e);
      } else if (e.state !== 'idle') setState(e, 'idle');
      break;
    }

    case 'run': {
      const dirHeld = e.facing === 1 ? cur.right : cur.left;
      const oppHeld = e.facing === 1 ? cur.left : cur.right;
      if (pressed.A) {
        tryAttack(w, e, 'run');
        break;
      }
      if (pressed.J) {
        doJump(w, e, def, e.facing * def.stats.runSpeed * P.dashJumpVxMul, dz * wsz);
        e.vy *= P.dashJumpVyMul;
        break;
      }
      if (pressed.D) {
        setState(e, 'rolling');
        e.invuln = Math.max(e.invuln, C.rollTicks);
        moving = true;
        break;
      }
      if (!dirHeld || oppHeld) {
        setState(e, 'idle');
        break;
      }
      e.vx = e.facing * def.stats.runSpeed;
      e.vz = dz * P.runSpeedZ;
      moving = true;
      break;
    }

    case 'jump': {
      const hover = hasBuff(e, 'hover');
      if (pressed.A && (!e.airAttackUsed || hover)) {
        e.airAttackUsed = true;
        tryAttack(w, e, 'air');
        break;
      }
      if (hover) {
        e.vx = dx * ws;
        e.vz = dz * wsz;
        if (dx) e.facing = dx > 0 ? 1 : -1;
      }
      break;
    }

    case 'attack': {
      const f = e.frame ? def.frames[e.frame] : undefined;
      if (!f) {
        toNeutral(e);
        break;
      }
      if (f.invuln) e.invuln = Math.max(e.invuln, 2);
      e.frameTime++;
      if (e.frameTime >= f.duration) {
        let next = f.next;
        if (e.comboQueued && f.onA) {
          next = f.onA;
          e.comboQueued = false;
        }
        if (next === 'idle' || !def.frames[next]) toNeutral(e);
        else enterFrame(w, e, next);
      }
      break;
    }

    case 'defend': {
      if (!cur.D) {
        setState(e, 'idle');
        break;
      }
      if (dx) e.facing = dx > 0 ? 1 : -1;
      break;
    }

    case 'broken':
      if (e.stateTime >= C.guardBreakTicks) {
        e.guard = C.guardMax * 0.5;
        setState(e, 'idle');
      }
      break;

    case 'hurt':
      if (e.stateTime >= C.hurtTicks) setState(e, 'idle');
      break;

    case 'dizzy':
      if (e.stateTime >= C.dizzyTicks) {
        e.fall = 0;
        setState(e, 'idle');
      }
      break;

    case 'grabbing':
      updateGrabbing(w, e, pressed, dx);
      break;

    case 'grabbed': {
      const g = w.get(e.grabbedBy);
      if (!g || g.state !== 'grabbing' || g.grabTarget !== e.id) {
        e.grabbedBy = 0;
        setState(e, 'dizzy');
        e.stateTime = C.dizzyTicks - 20;
      }
      break;
    }

    case 'falling':
      break;

    case 'lying':
      if (e.stateTime >= C.lyingTicks) {
        if (e.hp <= 0) setState(e, 'dead');
        else {
          setState(e, 'idle');
          e.fall = 0;
          e.invuln = C.invulnAfterGetUp;
        }
      }
      break;

    case 'rolling':
      e.vx = e.facing * C.rollSpeed;
      e.vz = dz * P.walkSpeedZ;
      moving = true;
      if (e.stateTime >= C.rollTicks) setState(e, 'idle');
      break;

    case 'dead':
      e.vx = 0;
      e.vz = 0;
      break;
  }

  physics(w, e, moving);
}

function doJump(w: World, e: Entity, def: CharacterDef, vx: number, vz: number): void {
  setState(e, 'jump');
  e.vy = def.stats.jumpPower;
  e.vx = vx;
  e.vz = vz * 0.8;
  e.airAttackUsed = false;
  w.emit({ type: 'sound', key: 'jump' });
}

/** 攻擊鍵：撿道具 / 揮擊 / 投擲 / 一般攻擊 */
function tryAttack(w: World, e: Entity, ctx: 'ground' | 'run' | 'air'): void {
  const held = heldItemDef(w, e);
  if (held) {
    if (held.kind === 'heavy' || ctx !== 'ground' || !held.swingFrame) {
      startAction(w, e, 'throw');
      return;
    }
    if (held.kind === 'weapon') {
      const it = w.get(e.heldItem);
      if (it) {
        it.uses--;
        if (it.uses <= 0) {
          it.removed = true;
          e.heldItem = 0;
        }
      }
    }
    startAction(w, e, held.swingFrame);
    return;
  }
  if (ctx === 'ground') {
    const item = findNearbyItem(w, e);
    if (item) {
      pickUp(w, e, item);
      return;
    }
    e.vx = 0;
    e.vz = 0;
    startAction(w, e, 'punch_1');
  } else if (ctx === 'run') startAction(w, e, 'run_attack');
  else startAction(w, e, 'jump_attack');
}

/** 走向暈眩中的敵人時自動抓住 */
function tryGrab(w: World, e: Entity): void {
  if (e.heldItem) return;
  for (const t of w.entities) {
    if (t.kind !== 'char' || t === e || t.team === e.team || t.state !== 'dizzy' || t.grabbedBy) continue;
    const dist = (t.x - e.x) * e.facing;
    if (dist > 0 && dist < C.grabRange && Math.abs(t.z - e.z) < P.hitZTolerance && t.y <= 0) {
      setState(e, 'grabbing');
      e.grabTarget = t.id;
      e.vx = 0;
      e.vz = 0;
      setState(t, 'grabbed');
      t.grabbedBy = e.id;
      t.vx = 0;
      t.vz = 0;
      return;
    }
  }
}

function updateGrabbing(w: World, e: Entity, pressed: Snapshot, dx: number): void {
  const t = w.get(e.grabTarget);
  if (!t || t.state !== 'grabbed' || t.grabbedBy !== e.id) {
    e.grabTarget = 0;
    setState(e, 'idle');
    return;
  }
  e.vx = 0;
  e.vz = 0;
  t.x = e.x + e.facing * 22;
  t.z = e.z;
  t.y = 0;
  t.facing = e.facing === 1 ? -1 : 1;

  if (e.stateTime > C.grabMaxTicks) {
    releaseGrab(e, t);
    return;
  }
  if (!pressed.A || w.tick - e.grabPunchTick < C.grabPunchCooldown) return;

  const killer = e;
  if (dx) {
    // 方向 + 攻擊：摔出
    e.facing = dx > 0 ? 1 : -1;
    e.grabTarget = 0;
    t.grabbedBy = 0;
    t.hp = Math.max(0, t.hp - C.grabThrowDamage);
    killer.stats.damage += C.grabThrowDamage;
    setState(t, 'falling');
    t.vx = e.facing * C.grabThrowVx;
    t.vy = C.grabThrowVy;
    t.x = e.x + e.facing * 10;
    t.flash = C.flashTicks;
    afterDamage(w, t, killer);
    startAction(w, e, 'grab_throw');
    w.emit({ type: 'hit', x: t.x, y: 40, z: t.z, heavy: true, blocked: false });
    w.emit({ type: 'sound', key: 'hit_heavy' });
  } else {
    e.grabPunchTick = w.tick;
    t.hp = Math.max(0, t.hp - C.grabPunchDamage);
    killer.stats.damage += C.grabPunchDamage;
    t.flash = C.flashTicks;
    e.freeze = t.freeze = C.hitstopLight;
    w.emit({ type: 'hit', x: t.x, y: 40, z: t.z, heavy: false, blocked: false });
    w.emit({ type: 'sound', key: 'hit_light' });
    if (t.hp <= 0) {
      e.grabTarget = 0;
      t.grabbedBy = 0;
      setState(e, 'idle');
      setState(t, 'falling');
      t.vx = e.facing * C.knockVx;
      t.vy = C.knockVy;
      afterDamage(w, t, killer);
    }
  }
}

export function releaseGrab(a: Entity, b: Entity): void {
  // a 抓住 b
  a.grabTarget = 0;
  b.grabbedBy = 0;
  if (a.state === 'grabbing') setState(a, 'idle');
  if (b.state === 'grabbed') {
    setState(b, 'dizzy');
    b.stateTime = C.dizzyTicks - 30;
  }
}

/** HP 歸零時記錄擊倒數（每條命只記一次） */
export function afterDamage(w: World, t: Entity, attacker: Entity | undefined): void {
  if (t.hp > 0 || t.koDone) return;
  t.koDone = true;
  t.stats.downs++;
  if (attacker && attacker !== t) attacker.stats.kos++;
  w.emit({ type: 'ko', id: t.id });
  w.emit({ type: 'sound', key: 'ko' });
}

export function physics(w: World, e: Entity, moving: boolean): void {
  const frame = e.state === 'attack' ? w.currentFrame(e) : undefined;
  const airborne = !isGrounded(e);
  if (airborne) {
    const hover = hasBuff(e, 'hover') && (e.state === 'jump' || e.state === 'attack');
    if (frame?.hover) {
      // 由 selfVel 決定速度，不受重力
    } else if (hover) e.vy *= P.hoverDamping;
    else e.vy -= P.gravity;
    e.y += e.vy;
    if (e.y <= 0) {
      e.y = 0;
      e.vy = 0;
      onLand(w, e);
    }
  } else if (!moving && e.state !== 'grabbed') {
    const fr = frame?.friction ?? P.friction;
    e.vx *= fr;
    e.vz *= P.friction;
    if (Math.abs(e.vx) < 0.05) e.vx = 0;
    if (Math.abs(e.vz) < 0.05) e.vz = 0;
  }
  if (e.state === 'grabbed') return;
  e.x += e.vx;
  e.z += e.vz;
  w.clampToStage(e);
}

function onLand(w: World, e: Entity): void {
  switch (e.state) {
    case 'jump':
      setState(e, 'idle');
      e.vx *= 0.3;
      e.vz = 0;
      break;
    case 'attack':
      if (!w.currentFrame(e)?.hover) {
        setState(e, 'idle');
        e.vx *= 0.3;
      }
      break;
    case 'falling':
      setState(e, 'lying');
      e.vx *= 0.4;
      e.vz = 0;
      e.fall = 0;
      w.emit({ type: 'sound', key: 'hit_light' });
      break;
    default:
      break;
  }
}
