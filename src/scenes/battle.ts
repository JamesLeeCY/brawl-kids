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
import { recordPractice } from '../progress';
import { progressTotals } from './achievements';
import { dataVersion } from '../data';
import { ReplayRecorder } from '../replay/replay';
import { campaignHealAmount, campaignLength, campaignStageId } from '../sim/world';
import { setGameSpeed, speedValue } from '../speed';
import { drawMoveList, drawStatusLegend } from '../render/movelist';
const PAUSE_ITEMS = ['繼續', '重新開始', '回選角', '招式表', '按鍵說明'];
const NET_MENU_ITEMS = ['繼續', '招式表', '按鍵說明', '離開連線'];
const HASH_INTERVAL = 120;

export class BattleScene extends Scene {
  readonly wide = true;
  world: World;
  renderer: BattleRenderer;
  private paused = false;
  private pauseSel = 0;
  private showHelp = false;
  /** 招式表頁碼（-1 = 沒開）：每個場上角色一頁，最後一頁是狀態說明 */
  private movePage = -1;
  private intro = 90;
  /** 連線模式：等待對手按鍵的連續 tick 數 */
  private stall = 0;
  private myHashes = new Map<number, string>();
  private desync = false;
  /** 練習模式：每位真人玩家已放出的招式、上一個幀（偵測剛放出）、提示訊息、沙包的連段傷害 */
  private practiceDone = new Map<number, Set<string>>();
  private practicePrevFrame = new Map<number, string | null>();
  private practiceToast: { text: string; t: number } | null = null;
  private combo = { dmg: 0, hits: 0, last: -9999, best: 0, hp: -1 };
  /** 重播錄製（練習模式不錄：畫面層會改動世界，重播無法重現）；闖關只錄目前這一關 */
  private recorder: ReplayRecorder | null;

  constructor(
    app: App,
    private setup: MatchSetup,
    private net: NetSession | null = null,
  ) {
    super(app);
    this.world = new World(app.data, setup);
    this.renderer = new BattleRenderer(this.world);
    setGameSpeed(setup.speed ?? speedValue(app.settings.speed));
    this.recorder = setup.practice ? null : new ReplayRecorder(setup, dataVersion());
    if (setup.practice) this.initPractice();
  }

  private isPracticeHuman(slot: number): boolean {
    return slot >= 0 && this.app.slots[slot]?.kind === 'human';
  }

  private initPractice(): void {
    for (const c of this.world.chars()) {
      if (this.isPracticeHuman(c.slot)) continue;
      c.hp = c.maxHp = 9999; // 沙包
    }
    this.combo = { dmg: 0, hits: 0, last: -9999, best: 0, hp: 9999 };
  }

