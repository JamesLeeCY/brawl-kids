// 新招式機制：狀態效果、實體牆、反彈、反擊、指令投、蓄力、隨機招……
import { describe, expect, it } from 'vitest';
import { addBuff } from '../src/sim/effects';
import { getBuff, hasBuff, type Entity } from '../src/sim/entity';
import { setState } from '../src/sim/fsm';
import { emptySnapshot, snapshotFrom, type Snapshot } from '../src/sim/snapshot';
import { World, type MatchSetup } from '../src/sim/world';
import { data, duel, idle } from './helpers';

const NONE = emptySnapshot();

/** 用「按住防禦＋方向，再按攻擊/跳躍」放出某角色的某指令 */
function cast(w: World, cmd: string, slot = 0, hold = 1): void {
  const dir = cmd[1] === '^' ? 'up' : cmd[1] === 'v' ? 'down' : null;
  const fin = cmd[2] as 'A' | 'J';
  const me = w.chars().find((c) => c.slot === slot)!;
  const fwd = me.facing === 1 ? 'right' : 'left';
  const held: Partial<Snapshot> = { D: true, ...(dir ? { [dir]: true } : { [fwd]: true }) };
  const step = (s: Snapshot) => w.step(slot === 0 ? [s, NONE] : [NONE, s]);
  step(snapshotFrom(held));
  step(snapshotFrom({ ...held, [fin]: true }));
  for (let i = 1; i < hold; i++) step(snapshotFrom({ [fin]: true }));
}

function team4(chars: string[]): { w: World; c: Entity[] } {
  const setup: MatchSetup = {
    mode: 'versus',
    stageId: 'ntu',
    seed: 5,
    players: chars.map((charId, i) => ({ slot: i, charId, team: i < 2 ? 1 : 2, controller: 'human' as const, difficulty: 'normal' as const })),
  };
  const w = new World(data, setup);
  w.itemTimer = 1e9;
  const c = w.chars();
  c.forEach((e, i) => {
    e.x = 400 + i * 30;
    e.z = 60;
    setState(e, 'idle');
  });
  return { w, c };
}

