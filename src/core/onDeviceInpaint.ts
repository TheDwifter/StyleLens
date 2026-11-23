/**
 * On-device rebuild of the picture behind erased lettering, using a fixed-size inpainting model
 * (LaMa, 512x512). This file is pure pixel plumbing and has no dependency on any runtime: the
 * model itself is injected as `runModel`, so it is testable and the model engine stays lazy.
 *
 * Pipeline: widen the erase mask slightly -> crop a padded box around it -> resize the crop to
 * the model's square -> run the model -> resize its answer back -> paste ONLY inside the
 * (feathered) erase mask, so every pixel that was never erased stays exactly as it was.
 */

/** LaMa's fixed working resolution. */
export const INPAINT_MODEL_SIZE = 512;

/**
 * Runs the inpainting model once.
 * - `image`: RGB planes (R plane, G plane, B plane), each `size*size`, values 0..1
 * - `mask`: one plane, `size*size`, 1 = rebuild this pixel, 0 = keep
 * - returns RGB planes, `3*size*size`, values 0..255
 */
export type InpaintModelRunner = (
  image: Float32Array,
  mask: Float32Array,
  size: number
) => Promise<Float32Array>;

export interface InpaintJob {
  /** Model inputs. */
  image: Float32Array;
  mask: Float32Array;
  size: number;
  /** Crop of the source picture that the model sees. */
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  /** The widened erase mask at full resolution (1 = rebuilt). */
  holeMask: Uint8Array;
}

function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return new Uint8Array(mask);
  const horizontal = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let lastOn = -Infinity;
    // Two sweeps give an exact horizontal dilation in O(width)
    for (let x = 0; x < width; x++) {
      if (mask[row + x]) lastOn = x;
      if (x - lastOn <= radius) horizontal[row + x] = 1;
    }
    lastOn = Infinity;
    for (let x = width - 1; x >= 0; x--) {
      if (mask[row + x]) lastOn = x;
      if (lastOn - x <= radius) horizontal[row + x] = 1;
    }
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let lastOn = -Infinity;
    for (let y = 0; y < height; y++) {
      if (horizontal[y * width + x]) lastOn = y;
      if (y - lastOn <= radius) out[y * width + x] = 1;
    }
    lastOn = Infinity;
    for (let y = height - 1; y >= 0; y--) {
      if (horizontal[y * width + x]) lastOn = y;
      if (lastOn - y <= radius) out[y * width + x] = 1;
    }
  }
  return out;
}

/**
 * Builds the model inputs for one picture. Returns null when there is nothing to rebuild.
 * The mask is widened a little because any lettering edge left OUTSIDE the hole is smeared by
 * the model back into it as a ghost of the word.
 */
export function prepareInpaintJob(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  eraseMask: Uint8Array,
  size = INPAINT_MODEL_SIZE
): InpaintJob | null {
  if (width < 8 || height < 8 || eraseMask.length < width * height) return null;
  // About 1.2% of the short side (7px on a 1024x615 picture). Where lettering lies on artwork the
  // erase mask stops exactly at the artwork, so the blended letter edge is still outside it.
  const extra = Math.max(6, Math.round(Math.min(width, height) * 0.012));
  const holeMask = dilateMask(eraseMask, width, height, extra);

  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!holeMask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;

  // Generous context around the hole: the model needs to SEE the artwork it must continue
  const padX = Math.round((maxX - minX + 1) * 0.2) + 24;
  const padY = Math.round((maxY - minY + 1) * 0.35) + 24;
  const cropX = Math.max(0, minX - padX);
  const cropY = Math.max(0, minY - padY);
  const cropWidth = Math.min(width - 1, maxX + padX) - cropX + 1;
  const cropHeight = Math.min(height - 1, maxY + padY) - cropY + 1;

  const plane = size * size;
  const image = new Float32Array(3 * plane);
  const mask = new Float32Array(plane);
  for (let y = 0; y < size; y++) {
    const fy = ((y + 0.5) * cropHeight) / size - 0.5;
    const y0 = Math.max(0, Math.min(cropHeight - 1, Math.floor(fy)));
    const y1 = Math.min(cropHeight - 1, y0 + 1);
    const ty = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < size; x++) {
      const fx = ((x + 0.5) * cropWidth) / size - 0.5;
      const x0 = Math.max(0, Math.min(cropWidth - 1, Math.floor(fx)));
      const x1 = Math.min(cropWidth - 1, x0 + 1);
      const tx = Math.min(1, Math.max(0, fx - x0));
      const p00 = ((cropY + y0) * width + (cropX + x0)) * 4;
      const p10 = ((cropY + y0) * width + (cropX + x1)) * 4;
      const p01 = ((cropY + y1) * width + (cropX + x0)) * 4;
      const p11 = ((cropY + y1) * width + (cropX + x1)) * 4;
      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;
      const i = y * size + x;
      for (let c = 0; c < 3; c++) {
        image[c * plane + i] =
          (rgba[p00 + c]! * w00 + rgba[p10 + c]! * w10 + rgba[p01 + c]! * w01 + rgba[p11 + c]! * w11) /
          255;
      }
      // A model pixel is a hole if ANY source pixel it covers is
      mask[i] =
        holeMask[p00 / 4]! | holeMask[p10 / 4]! | holeMask[p01 / 4]! | holeMask[p11 / 4]! ? 1 : 0;
    }
  }
  return { image, mask, size, cropX, cropY, cropWidth, cropHeight, holeMask };
}

