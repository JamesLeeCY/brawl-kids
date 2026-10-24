// 骨架姿勢：關節角度（度）。肢體角度 0 = 朝下，90 = 朝前（面向方向），-90 = 朝後。
// 軀幹 t：0 = 直立，正值前傾。dy：髖部下沉量。rot：整體旋轉（倒地等）。

export interface Pose {
  t: number;
  h?: number;
  bua: number;
  bfa: number;
  fua: number;
  ffa: number;
  bth: number;
  bsh: number;
  fth: number;
  fsh: number;
  dy?: number;
  rot?: number;
  /** 手臂長度倍率（招牌動作把手伸長，Q 版大頭才看得出手勢；預設 1） */
  reach?: number;
}

const stance = { bth: -15, bsh: -15, fth: 20, fsh: 5 };

export const POSES: Record<string, Pose> = {
  idle_0: { t: 0, bua: -12, bfa: 15, fua: 12, ffa: 40, bth: -6, bsh: -6, fth: 6, fsh: 6 },
  idle_1: { t: 2, bua: -8, bfa: 22, fua: 16, ffa: 48, bth: -6, bsh: -4, fth: 6, fsh: 8, dy: 1 },

  walk_0: { t: 4, bua: 25, bfa: 45, fua: -25, ffa: 0, bth: -25, bsh: -40, fth: 25, fsh: 10 },
  walk_1: { t: 4, bua: 5, bfa: 25, fua: -5, ffa: 20, bth: -5, bsh: -20, fth: 5, fsh: -5, dy: -1 },
  walk_2: { t: 4, bua: -25, bfa: 0, fua: 25, ffa: 45, bth: 25, bsh: 10, fth: -25, fsh: -40 },
  walk_3: { t: 4, bua: -5, bfa: 20, fua: 5, ffa: 25, bth: 5, bsh: -5, fth: -5, fsh: -20, dy: -1 },

  run_0: { t: 18, bua: 50, bfa: 110, fua: -45, ffa: 20, bth: -45, bsh: -90, fth: 50, fsh: 20, dy: 1 },
  run_1: { t: 18, bua: 10, bfa: 90, fua: -10, ffa: 70, bth: -10, bsh: -50, fth: 15, fsh: -30, dy: -2 },
  run_2: { t: 18, bua: -45, bfa: 20, fua: 50, ffa: 110, bth: 50, bsh: 20, fth: -45, fsh: -90, dy: 1 },
  run_3: { t: 18, bua: -10, bfa: 70, fua: 10, ffa: 90, bth: 15, bsh: -30, fth: -10, fsh: -50, dy: -2 },

  jump: { t: 6, bua: -50, bfa: 10, fua: 120, ffa: 150, bth: 30, bsh: -40, fth: 55, fsh: -10 },
  crouch: { t: 15, bua: 20, bfa: 60, fua: 30, ffa: 70, bth: -40, bsh: 35, fth: 45, fsh: -35, dy: 8 },

  punch_ready: { t: 6, bua: -20, bfa: 70, fua: 40, ffa: 140, ...stance },
  punch_extend: { t: 16, bua: -30, bfa: 30, fua: 90, ffa: 90, ...stance },
  punch_ready2: { t: 4, bua: 30, bfa: 130, fua: -10, ffa: 60, ...stance },
  punch2_extend: { t: 18, bua: 90, bfa: 90, fua: -25, ffa: 20, ...stance },
  kick_ready: { t: -6, bua: -40, bfa: 10, fua: 40, ffa: 100, bth: -5, bsh: 0, fth: 70, fsh: -20 },
  kick: { t: -16, bua: -60, bfa: -20, fua: 30, ffa: 80, bth: -5, bsh: 0, fth: 92, fsh: 92 },
  flykick: { t: -12, bua: -110, bfa: -80, fua: 140, ffa: 160, bth: -25, bsh: -70, fth: 75, fsh: 85 },
  run_attack: { t: 30, bua: 70, bfa: 80, fua: 80, ffa: 95, bth: -40, bsh: -70, fth: 40, fsh: 10, dy: 2 },

  defend: { t: 2, bua: 60, bfa: 165, fua: 75, ffa: 170, bth: -22, bsh: 10, fth: 25, fsh: -10, dy: 3 },
  hurt: { t: -22, h: -15, bua: -70, bfa: -30, fua: -40, ffa: 10, bth: -12, bsh: -5, fth: 18, fsh: 5 },
  dizzy: { t: -8, h: 10, bua: 5, bfa: 5, fua: -5, ffa: -5, bth: -8, bsh: 0, fth: 8, fsh: 0, dy: 1 },
  falling: { t: -10, h: -20, bua: -150, bfa: -170, fua: 150, ffa: 170, bth: 20, bsh: -20, fth: 45, fsh: 10, rot: -55 },
  lying: { t: 0, h: 0, bua: -170, bfa: -175, fua: 170, ffa: 175, bth: 5, bsh: 0, fth: -5, fsh: 0, rot: -90 },
  victory: { t: 0, bua: -30, bfa: -10, fua: 135, ffa: 170, bth: -10, bsh: -10, fth: 10, fsh: 10 },

  throw_ready: { t: -12, bua: 40, bfa: 70, fua: -130, ffa: -160, ...stance },
  throw: { t: 22, bua: -40, bfa: 0, fua: 100, ffa: 95, ...stance },
  swing_ready: { t: -10, bua: -40, bfa: 20, fua: -150, ffa: -170, ...stance },
  swing: { t: 20, bua: -30, bfa: 10, fua: 80, ffa: 70, ...stance },

  cast_ready: { t: -6, bua: -50, bfa: -20, fua: -40, ffa: 10, ...stance },
  cast: { t: 10, bua: 80, bfa: 85, fua: 88, ffa: 92, ...stance },
  cast_up: { t: -4, bua: 155, bfa: 165, fua: 140, ffa: 165, bth: -10, bsh: -10, fth: 10, fsh: 10 },
  slam_ready: { t: -14, bua: 160, bfa: 175, fua: 165, ffa: 178, ...stance },
  slam: { t: 40, bua: 30, bfa: 22, fua: 38, ffa: 28, bth: -45, bsh: 40, fth: 58, fsh: -42, dy: 15 },
  dash: { t: 38, bua: -80, bfa: -100, fua: -60, ffa: -90, bth: -50, bsh: -90, fth: 50, fsh: 20, dy: 2 },
  place: { t: 30, bua: 20, bfa: 30, fua: 60, ffa: 40, bth: -40, bsh: 35, fth: 45, fsh: -35, dy: 8 },
  jet_up: { t: 0, bua: -25, bfa: -15, fua: 25, ffa: 15, bth: -5, bsh: -5, fth: 10, fsh: 0 },

  // 慶祝姿勢：舉起的手往後上方、往前的手停在下巴以下，不擋臉
  cheer_back: { t: -6, bua: 20, bfa: 40, fua: -150, ffa: -170, bth: -10, bsh: -8, fth: 10, fsh: 8 },
  wave: { t: -4, bua: -150, bfa: -120, fua: 20, ffa: 35, bth: -8, bsh: -6, fth: 8, fsh: 6 },
  wave2: { t: -4, bua: -150, bfa: -178, fua: 20, ffa: 35, bth: -8, bsh: -6, fth: 8, fsh: 6, dy: 1 },
  fist_pump: { t: -8, bua: -160, bfa: -175, fua: 32, ffa: 95, bth: -12, bsh: -6, fth: 14, fsh: 4 },
  thumbs: { t: -4, bua: 15, bfa: 30, fua: 50, ffa: 85, bth: -10, bsh: -6, fth: 10, fsh: 6 },
  clap: { t: -2, bua: 45, bfa: 85, fua: 50, ffa: 88, bth: -6, bsh: -6, fth: 6, fsh: 6 },
  clap2: { t: -2, bua: 32, bfa: 65, fua: 62, ffa: 92, bth: -6, bsh: -6, fth: 6, fsh: 6, dy: 1 },
  flex: { t: -6, bua: -100, bfa: -175, fua: 20, ffa: 30, bth: -14, bsh: -8, fth: 16, fsh: 6 },
  hop: { t: -10, bua: -140, bfa: -160, fua: -130, ffa: -150, bth: 30, bsh: -50, fth: 50, fsh: -20, dy: -4 },
  grab: { t: 10, bua: 70, bfa: 60, fua: 80, ffa: 70, ...stance },

  // ---- 招牌動作（各角色的代表招式用）----
  // Q 版頭很大：往上的手勢一律用後手（畫在頭後面），前手只在頭的下方或前方，不擋到臉
  toss_ready: { t: -4, bua: 20, bfa: 40, fua: -40, ffa: -10, ...stance },
  toss: { t: 14, bua: -30, bfa: -5, fua: 70, ffa: 100, ...stance, reach: 1.25 },
  point_fwd: { t: 8, bua: -35, bfa: 0, fua: 92, ffa: 96, bth: -22, bsh: -22, fth: 30, fsh: 8, reach: 1.3 },
  point_up: { t: 6, bua: -105, bfa: -150, fua: 35, ffa: 70, ...stance, reach: 1.4 },
  arms_wide: { t: 2, bua: -100, bfa: -125, fua: 95, ffa: 105, bth: -22, bsh: -18, fth: 22, fsh: 18, reach: 1.35 },
  cheer_v: { t: 2, bua: -110, bfa: -160, fua: 95, ffa: 115, bth: -12, bsh: -8, fth: 14, fsh: 6, reach: 1.35 },
  flex_front: { t: 2, bua: -95, bfa: -170, fua: 40, ffa: 100, bth: -16, bsh: -8, fth: 18, fsh: 6, dy: 1, reach: 1.3 },
  deep_squat: { t: 8, bua: 75, bfa: 85, fua: 80, ffa: 90, bth: -70, bsh: 25, fth: 75, fsh: -20, dy: 8 },
  bow: { t: 55, h: 12, bua: 0, bfa: -5, fua: 5, ffa: 0, bth: -2, bsh: -2, fth: 4, fsh: 2 },
  push: { t: 26, bua: 72, bfa: 84, fua: 78, ffa: 88, bth: -40, bsh: -60, fth: 35, fsh: 10, dy: 1, reach: 1.25 },
  stop_palm: { t: 4, bua: -10, bfa: 10, fua: 88, ffa: 120, ...stance, reach: 1.3 },
  arms_crossed: { t: 0, bua: 50, bfa: 105, fua: 40, ffa: 115, bth: -8, bsh: -6, fth: 8, fsh: 6 },
  hands_together: { t: 4, bua: 35, bfa: 95, fua: 30, ffa: 100, bth: -6, bsh: -6, fth: 6, fsh: 6 },
  offer: { t: 12, bua: 60, bfa: 75, fua: 65, ffa: 80, ...stance, reach: 1.2 },
  accuse: { t: 18, h: 6, bua: -45, bfa: -15, fua: 95, ffa: 95, bth: -30, bsh: -35, fth: 42, fsh: 12, dy: 1, reach: 1.4 },
  scold: { t: 6, h: -4, bua: -30, bfa: 10, fua: 80, ffa: 118, ...stance, reach: 1.2 },
  tantrum_a: { t: -6, bua: -110, bfa: -60, fua: 70, ffa: 20, bth: -10, bsh: -10, fth: 40, fsh: -30, reach: 1.3 },
  tantrum_b: { t: 6, bua: 40, bfa: 80, fua: -100, ffa: -50, bth: -35, bsh: -60, fth: 10, fsh: 10, reach: 1.3 },
  judo_lift: { t: 6, bua: -110, bfa: -150, fua: -95, ffa: -135, bth: -30, bsh: 10, fth: 35, fsh: -10, dy: 3, reach: 1.35 },
  open_box: { t: 10, bua: 75, bfa: 100, fua: 85, ffa: 110, ...stance, reach: 1.25 },
  karate: { t: 14, bua: -40, bfa: 60, fua: 92, ffa: 92, bth: -40, bsh: -5, fth: 45, fsh: 5, dy: 4, reach: 1.3 },
  phone: { t: 3, h: 10, bua: -10, bfa: 5, fua: 25, ffa: 125, ...stance },
  ride: { t: 18, bua: 68, bfa: 76, fua: 72, ffa: 80, bth: -55, bsh: 25, fth: 60, fsh: -25, dy: 6 },
  make_rain: { t: 4, bua: -105, bfa: -140, fua: 45, ffa: 85, ...stance, dy: -1, reach: 1.4 },
  defib: { t: 22, bua: 52, bfa: 88, fua: 58, ffa: 92, ...stance, reach: 1.25 },
  laugh_back: { t: -18, h: -10, bua: 10, bfa: 70, fua: 15, ffa: 75, ...stance },
  present: { t: 4, bua: -10, bfa: 5, fua: 70, ffa: 45, ...stance, reach: 1.25 },
  shotput_ready: { t: -10, bua: -60, bfa: -20, fua: 10, ffa: 150, bth: -35, bsh: -15, fth: 25, fsh: 5 },
  shotput: { t: 24, bua: -70, bfa: -40, fua: 100, ffa: 100, bth: -40, bsh: -50, fth: 40, fsh: 15, reach: 1.3 },
  carry: { t: 0, bua: 165, bfa: 175, fua: 160, ffa: 175, bth: -6, bsh: -6, fth: 6, fsh: 6 },
};

