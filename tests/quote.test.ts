import { describe, expect, it } from 'vitest';
import { fitQuote, splitTwo } from '../src/render/quote';
import { data } from './helpers';

// 粗估字寬：中文全形字 = 字級，英數半形 ≈ 0.6 倍（Noto Sans TC 粗體）
const measure = (s: string, size: number) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) < 0x2000 ? 0.6 : 1) * size, 0);

describe('結算畫面口頭禪排版', () => {
  it('雙人勝利（每人 160 px）時每名角色的台詞都放得下', () => {
    for (const id of data.selectable) {
      const def = data.characters[id];
      const fit = fitQuote(def.quote, def.shortQuote, 160, measure);
      expect(fit.lines.length, id).toBeLessThanOrEqual(2);
      for (const l of fit.lines) expect(measure(l, fit.size), `${id}: ${l}`).toBeLessThanOrEqual(160);
    }
  });

  it('單人勝利時用完整台詞', () => {
    const def = data.characters.pudding;
    const fit = fitQuote(def.quote, def.shortQuote, 600, measure);
    expect(fit.lines.join('')).toContain(def.quote);
  });

  it('布丁雙人勝利時改用短版', () => {
    const def = data.characters.pudding;
    expect(fitQuote(def.quote, def.shortQuote, 160, measure).lines.join('')).toContain('送他們去見上帝');
  });

  it('兩行時在標點後斷開', () => {
    expect(splitTwo('貨出得去，人進得來，高雄發大財！')).toEqual(['貨出得去，人進得來，', '高雄發大財！']);
  });
});
