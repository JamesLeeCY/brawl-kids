// 場地縮圖：把真正的場景背景畫一次、縮小快取起來，在選單裡當成 Q 版小卡片。
import type { GameData } from '../data/load';
import { World } from '../sim/world';
import { drawStage } from './stage';
import { text } from './text';

const THUMB_W = 320;
const THUMB_H = 180;
const cache = new Map<string, HTMLCanvasElement>();

/** 取得場地縮圖（第一次呼叫時繪製，之後用快取） */
function stageThumb(data: GameData, id: string): HTMLCanvasElement | null {
  const hit = cache.get(id);
  if (hit) return hit;
  if (!data.stages[id] || typeof document === 'undefined') return null;
  const full = document.createElement('canvas');
  full.width = 800;
  full.height = 450;
  const fctx = full.getContext('2d');
  if (!fctx) return null;
  const w = new World(data, { mode: 'versus', stageId: id, seed: 1, players: [] });
  // 鏡頭放在地標附近（場地約 1/3 處）
  const cam = Math.max(0, Math.min(w.stage.width - 800, w.stage.width * 0.32));
  drawStage(fctx, w, cam);
  const t = document.createElement('canvas');
  t.width = THUMB_W;
  t.height = THUMB_H;
  t.getContext('2d')?.drawImage(full, 0, 40, 800, 450, 0, 0, THUMB_W, THUMB_H);
  cache.set(id, t);
  return t;
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface ThumbOpts {
  selected?: boolean;
  /** 左上角的小標籤（例如「第 3 關」） */
  badge?: string;
  /** 右上角的紅色標籤（例如「頭目」） */
  tag?: string;
  /** 卡片下方顯示場地名稱 */
  label?: boolean;
  /** 神秘卡（隨機路線）：不顯示場景 */
  mystery?: boolean;
}

/** 畫一張 Q 版場地卡：圓角、粗白框、選取時金色外框並微微放大 */
export function drawStageCard(ctx: CanvasRenderingContext2D, data: GameData, id: string, cx: number, y: number, w: number, o: ThumbOpts = {}): void {
  const h = Math.round((w * 9) / 16);
  const grow = o.selected ? 1.06 : 1;
  const ww = w * grow;
  const hh = h * grow;
  const x = cx - ww / 2;
  const yy = y - (hh - h) / 2;
  ctx.save();
  // 陰影
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  rounded(ctx, x + 3, yy + 5, ww, hh, 10);
  ctx.fill();
  // 圖
  ctx.save();
  rounded(ctx, x, yy, ww, hh, 10);
  ctx.clip();
  const img = o.mystery ? null : stageThumb(data, id);
  if (img) ctx.drawImage(img, x, yy, ww, hh);
  else {
    const g = ctx.createLinearGradient(x, yy, x + ww, yy + hh);
    g.addColorStop(0, '#6d28d9');
    g.addColorStop(1, '#db2777');
    ctx.fillStyle = g;
    ctx.fillRect(x, yy, ww, hh);
    text(ctx, '？', cx, yy + hh / 2 + hh * 0.18, Math.round(hh * 0.5), '#fff', 'center', true);
  }
  // 上方高光
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x, yy, ww, hh * 0.18);
  ctx.restore();
  // 外框
  rounded(ctx, x, yy, ww, hh, 10);
  ctx.lineWidth = o.selected ? 4 : 3;
  ctx.strokeStyle = o.selected ? '#ffd23f' : '#ffffff';
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  rounded(ctx, x - 2, yy - 2, ww + 4, hh + 4, 12);
  ctx.stroke();
  const fs = Math.max(10, Math.round(w / 11));
  if (o.badge) {
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    rounded(ctx, x + 4, yy + 4, fs * 3.4, fs + 6, 6);
    ctx.fill();
    text(ctx, o.badge, x + 4 + fs * 1.7, yy + fs + 4, fs, '#ffd23f', 'center', false);
  }
  if (o.tag) {
    ctx.fillStyle = '#dc2626';
    rounded(ctx, x + ww - fs * 2.6 - 4, yy + 4, fs * 2.6, fs + 6, 6);
    ctx.fill();
    text(ctx, o.tag, x + ww - fs * 1.3 - 4, yy + fs + 4, fs, '#fff', 'center', false);
  }
  if (o.label) {
    const name = o.mystery ? '抽籤決定' : (data.stages[id]?.name ?? id);
    text(ctx, name, cx, yy + hh + fs + 6, fs, o.selected ? '#ffd23f' : '#fff', 'center', true);
  }
  ctx.restore();
}
