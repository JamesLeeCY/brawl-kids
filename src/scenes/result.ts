import { CONFIG } from '../config';
import { SLOT_COLORS } from '../render/battle';
import { drawFigure, roundRect } from '../render/character';
import { getPose } from '../render/poses';
import { text } from '../render/text';
import type { Entity } from '../sim/entity';
import { CAMPAIGN_PLAYER_TEAM, type MatchResult, type MatchSetup, type World } from '../sim/world';
import type { NetSession } from '../net/session';
import { BattleScene, backToSelect, backToTitle } from './battle';
import { startOnlineMatch } from './online';
import { Scene, type App, type MenuInput } from './scene';
import { button, hint, menuBackground } from './ui';
import { ReplayScene } from './replay';
import type { Replay } from '../replay/replay';
import { shareReplay } from '../replay/share';
import { resetCampaign } from './campaign';

const VW = CONFIG.view.width;
const VH = CONFIG.view.height;
/** 右上角「觀看重播 / 分享重播」按鈕 */
const REPLAY_BTN = { x: 700, w: 150, y: [16, 60] };

export class ResultScene extends Scene {
  private t = 0;
  private winners: Entity[];
  private players: Entity[];
  private title: string;
  /** 分享重播的結果訊息 */
  private shareMsg: { text: string; t: number } | null = null;
  private sharing = false;

  constructor(
    app: App,
    private setup: MatchSetup,
    private world: World,
    res: MatchResult,
    private net: NetSession | null = null,
    private replay: Replay | null = null,
  ) {
    super(app);
    if (net) net.inMatch = false;
    const chars = world.chars();
    this.players = chars.filter((c) => c.slot >= 0).sort((a, b) => a.slot - b.slot);
    if (setup.mode === 'campaign') {
      this.winners = res.outcome === 'win' ? this.players.filter((c) => c.team === CAMPAIGN_PLAYER_TEAM) : [];
      this.title = res.outcome === 'win' ? '闖關成功！' : '闖關失敗…';
    } else {
      this.winners = res.winnerTeam === null ? [] : chars.filter((c) => c.team === res.winnerTeam && c.slot >= 0);
      this.title = this.winners.length ? '勝利！' : '平手';
    }
  }

  update(inp: MenuInput): void {
    this.t++;
    if (this.shareMsg && --this.shareMsg.t <= 0) this.shareMsg = null;
    if (this.t >= 30 && this.replay) {
      if (inp.pressed.some((p) => p.J)) {
        this.watchReplay();
        return;
      }
      if (inp.pressed.some((p) => p.up)) this.share();
    }
    if (this.net) {
      this.updateNet(inp);
      return;
    }
    if (this.t < 30) return;
    if (inp.any.A) {
      const s = { ...this.setup, seed: (this.setup.seed * 1664525 + 1013904223) >>> 0, carry: undefined };
      if (s.mode === 'campaign') resetCampaign(this.app, s);
      this.app.scenes.replace(new BattleScene(this.app, s));
    } else if (inp.any.D) backToSelect(this.app);
  }

  private watchReplay(): void {
    if (!this.replay) return;
    // 連線時看重播，仍要接收房主的「再來一場 / 回選角」
    const onTick = this.net ? () => void this.pollNet() : undefined;
    this.app.scenes.push(new ReplayScene(this.app, this.replay, { onTick }));
  }

  private share(): void {
    if (!this.replay || this.sharing) return;
    this.sharing = true;
    this.shareMsg = { text: '準備重播連結…', t: 600 };
    shareReplay(this.replay)
      .then(
        (msg) => (this.shareMsg = { text: msg, t: 300 }),
        () => (this.shareMsg = { text: '分享失敗，這個瀏覽器可能不支援', t: 300 }),
      )
      .finally(() => (this.sharing = false));
  }

  /** 處理房主訊息；場景已切換回傳 true */
  private pollNet(): boolean {
    const net = this.net!;
    for (const { msg: m } of net.drain()) {
      if (m.type === 'rematch') {
        // 自己（以及上面可能疊著的重播畫面）換成新的一場
        const st = this.app.scenes.stack;
        const i = st.indexOf(this);
        this.app.scenes.reset([...st.slice(0, i < 0 ? st.length - 1 : i), new BattleScene(this.app, m.setup, net)]);
        return true;
      }
      if (m.type === 'lobby') {
        this.toOnlineSelect();
        return true;
      }
    }
    return false;
  }

