// 狀態效果、騎乘道具與新招式飛行物的畫法（純畫面，不影響遊戲結果）。
import { getBuff, hasBuff, type Entity } from '../sim/entity';
import type { World } from '../sim/world';
import { FONT } from './text';
import { lowQuality } from './quality';

/** 頭上的小標籤（狀態名稱 / 倒數） */
function tag(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, bg: string, fg = '#ffffff', size = 11): number {
  ctx.font = `900 ${size}px ${FONT}`;
  const w = ctx.measureText(s).width + 10;
  ctx.fillStyle = bg;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect?.(x - w / 2, y - size, w, size + 6, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.fillText(s, x, y + 1);
  ctx.textAlign = 'left';
  return w;
}

function outlinedText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string): void {
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size / 5);
  ctx.strokeStyle = '#1a1530';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.textAlign = 'left';
}

const secs = (t: number) => Math.max(1, Math.ceil(t / 60));

/** 角色後面的光環（漲停、紅帽、都有掌握、策反、MP 加倍） */
export function drawBuffBack(ctx: CanvasRenderingContext2D, e: Entity, x: number, y: number, tick: number): void {
  const ring = (fill: string, stroke: string, rx = 30, ry = 46) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y - 36, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  if (hasBuff(e, 'rage')) {
    const hot = e.hp < e.maxHp / 2;
    ring(hot ? 'rgba(239,68,68,0.28)' : 'rgba(239,68,68,0.12)', hot ? 'rgba(239,68,68,0.95)' : 'rgba(239,68,68,0.5)');
    // 往上竄的紅色 K 線
    ctx.fillStyle = '#ef4444';
    for (let i = 0; i < 3; i++) {
      const k = ((tick * 1.5 + i * 23) % 60) / 60;
      ctx.globalAlpha = 1 - k;
      ctx.fillRect(x - 22 + i * 20, y - 20 - k * 60, 5, 14);
    }
    ctx.globalAlpha = 1;
  }
  if (hasBuff(e, 'counter')) {
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = -tick * 0.6;
    ctx.beginPath();
    ctx.ellipse(x, y - 36, 32, 48, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (hasBuff(e, 'charm')) ring('rgba(168,85,247,0.22)', 'rgba(168,85,247,0.85)');
  if (hasBuff(e, 'power')) ring('rgba(220,38,38,0.16)', 'rgba(220,38,38,0.6)', 36, 54);
  if (hasBuff(e, 'mpRegen')) {
    // 業主加碼：撒鈔票
    for (let i = 0; i < (lowQuality ? 2 : 4); i++) {
      const k = ((tick * 0.9 + i * 17) % 50) / 50;
      const bx = x - 26 + ((i * 37) % 52) + Math.sin(tick * 0.1 + i) * 6;
      const by = y - 96 + k * 80;
      ctx.save();
      ctx.globalAlpha = 1 - k * 0.6;
      ctx.translate(bx, by);
      ctx.rotate(Math.sin(tick * 0.15 + i) * 0.6);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(-7, -4, 14, 8);
      ctx.strokeStyle = '#166534';
      ctx.lineWidth = 1;
      ctx.strokeRect(-7, -4, 14, 8);
      ctx.fillStyle = '#166534';
      ctx.font = `900 7px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('$', 0, 3);
      ctx.restore();
    }
  }
}

/** 角色前面、頭上的狀態（冰凍、顛倒、F、倒數……） */
export function drawBuffFront(ctx: CanvasRenderingContext2D, e: Entity, x: number, y: number, tick: number, scale = 1): void {
  const top = y - 108 * scale;
  const stun = getBuff(e, 'stun');
  if (stun) {
    switch (stun.value) {
      case 1: {
        // 冷笑話：結冰
        ctx.fillStyle = 'rgba(186,230,253,0.5)';
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect?.(x - 22, y - 78, 44, 80, 8);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.moveTo(x - 14, y - 70);
        ctx.lineTo(x - 6, y - 56);
        ctx.stroke();
        outlinedText(ctx, '凍', x, top, 14, '#7dd3fc');
        break;
      }
      case 2:
        outlinedText(ctx, (tick >> 3) % 2 ? '啪！' : '啪啪！', x, top, 13, '#fbbf24');
        break;
      case 3:
        for (let i = 0; i < 3; i++) outlinedText(ctx, i % 2 ? '♫' : '♪', x - 16 + i * 16, top - Math.abs(Math.sin(tick * 0.15 + i)) * 8, 14, '#f472b6');
        break;
      case 4: {
        // 颱風假：旋轉的風
        ctx.strokeStyle = 'rgba(148,163,184,0.9)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(x, top + 4, 6 + i * 5, tick * 0.3 + i, tick * 0.3 + i + Math.PI * 1.3);
          ctx.stroke();
        }
        outlinedText(ctx, '停班停課', x, top - 14, 11, '#e2e8f0');
        break;
      }
      default:
        outlinedText(ctx, '哈哈哈', x, top, 13, '#fde047');
    }
  }
  const labels: [string, string][] = [];
  if (hasBuff(e, 'reverse')) labels.push(['⇄ 顛倒', '#0ea5e9']);
  if (hasBuff(e, 'silence')) labels.push(['噓！封技', '#64748b']);
  const at = getBuff(e, 'atkDown');
  if (at) labels.push([`-${at.n} 分`, '#ef4444']);
  const mark = getBuff(e, 'mark');
  if (mark) labels.push([`質詢 ${secs(mark.time)}`, '#b91c1c']);
  const bomb = getBuff(e, 'bomb');
  if (bomb) labels.push([`叫號 ${secs(bomb.time)}`, '#0f766e']);
  if (hasBuff(e, 'charm')) labels.push(['叛徒！', '#7e22ce']);
  if (hasBuff(e, 'dot')) labels.push(['扣扣扣', '#be123c']);
  const crit = hasBuff(e, 'crit');
  const knock = getBuff(e, 'knock');
  if (crit) labels.push(['IQ 157', '#ca8a04']);
  if (knock) labels.push([`增肌 ×${knock.n}`, '#ea580c']);
  if (hasBuff(e, 'reflect')) labels.push(['反彈', '#0891b2']);
  let ly = top - (stun ? 18 : 0);
  for (const [s, bg] of labels) {
    tag(ctx, s, x, ly, bg);
    ly -= 17;
  }
  if (hasBuff(e, 'vuln')) {
    // 期末考：頭上的紅色 F
    ctx.save();
    ctx.translate(x + 20, y - 84 * scale);
    ctx.rotate(0.15);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 2;
    ctx.fillRect(-9, -11, 18, 20);
    ctx.strokeRect(-9, -11, 18, 20);
    ctx.fillStyle = '#dc2626';
    ctx.font = `900 16px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('F', 0, 5);
    ctx.restore();
  }
  if (hasBuff(e, 'reflect')) {
    ctx.save();
    ctx.strokeStyle = 'rgba(103,232,249,0.9)';
    ctx.fillStyle = 'rgba(103,232,249,0.12)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2 - tick * 0.04;
      const px = x + Math.cos(a) * 34;
      const py = y - 36 + Math.sin(a) * 46;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** MAGA 紅帽：畫在頭頂（scale = 角色放大倍率） */
export function drawRedCap(ctx: CanvasRenderingContext2D, x: number, y: number, facing: number, scale: number): void {
  ctx.save();
  ctx.translate(x, y - 74 * scale);
  ctx.scale(facing * scale, scale);
  ctx.fillStyle = '#dc2626';
  ctx.strokeStyle = '#7f1d1d';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(1, 0, 15, 9, 0, Math.PI, 0);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(13, 0, 9, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 5px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('MAGA', 1, -2.5);
  ctx.restore();
}

/** 招式中騎 / 推 / 拿的道具 */
export function drawPropBack(ctx: CanvasRenderingContext2D, prop: string, x: number, gy: number, facing: number, tick: number): void {
  const wheel = (cx: number, r: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, gy - r, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    const a = tick * 0.5;
    ctx.moveTo(cx + Math.cos(a) * r, gy - r + Math.sin(a) * r);
    ctx.lineTo(cx - Math.cos(a) * r, gy - r - Math.sin(a) * r);
    ctx.stroke();
  };
  ctx.save();
  switch (prop) {
    case 'bike':
    case 'youbike': {
      const frame = prop === 'youbike' ? '#f59e0b' : '#e5e7eb';
      wheel(x - facing * 14, 9, '#1f2937');
      wheel(x + facing * 14, 9, '#1f2937');
      ctx.strokeStyle = frame;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - facing * 14, gy - 9);
      ctx.lineTo(x, gy - 22);
      ctx.lineTo(x + facing * 14, gy - 9);
      ctx.moveTo(x, gy - 22);
      ctx.lineTo(x + facing * 10, gy - 26);
      ctx.stroke();
      if (prop === 'youbike') {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(x + facing * 10 - 5, gy - 30, 10, 6);
      }
      break;
    }
    case 'bear': {
      // 坐騎黑熊
      const bob = Math.sin(tick * 0.6) * 2;
      ctx.fillStyle = '#141414';
      ctx.beginPath();
      ctx.ellipse(x, gy - 16 + bob, 26, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + facing * 24, gy - 24 + bob, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + facing * 19, gy - 34 + bob, 4, 0, Math.PI * 2);
      ctx.arc(x + facing * 30, gy - 33 + bob, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath();
      ctx.moveTo(x + facing * 6, gy - 22 + bob);
      ctx.lineTo(x + facing * 18, gy - 22 + bob);
      ctx.lineTo(x + facing * 12, gy - 15 + bob);
      ctx.fill();
      ctx.fillStyle = '#c8a27a';
      ctx.beginPath();
      ctx.arc(x + facing * 32, gy - 22 + bob, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#141414';
      for (const lx of [-16, -6, 8, 18]) ctx.fillRect(x + facing * lx - 3, gy - 8 + ((tick >> 2) % 2 ? 0 : -3) * (lx > 0 ? 1 : -1), 6, 8);
      break;
    }
    case 'cart': {
      // 菜車：推在前面
      const cx = x + facing * 30;
      ctx.fillStyle = '#a16207';
      ctx.fillRect(cx - 18, gy - 30, 36, 18);
      ctx.fillStyle = '#84cc16';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(cx - 11 + i * 11, gy - 32, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      wheel(cx - 10, 5, '#1f2937');
      wheel(cx + 10, 5, '#1f2937');
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - facing * 18, gy - 28);
      ctx.lineTo(x + facing * 6, gy - 40);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** 試吃 / 大胃王：手上的食物（畫在角色前面） */
export function drawPropFront(ctx: CanvasRenderingContext2D, prop: string, x: number, gy: number, facing: number, tick: number): void {
  if (prop !== 'food') return;
  const fx = x + facing * 14;
  const fy = gy - 52 + Math.sin(tick * 0.4) * 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(fx, fy + 5, 11, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b45309';
  ctx.beginPath();
  ctx.arc(fx - 4, fy, 4.5, 0, Math.PI * 2);
  ctx.arc(fx + 4, fy, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.arc(fx, fy - 3, 4, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 2; i++) {
    const k = ((tick + i * 15) % 30) / 30;
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fx - 3 + i * 6, fy - 8 - k * 12);
    ctx.quadraticCurveTo(fx + i * 6, fy - 12 - k * 12, fx - 3 + i * 6, fy - 16 - k * 12);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export const EXTRA_POSES = new Set([
  'english',
  'traitor',
  'vs',
  'dot',
  'chair',
  'tripod',
  'tongue',
  'kong',
  'ticket',
  'minibear',
  'bigwall',
  'greatwall',
  'wordwall',
  'steam',
  'catpaw',
  'moon',
  'scorecard',
]);

/** 新招式的飛行物（x, y 是飛行物在畫面上的位置；gy 是它腳下的地面） */
export function drawExtraProjectile(ctx: CanvasRenderingContext2D, w: World, p: Entity, pose: string, x: number, y: number, gy: number, color: string): void {
  const f = p.facing;
  const tick = w.tick;
  ctx.shadowBlur = 0;
  switch (pose) {
    case 'english':
    case 'traitor': {
      const word = pose === 'english' ? '學英文？' : '叛徒！';
      ctx.strokeStyle = pose === 'english' ? color : '#a855f7';
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 2; i++) {
        ctx.globalAlpha = 0.8 - i * 0.3;
        ctx.beginPath();
        ctx.arc(x - f * (6 + i * 8), y, 18 - i * 3, f > 0 ? -1 : Math.PI - 1, f > 0 ? 1 : Math.PI + 1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      outlinedText(ctx, word, x + f * 4, y + 5, 14, pose === 'english' ? '#ffffff' : '#e9d5ff');
      break;
    }
    case 'vs':
      outlinedText(ctx, 'vs', x, y + 9, 28, '#facc15');
      break;
    case 'dot':
      ctx.fillStyle = '#1a1530';
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
    case 'chair':
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tick * 0.3);
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(-8, -9, 4, 18);
      ctx.fillRect(-8, -1, 15, 4);
      ctx.fillStyle = '#4b5563';
      ctx.fillRect(4, 2, 2.5, 8);
      ctx.fillRect(-7, 2, 2.5, 8);
      ctx.restore();
      break;
    case 'tripod':
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tick * 0.28);
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(-7, 9);
      ctx.moveTo(0, -8);
      ctx.lineTo(7, 9);
      ctx.moveTo(0, -8);
      ctx.lineTo(0, 10);
      ctx.stroke();
      ctx.fillStyle = '#111827';
      ctx.fillRect(-5, -13, 10, 6);
      ctx.restore();
      break;
    case 'tongue': {
      // 從呱雞嘴巴伸出的舌頭
      const o = w.get(p.ownerId);
      const ox = o ? o.x - p.x + x + o.facing * 10 : x - f * 30;
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ox, y + 2);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = '#ec4899';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'kong': {
      const k = Math.min(1, (40 - p.life) / 10);
      ctx.globalAlpha = Math.min(1, p.life / 12);
      outlinedText(ctx, '空', x, y + 18, 30 + k * 30, '#e0f2fe');
      ctx.strokeStyle = 'rgba(125,211,252,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, gy, 60 + k * 160, 16 + k * 26, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'ticket':
    case 'scorecard': {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(tick * 0.4 + p.id) * 0.3);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = pose === 'ticket' ? '#0f766e' : '#dc2626';
      ctx.lineWidth = 1.8;
      ctx.fillRect(-9, -7, 18, 14);
      ctx.strokeRect(-9, -7, 18, 14);
      ctx.fillStyle = pose === 'ticket' ? '#0f766e' : '#dc2626';
      ctx.font = `900 9px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(pose === 'ticket' ? `${(p.id % 90) + 10}` : '-1', 0, 4);
      ctx.restore();
      break;
    }
    case 'minibear': {
      const bob = -Math.abs(Math.sin(tick * 0.5)) * 3;
      const by = gy - 10 + bob;
      ctx.fillStyle = '#141414';
      ctx.beginPath();
      ctx.ellipse(x - f * 3, by, 10, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + f * 7, by - 4, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + f * 4, by - 9, 2.2, 0, Math.PI * 2);
      ctx.arc(x + f * 10, by - 9, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(x - f * 1 - 3, by - 3, 6, 2);
      // 學士帽
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(x + f * 7 - 6, by - 13, 12, 2.5);
      ctx.fillRect(x + f * 7 - 2.5, by - 12, 5, 2.5);
      break;
    }
    case 'bigwall': {
      // 金色高牆
      const h = 110;
      ctx.fillStyle = '#b45309';
      ctx.fillRect(x - 10, gy - h, 20, h);
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 1;
      for (let r = 0; r < 11; r++) {
        ctx.beginPath();
        ctx.moveTo(x - 10, gy - r * 10);
        ctx.lineTo(x + 10, gy - r * 10);
        ctx.moveTo(x + (r % 2 ? -3 : 4), gy - r * 10);
        ctx.lineTo(x + (r % 2 ? -3 : 4), gy - r * 10 - 10);
        ctx.stroke();
      }
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x - 13, gy - h - 5, 26, 6);
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 10, gy - h, 20, h);
      break;
    }
    case 'greatwall': {
      // 長長矮矮的城牆
      const h = 46;
      const ww = 76;
      ctx.fillStyle = '#a8a29e';
      ctx.fillRect(x - ww / 2, gy - h, ww, h);
      ctx.fillStyle = '#78716c';
      for (let i = 0; i < 7; i++) ctx.fillRect(x - ww / 2 + i * 11.5, gy - h - 7, 7, 7);
      ctx.strokeStyle = '#57534e';
      ctx.lineWidth = 1;
      for (let r = 1; r < 5; r++) {
        ctx.beginPath();
        ctx.moveTo(x - ww / 2, gy - r * 10);
        ctx.lineTo(x + ww / 2, gy - r * 10);
        ctx.stroke();
      }
      ctx.strokeStyle = '#44403c';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - ww / 2, gy - h, ww, h);
      break;
    }
    case 'wordwall': {
      // 浮在空中的台語字卡
      const top = y - 56;
      ctx.fillStyle = '#fef08a';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect?.(x - 11, top, 22, 56, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#b91c1c';
      ctx.font = `900 15px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('嗆', x, top + 22);
      ctx.fillText('啦', x, top + 44);
      ctx.textAlign = 'left';
      break;
    }
    case 'steam': {
      ctx.globalAlpha = Math.min(1, p.life / 30) * 0.75;
      for (let i = 0; i < (lowQuality ? 3 : 6); i++) {
        const k = ((tick * 0.8 + i * 13) % 50) / 50;
        ctx.fillStyle = `rgba(241,245,249,${0.7 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(x - 36 + ((i * 29) % 72), gy - 6 - k * 50, 10 + k * 10, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(203,213,225,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, gy, 44, 12, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'catpaw': {
      ctx.fillStyle = 'rgba(244,114,182,0.85)';
      for (let i = 0; i < 2; i++) {
        const px = x + (((tick >> 3) + i) % 2 ? -10 : 10);
        const py = gy - 2 - i * 6;
        ctx.beginPath();
        ctx.ellipse(px, py, 6, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        for (let t = -1; t <= 1; t++) {
          ctx.beginPath();
          ctx.arc(px + t * 4.5, py - 6, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'moon': {
      ctx.shadowColor = '#fde68a';
      ctx.shadowBlur = lowQuality ? 0 : 14;
      ctx.fillStyle = '#fef9c3';
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(202,138,4,0.35)';
      ctx.beginPath();
      ctx.arc(x - 3, y - 2, 2.5, 0, Math.PI * 2);
      ctx.arc(x + 4, y + 3, 1.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}
