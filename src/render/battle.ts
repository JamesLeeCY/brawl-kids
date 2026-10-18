// 戰鬥畫面繪製：相機、z 排序、陰影、特效、HUD。
import { CONFIG } from '../config';
import type { CharacterDef } from '../data/load';
import { hasBuff, type Entity } from '../sim/entity';
import { ENEMY_TEAM, type GameEvent, type World } from '../sim/world';
import { OUTLINE, drawFigure, drawItemShape, roundRect, shade, type Expression } from './character';
import { getPose, withCarryArms } from './poses';
import { drawStage } from './stage';
import { FONT, text } from './text';

import { VW, viewOffset } from './view';
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
      ctx.ellipse(x, y - 36, 30, 46, 0, 0, Math.PI * 2);
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
      expression: expressionFor(w, e),
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
        const px = x + e.facing * 4 + Math.cos(a) * 34;
        const py = y - 36 + Math.sin(a) * 46;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
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
      case 'talk': {
        // 文字聲波：哈哈 / 讚啦 / 質詢
        const word = pose === 'laugh' ? '哈哈' : pose === 'zan' ? '讚啦' : '質詢！';
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
        ctx.shadowBlur = 4;
        drawIcon(ctx, pose, x, y, 1, p.facing, color, w.tick, p.id);
        break;
      case 'bookdrop':
      case 'slipperdrop':
      case 'laughdrop':
      case 'frogdrop':
      case 'candledrop': {
        const k = f ? p.frameTime / f.duration : 1;
        const by = HZ + p.z - Math.max(0, 1 - k * 2.2) * 260;
        ctx.shadowBlur = 0;
        drawIcon(ctx, pose.replace('drop', ''), x, by - 16, 1.8, 1, color, w.tick, p.id);
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
function drawIcon(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, sc: number, facing: number, color: string, tick: number, seed: number): void {
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
