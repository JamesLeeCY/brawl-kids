// 連線大廳：建立 / 加入房間、連線選角。
import { CONFIG, type Difficulty } from '../config';
import { dataVersion } from '../data';
import { SLOT_COLORS } from '../render/battle';
import { drawFigure, roundRect, shade } from '../render/character';
import { getPose } from '../render/poses';
import { text } from '../render/text';
import { CODE_LENGTH, NetSession, isValidCodeChar, shareUrl } from '../net/session';
import { emptySnapshot, type Snapshot } from '../sim/snapshot';
import type { MatchSetup } from '../sim/world';
import { BattleScene } from './battle';
import { Scene, type App, type MenuInput } from './scene';
import { button, hint, menuBackground } from './ui';

const VW = CONFIG.view.width;

/** 連線時本機玩家可用 1P 或 2P 任一組按鍵 */
export function localPressed(inp: MenuInput): Snapshot {
  const s = emptySnapshot();
  for (const p of inp.pressed) for (const k of Object.keys(s) as (keyof Snapshot)[]) s[k] = s[k] || p[k];
  if (inp.codes.includes('Enter')) s.A = true;
  return s;
}

export function localHeld(inp: MenuInput): Snapshot {
  const s = emptySnapshot();
  for (const p of inp.held) for (const k of Object.keys(s) as (keyof Snapshot)[]) s[k] = s[k] || p[k];
  return s;
}

export function leaveOnline(app: App, net: NetSession | null): void {
  net?.close();
  app.scenes.reset(app.scenes.stack.slice(0, 1));
}

// ---------------- 連線選單 ----------------
export class OnlineMenuScene extends Scene {
  private sel = 0;
  private t = 0;
  private readonly options = ['建立房間', '加入房間', '返回'];

  update(inp: MenuInput): void {
    this.t++;
    const a = inp.any;
    if (a.up) this.sel = (this.sel + this.options.length - 1) % this.options.length;
    if (a.down) this.sel = (this.sel + 1) % this.options.length;
    if (a.A) {
      if (this.sel === 0) this.app.scenes.push(new HostScene(this.app));
      else if (this.sel === 1) this.app.scenes.push(new JoinScene(this.app));
      else this.app.scenes.pop();
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t, '#0b2545', '#13315c');
    text(ctx, '連線對戰', VW / 2, 90, 36, '#ffd23f', 'center', true, true);
    text(ctx, '兩台電腦、各自一副鍵盤，透過網址連線一起玩', VW / 2, 125, 14, '#cbd5e1', 'center', false);
    this.options.forEach((o, i) => button(ctx, o, VW / 2, 170 + i * 50, 240, this.sel === i));
    text(ctx, '房主建立房間後，把連結傳給朋友；朋友打開連結就會自動加入。', VW / 2, 350, 13, '#fff', 'center', false);
    text(ctx, '連線時你可以用 WASD + J/K/L 或 方向鍵 + 數字鍵 1/2/3 操作。', VW / 2, 372, 13, '#fff', 'center', false);
    hint(ctx, '↑↓ 選擇　攻擊 / Enter 確定　Esc 返回');
  }
}

// ---------------- 建立房間 ----------------
export class HostScene extends Scene {
  private net: NetSession;
  private t = 0;
  private copied = 0;

  constructor(app: App) {
    super(app);
    this.net = NetSession.host(dataVersion());
  }

  update(inp: MenuInput): void {
    this.t++;
    if (this.copied > 0) this.copied--;
    if (this.net.status === 'open') {
      this.app.scenes.replace(new OnlineSelectScene(this.app, this.net));
      return;
    }
    if (inp.any.A && this.net.status === 'waiting') this.copy();
  }

  private copy(): void {
    const url = shareUrl(this.net.code);
    navigator.clipboard?.writeText(url).then(
      () => (this.copied = 120),
      () => (this.copied = -1),
    );
  }

  onClick(): void {
    if (this.net.status === 'waiting') this.copy();
  }

  onEscape(): void {
    this.net.close();
    this.app.scenes.pop();
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t, '#0b2545', '#13315c');
    text(ctx, '建立房間', VW / 2, 70, 30, '#ffd23f', 'center', true, true);
    const n = this.net;
    if (n.status === 'connecting') {
      text(ctx, '正在向配對伺服器登記房間…', VW / 2, 200, 18, '#fff', 'center');
    } else if (n.status === 'error') {
      text(ctx, n.error, VW / 2, 200, 16, '#ff8a8a', 'center');
      text(ctx, '按 Esc 返回', VW / 2, 240, 14, '#fff', 'center', false);
    } else {
      text(ctx, '房間代碼', VW / 2, 130, 16, '#cbd5e1', 'center');
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      roundRect(ctx, VW / 2 - 150, 142, 300, 70, 12);
      ctx.fill();
      text(ctx, n.code.split('').join(' '), VW / 2, 192, 44, '#fff', 'center', true);
      text(ctx, '分享連結（朋友打開就會自動加入）：', VW / 2, 250, 14, '#cbd5e1', 'center', false);
      text(ctx, shareUrl(n.code), VW / 2, 274, 13, '#7dd3fc', 'center', false);
      const label = this.copied > 0 ? '✓ 已複製連結！' : this.copied < 0 ? '無法自動複製，請手動複製上方連結' : '按 攻擊 / Enter 或點畫面複製連結';
      button(ctx, label, VW / 2, 300, 380, true);
      const dots = '.'.repeat(1 + ((this.t >> 4) % 3));
      text(ctx, `等待對手加入${dots}`, VW / 2, 380, 18, '#ffd23f', 'center');
    }
    hint(ctx, 'Esc 取消並返回');
  }
}