  private updateNet(inp: MenuInput): void {
    const net = this.net!;
    if (this.pollNet()) return;
    if (net.status !== 'open') {
      if (inp.any.A || inp.any.D) backToTitle(this.app, net);
      return;
    }
    if (this.t < 30) return;
    // 連線時按鍵：任一組本機按鍵都可
    const a = inp.pressed.some((p) => p.A) || inp.codes.includes('Enter');
    const d = inp.pressed.some((p) => p.D);
    if (a && net.role === 'host') {
      const s: MatchSetup = { ...this.setup, seed: (this.setup.seed * 1664525 + 1013904223) >>> 0, carry: undefined };
      if (s.mode === 'campaign') resetCampaign(this.app, s);
      startOnlineMatch(this.app, net, s, 'rematch');
    } else if (d && net.role === 'host') {
      net.broadcast({ type: 'lobby' });
      this.toOnlineSelect();
    }
  }

  private toOnlineSelect(): void {
    const stack = this.app.scenes.stack;
    const i = stack.findIndex((s) => s.tag === 'online-select');
    if (i < 0) {
      backToTitle(this.app, this.net);
      return;
    }
    this.app.scenes.reset(stack.slice(0, i + 1));
    (stack[i] as unknown as { reset(): void }).reset();
  }

  onClick(x: number, y: number): void {
    if (!this.replay || this.t < 30 || Math.abs(x - REPLAY_BTN.x) > REPLAY_BTN.w / 2) return;
    if (y >= REPLAY_BTN.y[0] && y <= REPLAY_BTN.y[0] + 36) this.watchReplay();
    else if (y >= REPLAY_BTN.y[1] && y <= REPLAY_BTN.y[1] + 36) this.share();
  }

  onEscape(): void {
    if (this.net) {
      backToTitle(this.app, this.net);
      return;
    }
    backToSelect(this.app);
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t, '#1a1a2e', '#3d2c5c');
    text(ctx, this.title, VW / 2, 52, 40, '#ffd23f', 'center', true, true);
    const ws = this.winners;
    ws.forEach((c, i) => {
      const def = this.world.charDef(c);
      const x = VW / 2 + (i - (ws.length - 1) / 2) * 170;
      const pose = getPose(Math.floor(this.t / 25) % 2 ? 'victory' : 'cast_up');
      drawFigure(ctx, def, { pose, x, y: 222, facing: 1, scale: 1.8, tick: this.t, expression: 'happy' });
      text(ctx, def.name, x, 236, 16, '#fff', 'center');
      text(ctx, `「${def.quote}」`, x, 258, 14, def.palette.accent, 'center', true, true);
    });
    if (!ws.length) text(ctx, this.setup.mode === 'campaign' ? '保全機器人守住了陣地…' : '無人存活', VW / 2, 180, 18, '#fff', 'center');

    // 成績表
    const top = 280;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    roundRect(ctx, 100, top, 600, 34 + this.players.length * 24, 8);
    ctx.fill();
    const cols = ['玩家', '角色', '造成傷害', '擊倒數', '被擊倒數'];
    const cx = [150, 270, 420, 530, 630];
    cols.forEach((c, i) => text(ctx, c, cx[i], top + 22, 13, '#ffd23f', 'center'));
    this.players.forEach((p, r) => {
      const y = top + 46 + r * 24;
      const def = this.world.charDef(p);
      text(ctx, p.ai ? `COM ${p.slot + 1}` : `${p.slot + 1}P`, cx[0], y, 14, SLOT_COLORS[p.slot], 'center');
      text(ctx, def.name, cx[1], y, 14, '#fff', 'center');
      text(ctx, `${Math.round(p.stats.damage)}`, cx[2], y, 14, '#fff', 'center');
      text(ctx, `${p.stats.kos}`, cx[3], y, 14, '#fff', 'center');
      text(ctx, `${p.stats.downs}`, cx[4], y, 14, '#fff', 'center');
    });
    if (this.replay) {
      button(ctx, '▶ 觀看重播', REPLAY_BTN.x, REPLAY_BTN.y[0], REPLAY_BTN.w, false);
      button(ctx, '分享重播', REPLAY_BTN.x, REPLAY_BTN.y[1], REPLAY_BTN.w, false);
      if (this.shareMsg) text(ctx, this.shareMsg.text, VW / 2, 92, 14, '#86efac', 'center', true, true);
      hint(ctx, '跳躍 / 點右上：觀看重播　↑：分享重播', VH - 32);
    }
    if (!this.net) hint(ctx, '攻擊 / Enter：再來一場　防禦 / Esc：回選角');
    else if (this.net.status !== 'open') hint(ctx, '對手已離線　·　按 攻擊 回到標題');
    else if (this.net.role === 'host') hint(ctx, '攻擊 / Enter：再來一場　防禦：回連線選角　Esc：離開連線');
    else hint(ctx, '等待房主決定：再來一場或回連線選角…　Esc：離開連線');
  }
}
