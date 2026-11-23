import { measureLetteringRgba, type LetteringMetrics } from './letteringMetrics';
/**
 * Pure-TypeScript 5-stage Transparent PNG Alpha-Matting Engine for StyleLens Layer 2
 * (Isolated Font / Writing cutouts generated on a flat uniform solid backdrop).
 *
 * Stages:
 *   0. Dimension & already-transparent guard
 *   1. Watermark-immune 3-of-4 corner consensus + bilinear local backdrop B(x,y) + uniformity gate
 *   2. Adaptive 4-connected exterior flood-fill (protects thin 1px diagonal italic strokes)
 *   3. Smart enclosed letter-counter hole clearing (o, R, e, a, b, d, p, g, A, B, D, O, P, Q, 0, 8)
 *      with Depth-2 Nested-Island Shield & Thin-Wall Fill-Dominance Shield (never punches out
 *      white-filled outlined letters!)
 *   4. Continuous linear alpha feathering + stabilized Porter-Duff un-premultiplication de-fringing
 *      (eliminates frosty white/black edge halos) + isolated bottom-right watermark speck cleanup
 */

export type RgbTuple = readonly [number, number, number];

export type AlphaMatteRejectReason =
  | 'image-too-small'
  | 'already-transparent'
  | 'corner-mismatch'
  | 'photo-or-textured-border'
  | 'empty-or-solid-image'
  | 'canvas-unavailable';

export interface RgbaAlphaMatteResult {
  applied: boolean;
  reason?: AlphaMatteRejectReason;
  data: Uint8ClampedArray;
  width: number;
  height: number;
  backdropRgb: RgbTuple;
  backdropIsLight: boolean;
  holesCleared: number;
  transparentRatio: number;
}

export interface TransparentWordmarkPngResult {
  applied: boolean;
  reason?: AlphaMatteRejectReason;
  dataUrl: string;
  width: number;
  height: number;
  backdropRgb: RgbTuple;
  backdropIsLight: boolean;
  holesCleared: number;
  transparentRatio: number;
}

function clampByte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentileOf(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[idx]!;
}

function rgbDist(a: RgbTuple, b: RgbTuple): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function relativeLuminance(rgb: RgbTuple): number {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

function samplePatchMedian(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  size: number
): RgbTuple {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      const idx = (y * width + x) * 4;
      rs.push(data[idx]!);
      gs.push(data[idx + 1]!);
      bs.push(data[idx + 2]!);
    }
  }
  return [Math.round(medianOf(rs)), Math.round(medianOf(gs)), Math.round(medianOf(bs))];
}

/**
 * Pure RGBA transparent-cutout processor (zero DOM dependencies — 100% deterministic & testable).
 */
export function extractTransparentWordmarkFromRgba(
  input: Uint8ClampedArray,
  width: number,
  height: number
): RgbaAlphaMatteResult {
  const pixelCount = width * height;
  const copyInput = (): Uint8ClampedArray => new Uint8ClampedArray(input);

  // Stage 0: Dimension & already-transparent guard
  if (width < 16 || height < 16 || input.length < pixelCount * 4) {
    return {
      applied: false,
      reason: 'image-too-small',
      data: copyInput(),
      width,
      height,
      backdropRgb: [255, 255, 255],
      backdropIsLight: true,
      holesCleared: 0,
      transparentRatio: 0,
    };
  }

  let borderTotal = 0;
  let borderTransparent = 0;
  for (let x = 0; x < width; x++) {
    borderTotal += 2;
    if (input[x * 4 + 3]! < 20) borderTransparent += 1;
    if (input[((height - 1) * width + x) * 4 + 3]! < 20) borderTransparent += 1;
  }
  for (let y = 1; y < height - 1; y++) {
    borderTotal += 2;
    if (input[(y * width) * 4 + 3]! < 20) borderTransparent += 1;
    if (input[(y * width + (width - 1)) * 4 + 3]! < 20) borderTransparent += 1;
  }
  if (borderTotal > 0 && borderTransparent / borderTotal >= 0.6) {
    return {
      applied: false,
      reason: 'already-transparent',
      data: copyInput(),
      width,
      height,
      backdropRgb: [255, 255, 255],
      backdropIsLight: true,
      holesCleared: 0,
      transparentRatio: borderTransparent / borderTotal,
    };
  }

  // Stage 1: Watermark-immune 3-of-4 corner consensus + bilinear local backdrop B(x,y)
  const patchSize = clamp(Math.floor(0.025 * Math.min(width, height)), 3, 16);
  const inset = Math.min(1, Math.floor((Math.min(width, height) - patchSize) / 2));
  const rawCorners: [RgbTuple, RgbTuple, RgbTuple, RgbTuple] = [
    samplePatchMedian(input, width, inset, inset, patchSize), // 0: TL
    samplePatchMedian(input, width, width - inset - patchSize, inset, patchSize), // 1: TR
    samplePatchMedian(input, width, inset, height - inset - patchSize, patchSize), // 2: BL
    samplePatchMedian(input, width, width - inset - patchSize, height - inset - patchSize, patchSize), // 3: BR
  ];

  // Check 3-of-4 corner agreement within RGB distance 28 (tolerates Gemini's BR sparkle watermark)
  const agreeCounts = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (i !== j && rgbDist(rawCorners[i]!, rawCorners[j]!) <= 28) {
        agreeCounts[i]! += 1;
      }
    }
  }
  const consensusIndices = agreeCounts
    .map((count, idx) => ({ count, idx }))
    .filter((entry) => entry.count >= 2)
    .map((entry) => entry.idx);

  if (consensusIndices.length < 3) {
    const fallbackRgb = rawCorners[0];
    return {
      applied: false,
      reason: 'corner-mismatch',
      data: copyInput(),
      width,
      height,
      backdropRgb: fallbackRgb,
      backdropIsLight: relativeLuminance(fallbackRgb) >= 0.5,
      holesCleared: 0,
      transparentRatio: 0,
    };
  }

  const corners: [RgbTuple, RgbTuple, RgbTuple, RgbTuple] = [...rawCorners] as [
    RgbTuple,
    RgbTuple,
    RgbTuple,
    RgbTuple,
  ];
  if (consensusIndices.length === 3) {
    const outlierIdx = [0, 1, 2, 3].find((i) => !consensusIndices.includes(i))!;
    // Adjacent pair for outlier corner
    const adjPairs: Record<number, [number, number]> = {
      0: [1, 2],
      1: [0, 3],
      2: [0, 3],
      3: [1, 2],
    };
    const [aIdx, bIdx] = adjPairs[outlierIdx]!;
    const a = corners[aIdx]!;
    const b = corners[bIdx]!;
    corners[outlierIdx] = [
      Math.round((a[0] + b[0]) / 2),
      Math.round((a[1] + b[1]) / 2),
      Math.round((a[2] + b[2]) / 2),
    ];
  }

  const medianBg: RgbTuple = [
    Math.round(medianOf(corners.map((c) => c[0]))),
    Math.round(medianOf(corners.map((c) => c[1]))),
    Math.round(medianOf(corners.map((c) => c[2]))),
  ];
  const bgIsAchromatic =
    Math.max(medianBg[0], medianBg[1], medianBg[2]) -
      Math.min(medianBg[0], medianBg[1], medianBg[2]) <=
    12;

  let maxCornerSpread = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      maxCornerSpread = Math.max(maxCornerSpread, rgbDist(corners[i]!, corners[j]!));
    }
  }
  const useConstantBg = maxCornerSpread <= 5;
  const invW = width > 1 ? 1 / (width - 1) : 0;
  const invH = height > 1 ? 1 / (height - 1) : 0;

  const getLocalBg = (x: number, y: number): RgbTuple => {
    if (useConstantBg) return medianBg;
    const u = x * invW;
    const v = y * invH;
    const w00 = (1 - u) * (1 - v);
    const w10 = u * (1 - v);
    const w01 = (1 - u) * v;
    const w11 = u * v;
    return [
      w00 * corners[0][0] + w10 * corners[1][0] + w01 * corners[2][0] + w11 * corners[3][0],
      w00 * corners[0][1] + w10 * corners[1][1] + w01 * corners[2][1] + w11 * corners[3][1],
      w00 * corners[0][2] + w10 * corners[1][2] + w01 * corners[2][2] + w11 * corners[3][2],
    ];
  };

  const pixelDist = (pxIdx: number, x: number, y: number): number => {
    const o = pxIdx * 4;
    const r = input[o]!;
    const g = input[o + 1]!;
    const b = input[o + 2]!;
    const bg = getLocalBg(x, y);
    const dr = r - bg[0];
    const dg = g - bg[1];
    const db = b - bg[2];
    if (!bgIsAchromatic) {
      return Math.sqrt(dr * dr + dg * dg + db * db);
    }
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    return Math.sqrt(dr * dr + dg * dg + db * db + 1.5 * chroma * chroma);
  };

  // Precompute per-pixel distance field once (fast O(N) reused across all stages)
  const distField = new Float32Array(pixelCount);
  let strongForegroundCount = 0;
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const p = rowOff + x;
      const d = pixelDist(p, x, y);
      distField[p] = d;
      if (d > 40) strongForegroundCount += 1;
    }
  }

  // Sample 2px inner perimeter ring (excluding bottom-right 8%x8% watermark zone)
  const wmMinX = Math.floor(width * 0.92);
  const wmMinY = Math.floor(height * 0.92);
  const borderDists: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onRing = x <= 1 || x >= width - 2 || y <= 1 || y >= height - 2;
      if (!onRing) continue;
      if (x >= wmMinX && y >= wmMinY) continue;
      borderDists.push(distField[y * width + x]!);
    }
  }

  const borderNoiseP90 = percentileOf(borderDists, 0.9);
  const borderAgreementRatio =
    borderDists.length > 0
      ? borderDists.filter((d) => d <= 28).length / borderDists.length
      : 0;
  const backdropIsLight = relativeLuminance(medianBg) >= 0.5;

  if (borderAgreementRatio < 0.86 || borderNoiseP90 > 24) {
    return {
      applied: false,
      reason: 'photo-or-textured-border',
      data: copyInput(),
      width,
      height,
      backdropRgb: medianBg,
      backdropIsLight,
      holesCleared: 0,
      transparentRatio: 0,
    };
  }

  if (strongForegroundCount / pixelCount < 0.0025) {
    return {
      applied: false,
      reason: 'empty-or-solid-image',
      data: copyInput(),
      width,
      height,
      backdropRgb: medianBg,
      backdropIsLight,
      holesCleared: 0,
      transparentRatio: 0,
    };
  }

  // Stage 2: Pass 1 — Adaptive Exterior 4-Connected Flood-Fill
  const sigmaB = Math.max(3, borderNoiseP90);
  const tLow = clamp(1.6 * sigmaB + 6, 12, 26);
  const tHigh = clamp(tLow + 44, 56, 78);
  const tMid = (tLow + tHigh) / 2;

  // cls: 0 = unvisited / foreground, 1 = confirmed background (alpha = 0), 2 = anti-aliased fringe
  const cls = new Uint8Array(pixelCount);
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let qHead = 0;
  let qTail = 0;

  const trySeed = (x: number, y: number) => {
    const p = y * width + x;
    if (visited[p] !== 0) return;
    if (distField[p]! <= tHigh) {
      visited[p] = 1;
      queue[qTail++] = p;
    }
  };

  for (let x = 0; x < width; x++) {
    trySeed(x, 0);
    trySeed(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    trySeed(0, y);
    trySeed(width - 1, y);
  }

  // 4-connected BFS (N, S, W, E) so 1px diagonal italic strokes never leak!
  while (qHead < qTail) {
    const p = queue[qHead++]!;
    const dp = distField[p]!;
    if (dp <= tLow) {
      cls[p] = 1;
    } else {
      cls[p] = 2;
    }
    const px = p % width;
    const py = (p - px) / width;

    const visitNeighbor = (np: number) => {
      if (visited[np] !== 0) return;
      const dq = distField[np]!;
      if (dq <= tLow || (dq <= tHigh && dp <= tMid)) {
        visited[np] = 1;
        queue[qTail++] = np;
      }
    };

    if (px > 0) visitNeighbor(p - 1);
    if (px + 1 < width) visitNeighbor(p + 1);
    if (py > 0) visitNeighbor(p - width);
    if (py + 1 < height) visitNeighbor(p + width);
  }

  // Expand a 1px outer anti-aliased feather ring around confirmed exterior background (cls === 1)
  // Captures mid-opacity anti-aliased gray edges (e.g., 15%-85% black-on-white or white-on-black)
  // while leaving opaque strokes untouched during Stage 4's closed-form color-line projection!
  const markBoundaryFringeCandidates = () => {
    for (let y = 0; y < height; y++) {
      const rowOff = y * width;
      for (let x = 0; x < width; x++) {
        const p = rowOff + x;
        if (cls[p] !== 0) continue;
        let touchesBg = false;
        for (let dy = -1; dy <= 1 && !touchesBg; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            if (cls[ny * width + nx] === 1) {
              touchesBg = true;
              break;
            }
          }
        }
        if (touchesBg) cls[p] = 2;
      }
    }
  };
  markBoundaryFringeCandidates();

  // Compute main foreground bounding box & opaque ink count (includes 1px–2px hairline strokes
  // whose pixels touch exterior cls===1 so crisp thin serif/script lettering is NEVER rejected!)
  let fgMinX = width;
  let fgMaxX = -1;
  let fgMinY = height;
  let fgMaxY = -1;
  let opaqueInkCount = 0;
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const p = rowOff + x;
      if (cls[p] !== 1 && distField[p]! > tHigh) {
        opaqueInkCount += 1;
        if (x < fgMinX) fgMinX = x;
        if (x > fgMaxX) fgMaxX = x;
        if (y < fgMinY) fgMinY = y;
        if (y > fgMaxY) fgMaxY = y;
      }
    }
  }

  if (fgMaxX < fgMinX || fgMaxY < fgMinY || opaqueInkCount === 0) {
    return {
      applied: false,
      reason: 'empty-or-solid-image',
      data: copyInput(),
      width,
      height,
      backdropRgb: medianBg,
      backdropIsLight,
      holesCleared: 0,
      transparentRatio: 0,
    };
  }

  const fgBBoxW = fgMaxX - fgMinX + 1;
  const fgBBoxH = fgMaxY - fgMinY + 1;
  const fgBBoxArea = fgBBoxW * fgBBoxH;
  const singleCharLike = fgBBoxW / Math.max(1, fgBBoxH) < 1.45;
  const maxHoleArea = Math.floor(fgBBoxArea * (singleCharLike ? 0.42 : 0.22));

  // Stage 3: Pass 2 — Smart Enclosed Letter-Counter Hole Clearing (o, R, e, A, O, 0, 8...)
  const tHole = Math.max(tLow + 6, 20);
  const holeSeen = new Uint8Array(pixelCount);

  interface HoleCandidate {
    pixels: number[];
    boundaryInkPixels: number[];
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    enclosesForegroundIsland: boolean;
    nestedDepth2Pixels: number[];
    thinWallRatio: number;
  }

  const candidates: HoleCandidate[] = [];
  const bfsBuf = new Int32Array(pixelCount);

  for (let y = 1; y < height - 1; y++) {
    const rowOff = y * width;
    for (let x = 1; x < width - 1; x++) {
      const start = rowOff + x;
      if (cls[start] !== 0 || holeSeen[start] !== 0 || distField[start]! > tHole) continue;

      let bh = 0;
      let bt = 0;
      holeSeen[start] = 1;
      bfsBuf[bt++] = start;
      const pixels: number[] = [];
      const boundaryInkSet = new Set<number>();
      let cMinX = x;
      let cMaxX = x;
      let cMinY = y;
      let cMaxY = y;
      const compDists: number[] = [];

      while (bh < bt) {
        const p = bfsBuf[bh++]!;
        pixels.push(p);
        compDists.push(distField[p]!);
        const px = p % width;
        const py = (p - px) / width;
        if (px < cMinX) cMinX = px;
        if (px > cMaxX) cMaxX = px;
        if (py < cMinY) cMinY = py;
        if (py > cMaxY) cMaxY = py;

        const checkN = (np: number) => {
          if (cls[np] === 1) return;
          if (cls[np] === 0 && distField[np]! <= tHole) {
            if (holeSeen[np] === 0) {
              holeSeen[np] = 1;
              bfsBuf[bt++] = np;
            }
          } else if (distField[np]! > tHole) {
            boundaryInkSet.add(np);
          }
        };

        if (px > 0) checkN(p - 1);
        if (px + 1 < width) checkN(p + 1);
        if (py > 0) checkN(p - width);
        if (py + 1 < height) checkN(p + width);
      }

      if (pixels.length < 4 || pixels.length > maxHoleArea) continue;

      // Safety Criterion 1: Strict local backdrop match (preserves tinted/cream/silver fills!)
      const compMedianDist = medianOf(compDists);
      const compP90Dist = percentileOf(compDists, 0.9);
      if (compMedianDist > Math.min(tLow + 4, 18) || compP90Dist > tLow + 12) continue;

      // Safety Criterion 3: Depth-2 Nested-Island Topology Shield
      // Flood-fill outside the component inside its padded bounding box to see if it strictly
      // encloses any opaque foreground island (provable signature of outlined white letter fills!).
      const padMinX = Math.max(0, cMinX - 1);
      const padMaxX = Math.min(width - 1, cMaxX + 1);
      const padMinY = Math.max(0, cMinY - 1);
      const padMaxY = Math.min(height - 1, cMaxY + 1);
      const boxW = padMaxX - padMinX + 1;
      const boxH = padMaxY - padMinY + 1;
      const inComp = new Uint8Array(boxW * boxH);
      for (const p of pixels) {
        const px = p % width;
        const py = (p - px) / width;
        inComp[(py - padMinY) * boxW + (px - padMinX)] = 1;
      }
      const extReach = new Uint8Array(boxW * boxH);
      const boxQ = new Int32Array(boxW * boxH);
      let bqh = 0;
      let bqt = 0;
      const seedBox = (bx: number, by: number) => {
        const bi = by * boxW + bx;
        if (inComp[bi] === 0 && extReach[bi] === 0) {
          extReach[bi] = 1;
          boxQ[bqt++] = bi;
        }
      };
      for (let bx = 0; bx < boxW; bx++) {
        seedBox(bx, 0);
        seedBox(bx, boxH - 1);
      }
      for (let by = 1; by < boxH - 1; by++) {
        seedBox(0, by);
        seedBox(boxW - 1, by);
      }
      while (bqh < bqt) {
        const bi = boxQ[bqh++]!;
        const bx = bi % boxW;
        const by = (bi - bx) / boxW;
        const tryB = (nbi: number) => {
          if (inComp[nbi] === 0 && extReach[nbi] === 0) {
            extReach[nbi] = 1;
            boxQ[bqt++] = nbi;
          }
        };
        if (bx > 0) tryB(bi - 1);
        if (bx + 1 < boxW) tryB(bi + 1);
        if (by > 0) tryB(bi - boxW);
        if (by + 1 < boxH) tryB(bi + boxW);
      }

      let enclosedInkPixels = 0;
      const nestedDepth2Pixels: number[] = [];
      for (let by = 1; by < boxH - 1; by++) {
        for (let bx = 1; bx < boxW - 1; bx++) {
          const bi = by * boxW + bx;
          if (inComp[bi] === 0 && extReach[bi] === 0) {
            const gp = (by + padMinY) * width + (bx + padMinX);
            if (distField[gp]! > tHigh) {
              enclosedInkPixels += 1;
            } else if (distField[gp]! <= tHole) {
              nestedDepth2Pixels.push(gp);
            }
          }
        }
      }
      const enclosesForegroundIsland = enclosedInkPixels >= 6;

      // Safety Criterion 4: Measure enclosing ink wall thickness to exterior cls === 1
      const boundaryInkPixels = Array.from(boundaryInkSet);
      const maxThinWall = Math.max(5, Math.round(0.08 * fgBBoxH));
      let sampledBoundary = 0;
      let thinBoundary = 0;
      const step = Math.max(1, Math.floor(boundaryInkPixels.length / 40));
      for (let i = 0; i < boundaryInkPixels.length; i += step) {
        const bp = boundaryInkPixels[i]!;
        const bx = bp % width;
        const by = (bp - bx) / width;
        sampledBoundary += 1;
        let hitExterior = false;
        // Probe 4 cardinal rays up to maxThinWall pixels for exterior cls === 1
        const dirs: ReadonlyArray<[number, number]> = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (const [dx, dy] of dirs) {
          for (let d = 1; d <= maxThinWall; d++) {
            const nx = bx + dx * d;
            const ny = by + dy * d;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
              hitExterior = true;
              break;
            }
            if (cls[ny * width + nx] === 1) {
              hitExterior = true;
              break;
            }
          }
          if (hitExterior) break;
        }
        if (hitExterior) thinBoundary += 1;
      }
      const thinWallRatio = sampledBoundary > 0 ? thinBoundary / sampledBoundary : 0;

      candidates.push({
        pixels,
        boundaryInkPixels,
        minX: cMinX,
        maxX: cMaxX,
        minY: cMinY,
        maxY: cMaxY,
        enclosesForegroundIsland,
        nestedDepth2Pixels,
        thinWallRatio,
      });
    }
  }

  const totalCandidateHolePixels = candidates.reduce((acc, c) => acc + c.pixels.length, 0);
  const globalHoleToInkRatio = totalCandidateHolePixels / Math.max(1, opaqueInkCount);
  const anyNestedIsland = candidates.some((c) => c.enclosesForegroundIsland);

  let holesCleared = 0;
  const markClearedHolePixels = (holePixels: number[]) => {
    if (holePixels.length === 0) return;
    holesCleared += 1;
    for (const p of holePixels) {
      cls[p] = distField[p]! <= tLow ? 1 : 2;
    }
    // Mark 8-connected boundary ring around newly cleared hole as fringe (cls = 2)
    for (const p of holePixels) {
      if (cls[p] !== 1) continue;
      const px = p % width;
      const py = (p - px) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= width) continue;
          const np = ny * width + nx;
          if (cls[np] === 0) {
            cls[np] = 2;
          }
        }
      }
    }
  };

  for (const cand of candidates) {
    // If this component encloses a foreground island (outlined white letter fill like 'O'/'R'),
    // PRESERVE the white fill and clear ONLY its nested depth-2 inner counter hole!
    if (cand.enclosesForegroundIsland) {
      if (cand.nestedDepth2Pixels.length >= 4) {
        markClearedHolePixels(cand.nestedDepth2Pixels);
      }
      continue;
    }
    // Thin-Wall + Global Fill-Dominance Shield: protects outlined non-loop letters (t, s, I, E)
    // in the worst-case scenario where white-filled outlined letters sit on a white backdrop!
    if (
      (globalHoleToInkRatio > 0.55 || anyNestedIsland) &&
      cand.thinWallRatio >= 0.72
    ) {
      continue;
    }
    markClearedHolePixels(cand.pixels);
  }

  // Stage 4: Linear Alpha Feathering + Stabilized Porter-Duff Un-Premultiplication De-Fringing
  const output = new Uint8ClampedArray(input);
  let transparentPixels = 0;
  const invBand = 1 / Math.max(1, tHigh - tLow);

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const p = rowOff + x;
      const o = p * 4;
      const c = cls[p]!;

      if (c === 1) {
        output[o] = 0;
        output[o + 1] = 0;
        output[o + 2] = 0;
        output[o + 3] = 0;
        transparentPixels += 1;
        continue;
      }

      if (c === 2) {
        const d = distField[p]!;
        const bg = getLocalBg(x, y);
        const cr = input[o]!;
        const cg = input[o + 1]!;
        const cb = input[o + 2]!;

        // Local 5x5 inverse-distance weighted opaque interior foreground estimate (F_local).
        // Prefer interior `cls === 0` pixels; if none exist (1px–2px hairline strokes!), estimate
        // F_local from the peak-contrast ink pixels (`>= 72%` of local max distance, `> tHigh`)
        // so hairline strokes stay 100% solid while adjacent anti-aliased fringe still de-fringes!
        let sumW = 0;
        let locR = 0;
        let locG = 0;
        let locB = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const np = ny * width + nx;
            if (cls[np] !== 0) continue;
            const w = 1 / (dx * dx + dy * dy + 0.5);
            const no = np * 4;
            locR += input[no]! * w;
            locG += input[no + 1]! * w;
            locB += input[no + 2]! * w;
            sumW += w;
          }
        }
        if (sumW === 0) {
          let localMaxD = 0;
          for (let dy = -2; dy <= 2; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -2; dx <= 2; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= width) continue;
              const np = ny * width + nx;
              if (cls[np] !== 1 && distField[np]! > localMaxD) {
                localMaxD = distField[np]!;
              }
            }
          }
          if (localMaxD > tHigh) {
            const peakFloor = Math.max(tHigh, localMaxD * 0.72);
            for (let dy = -2; dy <= 2; dy++) {
              const ny = y + dy;
              if (ny < 0 || ny >= height) continue;
              for (let dx = -2; dx <= 2; dx++) {
                const nx = x + dx;
                if (nx < 0 || nx >= width) continue;
                const np = ny * width + nx;
                if (cls[np] === 1 || distField[np]! < peakFloor) continue;
                const w = 1 / (dx * dx + dy * dy + 0.5);
                const no = np * 4;
                locR += input[no]! * w;
                locG += input[no + 1]! * w;
                locB += input[no + 2]! * w;
                sumW += w;
              }
            }
          }
        }

        // Closed-form color-line alpha projection: solves C = alpha * F_local + (1 - alpha) * B
        // Accurately handles 10%–90% anti-aliased edges across any contrast range while keeping
        // true opaque rim colors (e.g. white sticker outlines) & 1px–2px hairline strokes 100% opaque!
        let alpha = d > tHigh ? 1 : clamp((d - tLow) * invBand, 0, 1);
        let avgR = cr;
        let avgG = cg;
        let avgB = cb;
        if (sumW > 0) {
          avgR = locR / sumW;
          avgG = locG / sumW;
          avgB = locB / sumW;
          const vr = avgR - bg[0];
          const vg = avgG - bg[1];
          const vb = avgB - bg[2];
          const vLenSq = vr * vr + vg * vg + vb * vb;
          if (vLenSq >= 400) {
            const dr = cr - bg[0];
            const dg = cg - bg[1];
            const db = cb - bg[2];
            const proj = (dr * vr + dg * vg + db * vb) / vLenSq;
            const perpR = dr - proj * vr;
            const perpG = dg - proj * vg;
            const perpB = db - proj * vb;
            const perpDist = Math.sqrt(perpR * perpR + perpG * perpG + perpB * perpB);
            if (perpDist <= 30) {
              if (proj >= 0.94) {
                // Pixel matches opaque foreground edge -> keep 100% solid!
                alpha = 1;
              } else if (proj <= 0.02) {
                alpha = 0;
              } else {
                alpha = clamp(proj, 0, 1);
              }
            } else {
              // Chromatically distinct rim color (not a blend toward B) -> preserve opaque!
              alpha = 1;
            }
          }
        }

        if (alpha <= 0.01) {
          output[o] = 0;
          output[o + 1] = 0;
          output[o + 2] = 0;
          output[o + 3] = 0;
          transparentPixels += 1;
          continue;
        }
        if (alpha >= 0.99) {
          // Pure solid foreground edge pixel — leave exact original RGBA untouched!
          continue;
        }

        // Analytical un-mix: F = (C - (1 - alpha) * B) / alpha
        const unmixR = clamp((cr - (1 - alpha) * bg[0]) / alpha, 0, 255);
        const unmixG = clamp((cg - (1 - alpha) * bg[1]) / alpha, 0, 255);
        const unmixB = clamp((cb - (1 - alpha) * bg[2]) / alpha, 0, 255);

        let fr = unmixR;
        let fg = unmixG;
        let fb = unmixB;
        if (sumW > 0) {
          if (alpha >= 0.35) {
            fr = 0.7 * unmixR + 0.3 * avgR;
            fg = 0.7 * unmixG + 0.3 * avgG;
            fb = 0.7 * unmixB + 0.3 * avgB;
          } else {
            const w = alpha / 0.35;
            fr = w * unmixR + (1 - w) * avgR;
            fg = w * unmixG + (1 - w) * avgG;
            fb = w * unmixB + (1 - w) * avgB;
          }
        }

        output[o] = clampByte(fr);
        output[o + 1] = clampByte(fg);
        output[o + 2] = clampByte(fb);
        output[o + 3] = clampByte(alpha * 255);
      }
    }
  }

  // Optional Isolated Bottom-Right Gemini Watermark Speck Cleanup
  // Only wipes tiny disconnected foreground islands strictly inside [0.90W..W, 0.90H..H]
  // with area < 0.35% of image AND separated by >= 4% transparent margin from the main wordmark.
  const wmBoxX = Math.floor(width * 0.9);
  const wmBoxY = Math.floor(height * 0.9);
  const gapX = Math.max(2, Math.floor(width * 0.04));
  const gapY = Math.max(2, Math.floor(height * 0.04));
  const maxWmArea = Math.floor(pixelCount * 0.0035);

  // Find bounding box of main foreground outside the bottom-right corner zone
  let mainMaxX = -1;
  let mainMaxY = -1;
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      if (x >= wmBoxX && y >= wmBoxY) continue;
      if (output[(rowOff + x) * 4 + 3]! > 25) {
        if (x > mainMaxX) mainMaxX = x;
        if (y > mainMaxY) mainMaxY = y;
      }
    }
  }

  if (mainMaxX >= 0 && (mainMaxX + gapX < wmBoxX || mainMaxY + gapY < wmBoxY)) {
    const wmVisited = new Uint8Array(pixelCount);
    for (let y = wmBoxY; y < height; y++) {
      for (let x = wmBoxX; x < width; x++) {
        const start = y * width + x;
        if (wmVisited[start] !== 0 || output[start * 4 + 3]! <= 5) continue;
        let wh = 0;
        let wt = 0;
        wmVisited[start] = 1;
        bfsBuf[wt++] = start;
        const island: number[] = [];
        let touchesOutsideWm = false;
        while (wh < wt) {
          const p = bfsBuf[wh++]!;
          island.push(p);
          const px = p % width;
          const py = (p - px) / width;
          if (px < wmBoxX || py < wmBoxY) touchesOutsideWm = true;
          const checkW = (np: number) => {
            if (wmVisited[np] !== 0 || output[np * 4 + 3]! <= 5) return;
            wmVisited[np] = 1;
            bfsBuf[wt++] = np;
          };
          if (px > 0) checkW(p - 1);
          if (px + 1 < width) checkW(p + 1);
          if (py > 0) checkW(p - width);
          if (py + 1 < height) checkW(p + width);
        }
        if (!touchesOutsideWm && island.length <= maxWmArea) {
          for (const p of island) {
            const o = p * 4;
            output[o] = 0;
            output[o + 1] = 0;
            output[o + 2] = 0;
            output[o + 3] = 0;
            transparentPixels += 1;
          }
        }
      }
    }
  }

  const transparentRatio = transparentPixels / pixelCount;
  if (transparentRatio < 0.04 || transparentRatio > 0.995) {
    return {
      applied: false,
      reason: 'empty-or-solid-image',
      data: copyInput(),
      width,
      height,
      backdropRgb: medianBg,
      backdropIsLight,
      holesCleared: 0,
      transparentRatio,
    };
  }

  return {
    applied: true,
    data: output,
    width,
    height,
    backdropRgb: medianBg,
    backdropIsLight,
    holesCleared,
    transparentRatio,
  };
}

