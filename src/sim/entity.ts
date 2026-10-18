// 角色 / 道具 / 飛行物共用的實體結構。全部為純資料，可序列化以計算世界雜湊。
import type { Difficulty } from '../config';
import { emptySnapshot, type Snapshot } from './snapshot';

export type EntityKind = 'char' | 'item' | 'proj';

export type CharState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'attack'
  | 'defend'
  | 'broken'
  | 'hurt'
  | 'dizzy'
  | 'grabbing'
  | 'grabbed'
  | 'falling'
  | 'lying'
  | 'rolling'
  | 'dead';

export type BuffType = 'dmgReduce' | 'blockProjectile' | 'hover';

export interface Buff {
  type: BuffType;
  value: number;
  time: number;
}

export interface CmdEvent {
  k: string;
  t: number;
}

export type AIIntent = 'approach' | 'ranged' | 'pickup' | 'evade' | 'defend' | 'wander' | 'special';

export interface AIState {
  difficulty: Difficulty;
  nextDecision: number;
  intent: AIIntent;
  targetId: number;
  plan: Snapshot[];
  wanderDx: number;
  wanderDz: number;
}

export interface MatchStats {
  damage: number;
  kos: number;
  downs: number;
}

export type ItemState = 'ground' | 'held' | 'flying';

export interface Entity {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  facing: 1 | -1;
  team: number;
  ownerId: number;
  freeze: number;
  flash: number;
  removed: boolean;

  /** 目前播放的幀（角色攻擊狀態 / 飛行物） */
  frame: string | null;
  frameTime: number;
  /** 每次開始新動作遞增，用於「同一動作對同一目標只命中一次」 */
  chain: number;
  hitSet: Record<string, number>;

  // ---- 角色 ----
  charId: string;
  /** 玩家欄位 0–3；闖關敵人為 -1 */
  slot: number;
  state: CharState;
  stateTime: number;
  hp: number;
  maxHp: number;
  mp: number;
  fall: number;
  guard: number;
  invuln: number;
  prevInput: Snapshot;
  lastTapDir: number;
  lastTapTick: number;
  comboQueued: boolean;
  airAttackUsed: boolean;
  heldItem: number;
  grabTarget: number;
  grabbedBy: number;
  grabPunchTick: number;
  buffs: Buff[];
  cmdBuf: CmdEvent[];
  stats: MatchStats;
  boss: boolean;
  koDone: boolean;
  ai: AIState | null;

  // ---- 道具 ----
  itemId: string;
  itemState: ItemState;
  uses: number;
  bounces: number;

  // ---- 飛行物 ----
  projId: string;
  life: number;
  hits: number;
  homingTarget: number;
  speed: number;
}

export function createEntity(id: number, kind: EntityKind): Entity {
  return {
    id,
    kind,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    facing: 1,
    team: 0,
    ownerId: 0,
    freeze: 0,
    flash: 0,
    removed: false,
    frame: null,
    frameTime: 0,
    chain: 0,
    hitSet: {},
    charId: '',
    slot: -1,
    state: 'idle',
    stateTime: 0,
    hp: 0,
    maxHp: 0,
    mp: 0,
    fall: 0,
    guard: 0,
    invuln: 0,
    prevInput: emptySnapshot(),
    lastTapDir: 0,
    lastTapTick: -999,
    comboQueued: false,
    airAttackUsed: false,
    heldItem: 0,
    grabTarget: 0,
    grabbedBy: 0,
    grabPunchTick: -999,
    buffs: [],
    cmdBuf: [],
    stats: { damage: 0, kos: 0, downs: 0 },
    boss: false,
    koDone: false,
    ai: null,
    itemId: '',
    itemState: 'ground',
    uses: 0,
    bounces: 0,
    projId: '',
    life: 0,
    hits: 0,
    homingTarget: 0,
    speed: 0,
  };
}

export function hasBuff(e: Entity, type: BuffType): boolean {
  return e.buffs.some((b) => b.type === type);
}

export function buffValue(e: Entity, type: BuffType): number {
  let v = 0;
  for (const b of e.buffs) if (b.type === type) v = Math.max(v, b.value);
  return v;
}

export function isAlive(e: Entity): boolean {
  return e.kind === 'char' && e.hp > 0 && e.state !== 'dead';
}
