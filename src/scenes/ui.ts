import { CONFIG } from '../config';
import { roundRect } from '../render/character';
import { text } from '../render/text';

const VW = CONFIG.view.width;
const VH = CONFIG.view.height;

export function menuBackground(ctx: CanvasRenderingContext2D, tick: number, a = '#1b1035', b = '#3a1f5c'): void {
  const g = ctx.createLinearGradient(0, 0, 0, VH);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 12; i++) {
    const x = ((i * 97 + tick * 0.4) % (VW + 120)) - 60;
    ctx.save();
    ctx.translate(x, (i * 53) % VH);
    ctx.rotate(0.6);
    ctx.fillRect(-4, -80, 8, 160);
    ctx.restore();
  }
}

export function button(ctx: CanvasRenderingContext2D, label: string, cx: number, y: number, w: number, selected: boolean): void {
  ctx.fillStyle = selected ? '#ffd23f' : 'rgba(255,255,255,0.1)';
  roundRect(ctx, cx - w / 2, y, w, 34, 8);
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  text(ctx, label, cx, y + 23, 17, selected ? '#1b1035' : '#fff', 'center');
}

export function hint(ctx: CanvasRenderingContext2D, s: string, y: number = VH - 14, cx: number = VW / 2): void {
  text(ctx, s, cx, y, 12, 'rgba(255,255,255,0.75)', 'center', false);
}

export function overlay(ctx: CanvasRenderingContext2D, alpha = 0.6, w: number = VW): void {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, w, VH);
}