  /** 練習模式每個 tick：真人玩家無限 MP、不會倒下；沙包 2 秒沒被打就回滿；記錄放出的招式與連段傷害 */
  private practiceTick(): void {
    const w = this.world;
    for (const c of w.chars()) {
      if (this.isPracticeHuman(c.slot)) {
        c.mp = CONFIG.combat.mpMax;
        c.hp = c.maxHp;
        const prev = this.practicePrevFrame.get(c.id) ?? null;
        if (c.state === 'attack' && c.frame && c.frame !== prev) {
          const mv = w.charDef(c).moves.find((m) => m.startFrame === c.frame);
          if (mv) {
            const done = this.practiceDone.get(c.slot) ?? new Set<string>();
            const before = done.size;
            done.add(mv.command);
            this.practiceDone.set(c.slot, done);
            this.practiceToast = { text: `${c.slot + 1}P ✓ ${mv.name}（${moveLabel(mv.command)}）`, t: 100 };
            if (before < done.size && done.size === w.charDef(c).moves.length) this.unlockToast(recordPractice({ allMoves: true }, progressTotals(this.app)));
          }
        }
        this.practicePrevFrame.set(c.id, c.state === 'attack' ? c.frame : null);
      } else {
        if (c.hp < this.combo.hp) {
          if (w.tick - this.combo.last > 90) this.combo.dmg = this.combo.hits = 0;
          this.combo.dmg += this.combo.hp - c.hp;
          this.combo.hits++;
          this.combo.last = w.tick;
          this.combo.best = Math.max(this.combo.best, this.combo.dmg);
        }
        // 一段連段結束：記錄最高連段傷害（成就）
        if (w.tick - this.combo.last === 91 && this.combo.dmg > 0) this.unlockToast(recordPractice({ combo: this.combo.dmg }, progressTotals(this.app)));
        if (w.tick - this.combo.last > 120 && c.hp < c.maxHp) c.hp = c.maxHp;
        if (c.hp < 1000) c.hp = c.maxHp;
        this.combo.hp = c.hp;
      }
    }
    if (this.practiceToast && --this.practiceToast.t <= 0) this.practiceToast = null;
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
    if (this.setup.practice) this.practiceTick();
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
    this.recorder?.record(inputs);
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
    this.app.scenes.replace(new ResultScene(this.app, this.setup, this.world, res, this.net, this.recorder?.finish(this.world.hash()) ?? null));
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
        hp: c.hp > 0 ? Math.min(c.maxHp, c.hp + campaignHealAmount(this.app.data, this.setup)) : M.campaignReviveHp,
        mp: CONFIG.combat.mpMax,
        damage: c.stats.damage,
        kos: c.stats.kos,
        downs: c.stats.downs,
      }));
    this.setup = { ...this.setup, campaignIndex: idx, stageId: campaignStageId(this.app.data, this.setup, idx), carry, seed: this.setup.seed + 1 };
    this.world = new World(this.app.data, this.setup);
    this.renderer = new BattleRenderer(this.world);
    this.recorder = new ReplayRecorder(this.setup, dataVersion());
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

  /** 招式表要顯示的角色：真人玩家的角色在前，再來是其他場上角色（不重複） */
  private moveListChars(): string[] {
    const cs = this.world.chars().filter((c) => c.charId !== 'guardbot');
    const ordered = [...cs.filter((c) => c.slot >= 0 && !c.ai), ...cs.filter((c) => c.slot < 0 || c.ai)];
    return [...new Set(ordered.map((c) => c.charId))];
  }

  private updatePause(inp: MenuInput): void {
    const a = inp.any;
    if (this.movePage >= 0) {
      const pages = this.moveListChars().length + 1;
      if (a.right) this.movePage = (this.movePage + 1) % pages;
      if (a.left) this.movePage = (this.movePage + pages - 1) % pages;
      if (a.A || a.D || a.J) this.movePage = -1;
      return;
    }
    if (this.showHelp) {
      if (a.A || a.D || a.J) this.showHelp = false;
      return;
    }
    const items = this.menuItems;
    if (a.up) this.pauseSel = (this.pauseSel + items.length - 1) % items.length;
    if (a.down) this.pauseSel = (this.pauseSel + 1) % items.length;
    if (a.A && this.net) {
      if (this.pauseSel === 0) this.paused = false;
      else if (this.pauseSel === 1) this.movePage = 0;
      else if (this.pauseSel === 2) this.showHelp = true;
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
          this.movePage = 0;
          break;
        case 4:
          this.showHelp = true;
          break;
      }
    }
  }

  onEscape(): void {
    if (this.movePage >= 0) {
      this.movePage = -1;
      return;
    }
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
      extra = `【${dl}】第 ${idx} / ${campaignLength(this.app.data, this.setup)} 關　${w.stage.name}　波 ${Math.max(1, w.waveIndex + 1)} / ${w.waves.waves.length}`;
    }
    this.renderer.draw(ctx, w, extra);
    if (this.intro > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.intro / 25);
      const title = this.setup.practice ? `練習模式　${w.stage.name}` : this.setup.mode === 'campaign' ? `第 ${(this.setup.campaignIndex ?? 0) + 1} / ${campaignLength(this.app.data, this.setup)} 關　${w.stage.name}` : w.stage.name;
      text(ctx, title, VW / 2, 180, 30, '#fff', 'center', true, true);
      text(ctx, this.intro > 30 ? '準備…' : '開打！', VW / 2, 225, 40, '#ffd23f', 'center', true, true);
      ctx.restore();
    }
    if (this.setup.practice) this.renderPractice(ctx);
    if (w.endTimer > 0) {
      text(ctx, 'K.O.!', VW / 2, 200, 64, '#ff4d4d', 'center', true, true);
    }
    if (this.net) this.renderNetStatus(ctx);
    if (this.paused) {
      overlay(ctx, 0.6, VW);
      if (this.movePage >= 0) {
        this.renderMoveList(ctx);
        return;
      }
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

  private unlockToast(news: { name: string }[]): void {
    if (news.length) this.practiceToast = { text: `★ 成就解鎖：${news.map((a) => a.name).join('、')}`, t: 160 };
  }

  /** 練習模式：每位真人玩家的招式表（放出過的打勾）、剛放出的提示、沙包連段傷害 */
  private renderPractice(ctx: CanvasRenderingContext2D): void {
    const humans = this.world.chars().filter((c) => this.isPracticeHuman(c.slot));
    humans.slice(0, 2).forEach((c, i) => {
      const def = this.world.charDef(c);
      const done = this.practiceDone.get(c.slot) ?? new Set<string>();
      const pw = 190;
      const x = i === 0 ? 8 : VW - pw - 8;
      const y = 86;
      ctx.fillStyle = 'rgba(10,12,30,0.62)';
      roundRect(ctx, x, y, pw, 30 + def.moves.length * 19, 8);
      ctx.fill();
      text(ctx, `${c.slot + 1}P ${def.name}　${done.size} / ${def.moves.length}`, x + 10, y + 19, 12, '#ffd23f', 'left');
      def.moves.forEach((m, mi) => {
        const ok = done.has(m.command);
        text(ctx, `${ok ? '✓' : '・'} ${moveLabel(m.command)}　${m.name}`, x + 10, y + 40 + mi * 19, 12, ok ? '#86efac' : '#fff', 'left', ok);
      });
    });
    if (this.practiceToast) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.practiceToast.t / 20);
      text(ctx, this.practiceToast.text, VW / 2, 120, 20, '#86efac', 'center', true, true);
      ctx.restore();
    }
    const c = this.combo;
    const live = this.world.tick - c.last <= 90 && c.hits > 0;
    text(ctx, live ? `連段 ${c.hits} 下　傷害 ${Math.round(c.dmg)}` : `最高連段傷害 ${Math.round(c.best)}`, VW / 2, 420, 14, live ? '#ffd23f' : '#cbd5e1', 'center', true, true);
    text(ctx, '練習模式：無限 MP、不會倒下　·　Esc 選單（重新開始 / 回選角）', VW / 2, 440, 11, 'rgba(255,255,255,0.8)', 'center', false, true);
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

  private renderMoveList(ctx: CanvasRenderingContext2D): void {
    const ids = this.moveListChars();
    const page = Math.min(this.movePage, ids.length);
    ctx.save();
    ctx.translate(viewOffset(), 0);
    text(ctx, page < ids.length ? '招式表' : '狀態說明', 400, 44, 24, '#ffd23f', 'center', true, true);
    text(ctx, `◀ ${page + 1} / ${ids.length + 1} ▶`, 400, 70, 13, '#cbd5e1', 'center', false);
    if (page < ids.length) drawMoveList(ctx, this.app.data.characters[ids[page]], 100, 86, 600, (c) => moveLabel(c), this.world.tick);
    else drawStatusLegend(ctx, 100, 86, 600);
    hint(ctx, touchMode() ? '搖桿←→ 換頁　點「攻擊」返回' : '←→ 換頁（最後一頁是狀態說明）　攻擊 / Esc 返回', 410, 400);
    ctx.restore();
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
