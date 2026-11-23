import {
  extractFontFaceFamilyLower,
  KNOWN_GOOGLE_FONTS,
  stylesheetUrlMatchesFamily,
} from '../ai/responseParser';
import { shouldSuppressHostFallbackFont } from './captureClassification';
import {
  colorDistance,
  contrastRatio,
  isDarkColor,
  isNeutralColor,
  parseCssColor,
  rgbaToHex,
  type RgbaColor,
} from './color';
import type { CaptureRecord, ExtractedNode } from '../types/capture';

export interface DimensionScore {
  score: number;
  max: number;
  matched: number;
  total: number;
  missing: string[];
}

export interface FidelityReport {
  totalScore: number;
  passedThreshold: boolean;
  /** True when the capture is a raster <img>/<video> where live HTML cannot replicate baked lettering. */
  isBakedVisualOnly: boolean;
  breakdown: {
    typography: DimensionScore;
    colors: DimensionScore;
    layout: DimensionScore;
    surfaces: DimensionScore;
    structure: DimensionScore;
  };
  issues: string[];
  verdict: string;
}

export interface PromptFidelityReport {
  totalScore: number;
  passedThreshold: boolean;
  matched: number;
  total: number;
  issues: string[];
  verdict: string;
}

export const FIDELITY_TARGET_PERCENT = 98;

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

function parseHslToHex(hslString: string): string | null {
  const match = hslString.match(
    /hsla?\(\s*(-?\d*\.?\d+)(?:deg)?[\s,]+(\d*\.?\d+)%[\s,]+(\d*\.?\d+)%/i
  );
  if (!match || !match[1] || !match[2] || !match[3]) return null;
  const h = (((Number.parseFloat(match[1]) % 360) + 360) % 360) / 360;
  const s = Math.max(0, Math.min(100, Number.parseFloat(match[2]))) / 100;
  const l = Math.max(0, Math.min(100, Number.parseFloat(match[3]))) / 100;

  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return rgbaToHex(
    { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), a: 1 },
    false
  );
}

/**
 * Normalizes every CSS hex, rgb()/rgba(), hsl()/hsla(), and common Tailwind named color utility
 * (`bg-black`, `text-white`, etc.) inside comment-stripped CSS/HTML into uppercase #RRGGBB tokens.
 */
function extractNormalizedColorsFromCode(cleanCode: string): {
  hexes: Set<string>;
  hexWithAlpha: Set<string>;
} {
  const hexes = new Set<string>();
  const hexWithAlpha = new Set<string>();

  const register = (hex: string, alpha: number) => {
    const upper = hex.toUpperCase();
    hexes.add(upper);
    hexWithAlpha.add(`${upper}:${Math.round(alpha * 10)}`);
  };

  const hexMatches = cleanCode.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  for (const h of hexMatches) {
    const parsed = parseCssColor(h);
    if (parsed) register(rgbaToHex(parsed, false), parsed.a);
  }

  const rgbMatches = cleanCode.match(/rgba?\([^)]+\)/gi) ?? [];
  for (const rgb of rgbMatches) {
    const parsed = parseCssColor(rgb);
    if (parsed) register(rgbaToHex(parsed, false), parsed.a);
  }

  const hslMatches = cleanCode.match(/hsla?\([^)]+\)/gi) ?? [];
  for (const hsl of hslMatches) {
    const hex = parseHslToHex(hsl);
    if (hex) {
      const alphaMatch = hsl.match(/[/,]\s*(0?\.\d+|1(?:\.0+)?|\d+%)\s*\)$/);
      const alpha = alphaMatch?.[1]
        ? alphaMatch[1].endsWith('%')
          ? Number.parseFloat(alphaMatch[1]) / 100
          : Number.parseFloat(alphaMatch[1])
        : 1;
      register(hex, Number.isFinite(alpha) ? alpha : 1);
    }
  }

  if (/\b(?:bg|text|border|fill|stroke)-black\b/i.test(cleanCode)) register('#000000', 1);
  if (/\b(?:bg|text|border|fill|stroke)-white\b/i.test(cleanCode)) register('#FFFFFF', 1);

  return { hexes, hexWithAlpha };
}

function cleanFontName(name: string): string {
  return name.replace(/^__/, '').replace(/_[a-f0-9]{5,}$/i, '').replace(/_/g, ' ').trim();
}

function scoreDimension(matched: number, total: number, max: number, missing: string[]): DimensionScore {
  if (total === 0) {
    return { score: max, max, matched: 0, total: 0, missing: [] };
  }
  const ratio = Math.max(0, Math.min(1, matched / total));
  return {
    score: Math.round(ratio * max * 10) / 10,
    max,
    matched,
    total,
    missing,
  };
}

const SYSTEM_FONT_NAMES = new Set([
  'system-ui',
  '-apple-system',
  'blinkmacsystemfont',
  'segoe ui',
  'arial',
  'helvetica',
  'helvetica neue',
  'times new roman',
  'times',
  'georgia',
  'courier new',
  'courier',
  'verdana',
  'tahoma',
  'trebuchet ms',
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
]);

function extractCssFunctionName(value: string): string | null {
  const match = value.toLowerCase().match(/([a-z-]+)\s*\(/);
  return match?.[1] ?? null;
}

function extractSignificantPxToken(value: string): string | null {
  const matches = value.toLowerCase().match(/-?\d*\.?\d+px/g);
  if (!matches || matches.length === 0) return null;
  let best = matches[0]!;
  let bestAbs = Math.abs(Number.parseFloat(best)) || 0;
  for (const m of matches) {
    const abs = Math.abs(Number.parseFloat(m)) || 0;
    if (abs > bestAbs) {
      bestAbs = abs;
      best = m;
    }
  }
  return best;
}

/**
 * Extracts CSS or JSX inline-style values for matching property names without truncating
 * on quotes inside CSS functions such as `url("...")` or `font-family: "Inter", sans-serif`.
 */
function extractPropertyValues(normalizedCode: string, propNamePattern: string): string {
  const regex = new RegExp(`(?:^|[;{\\s,])(?:${propNamePattern})\\s*:\\s*([^;}\\n]+)`, 'gi');
  const values: string[] = [];
  for (const match of normalizedCode.matchAll(regex)) {
    const raw = (match[1] ?? '').trim();
    if (!raw) continue;
    let parenDepth = 0;
    let inQuote: '"' | "'" | null = null;
    let endIdx = raw.length;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]!;
      if (inQuote) {
        if (ch === inQuote && raw[i - 1] !== '\\') inQuote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === '(') {
        parenDepth += 1;
      } else if (ch === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (ch === ',' && parenDepth === 0) {
        const rest = raw.slice(i + 1);
        if (/^\s*[a-zA-Z_$][a-zA-Z0-9_$-]*\s*:/.test(rest)) {
          endIdx = i;
          break;
        }
      }
    }
    const trimmed = raw.slice(0, endIdx).trim().replace(/^['"]|['"]$/g, '');
    if (trimmed) values.push(trimmed);
  }
  return values.join(' | ');
}

function hasSpecificWebfontLoader(cleanCodeLower: string, fontNameLower: string): boolean {
  const encodedPlus = fontNameLower.replace(/\s+/g, '+');
  const encodedPct = encodeURIComponent(fontNameLower);

  const linkTags = cleanCodeLower.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    if (
      tag.includes(encodedPlus) ||
      tag.includes(encodedPct) ||
      tag.includes(fontNameLower)
    ) {
      return true;
    }
  }

  const fontFaceBlocks = cleanCodeLower.match(/@font-face\s*\{[^}]*\}/gi) ?? [];
  for (const block of fontFaceBlocks) {
    if (block.includes(fontNameLower)) {
      return true;
    }
  }

  return false;
}

function collectAllNodes(roots: ExtractedNode[]): ExtractedNode[] {
  const all: ExtractedNode[] = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const n = stack.pop()!;
    all.push(n);
    for (const c of n.children) stack.push(c);
  }
  return all;
}

