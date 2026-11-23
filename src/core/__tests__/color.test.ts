import { describe, expect, it } from 'vitest';
import {
  compositeOver,
  contrastRatio,
  isDarkColor,
  isNeutralColor,
  parseCssColor,
  rgbaToHex,
} from '../color';

describe('color utilities', () => {
  it('parses rgb, rgba, modern slash syntax, and hex notations', () => {
    expect(parseCssColor('rgb(15, 23, 42)')).toEqual({ r: 15, g: 23, b: 42, a: 1 });
    expect(parseCssColor('rgba(255, 255, 255, 0.5)')).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
    expect(parseCssColor('rgb(99 102 241 / 50%)')).toEqual({ r: 99, g: 102, b: 241, a: 0.5 });
    expect(parseCssColor('#0f172a')).toEqual({ r: 15, g: 23, b: 42, a: 1 });
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseCssColor('none')).toBeNull();
  });

  it('composites translucent layers over opaque backgrounds accurately', () => {
    const fg = { r: 255, g: 255, b: 255, a: 0.5 };
    const bg = { r: 0, g: 0, b: 0, a: 1 };
    const out = compositeOver(fg, bg);
    expect(out.r).toBe(128);
    expect(out.g).toBe(128);
    expect(out.b).toBe(128);
    expect(out.a).toBe(1);
    expect(rgbaToHex(out)).toBe('#808080');
  });

  it('computes exact WCAG 2.1 contrast ratios', () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    expect(contrastRatio(black, white)).toBe(21);
    expect(contrastRatio(white, white)).toBe(1);

    const slateText = { r: 244, g: 244, b: 245, a: 1 };
    const darkBg = { r: 9, g: 9, b: 11, a: 1 };
    expect(contrastRatio(slateText, darkBg)).toBeGreaterThan(17);
  });

  it('classifies dark vs light and neutral vs chromatic accents', () => {
    expect(isDarkColor({ r: 15, g: 23, b: 42 })).toBe(true);
    expect(isDarkColor({ r: 248, g: 250, b: 252 })).toBe(false);
    expect(isNeutralColor({ r: 113, g: 113, b: 122 })).toBe(true);
    expect(isNeutralColor({ r: 99, g: 102, b: 241 })).toBe(false);
  });
});
