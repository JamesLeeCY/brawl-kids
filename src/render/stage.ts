// 場地背景：分層矩形與漸層，2 層視差捲動（遠景慢、近景快）。招牌一律虛構店名。
import { CONFIG } from '../config';
import type { StageDef } from '../data/schema';
import type { World } from '../sim/world';
import { shade } from './character';

import { VW } from './view';
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

// ================= 類 3D 繪圖工具（參考實景照片的立體感） =================
const OL3 = 'rgba(26,21,48,0.85)';

/** 透視消失點：建築側面與屋頂朝這裡收斂；鏡頭捲動時看得到的側面會跟著改變 */
function vanish(): { x: number; y: number } {
  return { x: VW / 2, y: GROUND_TOP - 80 };
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

function poly(ctx: Ctx, pts: number[][], fill: string | CanvasGradient, stroke = true): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = OL3;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

interface Windows3D {
  rows: number;
  cols: number;
  /** 亮燈比例 0–1 */
  lit?: number;
  seed?: number;
  /** 玻璃帷幕：反射天空 */
  glass?: boolean;
  /** 拱形窗 */
  arch?: boolean;
  /** 窗框顏色（預設依牆色） */
  frame?: string;
  /** 窗戶佔格子的比例（預設 0.66） */
  size?: number;
}

interface Opts3D {
  /** 往消失點收縮的比例，越大越有厚度 */
  depth?: number;
  roof?: string;
  windows?: Windows3D;
  /** 水平飾帶：y 為距頂端的比例（0–1） */
  bands?: { y: number; h: number; color: string }[];
  outline?: boolean;
}

/** 類 3D 建築：正面 + 朝消失點的側面與屋頂，左上方光源，窗戶與底部陰影 */
function building3d(ctx: Ctx, x: number, top: number, w: number, h: number, color: string, o: Opts3D = {}): void {
  const d = o.depth ?? 0.1;
  const V = vanish();
  const px = (v: number) => v + (V.x - v) * d;
  const py = (v: number) => v + (V.y - v) * d;
  const L = x;
  const R = x + w;
  const T = top;
  const B = top + h;
  const ol = o.outline !== false;
  // 側面：建築在消失點左邊看到右側面（背光），右邊看到左側面（受光）
  if (R < V.x - 2) poly(ctx, [[R, T], [px(R), py(T)], [px(R), py(B)], [R, B]], shade(color, -0.4), ol);
  else if (L > V.x + 2) poly(ctx, [[L, T], [px(L), py(T)], [px(L), py(B)], [L, B]], shade(color, -0.14), ol);
  // 屋頂：比消失點低的建築才看得到
  if (T > V.y) poly(ctx, [[L, T], [R, T], [px(R), py(T)], [px(L), py(T)]], o.roof ?? shade(color, 0.22), ol);
  // 正面（含窗戶、飾帶、光影）不受鏡頭影響 → 畫進離屏快取，之後每幀只貼一張圖
  ctx.drawImage(frontCache(ctx, w, h, color, o, ol), L - 1, T - 1, w + 2, h + 2);
}

const FRONT_CACHE = new Map<string, HTMLCanvasElement>();

function frontCache(ctx: Ctx, w: number, h: number, color: string, o: Opts3D, ol: boolean): HTMLCanvasElement {
  const sc = Math.min(3, Math.max(1, Math.round(ctx.getTransform().a)));
  const key = `${Math.round(w)}|${Math.round(h)}|${color}|${sc}|${ol}|${JSON.stringify(o.windows ?? 0)}|${JSON.stringify(o.bands ?? 0)}`;
  let img = FRONT_CACHE.get(key);
  if (img) return img;
  if (FRONT_CACHE.size > 800) FRONT_CACHE.clear();
  img = document.createElement('canvas');
  img.width = Math.ceil((w + 2) * sc);
  img.height = Math.ceil((h + 2) * sc);
  const c = img.getContext('2d')!;
  c.scale(sc, sc);
  c.translate(1, 1);
  drawFront(c, w, h, color, o, ol);
  FRONT_CACHE.set(key, img);
  return img;
}

function drawFront(ctx: Ctx, w: number, h: number, color: string, o: Opts3D, ol: boolean): void {
  // 正面：左上亮、右下暗
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, shade(color, 0.16));
  g.addColorStop(1, shade(color, -0.16));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (const b of o.bands ?? []) {
    ctx.fillStyle = b.color;
    ctx.fillRect(0, h * b.y, w, b.h);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, h * b.y + b.h, w, 1.5);
  }
  if (o.windows) windowGrid(ctx, 0, 0, w, h, color, o.windows);
  // 邊緣受光線
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(0, 0, 2, h);
  // 底部環境光遮蔽
  const ao = ctx.createLinearGradient(0, h - 16, 0, h);
  ao.addColorStop(0, 'rgba(0,0,0,0)');
  ao.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = ao;
  ctx.fillRect(0, h - 16, w, 16);
  if (ol) {
    ctx.strokeStyle = OL3;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(0, 0, w, h);
  }
}

