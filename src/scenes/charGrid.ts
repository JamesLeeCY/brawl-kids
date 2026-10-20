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

/** 畫頭像格與所有游標；(gx, gy) 為左上角 */
export function drawCharGrid(ctx: CanvasRenderingContext2D, defs: CharacterDef[], gx: number, gy: number, cursors: GridCursor[], tick: number): void {
  const n = defs.length;
  const cols = gridCols(n);
  const cellPos = (i: number) => ({ x: gx + (i % cols) * (CELL_W + GAP), y: gy + Math.floor(i / cols) * (CELL_H + GAP) });
  const s = CELL_H / 42;
  defs.forEach((def, i) => {
    const { x, y } = cellPos(i);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, CELL_W, CELL_H);
    ctx.clip();
    ctx.fillStyle = shade(def.palette.accent, -0.5);
    ctx.fillRect(x, y, CELL_W, CELL_H);
    drawFigure(ctx, def, { pose: getPose('idle_0'), x: x + CELL_W / 2 - 3 * s, y: y + 74 * s, facing: 1, scale: 0.86 * s, tick, upperOnly: true, sticker: true });
    ctx.restore();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, CELL_W, CELL_H);
  });
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
