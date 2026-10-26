// 遊戲內招式表與狀態說明：暫停選單、新手教學共用。
import type { CharacterDef } from '../data/load';
import { drawFigure, roundRect, shade } from './character';
import { getPose } from './poses';
import { tag } from './status';
import { text } from './text';

/** 招式表：左邊角色大頭像，右邊 6 招（按法、名稱、MP、說明）；(x, y) 為左上角，寬 w */
export function drawMoveList(ctx: CanvasRenderingContext2D, def: CharacterDef, x: number, y: number, w: number, label: (cmd: string) => string, tick: number): void {
  ctx.fillStyle = 'rgba(10,12,30,0.85)';
  roundRect(ctx, x, y, w, 300, 12);
  ctx.fill();
  ctx.strokeStyle = def.palette.accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  // 頭像
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 12, y + 12, 120, 130);
  ctx.clip();
  ctx.fillStyle = shade(def.palette.accent, -0.55);
  ctx.fillRect(x + 12, y + 12, 120, 130);
  drawFigure(ctx, def, { pose: getPose('idle_0'), x: x + 72, y: y + 128, facing: 1, scale: 1.6, tick, upperOnly: true, sticker: true, expression: 'happy' });
  ctx.restore();
  text(ctx, def.name, x + 72, y + 166, 18, '#fff', 'center');
  text(ctx, def.title, x + 72, y + 186, 12, def.palette.accent, 'center');
  text(ctx, `HP ${def.stats.hp}`, x + 72, y + 206, 12, '#cbd5e1', 'center', false);
  // 招式
  const mx = x + 150;
  def.moves.forEach((m, i) => {
    const ry = y + 26 + i * 46;
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)';
    roundRect(ctx, mx - 8, ry - 18, w - 150, 42, 6);
    ctx.fill();
    text(ctx, label(m.command), mx, ry, 13, '#ffd23f', 'left');
    text(ctx, m.name, mx + 78, ry, 15, '#fff', 'left');
    text(ctx, `MP ${m.mp}`, x + w - 18, ry, 12, '#93c5fd', 'right', false);
    if (m.desc) text(ctx, m.desc, mx + 78, ry + 17, 11.5, 'rgba(255,255,255,0.78)', 'left', false);
  });
}

/** 頭上狀態標籤的說明 */
const LEGEND: [string, string, string][] = [
  ['⇄ 顛倒', '#0ea5e9', '左右方向相反'],
  ['噓！封技', '#64748b', '暫時不能放必殺'],
  ['-1 分', '#ef4444', '攻擊力每層 -10%（最多 3 層）'],
  ['質詢 3', '#b91c1c', '倒數中放必殺會被取消並受傷'],
  ['叫號 3', '#0f766e', '倒數結束時爆炸'],
  ['叛徒！', '#7e22ce', '暫時倒戈，攻擊打到自己隊友'],
  ['扣扣扣', '#be123c', '每半秒扣一點血'],
  ['IQ 157', '#ca8a04', '下一擊傷害 ×1.57'],
  ['增肌 ×3', '#ea580c', '接下來幾拳擊退加倍'],
  ['反彈', '#0891b2', '把打過來的飛行物彈回去'],
];

const LEGEND2: [string, string][] = [
  ['頭上紅色 F', '受到的傷害 +20%'],
  ['凍 / 啪 / ♪ / 停班停課 / 哈哈哈', '定身：暫時不能動'],
  ['金色光環、辣椒火焰', '減傷'],
  ['藍色虛線圈', '都有掌握：自動擋下一擊並反擊'],
  ['紅色光環', '漲停板 / MAGA 紅帽：攻擊提高'],
  ['紫色光環', '被策反中'],
  ['身邊撒鈔票', 'MP 回復加倍'],
  ['半透明藍色分身', '分身跟著一起打'],
];

/** 狀態說明：(x, y) 為左上角，寬 w */
export function drawStatusLegend(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  ctx.fillStyle = 'rgba(10,12,30,0.85)';
  roundRect(ctx, x, y, w, 300, 12);
  ctx.fill();
  text(ctx, '頭上的狀態標籤', x + 20, y + 26, 15, '#ffd23f', 'left');
  LEGEND.forEach(([t, bg, d], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = x + 20 + col * (w / 2);
    const cy = y + 54 + row * 26;
    const tw = tag(ctx, t, cx + 40, cy, bg);
    text(ctx, d, cx + 40 + tw / 2 + 8, cy + 1, 12, '#fff', 'left', false);
  });
  text(ctx, '其他記號', x + 20, y + 200, 15, '#ffd23f', 'left');
  LEGEND2.forEach(([t, d], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = x + 20 + col * (w / 2);
    const cy = y + 224 + row * 20;
    text(ctx, `${t}：`, cx, cy, 12, '#fde68a', 'left');
    text(ctx, d, cx + ctx.measureText(`${t}：`).width + 2, cy, 12, '#fff', 'left', false);
  });
}
