// 連線大廳（最多 4 人）：建立 / 加入房間、連線選角。
import { CONFIG, type Difficulty } from '../config';
import { dataVersion } from '../data';
import { SLOT_COLORS } from '../render/battle';
import { drawFigure, roundRect, shade } from '../render/character';
import { getPose } from '../render/poses';
import { text } from '../render/text';
import { CODE_LENGTH, MAX_SLOTS, NetSession, isValidCodeChar, shareUrl, type LobbySlot, type Step } from '../net/session';
import { ensureLatest, isStale } from '../version';
import { emptySnapshot, type Snapshot } from '../sim/snapshot';
import type { MatchSetup } from '../sim/world';
import { BattleScene } from './battle';
import { Scene, type App, type MenuInput } from './scene';
import { drawCharGrid, gridCols, gridHit, gridSize, moveGridCursor, type GridCursor } from './charGrid';
import { DIFF_LABEL, TEAM_LABEL, moveLabel, touchMode } from './select';
import { button, hint, menuBackground } from './ui';
import { ROUTES, randomCampaignRoute } from './campaign';
import { DEFAULT_CAMPAIGN_LENGTH, defaultCampaignRoute } from '../sim/world';

const VW = CONFIG.view.width;
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
/** 連線選角版面：上方頭像格、中間四張角色卡、下方模式按鈕 */
const GRID_Y = 6;
const CARD_Y = 136;
const CARD_H = 204;
const MODE_Y = 346;

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
  net: NetSession | null = null;
  private t = 0;
  private cancelled = false;

  constructor(app: App) {
    super(app);
    // 先確認是最新版（舊版房間朋友連不進來），再建立房間
    void ensureLatest().then((reloading) => {
      if (!reloading && !this.cancelled) this.net = NetSession.host(dataVersion());
    });
  }

  update(): void {
    this.t++;
    if (this.net?.status === 'open') this.app.scenes.replace(new OnlineSelectScene(this.app, this.net));
  }

  onEscape(): void {
    this.cancelled = true;
    this.net?.close();
    this.app.scenes.pop();
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t, '#0b2545', '#13315c');
    text(ctx, '建立房間', VW / 2, 70, 30, '#ffd23f', 'center', true, true);
    if (!this.net) text(ctx, '檢查遊戲版本…', VW / 2, 200, 18, '#fff', 'center');
    else if (this.net.status === 'error') {
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

  private checking = false;

  private connect(): void {
    if (this.checking) return;
    this.checking = true;
    const code = this.code;
    // 先確認是最新版；若是舊版會自動更新並帶著房間代碼回來
    void ensureLatest({ room: code }).then((reloading) => {
      this.checking = false;
      if (!reloading && this.app.scenes.top === this && this.code === code) this.net = NetSession.join(code, dataVersion());
    });
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

  /** 手機沒有實體鍵盤：點畫面跳出輸入框 */
  onClick(): void {
    if (this.net && this.net.status !== 'error' && this.net.status !== 'closed') return;
    const v = window.prompt('輸入 6 碼房間代碼', this.code);
    if (v === null) return;
    this.net = null;
    this.code = [...v.toUpperCase()].filter(isValidCodeChar).join('').slice(0, CODE_LENGTH);
    if (this.code.length === CODE_LENGTH) this.connect();
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
    if (!n && this.checking) {
      text(ctx, '檢查遊戲版本…', VW / 2, 270, 18, '#fff', 'center');
    } else if (!n) {
      text(ctx, this.code.length === CODE_LENGTH ? '按 Enter 連線' : '直接用鍵盤輸入英文字母與數字，Backspace 刪除', VW / 2, 260, 15, '#fff', 'center', false);
      text(ctx, '手機 / 平板：點一下畫面輸入代碼', VW / 2, 286, 13, '#cbd5e1', 'center', false);
    } else if (n.status === 'error' || n.status === 'closed') {
      text(ctx, n.error || '連線已中斷', VW / 2, 260, 15, '#ff8a8a', 'center');
      text(ctx, '按 Enter 重新輸入（手機：點一下畫面）', VW / 2, 290, 14, '#fff', 'center', false);
      this.renderDiag(ctx, n);
    } else {
      const dots = '.'.repeat(1 + ((this.t >> 4) % 3));
      text(ctx, `連線中${dots}`, VW / 2, 270, 20, '#ffd23f', 'center');
      const d = n.diag;
      let sub = '';
      if (d.hostSeen) sub = '找到房主了，正在建立連線…';
      else if (d.relay > 0 && this.t > 600) sub = '已連上中繼伺服器，等待房主回應…（請房主回到遊戲畫面）';
      else if (this.t > 360) sub = '直連較慢，正在改用中繼伺服器…';
      if (sub) text(ctx, sub, VW / 2, 298, 13, '#cbd5e1', 'center', false);
      this.renderDiag(ctx, n);
    }
    hint(ctx, 'Esc 返回');
  }

  /** 各連線步驟的狀態：連不上時看得出卡在哪一步 */
  private renderDiag(ctx: CanvasRenderingContext2D, n: NetSession): void {
    const d = n.diag;
    const mark = (s: Step) => (s === 'ok' ? '✓' : s === 'fail' ? '✗' : s === 'skip' ? '略過' : '…');
    const relay = d.relay ? `${d.relay} 個 ✓` : d.relayFail ? '✗' : '…';
    const line = `配對伺服器 ${mark(d.peer)}　·　直連 ${mark(d.p2p)}　·　中繼伺服器 ${relay}　·　房主在線 ${d.hostSeen || d.host ? '✓' : '…'}　·　房主回應 ${d.host ? '✓' : '…'}`;
    text(ctx, line, VW / 2, 330, 12, '#94a3b8', 'center', false);
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
  /** 合作闖關的場景路線（ROUTES 的索引）與自選的各關場景（房主設定，同步給大家） */
  private routeIdx = 0;
  /** 合作闖關的關數 */
  private len = DEFAULT_CAMPAIGN_LENGTH;
  private stages: string[];
  /** 房主設定闖關場景時的游標：0 = 路線，1… = 第幾關；-1 表示未在編輯 */
  private routeCursor = -1;
  private warn = 0;
  private copied = 0;
  /** 房主等人時發現網站有新版本（舊版房間新版的朋友連不進來） */
  private newVersion = false;
  private dirty = true;
  /** 房主的游標在「模式」按鈕上（從頭像格最下列再按 ↓） */
  private onMode = false;

  constructor(
    app: App,
    private net: NetSession,
  ) {
    super(app);
    this.stages = defaultCampaignRoute(app.data, this.len);
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
    this.routeCursor = -1;
    this.onMode = false;
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
    if (this.isHost && this.t % 3600 === 1800) void isStale().then((v) => (this.newVersion = v));
    this.handleMessages();
    if (this.net.status !== 'open') return;
    const k = localPressed(inp);
    if (this.isHost && this.routeCursor >= 0) this.updateRouteEdit(k);
    else if (this.isHost && this.aiCursor >= 0) this.updateAiEdit(k);
    else this.updateSelf(k);
    if (this.isHost) {
      if (this.dirty || this.t % 60 === 0) {
        this.dirty = false;
        this.net.broadcast({ type: 'lobbystate', slots: this.slots, opt: this.opt, route: this.routeIdx, stages: this.stages, len: this.len });
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
            if (msg.route !== undefined) this.routeIdx = msg.route;
            if (msg.stages) this.stages = [...msg.stages];
            if (msg.len !== undefined) this.len = msg.len;
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
    const campaign = onlineOptions(this.app)[this.opt].mode === 'campaign';
    if (!me.ready) {
      if (this.isHost && this.onMode) {
        // 模式按鈕：←→ 切換、↑↓ 回到頭像格
        const step = k.left ? -1 : k.right ? 1 : 0;
        const len = onlineOptions(this.app).length;
        if (step) (this.opt = (this.opt + len + step) % len), (this.dirty = true);
        if (k.up || k.down) this.onMode = false;
      } else if (this.isHost && k.down && me.charIdx + gridCols(n) >= n) this.onMode = true;
      else {
        const nx = moveGridCursor(me.charIdx, k, n);
        if (nx !== me.charIdx) (me.charIdx = nx), this.changed();
      }
      // 跳躍：對戰換隊；合作闖關不分隊，房主改成打開闖關場景設定
      if (k.J && campaign && this.isHost) this.routeCursor = 0;
      else if (k.J && !campaign) (me.team = (me.team + 1) % 5), this.changed();
      if (k.A) {
        me.ready = true;
        this.onMode = false;
        this.app.sfx.play('special');
        this.changed();
        return;
      }
    } else {
      if (k.D) {
        me.ready = false;
        this.changed();
      }
      if (this.isHost && (k.left || k.right)) this.aiCursor = this.nextAiSlot(0, 1);
      // 合作闖關：↑↓ 打開闖關場景設定
      if (this.isHost && (k.up || k.down) && campaign) this.routeCursor = 0;
    }
    if (this.isHost && k.A && me.ready) this.share();
  }

  onClick(x: number, y: number): void {
    const n = this.app.data.selectable.length;
    const i = gridHit(x, y, this.gridX, GRID_Y, n);
    if (i < 0 || this.routeCursor >= 0 || this.net.status !== 'open') return;
    // 點頭像：房主設定電腦時換該電腦的角色，否則換自己的角色
    if (this.aiCursor >= 0) {
      const s = this.slots[this.aiCursor];
      if (s.kind === 'ai') (s.charIdx = i), (this.dirty = true);
    } else if (!this.me.ready) {
      this.me.charIdx = i;
      this.onMode = false;
      this.changed();
    }
  }

  private get gridX(): number {
    return (VW - gridSize(this.app.data.selectable.length).w) / 2;
  }

  private share(): void {
    const url = shareUrl(this.net.code);
    if (navigator.share && navigator.maxTouchPoints > 0) {
      navigator.share({ title: '台灣大亂鬥', text: `一起來打！房間代碼 ${this.net.code}`, url }).catch(() => undefined);
      return;
    }
    navigator.clipboard?.writeText(url).then(
      () => (this.copied = 120),
      () => (this.copied = -1),
    );
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
    this.dirty = true;
    // 空欄位：←→ 換欄位、攻擊加入、防禦完成；電腦欄位：方向鍵在頭像格選角、防禦換下一個欄位（沒有就完成）
    if (s.kind === 'empty') {
      if (k.right) {
        const nx = this.nextAiSlot(this.aiCursor, 1);
        if (nx >= 0) this.aiCursor = nx;
      }
      if (k.left) this.aiCursor = this.nextAiSlot(this.aiCursor, -1);
      if (k.D) this.aiCursor = -1;
      if (this.aiCursor >= 0 && this.slots[this.aiCursor] === s && k.A) Object.assign(s, { kind: 'ai', difficulty: 'easy', ready: true });
      return;
    }
    if (k.D) {
      this.aiCursor = this.nextAiSlot(this.aiCursor, 1);
      return;
    }
    s.charIdx = moveGridCursor(s.charIdx, k, this.app.data.selectable.length);
    if (k.J) s.team = (s.team + 1) % 5;
    if (k.A) {
      const i = DIFFS.indexOf(s.difficulty);
      if (i === DIFFS.length - 1) Object.assign(s, emptySlot(this.aiCursor));
      else s.difficulty = DIFFS[i + 1];
    }
  }

  private get route(): (typeof ROUTES)[number]['id'] {
    return ROUTES[this.routeIdx].id;
  }

  /** 房主設定闖關場景：第 0 列關卡數、第 1 列路線，自選時第 2… 列換各關場景 */
  private updateRouteEdit(k: Snapshot): void {
    const rows = 2 + (this.route === 'custom' ? this.stages.length : 0);
    if (k.up) this.routeCursor = (this.routeCursor + rows - 1) % rows;
    if (k.down) this.routeCursor = (this.routeCursor + 1) % rows;
    const step = k.left ? -1 : k.right ? 1 : 0;
    if (step && this.routeCursor === 0) {
      this.len = Math.max(1, Math.min(this.app.data.campaign.length, this.len + step));
      this.stages = defaultCampaignRoute(this.app.data, this.len);
    } else if (step && this.routeCursor === 1) this.routeIdx = (this.routeIdx + ROUTES.length + step) % ROUTES.length;
    else if (step) {
      const order = this.app.data.stageOrder;
      const i = this.routeCursor - 2;
      this.stages[i] = order[(order.indexOf(this.stages[i]) + order.length + step) % order.length];
    }
    if (k.D || k.J) this.routeCursor = -1;
    this.dirty = true;
  }

  private tryStart(): void {
    if (this.aiCursor >= 0 || this.routeCursor >= 0) return;
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
    const route = o.mode === 'campaign' ? this.route : undefined;
    const campaignStages = route === 'random' ? randomCampaignRoute(this.app, this.len) : route === 'custom' ? [...this.stages] : undefined;
    const setup: MatchSetup = {
      mode: o.mode,
      stageId: o.mode === 'campaign' ? (campaignStages?.[0] ?? this.stages[0]) : o.stageId!,
      campaignLength: o.mode === 'campaign' ? this.len : undefined,
      campaignStages,
      campaignRoute: route,
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
    if (this.routeCursor >= 0) {
      this.routeCursor = -1;
      return;
    }
    if (this.aiCursor >= 0) {
      this.aiCursor = -1;
      return;
    }
    leaveOnline(this.app, this.net);
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t, '#16213e', '#0f3460');
    const n = this.net;
    const ids = this.app.data.selectable;
    const gx = this.gridX;
    // 頭像格左側：標題與房間資訊；右側：分享連結
    text(ctx, '連線選角', gx / 2, 32, 22, '#ffd23f', 'center', true, true);
    text(ctx, `房間 ${n.code}`, gx / 2, 58, 18, '#fff', 'center', true, true);
    const ping = n.role === 'host' ? `最慢延遲 ${Math.round(n.rtt)} ms` : `延遲 ${Math.round(n.rtt)} ms`;
    text(ctx, `${n.transportLabel()}　·　${ping}`, gx / 2, 80, 11, '#cbd5e1', 'center', false);
    if (this.isHost) text(ctx, `中繼伺服器 ${n.relayUp()}`, gx / 2, 96, 11, '#cbd5e1', 'center', false);
    const url = shareUrl(n.code);
    const q = url.indexOf('?');
    const rx = VW - gx / 2;
    text(ctx, '分享連結', rx, 40, 13, '#ffd23f', 'center');
    text(ctx, q > 0 ? url.slice(0, q) : url, rx, 60, 10, '#cbd5e1', 'center', false);
    if (q > 0) text(ctx, url.slice(q), rx, 75, 10, '#cbd5e1', 'center', false);
    const cursors: GridCursor[] = [];
    this.slots.forEach((s, i) => {
      if (s.kind === 'empty') return;
      const label = s.kind === 'ai' ? 'COM' : `${i + 1}P`;
      cursors.push({ idx: s.charIdx, slot: i, color: SLOT_COLORS[i], label, locked: s.kind === 'ai' ? this.aiCursor !== i : s.ready });
    });
    drawCharGrid(ctx, ids.map((id) => this.app.data.characters[id]), gx, GRID_Y, cursors, this.t);
    const o = onlineOptions(this.app)[this.opt];
    const touch = touchMode();
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = this.slots[i];
      const x = i * 200 + 6;
      const y = CARD_Y;
      const mine = i === n.mySlot;
      const editing = this.aiCursor === i;
      ctx.fillStyle = s.kind === 'empty' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.35)';
      roundRect(ctx, x, y, 188, CARD_H, 10);
      ctx.fill();
      ctx.strokeStyle = editing ? '#fff' : s.ready ? '#ffd23f' : SLOT_COLORS[i];
      ctx.lineWidth = editing || s.ready || mine ? 4 : 2;
      ctx.stroke();
      const label = s.kind === 'ai' ? `COM（${DIFF_LABEL[s.difficulty]}）` : s.kind === 'human' ? `${i + 1}P${mine ? '（你）' : i === 0 ? '（房主）' : ''}` : `${i + 1}P`;
      text(ctx, label, x + 94, y + 19, 15, SLOT_COLORS[i], 'center');
      if (s.kind === 'empty') {
        text(ctx, '等待玩家加入…', x + 94, y + 96, 14, 'rgba(255,255,255,0.7)', 'center');
        if (this.isHost) text(ctx, '（房主可設為電腦）', x + 94, y + 120, 11, 'rgba(255,255,255,0.5)', 'center', false);
        if (editing) text(ctx, '攻擊：加入電腦', x + 94, y + 156, 13, '#fff', 'center');
        continue;
      }
      const def = this.app.data.characters[ids[s.charIdx % ids.length]];
      // 左：大頭像；右：名字、稱號、隊伍、狀態；下：招式表
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 8, y + 26, 86, 100);
      ctx.clip();
      ctx.fillStyle = shade(def.palette.accent, -0.55);
      ctx.fillRect(x + 8, y + 26, 86, 100);
      drawFigure(ctx, def, { pose: getPose(s.ready ? 'victory' : `idle_${(this.t >> 5) % 2}`), x: x + 51, y: y + 150, facing: 1, scale: 1.45, tick: this.t, upperOnly: true, sticker: true, expression: s.ready ? 'happy' : 'normal' });
      ctx.restore();
      text(ctx, def.name, x + 141, y + 52, 17, '#fff', 'center');
      text(ctx, def.title, x + 141, y + 72, 12, def.palette.accent, 'center');
      if (o.mode === 'versus') text(ctx, `隊伍：${TEAM_LABEL[s.team]}`, x + 141, y + 96, 13, '#fff', 'center');
      if (s.ready) text(ctx, s.kind === 'ai' ? '電腦' : '準備完成！', x + 141, y + 120, 13, '#ffd23f', 'center');
      const fs = touch ? 10 : 9;
      def.moves.forEach((m, mi) => text(ctx, `${moveLabel(m.command)} ${m.name}`, x + 8 + (mi % 2) * 90, y + 144 + Math.floor(mi / 2) * 14, fs, 'rgba(255,255,255,0.8)', 'left', false));
      if (editing) text(ctx, '方向鍵選角 跳躍換隊 攻擊改難度', x + 94, y + CARD_H - 6, 10, '#fff', 'center');
    }
    const modeLabel = o.mode === 'campaign' ? `${o.label}・${this.len} 關・${ROUTES[this.routeIdx].label}` : o.label;
    const hostPick = this.isHost && !this.me.ready;
    button(ctx, hostPick ? `模式：${modeLabel}（${this.onMode ? '←→ 切換' : '↓ 到這裡切換'}）` : `模式：${modeLabel}`, VW / 2, MODE_Y, 460, hostPick && this.onMode);
    if (this.routeCursor >= 0) this.renderRouteEditor(ctx);
    const DIR = touch ? '搖桿' : '方向鍵';
    let h1: string;
    const lost = n.lostSlots();
    if (n.status !== 'open') h1 = n.error || '與房主的連線已中斷，按 Esc 返回標題';
    else if (n.reconnecting) h1 = '連線不穩，正在重新連線…';
    else if (lost.length) h1 = `${lost.map((s) => `${s + 1}P`).join('、')} 連線中斷，等待重新連線…`;
    else if (this.warn > 0) h1 = '對戰至少需要兩隊！請調整隊伍或加入電腦。';
    else if (this.copied > 0) h1 = '✓ 已複製分享連結';
    else if (this.aiCursor >= 0) h1 = `設定電腦：攻擊 加入/改難度/移除　${DIR} 在頭像格選角　跳躍 換隊　防禦 下一個欄位（沒有就完成）`;
    else if (this.routeCursor >= 0) h1 = '闖關場景：↑↓ 選擇　←→ 切換　跳躍 / 防禦 完成';
    else if (this.isHost && this.me.ready && o.mode === 'campaign') h1 = '已確定：← / → 設定電腦　↑ / ↓ 闖關場景　攻擊 複製分享連結　防禦 取消';
    else if (this.isHost && this.me.ready) h1 = '已確定：← / → 設定電腦　攻擊 複製分享連結　防禦 取消';
    else if (this.isHost && this.onMode) h1 = '模式：←→ 切換　↑ 回到頭像格　攻擊 確定';
    else if (this.isHost && o.mode === 'campaign') h1 = `${DIR} 在頭像格選角（最下列再按 ↓ 切換模式）　跳躍 闖關場景　攻擊 確定`;
    else if (this.isHost) h1 = `${DIR} 在頭像格選角（最下列再按 ↓ 切換模式）　跳躍 換隊伍　攻擊 確定`;
    else if (o.mode === 'campaign') h1 = `${DIR} 在頭像格選角　攻擊 確定`;
    else h1 = `${DIR} 在頭像格選角　跳躍 換隊伍　攻擊 確定`;
    text(ctx, h1, VW / 2, 404, 12, n.status !== 'open' || n.reconnecting || lost.length || this.warn > 0 ? '#ff8a8a' : '#fff', 'center', false);
    if (this.isHost && this.newVersion) hint(ctx, '網站已更新：請按 Esc 離開，重新整理網頁後再建立房間（舊版房間朋友連不進來）');
    else if (this.isHost && n.guestSlots().length === 0) hint(ctx, '分享連結後請回到這個畫面等朋友加入（停在別的 App 時朋友連不進來）　·　Esc 離開連線');
    else if (o.mode === 'campaign' && this.route === 'custom') hint(ctx, `闖關場景：${this.stages.map((id) => this.app.data.stages[id]?.name ?? id).join(' → ')}`);
    else hint(ctx, `所有玩家都確定後由房主開始　·　${touch ? '也可直接點頭像選角' : 'Esc 離開連線'}`);
  }

  /** 房主設定闖關場景的面板 */
  private renderRouteEditor(ctx: CanvasRenderingContext2D): void {
    const custom = this.route === 'custom';
    const n = this.stages.length;
    const twoCols = n > 5;
    const listRows = custom ? (twoCols ? Math.ceil(n / 2) : n) : 0;
    const w = twoCols ? 640 : 480;
    const h = 136 + listRows * 24;
    const y0 = 70;
    ctx.fillStyle = 'rgba(8,12,30,0.95)';
    roundRect(ctx, VW / 2 - w / 2, y0, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 3;
    ctx.stroke();
    text(ctx, '闖關設定', VW / 2, y0 + 28, 20, '#ffd23f', 'center', true);
    const rowText = (sel: boolean, s: string, x: number, y: number, size = 16) => text(ctx, sel ? `◀ ${s} ▶` : s, x, y, size, sel ? '#ffd23f' : '#fff', 'center');
    rowText(this.routeCursor === 0, `關卡數：${this.len}（最後一關有頭目）`, VW / 2, y0 + 58);
    const r = ROUTES[this.routeIdx];
    rowText(this.routeCursor === 1, `場景：${r.label}`, VW / 2, y0 + 86);
    text(ctx, custom ? '↓ 選關卡、←→ 換場景（各關敵人與難度不變）' : r.desc, VW / 2, y0 + 110, 12, '#cbd5e1', 'center', false);
    if (!custom) return;
    this.stages.forEach((id, i) => {
      const col = twoCols ? Math.floor(i / listRows) : 0;
      const rr = twoCols ? i % listRows : i;
      const x = twoCols ? VW / 2 + (col === 0 ? -160 : 160) : VW / 2;
      const name = this.app.data.stages[id]?.name ?? id;
      const last = i === n - 1 ? '（頭目）' : '';
      rowText(this.routeCursor === i + 2, `第 ${i + 1} 關　${name}${last}`, x, y0 + 138 + rr * 24, 14);
    });
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
