import { describe, expect, it } from 'vitest';
import { DONATE_URL, donateUrl } from '../src/donate';

describe('贊助連結', () => {
  it('只接受 https 網址', () => {
    expect(donateUrl('https://p.ecpay.com.tw/ABC123')).toBe('https://p.ecpay.com.tw/ABC123');
    expect(donateUrl('http://p.ecpay.com.tw/ABC123')).toBeNull();
    expect(donateUrl('javascript:alert(1)')).toBeNull();
    expect(donateUrl('')).toBeNull();
  });
  it('設定的網址必須是空的（不顯示）或合法的 https', () => {
    expect(DONATE_URL === '' || donateUrl(DONATE_URL) !== null).toBe(true);
  });
});
