import { describe, expect, it } from 'vitest';
import { matchOriginalCase } from '../chatImagePrompts';
import { splitMasterImageRgba } from '../imageLayerProcessor';
import { boxesFromProbabilityMap, prepareDetectorInput } from '../textDetection';

function canvas(w: number, h: number, rgb: [number, number, number]) {
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) buf.set([rgb[0], rgb[1], rgb[2], 255], p * 4);
  return buf;
}
function rect(buf: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) buf.set([rgb[0], rgb[1], rgb[2], 255], (y * w + x) * 4);
}

describe('text detection (bundled detector) plumbing and use', () => {
  it('prepares a BGR, normalised, 32-aligned input no longer than 960 px', () => {
    const { input, inW, inH } = prepareDetectorInput(canvas(2000, 600, [255, 0, 0]), 2000, 600);
    expect(inW % 32).toBe(0);
    expect(inH % 32).toBe(0);
    expect(Math.max(inW, inH)).toBeLessThanOrEqual(960);
    // Pure red: channel 0 is BLUE (0) and channel 2 is RED (255), normalised
    expect(input[0]).toBeCloseTo((0 - 0.485) / 0.229, 3);
    expect(input[2 * inW * inH]).toBeCloseTo((1 - 0.406) / 0.225, 3);
  });

  it('turns a probability map into expanded boxes at picture resolution, dropping weak regions', () => {
    const inW = 64;
    const inH = 32;
    const prob = new Float32Array(inW * inH);
    for (let y = 10; y < 20; y++) for (let x = 8; x < 40; x++) prob[y * inW + x] = 0.95; // text
    for (let y = 2; y < 6; y++) for (let x = 50; x < 60; x++) prob[y * inW + x] = 0.4; // weak
    const det = boxesFromProbabilityMap(prob, inW, inH, 640, 320);
    expect(det.boxes).toHaveLength(1);
    const b = det.boxes[0]!;
    expect(b.minX).toBeLessThan(80);
    expect(b.maxX).toBeGreaterThan(400);
    expect(b.minY).toBeLessThan(100);
    expect(b.maxY).toBeGreaterThan(200);
    expect(det.mask[150 * 640 + 240]).toBe(1);
    expect(det.mask[20 * 640 + 550]).toBe(0);
  });

  it('with a detected text area, line art that touches the lettering stays in the Clean Background (hoodie "RECORDS" over a drawn figure)', () => {
    const w = 640;
    const h = 400;
    const red: [number, number, number] = [170, 30, 40];
    const white: [number, number, number] = [235, 235, 235];
    const buf = canvas(w, h, [18, 18, 20]);
    // Line-art figure: tall white outline running far above and below the lettering
    rect(buf, w, 290, 30, 296, 370, white);
    rect(buf, w, 344, 30, 350, 370, white);
    rect(buf, w, 290, 30, 350, 36, white);
    rect(buf, w, 290, 364, 350, 370, white);
    // Seven red letters across the middle
    const xs = [60, 140, 220, 300, 380, 460, 540];
    for (const x of xs) {
      rect(buf, w, x, 170, x + 44, 240, red);
      rect(buf, w, x + 10, 182, x + 34, 228, [18, 18, 20]);
    }
    // The detector found the word's line of text
    const textMask = new Uint8Array(w * h);
    for (let y = 160; y <= 250; y++) textMask.fill(1, y * w + 50, y * w + 600);

    // First attempt (as in the extension) lets the tall figure take over; the detector-guided
    // second attempt cuts every shape to the detected text line
    const first = splitMasterImageRgba(buf.slice(), w, h, { targetWord: 'Records', textMask });
    expect(first.quality.fontOk).toBe(false);
    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'Records', textMask, textMaskMode: 'clip' });
    expect(split.quality.fontOk).toBe(true);
    expect(split.applied).toBe(true);
    // The figure's outline (well outside the text line) is NOT cut out as lettering
    expect(split.fontData[(100 * w + 293) * 4 + 3]).toBe(0);
    expect(split.backgroundData[(100 * w + 293) * 4]).toBeGreaterThan(200);
    // The red letters are in the Font
    for (const x of [60, 140, 460, 540]) expect(split.fontData[(200 * w + x + 4) * 4 + 3]).toBe(255);
  });

  it('matches the original letter case: all-caps logo -> capitals, all-lowercase -> lowercase', () => {
    expect(matchOriginalCase('INSOMNIA', 'In case u 2')).toBe('IN CASE U 2');
    expect(matchOriginalCase('crave', 'Make it')).toBe('make it');
    expect(matchOriginalCase('Netflix', 'Make it')).toBeNull();
    expect(matchOriginalCase('INSOMNIA', 'HELLO')).toBeNull();
    expect(matchOriginalCase('', 'Hello')).toBeNull();
  });
});