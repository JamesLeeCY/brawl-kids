// 選角頭像格：本機選角與連線選角共用。每個可選角色一格 Q 版頭像，各玩家游標以欄位顏色標示。
import type { CharacterDef } from '../data/load';
import { drawFigure, OUTLINE, roundRect, shade } from '../render/character';
import { getPose } from '../render/poses';
import { text } from '../render/text';
import type { Snapshot } from '../sim/snapshot';

/** 格子固定 3 列，欄數隨角色數增加（15 名 → 5×3） */
export const GRID_ROWS = 3;
export const CELL_W = 50;
export const CELL_H = 40;
const GAP = 2;

/** 頭像格最後多一格「隨機」：格子數 = 角色數 + 1，索引 = 角色數就是隨機 */
export function gridCells(nChars: number): number {
  return nChars + 1;
}

export function isRandomIdx(idx: number, nChars: number): boolean {
  return idx % gridCells(nChars) === nChars;
}

/** 游標索引 → 角色 id；選到「隨機」就在開打時抽一名 */
export function resolveCharId(ids: readonly string[], idx: number, rand: () => number = Math.random): string {
  const i = idx % gridCells(ids.length);
  return i === ids.length ? ids[Math.floor(rand() * ids.length) % ids.length] : ids[i];
}

/** 再來一場：選「隨機」的玩家重新抽角色 */
export function rerollRandom<P extends { charId: string; random?: boolean }>(players: readonly P[], ids: readonly string[], rand: () => number = Math.random): P[] {
  return players.map((p) => (p.random ? { ...p, charId: ids[Math.floor(rand() * ids.length) % ids.length] } : p));
}

/** 「隨機」的大頭像：角色剪影快速輪播，上面一個大問號 */
export function drawRandomPortrait(ctx: CanvasRenderingContext2D, defs: CharacterDef[], x: number, y: number, w: number, h: number, tick: number, figScale: number, footY: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#3b2a5c';
  ctx.fillRect(x, y, w, h);
  if (defs.length) {
    const def = defs[Math.floor(tick / 6) % defs.length];
    drawFigure(ctx, def, { pose: getPose('idle_0'), x: x + w / 2, y: footY, facing: 1, scale: figScale, tick, upperOnly: true, tint: '#ffffff', alpha: 0.28 });
  }
  ctx.restore();
  text(ctx, '?', x + w / 2, y + h / 2 + h * 0.2, Math.round(h * 0.62), '#ffd23f', 'center', true, true);
}

export function gridCols(n: number): number {
  return Math.max(1, Math.ceil(n / GRID_ROWS));
}

export function gridSize(n: number): { w: number; h: number } {
  const cols = gridCols(n);
  const rows = Math.ceil(n / cols);
  return { w: cols * (CELL_W + GAP) - GAP, h: rows * (CELL_H + GAP) - GAP };
}

/** 依方向鍵移動游標：左右在同一列循環、上下在同一欄循環（最後一列不滿時跳過空格） */
export function moveGridCursor(idx: number, k: Pick<Snapshot, 'up' | 'down' | 'left' | 'right'>, n: number): number {
  if (n <= 0) return 0;
  const cols = gridCols(n);
  const rows = Math.ceil(n / cols);
  let r = Math.floor((idx % n) / cols);
  let c = (idx % n) % cols;
  const rowLen = (row: number) => Math.min(cols, n - row * cols);
  if (k.left) c = (c - 1 + rowLen(r)) % rowLen(r);
  if (k.right) c = (c + 1) % rowLen(r);
  if (k.up) {
    r = (r - 1 + rows) % rows;
    if (r * cols + c >= n) r--;
  }
  if (k.down) {
    r = (r + 1) % rows;
    if (r * cols + c >= n) r = 0;
  }
  return r * cols + c;
}

/** 點擊位置對應的角色索引；沒點到格子回傳 -1 */
export function gridHit(x: number, y: number, gx: number, gy: number, n: number): number {
  const cols = gridCols(n);
  const c = Math.floor((x - gx) / (CELL_W + GAP));
  const r = Math.floor((y - gy) / (CELL_H + GAP));
  if (c < 0 || c >= cols || r < 0 || x - gx - c * (CELL_W + GAP) > CELL_W || y - gy - r * (CELL_H + GAP) > CELL_H) return -1;
  const i = r * cols + c;
  return i < n ? i : -1;
}

