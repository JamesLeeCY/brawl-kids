// 新手教學：約 30 秒的互動教學。依序教 移動 → 跳躍 → 攻擊 → 防禦 → 必殺技，做到了才進下一步，
// 完成後可直接進練習模式。只在本機跑，世界照對戰規則模擬（玩家與沙包由畫面層補血）。
import { CONFIG } from '../config';
import { keyName } from '../input/keyboard';
import { BattleRenderer } from '../render/battle';
import { roundRect } from '../render/character';
import { text } from '../render/text';
import { VW } from '../render/view';
import { emptySnapshot } from '../sim/snapshot';
import { World, type MatchSetup } from '../sim/world';
import { BattleScene } from './battle';
import { Scene, type App, type MenuInput } from './scene';
import { moveLabel, touchMode } from './select';
import { hint } from './ui';
import { recordTutorial } from '../progress';
import { progressTotals } from './achievements';
import { drawStatusLegend } from '../render/movelist';

const STORAGE_KEY = 'brawl-kids.tutorial.v1';
/** 教學用的角色：講萬安（D→A 市政公文是直線飛行物，最好懂） */
const TUTOR_CHAR = 'jiang';

export function tutorialDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'done';
  } catch {
    return true; // 讀不到就不要一直提示
  }
}

function markTutorialDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'done');
  } catch {
    /* 私密模式等情況忽略 */
  }
}

interface Step {
  title: string;
  /** 說明文字（鍵盤 / 觸控） */
  say: (touch: boolean) => string;
  done: () => boolean;
}

export class TutorialScene extends Scene {
  readonly wide = true;
  private world: World;
  private renderer: BattleRenderer;
  private t = 0;
  private step = 0;
  /** 完成一步後的「很好！」停留時間 */
  private praise = 0;
  private finished = false;
  // 進度量測
  private moved = 0;
  private lastPos = { x: 0, z: 0 };
  private hits = 0;
  private dummyHp = 9999;
  private defendTicks = 0;
  private castDone = false;
  /** 「特殊狀態」說明頁：看了一下再按攻擊才算完成 */
  private legendTicks = 0;
  private legendAck = false;
  private prevFrame: string | null = null;
  private readonly steps: Step[];

  constructor(app: App) {
    super(app);
    const setup: MatchSetup = {
      mode: 'versus',
      stageId: 'ntu',
      seed: 7,
      players: [
        { slot: 0, charId: TUTOR_CHAR, team: 1, controller: 'human', difficulty: 'normal' },
        // 沙包：真人欄位但沒有按鍵輸入，所以站著不動
        { slot: 1, charId: 'guardbot', team: 2, controller: 'human', difficulty: 'normal' },
      ],
      practice: true,
    };
    this.world = new World(app.data, setup);
    this.world.itemTimer = 1e9;
    this.renderer = new BattleRenderer(this.world);
    const [me, dummy] = this.world.chars();
    me.x = 420;
    dummy.x = 640;
    me.z = dummy.z = 70;
    me.facing = 1;
    dummy.facing = -1;
    dummy.hp = dummy.maxHp = 9999;
    this.lastPos = { x: me.x, z: me.z };

    const b = app.settings.bindings[0];
    const k = (a: keyof typeof b) => keyName(b[a]);
    const special = app.data.characters[TUTOR_CHAR].moves.find((m) => m.command === 'D>A')!;
    this.steps = [
      {
        title: '移動',
        say: (touch) => (touch ? '按住螢幕左半邊拖曳＝搖桿，走一走' : `用 ${k('up')}${k('left')}${k('down')}${k('right')} 走一走（上下是往畫面深處走）`),
        done: () => this.moved > 160,
      },
      { title: '跳躍', say: (touch) => (touch ? '點「跳躍」跳起來' : `按 ${k('J')} 跳起來`), done: () => this.me.y > 18 },
      {
        title: '攻擊',
        say: (touch) => (touch ? '走到機器人旁邊，點「攻擊」打 3 下' : `走到機器人旁邊，按 ${k('A')} 攻擊 3 下（連按會打出連段）`),
        done: () => this.hits >= 3,
      },
      { title: '防禦', say: (touch) => (touch ? '按住「防禦」1 秒' : `按住 ${k('D')} 防禦 1 秒`), done: () => this.defendTicks >= 60 },
      {
        title: '必殺技',
        say: (touch) =>
          touch
            ? `點「必殺」放出「${special.name}」（不推搖桿＝朝前方）`
            : `按住 ${k('D')}＋${k('right')}，再按 ${k('A')}：放出「${special.name}」（${moveLabel(special.command, false)}）`,
        done: () => this.castDone,
      },
      {
        title: '特殊狀態',
        say: (touch) => (touch ? '看完頭上狀態標籤的意思後，點「攻擊」繼續' : `看完頭上狀態標籤的意思後，按 ${k('A')} 繼續（暫停選單的「招式表」也看得到）`),
        done: () => this.legendAck,
      },
    ];
  }

  private get me() {
    return this.world.chars()[0];
  }

