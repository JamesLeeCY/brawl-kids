// 程式繪製的 Q 版角色（約 2 頭身、A 字形身體、彩色線稿），依骨架姿勢畫出，面向左時水平翻轉。
// 畫風：手繪賀卡風的 Q 版（細細的暖褐色描邊、柔和的粉彩配色、豆豆眼、圓臉腮紅）；選單可加貼紙風白邊。
import type { CharacterDef } from '../data/load';
import type { ItemDef } from '../data/schema';
import type { Pose } from './poses';
import { lowQuality } from './quality';

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
  /** 貼紙風：角色外圍加一圈粗白邊（選單、結算等靜態畫面用） */
  sticker?: boolean;
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

/** 粗描邊的預設顏色（閃白、機器人等用） */
export const OUTLINE = '#1a1530';
/** 頭部放大倍率（Q 版大頭，約 2 頭身） */
const HEAD_SCALE = 1.6;

/** 貼紙白邊那一趟繪製：描邊一律改成白色並加粗 */
let olOverride: string | null = null;
let olExtra = 0;

/** 彩色線稿：描邊用該部位本色的深色（比全黑柔和，仍保有輪廓） */
function outlineOf(color: string): string {
  if (olOverride) return olOverride;
  // 手繪風：線條用本色的深色、再往暖褐色靠，比全黑柔和
  return mix(color === '#ffffff' ? '#8a7a6a' : shade(color, -0.55), '#4a3a2e', 0.45);
}

/** 兩色混合（t = 0 → a，1 → b） */
function mix(a: string, b: string, t: number): string {
  const p = (c: string) => {
    if (c.startsWith('#')) {
      const n = parseInt(c.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m = c.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0'];
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  };
  const x = p(a);
  const y = p(b);
  return `rgb(${(x[0] + (y[0] - x[0]) * t) | 0},${(x[1] + (y[1] - x[1]) * t) | 0},${(x[2] + (y[2] - x[2]) * t) | 0})`;
}

/** 粉彩化：往暖白色靠一點，降低飽和度（手繪賀卡的柔和配色） */
export function pastel(color: string, amt = 0.16): string {
  return mix(color, '#f6efe4', amt);
}

/** 是否畫明暗（一般角色才畫；閃白、殘影、貼紙白邊不畫） */
let shadeOn = false;

/** 光從前上方來：陰影落在後下方（面向右的座標，x+ 是前方、y+ 是下方） */
const SHADOW_DIR = { x: -0.6, y: 0.8 };

/**
 * 肢體的 cel shading：在陰影側畫一條較深的色帶、受光側畫一條細亮線，
 * 都畫在肢體寬度之內，不會超出描邊。
 */
function limbShade(ctx: CanvasRenderingContext2D, pts: [number, number][], w: number, color: string): void {
  ctx.lineCap = 'round';
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.5) continue;
    let nx = -(by - ay) / len;
    let ny = (bx - ax) / len;
    if (nx * SHADOW_DIR.x + ny * SHADOW_DIR.y < 0) {
      nx = -nx;
      ny = -ny;
    }
    const so = w * 0.27;
    ctx.strokeStyle = shade(color, -0.2);
    ctx.lineWidth = w * 0.4;
    ctx.beginPath();
    ctx.moveTo(ax + nx * so, ay + ny * so);
    ctx.lineTo(bx + nx * so, by + ny * so);
    ctx.stroke();
    const ho = w * 0.3;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = w * 0.18;
    ctx.beginPath();
    ctx.moveTo(ax - nx * ho, ay - ny * ho);
    ctx.lineTo(bx - nx * ho, by - ny * ho);
    ctx.stroke();
  }
}

/** 肢體：先畫較粗的深色描邊再畫本色 */
function limb(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, w: number, color: string) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = outlineOf(color);
  ctx.lineWidth = w + 2.2 + olExtra;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
  if (shadeOn)
    limbShade(
      ctx,
      [
        [x0, y0],
        [x1, y1],
        [x2, y2],
      ],
      w,
      color,
    );
}