export interface GridCursor {
  idx: number;
  /** 欄位編號 0–3：決定顏色與標籤位置（左上 / 右上 / 左下 / 右下） */
  slot: number;
  color: string;
  label: string;
  /** 已確定：實心框不閃爍 */
  locked: boolean;
}

/** 頭像格的大頭像快取：頭像是靜態的，畫一次存成小畫布，之後每格只要 drawImage */
const portraitCache = new Map<string, HTMLCanvasElement>();
/** 快取的解析度倍率（高 DPI 螢幕也清楚） */
const CACHE_RES = 3;

function cachedPortrait(def: CharacterDef): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  let cv = portraitCache.get(def.id);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = CELL_W * CACHE_RES;
  cv.height = CELL_H * CACHE_RES;
  const c = cv.getContext('2d');
  if (!c) return null;
  c.scale(CACHE_RES, CACHE_RES);
  const s = CELL_H / 42;
  c.fillStyle = shade(def.palette.accent, -0.5);
  c.fillRect(0, 0, CELL_W, CELL_H);
  drawFigure(c, def, { pose: getPose('idle_0'), x: CELL_W / 2 - 3 * s, y: 74 * s, facing: 1, scale: 0.86 * s, tick: 0, sway: 0, upperOnly: true, sticker: true });
  portraitCache.set(def.id, cv);
  return cv;
}

/** 畫頭像格與所有游標；(gx, gy) 為左上角 */
export function drawCharGrid(ctx: CanvasRenderingContext2D, defs: CharacterDef[], gx: number, gy: number, cursors: GridCursor[], tick: number): void {
  const n = gridCells(defs.length);
  const cols = gridCols(n);
  const cellPos = (i: number) => ({ x: gx + (i % cols) * (CELL_W + GAP), y: gy + Math.floor(i / cols) * (CELL_H + GAP) });
  const s = CELL_H / 42;
  defs.forEach((def, i) => {
    const { x, y } = cellPos(i);
    const img = cachedPortrait(def);
    if (img) ctx.drawImage(img, x, y, CELL_W, CELL_H);
    else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, CELL_W, CELL_H);
      ctx.clip();
      ctx.fillStyle = shade(def.palette.accent, -0.5);
      ctx.fillRect(x, y, CELL_W, CELL_H);
      drawFigure(ctx, def, { pose: getPose('idle_0'), x: x + CELL_W / 2 - 3 * s, y: y + 74 * s, facing: 1, scale: 0.86 * s, tick, upperOnly: true, sticker: true });
      ctx.restore();
    }
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, CELL_W, CELL_H);
  });
  // 最後一格：隨機
  {
    const { x, y } = cellPos(defs.length);
    ctx.fillStyle = '#3b2a5c';
    ctx.fillRect(x, y, CELL_W, CELL_H);
    text(ctx, '?', x + CELL_W / 2, y + CELL_H / 2 + 7, 22, '#ffd23f', 'center', true, true);
    text(ctx, '隨機', x + CELL_W / 2, y + CELL_H - 3, 8, '#ffffff', 'center', true);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, CELL_W, CELL_H);
  }
  // 同一格有多個游標時由外往內縮排，各自的標籤放在不同角落
  const stack = new Map<number, number>();
  for (const cur of cursors) {
    const depth = stack.get(cur.idx) ?? 0;
    stack.set(cur.idx, depth + 1);
    const { x, y } = cellPos(cur.idx % n);
    const inset = depth * 3 - 1;
    const pulse = cur.locked ? 1 : 0.65 + 0.35 * Math.abs(Math.sin(tick * 0.12));
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = cur.color;
    ctx.lineWidth = 3;
    roundRect(ctx, x + inset, y + inset, CELL_W - inset * 2, CELL_H - inset * 2, 4);
    ctx.stroke();
    ctx.restore();
    const right = cur.slot % 2 === 1;
    const bottom = cur.slot >= 2;
    const tw = cur.label.length > 2 ? 26 : 16;
    const lx = right ? x + CELL_W - tw - 1 : x + 1;
    const ly = bottom ? y + CELL_H - 11 : y + 1;
    ctx.fillStyle = cur.color;
    roundRect(ctx, lx, ly, tw, 10, 3);
    ctx.fill();
    text(ctx, cur.label, lx + tw / 2, ly + 8.5, 8, '#fff', 'center', true);
  }
}