// ---------------- 加入房間 ----------------
export class JoinScene extends Scene {
  private code = '';
  private net: NetSession | null = null;
  private t = 0;

  constructor(app: App, code = '') {
    super(app);
    this.code = code.toUpperCase().slice(0, CODE_LENGTH);
    if (this.code.length === CODE_LENGTH) this.connect();
  }

  private connect(): void {
    this.net = NetSession.join(this.code, dataVersion());
  }

  update(inp: MenuInput): void {
    this.t++;
    if (this.net) {
      if (this.net.status === 'open') {
        this.app.scenes.replace(new OnlineSelectScene(this.app, this.net));
        return;
      }
      if (this.net.status === 'error' || this.net.status === 'closed') {
        if (inp.codes.includes('Enter') || inp.codes.includes('Backspace')) this.net = null;
      }
      return;
    }
    for (const c of inp.codes) {
      if (c === 'Backspace') this.code = this.code.slice(0, -1);
      else if (c === 'Enter' && this.code.length === CODE_LENGTH) this.connect();
      else {
        const ch = c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : c.startsWith('Numpad') ? c.slice(6) : '';
        if (ch.length === 1 && isValidCodeChar(ch) && this.code.length < CODE_LENGTH) this.code += ch;
      }
    }
  }

  onEscape(): void {
    this.net?.close();
    this.app.scenes.pop();
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t, '#0b2545', '#13315c');
    text(ctx, '加入房間', VW / 2, 70, 30, '#ffd23f', 'center', true, true);
    text(ctx, '輸入房主給你的 6 碼房間代碼', VW / 2, 130, 16, '#cbd5e1', 'center');
    for (let i = 0; i < CODE_LENGTH; i++) {
      const x = VW / 2 - 165 + i * 56;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      roundRect(ctx, x, 150, 48, 60, 8);
      ctx.fill();
      if (i === this.code.length && !this.net && (this.t >> 4) % 2 === 0) {
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(x + 10, 200, 28, 3);
      }
      text(ctx, this.code[i] ?? '', x + 24, 195, 36, '#fff', 'center');
    }
    const n = this.net;
    if (!n) {
      text(ctx, this.code.length === CODE_LENGTH ? '按 Enter 連線' : '直接用鍵盤輸入英文字母與數字，Backspace 刪除', VW / 2, 260, 15, '#fff', 'center', false);
    } else if (n.status === 'error' || n.status === 'closed') {
      text(ctx, n.error || '連線已中斷', VW / 2, 260, 15, '#ff8a8a', 'center');
      text(ctx, '按 Enter 重新輸入', VW / 2, 290, 14, '#fff', 'center', false);
    } else {
      const dots = '.'.repeat(1 + ((this.t >> 4) % 3));
      text(ctx, `連線中${dots}`, VW / 2, 270, 20, '#ffd23f', 'center');
    }
    hint(ctx, 'Esc 返回');
  }
}

// ---------------- 連線選角 ----------------
interface OnlineOption {
  label: string;
  mode: 'versus' | 'campaign';
  stageId?: string;
  difficulty?: Difficulty;
}

export function onlineOptions(app: App): OnlineOption[] {
  const d = app.data;
  const out: OnlineOption[] = d.stageOrder.map((id) => ({ label: `對戰・${d.stages[id].name}`, mode: 'versus', stageId: id }));
  for (const diff of ['easy', 'normal', 'hard'] as Difficulty[])
    out.push({ label: `合作闖關・${d.campaignDifficulty[diff].label}`, mode: 'campaign', difficulty: diff });
  return out;
}

export class OnlineSelectScene extends Scene {
  readonly tag = 'online-select';
  private t = 0;
  private myChar: number;
  private myReady = false;
  private oppChar = 0;
  private oppReady = false;
  private opt = 0;

  constructor(
    app: App,
    private net: NetSession,
  ) {
    super(app);
    this.myChar = net.mySlot;
    this.oppChar = 1 - net.mySlot;
    this.sendSel();
  }

  /** 從結算回到選角 */
  reset(): void {
    this.myReady = false;
    this.oppReady = false;
    this.sendSel();
  }

  private sendSel(): void {
    this.net.send({ type: 'sel', charIdx: this.myChar, ready: this.myReady });
  }

