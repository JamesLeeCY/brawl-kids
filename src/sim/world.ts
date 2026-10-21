// 世界狀態與 tick()。純邏輯：不得引用 window / document / Canvas。
import { CONFIG, type Difficulty } from '../config';
import type { CharacterDef, GameData } from '../data/load';
import type { FrameDef, SoundKey, StageDef } from '../data/schema';
import { aiThink } from './ai';
import { resolveCombat } from './combat';
import { createEntity, isAlive, type Entity } from './entity';
import { updateChar } from './fsm';
import { spawnItem, updateItem } from './items';
import { updateProjectile } from './projectiles';
import { Rng } from './rng';
import { emptySnapshot, type Snapshot } from './snapshot';

export type GameMode = 'versus' | 'campaign';

export interface PlayerSetup {
  slot: number;
  charId: string;
  /** 0 = 獨立（自成一隊），1–4 = 隊伍 */
  team: number;
  controller: 'human' | 'ai';
  difficulty: Difficulty;
}

export interface CarryOver {
  slot: number;
  hp: number;
  mp: number;
  damage: number;
  kos: number;
  downs: number;
}

export interface MatchSetup {
  mode: GameMode;
  stageId: string;
  seed: number;
  players: PlayerSetup[];
  /** 闖關模式第幾關（0 起算） */
  campaignIndex?: number;
  /** 闖關難度（預設普通） */
  campaignDifficulty?: Difficulty;
  /** 遊戲速度倍率（只影響實際時間流速；連線時由房主決定、所有人一致） */
  speed?: number;
  /** 練習模式（只由畫面層處理：無限 MP、不會倒下、沙包自動回血；模擬本身照對戰規則跑） */
  practice?: boolean;
  /** 闖關總關數（1～campaign 模板數；沒有就是 4 關） */
  campaignLength?: number;
  /** 闖關各關的場景（沒有就用 campaign 資料裡的預設路線） */
  campaignStages?: string[];
  /** 闖關路線的選法（重新開始時，隨機路線會重抽） */
  campaignRoute?: CampaignRoute;
  carry?: CarryOver[];
}

export type CampaignRoute = 'fixed' | 'random' | 'custom';

/** 沒指定關數時的預設（與早期版本相同的 4 關） */
export const DEFAULT_CAMPAIGN_LENGTH = 4;

type CampaignData = { campaign: readonly { stage: string }[] };

/** 這次闖關共幾關 */
export function campaignLength(data: CampaignData, setup: Pick<MatchSetup, 'campaignLength'>): number {
  const total = data.campaign.length;
  return Math.max(1, Math.min(total, setup.campaignLength ?? Math.min(DEFAULT_CAMPAIGN_LENGTH, total)));
}

/**
 * 第 idx 關用哪一個難度模板：關數較少時平均取樣（例如 4 關 = 模板 1、4、7、10），
 * 最後一關一定是最後的模板（有頭目）。
 */
export function campaignTemplateIndex(total: number, length: number, idx: number): number {
  if (length <= 1) return total - 1;
  return Math.round((idx * (total - 1)) / (length - 1));
}

export function campaignTemplate(data: CampaignData, setup: MatchSetup, idx: number): number {
  return campaignTemplateIndex(data.campaign.length, campaignLength(data, setup), idx);
}

/** 闖關第 idx 關的場景：玩家選的路線優先，否則用該關模板的預設場景 */
export function campaignStageId(data: CampaignData, setup: MatchSetup, idx: number): string {
  return setup.campaignStages?.[idx] ?? data.campaign[campaignTemplate(data, setup, idx)].stage;
}

/** 過關時回復的 HP：長途闖關回復較多 */
export function campaignHealAmount(data: CampaignData, setup: Pick<MatchSetup, 'campaignLength'>): number {
  const M = CONFIG.match;
  return campaignLength(data, setup) > DEFAULT_CAMPAIGN_LENGTH ? M.campaignHealLongRun : M.campaignHealBetweenStages;
}

