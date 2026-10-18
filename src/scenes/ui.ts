import { CONFIG } from '../config';
import { OUTLINE, roundRect, shade } from '../render/character';
import { text } from '../render/text';

const VW = CONFIG.view.width;
const VH = CONFIG.view.height;

/** 荒野亂鬥式選單背景：漸層 + 緩慢旋轉的放射光芒 + 暗角 */
export function menuBackground(ctx: CanvasRenderingContext2D, tick: number, a = '#1b1035', b = '#3a1f5c'): void {
  const g = ctx.createLinearGradient(0, 0, 0, VH);
  g.addColorStop(0, shade(a, 0.12));
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, VH);
  ctx.save();
  ctx.translate(VW / 2, VH * 0.42);
  ctx.rotate(tick * 0.0025);
  ctx.fillStyle = 'rgba(255,255,255,0.055)';
  for (let i = 0; i < 16; i++) {
    ctx.rotate((Math.PI * 2) / 16);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-60, -700);
    ctx.lineTo(60, -700);
    ctx.closePath();
    if (i % 2 === 0) ctx.fill();
  }
  ctx.restore();
  const v = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.3, VW / 2, VH / 2, VW * 0.65);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, VW, VH);
}

/** 荒野亂鬥式按鈕：選中為黃色、未選為藍色，粗描邊 + 底部陰影，白字黑邊 */
export function button(ctx: CanvasRenderingContext2D, label: string, cx: number, y: number, w: number, selected: boolean): void {
  const h = 36;
  const x = cx - w / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, x, y + 4, w, h, 10);
  ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  if (selected) {
    g.addColorStop(0, '#ffe45c');
    g.addColorStop(1, '#ffae00');
  } else {
    g.addColorStop(0, '#4f9dff');
    g.addColorStop(1, '#2459d6');
  }
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  roundRect(ctx, x + 4, y + 3, w - 8, h * 0.38, 6);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  roundRect(ctx, x, y, w, h, 10);
  ctx.stroke();
  text(ctx, label, cx, y + 25, 17, '#ffffff', 'center', true, true);
}

export function hint(ctx: CanvasRenderingContext2D, s: string, y: number = VH - 14, cx: number = VW / 2): void {
  text(ctx, s, cx, y, 12, 'rgba(255,255,255,0.75)', 'center', false);
}

export function overlay(ctx: CanvasRenderingContext2D, alpha = 0.6, w: number = VW): void {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, w, VH);
}