  update(inp: MenuInput): void {
    this.t++;
    const n = this.app.data.selectable.length;
    for (const m of this.net.drain()) {
      if (m.type === 'sel') {
        this.oppChar = m.charIdx;
        this.oppReady = m.ready;
      } else if (m.type === 'cfg') this.opt = m.opt;
      else if (m.type === 'start') this.app.scenes.push(new BattleScene(this.app, m.setup, this.net));
    }
    if (this.net.status !== 'open') return;
    const k = localPressed(inp);
    const isHost = this.net.role === 'host';
    if (!this.myReady) {
      let changed = false;
      if (k.left) (this.myChar = (this.myChar + n - 1) % n), (changed = true);
      if (k.right) (this.myChar = (this.myChar + 1) % n), (changed = true);
      if (k.J || k.A) (this.myReady = true), (changed = true), this.app.sfx.play('special');
      if (isHost && (k.up || k.down)) {
        const opts = onlineOptions(this.app).length;
        this.opt = (this.opt + (k.down ? 1 : opts - 1)) % opts;
        this.net.send({ type: 'cfg', opt: this.opt });
      }
      if (changed) this.sendSel();
    } else if (k.D) {
      this.myReady = false;
      this.sendSel();
    }
    if (isHost && this.myReady && this.oppReady) this.start();
  }

  private start(): void {
    const o = onlineOptions(this.app)[this.opt];
    const ids = this.app.data.selectable;
    const setup: MatchSetup = {
      mode: o.mode,
      stageId: o.mode === 'campaign' ? this.app.data.campaign[0].stage : o.stageId!,
      seed: (Date.now() ^ (performance.now() * 1000)) >>> 0,
      campaignIndex: 0,
      campaignDifficulty: o.difficulty,
      players: [
        { slot: 0, charId: ids[this.myChar % ids.length], team: 0, controller: 'human', difficulty: 'normal' },
        { slot: 1, charId: ids[this.oppChar % ids.length], team: 0, controller: 'human', difficulty: 'normal' },
      ],
    };
    const epoch = this.net.epoch + 1;
    const delay = this.net.suggestDelay();
    this.net.beginMatch(epoch, delay);
    this.net.send({ type: 'start', setup, epoch, delay });
    this.myReady = false;
    this.oppReady = false;
    this.app.scenes.push(new BattleScene(this.app, setup, this.net));
  }

  onEscape(): void {
    leaveOnline(this.app, this.net);
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t, '#16213e', '#0f3460');
    const n = this.net;
    text(ctx, '連線選角', VW / 2, 34, 24, '#ffd23f', 'center', true, true);
    text(ctx, `房間 ${n.code}　·　延遲 ${Math.round(n.rtt)} ms`, VW / 2, 56, 12, '#cbd5e1', 'center', false);
    const ids = this.app.data.selectable;
    const cols: [string, number, boolean, number][] = [
      [`你（${n.mySlot + 1}P）`, this.myChar, this.myReady, n.mySlot],
      [`對手（${2 - n.mySlot}P）`, this.oppChar, this.oppReady, 1 - n.mySlot],
    ];
    cols.forEach(([label, ci, ready, slot], i) => {
      const x = 90 + i * 330;
      const y = 70;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(ctx, x, y, 290, 250, 10);
      ctx.fill();
      ctx.strokeStyle = ready ? '#ffd23f' : SLOT_COLORS[slot];
      ctx.lineWidth = ready ? 4 : 2;
      ctx.stroke();
      text(ctx, label, x + 145, y + 24, 16, SLOT_COLORS[slot], 'center');
      const def = this.app.data.characters[ids[ci % ids.length]];
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 65, y + 34, 160, 130);
      ctx.clip();
      ctx.fillStyle = shade(def.palette.accent, -0.55);
      ctx.fillRect(x + 65, y + 34, 160, 130);
      drawFigure(ctx, def, { pose: getPose(ready ? 'victory' : `idle_${(this.t >> 5) % 2}`), x: x + 145, y: y + 214, facing: 1, scale: 2, tick: this.t, upperOnly: true });
      ctx.restore();
      if (i === 0 && !ready) {
        text(ctx, '◀', x + 45, y + 108, 20, '#fff', 'center');
        text(ctx, '▶', x + 245, y + 108, 20, '#fff', 'center');
      }
      text(ctx, def.name, x + 145, y + 190, 20, '#fff', 'center');
      text(ctx, def.title, x + 145, y + 210, 13, def.palette.accent, 'center');
      text(ctx, ready ? '準備完成！' : i === 0 ? '←→ 選角　跳躍 確定' : '選擇中…', x + 145, y + 238, 14, ready ? '#ffd23f' : '#fff', 'center');
    });
    const o = onlineOptions(this.app)[this.opt];
    const isHost = n.role === 'host';
    button(ctx, isHost && !this.myReady ? `▲ ${o.label} ▼` : o.label, VW / 2, 336, 360, isHost && !this.myReady);
    text(ctx, isHost ? '你是房主：↑↓ 選擇模式 / 場地 / 闖關難度' : '模式由房主選擇', VW / 2, 390, 12, '#cbd5e1', 'center', false);
    if (n.status !== 'open') text(ctx, n.error || '對手已離線，按 Esc 返回標題', VW / 2, 412, 15, '#ff8a8a', 'center');
    hint(ctx, '兩人都按「確定」後自動開始　·　防禦 取消確定　·　Esc 離開連線');
  }
}
