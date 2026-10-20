// 重播畫面：用錄下的按鍵重跑同一個決定論世界。可暫停、2 倍速、拖曳進度（往回跳時從第 0 tick 重建）。
import { CONFIG } from '../config';
import { dataVersion } from '../data';
import { BattleRenderer } from '../render/battle';
import { roundRect } from '../render/character';
import { text } from '../render/text';
import { VW } from '../render/view';
import { decodeReplay, replayInputs, type Replay } from '../replay/replay';
import { campaignLength, World } from '../sim/world';
import { Scene, type App, type MenuInput } from './scene';
import { hint, menuBackground, overlay } from './ui';

const VH = CONFIG.view.height;
/** 跳轉時每個畫面 tick 最多模擬幾個 tick（避免長比賽一次卡住太久） */
const SEEK_TICKS_PER_FRAME = 1500;
const SEEK_STEP = 5 * CONFIG.tickRate;

export interface ReplayOptions {
  /** 每個 tick 先呼叫（連線結算畫面在重播期間仍要處理房主的「再來一場」） */
  onTick?: () => void;
  /** 離開重播；預設回上一頁 */
  onExit?: () => void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class ReplayScene extends Scene {
  readonly wide = true;
  readonly noTouchPad = true;
  world: World;
  private renderer: BattleRenderer;
  private paused = false;
  private speed: 1 | 2 = 1;
  /** 跳轉目標 tick；-1 = 沒有在跳轉 */
  private target = -1;
  private mismatch = false;

  constructor(
    app: App,
    private replay: Replay,
    private opts: ReplayOptions = {},
  ) {
    super(app);
    this.world = new World(app.data, replay.setup);
    this.renderer = new BattleRenderer(this.world);
  }

  private get ended(): boolean {
    return this.world.tick >= this.replay.ticks;
  }

  update(inp: MenuInput): void {
    this.opts.onTick?.();
    if (this.app.scenes.top !== this) return;
    const a = inp.any;
    if (a.A || inp.codes.includes('Space')) this.togglePause();
    if (a.J) this.speed = this.speed === 1 ? 2 : 1;
    if (a.left) this.seek(this.seekBase() - SEEK_STEP);
    if (a.right) this.seek(this.seekBase() + SEEK_STEP);
    if (a.D) {
      this.exit();
      return;
    }
    if (this.target >= 0) {
      this.runSeek();
      return;
    }
    if (this.paused || this.ended) return;
    for (let i = 0; i < this.speed && !this.ended; i++) this.stepOne(true);
    if (this.ended) this.checkEnd();
  }

  private seekBase(): number {
    return this.target >= 0 ? this.target : this.world.tick;
  }

  private togglePause(): void {
    if (this.ended && this.target < 0) {
      this.seek(0);
      this.paused = false;
      return;
    }
    this.paused = !this.paused;
  }

  seek(tick: number): void {
    this.target = Math.max(0, Math.min(this.replay.ticks, Math.round(tick)));
  }

  /** 往回跳：從第 0 tick 重建；往前跳：直接快轉。都不播特效與音效 */
  private runSeek(): void {
    if (this.target < this.world.tick) this.world = new World(this.app.data, this.replay.setup);
    for (let i = 0; i < SEEK_TICKS_PER_FRAME && this.world.tick < this.target; i++) this.stepOne(false);
    if (this.world.tick < this.target) return;
    this.target = -1;
    this.renderer = new BattleRenderer(this.world);
    if (this.ended) this.checkEnd();
  }

  private stepOne(fx: boolean): void {
    const w = this.world;
    w.step(replayInputs(this.replay, w.tick));
    if (!fx) return;
    this.renderer.consume(w.events);
    for (const ev of w.events) if (ev.type === 'sound') this.app.sfx.play(ev.key);
    this.renderer.tick(w);
  }

  private checkEnd(): void {
    this.mismatch = this.world.hash() !== this.replay.finalHash;
    if (this.mismatch) console.warn('[重播] 結束時的世界狀態與錄製時不同');
  }

  private exit(): void {
    if (this.opts.onExit) this.opts.onExit();
    else this.app.scenes.pop();
  }

  onEscape(): void {
    this.exit();
  }

  // ---------- 版面 ----------
  private layout(): { play: Rect; speed: Rect; bar: Rect; exit: Rect } {
    const y = VH - 40;
    const h = 30;
    return {
      play: { x: 10, y, w: 44, h },
      speed: { x: 60, y, w: 44, h },
      bar: { x: 118, y: y + 11, w: VW - 118 - 200, h: 8 },
      exit: { x: VW - 70, y, w: 60, h },
    };
  }

  onClick(x: number, y: number): void {
    const L = this.layout();
    const hit = (r: Rect, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
    if (hit(L.play)) this.togglePause();
    else if (hit(L.speed)) this.speed = this.speed === 1 ? 2 : 1;
    else if (hit(L.exit)) this.exit();
    else if (hit(L.bar, 12)) this.seek(((x - L.bar.x) / L.bar.w) * this.replay.ticks);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const w = this.world;
    const s = this.replay.setup;
    let extra: string | undefined;
    if (s.mode === 'campaign' && w.waves) {
      extra = `重播　第 ${(s.campaignIndex ?? 0) + 1} / ${campaignLength(this.app.data, s)} 關　${w.stage.name}　波 ${Math.max(1, w.waveIndex + 1)} / ${w.waves.waves.length}`;
    }
    this.renderer.draw(ctx, w, extra);
    if (w.endTimer > 0) text(ctx, 'K.O.!', VW / 2, 200, 64, '#ff4d4d', 'center', true, true);
    text(ctx, '● 重播', VW / 2, 86, 16, '#ff6b6b', 'center', true, true);

    if (this.target >= 0) {
      overlay(ctx, 0.35, VW);
      text(ctx, '跳轉中…', VW / 2, 210, 26, '#ffd23f', 'center', true, true);
    } else if (this.ended) {
      text(ctx, this.mismatch ? '⚠ 重播與原比賽不一致' : '重播結束', VW / 2, 250, 26, this.mismatch ? '#fca5a5' : '#ffd23f', 'center', true, true);
      text(ctx, '攻擊：從頭播放　防禦 / Esc：離開', VW / 2, 280, 14, '#fff', 'center', true, true);
    } else if (this.paused) {
      text(ctx, '❚❚ 暫停', VW / 2, 220, 30, '#fff', 'center', true, true);
    }
    this.renderBar(ctx);
  }

  private renderBar(ctx: CanvasRenderingContext2D): void {
    const L = this.layout();
    ctx.fillStyle = 'rgba(10,12,30,0.72)';
    ctx.fillRect(0, L.play.y - 8, VW, VH - L.play.y + 8);
    const btn = (r: Rect, label: string, on = false) => {
      ctx.fillStyle = on ? '#ffd23f' : 'rgba(255,255,255,0.16)';
      roundRect(ctx, r.x, r.y, r.w, r.h, 7);
      ctx.fill();
      text(ctx, label, r.x + r.w / 2, r.y + 21, 14, on ? '#111' : '#fff', 'center');
    };
    btn(L.play, this.paused || this.ended ? '▶' : '❚❚');
    btn(L.speed, `${this.speed}×`, this.speed === 2);
    btn(L.exit, '離開');
    const b = L.bar;
    const cur = this.seekBase();
    const frac = this.replay.ticks ? cur / this.replay.ticks : 0;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    roundRect(ctx, b.x, b.y, b.w, b.h, 4);
    ctx.fill();
    ctx.fillStyle = '#ff6b6b';
    roundRect(ctx, b.x, b.y, Math.max(b.h, b.w * frac), b.h, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(b.x + b.w * frac, b.y + b.h / 2, 8, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, `${clock(cur)} / ${clock(this.replay.ticks)}`, b.x + b.w + 14, b.y + 9, 13, '#fff', 'left');
    text(ctx, '攻擊 暫停　跳躍 2×　←→ ±5 秒', VW / 2, L.play.y - 14, 11, 'rgba(255,255,255,0.75)', 'center', false, true);
  }
}

function clock(ticks: number): string {
  const sec = Math.floor(ticks / (CONFIG.tickRate * CONFIG.gameSpeed));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** 從分享連結或貼上的代碼開啟重播：解碼、比對版本，成功就換成 ReplayScene，否則顯示原因 */
export class ReplayLoadScene extends Scene {
  private t = 0;
  private error = '';
  private detail = '';

  constructor(
    app: App,
    code: string,
    private onExit: () => void,
  ) {
    super(app);
    decodeReplay(code).then(
      (r) => this.open(r),
      (e: unknown) => {
        this.error = e instanceof Error ? e.message : '重播資料無法讀取';
        this.detail = '請確認連結或代碼有完整複製。';
      },
    );
  }

  private open(r: Replay): void {
    if (this.app.scenes.top !== this) return;
    if (r.version !== dataVersion()) {
      this.error = '這段重播是用另一個版本的遊戲錄的';
      this.detail = '遊戲更新後，舊的重播無法正確播放（角色動作可能已經不同）。';
      return;
    }
    const known = r.setup.players.every((p) => this.app.data.characters[p.charId]);
    if (!known) {
      this.error = '重播裡有目前版本沒有的角色';
      return;
    }
    this.app.scenes.replace(new ReplayScene(this.app, r, { onExit: this.onExit }));
  }

  update(inp: MenuInput): void {
    this.t++;
    if (this.error && this.t > 20 && (inp.any.A || inp.any.D)) this.onExit();
  }

  onEscape(): void {
    this.onExit();
  }

  onClick(): void {
    if (this.error) this.onExit();
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t);
    const cx = CONFIG.view.width / 2;
    if (!this.error) {
      text(ctx, '讀取重播中…', cx, 220, 26, '#ffd23f', 'center', true, true);
      return;
    }
    text(ctx, '無法播放重播', cx, 160, 30, '#ffd23f', 'center', true, true);
    text(ctx, this.error, cx, 215, 18, '#fff', 'center', true, true);
    if (this.detail) text(ctx, this.detail, cx, 245, 14, '#e2e8f0', 'center', false, true);
    hint(ctx, '按 攻擊 / Enter 回到標題');
  }
}
