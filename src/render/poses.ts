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
