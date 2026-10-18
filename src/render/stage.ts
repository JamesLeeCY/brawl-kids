// 場地背景：分層矩形與漸層，2 層視差捲動（遠景慢、近景快）。招牌一律虛構店名。
import { CONFIG } from '../config';
import type { StageDef } from '../data/schema';
import type { World } from '../sim/world';
import { shade } from './character';

const VW = CONFIG.view.width;
const VH = CONFIG.view.height;
const HZ = CONFIG.view.horizon;
const GROUND_TOP = HZ - 10;
const GROUND_BOTTOM = HZ + CONFIG.physics.zMax + 10;
const FAR = 0.3;
const NEAR = 0.65;

const hr = (i: number) => {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

type Ctx = CanvasRenderingContext2D;

export function drawStage(ctx: Ctx, w: World, camX: number): void {
  const st = w.stage;
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_TOP);
  g.addColorStop(0, st.palette.skyTop);
  g.addColorStop(1, st.palette.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, GROUND_TOP + 2);
  switch (st.theme) {
    case 'ximending':
      ximending(ctx, st, camX, w.tick);
      break;
    case 'xinyi':
      xinyi(ctx, st, camX, w.tick);
      break;
    case 'dome':
      dome(ctx, st, camX, w.tick);
      break;
    case 'ntu':
      ntu(ctx, st, camX, w.tick);
      break;
    default:
      generic(ctx, st, camX);
  }
  // 可行走區與背景要有明顯色差：地面上緣加一道邊線
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, GROUND_TOP - 3, VW, 3);
}

function sign(ctx: Ctx, x: number, y: number, text: string, color: string, on: boolean, vertical = false) {
  ctx.save();
  ctx.font = 'bold 11px "Noto Sans TC","Microsoft JhengHei",sans-serif';
  const tw = vertical ? 16 : ctx.measureText(text).width + 10;
  const th = vertical ? text.length * 13 + 6 : 18;
  ctx.fillStyle = 'rgba(10,5,20,0.85)';
  ctx.fillRect(x, y, tw, th);
  ctx.strokeStyle = on ? color : shade(color, -0.6);
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, tw, th);
  if (on) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
  }
  ctx.fillStyle = on ? color : shade(color, -0.6);
  ctx.textBaseline = 'top';
  if (vertical) {
    [...text].forEach((ch, i) => ctx.fillText(ch, x + 2.5, y + 4 + i * 13));
  } else ctx.fillText(text, x + 5, y + 3);
  ctx.restore();
}

function groundTiles(ctx: Ctx, camX: number, tw: number, th: number, colors: string[], lines?: string) {
  for (let row = 0; GROUND_TOP + row * th < GROUND_BOTTOM; row++) {
    const y = GROUND_TOP + row * th;
    const off = row % 2 ? tw / 2 : 0;
    const start = Math.floor((camX - off) / tw) - 1;
    for (let i = start; i * tw + off - camX < VW + tw; i++) {
      const x = i * tw + off - camX;
      ctx.fillStyle = colors[(((i + row * 7) % colors.length) + colors.length) % colors.length];
      ctx.fillRect(x, y, tw, th);
    }
  }
  if (lines) {
    ctx.strokeStyle = lines;
    ctx.lineWidth = 1;
    for (let y = GROUND_TOP; y < GROUND_BOTTOM; y += th) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(VW, y + 0.5);
      ctx.stroke();
    }
  }
}

function frontEdge(ctx: Ctx, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(0, GROUND_BOTTOM, VW, VH - GROUND_BOTTOM);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, GROUND_BOTTOM, VW, 3);
}

// ---------------- 台北西門町 ----------------
const XMD_SIGNS = ['星光冰室', '大頭貼樂園', '夜貓唱片行', '阿福滷味', '霓虹電玩', '小巷咖啡', '萬年鞋鋪', '糖葫蘆王'];
const NEON = ['#ff3fa4', '#3ff0ff', '#ffe23f', '#7dff6b', '#ff8a3f'];

