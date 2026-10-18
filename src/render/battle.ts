// 戰鬥畫面繪製：相機、z 排序、陰影、特效、HUD。
import { CONFIG } from '../config';
import type { CharacterDef } from '../data/load';
import { hasBuff, type Entity } from '../sim/entity';
import { ENEMY_TEAM, type GameEvent, type World } from '../sim/world';
import { drawFigure, drawItemShape, roundRect, shade } from './character';
import { getPose, withCarryArms } from './poses';
import { drawStage } from './stage';
import { FONT } from './text';

const VW = CONFIG.view.width;
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
}

interface Afterimage {
  e: Entity;
  t: number;
}

interface Debris {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  t: number;
  color: string;
}

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

export class BattleRenderer {
  camX = 0;
  shakeAmp = 0;
  shakeTicks = 0;
  sparks: Spark[] = [];
  afterimages: Afterimage[] = [];
  debris: Debris[] = [];
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
        this.sparks.push({ x: ev.x, y: ev.y, z: ev.z, t: FX.sparkTicks, heavy: ev.heavy, blocked: ev.blocked, seed: this.sparkSeed++ });
      } else if (ev.type === 'shake') {
        if (ev.amp >= this.shakeAmp || this.shakeTicks <= 0) {
          this.shakeAmp = ev.amp;
          this.shakeTicks = ev.ticks;
        }
      } else if (ev.type === 'break') {
        for (let i = 0; i < 8; i++)
          this.debris.push({ x: ev.x, y: ev.y + 10, z: ev.z, vx: Math.cos(i * 0.8) * (2 + (i % 3)), vy: 3 + (i % 4), t: 30, color: ev.color });
      } else if (ev.type === 'wave') {
        this.banner = { text: `第 ${ev.index + 1} / ${ev.total} 波`, t: 90 };
      }
    }
  }

  /** 每個邏輯 tick 呼叫一次 */
  tick(w: World): void {
    this.camX += (this.targetCam(w) - this.camX) * FX.cameraLerp;
    if (this.shakeTicks > 0) this.shakeTicks--;
    for (const s of this.sparks) s.t--;
    this.sparks = this.sparks.filter((s) => s.t > 0);
    for (const a of this.afterimages) a.t--;
    this.afterimages = this.afterimages.filter((a) => a.t > 0);
    for (const d of this.debris) {
      d.vy -= 0.4;
      d.x += d.vx;
      d.y = Math.max(0, d.y + d.vy);
      d.t--;
    }
    this.debris = this.debris.filter((d) => d.t > 0);
    if (this.banner && --this.banner.t <= 0) this.banner = null;
    if (w.tick % FX.afterimageInterval === 0) {
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
      const a = this.shakeAmp;
      ctx.translate(((w.tick * 7919) % 3) - 1 === 0 ? a : -a * 0.6, (w.tick % 2 ? 1 : -1) * a * 0.5);
    }
    const cam = Math.round(this.camX);
    drawStage(ctx, w, cam);

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

    for (const a of this.afterimages) {
      const def = w.charDef(a.e);
      ctx.globalAlpha = FX.afterimageAlpha * (a.t / FX.afterimageLife);
      drawFigure(ctx, def, { pose: getPose('falling'), x: a.e.x - cam, y: screenY(a.e), facing: a.e.facing, tick: w.tick, tint: '#fff' });
      ctx.globalAlpha = 1;
    }

    const sorted = w.entities.filter((e) => !(e.kind === 'item' && e.itemState === 'held')).sort((a, b) => a.z - b.z || a.id - b.id);
    for (const e of sorted) {
      if (e.kind === 'char') this.drawChar(ctx, w, e, cam);
      else if (e.kind === 'item') drawItemShape(ctx, w.data.items[e.itemId], e.x - cam, screenY(e), 0);
      else this.drawProjectile(ctx, w, e, cam);
    }

    for (const d of this.debris) {
      ctx.fillStyle = d.color;
      ctx.fillRect(d.x - cam - 3, HZ + d.z - d.y - 3, 6, 5);
    }
    for (const s of this.sparks) this.drawSpark(ctx, s, cam);
    ctx.restore();
    this.drawHud(ctx, w, hudExtra);
  }

  private drawChar(ctx: CanvasRenderingContext2D, w: World, e: Entity, cam: number): void {
    const def = w.charDef(e);
    const held = e.heldItem ? w.data.items[w.get(e.heldItem)?.itemId ?? ''] : undefined;
    let pose = getPose(poseName(w, e));
    if (held?.kind === 'heavy' && (e.state === 'idle' || e.state === 'walk')) pose = withCarryArms(pose);
    if (e.state === 'rolling') pose = { ...pose, rot: (e.stateTime / CONFIG.combat.rollTicks) * 360 };
    if (e.state === 'dizzy' || e.state === 'broken') pose = { ...pose, t: pose.t + Math.sin(w.tick * 0.2) * 8 };
    const x = e.x - cam;
    const y = screenY(e);
    let alpha = 1;
    if (e.state === 'dead') alpha = 0.45;
    else if (e.invuln > 0 && e.state !== 'rolling' && e.state !== 'attack' && (w.tick >> 2) % 2 === 0) alpha = 0.4;

    // 增益效果
    if (hasBuff(e, 'dmgReduce')) {
      ctx.fillStyle = 'rgba(255,215,90,0.22)';
      ctx.strokeStyle = 'rgba(255,215,90,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y - 30, 26, 38, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
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
    });
    if (hasBuff(e, 'blockProjectile')) {
      ctx.save();
      ctx.strokeStyle = def.palette.accent;
      ctx.shadowColor = def.palette.accent;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2 + w.tick * 0.03;
        const px = x + e.facing * 4 + Math.cos(a) * 30;
        const py = y - 32 + Math.sin(a) * 38;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (e.state === 'dizzy' || e.state === 'broken' || e.state === 'grabbed') {
      for (let i = 0; i < 3; i++) {
        const a = w.tick * 0.12 + (i * Math.PI * 2) / 3;
        star(ctx, x + Math.cos(a) * 14, y - 70 + Math.sin(a) * 4, 4, '#ffe14d');
      }
    }
    // 敵人與 AI 頭上小血條；玩家標記
    if (e.state !== 'dead') {
      if (e.slot < 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - 16, y - 78, 32, 4);
        ctx.fillStyle = e.boss ? '#ff4d4d' : '#ffb84d';
        ctx.fillRect(x - 16, y - 78, (32 * e.hp) / e.maxHp, 4);
      } else {
        ctx.font = `bold 10px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = SLOT_COLORS[e.slot];
        ctx.fillText(e.ai ? 'COM' : `${e.slot + 1}P`, x, y - 74);
        ctx.textAlign = 'left';
      }
    }
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
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    const pose = f?.pose ?? 'dart';
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
        ctx.shadowBlur = 6;
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
      default:
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, s / 2, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
  }

  private drawSpark(ctx: CanvasRenderingContext2D, s: Spark, cam: number): void {
    const x = s.x - cam;
    const y = HZ + s.z - s.y;
    const k = s.t / FX.sparkTicks;
    const n = s.heavy ? 6 : 4;
    ctx.strokeStyle = s.blocked ? '#7fd6ff' : s.heavy ? '#ffef6b' : '#ffffff';
    ctx.lineWidth = s.heavy ? 3 : 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + s.seed;
      const r0 = 4 + (1 - k) * 8;
      const r1 = r0 + (s.heavy ? 14 : 9) * k;
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    }
    ctx.stroke();
  }

  private drawHud(ctx: CanvasRenderingContext2D, w: World, extra?: string): void {
    const players = w
      .chars()
      .filter((c) => c.slot >= 0)
      .sort((a, b) => a.slot - b.slot);
    players.forEach((c) => {
      const px = c.slot * 200 + 4;
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
      ctx.fillRect(200, 420, 400, 14);
      ctx.fillStyle = '#ff3b3b';
      ctx.fillRect(202, 422, (396 * boss.hp) / boss.maxHp, 10);
      ctx.font = `bold 11px ${FONT}`;
      ctx.fillStyle = '#fff';
      ctx.fillText(`頭目 · 強化${w.charDef(boss).name}`, 206, 416);
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
  ctx.fillStyle = 'rgba(8,10,20,0.72)';
  roundRect(ctx, x, y, 192, 46, 6);
  ctx.fill();
  ctx.strokeStyle = SLOT_COLORS[c.slot] ?? '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  // 頭像
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 4, y + 4, 38, 38);
  ctx.clip();
  ctx.fillStyle = shade(def.palette.accent, -0.55);
  ctx.fillRect(x + 4, y + 4, 38, 38);
  drawFigure(ctx, def, { pose: getPose(c.hp > 0 ? 'idle_0' : 'hurt'), x: x + 22, y: y + 78, facing: 1, scale: 1.05, tick, upperOnly: true, alpha: c.hp > 0 ? 1 : 0.5 });
  ctx.restore();
  ctx.font = `bold 11px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.fillText(`${c.ai ? 'COM' : `${c.slot + 1}P`} ${def.name}`, x + 48, y + 14);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText(`${Math.ceil(c.hp)}`, x + 186, y + 14);
  ctx.textAlign = 'left';
  const bw = 136;
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(x + 48, y + 20, bw, 9);
  ctx.fillStyle = '#e04848';
  ctx.fillRect(x + 48, y + 20, (bw * Math.max(0, lag)) / c.maxHp, 9);
  ctx.fillStyle = '#42d35a';
  ctx.fillRect(x + 48, y + 20, (bw * Math.max(0, c.hp)) / c.maxHp, 9);
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(x + 48, y + 33, bw, 6);
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(x + 48, y + 33, (bw * c.mp) / CONFIG.combat.mpMax, 6);
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
