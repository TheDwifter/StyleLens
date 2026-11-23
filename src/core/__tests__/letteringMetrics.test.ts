import { describe, expect, it } from 'vitest';
import { splitMasterImageRgba } from '../imageLayerProcessor';
import {
  buildStyleCorrectionPrompt,
  compareLettering,
  describeLetteringForPrompt,
  measureLetteringRgba,
} from '../letteringMetrics';

function canvas(w: number, h: number, rgb: [number, number, number]) {
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    buf[p * 4] = rgb[0];
    buf[p * 4 + 1] = rgb[1];
    buf[p * 4 + 2] = rgb[2];
    buf[p * 4 + 3] = 255;
  }
  return buf;
}

function rect(
  buf: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number]
) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = (y * w + x) * 4;
      buf[o] = rgb[0];
      buf[o + 1] = rgb[1];
      buf[o + 2] = rgb[2];
      buf[o + 3] = 255;
    }
  }
}

/** Ring-shaped "letters" (outer box minus inner box) so stroke thickness is well defined. */
function drawWord(
  w: number,
  h: number,
  count: number,
  letterW: number,
  letterH: number,
  stroke: number,
  gap: number
) {
  const buf = canvas(w, h, [2, 3, 46]);
  const total = count * letterW + (count - 1) * gap;
  const x0 = Math.round((w - total) / 2);
  const y0 = Math.round((h - letterH) / 2);
  for (let i = 0; i < count; i++) {
    const lx = x0 + i * (letterW + gap);
    rect(buf, w, lx, y0, lx + letterW - 1, y0 + letterH - 1, [90, 160, 230]);
    rect(buf, w, lx + stroke, y0 + stroke, lx + letterW - 1 - stroke, y0 + letterH - 1 - stroke, [2, 3, 46]);
  }
  return buf;
}

describe('letteringMetrics (measured style of the original vs the AI picture)', () => {
  it('measures letter size, width, stroke weight and spacing in resolution-free units', () => {
    const w = 800;
    const h = 400;
    const split = splitMasterImageRgba(drawWord(w, h, 5, 80, 80, 20, 12), w, h, { targetWord: 'crave' });
    expect(split.quality.fontOk).toBe(true);
    const m = measureLetteringRgba(split.fontData, w, h)!;
    expect(m.letterCount).toBe(5);
    expect(m.letterHeightFrac).toBeCloseTo(0.2, 1);
    expect(m.letterAspect).toBeCloseTo(1, 1);
    expect(m.strokeRatio).toBeGreaterThan(0.2);
    expect(m.strokeRatio).toBeLessThan(0.3);
    expect(m.spacingRatio).toBeGreaterThan(0.1);
    expect(m.spacingRatio).toBeLessThan(0.2);
    expect(m.cornerFill).toBeGreaterThan(0.85);
    expect(m.heightSpread).toBeLessThan(0.02);
    expect(describeLetteringForPrompt(m)).toContain('heavy strokes');
    expect(describeLetteringForPrompt(m)).toContain('every letter exactly the same height');
    expect(describeLetteringForPrompt(m)).toContain('about 20% of the picture height');
  });

  it('flags an AI picture whose letters are much bigger and narrower (Crave -> "Made it"), and stays quiet on a close match', () => {
    const w = 800;
    const h = 400;
    const measure = (buf: Uint8ClampedArray, word: string) => {
      const s = splitMasterImageRgba(buf, w, h, { targetWord: word });
      return measureLetteringRgba(s.fontData, w, h)!;
    };
    const original = measure(drawWord(w, h, 5, 80, 80, 20, 12), 'crave');
    const drifted = measure(drawWord(w, h, 5, 90, 140, 30, 14), 'Made it');
    const close = measure(drawWord(w, h, 6, 78, 84, 20, 12), 'made it');

    const bad = compareLettering(original, drifted);
    expect(bad.issues).toContain('too-large');
    expect(bad.issues).toContain('too-narrow');
    expect(bad.sizeRatio).toBeGreaterThan(1.6);
    expect(compareLettering(original, close).issues).toEqual([]);

    const prompt = buildStyleCorrectionPrompt('Made it', bad, original);
    expect(prompt).toMatch(/^Create 1 edited image/);
    expect(prompt).toContain('too big');
    expect(prompt).toContain('too narrow');
    expect(prompt).toContain('Spell it exactly: Made it.');
    expect(prompt).toContain('copied exactly from the picture');
    expect(prompt.length).toBeLessThan(1900);
    expect(prompt).not.toMatch(/\btransparent\b|\bcheckerboard\b|\bPNG\b|\bcutout\b/i);
  });

  it('a tightly cropped multi-colour wordmark that fills its picture is NOT mistaken for a busy scene', () => {
    const w = 600;
    const h = 160;
    const buf = canvas(w, h, [255, 255, 255]);
    const colours: Array<[number, number, number]> = [
      [66, 133, 244],
      [219, 68, 55],
      [244, 180, 0],
      [66, 133, 244],
      [15, 157, 88],
      [219, 68, 55],
    ];
    // Ring-shaped letters (real lettering has background inside and between its strokes)
    colours.forEach((c, i) => {
      rect(buf, w, 4 + i * 100, 6, 4 + i * 100 + 84, 152, c);
      rect(buf, w, 4 + i * 100 + 18, 24, 4 + i * 100 + 66, 134, [255, 255, 255]);
    });
    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'Google' });
    expect(split.applied).toBe(true);
    expect(split.quality.reasons).not.toContain('font-too-spread');
    expect(split.quality.fontOk).toBe(true);
  });
});
