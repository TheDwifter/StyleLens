/**
 * Measured shape and size of a piece of lettering, in units that do not depend on the picture's
 * resolution. Used twice:
 *  1. on the ORIGINAL capture, to tell the image AI concretely how the letters are built
 *     ("wide, bold letters, tight spacing, about 18% of the picture height"), and
 *  2. on the AI's Full Picture, to catch style drift (letters drawn 2.5x too big, much narrower,
 *     much thinner) and offer a corrective retry instead of silently accepting it.
 */
export interface LetteringMetrics {
  /** Typical letter height (median over letters, so ascenders/capitals do not dominate) / picture height */
  letterHeightFrac: number;
  /** Width of the whole word / picture width */
  wordWidthFrac: number;
  /** Centre of the word as fractions of the picture (0..1) */
  centreX: number;
  centreY: number;
  /** Typical letter width / typical letter height (above ~1.15 = wide/extended, below ~0.8 = condensed) */
  letterAspect: number;
  /** Typical stroke thickness / typical letter height */
  strokeRatio: number;
  /** Typical gap between neighbouring letters / typical letter height */
  spacingRatio: number;
  /** Number of letter-sized shapes measured */
  letterCount: number;
  /**
   * How far the ink of a letter reaches into the corners of its own box, relative to its overall
   * ink density (median over letters). Circular bowls leave the corners empty (~0.2-0.4); squarish
   * "rounded-rectangle" bowls fill them (~0.5-0.8); blocky letters fill them fully (~0.9+).
   */
  cornerFill: number;
  /** Spread of letter heights (coefficient of variation); near 0 = every letter the same height. */
  heightSpread: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

interface Blob {
  id: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  area: number;
  runs: number[];
}

/**
 * Measures lettering from a transparent lettering layer (RGBA, alpha = ink).
 * Returns null when fewer than one letter-sized shape is found.
 */
export function measureLetteringRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): LetteringMetrics | null {
  const n = width * height;
  if (width < 8 || height < 8 || rgba.length < n * 4) return null;
  const ink = new Uint8Array(n);
  for (let p = 0; p < n; p++) ink[p] = rgba[p * 4 + 3]! >= 128 ? 1 : 0;

  // Connected shapes (8-connected)
  const label = new Int32Array(n);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (!ink[start] || label[start]) continue;
    const id = blobs.length + 1;
    const blob: Blob = { id, minX: width, maxX: -1, minY: height, maxY: -1, area: 0, runs: [] };
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p - x) / width;
      blob.area += 1;
      if (x < blob.minX) blob.minX = x;
      if (x > blob.maxX) blob.maxX = x;
      if (y < blob.minY) blob.minY = y;
      if (y > blob.maxY) blob.maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const np = ny * width + nx;
          if (ink[np] && !label[np]) {
            label[np] = id;
            stack.push(np);
          }
        }
      }
    }
    blobs.push(blob);
  }
  if (blobs.length === 0) return null;

  // Letter-sized shapes only: drop dots, accents, specks and stray fragments
  const maxH = Math.max(...blobs.map((b) => b.maxY - b.minY + 1));
  const maxArea = Math.max(...blobs.map((b) => b.area));
  const letters = blobs.filter(
    (b) => b.maxY - b.minY + 1 >= maxH * 0.4 && b.area >= maxArea * 0.04
  );
  if (letters.length === 0) return null;

  // Horizontal ink runs inside each letter: the median run is the stem / bowl thickness
  const letterIds = new Set(letters.map((b) => blobs.indexOf(b) + 1));
  const runs: number[] = [];
  for (let y = 0; y < height; y++) {
    let runId = 0;
    let runLen = 0;
    for (let x = 0; x <= width; x++) {
      const id = x < width ? label[y * width + x]! : 0;
      if (id !== 0 && id === runId) {
        runLen += 1;
        continue;
      }
      if (runId !== 0 && letterIds.has(runId)) runs.push(runLen);
      runId = id;
      runLen = id !== 0 ? 1 : 0;
    }
  }

  const heights = letters.map((b) => b.maxY - b.minY + 1);
  const widths = letters.map((b) => b.maxX - b.minX + 1);
  const letterH = Math.max(1, median(heights));
  const letterW = Math.max(1, median(widths));

  const byX = [...letters].sort((a, b) => a.minX - b.minX);
  const gaps: number[] = [];
  for (let i = 1; i < byX.length; i++) {
    gaps.push(Math.max(0, byX[i]!.minX - byX[i - 1]!.maxX - 1));
  }

  // Corner fill: ink in the four corner patches of each letter's box vs. the letter's own density
  const cornerFills: number[] = [];
  for (const b of letters) {
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    const patch = Math.max(2, Math.round(Math.min(bw, bh) * 0.2));
    if (bw < patch * 2 + 2 || bh < patch * 2 + 2) continue;
    let cornerInk = 0;
    const corners: Array<[number, number]> = [
      [b.minX, b.minY],
      [b.maxX - patch + 1, b.minY],
      [b.minX, b.maxY - patch + 1],
      [b.maxX - patch + 1, b.maxY - patch + 1],
    ];
    for (const [cx, cy] of corners) {
      for (let y = cy; y < cy + patch; y++) {
        for (let x = cx; x < cx + patch; x++) {
          if (label[y * width + x] === b.id) cornerInk += 1;
        }
      }
    }
    const cornerDensity = cornerInk / (4 * patch * patch);
    const overallDensity = b.area / (bw * bh);
    if (overallDensity > 0) cornerFills.push(cornerDensity / overallDensity);
  }
  const meanH = heights.reduce((s, v) => s + v, 0) / heights.length;
  const heightSpread =
    heights.length > 1
      ? Math.sqrt(heights.reduce((s, v) => s + (v - meanH) ** 2, 0) / heights.length) / Math.max(1, meanH)
      : 0;

  const minX = Math.min(...letters.map((b) => b.minX));
  const maxX = Math.max(...letters.map((b) => b.maxX));
  const minY = Math.min(...letters.map((b) => b.minY));
  const maxY = Math.max(...letters.map((b) => b.maxY));

  return {
    letterHeightFrac: letterH / height,
    wordWidthFrac: (maxX - minX + 1) / width,
    centreX: (minX + maxX + 1) / 2 / width,
    centreY: (minY + maxY + 1) / 2 / height,
    letterAspect: letterW / letterH,
    strokeRatio: median(runs) / letterH,
    spacingRatio: gaps.length > 0 ? median(gaps) / letterH : 0,
    letterCount: letters.length,
    cornerFill: cornerFills.length > 0 ? median(cornerFills) : 0,
    heightSpread,
  };
}


