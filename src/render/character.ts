// 程式繪製的 Q 版角色：頭身比 1:2、總高約 64 px，依骨架姿勢畫出，面向左時水平翻轉。
import type { CharacterDef } from '../data/load';
import type { ItemDef } from '../data/schema';
import type { Pose } from './poses';

export interface FigureOpts {
  pose: Pose;
  x: number;
  /** 腳底在畫面上的 y */
  y: number;
  facing: 1 | -1;
  scale?: number;
  flash?: boolean;
  alpha?: number;
  upperOnly?: boolean;
  tick: number;
  held?: ItemDef;
  airborne?: boolean;
  glow?: string;
  tint?: string;
  /** 表情：一般 / 攻擊 / 受傷 / 開心 / 暈眩 / 專注 */
  expression?: Expression;
}

export type Expression = 'normal' | 'attack' | 'hurt' | 'happy' | 'dizzy' | 'focus';

const D2R = Math.PI / 180;
const dir = (a: number) => ({ x: Math.sin(a * D2R), y: Math.cos(a * D2R) });
const up = (a: number) => ({ x: Math.sin(a * D2R), y: -Math.cos(a * D2R) });

export function shade(color: string, amt: number): string {
  // 接受 #RRGGBB 或 rgb(r,g,b)（shade 自己的輸出），可連續套用
  let r: number;
  let g: number;
  let b: number;
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const m = color.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0'];
    r = Number(m[0]);
    g = Number(m[1]);
    b = Number(m[2]);
  }
  if (amt < 0) {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  } else {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** 荒野亂鬥式粗描邊顏色 */
export const OUTLINE = '#1a1530';
/** 頭部放大倍率（Q 版大頭） */
const HEAD_SCALE = 1.45;

/** 肢體：先畫較粗的深色描邊再畫本色 */
function limb(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, w: number, color: string) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = w + 3.2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function circleOl(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, lw = 1.6) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lw;
  ctx.stroke();
}