export function getPose(name: string): Pose {
  return POSES[name] ?? POSES.idle_0;
}

/** 持重物時覆寫手臂 */
export function withCarryArms(p: Pose): Pose {
  const c = POSES.carry;
  return { ...p, bua: c.bua, bfa: c.bfa, fua: c.fua, ffa: c.ffa };
}

export const REQUIRED_POSES = [
  'idle_0', 'idle_1', 'walk_0', 'walk_1', 'walk_2', 'walk_3', 'run_0', 'run_1', 'run_2', 'run_3',
  'jump', 'punch_extend', 'kick', 'defend', 'hurt', 'dizzy', 'falling', 'lying', 'victory',
];

const KEYS = ['t', 'h', 'bua', 'bfa', 'fua', 'ffa', 'bth', 'bsh', 'fth', 'fsh', 'dy', 'rot', 'reach'] as const;

/** 兩個姿勢之間插值（k = 0 → a，1 → b）；畫面用，讓動作之間平順過渡 */
export function lerpPose(a: Pose, b: Pose, k: number): Pose {
  const o = {} as Pose;
  for (const key of KEYS) {
    const def = key === 'reach' ? 1 : 0;
    const va = a[key] ?? def;
    const vb = b[key] ?? def;
    (o as unknown as Record<string, number>)[key] = va + (vb - va) * k;
  }
  return o;
}

/**
 * 循環動作（走路 4 格、跑步 4 格）用連續的相位在相鄰兩格之間插值，
 * 不再一格一格跳，看起來像有很多格動畫。
 */
export function cyclePose(prefix: string, frames: number, phase: number): Pose {
  const i = Math.floor(phase);
  const f = phase - i;
  // 緩入緩出：在關鍵格停留久一點，比線性更有「定格」的手感
  const e = f * f * (3 - 2 * f);
  return lerpPose(getPose(`${prefix}_${((i % frames) + frames) % frames}`), getPose(`${prefix}_${(((i + 1) % frames) + frames) % frames}`), e);
}
