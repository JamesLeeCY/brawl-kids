// 標題畫面背景：立法院議場（程式繪製的 Q 版議場：木質牆面、主席台、天花板燈環、藍色地毯與弧形議員席）。
// 靜態部分畫一次後快取；議員席的桌面前緣另外提供，讓角色「站在桌子後面」，畫面比較整齊。
import { CONFIG } from '../config';

const VW = CONFIG.view.width;
const VH = CONFIG.view.height;
let cache: HTMLCanvasElement | null = null;

function grad(ctx: CanvasRenderingContext2D, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function paint(ctx: CanvasRenderingContext2D): void {
  // 天花板
  ctx.fillStyle = grad(ctx, 0, 70, [
    [0, '#2b1d14'],
    [1, '#4a3324'],
  ]);
  ctx.fillRect(0, 0, VW, 70);
  // 天花板燈環（弧形排列的崁燈）
  for (let i = 0; i < 17; i++) {
    const t = i / 16;
    const x = 40 + t * (VW - 80);
    const y = 26 + Math.sin(t * Math.PI) * -12 + 14;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
    g.addColorStop(0, 'rgba(255,240,200,0.95)');
    g.addColorStop(0.35, 'rgba(255,220,150,0.45)');
    g.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();
  }
  // 木質牆面 + 直條木紋
  ctx.fillStyle = grad(ctx, 70, 250, [
    [0, '#9a6a3f'],
    [1, '#6e4626'],
  ]);
  ctx.fillRect(0, 70, VW, 180);
  ctx.strokeStyle = 'rgba(60,35,18,0.35)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= VW; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 78);
    ctx.lineTo(x, 250);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let x = 6; x <= VW; x += 32) ctx.fillRect(x, 78, 6, 172);
  // 金色飾條
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(0, 70, VW, 6);
  ctx.fillRect(0, 168, VW, 3);
  // 主席台（標題後方）：三層木台 + 椅背 + 麥克風
  ctx.fillStyle = '#5a3a20';
  ctx.beginPath();
  ctx.moveTo(VW / 2 - 230, 250);
  ctx.lineTo(VW / 2 - 200, 172);
  ctx.lineTo(VW / 2 + 200, 172);
  ctx.lineTo(VW / 2 + 230, 250);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7b5230';
  ctx.fillRect(VW / 2 - 190, 176, 380, 10);
  ctx.fillRect(VW / 2 - 205, 205, 410, 8);
  for (let i = -2; i <= 2; i++) {
    // 主席台座椅
    const x = VW / 2 + i * 70;
    ctx.fillStyle = '#2f1d10';
    ctx.beginPath();
    ctx.roundRect?.(x - 14, 150, 28, 26, 6);
    ctx.fill();
    // 麥克風
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 18, 186);
    ctx.lineTo(x + 24, 176);
    ctx.stroke();
  }
  // 地毯：藍色、往後收的透視 + 中央走道
  ctx.fillStyle = grad(ctx, 250, VH, [
    [0, '#1e3a8a'],
    [1, '#172554'],
  ]);
  ctx.fillRect(0, 250, VW, VH - 250);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.moveTo(VW / 2 - 60, 250);
  ctx.lineTo(VW / 2 + 60, 250);
  ctx.lineTo(VW / 2 + 150, VH);
  ctx.lineTo(VW / 2 - 150, VH);
  ctx.closePath();
  ctx.fill();
  // 暗角，讓中間的標題與選單更醒目
  const v = ctx.createRadialGradient(VW / 2, VH * 0.45, 120, VW / 2, VH * 0.5, VW * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, VW, VH);
}

/** 畫議場背景（第一次呼叫時畫進快取） */
export function drawLegislature(ctx: CanvasRenderingContext2D): void {
  if (!cache && typeof document !== 'undefined') {
    cache = document.createElement('canvas');
    cache.width = VW * 2;
    cache.height = VH * 2;
    const c = cache.getContext('2d');
    if (c) {
      c.scale(2, 2);
      paint(c);
    }
  }
  if (cache) ctx.drawImage(cache, 0, 0, VW, VH);
}

/**
 * 一排弧形議員席的桌子前緣（在角色之後畫，遮住腳，看起來像站在座位後方）。
 * side：-1 左側、1 右側；y：桌面高度；x0 / x1：桌子範圍。
 */
export function drawDeskRow(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, side: -1 | 1): void {
  const curve = 10 * side;
  // 桌面
  ctx.fillStyle = '#b07a45';
  ctx.beginPath();
  ctx.moveTo(x0, y + (side < 0 ? 0 : curve));
  ctx.quadraticCurveTo((x0 + x1) / 2, y - 6, x1, y + (side < 0 ? -curve : 0));
  ctx.lineTo(x1, y + 8 + (side < 0 ? -curve : 0));
  ctx.quadraticCurveTo((x0 + x1) / 2, y + 2, x0, y + 8 + (side < 0 ? 0 : curve));
  ctx.closePath();
  ctx.fill();
  // 桌子正面
  ctx.fillStyle = '#7a4f2a';
  ctx.beginPath();
  ctx.moveTo(x0, y + 8 + (side < 0 ? 0 : curve));
  ctx.quadraticCurveTo((x0 + x1) / 2, y + 2, x1, y + 8 + (side < 0 ? -curve : 0));
  ctx.lineTo(x1, y + 30 + (side < 0 ? -curve : 0));
  ctx.quadraticCurveTo((x0 + x1) / 2, y + 24, x0, y + 30 + (side < 0 ? 0 : curve));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,22,10,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 桌上的小螢幕與麥克風
  const n = Math.max(2, Math.round((x1 - x0) / 66));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + t * (x1 - x0);
    const yy = y - 4 + Math.sin(t * Math.PI) * -2 + (side < 0 ? -curve * t : curve * (1 - t));
    ctx.fillStyle = '#111827';
    ctx.fillRect(x - 9, yy - 9, 14, 9);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(x - 8, yy - 8, 12, 6);
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + 10, yy);
    ctx.lineTo(x + 14, yy - 10);
    ctx.stroke();
  }
}