export function drawFigure(ctx: CanvasRenderingContext2D, def: CharacterDef, o: FigureOpts): void {
  const p = o.pose;
  const s = o.scale ?? 1;
  const W = o.flash ? '#ffffff' : null;
  const pal = def.palette;
  const skin = W ?? pal.skin;
  const main = W ?? pal.main;
  const hair = W ?? pal.hair;
  const pants = W ?? shade(pal.main, -0.35);
  const backMain = W ?? shade(pal.main, -0.18);
  const shoe = W ?? '#2a2a2a';
  const acc = def.accessory;

  ctx.save();
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.translate(o.x, o.y);
  ctx.scale(o.facing * s, s);
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = 14;
  }
  if (p.rot) {
    ctx.translate(0, -9 * Math.abs(Math.sin(p.rot * D2R)));
    ctx.rotate(p.rot * D2R);
  }

  const hip = { x: 0, y: -22 + (p.dy ?? 0) };
  if (o.upperOnly) {
    ctx.beginPath();
    ctx.rect(-40, -90, 80, 90 + hip.y + 4);
    ctx.clip();
  }
  const u = up(p.t);
  const neck = { x: hip.x + u.x * 18, y: hip.y + u.y * 18 };
  const sh = { x: hip.x + u.x * 15, y: hip.y + u.y * 15 };
  const hu = up(p.t + (p.h ?? 0));
  const headPos = { x: neck.x + hu.x * 13.5, y: neck.y + hu.y * 13.5 };
  const arm = (ua: number, fa: number) => {
    const e = dir(ua);
    const f = dir(fa);
    const el = { x: sh.x + e.x * 9, y: sh.y + e.y * 9 };
    return { el, hand: { x: el.x + f.x * 9, y: el.y + f.y * 9 } };
  };
  const leg = (th: number, shn: number, off: number) => {
    const a = dir(th);
    const b = dir(shn);
    const h0 = { x: hip.x + off, y: hip.y };
    const kn = { x: h0.x + a.x * 11, y: h0.y + a.y * 11 };
    return { h0, kn, ft: { x: kn.x + b.x * 11, y: kn.y + b.y * 11 } };
  };
  const bArm = arm(p.bua, p.bfa);
  const fArm = arm(p.fua, p.ffa);
  const bLeg = leg(p.bth, p.bsh, -2);
  const fLeg = leg(p.fth, p.fsh, 2);
  const isRobot = acc === 'robot';

  const look = def.look;

  // ---- 背後配件 ----
  if (acc === 'bear') drawBear(ctx, sh.x - 11, sh.y - 6 + Math.sin(o.tick / 12) * 1.5, !!W);

  // ---- 後側肢體 ----
  const armBack = look.sleeveless ? W ?? shade(pal.skin, -0.12) : backMain;
  const armFront = look.sleeveless ? skin : main;
  limb(ctx, sh.x, sh.y, bArm.el.x, bArm.el.y, bArm.hand.x, bArm.hand.y, 6, armBack);
  circleOl(ctx, bArm.hand.x, bArm.hand.y, 3.2, skin);
  if (!W && !o.held) drawBackHandProp(ctx, acc, bArm.hand.x, bArm.hand.y, pal.accent);
  limb(ctx, bLeg.h0.x, bLeg.h0.y, bLeg.kn.x, bLeg.kn.y, bLeg.ft.x, bLeg.ft.y, 7, W ?? shade(pal.main, -0.45));
  circleOl(ctx, bLeg.ft.x + 1.5, bLeg.ft.y, 3.8, shoe);
  limb(ctx, fLeg.h0.x, fLeg.h0.y, fLeg.kn.x, fLeg.kn.y, fLeg.ft.x, fLeg.ft.y, 7, pants);
  circleOl(ctx, fLeg.ft.x + 1.5, fLeg.ft.y, 3.8, shoe);

  // ---- 軀幹 ----
  ctx.save();
  ctx.translate(hip.x, hip.y);
  ctx.rotate(p.t * D2R);
  ctx.fillStyle = main;
  roundRect(ctx, -9.5, -20.5, 19, 23, 6);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  if (!W) {
    // 簡單的明暗：左側亮面、下方暗面
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(-7.5, -18, 3.5, 15);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(-8.5, -5, 17, 5);
    if (look.tie) {
      // 襯衫 V 領 + 領帶（面向右，偏前側）
      ctx.fillStyle = look.shirt;
      ctx.beginPath();
      ctx.moveTo(-1, -20);
      ctx.lineTo(7, -20);
      ctx.lineTo(3, -9);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = look.tie;
      ctx.beginPath();
      ctx.moveTo(2, -19);
      ctx.lineTo(4.5, -19);
      ctx.lineTo(5, -8);
      ctx.lineTo(3.2, -6);
      ctx.lineTo(1.5, -8);
      ctx.closePath();
      ctx.fill();
    }
    if (acc === 'headmirror') {
      // 白袍翻領與口袋
      ctx.strokeStyle = shade(pal.main, -0.25);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-1, -20);
      ctx.lineTo(2, -8);
      ctx.moveTo(7, -20);
      ctx.lineTo(4, -8);
      ctx.stroke();
      ctx.strokeRect(-7, -9, 5, 4);
    } else if (acc === 'stethoscope') {
      ctx.strokeStyle = '#4b5563';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-4, -20);
      ctx.quadraticCurveTo(-6, -10, 1, -8);
      ctx.moveTo(8, -20);
      ctx.quadraticCurveTo(9, -12, 6, -9);
      ctx.stroke();
      circle(ctx, 1, -7.5, 2.2, '#9ca3af');
    } else if (acc === 'pin') {
      circle(ctx, -4, -15, 2, pal.accent);
      ctx.fillStyle = '#fff';
      ctx.fillRect(-4.6, -15.6, 1.2, 1.2);
    } else if (acc === 'bear') {
      // 黑熊徽章
      circle(ctx, -4, -14, 2.6, '#111');
      circle(ctx, -5.6, -16, 1, '#111');
      circle(ctx, -2.4, -16, 1, '#111');
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(-5.2, -13.4, 2.4, 0.9);
    } else if (isRobot) {
      ctx.fillStyle = pal.accent;
      ctx.fillRect(-6, -14, 12, 3);
      ctx.fillStyle = '#111827';
      ctx.fillRect(-4, -9, 8, 5);
    }
    ctx.fillStyle = shade(pal.main, -0.5);
    ctx.fillRect(-9, -2, 18, 3);
  }
  ctx.restore();

  // ---- 頭（放大的 Q 版大頭） ----
  ctx.save();
  ctx.translate(headPos.x, headPos.y);
  ctx.scale(HEAD_SCALE, HEAD_SCALE);
  {
  const head = { x: 0, y: 0 };
  if (isRobot) {
    ctx.fillStyle = skin;
    roundRect(ctx, head.x - 10, head.y - 10, 20, 19, 5);
    ctx.fill();
    if (!W) {
      ctx.fillStyle = pal.accent;
      ctx.fillRect(head.x - 2, head.y - 4, 12, 5);
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(head.x - 3, head.y - 10);
      ctx.lineTo(head.x - 5, head.y - 17);
      ctx.stroke();
      circle(ctx, head.x - 5, head.y - 18, 2.5, '#ef4444');
    }
  } else {
    circleOl(ctx, head.x, head.y, 11, skin, 2);
    if (!W) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath();
      ctx.arc(head.x - 1, head.y + 2, 10, Math.PI * 0.1, Math.PI * 0.9);
      ctx.fill();
      drawHair(ctx, head.x, head.y, look.hair, hair);
      if (acc === 'frog') drawFrogHood(ctx, head.x, head.y, pal.accent);
      drawFace(ctx, head.x, head.y, o.expression ?? 'normal', def, o.tick);
      if (acc === 'headmirror') {
        // 額鏡
        ctx.strokeStyle = '#6b7280';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(head.x - 10, head.y - 5);
        ctx.lineTo(head.x + 8, head.y - 6);
        ctx.stroke();
        circle(ctx, head.x + 7, head.y - 6, 3.6, '#d1d5db');
        circle(ctx, head.x + 7, head.y - 6, 1.2, '#4b5563');
      }
    }
  }
  if (isRobot) {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    roundRect(ctx, head.x - 10, head.y - 10, 20, 19, 5);
    ctx.stroke();
  }
  }
  ctx.restore();

  // ---- 前側手臂 ----
  limb(ctx, sh.x, sh.y, fArm.el.x, fArm.el.y, fArm.hand.x, fArm.hand.y, 6, armFront);
  circleOl(ctx, fArm.hand.x, fArm.hand.y, 3.4, skin);

  // ---- 手持物 ----
  if (o.held) {
    if (o.held.kind === 'heavy') {
      const mx = (fArm.hand.x + bArm.hand.x) / 2;
      const my = Math.min(fArm.hand.y, bArm.hand.y);
      drawItemShape(ctx, o.held, mx, my, 0, !!W);
    } else {
      const a = Math.atan2(fArm.hand.y - fArm.el.y, fArm.hand.x - fArm.el.x);
      drawItemShape(ctx, o.held, fArm.hand.x, fArm.hand.y, a, !!W, true);
    }
  } else if (!W && (acc === 'mic' || acc === 'slipper')) {
    const a = Math.atan2(fArm.hand.y - fArm.el.y, fArm.hand.x - fArm.el.x);
    ctx.save();
    ctx.translate(fArm.hand.x, fArm.hand.y);
    ctx.rotate(a - Math.PI / 2);
    if (acc === 'mic') {
      ctx.fillStyle = '#222';
      ctx.fillRect(-1.5, -2, 3, 8);
      circle(ctx, 0, 8, 3, '#9ca3af');
    } else {
      // 藍白拖
      ctx.fillStyle = '#f8fafc';
      roundRect(ctx, -3.5, 0, 7, 13, 3);
      ctx.fill();
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(-3.5, 3, 7, 3);
    }
    ctx.restore();
  }

  ctx.restore();
}

