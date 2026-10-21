// 結算畫面的口頭禪排版：放不下就縮字、換成兩行，再不行改用短版台詞。

export interface QuoteLayout {
  lines: string[];
  size: number;
}

const SIZES = [14, 12];

/**
 * 把一句話拆成兩行：優先在中間附近的標點後面斷開，沒有標點就從中間切。
 */
export function splitTwo(s: string): [string, string] {
  const mid = s.length / 2;
  let best = -1;
  for (let i = 1; i < s.length - 1; i++) {
    if ('，、。！？；：,!? '.includes(s[i]) && (best < 0 || Math.abs(i + 1 - mid) < Math.abs(best - mid))) best = i + 1;
  }
  const cut = best > 0 && Math.abs(best - mid) <= s.length / 4 ? best : Math.ceil(mid);
  return [s.slice(0, cut), s.slice(cut)];
}

/**
 * measure(text, size) 回傳文字寬度。依序嘗試：完整台詞一行 → 縮字一行 → 縮字兩行 → 短版台詞。
 * 都放不下時用最後一個嘗試（短版、最小字、兩行）。
 */
export function fitQuote(quote: string, short: string | undefined, maxW: number, measure: (s: string, size: number) => number): QuoteLayout {
  const candidates = short && short !== quote ? [quote, short] : [quote];
  let last: QuoteLayout = { lines: [quote], size: SIZES[SIZES.length - 1] };
  for (const q of candidates) {
    for (const size of SIZES) {
      const one = `「${q}」`;
      if (measure(one, size) <= maxW) return { lines: [one], size };
    }
    const size = SIZES[SIZES.length - 1];
    const [a, b] = splitTwo(q);
    const two = [`「${a}`, `${b}」`];
    last = { lines: two, size };
    if (two.every((l) => measure(l, size) <= maxW)) return last;
  }
  return last;
}