/** 某個關數的預設路線 */
export function defaultCampaignRoute(data: CampaignData, length: number): string[] {
  return Array.from({ length }, (_, i) => data.campaign[campaignTemplateIndex(data.campaign.length, length, i)].stage);
}

export type GameEvent =
  | { type: 'sound'; key: SoundKey }
  | { type: 'hit'; x: number; y: number; z: number; heavy: boolean; blocked: boolean }
  | { type: 'shake'; amp: number; ticks: number }
  | { type: 'ko'; id: number }
  | { type: 'break'; x: number; y: number; z: number; color: string }
  | { type: 'pickup'; x: number; y: number; z: number }
  | { type: 'wave'; index: number; total: number }
  /** 頭上冒出的文字（status：狀態提示，用紅色泡泡） */
  | { type: 'say'; id: number; text: string; status?: boolean };

export type Outcome = 'win' | 'lose' | 'stageClear';

export interface MatchResult {
  outcome: Outcome;
  /** 對戰模式勝隊；無人存活為 null */
  winnerTeam: number | null;
}

export const ENEMY_TEAM = 99;
export const CAMPAIGN_PLAYER_TEAM = 1;

export class World {
  tick = 0;
  entities: Entity[] = [];
  nextId = 1;
  rng: Rng;
  events: GameEvent[] = [];
  stage: StageDef;
  result: MatchResult | null = null;
  endTimer = -1;
  itemTimer: number;
  waveIndex = -1;
  waveTimer: number = CONFIG.match.firstWaveDelayTicks;
  waves: CampaignWaves | null = null;

  constructor(
    public data: GameData,
    public setup: MatchSetup,
  ) {
    this.rng = new Rng(setup.seed);
    const stage = data.stages[setup.stageId] ?? data.stages[data.stageOrder[0]];
    this.stage = stage;
    this.itemTimer = this.rng.int(CONFIG.items.spawnMinTicks, CONFIG.items.spawnMaxTicks);

    if (setup.mode === 'campaign') {
      const c = data.campaign[campaignTemplate(data, setup, setup.campaignIndex ?? 0)];
      this.waves = { waves: c.waves };
    }

    const n = setup.players.length;
    setup.players.forEach((p, i) => {
      const x = setup.mode === 'campaign' ? 120 + i * 50 : (stage.width / (n + 1)) * (i + 1);
      const z = 30 + ((i * 37) % 70);
      const team = setup.mode === 'campaign' ? CAMPAIGN_PLAYER_TEAM : p.team > 0 ? p.team : 100 + p.slot;
      const e = this.spawnChar(p.charId, x, z, team, p.slot);
      if (setup.mode === 'versus') e.facing = x < stage.width / 2 ? 1 : -1;
      if (p.controller === 'ai') e.ai = newAI(p.difficulty);
      const carry = setup.carry?.find((c) => c.slot === p.slot);
      if (carry) {
        e.hp = carry.hp;
        e.mp = carry.mp;
        e.stats = { damage: carry.damage, kos: carry.kos, downs: carry.downs };
      }
    });
  }

  // ---------- 查詢 ----------
  get(id: number): Entity | undefined {
    if (!id) return undefined;
    for (const e of this.entities) if (e.id === id && !e.removed) return e;
    return undefined;
  }

  charDef(e: Entity): CharacterDef {
    return this.data.characters[e.charId];
  }

  currentFrame(e: Entity): FrameDef | undefined {
    if (!e.frame) return undefined;
    if (e.kind === 'proj') return this.data.projectiles[e.projId]?.frames[e.frame];
    return this.data.characters[e.charId]?.frames[e.frame];
  }

  chars(): Entity[] {
    return this.entities.filter((e) => e.kind === 'char' && !e.removed);
  }

  emit(ev: GameEvent): void {
    this.events.push(ev);
  }

  // ---------- 產生實體 ----------
  spawnChar(charId: string, x: number, z: number, team: number, slot: number): Entity {
    const def = this.data.characters[charId];
    const e = createEntity(this.nextId++, 'char');
    e.charId = charId;
    e.x = x;
    e.z = z;
    e.team = team;
    e.slot = slot;
    e.hp = e.maxHp = def.stats.hp;
    e.mp = CONFIG.combat.mpMax;
    e.guard = CONFIG.combat.guardMax;
    this.entities.push(e);
    return e;
  }

