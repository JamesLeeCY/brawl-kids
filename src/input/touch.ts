// 觸控操作（荒野亂鬥式）：按鈕直接疊在遊戲畫面上。
// - 左半邊任意位置按下 → 浮動搖桿出現在手指下，放開即消失
// - 右下：大顆「攻擊」，周圍「跳躍」「防禦」「必殺跳」；黃色「必殺」鈕外圈依 MP 充能
// 「必殺」＝同時按下 防禦＋方向＋攻擊（走「按住防禦＋方向再按攻擊」的簡單按法），沒推搖桿時朝最後面向的方向。
import type { Action } from '../sim/snapshot';
import type { Keyboard } from './keyboard';

type Dir = 'up' | 'down' | 'left' | 'right';

const DEAD_ZONE = 0.28;
/** 搖桿半徑（px） */
const STICK_R = 62;

/** 主要輸入是手指（手機 / 平板）；觸控筆電的主要輸入是滑鼠，等真的碰螢幕才顯示 */
export function isTouchDevice(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

export class TouchControls {
  readonly root: HTMLDivElement;
  private zone!: HTMLDivElement;
  private stickBase!: HTMLDivElement;
  private stickKnob!: HTMLDivElement;
  private stickPointer: number | null = null;
  private origin = { x: 0, y: 0 };
  private dirs = new Set<Dir>();
  private lastHorizontal: 'left' | 'right' = 'right';
  private superBtn!: HTMLDivElement;
  private superJumpBtn!: HTMLDivElement;
  private charge = -1;

  constructor(
    private kb: Keyboard,
    parent: HTMLElement,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'touch-ui';
    parent.appendChild(this.root);
    this.buildStick();
    this.buildButtons();
    this.buildTopBar();
    this.setVisible(isTouchDevice());
    // 用實體鍵盤就隱藏，碰觸螢幕再顯示
    kb.onPhysicalKey = () => this.setVisible(false);
    window.addEventListener('touchstart', () => this.setVisible(true), { passive: true });
    // 依螢幕高度縮放按鈕：矮的手機橫向畫面按鈕小一點，避免擋住戰場
    const fit = () => {
      const k = Math.max(0.62, Math.min(1.1, Math.min(window.innerHeight, window.innerWidth) / 470));
      this.root.style.setProperty('--k', k.toFixed(3));
    };
    window.addEventListener('resize', fit);
    fit();
  }

  setVisible(v: boolean): void {
    if (document.body.classList.contains('touch-mode') === v && this.root.style.display) return;
    this.root.style.display = v ? 'block' : 'none';
    document.body.classList.toggle('touch-mode', v);
    window.dispatchEvent(new Event('resize'));
  }

  /** 必殺鈕外圈充能（0–1，本機玩家 MP 比例） */
  setCharge(ratio: number): void {
    const r = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    if (r === this.charge) return;
    this.charge = r;
    for (const b of [this.superBtn, this.superJumpBtn]) {
      b.style.setProperty('--charge', `${r}%`);
      b.classList.toggle('ready', r >= 12);
    }
  }

  // ---------------- 浮動搖桿 ----------------
  private buildStick(): void {
    const zone = document.createElement('div');
    zone.className = 'touch-zone';
    const base = document.createElement('div');
    base.className = 'touch-stick idle';
    const knob = document.createElement('div');
    knob.className = 'touch-knob';
    base.appendChild(knob);
    zone.appendChild(base);
    this.root.appendChild(zone);
    this.zone = zone;
    this.stickBase = base;
    this.stickKnob = knob;
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      e.preventDefault();
      this.stickPointer = e.pointerId;
      capture(zone, e.pointerId);
      const zr = zone.getBoundingClientRect();
      this.origin = { x: e.clientX, y: e.clientY };
      base.style.left = `${e.clientX - zr.left}px`;
      base.style.top = `${e.clientY - zr.top}px`;
      base.classList.remove('idle');
      this.moveStick(e);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) this.moveStick(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.knobAt(0, 0);
      base.classList.add('idle');
      base.style.left = '';
      base.style.top = '';
      this.setDirs(new Set());
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  private moveStick(e: PointerEvent): void {
    const R = STICK_R * this.scaleK();
    let dx = (e.clientX - this.origin.x) / R;
    let dy = (e.clientY - this.origin.y) / R;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      // 手指拖太遠時搖桿跟著移動（荒野亂鬥式）
      const zr = this.zone.getBoundingClientRect();
      this.origin.x = e.clientX - (dx / len) * R;
      this.origin.y = e.clientY - (dy / len) * R;
      this.stickBase.style.left = `${this.origin.x - zr.left}px`;
      this.stickBase.style.top = `${this.origin.y - zr.top}px`;
      dx /= len;
      dy /= len;
    }
    this.knobAt(dx * STICK_R * 0.6, dy * STICK_R * 0.6);
    const next = new Set<Dir>();
    if (Math.min(len, 1) > DEAD_ZONE) {
      if (dx > 0.38) next.add('right');
      if (dx < -0.38) next.add('left');
      if (dy > 0.38) next.add('down');
      if (dy < -0.38) next.add('up');
    }
    this.setDirs(next);
  }

  private scaleK(): number {
    return Number(this.root.style.getPropertyValue('--k')) || 1;
  }

  private knobAt(x: number, y: number): void {
    this.stickKnob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  private setDirs(next: Set<Dir>): void {
    for (const d of this.dirs) if (!next.has(d)) this.kb.setVirtual(d, false);
    for (const d of next) if (!this.dirs.has(d)) this.kb.setVirtual(d, true);
    if (next.has('left')) this.lastHorizontal = 'left';
    if (next.has('right')) this.lastHorizontal = 'right';
    this.dirs = next;
  }

  // ---------------- 右下按鈕 ----------------
  private buildButtons(): void {
    const pad = document.createElement('div');
    pad.className = 'touch-pad';
    this.root.appendChild(pad);
    const defs: [string, string, () => Action[]][] = [
      ['攻擊', 'btn-a', () => ['A']],
      ['跳躍', 'btn-j', () => ['J']],
      ['防禦', 'btn-d', () => ['D']],
      ['必殺', 'btn-sa', () => this.specialKeys('A')],
      ['必殺跳', 'btn-sj', () => this.specialKeys('J')],
    ];
    for (const [label, cls, keys] of defs) {
      const b = document.createElement('div');
      b.className = `touch-btn ${cls}`;
      const span = document.createElement('span');
      span.textContent = label;
      b.appendChild(span);
      pad.appendChild(b);
      if (cls === 'btn-sa') this.superBtn = b;
      if (cls === 'btn-sj') this.superJumpBtn = b;
      let active: Action[] = [];
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        capture(b, e.pointerId);
        active = keys();
        for (const a of active) this.kb.setVirtual(a, true);
        b.classList.add('down');
        if (e.isTrusted) navigator.vibrate?.(12);
      });
      const up = () => {
        for (const a of active) if (!this.dirs.has(a as Dir)) this.kb.setVirtual(a, false);
        active = [];
        b.classList.remove('down');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    }
  }

  /** 必殺：防禦＋方向＋攻擊/跳躍；搖桿沒推時朝最後面向 */
  private specialKeys(fin: 'A' | 'J'): Action[] {
    const keys: Action[] = ['D', fin];
    if (this.dirs.size === 0) keys.push(this.lastHorizontal);
    return keys;
  }

  // ---------------- 上方：暫停 / 全螢幕；直向提示 ----------------
  private buildTopBar(): void {
    const pause = document.createElement('div');
    pause.className = 'touch-top touch-pause';
    pause.textContent = 'Ⅱ';
    pause.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.kb.pushCode('Escape');
    });
    const full = document.createElement('div');
    full.className = 'touch-top touch-full';
    full.textContent = '⛶';
    full.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      void toggleFullscreen();
    });
    const rotate = document.createElement('div');
    rotate.className = 'touch-rotate';
    rotate.innerHTML = '<div class="rotate-icon">📱</div><div>請將手機轉為橫向</div><small>橫向時遊戲會填滿整個螢幕</small>';
    this.root.append(pause, full, rotate);
  }
}

function capture(el: HTMLElement, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
    /* 部分瀏覽器對已結束的觸控點會丟例外，忽略 */
  }
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await o.lock?.('landscape').catch(() => undefined);
    }
  } catch {
    /* iOS Safari 不支援全螢幕 API，忽略 */
  }
}
