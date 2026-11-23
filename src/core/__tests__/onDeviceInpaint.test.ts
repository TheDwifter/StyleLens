import { describe, expect, it } from 'vitest';
import {
  INPAINT_MODEL_SIZE,
  compositeInpaintResult,
  inpaintErasedRegion,
  prepareInpaintJob,
  type InpaintModelRunner,
} from '../onDeviceInpaint';

function picture(width: number, height: number, rgb: [number, number, number]) {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    buf[p * 4] = rgb[0];
    buf[p * 4 + 1] = rgb[1];
    buf[p * 4 + 2] = rgb[2];
    buf[p * 4 + 3] = 255;
  }
  return buf;
}

function rectMask(width: number, height: number, x0: number, y0: number, x1: number, y1: number) {
  const mask = new Uint8Array(width * height);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) mask[y * width + x] = 1;
  }
  return mask;
}

/** A stand-in model that answers with one flat colour everywhere. */
const flatModel =
  (rgb: [number, number, number], unitScale = false): InpaintModelRunner =>
  async (_image, _mask, size) => {
    const out = new Float32Array(3 * size * size);
    for (let c = 0; c < 3; c++) {
      out.fill(unitScale ? rgb[c]! / 255 : rgb[c]!, c * size * size, (c + 1) * size * size);
    }
    return out;
  };

describe('onDeviceInpaint (bundled-model plumbing for the Clean Background)', () => {
  it('builds model inputs: a padded crop around the hole, picture scaled to 0..1, hole marked 1', () => {
    const w = 400;
    const h = 240;
    const rgba = picture(w, h, [255, 128, 0]);
    const job = prepareInpaintJob(rgba, w, h, rectMask(w, h, 150, 100, 250, 140));
    expect(job).not.toBeNull();
    const { image, mask, size, cropX, cropY, cropWidth, cropHeight } = job!;
    expect(size).toBe(INPAINT_MODEL_SIZE);
    expect(image.length).toBe(3 * size * size);
    expect(mask.length).toBe(size * size);
    // Crop contains the hole plus context, and stays inside the picture
    expect(cropX).toBeLessThan(150);
    expect(cropY).toBeLessThan(100);
    expect(cropX + cropWidth).toBeGreaterThan(250);
    expect(cropY + cropHeight).toBeGreaterThan(140);
    expect(cropX + cropWidth).toBeLessThanOrEqual(w);
    expect(cropY + cropHeight).toBeLessThanOrEqual(h);
    // Colour planes are R, G, B in 0..1
    expect(image[0]).toBeCloseTo(1, 5);
    expect(image[size * size]).toBeCloseTo(128 / 255, 5);
    expect(image[2 * size * size]).toBeCloseTo(0, 5);
    // The hole is present in the model mask, the far corner is not
    const centre = Math.floor(size / 2) * size + Math.floor(size / 2);
    expect(mask[centre]).toBe(1);
    expect(mask[0]).toBe(0);
    expect(mask.every((v) => v === 0 || v === 1)).toBe(true);
  });

  it('returns null when there is nothing to rebuild', async () => {
    const w = 64;
    const h = 64;
    const rgba = picture(w, h, [10, 20, 30]);
    expect(prepareInpaintJob(rgba, w, h, new Uint8Array(w * h))).toBeNull();
    expect(await inpaintErasedRegion(rgba, w, h, new Uint8Array(w * h), flatModel([1, 2, 3]))).toBeNull();
  });

  it('replaces ONLY the erased area: the hole takes the model colour, every other pixel is untouched', async () => {
    const w = 400;
    const h = 240;
    const rgba = picture(w, h, [246, 246, 246]);
    const mask = rectMask(w, h, 150, 100, 250, 140);
    const out = await inpaintErasedRegion(rgba, w, h, mask, flatModel([246, 168, 28]));
    expect(out).not.toBeNull();
    const px = (x: number, y: number) => {
      const o = (y * w + x) * 4;
      return [out![o], out![o + 1], out![o + 2], out![o + 3]];
    };
    // Deep inside the hole: the model's colour
    expect(px(200, 120)).toEqual([246, 168, 28, 255]);
    expect(px(152, 102)).toEqual([246, 168, 28, 255]);
    // Well outside the hole (even inside the crop the model saw): exactly the original
    for (const [x, y] of [
      [0, 0],
      [399, 239],
      [130, 120],
      [270, 120],
      [200, 80],
      [200, 160],
    ] as const) {
      expect(px(x, y)).toEqual([246, 246, 246, 255]);
    }
    // The input picture itself is never modified
    expect(rgba[(120 * w + 200) * 4 + 1]).toBe(246);
  });

  it('accepts a model that answers in 0..1 instead of 0..255', async () => {
    const w = 200;
    const h = 200;
    const rgba = picture(w, h, [0, 0, 0]);
    const out = await inpaintErasedRegion(
      rgba,
      w,
      h,
      rectMask(w, h, 80, 80, 120, 120),
      flatModel([200, 100, 50], true)
    );
    const o = (100 * w + 100) * 4;
    expect(out![o]).toBe(200);
    expect(out![o + 1]).toBe(100);
    expect(out![o + 2]).toBe(50);
  });

  it('rejects a model answer of the wrong size instead of writing garbage', () => {
    const w = 100;
    const h = 100;
    const rgba = picture(w, h, [5, 5, 5]);
    const job = prepareInpaintJob(rgba, w, h, rectMask(w, h, 40, 40, 60, 60))!;
    expect(compositeInpaintResult(rgba, w, h, job, new Float32Array(10))).toBeNull();
  });
});
