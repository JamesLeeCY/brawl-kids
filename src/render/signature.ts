// 角色招牌特效：每名角色的圖示、代表色與氣場風格。命中、集氣、衝刺、KO、大招切入畫面都用這裡的設定。
// 純畫面，不影響遊戲結果。
import { lowQuality } from './quality';
import { FONT } from './text';

export type AuraStyle = 'sparkle' | 'electric' | 'flame' | 'bubbles' | 'notes' | 'paper' | 'pop' | 'ice';

/** 招牌音效風格（命中時疊在一般打擊聲上、放招時的短旋律） */
export type SoundStyle =
  | 'paper'
  | 'slap'
  | 'laugh'
  | 'croak'
  | 'metal'
  | 'zap'
  | 'chime'
  | 'growl'
  | 'tweet'
  | 'steam'
  | 'boing'
  | 'sparkle'
  | 'boom'
  | 'meow'
  | 'coin'
  | 'box'
  | 'cash';

export interface Signature {
  /** 命中、KO 時噴出的圖示（drawIcon 的種類） */
  icons: [string, string];
  /** 主色、副色 */
  colors: [string, string];
  /** 集氣與大招時的氣場 */
  aura: AuraStyle;
  /** 招牌音效 */
  sound: SoundStyle;
}

export const SIGNATURES: Record<string, Signature> = {
  adi: { icons: ['abc', 'book'], colors: ['#0ea5e9', '#fbbf24'], aura: 'paper', sound: 'paper' },
  aga: { icons: ['slipper', 'star'], colors: ['#ef4444', '#fde047'], aura: 'flame', sound: 'slap' },
  boen: { icons: ['laugh', 'mic'], colors: ['#a855f7', '#facc15'], aura: 'pop', sound: 'laugh' },
  frog: { icons: ['frog', 'note'], colors: ['#22c55e', '#bbf7d0'], aura: 'bubbles', sound: 'croak' },
  gym: { icons: ['dumbbell', 'star'], colors: ['#f97316', '#fef08a'], aura: 'flame', sound: 'metal' },
  jiang: { icons: ['doc', 'star'], colors: ['#3b82f6', '#e0f2fe'], aura: 'paper', sound: 'paper' },
  ko: { icons: ['bolt', 'pill'], colors: ['#22d3ee', '#e0f2fe'], aura: 'electric', sound: 'zap' },
  lai: { icons: ['pill', 'star'], colors: ['#16a34a', '#bbf7d0'], aura: 'sparkle', sound: 'chime' },
  puma: { icons: ['bearhead', 'star'], colors: ['#fbbf24', '#1f2937'], aura: 'electric', sound: 'growl' },
  yu: { icons: ['candle', 'coin'], colors: ['#ef4444', '#22c55e'], aura: 'electric', sound: 'zap' },
  trump: { icons: ['tweet', 'tower'], colors: ['#f59e0b', '#ef4444'], aura: 'pop', sound: 'tweet' },
  xi: { icons: ['bun', 'star'], colors: ['#e11d48', '#fde68a'], aura: 'bubbles', sound: 'steam' },
  pudding: { icons: ['pudding', 'star'], colors: ['#38bdf8', '#e0f2fe'], aura: 'ice', sound: 'boing' },
  zelensky: { icons: ['sunflower', 'star'], colors: ['#facc15', '#3b82f6'], aura: 'sparkle', sound: 'sparkle' },
  kim: { icons: ['firework', 'star'], colors: ['#ef4444', '#facc15'], aura: 'flame', sound: 'boom' },
  tsai: { icons: ['cat', 'chili'], colors: ['#ec4899', '#fb923c'], aura: 'flame', sound: 'meow' },
  han: { icons: ['coin', 'cabbage'], colors: ['#facc15', '#84cc16'], aura: 'sparkle', sound: 'coin' },
  huang: { icons: ['evidence', 'doc'], colors: ['#f97316', '#ffffff'], aura: 'paper', sound: 'paper' },
  joeman: { icons: ['box', 'star'], colors: ['#f59e0b', '#fef3c7'], aura: 'pop', sound: 'box' },
  howhow: { icons: ['gift', 'note'], colors: ['#fb923c', '#fde047'], aura: 'notes', sound: 'cash' },
};

const DEFAULT_SIG: Signature = { icons: ['star', 'star'], colors: ['#ffd166', '#ffffff'], aura: 'sparkle', sound: 'sparkle' };

export function signatureOf(charId: string, accent?: string): Signature {
  return SIGNATURES[charId] ?? (accent ? { ...DEFAULT_SIG, colors: [accent, '#ffffff'] } : DEFAULT_SIG);
}

/** #rrggbb + 透明度 → rgba() */
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/**
 * 氣場：(x, y) 為身體中心，k = 0～1 強度（集氣時由外往內收、大招時滿格），r 為半徑。
 * 每種風格都畫在身體周圍，避開臉（中心在身體）。
 */
