// 連線大廳（最多 4 人）：建立 / 加入房間、連線選角。
import { CONFIG, type Difficulty } from '../config';
import { dataVersion } from '../data';
import { SLOT_COLORS } from '../render/battle';
import { drawFigure, roundRect, shade } from '../render/character';
import { getPose } from '../render/poses';
import { text } from '../render/text';
import { CODE_LENGTH, MAX_SLOTS, NetSession, isValidCodeChar, shareUrl, type LobbySlot } from '../net/session';
import { emptySnapshot, type Snapshot } from '../sim/snapshot';
import type { MatchSetup } from '../sim/world';
import { BattleScene } from './battle';
import { Scene, type App, type MenuInput } from './scene';
import { DIFF_LABEL, TEAM_LABEL, moveLabel } from './select';
import { button, hint, menuBackground } from './ui';

const VW = CONFIG.view.width;
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

/** 連線時本機玩家可用 1P 或 2P 任一組按鍵 */
export function localPressed(inp: MenuInput): Snapshot {
  const s = emptySnapshot();
  for (const p of inp.pressed) for (const k of Object.keys(s) as (keyof Snapshot)[]) s[k] = s[k] || p[k];
  if (inp.codes.includes('Enter')) s.A = true;
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
    text(ctx, '最多 4 人、各自一台電腦，透過網址連線一起玩', VW / 2, 125, 14, '#cbd5e1', 'center', false);
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

  constructor(app: App) {
    super(app);
    this.net = NetSession.host(dataVersion());
  }

  update(): void {
    this.t++;
    if (this.net.status === 'open') this.app.scenes.replace(new OnlineSelectScene(this.app, this.net));
  }

  onEscape(): void {
    this.net.close();
    this.app.scenes.pop();
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t, '#0b2545', '#13315c');
    text(ctx, '建立房間', VW / 2, 70, 30, '#ffd23f', 'center', true, true);
    if (this.net.status === 'error') {
      text(ctx, this.net.error, VW / 2, 200, 16, '#ff8a8a', 'center');
      text(ctx, '按 Esc 返回', VW / 2, 240, 14, '#fff', 'center', false);
    } else text(ctx, '正在向配對伺服器登記房間…', VW / 2, 200, 18, '#fff', 'center');
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

// ---------------- 連線選角（4 欄位） ----------------
interface OnlineOption {
  label: string;
  mode: 'versus' | 'campaign';
  stageId?: string;
  difficulty?: Difficulty;
}

export function onlineOptions(app: App): OnlineOption[] {
  const d = app.data;
  const out: OnlineOption[] = d.stageOrder.map((id) => ({ label: `對戰・${d.stages[id].name}`, mode: 'versus', stageId: id }));
  for (const diff of DIFFS) out.push({ label: `合作闖關・${d.campaignDifficulty[diff].label}`, mode: 'campaign', difficulty: diff });
  return out;
}

function emptySlot(i: number): LobbySlot {
  return { kind: 'empty', charIdx: i, team: 0, ready: false, difficulty: 'normal' };
}

export class OnlineSelectScene extends Scene {
  readonly tag = 'online-select';
  private t = 0;
  private slots: LobbySlot[];
  private opt = 0;
  /** 房主設定電腦欄位時的游標；-1 表示未在編輯 */
  private aiCursor = -1;
  private warn = 0;
  private copied = 0;
  private dirty = true;

  constructor(
    app: App,
    private net: NetSession,
  ) {
    super(app);
    this.slots = Array.from({ length: MAX_SLOTS }, (_, i) => emptySlot(i));
    const me = this.slots[net.mySlot];
    me.kind = 'human';
    me.charIdx = net.mySlot % app.data.selectable.length;
    if (net.role === 'host') for (const s of net.guestSlots()) this.slots[s] = { ...emptySlot(s), kind: 'human' };
    else this.sendSel();
  }

  private get isHost(): boolean {
    return this.net.role === 'host';
  }

  private get me(): LobbySlot {
    return this.slots[this.net.mySlot];
  }

  /** 從結算回到選角 */
  reset(): void {
    for (const s of this.slots) s.ready = false;
    this.aiCursor = -1;
    this.dirty = true;
    if (!this.isHost) this.sendSel();
  }

  private sendSel(): void {
    const me = this.me;
    this.net.broadcast({ type: 'sel', charIdx: me.charIdx, team: me.team, ready: me.ready });
  }

  private changed(): void {
    if (this.isHost) this.dirty = true;
    else this.sendSel();
  }

  update(inp: MenuInput): void {
    this.t++;
    if (this.warn > 0) this.warn--;
    if (this.copied > 0) this.copied--;
    this.handleMessages();
    if (this.net.status !== 'open') return;
    const k = localPressed(inp);
    if (this.isHost && this.aiCursor >= 0) this.updateAiEdit(k);
    else this.updateSelf(k);
    if (this.isHost) {
      if (this.dirty || this.t % 60 === 0) {
        this.dirty = false;
        this.net.broadcast({ type: 'lobbystate', slots: this.slots, opt: this.opt });
      }
      this.tryStart();
    }
  }

  private handleMessages(): void {
    for (const { from, msg } of this.net.drain()) {
      switch (msg.type) {
        case 'peer-join':
          this.slots[msg.slot] = { ...emptySlot(msg.slot), kind: 'human', charIdx: msg.slot % this.app.data.selectable.length };
          this.dirty = true;
          break;
        case 'peer-leave':
          this.slots[msg.slot] = emptySlot(msg.slot);
          this.dirty = true;
          break;
        case 'sel':
          if (this.isHost && this.slots[from]?.kind === 'human') {
            Object.assign(this.slots[from], { charIdx: msg.charIdx, team: msg.team, ready: msg.ready });
            this.dirty = true;
          }
          break;
        case 'lobbystate':
          if (!this.isHost) {
            const mine = { ...this.me };
            this.slots = msg.slots.map((s) => ({ ...s }));
            this.slots[this.net.mySlot] = mine;
            this.opt = msg.opt;
          }
          break;
        case 'start':
          this.me.ready = false;
          this.app.scenes.push(new BattleScene(this.app, msg.setup, this.net));
          break;
      }
    }
  }

  private updateSelf(k: Snapshot): void {
    const n = this.app.data.selectable.length;
    const me = this.me;
    if (!me.ready) {
      if (k.left) (me.charIdx = (me.charIdx + n - 1) % n), this.changed();
      if (k.right) (me.charIdx = (me.charIdx + 1) % n), this.changed();
      if (k.up) (me.team = (me.team + 4) % 5), this.changed();
      if (k.down) (me.team = (me.team + 1) % 5), this.changed();
      if (this.isHost && k.A) {
        this.opt = (this.opt + 1) % onlineOptions(this.app).length;
        this.dirty = true;
      }
      if (k.J) {
        me.ready = true;
        this.app.sfx.play('special');
        this.changed();
      }
    } else {
      if (k.D) {
        me.ready = false;
        this.changed();
      }
      if (this.isHost && (k.left || k.right)) this.aiCursor = this.nextAiSlot(0, 1);
    }
    if (this.isHost && k.A && me.ready) {
      const share = shareUrl(this.net.code);
      navigator.clipboard?.writeText(share).then(
        () => (this.copied = 120),
        () => (this.copied = -1),
      );
    }
  }

  private nextAiSlot(from: number, dir: 1 | -1): number {
    for (let i = from + dir; i >= 1 && i < MAX_SLOTS; i += dir) if (this.slots[i].kind !== 'human') return i;
    return -1;
  }

  private updateAiEdit(k: Snapshot): void {
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
    const n = this.app.data.selectable.length;
    if (k.A) {
      if (s.kind === 'empty') {
        s.kind = 'ai';
        s.difficulty = 'easy';
        s.ready = true;
      } else {
        const i = DIFFS.indexOf(s.difficulty);
        if (i === DIFFS.length - 1) Object.assign(s, emptySlot(this.aiCursor));
        else s.difficulty = DIFFS[i + 1];
      }
    }
    if (s.kind === 'ai') {
      if (k.up) s.charIdx = (s.charIdx + n - 1) % n;
      if (k.down) s.charIdx = (s.charIdx + 1) % n;
      if (k.J) s.team = (s.team + 1) % 5;
    }
    this.dirty = true;
  }

  private tryStart(): void {
    if (this.aiCursor >= 0) return;
    const humans = this.slots.filter((s) => s.kind === 'human');
    if (!humans.every((s) => s.ready)) return;
    const o = onlineOptions(this.app)[this.opt];
    const participants = this.slots.map((s, i) => ({ s, i })).filter(({ s }) => s.kind !== 'empty');
    if (o.mode === 'versus') {
      const teams = new Set(participants.map(({ s, i }) => (s.team > 0 ? s.team : 100 + i)));
      if (teams.size < 2) {
        if (this.warn === 0) this.warn = 150;
        return;
      }
    }
    const ids = this.app.data.selectable;
    const setup: MatchSetup = {
      mode: o.mode,
      stageId: o.mode === 'campaign' ? this.app.data.campaign[0].stage : o.stageId!,
      seed: (Date.now() ^ (performance.now() * 1000)) >>> 0,
      campaignIndex: 0,
      campaignDifficulty: o.difficulty,
      players: participants.map(({ s, i }) => ({
        slot: i,
        charId: ids[s.charIdx % ids.length],
        team: s.team,
        controller: s.kind === 'ai' ? ('ai' as const) : ('human' as const),
        difficulty: s.difficulty,
      })),
    };
    startOnlineMatch(this.app, this.net, setup, 'start');
    for (const s of this.slots) if (s.kind === 'human') s.ready = false;
    this.dirty = true;
  }

  onEscape(): void {
    if (this.aiCursor >= 0) {
      this.aiCursor = -1;
      return;
    }
    leaveOnline(this.app, this.net);
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t, '#16213e', '#0f3460');
    const n = this.net;
    text(ctx, '連線選角', VW / 2, 28, 22, '#ffd23f', 'center', true, true);
    const ping = n.role === 'host' ? `最慢延遲 ${Math.round(n.rtt)} ms` : `延遲 ${Math.round(n.rtt)} ms`;
    text(ctx, `房間 ${n.code}　·　${ping}　·　分享：${shareUrl(n.code)}`, VW / 2, 46, 11, '#cbd5e1', 'center', false);
    const ids = this.app.data.selectable;
    const o = onlineOptions(this.app)[this.opt];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = this.slots[i];
      const x = i * 200 + 6;
      const y = 56;
      const mine = i === n.mySlot;
      const editing = this.aiCursor === i;
      ctx.fillStyle = s.kind === 'empty' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.35)';
      roundRect(ctx, x, y, 188, 286, 10);
      ctx.fill();
      ctx.strokeStyle = editing ? '#fff' : s.ready ? '#ffd23f' : SLOT_COLORS[i];
      ctx.lineWidth = editing || s.ready || mine ? 4 : 2;
      ctx.stroke();
      const label = s.kind === 'ai' ? `COM（${DIFF_LABEL[s.difficulty]}）` : s.kind === 'human' ? `${i + 1}P${mine ? '（你）' : i === 0 ? '（房主）' : ''}` : `${i + 1}P`;
      text(ctx, label, x + 94, y + 22, 15, SLOT_COLORS[i], 'center');
      if (s.kind === 'empty') {
        text(ctx, '等待玩家加入…', x + 94, y + 140, 14, 'rgba(255,255,255,0.7)', 'center');
        if (this.isHost) text(ctx, '（房主可設為電腦）', x + 94, y + 164, 11, 'rgba(255,255,255,0.5)', 'center', false);
        if (editing) text(ctx, '攻擊：加入電腦', x + 94, y + 200, 13, '#fff', 'center');
        continue;
      }
      const def = this.app.data.characters[ids[s.charIdx % ids.length]];
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 14, y + 32, 160, 122);
      ctx.clip();
      ctx.fillStyle = shade(def.palette.accent, -0.55);
      ctx.fillRect(x + 14, y + 32, 160, 122);
      drawFigure(ctx, def, { pose: getPose(s.ready ? 'victory' : `idle_${(this.t >> 5) % 2}`), x: x + 94, y: y + 212, facing: 1, scale: 1.8, tick: this.t, upperOnly: true });
      ctx.restore();
      if (mine && !s.ready) {
        text(ctx, '◀', x + 22, y + 98, 18, '#fff', 'center');
        text(ctx, '▶', x + 166, y + 98, 18, '#fff', 'center');
      }
      text(ctx, def.name, x + 94, y + 176, 19, '#fff', 'center');
      text(ctx, def.title, x + 94, y + 194, 12, def.palette.accent, 'center');
      if (o.mode === 'versus') text(ctx, `隊伍：${TEAM_LABEL[s.team]}`, x + 94, y + 214, 13, '#fff', 'center');
      def.moves.forEach((m, mi) => text(ctx, `${moveLabel(m.command)} ${m.name}`, x + 8 + (mi % 2) * 90, y + 232 + Math.floor(mi / 2) * 13, 9, 'rgba(255,255,255,0.75)', 'left', false));
      if (s.ready) text(ctx, s.kind === 'ai' ? '電腦' : '準備完成！', x + 94, y + 278, 13, '#ffd23f', 'center');
    }
    button(ctx, this.isHost && !this.me.ready ? `模式：${o.label}（攻擊切換）` : `模式：${o.label}`, VW / 2, 350, 420, this.isHost && !this.me.ready);
    let h1: string;
    if (n.status !== 'open') h1 = n.error || '與房主的連線已中斷，按 Esc 返回標題';
    else if (this.warn > 0) h1 = '對戰至少需要兩隊！請調整隊伍或加入電腦。';
    else if (this.copied > 0) h1 = '✓ 已複製分享連結';
    else if (this.aiCursor >= 0) h1 = '設定電腦：←→ 選欄位　攻擊 加入/改難度/移除　↑↓ 換角色　跳躍 換隊　防禦 完成';
    else if (this.isHost && this.me.ready) h1 = '已確定：← / → 設定電腦　攻擊 複製分享連結　防禦 取消';
    else h1 = '←→ 選角　↑↓ 選隊伍　跳躍 確定　防禦 取消' + (this.isHost ? '　攻擊 切換模式' : '');
    text(ctx, h1, VW / 2, 404, 12, n.status !== 'open' || this.warn > 0 ? '#ff8a8a' : '#fff', 'center', false);
    hint(ctx, '所有玩家都確定後由房主開始　·　Esc 離開連線');
  }
}

/** 房主：開始新比賽 / 再來一場 */
export function startOnlineMatch(app: App, net: NetSession, setup: MatchSetup, kind: 'start' | 'rematch'): BattleScene {
  const epoch = net.epoch + 1;
  const delay = net.suggestDelay();
  const humans = setup.players.filter((p) => p.controller === 'human').map((p) => p.slot);
  net.beginMatch(epoch, delay, humans);
  net.inMatch = true;
  net.broadcast({ type: kind, setup, epoch, delay });
  const scene = new BattleScene(app, setup, net);
  if (kind === 'start') app.scenes.push(scene);
  else app.scenes.replace(scene);
  return scene;
}
