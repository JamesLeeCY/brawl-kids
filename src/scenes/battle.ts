import { CONFIG } from '../config';
import { ACTION_LABELS, HUMAN_PLAYERS, keyName } from '../input/keyboard';
import { BattleRenderer } from '../render/battle';
import { roundRect } from '../render/character';
import { text } from '../render/text';
import type { NetSession } from '../net/session';
import { ACTIONS, emptySnapshot, type Snapshot } from '../sim/snapshot';
import { World, type CarryOver, type MatchSetup } from '../sim/world';
import { ResultScene } from './result';
import { moveLabel, touchMode } from './select';
import { Scene, type App, type MenuInput } from './scene';
import { hint, overlay } from './ui';

import { VW, viewOffset } from '../render/view';
import { resetCampaign } from './campaign';
import { campaignStageId } from '../sim/world';
const PAUSE_ITEMS = ['繼續', '重新開始', '回選角', '按鍵說明'];
const NET_MENU_ITEMS = ['繼續', '按鍵說明', '離開連線'];
const HASH_INTERVAL = 120;

export class BattleScene extends Scene {
  readonly wide = true;
  world: World;
  renderer: BattleRenderer;
  private paused = false;
  private pauseSel = 0;
  private showHelp = false;
  private intro = 90;
  /** 連線模式：等待對手按鍵的連續 tick 數 */
  private stall = 0;
  private myHashes = new Map<number, string>();
  private desync = false;

  constructor(
    app: App,
    private setup: MatchSetup,
    private net: NetSession | null = null,
  ) {
    super(app);
    this.world = new World(app.data, setup);
    this.renderer = new BattleRenderer(this.world);
  }

  update(inp: MenuInput): void {
    if (this.net) {
      this.updateNet(inp);
      return;
    }
    if (this.paused) {
      this.updatePause(inp);
      return;
    }
    if (this.intro > 0) this.intro--;
    const inputs: (Snapshot | undefined)[] = inp.held.map((h, slot) => (this.app.slots[slot]?.kind === 'human' ? h : undefined));
    this.stepWorld(inputs);
  }

  /** 連線模式：世界不會暫停；只有雙方按鍵都到齊才前進 */
  private updateNet(inp: MenuInput): void {
    const net = this.net!;
    if (net.status !== 'open') {
      if (inp.any.A) backToTitle(this.app, net);
      return;
    }
    if (this.paused) this.updatePause(inp);
    const ls = net.lockstep;
    if (!ls) return;
    let local = emptySnapshot();
    if (!this.paused) {
      for (const h of inp.held) for (const k of ACTIONS) local[k] = local[k] || h[k];
    }
    const pkt = ls.produce(this.world.tick, local);
    if (pkt) net.sendInput(pkt);
    let steps = 0;
    while (steps < 3) {
      const inputs = ls.take(this.world.tick);
      if (!inputs) break;
      if (this.intro > 0) this.intro--;
      if (this.stepWorld(inputs)) return;
      steps++;
      const t = this.world.tick;
      if (t % HASH_INTERVAL === 0) {
        const h = this.world.hash();
        this.myHashes.set(t, h);
        net.broadcast({ type: 'hash', e: net.epoch, s: net.mySlot, t, h });
      }
    }
    this.stall = steps ? 0 : this.stall + 1;
    for (const [key, h] of net.remoteHashes) {
      const t = Number(key.split(':')[1]);
      const mine = this.myHashes.get(t);
      if (mine === undefined) continue;
      if (mine !== h && !this.desync) {
        this.desync = true;
        console.warn(`[連線] ${key} 世界狀態不同步`);
      }
      net.remoteHashes.delete(key);
    }
    for (const t of this.myHashes.keys()) if (t < this.world.tick - HASH_INTERVAL * 4) this.myHashes.delete(t);
  }

  /** 前進一個 tick；若場景已切換回傳 true */
  private stepWorld(inputs: readonly (Snapshot | undefined)[]): boolean {
    this.world.step(inputs);
    this.renderer.consume(this.world.events);
    for (const ev of this.world.events) if (ev.type === 'sound') this.app.sfx.play(ev.key);
    this.renderer.tick(this.world);
    const res = this.world.result;
    if (!res) return false;
    if (res.outcome === 'stageClear') {
      this.nextStage();
      return false;
    }
    this.app.scenes.replace(new ResultScene(this.app, this.setup, this.world, res, this.net));
    return true;
  }