/**
 * Browser/Side-Panel Canvas wrapper: converts a solid-backdrop isolated wordmark PNG DataURL
 * into a crisp true-transparent PNG DataURL (falling back cleanly to the original DataURL if
 * the backdrop is non-uniform or Canvas APIs are unavailable).
 */
export async function extractTransparentWordmarkPng(
  solidDataUrl: string
): Promise<TransparentWordmarkPngResult> {
  const fallback = (
    reason: AlphaMatteRejectReason,
    width = 0,
    height = 0,
    backdropRgb: RgbTuple = [255, 255, 255]
  ): TransparentWordmarkPngResult => ({
    applied: false,
    reason,
    dataUrl: solidDataUrl,
    width,
    height,
    backdropRgb,
    backdropIsLight: relativeLuminance(backdropRgb) >= 0.5,
    holesCleared: 0,
    transparentRatio: 0,
  });

  if (typeof document === 'undefined' || !solidDataUrl.startsWith('data:image/')) {
    return fallback('canvas-unavailable');
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode wordmark image'));
      el.src = solidDataUrl;
    });

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width < 16 || height < 16) return fallback('image-too-small', width, height);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallback('canvas-unavailable', width, height);

    ctx.drawImage(img, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);
    const processed = extractTransparentWordmarkFromRgba(imgData.data, width, height);

    if (!processed.applied) {
      return {
        applied: false,
        reason: processed.reason,
        dataUrl: solidDataUrl,
        width,
        height,
        backdropRgb: processed.backdropRgb,
        backdropIsLight: processed.backdropIsLight,
        holesCleared: 0,
        transparentRatio: processed.transparentRatio,
      };
    }

    const outImageData = new ImageData(
      new Uint8ClampedArray(processed.data),
      width,
      height
    );
    ctx.putImageData(outImageData, 0, 0);
    const pngDataUrl = canvas.toDataURL('image/png');

    return {
      applied: true,
      dataUrl: pngDataUrl,
      width,
      height,
      backdropRgb: processed.backdropRgb,
      backdropIsLight: processed.backdropIsLight,
      holesCleared: processed.holesCleared,
      transparentRatio: processed.transparentRatio,
    };
  } catch {
    return fallback('canvas-unavailable');
  }
}

// =============================================================================
// 2. Sub-Pixel Raster-to-Vector `<path>` SVG Tracer (`traceWordmarkRgbaToVectorSvg`)
//    Converts any transparent wordmark PNG into a genuine, infinitely scalable
//    `<svg><path d="M... Q... Z" fill="#..." fill-rule="evenodd"/></svg>` vector logo!
// =============================================================================

export interface VectorTraceOptions {
  alphaThreshold?: number;
  maxColors?: number;
  simplifyEpsilon?: number;
}

interface Pt2D {
  x: number;
  y: number;
}

function rgbToHexString(rgb: RgbTuple): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0').toUpperCase();
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

function perpendicularDist(pt: Pt2D, a: Pt2D, b: Pt2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return Math.hypot(pt.x - a.x, pt.y - a.y);
  }
  const t = clamp(((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq, 0, 1);
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(pt.x - px, pt.y - py);
}

function rdpOpenChain(points: Pt2D[], epsilon: number): Pt2D[] {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdpOpenChain(points.slice(0, maxIdx + 1), epsilon);
    const right = rdpOpenChain(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function simplifyClosedContour(loop: Pt2D[], epsilon: number): Pt2D[] {
  if (loop.length <= 4) return loop;
  // Split at vertex 0 and its farthest antipodal vertex so closed loops simplify symmetrically
  const p0 = loop[0]!;
  let farIdx = Math.floor(loop.length / 2);
  let maxD = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i]!.x - p0.x, loop[i]!.y - p0.y);
    if (d > maxD) {
      maxD = d;
      farIdx = i;
    }
  }
  const half1 = loop.slice(0, farIdx + 1);
  const half2 = [...loop.slice(farIdx), p0];
  const s1 = rdpOpenChain(half1, epsilon);
  const s2 = rdpOpenChain(half2, epsilon);
  return [...s1.slice(0, -1), ...s2.slice(0, -1)];
}

function contourToBezierPathD(loop: Pt2D[], scaleX: number, scaleY: number): string {
  const m = loop.length;
  if (m < 3) return '';
  const fmt = (n: number) => Number(n.toFixed(1));
  const scaled = loop.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));

  const cmds: string[] = [];
  const pLast = scaled[m - 1]!;
  const pFirst = scaled[0]!;
  const startMidX = fmt((pLast.x + pFirst.x) / 2);
  const startMidY = fmt((pLast.y + pFirst.y) / 2);
  cmds.push(`M ${startMidX} ${startMidY}`);

  for (let i = 0; i < m; i++) {
    const a = scaled[(i - 1 + m) % m]!;
    const b = scaled[i]!;
    const c = scaled[(i + 1) % m]!;
    const midBC = { x: fmt((b.x + c.x) / 2), y: fmt((b.y + c.y) / 2) };

    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const uLen = Math.hypot(ux, uy);
    const vLen = Math.hypot(vx, vy);

    if (uLen > 0.5 && vLen > 0.5) {
      const cosAngle = (ux * vx + uy * vy) / (uLen * vLen);
      if (cosAngle < 0.35) {
        // Sharp corner (serif or stencil edge): tighten quadratic control handles around vertex B
        const tU = Math.min(1.4, uLen * 0.22);
        const tV = Math.min(1.4, vLen * 0.22);
        const preX = fmt(b.x - (ux / uLen) * tU);
        const preY = fmt(b.y - (uy / uLen) * tU);
        const postX = fmt(b.x + (vx / vLen) * tV);
        const postY = fmt(b.y + (vy / vLen) * tV);
        cmds.push(`L ${preX} ${preY} Q ${fmt(b.x)} ${fmt(b.y)} ${postX} ${postY} L ${midBC.x} ${midBC.y}`);
        continue;
      }
    }
    cmds.push(`Q ${fmt(b.x)} ${fmt(b.y)} ${midBC.x} ${midBC.y}`);
  }

  cmds.push('Z');
  return cmds.join(' ');
}

function downsampleRgbaMaxEdge(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  maxEdge = 512
): { data: Uint8ClampedArray; w: number; h: number; scaleX: number; scaleY: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) {
    return { data: rgba, w: width, h: height, scaleX: 1, scaleY: 1 };
  }
  const ratio = maxEdge / longest;
  const w = Math.max(16, Math.round(width * ratio));
  const h = Math.max(16, Math.round(height * ratio));
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = width / w;
  const sy = height / h;
  for (let y = 0; y < h; y++) {
    const srcY = Math.min(height - 1, Math.floor(y * sy));
    for (let x = 0; x < w; x++) {
      const srcX = Math.min(width - 1, Math.floor(x * sx));
      const srcOff = (srcY * width + srcX) * 4;
      const dstOff = (y * w + x) * 4;
      out[dstOff] = rgba[srcOff]!;
      out[dstOff + 1] = rgba[srcOff + 1]!;
      out[dstOff + 2] = rgba[srcOff + 2]!;
      out[dstOff + 3] = rgba[srcOff + 3]!;
    }
  }
  return { data: out, w, h, scaleX: sx, scaleY: sy };
}

/**
 * Pure-TypeScript Sub-Pixel Marching-Squares + Ramer-Douglas-Peucker + Quadratic Bézier
 * vectorizer: traces a transparent wordmark RGBA buffer into a standalone `<svg>` containing
 * genuine `<path d="M... Q... Z" fill-rule="evenodd"/>` vector curves (zero `<image>` tags).
 */