function windowGrid(ctx: Ctx, L: number, T: number, w: number, h: number, wall: string, wo: Windows3D): void {
  const padX = w * 0.07;
  const padY = h * 0.07;
  const cw = (w - padX * 2) / wo.cols;
  const ch = (h - padY * 2) / wo.rows;
  const k = wo.size ?? 0.66;
  const ww = cw * k;
  const wh = ch * k * 0.96;
  const xs: number[] = [];
  const ys: number[] = [];
  const lits: boolean[] = [];
  for (let r = 0; r < wo.rows; r++)
    for (let c = 0; c < wo.cols; c++) {
      xs.push(L + padX + c * cw + (cw - ww) / 2);
      ys.push(T + padY + r * ch + (ch - wh) / 2);
      lits.push(hr((wo.seed ?? 1) * 97 + r * 13 + c * 7) < (wo.lit ?? 0.3));
    }
  const n = xs.length;
  // 依顏色分批：窗框 → 窗玻璃下半 → 上半 → 反光 → 窗台
  ctx.fillStyle = wo.frame ?? shade(wall, -0.35);
  for (let i = 0; i < n; i++) ctx.fillRect(xs[i] - 1, ys[i] - 1, ww + 2, wh + 2);
  const pass = (lit: boolean, bot: string, top: string) => {
    ctx.fillStyle = bot;
    for (let i = 0; i < n; i++) {
      if (lits[i] !== lit) continue;
      if (wo.arch) {
        ctx.beginPath();
        ctx.moveTo(xs[i], ys[i] + wh);
        ctx.lineTo(xs[i], ys[i] + ww / 2);
        ctx.arc(xs[i] + ww / 2, ys[i] + ww / 2, ww / 2, Math.PI, 0);
        ctx.lineTo(xs[i] + ww, ys[i] + wh);
        ctx.fill();
      } else ctx.fillRect(xs[i], ys[i], ww, wh);
    }
    ctx.fillStyle = top;
    for (let i = 0; i < n; i++) {
      if (lits[i] !== lit) continue;
      if (wo.arch) ctx.fillRect(xs[i] + 1, ys[i] + ww / 2, ww * 0.35, wh * 0.4);
      else ctx.fillRect(xs[i], ys[i], ww, wh * 0.45);
    }
  };
  pass(true, '#ffc95a', '#fff3c4');
  pass(false, wo.glass ? '#4f6f99' : '#2b3446', wo.glass ? '#d6ecff' : '#5d6b80');
  if (!wo.arch && ww >= 6) {
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    for (let i = 0; i < n; i++) if (!lits[i]) ctx.fillRect(xs[i] + ww * 0.3, ys[i], ww * 0.16, wh);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < n; i++) ctx.fillRect(xs[i] - 1, ys[i] + wh + 1, ww + 2, 1.2);
}

/** 大氣透視：遠景罩上一層天空色的霧，越接近地平線越濃 */
function haze(ctx: Ctx, st: StageDef, a = 0.32): void {
  const g = ctx.createLinearGradient(0, GROUND_TOP - 260, 0, GROUND_TOP);
  g.addColorStop(0, rgba(st.palette.skyBottom, 0));
  g.addColorStop(1, rgba(st.palette.skyBottom, a));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, GROUND_TOP);
}

