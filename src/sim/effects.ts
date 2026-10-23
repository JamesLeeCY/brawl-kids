// 增益與狀態效果：給自己 / 隊友的增益、打在對手身上的狀態（顛倒、定身、封技、策反……）、實體牆。
import { CONFIG } from '../config';
import type { BuffDef } from '../data/schema';
import { effTeam, getBuff, isAlive, type Entity } from './entity';
import type { World } from './world';

const C = CONFIG.combat;

/** 加上增益 / 狀態（同類型只留一個；可疊層的再中一次 +1 層） */
export function addBuff(e: Entity, b: BuffDef, src = 0, value = b.value): void {
  const old = getBuff(e, b.type);
  let n = b.count ?? 1;
  if (old && b.stack) n = Math.min(b.stack, old.n + 1);
  e.buffs = e.buffs.filter((x) => x.type !== b.type);
  e.buffs.push({ type: b.type, value, time: b.duration, src, n });
}

export function removeBuff(e: Entity, type: Entity['buffs'][number]['type']): void {
  e.buffs = e.buffs.filter((x) => x.type !== type);
}

/** 同一隊（戰鬥陣營）的其他活著的角色 */
export function alliesOf(w: World, e: Entity): Entity[] {
  const team = effTeam(e);
  return w.chars().filter((c) => c !== e && isAlive(c) && effTeam(c) === team);
}

/** 依 to 決定增益給誰 */
export function buffTargets(w: World, e: Entity, b: BuffDef): Entity[] {
  if (b.to === 'self') return [e];
  const allies = alliesOf(w, e);
  if (b.to === 'team') return [e, ...allies];
  return allies.length ? allies : [e];
}