/** 髮型：面向右，(x,y) 為頭中心、半徑 11 */
function drawHair(ctx: CanvasRenderingContext2D, x: number, y: number, style: string, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  switch (style) {
    case 'none':
      return;
    case 'receding':
      // 前額高、只剩後腦與兩側
      ctx.beginPath();
      ctx.arc(x - 1, y - 1, 11.5, Math.PI * 0.95, Math.PI * 1.45);
      ctx.lineTo(x - 2, y - 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(x - 12, y - 3, 5, 7);
      return;
    case 'sidepart':
      // 旁分油頭：頂部蓬起、前方瀏海往前梳
      ctx.beginPath();
      ctx.arc(x - 1, y - 2, 12, Math.PI * 0.95, Math.PI * 2.0);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 1, y - 13);
      ctx.quadraticCurveTo(x + 12, y - 13, x + 11, y - 5);
      ctx.lineTo(x + 6, y - 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - 12, y - 3, 6, 7);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 13);
      ctx.lineTo(x - 1, y - 8);
      ctx.stroke();
      return;
    case 'cap':
      // 棒球帽（帽子顏色 = hair）
      ctx.beginPath();
      ctx.arc(x - 1, y - 2, 12, Math.PI * 1.0, Math.PI * 2.0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(x - 1, y - 4, 16, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x - 6, y - 9, 6, 3);
      ctx.fillStyle = '#1f1f1f';
      ctx.fillRect(x - 12, y - 2, 5, 5);
      return;
    case 'neat':
      // 整齊短髮（較貼頭）
      ctx.beginPath();
      ctx.arc(x - 1, y - 1, 11.3, Math.PI * 1.0, Math.PI * 1.95);
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(x - 12, y - 3, 5, 6);
      return;
    default:
      ctx.beginPath();
      ctx.arc(x - 1, y - 1, 11.5, Math.PI * 0.95, Math.PI * 2.05);
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(x - 12, y - 3, 6, 7);
  }
}