  private nextStage(): void {
    const M = CONFIG.match;
    const idx = (this.setup.campaignIndex ?? 0) + 1;
    const carry: CarryOver[] = this.world
      .chars()
      .filter((c) => c.slot >= 0)
      .map((c) => ({
        slot: c.slot,
        hp: c.hp > 0 ? Math.min(c.maxHp, c.hp + M.campaignHealBetweenStages) : M.campaignReviveHp,
        mp: CONFIG.combat.mpMax,
        damage: c.stats.damage,
        kos: c.stats.kos,
        downs: c.stats.downs,
      }));
    this.setup = { ...this.setup, campaignIndex: idx, stageId: campaignStageId(this.app.data, this.setup, idx), carry, seed: this.setup.seed + 1 };
    this.world = new World(this.app.data, this.setup);
    this.renderer = new BattleRenderer(this.world);
    this.intro = 90;
    if (this.net?.lockstep) {
      // 各端在同一個世界 tick 過關，各自切到下一段 lockstep
      this.net.nextSegment();
      this.myHashes.clear();
    }
  }

  private restart(): void {
    const s = { ...this.setup, seed: (this.setup.seed * 1103515245 + 12345) >>> 0 };
    if (s.mode === 'campaign') resetCampaign(this.app, s);
    this.app.scenes.replace(new BattleScene(this.app, s));
  }

  private get menuItems(): string[] {
    return this.net ? NET_MENU_ITEMS : PAUSE_ITEMS;
  }

  private updatePause(inp: MenuInput): void {
    const a = inp.any;
    if (this.showHelp) {
      if (a.A || a.D || a.J) this.showHelp = false;
      return;
    }
    const items = this.menuItems;
    if (a.up) this.pauseSel = (this.pauseSel + items.length - 1) % items.length;
    if (a.down) this.pauseSel = (this.pauseSel + 1) % items.length;
    if (a.A && this.net) {
      if (this.pauseSel === 0) this.paused = false;
      else if (this.pauseSel === 1) this.showHelp = true;
      else backToTitle(this.app, this.net);
      return;
    }
    if (a.A) {
      switch (this.pauseSel) {
        case 0:
          this.paused = false;
          break;
        case 1:
          this.restart();
          break;
        case 2:
          backToSelect(this.app);
          break;
        case 3:
          this.showHelp = true;
          break;
      }
    }
  }