export function traceWordmarkRgbaToVectorSvg(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options?: VectorTraceOptions
): string {
  if (width < 4 || height < 4 || rgba.length < width * height * 4) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(1, width)} ${Math.max(1, height)}" width="${Math.max(1, width)}" height="${Math.max(1, height)}" role="img"></svg>`;
  }

  const alphaThreshold = options?.alphaThreshold ?? 110;
  const maxColors = clamp(options?.maxColors ?? 4, 1, 6);
  const { data, w, h, scaleX, scaleY } = downsampleRgbaMaxEdge(rgba, width, height, 512);
  const eps = options?.simplifyEpsilon ?? clamp(Math.min(w, h) * 0.0024, 0.45, 1.35);
  const pixelCount = w * h;

  // 1. Quantize opaque ink pixels into up to `maxColors` dominant color clusters
  const bucketMap = new Map<number, { count: number; rSum: number; gSum: number; bSum: number }>();
  let totalOpaque = 0;
  for (let p = 0; p < pixelCount; p++) {
    const o = p * 4;
    const a = data[o + 3]!;
    if (a < alphaThreshold) continue;
    totalOpaque += 1;
    const r = data[o]!;
    const g = data[o + 1]!;
    const b = data[o + 2]!;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const prev = bucketMap.get(key);
    if (prev) {
      prev.count += 1;
      prev.rSum += r;
      prev.gSum += g;
      prev.bSum += b;
    } else {
      bucketMap.set(key, { count: 1, rSum: r, gSum: g, bSum: b });
    }
  }

  if (totalOpaque === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"></svg>`;
  }

  const sortedBuckets = [...bucketMap.values()].sort((a, b) => b.count - a.count);
  const clusters: Array<{ rgb: RgbTuple; count: number }> = [];
  for (const b of sortedBuckets) {
    const rgb: RgbTuple = [
      Math.round(b.rSum / b.count),
      Math.round(b.gSum / b.count),
      Math.round(b.bSum / b.count),
    ];
    let merged = false;
    for (const c of clusters) {
      if (rgbDist(rgb, c.rgb) <= 42) {
        const tot = c.count + b.count;
        c.rgb = [
          Math.round((c.rgb[0] * c.count + rgb[0] * b.count) / tot),
          Math.round((c.rgb[1] * c.count + rgb[1] * b.count) / tot),
          Math.round((c.rgb[2] * c.count + rgb[2] * b.count) / tot),
        ];
        c.count = tot;
        merged = true;
        break;
      }
    }
    if (!merged && clusters.length < maxColors) {
      clusters.push({ rgb, count: b.count });
    }
  }

  const activeClusters = clusters.filter(
    (c, idx) => idx === 0 || c.count / totalOpaque >= 0.015
  );

  // Assign each opaque pixel to its closest cluster index (1..K, 0 = transparent)
  const pixelCluster = new Uint8Array(pixelCount);
  for (let p = 0; p < pixelCount; p++) {
    const o = p * 4;
    if (data[o + 3]! < alphaThreshold) continue;
    const rgb: RgbTuple = [data[o]!, data[o + 1]!, data[o + 2]!];
    let bestIdx = 1;
    let bestD = Infinity;
    for (let k = 0; k < activeClusters.length; k++) {
      const d = rgbDist(rgb, activeClusters[k]!.rgb);
      if (d < bestD) {
        bestD = d;
        bestIdx = k + 1;
      }
    }
    pixelCluster[p] = bestIdx;
  }

  // 2. Sub-pixel Marching Squares per cluster k
  const sampleScalar = (x: number, y: number, k: number): number => {
    if (x < 0 || x >= w || y < 0 || y >= h) return 0;
    const p = y * w + x;
    return pixelCluster[p] === k ? data[p * 4 + 3]! : 0;
  };

  const interp = (sA: number, sB: number): number => {
    const denom = sA - sB;
    if (Math.abs(denom) < 1e-3) return 0.5;
    return clamp((sA - alphaThreshold) / denom, 0.05, 0.95);
  };

  const pathElements: string[] = [];

  for (let k = 1; k <= activeClusters.length; k++) {
    const clusterHex = rgbToHexString(activeClusters[k - 1]!.rgb);
    // Directed graph of marching-squares boundary segments keyed by integer grid edge ID
    // Side 0: Top (cx..cx+1, cy), Side 1: Right (cx+1, cy..cy+1),
    // Side 2: Bottom (cx..cx+1, cy+1), Side 3: Left (cx, cy..cy+1)
    const edgeKey = (cx: number, cy: number, side: 0 | 1 | 2 | 3): number => {
      // Normalize shared edges between adjacent cells
      if (side === 0) return ((cy + 1) * (w + 3) + (cx + 1)) * 2; // H edge
      if (side === 2) return ((cy + 2) * (w + 3) + (cx + 1)) * 2; // H edge
      if (side === 3) return ((cy + 1) * (w + 3) + (cx + 1)) * 2 + 1; // V edge
      return ((cy + 1) * (w + 3) + (cx + 2)) * 2 + 1; // V edge (side 1)
    };

    interface Seg {
      fromKey: number;
      toKey: number;
      fromPt: Pt2D;
      toPt: Pt2D;
      used: boolean;
    }

    const outgoing = new Map<number, Seg[]>();
    const allSegs: Seg[] = [];

    for (let cy = -1; cy < h; cy++) {
      for (let cx = -1; cx < w; cx++) {
        const sTL = sampleScalar(cx, cy, k);
        const sTR = sampleScalar(cx + 1, cy, k);
        const sBR = sampleScalar(cx + 1, cy + 1, k);
        const sBL = sampleScalar(cx, cy + 1, k);

        let mask = 0;
        if (sTL >= alphaThreshold) mask |= 1;
        if (sTR >= alphaThreshold) mask |= 2;
        if (sBR >= alphaThreshold) mask |= 4;
        if (sBL >= alphaThreshold) mask |= 8;
        if (mask === 0 || mask === 15) continue;

        const sidePt = (side: 0 | 1 | 2 | 3): Pt2D => {
          if (side === 0) return { x: cx + 0.5 + interp(sTL, sTR), y: cy + 0.5 };
          if (side === 1) return { x: cx + 1.5, y: cy + 0.5 + interp(sTR, sBR) };
          if (side === 2) return { x: cx + 0.5 + interp(sBL, sBR), y: cy + 1.5 };
          return { x: cx + 0.5, y: cy + 0.5 + interp(sTL, sBL) };
        };

        const addSeg = (sFrom: 0 | 1 | 2 | 3, sTo: 0 | 1 | 2 | 3) => {
          const fk = edgeKey(cx, cy, sFrom);
          const tk = edgeKey(cx, cy, sTo);
          const seg: Seg = {
            fromKey: fk,
            toKey: tk,
            fromPt: sidePt(sFrom),
            toPt: sidePt(sTo),
            used: false,
          };
          allSegs.push(seg);
          const list = outgoing.get(fk);
          if (list) list.push(seg);
          else outgoing.set(fk, [seg]);
        };

        const centerHigh = (sTL + sTR + sBR + sBL) * 0.25 >= alphaThreshold;
        switch (mask) {
          case 1:
            addSeg(3, 0);
            break;
          case 2:
            addSeg(0, 1);
            break;
          case 3:
            addSeg(3, 1);
            break;
          case 4:
            addSeg(1, 2);
            break;
          case 5:
            if (centerHigh) {
              addSeg(3, 2);
              addSeg(1, 0);
            } else {
              addSeg(3, 0);
              addSeg(1, 2);
            }
            break;
          case 6:
            addSeg(0, 2);
            break;
          case 7:
            addSeg(3, 2);
            break;
          case 8:
            addSeg(2, 3);
            break;
          case 9:
            addSeg(2, 0);
            break;
          case 10:
            if (centerHigh) {
              addSeg(0, 3);
              addSeg(2, 1);
            } else {
              addSeg(0, 1);
              addSeg(2, 3);
            }
            break;
          case 11:
            addSeg(2, 1);
            break;
          case 12:
            addSeg(1, 3);
            break;
          case 13:
            addSeg(1, 0);
            break;
          case 14:
            addSeg(0, 3);
            break;
        }
      }
    }

    const clusterSubpaths: string[] = [];
    for (const startSeg of allSegs) {
      if (startSeg.used) continue;
      startSeg.used = true;
      const loop: Pt2D[] = [startSeg.fromPt];
      let cur = startSeg;
      while (cur.toKey !== startSeg.fromKey) {
        loop.push(cur.toPt);
        const nextCandidates = outgoing.get(cur.toKey);
        const next = nextCandidates?.find((s) => !s.used);
        if (!next) break;
        next.used = true;
        cur = next;
      }
      if (loop.length < 4) continue;

      // Shoelace polygon area filter to drop tiny 1px noise specks
      let twiceArea = 0;
      for (let i = 0; i < loop.length; i++) {
        const p1 = loop[i]!;
        const p2 = loop[(i + 1) % loop.length]!;
        twiceArea += p1.x * p2.y - p2.x * p1.y;
      }
      if (Math.abs(twiceArea) * 0.5 < 3.5) continue;

      const simplified = simplifyClosedContour(loop, eps);
      const pathD = contourToBezierPathD(simplified, scaleX, scaleY);
      if (pathD) clusterSubpaths.push(pathD);
    }

    if (clusterSubpaths.length > 0) {
      pathElements.push(
        `  <path d="${clusterSubpaths.join(' ')}" fill="${clusterHex}" fill-rule="evenodd" />`
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">`,
    ...pathElements,
    `</svg>`,
  ].join('\n');
}

export async function traceTransparentWordmarkToVectorSvg(
  transparentDataUrl: string,
  options?: VectorTraceOptions
): Promise<string> {
  if (typeof document === 'undefined' || !transparentDataUrl.startsWith('data:image/')) {
    return '';
  }
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = transparentDataUrl;
    });
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width < 4 || height < 4) return '';
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);
    return traceWordmarkRgbaToVectorSvg(imgData.data, width, height, options);
  } catch {
    return '';
  }
}

// =============================================================================
// 3. 0-Token Client-Side Master Image Layer Splitter (`splitMasterImageRgba`)
//    Separates Turn 1's Master Composite Image into:
//      (A) Transparent Font Cutout PNG + Vector `<path>` SVG (excluding brand emblems!)
//      (B) Seamlessly Inpainted Clean Background PNG (preserving brand emblems!)
//    in <120ms with ZERO extra AI tokens!
// =============================================================================

export interface MasterSplitOptions {
  targetWord?: string;
  /**
   * Where a text-detection model found text (1 = text), at the picture's resolution. When it
   * agrees with the splitter on most of the lettering, shapes lying mostly OUTSIDE detected text
   * (line art, illustrations) are kept as artwork instead of being cut out as lettering.
   */
  textMask?: Uint8Array;
  /**
   * 'filter' (default): use the mask only to drop shapes outside the text the splitter chose.
   * 'clip': trust the mask first - cut every shape to the detected text area before choosing the
   * word (second attempt when the first one failed, e.g. line art or a busy scene took over).
   */
  textMaskMode?: 'filter' | 'clip';
  originalData?: Uint8ClampedArray;
  originalWidth?: number;
  originalHeight?: number;
}

export interface RgbaMasterSplitResult {
  applied: boolean;
  reason?: AlphaMatteRejectReason | 'no-text-cluster-found' | 'complex-textured-scene';
  fontData: Uint8ClampedArray;
  backgroundData: Uint8ClampedArray;
  width: number;
  height: number;
  backgroundConfidence: number;
  backdropIsLight: boolean;
  textComponentCount: number;
  emblemsPreservedCount: number;
  textBBox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /**
   * Self-check of the split. `fontOk === false` means the Font layer is probably not the whole
   * word; `backgroundOk === false` means lettering covered artwork that cannot be rebuilt locally.
   * Callers must not present a layer as finished when its flag is false.
   */
  quality: SplitQuality;
  /**
   * 1 for every pixel that was erased to make the Clean Background (lettering, its soft edge and
   * rim), 0 elsewhere. Lets a stronger inpainter redo just that area.
   */
  eraseMask: Uint8Array;
}

export interface SplitQuality {
  fontOk: boolean;
  backgroundOk: boolean;
  reasons: Array<
    | 'font-too-narrow'
    | 'font-too-flat'
    | 'ink-left-behind'
    | 'ink-undecided'
    | 'font-too-spread'
    | 'font-mixed-inks'
    | 'lettering-over-artwork'
    | 'text-left-in-background'
  >;
}

export interface LocalMasterSplitDataUrlsResult {
  applied: boolean;
  reason?: RgbaMasterSplitResult['reason'];
  fontTransparentDataUrl: string;
  backgroundDataUrl: string;
  vectorSvg: string;
  width: number;
  height: number;
  backgroundConfidence: number;
  backdropIsLight: boolean;
  textComponentCount: number;
  emblemsPreservedCount: number;
  /** Self-check verdict (see SplitQuality). */
  quality: SplitQuality;
  /** True when the bundled on-device model rebuilt the Clean Background. */
  backgroundRebuiltOnDevice?: boolean;
  /** Measured shape and size of the lettering found (when the Font passed its self-check). */
  letteringMetrics?: LetteringMetrics | null;
}

