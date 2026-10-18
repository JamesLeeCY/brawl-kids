import { CONFIG, type Difficulty } from '../config';
import { HUMAN_PLAYERS } from '../input/keyboard';
import { SLOT_COLORS } from '../render/battle';
import { drawFigure, roundRect, shade } from '../render/character';
import { getPose } from '../render/poses';
import { text } from '../render/text';
import { ModeScene } from './mode';
import { Scene, type App, type MenuInput, type SlotConfig } from './scene';
import { hint, menuBackground } from './ui';

const VW = CONFIG.view.width;
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
export const DIFF_LABEL: Record<Difficulty, string> = { easy: '簡單', normal: '普通', hard: '困難' };
export const TEAM_LABEL = ['獨立', '1 隊', '2 隊', '3 隊', '4 隊'];
const COUNTDOWN = 60;

/** "D>A" → "D→A" */
export function moveLabel(cmd: string): string {
  return cmd.replace('>', '→').replace('^', '↑').replace('v', '↓');
}

export function defaultSlots(): SlotConfig[] {
  return [0, 1, 2, 3].map((i) => ({ kind: 'empty', ready: false, charIdx: i, team: 0, difficulty: 'normal' }));
}

export class SelectScene extends Scene {
  readonly tag = 'select';
  private t = 0;
  private countdown = -1;
  /** P1 設定電腦對手時的游標欄位；-1 表示未在編輯 */
  private aiCursor = -1;

  constructor(app: App) {
    super(app);
    for (const s of app.slots) if (s.kind === 'human') s.ready = false;
  }

  private get slots(): SlotConfig[] {
    return this.app.slots;
  }

  private nChars(): number {
    return this.app.data.selectable.length;
  }

  update(inp: MenuInput): void {
    this.t++;
    const n = this.nChars();
    for (let p = 0; p < HUMAN_PLAYERS; p++) {
      const k = inp.pressed[p];
      const s = this.slots[p];
      if (p === 0 && this.aiCursor >= 0) {
        this.updateAiEdit(inp);
        continue;
      }
      if (s.kind !== 'human') {
        if (k.A) {
          s.kind = 'human';
          s.ready = false;
          this.app.sfx.play('jump');
        }
        continue;
      }
      if (!s.ready) {
        if (k.left) s.charIdx = (s.charIdx + n - 1) % n;
        if (k.right) s.charIdx = (s.charIdx + 1) % n;
        if (k.up) s.team = (s.team + 4) % 5;
        if (k.down) s.team = (s.team + 1) % 5;
        if (k.J || k.A) {
          s.ready = true;
          this.app.sfx.play('special');
        }
        if (k.D) s.kind = 'empty';
      } else {
        if (k.D) s.ready = false;
        if (p === 0 && (k.right || k.left)) {
          const first = this.nextAiSlot(0, 1);
          if (first >= 0) this.aiCursor = first;
        }
      }
    }
    const humans = this.slots.filter((s) => s.kind === 'human');
    const allReady = humans.length > 0 && humans.every((s) => s.ready) && this.aiCursor < 0;
    if (!allReady) this.countdown = -1;
    else if (this.countdown < 0) this.countdown = COUNTDOWN;
    else if (--this.countdown === 0) {
      this.countdown = -1;
      this.app.scenes.push(new ModeScene(this.app));
    }
  }

  private nextAiSlot(from: number, dir: 1 | -1): number {
    for (let i = from + dir; i >= 1 && i <= 3; i += dir) if (this.slots[i].kind !== 'human') return i;
    return -1;
  }

  private updateAiEdit(inp: MenuInput): void {
    const k = inp.pressed[0];
    const s = this.slots[this.aiCursor];
    if (s.kind === 'human') {
      this.aiCursor = this.nextAiSlot(0, 1);
      return;
    }
    if (k.right) {
      const nx = this.nextAiSlot(this.aiCursor, 1);
      if (nx >= 0) this.aiCursor = nx;
    }
    if (k.left) this.aiCursor = this.nextAiSlot(this.aiCursor, -1);
    if (k.D) this.aiCursor = -1;
    if (this.aiCursor < 0) return;
    const n = this.nChars();
    if (k.A) {
      if (s.kind === 'empty') {
        s.kind = 'ai';
        s.difficulty = 'easy';
      } else {
        const i = DIFFS.indexOf(s.difficulty);
        if (i === DIFFS.length - 1) s.kind = 'empty';
        else s.difficulty = DIFFS[i + 1];
      }
    }
    if (s.kind === 'ai') {
      if (k.up) s.charIdx = (s.charIdx + n - 1) % n;
      if (k.down) s.charIdx = (s.charIdx + 1) % n;
      if (k.J) s.team = (s.team + 1) % 5;
    }
  }

