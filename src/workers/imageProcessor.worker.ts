import { colorDistance, rgbaToHex } from '../core/color';
import type { SampledColor } from '../types/capture';
import type { ImageWorkerRequest, ImageWorkerResponse } from '../types/messages';

function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) {
    throw new Error('Malformed screenshot data URL.');
  }
  const header = dataUrl.slice(0, commaIdx);
  const mimeMatch = header.match(/data:([^;]+);base64/);
  const mimeType = mimeMatch?.[1] ?? 'image/png';
  const base64 = dataUrl.slice(commaIdx + 1);
  const binaryStr = atob(base64);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

interface ColorBucket {
  rSum: number;
  gSum: number;
  bSum: number;
  count: number;
}

/**
 * Extracts dominant visual colors using fast 5-bit channel quantization (32^3 grid)
 * followed by perceptual distance merging. Runs in < 3 ms on a 72x72 sample canvas.
 */
function extractDominantColors(
  imageData: ImageData,
  maxColors: number
): SampledColor[] {
  const { data } = imageData;
  const buckets = new Map<number, ColorBucket>();
  let totalVisiblePixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 128) continue;

    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    totalVisiblePixels += 1;

    // 5-bit quantization per channel (0..31)
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const existing = buckets.get(key);
    if (existing) {
      existing.rSum += r;
      existing.gSum += g;
      existing.bSum += b;
      existing.count += 1;
    } else {
      buckets.set(key, { rSum: r, gSum: g, bSum: b, count: 1 });
    }
  }

  if (totalVisiblePixels === 0) return [];

  const sorted = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 64)
    .map((bucket) => ({
      r: Math.round(bucket.rSum / bucket.count),
      g: Math.round(bucket.gSum / bucket.count),
      b: Math.round(bucket.bSum / bucket.count),
      count: bucket.count,
    }));

  // Perceptually merge near-identical quantized buckets
  const merged: Array<{ r: number; g: number; b: number; count: number }> = [];
  for (const candidate of sorted) {
    const match = merged.find((m) => colorDistance(m, candidate) < 28);
    if (match) {
      const combined = match.count + candidate.count;
      match.r = Math.round((match.r * match.count + candidate.r * candidate.count) / combined);
      match.g = Math.round((match.g * match.count + candidate.g * candidate.count) / combined);
      match.b = Math.round((match.b * match.count + candidate.b * candidate.count) / combined);
      match.count = combined;
    } else {
      merged.push({ ...candidate });
    }
  }

  return merged
    .sort((a, b) => b.count - a.count)
    .slice(0, maxColors)
    .map((c) => ({
      hex: rgbaToHex({ r: c.r, g: c.g, b: c.b, a: 1 }),
      rgb: [c.r, c.g, c.b] as [number, number, number],
      percentage: Number(((c.count / totalVisiblePixels) * 100).toFixed(1)),
    }));
}

async function processCaptureImage(req: ImageWorkerRequest): Promise<ImageWorkerResponse> {
  const sourceBlob = dataUrlToBlob(req.fullViewportDataUrl);
  const bitmap = await createImageBitmap(sourceBlob);

  try {
    // Derive exact scale directly from bitmap vs CSS viewport dimensions to eliminate
    // fractional Windows DPI (125%/150%) and browser zoom rounding drift.
    const scaleX = req.viewport.width > 0 ? bitmap.width / req.viewport.width : req.viewport.devicePixelRatio;
    const scaleY = req.viewport.height > 0 ? bitmap.height / req.viewport.height : req.viewport.devicePixelRatio;

    const sx = Math.max(0, Math.min(bitmap.width - 1, Math.round(req.rect.x * scaleX)));
    const sy = Math.max(0, Math.min(bitmap.height - 1, Math.round(req.rect.y * scaleY)));
    const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(req.rect.width * scaleX)));
    const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(req.rect.height * scaleY)));

    const cropCanvas = new OffscreenCanvas(sw, sh);
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) {
      throw new Error('Could not acquire 2D OffscreenCanvas context.');
    }
    cropCtx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

    // Downsample onto a small 72x72 canvas for ultra-fast pixel color quantization
    const sampleMax = 72;
    const aspect = sw / sh;
    const sampleW = Math.max(1, aspect >= 1 ? sampleMax : Math.round(sampleMax * aspect));
    const sampleH = Math.max(1, aspect < 1 ? sampleMax : Math.round(sampleMax / aspect));

    const sampleCanvas = new OffscreenCanvas(sampleW, sampleH);
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    let sampledColors: SampledColor[] = [];
    if (sampleCtx) {
      sampleCtx.drawImage(cropCanvas, 0, 0, sampleW, sampleH);
      const imageData = sampleCtx.getImageData(0, 0, sampleW, sampleH);
      sampledColors = extractDominantColors(imageData, req.maxColors);
    }

    const croppedBlob = await cropCanvas.convertToBlob({ type: 'image/png' });

    return {
      id: req.id,
      ok: true,
      croppedBlob,
      width: sw,
      height: sh,
      sampledColors,
    };
  } finally {
    bitmap.close();
  }
}

self.onmessage = (event: MessageEvent<ImageWorkerRequest>) => {
  const req = event.data;
  processCaptureImage(req)
    .then((response) => self.postMessage(response))
    .catch((err) => {
      const errorResponse: ImageWorkerResponse = {
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(errorResponse);
    });
};