export function splitMasterImageRgba(
  masterData: Uint8ClampedArray,
  width: number,
  height: number,
  options?: MasterSplitOptions
): RgbaMasterSplitResult {
  const pixelCount = width * height;
  const emptyFail = (
    reason: RgbaMasterSplitResult['reason'],
    confidence = 0
  ): RgbaMasterSplitResult => ({
    applied: false,
    reason,
    fontData: new Uint8ClampedArray(pixelCount * 4),
    backgroundData: new Uint8ClampedArray(masterData),
    width,
    height,
    backgroundConfidence: confidence,
    backdropIsLight: true,
    textComponentCount: 0,
    emblemsPreservedCount: 0,
    textBBox: null,
    quality: { fontOk: false, backgroundOk: false, reasons: [] },
    eraseMask: new Uint8Array(pixelCount),
  });

  if (width < 20 || height < 20 || masterData.length < pixelCount * 4) {
    return emptyFail('image-too-small');
  }

  // Stage 1: Coarse-Tile Smooth Background Surface B(x,y) (12 x 10 grid)
  const gridCols = Math.min(12, Math.max(4, Math.floor(width / 10)));
  const gridRows = Math.min(10, Math.max(4, Math.floor(height / 10)));
  const tileCount = gridCols * gridRows;
  const tileMedians: RgbTuple[] = new Array(tileCount);
  // Per-tile sampled pixels (kept for the local-background refinement pass below) and the
  // 90th-percentile deviation from the tile median: a low spread means a SMOOTH tile (flat color
  // or gentle gradient) with no sharp text strokes or emblem edges crossing it.
  const tileSamples: Uint8ClampedArray[] = new Array(tileCount);
  const tileSpread = new Float32Array(tileCount);

  for (let ty = 0; ty < gridRows; ty++) {
    const y0 = Math.floor((ty * height) / gridRows);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / gridRows));
    for (let tx = 0; tx < gridCols; tx++) {
      const x0 = Math.floor((tx * width) / gridCols);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / gridCols));
      const rs: number[] = [];
      const gs: number[] = [];
      const bs: number[] = [];
      const stepY = Math.max(1, Math.floor((y1 - y0) / 8));
      const stepX = Math.max(1, Math.floor((x1 - x0) / 8));
      for (let y = y0; y < y1; y += stepY) {
        for (let x = x0; x < x1; x += stepX) {
          const o = (y * width + x) * 4;
          rs.push(masterData[o]!);
          gs.push(masterData[o + 1]!);
          bs.push(masterData[o + 2]!);
        }
      }
      const tileMedian: RgbTuple = [
        Math.round(medianOf(rs)),
        Math.round(medianOf(gs)),
        Math.round(medianOf(bs)),
      ];
      const tIdx = ty * gridCols + tx;
      tileMedians[tIdx] = tileMedian;
      const packed = new Uint8ClampedArray(rs.length * 3);
      const deviations: number[] = new Array(rs.length);
      for (let s = 0; s < rs.length; s++) {
        packed[s * 3] = rs[s]!;
        packed[s * 3 + 1] = gs[s]!;
        packed[s * 3 + 2] = bs[s]!;
        deviations[s] = rgbDist([rs[s]!, gs[s]!, bs[s]!], tileMedian);
      }
      tileSamples[tIdx] = packed;
      tileSpread[tIdx] = percentileOf(deviations, 0.9);
    }
  }

  // Cluster tile medians (within RGB distance 38) to find the dominant card/scene surface.
  // Perimeter border tiles get 2x vote weight so large bold central lettering never outvotes the card background!
  let bestClusterCenter: RgbTuple = tileMedians[0]!;
  let bestClusterScore = -1;
  let bestClusterCount = -1;
  for (let i = 0; i < tileCount; i++) {
    const c = tileMedians[i]!;
    let score = 0;
    let matches = 0;
    for (let j = 0; j < tileCount; j++) {
      if (rgbDist(c, tileMedians[j]!) <= 38) {
        const ty = Math.floor(j / gridCols);
        const tx = j - ty * gridCols;
        const isBorderTile = ty === 0 || ty === gridRows - 1 || tx === 0 || tx === gridCols - 1;
        score += isBorderTile ? 2 : 1;
        matches += 1;
      }
    }
    if (score > bestClusterScore) {
      bestClusterScore = score;
      bestClusterCount = matches;
      bestClusterCenter = c;
    }
  }

  const tileIsBg = new Uint8Array(tileCount);
  const tileR = new Float32Array(tileCount);
  const tileG = new Float32Array(tileCount);
  const tileB = new Float32Array(tileCount);

  // A tile half-covered by same-hue lettering has a blended per-channel median (e.g. pinkish on a
  // white card with red script) that still falls inside the cluster ball. When enough genuinely
  // smooth tiles exist, only those seed the surface; the mixed tiles are solved from them below
  // (harmonic fill + local refinement), which recovers their true background color.
  let smoothSeedCount = 0;
  for (let i = 0; i < tileCount; i++) {
    if (tileSpread[i]! <= 18 && rgbDist(tileMedians[i]!, bestClusterCenter) <= 44) {
      smoothSeedCount += 1;
    }
  }
  const smoothSeedsOnly = smoothSeedCount >= Math.max(4, Math.ceil(tileCount * 0.08));
  if (smoothSeedsOnly) {
    // Describe the surface by its clean tiles (the winning center may itself be a blended tile)
    const seedR: number[] = [];
    const seedG: number[] = [];
    const seedB: number[] = [];
    for (let i = 0; i < tileCount; i++) {
      const tm = tileMedians[i]!;
      if (tileSpread[i]! <= 18 && rgbDist(tm, bestClusterCenter) <= 44) {
        seedR.push(tm[0]);
        seedG.push(tm[1]);
        seedB.push(tm[2]);
      }
    }
    const cleanCenter: RgbTuple = [medianOf(seedR), medianOf(seedG), medianOf(seedB)];
    if (rgbDist(cleanCenter, bestClusterCenter) <= 44) bestClusterCenter = cleanCenter;
  }

  for (let i = 0; i < tileCount; i++) {
    const tm = tileMedians[i]!;
    if (
      rgbDist(tm, bestClusterCenter) <= 44 &&
      (!smoothSeedsOnly || tileSpread[i]! <= 18)
    ) {
      tileIsBg[i] = 1;
      tileR[i] = tm[0];
      tileG[i] = tm[1];
      tileB[i] = tm[2];
    } else {
      // Initialize foreground-covered tiles to dominant background center (NEVER dark letter ink!)
      tileR[i] = bestClusterCenter[0];
      tileG[i] = bestClusterCenter[1];
      tileB[i] = bestClusterCenter[2];
    }
  }

  // Smooth multi-stop gradient support: a single RGB ball around `bestClusterCenter` only covers
  // part of a strong 2D gradient (e.g. Disney+'s #53A0B3 teal -> #0F203C navy spans ~145 RGB), so
  // region-grow the background from the confirmed seed tiles into every SMOOTH neighbor tile whose
  // median steps gently from an already-confirmed background tile. Each grown tile keeps its own
  // true local median, so B(x,y) follows the gradient across the whole canvas instead of
  // flattening the far corners to the cluster center. Flat solid emblems / thick letter interiors
  // are smooth too, but sit a full ink-contrast step away from their neighbors and never join.
  const SMOOTH_TILE_SPREAD = 18;
  const SMOOTH_TILE_STEP = 38;
  for (let grew = true, guard = 0; grew && guard < tileCount; guard++) {
    grew = false;
    for (let idx = 0; idx < tileCount; idx++) {
      if (tileIsBg[idx] === 1 || tileSpread[idx]! > SMOOTH_TILE_SPREAD) continue;
      const ty = Math.floor(idx / gridCols);
      const tx = idx - ty * gridCols;
      const nbs = [
        ty > 0 ? idx - gridCols : -1,
        ty + 1 < gridRows ? idx + gridCols : -1,
        tx > 0 ? idx - 1 : -1,
        tx + 1 < gridCols ? idx + 1 : -1,
      ];
      for (const nb of nbs) {
        if (nb >= 0 && tileIsBg[nb] === 1 && rgbDist(tileMedians[idx]!, tileMedians[nb]!) <= SMOOTH_TILE_STEP) {
          const tm = tileMedians[idx]!;
          tileIsBg[idx] = 1;
          tileR[idx] = tm[0];
          tileG[idx] = tm[1];
          tileB[idx] = tm[2];
          grew = true;
          break;
        }
      }
    }
  }

  // Harmonic fill: relax every non-anchored tile toward the average of its 4 neighbors until the
  // surface converges, so text/emblem-covered tiles inherit the surrounding gradient instead of
  // a stale cluster-center initial value.
  const tileIsAnchor = new Uint8Array(tileIsBg);
  const relaxUnanchoredTiles = () => {
    for (let pass = 0; pass < 240; pass++) {
      let maxDelta = 0;
      for (let ty = 0; ty < gridRows; ty++) {
        for (let tx = 0; tx < gridCols; tx++) {
          const idx = ty * gridCols + tx;
          if (tileIsAnchor[idx] === 1) continue;
          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          let sumW = 0;
          const nbs = [
            ty > 0 ? idx - gridCols : -1,
            ty + 1 < gridRows ? idx + gridCols : -1,
            tx > 0 ? idx - 1 : -1,
            tx + 1 < gridCols ? idx + 1 : -1,
          ];
          for (const nb of nbs) {
            if (nb >= 0) {
              const w = tileIsAnchor[nb] === 1 ? 2.5 : 1;
              sumR += tileR[nb]! * w;
              sumG += tileG[nb]! * w;
              sumB += tileB[nb]! * w;
              sumW += w;
            }
          }
          if (sumW > 0) {
            const nr = sumR / sumW;
            const ng = sumG / sumW;
            const nb2 = sumB / sumW;
            const delta =
              Math.abs(nr - tileR[idx]!) + Math.abs(ng - tileG[idx]!) + Math.abs(nb2 - tileB[idx]!);
            if (delta > maxDelta) maxDelta = delta;
            tileR[idx] = nr;
            tileG[idx] = ng;
            tileB[idx] = nb2;
          }
        }
      }
      if (maxDelta < 0.2) break;
    }
  };
  relaxUnanchoredTiles();

  // Local refinement: a tile partly covered by lettering still shows plenty of true background
  // between the strokes. Take the median of its samples that agree with the predicted local
  // surface and anchor the tile to it, so B(x,y) stays exact directly BEHIND the text (this is
  // what the Clean Background inpaint and the alpha un-mixing read). Never promotes a tile to
  // `tileIsBg`: confidence / noise statistics keep using genuinely clean tiles only.
  let refinedAnyTile = false;
  for (let idx = 0; idx < tileCount; idx++) {
    if (tileIsAnchor[idx] === 1) continue;
    const samples = tileSamples[idx]!;
    const sampleCount = samples.length / 3;
    // Shrinking-radius consensus (30 -> 16 -> 10) so one-sided anti-aliased halo pixels around
    // the strokes cannot drag the estimate toward the ink color.
    let estimate: RgbTuple = [tileR[idx]!, tileG[idx]!, tileB[idx]!];
    let agreed = 0;
    for (const radius of [30, 16, 10]) {
      const rs: number[] = [];
      const gs: number[] = [];
      const bs: number[] = [];
      for (let s = 0; s < sampleCount; s++) {
        const sr = samples[s * 3]!;
        const sg = samples[s * 3 + 1]!;
        const sb = samples[s * 3 + 2]!;
        if (rgbDist([sr, sg, sb], estimate) <= radius) {
          rs.push(sr);
          gs.push(sg);
          bs.push(sb);
        }
      }
      if (rs.length < Math.max(6, sampleCount * 0.15)) break;
      estimate = [medianOf(rs), medianOf(gs), medianOf(bs)];
      agreed += 1;
    }
    if (agreed > 0) {
      tileR[idx] = estimate[0];
      tileG[idx] = estimate[1];
      tileB[idx] = estimate[2];
      tileIsAnchor[idx] = 1;
      refinedAnyTile = true;
    }
  }
  if (refinedAnyTile) relaxUnanchoredTiles();

  const backdropIsLight = relativeLuminance(bestClusterCenter) >= 0.5;
  const bgIsAchromatic =
    Math.max(bestClusterCenter[0], bestClusterCenter[1], bestClusterCenter[2]) -
      Math.min(bestClusterCenter[0], bestClusterCenter[1], bestClusterCenter[2]) <=
    14;

  // Bilinear surface through the tile CENTERS (each tile median describes its center, not its
  // left/top edge), linearly extrapolated across the outer half-tile so a gradient keeps its
  // slope right up to the canvas border instead of drifting by half a tile.
  const evalLocalBg = (x: number, y: number): RgbTuple => {
    const gx = clamp(((x + 0.5) * gridCols) / width - 0.5, -0.5, gridCols - 0.5);
    const gy = clamp(((y + 0.5) * gridRows) / height - 0.5, -0.5, gridRows - 0.5);
    const x0 = clamp(Math.floor(gx), 0, Math.max(0, gridCols - 2));
    const y0 = clamp(Math.floor(gy), 0, Math.max(0, gridRows - 2));
    const x1 = Math.min(gridCols - 1, x0 + 1);
    const y1 = Math.min(gridRows - 1, y0 + 1);
    const fx = gx - x0;
    const fy = gy - y0;
    const i00 = y0 * gridCols + x0;
    const i10 = y0 * gridCols + x1;
    const i01 = y1 * gridCols + x0;
    const i11 = y1 * gridCols + x1;
    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;
    return [
      clamp(w00 * tileR[i00]! + w10 * tileR[i10]! + w01 * tileR[i01]! + w11 * tileR[i11]!, 0, 255),
      clamp(w00 * tileG[i00]! + w10 * tileG[i10]! + w01 * tileG[i01]! + w11 * tileG[i11]!, 0, 255),
      clamp(w00 * tileB[i00]! + w10 * tileB[i10]! + w01 * tileB[i01]! + w11 * tileB[i11]!, 0, 255),
    ];
  };

  const distField = new Float32Array(pixelCount);
  const bgTileResidualDists: number[] = [];
  for (let y = 0; y < height; y++) {
    const ty = Math.min(gridRows - 1, Math.floor((y * gridRows) / height));
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const p = rowOff + x;
      const o = p * 4;
      const r = masterData[o]!;
      const g = masterData[o + 1]!;
      const b = masterData[o + 2]!;
      const bg = evalLocalBg(x, y);
      const dr = r - bg[0];
      const dg = g - bg[1];
      const db = b - bg[2];
      const chroma = bgIsAchromatic ? Math.max(r, g, b) - Math.min(r, g, b) : 0;
      const d = Math.sqrt(dr * dr + dg * dg + db * db + 1.5 * chroma * chroma);
      distField[p] = d;
      const tx = Math.min(gridCols - 1, Math.floor((x * gridCols) / width));
      if (tileIsBg[ty * gridCols + tx] === 1 && ((x + y) & 1) === 0) {
        bgTileResidualDists.push(d);
      }
    }
  }

  // Count every confirmed background tile (seed cluster + smooth gradient growth), so a strong
  // gradient is not misread as a "complex textured scene" just because it outruns one RGB ball.
  let confirmedBgTiles = 0;
  for (let i = 0; i < tileCount; i++) confirmedBgTiles += tileIsBg[i]!;
  const bgTileRatio = Math.max(bestClusterCount, confirmedBgTiles) / tileCount;
  const sigmaB = Math.max(3, percentileOf(bgTileResidualDists, 0.65));
  const p85Residual = percentileOf(bgTileResidualDists, 0.85);
  const backgroundConfidence = clamp(
    bgTileRatio * 0.65 + clamp(1 - (p85Residual - 10) / 36, 0, 1) * 0.35,
    0,
    1
  );

  if (bgTileRatio < 0.25) {
    return emptyFail('complex-textured-scene', backgroundConfidence);
  }

  const tLow = clamp(1.8 * sigmaB + 8, 14, 28);
  const tHigh = clamp(tLow + 34, 48, 74);

  // Compute 90th-percentile foreground ink contrast so Stage 2 component connectivity
  // floods solid glyph stroke cores (`tConnect`) instead of bridging across tight kerning gaps
  // via faint 4% anti-aliased halos (`tLow`), while Stage 4 still mattes smoothly down to `tLow`!
  const fgDistSamples: number[] = [];
  const fgSampleStep = Math.max(1, Math.floor(pixelCount / 4096));
  for (let p = 0; p < pixelCount; p += fgSampleStep) {
    if (distField[p]! > tHigh) fgDistSamples.push(distField[p]!);
  }
  const p90FgDist = fgDistSamples.length > 0 ? percentileOf(fgDistSamples, 0.9) : tHigh + 20;
  const tConnect = clamp(
    Math.max(tLow + 10, p90FgDist * 0.36),
    24,
    Math.max(tHigh - 2, p90FgDist * 0.52)
  );
  const tSeed = Math.max(tHigh, tConnect + 4);

  // Stage 2: Extract Foreground Connected Components (+ Automatic Vertical Valley Splitting for touching kerning!)
  interface FgComponent {
    id: number;
    pixels: number[];
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    w: number;
    h: number;
    cx: number;
    cy: number;
    area: number;
    touchesOuterBorder: boolean;
    /** Split off a frame / border decoration (see frame-vs-lettering separation). */
    fromFrame: boolean;
    origDelta: number;
    meanRgb: RgbTuple;
  }

  const compMap = new Int32Array(pixelCount);
  const bfsQueue = new Int32Array(pixelCount);
  const rawComponents: Array<{
    pixels: number[];
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    touchesOuterBorder: boolean;
    fromFrame?: boolean;
  }> = [];
  const frameCandidates: Array<{
    pixels: number[];
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }> = [];
  const wmStartX = Math.floor(width * 0.9);
  const wmStartY = Math.floor(height * 0.9);
  const maxWmArea = Math.floor(pixelCount * 0.0035);

  const origData = options?.originalData;
  const origW = options?.originalWidth ?? 0;
  const origH = options?.originalHeight ?? 0;
  const hasCompatibleOrig =
    Boolean(origData && origW >= 16 && origH >= 16) &&
    Math.abs(width / height - origW / origH) / (width / height) <= 0.28;

  // Classifies one connected foreground shape as watermark / frame candidate / raw component.
  const registerRawComponent = (pixels: number[]) => {
    if (pixels.length < 4) return;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    for (const p of pixels) {
      const px = p % width;
      const py = (p - px) / width;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    if (minX >= wmStartX && minY >= wmStartY && pixels.length <= maxWmArea) return;
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    const sidesTouched =
      (minX === 0 ? 1 : 0) +
      (maxX === width - 1 ? 1 : 0) +
      (minY === 0 ? 1 : 0) +
      (maxY === height - 1 ? 1 : 0);
    const touchesOuterBorder = sidesTouched > 0;
    if (
      touchesOuterBorder &&
      (cw >= width * 0.85 || ch >= height * 0.85 || sidesTouched >= 2)
    ) {
      // A frame / border decoration. Lettering that merely TOUCHES it (e.g. a script swash
      // brushing a halftone-dot border) must not be thrown away with it: resolved below.
      frameCandidates.push({ pixels, minX, maxX, minY, maxY });
      return;
    }
    rawComponents.push({ pixels, minX, maxX, minY, maxY, touchesOuterBorder });
  };

  // INK-COLOUR SEPARATION. Lettering drawn ACROSS artwork (purple script over a gold basketball
  // with black seams) is one connected foreground shape; no amount of shape geometry can tell the
  // letters from the ball. Their ink colours can. A large shape made of two or more clearly
  // different, substantial colours is split into one piece per colour region, so the letters, the
  // ball and the seams each become their own component for the word / emblem logic below.
  // Single-colour shapes (ordinary letters, a solid emblem, a one-colour frame) are untouched.
  const compositeMinBoxArea = pixelCount * 0.12;
  const colourSplitLeftovers: number[] = [];
  // Every tangled multi-ink shape seen, with its box and whether its lettering ink was decided.
  // The self-check only cares about the ones that actually reach the chosen lettering.
  const tangledShapes: Array<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    decided: boolean;
  }> = [];
  // Thin blended rims / minor inks of a tangled shape: erased with the lettering when they hug
  // it (its anti-aliased edge over the artwork), preserved as artwork otherwise.
  const colourSplitRimPixels: number[] = [];
  const letteringCrumbPixels: number[] = [];
  const splitCompositeByInk = (pixels: number[]): number[][] => {
    if (pixels.length < 400) return [pixels];
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    for (const p of pixels) {
      const px = p % width;
      const py = (p - px) / width;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    if ((maxX - minX + 1) * (maxY - minY + 1) < compositeMinBoxArea) return [pixels];

    // Coarse 16-level-per-channel colour histogram of the shape
    const binCount = new Map<number, number>();
    for (const p of pixels) {
      const o = p * 4;
      const key = ((masterData[o]! >> 4) << 8) | ((masterData[o + 1]! >> 4) << 4) | (masterData[o + 2]! >> 4);
      binCount.set(key, (binCount.get(key) ?? 0) + 1);
    }
    const binColour = (key: number): RgbTuple => [
      ((key >> 8) & 15) * 16 + 8,
      ((key >> 4) & 15) * 16 + 8,
      (key & 15) * 16 + 8,
    ];
    // Greedy clustering, most populous bins first (cluster radius 48)
    const clusters: Array<{ sum: [number, number, number]; count: number; centre: RgbTuple }> = [];
    for (const [key, count] of [...binCount.entries()].sort((a, b) => b[1] - a[1])) {
      const col = binColour(key);
      let best = -1;
      let bestDist = 48;
      for (let k = 0; k < clusters.length; k++) {
        const d = rgbDist(col, clusters[k]!.centre);
        if (d <= bestDist) {
          bestDist = d;
          best = k;
        }
      }
      if (best >= 0) {
        const cl = clusters[best]!;
        cl.sum[0] += col[0] * count;
        cl.sum[1] += col[1] * count;
        cl.sum[2] += col[2] * count;
        cl.count += count;
      } else if (clusters.length < 8) {
        clusters.push({
          sum: [col[0] * count, col[1] * count, col[2] * count],
          count,
          centre: col,
        });
      }
    }
    const inks = clusters
      // Minor inks (thin seams, outlines) get their own label so they are not lumped into a
      // neighbouring ink; only major inks compete to be the lettering below.
      .filter((cl) => cl.count >= pixels.length * 0.015 && cl.count >= 80)
      .sort((a, b) => b.count - a.count)
      .map((cl): RgbTuple => [cl.sum[0] / cl.count, cl.sum[1] / cl.count, cl.sum[2] / cl.count])
      // A soft / anti-aliased edge is the ink blended with the card colour: it sits on the
      // straight line between a bigger ink and the background and is NOT a separate ink.
      // (Blurry or upscaled lettering can have a lot of it.)
      .filter((cand, idx, all) => {
        for (let a = 0; a < idx; a++) {
          const ink = all[a]!;
          const vx = bestClusterCenter[0] - ink[0];
          const vy = bestClusterCenter[1] - ink[1];
          const vz = bestClusterCenter[2] - ink[2];
          const lenSq = vx * vx + vy * vy + vz * vz;
          if (lenSq < 1) continue;
          const dx = cand[0] - ink[0];
          const dy = cand[1] - ink[1];
          const dz = cand[2] - ink[2];
          const t = (dx * vx + dy * vy + dz * vz) / lenSq;
          if (t <= 0.04 || t >= 1) continue;
          const perp = Math.hypot(dx - t * vx, dy - t * vy, dz - t * vz);
          if (perp <= 32) return false;
        }
        return true;
      });
    if (inks.length < 2) return [pixels];
    let maxInkGap = 0;
    for (let a = 0; a < inks.length; a++) {
      for (let b = a + 1; b < inks.length; b++) {
        maxInkGap = Math.max(maxInkGap, rgbDist(inks[a]!, inks[b]!));
      }
    }
    if (maxInkGap < 90) return [pixels];

    // Label every pixel with its nearest ink, then take connected regions per ink
    // Flat typed arrays (not Map/Set): this runs over hundreds of thousands of pixels
    const inkOf = new Int8Array(pixelCount).fill(-1);
    // Bit flags of the image sides each ink reaches (left 1, right 2, top 4, bottom 8)
    const inkEdgeSides: number[] = [];
    for (const p of pixels) {
      const o = p * 4;
      const col: RgbTuple = [masterData[o]!, masterData[o + 1]!, masterData[o + 2]!];
      let best = 0;
      let bestDist = Infinity;
      for (let k = 0; k < inks.length; k++) {
        const d = rgbDist(col, inks[k]!);
        if (d < bestDist) {
          bestDist = d;
          best = k;
        }
      }
      inkOf[p] = best;
      const px = p % width;
      const py = (p - px) / width;
      let sides = inkEdgeSides[best] ?? 0;
      if (px === 0) sides |= 1;
      if (px === width - 1) sides |= 2;
      if (py === 0) sides |= 4;
      if (py === height - 1) sides |= 8;
      inkEdgeSides[best] = sides;
    }
    // Which ink is the lettering? Exactly one ink of a tangled shape can be; the others are the
    // artwork it lies across and are preserved untouched.
    //  1. With the original capture available, the lettering is the ink that CHANGED (the word
    //     was replaced, the artwork was kept).
    //  2. Otherwise the lettering is the ink laid out as a horizontal strip (a line of text),
    //     while artwork (a ball, a badge, a photo subject) is roughly as tall as it is wide.
    // If neither is decisive nothing here is claimed as lettering; the self-check then routes the
    // picture to the AI instead of guessing.
    const inkStats = inks.map(() => ({ xs: [] as number[], ys: [] as number[], delta: 0, samples: 0 }));
    const statStride = Math.max(1, Math.floor(pixels.length / 6000));
    for (let i = 0; i < pixels.length; i += statStride) {
      const p = pixels[i]!;
      const st = inkStats[inkOf[p]!]!;
      const px = p % width;
      const py = (p - px) / width;
      st.xs.push(px);
      st.ys.push(py);
      if (hasCompatibleOrig && origData) {
        const ox = clamp(Math.round((px / (width - 1)) * (origW - 1)), 0, origW - 1);
        const oy = clamp(Math.round((py / (height - 1)) * (origH - 1)), 0, origH - 1);
        const mo = p * 4;
        const oo = (oy * origW + ox) * 4;
        st.delta += clamp(
          Math.hypot(
            masterData[mo]! - origData[oo]!,
            masterData[mo + 1]! - origData[oo + 1]!,
            masterData[mo + 2]! - origData[oo + 2]!
          ) / 140,
          0,
          1
        );
      }
      st.samples += 1;
    }
    // Only substantial inks compete; thin blended rims between two inks follow a letter's outline
    // and would otherwise tie with the lettering itself.
    const totalSamples = inkStats.reduce((acc, st) => acc + st.samples, 0);
    const majorInks = inkStats
      .map((st, k) => ({ st, k }))
      .filter(({ st }) => st.samples >= totalSamples * 0.12);
    let letteringInk = -1;
    if (majorInks.length === 1) {
      letteringInk = -1;
    } else if (hasCompatibleOrig && majorInks.length >= 2) {
      const ranked = majorInks
        .map(({ st, k }) => ({ d: st.delta / Math.max(1, st.samples), k }))
        .sort((a, b) => b.d - a.d);
      if (ranked[0]!.d >= 0.25 && ranked[0]!.d - ranked[1]!.d >= 0.12) letteringInk = ranked[0]!.k;
    }
    // 1b. An ink that runs off two or more sides of the picture is a panel, band or backdrop shape
    //     (a red roof over a white card, a ball cropped by the frame), not lettering. If that
    //     leaves exactly one substantial ink, that ink is the lettering.
    if (letteringInk < 0 && majorInks.length >= 2) {
      const countSides = (flags: number) =>
        (flags & 1 ? 1 : 0) + (flags & 2 ? 1 : 0) + (flags & 4 ? 1 : 0) + (flags & 8 ? 1 : 0);
      const notRunningOff = majorInks.filter(({ k }) => countSides(inkEdgeSides[k] ?? 0) < 2);
      if (notRunningOff.length === 1 && notRunningOff.length < majorInks.length) {
        letteringInk = notRunningOff[0]!.k;
      }
    }
    if (letteringInk < 0 && majorInks.length >= 2) {
      const strips = majorInks
        .map(({ st, k }) => {
          if (st.samples < 20) return { k, aspect: 0 };
          const xExtent = percentileOf(st.xs, 0.97) - percentileOf(st.xs, 0.03) + 1;
          const yExtent = percentileOf(st.ys, 0.97) - percentileOf(st.ys, 0.03) + 1;
          return { k, aspect: xExtent / Math.max(1, yExtent) };
        })
        .sort((a, b) => b.aspect - a.aspect);
      if (strips[0]!.aspect >= 1.6 && strips[0]!.aspect >= strips[1]!.aspect * 1.4) {
        letteringInk = strips[0]!.k;
      }
    }

    if (majorInks.length >= 2) {
      tangledShapes.push({ minX, maxX, minY, maxY, decided: letteringInk >= 0 });
    }
    const majorInkSet = new Set<number>(majorInks.map((m) => m.k));
    const parts: number[][] = [];
    const seen = new Uint8Array(pixelCount);
    for (const start of pixels) {
      if (seen[start] === 1) continue;
      const ink = inkOf[start]!;
      const part: number[] = [];
      const stack = [start];
      seen[start] = 1;
      while (stack.length > 0) {
        const p = stack.pop()!;
        part.push(p);
        const px = p % width;
        const py = (p - px) / width;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            if (nx < 0 || nx >= width) continue;
            const np = ny * width + nx;
            if (seen[np] === 0 && inkOf[np] === ink) {
              seen[np] = 1;
              stack.push(np);
            }
          }
        }
      }
      // Artwork inks, and slivers of blended edge pixels, are kept as untouched artwork
      if (ink === letteringInk && part.length >= 24) parts.push(part);
      else if (ink === letteringInk) {
        // A crumb of the lettering's own ink (too small to be a component): never artwork.
        // It is erased from the Clean Background together with the lettering.
        for (const p of part) letteringCrumbPixels.push(p);
      } else if (letteringInk >= 0 && !majorInkSet.has(ink)) {
        for (const p of part) colourSplitRimPixels.push(p);
      } else for (const p of part) colourSplitLeftovers.push(p);
    }
    return parts;
  };
  let nextRawId = 1;
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const start = rowOff + x;
      if (compMap[start] !== 0 || distField[start]! <= tSeed) continue;

      const rawId = nextRawId++;
      let qh = 0;
      let qt = 0;
      compMap[start] = rawId;
      bfsQueue[qt++] = start;
      const pixels: number[] = [];
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let touchesOuterBorder = false;

      while (qh < qt) {
        const p = bfsQueue[qh++]!;
        pixels.push(p);
        const px = p % width;
        const py = (p - px) / width;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        if (px === 0 || px === width - 1 || py === 0 || py === height - 1) {
          touchesOuterBorder = true;
        }

        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = px + dx;
            if (nx < 0 || nx >= width) continue;
            const np = ny * width + nx;
            if (compMap[np] === 0 && distField[np]! > tConnect) {
              compMap[np] = rawId;
              bfsQueue[qt++] = np;
            }
          }
        }
      }

      void minX;
      void maxX;
      void minY;
      void maxY;
      void touchesOuterBorder;
      for (const part of splitCompositeByInk(pixels)) registerRawComponent(part);
    }
  }

  // Frame vs lettering separation. For each border-hugging component, erode it by a growing
  // radius and flood from the image edge: the flood covers the frame but cannot pass the thin
  // neck where a letter touches it. Whatever large interior part is left over is real foreground
  // (lettering or an inner emblem) and goes back into the component list; the frame itself is
  // recorded so it is preserved untouched in the Clean Background and never reaches the Font.
  const isFramePixel = new Uint8Array(pixelCount);
  for (const p of colourSplitLeftovers) isFramePixel[p] = 1;
  const minInteriorArea = Math.max(150, Math.floor(pixelCount * 0.002));
  for (const fc of frameCandidates) {
    const bw = fc.maxX - fc.minX + 1;
    const bh = fc.maxY - fc.minY + 1;
    const local = new Uint8Array(bw * bh);
    for (const p of fc.pixels) {
      const px = p % width;
      const py = (p - px) / width;
      local[(py - fc.minY) * bw + (px - fc.minX)] = 1;
    }
    // City-block distance to the nearest non-component pixel. Beyond the IMAGE edge counts as
    // "inside", so a frame is never eroded from the side where it runs off the picture.
    const BIG = 1 << 20;
    const dist = new Int32Array(bw * bh);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        if (local[i] === 0) continue;
        const gx = x + fc.minX;
        const gy = y + fc.minY;
        const left = x > 0 ? dist[i - 1]! + 1 : gx === 0 ? BIG : 1;
        const up = y > 0 ? dist[i - bw]! + 1 : gy === 0 ? BIG : 1;
        dist[i] = Math.min(left, up, BIG);
      }
    }
    for (let y = bh - 1; y >= 0; y--) {
      for (let x = bw - 1; x >= 0; x--) {
        const i = y * bw + x;
        if (local[i] === 0) continue;
        const gx = x + fc.minX;
        const gy = y + fc.minY;
        const right = x < bw - 1 ? dist[i + 1]! + 1 : gx === width - 1 ? BIG : 1;
        const down = y < bh - 1 ? dist[i + bw]! + 1 : gy === height - 1 ? BIG : 1;
        dist[i] = Math.min(dist[i]!, right, down);
      }
    }

    let resolved = false;
    for (const radius of [2, 3, 4, 6, 8, 11, 14]) {
      // 1. Flood the eroded component from the image edge
      const state = new Uint8Array(bw * bh); // 1 = frame
      let queue: number[] = [];
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const gx = x + fc.minX;
          const gy = y + fc.minY;
          if (gx !== 0 && gy !== 0 && gx !== width - 1 && gy !== height - 1) continue;
          const i = y * bw + x;
          if (local[i] === 1 && dist[i]! > radius) {
            state[i] = 1;
            queue.push(i);
          }
        }
      }
      if (queue.length === 0) break;
      for (let qh = 0; qh < queue.length; qh++) {
        const i = queue[qh]!;
        const x = i % bw;
        const y = (i - x) / bw;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= bh) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= bw) continue;
            const ni = ny * bw + nx;
            if (state[ni] === 0 && local[ni] === 1 && dist[ni]! > radius) {
              state[ni] = 1;
              queue.push(ni);
            }
          }
        }
      }
      // 2. Grow the flooded core back out by the erosion radius (restores the frame's own rim)
      for (let step = 0; step <= radius && queue.length > 0; step++) {
        const next: number[] = [];
        for (const i of queue) {
          const x = i % bw;
          const y = (i - x) / bw;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= bh) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= bw) continue;
              const ni = ny * bw + nx;
              if (state[ni] === 0 && local[ni] === 1) {
                state[ni] = 1;
                next.push(ni);
              }
            }
          }
        }
        queue = next;
      }
      // 3. Label what is left; parts still touching the image edge belong to the frame
      const label = new Int32Array(bw * bh);
      const parts: Array<{ pixels: number[]; touchesEdge: boolean }> = [];
      for (let start = 0; start < bw * bh; start++) {
        if (local[start] === 0 || state[start] === 1 || label[start] !== 0) continue;
        const id = parts.length + 1;
        const partPixels: number[] = [];
        let touchesEdge = false;
        const stack = [start];
        label[start] = id;
        while (stack.length > 0) {
          const i = stack.pop()!;
          const x = i % bw;
          const y = (i - x) / bw;
          const gx = x + fc.minX;
          const gy = y + fc.minY;
          partPixels.push(gy * width + gx);
          if (gx === 0 || gy === 0 || gx === width - 1 || gy === height - 1) touchesEdge = true;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= bh) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= bw) continue;
              const ni = ny * bw + nx;
              if (local[ni] === 1 && state[ni] === 0 && label[ni] === 0) {
                label[ni] = id;
                stack.push(ni);
              }
            }
          }
        }
        parts.push({ pixels: partPixels, touchesEdge });
      }
      if (!parts.some((part) => !part.touchesEdge && part.pixels.length >= minInteriorArea)) {
        continue;
      }
      for (let i = 0; i < bw * bh; i++) {
        if (state[i] === 1) {
          const x = i % bw;
          isFramePixel[(fc.minY + (i - x) / bw) * width + (fc.minX + x)] = 1;
        }
      }
      for (const part of parts) {
        if (part.touchesEdge || part.pixels.length < 4) {
          for (const p of part.pixels) isFramePixel[p] = 1;
          continue;
        }
        let pMinX = width;
        let pMaxX = -1;
        let pMinY = height;
        let pMaxY = -1;
        for (const p of part.pixels) {
          const px = p % width;
          const py = (p - px) / width;
          if (px < pMinX) pMinX = px;
          if (px > pMaxX) pMaxX = px;
          if (py < pMinY) pMinY = py;
          if (py > pMaxY) pMaxY = py;
        }
        rawComponents.push({
          pixels: part.pixels,
          minX: pMinX,
          maxX: pMaxX,
          minY: pMinY,
          maxY: pMaxY,
          touchesOuterBorder: false,
          fromFrame: true,
        });
      }
      resolved = true;
      break;
    }
    if (!resolved) {
      for (const p of fc.pixels) isFramePixel[p] = 1;
    }
  }

  // Split wide fused multi-letter components along deep vertical projection valleys
  // (in case tightly kerned bold letters like "Banan" touch by a few pixels at their serifs/bowls!)
  const splitPixelGroups: Array<{
    pixels: number[];
    touchesOuterBorder: boolean;
    fromFrame: boolean;
  }> = [];
  for (const rc of rawComponents) {
    const cw = rc.maxX - rc.minX + 1;
    const ch = rc.maxY - rc.minY + 1;
    // A hollow outline (a box drawn around a motto, a badge ring) is one object, not fused letters:
    // cutting it at its near-empty columns would leave tall slivers that pass for glyphs.
    const isHollowOutline = rc.pixels.length < cw * ch * 0.12;
    if (cw > ch * 1.18 && ch >= 14 && cw >= 24 && !isHollowOutline) {
      const colCounts = new Int32Array(cw);
      for (const p of rc.pixels) {
        const px = p % width;
        colCounts[px - rc.minX]! += 1;
      }
      const minLobeW = Math.max(5, Math.round(ch * 0.28));
      const valleyCeil = Math.max(2, Math.floor(ch * 0.16));
      const cutXs: number[] = [];
      let lastCut = 0;
      for (let ix = minLobeW; ix <= cw - minLobeW; ix++) {
        const cVal = colCounts[ix]!;
        if (cVal > valleyCeil) continue;
        // Require a local minimum and substantial ink lobes on both left and right
        if (cVal <= colCounts[ix - 1]! && cVal <= colCounts[Math.min(cw - 1, ix + 1)]!) {
          let leftPeak = 0;
          for (let lx = lastCut; lx < ix; lx++) {
            if (colCounts[lx]! > leftPeak) leftPeak = colCounts[lx]!;
          }
          let rightPeak = 0;
          const rightLim = Math.min(cw, ix + minLobeW * 2);
          for (let rx = ix + 1; rx < rightLim; rx++) {
            if (colCounts[rx]! > rightPeak) rightPeak = colCounts[rx]!;
          }
          if (
            leftPeak >= Math.max(4, ch * 0.35) &&
            rightPeak >= Math.max(4, ch * 0.35) &&
            ix - lastCut >= minLobeW
          ) {
            cutXs.push(rc.minX + ix);
            lastCut = ix;
          }
        }
      }
      if (cutXs.length > 0) {
        const buckets: number[][] = Array.from({ length: cutXs.length + 1 }, () => []);
        for (const p of rc.pixels) {
          const px = p % width;
          let bIdx = cutXs.length;
          for (let k = 0; k < cutXs.length; k++) {
            if (px <= cutXs[k]!) {
              bIdx = k;
              break;
            }
          }
          buckets[bIdx]!.push(p);
        }
        for (const bPixels of buckets) {
          if (bPixels.length >= 4) {
            splitPixelGroups.push({
              pixels: bPixels,
              touchesOuterBorder: rc.touchesOuterBorder,
              fromFrame: Boolean(rc.fromFrame),
            });
          }
        }
        continue;
      }
    }
    splitPixelGroups.push({
      pixels: rc.pixels,
      touchesOuterBorder: rc.touchesOuterBorder,
      fromFrame: Boolean(rc.fromFrame),
    });
  }

  const components: FgComponent[] = [];
  for (const grp of splitPixelGroups) {
    const pixels = grp.pixels;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (const p of pixels) {
      const px = p % width;
      const py = (p - px) / width;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      const o = p * 4;
      sumR += masterData[o]!;
      sumG += masterData[o + 1]!;
      sumB += masterData[o + 2]!;
    }
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    let origDelta = 0.5;
    if (hasCompatibleOrig && origData) {
      let diffSum = 0;
      let samples = 0;
      const stride = Math.max(1, Math.floor(pixels.length / 80));
      for (let i = 0; i < pixels.length; i += stride) {
        const p = pixels[i]!;
        const px = p % width;
        const py = (p - px) / width;
        const ox = clamp(Math.round((px / (width - 1)) * (origW - 1)), 0, origW - 1);
        const oy = clamp(Math.round((py / (height - 1)) * (origH - 1)), 0, origH - 1);
        const mo = p * 4;
        const oo = (oy * origW + ox) * 4;
        const d = Math.hypot(
          masterData[mo]! - origData[oo]!,
          masterData[mo + 1]! - origData[oo + 1]!,
          masterData[mo + 2]! - origData[oo + 2]!
        );
        diffSum += clamp(d / 140, 0, 1);
        samples += 1;
      }
      if (samples > 0) origDelta = diffSum / samples;
    }

    components.push({
      id: components.length + 1,
      pixels,
      minX,
      maxX,
      minY,
      maxY,
      w: cw,
      h: ch,
      cx: (minX + maxX) * 0.5,
      cy: (minY + maxY) * 0.5,
      area: pixels.length,
      touchesOuterBorder: grp.touchesOuterBorder,
      fromFrame: grp.fromFrame,
      origDelta,
      meanRgb: [sumR / pixels.length, sumG / pixels.length, sumB / pixels.length],
    });
  }

  if (components.length === 0) {
    return emptyFail('no-text-cluster-found', backgroundConfidence);
  }

  // Stage 3: Multi-Cue Text-Cluster vs Emblem Discriminator
  // Group components into horizontal text bands by vertical overlap, anchoring taller main
  // letter bodies first so small diacritics ('i' dots, accents, CJK top radicals) never seed
  // premature tiny orphan bands before the main baseline is established.
  // 'clip' mode: cut every shape to the detected text area; whatever lies outside it is artwork
  // and takes no part in choosing the word.
  const clipArtworkIds = new Set<number>();
  if (options?.textMaskMode === 'clip' && options.textMask && options.textMask.length >= pixelCount) {
    const tm = options.textMask;
    const originalCount = components.length;
    for (let ci = 0; ci < originalCount; ci++) {
      const comp = components[ci]!;
      const inPart: number[] = [];
      const outPart: number[] = [];
      for (const px of comp.pixels) (tm[px] === 1 ? inPart : outPart).push(px);
      if (inPart.length < 4) {
        clipArtworkIds.add(comp.id);
        continue;
      }
      if (outPart.length < 4) continue;
      const boundsOf = (pixels: number[]) => {
        let bx0 = width;
        let bx1 = -1;
        let by0 = height;
        let by1 = -1;
        for (const px of pixels) {
          const x = px % width;
          const y = (px - x) / width;
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
        return { minX: bx0, maxX: bx1, minY: by0, maxY: by1 };
      };
      const ib = boundsOf(inPart);
      const ob = boundsOf(outPart);
      const reshape = (target: FgComponent, pixels: number[], b: ReturnType<typeof boundsOf>) => {
        target.pixels = pixels;
        target.area = pixels.length;
        target.minX = b.minX;
        target.maxX = b.maxX;
        target.minY = b.minY;
        target.maxY = b.maxY;
        target.w = b.maxX - b.minX + 1;
        target.h = b.maxY - b.minY + 1;
        target.cx = (b.minX + b.maxX) * 0.5;
        target.cy = (b.minY + b.maxY) * 0.5;
      };
      const artwork: FgComponent = { ...comp, id: 2000000 + ci };
      reshape(artwork, outPart, ob);
      reshape(comp, inPart, ib);
      components.push(artwork);
      clipArtworkIds.add(artwork.id);
    }
  }
  const sortedForBanding = components
    .filter((c) => !clipArtworkIds.has(c.id))
    .sort((a, b) => b.h - a.h || a.cy - b.cy);
  const bands: FgComponent[][] = [];

  for (const comp of sortedForBanding) {
    let bestBand: FgComponent[] | null = null;
    for (const band of bands) {
      const bMinY = Math.min(...band.map((c) => c.minY));
      const bMaxY = Math.max(...band.map((c) => c.maxY));
      const bH = Math.max(1, bMaxY - bMinY + 1);
      const bCy = (bMinY + bMaxY) * 0.5;
      const overlapY = Math.max(0, Math.min(comp.maxY, bMaxY) - Math.max(comp.minY, bMinY) + 1);
      const minH = Math.max(1, Math.min(comp.h, bH));
      if (overlapY / minH >= 0.35 || Math.abs(comp.cy - bCy) <= 0.45 * Math.max(comp.h, bH)) {
        bestBand = band;
        break;
      }
    }
    if (bestBand) bestBand.push(comp);
    else bands.push([comp]);
  }

  interface CharSlotColumn {
    comps: FgComponent[];
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    w: number;
    h: number;
    area: number;
    origDelta: number;
    meanRgb: RgbTuple;
  }

  // Group vertically overlapping pieces of the SAME character slot (e.g., 'i' stem + dot, or
  // thin split stencil halves of a single glyph) WITHOUT ever chain-merging adjacent distinct letters!
  const buildColumnsForBand = (band: FgComponent[]): CharSlotColumn[] => {
    const byX = [...band].sort((a, b) => a.minX - b.minX);
    const medH = Math.max(1, medianOf(byX.map((c) => c.h)));
    const cols: CharSlotColumn[] = [];
    for (const c of byX) {
      const prev = cols[cols.length - 1];
      let shouldMerge = false;
      if (prev) {
        const xOverlap = Math.max(0, Math.min(c.maxX, prev.maxX) - Math.max(c.minX, prev.minX) + 1);
        const minW = Math.max(1, Math.min(c.w, prev.w));
        const combinedW = Math.max(prev.maxX, c.maxX) - Math.min(prev.minX, c.minX) + 1;
        const xGap = Math.max(0, c.minX - prev.maxX);
        const isOverlappingSameGlyph =
          xOverlap >= minW * 0.35 &&
          combinedW <= Math.max(medH * 1.15, Math.max(prev.w, c.w) * 1.25) &&
          // Different inks stacked in one slot are different objects (a letter lying over artwork)
          rgbDist(c.meanRgb, prev.meanRgb) <= 70;
        const isSplitStencilSliver =
          prev.w <= medH * 0.24 &&
          c.w <= medH * 0.24 &&
          xGap <= Math.max(2, medH * 0.04) &&
          combinedW <= medH * 0.72;
        // Stencil glyph cut by a hairline bridge gap (e.g. stencil 'p' / 'e' / 'A': a ~60% stem
        // island + a ~35% bowl island, 2–5px apart). Both islands share the SAME ink and overlap
        // vertically, and together still fit inside ONE character slot — two real neighboring
        // letters are wider than that combined, so distinct letters are never chain-merged.
        const yOverlap = Math.max(0, Math.min(c.maxY, prev.maxY) - Math.max(c.minY, prev.minY) + 1);
        const isSplitStencilIsland =
          xGap <= Math.max(3, medH * 0.07) &&
          combinedW <= medH * 0.92 &&
          yOverlap >= Math.min(c.h, prev.h) * 0.5 &&
          rgbDist(c.meanRgb, prev.meanRgb) <= 35;
        shouldMerge = isOverlappingSameGlyph || isSplitStencilSliver || isSplitStencilIsland;
      }

      if (prev && shouldMerge) {
        const totalArea = prev.area + c.area;
        prev.meanRgb = [
          (prev.meanRgb[0] * prev.area + c.meanRgb[0] * c.area) / totalArea,
          (prev.meanRgb[1] * prev.area + c.meanRgb[1] * c.area) / totalArea,
          (prev.meanRgb[2] * prev.area + c.meanRgb[2] * c.area) / totalArea,
        ];
        prev.comps.push(c);
        prev.minX = Math.min(prev.minX, c.minX);
        prev.maxX = Math.max(prev.maxX, c.maxX);
        prev.minY = Math.min(prev.minY, c.minY);
        prev.maxY = Math.max(prev.maxY, c.maxY);
        prev.w = prev.maxX - prev.minX + 1;
        prev.h = prev.maxY - prev.minY + 1;
        prev.area = totalArea;
        prev.origDelta =
          prev.comps.reduce((acc, item) => acc + item.origDelta * item.area, 0) / prev.area;
      } else {
        cols.push({
          comps: [c],
          minX: c.minX,
          maxX: c.maxX,
          minY: c.minY,
          maxY: c.maxY,
          w: c.w,
          h: c.h,
          area: c.area,
          origDelta: c.origDelta,
          meanRgb: [...c.meanRgb],
        });
      }
    }
    return cols;
  };

  const targetCharCount = (options?.targetWord ?? '').replace(/\s+/g, '').length;

  // Score each horizontal band to pick the wordmark band (vs a detached top/bottom emblem like Alibaba's curl!)
  let winningBandIdx = 0;
  let bestBandScore = -Infinity;
  const bandColumns = bands.map(buildColumnsForBand);

  // Glyph-scale weighting: a row of small decorative specks (halftone dots, sparkles, stars)
  // can out-number the letters of a fused script wordmark many times over. Count each column in
  // proportion to its height against the tallest column anywhere, count a wide fused multi-letter
  // block as the letters it spans, and credit the band holding most of the ink.
  const globalMaxColH = Math.max(1, ...bandColumns.flatMap((cols) => cols.map((c) => c.h)));
  const totalColArea = Math.max(
    1,
    bandColumns.reduce((acc, cols) => acc + cols.reduce((a, c) => a + c.area, 0), 0)
  );

  for (let bIdx = 0; bIdx < bands.length; bIdx++) {
    const cols = bandColumns[bIdx]!;
    let weightedCount = 0;
    for (const c of cols) {
      // Quadratic falloff: a long row of tiny print (a dateline, a caption) must not out-vote a
      // handful of large title glyphs just by having many more characters.
      const scale = clamp((c.h / (globalMaxColH * 0.5)) ** 2, 0.02, 1);
      // A ruling line / underline is not a run of letters, however long it is
      if (c.w > c.h * 8) {
        weightedCount += 0.1;
        continue;
      }
      const spannedChars =
        c.w > c.h * 1.15 ? Math.min(8, Math.max(1, Math.round(c.w / Math.max(1, c.h * 0.65)))) : 1;
      weightedCount += scale * spannedChars;
    }
    const bandArea = cols.reduce((a, c) => a + c.area, 0);
    let score = weightedCount * 14 + (bandArea / totalColArea) * 40;
    if (targetCharCount >= 2) {
      if (cols.length === 1 && weightedCount < 1.5) score -= 55;
      const diff = Math.abs(weightedCount - targetCharCount);
      score += Math.max(0, 40 - diff * 12);
    } else if (cols.length >= 2) {
      score += 25;
    }
    if (hasCompatibleOrig) {
      const avgDelta =
        cols.reduce((acc, c) => acc + c.origDelta * c.area, 0) /
        Math.max(1, cols.reduce((acc, c) => acc + c.area, 0));
      score += avgDelta * 60;
    }
    if (score > bestBandScore) {
      bestBandScore = score;
      winningBandIdx = bIdx;
    }
  }

  const winningCols = [...bandColumns[winningBandIdx]!];
  const peeledEmblemCompIds = new Set<number>(clipArtworkIds);

  // Decoration-speck filter: small pieces sharing the word's Y-band that are NOT lettering —
  // fragments split off a frame / border, pieces running off the image edge, or free dots strewn
  // outside the word (halftone dots, sparkles). Punctuation and marks hugging the word stay.
  {
    // First drop frame debris that was grouped INTO a glyph column by horizontal overlap
    const compMaxH = Math.max(1, ...winningCols.flatMap((c) => c.comps.map((x) => x.h)));
    const compMaxArea = Math.max(1, ...winningCols.flatMap((c) => c.comps.map((x) => x.area)));
    for (let idx = winningCols.length - 1; idx >= 0; idx--) {
      const col = winningCols[idx]!;
      const kept = col.comps.filter((x) => {
        const isFrameDebris =
          (x.fromFrame || x.touchesOuterBorder) &&
          x.h < compMaxH * 0.45 &&
          x.area < compMaxArea * 0.18;
        // Ruling lines / underlines and hollow outline boxes (e.g. a newspaper masthead's rules
        // and its boxed motto) are page furniture, not lettering.
        const isRuleLine = x.w >= x.h * 8 && x.h <= compMaxH * 0.2;
        const isHollowBox =
          x.w * x.h >= compMaxH * compMaxH * 0.5 && x.area < x.w * x.h * 0.12;
        return !(isFrameDebris || isRuleLine || isHollowBox);
      });
      if (kept.length === col.comps.length) continue;
      for (const x of col.comps) {
        if (!kept.includes(x)) peeledEmblemCompIds.add(x.id);
      }
      if (kept.length === 0) {
        winningCols.splice(idx, 1);
        continue;
      }
      col.comps = kept;
      col.minX = Math.min(...kept.map((x) => x.minX));
      col.maxX = Math.max(...kept.map((x) => x.maxX));
      col.minY = Math.min(...kept.map((x) => x.minY));
      col.maxY = Math.max(...kept.map((x) => x.maxY));
      col.w = col.maxX - col.minX + 1;
      col.h = col.maxY - col.minY + 1;
      col.area = kept.reduce((acc, x) => acc + x.area, 0);
    }
    if (winningCols.length === 0) {
      return emptyFail('no-text-cluster-found', backgroundConfidence);
    }

    const bandMaxH = Math.max(1, ...winningCols.map((c) => c.h));
    const bandMaxArea = Math.max(1, ...winningCols.map((c) => c.area));
    // Small either as a whole, or a cluster of tiny pieces (a block of small print)
    const isSpeckCol = (c: CharSlotColumn) => {
      if (c.h >= bandMaxH * 0.45) return false;
      const tallestPiece = Math.max(...c.comps.map((x) => x.h));
      return c.area < bandMaxArea * 0.18 || tallestPiece < bandMaxH * 0.3;
    };
    const coreCols = winningCols.filter((c) => !isSpeckCol(c));
    if (coreCols.length > 0 && coreCols.length < winningCols.length) {
      const coreMinX = Math.min(...coreCols.map((c) => c.minX));
      const coreMaxX = Math.max(...coreCols.map((c) => c.maxX));
      const medCoreH = Math.max(1, medianOf(coreCols.map((c) => c.h)));
      const outsideGap = (c: CharSlotColumn) =>
        c.maxX < coreMinX ? coreMinX - c.maxX : c.minX > coreMaxX ? c.minX - coreMaxX : 0;
      const strewnOutside = winningCols.filter((c) => isSpeckCol(c) && outsideGap(c) > 0).length;
      for (let idx = winningCols.length - 1; idx >= 0; idx--) {
        const col = winningCols[idx]!;
        if (!isSpeckCol(col)) continue;
        const isFrameDebris = col.comps.every((c) => c.fromFrame || c.touchesOuterBorder);
        const gap = outsideGap(col);
        if (isFrameDebris || gap > medCoreH * 0.25 || (gap > 0 && strewnOutside >= 4)) {
          for (const c of col.comps) peeledEmblemCompIds.add(c.id);
          winningCols.splice(idx, 1);
        }
      }
    }
  }

  // Edge-Emblem Peeling: peels a left/right circular or shield emblem sitting on the SAME Y-band
  // as the lettering (e.g., a shield emblem to the left of a word, or a
  // tree crest to the left of "Apple").
  // Never peels a wide multi-letter word block (`w > h * 1.42`) and ignores tiny trailing
  // trademark/punctuation specks (`®`, `™`) when measuring glyph column medians!
  const tryPeelEdgeEmblem = (edgeIdx: number) => {
    if (winningCols.length < 2) return false;
    const candidate = winningCols[edgeIdx]!;

    // Guard 1: Never peel a wide horizontal multi-letter word block!
    if (candidate.w > candidate.h * 1.42 || candidate.w > width * 0.28) {
      return false;
    }

    const maxBandH = Math.max(1, ...winningCols.map((c) => c.h));
    const maxBandArea = Math.max(1, ...winningCols.map((c) => c.area));

    // Guard 2: Never peel a tiny trademark/punctuation speck ('®', '™', '.') as an "emblem"
    if (candidate.h < maxBandH * 0.45 && candidate.area < maxBandArea * 0.18) {
      return false;
    }

    const restAll = winningCols.filter((_, idx) => idx !== edgeIdx);
    const coreRest = restAll.filter(
      (c) => c.h >= maxBandH * 0.45 && c.area >= maxBandArea * 0.08
    );
    if (coreRest.length === 0) return false;

    // Normalize wide connected cursive/bold multi-letter blocks by their estimated character count
    // so a fused 5-letter block ("Banan") counts as ~5 character slots and ~1x per-character area!
    const estCharsOf = (c: CharSlotColumn) =>
      c.w > c.h * 1.15 ? Math.max(1, Math.round(c.w / Math.max(1, c.h * 0.65))) : 1;
    const coreColCount = 1 + coreRest.reduce((acc, c) => acc + estCharsOf(c), 0);
    const medRestH = Math.max(1, medianOf(coreRest.map((c) => c.h)));
    const medRestW = Math.max(1, medianOf(coreRest.map((c) => c.w / estCharsOf(c))));
    const medRestArea = Math.max(1, medianOf(coreRest.map((c) => c.area / estCharsOf(c))));
    const medRestDelta = medianOf(coreRest.map((c) => c.origDelta));

    const intraGaps: number[] = [];
    for (let i = 0; i < coreRest.length - 1; i++) {
      intraGaps.push(Math.max(0, coreRest[i + 1]!.minX - coreRest[i]!.maxX));
    }
    const medGap = intraGaps.length > 0 ? Math.max(1, medianOf(intraGaps)) : medRestW * 0.22;
    const neighborCol = edgeIdx === 0 ? coreRest[0]! : coreRest[coreRest.length - 1]!;
    const edgeGap =
      edgeIdx === 0
        ? Math.max(0, neighborCol.minX - candidate.maxX)
        : Math.max(0, candidate.minX - neighborCol.maxX);

    // Check color & fill-density divergence (e.g. solid blue shield `#0264A9` next to red/black letters!)
    const candidateFill = candidate.area / Math.max(1, candidate.w * candidate.h);
    const medRestFill = medianOf(coreRest.map((c) => c.area / Math.max(1, c.w * c.h)));
    const minColorDistToRest = Math.min(
      ...coreRest.map((c) => rgbDist(candidate.meanRgb, c.meanRgb))
    );
    const isDistinctColoredEmblem =
      minColorDistToRest > 48 &&
      (candidateFill > medRestFill * 1.15 || edgeGap > medGap * 1.18 || candidate.h > medRestH * 1.06);

    const hasSurplusCols =
      targetCharCount >= 2 ? coreColCount > targetCharCount : coreColCount >= 3;
    const isGeomOrGapOutlier =
      candidate.h > medRestH * 1.12 ||
      candidate.w > medRestW * 1.22 ||
      candidate.area > medRestArea * 1.35 ||
      edgeGap > medGap * 1.22 ||
      isDistinctColoredEmblem;

    const peelNow = () => {
      const boxMinX = candidate.minX - 4;
      const boxMaxX = candidate.maxX + 4;
      const boxMinY = candidate.minY - 4;
      const boxMaxY = candidate.maxY + 4;
      for (const comp of components) {
        if (
          comp.minX >= boxMinX &&
          comp.maxX <= boxMaxX &&
          comp.minY >= boxMinY &&
          comp.maxY <= boxMaxY
        ) {
          peeledEmblemCompIds.add(comp.id);
        }
      }
      for (let idx = winningCols.length - 1; idx >= 0; idx--) {
        const col = winningCols[idx]!;
        if (
          idx === edgeIdx ||
          (col.minX >= boxMinX && col.maxX <= boxMaxX && col.minY >= boxMinY && col.maxY <= boxMaxY)
        ) {
          for (const c of col.comps) peeledEmblemCompIds.add(c.id);
          winningCols.splice(idx, 1);
        }
      }
      return true;
    };

    // LEADING / TRAILING LETTER IMMUNITY: an edge column drawn in the SAME ink as the rest of the
    // word and sitting at normal letter spacing IS a letter. Being taller, wider or heavier than
    // the others is exactly what a capital or swash initial looks like ("R" in a script
    // "Record+" is ~2.2x the lowercase height; a stencil "A" in "Apple" is wider than "l"), and
    // a surplus column count only means a stencil glyph split or the AI kept a "+" / "®".
    // Real same-color emblems (e.g. the red tree beside "Apple") stand off by a visibly wider
    // gap; anything else is told apart by color. Size caps keep giant same-ink shapes peelable.
    const looksLikeEdgeLetter =
      minColorDistToRest <= 35 &&
      edgeGap <= Math.max(medGap * 1.85, medRestW * 0.65) &&
      candidate.h <= medRestH * 2.6 &&
      candidate.w <= medRestW * 3.6;
    if (looksLikeEdgeLetter) return false;

    if (
      hasCompatibleOrig &&
      hasSurplusCols &&
      isGeomOrGapOutlier &&
      candidate.origDelta < 0.28 &&
      medRestDelta >= 0.45
    ) {
      return peelNow();
    }
    const medRestMinY = medianOf(coreRest.map((c) => c.minY));
    const medRestMaxY = medianOf(coreRest.map((c) => c.maxY));
    const sharesBaselineAndColor =
      minColorDistToRest <= 35 &&
      Math.abs(candidate.minY - medRestMinY) <= medRestH * 0.12 &&
      Math.abs(candidate.maxY - medRestMaxY) <= medRestH * 0.12;

    if (
      targetCharCount >= 2 &&
      coreColCount > targetCharCount &&
      (candidate.h > medRestH * 1.14 ||
        (!sharesBaselineAndColor && candidate.w > medRestW * 1.24) ||
        candidate.area > medRestArea * (sharesBaselineAndColor ? 1.55 : 1.4) ||
        edgeGap > medGap * (sharesBaselineAndColor ? 1.4 : 1.28) ||
        isDistinctColoredEmblem)
    ) {
      return peelNow();
    }
    if (
      coreColCount >= 3 &&
      candidate.area > medRestArea * 1.65 &&
      (candidate.h > medRestH * 1.18 ||
        (!sharesBaselineAndColor && candidate.w > medRestW * 1.3) ||
        edgeGap > medGap * 1.45)
    ) {
      return peelNow();
    }
    return false;
  };

  if (!tryPeelEdgeEmblem(0) && winningCols.length >= 2) {
    tryPeelEdgeEmblem(winningCols.length - 1);
  }

  // Interior/Center Emblem Peeling: handles logos where an emblem sits BETWEEN two words on the
  // same horizontal band (e.g., a paw-print emblem between two words,
  // which has 4 blue toe pads directly above the blue paw pad while the text letters are red!).
  if (winningCols.length >= 3) {
    const initialWinCompIds = new Set<number>(
      winningCols.flatMap((c) => c.comps.map((x) => x.id))
    );
    const outsideBandComps = components.filter(
      (c) => !initialWinCompIds.has(c.id) && !peeledEmblemCompIds.has(c.id)
    );

    // Find the dominant text ink color across `winningCols`
    let dominantTextRgb: RgbTuple = winningCols[0]!.meanRgb;
    let bestColorMatches = -1;
    for (const col of winningCols) {
      // Weighted by letter-sized pieces, so many thin artwork lines cannot out-vote the lettering
      let count = 0;
      for (const other of winningCols) {
        if (rgbDist(col.meanRgb, other.meanRgb) <= 48) count += Math.sqrt(other.area);
      }
      if (count > bestColorMatches) {
        bestColorMatches = count;
        dominantTextRgb = col.meanRgb;
      }
    }

    const medColH = Math.max(1, medianOf(winningCols.map((c) => c.h)));
    const medColArea = Math.max(1, medianOf(winningCols.map((c) => c.area)));

    for (let idx = winningCols.length - 2; idx >= 1; idx--) {
      if (winningCols.length <= 2) break;
      const col = winningCols[idx]!;
      const colorDistToText = rgbDist(col.meanRgb, dominantTextRgb);
      if (colorDistToText <= 60) continue;

      // Cue A: Vertically aligned with detached upper/lower emblem sub-components of the SAME emblem color
      // (e.g., Baidu's 4 blue toe pads sitting directly above the center blue paw pad!)
      const hasMatchingDetachedEmblemParts = outsideBandComps.some((ext) => {
        if (rgbDist(ext.meanRgb, col.meanRgb) > 48) return false;
        const xOverlap = Math.max(
          0,
          Math.min(ext.maxX, col.maxX + col.w * 0.35) -
            Math.max(ext.minX, col.minX - col.w * 0.35) +
            1
        );
        const vGap =
          ext.maxY < col.minY
            ? col.minY - ext.maxY
            : ext.minY > col.maxY
              ? ext.minY - col.maxY
              : 0;
        return xOverlap > 0 && vGap <= medColH * 0.85;
      });

      // Cue B: Distinctly colored oversized center emblem present in original capture
      const isOversizedCenterEmblem =
        (col.area > medColArea * 1.45 || col.h > medColH * 1.15) &&
        (!hasCompatibleOrig || col.origDelta < 0.35);

      if (hasMatchingDetachedEmblemParts || isOversizedCenterEmblem) {
        for (const c of col.comps) peeledEmblemCompIds.add(c.id);
        for (const ext of outsideBandComps) {
          if (rgbDist(ext.meanRgb, col.meanRgb) <= 48) {
            peeledEmblemCompIds.add(ext.id);
          }
        }
        winningCols.splice(idx, 1);
      }
    }
  }

  // Diacritic & CJK Top/Bottom Sub-Radical Absorption Pass:
  // Absorbs compact dots ('i'/'j'), accents, and split CJK radicals (e.g. `艹` above `平` in `苹`)
  // that sit directly above/below a winning character column within tight vertical proximity
  // and match the glyph's ink color, while leaving detached or peeled brand emblems untouched!
  const initialSelectedIds = new Set<number>(winningCols.flatMap((c) => c.comps.map((x) => x.id)));
  const winMedianH = Math.max(1, medianOf(winningCols.map((c) => c.h)));
  const maxDiacriticGap = Math.max(4, Math.round(winMedianH * 0.42));

  // Measure every accessory against the glyph columns AS THEY ARE NOW: absorbing one piece must
  // not stretch a column so that it reaches the next piece (that chained a whole trail of border
  // dots into the Font). Frame debris and pieces running off the image edge are never diacritics.
  const glyphBoxes = winningCols.map((c) => ({
    minX: c.minX,
    maxX: c.maxX,
    minY: c.minY,
    maxY: c.maxY,
    w: c.w,
    area: c.area,
  }));

  for (const comp of components) {
    if (initialSelectedIds.has(comp.id) || peeledEmblemCompIds.has(comp.id)) continue;
    if (comp.fromFrame || comp.touchesOuterBorder) continue;
    for (let colIdx = 0; colIdx < winningCols.length; colIdx++) {
      const col = winningCols[colIdx]!;
      const box = glyphBoxes[colIdx]!;
      if (rgbDist(comp.meanRgb, col.meanRgb) > 55) continue;
      const xOverlap = Math.max(0, Math.min(comp.maxX, box.maxX) - Math.max(comp.minX, box.minX) + 1);
      const colCx = (box.minX + box.maxX) * 0.5;
      const xAligned =
        xOverlap >= Math.min(comp.w, box.w) * 0.3 || Math.abs(comp.cx - colCx) <= box.w * 0.65;
      if (!xAligned) continue;

      const vGap =
        comp.maxY < box.minY
          ? box.minY - comp.maxY
          : comp.minY > box.maxY
            ? comp.minY - box.maxY
            : 0;
      if (vGap > maxDiacriticGap) continue;
      // A real dot / accent floats within a couple of its own sizes of its glyph; a lone dot far
      // below tall script lettering is background decoration, not a diacritic.
      if (vGap > Math.max(4, Math.max(comp.w, comp.h) * 1.6)) continue;

      const isCompactAccessory =
        comp.h <= winMedianH * 0.72 && comp.w <= box.w * 1.35 && comp.area <= box.area * 0.9;
      if (!isCompactAccessory) continue;

      col.comps.push(comp);
      col.minX = Math.min(col.minX, comp.minX);
      col.maxX = Math.max(col.maxX, comp.maxX);
      col.minY = Math.min(col.minY, comp.minY);
      col.maxY = Math.max(col.maxY, comp.maxY);
      col.w = col.maxX - col.minX + 1;
      col.h = col.maxY - col.minY + 1;
      col.area += comp.area;
      initialSelectedIds.add(comp.id);
      break;
    }
  }

  // Text-detector cross-check: keep only shapes that the detector also sees as text, but only
  // when it clearly agrees about where the lettering is (it misses some script / overlapping
  // lettering, and then it is ignored).
  const textMask = options?.textMaskMode === 'clip' ? undefined : options?.textMask;
  if (textMask && textMask.length >= pixelCount) {
    const inside = (comp: FgComponent) => {
      let hit = 0;
      const stride = Math.max(1, Math.floor(comp.pixels.length / 400));
      let seen = 0;
      for (let i = 0; i < comp.pixels.length; i += stride) {
        seen += 1;
        if (textMask[comp.pixels[i]!] === 1) hit += 1;
      }
      return seen > 0 ? hit / seen : 0;
    };
    const all = winningCols.flatMap((c) => c.comps);
    let totalArea = 0;
    let agreedArea = 0;
    for (const comp of all) {
      totalArea += comp.area;
      agreedArea += comp.area * inside(comp);
    }
    if (totalArea > 0 && agreedArea >= totalArea * 0.5) {
      for (let ci = winningCols.length - 1; ci >= 0; ci--) {
        const col = winningCols[ci]!;
        const kept = col.comps.filter((comp) => inside(comp) >= 0.4);
        for (const comp of col.comps) {
          if (!kept.includes(comp)) peeledEmblemCompIds.add(comp.id);
        }
        // A shape that is partly text and partly something else (a letter welded to line art
        // that runs far outside the text line): keep only the part inside the detected text
        // area; the rest becomes its own artwork shape and is preserved.
        for (const comp of kept) {
          if (inside(comp) >= 0.92) continue;
          const inPart: number[] = [];
          const outPart: number[] = [];
          for (const px of comp.pixels) (textMask[px] === 1 ? inPart : outPart).push(px);
          if (inPart.length < 4 || outPart.length < 4) continue;
          const boundsOf = (pixels: number[]) => {
            let bx0 = width;
            let bx1 = -1;
            let by0 = height;
            let by1 = -1;
            for (const px of pixels) {
              const x = px % width;
              const y = (px - x) / width;
              if (x < bx0) bx0 = x;
              if (x > bx1) bx1 = x;
              if (y < by0) by0 = y;
              if (y > by1) by1 = y;
            }
            return { minX: bx0, maxX: bx1, minY: by0, maxY: by1 };
          };
          const ib = boundsOf(inPart);
          comp.pixels = inPart;
          comp.area = inPart.length;
          comp.minX = ib.minX;
          comp.maxX = ib.maxX;
          comp.minY = ib.minY;
          comp.maxY = ib.maxY;
          comp.w = ib.maxX - ib.minX + 1;
          comp.h = ib.maxY - ib.minY + 1;
          comp.cx = (ib.minX + ib.maxX) * 0.5;
          comp.cy = (ib.minY + ib.maxY) * 0.5;
          const ob = boundsOf(outPart);
          const artwork: FgComponent = {
            ...comp,
            id: components.length + 1000000,
            pixels: outPart,
            area: outPart.length,
            minX: ob.minX,
            maxX: ob.maxX,
            minY: ob.minY,
            maxY: ob.maxY,
            w: ob.maxX - ob.minX + 1,
            h: ob.maxY - ob.minY + 1,
            cx: (ob.minX + ob.maxX) * 0.5,
            cy: (ob.minY + ob.maxY) * 0.5,
          };
          components.push(artwork);
          peeledEmblemCompIds.add(artwork.id);
        }
        if (kept.length === 0) winningCols.splice(ci, 1);
        else col.comps = kept;
      }
    }
  }

  const selectedTextComps = winningCols.flatMap((c) => c.comps);
  if (selectedTextComps.length === 0) {
    return emptyFail('no-text-cluster-found', backgroundConfidence);
  }

  const selectedIds = new Set<number>(selectedTextComps.map((c) => c.id));
  const emblemsPreservedCount = components.length - selectedTextComps.length;

  const isTextPixel = new Uint8Array(pixelCount);
  const isEmblemPixel = new Uint8Array(pixelCount);
  let textMinX = width;
  let textMaxX = -1;
  let textMinY = height;
  let textMaxY = -1;

  for (const comp of components) {
    if (selectedIds.has(comp.id)) {
      if (comp.minX < textMinX) textMinX = comp.minX;
      if (comp.maxX > textMaxX) textMaxX = comp.maxX;
      if (comp.minY < textMinY) textMinY = comp.minY;
      if (comp.maxY > textMaxY) textMaxY = comp.maxY;
      for (const p of comp.pixels) isTextPixel[p] = 1;
    } else {
      for (const p of comp.pixels) isEmblemPixel[p] = 1;
    }
  }
  // Frame / border decoration is preserved exactly like an emblem
  for (let p = 0; p < pixelCount; p++) {
    if (isFramePixel[p] === 1 && isTextPixel[p] === 0) isEmblemPixel[p] = 1;
  }
  // Rim pixels of a colour-separated shape: those hugging the selected lettering are its soft
  // edge over the artwork and must be erased with it; the rest stays as artwork.
  const isLetterRim = new Uint8Array(pixelCount);
  for (const p of colourSplitRimPixels) {
    const px = p % width;
    const py = (p - px) / width;
    let hugsText = false;
    for (let dy = -4; dy <= 4 && !hugsText; dy++) {
      const ny = py + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -4; dx <= 4; dx++) {
        const nx = px + dx;
        if (nx < 0 || nx >= width) continue;
        if (isTextPixel[ny * width + nx] === 1) {
          hugsText = true;
          break;
        }
      }
    }
    if (hugsText) isLetterRim[p] = 1;
    else isEmblemPixel[p] = 1;
  }
  for (const p of letteringCrumbPixels) {
    if (isTextPixel[p] === 0) isLetterRim[p] = 1;
  }

  // Stage 4: Layer A — Transparent Font Cutout (`fontData`)
  // Include up to a 3px outer anti-aliased fringe ring (`distField > tLow`) around `isTextPixel`
  // while strictly excluding `isEmblemPixel` and its 1px border so emblems never bleed into fontData!
  const isTextFringe = new Uint8Array(pixelCount);
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const p = rowOff + x;
      if (isTextPixel[p] === 1 || isEmblemPixel[p] === 1 || distField[p]! <= tLow) continue;
      let touchesEmblem = false;
      for (let dy = -1; dy <= 1 && !touchesEmblem; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (isEmblemPixel[ny * width + nx] === 1) {
            touchesEmblem = true;
            break;
          }
        }
      }
      if (touchesEmblem) continue;

      let touchesText = false;
      for (let dy = -3; dy <= 3 && !touchesText; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy > 9) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (isTextPixel[ny * width + nx] === 1) {
            touchesText = true;
            break;
          }
        }
      }
      if (touchesText) isTextFringe[p] = 1;
    }
  }

  // Adaptive soft-edge reach: on large or softly rendered lettering (AI images, upscaled or
  // JPEG-softened edges, glows) the anti-aliased ramp is wider than 3px, which used to leave a
  // faint outline of every letter in the Clean Background. Grow the fringe geodesically through
  // still-above-noise pixels (`distField > tLow`) up to ~5% of the letter height (max 7px).
  // Sharp edges stop the growth by themselves; small lettering keeps the classic 3px ring.
  const fringeReach = clamp(Math.round(winMedianH * 0.05), 3, 7);
  if (fringeReach > 3) {
    let frontier: number[] = [];
    for (let p = 0; p < pixelCount; p++) {
      if (isTextFringe[p] === 1) frontier.push(p);
    }
    for (let step = 3; step < fringeReach && frontier.length > 0; step++) {
      const next: number[] = [];
      for (const p of frontier) {
        const px = p % width;
        const py = (p - px) / width;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = px + dx;
            if (nx < 0 || nx >= width) continue;
            const np = ny * width + nx;
            if (
              isTextPixel[np] === 1 ||
              isTextFringe[np] === 1 ||
              isEmblemPixel[np] === 1 ||
              distField[np]! <= tLow
            ) {
              continue;
            }
            let nearEmblem = false;
            for (let ey = -1; ey <= 1 && !nearEmblem; ey++) {
              const qy = ny + ey;
              if (qy < 0 || qy >= height) continue;
              for (let ex = -1; ex <= 1; ex++) {
                const qx = nx + ex;
                if (qx < 0 || qx >= width) continue;
                if (isEmblemPixel[qy * width + qx] === 1) {
                  nearEmblem = true;
                  break;
                }
              }
            }
            if (nearEmblem) continue;
            isTextFringe[np] = 1;
            next.push(np);
          }
        }
      }
      frontier = next;
    }
  }

  const fontData = new Uint8ClampedArray(pixelCount * 4);
  const invBand = 1 / Math.max(1, tHigh - tLow);

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const p = rowOff + x;
      if (isTextPixel[p] === 0 && isTextFringe[p] === 0) continue;

      const o = p * 4;
      const cr = masterData[o]!;
      const cg = masterData[o + 1]!;
      const cb = masterData[o + 2]!;
      const bg = evalLocalBg(x, y);
      const d = distField[p]!;

      // Estimate local peak foreground color F_local in a 5x5 neighborhood
      // (with peak-ink fallback when sumW === 0 on 1px–2px hairline strokes!)
      let sumW = 0;
      let locR = 0;
      let locG = 0;
      let locB = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const np = ny * width + nx;
          if (isTextPixel[np] !== 1 || distField[np]! <= tHigh) continue;
          const w = 1 / (dx * dx + dy * dy + 0.5);
          const no = np * 4;
          locR += masterData[no]! * w;
          locG += masterData[no + 1]! * w;
          locB += masterData[no + 2]! * w;
          sumW += w;
        }
      }
      if (sumW === 0) {
        let localMaxD = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const np = ny * width + nx;
            if ((isTextPixel[np] === 1 || isTextFringe[np] === 1) && distField[np]! > localMaxD) {
              localMaxD = distField[np]!;
            }
          }
        }
        if (localMaxD > tHigh) {
          const peakFloor = Math.max(tHigh, localMaxD * 0.72);
          for (let dy = -2; dy <= 2; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -2; dx <= 2; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= width) continue;
              const np = ny * width + nx;
              if (
                (isTextPixel[np] !== 1 && isTextFringe[np] !== 1) ||
                distField[np]! < peakFloor
              ) {
                continue;
              }
              const w = 1 / (dx * dx + dy * dy + 0.5);
              const no = np * 4;
              locR += masterData[no]! * w;
              locG += masterData[no + 1]! * w;
              locB += masterData[no + 2]! * w;
              sumW += w;
            }
          }
        }
      }

      let alpha = isTextPixel[p] === 1 && d > tHigh ? 1 : clamp((d - tLow) * invBand, 0, 1);
      if (sumW > 0) {
        const avgR = locR / sumW;
        const avgG = locG / sumW;
        const avgB = locB / sumW;
        const vr = avgR - bg[0];
        const vg = avgG - bg[1];
        const vb = avgB - bg[2];
        const vLenSq = vr * vr + vg * vg + vb * vb;
        if (vLenSq >= 400) {
          const dr = cr - bg[0];
          const dg = cg - bg[1];
          const db = cb - bg[2];
          const proj = (dr * vr + dg * vg + db * vb) / vLenSq;
          const perpR = dr - proj * vr;
          const perpG = dg - proj * vg;
          const perpB = db - proj * vb;
          const perpDist = Math.sqrt(perpR * perpR + perpG * perpG + perpB * perpB);
          // Only project along the B -> F_local line when the pixel is colinear (perpDist <= 30);
          // non-collinear dark/colored outlines or drop-shadows on mid-tone cards stay 100% opaque!
          if (perpDist <= 30) {
            if (proj >= 0.92) alpha = 1;
            else if (proj <= 0.03) alpha = 0;
            else alpha = clamp(proj, 0, 1);
          } else {
            alpha = d > tHigh ? 1 : clamp((d - tLow) * invBand, 0, 1);
          }
        }
      }

      if (alpha <= 0.02) continue;

      if (alpha >= 0.98) {
        fontData[o] = cr;
        fontData[o + 1] = cg;
        fontData[o + 2] = cb;
        fontData[o + 3] = 255;
      } else {
        const unmixR = clamp((cr - (1 - alpha) * bg[0]) / alpha, 0, 255);
        const unmixG = clamp((cg - (1 - alpha) * bg[1]) / alpha, 0, 255);
        const unmixB = clamp((cb - (1 - alpha) * bg[2]) / alpha, 0, 255);
        fontData[o] = clampByte(unmixR);
        fontData[o + 1] = clampByte(unmixG);
        fontData[o + 2] = clampByte(unmixB);
        fontData[o + 3] = clampByte(alpha * 255);
      }
    }
  }

  // Stage 5: Layer B — Fast Directional + Harmonic Inpainting (`backgroundData`)
  // Dilate text + fringe mask by radius 3px (strictly excluding `isEmblemPixel` so emblems stay 100% sharp!)
  const inpaintMask = new Uint8Array(pixelCount);
  const maskedIndices: number[] = [];
  // Large / soft lettering also carries a faint compression "ringing" band just outside its
  // anti-aliased edge; widen the erase margin with the same adaptive reach so that band is
  // inpainted too (small lettering keeps the classic 3px margin and code path below).
  if (fringeReach > 3) {
    const reachSq = fringeReach * fringeReach + 1;
    for (let y = 0; y < height; y++) {
      const rowOff = y * width;
      for (let x = 0; x < width; x++) {
        const p = rowOff + x;
        if (isTextPixel[p] !== 1 && isTextFringe[p] !== 1) continue;
        inpaintMask[p] = 1;
        // Only outline pixels of the text+fringe set need to stamp their disc
        const isOutline =
          x === 0 ||
          y === 0 ||
          x === width - 1 ||
          y === height - 1 ||
          (isTextPixel[p - 1] !== 1 && isTextFringe[p - 1] !== 1) ||
          (isTextPixel[p + 1] !== 1 && isTextFringe[p + 1] !== 1) ||
          (isTextPixel[p - width] !== 1 && isTextFringe[p - width] !== 1) ||
          (isTextPixel[p + width] !== 1 && isTextFringe[p + width] !== 1);
        if (!isOutline) continue;
        for (let dy = -fringeReach; dy <= fringeReach; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -fringeReach; dx <= fringeReach; dx++) {
            if (dx * dx + dy * dy > reachSq) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const np = ny * width + nx;
            if (isEmblemPixel[np] !== 1) inpaintMask[np] = 1;
          }
        }
      }
    }
    for (let p = 0; p < pixelCount; p++) {
      if (isLetterRim[p] === 1) inpaintMask[p] = 1;
      if (inpaintMask[p] === 1) maskedIndices.push(p);
    }
  }
  for (let y = 0; fringeReach <= 3 && y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const p = rowOff + x;
      if (isEmblemPixel[p] === 1) continue;
      let nearText = isTextPixel[p] === 1 || isTextFringe[p] === 1 || isLetterRim[p] === 1;
      for (let dy = -3; dy <= 3 && !nearText; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy > 10) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const np = ny * width + nx;
          if (isTextPixel[np] === 1 || isTextFringe[np] === 1) {
            nearText = true;
            break;
          }
        }
      }
      if (nearText) {
        inpaintMask[p] = 1;
        maskedIndices.push(p);
      }
    }
  }

  const backgroundData = new Uint8ClampedArray(masterData);

  // Pass 1: Initialize masked pixels from the smooth tile surface model B(x,y), corrected by a
  // pull-push (image-pyramid) interpolation of the model's RESIDUAL measured on the clean
  // background pixels surrounding the mask. The model supplies the gradient's shape; the residual
  // membrane removes any small level offset, so the erased lettering leaves no lighter/darker
  // "ghost" on gradients, vignettes or softly textured surfaces. On a flat surface the residual
  // is ~0 and this reduces exactly to the plain model fill.
  if (maskedIndices.length > 0) {
    let mMinX = width;
    let mMaxX = -1;
    let mMinY = height;
    let mMaxY = -1;
    for (const p of maskedIndices) {
      const px = p % width;
      const py = (p - px) / width;
      if (px < mMinX) mMinX = px;
      if (px > mMaxX) mMaxX = px;
      if (py < mMinY) mMinY = py;
      if (py > mMaxY) mMaxY = py;
    }
    const pad = 24;
    const bx0 = Math.max(0, mMinX - pad);
    const by0 = Math.max(0, mMinY - pad);
    const bw = Math.min(width - 1, mMaxX + pad) - bx0 + 1;
    const bh = Math.min(height - 1, mMaxY + pad) - by0 + 1;

    interface ResidualLevel {
      w: number;
      h: number;
      r: Float32Array;
      g: Float32Array;
      b: Float32Array;
      wt: Float32Array;
    }
    const base: ResidualLevel = {
      w: bw,
      h: bh,
      r: new Float32Array(bw * bh),
      g: new Float32Array(bw * bh),
      b: new Float32Array(bw * bh),
      wt: new Float32Array(bw * bh),
    };
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const p = (by0 + y) * width + (bx0 + x);
        // Sources are clean background pixels, plus solid artwork (emblem) pixels: where lettering
        // lay ACROSS artwork, the hole must be refilled with that artwork's colour, not with the
        // card colour. Soft halo pixels in between are never sources.
        if (inpaintMask[p] === 1) continue;
        if (isEmblemPixel[p] !== 1 && distField[p]! > tLow) continue;
        const bg = evalLocalBg(bx0 + x, by0 + y);
        const o = p * 4;
        const i = y * bw + x;
        base.r[i] = masterData[o]! - bg[0];
        base.g[i] = masterData[o + 1]! - bg[1];
        base.b[i] = masterData[o + 2]! - bg[2];
        base.wt[i] = 1;
      }
    }

    // Pull: average known residuals into progressively coarser levels
    const levels: ResidualLevel[] = [base];
    while (levels[levels.length - 1]!.w > 1 || levels[levels.length - 1]!.h > 1) {
      const fine = levels[levels.length - 1]!;
      const cw = Math.max(1, Math.ceil(fine.w / 2));
      const ch = Math.max(1, Math.ceil(fine.h / 2));
      const coarse: ResidualLevel = {
        w: cw,
        h: ch,
        r: new Float32Array(cw * ch),
        g: new Float32Array(cw * ch),
        b: new Float32Array(cw * ch),
        wt: new Float32Array(cw * ch),
      };
      for (let y = 0; y < fine.h; y++) {
        const cy = y >> 1;
        for (let x = 0; x < fine.w; x++) {
          const fi = y * fine.w + x;
          const wv = fine.wt[fi]!;
          if (wv <= 0) continue;
          const ci = cy * cw + (x >> 1);
          coarse.r[ci]! += fine.r[fi]! * wv;
          coarse.g[ci]! += fine.g[fi]! * wv;
          coarse.b[ci]! += fine.b[fi]! * wv;
          coarse.wt[ci]! += wv;
        }
      }
      for (let ci = 0; ci < cw * ch; ci++) {
        const sw = coarse.wt[ci]!;
        if (sw > 0) {
          coarse.r[ci]! /= sw;
          coarse.g[ci]! /= sw;
          coarse.b[ci]! /= sw;
          coarse.wt[ci] = Math.min(1, sw);
        }
      }
      levels.push(coarse);
    }

    // Push: fill unknown cells from the (bilinearly upsampled) coarser level, coarse -> fine
    for (let li = levels.length - 2; li >= 0; li--) {
      const fine = levels[li]!;
      const coarse = levels[li + 1]!;
      for (let y = 0; y < fine.h; y++) {
        const gy = clamp((y + 0.5) / 2 - 0.5, 0, coarse.h - 1);
        const y0 = Math.floor(gy);
        const y1 = Math.min(coarse.h - 1, y0 + 1);
        const fy = gy - y0;
        for (let x = 0; x < fine.w; x++) {
          const fi = y * fine.w + x;
          const wv = fine.wt[fi]!;
          if (wv >= 1) continue;
          const gx = clamp((x + 0.5) / 2 - 0.5, 0, coarse.w - 1);
          const x0 = Math.floor(gx);
          const x1 = Math.min(coarse.w - 1, x0 + 1);
          const fx = gx - x0;
          const c00 = y0 * coarse.w + x0;
          const c10 = y0 * coarse.w + x1;
          const c01 = y1 * coarse.w + x0;
          const c11 = y1 * coarse.w + x1;
          const k00 = (1 - fx) * (1 - fy);
          const k10 = fx * (1 - fy);
          const k01 = (1 - fx) * fy;
          const k11 = fx * fy;
          const up = (ch: Float32Array) =>
            k00 * ch[c00]! + k10 * ch[c10]! + k01 * ch[c01]! + k11 * ch[c11]!;
          fine.r[fi] = fine.r[fi]! * wv + (1 - wv) * up(coarse.r);
          fine.g[fi] = fine.g[fi]! * wv + (1 - wv) * up(coarse.g);
          fine.b[fi] = fine.b[fi]! * wv + (1 - wv) * up(coarse.b);
          fine.wt[fi] = 1;
        }
      }
    }

    for (const p of maskedIndices) {
      const px = p % width;
      const py = (p - px) / width;
      const bg = evalLocalBg(px, py);
      const i = (py - by0) * bw + (px - bx0);
      const o = p * 4;
      backgroundData[o] = clampByte(bg[0] + base.r[i]!);
      backgroundData[o + 1] = clampByte(bg[1] + base.g[i]!);
      backgroundData[o + 2] = clampByte(bg[2] + base.b[i]!);
      backgroundData[o + 3] = 255;
    }
  }

  // Pass 2: 14-sweep Gauss-Seidel harmonic boundary continuation over `maskedIndices`
  for (let sweep = 0; sweep < 14; sweep++) {
    for (let i = 0; i < maskedIndices.length; i++) {
      const p = maskedIndices[i]!;
      const px = p % width;
      const py = (p - px) / width;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;

      const addNb = (np: number) => {
        if (isEmblemPixel[np] === 1) return;
        const no = np * 4;
        sumR += backgroundData[no]!;
        sumG += backgroundData[no + 1]!;
        sumB += backgroundData[no + 2]!;
        count += 1;
      };

      if (px > 0) addNb(p - 1);
      if (px + 1 < width) addNb(p + 1);
      if (py > 0) addNb(p - width);
      if (py + 1 < height) addNb(p + width);

      if (count > 0) {
        const o = p * 4;
        backgroundData[o] = clampByte(sumR / count);
        backgroundData[o + 1] = clampByte(sumG / count);
        backgroundData[o + 2] = clampByte(sumB / count);
      }
    }
  }

  // SELF-CHECK: decide whether each layer can honestly be presented as finished.
  const qualityReasons: SplitQuality['reasons'] = [];
  const bboxW = Math.max(1, textMaxX - textMinX + 1);
  const bboxH = Math.max(1, textMaxY - textMinY + 1);
  const expectedChars = Math.min(12, targetCharCount);
  // 1. A word of N letters cannot be much narrower than N slim letters of its own height
  //    (catches "only the last letter was found").
  if (expectedChars >= 2 && bboxW < 0.22 * expectedChars * winMedianH) {
    qualityReasons.push('font-too-narrow');
  }
  // 2. A hairline is not a word (catches a ruling line chosen as the lettering).
  if (bboxW / bboxH > Math.max(12, targetCharCount * 4)) qualityReasons.push('font-too-flat');
  // 3. Same-ink foreground left inside the word's own box means letters were missed.
  let textArea = 0;
  let mainTextComp = selectedTextComps[0]!;
  for (const comp of selectedTextComps) {
    textArea += comp.area;
    if (comp.area > mainTextComp.area) mainTextComp = comp;
  }
  //    "Inside" means inside one of the chosen glyph columns, not the word's overall bounding
  //    box: for lettering set around a ring that box is the whole badge, and a highlight or seam
  //    in the middle of it is not a missed letter.
  let inkLeftArea = 0;
  for (const comp of components) {
    if (selectedIds.has(comp.id)) continue;
    if (rgbDist(comp.meanRgb, mainTextComp.meanRgb) > 45) continue;
    const insideAGlyphColumn = winningCols.some(
      (col) =>
        comp.cx >= col.minX - col.w * 0.1 &&
        comp.cx <= col.maxX + col.w * 0.1 &&
        comp.cy >= col.minY - col.h * 0.1 &&
        comp.cy <= col.maxY + col.h * 0.1
    );
    if (!insideAGlyphColumn) continue;
    inkLeftArea += comp.area;
  }
  // Same check, but using the text detector: same-ink shapes it marks as text that were not
  // selected (a missed line of a heading, a missed word) mean the Font is incomplete.
  const detMask = options?.textMask;
  if (detMask && detMask.length >= pixelCount) {
    const medianLetterArea = medianOf(selectedTextComps.map((c) => c.area));
    for (const comp of components) {
      if (selectedIds.has(comp.id) || comp.area < medianLetterArea * 0.3) continue;
      if (rgbDist(comp.meanRgb, mainTextComp.meanRgb) > 45) continue;
      let hit = 0;
      let seen = 0;
      const stride = Math.max(1, Math.floor(comp.pixels.length / 200));
      for (let i = 0; i < comp.pixels.length; i += stride) {
        seen += 1;
        if (detMask[comp.pixels[i]!] === 1) hit += 1;
      }
      if (seen > 0 && hit / seen >= 0.6) inkLeftArea += comp.area;
    }
  }
  if (inkLeftArea > textArea * 0.3) qualityReasons.push('ink-left-behind');
  // 4. A tangled multi-ink shape whose lettering ink could not be told apart — but only when
  //    that shape actually reaches the chosen lettering. Two-colour artwork elsewhere in the
  //    picture (a photo, a badge away from the word) says nothing about this split.
  const reachMargin = winMedianH * 0.25;
  const reachesLettering = (shape: (typeof tangledShapes)[number]) =>
    shape.maxX >= textMinX - reachMargin &&
    shape.minX <= textMaxX + reachMargin &&
    shape.maxY >= textMinY - reachMargin &&
    shape.minY <= textMaxY + reachMargin;
  const inkUndecided = tangledShapes.some((shape) => !shape.decided && reachesLettering(shape));
  const sawTangledShape = tangledShapes.some((shape) => shape.decided && reachesLettering(shape));
  if (inkUndecided) qualityReasons.push('ink-undecided');
  // 4b. "Lettering" that covers the whole picture edge to edge is scenery, not a word (a busy
  //     illustration or screenshot where buildings and shapes were swept up as glyphs).
  //     Only when it is also made of far more pieces than the word has letters, so a tightly
  //     cropped wordmark that fills its picture is never mistaken for scenery.
  if (
    bboxW >= width * 0.95 &&
    bboxH >= height * 0.9 &&
    selectedTextComps.length > Math.max(12, targetCharCount * 2.5)
  ) {
    qualityReasons.push('font-too-spread');
  }
  const fontOk = qualityReasons.length === 0;
  // 5. Lettering that lay across artwork: the hidden artwork can only be guessed locally.
  let refilledWithArtwork = 0;
  let refillSamples = 0;
  for (let i = 0; i < maskedIndices.length; i += 3) {
    const p = maskedIndices[i]!;
    const px = p % width;
    const py = (p - px) / width;
    const bg = evalLocalBg(px, py);
    const o = p * 4;
    if (
      rgbDist([backgroundData[o]!, backgroundData[o + 1]!, backgroundData[o + 2]!], bg) > tHigh
    ) {
      refilledWithArtwork += 1;
    }
    refillSamples += 1;
  }
  const backgroundOk =
    fontOk && !(sawTangledShape && refilledWithArtwork > refillSamples * 0.08);
  if (fontOk && !backgroundOk) qualityReasons.push('lettering-over-artwork');

  return {
    applied: true,
    quality: { fontOk, backgroundOk, reasons: qualityReasons },
    eraseMask: inpaintMask,
    fontData,
    backgroundData,
    width,
    height,
    backgroundConfidence,
    backdropIsLight,
    textComponentCount: selectedTextComps.length,
    emblemsPreservedCount,
    textBBox:
      textMaxX >= textMinX
        ? { minX: textMinX, minY: textMinY, maxX: textMaxX, maxY: textMaxY }
        : null,
  };
}

