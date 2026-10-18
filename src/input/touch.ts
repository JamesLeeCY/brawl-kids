// 觸控操作：左下虛擬搖桿、右下按鈕，結果併入 1P 的按鍵快照。
// 「必殺」鈕＝同時按下 防禦＋方向＋攻擊（走「按住防禦＋方向再按攻擊」的簡單按法），沒推搖桿時朝最後面向的方向。
import type { Action } from '../sim/snapshot';
import type { Keyboard } from './keyboard';

type Dir = 'up' | 'down' | 'left' | 'right';

const DEAD_ZONE = 0.32;

/** 主要輸入是手指（手機 / 平板）；觸控筆電的主要輸入是滑鼠，等真的碰螢幕才顯示 */
export function isTouchDevice(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

export class TouchControls {
  readonly root: HTMLDivElement;
  private stickBase!: HTMLDivElement;
  private stickKnob!: HTMLDivElement;
  private stickPointer: number | null = null;
  private dirs = new Set<Dir>();
  private lastHorizontal: 'left' | 'right' = 'right';

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
  }

  setVisible(v: boolean): void {
    if (document.body.classList.contains('touch-mode') === v && this.root.style.display) return;
    this.root.style.display = v ? 'block' : 'none';
    document.body.classList.toggle('touch-mode', v);
    window.dispatchEvent(new Event('resize'));
  }

  // ---------------- 搖桿 ----------------
  private buildStick(): void {
    const base = document.createElement('div');
    base.className = 'touch-stick';
    const knob = document.createElement('div');
    knob.className = 'touch-knob';
    base.appendChild(knob);
    this.root.appendChild(base);
    this.stickBase = base;
    this.stickKnob = knob;
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stickPointer = e.pointerId;
      capture(base, e.pointerId);
      this.moveStick(e);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) this.moveStick(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.knobAt(0, 0);
      this.setDirs(new Set());
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }

  private moveStick(e: PointerEvent): void {
    const r = this.stickBase.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = (e.clientX - (r.left + radius)) / radius;
    let dy = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.knobAt(dx * radius * 0.55, dy * radius * 0.55);
    const next = new Set<Dir>();
    if (len > DEAD_ZONE) {
      // 8 方向：與軸夾角小於 67.5 度即算該方向
      if (dx > 0.38) next.add('right');
      if (dx < -0.38) next.add('left');
      if (dy > 0.38) next.add('down');
      if (dy < -0.38) next.add('up');
    }
    this.setDirs(next);
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

  // ---------------- 按鈕 ----------------
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
      b.textContent = label;
      pad.appendChild(b);
      let active: Action[] = [];
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        capture(b, e.pointerId);
        active = keys();
        for (const a of active) this.kb.setVirtual(a, true);
        b.classList.add('down');
        navigator.vibrate?.(12);
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

  // ---------------- 上方：暫停 / 全螢幕 ----------------
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
    const tip = document.createElement('div');
    tip.className = 'touch-rotate';
    tip.textContent = '📱 橫向持握手機，畫面更大更好玩';
    this.root.append(pause, full, tip);
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

function capture(el: HTMLElement, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
    /* 部分瀏覽器對已結束的觸控點會丟例外，忽略 */
  }
}