/** The measured features in words, each phrased as something an image model can act on. */
export function letteringFeatureWords(m: LetteringMetrics): {
  width: string;
  weight: string;
  curves: string;
  height: string | null;
  spacing: string;
  sizePct: number;
  strokePct: number;
} {
  return {
    width:
      m.letterAspect >= 1.15
        ? 'wide, extended letters'
        : m.letterAspect >= 0.92
          ? 'broad letters, about as wide as they are tall'
          : m.letterAspect <= 0.75
            ? 'narrow, condensed letters'
            : 'regular-width letters',
    weight:
      m.strokeRatio >= 0.22
        ? 'heavy strokes'
        : m.strokeRatio >= 0.15
          ? 'bold strokes'
          : m.strokeRatio >= 0.09
            ? 'medium-weight strokes'
            : 'thin strokes',
    curves:
      m.cornerFill >= 0.88
        ? 'blocky, square-cornered curves'
        : m.cornerFill >= 0.7
          ? 'squarish curves shaped like rounded rectangles, not circles'
          : m.cornerFill >= 0.5
            ? 'softly squared curves'
            : 'round, circular curves',
    height:
      m.letterCount >= 3 && m.heightSpread <= 0.06
        ? 'every letter exactly the same height'
        : null,
    spacing: m.spacingRatio <= 0.12 ? 'tight' : m.spacingRatio >= 0.35 ? 'wide' : 'even',
    sizePct: Math.round(m.letterHeightFrac * 100),
    strokePct: Math.round(m.strokeRatio * 100),
  };
}

