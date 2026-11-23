/**
 * Text-region detection with a bundled DBNet model (PaddleOCR PP-OCRv5 mobile detector, 4.8 MB,
 * Apache-2.0). It answers one question the pixel heuristics cannot: WHERE in the picture is
 * there text? Line art, emblems, photos and patterns are not text, even when they share the
 * lettering's colour or touch it.
 *
 * This file is pure pre/post-processing; the model run is injected (`TextDetectorRunner`) so it
 * is testable without a browser and the engine stays lazily loaded.
 */

/** Runs the detector: input is BGR, normalised, CHW float32 [1,3,h,w]; output is a [h*w] probability map. */
export type TextDetectorRunner = (input: Float32Array, width: number, height: number) => Promise<Float32Array>;

export interface TextBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Mean probability inside the region (0..1) */
  score: number;
}

export interface TextDetection {
  boxes: TextBox[];
  /** 1 where a detected text box (after expansion) covers the pixel, at the picture's resolution */
  mask: Uint8Array;
}

const LONG_SIDE = 960;
const MEAN_BGR = [0.485, 0.456, 0.406];
const STD_BGR = [0.229, 0.224, 0.225];
const PIXEL_THRESH = 0.3;
const BOX_THRESH = 0.6;
const UNCLIP_RATIO = 1.5;

/** Resizes (bilinear) to a multiple of 32 with the long side <= 960 and normalises like PaddleOCR. */
export function prepareDetectorInput(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): { input: Float32Array; inW: number; inH: number } {
  const scale = Math.min(1, LONG_SIDE / Math.max(width, height));
  const inW = Math.max(32, Math.round((width * scale) / 32) * 32);
  const inH = Math.max(32, Math.round((height * scale) / 32) * 32);
  const plane = inW * inH;
  const input = new Float32Array(3 * plane);
  for (let y = 0; y < inH; y++) {
    const fy = ((y + 0.5) * height) / inH - 0.5;
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(fy)));
    const y1 = Math.min(height - 1, y0 + 1);
    const ty = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < inW; x++) {
      const fx = ((x + 0.5) * width) / inW - 0.5;
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(fx)));
      const x1 = Math.min(width - 1, x0 + 1);
      const tx = Math.min(1, Math.max(0, fx - x0));
      const i = y * inW + x;
      // Channel order B, G, R (the model was trained on OpenCV BGR images)
      for (let c = 0; c < 3; c++) {
        const src = 2 - c;
        const v =
          rgba[(y0 * width + x0) * 4 + src]! * (1 - tx) * (1 - ty) +
          rgba[(y0 * width + x1) * 4 + src]! * tx * (1 - ty) +
          rgba[(y1 * width + x0) * 4 + src]! * (1 - tx) * ty +
          rgba[(y1 * width + x1) * 4 + src]! * tx * ty;
        input[c * plane + i] = (v / 255 - MEAN_BGR[c]!) / STD_BGR[c]!;
      }
    }
  }
  return { input, inW, inH };
}

/**
 * DBNet post-processing: threshold the probability map, take connected regions, keep the
 * confident ones, expand each box by the "unclip" distance (DB shrinks text kernels), and map
 * back to the picture's resolution.
 */
export function boxesFromProbabilityMap(
  prob: Float32Array,
  inW: number,
  inH: number,
  width: number,
  height: number
): TextDetection {
  const n = inW * inH;
  const label = new Int32Array(n);
  const boxes: TextBox[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < n; start++) {
    if (label[start] !== 0 || prob[start]! <= PIXEL_THRESH) continue;
    next += 1;
    label[start] = next;
    stack.push(start);
    let minX = inW;
    let maxX = -1;
    let minY = inH;
    let maxY = -1;
    let sum = 0;
    let count = 0;
    while (stack.length > 0) {
      const p = stack.pop()!;
      const x = p % inW;
      const y = (p - x) / inW;
      sum += prob[p]!;
      count += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const nbs = [x > 0 ? p - 1 : -1, x < inW - 1 ? p + 1 : -1, y > 0 ? p - inW : -1, y < inH - 1 ? p + inW : -1];
      for (const q of nbs) {
        if (q >= 0 && label[q] === 0 && prob[q]! > PIXEL_THRESH) {
          label[q] = next;
          stack.push(q);
        }
      }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (count < 6 || Math.min(bw, bh) < 3) continue;
    const score = sum / count;
    if (score < BOX_THRESH) continue;
    // Unclip: offset = area * ratio / perimeter (on the box)
    const offset = (bw * bh * UNCLIP_RATIO) / (2 * (bw + bh));
    const sx = width / inW;
    const sy = height / inH;
    boxes.push({
      minX: Math.max(0, Math.floor((minX - offset) * sx)),
      minY: Math.max(0, Math.floor((minY - offset) * sy)),
      maxX: Math.min(width - 1, Math.ceil((maxX + 1 + offset) * sx) - 1),
      maxY: Math.min(height - 1, Math.ceil((maxY + 1 + offset) * sy) - 1),
      score,
    });
  }
  const mask = new Uint8Array(width * height);
  for (const b of boxes) {
    for (let y = b.minY; y <= b.maxY; y++) mask.fill(1, y * width + b.minX, y * width + b.maxX + 1);
  }
  return { boxes, mask };
}

export async function detectText(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  run: TextDetectorRunner
): Promise<TextDetection> {
  const { input, inW, inH } = prepareDetectorInput(rgba, width, height);
  const prob = await run(input, inW, inH);
  return boxesFromProbabilityMap(prob, inW, inH, width, height);
}