function ximending(ctx: Ctx, st: StageDef, camX: number, tick: number) {
  const blink = Math.floor(tick / (st.features.neon?.interval ?? 120));
  // 遠景：大樓群 + 紅磚八角樓
  const fx = camX * FAR;
  for (let i = 0; i < 18; i++) {
    const x = i * 90 - fx;
    if (x < -100 || x > VW + 10) continue;
    const h = 90 + hr(i) * 90;
    ctx.fillStyle = shade(st.palette.near, -0.2 + hr(i + 3) * 0.2);
    ctx.fillRect(x, GROUND_TOP - 40 - h, 80, h + 40);
    ctx.fillStyle = 'rgba(255,230,150,0.35)';
    for (let wy = 0; wy < h - 10; wy += 14)
      for (let wx = 6; wx < 72; wx += 14) if (hr(i * 31 + wy + wx) > 0.55) ctx.fillRect(x + wx, GROUND_TOP - 40 - h + 8 + wy, 6, 7);
  }
  const rx = 330 - fx;
  if (rx > -160 && rx < VW + 20) {
    // 八角樓輪廓（簡化）
    const by = GROUND_TOP - 30;
    ctx.fillStyle = st.palette.far;
    ctx.beginPath();
    ctx.moveTo(rx, by);
    ctx.lineTo(rx, by - 60);
    ctx.lineTo(rx + 20, by - 80);
    ctx.lineTo(rx + 90, by - 80);
    ctx.lineTo(rx + 110, by - 60);
    ctx.lineTo(rx + 110, by);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade(st.palette.far, -0.3);
    ctx.beginPath();
    ctx.moveTo(rx + 25, by - 80);
    ctx.lineTo(rx + 55, by - 100);
    ctx.lineTo(rx + 85, by - 80);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,220,160,0.7)';
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.arc(rx + 22 + k * 22, by - 40, 6, Math.PI, 0);
      ctx.fillRect(rx + 16 + k * 22, by - 40, 12, 14);
      ctx.fill();
    }
    ctx.fillStyle = shade(st.palette.far, 0.3);
    ctx.fillRect(rx, by - 62, 110, 3);
  }
  // 近景：店面 + 霓虹招牌
  const nx = camX * NEAR;
  for (let i = 0; i < 16; i++) {
    const x = i * 120 - nx;
    if (x < -130 || x > VW + 10) continue;
    ctx.fillStyle = shade(st.palette.near, hr(i + 9) * 0.2);
    ctx.fillRect(x, GROUND_TOP - 70, 116, 70);
    ctx.fillStyle = NEON[i % NEON.length];
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x + 8, GROUND_TOP - 30, 100, 30);
    ctx.globalAlpha = 1;
    ctx.fillStyle = shade(NEON[(i + 2) % NEON.length], -0.3);
    ctx.beginPath();
    ctx.moveTo(x + 4, GROUND_TOP - 34);
    ctx.lineTo(x + 112, GROUND_TOP - 34);
    ctx.lineTo(x + 104, GROUND_TOP - 26);
    ctx.lineTo(x + 12, GROUND_TOP - 26);
    ctx.fill();
    const on = (blink + i) % 2 === 0 || i % 3 === 0;
    sign(ctx, x + 14, GROUND_TOP - 64, XMD_SIGNS[i % XMD_SIGNS.length], NEON[i % NEON.length], on);
    if (i % 2 === 0) sign(ctx, x + 96, GROUND_TOP - 140, XMD_SIGNS[(i + 3) % XMD_SIGNS.length].slice(0, 4), NEON[(i + 1) % NEON.length], !on, true);
  }
  // 背景路人群
  const n = st.features.pedestrians?.count ?? 0;
  for (let i = 0; i < n; i++) {
    const speed = 0.4 + hr(i) * 0.5;
    const dirn = i % 2 ? 1 : -1;
    const span = st.width * NEAR + VW + 200;
    let px = (hr(i + 50) * span + dirn * tick * speed) % span;
    if (px < 0) px += span;
    const x = px - 100 - nx;
    if (x < -20 || x > VW + 20) continue;
    const y = GROUND_TOP - 2;
    const c = shade(NEON[i % NEON.length], -0.65);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y - 22, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - 4, y - 18, 8, 11);
    const sw = Math.sin(tick * 0.2 + i) * 3;
    ctx.fillRect(x - 3 + sw, y - 8, 2.5, 8);
    ctx.fillRect(x + 1 - sw, y - 8, 2.5, 8);
  }
  // 地面：徒步區彩色地磚
  groundTiles(ctx, camX, 40, 20, [st.palette.ground, st.palette.groundAlt, '#d8c27a', '#6a8fbf'], 'rgba(0,0,0,0.12)');
  // 街頭藝人圈
  const cx = 900 - camX;
  if (cx > -120 && cx < VW + 120) {
    ctx.strokeStyle = 'rgba(255,240,120,0.8)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.ellipse(cx, HZ + 60, 90, 34, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  frontEdge(ctx, '#3a2238');
}