  update(inp: MenuInput): void {
    this.t++;
    if (this.finished) {
      if (inp.any.A) this.toPractice();
      else if (inp.any.D || inp.any.J) this.app.scenes.pop();
      return;
    }
    if (this.step === this.steps.length - 1 && this.praise === 0) {
      // 說明頁：世界照跑但不用操作，看一下再按攻擊
      if (++this.legendTicks > 45 && inp.any.A) this.legendAck = true;
    }
    this.world.step([inp.held[0] ?? emptySnapshot(), undefined]);
    this.renderer.consume(this.world.events);
    for (const ev of this.world.events) if (ev.type === 'sound') this.app.sfx.play(ev.key);
    this.renderer.tick(this.world);
    this.measure();
    if (this.praise > 0) {
      if (--this.praise === 0) {
        this.step++;
        if (this.step >= this.steps.length) this.finish();
      }
    } else if (this.steps[this.step].done()) {
      this.praise = 50;
      this.app.sfx.play('special');
    }
  }

  /** 每 tick 更新進度量測；玩家與沙包補滿（教學中不會倒下） */
  private measure(): void {
    const [me, dummy] = this.world.chars();
    me.hp = me.maxHp;
    me.mp = CONFIG.combat.mpMax;
    this.moved += Math.abs(me.x - this.lastPos.x) + Math.abs(me.z - this.lastPos.z);
    this.lastPos = { x: me.x, z: me.z };
    if (me.state === 'defend') this.defendTicks++;
    if (dummy.hp < this.dummyHp) this.hits++;
    if (dummy.hp < 5000) dummy.hp = dummy.maxHp;
    this.dummyHp = dummy.hp;
    if (me.state === 'attack' && me.frame && me.frame !== this.prevFrame) {
      const mv = this.world.charDef(me).moves.find((m) => m.startFrame === me.frame);
      if (mv?.command === 'D>A') this.castDone = true;
    }
    this.prevFrame = me.state === 'attack' ? me.frame : null;
  }

  private finish(): void {
    this.finished = true;
    markTutorialDone();
    recordTutorial(progressTotals(this.app));
  }

  /** 教學完成 → 直接用同一個角色進練習模式 */
  private toPractice(): void {
    const ids = this.app.data.selectable;
    const s = this.app.slots[0];
    s.kind = 'human';
    s.charIdx = Math.max(0, ids.indexOf(TUTOR_CHAR));
    for (let i = 1; i < this.app.slots.length; i++) if (this.app.slots[i].kind === 'human') this.app.slots[i].kind = 'empty';
    const setup: MatchSetup = {
      mode: 'versus',
      stageId: 'ntu',
      seed: (Date.now() ^ (performance.now() * 1000)) >>> 0,
      practice: true,
      players: [
        { slot: 0, charId: TUTOR_CHAR, team: 1, controller: 'human', difficulty: 'normal' },
        { slot: 1, charId: 'guardbot', team: 2, controller: 'human', difficulty: 'normal' },
      ],
    };
    this.app.scenes.replace(new BattleScene(this.app, setup));
  }

  onEscape(): void {
    this.app.scenes.pop();
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.renderer.draw(ctx, this.world);
    const touch = touchMode();
    // 進度列
    const n = this.steps.length;
    const x0 = VW / 2 - ((n - 1) * 92) / 2;
    this.steps.forEach((s, i) => {
      const done = i < this.step || (i === this.step && (this.praise > 0 || this.finished));
      const cur = i === this.step && !this.finished;
      ctx.fillStyle = done ? '#22c55e' : cur ? '#ffd23f' : 'rgba(255,255,255,0.25)';
      roundRect(ctx, x0 + i * 92 - 40, 82, 80, 24, 12);
      ctx.fill();
      text(ctx, `${done ? '✓ ' : ''}${s.title}`, x0 + i * 92, 99, 13, done || cur ? '#111' : '#fff', 'center');
    });
    // 說明框
    ctx.fillStyle = 'rgba(10,12,30,0.78)';
    roundRect(ctx, VW / 2 - 300, 116, 600, 58, 12);
    ctx.fill();
    if (this.finished) {
      text(ctx, '教學完成！你已經會基本操作了', VW / 2, 142, 20, '#ffd23f', 'center', true, true);
      text(ctx, touch ? '點「攻擊」進練習模式（招式表會打勾）　·　點「防禦」回標題' : '攻擊 = 進練習模式（試試全部 6 招）　·　防禦 / 跳躍 = 回標題', VW / 2, 166, 13, '#fff', 'center', false);
    } else if (this.praise > 0) {
      text(ctx, '很好！', VW / 2, 154, 26, '#86efac', 'center', true, true);
    } else {
      const s = this.steps[this.step];
      text(ctx, `第 ${this.step + 1} 步：${s.title}`, VW / 2, 138, 14, '#ffd23f', 'center');
      text(ctx, s.say(touch), VW / 2, 162, 16, '#fff', 'center', true, true);
      if (this.step === 2 && this.hits > 0) text(ctx, `${Math.min(3, this.hits)} / 3`, VW / 2 + 260, 162, 14, '#86efac', 'center');
      if (this.step === 3 && this.defendTicks > 0) text(ctx, `${Math.min(100, Math.round((this.defendTicks / 60) * 100))}%`, VW / 2 + 260, 162, 14, '#86efac', 'center');
    }
    if (!this.finished && this.praise === 0 && this.step === this.steps.length - 1) drawStatusLegend(ctx, VW / 2 - 300, 180, 600);
    hint(ctx, '新手教學　·　Esc 離開');
  }
}
