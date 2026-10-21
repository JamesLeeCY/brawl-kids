// 勝利慶祝：每個角色有自己的兩個慶祝姿勢與招牌道具雨。道具畫在角色後面、姿勢不擋臉。
import type { CharacterDef } from '../data/load';
import { drawIcon } from './battle';
import { drawFigure } from './character';
import { getPose } from './poses';

interface Celebration {
  poses: [string, string];
  /** 道具雨的圖示（drawIcon 的種類） */
  icon: string;
}

const CELEBRATIONS: Record<string, Celebration> = {
  adi: { poses: ['cheer_back', 'wave'], icon: 'abc' },
  aga: { poses: ['fist_pump', 'cheer_back'], icon: 'slipper' },
  boen: { poses: ['clap', 'clap2'], icon: 'laugh' },
  frog: { poses: ['hop', 'cheer_back'], icon: 'frog' },
  gym: { poses: ['flex', 'fist_pump'], icon: 'dumbbell' },
  jiang: { poses: ['wave', 'wave2'], icon: 'doc' },
  ko: { poses: ['thumbs', 'cheer_back'], icon: 'bolt' },
  lai: { poses: ['wave', 'wave2'], icon: 'pill' },
  puma: { poses: ['fist_pump', 'hop'], icon: 'bearhead' },
  yu: { poses: ['thumbs', 'fist_pump'], icon: 'candle' },
  trump: { poses: ['thumbs', 'fist_pump'], icon: 'tweet' },
  xi: { poses: ['wave', 'wave2'], icon: 'bun' },
  pudding: { poses: ['flex', 'cheer_back'], icon: 'pudding' },
  zelensky: { poses: ['fist_pump', 'wave2'], icon: 'sunflower' },
  kim: { poses: ['clap', 'clap2'], icon: 'firework' },
  tsai: { poses: ['wave', 'wave2'], icon: 'cat' },
};
const DEFAULT: Celebration = { poses: ['cheer_back', 'wave'], icon: 'star' };

/** 在 (x, y) 畫一個正在慶祝的角色（y = 腳底）；scale 為角色大小 */
export function drawCelebration(ctx: CanvasRenderingContext2D, def: CharacterDef, x: number, y: number, scale: number, t: number): void {
  const c = CELEBRATIONS[def.id] ?? DEFAULT;
  // 道具雨：在角色左右兩側落下、轉動，畫在角色後面
  ctx.save();
  for (let i = 0; i < 9; i++) {
    const side = i % 2 ? 1 : -1;
    const lane = 34 + ((i * 37) % 60);
    const fall = ((t * (0.9 + (i % 3) * 0.25) + i * 47) % 190) - 40;
    const ix = x + side * lane * (scale / 1.8) + Math.sin(t * 0.05 + i) * 6;
    const iy = y - 150 * (scale / 1.8) + fall;
    ctx.globalAlpha = Math.max(0, Math.min(1, 1.6 - fall / 120));
    drawIcon(ctx, c.icon, ix, iy, 1.1 * (scale / 1.8), 1, def.palette.accent, t, i);
  }
  ctx.restore();
  // 輕快的彈跳 + 兩個姿勢交替
  const beat = Math.floor(t / 22) % 2;
  const bounce = Math.abs(Math.sin((t / 22) * Math.PI)) * 5;
  drawFigure(ctx, def, { pose: getPose(c.poses[beat]), x, y: y - bounce, facing: 1, scale, tick: t, expression: 'happy', sticker: true });
}