describe('對手身上的狀態', () => {
  it('方向顛倒：按右會往左走', () => {
    const { w, a } = duel();
    addBuff(a, { type: 'reverse', value: 1, duration: 60, to: 'self' });
    const x = a.x;
    for (let i = 0; i < 10; i++) w.step([snapshotFrom({ right: true }), NONE]);
    expect(a.x).toBeLessThan(x);
  });

  it('定身：按鍵沒反應，時間到才恢復', () => {
    const { w, a } = duel();
    addBuff(a, { type: 'stun', value: 1, duration: 30, to: 'self' });
    const x = a.x;
    for (let i = 0; i < 20; i++) w.step([snapshotFrom({ right: true }), NONE]);
    expect(a.x).toBe(x);
    for (let i = 0; i < 20; i++) w.step([snapshotFrom({ right: true }), NONE]);
    expect(a.x).toBeGreaterThan(x);
  });

  it('全場安靜：不能放必殺', () => {
    const { w, a } = duel();
    addBuff(a, { type: 'silence', value: 1, duration: 120, to: 'self' });
    const mp = a.mp;
    cast(w, 'D>A');
    expect(a.mp).toBeGreaterThanOrEqual(mp);
    expect(a.frame === null || !a.frame.startsWith('doc')).toBe(true);
  });

  it('期末考 F：受到的傷害 +20%', () => {
    const plain = duel();
    const marked = duel();
    addBuff(marked.b, { type: 'vuln', value: 0.2, duration: 120, to: 'self' });
    for (const d of [plain, marked]) {
      d.w.step([snapshotFrom({ A: true }), NONE]);
      idle(d.w, 12);
    }
    const lostPlain = plain.b.maxHp - plain.b.hp;
    const lostMarked = marked.b.maxHp - marked.b.hp;
    expect(lostPlain).toBeGreaterThan(0);
    expect(lostMarked).toBeCloseTo(lostPlain * 1.2, 5);
  });

  it('定期定額：每半秒扣血，不會直接打死', () => {
    const { w, b } = duel();
    addBuff(b, { type: 'dot', value: 4, duration: 240, to: 'self' });
    idle(w, 240);
    expect(b.maxHp - b.hp).toBe(32);
    b.hp = 3;
    addBuff(b, { type: 'dot', value: 4, duration: 240, to: 'self' });
    idle(w, 240);
    expect(b.hp).toBe(1);
  });

  it('我要扣分嘍：最多疊 3 層，每層攻擊力 -10%', () => {
    const { w, a, b } = duel('joeman', 'jiang');
    const def = { type: 'atkDown' as const, value: 0.1, duration: 300, stack: 3, to: 'self' as const };
    for (let i = 0; i < 5; i++) addBuff(b, def);
    expect(getBuff(b, 'atkDown')!.n).toBe(3);
    // 被扣分的人出拳傷害變成 70%
    const hp = a.hp;
    w.step([NONE, snapshotFrom({ A: true })]);
    idle(w, 12);
    const plain = duel();
    plain.w.step([NONE, snapshotFrom({ A: true })]);
    idle(plain.w, 12);
    expect(hp - a.hp).toBeCloseTo((plain.a.maxHp - plain.a.hp) * 0.7, 5);
  });

  it('掛號：3 秒後爆炸', () => {
    const { w, a, b } = duel('lai', 'jiang');
    addBuff(b, { type: 'bomb', value: 52, duration: 180, to: 'self' }, a.id);
    idle(w, 179);
    expect(b.hp).toBe(b.maxHp);
    idle(w, 1);
    expect(b.hp).toBe(b.maxHp - 52);
    expect(b.state).toBe('falling');
  });

  it('質詢時間到：倒數中放招會被取消並受傷', () => {
    const { w, a, b } = duel('huang', 'jiang');
    b.x = 800;
    cast(w, 'D^J');
    expect(hasBuff(b, 'mark')).toBe(true);
    idle(w, 30);
    const hp = b.hp;
    cast(w, 'D>A', 1);
    expect(b.hp).toBe(hp - 45);
    expect(hasBuff(b, 'mark')).toBe(false);
    expect(b.state).toBe('falling');
    expect(a.stats.damage).toBeGreaterThanOrEqual(45);
  });
});

describe('策反', () => {
  it('2 對 2：被策反的人會打到自己原本的隊友', () => {
    const { w, c } = team4(['howhow', 'jiang', 'jiang', 'jiang']);
    const [hh, , victim, mate] = c;
    victim.x = 500;
    mate.x = 530;
    victim.facing = 1;
    addBuff(victim, { type: 'charm', value: 0, duration: 120, to: 'self' }, hh.id, hh.team);
    w.step([NONE, NONE, snapshotFrom({ A: true }), NONE]);
    idle(w, 12);
    expect(mate.hp).toBeLessThan(mate.maxHp);
  });

  it('1 對 1：沒有隊友可打，改成方向顛倒', () => {
    const { w, a, b } = duel('howhow', 'jiang');
    b.x = 600;
    cast(w, 'D^J');
    idle(w, 40);
    expect(hasBuff(b, 'charm')).toBe(false);
    expect(hasBuff(b, 'reverse')).toBe(true);
    expect(a.hp).toBe(a.maxHp);
  });
});