function countDistinctVerticalRows(nodes: ExtractedNode[]): number {
  const visualNodes = nodes.filter(
    (n) => Boolean(n.textSnippet || n.tag === 'svg' || n.tag === 'img') && n.rect.height > 0
  );
  if (visualNodes.length <= 1) return visualNodes.length;
  const centers = visualNodes.map((n) => n.rect.y + n.rect.height / 2).sort((a, b) => a - b);
  let rows = 1;
  let lastCenter = centers[0]!;
  for (let i = 1; i < centers.length; i++) {
    if (centers[i]! - lastCenter > 34) {
      rows += 1;
      lastCenter = centers[i]!;
    }
  }
  return rows;
}

/**
 * Strict 98% Fidelity Critic Engine:
 * Rigorously audits a generated HTML/CSS recreation against the captured Design DNA
 * across Typography (25), Colors & SVG Accents (25), 2D Spatial Layout & Positioning (20),
 * Surfaces & Anti-Hallucination Purity (15), and Structure & Vectors (15).
 * Enforces strict >= 98.0 unrounded threshold (no rounding 97.5 up to 98!), rejects glossy pill
 * hallucinations even when small inner child dots have border-radius, prevents multi-row collapse,
 * and strips comments + scopes checks to real CSS/JSX declarations.
 */
