// 全域數值設定。所有速度單位為 px/tick，時間單位為 tick（60 tick = 1 秒）。

export const CONFIG = {
  tickRate: 60,
  /** 整體遊戲速度（實際每秒跑 tickRate × gameSpeed 個 tick）：稍慢一點讓招式比較好打中；只影響時間流速，不影響決定論 */
  gameSpeed: 0.85,
  maxCatchUpTicks: 5,

  view: {
    width: 800,
    height: 450,
    /** z = 0 在畫面上的 y 座標（地平線） */
    horizon: 300,
  },

  physics: {
    zMin: 0,
    zMax: 120,
    walkSpeedX: 2.5,
    walkSpeedZ: 1.5,
    runSpeedX: 5.5,
    runSpeedZ: 1.2,
    doubleTapWindow: 12,
    jumpVy: 9,
    gravity: 0.55,
    friction: 0.8,
    hitZTolerance: 14,
    dashJumpVxMul: 1.25,
    dashJumpVyMul: 0.85,
    stageMargin: 16,
    heavyCarrySpeedMul: 0.7,
    hoverDamping: 0.8,
  },

  combat: {
    hpDefault: 500,
    mpMax: 500,
    mpRegen: 0.5,
    fallDizzy: 40,
    fallKnock: 70,
    fallDecay: 0.5,
    hitstopLight: 4,
    hitstopHeavy: 6,
    flashTicks: 2,
    hurtTicks: 16,
    dizzyTicks: 100,
    lyingTicks: 45,
    invulnAfterGetUp: 30,
    knockVx: 4,
    knockVy: 6,
    guardMax: 60,
    guardRegen: 0.25,
    guardCostMul: 0.5,
    guardDamageReduction: 0.9,
    guardBreakTicks: 40,
    guardPushback: 1.5,
    rollTicks: 22,
    rollSpeed: 6,
    commandWindow: 30,
    commandBufferTicks: 40,
    grabRange: 28,
    grabMaxTicks: 150,
    grabPunchDamage: 12,
    grabPunchCooldown: 10,
    grabThrowDamage: 40,
    grabThrowVx: 7,
    grabThrowVy: 6,
    pickupRange: 26,
    defaultBody: { x: -11, y: 0, w: 22, h: 60 },
  },

  items: {
    spawnMinTicks: 1200,
    spawnMaxTicks: 1800,
    spawnHeight: 320,
    throwVx: 10,
    throwVy: 2,
    heavyThrowVx: 7,
    heavyThrowVy: 3,
    bounceVy: 4,
  },

  ai: {
    period: { easy: 30, normal: 15, hard: 6 },
    mistake: { easy: 0.4, normal: 0.2, hard: 0.05 },
    projectileDefendChance: { easy: 0, normal: 0.3, hard: 0.7 },
    specialChance: { easy: 0.15, normal: 0.3, hard: 0.6 },
    alignZ: 10,
    meleeRange: 40,
    rangedMin: 120,
    rangedMax: 300,
  },

  match: {
    endDelayTicks: 90,
    waveDelayTicks: 90,
    firstWaveDelayTicks: 45,
    campaignReviveHp: 200,
    campaignHealBetweenStages: 200,
    /** 超過 4 關的長途闖關，每關之間回復較多（避免後段血量被磨光） */
    campaignHealLongRun: 300,
  },

  fx: {
    sparkTicks: 6,
    afterimageInterval: 3,
    afterimageLife: 12,
    afterimageAlpha: 0.3,
    shakeAmp: 4,
    shakeTicks: 6,
    cameraLerp: 0.12,
  },
} as const;

export type Difficulty = 'easy' | 'normal' | 'hard';
