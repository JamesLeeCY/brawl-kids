// 飛行物：本身也是帶 frames 的實體。
import { CONFIG } from '../config';
import type { SpawnDef } from '../data/schema';
import { isAlive, type Entity } from './entity';
import type { World } from './world';

export function spawnFromFrame(w: World, owner: Entity, spawns: readonly SpawnDef[]): void {
  for (const s of spawns) {
    const key = `${owner.charId}.${s.id}`;
    if (s.at === 'random') {
      const enemies = w.chars().filter((c) => c.team !== owner.team && isAlive(c));
      for (let i = 0; i < s.count; i++) {
        let x: number;
        let z: number;
        if (enemies.length && i < s.count - 2) {
          const t = enemies[i % enemies.length];
          x = t.x + w.rng.range(-25, 25);
          z = t.z + w.rng.range(-8, 8);
        } else {
          x = owner.x + w.rng.range(-350, 350);
          z = w.rng.range(CONFIG.physics.zMin, CONFIG.physics.zMax);
        }
        spawnProjectile(w, owner, key, x, s.y, z, s.vx * owner.facing, s.vy, s.vz);
      }
    } else {
      for (let i = 0; i < s.count; i++)
        spawnProjectile(w, owner, key, owner.x + owner.facing * s.x, owner.y + s.y, owner.z + s.dz, s.vx * owner.facing, s.vy, s.vz);
    }
  }
}

export function spawnProjectile(
  w: World,
  owner: Entity,
  key: string,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
): Entity | null {
  const def = w.data.projectiles[key];
  if (!def) return null;
  const p = w.newEntity('proj');
  p.projId = key;
  p.charId = owner.charId;
  p.ownerId = owner.kind === 'char' ? owner.id : owner.ownerId;
  p.team = owner.team;
  p.facing = vx < 0 ? -1 : vx > 0 ? 1 : owner.facing;
  p.x = Math.max(0, Math.min(w.stage.width, x));
  p.y = Math.max(0, y);
  p.z = Math.max(CONFIG.physics.zMin, Math.min(CONFIG.physics.zMax, z));
  p.vx = vx;
  p.vy = vy;
  p.vz = vz;
  p.speed = Math.sqrt(vx * vx + vz * vz);
  p.life = def.life;
  p.chain = 1;
  p.frame = def.startFrame;
  p.frameTime = 0;
  const f = def.frames[def.startFrame];
  if (f?.sound) w.emit({ type: 'sound', key: f.sound });
  if (f?.shake) w.emit({ type: 'shake', amp: CONFIG.fx.shakeAmp, ticks: CONFIG.fx.shakeTicks });
  if (def.homing > 0) {
    let best: Entity | null = null;
    let bd = Infinity;
    for (const c of w.chars()) {
      if (c.team === p.team || !isAlive(c)) continue;
      const d = Math.abs(c.x - p.x) + Math.abs(c.z - p.z) * 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    p.homingTarget = best?.id ?? 0;
  }
  w.addEntity(p);
  return p;
}

export function updateProjectile(w: World, p: Entity): void {
  if (p.freeze > 0) {
    p.freeze--;
    return;
  }
  const def = w.data.projectiles[p.projId];
  if (!def) {
    p.removed = true;
    return;
  }
  const f = p.frame ? def.frames[p.frame] : undefined;
  if (f) {
    p.frameTime++;
    if (p.frameTime >= f.duration) {
      if (f.next === 'expire' || !def.frames[f.next]) {
        expireProjectile(w, p);
        return;
      }
      if (f.next !== p.frame) {
        p.frame = f.next;
        const nf = def.frames[f.next];
        if (nf.sound) w.emit({ type: 'sound', key: nf.sound });
        if (nf.shake) w.emit({ type: 'shake', amp: CONFIG.fx.shakeAmp, ticks: CONFIG.fx.shakeTicks });
      }
      p.frameTime = 0;
    }
  }

  if (def.homing > 0) {
    const t = w.get(p.homingTarget);
    if (t && isAlive(t)) {
      p.vz = Math.max(-p.speed * 0.6, Math.min(p.speed * 0.6, p.vz + Math.sign(t.z - p.z) * def.homing));
      p.vx = Math.max(-p.speed, Math.min(p.speed, p.vx + Math.sign(t.x - p.x) * def.homing));
      p.y += Math.sign(t.y + 36 - p.y) * 0.5;
      if (p.vx) p.facing = p.vx > 0 ? 1 : -1;
    }
  }

  if (def.pull > 0) {
    for (const c of w.chars()) {
      if (c.team === p.team || !isAlive(c) || c.invuln > 0 || c.state === 'lying' || c.state === 'grabbed') continue;
      const ddx = p.x - c.x;
      const ddz = p.z - c.z;
      if (Math.sqrt(ddx * ddx + 4 * ddz * ddz) > def.pullRadius) continue;
      if (Math.abs(ddx) > 2) c.x += Math.sign(ddx) * def.pull;
      if (Math.abs(ddz) > 1) c.z += Math.sign(ddz) * def.pull * 0.6;
      w.clampToStage(c);
    }
  }

  p.vy -= def.gravity;
  p.x += p.vx;
  p.y += p.vy;
  p.z = Math.max(CONFIG.physics.zMin, Math.min(CONFIG.physics.zMax, p.z + p.vz));
  if (p.y < 0) {
    p.y = 0;
    p.vy = 0;
  }
  if (p.x < -50 || p.x > w.stage.width + 50) {
    p.removed = true;
    return;
  }
  if (--p.life <= 0) expireProjectile(w, p);
}

function spawnChild(w: World, p: Entity, childId: string): void {
  const owner = w.get(p.ownerId);
  if (!owner) return;
  spawnProjectile(w, owner, `${p.charId}.${childId}`, p.x, p.y, p.z, 0, 0, 0);
}

export function expireProjectile(w: World, p: Entity): void {
  if (p.removed) return;
  p.removed = true;
  const def = w.data.projectiles[p.projId];
  if (def?.onExpire) spawnChild(w, p, def.onExpire);
}

export function onProjectileHit(w: World, p: Entity): void {
  const def = w.data.projectiles[p.projId];
  if (!def) return;
  p.hits++;
  if (p.hits >= def.hitLimit) {
    p.removed = true;
    if (def.onHit) spawnChild(w, p, def.onHit);
  }
}