export function evaluateFidelity(record: CaptureRecord, candidateHtmlCss: string): FidelityReport {
  const rawCode = candidateHtmlCss || '';
  const cleanCode = stripComments(rawCode);
  const codeLower = cleanCode.toLowerCase();
  const normalizedCode = codeLower.replace(/\s+/g, ' ');
  const isFullHtmlDocument = /<!doctype\s+html|<html\b/i.test(cleanCode);
  const { dna } = record;
  const isBakedVisualOnly =
    record.captureMode === 'visual-only' || Boolean(record.containsGraphicArtwork);
  const allNodes = collectAllNodes(record.roots);

  const fontFamilyValues = extractPropertyValues(normalizedCode, 'font-family|fontfamily');
  const fontSizeValues = extractPropertyValues(normalizedCode, 'font-size|fontsize');
  const fontWeightValues = extractPropertyValues(normalizedCode, 'font-weight|fontweight');
  const gapValues = extractPropertyValues(normalizedCode, '(?:row-|column-)?gap|rowgap|columngap');
  const paddingValues = extractPropertyValues(
    normalizedCode,
    'padding(?:-(?:top|right|bottom|left))?|padding(?:top|right|bottom|left)?'
  );

  // 1. Typography & Font Fidelity (25 pts)
  const typeMissing: string[] = [];
  let typeTotal = 0;
  let typeMatched = 0;
  const checkedWebfonts = new Set<string>();
  const hasSourceFontAssets =
    (dna.fontStylesheetUrls?.length ?? 0) > 0 || (dna.fontFaceRules?.length ?? 0) > 0;

  for (const t of dna.typography.slice(0, 6)) {
    const cleaned = cleanFontName(t.primaryFont).toLowerCase();
    typeTotal += 1;
    const rawPrimaryLower = t.primaryFont.toLowerCase();
    if (
      fontFamilyValues.includes(cleaned) ||
      fontFamilyValues.includes(rawPrimaryLower) ||
      new RegExp(`font-\\[['"]?${cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(codeLower)
    ) {
      typeMatched += 1;
    } else {
      typeMissing.push(`Missing font-family "${cleanFontName(t.primaryFont)}"`);
    }

    // Require webfont loader on full HTML docs for Google Fonts OR when source page exposed font sheets/@font-face
    const requiresWebfontLoader =
      isFullHtmlDocument &&
      cleaned &&
      !SYSTEM_FONT_NAMES.has(cleaned) &&
      (KNOWN_GOOGLE_FONTS.has(cleaned) || hasSourceFontAssets);

    if (requiresWebfontLoader && !checkedWebfonts.has(cleaned)) {
      checkedWebfonts.add(cleaned);
      typeTotal += 1;
      if (hasSpecificWebfontLoader(codeLower, cleaned)) {
        typeMatched += 1;
      } else {
        typeMissing.push(
          `Missing webfont loader (<link> or @font-face) for "${cleanFontName(t.primaryFont)}"`
        );
      }
    }

    typeTotal += 1;
    const sizeStr = `${t.fontSizePx}px`;
    const sizeInt = `${Math.round(t.fontSizePx)}px`;
    const sizePattern = new RegExp(
      `(?:^|\\b)(?:${sizeStr.replace('.', '\\.')}|${sizeInt})\\b`,
      'i'
    );
    if (
      sizePattern.test(fontSizeValues) ||
      codeLower.includes(`text-[${sizeStr}]`) ||
      codeLower.includes(`text-[${sizeInt}]`)
    ) {
      typeMatched += 1;
    } else {
      typeMissing.push(`Missing font-size ${sizeStr}`);
    }

    typeTotal += 1;
    if (
      new RegExp(`\\b${t.fontWeight}\\b`).test(fontWeightValues) ||
      (t.fontWeight >= 700 && /\bfont-(bold|extrabold|black)\b/.test(codeLower)) ||
      (t.fontWeight === 600 && /\bfont-semibold\b/.test(codeLower)) ||
      (t.fontWeight === 500 && /\bfont-medium\b/.test(codeLower))
    ) {
      typeMatched += 1;
    } else {
      typeMissing.push(`Missing font-weight ${t.fontWeight}`);
    }
  }
  const typography = scoreDimension(typeMatched, typeTotal, 25, typeMissing);

  // 2. Color, SVG Brand Accents & Polarity Fidelity (25 pts)
  const { hexes: codeHexes, hexWithAlpha } = extractNormalizedColorsFromCode(cleanCode);
  const exactColors = dna.palette.filter((c) => c.provenance === 'exact-dom').slice(0, 8);
  const targetColors = exactColors.length > 0 ? exactColors : dna.palette.slice(0, 5);
  const colorMissing: string[] = [];
  let colorTotal = 0;
  let colorMatched = 0;

  for (const c of targetColors) {
    colorTotal += 1;
    const targetHex = c.hex.toUpperCase();
    if (c.alpha < 0.92) {
      const bucket = Math.round(c.alpha * 10);
      const alphaMatched =
        hexWithAlpha.has(`${targetHex}:${bucket}`) ||
        hexWithAlpha.has(`${targetHex}:${Math.max(0, bucket - 1)}`) ||
        hexWithAlpha.has(`${targetHex}:${Math.min(10, bucket + 1)}`);
      if (alphaMatched || codeHexes.has(targetHex)) {
        colorMatched += 1;
      } else {
        colorMissing.push(`Missing translucent ${c.role} color ${c.rgbString} (${targetHex})`);
      }
    } else if (codeHexes.has(targetHex)) {
      colorMatched += 1;
    } else {
      colorMissing.push(`Missing ${c.role} color ${targetHex}`);
    }
  }

  // Explicitly verify extracted inline <svg> brand fill/stroke colors appear in vector/fill/color context
  const svgChunks = (cleanCode.match(/<svg\b[\s\S]*?<\/svg>/gi) ?? []).join(' ');
  const svgAndColorContext = `${svgChunks} ${extractPropertyValues(normalizedCode, 'fill|stroke|color')}`;
  const svgContextHexes = extractNormalizedColorsFromCode(svgAndColorContext).hexes;
  const requiredSvgHexes = Array.from(
    new Set(allNodes.flatMap((n) => n.svgColors ?? []).map((h) => h.toUpperCase()))
  ).slice(0, 4);

  for (const svgHex of requiredSvgHexes) {
    colorTotal += 1;
    if (svgContextHexes.has(svgHex)) colorMatched += 1;
    else colorMissing.push(`Missing inline <svg> brand vector color ${svgHex} in fill/stroke/color`);
  }
  const colors = scoreDimension(colorMatched, colorTotal, 25, colorMissing);

  // 3. 2D Spatial Layout, Spacing & Positioning Fidelity (20 pts)
  const layoutMissing: string[] = [];
  let layoutTotal = 0;
  let layoutMatched = 0;

  if (dna.layout.primaryModel === 'flex' || dna.layout.primaryModel === 'mixed') {
    layoutTotal += 1;
    if (
      /display\s*:\s*['"]?(inline-)?flex\b/i.test(cleanCode) ||
      /class(?:Name)?\s*=\s*["'][^"']*\b(?:inline-)?flex\b/i.test(cleanCode)
    ) {
      layoutMatched += 1;
    } else {
      layoutMissing.push('Missing flexbox layout');
    }
  }
  if (dna.layout.primaryModel === 'grid' || dna.layout.primaryModel === 'mixed') {
    layoutTotal += 1;
    if (
      /display\s*:\s*['"]?(inline-)?grid\b/i.test(cleanCode) ||
      /class(?:Name)?\s*=\s*["'][^"']*\b(?:inline-)?grid\b/i.test(cleanCode)
    ) {
      layoutMatched += 1;
    } else {
      layoutMissing.push('Missing CSS grid layout');
    }
  }
  for (const gapPx of dna.layout.gapValuesPx.slice(0, 3)) {
    layoutTotal += 1;
    const twGap = gapPx % 4 === 0 ? `gap-${gapPx / 4}` : null;
    if (
      new RegExp(`\\b${gapPx}px\\b`).test(gapValues) ||
      codeLower.includes(`gap-[${gapPx}px]`) ||
      (twGap !== null && new RegExp(`\\b${twGap}\\b`).test(codeLower))
    ) {
      layoutMatched += 1;
    } else {
      layoutMissing.push(`Missing gap ${gapPx}px`);
    }
  }
  for (const padPx of dna.layout.paddingValuesPx.slice(0, 3)) {
    layoutTotal += 1;
    const twPad = padPx % 4 === 0 ? `(?:p|px|py|pt|pr|pb|pl)-${padPx / 4}` : null;
    if (
      new RegExp(`\\b${padPx}px\\b`).test(paddingValues) ||
      new RegExp(`(?:p|px|py|pt|pr|pb|pl)-\\[${padPx}px\\]`).test(codeLower) ||
      (twPad !== null && new RegExp(`\\b${twPad}\\b`).test(codeLower))
    ) {
      layoutMatched += 1;
    } else {
      layoutMissing.push(`Missing padding ${padPx}px`);
    }
  }

  // Multi-row & multi-root 2D spatial layout preservation check (strictly blocks single-row pill collapse!)
  const verticalRowCount = countDistinctVerticalRows(allNodes);
  if (record.roots.length > 1) {
    layoutTotal += 1;
    const preserves2DPositions =
      /position\s*:\s*['"]?absolute\b/i.test(cleanCode) &&
      /(?:^|[;{\s,])left\s*:\s*['"]?\d+px/i.test(cleanCode) &&
      /(?:^|[;{\s,])top\s*:\s*['"]?\d+px/i.test(cleanCode);
    const preservesMultiRowStack =
      /flex-direction\s*:\s*['"]?column\b/i.test(cleanCode) ||
      /\bflex-col\b/i.test(cleanCode) ||
      /grid-template-rows/i.test(cleanCode);
    const passesMultiRoot =
      verticalRowCount >= 2 ? preserves2DPositions || preservesMultiRowStack : preserves2DPositions;
    if (passesMultiRoot) {
      layoutMatched += 1;
    } else {
      layoutMissing.push(
        'Multi-root marquee lost its 2D spatial coordinates or collapsed multi-row hierarchy'
      );
    }
  } else if (
    verticalRowCount >= 2 &&
    record.roots[0]?.styles.flexDirection === 'column'
  ) {
    layoutTotal += 1;
    if (
      /flex-direction\s*:\s*['"]?column\b/i.test(cleanCode) ||
      /\bflex-col\b/i.test(cleanCode) ||
      /grid-template-rows/i.test(cleanCode)
    ) {
      layoutMatched += 1;
    } else {
      layoutMissing.push('Single-root multi-row layout lost vertical column direction');
    }
  }

  // Absolute-positioned non-root overlay children check
  let hasPositionedOverlayChild = false;
  const posStack: Array<{ node: ExtractedNode; isRoot: boolean }> = record.roots.map((r) => ({
    node: r,
    isRoot: true,
  }));
  while (posStack.length > 0) {
    const { node, isRoot } = posStack.pop()!;
    if (
      !isRoot &&
      node.styles.position === 'absolute' &&
      Boolean(node.styles.top || node.styles.right || node.styles.bottom || node.styles.left)
    ) {
      hasPositionedOverlayChild = true;
      break;
    }
    for (const child of node.children) posStack.push({ node: child, isRoot: false });
  }
  if (hasPositionedOverlayChild) {
    layoutTotal += 1;
    const hasAbsoluteAndOffset =
      /position\s*:\s*['"]?absolute\b/i.test(cleanCode) &&
      /(?:^|[;{\s,])(?:top|right|bottom|left)\s*:\s*['"]?-?\d/i.test(cleanCode);
    if (hasAbsoluteAndOffset) layoutMatched += 1;
    else layoutMissing.push('Missing position: absolute offset coordinates for overlay element');
  }

  const layout = scoreDimension(layoutMatched, layoutTotal, 20, layoutMissing);

  // 4. Backdrop, Surfaces & Anti-Hallucination Purity (15 pts)
  const surfaces = dna.surfaces;
  const surfaceMissing: string[] = [];
  let surfaceTotal = 0;
  let surfaceMatched = 0;

  const checkSurfaceValue = (
    items: string[] | undefined,
    label: string,
    propNamePattern: string,
    matcher: (firstValue: string, propValues: string) => boolean
  ) => {
    const first = items?.[0];
    if (!first) return;
    surfaceTotal += 1;
    const normalizedFirst = first.toLowerCase().replace(/\s+/g, ' ');
    const propValues = extractPropertyValues(normalizedCode, propNamePattern);
    if (
      (propValues.length > 0 && propValues.includes(normalizedFirst)) ||
      matcher(normalizedFirst, propValues)
    ) {
      surfaceMatched += 1;
    } else {
      surfaceMissing.push(`Missing ${label}: ${first}`);
    }
  };

  checkSurfaceValue(
    surfaces?.borderRadii,
    'border-radius',
    'border-radius|borderradius',
    (val, propValues) => {
      const px = extractSignificantPxToken(val);
      return Boolean(px && propValues.includes(px));
    }
  );
  checkSurfaceValue(
    surfaces?.borders,
    'border',
    'border(?:-(?:top|right|bottom|left))?|border(?:top|right|bottom|left)?',
    (val, propValues) => {
      const widthPx = extractSignificantPxToken(val);
      return Boolean(propValues.length > 0 && (!widthPx || propValues.includes(widthPx)));
    }
  );
  checkSurfaceValue(
    surfaces?.shadows,
    'box-shadow',
    'box-shadow|boxshadow',
    (val, propValues) => {
      const px = extractSignificantPxToken(val);
      return Boolean(propValues.length > 0 && (!px || propValues.includes(px)));
    }
  );
  checkSurfaceValue(
    surfaces?.textShadows,
    'text-shadow',
    'text-shadow|textshadow',
    (val, propValues) => {
      const px = extractSignificantPxToken(val);
      return Boolean(propValues.length > 0 && (!px || propValues.includes(px)));
    }
  );
  checkSurfaceValue(
    surfaces?.backdropFilters,
    'backdrop-filter',
    '(?:-webkit-)?backdrop-filter|backdropfilter',
    (val, propValues) => {
      const px = extractSignificantPxToken(val);
      return Boolean(propValues.includes('blur(') && (!px || propValues.includes(px)));
    }
  );
  checkSurfaceValue(
    surfaces?.gradients,
    'gradient',
    'background(?:-image)?|backgroundimage',
    (val, propValues) => {
      const fn = extractCssFunctionName(val);
      return Boolean(fn && propValues.includes(`${fn}(`));
    }
  );
  checkSurfaceValue(
    surfaces?.transforms,
    'transform',
    'transform',
    (val, propValues) => {
      const fn = extractCssFunctionName(val);
      return Boolean(propValues.length > 0 && (!fn || propValues.includes(`${fn}(`)));
    }
  );
  checkSurfaceValue(
    surfaces?.clipPaths,
    'clip-path',
    'clip-path|clippath',
    (val, propValues) => {
      const fn = extractCssFunctionName(val);
      return Boolean(propValues.length > 0 && (!fn || propValues.includes(`${fn}(`)));
    }
  );

  // Outer-frame Anti-Hallucination Purity Checks (immune to tiny 14px child badge dots!)
  const outerHasRadius = record.roots.some((r) => Boolean(r.styles.borderRadius));
  const outerHasShadow = record.roots.some((r) => Boolean(r.styles.boxShadow));
  const hasAnyPillInOriginal = (surfaces?.borderRadii ?? []).some((r) => /999\d*px|50%/i.test(r));

  if (!outerHasRadius && record.roots.length > 0) {
    surfaceTotal += 1;
    // Matches Tailwind positive rounded utilities while NEVER flagging `rounded-none` or `rounded-[0px]`
    const twPositiveRoundedPattern =
      /(?<![a-z0-9-])rounded(?!-none\b)(?:-(?:sm|md|lg|xl|2xl|3xl|full|\[[1-9][^\]]*\]))?(?![a-z0-9-])/i;
    const hasHallucinatedPillOnZeroPillCapture =
      !hasAnyPillInOriginal &&
      (/(?:border-radius|borderradius)\s*:\s*['"]?(?:999\d*px|50%)/i.test(normalizedCode) ||
        /\brounded-full\b/i.test(codeLower));
    const outerFrameHasRadius =
      /(?:\.(?:sl-capture-frame|sl-root|pill|badge-frame|card|header|wrapper|container)|(?:^|[}\s])(?:header|section|nav|main))\s*\{[^}]*border-radius\s*:\s*[1-9]/i.test(
        normalizedCode
      ) ||
      /<(?:header|section|nav|main)\b[^>]*class(?:Name)?\s*=\s*["'][^"']*\brounded-(?:lg|xl|2xl|3xl|full|\[[1-9][^\]]*\])\b/i.test(
        cleanCode
      );
    const hasGlobalRadiusOnZeroRadiusCapture =
      (surfaces?.borderRadii?.length ?? 0) === 0 &&
      (/[1-9]\d*(?:\.\d+)?(?:px|rem|em|%)/.test(
        extractPropertyValues(normalizedCode, 'border-radius|borderradius')
      ) ||
        twPositiveRoundedPattern.test(codeLower));

    if (!hasHallucinatedPillOnZeroPillCapture && !outerFrameHasRadius && !hasGlobalRadiusOnZeroRadiusCapture) {
      surfaceMatched += 1;
    } else {
      surfaceMissing.push(
        'Hallucinated rounded/pill border-radius on a flat sharp-edged outer capture (0px original)'
      );
    }
  }

  if ((surfaces?.gradients?.length ?? 0) === 0 && record.roots.length > 0) {
    surfaceTotal += 1;
    const bgVals = extractPropertyValues(normalizedCode, 'background(?:-image)?|backgroundimage');
    const hasTwGradient = /\bbg-(?:gradient|linear|radial|conic)-to-/i.test(codeLower);
    if (!/gradient\(/.test(bgVals) && !hasTwGradient) {
      surfaceMatched += 1;
    } else {
      surfaceMissing.push('Hallucinated glossy/gradient fill on a flat solid-color capture');
    }
  }

  if (!outerHasShadow && (surfaces?.shadows?.length ?? 0) === 0 && record.roots.length > 0) {
    surfaceTotal += 1;
    const shadowVals = extractPropertyValues(normalizedCode, 'box-shadow|boxshadow');
    const hasCssShadow = shadowVals.length > 0 && !/^(?:none|\s|\|)+$/.test(shadowVals);
    const hasTwShadow =
      /(?<![a-z0-9-])shadow(?!-none\b)(?:-(?:sm|md|lg|xl|2xl|inner|\[[^\]]+\]))?(?![a-z0-9-])/i.test(
        codeLower
      );
    if (!hasCssShadow && !hasTwShadow) {
      surfaceMatched += 1;
    } else {
      surfaceMissing.push('Hallucinated drop shadow on a flat zero-elevation capture');
    }
  }

  const surfaceScore = scoreDimension(surfaceMatched, surfaceTotal, 15, surfaceMissing);

  // 5. Structure & Vector Completeness (15 pts)
  const structMissing: string[] = [];
  let structTotal = 0;
  let structMatched = 0;

  const flatTags: string[] = [];
  let svgCount = 0;
  let svgUsesCurrentColor = false;
  for (const n of allNodes) {
    flatTags.push(n.tag);
    if (n.tag === 'svg' && n.svgMarkup) {
      svgCount += 1;
      if (/currentcolor/i.test(n.svgMarkup)) svgUsesCurrentColor = true;
    }
  }

  const uniqueSemanticTags = Array.from(
    new Set(flatTags.filter((t) => !['div', 'span'].includes(t)))
  ).slice(0, 6);
  for (const tag of uniqueSemanticTags) {
    structTotal += 1;
    if (new RegExp(`<${tag}\\b`, 'i').test(cleanCode)) structMatched += 1;
    else structMissing.push(`Missing semantic <${tag}> element`);
  }

  if (svgCount > 0) {
    structTotal += 1;
    if (/<svg\b/i.test(cleanCode)) structMatched += 1;
    else structMissing.push('Missing inline <svg> vector artwork');

    if (svgUsesCurrentColor) {
      structTotal += 1;
      const fgColorValues = extractPropertyValues(normalizedCode, 'color');
      if (/(?:rgb|#|hsl|oklch)/i.test(fgColorValues)) structMatched += 1;
      else structMissing.push('Missing inherited foreground color declaration for currentColor inline <svg>');
    }
  }

  const structure = isBakedVisualOnly
    ? {
        score: 6,
        max: 15,
        matched: 0,
        total: 1,
        missing: [
          'Selection is baked raster artwork/media — attach the cropped PNG image alongside the prompt for visual accuracy.',
        ],
      }
    : scoreDimension(structMatched, structTotal, 15, structMissing);

  // Guard against empty/blank HTML shells falsely scoring 100% when typography tokens were empty
  const htmlWithoutStyles = cleanCode.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  const visiblePlainText = htmlWithoutStyles.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const hasVisibleVisualElement =
    visiblePlainText.length > 0 ||
    /<svg\b/i.test(htmlWithoutStyles) ||
    /<img\b[^>]*\bsrc\s*=/i.test(htmlWithoutStyles) ||
    /<input\b/i.test(htmlWithoutStyles);

  // STRICT NO-ROUNDING-UP THRESHOLD: 97.5 scores 97 and FAILS (< 98.0)!
  const rawTotal =
    typography.score + colors.score + layout.score + surfaceScore.score + structure.score;
  const clampedRaw = hasVisibleVisualElement
    ? Math.max(0, Math.min(100, rawTotal))
    : Math.min(15, Math.max(0, rawTotal));
  const totalScore = Math.floor(clampedRaw);
  const passedThreshold = hasVisibleVisualElement && clampedRaw >= FIDELITY_TARGET_PERCENT;

  const issues = [
    ...(!hasVisibleVisualElement
      ? ['Preview contains no visible rendered elements (blank canvas)']
      : []),
    ...typography.missing,
    ...colors.missing,
    ...layout.missing,
    ...surfaceScore.missing,
    ...structure.missing,
  ];

  const verdict = isBakedVisualOnly
    ? `${totalScore}% (Baked Graphic — attach Copy Image + Prompt for visual shapes)`
    : passedThreshold
      ? `${totalScore}% Verified 1:1 X-Ray Match (>= ${FIDELITY_TARGET_PERCENT}% target)`
      : `${totalScore}% Needs Refinement (${issues.length} gap${issues.length === 1 ? '' : 's'} flagged — target >= ${FIDELITY_TARGET_PERCENT}%)`;

  return {
    totalScore,
    passedThreshold,
    isBakedVisualOnly,
    breakdown: {
      typography,
      colors,
      layout,
      surfaces: surfaceScore,
      structure,
    },
    issues,
    verdict,
  };
}

/**
 * Strict 98% Prompt Fidelity Critic:
 * Audits the generated "Copy Style Prompt" to verify it gives external AIs (Gemini, ChatGPT,
 * Claude, Cursor) unambiguous 1-to-1 spatial layout, exact typography/weight/casing/color
 * attribution, anti-hallucination guardrails, and an intact ordered HTML+CSS blueprint.
 */
export function evaluatePromptFidelity(
  record: CaptureRecord,
  promptText: string
): PromptFidelityReport {
  const text = promptText || '';
  const lower = text.toLowerCase();
  const issues: string[] = [];
  let total = 0;
  let matched = 0;

  const check = (condition: boolean, failureMessage: string) => {
    total += 1;
    if (condition) matched += 1;
    else issues.push(failureMessage);
  };

  // 1. Strict 1-to-1 contract, position-agnostic text-swap, and no-CSS-as-image-text rule
  check(
    /mandatory replication contract|replicate the exact format/i.test(text),
    'Missing explicit 1-to-1 exact format/font replication directive'
  );
  check(
    /change only the specific text or brand name i requested in my message/i.test(text),
    'Missing position-agnostic directive to swap ONLY user-requested brand/text'
  );
  check(
    /never (?:render|draw) css/i.test(text),
    'Missing guardrail forbidding image generators from rendering CSS/hex metadata as visible text'
  );

  // 2. X-Ray Spatial Visual Layout Map coverage (prioritizing headings/logos so <h1> is never skipped)
  const allNodes = collectAllNodes(record.roots);
  check(
    /x-ray spatial visual layout map/i.test(text),
    'Missing X-Ray Spatial Visual Layout Map section'
  );

  const rankedTextNodes = allNodes
    .filter((n) => Boolean(n.textSnippet?.trim()))
    .sort((a, b) => {
      const pa = a.tag === 'h1' ? 100 : a.tag === 'h2' ? 90 : 50;
      const pb = b.tag === 'h1' ? 100 : b.tag === 'h2' ? 90 : 50;
      return pb - pa;
    })
    .slice(0, 12);

  for (const n of rankedTextNodes) {
    const snippet = n.textSnippet!.trim();
    const textSegments =
      n.inlineSegments && n.inlineSegments.length > 0
        ? n.inlineSegments
            .filter((s): s is { kind: 'text'; text: string } => s.kind === 'text')
            .map((s) => s.text.trim().slice(0, 32).toLowerCase())
            .filter((s) => s.length > 0)
        : [snippet.slice(0, 32).toLowerCase()];

    const allSegmentsPresent = textSegments.every((seg) => lower.includes(seg));
    check(
      allSegmentsPresent,
      `Spatial Layout Map missing captured text element "${snippet.slice(0, 32)}"`
    );
    if (n.styles.textTransform === 'uppercase') {
      check(
        text.includes('UPPERCASE'),
        `Spatial Layout Map missing UPPERCASE casing indicator for "${snippet.slice(0, 24)}"`
      );
    }
  }

  // 3. Exact colors + SVG brand accent attribution
  const exactHexes = Array.from(
    new Set([
      ...record.dna.palette.filter((c) => c.provenance === 'exact-dom').map((c) => c.hex.toUpperCase()),
      ...allNodes.flatMap((n) => n.svgColors ?? []).map((h) => h.toUpperCase()),
    ])
  ).slice(0, 8);
  for (const hex of exactHexes) {
    check(text.toUpperCase().includes(hex), `Prompt missing exact measured color ${hex}`);
  }

  // 4. Typography families, sizes & weights
  for (const t of record.dna.typography.slice(0, 5)) {
    const fontClean = cleanFontName(t.primaryFont).toLowerCase();
    check(
      lower.includes(fontClean) &&
        lower.includes(`${t.fontSizePx}px`) &&
        lower.includes(`weight ${t.fontWeight}`),
      `Prompt missing complete typography spec for "${cleanFontName(t.primaryFont)}" (${t.fontSizePx}px, weight ${t.fontWeight})`
    );
  }

  // 5. Anti-hallucination negative constraints (outer-root based, immune to tiny child dots)
  check(
    /do-not-invent|anti-hallucination/i.test(text),
    'Missing anti-hallucination negative constraints section'
  );
  const outerHasRadius = record.roots.some((r) => Boolean(r.styles.borderRadius));
  if (!outerHasRadius && record.roots.length > 0) {
    check(
      /no invented pill|0px/i.test(text),
      'Missing anti-pill guardrail for flat 0px-radius outer capture'
    );
  }
  if ((record.dna.surfaces.gradients?.length ?? 0) === 0 && record.roots.length > 0) {
    check(
      /no 3d gloss|flat solid/i.test(text),
      'Missing anti-gloss/anti-gradient guardrail for flat matte capture'
    );
  }
  if (countDistinctVerticalRows(allNodes) >= 2) {
    check(
      /no layout collapsing/i.test(text),
      'Missing anti-row-collapse guardrail for multi-row capture'
    );
  }

  // 6. Strict ordered intact HTML + Scoped CSS blueprint (when meaningful live DOM was captured)
  if (record.roots.length > 0 && !record.containsGraphicArtwork && record.dna.typography.length > 0) {
    const styleOpenIdx = text.indexOf('<style>');
    const styleCloseIdx = text.indexOf('</style>');
    const frameIdx = text.indexOf('<div class="sl-capture-frame">');
    check(
      styleOpenIdx !== -1 &&
        styleCloseIdx > styleOpenIdx &&
        frameIdx > styleCloseIdx,
      'Prompt blueprint has missing or malformed/out-of-order <style>...</style> and .sl-capture-frame HTML'
    );
  }

  const rawPercent = total === 0 ? 100 : (matched / total) * 100;
  const totalScore = Math.floor(rawPercent);
  const passedThreshold = rawPercent >= FIDELITY_TARGET_PERCENT;

  return {
    totalScore,
    passedThreshold,
    matched,
    total,
    issues,
    verdict: passedThreshold
      ? `${totalScore}% Prompt Fidelity Verified (>= ${FIDELITY_TARGET_PERCENT}% target)`
      : `${totalScore}% Prompt Fidelity Below Target (${issues.length} gap${issues.length === 1 ? '' : 's'})`,
  };
}

function hasCorsSafeFontLoader(
  srcDoc: string,
  cleanFontLower: string,
  rawFontLower: string
): boolean {
  // 1. CORS-open external stylesheet <link> with EXACT `family=` parameter match
  // (prevents `"Inter"` from falsely matching `"Inter+Tight"`!)
  const linkTags = srcDoc.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    const hrefMatch = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    const href = hrefMatch?.[1];
    if (!href) continue;
    const isCorsOpenCdn =
      /^https:\/\/(?:fonts\.googleapis\.com|fonts\.bunny\.net|api\.fontshare\.com|cdn\.jsdelivr\.net)\//i.test(
        href
      );
    if (isCorsOpenCdn && stylesheetUrlMatchesFamily(href, cleanFontLower)) {
      return true;
    }
  }

  // 2. Embedded base64 data-URI `@font-face` OR CORS-open CDN `@font-face`
  // Strictly parse ONLY `font-family:` (NEVER scan the base64 payload bytes!)
  const fontFaceBlocks = srcDoc.match(/@font-face\s*\{[^}]*\}/gi) ?? [];
  for (const block of fontFaceBlocks) {
    const declaredFamily = extractFontFaceFamilyLower(block);
    if (!declaredFamily) continue;
    const matchesFamily =
      declaredFamily === cleanFontLower ||
      (rawFontLower.length > 0 && declaredFamily === rawFontLower);
    if (!matchesFamily) continue;
    const isEmbeddedData = /url\(\s*["']?data:(?:font\/|application\/)/i.test(block);
    const isCorsOpenSrc =
      /fonts\.gstatic\.com|fonts\.bunny\.net|use\.typekit\.net|cdn\.jsdelivr\.net/i.test(block);
    if (isEmbeddedData || isCorsOpenSrc) {
      return true;
    }
  }

  return false;
}

interface ParsedCssRule {
  selector: string;
  body: string;
}

function parseActiveComponentRules(
  styleCss: string,
  activeClasses: Set<string>,
  activeTags: Set<string>
): ParsedCssRule[] {
  const withoutAtRules = styleCss
    .replace(/@font-face\s*\{[^}]*\}/gi, ' ')
    .replace(/:root\s*\{[^}]*\}/gi, ' ')
    .replace(/html,\s*body\s*\{[^}]*\}/gi, ' ');

  const rules: ParsedCssRule[] = [];
  const rulePattern = /([^{}@]+)\{([^}]*)\}/g;
  for (const match of withoutAtRules.matchAll(rulePattern)) {
    const selector = (match[1] ?? '').trim();
    const body = (match[2] ?? '').trim();
    if (!selector || !body) continue;

    // Exclude global resets, wrapper stage, and decorative swatch dots (anti-gaming!)
    const selectorLower = selector.toLowerCase();
    if (
      /^\*|\bhtml\b|\bbody\b|\.sl-stage\b|\.sl-dots?\b/.test(selectorLower) &&
      !selectorLower.includes('.sl-spec-')
    ) {
      continue;
    }

    // Verify at least one selector branch actually matches a class or tag in the rendered HTML!
    const branches = selectorLower.split(',').map((s) => s.trim());
    const matchesDom = branches.some((branch) => {
      if (/\.sl-dots?\b/.test(branch)) return false;
      const clsMatches = Array.from(branch.matchAll(/\.([a-z0-9_-]+)/gi)).map((m) => m[1]!);
      if (clsMatches.length > 0) {
        return clsMatches.every((cls) => activeClasses.has(cls));
      }
      const tagMatch = branch.match(/^([a-z][a-z0-9-]*)/i);
      return Boolean(tagMatch?.[1] && activeTags.has(tagMatch[1]));
    });

    if (matchesDom) {
      rules.push({ selector, body });
    }
  }
  return rules;
}

function getMergedRuleBody(rules: ParsedCssRule[], selectorPattern: RegExp): string {
  return rules
    .filter((r) =>
      r.selector
        .split(',')
        .some((branch) => selectorPattern.test(branch.trim()))
    )
    .map((r) => r.body)
    .join('; ');
}

function getLastDeclarationValue(blockCss: string, propNamePattern: string): string {
  const regex = new RegExp(`(?:^|[;\\s])(?:${propNamePattern})\\s*:\\s*([^;]+)`, 'gi');
  let lastVal = '';
  for (const m of blockCss.matchAll(regex)) {
    if (m[1]) lastVal = m[1].trim();
  }
  return lastVal;
}

function extractLastColorProp(blockCss: string, propName: string): RgbaColor | null {
  const lastVal = getLastDeclarationValue(blockCss, propName);
  if (!lastVal) return null;
  const colorToken = lastVal.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}\b/);
  return colorToken ? parseCssColor(colorToken[0]) : null;
}

function firstFontInStackMatches(
  fontFamilyValue: string,
  cleanFontLower: string,
  rawFontLower: string
): boolean {
  if (!fontFamilyValue) return false;
  const firstPart = (fontFamilyValue.split(',')[0] ?? '')
    .trim()
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .toLowerCase();
  if (!firstPart) return false;
  return firstPart === cleanFontLower || (rawFontLower.length > 0 && firstPart === rawFontLower);
}

function hasVisibleBorderDeclaration(cssText: string): boolean {
  const regex = /(?:^|[;{\s])border(?:-(?:top|right|bottom|left))?\s*:\s*([^;}\n]+)/gi;
  for (const m of cssText.matchAll(regex)) {
    const val = (m[1] ?? '').trim().toLowerCase();
    if (!val || /^(?:none|0(?:px)?|transparent)$/.test(val)) continue;
    if (/\b(?:solid|dashed|dotted|double|groove|ridge)\b/.test(val) && !/\b0(?:px)?\s+(?:solid|dashed|dotted)\b/.test(val)) {
      return true;
    }
  }
  return false;
}

/**
 * Ultra-Strict Remix Preview Fidelity Critic (>= 98.0% required to PASS):
 * Audits the ACTUAL rendered `<iframe sandbox="" srcDoc>` HTML document — NOT just a partial
 * snippet — enforcing active DOM-matched CSS selectors, cascade-last rule semantics,
 * first-in-stack font verification for BOTH heading AND body fonts, exact CORS-safe font
 * loaders (zero base64/substring collisions), active brand accents (no `.sl-dot` or `:root`
 * gaming), WCAG AA (>= 4.5:1) contrast on solid AND gradient stops, and flat-edge purity.
 */
export function evaluateRemixFidelity(
  record: CaptureRecord,
  renderedSrcDoc: string
): FidelityReport {
  const rawDoc = renderedSrcDoc || '';
  const cleanDoc = stripComments(rawDoc);
  const { dna } = record;
  const isBakedVisualOnly =
    record.captureMode === 'visual-only' || Boolean(record.containsGraphicArtwork);

  // Extract rendered HTML body (excluding <head> and <style>) to know which selectors are ACTUALLY used!
  const bodyOnlyHtml = cleanDoc
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ');

  const activeClasses = new Set<string>();
  for (const m of bodyOnlyHtml.matchAll(/\bclass\s*=\s*["']([^"']+)["']/gi)) {
    for (const token of (m[1] ?? '').split(/\s+/)) {
      const cls = token.trim().toLowerCase();
      if (cls) activeClasses.add(cls);
    }
  }
  const activeTags = new Set<string>();
  for (const m of bodyOnlyHtml.matchAll(/<([a-z][a-z0-9-]*)\b/gi)) {
    if (m[1]) activeTags.add(m[1].toLowerCase());
  }

  const styleBlocks = Array.from(cleanDoc.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    .map((m) => m[1] ?? '')
    .join('\n');
  const activeRules = parseActiveComponentRules(styleBlocks, activeClasses, activeTags);
  const activeComponentCss = activeRules.map((r) => `${r.selector} { ${r.body} }`).join('\n');
  const activeComponentCssLower = activeComponentCss.toLowerCase();
  const normalizedActiveCss = activeComponentCssLower.replace(/\s+/g, ' ');

  const effectiveTypography = shouldSuppressHostFallbackFont(record)
    ? []
    : dna.typography.length > 0
      ? dna.typography
      : (dna.pageFallbackTypography ?? []);

  // -------------------------------------------------------------------------
  // 1. Real Font Delivery & Typography Fidelity (30 pts)
  // -------------------------------------------------------------------------
  const typeMissing: string[] = [];
  let typeTotal = 0;
  let typeMatched = 0;

  if (effectiveTypography.length === 0) {
    // Strictly penalize unknown typography — never award 30/30 when no font was captured!
    typeTotal = 2;
    typeMatched = 1;
    typeMissing.push(
      'No webfont detected in selection or host page — rescan a page with live text to embed its real font'
    );
  } else {
    const headingToken =
      effectiveTypography.find((t) => t.role === 'display' || t.role === 'heading') ??
      effectiveTypography[0]!;
    const bodyToken =
      effectiveTypography.find((t) => t.role === 'body') ?? effectiveTypography[1] ?? headingToken;

    const headingClean = cleanFontName(headingToken.primaryFont);
    const headingCleanLower = headingClean.toLowerCase();
    const headingRawLower = headingToken.primaryFont.replace(/^["'\s]+|["'\s]+$/g, '').trim().toLowerCase();

    const bodyClean = cleanFontName(bodyToken.primaryFont);
    const bodyCleanLower = bodyClean.toLowerCase();
    const bodyRawLower = bodyToken.primaryFont.replace(/^["'\s]+|["'\s]+$/g, '').trim().toLowerCase();

    // 1A: Heading selector `.sl-spec-title` MUST exist in active CSS AND put captured heading font FIRST in stack!
    const headingRuleBody = getMergedRuleBody(
      activeRules,
      /(?:^|[\s,>])\.sl-spec-title(?=$|[\s,:{])/i
    );
    const headingFontDecl = getLastDeclarationValue(headingRuleBody, 'font-family');
    typeTotal += 2;
    if (
      headingRuleBody.length > 0 &&
      firstFontInStackMatches(headingFontDecl, headingCleanLower, headingRawLower)
    ) {
      typeMatched += 2;
    } else {
      typeMissing.push(
        `Preview heading (.sl-spec-title) is not leading with captured font "${headingClean}"`
      );
    }

    // 1B: If body font differs from heading font, `.sl-spec-card`/`.sl-spec-wrap`/`.sl-spec-copy` MUST lead with body font!
    if (bodyCleanLower && bodyCleanLower !== headingCleanLower) {
      const bodyRuleBody = getMergedRuleBody(
        activeRules,
        /(?:^|[\s,>])\.(?:sl-spec-card|sl-spec-copy|sl-spec-wrap)(?=$|[\s,:{])/i
      );
      const bodyFontDecl = getLastDeclarationValue(bodyRuleBody, 'font-family');
      typeTotal += 1;
      if (
        bodyRuleBody.length > 0 &&
        firstFontInStackMatches(bodyFontDecl, bodyCleanLower, bodyRawLower)
      ) {
        typeMatched += 1;
      } else {
        typeMissing.push(
          `Preview body (.sl-spec-card/.sl-spec-copy) is not leading with captured body font "${bodyClean}"`
        );
      }
    }

    // 1C: For every distinct non-system webfont (heading + body), REQUIRE a real CORS-safe loader in srcDoc!
    const distinctTargets: Array<{ clean: string; cleanLower: string; rawLower: string }> = [
      { clean: headingClean, cleanLower: headingCleanLower, rawLower: headingRawLower },
    ];
    if (bodyCleanLower && bodyCleanLower !== headingCleanLower) {
      distinctTargets.push({ clean: bodyClean, cleanLower: bodyCleanLower, rawLower: bodyRawLower });
    }

    for (const target of distinctTargets) {
      if (!target.cleanLower || SYSTEM_FONT_NAMES.has(target.cleanLower)) continue;
      typeTotal += 1;
      if (hasCorsSafeFontLoader(cleanDoc, target.cleanLower, target.rawLower)) {
        typeMatched += 1;
      } else {
        typeMissing.push(
          `No CORS-safe embedded @font-face or webfont <link> loaded in iframe for "${target.clean}"`
        );
      }
    }

    // 1D: Heading weight explicitly applied on `.sl-spec-title`
    const headingWeightDecl = getLastDeclarationValue(headingRuleBody, 'font-weight');
    typeTotal += 1;
    if (new RegExp(`\\b${headingToken.fontWeight}\\b`).test(headingWeightDecl)) {
      typeMatched += 1;
    } else {
      typeMissing.push(`Missing heading font-weight ${headingToken.fontWeight} on .sl-spec-title`);
    }
  }
  const typography = scoreDimension(typeMatched, typeTotal, 30, typeMissing);

  // -------------------------------------------------------------------------
  // 2. True Visual Polarity & Active Brand Accents (30 pts) — zero dot/dead-CSS gaming!
  // -------------------------------------------------------------------------
  const colorMissing: string[] = [];
  let colorTotal = 0;
  let colorMatched = 0;

  const preferVisual =
    record.captureMode === 'visual-only' ||
    Boolean(record.containsGraphicArtwork) ||
    dna.typography.length === 0;
  const sampledSorted = [...dna.palette]
    .filter((c) => c.provenance === 'sampled-pixels')
    .sort((a, b) => (b.visualSharePercent ?? 0) - (a.visualSharePercent ?? 0));

  let expectedPolarity: 'dark' | 'light' | 'mixed' = dna.polarity;
  if (preferVisual && sampledSorted[0]) {
    const parsedTop = parseCssColor(sampledSorted[0].hex);
    if (parsedTop) expectedPolarity = isDarkColor(parsedTop) ? 'dark' : 'light';
  }

  const wrapBlock = getMergedRuleBody(activeRules, /(?:^|[\s,>])\.sl-spec-wrap(?=$|[\s,:{])/i);
  const cardBlock = getMergedRuleBody(activeRules, /(?:^|[\s,>])\.sl-spec-card(?=$|[\s,:{])/i);
  const actualWrapBg = extractLastColorProp(wrapBlock, 'background(?:-color)?');
  const actualCardBg = extractLastColorProp(cardBlock, 'background(?:-color)?');

  if (expectedPolarity === 'dark' || expectedPolarity === 'light') {
    colorTotal += 2;
    const bgToCheck = actualWrapBg ?? actualCardBg;
    if (bgToCheck && (expectedPolarity === 'dark') === isDarkColor(bgToCheck)) {
      colorMatched += 2;
    } else {
      colorMissing.push(
        `Preview polarity mismatch: capture is ${expectedPolarity} but preview rendered ${bgToCheck ? (isDarkColor(bgToCheck) ? 'dark' : 'light') : 'unknown'} background`
      );
    }
  }

  // Only count colors used inside ACTIVE DOM-matched CSS declarations (NOT `.sl-dot`, `:root`, or dead rules!)
  const styleHexes = extractNormalizedColorsFromCode(activeComponentCss).hexes;

  const chromaticAccents = dna.palette
    .map((token) => {
      const rgba = parseCssColor(token.hex);
      if (!rgba) return null;
      const chroma = Math.max(rgba.r, rgba.g, rgba.b) - Math.min(rgba.r, rgba.g, rgba.b);
      return !isNeutralColor(rgba) && chroma >= 28 ? { token, rgba, chroma } : null;
    })
    .filter(
      (entry): entry is { token: CaptureRecord['dna']['palette'][number]; rgba: RgbaColor; chroma: number } =>
        entry !== null
    )
    .sort((a, b) => {
      const aBoost = a.token.role === 'accent' ? 40 : 0;
      const bBoost = b.token.role === 'accent' ? 40 : 0;
      return b.chroma + bBoost - (a.chroma + aBoost);
    });

  const primaryAccent = chromaticAccents[0];
  const secondaryAccent = primaryAccent
    ? chromaticAccents.find((c) => colorDistance(c.rgba, primaryAccent.rgba) >= 42)
    : undefined;

  if (primaryAccent) {
    colorTotal += 2;
    const hexUpper = primaryAccent.token.hex.toUpperCase();
    if (styleHexes.has(hexUpper)) {
      colorMatched += 2;
    } else {
      colorMissing.push(`Primary brand accent ${hexUpper} is not used in active preview CSS`);
    }
  }
  if (secondaryAccent) {
    colorTotal += 1;
    const hexUpper = secondaryAccent.token.hex.toUpperCase();
    const rgbaMatch = `rgba(${secondaryAccent.rgba.r}, ${secondaryAccent.rgba.g}, ${secondaryAccent.rgba.b}`;
    if (styleHexes.has(hexUpper) || normalizedActiveCss.includes(rgbaMatch)) {
      colorMatched += 1;
    } else {
      colorMissing.push(`Secondary brand accent ${hexUpper} is not used in active preview CSS`);
    }
  }

  const colors = scoreDimension(colorMatched, colorTotal, 30, colorMissing);

  // -------------------------------------------------------------------------
  // 3. Readable Contrast (Solid + Gradient Stops), Zero Blank Canvas & Layout (15 pts)
  // -------------------------------------------------------------------------
  const layoutMissing: string[] = [];
  let layoutTotal = 0;
  let layoutMatched = 0;

  const visiblePlainText = bodyOnlyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const hasVisibleContent = visiblePlainText.length >= 8;

  layoutTotal += 1;
  if (hasVisibleContent) layoutMatched += 1;
  else layoutMissing.push('Preview has no visible UI content (blank canvas)');

  // Card text contrast >= 4.5:1 (NEVER skipped if omitted; ALSO checks every opaque gradient stop in background OR background-image!)
  const cardTextRgba = extractLastColorProp(cardBlock, 'color');
  const cardBgImage = getLastDeclarationValue(cardBlock, 'background(?:-image)?');
  layoutTotal += 1;
  if (!actualCardBg || !cardTextRgba) {
    layoutMissing.push('Card missing explicit background or foreground color for WCAG contrast check');
  } else {
    const baseRatio = contrastRatio(cardTextRgba, actualCardBg);
    let worstRatio = baseRatio;
    if (cardBgImage && /gradient\(/i.test(cardBgImage)) {
      const stopTokens = cardBgImage.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}\b/g) ?? [];
      for (const st of stopTokens) {
        const parsedStop = parseCssColor(st);
        if (parsedStop && parsedStop.a >= 0.45) {
          worstRatio = Math.min(worstRatio, contrastRatio(cardTextRgba, parsedStop));
        }
      }
    }
    if (worstRatio >= 4.5) layoutMatched += 1;
    else layoutMissing.push(`Card text contrast too low (${worstRatio.toFixed(2)}:1 < 4.5:1 WCAG AA)`);
  }

  // Primary CTA contrast >= 4.5:1 (mandatory whenever a <button> exists in the rendered preview!)
  if (activeTags.has('button')) {
    const ctaBlock = getMergedRuleBody(activeRules, /(?:^|[\s,>])\.sl-cta(?=$|[\s,:{])/i);
    const ctaBg = extractLastColorProp(ctaBlock, 'background(?:-color)?');
    const ctaFg = extractLastColorProp(ctaBlock, 'color');
    layoutTotal += 1;
    if (!ctaBg || !ctaFg) {
      layoutMissing.push('CTA button missing explicit background or foreground color for WCAG contrast check');
    } else {
      const ratio = contrastRatio(ctaFg, ctaBg);
      if (ratio >= 4.5) layoutMatched += 1;
      else layoutMissing.push(`CTA button contrast too low (${ratio.toFixed(2)}:1 < 4.5:1 WCAG AA)`);
    }
  }

  // Responsive flex/grid layout present in active component CSS (not buildPreviewSrcDoc's html, body!)
  layoutTotal += 1;
  if (/display\s*:\s*(?:flex|grid)\b/i.test(activeComponentCss)) {
    layoutMatched += 1;
  } else {
    layoutMissing.push('Preview missing flex/grid layout structure in active component CSS');
  }

  const layout = scoreDimension(layoutMatched, layoutTotal, 15, layoutMissing);

  // -------------------------------------------------------------------------
  // 4. Surface Geometry & Flat-Surface Anti-Hallucination (15 pts)
  // -------------------------------------------------------------------------
  const surfaceMissing: string[] = [];
  let surfaceTotal = 0;
  let surfaceMatched = 0;
  const { surfaces } = dna;

  if (surfaces.borderRadii[0]) {
    surfaceTotal += 1;
    const px = extractSignificantPxToken(surfaces.borderRadii[0]);
    const radiiVals = extractPropertyValues(normalizedActiveCss, 'border-radius');
    if (radiiVals.includes(surfaces.borderRadii[0].toLowerCase()) || (px && radiiVals.includes(px))) {
      surfaceMatched += 1;
    } else {
      surfaceMissing.push(`Preview missed extracted border-radius (${surfaces.borderRadii[0]})`);
    }
  } else if (record.roots.length > 0 && !record.containsGraphicArtwork) {
    // Anti-hallucination: flat 0px-radius live DOM captures must not invent rounded card corners
    surfaceTotal += 1;
    const cardRadius = getLastDeclarationValue(cardBlock, 'border-radius');
    if (!cardRadius || /^0(?:px)?$/i.test(cardRadius)) {
      surfaceMatched += 1;
    } else {
      surfaceMissing.push(`Hallucinated rounded card border-radius (${cardRadius}) on a flat 0px capture`);
    }
  }

  if (surfaces.borders[0]) {
    surfaceTotal += 1;
    // Strictly reject `border: none` / `border: 0` as border evidence!
    if (hasVisibleBorderDeclaration(activeComponentCss)) surfaceMatched += 1;
    else surfaceMissing.push('Preview missed extracted visible border framing');
  }
  if (surfaces.shadows[0]) {
    surfaceTotal += 1;
    const shadowVals = extractPropertyValues(normalizedActiveCss, 'box-shadow');
    if (shadowVals.length > 0 && !/^(?:none|\s|\|)+$/.test(shadowVals)) surfaceMatched += 1;
    else surfaceMissing.push('Preview missed extracted box-shadow elevation');
  }
  if (surfaces.backdropFilters[0]) {
    surfaceTotal += 1;
    const bfVals = extractPropertyValues(normalizedActiveCss, '(?:-webkit-)?backdrop-filter');
    if (bfVals.includes('blur(')) surfaceMatched += 1;
    else surfaceMissing.push(`Preview missed extracted backdrop-filter (${surfaces.backdropFilters[0]})`);
  }
  if (surfaces.gradients[0]) {
    surfaceTotal += 1;
    const bgVals = extractPropertyValues(normalizedActiveCss, 'background(?:-image)?');
    if (/gradient\(/.test(bgVals)) surfaceMatched += 1;
    else surfaceMissing.push('Preview missed extracted CSS gradient');
  } else if (record.roots.length > 0 && !record.containsGraphicArtwork) {
    // Anti-hallucination: flat solid DOM captures must not invent glossy card gradients
    surfaceTotal += 1;
    if (!cardBgImage || !/gradient\(/i.test(cardBgImage)) {
      surfaceMatched += 1;
    } else {
      surfaceMissing.push('Hallucinated glossy gradient on a flat solid-color capture');
    }
  }
  if (surfaces.textShadows[0]) {
    surfaceTotal += 1;
    const tsVals = extractPropertyValues(normalizedActiveCss, 'text-shadow');
    if (tsVals.length > 0 && !/^(?:none|\s|\|)+$/.test(tsVals)) surfaceMatched += 1;
    else surfaceMissing.push('Preview missed extracted text-shadow');
  }

  const surfaceScore = scoreDimension(surfaceMatched, surfaceTotal, 15, surfaceMissing);

  // -------------------------------------------------------------------------
  // 5. Component Structure & Sandbox Safety (10 pts)
  // -------------------------------------------------------------------------
  const structMissing: string[] = [];
  const structTotal = 2;
  let structMatched = 0;

  if (/<(?:section|header|nav|article)\b/i.test(bodyOnlyHtml) && /<h[1-6]\b/i.test(bodyOnlyHtml)) {
    structMatched += 1;
  } else {
    structMissing.push('Preview missing semantic section/heading hierarchy');
  }

  if (!/<script\b/i.test(cleanDoc) && !/\son[a-z]+\s*=/i.test(cleanDoc)) {
    structMatched += 1;
  } else {
    structMissing.push('Unsafe script or inline event handler detected in preview');
  }

  const structure = scoreDimension(structMatched, structTotal, 10, structMissing);

  const rawTotal =
    typography.score + colors.score + layout.score + surfaceScore.score + structure.score;
  const clampedRaw = hasVisibleContent
    ? Math.max(0, Math.min(100, rawTotal))
    : Math.min(15, Math.max(0, rawTotal));
  const totalScore = Math.floor(clampedRaw);
  const passedThreshold = hasVisibleContent && clampedRaw >= FIDELITY_TARGET_PERCENT;

  const issues = [
    ...typography.missing,
    ...colors.missing,
    ...layout.missing,
    ...surfaceScore.missing,
    ...structure.missing,
  ];

  const verdict = passedThreshold
    ? `${totalScore}% Verified Live Font + Style Match (>= ${FIDELITY_TARGET_PERCENT}% target)`
    : `${totalScore}% Below ${FIDELITY_TARGET_PERCENT}% Target (${issues.length} gap${issues.length === 1 ? '' : 's'} — ${issues[0] ?? 'check fonts & colors'})`;

  return {
    totalScore,
    passedThreshold,
    isBakedVisualOnly,
    breakdown: {
      typography,
      colors,
      layout,
      surfaces: surfaceScore,
      structure,
    },
    issues,
    verdict,
  };
}