/**
 * Runs the text detector on a finished Clean Background and returns a mask of the detected text
 * boxes that overlap the area where lettering was erased, or null when none are found.
 */
async function findLeftoverText(
  background: Uint8ClampedArray,
  width: number,
  height: number,
  eraseMask: Uint8Array,
  detect: NonNullable<Parameters<typeof splitMasterImageLayersLocally>[1]>['detectTextMask']
): Promise<Uint8Array | null> {
  if (!detect) return null;
  const found = await detect(background, width, height).catch(() => null);
  if (!found || found.boxes.length === 0) return null;
  const mask = new Uint8Array(width * height);
  let any = false;
  for (const b of found.boxes) {
    let inErase = 0;
    let area = 0;
    for (let y = b.minY; y <= b.maxY; y += 2) {
      for (let x = b.minX; x <= b.maxX; x += 2) {
        area += 1;
        if (eraseMask[y * width + x] === 1) inErase += 1;
      }
    }
    if (area === 0 || inErase / area < 0.3) continue;
    any = true;
    for (let y = b.minY; y <= b.maxY; y++) mask.fill(1, y * width + b.minX, y * width + b.maxX + 1);
  }
  return any ? mask : null;
}

/**
 * Browser Canvas wrapper: splits Turn 1's Master Composite Image DataURL into:
 *   1. `fontTransparentDataUrl` (True Alpha-Transparent PNG)
 *   2. `backgroundDataUrl` (Seamlessly Inpainted Clean Background PNG)
 *   3. `vectorSvg` (Sub-pixel `<path d="M... Q... Z"/>` Vector SVG ready for Figma/Illustrator)
 * in <120ms with ZERO extra AI tokens!
 */
