// 設定（按鍵綁定、音量）存在 localStorage；讀寫皆包 try/catch。
import { DEFAULT_BINDINGS, type Binding } from './input/keyboard';
import { ACTIONS } from './sim/snapshot';
import type { QualitySetting } from './render/quality';
import type { SpeedSetting } from './speed';
import type { ShakeSetting } from './render/shake';

const KEY = 'brawl-kids.settings.v2';

export interface Settings {
  bindings: Binding[];
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  /** 畫質：自動（跑太慢時自動降低）/ 高 / 低 */
  quality: QualitySetting;
  /** 遊戲速度：快 / 中 / 慢（連線時用房主的設定） */
  speed: SpeedSetting;
  /** 畫面晃動：標準 / 弱 / 關 */
  shake: ShakeSetting;
}

export function defaultSettings(): Settings {
  return { bindings: DEFAULT_BINDINGS.map((b) => ({ ...b })), masterVolume: 0.8, sfxVolume: 0.8, musicVolume: 0.6, quality: 'auto', speed: 'normal', shake: 'normal' };
}

export function loadSettings(): Settings {
  const s = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return s;
    const j = JSON.parse(raw) as Partial<Settings>;
    if (Array.isArray(j.bindings) && j.bindings.length === s.bindings.length) {
      j.bindings.forEach((b, i) => {
        for (const a of ACTIONS) if (typeof b?.[a] === 'string') s.bindings[i][a] = b[a];
      });
    }
    if (typeof j.masterVolume === 'number') s.masterVolume = clamp01(j.masterVolume);
    if (typeof j.sfxVolume === 'number') s.sfxVolume = clamp01(j.sfxVolume);
    if (typeof j.musicVolume === 'number') s.musicVolume = clamp01(j.musicVolume);
    if (j.quality === 'auto' || j.quality === 'high' || j.quality === 'low') s.quality = j.quality;
    if (j.speed === 'fast' || j.speed === 'normal' || j.speed === 'slow') s.speed = j.speed;
    if (j.shake === 'off' || j.shake === 'low' || j.shake === 'normal') s.shake = j.shake;
  } catch {
    /* 無法讀取時使用預設值 */
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 私密瀏覽等情況忽略 */
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
