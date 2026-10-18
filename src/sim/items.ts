// 道具：掉落、撿拾、揮擊、投擲。
import { CONFIG } from '../config';
import type { ItemDef } from '../data/schema';
import type { Entity } from './entity';
import type { World } from './world';

const P = CONFIG.physics;
const I = CONFIG.items;

export function spawnItem(w: World, itemId: string, x: number, z: number, y: number): Entity | null {
  const def = w.data.items[itemId];
  if (!def) return null;
  const it = w.newEntity('item');
  it.itemId = itemId;
  it.x = x;
  it.z = z;
  it.y = y;
  it.itemState = 'ground';
  it.uses = def.uses ?? 0;
  w.clampToStage(it);
  w.addEntity(it);
  return it;
}

export function heldItemDef(w: World, e: Entity): ItemDef | undefined {
  if (!e.heldItem) return undefined;
  const it = w.get(e.heldItem);
  if (!it) {
    e.heldItem = 0;
    return undefined;
  }
  return w.data.items[it.itemId];
}

export function findNearbyItem(w: World, e: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bd = Infinity;
  for (const it of w.entities) {
    if (it.kind !== 'item' || it.removed || it.itemState !== 'ground' || it.y > 4) continue;
    const dx = Math.abs(it.x - e.x);
    if (dx > CONFIG.combat.pickupRange || Math.abs(it.z - e.z) > P.hitZTolerance) continue;
    if (dx < bd) {
      bd = dx;
      best = it;
    }
  }
  return best;
}

export function pickUp(w: World, e: Entity, it: Entity): void {
  const def = w.data.items[it.itemId];
  w.emit({ type: 'pickup', x: it.x, y: it.y, z: it.z });
  if (def.kind === 'consumable') {
    if (def.heal) {
      e.hp = Math.min(e.maxHp, e.hp + def.heal.hp);
      e.mp = Math.min(CONFIG.combat.mpMax, e.mp + def.heal.mp);
    }
    it.removed = true;
    w.emit({ type: 'sound', key: 'jump' });
    return;
  }
  it.itemState = 'held';
  it.ownerId = e.id;
  it.team = e.team;
  e.heldItem = it.id;
}

export function throwHeldItem(w: World, e: Entity): void {
  const it = w.get(e.heldItem);
  e.heldItem = 0;
  if (!it) return;
  const def = w.data.items[it.itemId];
  const heavy = def.kind === 'heavy';
  it.itemState = 'flying';
  it.ownerId = e.id;
  it.team = e.team;
  it.chain++;
  it.hitSet = {};
  it.bounces = 0;
  it.facing = e.facing;
  it.x = e.x + e.facing * 16;
  it.y = e.y + (heavy ? 56 : 40);
  it.z = e.z;
  it.vx = e.facing * (heavy ? I.heavyThrowVx : I.throwVx) + e.vx * 0.4;
  it.vy = heavy ? I.heavyThrowVy : I.throwVy;
  it.vz = 0;
}

export function dropHeldItem(w: World, e: Entity): void {
  const it = w.get(e.heldItem);
  e.heldItem = 0;
  if (!it) return;
  it.itemState = 'ground';
  it.team = 0;
  it.x = e.x;
  it.y = e.y + 30;
  it.z = e.z;
  it.vx = -e.facing * 1.5;
  it.vy = 2;
}

export function onItemHit(w: World, it: Entity): void {
  const def = w.data.items[it.itemId];
  if (def.breakOnLand) {
    breakItem(w, it);
    return;
  }
  it.vx = -it.vx * 0.3;
  it.vy = 3;
  it.itemState = 'ground';
  it.team = 0;
}

function breakItem(w: World, it: Entity): void {
  it.removed = true;
  w.emit({ type: 'break', x: it.x, y: it.y, z: it.z, color: w.data.items[it.itemId].color });
  w.emit({ type: 'sound', key: 'hit_heavy' });
}

export function updateItem(w: World, it: Entity): void {
  if (it.freeze > 0) {
    it.freeze--;
    return;
  }
  if (it.itemState === 'held') {
    const h = w.get(it.ownerId);
    if (!h || h.heldItem !== it.id) {
      it.itemState = 'ground';
      it.team = 0;
    } else {
      it.x = h.x;
      it.y = h.y + 40;
      it.z = h.z;
      it.facing = h.facing;
      return;
    }
  }
  const def = w.data.items[it.itemId];
  if (it.y > 0 || it.vy > 0) {
    it.vy -= P.gravity;
    it.y += it.vy;
    if (it.y <= 0) {
      it.y = 0;
      if (it.itemState === 'flying') {
        if (def.breakOnLand) {
          breakItem(w, it);
          return;
        }
        if (it.bounces < def.bounces) {
          it.bounces++;
          it.vy = I.bounceVy;
          it.vx *= 0.6;
        } else {
          it.itemState = 'ground';
          it.team = 0;
          it.vy = 0;
        }
      } else it.vy = 0;
    }
  } else {
    it.vx *= P.friction;
    if (Math.abs(it.vx) < 0.05) it.vx = 0;
  }
  it.x += it.vx;
  it.z += it.vz;
  if (it.itemState === 'flying' && (it.x <= P.stageMargin || it.x >= w.stage.width - P.stageMargin)) {
    it.vx = 0;
    it.itemState = 'ground';
    it.team = 0;
  }
  w.clampToStage(it);
}