export async function splitMasterImageLayersLocally(
  masterDataUrl: string,
  options?: {
    targetWord?: string;
    originalDataUrl?: string;
    /**
     * Optional stronger inpainter (the bundled on-device model). Called only when the split is
     * trustworthy for the Font but the lettering covered artwork, so the plain local fill is not
     * good enough. Receives the ORIGINAL picture and the erase mask; returns the rebuilt picture
     * or null if it could not run. On success the background passes the self-check.
     */
    inpaintOverArtwork?: (
      rgba: Uint8ClampedArray,
      width: number,
      height: number,
      eraseMask: Uint8Array
    ) => Promise<Uint8ClampedArray | null>;
    /**
     * Optional text detector (the bundled model). Used twice: to tell lettering from line art
     * before the split, and to look for text LEFT BEHIND in the Clean Background afterwards.
     */
    detectTextMask?: (
      rgba: Uint8ClampedArray,
      width: number,
      height: number
    ) => Promise<{ mask: Uint8Array; boxes: Array<{ minX: number; minY: number; maxX: number; maxY: number }> } | null>;
  }
): Promise<LocalMasterSplitDataUrlsResult> {
  const fail = (
    reason: RgbaMasterSplitResult['reason'] = 'canvas-unavailable'
  ): LocalMasterSplitDataUrlsResult => ({
    applied: false,
    reason,
    fontTransparentDataUrl: '',
    backgroundDataUrl: '',
    vectorSvg: '',
    width: 0,
    height: 0,
    backgroundConfidence: 0,
    backdropIsLight: true,
    textComponentCount: 0,
    emblemsPreservedCount: 0,
    quality: { fontOk: false, backgroundOk: false, reasons: [] },
  });

  if (typeof document === 'undefined' || !masterDataUrl.startsWith('data:image/')) {
    return fail('canvas-unavailable');
  }

  const decodeToImageData = async (
    url: string
  ): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> => {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('decode failed'));
        el.src = url;
      });
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w < 16 || h < 16) return null;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
    } catch {
      return null;
    }
  };

  try {
    const master = await decodeToImageData(masterDataUrl);
    if (!master) return fail('image-too-small');

    const orig =
      options?.originalDataUrl && options.originalDataUrl.startsWith('data:image/')
        ? await decodeToImageData(options.originalDataUrl)
        : null;

    const detected = options?.detectTextMask
      ? await options.detectTextMask(master.data, master.width, master.height).catch(() => null)
      : null;
    let split = splitMasterImageRgba(master.data, master.width, master.height, {
      targetWord: options?.targetWord,
      textMask: detected?.mask,
      originalData: orig?.data,
      originalWidth: orig?.width,
      originalHeight: orig?.height,
    });

    // Second attempt: the first split chose the wrong things (line art, a busy scene), but the
    // detector is confident where the text is -> cut everything to the detected text and retry.
    if (
      detected &&
      detected.boxes.length > 0 &&
      (!split.applied || !split.quality.fontOk)
    ) {
      const clipped = splitMasterImageRgba(master.data, master.width, master.height, {
        targetWord: options?.targetWord,
        textMask: detected.mask,
        textMaskMode: 'clip',
        originalData: orig?.data,
        originalWidth: orig?.width,
        originalHeight: orig?.height,
      });
      if (clipped.applied && clipped.quality.fontOk) split = clipped;
    }

    if (!split.applied) {
      return {
        ...fail(split.reason),
        width: master.width,
        height: master.height,
        backgroundConfidence: split.backgroundConfidence,
      };
    }

    const encodeRgba = (buf: Uint8ClampedArray, w: number, h: number): string => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return '';
      ctx.putImageData(new ImageData(new Uint8ClampedArray(buf), w, h), 0, 0);
      return c.toDataURL('image/png');
    };

    // Lettering lay across artwork: let the bundled model rebuild what was hidden.
    let backgroundRgba = split.backgroundData;
    let quality = split.quality;
    let backgroundRebuiltOnDevice = false;
    if (
      options?.inpaintOverArtwork &&
      quality.fontOk &&
      !quality.backgroundOk &&
      quality.reasons.includes('lettering-over-artwork')
    ) {
      try {
        const rebuilt = await options.inpaintOverArtwork(
          master.data,
          split.width,
          split.height,
          split.eraseMask
        );
        if (rebuilt && rebuilt.length === split.backgroundData.length) {
          backgroundRgba = rebuilt;
          backgroundRebuiltOnDevice = true;
          quality = {
            fontOk: true,
            backgroundOk: true,
            reasons: quality.reasons.filter((r) => r !== 'lettering-over-artwork'),
          };
        }
      } catch {
        // Model unavailable or failed: keep the verdict, the caller falls back to the AI
      }
    }

    // Leftover check: is there still text where the lettering was erased? (Detector boxes that
    // overlap the erased area; text elsewhere, such as words inside an emblem, is not counted.)
    if (options?.detectTextMask && quality.fontOk && quality.backgroundOk) {
      const leftover = await findLeftoverText(
        backgroundRgba,
        split.width,
        split.height,
        split.eraseMask,
        options.detectTextMask
      );
      if (leftover) {
        let fixed = false;
        if (options.inpaintOverArtwork) {
          try {
            const rebuilt = await options.inpaintOverArtwork(backgroundRgba, split.width, split.height, leftover);
            if (rebuilt && rebuilt.length === backgroundRgba.length) {
              const stillThere = await findLeftoverText(
                rebuilt,
                split.width,
                split.height,
                split.eraseMask,
                options.detectTextMask
              );
              if (!stillThere) {
                backgroundRgba = rebuilt;
                backgroundRebuiltOnDevice = true;
                fixed = true;
              }
            }
          } catch {
            // fall through to "not OK"
          }
        }
        if (!fixed) {
          quality = {
            fontOk: true,
            backgroundOk: false,
            reasons: [...quality.reasons, 'text-left-in-background'],
          };
        }
      }
    }

    const fontTransparentDataUrl = encodeRgba(split.fontData, split.width, split.height);
    const backgroundDataUrl = encodeRgba(backgroundRgba, split.width, split.height);
    const vectorSvg = traceWordmarkRgbaToVectorSvg(split.fontData, split.width, split.height);

    return {
      applied: Boolean(fontTransparentDataUrl && backgroundDataUrl),
      fontTransparentDataUrl,
      backgroundDataUrl,
      vectorSvg,
      width: split.width,
      height: split.height,
      backgroundConfidence: split.backgroundConfidence,
      backdropIsLight: split.backdropIsLight,
      textComponentCount: split.textComponentCount,
      emblemsPreservedCount: split.emblemsPreservedCount,
      quality,
      backgroundRebuiltOnDevice,
      letteringMetrics: quality.fontOk
        ? measureLetteringRgba(split.fontData, split.width, split.height)
        : null,
    };
  } catch {
    return fail('canvas-unavailable');
  }
}