/** 太陽 / 月亮與光暈（依天空亮度自動判斷） */
function skyLight(ctx: Ctx, st: StageDef, camX: number): void {
  const night = luminance(st.palette.skyTop) < 0.3;
  const x = VW * 0.8 - camX * 0.03;
  const y = night ? 62 : 70;
  const glow = ctx.createRadialGradient(x, y, 4, x, y, night ? 80 : 170);
  glow.addColorStop(0, night ? 'rgba(255,250,220,0.35)' : 'rgba(255,252,230,0.75)');
  glow.addColorStop(1, 'rgba(255,250,220,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 180, y - 180, 360, 360);
  ctx.fillStyle = night ? '#fdf6d8' : '#fffdf0';
  ctx.beginPath();
  ctx.arc(x, y, night ? 15 : 22, 0, Math.PI * 2);
  ctx.fill();
  if (night) {
    ctx.fillStyle = 'rgba(200,190,150,0.45)';
    for (const [cx, cy, r] of [[-4, -3, 3.5], [5, 4, 2.5], [3, -6, 1.8]]) {
      ctx.beginPath();
      ctx.arc(x + cx, y + cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** 地面接觸陰影：近景建築與地面交界的暗帶 */
function contactShadow(ctx: Ctx): void {
  const g = ctx.createLinearGradient(0, GROUND_TOP, 0, GROUND_TOP + 24);
  g.addColorStop(0, 'rgba(0,0,0,0.32)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, GROUND_TOP, VW, 24);
}

/** 圓頂 / 球面的立體光影 */
function sphereShade(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, base: string): CanvasGradient {
  const g = ctx.createRadialGradient(cx - rx * 0.35, cy - ry * 0.55, rx * 0.05, cx, cy, Math.max(rx, ry) * 1.05);
  g.addColorStop(0, shade(base, 0.45));
  g.addColorStop(0.55, base);
  g.addColorStop(1, shade(base, -0.35));
  return g;
}

export function drawStage(ctx: Ctx, w: World, camX: number): void {
  const st = w.stage;
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_TOP);
  g.addColorStop(0, st.palette.skyTop);
  g.addColorStop(1, st.palette.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, GROUND_TOP + 2);
  skyLight(ctx, st, camX);
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
    case 'zoo':
      zoo(ctx, st, camX, w.tick);
      break;
    case 'maokong':
      maokong(ctx, st, camX, w.tick);
      break;
    case 'expo':
      expo(ctx, st, camX, w.tick);
      break;
    case 'chifeng':
      chifeng(ctx, st, camX, w.tick);
      break;
    case 'government':
      government(ctx, st, camX, w.tick);
      break;
    default:
      generic(ctx, st, camX);
  }
  contactShadow(ctx);
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

/** 類 3D 地面：越近的磚列越高（透視壓縮）、每塊磚有斜面受光與陰影、遠暗近亮。
 *  依顏色分批呼叫 fillRect（比逐塊切換顏色或 Path2D 合併都快）。 */
const GROUND_CACHE = new Map<string, HTMLCanvasElement>();

/** 地面以「水平重複的長條圖」快取：顏色週期 = 磚寬 × 顏色數，鏡頭移動時只平移貼圖 */
function groundTiles(ctx: Ctx, camX: number, tw: number, th: number, colors: string[], _lines?: string) {
  const period = tw * colors.length * 2;
  const sc = Math.min(3, Math.max(1, Math.round(ctx.getTransform().a)));
  const width = Math.ceil(VW + period + tw);
  const key = `${tw}|${th}|${colors.join(',')}|${sc}|${width}`;
  let img = GROUND_CACHE.get(key);
  if (!img) {
    if (GROUND_CACHE.size > 30) GROUND_CACHE.clear();
    img = document.createElement('canvas');
    img.width = width * sc;
    img.height = Math.ceil((GROUND_BOTTOM - GROUND_TOP) * sc);
    const c = img.getContext('2d')!;
    c.scale(sc, sc);
    c.translate(0, -GROUND_TOP);
    drawGroundTiles(c, 0, tw, th, colors, width);
    GROUND_CACHE.set(key, img);
  }
  const shift = ((camX % period) + period) % period;
  ctx.drawImage(img, -shift, GROUND_TOP, width, GROUND_BOTTOM - GROUND_TOP);
}

function drawGroundTiles(ctx: Ctx, camX: number, tw: number, th: number, colors: string[], VWIDTH: number) {
  const H = GROUND_BOTTOM - GROUND_TOP;
  const tiles: number[] = []; // x, y, h, colorIdx, bevel
  let y = GROUND_TOP;
  let row = 0;
  while (y < GROUND_BOTTOM) {
    const t = (y - GROUND_TOP) / H;
    const rh = Math.max(5, th * (0.6 + 0.85 * t));
    const off = row % 2 ? tw / 2 : 0;
    const start = Math.floor((camX - off) / tw) - 1;
    const bevel = 1 + t * 1.5;
    for (let i = start; i * tw + off - camX < VWIDTH + tw; i++) {
      tiles.push(i * tw + off - camX, y, rh, (((i + row * 7) % colors.length) + colors.length) % colors.length, bevel);
    }
    y += rh;
    row++;
  }
  for (let c = 0; c < colors.length; c++) {
    ctx.fillStyle = colors[c];
    for (let k = 0; k < tiles.length; k += 5) if (tiles[k + 3] === c) ctx.fillRect(tiles[k], tiles[k + 1], tw, tiles[k + 2]);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  for (let k = 0; k < tiles.length; k += 5) {
    ctx.fillRect(tiles[k], tiles[k + 1], tw, tiles[k + 4]);
    ctx.fillRect(tiles[k], tiles[k + 1], tiles[k + 4], tiles[k + 2]);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  for (let k = 0; k < tiles.length; k += 5) {
    const bv = tiles[k + 4];
    ctx.fillRect(tiles[k], tiles[k + 1] + tiles[k + 2] - bv, tw, bv);
    ctx.fillRect(tiles[k] + tw - bv, tiles[k + 1], bv, tiles[k + 2]);
  }
  // 遠暗近亮 + 地平線附近的霧
  const g = ctx.createLinearGradient(0, GROUND_TOP, 0, GROUND_BOTTOM);
  g.addColorStop(0, 'rgba(20,24,48,0.3)');
  g.addColorStop(0.45, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(255,255,255,0.08)');
  ctx.fillStyle = g;
  ctx.fillRect(0, GROUND_TOP, VWIDTH, H);
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
    building3d(ctx, x, GROUND_TOP - 40 - h, 76, h + 40, shade(st.palette.near, -0.05 + hr(i + 3) * 0.25), {
      depth: 0.08,
      windows: { rows: Math.round(h / 16), cols: 4, lit: 0.45, seed: i },
    });
  }
  haze(ctx, st, 0.28);
  const rx = 330 - fx;
  if (rx > -160 && rx < VW + 20) {
    // 西門紅樓：紅磚八角樓（立體量體 + 八角塔樓 + 尖頂）
    const by = GROUND_TOP - 30;
    building3d(ctx, rx - 10, by - 58, 130, 58, st.palette.far, {
      depth: 0.07,
      windows: { rows: 1, cols: 5, arch: true, lit: 1, seed: 3 },
      bands: [{ y: 0, h: 4, color: shade(st.palette.far, 0.35) }],
    });
    building3d(ctx, rx + 22, by - 92, 66, 34, shade(st.palette.far, 0.05), {
      depth: 0.07,
      windows: { rows: 1, cols: 3, arch: true, lit: 1, seed: 5 },
    });
    const roofG = ctx.createLinearGradient(rx + 20, 0, rx + 90, 0);
    roofG.addColorStop(0, shade(st.palette.far, -0.05));
    roofG.addColorStop(1, shade(st.palette.far, -0.45));
    poly(ctx, [[rx + 18, by - 92], [rx + 55, by - 116], [rx + 92, by - 92]], roofG);
  }
  // 近景：店面 + 霓虹招牌
  const nx = camX * NEAR;
  for (let i = 0; i < 16; i++) {
    const x = i * 120 - nx;
    if (x < -130 || x > VW + 10) continue;
    building3d(ctx, x, GROUND_TOP - 70, 116, 70, shade(st.palette.near, hr(i + 9) * 0.25), { depth: 0.04 });
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
    building3d(ctx, x, GROUND_TOP - 30 - h, 78, h + 30, shade(st.palette.near, 0.05 + hr(i) * 0.25), {
      depth: 0.09,
      windows: { rows: Math.round(h / 11), cols: 5, glass: true, lit: 0.3, seed: i + 40 },
    });
  }
  haze(ctx, st, 0.22);
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
      // 每一節：玻璃正面（左亮右暗）+ 右側立面，呈現斗拱狀外擴的立體感
      const sg = ctx.createLinearGradient(tx - 28, 0, tx + 28, 0);
      sg.addColorStop(0, shade(glass, 0.35));
      sg.addColorStop(0.5, glass);
      sg.addColorStop(1, shade(glass, -0.3));
      poly(ctx, [[tx - 22, y], [tx - 28, y - h], [tx + 28, y - h], [tx + 22, y]], sg);
      poly(ctx, [[tx + 22, y], [tx + 28, y - h], [tx + 33, y - h + 3], [tx + 26, y + 2]], shade(glass, -0.45));
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      for (let m = -18; m <= 18; m += 9) {
        ctx.beginPath();
        ctx.moveTo(tx + m * 0.8, y);
        ctx.lineTo(tx + m, y - h);
        ctx.stroke();
      }
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
    building3d(ctx, x, GROUND_TOP - 70, 140, 70, shade('#3d4b63', hr(i + 4) * 0.25), {
      depth: 0.05,
      windows: { rows: 1, cols: 4, glass: true, lit: 0.2, seed: i },
    });
    ctx.fillStyle = 'rgba(255,230,170,0.45)';
    ctx.fillRect(x + 8, GROUND_TOP - 30, 124, 30);
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
    ctx.fillStyle = sphereShade(ctx, dx, by, 220, 115, '#c8d2de');
    ctx.beginPath();
    ctx.ellipse(dx, by, 220, 115, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = OL3;
    ctx.lineWidth = 2;
    ctx.stroke();
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
  haze(ctx, st, 0.2);
  // 近景：東區商店街
  const nx = camX * NEAR;
  for (let i = 0; i < 14; i++) {
    const x = i * 130 - nx;
    if (x < -140 || x > VW + 10) continue;
    building3d(ctx, x, GROUND_TOP - 64, 124, 64, shade(st.palette.near, hr(i + 2) * 0.3), {
      depth: 0.05,
      windows: { rows: 1, cols: 3, lit: 0.6, seed: i + 7 },
    });
    ctx.fillStyle = 'rgba(255,240,200,0.4)';
    ctx.fillRect(x + 8, GROUND_TOP - 32, 108, 32);
    ctx.fillStyle = ['#ef4444', '#0ea5e9', '#f59e0b', '#10b981'][i % 4];
    ctx.fillRect(x + 4, GROUND_TOP - 38, 116, 6);
    sign(ctx, x + 20, GROUND_TOP - 60, DOME_SIGNS[i % DOME_SIGNS.length], st.palette.accent, true);
    // 行道樹
    const tx = x + 128;
    ctx.fillStyle = '#5b3a1e';
    ctx.fillRect(tx - 2, GROUND_TOP - 40, 4, 40);
    ctx.fillStyle = sphereShade(ctx, tx, GROUND_TOP - 48, 14, 14, '#2f7d32');
    ctx.beginPath();
    ctx.arc(tx, GROUND_TOP - 48, 14, 0, Math.PI * 2);
    ctx.fill();
  }
  groundTiles(ctx, camX, 30, 15, [st.palette.ground, st.palette.groundAlt, shade(st.palette.ground, 0.08)], 'rgba(0,0,0,0.12)');
  frontEdge(ctx, '#3f2a20');
}

// ---------------- 國立台灣大學 ----------------
function palm(ctx: Ctx, x: number, baseY: number, h: number, sway: number) {
  // 樹幹：陰影側 + 受光側兩道線，呈現圓柱感
  ctx.strokeStyle = '#6d5d48';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(x + 3, baseY - h / 2, x + sway, baseY - h);
  ctx.stroke();
  ctx.strokeStyle = '#a8977c';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x - 1.5, baseY);
  ctx.quadraticCurveTo(x + 1.5, baseY - h / 2, x + sway - 1.5, baseY - h);
  ctx.stroke();
  ctx.strokeStyle = '#8d7b62';
  ctx.lineWidth = 0.01;
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
    // 總圖書館：兩翼 + 中央塔樓，紅磚色立面與拱窗
    building3d(ctx, lx - 200, by - 70, 400, 70, st.palette.far, {
      depth: 0.06,
      windows: { rows: 2, cols: 12, arch: true, lit: 0.15, seed: 11 },
      bands: [{ y: 0, h: 5, color: shade(st.palette.far, -0.2) }],
    });
    building3d(ctx, lx - 40, by - 120, 80, 120, shade(st.palette.far, 0.06), {
      depth: 0.06,
      windows: { rows: 5, cols: 2, arch: true, lit: 0.35, seed: 12, size: 0.42 },
    });
    const rg = ctx.createLinearGradient(lx - 46, 0, lx + 46, 0);
    rg.addColorStop(0, shade(st.palette.far, -0.05));
    rg.addColorStop(1, shade(st.palette.far, -0.45));
    poly(ctx, [[lx - 46, by - 120], [lx, by - 142], [lx + 46, by - 120]], rg);
    ctx.fillStyle = '#3d2b1f';
    ctx.beginPath();
    ctx.arc(lx, by - 30, 18, Math.PI, 0);
    ctx.fillRect(lx - 18, by - 30, 36, 30);
    ctx.fill();
  }
  haze(ctx, st, 0.25);
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

// ================= 荒野亂鬥式粗描邊小工具 =================
const OL = '#1a1530';

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 填色後加深色粗描邊 */
function ol(ctx: Ctx, fill: string | CanvasGradient, path: () => void, lw = 2.5) {
  ctx.beginPath();
  path();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OL;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function box(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, r = 4, lw = 2.5) {
  ol(ctx, fill, () => rr(ctx, x, y, w, h, r), lw);
}

function blob(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient, lw = 2.5) {
  ol(ctx, fill, () => ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2), lw);
}

function cloudsOl(ctx: Ctx, camX: number, tick: number) {
  for (let i = 0; i < 5; i++) {
    const x = ((hr(i + 3) * 1400 - camX * 0.08 + tick * 0.06) % (VW + 220)) - 110;
    const y = 30 + hr(i + 8) * 55;
    const cg = ctx.createLinearGradient(0, y - 18, 0, y + 13);
    cg.addColorStop(0, '#ffffff');
    cg.addColorStop(1, '#c9d8ec');
    ol(ctx, cg, () => {
      ctx.ellipse(x, y, 34, 13, 0, 0, Math.PI * 2);
      ctx.moveTo(x + 46, y - 4);
      ctx.ellipse(x + 22, y - 4, 24, 14, 0, 0, Math.PI * 2);
    }, 2);
  }
}

/** 粗描邊的行道樹 */
function treeOl(ctx: Ctx, x: number, baseY: number, h: number, leaf = '#3fb34f') {
  box(ctx, x - 4, baseY - h * 0.45, 8, h * 0.45, '#8a5a3b', 2, 2);
  // 樹冠：球狀光影 + 地面陰影
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(x + 4, baseY, h * 0.28, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  blob(ctx, x, baseY - h * 0.6, h * 0.32, h * 0.3, sphereShade(ctx, x, baseY - h * 0.6, h * 0.32, h * 0.3, leaf), 2.5);
  blob(ctx, x - h * 0.16, baseY - h * 0.5, h * 0.17, h * 0.15, sphereShade(ctx, x - h * 0.16, baseY - h * 0.5, h * 0.17, h * 0.15, shade(leaf, -0.08)), 2);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  ctx.ellipse(x - h * 0.1, baseY - h * 0.7, h * 0.12, h * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 粗描邊地磚 + 前緣 */
function groundOl(ctx: Ctx, camX: number, tw: number, th: number, colors: string[], edge: string) {
  groundTiles(ctx, camX, tw, th, colors, 'rgba(26,21,48,0.22)');
  ctx.fillStyle = OL;
  ctx.fillRect(0, GROUND_TOP - 2, VW, 3);
  frontEdge(ctx, edge);
}

// ---------------- 木柵動物園 ----------------
function zoo(ctx: Ctx, st: StageDef, camX: number, tick: number) {
  cloudsOl(ctx, camX, tick);
  const fx = camX * 0.2;
  // 遠景：層層山丘
  for (let layer = 0; layer < 2; layer++) {
    const col = layer ? st.palette.far : shade(st.palette.far, -0.25);
    for (let i = -1; i < 12; i++) {
      const x = i * 170 - (fx * (layer + 1)) % 170;
      blob(ctx, x, GROUND_TOP - 40 + layer * 18, 130, 70 - layer * 15, sphereShade(ctx, x, GROUND_TOP - 40 + layer * 18, 130, 70 - layer * 15, col), 2.5);
    }
  }
  haze(ctx, st, 0.25);
  const nx = camX * NEAR;
  // 動物園大門
  const gx = 260 - nx;
  if (gx > -160 && gx < VW + 160) {
    box(ctx, gx - 90, GROUND_TOP - 120, 22, 120, '#e07a3c', 3);
    box(ctx, gx + 68, GROUND_TOP - 120, 22, 120, '#e07a3c', 3);
    box(ctx, gx - 104, GROUND_TOP - 140, 208, 34, '#ffcf33', 10);
    ctx.font = `900 18px "Noto Sans TC","Microsoft JhengHei",sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = OL;
    ctx.strokeText('動物園', gx, GROUND_TOP - 116);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('動物園', gx, GROUND_TOP - 116);
    ctx.textAlign = 'left';
  }
  // 圍欄
  for (let i = 0; i < 26; i++) {
    const x = i * 60 - (nx % 60);
    box(ctx, x, GROUND_TOP - 30, 7, 30, '#b07a4f', 2, 2);
  }
  ctx.strokeStyle = OL;
  ctx.lineWidth = 2;
  ctx.fillStyle = '#c8935e';
  for (const y of [GROUND_TOP - 24, GROUND_TOP - 12]) {
    ctx.fillRect(0, y, VW, 4);
    ctx.strokeRect(-2, y, VW + 4, 4);
  }
  // 動物們
  const bob = (k: number) => Math.sin(tick * 0.05 + k) * 2;
  const ax = (wx: number) => wx - nx;
  // 長頸鹿
  const g = ax(620);
  if (g > -80 && g < VW + 80) {
    const by = GROUND_TOP - 30 + bob(1);
    box(ctx, g - 6, by - 105, 12, 70, '#f6c343', 6);
    blob(ctx, g + 4, by - 108, 13, 9, '#f6c343');
    box(ctx, g - 30, by - 46, 56, 28, '#f6c343', 12);
    for (const [sx, sy] of [[-18, -38], [0, -32], [12, -40], [-2, -80], [-1, -62]]) {
      ctx.fillStyle = '#b5651d';
      ctx.beginPath();
      ctx.arc(g + sx, by + sy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const lx of [-24, -12, 8, 18]) box(ctx, g + lx, by - 20, 6, 22, '#f6c343', 2, 2);
    ctx.fillStyle = OL;
    ctx.beginPath();
    ctx.arc(g + 10, by - 110, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // 大象
  const e = ax(900);
  if (e > -90 && e < VW + 90) {
    const by = GROUND_TOP - 30 + bob(2);
    blob(ctx, e, by - 30, 38, 26, '#9aa7b8');
    blob(ctx, e + 34, by - 38, 18, 16, '#9aa7b8');
    blob(ctx, e + 22, by - 40, 12, 14, '#b9c3d1', 2);
    box(ctx, e + 44, by - 36, 7, 30, '#9aa7b8', 3, 2);
    for (const lx of [-28, -12, 8, 22]) box(ctx, e + lx, by - 12, 11, 14, '#9aa7b8', 3, 2);
    ctx.fillStyle = OL;
    ctx.beginPath();
    ctx.arc(e + 38, by - 42, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // 熊貓
  const p = ax(1150);
  if (p > -60 && p < VW + 60) {
    const by = GROUND_TOP - 28 + bob(3);
    blob(ctx, p, by - 16, 22, 18, '#ffffff');
    blob(ctx, p, by - 42, 16, 14, '#ffffff');
    for (const ex of [-11, 11]) blob(ctx, p + ex, by - 54, 6, 6, '#1f1f1f', 2);
    for (const ex of [-6, 6]) {
      ctx.fillStyle = '#1f1f1f';
      ctx.beginPath();
      ctx.ellipse(p + ex, by - 43, 4, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    box(ctx, p - 24, by - 26, 10, 18, '#1f1f1f', 4, 2);
    box(ctx, p + 14, by - 26, 10, 18, '#1f1f1f', 4, 2);
  }
  for (let i = 0; i < 9; i++) {
    const x = i * 210 + 80 - nx * 1.05;
    if (x > -60 && x < VW + 60) treeOl(ctx, x, GROUND_TOP - 2, 70 + hr(i) * 30);
  }
  groundOl(ctx, camX, 44, 18, [st.palette.ground, st.palette.groundAlt], '#4f9b3a');
}

// ---------------- 貓空纜車・泡茶 ----------------
function maokong(ctx: Ctx, st: StageDef, camX: number, tick: number) {
  cloudsOl(ctx, camX, tick);
  const fx = camX * 0.18;
  // 茶園山坡（梯田線）
  for (let layer = 0; layer < 3; layer++) {
    const col = shade(st.palette.far, -0.3 + layer * 0.15);
    ol(ctx, col, () => {
      ctx.moveTo(0, GROUND_TOP);
      for (let x = 0; x <= VW + 20; x += 20) {
        const wx = (x + fx * (layer + 1)) / 60;
        ctx.lineTo(x, GROUND_TOP - 70 - layer * -18 - 60 * (0.6 + 0.4 * Math.sin(wx + layer * 2)));
      }
      ctx.lineTo(VW, GROUND_TOP);
      ctx.closePath();
    }, 2.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    for (let r = 1; r < 4; r++) {
      ctx.beginPath();
      for (let x = 0; x <= VW; x += 20) {
        const wx = (x + fx * (layer + 1)) / 60;
        const y = GROUND_TOP - 70 - layer * -18 - 60 * (0.6 + 0.4 * Math.sin(wx + layer * 2)) + r * 14;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  haze(ctx, st, 0.3);
  // 纜車：斜纜線 + 移動車廂
  const cx = camX * 0.4;
  const y0 = 150;
  const slope = -0.12;
  ctx.strokeStyle = OL;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, y0 + slope * (0 + cx));
  ctx.lineTo(VW, y0 + slope * (VW + cx) );
  ctx.stroke();
  const colors = ['#ff5a5f', '#ffcf33', '#4fc3ff', '#7ed957'];
  for (let i = 0; i < 6; i++) {
    const span = VW + 400;
    const wx = ((i * 260 + tick * 0.6) % span) - 200;
    const y = y0 + slope * (wx + cx);
    ctx.strokeStyle = OL;
    ctx.beginPath();
    ctx.moveTo(wx, y);
    ctx.lineTo(wx, y + 12);
    ctx.stroke();
    box(ctx, wx - 16, y + 12, 32, 26, colors[i % colors.length], 8);
    box(ctx, wx - 11, y + 17, 22, 10, '#d9f6ff', 3, 1.5);
  }
  // 近景：茶坊
  const nx = camX * NEAR;
  for (let i = 0; i < 8; i++) {
    const x = i * 230 + 40 - nx;
    if (x < -220 || x > VW + 20) continue;
    building3d(ctx, x, GROUND_TOP - 70, 190, 70, '#c98f5c', { depth: 0.05, windows: { rows: 1, cols: 2, lit: 0.7, seed: i } });
    ol(ctx, '#7a3b2e', () => {
      ctx.moveTo(x - 14, GROUND_TOP - 68);
      ctx.lineTo(x + 95, GROUND_TOP - 106);
      ctx.lineTo(x + 204, GROUND_TOP - 68);
      ctx.closePath();
    });
    box(ctx, x + 64, GROUND_TOP - 64, 62, 18, '#fff3d6', 4, 2);
    ctx.font = `900 12px "Noto Sans TC","Microsoft JhengHei",sans-serif`;
    ctx.fillStyle = '#7a3b2e';
    ctx.textAlign = 'center';
    ctx.fillText(['貓空茶坊', '山頂茶屋', '雲霧茶舖'][i % 3], x + 95, GROUND_TOP - 51);
    ctx.textAlign = 'left';
    for (let k = 0; k < 3; k++) {
      const lx = x + 22 + k * 70;
      const sw = Math.sin(tick * 0.06 + k + i) * 2;
      ctx.strokeStyle = OL;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx, GROUND_TOP - 70);
      ctx.lineTo(lx + sw, GROUND_TOP - 60);
      ctx.stroke();
      blob(ctx, lx + sw, GROUND_TOP - 52, 7, 9, '#ff4d4d', 2);
    }
    // 茶桌與茶壺
    box(ctx, x + 20, GROUND_TOP - 30, 60, 8, '#8d5a3b', 2, 2);
    blob(ctx, x + 50, GROUND_TOP - 36, 8, 6, '#6d8b74', 2);
    box(ctx, x + 120, GROUND_TOP - 30, 60, 8, '#8d5a3b', 2, 2);
  }
  // 地面：木棧平台
  groundOl(ctx, camX, 80, 12, [st.palette.ground, st.palette.groundAlt, shade(st.palette.ground, -0.08)], '#3d6b2e');
}

// ---------------- 圓山花博 ----------------
function expo(ctx: Ctx, st: StageDef, camX: number, tick: number) {
  cloudsOl(ctx, camX, tick);
  const fx = camX * FAR;
  // 遠景：山丘上的紅色宮殿式大飯店
  const hx = 420 - fx;
  blob(ctx, hx, GROUND_TOP - 20, 260, 90, sphereShade(ctx, hx, GROUND_TOP - 20, 260, 90, '#4caf50'));
  if (hx > -260 && hx < VW + 260) {
    const by = GROUND_TOP - 92;
    building3d(ctx, hx - 110, by - 46, 220, 46, st.palette.far, {
      depth: 0.06,
      windows: { rows: 1, cols: 9, lit: 0.8, seed: 21 },
    });
    for (let tier = 0; tier < 3; tier++) {
      const w = 250 - tier * 60;
      const y = by - 46 - tier * 26;
      ol(ctx, '#ffb300', () => {
        ctx.moveTo(hx - w / 2 - 12, y);
        ctx.quadraticCurveTo(hx - w / 2, y - 6, hx - w / 2 + 14, y - 14);
        ctx.lineTo(hx + w / 2 - 14, y - 14);
        ctx.quadraticCurveTo(hx + w / 2, y - 6, hx + w / 2 + 12, y);
        ctx.closePath();
      });
      if (tier < 2) box(ctx, hx - w / 2 + 34, y - 26, w - 68, 12, st.palette.far, 1, 2);
    }
  }
  haze(ctx, st, 0.25);
  // 近景：花博爭艷館風格的白色穹頂展館
  const nx = camX * NEAR;
  const dx = 760 - nx;
  if (dx > -200 && dx < VW + 200) {
    ol(ctx, sphereShade(ctx, dx, GROUND_TOP - 40, 150, 110, '#e6ecf4'), () => {
      ctx.moveTo(dx - 150, GROUND_TOP - 4);
      ctx.quadraticCurveTo(dx - 140, GROUND_TOP - 110, dx, GROUND_TOP - 118);
      ctx.quadraticCurveTo(dx + 140, GROUND_TOP - 110, dx + 150, GROUND_TOP - 4);
      ctx.closePath();
    }, 3);
    ctx.strokeStyle = 'rgba(26,21,48,0.35)';
    ctx.lineWidth = 2;
    for (let k = -3; k <= 3; k++) {
      ctx.beginPath();
      ctx.moveTo(dx + k * 40, GROUND_TOP - 4);
      ctx.quadraticCurveTo(dx + k * 30, GROUND_TOP - 90, dx, GROUND_TOP - 116);
      ctx.stroke();
    }
    box(ctx, dx - 40, GROUND_TOP - 40, 80, 36, '#9fd8ff', 6);
  }
  // 花圃（彩色圓點排）
  const flower = ['#ff4f9a', '#ffcf33', '#b46cff', '#ff7043', '#ffffff'];
  for (let i = 0; i < 70; i++) {
    const x = ((i * 26 - nx) % (VW + 40) + VW + 40) % (VW + 40) - 20;
    const y = GROUND_TOP - 10 - (i % 2) * 8;
    blob(ctx, x, y, 7, 7, flower[i % flower.length], 1.8);
    ctx.fillStyle = '#ffeb3b';
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  groundOl(ctx, camX, 40, 20, [st.palette.ground, st.palette.groundAlt, '#f3e3c3'], '#5cbf4a');
  // 前緣花帶
  for (let i = 0; i < 40; i++) {
    const x = ((i * 22 - camX * 1.1) % (VW + 30) + VW + 30) % (VW + 30) - 15;
    blob(ctx, x, GROUND_BOTTOM + 10, 6, 6, flower[(i + 2) % flower.length], 1.6);
  }
}

// ---------------- 中山赤峰街 ----------------
const CF_SIGNS = ['鐵件五金', '老宅咖啡', '選物小店', '機車行', '手作甜點', '二手唱片', '花藝工作室', '螺絲專賣'];

function chifeng(ctx: Ctx, st: StageDef, camX: number, tick: number) {
  const fx = camX * FAR;
  // 遠景：老公寓與陽台
  for (let i = 0; i < 16; i++) {
    const x = i * 100 - fx;
    if (x < -110 || x > VW + 10) continue;
    const h = 120 + hr(i + 4) * 60;
    const floors = Math.max(2, Math.floor((h - 10) / 30));
    building3d(ctx, x, GROUND_TOP - 40 - h, 92, h + 40, shade(st.palette.far, -0.1 + hr(i) * 0.3), {
      depth: 0.07,
      windows: { rows: floors + 1, cols: 2, lit: 0.55, seed: i + 60 },
    });
    // 陽台：外凸的板與欄杆，帶陰影
    for (let f = 1; f <= floors; f++) {
      const y = GROUND_TOP - 40 - h + ((h + 40) * f) / (floors + 1) - 3;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + 2, y + 5, 88, 4);
      box(ctx, x - 2, y, 96, 5, '#8a6a52', 1, 1.2);
      if (hr(i + f * 3) > 0.55) blob(ctx, x + 18, y - 4, 6, 5, sphereShade(ctx, x + 18, y - 4, 6, 5, '#4caf50'), 1.2);
    }
  }
  haze(ctx, st, 0.25);
  // 近景：一樓店面
  const nx = camX * NEAR;
  const blink = Math.floor(tick / (st.features.neon?.interval ?? 150));
  for (let i = 0; i < 14; i++) {
    const x = i * 120 - nx;
    if (x < -130 || x > VW + 10) continue;
    building3d(ctx, x, GROUND_TOP - 70, 114, 70, shade(st.palette.near, hr(i + 2) * 0.3), { depth: 0.04 });
    // 鐵捲門或玻璃店面
    if (i % 3 === 0) {
      box(ctx, x + 8, GROUND_TOP - 46, 98, 46, '#b0b7c0', 2, 2);
      ctx.strokeStyle = 'rgba(26,21,48,0.3)';
      ctx.lineWidth = 1;
      for (let y = GROUND_TOP - 42; y < GROUND_TOP; y += 5) {
        ctx.beginPath();
        ctx.moveTo(x + 9, y);
        ctx.lineTo(x + 105, y);
        ctx.stroke();
      }
    } else {
      box(ctx, x + 8, GROUND_TOP - 46, 98, 46, 'rgba(255,224,150,0.85)', 2, 2);
      box(ctx, x + 14, GROUND_TOP - 22, 18, 22, '#6d4c41', 2, 1.5);
      blob(ctx, x + 92, GROUND_TOP - 10, 9, 10, '#43a047', 1.8);
    }
    const on = (blink + i) % 3 !== 0;
    sign(ctx, x + 18, GROUND_TOP - 66, CF_SIGNS[i % CF_SIGNS.length], on ? st.palette.accent : '#ffcf33', true);
  }
  // 串燈
  for (let i = 0; i < 40; i++) {
    const x = ((i * 34 - nx) % (VW + 34) + VW + 34) % (VW + 34) - 17;
    const y = GROUND_TOP - 82 + Math.sin(i * 0.8) * 4;
    ctx.fillStyle = (i + Math.floor(tick / 20)) % 3 ? '#ffe082' : '#ff8a65';
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = OL;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // 停放的機車
  for (let i = 0; i < 6; i++) {
    const x = i * 280 + 140 - nx * 1.02;
    if (x < -40 || x > VW + 40) continue;
    blob(ctx, x - 12, GROUND_TOP - 6, 6, 6, '#333', 2);
    blob(ctx, x + 12, GROUND_TOP - 6, 6, 6, '#333', 2);
    box(ctx, x - 14, GROUND_TOP - 22, 28, 12, ['#ff5a5f', '#4fc3ff', '#ffcf33'][i % 3], 5, 2);
  }
  groundOl(ctx, camX, 60, 16, [st.palette.ground, st.palette.groundAlt], '#4a4f57');
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.setLineDash([26, 18]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-((camX % 44) + 44), HZ + 66);
  ctx.lineTo(VW, HZ + 66);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ---------------- 總統府前（北一女、臺大醫院） ----------------
function government(ctx: Ctx, st: StageDef, camX: number, tick: number) {
  cloudsOl(ctx, camX, tick);
  const fx = camX * FAR;
  const by = GROUND_TOP - 26;
  // 北一女：紅磚校舍、綠色窗框
  const sx = 120 - fx;
  if (sx > -220 && sx < VW + 40) {
    building3d(ctx, sx - 100, by - 70, 200, 70, '#c0563f', {
      depth: 0.07,
      windows: { rows: 2, cols: 7, lit: 0.1, seed: 31, frame: '#2e7d32' },
    });
    box(ctx, sx - 104, by - 78, 208, 10, '#f3efe6', 1, 2);
    box(ctx, sx - 40, by - 100, 80, 24, '#f3efe6', 3, 2);
    ctx.font = `900 12px "Noto Sans TC","Microsoft JhengHei",sans-serif`;
    ctx.fillStyle = '#2e7d32';
    ctx.textAlign = 'center';
    ctx.fillText('北一女中', sx, by - 83);
    ctx.textAlign = 'left';
  }
  // 總統府：紅磚白帶，中央高塔
  const gx = 560 - fx;
  if (gx > -320 && gx < VW + 320) {
    // 兩翼：紅磚 + 白色水平飾帶 + 拱窗
    building3d(ctx, gx - 230, by - 80, 460, 80, st.palette.far, {
      depth: 0.05,
      windows: { rows: 2, cols: 14, arch: true, lit: 0.12, seed: 41, frame: '#f7f4ec' },
      bands: [
        { y: 0, h: 7, color: '#f7f4ec' },
        { y: 0.45, h: 6, color: '#f7f4ec' },
      ],
    });
    // 中央塔
    building3d(ctx, gx - 34, by - 190, 68, 190, st.palette.far, {
      depth: 0.05,
      windows: { rows: 6, cols: 2, arch: true, lit: 0.1, seed: 42, frame: '#f7f4ec' },
      bands: [0.12, 0.3, 0.48, 0.66, 0.84].map((y) => ({ y, h: 4, color: '#f7f4ec' })),
    });
    box(ctx, gx - 44, by - 206, 88, 18, '#f7f4ec', 3, 2.5);
    ol(ctx, st.palette.far, () => {
      ctx.moveTo(gx - 28, by - 206);
      ctx.lineTo(gx, by - 236);
      ctx.lineTo(gx + 28, by - 206);
      ctx.closePath();
    });
    box(ctx, gx - 14, by - 60, 28, 60, '#5a3a2a', 10, 2);
    // 旗桿
    ctx.strokeStyle = OL;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx, by - 236);
    ctx.lineTo(gx, by - 262);
    ctx.stroke();
  }
  // 臺大醫院舊館：白色古典建築、圓頂與廊柱
  const hx = 1000 - fx;
  if (hx > -220 && hx < VW + 220) {
    building3d(ctx, hx - 130, by - 66, 260, 66, st.palette.near, {
      depth: 0.06,
      windows: { rows: 2, cols: 8, lit: 0.15, seed: 51 },
    });
    // 門廊柱列（圓柱光影）
    for (let k = 0; k < 6; k++) {
      const cx = hx - 50 + k * 20;
      const cg = ctx.createLinearGradient(cx - 4, 0, cx + 4, 0);
      cg.addColorStop(0, '#ffffff');
      cg.addColorStop(1, '#bdb4a0');
      ctx.fillStyle = cg;
      ctx.fillRect(cx - 4, by - 60, 8, 60);
    }
    building3d(ctx, hx - 50, by - 92, 100, 28, st.palette.near, { depth: 0.06 });
    ol(ctx, sphereShade(ctx, hx, by - 92, 34, 34, '#e0d6bd'), () => ctx.arc(hx, by - 92, 34, Math.PI, 0), 2.5);
    ol(ctx, st.palette.near, () => {
      ctx.moveTo(hx - 60, by - 66);
      ctx.lineTo(hx, by - 84);
      ctx.lineTo(hx + 60, by - 66);
      ctx.closePath();
    }, 2);
    ctx.font = `900 11px "Noto Sans TC","Microsoft JhengHei",sans-serif`;
    ctx.fillStyle = '#8d6e63';
    ctx.textAlign = 'center';
    ctx.fillText('臺大醫院', hx, by - 70);
    ctx.textAlign = 'left';
  }
  haze(ctx, st, 0.2);
  // 近景：大道行道樹與路燈
  const nx = camX * NEAR;
  for (let i = 0; i < 16; i++) {
    const x = i * 140 + 60 - nx;
    if (x < -60 || x > VW + 60) continue;
    if (i % 2) treeOl(ctx, x, GROUND_TOP - 2, 84, '#2f9e44');
    else {
      box(ctx, x - 2, GROUND_TOP - 74, 4, 72, '#455a64', 1, 1.5);
      blob(ctx, x, GROUND_TOP - 78, 8, 6, '#fff59d', 2);
    }
  }
  // 地面：凱達格蘭大道（車道線 + 斑馬線）
  groundOl(ctx, camX, 80, 20, [st.palette.ground, st.palette.groundAlt], '#5b6068');
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 30; i++) {
    const x = i * 80 - (camX % 80);
    ctx.fillRect(x, HZ + 58, 40, 4);
  }
  const zx = 560 - camX;
  if (zx > -120 && zx < VW + 120) for (let k = 0; k < 7; k++) ctx.fillRect(zx - 60 + k * 18, GROUND_TOP + 6, 10, 110);
}

function generic(ctx: Ctx, st: StageDef, camX: number) {
  const fx = camX * FAR;
  for (let i = 0; i < 20; i++) {
    const x = i * 80 - fx;
    const h = 60 + hr(i) * 120;
    building3d(ctx, x, GROUND_TOP - h, 70, h, shade(st.palette.far, hr(i + 1) * 0.3 - 0.15), {
      depth: 0.08,
      windows: { rows: Math.round(h / 16), cols: 3, lit: 0.3, seed: i },
    });
  }
  haze(ctx, st, 0.25);
  const nx = camX * NEAR;
  for (let i = 0; i < 16; i++) {
    const x = i * 120 - nx;
    building3d(ctx, x, GROUND_TOP - 50, 110, 50, shade(st.palette.near, hr(i + 7) * 0.2), { depth: 0.04 });
  }
  groundTiles(ctx, camX, 48, 20, [st.palette.ground, st.palette.groundAlt]);
  frontEdge(ctx, shade(st.palette.ground, -0.5));
}