/** 手：圓形加上受光的小亮點與陰影側的暗面 */
function hand(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  circleOl(ctx, x, y, r, color);
  if (!shadeOn) return;
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.92, Math.PI * 0.35, Math.PI * 1.15);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.arc(x + r * 0.3, y - r * 0.35, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function circleOl(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, lw = 1.25) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = outlineOf(color);
  ctx.lineWidth = lw + olExtra;
  if (olExtra) ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  if (!olExtra) ctx.stroke();
}

/** 圓胖的鞋子（略往前凸的橢圓） */
function shoe(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.beginPath();
  ctx.ellipse(x + 1.8, y + 0.2, 5, 3.6, 0, 0, Math.PI * 2);
  ctx.strokeStyle = outlineOf(color);
  ctx.lineWidth = 1.8 + olExtra;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  if (!olExtra) {
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.ellipse(x + 2.6, y - 1.2, 2.2, 1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawFigure(ctx: CanvasRenderingContext2D, def: CharacterDef, o: FigureOpts): void {
  if (o.sticker && olOverride === null) {
    // 貼紙風：先畫一個粗白邊的剪影，再疊上正常的角色
    olOverride = '#ffffff';
    olExtra = 4.5;
    try {
      drawFigure(ctx, def, { ...o, sticker: false, flash: true, glow: undefined, held: undefined, alpha: (o.alpha ?? 1) * 0.95 });
    } finally {
      olOverride = null;
      olExtra = 0;
    }
  }
  const silhouette = olOverride !== null;
  const p = o.pose;
  const s = o.scale ?? 1;
  // 受擊閃白 / 殘影、分身的單色剪影
  const W = o.tint ?? (o.flash ? '#ffffff' : null);
  const pal = def.palette;
  const skin = W ?? pastel(pal.skin, 0.12);
  const main = W ?? pastel(pal.main);
  const hair = W ?? pastel(pal.hair, 0.08);
  const pants = W ?? pastel(shade(pal.main, -0.35));
  const backMain = W ?? pastel(shade(pal.main, -0.18));
  const shoeColor = W ?? '#3a3330';
  const acc = def.accessory;
  const prevShade = shadeOn;
  shadeOn = !W && !silhouette;

  ctx.save();
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.translate(o.x, o.y);
  ctx.scale(o.facing * s, s);
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = lowQuality ? 0 : 14;
  }
  if (p.rot) {
    ctx.translate(0, -9 * Math.abs(Math.sin(p.rot * D2R)));
    ctx.rotate(p.rot * D2R);
  }

  // 約 2 頭身：腿與手臂縮短、頭放大
  const hip = { x: 0, y: -17 + (p.dy ?? 0) };
  if (o.upperOnly) {
    ctx.beginPath();
    ctx.rect(-40, -90, 80, 90 + hip.y + 4);
    ctx.clip();
  }
  const u = up(p.t);
  const neck = { x: hip.x + u.x * 16, y: hip.y + u.y * 16 };
  const sh = { x: hip.x + u.x * 13.5, y: hip.y + u.y * 13.5 };
  const hu = up(p.t + (p.h ?? 0));
  const headPos = { x: neck.x + hu.x * 14.5, y: neck.y + hu.y * 14.5 };
  const arm = (ua: number, fa: number) => {
    const e = dir(ua);
    const f = dir(fa);
    const el = { x: sh.x + e.x * 7.5, y: sh.y + e.y * 7.5 };
    return { el, hand: { x: el.x + f.x * 7.5, y: el.y + f.y * 7.5 } };
  };
  const leg = (th: number, shn: number, off: number) => {
    const a = dir(th);
    const b = dir(shn);
    const h0 = { x: hip.x + off, y: hip.y };
    const kn = { x: h0.x + a.x * 8.5, y: h0.y + a.y * 8.5 };
    return { h0, kn, ft: { x: kn.x + b.x * 8.5, y: kn.y + b.y * 8.5 } };
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
  limb(ctx, sh.x, sh.y, bArm.el.x, bArm.el.y, bArm.hand.x, bArm.hand.y, 6.5, armBack);
  hand(ctx, bArm.hand.x, bArm.hand.y, 3.8, skin);
  if (!W && !o.held) drawBackHandProp(ctx, acc, bArm.hand.x, bArm.hand.y, pal.accent);
  limb(ctx, bLeg.h0.x, bLeg.h0.y, bLeg.kn.x, bLeg.kn.y, bLeg.ft.x, bLeg.ft.y, 7.5, W ?? shade(pal.main, -0.45));
  shoe(ctx, bLeg.ft.x, bLeg.ft.y, shoeColor);
  limb(ctx, fLeg.h0.x, fLeg.h0.y, fLeg.kn.x, fLeg.kn.y, fLeg.ft.x, fLeg.ft.y, 7.5, pants);
  shoe(ctx, fLeg.ft.x, fLeg.ft.y, shoeColor);

  // ---- 軀幹 ----
  ctx.save();
  ctx.translate(hip.x, hip.y);
  ctx.rotate(p.t * D2R);
  // A 字形身體：上窄下寬
  ctx.beginPath();
  ctx.moveTo(-6, -20.5);
  ctx.lineTo(6, -20.5);
  ctx.quadraticCurveTo(9, -20.5, 9.6, -17);
  ctx.lineTo(11.5, -1);
  ctx.quadraticCurveTo(12, 2.5, 8.5, 2.5);
  ctx.lineTo(-8.5, 2.5);
  ctx.quadraticCurveTo(-12, 2.5, -11.5, -1);
  ctx.lineTo(-9.6, -17);
  ctx.quadraticCurveTo(-9, -20.5, -6, -20.5);
  ctx.closePath();
  ctx.strokeStyle = W && !silhouette ? OUTLINE : outlineOf(pal.main);
  ctx.lineWidth = 1.7 + olExtra;
  if (silhouette) ctx.stroke();
  ctx.fillStyle = main;
  ctx.fill();
  if (!silhouette) ctx.stroke();
  if (!W) {
    // cel shading：光從前上方來，背側與下襬是暗面，前側一條亮面
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(40,20,40,0.2)';
    ctx.beginPath();
    ctx.moveTo(-13, -21);
    ctx.lineTo(-4.5, -21);
    ctx.quadraticCurveTo(-7, -9, -2, 3);
    ctx.lineTo(-13, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(40,20,40,0.14)';
    ctx.fillRect(-13, -4.5, 26, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.24)';
    ctx.beginPath();
    ctx.moveTo(4, -19.5);
    ctx.quadraticCurveTo(8.6, -18.5, 9.2, -13);
    ctx.lineTo(10, -6);
    ctx.quadraticCurveTo(7.5, -11, 4, -19.5);
    ctx.closePath();
    ctx.fill();
    // 衣服皺褶：腰側兩道
    ctx.strokeStyle = 'rgba(40,20,40,0.22)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-6, -7);
    ctx.quadraticCurveTo(-3.5, -5.5, -1, -6.5);
    ctx.moveTo(2, -4.5);
    ctx.quadraticCurveTo(4, -3.5, 6.5, -4.5);
    ctx.stroke();
    ctx.restore();
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
    } else if (acc === 'judo') {
      // 柔道服：交疊的衣襟 + 黑帶
      ctx.strokeStyle = shade(pal.main, -0.3);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-5, -20);
      ctx.lineTo(4, -7);
      ctx.moveTo(7, -20);
      ctx.lineTo(1, -11);
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.fillRect(-9.5, -5, 19, 3.6);
      ctx.fillRect(3, -3, 2.2, 6);
      ctx.fillRect(5.5, -3, 2.2, 5);
    } else if (acc === 'maosuit') {
      // 立領中山裝：高領、一排鈕扣、口袋
      ctx.fillStyle = shade(pal.main, 0.25);
      ctx.fillRect(-6, -21, 13, 3.5);
      for (const by of [-15, -10.5, -6]) circle(ctx, 3.5, by, 1.1, '#9ca3af');
      ctx.strokeStyle = shade(pal.main, 0.3);
      ctx.lineWidth = 1;
      ctx.strokeRect(-7, -15, 4.5, 3.5);
      ctx.strokeRect(-7, -8, 4.5, 4);
    } else if (isRobot) {
      ctx.fillStyle = pal.accent;
      ctx.fillRect(-6, -14, 12, 3);
      ctx.fillStyle = '#111827';
      ctx.fillRect(-4, -9, 8, 5);
    }
    ctx.fillStyle = shade(pal.main, -0.5);
    ctx.fillRect(-11, -1.5, 22, 3);
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
    circleOl(ctx, head.x, head.y, 11, skin, 1.5);
    if (silhouette) drawHair(ctx, head.x, head.y, look.hair, '#ffffff');
    if (!W) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath();
      ctx.arc(head.x - 1, head.y + 2, 10, Math.PI * 0.1, Math.PI * 0.9);
      ctx.fill();
      // 後腦勺的暗面（新月形）與前臉頰的受光邊
      ctx.fillStyle = 'rgba(60,30,30,0.12)';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 10.4, Math.PI * 0.55, Math.PI * 1.35);
      ctx.arc(head.x + 3, head.y - 0.5, 9.2, Math.PI * 1.3, Math.PI * 0.6, true);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 9.6, -Math.PI * 0.05, Math.PI * 0.3);
      ctx.stroke();
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
  limb(ctx, sh.x, sh.y, fArm.el.x, fArm.el.y, fArm.hand.x, fArm.hand.y, 6.5, armFront);
  hand(ctx, fArm.hand.x, fArm.hand.y, 4, skin);

  // ---- 抱在懷裡的貓（配件 cat）----
  if (acc === 'cat' && !W && !o.held) drawHeldCat(ctx, fArm.hand.x, fArm.hand.y);

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
  shadeOn = prevShade;
}

/** 髮型：面向右，(x,y) 為頭中心、半徑 11 */
function drawHair(ctx: CanvasRenderingContext2D, x: number, y: number, style: string, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = outlineOf(color);
  ctx.lineWidth = 1.6 + olExtra / HEAD_SCALE;
  ctx.lineJoin = 'round';
  switch (style) {
    case 'none': {
      // 光頭：頭頂一道亮光
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x - 1, y - 1, 8, Math.PI * 1.2, Math.PI * 1.55);
      ctx.stroke();
      ctx.restore();
      return;
    }
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
    case 'bob':
      // 蓬鬆的鮑伯短髮：蓋住耳朵、前方有瀏海，髮尾到下巴
      ctx.beginPath();
      ctx.moveTo(x - 12.5, y + 8);
      ctx.quadraticCurveTo(x - 16, y - 6, x - 8, y - 13);
      ctx.quadraticCurveTo(x + 2, y - 18, x + 11, y - 10.5);
      ctx.quadraticCurveTo(x + 14, y - 6, x + 12.4, y - 1.5);
      ctx.quadraticCurveTo(x + 7, y - 6.2, x + 1.5, y - 5);
      ctx.quadraticCurveTo(x - 3, y - 4, x - 4.5, y + 1);
      ctx.quadraticCurveTo(x - 5.5, y + 6, x - 7.5, y + 9.5);
      ctx.quadraticCurveTo(x - 10.5, y + 10.5, x - 12.5, y + 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 11);
      ctx.quadraticCurveTo(x - 1, y - 14.5, x + 5, y - 12);
      ctx.stroke();
      return;
    case 'swoop':
      // 蓬鬆金髮、往前梳的大瀏海
      ctx.beginPath();
      ctx.arc(x - 1, y - 2, 12.6, Math.PI * 0.9, Math.PI * 2.0);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 13);
      ctx.quadraticCurveTo(x + 9, y - 19, x + 14.5, y - 6);
      ctx.quadraticCurveTo(x + 9, y - 9.5, x + 2, y - 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(x - 13, y - 3, 6, 8);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 14);
      ctx.quadraticCurveTo(x + 5, y - 16, x + 10, y - 9);
      ctx.stroke();
      return;
    case 'flattop': {
      // 兩側推短（露出頭皮的淡淡髮根）、頭頂往後梳的蓬鬆髮量
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.beginPath();
      ctx.arc(x - 1, y - 1, 11.2, Math.PI * 0.98, Math.PI * 1.25);
      ctx.lineTo(x - 7, y - 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // 頭頂髮量：圓弧頂、前方微微翹起，下緣停在額頭高度（不蓋到耳朵）
      ctx.beginPath();
      ctx.moveTo(x - 10.5, y - 7);
      ctx.quadraticCurveTo(x - 12, y - 15, x - 5, y - 17.5);
      ctx.quadraticCurveTo(x + 3, y - 19.5, x + 9, y - 15.5);
      ctx.quadraticCurveTo(x + 11.5, y - 13, x + 9.5, y - 10);
      ctx.quadraticCurveTo(x + 2, y - 12.5, x - 4, y - 10.5);
      ctx.quadraticCurveTo(x - 8, y - 9.5, x - 10.5, y - 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 髮絲紋路（往後梳）
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (const k of [-5, -1, 3]) {
        ctx.moveTo(x + k + 4, y - 16.5);
        ctx.quadraticCurveTo(x + k, y - 15, x + k - 4, y - 12);
      }
      ctx.stroke();
      return;
    }
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
  ctx.ellipse(x - 5.2, y + 3.2, 1.9, 2.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = pal.skin;
  ctx.fill();
  ctx.strokeStyle = skinDark;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - 5, y + 3.3, 0.9, Math.PI * 0.5, Math.PI * 1.5);
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
  // 腮紅（Q 版：大一點、明顯一點）
  ctx.fillStyle = 'rgba(255,135,145,0.34)';
  ctx.beginPath();
  ctx.ellipse(x + 3.4, y + 6.4, 2.3, 1.6, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 10.4, y + 6.2, 1.5, 1.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // 眼睛（五官放低：額頭留寬；近眼大、遠眼小）
  const eyes: [number, number, number][] = [
    [4.4, 2.2, 1.18],
    [9.4, 2.0, 0.92],
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
      // 豆豆眼：深色小橢圓 + 一個小亮點（手繪賀卡風）
      const sharp = expr === 'attack' || expr === 'focus';
      const look = expr === 'attack' ? 0.5 : 0.25;
      ctx.beginPath();
      ctx.ellipse(cx + look, cy + 0.4, 1.35 * k, (sharp ? 1.35 : 1.85) * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#2b211c';
      ctx.fill();
      circle(ctx, cx + look + 0.45 * k, cy - 0.3 * k, 0.5 * k, '#ffffff');
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
  // 五官整體下移，眉毛跟著眼睛往下
  const BROW_DROP = 1.1;
  for (const [x0, y0, x1, y1] of brows[expr]) {
    ctx.beginPath();
    ctx.moveTo(x + x0, y + y0 + BROW_DROP);
    ctx.quadraticCurveTo(x + (x0 + x1) / 2, y + Math.min(y0, y1) - 0.6 + BROW_DROP, x + x1, y + y1 + BROW_DROP);
    ctx.stroke();
  }

  // 鼻子
  ctx.strokeStyle = skinDark;
  ctx.lineWidth = 1;
  // 鼻子（Q 版：小小一點）
  ctx.beginPath();
  ctx.moveTo(x + 11.2, y + 4.4);
  ctx.quadraticCurveTo(x + 12.2, y + 5.2, x + 11.1, y + 5.6);
  ctx.stroke();

  // 嘴巴（放低、偏小）
  const mx = x + 7.6;
  const my = y + 8.1;
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
  if (look.glasses && look.roundGlasses) {
    // 細框圓眼鏡
    ctx.strokeStyle = '#3b3029';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.ellipse(x + 4.6, y + 2.4, 3.3, 3.1, 0, 0, Math.PI * 2);
    ctx.moveTo(x + 12.4, y + 2.2);
    ctx.ellipse(x + 10, y + 2.2, 2.4, 2.9, 0, 0, Math.PI * 2);
    ctx.moveTo(x + 7.9, y + 1.8);
    ctx.lineTo(x + 7.6, y + 1.8);
    ctx.moveTo(x + 1.3, y + 1.8);
    ctx.lineTo(x - 3.6, y + 1);
    ctx.stroke();
  } else if (look.glasses) {
    // 招牌眼鏡放大一點（Q 版要凸顯角色特徵）
    ctx.strokeStyle = '#2b2420';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    rrPath(ctx, x + 0.9, y - 1.6, 7, 7, 2);
    rrPath(ctx, x + 7.9, y - 1.4, 4.8, 6.6, 1.8);
    ctx.moveTo(x + 7.9, y + 0.8);
    ctx.lineTo(x + 7.9, y + 0.8);
    ctx.moveTo(x + 0.9, y + 0.6);
    ctx.lineTo(x - 3.6, y - 0.2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(200,230,255,0.18)';
    ctx.fill();
  }
}

/** 抱在手上的小貓（灰虎斑），(x, y) 為手的位置 */
function drawHeldCat(ctx: CanvasRenderingContext2D, hx: number, hy: number): void {
  // 放大約 1.7 倍：小了看起來像老鼠
  ctx.save();
  ctx.translate(hx, hy);
  ctx.scale(1.7, 1.7);
  ctx.translate(-hx, -hy + 1.2);
  const x = hx;
  const y = hy;
  const fur = '#b9b2a8';
  const ol = '#5a4a3e';
  ctx.lineWidth = 1;
  ctx.strokeStyle = ol;
  // 身體
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(x + 1, y - 2, 4.6, 3.6, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 頭與耳朵
  ctx.beginPath();
  ctx.moveTo(x + 2.4, y - 8.2);
  ctx.lineTo(x + 3.4, y - 11.4);
  ctx.lineTo(x + 5, y - 9);
  ctx.lineTo(x + 7.4, y - 10.8);
  ctx.lineTo(x + 7.6, y - 7.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + 5, y - 6.6, 3.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 虎斑紋、眼睛、粉紅鼻子
  ctx.strokeStyle = '#7d7368';
  ctx.beginPath();
  ctx.moveTo(x + 4.2, y - 9.6);
  ctx.lineTo(x + 4.6, y - 8.4);
  ctx.moveTo(x - 1.5, y - 4.5);
  ctx.lineTo(x - 0.5, y - 2.5);
  ctx.moveTo(x + 1, y - 5.2);
  ctx.lineTo(x + 1.8, y - 3);
  ctx.stroke();
  circle(ctx, x + 4.1, y - 6.6, 0.6, '#2b211c');
  circle(ctx, x + 6.4, y - 6.6, 0.6, '#2b211c');
  circle(ctx, x + 5.3, y - 5.5, 0.45, '#f29aa3');
  // 鬍鬚與尾巴（讓牠一看就是貓）
  ctx.strokeStyle = '#7d7368';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(x + 6.6, y - 5.3);
  ctx.lineTo(x + 9.6, y - 5.8);
  ctx.moveTo(x + 6.6, y - 4.9);
  ctx.lineTo(x + 9.4, y - 4.4);
  ctx.stroke();
  ctx.strokeStyle = '#5a4a3e';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - 3.2, y - 1);
  ctx.quadraticCurveTo(x - 7, y - 2, x - 6.2, y - 6.5);
  ctx.stroke();
  ctx.restore();
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
    case 'cabbage': {
      const cy = inHand ? 0 : -s / 2;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, cy, s / 2 + 1, 0, Math.PI * 2);
      ctx.fill();
      if (!white) {
        ctx.strokeStyle = '#4d7c0f';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-s / 2 + 2, cy);
        ctx.quadraticCurveTo(0, cy - s / 2, s / 2 - 2, cy);
        ctx.moveTo(0, cy - s / 2);
        ctx.lineTo(0, cy + s / 2 - 1);
        ctx.stroke();
      }
      break;
    }
    case 'desk':
      // 議事桌：桌面 + 兩支桌腳
      ctx.fillStyle = c;
      ctx.fillRect(-s / 2, -s * 0.75, s, s * 0.22);
      ctx.fillRect(-s / 2 + 2, -s * 0.55, 4, s * 0.55);
      ctx.fillRect(s / 2 - 6, -s * 0.55, 4, s * 0.55);
      if (!white) {
        ctx.strokeStyle = shade(def.color, -0.45);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-s / 2, -s * 0.75, s, s * 0.22);
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(-4, -s * 0.72, 8, 3);
      }
      break;
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