/** 最近的敵人（可限制距離；z 方向距離算兩倍） */
export function nearestEnemy(w: World, e: Entity, radius = Infinity): Entity | undefined {
  let best: Entity | undefined;
  let bd = radius;
  const team = effTeam(e);
  for (const c of w.chars()) {
    if (effTeam(c) === team || !isAlive(c)) continue;
    const d = Math.hypot(c.x - e.x, (c.z - e.z) * 2);
    if (d <= bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/**
 * 把狀態打到目標身上。策反（charm）在目標沒有隊友時改成方向顛倒 1 秒；
 * 定身時取消目標正在做的動作。
 */
export function inflict(w: World, t: Entity, b: BuffDef, src: Entity | undefined): void {
  if (!isAlive(t)) return;
  if (b.type === 'charm') {
    const hasMates = w.chars().some((c) => c !== t && isAlive(c) && c.team === t.team);
    if (!hasMates || !src) {
      addBuff(t, { type: 'reverse', value: 1, duration: 60, to: 'self' }, src?.id ?? 0);
      w.emit({ type: 'say', id: t.id, text: '方向顛倒！', status: true });
      return;
    }
    addBuff(t, b, src.id, effTeam(src));
    w.emit({ type: 'say', id: t.id, text: '叛徒！', status: true });
    return;
  }
  addBuff(t, b, src?.id ?? 0);
  if (b.type === 'stun' && ['attack', 'walk', 'run', 'defend'].includes(t.state) && t.y <= 0) {
    t.state = 'idle';
    t.stateTime = 0;
    t.frame = null;
    t.frameTime = 0;
    t.vx = 0;
    t.vz = 0;
  }
  if (b.type === 'atkDown') {
    const n = getBuff(t, 'atkDown')?.n ?? 1;
    w.emit({ type: 'say', id: t.id, text: `-${n} 分`, status: true });
  }
}

/** 每 tick 的狀態計時：持續扣血、掛號爆炸 */
export function tickBuffs(w: World, e: Entity): void {
  let boom: Entity['buffs'][number] | undefined;
  for (const b of e.buffs) {
    b.time--;
    if (b.type === 'dot' && b.time % 30 === 0 && isAlive(e)) {
      // 持續扣血不會直接打死人（留 1 滴血）
      const d = Math.min(b.value, Math.max(0, e.hp - 1));
      e.hp -= d;
      const s = w.get(b.src);
      if (s) s.stats.damage += d;
      e.flash = 2;
    }
    if (b.type === 'bomb' && b.time <= 0) boom = b;
  }
  e.buffs = e.buffs.filter((b) => b.time > 0);
  if (boom && isAlive(e)) explodeBomb(w, e, boom);
}

function explodeBomb(w: World, e: Entity, b: Entity['buffs'][number]): void {
  const src = w.get(b.src);
  const red = e.buffs.find((x) => x.type === 'dmgReduce')?.value ?? 0;
  const dmg = b.value * (1 - red);
  e.hp = Math.max(0, e.hp - dmg);
  if (src) src.stats.damage += dmg;
  e.flash = C.flashTicks;
  if (!['lying', 'dead', 'falling'].includes(e.state)) {
    e.state = 'falling';
    e.stateTime = 0;
    e.frame = null;
    e.vx = 0;
    e.vy = 6;
  }
  w.emit({ type: 'say', id: e.id, text: '叫號！', status: true });
  w.emit({ type: 'hit', x: e.x, y: e.y + 40, z: e.z, heavy: true, blocked: false, by: src?.id });
  w.emit({ type: 'sound', key: 'hit_heavy' });
  w.emit({ type: 'shake', amp: CONFIG.fx.shakeAmp, ticks: CONFIG.fx.shakeTicks });
  if (e.hp <= 0 && !e.koDone) {
    e.koDone = true;
    e.stats.downs++;
    if (src && src !== e) src.stats.kos++;
    w.emit({ type: 'ko', id: e.id, by: src?.id });
    w.emit({ type: 'sound', key: 'ko' });
  }
}

/** 攻擊者自身的傷害倍率（漲停、紅帽、被扣分） */
export function attackMul(a: Entity): number {
  let m = 1;
  for (const b of a.buffs) {
    if (b.type === 'rage') m *= a.hp < a.maxHp / 2 ? 2 : 1.25;
    else if (b.type === 'power') m *= 1 + b.value;
    else if (b.type === 'atkDown') m *= Math.max(0.5, 1 - b.value * b.n);
  }
  return m;
}

// ---------- 實體牆 ----------

function walls(w: World): Entity[] {
  return w.entities.filter((p) => p.kind === 'proj' && !p.removed && w.data.projectiles[p.projId]?.wall);
}

const WALL_DEPTH = 18;

/** 角色移動後：被敵方的牆擋住就推回牆的這一側 */
export function blockCharByWalls(w: World, e: Entity, px: number): void {
  for (const p of walls(w)) {
    const wd = w.data.projectiles[p.projId].wall!;
    if (!wd.blockChars || p.team === effTeam(e)) continue;
    if (Math.abs(p.z - e.z) > WALL_DEPTH || e.y >= p.y + wd.h) continue;
    const x0 = p.x - wd.w / 2 - 9;
    const x1 = p.x + wd.w / 2 + 9;
    if (e.x > x0 && e.x < x1) {
      e.x = px <= p.x ? x0 : x1;
      e.vx = 0;
    }
  }
}

/** 飛行物撞到敵方的牆就消失（從天而降的範圍技不受影響） */
export function projectileHitsWall(w: World, p: Entity): boolean {
  const def = w.data.projectiles[p.projId];
  if (!def?.blockable || def.wall) return false;
  for (const q of walls(w)) {
    if (q.team === p.team) continue;
    const wd = w.data.projectiles[q.projId].wall!;
    if (Math.abs(q.z - p.z) > WALL_DEPTH || p.y > q.y + wd.h || p.y < q.y - 12) continue;
    if (Math.abs(p.x - q.x) < wd.w / 2 + def.size / 2) {
      p.removed = true;
      w.emit({ type: 'hit', x: p.x, y: p.y, z: p.z, heavy: false, blocked: true });
      w.emit({ type: 'sound', key: 'hit_light' });
      return true;
    }
  }
  return false;
}
