// 進入點：固定時間步長迴圈（accumulator），邏輯 60 tick/秒，繪圖跟隨 requestAnimationFrame。
import { Sfx } from './audio/sfx';
import { CONFIG } from './config';
import { getGameData } from './data';
import { Keyboard } from './input/keyboard';
import { TouchControls } from './input/touch';
import { text } from './render/text';
import { SceneManager, unionPressed, type App, type MenuInput } from './scenes/scene';
import { defaultSlots } from './scenes/select';
import { JoinScene, OnlineMenuScene } from './scenes/online';
import { TitleScene } from './scenes/title';
import { loadSettings } from './settings';
import { emptySnapshot, pressedEdges, type Snapshot } from './sim/snapshot';

const VW = CONFIG.view.width;
const VH = CONFIG.view.height;
const STEP = 1000 / CONFIG.tickRate;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;

const settings = loadSettings();
const kb = new Keyboard(window);
kb.setBindings(settings.bindings);
const sfx = new Sfx();
sfx.setVolumes(settings.masterVolume, settings.sfxVolume);
kb.onFirstInput = () => sfx.unlock();
new TouchControls(kb, document.body);
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('pointerdown', () => sfx.unlock());

const app: App = {
  data: getGameData(),
  settings,
  kb,
  sfx,
  scenes: new SceneManager(),
  slots: defaultSlots(),
  showFps: false,
};
app.scenes.push(new TitleScene(app));
// 透過分享連結 ?room=XXXXXX 開啟時直接加入房間
const roomCode = new URLSearchParams(window.location.search).get('room');
if (roomCode) {
  app.scenes.push(new OnlineMenuScene(app));
  app.scenes.push(new JoinScene(app, roomCode));
}
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;

// ---------- 畫布縮放：保持 16:9，等比放大，邊緣留黑 ----------
let scale = 1;
function resize(): void {
  const s = Math.min(window.innerWidth / VW, (window.innerHeight - (document.body.classList.contains('touch-mode') && window.innerHeight > window.innerWidth ? 8 : 0)) / VH);
  const cssW = Math.floor(VW * s);
  const cssH = Math.floor(VH * s);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  scale = Math.max(1, Math.min(3, Math.ceil(s * dpr)));
  canvas.width = VW * scale;
  canvas.height = VH * scale;
}
window.addEventListener('resize', resize);
resize();

canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  app.scenes.top?.onClick(((e.clientX - r.left) / r.width) * VW, ((e.clientY - r.top) / r.height) * VH);
});

// ---------- 主迴圈 ----------
let prevHeld: Snapshot[] = [0, 1, 2, 3].map(() => emptySnapshot());
let acc = 0;
let last = performance.now();
let fps = 60;
let frames = 0;
let fpsTimer = last;

function tick(codes: string[]): void {
  if (codes.includes('F3')) app.showFps = !app.showFps;
  const held = settings.bindings.map((b, i) => kb.snapshot(b, i));
  kb.endTick();
  const pressed = held.map((h, i) => pressedEdges(h, prevHeld[i]));
  prevHeld = held;
  if (codes.includes('Escape')) {
    app.scenes.top?.onEscape();
    return;
  }
  const inp: MenuInput = { held, pressed, any: unionPressed(pressed, codes.includes('Enter')), codes };
  app.scenes.top?.update(inp);
}

function frame(now: number): void {
  acc += Math.min(now - last, STEP * CONFIG.maxCatchUpTicks);
  last = now;
  let n = 0;
  let codes = kb.drainPressed();
  while (acc >= STEP && n < CONFIG.maxCatchUpTicks) {
    try {
      tick(codes);
    } catch (err) {
      console.error(err);
    }
    codes = [];
    acc -= STEP;
    n++;
  }
  if (n === CONFIG.maxCatchUpTicks) acc = 0;

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, VW, VH);
  app.scenes.top?.render(ctx);
  frames++;
  if (now - fpsTimer >= 500) {
    fps = (frames * 1000) / (now - fpsTimer);
    frames = 0;
    fpsTimer = now;
  }
  if (app.showFps) text(ctx, `${fps.toFixed(0)} FPS`, VW - 6, VH - 6, 11, '#0f0', 'right');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