  addEntity(e: Entity): void {
    this.entities.push(e);
  }

  newEntity(kind: Entity['kind']): Entity {
    return createEntity(this.nextId++, kind);
  }

  // ---------- 主迴圈 ----------
  /** inputs[slot] 為人類玩家的按鍵快照；AI 角色忽略此參數，自行產生快照 */
  step(inputs: readonly (Snapshot | undefined)[]): void {
    this.events = [];
    this.tick++;
    const list = this.entities.slice();
    for (const e of list) {
      if (e.removed) continue;
      if (e.kind === 'char') {
        const snap = e.ai ? aiThink(this, e) : (e.slot >= 0 ? inputs[e.slot] : undefined) ?? emptySnapshot();
        updateChar(this, e, snap);
      } else if (e.kind === 'proj') updateProjectile(this, e);
      else updateItem(this, e);
    }
    resolveCombat(this);
    this.updateStageFeatures();
    this.updateItemSpawns();
    if (this.waves) this.updateCampaign();
    this.checkResult();
    this.entities = this.entities.filter((e) => !e.removed);
  }

  // ---------- 場景特色 ----------
  bridgeRotating(): boolean {
    const b = this.stage.features.bridge;
    if (!b) return false;
    return this.tick % b.interval >= b.interval - b.duration;
  }

  trainProgress(): number {
    const t = this.stage.features.train;
    if (!t) return -1;
    const p = this.tick % t.interval;
    return p < t.duration ? p / t.duration : -1;
  }

  private updateStageFeatures(): void {
    const f = this.stage.features;
    if (f.foodSpawn && this.tick % f.foodSpawn.interval === 0) {
      const count = this.entities.filter((e) => e.kind === 'item' && e.itemId === f.foodSpawn!.item && !e.removed).length;
      if (count < f.foodSpawn.max) spawnItem(this, f.foodSpawn.item, this.rng.pick(f.foodSpawn.x), this.rng.range(15, 50), 40);
    }
    if (f.train && this.tick % f.train.interval === 1) this.emit({ type: 'shake', amp: f.train.shake, ticks: f.train.duration });
  }

  /** 旋轉中的人行橋區段不可站立：把人推到最近的橋頭 */
  clampToStage(e: Entity): void {
    const P = CONFIG.physics;
    e.x = Math.max(P.stageMargin, Math.min(this.stage.width - P.stageMargin, e.x));
    e.z = Math.max(P.zMin, Math.min(P.zMax, e.z));
    const b = this.stage.features.bridge;
    if (b && e.kind === 'char' && this.bridgeRotating() && e.x > b.x0 && e.x < b.x1 && e.y <= 0) {
      e.x = e.x - b.x0 < b.x1 - e.x ? b.x0 : b.x1;
    }
  }

  private updateItemSpawns(): void {
    if (--this.itemTimer > 0) return;
    this.itemTimer = this.rng.int(CONFIG.items.spawnMinTicks, CONFIG.items.spawnMaxTicks);
    const pool = this.data.itemOrder.filter((id) => this.data.items[id].weight > 0);
    if (!pool.length) return;
    let total = 0;
    for (const id of pool) total += this.data.items[id].weight;
    let r = this.rng.range(0, total);
    let chosen = pool[0];
    for (const id of pool) {
      r -= this.data.items[id].weight;
      if (r <= 0) {
        chosen = id;
        break;
      }
    }
    const alive = this.chars().filter((c) => isAlive(c));
    const cx = alive.length ? alive.reduce((s, c) => s + c.x, 0) / alive.length : this.stage.width / 2;
    spawnItem(this, chosen, cx + this.rng.range(-250, 250), this.rng.range(10, 110), CONFIG.items.spawnHeight);
  }