export function drawAura(ctx: CanvasRenderingContext2D, style: AuraStyle, x: number, y: number, r: number, k: number, colors: [string, string], tick: number, seed: number): void {
  const [c1, c2] = colors;
  const n = lowQuality ? 5 : 10;
  ctx.save();
  ctx.lineCap = 'round';
  switch (style) {
    case 'electric': {
      // 電流：繞著身體的鋸齒閃電
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < (lowQuality ? 2 : 4); i++) {
        const a0 = ((tick * 0.35 + i * 1.7 + seed) % (Math.PI * 2));
        ctx.strokeStyle = rgba(i % 2 ? c2 : c1, 0.9 * k);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let s = 0; s <= 6; s++) {
          const a = a0 + s * 0.28;
          const rr = r * (0.8 + ((s * 37 + tick * 13 + i * 7) % 10) / 25);
          const px = x + Math.cos(a) * rr;
          const py = y + Math.sin(a) * rr * 1.2;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      break;
    }
    case 'flame': {
      // 火焰：腳邊往上竄的火舌
      for (let i = 0; i < n; i++) {
        const ph = ((tick * 2.2 + i * 23 + seed * 7) % 40) / 40;
        const fx = x + Math.sin(i * 2.4 + seed) * r * 0.75;
        const fy = y + r * 0.9 - ph * r * 1.6;
        const s = (1 - ph) * 7 * (0.6 + k * 0.6);
        ctx.fillStyle = rgba(ph < 0.4 ? c2 : c1, (1 - ph) * 0.85 * k + 0.1);
        ctx.beginPath();
        ctx.moveTo(fx, fy - s * 1.8);
        ctx.quadraticCurveTo(fx + s, fy, fx, fy + s * 0.6);
        ctx.quadraticCurveTo(fx - s, fy, fx, fy - s * 1.8);
        ctx.fill();
      }
      break;
    }
    case 'bubbles':
      for (let i = 0; i < n; i++) {
        const ph = ((tick * 1.4 + i * 19 + seed * 5) % 50) / 50;
        const bx = x + Math.sin(i * 1.9 + ph * 4) * r * 0.8;
        const by = y + r - ph * r * 2;
        ctx.strokeStyle = rgba(i % 2 ? c2 : c1, (1 - ph) * k);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bx, by, 2 + (i % 3) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    case 'notes':
      ctx.font = `900 13px ${FONT}`;
      ctx.textAlign = 'center';
      for (let i = 0; i < (lowQuality ? 3 : 6); i++) {
        const a = tick * 0.06 + (i / 6) * Math.PI * 2 + seed;
        ctx.fillStyle = rgba(i % 2 ? c2 : c1, k);
        ctx.fillText(i % 2 ? '♫' : '♪', x + Math.cos(a) * r, y + Math.sin(a) * r * 0.9 + Math.sin(tick * 0.2 + i) * 3);
      }
      break;
    case 'paper':
      for (let i = 0; i < n; i++) {
        const a = tick * 0.09 + (i / n) * Math.PI * 2 + seed;
        ctx.save();
        ctx.translate(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8);
        ctx.rotate(a * 2);
        ctx.fillStyle = rgba('#ffffff', 0.9 * k);
        ctx.strokeStyle = rgba(c1, k);
        ctx.lineWidth = 1;
        ctx.fillRect(-3.5, -4.5, 7, 9);
        ctx.strokeRect(-3.5, -4.5, 7, 9);
        ctx.restore();
      }
      break;
    case 'pop': {
      // 漫畫爆炸框：一圈尖尖的放射線
      ctx.strokeStyle = rgba(c1, 0.9 * k);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + seed;
        const r0 = r * 0.8 + Math.sin(tick * 0.5 + i) * 3;
        ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
        ctx.lineTo(x + Math.cos(a) * (r0 + 9 * k), y + Math.sin(a) * (r0 + 9 * k));
      }
      ctx.stroke();
      break;
    }
    case 'ice':
      for (let i = 0; i < n; i++) {
        const a = tick * 0.05 + (i / n) * Math.PI * 2 + seed;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r * 0.85;
        ctx.strokeStyle = rgba(i % 2 ? c2 : c1, k);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let s = 0; s < 3; s++) {
          const b = (s / 3) * Math.PI;
          ctx.moveTo(px - Math.cos(b) * 4, py - Math.sin(b) * 4);
          ctx.lineTo(px + Math.cos(b) * 4, py + Math.sin(b) * 4);
        }
        ctx.stroke();
      }
      break;
    default:
      // sparkle：四角星光
      for (let i = 0; i < n; i++) {
        const a = tick * 0.07 + (i / n) * Math.PI * 2 + seed;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r * 0.85;
        const s = 2.5 + ((i + tick) % 3);
        ctx.fillStyle = rgba(i % 2 ? c2 : c1, k);
        ctx.beginPath();
        ctx.moveTo(px, py - s * 1.6);
        ctx.lineTo(px + s * 0.4, py - s * 0.4);
        ctx.lineTo(px + s * 1.6, py);
        ctx.lineTo(px + s * 0.4, py + s * 0.4);
        ctx.lineTo(px, py + s * 1.6);
        ctx.lineTo(px - s * 0.4, py + s * 0.4);
        ctx.lineTo(px - s * 1.6, py);
        ctx.lineTo(px - s * 0.4, py - s * 0.4);
        ctx.closePath();
        ctx.fill();
      }
  }
  ctx.restore();
}