// ---------------- 台北信義區 ----------------
const XY_SIGNS = ['雲端百貨', '星光影城', '時尚廣場', '天際購物', '夜空書店', '信義小食堂'];
const XY_LIGHT = ['#7dd3fc', '#f472b6', '#facc15', '#a78bfa', '#34d399', '#fb923c'];

function xinyi(ctx: Ctx, st: StageDef, camX: number, tick: number) {
  // 星星
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.4 * hr(i + 7)})`;
    ctx.fillRect((hr(i) * VW * 1.5 - camX * 0.05) % VW, hr(i + 50) * 120, 1.5, 1.5);
  }
  // 煙火（裝飾）
  const fw = tick % 360;
  if (fw < 70) {
    const fx0 = 120 + hr(Math.floor(tick / 360)) * 560;
    const fy0 = 50 + hr(Math.floor(tick / 360) + 3) * 50;
    const r = fw * 0.9;
    const col = XY_LIGHT[Math.floor(tick / 360) % XY_LIGHT.length];
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - fw / 70);
    ctx.fillStyle = col;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      ctx.fillRect(fx0 + Math.cos(a) * r, fy0 + Math.sin(a) * r + fw * 0.15, 2.5, 2.5);
    }
    ctx.restore();
  }
  const fx = camX * FAR;
  // 遠景大樓群
  for (let i = 0; i < 16; i++) {
    const x = i * 95 - fx;
    if (x < -100 || x > VW + 10) continue;
    if (Math.abs(x + fx - 470) < 70) continue;
    const h = 90 + hr(i + 20) * 100;
    ctx.fillStyle = shade(st.palette.near, -0.1 + hr(i) * 0.2);
    ctx.fillRect(x, GROUND_TOP - 30 - h, 82, h + 30);
    ctx.fillStyle = 'rgba(180,220,255,0.3)';
    for (let wy = 6; wy < h - 6; wy += 10) ctx.fillRect(x + 6, GROUND_TOP - 30 - h + wy, 70, 3);
  }
  // 台北 101（分節塔身輪廓）
  const tx = 470 - fx;
  if (tx > -120 && tx < VW + 120) {
    const base = GROUND_TOP - 30;
    const glass = st.palette.far;
    ctx.fillStyle = shade(glass, -0.15);
    ctx.fillRect(tx - 34, base - 46, 68, 46);
    let y = base - 46;
    for (let k = 0; k < 8; k++) {
      const h = 22;
      ctx.fillStyle = k % 2 ? glass : shade(glass, 0.08);
      ctx.beginPath();
      ctx.moveTo(tx - 22, y);
      ctx.lineTo(tx - 28, y - h);
      ctx.lineTo(tx + 28, y - h);
      ctx.lineTo(tx + 22, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = XY_LIGHT[(k + Math.floor(tick / (st.features.neon?.interval ?? 120))) % XY_LIGHT.length];
      ctx.globalAlpha = 0.55;
      ctx.fillRect(tx - 27, y - h + 1, 54, 2);
      ctx.globalAlpha = 1;
      y -= h;
    }
    ctx.fillStyle = shade(glass, -0.1);
    ctx.fillRect(tx - 14, y - 16, 28, 16);
    ctx.fillRect(tx - 8, y - 30, 16, 14);
    ctx.fillStyle = '#d1d5db';
    ctx.fillRect(tx - 2, y - 66, 4, 36);
    ctx.fillStyle = (tick >> 4) % 2 ? '#ef4444' : '#7f1d1d';
    ctx.fillRect(tx - 2, y - 70, 4, 4);
  }
  // 近景：百貨與空橋
  const nx = camX * NEAR;
  for (let i = 0; i < 14; i++) {
    const x = i * 150 - nx;
    if (x < -160 || x > VW + 10) continue;
    ctx.fillStyle = shade('#334155', hr(i + 4) * 0.2);
    ctx.fillRect(x, GROUND_TOP - 70, 140, 70);
    ctx.fillStyle = 'rgba(255,230,170,0.35)';
    ctx.fillRect(x + 8, GROUND_TOP - 36, 124, 36);
    ctx.fillStyle = 'rgba(150,200,255,0.25)';
    ctx.fillRect(x + 8, GROUND_TOP - 64, 124, 8);
    sign(ctx, x + 22, GROUND_TOP - 54, XY_SIGNS[i % XY_SIGNS.length], XY_LIGHT[i % XY_LIGHT.length], true);
  }
  // 空橋
  ctx.fillStyle = 'rgba(203,213,225,0.9)';
  ctx.fillRect(0, GROUND_TOP - 84, VW, 8);
  ctx.fillStyle = 'rgba(148,163,184,0.9)';
  for (let i = 0; i < 10; i++) {
    const x = ((i * 180 - camX * NEAR) % (VW + 180) + VW + 180) % (VW + 180) - 90;
    ctx.fillRect(x, GROUND_TOP - 76, 6, 76);
  }
  groundTiles(ctx, camX, 48, 20, [st.palette.ground, st.palette.groundAlt], 'rgba(255,255,255,0.08)');
  frontEdge(ctx, '#1e293b');
}

// ---------------- 東區・大巨蛋 ----------------
const DOME_SIGNS = ['忠孝小館', '東區潮牌', '珍奶本舖', '巷弄咖啡', '鞋櫃專賣', '拉麵橫丁'];

function dome(ctx: Ctx, st: StageDef, camX: number, tick: number) {
  const fx = camX * FAR;
  // 國父紀念館（黃色翹簷屋頂）
  const mx = 170 - fx;
  if (mx > -200 && mx < VW + 50) {
    const by = GROUND_TOP - 30;
    ctx.fillStyle = '#f5efe0';
    ctx.fillRect(mx - 70, by - 40, 140, 40);
    ctx.fillStyle = '#9b2c2c';
    for (let k = 0; k < 7; k++) ctx.fillRect(mx - 62 + k * 21, by - 40, 5, 40);
    ctx.fillStyle = '#e6b422';
    ctx.beginPath();
    ctx.moveTo(mx - 100, by - 34);
    ctx.quadraticCurveTo(mx - 70, by - 46, mx - 50, by - 70);
    ctx.lineTo(mx + 50, by - 70);
    ctx.quadraticCurveTo(mx + 70, by - 46, mx + 100, by - 34);
    ctx.lineTo(mx + 70, by - 44);
    ctx.lineTo(mx - 70, by - 44);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade('#e6b422', -0.25);
    ctx.fillRect(mx - 50, by - 74, 100, 5);
  }
  // 大巨蛋
  const dx = 560 - fx;
  if (dx > -300 && dx < VW + 300) {
    const by = GROUND_TOP - 26;
    const g = ctx.createLinearGradient(0, by - 120, 0, by);
    g.addColorStop(0, '#f1f5f9');
    g.addColorStop(1, '#94a3b8');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(dx, by, 220, 115, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(71,85,105,0.45)';
    ctx.lineWidth = 1.5;
    for (let k = -4; k <= 4; k++) {
      ctx.beginPath();
      ctx.ellipse(dx, by, Math.abs(k) * 50 + 8, 115, 0, Math.PI, 0);
      ctx.stroke();
    }
    for (let k = 1; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse(dx, by, 220 * Math.sqrt(1 - (k / 4) ** 2), 1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#475569';
    ctx.fillRect(dx - 240, by - 2, 480, 6);
    // 演唱會燈光
    if ((tick >> 5) % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.moveTo(dx - 40, by - 110);
      ctx.lineTo(dx - 120, 0);
      ctx.lineTo(dx - 60, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(dx + 40, by - 110);
      ctx.lineTo(dx + 120, 0);
      ctx.lineTo(dx + 60, 0);
      ctx.fill();
    }
  }
  // 近景：東區商店街
  const nx = camX * NEAR;
  for (let i = 0; i < 14; i++) {
    const x = i * 130 - nx;
    if (x < -140 || x > VW + 10) continue;
    ctx.fillStyle = shade(st.palette.near, hr(i + 2) * 0.25);
    ctx.fillRect(x, GROUND_TOP - 64, 124, 64);
    ctx.fillStyle = 'rgba(255,240,200,0.4)';
    ctx.fillRect(x + 8, GROUND_TOP - 32, 108, 32);
    ctx.fillStyle = ['#ef4444', '#0ea5e9', '#f59e0b', '#10b981'][i % 4];
    ctx.fillRect(x + 4, GROUND_TOP - 38, 116, 6);
    sign(ctx, x + 20, GROUND_TOP - 60, DOME_SIGNS[i % DOME_SIGNS.length], st.palette.accent, true);
    // 行道樹
    const tx = x + 128;
    ctx.fillStyle = '#5b3a1e';
    ctx.fillRect(tx - 2, GROUND_TOP - 40, 4, 40);
    ctx.fillStyle = '#2f7d32';
    ctx.beginPath();
    ctx.arc(tx, GROUND_TOP - 48, 14, 0, Math.PI * 2);
    ctx.fill();
  }
  groundTiles(ctx, camX, 30, 15, [st.palette.ground, st.palette.groundAlt, shade(st.palette.ground, 0.08)], 'rgba(0,0,0,0.12)');
  frontEdge(ctx, '#3f2a20');
}

// ---------------- 國立台灣大學 ----------------
function palm(ctx: Ctx, x: number, baseY: number, h: number, sway: number) {
  ctx.strokeStyle = '#8d7b62';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(x + 3, baseY - h / 2, x + sway, baseY - h);
  ctx.stroke();
  ctx.strokeStyle = '#2e7d32';
  ctx.lineWidth = 3;
  const tx = x + sway;
  const ty = baseY - h;
  for (let k = 0; k < 7; k++) {
    const a = Math.PI + (k / 6) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(tx + Math.cos(a) * 14, ty + Math.sin(a) * 14 - 4, tx + Math.cos(a) * 24, ty + Math.sin(a) * 10 + 10);
    ctx.stroke();
  }
}

function ntu(ctx: Ctx, st: StageDef, camX: number, tick: number) {
  for (let i = 0; i < 5; i++) {
    const x = ((hr(i) * 1200 - camX * 0.08 + tick * 0.05) % (VW + 200)) - 100;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(x, 40 + hr(i + 5) * 50, 40, 12, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 25, 34 + hr(i + 5) * 50, 26, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 遠景：總圖書館
  const fx = camX * FAR;
  const lx = 470 - fx;
  if (lx > -300 && lx < VW + 300) {
    const by = GROUND_TOP - 24;
    ctx.fillStyle = st.palette.far;
    ctx.fillRect(lx - 200, by - 70, 400, 70);
    ctx.fillStyle = shade(st.palette.far, -0.15);
    ctx.fillRect(lx - 200, by - 74, 400, 6);
    ctx.fillStyle = st.palette.far;
    ctx.fillRect(lx - 40, by - 120, 80, 120);
    ctx.fillStyle = shade(st.palette.far, -0.2);
    ctx.beginPath();
    ctx.moveTo(lx - 46, by - 120);
    ctx.lineTo(lx, by - 140);
    ctx.lineTo(lx + 46, by - 120);
    ctx.fill();
    ctx.fillStyle = '#3d2b1f';
    ctx.beginPath();
    ctx.arc(lx, by - 30, 18, Math.PI, 0);
    ctx.fillRect(lx - 18, by - 30, 36, 30);
    ctx.fill();
    for (let k = 0; k < 12; k++) {
      if (k === 5 || k === 6) continue;
      ctx.fillStyle = '#4b3a2c';
      ctx.fillRect(lx - 188 + k * 32, by - 56, 12, 20);
    }
  }
  // 椰林大道兩側的椰子樹 + 傅鐘
  const nx = camX * NEAR;
  const bx = 360 - nx;
  if (bx > -60 && bx < VW + 60) {
    const by = GROUND_TOP - 4;
    ctx.fillStyle = '#d6d3d1';
    ctx.fillRect(bx - 22, by - 6, 44, 6);
    ctx.fillStyle = '#a8a29e';
    ctx.fillRect(bx - 18, by - 46, 6, 40);
    ctx.fillRect(bx + 12, by - 46, 6, 40);
    ctx.fillStyle = '#78716c';
    ctx.fillRect(bx - 24, by - 52, 48, 7);
    ctx.fillStyle = '#b45309';
    ctx.beginPath();
    const sw = Math.sin(tick * 0.05) * 3;
    ctx.moveTo(bx - 7 + sw, by - 44);
    ctx.lineTo(bx + 7 + sw, by - 44);
    ctx.lineTo(bx + 9 + sw, by - 26);
    ctx.lineTo(bx - 9 + sw, by - 26);
    ctx.fill();
    ctx.font = 'bold 9px "Noto Sans TC","Microsoft JhengHei",sans-serif';
    ctx.fillStyle = '#44403c';
    ctx.fillText('傅鐘', bx - 9, by - 54);
  }
  for (let i = 0; i < 22; i++) {
    const x = i * 90 + 40 - nx;
    if (x < -40 || x > VW + 40) continue;
    palm(ctx, x, GROUND_TOP - 2, 110 + hr(i) * 20, Math.sin(tick * 0.02 + i) * 3);
  }
  // 騎腳踏車的學生
  for (let i = 0; i < 5; i++) {
    const span = st.width * NEAR + VW + 200;
    const dirn = i % 2 ? 1 : -1;
    let px = (hr(i + 30) * span + dirn * tick * (0.8 + hr(i) * 0.6)) % span;
    if (px < 0) px += span;
    const x = px - 100 - nx;
    if (x < -30 || x > VW + 30) continue;
    const y = GROUND_TOP - 2;
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x - 7, y - 5, 5, 0, Math.PI * 2);
    ctx.arc(x + 7, y - 5, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 5);
    ctx.lineTo(x, y - 12);
    ctx.lineTo(x + 7, y - 5);
    ctx.stroke();
    ctx.fillStyle = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7'][i];
    ctx.fillRect(x - 3, y - 24, 6, 11);
    ctx.fillStyle = '#f1c8a0';
    ctx.beginPath();
    ctx.arc(x, y - 27, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // 地面：椰林大道（紅磚 + 中央車道）
  groundTiles(ctx, camX, 36, 12, [st.palette.ground, st.palette.groundAlt], 'rgba(60,20,10,0.25)');
  ctx.fillStyle = 'rgba(80,80,90,0.35)';
  ctx.fillRect(0, HZ + 38, VW, 44);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.setLineDash([22, 18]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-((camX % 40) + 40), HZ + 60);
  ctx.lineTo(VW, HZ + 60);
  ctx.stroke();
  ctx.setLineDash([]);
  frontEdge(ctx, '#57534e');
}

function generic(ctx: Ctx, st: StageDef, camX: number) {
  const fx = camX * FAR;
  for (let i = 0; i < 20; i++) {
    const x = i * 80 - fx;
    const h = 60 + hr(i) * 120;
    ctx.fillStyle = shade(st.palette.far, hr(i + 1) * 0.3 - 0.15);
    ctx.fillRect(x, GROUND_TOP - h, 72, h);
  }
  const nx = camX * NEAR;
  for (let i = 0; i < 16; i++) {
    const x = i * 120 - nx;
    ctx.fillStyle = shade(st.palette.near, hr(i + 7) * 0.2);
    ctx.fillRect(x, GROUND_TOP - 50, 110, 50);
  }
  groundTiles(ctx, camX, 48, 20, [st.palette.ground, st.palette.groundAlt]);
  frontEdge(ctx, shade(st.palette.ground, -0.5));
}