  // ---------- 闖關 ----------
  private updateCampaign(): void {
    const w = this.waves!;
    if (this.result || this.endTimer >= 0) return;
    const enemiesAlive = this.chars().some((c) => c.team === ENEMY_TEAM && isAlive(c));
    if (enemiesAlive) return;
    if (this.waveIndex + 1 >= w.waves.length) return; // 由 checkResult 判定過關
    if (--this.waveTimer > 0) return;
    this.waveIndex++;
    this.waveTimer = CONFIG.match.waveDelayTicks;
    this.spawnWave(this.waveIndex);
    this.emit({ type: 'wave', index: this.waveIndex, total: w.waves.length });
  }

  private spawnWave(index: number): void {
    const wave = this.waves!.waves[index];
    const cd = this.data.campaignDifficulty[this.setup.campaignDifficulty ?? 'normal'];
    const LEVELS: Difficulty[] = ['easy', 'normal', 'hard'];
    const shift = (d: Difficulty) => LEVELS[Math.max(0, Math.min(2, LEVELS.indexOf(d) + cd.aiShift))];
    let k = 0;
    const players = this.chars().filter((c) => c.team === CAMPAIGN_PLAYER_TEAM);
    const px = players.length ? players.reduce((s, c) => s + c.x, 0) / players.length : 200;
    for (const en of wave.enemies) {
      const count = en.boss ? en.count : en.count + cd.extraEnemies;
      for (let i = 0; i < count; i++, k++) {
        let charId = en.char;
        if (charId === 'random_main') charId = this.rng.pick(this.data.selectable);
        const side = k % 2 === 0 ? 1 : -1;
        let x = px + side * (420 + i * 30);
        if (x > this.stage.width - 30 || x < 30) x = px - side * (420 + i * 30);
        const e = this.spawnChar(charId, x, this.rng.range(10, 110), ENEMY_TEAM, -1);
        this.clampToStage(e);
        e.facing = e.x > px ? -1 : 1;
        e.ai = newAI(shift(en.difficulty));
        if (en.boss) {
          e.boss = true;
          e.hp = e.maxHp = Math.round(e.maxHp * cd.bossHpMul);
        } else e.hp = e.maxHp = Math.round(e.maxHp * cd.enemyHpMul);
      }
    }
  }

  // ---------- 勝負 ----------
  private checkResult(): void {
    if (this.result) return;
    if (this.endTimer >= 0) {
      if (--this.endTimer <= 0) this.result = this.pendingResult;
      return;
    }
    const chars = this.chars();
    let res: MatchResult | null = null;
    if (this.setup.mode === 'versus') {
      const teams = new Set(chars.filter(isAlive).map((c) => c.team));
      if (teams.size <= 1) res = { outcome: 'win', winnerTeam: teams.size ? [...teams][0] : null };
    } else {
      const playersAlive = chars.some((c) => c.team === CAMPAIGN_PLAYER_TEAM && isAlive(c));
      const enemiesAlive = chars.some((c) => c.team === ENEMY_TEAM && isAlive(c));
      const lastStage = (this.setup.campaignIndex ?? 0) >= campaignLength(this.data, this.setup) - 1;
      if (!playersAlive) res = { outcome: 'lose', winnerTeam: ENEMY_TEAM };
      else if (!enemiesAlive && this.waveIndex >= this.waves!.waves.length - 1)
        res = { outcome: lastStage ? 'win' : 'stageClear', winnerTeam: CAMPAIGN_PLAYER_TEAM };
    }
    if (res) {
      this.pendingResult = res;
      this.endTimer = CONFIG.match.endDelayTicks;
    }
  }

  private pendingResult: MatchResult | null = null;

  // ---------- 決定論驗證 ----------
  hash(): string {
    const s = JSON.stringify({ t: this.tick, r: this.rng.state, e: this.entities, i: this.itemTimer, w: this.waveIndex });
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}

interface CampaignWaves {
  waves: GameData['campaign'][number]['waves'];
}

function newAI(difficulty: Difficulty) {
  return { difficulty, nextDecision: 0, intent: 'approach' as const, targetId: 0, plan: [], wanderDx: 0, wanderDz: 0 };
}