/** Plain-language description of measured lettering, for the image prompt. */
export function describeLetteringForPrompt(m: LetteringMetrics, short = false): string {
  const f = letteringFeatureWords(m);
  if (short) {
    return `Original letters: ${f.width}, ${f.weight}, ${f.curves}, ~${f.sizePct}% of picture height.`;
  }
  return [
    `Measured from the original letters: ${f.width}; ${f.weight} (about ${f.strokePct}% of the letter height); ${f.curves}`,
    f.height ? `; ${f.height}` : '',
    `; ${f.spacing} spacing; letters about ${f.sizePct}% of the picture height.`,
  ].join('');
}
export type LetteringDriftIssue =
  | 'too-large'
  | 'too-small'
  | 'too-narrow'
  | 'too-wide'
  | 'too-thin'
  | 'too-heavy'
  | 'too-round';

export interface LetteringDrift {
  issues: LetteringDriftIssue[];
  /** New letter height / original letter height (both relative to their pictures) */
  sizeRatio: number;
}

/**
 * Compares the AI's lettering with the original. Thresholds are deliberately loose: a different
 * word always looks somewhat different, so only clear drift is reported.
 */
export function compareLettering(
  original: LetteringMetrics,
  generated: LetteringMetrics
): LetteringDrift {
  const issues: LetteringDriftIssue[] = [];
  const sizeRatio = generated.letterHeightFrac / Math.max(1e-6, original.letterHeightFrac);
  if (sizeRatio >= 1.6) issues.push('too-large');
  else if (sizeRatio <= 0.6) issues.push('too-small');
  const aspectRatio = generated.letterAspect / Math.max(1e-6, original.letterAspect);
  if (aspectRatio <= 0.72) issues.push('too-narrow');
  else if (aspectRatio >= 1.4) issues.push('too-wide');
  const strokeRatio = generated.strokeRatio / Math.max(1e-6, original.strokeRatio);
  if (strokeRatio <= 0.7) issues.push('too-thin');
  else if (strokeRatio >= 1.45) issues.push('too-heavy');
  // Squarish lettering redrawn with circular bowls: the classic "generic font" substitution
  if (original.cornerFill >= 0.6 && generated.cornerFill <= original.cornerFill - 0.08) {
    issues.push('too-round');
  }
  return { issues, sizeRatio };
}

/** One-turn correction prompt asking the AI to redraw the lettering closer to the original. */
export function buildStyleCorrectionPrompt(
  word: string,
  drift: LetteringDrift,
  original: LetteringMetrics
): string {
  const fixes: string[] = [];
  if (drift.issues.includes('too-large')) {
    fixes.push(`the letters are about ${drift.sizeRatio.toFixed(1)}x too big; make them the original size`);
  }
  if (drift.issues.includes('too-small')) fixes.push('the letters are too small; make them the original size');
  if (drift.issues.includes('too-narrow')) fixes.push('the letters are too narrow; draw them as wide as the original letters');
  if (drift.issues.includes('too-wide')) fixes.push('the letters are too wide; draw them as narrow as the original letters');
  if (drift.issues.includes('too-thin')) fixes.push('the strokes are too thin; match the original stroke weight');
  if (drift.issues.includes('too-heavy')) fixes.push('the strokes are too heavy; match the original stroke weight');
  if (drift.issues.includes('too-round')) {
    fixes.push('the curves came out round like a standard font; make them squarish like the original letters');
  }
  return [
    'Create 1 edited image from the attached picture.',
    `Replace the main words in the attached picture with "${word}". Your last version did not match the original lettering: ${fixes.join('; ')}.`,
    'The lettering is a custom logotype, not a standard font. Do not use any common typeface.',
    `1. Read the existing word in the attached picture letter by letter.`,
    `2. Every letter of "${word}" that also appears in that word must be copied exactly from the picture: same skeleton, curves, corners, stroke endings and width.`,
    '3. Draw every other letter from the same parts, so the whole word looks drawn by one designer.',
    describeLetteringForPrompt(original),
    `Keep 100% of the background, colors, framing and position identical. Spell it exactly: ${word}.`,
    'Return only the 1 image.',
  ].join('\n');
}