/**
 * Pastes the model's answer back into a copy of the picture. Only pixels inside the hole change;
 * a 3px feather hides the seam. Returns null if the model output has the wrong size.
 */
export function compositeInpaintResult(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  job: InpaintJob,
  modelOutput: Float32Array
): Uint8ClampedArray | null {
  const { size, cropX, cropY, cropWidth, cropHeight, holeMask } = job;
  const plane = size * size;
  if (modelOutput.length < 3 * plane) return null;

  // Some exports answer in 0..1 instead of 0..255
  let peak = 0;
  for (let i = 0; i < modelOutput.length; i += 251) {
    if (modelOutput[i]! > peak) peak = modelOutput[i]!;
  }
  const scale = peak > 2 ? 1 : 255;

  const out = new Uint8ClampedArray(rgba);
  const feather = 3;
  for (let y = cropY; y < cropY + cropHeight; y++) {
    for (let x = cropX; x < cropX + cropWidth; x++) {
      let on = 0;
      let seen = 0;
      for (let dy = -feather; dy <= feather; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -feather; dx <= feather; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          on += holeMask[ny * width + nx]!;
          seen += 1;
        }
      }
      if (on === 0) continue;
      const alpha = on / seen;
      const fx = ((x - cropX + 0.5) * size) / cropWidth - 0.5;
      const fy = ((y - cropY + 0.5) * size) / cropHeight - 0.5;
      const x0 = Math.max(0, Math.min(size - 1, Math.floor(fx)));
      const y0 = Math.max(0, Math.min(size - 1, Math.floor(fy)));
      const x1 = Math.min(size - 1, x0 + 1);
      const y1 = Math.min(size - 1, y0 + 1);
      const tx = Math.min(1, Math.max(0, fx - x0));
      const ty = Math.min(1, Math.max(0, fy - y0));
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const base = c * plane;
        const value =
          (modelOutput[base + y0 * size + x0]! * (1 - tx) * (1 - ty) +
            modelOutput[base + y0 * size + x1]! * tx * (1 - ty) +
            modelOutput[base + y1 * size + x0]! * (1 - tx) * ty +
            modelOutput[base + y1 * size + x1]! * tx * ty) *
          scale;
        out[o + c] = out[o + c]! * (1 - alpha) + value * alpha;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Rebuilds everything under `eraseMask` with the injected model. Returns the rebuilt picture, or
 * null when there was nothing to rebuild or the model failed (callers then fall back).
 */
export async function inpaintErasedRegion(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  eraseMask: Uint8Array,
  runModel: InpaintModelRunner
): Promise<Uint8ClampedArray | null> {
  const job = prepareInpaintJob(rgba, width, height, eraseMask);
  if (!job) return null;
  const output = await runModel(job.image, job.mask, job.size);
  return compositeInpaintResult(rgba, width, height, job, output);
}
