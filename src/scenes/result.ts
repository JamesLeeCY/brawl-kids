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
import { hint, menuBackground } from './ui';

const VW = CONFIG.view.width;

export class ResultScene extends Scene {
  private t = 0;
  private winners: Entity[];
  private players: Entity[];
  private title: string;

  constructor(
    app: App,
    private setup: MatchSetup,
    private world: World,
    res: MatchResult,
    private net: NetSession | null = null,
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
    if (this.net) {
      this.updateNet(inp);
      return;
    }
    if (this.t < 30) return;
    if (inp.any.A) {
      const s = { ...this.setup, seed: (this.setup.seed * 1664525 + 1013904223) >>> 0, carry: undefined };
      if (s.mode === 'campaign') {
        s.campaignIndex = 0;
        s.stageId = this.app.data.campaign[0].stage;
      }
      this.app.scenes.replace(new BattleScene(this.app, s));
    } else if (inp.any.D) backToSelect(this.app);
  }

  private updateNet(inp: MenuInput): void {
    const net = this.net!;
    for (const { msg: m } of net.drain()) {
      if (m.type === 'rematch') {
        this.app.scenes.replace(new BattleScene(this.app, m.setup, net));
        return;
      }
      if (m.type === 'lobby') {
        this.toOnlineSelect();
        return;
      }
    }
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
      if (s.mode === 'campaign') {
        s.campaignIndex = 0;
        s.stageId = this.app.data.campaign[0].stage;
      }
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
    if (!this.net) hint(ctx, '攻擊 / Enter：再來一場　防禦 / Esc：回選角');
    else if (this.net.status !== 'open') hint(ctx, '對手已離線　·　按 攻擊 回到標題');
    else if (this.net.role === 'host') hint(ctx, '攻擊 / Enter：再來一場　防禦：回連線選角　Esc：離開連線');
    else hint(ctx, '等待房主決定：再來一場或回連線選角…　Esc：離開連線');
  }
}
