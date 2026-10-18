export const FONT = '"Noto Sans TC","Microsoft JhengHei","PingFang TC","Heiti TC",system-ui,sans-serif';

export function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color = '#fff',
  align: CanvasTextAlign = 'left',
  bold = true,
  outline = false,
): void {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (outline) {
    ctx.lineWidth = Math.max(3, size / 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineJoin = 'round';
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.textAlign = 'left';
}
