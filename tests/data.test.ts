import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data/load';
import baseFrames from '../src/data/base_frames.json';
import items from '../src/data/items.json';
import stages from '../src/data/stages.json';
import jiang from '../src/data/characters/jiang.json';
import { data } from './helpers';

describe('資料', () => {
  it('所有 data/ JSON 通過 schema 與交叉檢查', () => {
    expect(data.errors).toEqual([]);
  });

  it('4 名可選角色 + 保全機器人', () => {
    expect(data.selectable.length).toBeGreaterThanOrEqual(4);
    expect(data.characters.guardbot).toBeDefined();
    expect(data.selectable).not.toContain('guardbot');
  });

  it('每個 next 指向存在的幀，每招 startFrame 存在', () => {
    for (const c of Object.values(data.characters)) {
      for (const [name, f] of Object.entries(c.frames)) {
        expect(f.next === 'idle' || !!c.frames[f.next], `${c.id}.${name}.next`).toBe(true);
      }
      for (const m of c.moves) expect(c.frames[m.startFrame], `${c.id}.${m.startFrame}`).toBeDefined();
      for (const [pid, p] of Object.entries(c.projectiles)) {
        for (const f of Object.values(p.frames))
          expect(f.next === 'expire' || !!p.frames[f.next], `${c.id}.${pid}`).toBe(true);
      }
    }
  });

  it('每名主角色有 3–6 招', () => {
    for (const id of data.selectable) {
      const n = data.characters[id].moves.length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  it('新增 JSON 不改程式即出現在選角', () => {
    const extra = { ...jiang, id: 'newcomer', name: '新角色' };
    const d = loadGameData({
      characters: [
        { path: 'jiang.json', json: jiang },
        { path: 'newcomer.json', json: extra },
      ],
      baseFrames: { path: 'base', json: baseFrames },
      items: { path: 'items', json: items },
      stages: { path: 'stages', json: stages },
    });
    expect(d.selectable).toContain('newcomer');
  });

  it('格式錯誤時列出檔名與欄位', () => {
    const bad = { ...jiang, id: 'bad', stats: { ...jiang.stats, hp: 'x' } };
    const d = loadGameData({
      characters: [{ path: 'bad.json', json: bad }],
      baseFrames: { path: 'base', json: baseFrames },
      items: { path: 'items', json: items },
      stages: { path: 'stages', json: stages },
    });
    expect(d.errors.some((e) => e.includes('bad.json') && e.includes('stats.hp'))).toBe(true);
    expect(d.characters.bad).toBeUndefined();
  });
});

describe('角色外型', () => {
  it('每名可選角色都有自己的體型、腿長、臉型、眉型', () => {
    for (const id of data.selectable) {
      const look = data.characters[id].look;
      expect(['slim', 'normal', 'stout', 'muscular'], id).toContain(look.build);
      expect(look.height, id).toBeGreaterThanOrEqual(0.8);
      expect(['round', 'square', 'long'], id).toContain(look.face);
    }
    // 不是所有人都一樣：至少用到 3 種體型、3 種臉型、4 種眉型
    const kinds = (k: 'build' | 'face' | 'brows') => new Set(data.selectable.map((id) => data.characters[id].look[k])).size;
    expect(kinds('build')).toBeGreaterThanOrEqual(3);
    expect(kinds('face')).toBeGreaterThanOrEqual(3);
    expect(kinds('brows')).toBeGreaterThanOrEqual(4);
  });
});

describe('招牌動作', () => {
  it('角色招式用到的姿勢都存在（打錯字會變回站姿）', async () => {
    const { POSES } = await import('../src/render/poses');
    for (const id of data.selectable)
      for (const [name, f] of Object.entries(data.characters[id].frames)) expect(POSES[f.pose], `${id}.${name}: ${f.pose}`).toBeDefined();
  });
  it('每名角色至少有 3 個招牌動作（不只用共用的施法姿勢）', () => {
    const generic = new Set(['cast_ready', 'cast', 'cast_up', 'idle_0', 'crouch', 'dash', 'punch_ready', 'punch_extend', 'victory', 'slam', 'slam_ready', 'run_attack', 'jet_up', 'flykick', 'kick', 'hurt', 'thumbs', 'wave', 'wave2', 'grab', 'throw', 'throw_ready', 'flex', 'clap', 'fist_pump', 'dizzy']);
    for (const id of data.selectable) {
      const sig = new Set(Object.values(data.characters[id].frames).map((f) => f.pose).filter((p) => !generic.has(p)));
      expect(sig.size, id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('招式說明', () => {
  it('每一招都有說明（遊戲內招式表用）', () => {
    for (const id of data.selectable) for (const m of data.characters[id].moves) expect(m.desc, `${id} ${m.name}`).toBeTruthy();
  });
});
