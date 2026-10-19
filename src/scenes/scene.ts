import type { Music } from '../audio/music';
import type { Sfx } from '../audio/sfx';
import type { Difficulty } from '../config';
import type { GameData } from '../data/load';
import type { Keyboard } from '../input/keyboard';
import type { Settings } from '../settings';
import { emptySnapshot, type Snapshot } from '../sim/snapshot';

export interface MenuInput {
  /** 各玩家本 tick 的按下事件 */
  pressed: Snapshot[];
  /** 各玩家目前按住的鍵 */
  held: Snapshot[];
  /** 所有玩家按下事件的聯集（Enter 視為攻擊） */
  any: Snapshot;
  codes: string[];
}

export interface SlotConfig {
  kind: 'empty' | 'human' | 'ai';
  ready: boolean;
  charIdx: number;
  /** 0 = 獨立 */
  team: number;
  difficulty: Difficulty;
}

export interface App {
  data: GameData;
  settings: Settings;
  kb: Keyboard;
  sfx: Sfx;
  music: Music;
  scenes: SceneManager;
  slots: SlotConfig[];
  showFps: boolean;
}

export abstract class Scene {
  readonly tag: string = '';
  /** true：使用加寬的戰鬥畫面；false：800 寬置中 */
  readonly wide: boolean = false;
  /** true：加寬畫面但不顯示觸控搖桿 / 按鈕（例如重播，改用畫面上的按鈕） */
  readonly noTouchPad: boolean = false;
  constructor(protected app: App) {}
  abstract update(inp: MenuInput): void;
  abstract render(ctx: CanvasRenderingContext2D): void;
  /** Esc：預設回上一頁 */
  onEscape(): void {
    this.app.scenes.pop();
  }
  onClick(_x: number, _y: number): void {}
}

export class SceneManager {
  stack: Scene[] = [];
  get top(): Scene | undefined {
    return this.stack[this.stack.length - 1];
  }
  push(s: Scene): void {
    this.stack.push(s);
  }
  pop(): void {
    if (this.stack.length > 1) this.stack.pop();
  }
  replace(s: Scene): void {
    this.stack.pop();
    this.stack.push(s);
  }
  reset(list: Scene[]): void {
    this.stack = list;
  }
}

export function unionPressed(list: Snapshot[], enter: boolean): Snapshot {
  const u = emptySnapshot();
  for (const s of list) for (const k of Object.keys(u) as (keyof Snapshot)[]) u[k] = u[k] || s[k];
  if (enter) u.A = true;
  return u;
}
