// 戰鬥畫面繪製：相機、z 排序、陰影、特效、HUD。
import { CONFIG } from '../config';
import type { CharacterDef } from '../data/load';
import { clonePos } from '../sim/combat';
import { getBuff, hasBuff, type Entity } from '../sim/entity';
import { ENEMY_TEAM, type GameEvent, type World } from '../sim/world';
import { OUTLINE, drawFigure, drawItemShape, roundRect, shade, type Expression, type Joints } from './character';
import { cyclePose, getPose, lerpPose, withCarryArms, type Pose } from './poses';
import { drawStage } from './stage';
import { FONT, text } from './text';

import { VW, viewOffset } from './view';
import { lowQuality } from './quality';
import { REDUCED_MOTION, shakeFactor } from './shake';
import { drawAura, rgba, signatureOf, type AuraStyle, type SoundStyle } from './signature';
import type { SignatureMode } from '../audio/sfx';
import { EXTRA_POSES, drawBuffBack, drawBuffFront, drawExtraProjectile, drawPropBack, drawPropFront, drawRedCap } from './status';
const HZ = CONFIG.view.horizon;
const FX = CONFIG.fx;

interface Spark {
  x: number;
  y: number;
  z: number;
  t: number;
  heavy: boolean;
  blocked: boolean;
  seed: number;
  /** 攻擊者角色 id（之後換成該角色的代表色） */
  by?: number;
  colors?: [string, string];
}

/** 噴飛的招牌圖示（命中、KO、衝刺時） */
interface IconBit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  life: number;
  icon: string;
  color: string;
  spin: number;
  scale: number;
  /** 有重力（落到地上會彈） */
  fall: boolean;
}

/** 大招切入畫面 */
interface CutIn {
  id: number;
  charId: string;
  name: string;
  t: number;
}

/** 命中時飛出的碎片（菜葉、碎紙、布丁、火花……） */
interface Frag {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rot: number;
  vr: number;
  t: number;
  life: number;
  shape: 'leaf' | 'paper' | 'splat' | 'spark' | 'puff';
  color: string;
  size: number;
}

/** 地上的痕跡（震地裂痕、天降坑洞、爆炸焦痕），幾秒後淡掉 */
interface Decal {
  x: number;
  z: number;
  r: number;
  t: number;
  life: number;
  kind: 'crack' | 'crater' | 'scorch';
  seed: number;
}

/** 飄起來的傷害數字 */
interface DmgNum {
  x: number;
  y: number;
  z: number;
  t: number;
  value: number;
  heavy: boolean;
  blocked: boolean;
  by: number;
  color?: string;
}

/** 連擊數（每個攻擊者一個） */
interface ComboTag {
  by: number;
  n: number;
  x: number;
  y: number;
  z: number;
  t: number;
  color: string;
}

/** KO 爆字 */
interface KoSplash {
  x: number;
  y: number;
  z: number;
  t: number;
  colors: [string, string];
}

interface Afterimage {
  e: Entity;
  t: number;
  /** 殘影當下的姿勢（沒有就用倒地姿勢） */
  pose?: Pose;
  /** 殘影顏色 */
  tint?: string;
}

interface Debris {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  t: number;
  color: string;
  /** 碎石大小（預設 6） */
  size?: number;
  /** 前後方向的速度（震地碎石往四面八方飛） */
  vz?: number;
}

/** 震地衝擊：地面擴散的震波圈 */
interface Quake {
  x: number;
  z: number;
  rx: number;
  rz: number;
  t: number;
  color: string;
}

/** 震地揚起的塵土 */
interface Dust {
  x: number;
  z: number;
  vx: number;
  r: number;
  t: number;
}

/** 飛行物圖示的放大倍率（貓狗畫大一點才看得出是貓狗） */
const ICON_SCALE: Record<string, number> = { cat: 1.55, dog: 1.45 };
/** 天降攻擊圖示的放大倍率 */
const DROP_SCALE: Record<string, number> = { catdrop: 2.7 };

/** 命中火花持續 tick */
const SPARK_TICKS = 9;
/** 集氣光持續 tick */
const CHARGE_TICKS = 14;
/** 大招門檻（MP）：達到就有切入畫面與更大的氣場 */
const BIG_MOVE_MP = 130;
/** 大招切入畫面長度（tick） */
const CUTIN_TICKS = 52;
/** KO 爆字長度 */
const KO_TICKS = 50;
/** 重擊放大長度 */
const ZOOM_TICKS = 7;
/** 傷害數字停留 tick */
const DMG_TICKS = 46;
/** 連擊：兩下之間最多隔幾 tick 還算同一串 */
const COMBO_GAP = 70;
/** 連擊數顯示 tick */
const COMBO_TICKS = 60;
/** 地上痕跡最多同時幾個 */
const MAX_DECALS = 14;
/** 畫面搖晃上限（px）：超過就壓到這個值，避免看了不舒服 */
const MAX_SHAKE = 2.5;
/** 所有搖晃來源的幅度倍率 */
const SHAKE_SCALE = 0.5;


/** 顏色往白色靠（亮面） */
function mixWhite(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const m = (c: number) => Math.round(c + (255 - c) * 0.55);
  return `rgb(${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)})`;
}
/** 飛行物拖尾長度（tick） */
const TRAIL_LEN = 7;

/** #rrggbb + 透明度 → rgba() */
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/** 震波圈持續時間（tick） */
const QUAKE_TICKS = 34;
const DUST_TICKS = 40;

export function screenY(e: { y: number; z: number }): number {
  return HZ + e.z - e.y;
}

export function poseName(w: World, e: Entity): string {
  switch (e.state) {
    case 'attack':
      return w.currentFrame(e)?.pose ?? 'idle_0';
    case 'idle':
      return `idle_${Math.floor(w.tick / 30) % 2}`;
    case 'walk':
      return `walk_${Math.floor(e.stateTime / 7) % 4}`;
    case 'run':
      return `run_${Math.floor(e.stateTime / 4) % 4}`;
    case 'jump':
      return hasBuff(e, 'hover') ? 'jet_up' : 'jump';
    case 'defend':
      return 'defend';
    case 'broken':
    case 'dizzy':
      return 'dizzy';
    case 'hurt':
    case 'grabbed':
      return 'hurt';
    case 'grabbing':
      return w.tick - e.grabPunchTick < 8 ? 'punch_extend' : 'grab';
    case 'falling':
      return 'falling';
    case 'lying':
    case 'dead':
      return 'lying';
    case 'rolling':
      return 'crouch';
  }
}

/** 角色這一刻「應該」擺的姿勢：走路 / 跑步用連續相位、站著有呼吸起伏 */
export function targetPose(w: World, e: Entity): Pose {
  switch (e.state) {
    case 'walk':
      return cyclePose('walk', 4, e.stateTime / 7);
    case 'run':
      return cyclePose('run', 4, e.stateTime / 4);
    case 'idle': {
      const k = (1 - Math.cos((w.tick / 60) * Math.PI * 2)) / 2;
      const base = lerpPose(getPose('idle_0'), getPose('idle_1'), k);
      // 站久了的小動作：壯的人秀一下肌肉
      const q = idleQuirk(e);
      if (q >= 0 && q < 50 && w.charDef(e).look.build === 'muscular') return lerpPose(base, getPose('flex'), Math.sin((q / 50) * Math.PI));
      return base;
    }
    default:
      return getPose(poseName(w, e));
  }
}

/** 站著超過 2 秒後，每 5 秒一次的小動作進度（tick）；沒有就回傳 -1 */
function idleQuirk(e: Entity): number {
  if (e.state !== 'idle' || e.stateTime < 120) return -1;
  return (e.stateTime + e.id * 37) % 300;
}

/** 姿勢往目標靠近的速度：受擊、倒地要快（打擊感）；出招的預備幀慢慢蓄力、有攻擊框的那一幀一口氣打出去 */
function poseRate(w: World, e: Entity): number {
  switch (e.state) {
    case 'hurt':
    case 'falling':
    case 'grabbed':
      return 0.85;
    case 'attack':
      return w.currentFrame(e)?.itr ? 0.92 : 0.5;
    case 'lying':
    case 'dead':
      return 0.5;
    default:
      return 0.45;
  }
}

/** 依角色狀態決定表情 */
export function expressionFor(w: World, e: Entity): Expression {
  switch (e.state) {
    case 'attack': {
      const pose = w.currentFrame(e)?.pose ?? '';
      return pose === 'victory' ? 'happy' : 'attack';
    }
    case 'hurt':
    case 'grabbed':
    case 'falling':
    case 'lying':
    case 'dead':
    case 'broken':
      return 'hurt';
    case 'dizzy':
      return 'dizzy';
    case 'defend':
    case 'grabbing':
    case 'run':
    case 'rolling':
      return 'focus';
    default:
      return 'normal';
  }
}

export class BattleRenderer {
  camX = 0;
  shakeAmp = 0;
  shakeTicks = 0;
  /** 這次搖晃的總長度（用來算逐漸變小的幅度） */
  private shakeTotal = 1;
  sparks: Spark[] = [];
  afterimages: Afterimage[] = [];
  debris: Debris[] = [];
  quakes: Quake[] = [];
  dust: Dust[] = [];
  /** 招式喊話泡泡 */
  callouts: { text: string; id: number; t: number; color: string }[] = [];
  /** 震地瞬間的白色閃光（剩餘 tick） */
  flash = 0;
  private lastFrame = new Map<number, string | null>();
  /** 模擬送出的喊話（狀態提示、反擊……）與 KO，等下一個 tick 有世界資料時再處理 */
  private pendingSays: { id: number; text: string; status?: boolean }[] = [];
  private pendingKo: number[] = [];
  private pendingKoBy = new Map<number, number>();
  private openingDone = false;
  /** 畫面上每個角色目前的姿勢（每 tick 往目標姿勢插值） */
  private poses = new Map<number, Pose>();
  /** 飛行物的拖尾（最近幾 tick 的位置） */
  private trails = new Map<number, { x: number; y: number; z: number }[]>();
  /** 放招時的集氣光（往身體收攏的光點） */
  private charges: { id: number; t: number; color: string; colors: [string, string]; aura: AuraStyle; big: boolean }[] = [];
  private bits: IconBit[] = [];
  private frags: Frag[] = [];
  private decals: Decal[] = [];
  /** 每個角色的手腳位置（這一 tick 與上一 tick，用來畫揮擊殘影） */
  private joints = new Map<number, { tick: number; hist: Joints[] }>();
  /** 飛行物最後一次的樣子（消失時在原地畫命中碎片） */
  private projLast = new Map<number, { pose: string; x: number; y: number; z: number; charId: string; hitPose: string }>();
  /** 這一 tick 的命中位置 */
  private hitSpots: { x: number; y: number; z: number }[] = [];
  private cutIn: CutIn | null = null;
  private cutInCooldown = 0;
  private koSplashes: KoSplash[] = [];
  /** 重擊時畫面放大一下（剩餘 tick 與中心） */
  private zoom = { t: 0, x: 0, y: 0 };
  private pendingHits: { x: number; y: number; z: number; heavy: boolean; by: number }[] = [];
  /** 要播放的角色招牌音效（場景每 tick 取走） */
  sfxQueue: { style: SoundStyle; mode: SignatureMode }[] = [];
  private dmgNums: DmgNum[] = [];
  private combos = new Map<number, { n: number; last: number }>();
  private comboTags: ComboTag[] = [];
  /** 招式起始幀 → 招式（判斷是不是大招） */
  private moveIndex = new Map<string, Map<string, { mp: number; name: string }>>();
  private lastState = new Map<number, string>();
  /** 頭髮、領帶、衣襬的擺動（慢半拍跟著速度走，> 0 往後飄） */
  private sways = new Map<number, number>();
  private fxSeed = 1;
  hpLag = new Map<number, number>();
  banner: { text: string; t: number } | null = null;
  private sparkSeed = 0;