/** 臉部細節（面向右的 3/4 視角，(x,y) 為頭中心、半徑 11） */
function drawFace(ctx: CanvasRenderingContext2D, x: number, y: number, expr: Expression, def: CharacterDef, tick: number): void {
  const pal = def.palette;
  const look = def.look;
  const skinDark = shade(pal.skin, -0.32);
  // 耳朵（小、膚色、柔和描邊，放在頭的後側）
  ctx.beginPath();
  ctx.ellipse(x - 5.2, y + 2, 1.9, 2.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = pal.skin;
  ctx.fill();
  ctx.strokeStyle = skinDark;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - 5, y + 2.1, 0.9, Math.PI * 0.5, Math.PI * 1.5);
  ctx.stroke();
  // 鬍子（先畫，嘴巴疊在上面）
  if (look.beard) {
    ctx.fillStyle = pal.hair;
    ctx.beginPath();
    ctx.arc(x + 2, y + 2, 10.5, Math.PI * 0.02, Math.PI * 0.78);
    ctx.lineTo(x + 3, y + 3.5);
    ctx.closePath();
    ctx.fill();
  }
  // 腮紅
  ctx.fillStyle = 'rgba(255,110,120,0.32)';
  ctx.beginPath();
  ctx.ellipse(x + 4.4, y + 5.4, 2.1, 1.3, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 10.6, y + 5.1, 1.5, 1.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // 眼睛（近眼大、遠眼小）
  const eyes: [number, number, number][] = [
    [4.8, 0.6, 1],
    [9.8, 0.4, 0.82],
  ];
  const ink = '#1b1530';
  ctx.lineCap = 'round';
  for (const [ex, ey, k] of eyes) {
    const cx = x + ex;
    const cy = y + ey;
    if (expr === 'happy') {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy + 1.4, 2.2 * k, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (expr === 'hurt') {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - 1.8 * k, cy - 1.6 * k);
      ctx.lineTo(cx + 1.4 * k, cy);
      ctx.lineTo(cx - 1.8 * k, cy + 1.6 * k);
      ctx.stroke();
    } else if (expr === 'dizzy') {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let t = 0; t < 12; t++) {
        const a = t * 0.9 + tick * 0.2;
        const r = 0.25 * t * k;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (t === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    } else {
      const ry = (expr === 'attack' || expr === 'focus' ? 2.3 : 2.9) * k;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 2.4 * k, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      const look = expr === 'attack' ? 0.7 : 0.4;
      circle(ctx, cx + look, cy + 0.3, 1.55 * k, '#2a1d17');
      circle(ctx, cx + look, cy + 0.3, 0.75 * k, '#000000');
      circle(ctx, cx + look + 0.6, cy - 0.5, 0.55 * k, '#ffffff');
      // 上眼瞼（睫毛線）
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 2.5 * k, ry, 0, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
    }
  }

  // 眉毛
  const browCol = pal.hair === '#cfcfcf' || pal.hair === '#e5e5e5' ? shade(pal.hair, -0.35) : shade(pal.hair, -0.1);
  ctx.strokeStyle = browCol;
  ctx.lineWidth = 1.6;
  const brows: Record<Expression, [number, number, number, number][]> = {
    normal: [[2.6, -3.0, 6.6, -3.4], [8.2, -3.3, 11.4, -3.0]],
    happy: [[2.6, -3.4, 6.6, -4.2], [8.2, -4.1, 11.4, -3.4]],
    attack: [[2.4, -4.0, 6.6, -2.2], [8.0, -2.2, 11.6, -3.9]],
    focus: [[2.4, -3.6, 6.6, -2.6], [8.0, -2.6, 11.6, -3.5]],
    hurt: [[2.6, -2.4, 6.4, -4.0], [8.2, -4.0, 11.2, -2.4]],
    dizzy: [[2.6, -3.0, 6.6, -3.8], [8.2, -3.8, 11.4, -3.0]],
  };
  for (const [x0, y0, x1, y1] of brows[expr]) {
    ctx.beginPath();
    ctx.moveTo(x + x0, y + y0);
    ctx.quadraticCurveTo(x + (x0 + x1) / 2, y + Math.min(y0, y1) - 0.6, x + x1, y + y1);
    ctx.stroke();
  }

  // 鼻子
  ctx.strokeStyle = skinDark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 11.4, y + 1.4);
  ctx.quadraticCurveTo(x + 13, y + 3.4, x + 11.2, y + 3.9);
  ctx.stroke();

  // 嘴巴
  const mx = x + 8;
  const my = y + 6.8;
  const mouthIn = '#7a1f2b';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.1;
  switch (expr) {
    case 'attack':
      ctx.beginPath();
      ctx.moveTo(mx - 2.6, my - 0.8);
      ctx.lineTo(mx + 2.6, my - 0.8);
      ctx.quadraticCurveTo(mx + 2.2, my + 3, mx, my + 3);
      ctx.quadraticCurveTo(mx - 2.2, my + 3, mx - 2.6, my - 0.8);
      ctx.fillStyle = mouthIn;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(mx - 2.2, my - 0.6, 4.4, 1);
      break;
    case 'hurt':
      ctx.beginPath();
      ctx.ellipse(mx, my + 0.8, 1.6, 1.9, 0, 0, Math.PI * 2);
      ctx.fillStyle = mouthIn;
      ctx.fill();
      ctx.stroke();
      break;
    case 'happy':
      ctx.beginPath();
      ctx.moveTo(mx - 3, my - 0.6);
      ctx.quadraticCurveTo(mx, my + 4.6, mx + 3, my - 0.6);
      ctx.closePath();
      ctx.fillStyle = mouthIn;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ff8fa0';
      ctx.beginPath();
      ctx.ellipse(mx, my + 1.9, 1.4, 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'dizzy':
      ctx.beginPath();
      ctx.moveTo(mx - 2.6, my);
      ctx.quadraticCurveTo(mx - 1.3, my - 1, mx, my);
      ctx.quadraticCurveTo(mx + 1.3, my + 1, mx + 2.6, my);
      ctx.stroke();
      break;
    case 'focus':
      ctx.beginPath();
      ctx.moveTo(mx - 2, my + 0.4);
      ctx.lineTo(mx + 2, my + 0.4);
      ctx.stroke();
      break;
    default:
      ctx.beginPath();
      ctx.moveTo(mx - 2.2, my - 0.2);
      ctx.quadraticCurveTo(mx, my + 1.8, mx + 2.2, my - 0.2);
      ctx.stroke();
  }

  // 眼鏡（疊在眼睛上）
  if (look.glasses) {
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    rrPath(ctx, x + 2, y - 2.6, 5.6, 5.2, 1.6);
    rrPath(ctx, x + 7.8, y - 2.6, 4.4, 5, 1.4);
    ctx.moveTo(x + 7.6, y - 0.6);
    ctx.lineTo(x + 7.8, y - 0.6);
    ctx.moveTo(x + 2, y - 0.8);
    ctx.lineTo(x - 3, y - 1.4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(200,230,255,0.18)';
    ctx.fill();
  }
}

function rrPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 青蛙頭套 */
function drawFrogHood(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x - 1, y - 1, 12.5, Math.PI * 0.85, Math.PI * 2.15);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.8;
  ctx.stroke();
  for (const ex of [-5, 5]) {
    circleOl(ctx, x + ex, y - 12, 4.5, color);
    circle(ctx, x + ex + 0.8, y - 12.5, 2.6, '#ffffff');
    circle(ctx, x + ex + 1.4, y - 12.5, 1.3, '#111');
  }
}

/** 後手持物：英文書、K 線看板 */
function drawBackHandProp(ctx: CanvasRenderingContext2D, acc: string, x: number, y: number, accent: string): void {
  if (acc === 'book') {
    ctx.fillStyle = '#b91c1c';
    ctx.fillRect(x - 5, y - 8, 10, 12);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 6px sans-serif';
    ctx.fillText('ABC', x - 5, y - 1);
  } else if (acc === 'chart') {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x - 8, y - 14, 16, 12);
    const bars: [number, number, string][] = [
      [-5, 6, '#ef4444'],
      [-1, 4, '#22c55e'],
      [3, 8, '#ef4444'],
    ];
    for (const [bx, h, c] of bars) {
      ctx.fillStyle = c;
      ctx.fillRect(x + bx, y - 4 - h, 2.4, h);
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 5);
    ctx.lineTo(x - 2, y - 9);
    ctx.lineTo(x + 2, y - 7);
    ctx.lineTo(x + 7, y - 13);
    ctx.stroke();
  }
}

/** 背在肩上的小黑熊玩偶 */
function drawBear(ctx: CanvasRenderingContext2D, x: number, y: number, white: boolean): void {
  const c = white ? '#fff' : '#1a1a1a';
  circle(ctx, x, y + 5, 6, c);
  circle(ctx, x, y - 3, 5, c);
  circle(ctx, x - 4, y - 7, 2, c);
  circle(ctx, x + 4, y - 7, 2, c);
  if (!white) {
    ctx.fillStyle = '#f5f5f5';
    ctx.beginPath();
    ctx.moveTo(x - 4, y + 2);
    ctx.lineTo(x + 4, y + 2);
    ctx.lineTo(x, y + 5);
    ctx.closePath();
    ctx.fill();
    circle(ctx, x + 1.5, y - 2, 2, '#c8a27a');
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 道具圖形。(x,y) 為底部中心；inHand 時 (x,y) 為握點、angle 為手臂方向。
 */
export function drawItemShape(
  ctx: CanvasRenderingContext2D,
  def: ItemDef,
  x: number,
  y: number,
  angle: number,
  white = false,
  inHand = false,
): void {
  const c = white ? '#ffffff' : def.color;
  const s = def.size;
  ctx.save();
  ctx.translate(x, y);
  switch (def.id) {
    case 'crate':
      ctx.fillStyle = c;
      ctx.fillRect(-s / 2, -s, s, s);
      if (!white) {
        ctx.strokeStyle = shade(def.color, -0.4);
        ctx.lineWidth = 2;
        ctx.strokeRect(-s / 2 + 1, -s + 1, s - 2, s - 2);
        ctx.beginPath();
        ctx.moveTo(-s / 2 + 2, -s + 2);
        ctx.lineTo(s / 2 - 2, -2);
        ctx.moveTo(s / 2 - 2, -s + 2);
        ctx.lineTo(-s / 2 + 2, -2);
        ctx.stroke();
      }
      break;
    case 'stone':
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(0, inHand ? 0 : -s / 2, s / 2 + 1, s / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      if (!white) {
        ctx.fillStyle = shade(def.color, 0.3);
        ctx.fillRect(-2, (inHand ? 0 : -s / 2) - 3, 3, 2);
      }
      break;
    case 'bat':
      ctx.rotate(inHand ? angle : -0.15);
      ctx.strokeStyle = c;
      ctx.lineCap = 'round';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(inHand ? -4 : -s / 2, inHand ? 0 : -3);
      ctx.lineTo(inHand ? s * 0.4 : 0, inHand ? 0 : -3);
      ctx.stroke();
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(inHand ? s * 0.4 : 0, inHand ? 0 : -3);
      ctx.lineTo(inHand ? s : s / 2, inHand ? 0 : -3);
      ctx.stroke();
      break;
    case 'bubbletea':
      ctx.fillStyle = white ? c : 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.moveTo(-6, -s);
      ctx.lineTo(6, -s);
      ctx.lineTo(4, 0);
      ctx.lineTo(-4, 0);
      ctx.closePath();
      ctx.fill();
      if (!white) {
        ctx.fillStyle = def.color;
        ctx.fillRect(-5, -s + 4, 10, s - 4);
        ctx.fillStyle = '#3b2314';
        for (let i = 0; i < 4; i++) circle(ctx, -3 + i * 2, -3, 1.4, '#3b2314');
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(1, -s - 6, 2, 8);
      }
      break;
    case 'bento':
      ctx.fillStyle = white ? c : '#7a4a2a';
      ctx.fillRect(-s / 2 - 2, -10, s + 4, 10);
      if (!white) {
        ctx.fillStyle = def.color;
        ctx.fillRect(-s / 2, -9, s / 2, 7);
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(1, -9, s / 2 - 1, 3);
        ctx.fillStyle = '#27ae60';
        ctx.fillRect(1, -6, s / 2 - 1, 4);
      }
      break;
    case 'tea':
      // 高山茶：茶杯 + 熱氣
      ctx.fillStyle = white ? c : '#f5f0e6';
      ctx.beginPath();
      ctx.moveTo(-7, -11);
      ctx.lineTo(7, -11);
      ctx.lineTo(5, 0);
      ctx.lineTo(-5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1a1530';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (!white) {
        ctx.fillStyle = def.color;
        ctx.fillRect(-6, -10, 12, 3);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.moveTo(-2, -13);
        ctx.quadraticCurveTo(-5, -17, -2, -20);
        ctx.moveTo(3, -13);
        ctx.quadraticCurveTo(0, -17, 3, -20);
        ctx.stroke();
      }
      break;
    default:
      ctx.fillStyle = c;
      ctx.fillRect(-s / 2, -s, s, s);
  }
  ctx.restore();
}