  onEscape(): void {
    if (this.showHelp) {
      this.showHelp = false;
      return;
    }
    this.paused = !this.paused;
    this.pauseSel = 0;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const w = this.world;
    let extra: string | undefined;
    if (this.setup.mode === 'campaign' && w.waves) {
      const idx = (this.setup.campaignIndex ?? 0) + 1;
      const dl = this.app.data.campaignDifficulty[this.setup.campaignDifficulty ?? 'normal'].label;
      extra = `【${dl}】第 ${idx} / ${this.app.data.campaign.length} 關　${w.stage.name}　波 ${Math.max(1, w.waveIndex + 1)} / ${w.waves.waves.length}`;
    }
    this.renderer.draw(ctx, w, extra);
    if (this.intro > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.intro / 25);
      const title = this.setup.mode === 'campaign' ? `第 ${(this.setup.campaignIndex ?? 0) + 1} 關　${w.stage.name}` : w.stage.name;
      text(ctx, title, VW / 2, 180, 30, '#fff', 'center', true, true);
      text(ctx, this.intro > 30 ? '準備…' : '開打！', VW / 2, 225, 40, '#ffd23f', 'center', true, true);
      ctx.restore();
    }
    if (w.endTimer > 0) {
      text(ctx, 'K.O.!', VW / 2, 200, 64, '#ff4d4d', 'center', true, true);
    }
    if (this.net) this.renderNetStatus(ctx);
    if (this.paused) {
      overlay(ctx, 0.6, VW);
      if (this.showHelp) {
        this.renderHelp(ctx);
        return;
      }
      text(ctx, this.net ? '選單（連線中遊戲不會暫停）' : '暫停', VW / 2, 120, this.net ? 22 : 36, '#ffd23f', 'center', true, true);
      this.menuItems.forEach((it, i) => {
        const sel = i === this.pauseSel;
        ctx.fillStyle = sel ? '#ffd23f' : 'rgba(255,255,255,0.1)';
        roundRect(ctx, VW / 2 - 110, 150 + i * 46, 220, 36, 8);
        ctx.fill();
        text(ctx, it, VW / 2, 175 + i * 46, 17, sel ? '#111' : '#fff', 'center');
      });
      hint(ctx, '↑↓ 選擇　攻擊 / Enter 確定　Esc 繼續', undefined, VW / 2);
    }
  }

  private renderNetStatus(ctx: CanvasRenderingContext2D): void {
    const net = this.net!;
    const ping = `${net.role === 'host' ? '房主' : '加入者'}　${net.transportLabel()}　${Math.round(net.rtt)} ms`;
    text(ctx, ping, 8, 444, 11, net.rtt > 150 ? '#fca5a5' : '#86efac', 'left', false, true);
    if (this.desync) text(ctx, '⚠ 畫面可能不同步', VW - 8, 444, 11, '#fca5a5', 'right', false, true);
    const gone = net.lockstep?.humanSlots.filter((s) => net.lockstep!.isDropped(s)) ?? [];
    if (gone.length) text(ctx, `${gone.map((s) => `${s + 1}P`).join('、')} 已離線`, VW / 2, 444, 11, '#fca5a5', 'center', false, true);
    if (net.status !== 'open') {
      overlay(ctx, 0.65, VW);
      text(ctx, net.error || '對手已離線', VW / 2, 200, 22, '#ff8a8a', 'center', true, true);
      text(ctx, '按 攻擊 / Enter 回到標題', VW / 2, 240, 15, '#fff', 'center');
    } else if (net.reconnecting) {
      text(ctx, '連線不穩，正在重新連線…', VW / 2, 120, 22, '#ffd23f', 'center', true, true);
    } else if (net.lostSlots().length) {
      text(ctx, `${net.lostSlots().map((s) => `${s + 1}P`).join('、')} 連線中斷，等待重新連線…`, VW / 2, 120, 22, '#ffd23f', 'center', true, true);
    } else if (this.stall > 20) {
      text(ctx, '等待對手…', VW / 2, 120, 22, '#ffd23f', 'center', true, true);
    }
  }

  private renderHelp(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(viewOffset(), 0);
    text(ctx, '按鍵說明', 400, 50, 26, '#ffd23f', 'center');
    const b = this.app.settings.bindings;
    ACTIONS.forEach((a, r) => {
      text(ctx, ACTION_LABELS[a], 280, 90 + r * 22, 14, '#fff', 'right');
      for (let p = 0; p < HUMAN_PLAYERS; p++) text(ctx, keyName(b[p][a]), 360 + p * 160, 90 + r * 22, 14, '#e2e8f0', 'center');
    });
    for (let p = 0; p < HUMAN_PLAYERS; p++) text(ctx, `${p + 1}P`, 360 + p * 160, 70, 13, '#ffd23f', 'center');
    const lines = touchMode()
      ? [
          '左半邊任意處按住＝搖桿移動　同方向快推兩下＝跑步　跑步中：攻擊=衝撞、跳躍=衝刺跳、防禦=翻滾',
          '攻擊連按 3 下＝三段連擊　空中攻擊＝飛踢　按住防禦減傷 90%　靠近道具按攻擊撿起',
          '走向暈眩的敵人自動抓住：攻擊=揍打、推搖桿+攻擊=摔出',
          '必殺：推搖桿方向再點「必殺 / 必殺跳」（不推＝朝前方）；黃色外圈＝MP',
        ]
      : [
      '連擊：攻擊 ×3（第 3 段擊倒）　跑步：前方向連按兩次　跑步中：攻擊=衝撞、跳躍=衝刺跳、防禦=翻滾',
      '跳躍中攻擊=飛踢　按住防禦減傷 90%　靠近道具按攻擊撿起，持有時攻擊揮擊 / 跑跳中投出',
      '走向暈眩的敵人自動抓住：攻擊=揍打、方向+攻擊=摔出',
      '必殺技：按住「防禦＋方向」再按攻擊/跳躍；或依序按 防禦 → 方向 → 攻擊/跳躍',
      ];
    lines.forEach((l, i) => text(ctx, l, 400, 254 + i * 20, 12, '#fff', 'center', false));
    const inMatch = [...new Set(this.world.chars().filter((c) => c.slot >= 0).map((c) => c.charId))];
    inMatch.forEach((id, r) => {
      const d = this.app.data.characters[id];
      const mv = d.moves.map((m) => `${moveLabel(m.command)}${m.name}`).join('  ');
      text(ctx, `${d.name}：${mv}`, 400, 348 + r * 17, 10, '#cbd5e1', 'center', false);
    });
    hint(ctx, '按攻擊 / Esc 返回', undefined, 400);
    ctx.restore();
  }
}

export function backToSelect(app: App): void {
  const stack = app.scenes.stack;
  const i = stack.findIndex((s) => s.tag === 'select');
  if (i >= 0) {
    app.scenes.reset(stack.slice(0, i + 1));
    for (const s of app.slots) if (s.kind === 'human') s.ready = false;
  } else app.scenes.reset(stack.slice(0, 1));
}

export function backToTitle(app: App, net: NetSession | null): void {
  net?.close();
  app.scenes.reset(app.scenes.stack.slice(0, 1));
}
