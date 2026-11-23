import { splitMasterImageRgba } from '../../core/imageLayerProcessor';
import { measureLetteringRgba, type LetteringMetrics } from '../../core/letteringMetrics';

/**
 * Decodes a picture, splits it locally and measures the lettering found in it. Used on the
 * ORIGINAL capture before prompt 1. Returns null (never throws) when no trustworthy lettering
 * is found, in which case the prompt simply goes out without measurements.
 */
export async function measureLetteringFromDataUrl(
  dataUrl: string,
  targetWord?: string
): Promise<LetteringMetrics | null> {
  if (typeof document === 'undefined' || !dataUrl.startsWith('data:image/')) return null;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = dataUrl;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w < 16 || h < 16) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const split = splitMasterImageRgba(data, w, h, { targetWord });
    if (!split.applied || !split.quality.fontOk) return null;
    return measureLetteringRgba(split.fontData, w, h);
  } catch {
    return null;
  }
}