  onEscape(): void {
    if (this.aiCursor >= 0) {
      this.aiCursor = -1;
      return;
    }
    this.app.scenes.pop();
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t, '#16213e', '#0f3460');
    text(ctx, '選擇角色', VW / 2, 36, 26, '#ffd23f', 'center', true, true);
    const ids = this.app.data.selectable;
    for (let p = 0; p < 4; p++) {
      const s = this.slots[p];
      const x = p * 200 + 6;
      const y = 52;
      const col = SLOT_COLORS[p];
      const editing = this.aiCursor === p;
      ctx.fillStyle = s.kind === 'empty' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.35)';
      roundRect(ctx, x, y, 188, 330, 10);
      ctx.fill();
      ctx.strokeStyle = editing ? '#fff' : s.ready ? '#ffd23f' : col;
      ctx.lineWidth = editing || s.ready ? 4 : 2;
      ctx.stroke();
      text(ctx, s.kind === 'ai' ? `COM（${DIFF_LABEL[s.difficulty]}）` : `${p + 1}P`, x + 94, y + 24, 16, col, 'center');
      if (s.kind === 'empty') {
        text(ctx, p < HUMAN_PLAYERS ? '按攻擊鍵加入' : '電腦欄位', x + 94, y + 160, 15, 'rgba(255,255,255,0.7)', 'center');
        if (p > 0) text(ctx, p < HUMAN_PLAYERS ? '（或由 1P 設為電腦）' : '（由 1P 設為電腦）', x + 94, y + 184, 12, 'rgba(255,255,255,0.5)', 'center', false);
        if (editing) text(ctx, '1P：攻擊鍵加入電腦', x + 94, y + 220, 13, '#fff', 'center');
        continue;
      }
      const def = this.app.data.characters[ids[s.charIdx % ids.length]];
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 14, y + 36, 160, 150);
      ctx.clip();
      ctx.fillStyle = shade(def.palette.accent, -0.55);
      ctx.fillRect(x + 14, y + 36, 160, 150);
      const pose = getPose(s.ready ? 'victory' : `idle_${Math.floor(this.t / 30) % 2}`);
      drawFigure(ctx, def, { pose, x: x + 94, y: y + 238, facing: 1, scale: 2, tick: this.t, upperOnly: true });
      ctx.restore();
      if (s.kind === 'human' && !s.ready) {
        text(ctx, '◀', x + 22, y + 116, 18, '#fff', 'center');
        text(ctx, '▶', x + 166, y + 116, 18, '#fff', 'center');
      }
      text(ctx, def.name, x + 94, y + 212, 20, '#fff', 'center');
      text(ctx, def.title, x + 94, y + 232, 13, def.palette.accent, 'center');
      text(ctx, `隊伍：${TEAM_LABEL[s.team]}`, x + 94, y + 258, 14, '#fff', 'center');
      const moves = def.moves.map((m) => `${moveLabel(m.command)} ${m.name}`);
      moves.forEach((m, i) => text(ctx, m, x + 8 + (i % 2) * 90, y + 278 + Math.floor(i / 2) * 14, 9.5, 'rgba(255,255,255,0.8)', 'left', false));
      if (s.ready) text(ctx, '準備完成！', x + 94, y + 326, 15, '#ffd23f', 'center');
      if (editing) text(ctx, '上下換角 跳躍換隊 攻擊改難度', x + 94, y + 326, 11, '#fff', 'center');
    }
    if (this.countdown > 0) text(ctx, `即將開始…`, VW / 2, 400, 18, '#ffd23f', 'center', true, true);
    const p1 = this.slots[0];
    if (this.aiCursor >= 0) hint(ctx, '1P 設定電腦：←→ 選欄位　攻擊 加入/改難度/移除　↑↓ 換角色　跳躍 換隊　防禦 完成', 414);
    else if (p1.kind === 'human' && p1.ready) hint(ctx, '1P 已確定：按 ← / → 設定電腦對手　防禦 取消', 414);
    hint(ctx, '攻擊加入　←→ 選角　↑↓ 選隊伍　跳躍 確定　防禦 退出　·　全員確定 1 秒後開始　·　Esc 返回');
  }
}