describe('自己的增益', () => {
  it('識讀護盾：飛行物被反彈回去打到對手', () => {
    const { w, a, b } = duel('puma', 'jiang');
    b.x = 650;
    b.facing = -1;
    cast(w, 'D^A');
    idle(w, 25);
    expect(hasBuff(a, 'reflect')).toBe(true);
    cast(w, 'D>A', 1); // 講萬安丟公文
    idle(w, 90);
    expect(a.hp).toBe(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('都有掌握：擋下下一次攻擊並反擊', () => {
    const { w, a, b } = duel('jiang', 'jiang');
    cast(w, 'D^A');
    idle(w, 20);
    w.step([NONE, snapshotFrom({ A: true })]);
    idle(w, 10);
    expect(a.hp).toBe(a.maxHp);
    expect(b.hp).toBe(b.maxHp - 36);
    expect(hasBuff(a, 'counter')).toBe(false);
  });

  it('IQ 157：下一下傷害 ×1.57', () => {
    const plain = duel('ko', 'jiang');
    const crit = duel('ko', 'jiang');
    addBuff(crit.a, { type: 'crit', value: 1, duration: 180, to: 'self' });
    for (const d of [plain, crit]) {
      d.w.step([snapshotFrom({ A: true }), NONE]);
      idle(d.w, 12);
    }
    expect(crit.b.maxHp - crit.b.hp).toBeCloseTo((plain.b.maxHp - plain.b.hp) * 1.57, 5);
    expect(hasBuff(crit.a, 'crit')).toBe(false);
  });

  it('漲停板：血少於一半時傷害加倍', () => {
    const plain = duel('yu', 'jiang');
    const rage = duel('yu', 'jiang');
    addBuff(rage.a, { type: 'rage', value: 1, duration: 300, to: 'self' });
    rage.a.hp = rage.a.maxHp * 0.4;
    for (const d of [plain, rage]) {
      d.w.step([snapshotFrom({ A: true }), NONE]);
      idle(d.w, 12);
    }
    expect(rage.b.maxHp - rage.b.hp).toBeCloseTo((plain.b.maxHp - plain.b.hp) * 2, 5);
  });

  it('操心愛的人：有隊友時護盾給隊友', () => {
    const { w, c } = team4(['yu', 'jiang', 'jiang', 'jiang']);
    w.chars()[2].x = w.chars()[3].x = 1200;
    w.step([snapshotFrom({ D: true, up: true }), NONE, NONE, NONE]);
    w.step([snapshotFrom({ D: true, up: true, J: true }), NONE, NONE, NONE]);
    expect(hasBuff(c[1], 'dmgReduce')).toBe(true);
    expect(hasBuff(c[0], 'dmgReduce')).toBe(false);
  });

  it('爆氣摔器材：HP 低於 30% 才能用', () => {
    const { w, a } = duel('frog', 'jiang');
    cast(w, 'D^A');
    expect(a.frame).not.toBe('rage_1');
    idle(w, 30);
    a.hp = a.maxHp * 0.25;
    cast(w, 'D^A');
    expect(a.frame).toBe('rage_1');
  });
});

describe('招式動作', () => {
  it('築一道高牆：擋住敵人走過去，也擋住飛行物', () => {
    const { w, a, b } = duel('trump', 'jiang');
    b.x = 700;
    b.facing = -1;
    cast(w, 'D^A');
    idle(w, 20);
    const wall = w.entities.find((e) => e.projId === 'trump.bigwall')!;
    expect(wall).toBeDefined();
    for (let i = 0; i < 120; i++) w.step([NONE, snapshotFrom({ left: true })]);
    expect(b.x).toBeGreaterThan(wall.x);
    cast(w, 'D>A', 1);
    idle(w, 60);
    expect(a.hp).toBe(a.maxHp);
  });

  it('防火長城比較矮，跳得過去', () => {
    expect(data.projectiles['xi.greatwall'].wall!.h).toBeLessThan(80);
    expect(data.projectiles['xi.greatwall'].wall!.w).toBeGreaterThan(data.projectiles['trump.bigwall'].wall!.w);
  });

  it('舌頭勾：把遠處的敵人拉到面前', () => {
    const { w, a, b } = duel('frog', 'jiang');
    b.x = 560;
    cast(w, 'D^J');
    idle(w, 20);
    expect(Math.abs(b.x - a.x)).toBeLessThan(40);
    expect(b.state).toBe('dizzy');
  });

  it('柔道過肩摔：防禦也擋不住，摔到身後', () => {
    const { w, a, b } = duel('pudding', 'jiang');
    setState(b, 'defend');
    for (let i = 0; i < 3; i++) w.step([i === 0 ? snapshotFrom({ D: true, right: true }) : snapshotFrom({ D: true, right: true, J: i === 1 }), snapshotFrom({ D: true })]);
    for (let i = 0; i < 20; i++) w.step([NONE, snapshotFrom({ D: true })]);
    expect(b.hp).toBeLessThan(b.maxHp - 40);
    expect(b.x).toBeLessThan(a.x + 5);
  });

  it('繞遠路：出現在對手背後', () => {
    const { w, a, b } = duel('puma', 'jiang');
    b.x = 520;
    b.facing = -1;
    cast(w, 'D>J');
    idle(w, 14);
    expect(a.x).toBeGreaterThan(b.x);
    expect(a.facing).toBe(-1);
  });

  it('疫苗針筒：打到隊友時補血', () => {
    const { w, c } = team4(['lai', 'jiang', 'jiang', 'jiang']);
    const [lai, mate] = c;
    lai.x = 300;
    mate.x = 400;
    mate.hp = 100;
    w.chars()[2].x = w.chars()[3].x = 1500;
    w.step([snapshotFrom({ D: true, down: true }), NONE, NONE, NONE]);
    w.step([snapshotFrom({ D: true, down: true, J: true }), NONE, NONE, NONE]);
    for (let i = 0; i < 40; i++) w.step([NONE, NONE, NONE, NONE]);
    expect(mate.hp).toBe(160);
  });

  it('空！：範圍內敵人的 MP 被清空', () => {
    const { w, b } = duel('lai', 'jiang');
    cast(w, 'DvA');
    idle(w, 12);
    expect(b.mp).toBeLessThan(5);
  });

  it('颱風假：全場敵人定身', () => {
    const { w, b } = duel('jiang', 'jiang');
    b.x = 1200;
    cast(w, 'DvJ');
    idle(w, 16);
    expect(hasBuff(b, 'stun')).toBe(true);
  });

  it('好吃好吃：按住越久補越多', () => {
    const short = duel('aga', 'jiang');
    const long = duel('aga', 'jiang');
    for (const d of [short, long]) {
      d.b.x = 1200;
      d.a.hp = 200;
    }
    cast(short.w, 'D^J', 0, 1);
    cast(long.w, 'D^J', 0, 120);
    idle(short.w, 40);
    idle(long.w, 40);
    expect(long.a.hp).toBeGreaterThan(short.a.hp + 50);
  });

  it('大胃王蓄力：按越久震地越痛', () => {
    const short = duel('joeman', 'jiang');
    const long = duel('joeman', 'jiang');
    cast(short.w, 'DvA', 0, 1);
    cast(long.w, 'DvA', 0, 100);
    idle(short.w, 40);
    idle(long.w, 40);
    expect(long.b.maxHp - long.b.hp).toBeGreaterThan((short.b.maxHp - short.b.hp) * 1.8);
  });

  it('開箱翻車：同樣的種子結果一樣（決定論）', () => {
    const run = () => {
      const { w, a } = duel('joeman', 'jiang', 42);
      cast(w, 'D>A');
      idle(w, 10);
      return a.frame;
    };
    expect(run()).toBe(run());
  });

  it('傳承精神：分身在旁邊跟著打', () => {
    const { w, a, b } = duel('gym', 'jiang');
    b.z = 80; // 本尊打不到、分身打得到
    cast(w, 'D^J');
    idle(w, 22);
    expect(hasBuff(a, 'clone')).toBe(true);
    w.step([snapshotFrom({ A: true }), NONE]);
    idle(w, 12);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('灌籃：跳到敵人身上', () => {
    const { w, a, b } = duel('kim', 'jiang');
    b.x = 560;
    cast(w, 'D^J');
    idle(w, 40);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(Math.abs(a.x - 560)).toBeLessThan(60);
  });
});

describe('台詞', () => {
  it('每名可選角色都有勝利口頭禪', () => {
    for (const id of data.selectable) expect(data.characters[id].quote.length, id).toBeGreaterThan(0);
  });
  it('每一招放出時都會喊話', () => {
    for (const id of data.selectable) {
      const c = data.characters[id];
      for (const m of c.moves) {
        const key = m.startFrame.slice(0, m.startFrame.lastIndexOf('_') + 1);
        const said = Object.entries(c.frames).some(([k, f]) => k.startsWith(key) && f.say);
        expect(said, `${id} ${m.name}`).toBe(true);
      }
    }
  });
  it('習大包與揪門有被 KO 台詞', () => {
    expect(data.characters.xi.koQuote).toBe('我們懷念他');
    expect(data.characters.joeman.koQuote).toBe('對不起！');
  });
});