  constructor(w: World) {
    this.camX = this.targetCam(w);
  }

  private targetCam(w: World): number {
    let list = w.chars().filter((c) => c.slot >= 0 && c.hp > 0);
    if (!list.length) list = w.chars().filter((c) => c.hp > 0);
    if (!list.length) return this.camX;
    const cx = list.reduce((s, c) => s + c.x, 0) / list.length;
    return Math.max(0, Math.min(w.stage.width - VW, cx - VW / 2));
  }

  consume(events: GameEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'hit') {
        this.sparks.push({ x: ev.x, y: ev.y, z: ev.z, t: SPARK_TICKS, heavy: ev.heavy, blocked: ev.blocked, seed: this.sparkSeed++, by: ev.by });
        this.hitSpots.push({ x: ev.x, y: ev.y, z: ev.z });
        if (ev.heavy && !ev.blocked) {
          this.flash = Math.max(this.flash, 1);
          if (shakeFactor() > 0) this.zoom = { t: ZOOM_TICKS, x: ev.x, y: HZ + ev.z - ev.y };
          this.addShake(4, 8);
        }
        if (!ev.blocked && ev.by) this.pendingHits.push({ x: ev.x, y: ev.y, z: ev.z, heavy: ev.heavy, by: ev.by });
        if (ev.dmg && ev.dmg > 0) this.dmgNums.push({ x: ev.x + (this.rand() - 0.5) * 14, y: ev.y + 24, z: ev.z, t: DMG_TICKS, value: ev.dmg, heavy: ev.heavy, blocked: ev.blocked, by: ev.by ?? 0 });
      } else if (ev.type === 'shake') {
        this.addShake(ev.amp, Math.min(ev.ticks, 16));
      } else if (ev.type === 'break') {
        for (let i = 0; i < 8; i++)
          this.debris.push({ x: ev.x, y: ev.y + 10, z: ev.z, vx: Math.cos(i * 0.8) * (2 + (i % 3)), vy: 3 + (i % 4), t: 30, color: ev.color });
      } else if (ev.type === 'say') {
        this.pendingSays.push(ev);
      } else if (ev.type === 'ko') {
        this.pendingKo.push(ev.id);
        this.pendingKoBy.set(ev.id, ev.by ?? 0);
      } else if (ev.type === 'wave') {
        this.banner = { text: `第 ${ev.index + 1} / ${ev.total} 波`, t: 90 };
      }
    }
  }

  /**
   * 畫面搖晃：幅度一律壓在 MAX_SHAKE 以內，取較大的那一次；
   * 系統設定「減少動態效果」時完全不搖。
   */
  private addShake(amp: number, ticks: number): void {
    const f = shakeFactor();
    if (f <= 0) return;
    const a = Math.min(MAX_SHAKE, amp * SHAKE_SCALE) * f;
    if (a >= this.shakeAmp * (this.shakeTicks / this.shakeTotal) || this.shakeTicks <= 0) {
      this.shakeAmp = a;
      this.shakeTicks = ticks;
      this.shakeTotal = ticks;
    }
  }

  /** 畫面用的亂數（只影響特效，不影響遊戲結果） */
  private rand(): number {
    this.fxSeed = (this.fxSeed * 16807) % 2147483647;
    return this.fxSeed / 2147483647;
  }

  /** 震地招式落地的瞬間：震波、碎石、塵土、閃光、強烈搖晃 */
  private spawnQuake(w: World, e: Entity, itr: { x: number; w: number; zRange?: number }): void {
    const rx = Math.max(Math.abs(itr.x), Math.abs(itr.x + itr.w));
    const rz = itr.zRange ?? CONFIG.physics.hitZTolerance;
    const color = w.charDef(e).palette.accent;
    const rings = lowQuality ? 1 : 3;
    for (let i = 0; i < rings; i++) this.quakes.push({ x: e.x, z: e.z, rx: rx * (1 + i * 0.18), rz: rz * (1 + i * 0.18), t: QUAKE_TICKS + i * 5, color });
    const rockColors = ['#8b6b4a', '#a1866b', '#6b5440', '#cbb89d'];
    for (let i = 0; i < (lowQuality ? 8 : 22); i++) {
      const a = this.rand() * Math.PI * 2;
      const sp = 2 + this.rand() * 5;
      this.debris.push({
        x: e.x + Math.cos(a) * rx * 0.3,
        y: 2,
        z: e.z + Math.sin(a) * rz * 0.3,
        vx: Math.cos(a) * sp,
        vz: Math.sin(a) * sp * 0.35,
        vy: 4 + this.rand() * 6,
        t: 34 + Math.floor(this.rand() * 14),
        color: rockColors[i % rockColors.length],
        size: 4 + Math.floor(this.rand() * 6),
      });
    }
    for (let i = 0; i < (lowQuality ? 4 : 12); i++) {
      const side = i % 2 ? 1 : -1;
      this.dust.push({ x: e.x + side * rx * (0.2 + this.rand() * 0.7), z: e.z + (this.rand() - 0.5) * rz, vx: side * (0.6 + this.rand() * 1.4), r: 10 + this.rand() * 12, t: DUST_TICKS });
    }
    this.addDecal({ x: e.x, z: e.z, r: Math.min(90, rx * 0.7), kind: 'crack' });
    // 震地：用震波圈、碎石、塵土表現衝擊，畫面只輕輕晃一下
    this.flash = Math.max(this.flash, 3);
    this.addShake(6, 14);
  }

  /** 每個邏輯 tick 呼叫一次 */
  private say(id: number, text: string, color: string): void {
    this.callouts = this.callouts.filter((k) => k.id !== id);
    this.callouts.push({ text, id, t: 80, color });
  }

  tick(w: World): void {
    if (!this.openingDone) {
      this.openingDone = true;
      // 彩蛋：川噗對上金正嗯
      const chars = w.chars();
      for (const t of chars.filter((c) => c.charId === 'trump'))
        if (chars.some((k) => k.charId === 'kim' && k.team !== t.team)) this.say(t.id, '小火箭人！', w.charDef(t).palette.accent);
    }
    for (const s of this.pendingSays) {
      const e = w.get(s.id);
      if (e) this.say(s.id, s.text, s.status ? '#dc2626' : w.charDef(e).palette.accent);
    }
    this.pendingSays = [];
    for (const id of this.pendingKo) {
      const v = w.get(id);
      if (v) {
        const killer = w.get(this.pendingKoBy.get(id) ?? 0);
        const sig = signatureOf(killer?.charId ?? v.charId, killer ? w.charDef(killer).palette.accent : undefined);
        this.koSplashes.push({ x: v.x, y: v.y + 50, z: v.z, t: KO_TICKS, colors: sig.colors });
        this.burst(v.x, v.y + 40, v.z, sig.icons, sig.colors, lowQuality ? 6 : 14, 1.4);
        this.flash = Math.max(this.flash, 3);
        this.addShake(6, 14);
      }
      this.pendingKoBy.delete(id);
      const e = w.get(id);
      const q = e && w.charDef(e).koQuote;
      if (e && q) this.say(id, q, '#64748b');
    }
    this.pendingKo = [];
    for (const c of w.chars()) {
      // 平順動畫：往目標姿勢插值；受擊停頓中維持原姿勢
      const target = targetPose(w, c);
      const cur = this.poses.get(c.id);
      if (!cur || c.freeze === 0) this.poses.set(c.id, cur ? lerpPose(cur, target, poseRate(w, c)) : target);
      // 跟隨擺動：往前跑或被打飛時往後飄，停下來慢慢回彈
      const air = c.y > 0 ? Math.max(-0.4, Math.min(0.6, -c.vy / 10)) : 0;
      const want = Math.max(-1, Math.min(1.2, (c.vx * c.facing) / 5 + air));
      let sv = this.sways.get(c.id) ?? 0;
      // 站久了的小動作：甩一下頭髮
      if (idleQuirk(c) === 0) sv += 0.9;
      this.sways.set(c.id, sv + (want - sv) * 0.16);
      const ps = this.lastState.get(c.id);
      if (ps !== c.state) {
        this.lastState.set(c.id, c.state);
        // 落地、起跑、倒地揚起小塵土
        const puff = (ps === 'jump' && c.state === 'idle') || c.state === 'run' || c.state === 'lying';
        if (puff && !lowQuality)
          for (const side of [-1, 1]) this.dust.push({ x: c.x + side * 8, z: c.z, vx: side * (c.state === 'run' ? 0.3 : 0.9) - (c.state === 'run' ? c.facing * 0.8 : 0), r: 5, t: 22 });
      }
      // 衝刺類招式拖出角色色殘影，沿路掉招牌圖示
      if (!lowQuality && c.state === 'attack' && Math.abs(c.vx) > 5) {
        const sig = signatureOf(c.charId, w.charDef(c).palette.accent);
        if (w.tick % 2 === 0) this.afterimages.push({ e: { ...c, buffs: [] }, t: 10, pose: this.poses.get(c.id), tint: sig.colors[0] });
        if (w.tick % 5 === 0)
          this.bits.push({ x: c.x - c.facing * 12, y: c.y + 20 + this.rand() * 30, z: c.z, vx: -c.facing * 0.6, vy: 0.4, vz: 0, t: 22, life: 22, icon: sig.icons[(w.tick / 5) % 2 | 0], color: sig.colors[0], spin: this.rand() - 0.5, scale: 0.9, fall: false });
      }
      const prev = this.lastFrame.get(c.id);
      if (c.frame !== prev) {
        this.lastFrame.set(c.id, c.frame);
        const fr = c.state === 'attack' && c.frame ? w.charDef(c).frames[c.frame] : undefined;
        const quake = fr?.itr?.find((it) => it.radial);
        if (quake) this.spawnQuake(w, c, quake);
        const mv = c.frame ? this.moveOf(w, c.charId, c.frame) : undefined;
        if (fr?.sound === 'special' || mv) {
          const sig = signatureOf(c.charId, w.charDef(c).palette.accent);
          const big = !!mv && mv.mp >= BIG_MOVE_MP;
          if (!lowQuality || big) this.charges.push({ id: c.id, t: big ? CHARGE_TICKS * 2 : CHARGE_TICKS, color: sig.colors[0], colors: sig.colors, aura: sig.aura, big });
          if (mv) this.sfxQueue.push({ style: sig.sound, mode: 'cast' });
          // 大招：切入畫面（同時只有一個，連續放有冷卻）
          if (big && this.cutInCooldown <= 0) {
            this.cutIn = { id: c.id, charId: c.charId, name: mv.name, t: CUTIN_TICKS };
            this.cutInCooldown = CUTIN_TICKS + 40;
          }
        }
        if (fr?.say) {
          this.callouts = this.callouts.filter((k) => k.id !== c.id);
          this.callouts.push({ text: fr.say, id: c.id, t: 80, color: w.charDef(c).palette.accent });
        }
      }
    }
    for (const h of this.pendingHits) {
      const a = w.get(h.by);
      if (!a || a.kind !== 'char') continue;
      const sig = signatureOf(a.charId, w.charDef(a).palette.accent);
      this.sfxQueue.push({ style: sig.sound, mode: h.heavy ? 'heavy' : 'hit' });
      // 連擊：同一個人 70 tick 內連續打中就累加，3 下以上在命中點顯示「N HIT!」
      const c = this.combos.get(h.by);
      const n = c && w.tick - c.last <= COMBO_GAP ? c.n + 1 : 1;
      this.combos.set(h.by, { n, last: w.tick });
      if (n >= 3) {
        this.comboTags = this.comboTags.filter((k) => k.by !== h.by);
        this.comboTags.push({ by: h.by, n, x: h.x, y: h.y + 64, z: h.z, t: COMBO_TICKS, color: sig.colors[0] });
      }
      this.burst(h.x, h.y, h.z, sig.icons, sig.colors, h.heavy ? (lowQuality ? 3 : 6) : lowQuality ? 1 : 2, h.heavy ? 1.15 : 0.8);
    }
    this.pendingHits = [];
    for (const s of this.sparks) {
      if (s.by && !s.colors) {
        const a = w.get(s.by);
        if (a?.kind === 'char') s.colors = signatureOf(a.charId, w.charDef(a).palette.accent).colors;
      }
    }
    for (const b of this.bits) {
      b.x += b.vx;
      b.z += b.vz;
      if (b.fall) {
        b.vy -= 0.35;
        b.y += b.vy;
        if (b.y < 0) {
          b.y = 0;
          b.vy = -b.vy * 0.45;
          b.vx *= 0.7;
        }
      } else b.y += b.vy;
      b.t--;
    }
    this.bits = this.bits.filter((b) => b.t > 0);
    for (const d of this.dmgNums) {
      if (!d.color && d.by) {
        const a = w.get(d.by);
        d.color = a?.kind === 'char' ? signatureOf(a.charId, w.charDef(a).palette.accent).colors[0] : '#ffffff';
      }
      d.y += 0.9 * (d.t / DMG_TICKS) + 0.15;
      d.t--;
    }
    this.dmgNums = this.dmgNums.filter((d) => d.t > 0);
    if (this.dmgNums.length > 24) this.dmgNums.splice(0, this.dmgNums.length - 24);
    for (const k of this.comboTags) k.t--;
    this.comboTags = this.comboTags.filter((k) => k.t > 0);
    for (const k of this.koSplashes) k.t--;
    this.koSplashes = this.koSplashes.filter((k) => k.t > 0);
    if (this.zoom.t > 0) this.zoom.t--;
    if (this.cutIn && --this.cutIn.t <= 0) this.cutIn = null;
    if (this.cutInCooldown > 0) this.cutInCooldown--;
    for (const k of this.charges) k.t--;
    this.charges = this.charges.filter((k) => k.t > 0);
    const alive = new Set<number>();
    for (const p of w.entities) {
      if (p.kind !== 'proj') continue;
      alive.add(p.id);
      const pose = w.currentFrame(p)?.pose ?? '';
      const last = this.projLast.get(p.id);
      // 天降攻擊落地：留下坑洞（閃電留焦痕）
      if (last && last.pose !== pose && (pose.endsWith('drop') || pose === 'bolt')) this.addDecal({ x: p.x, z: p.z, r: 26, kind: pose === 'bolt' ? 'scorch' : 'crater' });
      if (last && last.pose !== pose && pose === 'explosion') this.addDecal({ x: p.x, z: p.z, r: 30, kind: 'scorch' });
      this.projLast.set(p.id, { pose, x: p.x, y: p.y, z: p.z, charId: p.charId, hitPose: pose === 'explosion' || pose.endsWith('drop') ? (last?.hitPose ?? pose) : pose });
      const tr = this.trails.get(p.id) ?? [];
      tr.unshift({ x: p.x, y: p.y, z: p.z });
      if (tr.length > TRAIL_LEN) tr.pop();
      this.trails.set(p.id, tr);
    }
    for (const id of this.trails.keys()) if (!alive.has(id)) this.trails.delete(id);
    // 飛行物打中人消失：依種類噴出碎片
    for (const [id, last] of this.projLast) {
      if (alive.has(id)) continue;
      this.projLast.delete(id);
      if (this.hitSpots.some((h) => Math.abs(h.x - last.x) < 45 && Math.abs(h.z - last.z) < 24)) this.impact(last.hitPose, last.x, last.y, last.z, w.data.characters[last.charId]?.palette.accent ?? '#ffffff');
    }
    this.hitSpots = [];
    for (const f of this.frags) {
      f.x += f.vx;
      f.z += f.vz;
      f.vy -= f.shape === 'puff' ? -0.05 : f.shape === 'leaf' || f.shape === 'paper' ? 0.18 : 0.35;
      if (f.shape === 'leaf' || f.shape === 'paper') {
        f.vx *= 0.96;
        f.vy = Math.max(f.vy, -1.6);
      }
      f.y += f.vy;
      if (f.y < 0) {
        f.y = 0;
        f.vy = 0;
        f.vx *= 0.5;
        f.vr *= 0.5;
      }
      f.rot += f.vr;
      f.t--;
    }
    this.frags = this.frags.filter((f) => f.t > 0);
    for (const d of this.decals) d.t--;
    this.decals = this.decals.filter((d) => d.t > 0);
    for (const k of this.callouts) k.t--;
    this.callouts = this.callouts.filter((k) => k.t > 0);
    for (const q of this.quakes) q.t--;
    this.quakes = this.quakes.filter((q) => q.t > 0);
    for (const d of this.dust) {
      d.x += d.vx;
      d.vx *= 0.94;
      d.r += 0.9;
      d.t--;
    }
    this.dust = this.dust.filter((d) => d.t > 0);
    if (this.flash > 0) this.flash--;
    this.camX += (this.targetCam(w) - this.camX) * FX.cameraLerp;
    if (this.shakeTicks > 0) this.shakeTicks--;
    for (const s of this.sparks) s.t--;
    this.sparks = this.sparks.filter((s) => s.t > 0);
    for (const a of this.afterimages) a.t--;
    this.afterimages = this.afterimages.filter((a) => a.t > 0);
    for (const d of this.debris) {
      d.vy -= 0.4;
      d.x += d.vx;
      if (d.vz) d.z += d.vz;
      d.y = Math.max(0, d.y + d.vy);
      if (d.y === 0) {
        d.vx *= 0.8;
        if (d.vz) d.vz *= 0.8;
      }
      d.t--;
    }
    this.debris = this.debris.filter((d) => d.t > 0);
    if (this.banner && --this.banner.t <= 0) this.banner = null;
    if (!lowQuality && w.tick % FX.afterimageInterval === 0) {
      for (const e of w.entities) {
        if (e.kind === 'char' && e.state === 'falling' && e.freeze === 0)
          this.afterimages.push({ e: { ...e, buffs: [] }, t: FX.afterimageLife });
      }
    }
    for (const c of w.chars()) {
      const lag = this.hpLag.get(c.id) ?? c.hp;
      this.hpLag.set(c.id, lag > c.hp ? Math.max(c.hp, lag - 2.5) : c.hp);
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: World, hudExtra?: string): void {
    ctx.save();
    if (this.shakeTicks > 0) {
      // 平滑、逐漸變小的晃動（不再每格左右跳），上下幅度更小
      const k = this.shakeTicks / this.shakeTotal;
      const a = this.shakeAmp * k * k;
      ctx.translate(Math.sin(w.tick * 1.1) * a, Math.cos(w.tick * 1.7) * a * 0.3);
    }
    const cam = Math.round(this.camX);
    if (this.zoom.t > 0 && !lowQuality) {
      // 重擊：畫面往命中點放大一下
      const k = 1 + 0.02 * shakeFactor() * (this.zoom.t / ZOOM_TICKS);
      const zx = this.zoom.x - cam;
      ctx.translate(zx, this.zoom.y);
      ctx.scale(k, k);
      ctx.translate(-zx, -this.zoom.y);
    }
    drawStage(ctx, w, cam);
    for (const d of this.decals) this.drawDecal(ctx, d, cam);

    // 陰影
    for (const e of w.entities) {
      if (e.kind === 'item' && e.itemState === 'held') continue;
      const size = e.kind === 'char' ? 16 : e.kind === 'proj' ? 8 : 9;
      const k = Math.max(0.4, 1 - e.y / 200);
      ctx.fillStyle = `rgba(0,0,0,${0.3 * k})`;
      ctx.beginPath();
      ctx.ellipse(e.x - cam, HZ + e.z, size * k, size * 0.35 * k, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const q of this.quakes) this.drawQuakeRing(ctx, q, cam);

    for (const a of this.afterimages) {
      const def = w.charDef(a.e);
      ctx.globalAlpha = FX.afterimageAlpha * Math.min(1, a.t / FX.afterimageLife);
      drawFigure(ctx, def, { pose: a.pose ?? getPose('falling'), x: a.e.x - cam, y: screenY(a.e), facing: a.e.facing, tick: w.tick, tint: a.tint ?? '#fff' });
      ctx.globalAlpha = 1;
    }

    const sorted = w.entities.filter((e) => !(e.kind === 'item' && e.itemState === 'held')).sort((a, b) => a.z - b.z || a.id - b.id);
    for (const e of sorted) {
      if (e.kind === 'char') this.drawChar(ctx, w, e, cam);
      else if (e.kind === 'item') drawItemShape(ctx, w.data.items[e.itemId], e.x - cam, screenY(e), 0);
      else this.drawProjectile(ctx, w, e, cam);
    }

    for (const d of this.dust) {
      const k = d.t / DUST_TICKS;
      ctx.fillStyle = `rgba(214,196,168,${0.55 * k})`;
      ctx.beginPath();
      ctx.ellipse(d.x - cam, HZ + d.z - d.r * 0.5, d.r, d.r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const d of this.debris) {
      const sz = d.size ?? 6;
      ctx.fillStyle = d.color;
      ctx.fillRect(d.x - cam - sz / 2, HZ + d.z - d.y - sz / 2, sz, sz * 0.85);
    }
    for (const s of this.sparks) this.drawSpark(ctx, s, cam);
    for (const k of this.charges) {
      const e = w.get(k.id);
      if (e) this.drawCharge(ctx, k, e, cam, w.tick);
    }
    for (const b of this.bits) {
      const a = Math.min(1, b.t / 8);
      ctx.globalAlpha = a;
      drawIcon(ctx, b.icon, b.x - cam, HZ + b.z - b.y, b.scale * (0.7 + 0.3 * Math.min(1, (b.life - b.t) / 4)), 1, b.color, w.tick * b.spin, 0);
      ctx.globalAlpha = 1;
    }
    for (const f of this.frags) this.drawFrag(ctx, f, cam);
    for (const k of this.koSplashes) this.drawKo(ctx, k, cam);
    for (const d of this.dmgNums) this.drawDmg(ctx, d, cam);
    for (const k of this.comboTags) this.drawCombo(ctx, k, cam);
    for (const k of this.callouts) {
      const e = w.get(k.id);
      if (e) this.drawCallout(ctx, k, e, cam);
    }
    ctx.restore();
    if (this.cutIn) this.drawCutIn(ctx, w, this.cutIn);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,250,230,${(REDUCED_MOTION || shakeFactor() === 0 ? 0.025 : 0.05) * this.flash})`;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    this.drawHud(ctx, w, hudExtra);
  }

  private drawChar(ctx: CanvasRenderingContext2D, w: World, e: Entity, cam: number): void {
    const def = w.charDef(e);
    const held = e.heldItem ? w.data.items[w.get(e.heldItem)?.itemId ?? ''] : undefined;
    let pose = this.poses.get(e.id) ?? targetPose(w, e);
    if (held?.kind === 'heavy' && (e.state === 'idle' || e.state === 'walk')) pose = withCarryArms(pose);
    if (e.state === 'rolling') pose = { ...pose, rot: (e.stateTime / CONFIG.combat.rollTicks) * 360 };
    if (e.state === 'dizzy' || e.state === 'broken') pose = { ...pose, t: pose.t + Math.sin(w.tick * 0.2) * 8 };
    const stun = getBuff(e, 'stun');
    if (stun?.value === 3) pose = { ...pose, t: pose.t + Math.sin(w.tick * 0.35) * 14 };
    // 受擊停頓時左右抖動（打擊感）
    const shake = e.freeze > 0 && (e.state === 'hurt' || e.state === 'falling' || e.state === 'dizzy' || e.state === 'broken') ? (w.tick % 2 ? 2 : -2) : 0;
    const x = e.x - cam + shake;
    const y = screenY(e);
    let alpha = 1;
    if (e.state === 'dead') alpha = 0.45;
    else if (e.invuln > 0 && e.state !== 'rolling' && e.state !== 'attack' && (w.tick >> 2) % 2 === 0) alpha = 0.4;

    // 增益效果
    if (hasBuff(e, 'dmgReduce') && def.buffFx?.dmgReduce === 'spicy') this.drawSpicyAura(ctx, x, y, w.tick);
    else if (hasBuff(e, 'dmgReduce')) {
      ctx.fillStyle = 'rgba(255,215,90,0.22)';
      ctx.strokeStyle = 'rgba(255,215,90,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y - 36, 30, 46, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    drawBuffBack(ctx, e, x, y, w.tick);
    // 震地類招式：地面畫出實際的命中範圍（擴散的震波），看得出打得到哪裡
    const fr = e.state === 'attack' && e.frame ? def.frames[e.frame] : undefined;
    if (fr?.prop) drawPropBack(ctx, fr.prop, x, y, e.facing, w.tick);
    // 傳承精神：半透明的分身
    if (hasBuff(e, 'clone') && e.state !== 'dead') {
      const c = clonePos(e);
      drawFigure(ctx, def, { pose, x: c.x - cam, y: HZ + c.z - e.y, facing: e.facing, alpha: 0.42, tick: w.tick, airborne: e.y > 0, tint: '#93c5fd' });
    }
    const scale = hasBuff(e, 'power') ? 1.18 : 1;
    // 揮擊殘影：有攻擊框的那一幀，手腳從上一 tick 的位置掃到現在的位置
    const jt = this.joints.get(e.id);
    const smear = !!fr?.itr && e.frameTime < 4 && !!jt && jt.hist.length > 1 && !lowQuality;
    const joints: Joints = {};
    // 臉：眨眼、喊話時嘴巴開合、看向對手的高低、眼鏡反光
    const foe = this.nearestFoe(w, e);
    const quirk = idleQuirk(e);
    const quake = fr?.itr?.find((it) => it.radial);
    if (fr && quake) this.drawQuake(ctx, x, HZ + e.z, quake, Math.min(1, e.frameTime / fr.duration), def.palette.accent);
    drawFigure(ctx, def, {
      pose,
      x,
      y,
      facing: e.facing,
      flash: e.flash > 0,
      alpha,
      tick: w.tick,
      held,
      airborne: e.y > 0,
      glow: e.boss ? '#ff2a2a' : undefined,
      expression: expressionFor(w, e),
      scale,
      sway: (this.sways.get(e.id) ?? 0) + Math.sin(w.tick * 0.07 + e.id) * 0.06,
      blink: (w.tick + e.id * 53) % 230 < 7 && (e.state === 'idle' || e.state === 'walk' || e.state === 'run'),
      talk: this.callouts.some((k) => k.id === e.id && k.t > 30) && (w.tick >> 2) % 2 === 0,
      lookDy: foe ? (foe.z - e.z) / 50 - (foe.y - e.y) / 60 : 0,
      glint: quirk >= 100 && quirk < 118 ? (quirk - 100) / 18 : undefined,
      joints,
    });
    if (!jt || jt.tick !== w.tick) {
      const hist = jt ? [...jt.hist, joints].slice(-3) : [joints];
      // 出招中（有攻擊框）時保留蓄力那一刻的位置，讓殘影從預備姿勢一路掃過來
      if (fr?.itr && jt && e.frameTime > 0 && jt.hist.length) hist[0] = jt.hist[0];
      this.joints.set(e.id, { tick: w.tick, hist });
    }
    if (scale > 1) drawRedCap(ctx, x, y, e.facing, scale);
    // 揮擊殘影：從兩 tick 前（預備姿勢）掃到現在（打出去），畫在角色前面（直拳沿著手臂，畫在後面會被手臂擋住）
    if (smear && jt) this.drawSmears(ctx, jt.hist[0], jt.hist[jt.hist.length - 1], w.charDef(e).palette.accent);
    if (fr?.prop) drawPropFront(ctx, fr.prop, x, y, e.facing, w.tick);
    drawBuffFront(ctx, e, x, y, w.tick, scale);
    if (hasBuff(e, 'blockProjectile')) {
      ctx.save();
      ctx.strokeStyle = def.palette.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2 + w.tick * 0.03;
        const px = x + e.facing * 4 + Math.cos(a) * 34;
        const py = y - 36 + Math.sin(a) * 46;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      // 發光：先畫一道寬的半透明線，再畫實線（取代 shadowBlur）
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    if (e.state === 'dizzy' || e.state === 'broken' || e.state === 'grabbed') {
      for (let i = 0; i < 3; i++) {
        const a = w.tick * 0.12 + (i * Math.PI * 2) / 3;
        star(ctx, x + Math.cos(a) * 16, y - 88 + Math.sin(a) * 4, 4.5, '#ffe14d');
      }
    }
    // 敵人與 AI 頭上小血條；玩家標記
    if (e.state !== 'dead') {
      if (e.slot < 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - 17, y - 94, 34, 5);
        ctx.fillStyle = e.boss ? '#ff4d4d' : '#ffb84d';
        ctx.fillRect(x - 17, y - 94, (34 * e.hp) / e.maxHp, 5);
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 17, y - 94, 34, 5);
      } else {
        ctx.font = `bold 10px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = SLOT_COLORS[e.slot];
        ctx.lineWidth = 3;
        ctx.strokeStyle = OUTLINE;
        ctx.strokeText(e.ai ? 'COM' : `${e.slot + 1}P`, x, y - 90);
        ctx.fillText(e.ai ? 'COM' : `${e.slot + 1}P`, x, y - 90);
        ctx.textAlign = 'left';
      }
    }
  }

  /** 震波：橢圓大小 = 命中範圍（左右 itr 寬、前後 zRange），隨時間擴散淡出 */
  private drawQuake(ctx: CanvasRenderingContext2D, x: number, gy: number, itr: { x: number; w: number; zRange?: number }, k: number, color: string): void {
    const rx = Math.max(Math.abs(itr.x), Math.abs(itr.x + itr.w));
    const rz = itr.zRange ?? CONFIG.physics.hitZTolerance;
    const grow = 0.45 + 0.55 * k;
    ctx.save();
    ctx.globalAlpha = 1 - k * 0.4;
    ctx.fillStyle = 'rgba(255,226,150,0.42)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 + 4 * (1 - k);
    ctx.beginPath();
    ctx.ellipse(x, gy, rx * grow, rz * grow, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, gy, rx * grow * 0.6, rz * grow * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    // 地面裂痕
    ctx.strokeStyle = 'rgba(70,45,25,0.75)';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      ctx.moveTo(x + c * rx * 0.15, gy + sn * rz * 0.15);
      ctx.lineTo(x + c * rx * 0.45 * grow + sn * 4, gy + sn * rz * 0.45 * grow);
      ctx.lineTo(x + c * rx * 0.8 * grow, gy + sn * rz * 0.8 * grow);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** 招式喊話：角色頭上的白色對話泡泡，往上飄並淡出 */
  private drawCallout(ctx: CanvasRenderingContext2D, k: { text: string; t: number; color: string }, e: Entity, cam: number): void {
    const age = 80 - k.t;
    const x = e.x - cam;
    const y = screenY(e) - 92 - Math.min(14, age * 0.5);
    const pop = age < 8 ? 0.6 + age * 0.05 : 1;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k.t / 18);
    ctx.translate(x, y);
    ctx.scale(pop, pop);
    ctx.font = `900 17px ${FONT}`;
    const tw = ctx.measureText(k.text).width + 18;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = k.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect?.(-tw / 2, -15, tw, 28, 14);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-5, 12);
    ctx.lineTo(0, 20);
    ctx.lineTo(5, 12);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1a1530';
    ctx.fillText(k.text, 0, 5);
    ctx.restore();
  }

  /** 「辣台妹」減傷：紅橘色火焰光環 + 繞著轉的小辣椒 */
  private drawSpicyAura(ctx: CanvasRenderingContext2D, x: number, y: number, tick: number): void {
    ctx.save();
    const g = ctx.createRadialGradient(x, y - 38, 6, x, y - 38, 52);
    g.addColorStop(0, 'rgba(255,170,60,0.05)');
    g.addColorStop(0.6, 'rgba(255,90,40,0.28)');
    g.addColorStop(1, 'rgba(220,30,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y - 38, 40, 54, 0, 0, Math.PI * 2);
    ctx.fill();
    // 搖曳的火焰
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const fx = x + Math.cos(a) * 30;
      const fy = y - 30 + Math.sin(a) * 12;
      const h = 14 + Math.sin(tick * 0.4 + i * 1.7) * 5;
      ctx.fillStyle = i % 2 ? 'rgba(255,120,30,0.75)' : 'rgba(255,200,60,0.75)';
      ctx.beginPath();
      ctx.moveTo(fx - 5, fy);
      ctx.quadraticCurveTo(fx - 4, fy - h * 0.6, fx, fy - h);
      ctx.quadraticCurveTo(fx + 4, fy - h * 0.6, fx + 5, fy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    for (let i = 0; i < 3; i++) {
      const a = tick * 0.08 + (i / 3) * Math.PI * 2;
      drawIcon(ctx, 'chili', x + Math.cos(a) * 34, y - 46 + Math.sin(a) * 22, 1.1, 1, '#ef4444', tick, i);
    }
  }

  /** 落地後的震波：擴散到超過命中範圍並淡出 */
  private drawQuakeRing(ctx: CanvasRenderingContext2D, q: Quake, cam: number): void {
    const k = 1 - q.t / QUAKE_TICKS; // 0 → 1（後面幾圈會稍微超過 1）
    if (k < 0) return;
    const grow = 0.3 + 1.0 * Math.min(1.2, k);
    const x = q.x - cam;
    const gy = HZ + q.z;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - k);
    ctx.strokeStyle = q.color;
    ctx.lineWidth = 8 * (1 - Math.min(1, k)) + 2;
    ctx.beginPath();
    ctx.ellipse(x, gy, q.rx * grow, q.rz * grow, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, gy, q.rx * grow * 0.85, q.rz * grow * 0.85, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawProjectile(ctx: CanvasRenderingContext2D, w: World, p: Entity, cam: number): void {
    const def = w.data.projectiles[p.projId];
    const ch = w.data.characters[p.charId];
    const color = ch?.palette.accent ?? '#ffffff';
    const f = w.currentFrame(p);
    const x = p.x - cam;
    const y = screenY(p);
    const s = def?.size ?? 10;
    ctx.save();
    const pose = f?.pose ?? 'dart';
    // LF2 風格：會飛的飛行物後面拖一道光、外圈有一層發光
    if (!lowQuality && def && !def.wall && def.blockable) {
      const tr = Math.hypot(p.vx, p.vz) > 1.5 ? (this.trails.get(p.id) ?? []) : [];
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 1; i < tr.length; i++) {
        const k = 1 - i / tr.length;
        ctx.globalAlpha = 0.32 * k;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(tr[i].x - cam, HZ + tr[i].z - tr[i].y, Math.max(1.5, s * 0.55 * k), 0, Math.PI * 2);
        ctx.fill();
      }
      const g = ctx.createRadialGradient(x, y, 0, x, y, s * 1.7);
      g.addColorStop(0, 'rgba(255,255,255,0.45)');
      g.addColorStop(0.35, hexA(color, 0.35));
      g.addColorStop(1, hexA(color, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, s * 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (EXTRA_POSES.has(pose)) {
      drawExtraProjectile(ctx, w, p, pose, x, y, HZ + p.z, color);
      ctx.restore();
      return;
    }
    switch (pose) {
      case 'wave':
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = 1 - i * 0.28;
          ctx.beginPath();
          ctx.arc(x - p.facing * i * 8, y, s - i * 3, p.facing > 0 ? -1 : Math.PI - 1, p.facing > 0 ? 1 : Math.PI + 1);
          ctx.stroke();
        }
        break;
      case 'dart':
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x - p.facing * 16 - 4, y - 2, 12, 4);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(x - 5, y - 5, 10, 10);
        ctx.fillStyle = color;
        ctx.fillRect(x - 2, y - 2, 4, 4);
        break;
      case 'rocket':
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.moveTo(x - p.facing * 8, y - 3);
        ctx.lineTo(x - p.facing * (16 + (w.tick % 3) * 3), y);
        ctx.lineTo(x - p.facing * 8, y + 3);
        ctx.fill();
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(x - 8, y - 3, 14, 6);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x + p.facing * 6, y - 3);
        ctx.lineTo(x + p.facing * 11, y);
        ctx.lineTo(x + p.facing * 6, y + 3);
        ctx.fill();
        break;
      case 'explosion': {
        const k = f ? p.frameTime / f.duration : 0;
        const r = s * (0.5 + k * 0.9);
        ctx.globalAlpha = 1 - k * 0.8;
        ctx.fillStyle = '#ff7b00';
        ctx.beginPath();
        ctx.arc(x, y - (f?.itr?.[0].y === 0 ? r * 0.6 : 0), r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe66d';
        ctx.beginPath();
        ctx.arc(x, y - (f?.itr?.[0].y === 0 ? r * 0.6 : 0), r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'pad_arm':
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#4b5563';
        ctx.fillRect(x - 12, y - 6, 24, 6);
        ctx.fillStyle = (w.tick >> 2) % 2 ? '#ef4444' : '#7f1d1d';
        ctx.beginPath();
        ctx.arc(x, y - 8, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'bubble':
        ctx.fillStyle = color;
        roundRect(ctx, x - 9, y - 7, 18, 13, 5);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - 3, y + 5);
        ctx.lineTo(x - 6, y + 10);
        ctx.lineTo(x + 2, y + 5);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold 9px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('99+', x, y + 3);
        ctx.textAlign = 'left';
        break;
      case 'vortex':
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          const a0 = w.tick * 0.3 + (i * Math.PI * 2) / 3;
          for (let k = 0; k < 14; k++) {
            const a = a0 + k * 0.4;
            const r = 3 + k * 1.6;
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * r * 1.3;
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        break;
      case 'bolt_warn':
        ctx.shadowBlur = 0;
        ctx.strokeStyle = (w.tick >> 2) % 2 ? color : '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x, HZ + p.z, 16, 6, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'bolt': {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        let bx = x;
        ctx.moveTo(bx, 0);
        for (let yy = 0; yy < HZ + p.z; yy += 24) {
          bx = x + (((yy * 31 + w.tick * 17) % 21) - 10);
          ctx.lineTo(bx, yy);
        }
        ctx.lineTo(x, HZ + p.z);
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case 'paper': {
        // 公文：翻轉的紙張
        ctx.shadowBlur = 0;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(w.tick * 0.35 * p.facing);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-6, -8, 12, 16);
        ctx.fillStyle = color;
        ctx.fillRect(-4, -5, 8, 1.5);
        ctx.fillRect(-4, -1, 8, 1.5);
        ctx.fillRect(-4, 3, 5, 1.5);
        ctx.restore();
        break;
      }
      case 'bear': {
        // 黑熊衝鋒
        const bob = Math.sin(w.tick * 0.5) * 2;
        ctx.fillStyle = '#141414';
        ctx.beginPath();
        ctx.ellipse(x - p.facing * 4, y + 2 + bob, 14, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + p.facing * 9, y - 3 + bob, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + p.facing * 5, y - 10 + bob, 3, 0, Math.PI * 2);
        ctx.arc(x + p.facing * 13, y - 10 + bob, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#f5f5f5';
        ctx.beginPath();
        ctx.moveTo(x - p.facing * 2, y - 2 + bob);
        ctx.lineTo(x + p.facing * 6, y - 2 + bob);
        ctx.lineTo(x + p.facing * 2, y + 3 + bob);
        ctx.fill();
        ctx.fillStyle = '#c8a27a';
        ctx.beginPath();
        ctx.arc(x + p.facing * 14, y - 2 + bob, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'pill':
        // 膠囊藥丸
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.atan2(p.vz * 0.5, p.vx || 1));
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, -9, -4, 9, 8, 4);
        ctx.fill();
        ctx.fillStyle = color;
        roundRect(ctx, 0, -4, 9, 8, 4);
        ctx.fill();
        ctx.restore();
        break;
      case 'notes': {
        // 洗腦神曲：一圈繞著轉的音符
        for (let i = 0; i < 6; i++) {
          const a = w.tick * 0.12 + (i / 6) * Math.PI * 2;
          drawIcon(ctx, 'note', x + Math.cos(a) * 20, y + Math.sin(a) * 10 - 6, 1.1, 1, i % 2 ? '#8b5cf6' : '#ec4899', w.tick, i);
        }
        break;
      }
      case 'shock': {
        // ECMO 電擊球
        ctx.fillStyle = '#e0f7ff';
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + w.tick * 0.4;
          ctx.moveTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
          ctx.lineTo(x + Math.cos(a + 0.3) * 11, y + Math.sin(a + 0.3) * 11);
        }
        ctx.stroke();
        break;
      }
      case 'spark_burst': {
        const k = f ? p.frameTime / f.duration : 0;
        const r = s * (0.5 + k * 0.9);
        ctx.globalAlpha = 1 - k * 0.8;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + k;
          ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
          ctx.lineTo(x + Math.cos(a) * (r + 10), y + Math.sin(a) * (r + 10));
        }
        ctx.stroke();
        break;
      }
      case 'truck': {
        // 垃圾車：黃色車身 + 音符
        ctx.shadowBlur = 0;
        const f = p.facing;
        ctx.fillStyle = '#facc15';
        ctx.fillRect(x - 20, y - 14, 30, 22);
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(x + (f > 0 ? 10 : -26), y - 6, 16, 14);
        ctx.fillStyle = '#7dd3fc';
        ctx.fillRect(x + (f > 0 ? 14 : -24), y - 3, 8, 6);
        ctx.fillStyle = '#16a34a';
        ctx.fillRect(x - 20, y - 2, 30, 3);
        ctx.fillStyle = '#111';
        const wheel = (wx: number) => {
          ctx.beginPath();
          ctx.arc(wx, y + 9, 4, 0, Math.PI * 2);
          ctx.fill();
        };
        wheel(x - 13);
        wheel(x + 4);
        wheel(x + 18 * f);
        ctx.fillStyle = color;
        ctx.font = `bold 12px ${FONT}`;
        const bob = Math.sin(w.tick * 0.3) * 3;
        ctx.fillText('♪', x - 14, y - 20 + bob);
        ctx.fillText('♫', x + 2, y - 24 - bob);
        break;
      }
      case 'scalpel':
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(p.facing, 1);
        ctx.fillStyle = '#6b7280';
        ctx.fillRect(-9, -1.5, 9, 3);
        ctx.fillStyle = '#e5e7eb';
        ctx.beginPath();
        ctx.moveTo(0, -3);
        ctx.lineTo(9, 0);
        ctx.lineTo(0, 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      case 'syringe':
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(p.facing, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(-10, -4, 14, 8);
        ctx.fillStyle = color;
        ctx.fillRect(-8, -2.5, 9, 5);
        ctx.fillStyle = '#9ca3af';
        ctx.fillRect(-14, -1, 4, 2);
        ctx.fillRect(-15, -4, 2, 8);
        ctx.fillRect(4, -0.8, 8, 1.6);
        ctx.restore();
        break;
      case 'beardrop': {
        // 從天而降的黑熊
        const k = f ? p.frameTime / f.duration : 1;
        const by = HZ + p.z - Math.max(0, 1 - k * 2.2) * 260;
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#141414';
        ctx.beginPath();
        ctx.ellipse(x, by - 14, 13, 14, 0, 0, Math.PI * 2);
        ctx.arc(x, by - 32, 10, 0, Math.PI * 2);
        ctx.arc(x - 8, by - 40, 4, 0, Math.PI * 2);
        ctx.arc(x + 8, by - 40, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f5f5f5';
        ctx.beginPath();
        ctx.moveTo(x - 7, by - 22);
        ctx.lineTo(x + 7, by - 22);
        ctx.lineTo(x, by - 16);
        ctx.fill();
        ctx.fillStyle = '#c8a27a';
        ctx.beginPath();
        ctx.arc(x, by - 30, 4, 0, Math.PI * 2);
        ctx.fill();
        if (k > 0.45) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(x, HZ + p.z, 24 * k, 8 * k, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 'laugh':
      case 'zan':
      case 'talk':
      case 'fired':
      case 'joke':
      case 'shout':
      case 'score':
      case 'ad': {
        // 文字聲波：哈哈 / 讚啦 / 質詢 / 你被開除！ / 哈！
        const words: Record<string, string> = { laugh: '哈哈', zan: '讚啦', talk: '質詢！', fired: '你被開除！', joke: '哈！', shout: '說清楚！', score: '10分！', ad: '業配！' };
        const word = words[pose] ?? '！';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        for (let i = 0; i < 2; i++) {
          ctx.globalAlpha = 0.8 - i * 0.3;
          ctx.beginPath();
          ctx.arc(x - p.facing * (6 + i * 8), y, 16 - i * 3, p.facing > 0 ? -1 : Math.PI - 1, p.facing > 0 ? 1 : Math.PI + 1);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.font = `bold 15px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.strokeText(word, x + p.facing * 4, y + 5);
        ctx.fillStyle = '#fff';
        ctx.fillText(word, x + p.facing * 4, y + 5);
        ctx.textAlign = 'left';
        break;
      }
      case 'abc':
      case 'slipper':
      case 'frog':
      case 'dumbbell':
      case 'mic':
      case 'candle':
      case 'cat':
      case 'dog':
      case 'box':
      case 'coin':
      case 'cabbage':
      case 'fish':
      case 'evidence':
      case 'tweet':
      case 'bun':
      case 'pudding':
      case 'sunflower':
        ctx.shadowBlur = 0;
        drawIcon(ctx, pose, x, y, ICON_SCALE[pose] ?? 1, p.facing, color, w.tick, p.id);
        break;
      case 'bookdrop':
      case 'slipperdrop':
      case 'laughdrop':
      case 'frogdrop':
      case 'candledrop':
      case 'towerdrop':
      case 'bundrop':
      case 'puddingdrop':
      case 'sunflowerdrop':
      case 'fireworkdrop':
      case 'catdrop':
      case 'coindrop':
      case 'evidencedrop':
      case 'boxdrop':
      case 'giftdrop': {
        const k = f ? p.frameTime / f.duration : 1;
        const by = HZ + p.z - Math.max(0, 1 - k * 2.2) * 260;
        ctx.shadowBlur = 0;
        drawIcon(ctx, pose.replace('drop', ''), x, by - 16, DROP_SCALE[pose] ?? 1.8, 1, color, w.tick, p.id);
        if (k > 0.45) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(x, HZ + p.z, 24 * k, 8 * k, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      default:
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, s / 2, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
  }

  /** 命中火花（LF2 風格）：一般命中是白色小星芒、重擊是黃白爆星加放射線、被擋下是藍色護盾弧 */
  private drawSpark(ctx: CanvasRenderingContext2D, s: Spark, cam: number): void {
    const x = s.x - cam;
    const y = HZ + s.z - s.y;
    const age = SPARK_TICKS - s.t;
    const k = s.t / SPARK_TICKS;
    ctx.save();
    if (s.blocked) {
      ctx.strokeStyle = `rgba(127,214,255,${0.9 * k})`;
      ctx.lineWidth = 3;
      const r = 10 + age * 2;
      const a0 = s.seed % 2 ? Math.PI * 0.7 : -Math.PI * 0.3;
      ctx.beginPath();
      ctx.arc(x, y, r, a0, a0 + Math.PI * 0.6);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${k})`;
      ctx.beginPath();
      ctx.arc(x, y, 3 * k + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const pop = age < 2 ? 0.7 + age * 0.25 : 1 + (age - 2) * 0.05;
    const R = (s.heavy ? 20 : 11) * pop;
    const pts = s.heavy ? 8 : 4;
    const rot = s.seed * 0.7;
    // 星芒本體
    ctx.globalAlpha = Math.min(1, k * 1.6);
    ctx.beginPath();
    for (let i = 0; i < pts * 2; i++) {
      const a = rot + (i / (pts * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? R : R * (s.heavy ? 0.42 : 0.32);
      if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
    // 星芒外框用攻擊者的代表色
    ctx.fillStyle = s.heavy ? (s.colors ? mixWhite(s.colors[1]) : '#fff3a0') : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = s.colors ? s.colors[0] : s.heavy ? '#ff8a1f' : '#ffd166';
    ctx.lineWidth = s.heavy ? 2.2 : 1.4;
    ctx.stroke();
    // 中心亮點
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, R * 0.28, 0, Math.PI * 2);
    ctx.fill();
    if (s.heavy) {
      // 放射線 + 外擴的衝擊環
      ctx.strokeStyle = s.colors ? rgba(s.colors[0], k) : `rgba(255,220,120,${k})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = rot * 1.3 + (i / 10) * Math.PI * 2;
        const r0 = R * 0.9 + age * 3;
        const r1 = r0 + 10 * k;
        ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
        ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      }
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * k})`;
      ctx.lineWidth = 2.5 * k + 0.5;
      ctx.beginPath();
      ctx.ellipse(x, y, R * 1.2 + age * 4, (R * 1.2 + age * 4) * 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private moveOf(w: World, charId: string, frame: string): { mp: number; name: string } | undefined {
    let m = this.moveIndex.get(charId);
    if (!m) {
      m = new Map(w.data.characters[charId].moves.map((mv) => [mv.startFrame, { mp: mv.mp, name: mv.name }]));
      this.moveIndex.set(charId, m);
    }
    return m.get(frame);
  }

  private nearestFoe(w: World, e: Entity): Entity | undefined {
    let best: Entity | undefined;
    let bd = Infinity;
    for (const c of w.chars()) {
      if (c.team === e.team || c.hp <= 0) continue;
      const d = Math.abs(c.x - e.x) + Math.abs(c.z - e.z) * 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** 手腳掃過的弧形殘影（動畫的 smear）：白色月牙加角色色外緣 */
  private drawSmears(ctx: CanvasRenderingContext2D, prev: Joints, cur: Joints, color: string): void {
    ctx.save();
    for (const key of ['fHand', 'fFoot', 'bHand', 'bFoot'] as const) {
      const a = prev[key];
      const b = cur[key];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 5) continue;
      // 月牙往行進方向的外側鼓起
      const nx = -dy / len;
      const ny = dx / len;
      const bulge = Math.min(14, len * 0.45);
      const mx = (a.x + b.x) / 2 + nx * bulge;
      const my = (a.y + b.y) / 2 + ny * bulge;
      const mx2 = (a.x + b.x) / 2 + nx * bulge * 0.35;
      const my2 = (a.y + b.y) / 2 + ny * bulge * 0.35;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.quadraticCurveTo(mx2, my2, a.x, a.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.fill();
      ctx.strokeStyle = rgba(color, 0.6);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 飛行物命中：依圖示種類噴出不同的碎片 */
  private impact(pose: string, x: number, y: number, z: number, accent: string): void {
    const kinds: Record<string, { shape: Frag['shape']; colors: string[]; n: number }> = {
      cabbage: { shape: 'leaf', colors: ['#84cc16', '#bef264', '#4d7c0f'], n: 7 },
      sunflower: { shape: 'leaf', colors: ['#facc15', '#fde047', '#a16207'], n: 7 },
      frog: { shape: 'splat', colors: ['#22c55e', '#86efac'], n: 5 },
      abc: { shape: 'paper', colors: ['#ffffff', '#dbeafe'], n: 6 },
      doc: { shape: 'paper', colors: ['#ffffff', '#fef3c7'], n: 7 },
      evidence: { shape: 'paper', colors: ['#ffffff', '#fed7aa'], n: 7 },
      book: { shape: 'paper', colors: ['#ffffff', '#fecaca'], n: 6 },
      scorecard: { shape: 'paper', colors: ['#ffffff', '#fecaca'], n: 5 },
      ticket: { shape: 'paper', colors: ['#ffffff', '#99f6e4'], n: 5 },
      tweet: { shape: 'leaf', colors: ['#38bdf8', '#e0f2fe'], n: 6 },
      box: { shape: 'paper', colors: ['#d4a373', '#a16207', '#ffffff'], n: 8 },
      gift: { shape: 'paper', colors: ['#f43f5e', '#fde047', '#ffffff'], n: 8 },
      pudding: { shape: 'splat', colors: ['#fde68a', '#b45309'], n: 7 },
      bun: { shape: 'puff', colors: ['#ffffff', '#f1f5f9'], n: 5 },
      firework: { shape: 'spark', colors: ['#f43f5e', '#facc15', '#60a5fa', '#a3e635'], n: 12 },
      rocket: { shape: 'spark', colors: ['#fb923c', '#facc15'], n: 9 },
      explosion: { shape: 'spark', colors: ['#fb923c', '#facc15', '#ffffff'], n: 10 },
      shock: { shape: 'spark', colors: ['#22d3ee', '#ffffff'], n: 8 },
      pill: { shape: 'splat', colors: ['#f87171', '#ffffff'], n: 5 },
      syringe: { shape: 'splat', colors: ['#7dd3fc', '#ffffff'], n: 5 },
      slipper: { shape: 'puff', colors: ['#e5e7eb', '#cbd5e1'], n: 4 },
      dumbbell: { shape: 'puff', colors: ['#d6d3d1', '#a8a29e'], n: 5 },
      moon: { shape: 'spark', colors: ['#fef9c3', '#fde68a'], n: 8 },
    };
    const k = kinds[pose] ?? (pose === 'coin' ? undefined : { shape: 'spark' as const, colors: [accent, '#ffffff'], n: 6 });
    if (!k) return; // 金幣由招牌圖示處理
    const n = lowQuality ? Math.ceil(k.n / 2) : k.n;
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const sp = k.shape === 'spark' ? 3 + this.rand() * 4 : 1.5 + this.rand() * 2.5;
      this.frags.push({
        x,
        y: Math.max(4, y),
        z,
        vx: Math.cos(a) * sp,
        vy: (k.shape === 'puff' ? 0.4 : 2) + this.rand() * 3,
        vz: Math.sin(a) * sp * 0.3,
        rot: this.rand() * 6,
        vr: (this.rand() - 0.5) * 0.5,
        t: k.shape === 'spark' ? 16 : 40,
        life: k.shape === 'spark' ? 16 : 40,
        shape: k.shape,
        color: k.colors[i % k.colors.length],
        size: k.shape === 'puff' ? 6 + this.rand() * 4 : 2.5 + this.rand() * 2,
      });
    }
  }

  private drawFrag(ctx: CanvasRenderingContext2D, f: Frag, cam: number): void {
    const x = f.x - cam;
    const y = HZ + f.z - f.y;
    const fade = Math.min(1, f.t / 10);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(x, y);
    ctx.rotate(f.rot);
    ctx.fillStyle = f.color;
    switch (f.shape) {
      case 'leaf':
        ctx.beginPath();
        ctx.ellipse(0, 0, f.size * 1.4, f.size * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-f.size * 1.2, 0);
        ctx.lineTo(f.size * 1.2, 0);
        ctx.stroke();
        break;
      case 'paper':
        ctx.fillRect(-f.size, -f.size * 0.75, f.size * 2, f.size * 1.5);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.7;
        ctx.strokeRect(-f.size, -f.size * 0.75, f.size * 2, f.size * 1.5);
        break;
      case 'splat':
        // 落地後壓扁成一灘
        ctx.rotate(-f.rot);
        ctx.beginPath();
        if (f.y <= 0) ctx.ellipse(0, 0, f.size * 1.8, f.size * 0.6, 0, 0, Math.PI * 2);
        else ctx.arc(0, 0, f.size, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'puff':
        ctx.globalAlpha = fade * 0.6;
        ctx.beginPath();
        ctx.arc(0, 0, f.size * (1.6 - f.t / f.life * 0.6), 0, Math.PI * 2);
        ctx.fill();
        break;
      default: {
        // 火花：沿速度方向的短亮線
        ctx.rotate(-f.rot);
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-f.vx * 2.2, f.vy * 2.2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private addDecal(d: { x: number; z: number; r: number; kind: Decal['kind'] }): void {
    const life = d.kind === 'crack' ? 300 : 240;
    this.decals.push({ ...d, t: life, life, seed: this.rand() * 1000 });
    if (this.decals.length > MAX_DECALS) this.decals.shift();
  }

  /** 地面痕跡：畫在場景上、角色與影子下面 */
  private drawDecal(ctx: CanvasRenderingContext2D, d: Decal, cam: number): void {
    const x = d.x - cam;
    const y = HZ + d.z;
    const a = Math.min(1, d.t / 60) * (d.t > d.life - 6 ? (d.life - d.t) / 6 : 1);
    ctx.save();
    ctx.globalAlpha = a;
    if (d.kind === 'crack') {
      // 放射狀的鋸齒裂痕（地面透視：前後方向壓扁）
      const n = 7;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + d.seed;
        const len = d.r * (0.55 + ((d.seed * (i + 3)) % 1) * 0.45);
        ctx.beginPath();
        ctx.moveTo(x, y);
        let px = x;
        let py = y;
        for (let s = 1; s <= 4; s++) {
          const jit = Math.sin(d.seed + i * 7 + s * 3) * 0.35;
          px = x + Math.cos(ang + jit) * len * (s / 4);
          py = y + Math.sin(ang + jit) * len * (s / 4) * 0.35;
          ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'rgba(40,28,20,0.55)';
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,240,220,0.25)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    } else if (d.kind === 'crater') {
      const g = ctx.createRadialGradient(x, y, 2, x, y, d.r);
      g.addColorStop(0, 'rgba(30,22,16,0.55)');
      g.addColorStop(0.7, 'rgba(60,45,35,0.35)');
      g.addColorStop(1, 'rgba(60,45,35,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, d.r, d.r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,240,220,0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y - 1, d.r * 0.8, d.r * 0.27, 0, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else {
      // 焦痕：不規則的黑灰
      ctx.fillStyle = 'rgba(25,20,18,0.45)';
      ctx.beginPath();
      for (let i = 0; i <= 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        const rr = d.r * (0.75 + 0.25 * Math.sin(d.seed + i * 2.3));
        const px = x + Math.cos(ang) * rr;
        const py = y + Math.sin(ang) * rr * 0.35;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** 從 (x, y, z) 往四周噴出招牌圖示 */
  private burst(x: number, y: number, z: number, icons: [string, string], colors: [string, string], n: number, power: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const sp = (2 + this.rand() * 3) * power;
      this.bits.push({
        x,
        y,
        z,
        vx: Math.cos(a) * sp,
        vy: 3 + this.rand() * 4 * power,
        vz: Math.sin(a) * sp * 0.25,
        t: 34,
        life: 34,
        icon: icons[i % 2],
        color: colors[i % 2],
        spin: (this.rand() - 0.5) * 0.6,
        scale: 0.9 + this.rand() * 0.5,
        fall: true,
      });
    }
  }

  /** 傷害數字：往上飄、淡出；重擊大一點，被擋下的灰色小字 */
  private drawDmg(ctx: CanvasRenderingContext2D, d: DmgNum, cam: number): void {
    const age = DMG_TICKS - d.t;
    const pop = age < 5 ? 0.6 + age * 0.1 : 1;
    const size = (d.blocked ? 11 : d.heavy ? 20 : 15) * pop;
    ctx.save();
    ctx.globalAlpha = Math.min(1, d.t / 14);
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    const x = d.x - cam;
    const y = HZ + d.z - d.y;
    ctx.lineWidth = d.blocked ? 3 : 4;
    ctx.strokeStyle = '#1a1530';
    ctx.strokeText(`${d.value}`, x, y);
    ctx.fillStyle = d.blocked ? '#cbd5e1' : d.heavy ? mixWhite(d.color ?? '#ffd166') : '#ffffff';
    ctx.fillText(`${d.value}`, x, y);
    if (!d.blocked && d.heavy && d.color) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = d.color;
      ctx.strokeText(`${d.value}`, x, y);
    }
    ctx.restore();
  }

  /** 連擊數：「3 HIT!」斜斜地跳出來，越多下越大 */
  private drawCombo(ctx: CanvasRenderingContext2D, k: ComboTag, cam: number): void {
    const age = COMBO_TICKS - k.t;
    const pop = age < 6 ? 0.5 + age * 0.1 : 1;
    const size = Math.min(30, 18 + k.n * 1.5) * pop;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k.t / 12);
    ctx.translate(k.x - cam + 26, HZ + k.z - k.y);
    ctx.transform(1, 0, -0.18, 1, 0, 0);
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#1a1530';
    ctx.strokeText(`${k.n} HIT!`, 0, 0);
    ctx.fillStyle = mixWhite(k.color);
    ctx.fillText(`${k.n} HIT!`, 0, 0);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = k.color;
    ctx.strokeText(`${k.n} HIT!`, 0, 0);
    ctx.restore();
  }

  /** KO 爆字：大大的「K.O.!」加放射線 */
  private drawKo(ctx: CanvasRenderingContext2D, k: KoSplash, cam: number): void {
    const age = KO_TICKS - k.t;
    const x = k.x - cam;
    const y = HZ + k.z - k.y - 30;
    const pop = age < 6 ? 0.4 + age * 0.12 : 1 + Math.sin(age * 0.3) * 0.03;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k.t / 12);
    ctx.translate(x, y);
    ctx.strokeStyle = rgba(k.colors[0], 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r0 = 26 + age * 2.2;
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 * 0.7);
      ctx.lineTo(Math.cos(a) * (r0 + 16), Math.sin(a) * (r0 + 16) * 0.7);
    }
    ctx.stroke();
    ctx.rotate(-0.12);
    ctx.scale(pop, pop);
    ctx.font = `900 34px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#1a1530';
    ctx.strokeText('K.O.!', 0, 12);
    ctx.lineWidth = 3;
    ctx.strokeStyle = k.colors[0];
    ctx.strokeText('K.O.!', 0, 12);
    ctx.fillStyle = mixWhite(k.colors[1]);
    ctx.fillText('K.O.!', 0, 12);
    ctx.restore();
  }

  /** 大招切入：畫面變暗，一條斜帶從左邊滑進來，上面是角色大頭像與招式名，背景是速度線 */
  private drawCutIn(ctx: CanvasRenderingContext2D, w: World, c: CutIn): void {
    const e = w.get(c.id);
    if (!e) return;
    const def = w.charDef(e);
    const sig = signatureOf(c.charId, def.palette.accent);
    const age = CUTIN_TICKS - c.t;
    const inK = Math.min(1, age / 7);
    const outK = Math.min(1, c.t / 7);
    const slide = (1 - inK) * -VW + (1 - outK) * VW;
    const ox = viewOffset();
    const W = VW + ox * 2;
    ctx.save();
    // 畫面變暗（前半段）
    ctx.fillStyle = `rgba(10,5,25,${0.38 * Math.min(inK, outK)})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const top = 70;
    const h = 96;
    ctx.translate(slide, 0);
    // 斜帶
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0, sig.colors[0]);
    g.addColorStop(1, shade(sig.colors[0], -0.45));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-20, top + 14);
    ctx.lineTo(W + 20, top);
    ctx.lineTo(W + 20, top + h - 14);
    ctx.lineTo(-20, top + h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = sig.colors[1];
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.save();
    ctx.clip();
    // 速度線
    if (!lowQuality) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const ly = top + 8 + ((i * 37) % (h - 12));
        const lx = ((i * 173 + age * 38) % (W + 200)) - 100;
        ctx.moveTo(W - lx, ly);
        ctx.lineTo(W - lx - 60 - (i % 3) * 30, ly + 3);
      }
      ctx.stroke();
      // 招牌圖示點綴
      for (let i = 0; i < 5; i++) drawIcon(ctx, sig.icons[i % 2], ((i * 211 + age * 6) % W), top + 20 + ((i * 29) % (h - 30)), 1.1, 1, sig.colors[1], w.tick, i);
    }
    // 角色大頭像（從左邊往右推一點）
    drawFigure(ctx, def, { pose: getPose('victory'), x: ox + 120 + age * 0.6, y: top + h + 70, facing: 1, scale: 2.5, tick: w.tick, upperOnly: true, sticker: true, expression: 'attack', sway: 0.4 });
    ctx.restore();
    // 招式名
    ctx.font = `900 34px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    const tx = ox + VW / 2 + 70;
    const ty = top + h / 2 + 12;
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#1a1530';
    ctx.strokeText(c.name, tx, ty);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(c.name, tx, ty);
    ctx.font = `900 13px ${FONT}`;
    ctx.fillStyle = sig.colors[1];
    ctx.fillText(`${def.name}　必殺技！`, tx, ty + 22);
    ctx.restore();
  }

  /** 放招時的集氣：光點從外圍往身體收攏，最後亮一下 */
  private drawCharge(ctx: CanvasRenderingContext2D, k: { t: number; color: string; colors: [string, string]; aura: AuraStyle; big: boolean }, e: Entity, cam: number, tick: number): void {
    // 集氣中心在身體（不蓋住臉）
    const x = e.x - cam;
    const y = screenY(e) - 22;
    const total = k.big ? CHARGE_TICKS * 2 : CHARGE_TICKS;
    // 招牌氣場：大招更大、更久
    drawAura(ctx, k.aura, x, y, (k.big ? 34 : 26) + 10 * (k.t / total), Math.min(1, (k.t / total) * 1.6), k.colors, tick, e.id);
    if (k.big && !lowQuality) {
      // 大招：腳下一圈光環
      ctx.save();
      ctx.strokeStyle = rgba(k.colors[0], 0.8 * (k.t / total));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, y + 22, 30 + (1 - k.t / total) * 24, 9 + (1 - k.t / total) * 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (k.t > CHARGE_TICKS) return;
    const p = k.t / CHARGE_TICKS;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + e.id;
      const r = 12 + 44 * p;
      ctx.globalAlpha = 0.9 * (1 - p * 0.6);
      ctx.fillStyle = i % 2 ? '#ffffff' : k.color;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8, 2.6 - p, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = k.color;
      ctx.globalAlpha = 0.35 * (1 - p);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8);
      ctx.lineTo(x + Math.cos(a) * (r + 10), y + Math.sin(a) * (r + 10) * 0.8);
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(x, y, 0, x, y, 26);
    g.addColorStop(0, hexA('#ffffff', 0.28 * (1 - p)));
    g.addColorStop(0.5, hexA(k.color, 0.2 * (1 - p)));
    g.addColorStop(1, hexA(k.color, 0));
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawHud(ctx: CanvasRenderingContext2D, w: World, extra?: string): void {
    const players = w
      .chars()
      .filter((c) => c.slot >= 0)
      .sort((a, b) => a.slot - b.slot);
    const ox = viewOffset();
    players.forEach((c) => {
      const px = ox + c.slot * 200 + 4;
      drawPanel(ctx, w.charDef(c), c, px, 4, this.hpLag.get(c.id) ?? c.hp, w.tick);
    });
    if (extra) {
      ctx.font = `bold 13px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const tw = ctx.measureText(extra).width;
      ctx.fillRect(VW - tw - 16, 54, tw + 12, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(extra, VW - 10, 69);
      ctx.textAlign = 'left';
    }
    const boss = w.chars().find((c) => c.boss && c.team === ENEMY_TEAM && c.hp > 0);
    if (boss) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(ox + 200, 420, 400, 14);
      ctx.fillStyle = '#ff3b3b';
      ctx.fillRect(ox + 202, 422, (396 * boss.hp) / boss.maxHp, 10);
      ctx.font = `bold 11px ${FONT}`;
      ctx.fillStyle = '#fff';
      ctx.fillText(`頭目 · 強化${w.charDef(boss).name}`, ox + 206, 416);
    }
    if (this.banner) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.banner.t / 20);
      ctx.font = `bold 32px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#000';
      ctx.strokeText(this.banner.text, VW / 2, 150);
      ctx.fillStyle = '#ffe14d';
      ctx.fillText(this.banner.text, VW / 2, 150);
      ctx.restore();
    }
  }
}

export const SLOT_COLORS = ['#ff5a5a', '#4da6ff', '#5ae07a', '#ffc94d'];

export function drawPanel(ctx: CanvasRenderingContext2D, def: CharacterDef, c: Entity, x: number, y: number, lag: number, tick: number): void {
  const col = SLOT_COLORS[c.slot] ?? '#fff';
  // 底板：深色 + 隊伍色上緣 + 粗描邊（荒野亂鬥式）
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, x, y + 3, 192, 46, 9);
  ctx.fill();
  ctx.fillStyle = 'rgba(16,14,40,0.88)';
  roundRect(ctx, x, y, 192, 46, 9);
  ctx.fill();
  ctx.fillStyle = col;
  roundRect(ctx, x + 2, y + 2, 188, 6, 4);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  roundRect(ctx, x, y, 192, 46, 9);
  ctx.stroke();
  // 頭像
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 5, y + 6, 37, 36);
  ctx.clip();
  ctx.fillStyle = shade(def.palette.accent, -0.45);
  ctx.fillRect(x + 5, y + 6, 37, 36);
  drawFigure(ctx, def, { pose: getPose(c.hp > 0 ? 'idle_0' : 'hurt'), x: x + 20, y: y + 70, facing: 1, scale: 0.86, tick, upperOnly: true, alpha: c.hp > 0 ? 1 : 0.5, expression: c.hp > 0 ? 'normal' : 'hurt' });
  ctx.restore();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 5, y + 6, 37, 36);
  text(ctx, `${c.ai ? 'COM' : `${c.slot + 1}P`} ${def.name}`, x + 48, y + 21, 12, '#ffffff', 'left', true, true);
  text(ctx, `${Math.ceil(c.hp)}`, x + 186, y + 21, 11, '#e2e8f0', 'right', true, true);
  const bw = 136;
  // HP 條（含殘影與每 100 HP 一格的分隔線）
  const hx = x + 48;
  const hy = y + 25;
  ctx.fillStyle = '#2b2440';
  ctx.fillRect(hx, hy, bw, 9);
  ctx.fillStyle = '#ff5a5a';
  ctx.fillRect(hx, hy, (bw * Math.max(0, lag)) / c.maxHp, 9);
  const hpG = ctx.createLinearGradient(0, hy, 0, hy + 9);
  hpG.addColorStop(0, '#8dff6a');
  hpG.addColorStop(1, '#2fbf3a');
  ctx.fillStyle = hpG;
  ctx.fillRect(hx, hy, (bw * Math.max(0, c.hp)) / c.maxHp, 9);
  ctx.fillStyle = 'rgba(16,14,40,0.7)';
  for (let v = 100; v < c.maxHp; v += 100) ctx.fillRect(hx + (bw * v) / c.maxHp - 0.5, hy, 1.5, 9);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(hx, hy, bw, 9);
  // MP 條
  const my = y + 37;
  ctx.fillStyle = '#2b2440';
  ctx.fillRect(hx, my, bw, 5);
  ctx.fillStyle = c.mp >= CONFIG.combat.mpMax ? '#7dd3fc' : '#3b82f6';
  ctx.fillRect(hx, my, (bw * c.mp) / CONFIG.combat.mpMax, 5);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(hx, my, bw, 5);
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.fill();
}

/** 飛行物與天降攻擊共用的小圖示，(x,y) 為中心 */
export function drawIcon(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, sc: number, facing: number, color: string, tick: number, seed: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc * facing, sc);
  switch (kind) {
    case 'abc': {
      ctx.rotate(Math.sin(tick * 0.3 + seed) * 0.3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-8, -6, 16, 12);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-8, -6, 16, 12);
      ctx.fillStyle = '#1e3a8a';
      ctx.font = `bold 8px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('ABC'.charAt(seed % 3), 0, 3);
      break;
    }
    case 'book':
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(-8, -10, 16, 20);
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(6, -9, 2, 18);
      ctx.fillStyle = '#fff';
      ctx.font = `bold 6px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('ABC', -1, 2);
      break;
    case 'slipper':
      ctx.rotate(tick * 0.4);
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(-3, -5, 4, 10);
      break;
    case 'laugh':
      ctx.font = `bold 20px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000';
      ctx.strokeText('哈', 0, 7);
      ctx.fillStyle = color;
      ctx.fillText('哈', 0, 7);
      break;
    case 'frog':
      ctx.fillStyle = '#16a34a';
      ctx.beginPath();
      ctx.ellipse(0, 2, 9, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const ex of [-4, 4]) {
        ctx.fillStyle = '#16a34a';
        ctx.beginPath();
        ctx.arc(ex, -4, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ex + 0.6, -4.4, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.fillRect(ex + 0.6, -5, 1, 1.2);
      }
      ctx.fillStyle = '#86efac';
      ctx.fillRect(-4, 4, 8, 1.5);
      break;
    case 'dumbbell':
      ctx.rotate(tick * 0.25);
      ctx.fillStyle = '#9ca3af';
      ctx.fillRect(-7, -1.5, 14, 3);
      ctx.fillStyle = '#374151';
      ctx.fillRect(-11, -6, 5, 12);
      ctx.fillRect(6, -6, 5, 12);
      break;
    case 'mic':
      ctx.rotate(tick * 0.35);
      ctx.fillStyle = '#222';
      ctx.fillRect(-1.5, -2, 3, 10);
      ctx.fillStyle = '#9ca3af';
      ctx.beginPath();
      ctx.arc(0, -4, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'pill': {
      ctx.rotate(tick * 0.2 + seed);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(-3, 0, 4, Math.PI / 2, Math.PI * 1.5);
      ctx.lineTo(0, -4);
      ctx.lineTo(0, 4);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(3, 0, 4, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(0, 4);
      ctx.lineTo(0, -4);
      ctx.fill();
      break;
    }
    case 'bearhead': {
      ctx.fillStyle = '#1f1f1f';
      for (const ex of [-6, 6]) {
        ctx.beginPath();
        ctx.arc(ex, -6, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath();
      ctx.moveTo(-5, 2);
      ctx.lineTo(0, 5.5);
      ctx.lineTo(5, 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'doc': {
      ctx.rotate(Math.sin(tick * 0.2 + seed) * 0.4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-7, -9, 14, 18);
      ctx.fillStyle = '#93c5fd';
      for (let r = 0; r < 4; r++) ctx.fillRect(-5, -6 + r * 4, 10, 1.6);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(4, 6, 2.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bolt': {
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(2, -10);
      ctx.lineTo(-5, 1);
      ctx.lineTo(0, 1);
      ctx.lineTo(-2, 10);
      ctx.lineTo(6, -2);
      ctx.lineTo(1, -2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'star':
      star(ctx, 0, 0, 8, color);
      break;
    case 'box': {
      // 開箱用的紙箱（膠帶十字）
      ctx.rotate(Math.sin(tick * 0.25 + seed) * 0.3);
      ctx.fillStyle = '#c8935a';
      ctx.strokeStyle = '#7a5530';
      ctx.lineWidth = 1.2;
      ctx.fillRect(-8, -7, 16, 14);
      ctx.strokeRect(-8, -7, 16, 14);
      ctx.fillStyle = '#e8d7b5';
      ctx.fillRect(-1.5, -7, 3, 14);
      ctx.fillStyle = '#7a5530';
      ctx.fillRect(-8, -7, 16, 2.4);
      break;
    }
    case 'gift': {
      ctx.rotate(Math.sin(tick * 0.25 + seed) * 0.3);
      ctx.fillStyle = seed % 2 ? '#8b5cf6' : '#ec4899';
      ctx.fillRect(-8, -6, 16, 13);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-1.6, -6, 3.2, 13);
      ctx.fillRect(-8, -1, 16, 3);
      ctx.beginPath();
      ctx.ellipse(-3, -8, 3.4, 2, -0.5, 0, Math.PI * 2);
      ctx.ellipse(3, -8, 3.4, 2, 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'note': {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(-2, 5, 4, 3, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(1.2, -9, 1.8, 14);
      ctx.beginPath();
      ctx.moveTo(3, -9);
      ctx.quadraticCurveTo(9, -7, 7, -2);
      ctx.lineTo(3, -5);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'chili': {
      ctx.rotate(Math.sin(tick * 0.2 + seed) * 0.5);
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.moveTo(-6, -3);
      ctx.quadraticCurveTo(2, -4, 7, 4);
      ctx.quadraticCurveTo(0, 2, -6, 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#16a34a';
      ctx.fillRect(-8, -3, 3, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(-3, -2.6, 4, 1);
      break;
    }
    case 'coin': {
      const sq = Math.abs(Math.cos(tick * 0.2 + seed));
      ctx.scale(Math.max(0.25, sq), 1);
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = '#a16207';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#a16207';
      ctx.font = `900 9px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('$', 0, 3.5);
      break;
    }
    case 'cabbage': {
      ctx.rotate(tick * 0.25 + seed);
      ctx.fillStyle = '#86efac';
      ctx.strokeStyle = '#15803d';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-6, -2);
      ctx.quadraticCurveTo(0, -7, 6, -2);
      ctx.moveTo(-5, 3);
      ctx.quadraticCurveTo(0, -1, 5, 3);
      ctx.stroke();
      break;
    }
    case 'fish': {
      const wag = Math.sin(tick * 0.5 + seed) * 2;
      ctx.fillStyle = '#60a5fa';
      ctx.strokeStyle = '#1e3a8a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(-14, -5 + wag);
      ctx.lineTo(-14, 5 + wag);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.fillRect(4, -2, 1.6, 1.6);
      break;
    }
    case 'evidence': {
      // 證據資料夾
      ctx.rotate(Math.sin(tick * 0.3 + seed) * 0.35);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(-9, -7, 18, 14);
      ctx.fillRect(-9, -9, 7, 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-6, -4, 12, 8);
      ctx.fillStyle = '#dc2626';
      ctx.font = `900 6px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('證據', 0, 2);
      break;
    }
    case 'cat': {
      // 灰色虎斑貓（想想 / 阿才）：往前撲的姿勢
      const bob = Math.sin(tick * 0.4 + seed) * 1.2;
      ctx.translate(0, bob);
      ctx.fillStyle = '#b9b2a8';
      ctx.strokeStyle = '#5a4a3e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(-2, 1, 7, 4.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(3, -4);
      ctx.lineTo(4.5, -9);
      ctx.lineTo(6.5, -5.5);
      ctx.lineTo(9.5, -8);
      ctx.lineTo(9.5, -3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(6.5, -1.5, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#7d7368';
      ctx.beginPath();
      ctx.moveTo(-6, -2);
      ctx.lineTo(-5, 1);
      ctx.moveTo(-3, -2.6);
      ctx.lineTo(-2, 0.6);
      ctx.moveTo(-9, 0);
      ctx.quadraticCurveTo(-13, -4, -11, -7);
      ctx.stroke();
      ctx.fillStyle = '#2b211c';
      ctx.fillRect(5.4, -2.6, 1, 1.4);
      ctx.fillRect(8.2, -2.6, 1, 1.4);
      ctx.fillStyle = '#f29aa3';
      ctx.fillRect(6.9, -0.8, 1, 0.8);
      break;
    }
    case 'dog': {
      // 米色狗狗（戴小方巾）：奔跑
      const step = Math.sin(tick * 0.6 + seed) * 2;
      ctx.fillStyle = '#e9d3a8';
      ctx.strokeStyle = '#6b5536';
      ctx.lineWidth = 1;
      for (const lx of [-6, -3, 4, 7]) {
        ctx.fillRect(lx + (lx < 0 ? step : -step) * 0.5, 3, 2.4, 6);
      }
      ctx.beginPath();
      ctx.ellipse(0, 1, 9, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(9, -4, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#c9a774';
      ctx.beginPath();
      ctx.ellipse(6, -6, 2, 3.6, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5fb3a1';
      ctx.beginPath();
      ctx.moveTo(5, -1);
      ctx.lineTo(10, 1);
      ctx.lineTo(6, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2b211c';
      ctx.fillRect(10, -5.5, 1.2, 1.4);
      ctx.beginPath();
      ctx.arc(13.6, -3.4, 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#6b5536';
      ctx.beginPath();
      ctx.moveTo(-9, -1);
      ctx.quadraticCurveTo(-13, -5, -11, -8);
      ctx.stroke();
      break;
    }
    case 'tweet': {
      // 推文對話框
      ctx.rotate(Math.sin(tick * 0.25 + seed) * 0.15);
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.ellipse(0, -1, 10, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-5, 4);
      ctx.lineTo(-8, 9);
      ctx.lineTo(-1, 5);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold 10px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('#', 0, 3);
      break;
    }
    case 'bun': {
      // 包子：白色圓頂 + 褶子
      ctx.fillStyle = '#fdf6e3';
      ctx.beginPath();
      ctx.ellipse(0, 1, 10, 7.5, 0, Math.PI, Math.PI * 2);
      ctx.lineTo(10, 4);
      ctx.lineTo(-10, 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#d6c7a1';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      for (const a of [-0.9, -0.3, 0.3, 0.9]) {
        ctx.moveTo(0, -6);
        ctx.lineTo(Math.sin(a) * 7, -6 + Math.cos(a) * 4);
      }
      ctx.stroke();
      break;
    }
    case 'pudding': {
      // 布丁：會晃的焦糖布丁
      const wob = Math.sin(tick * 0.5 + seed) * 1.5;
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(-10, 7);
      ctx.lineTo(10, 7);
      ctx.lineTo(7 + wob, -5);
      ctx.lineTo(-7 + wob, -5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#92400e';
      ctx.beginPath();
      ctx.ellipse(wob, -5, 7, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(-6, -1, 2, 6);
      break;
    }
    case 'sunflower': {
      ctx.rotate(tick * 0.3 + seed);
      ctx.fillStyle = '#facc15';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * 7, Math.sin(a) * 7, 4, 2, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#78350f';
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'tower': {
      // 金色大樓
      ctx.fillStyle = '#d4a017';
      ctx.fillRect(-7, -16, 14, 30);
      ctx.fillStyle = '#fde68a';
      for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) ctx.fillRect(-5 + c * 4, -13 + r * 4.5, 2.4, 2.6);
      ctx.fillStyle = '#b45309';
      ctx.fillRect(-9, 13, 18, 3);
      break;
    }
    case 'firework': {
      // 天降煙火：小火箭 + 爆開的星星
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-2, -2, 4, 12);
      ctx.beginPath();
      ctx.moveTo(-3, -2);
      ctx.lineTo(0, -8);
      ctx.lineTo(3, -2);
      ctx.fill();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + tick * 0.2;
        star(ctx, Math.cos(a) * 11, -10 + Math.sin(a) * 8, 3.2, i % 2 ? '#facc15' : '#f472b6');
      }
      break;
    }
    case 'candle': {
      const up = seed % 2 === 0;
      const c = up ? '#ef4444' : '#22c55e';
      ctx.fillStyle = c;
      ctx.fillRect(-0.8, -10, 1.6, 20);
      ctx.fillRect(-4, -6, 8, 12);
      break;
    }
  }
  ctx.restore();
}
