import {
  colorDistance,
  contrastRatio,
  formatRgbString,
  isDarkColor,
  isNeutralColor,
  parseCssColor,
  rgbaToHex,
  type RgbaColor,
} from './color';
import type {
  ColorRole,
  ColorToken,
  ContrastCheck,
  DesignDNA,
  ExtractedNode,
  LayoutSummary,
  RawDomExtraction,
  SampledColor,
  StyleTrait,
  SurfaceSummary,
  TypographyRole,
  TypographyToken,
  ViewportRect,
} from '../types/capture';

function flattenNodes(roots: ExtractedNode[]): ExtractedNode[] {
  const result: ExtractedNode[] = [];
  const stack: ExtractedNode[] = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    result.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push(node.children[i]!);
    }
  }
  return result;
}

function parsePxValues(shorthand: string | undefined): number[] {
  if (!shorthand) return [];
  const matches = shorthand.match(/-?\d*\.?\d+px/g);
  if (!matches) return [];
  return matches
    .map((m) => Math.round(Number.parseFloat(m)))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 256);
}

function extractPrimaryFont(fontStack: string): string {
  const first = fontStack.split(',')[0] ?? fontStack;
  return first.replace(/^["'\s]+|["'\s]+$/g, '') || 'system-ui';
}

function isMonospaceFont(fontStack: string): boolean {
  return /mono|consolas|menlo|fira code|jetbrains|courier|sfmono/i.test(fontStack);
}

function classifyTypographyRole(
  fontSizePx: number,
  fontWeight: number,
  fontStack: string
): TypographyRole {
  if (isMonospaceFont(fontStack)) return 'mono';
  if (fontSizePx >= 30) return 'display';
  if (fontSizePx >= 18 || (fontSizePx >= 15 && fontWeight >= 600)) return 'heading';
  if (fontSizePx <= 12.5) return 'label';
  return 'body';
}

function extractBorderColor(borderShorthand: string | undefined): RgbaColor | null {
  if (!borderShorthand) return null;
  const rgbMatch = borderShorthand.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/i);
  if (!rgbMatch) return null;
  return parseCssColor(rgbMatch[0]);
}

function extractBorderWidthPx(borderShorthand: string | undefined): number {
  if (!borderShorthand) return 0;
  const match = borderShorthand.match(/^(\d*\.?\d+)px/);
  return match && match[1] ? Number.parseFloat(match[1]) : 0;
}

function inferSpacingGridBase(values: number[]): 4 | 8 | null {
  const meaningful = values.filter((v) => v >= 4 && v <= 96);
  if (meaningful.length < 2) return null;
  const div8 = meaningful.filter((v) => v % 8 === 0).length / meaningful.length;
  if (div8 >= 0.7) return 8;
  const div4 = meaningful.filter((v) => v % 4 === 0).length / meaningful.length;
  if (div4 >= 0.7) return 4;
  return null;
}

function dedupeRanked(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const val of values) {
    const trimmed = val.trim();
    if (!trimmed) continue;
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([v]) => v);
}

interface ColorAccumulator {
  rgba: RgbaColor;
  hex: string;
  roles: Map<ColorRole, number>;
  usageCount: number;
  maxArea: number;
}

function buildPalette(
  nodes: ExtractedNode[],
  sampledColors: SampledColor[],
  preferVisualPalette = false
): { palette: ColorToken[]; polarity: 'dark' | 'light' | 'mixed' } {
  const map = new Map<string, ColorAccumulator>();

  const recordColor = (rgba: RgbaColor, role: ColorRole, area = 0) => {
    if (rgba.a <= 0.02) return;
    const hex = rgbaToHex(rgba, false);
    const key = `${hex}:${Math.round(rgba.a * 20)}`;
    const existing = map.get(key);
    if (existing) {
      existing.usageCount += 1;
      existing.maxArea = Math.max(existing.maxArea, area);
      existing.roles.set(role, (existing.roles.get(role) ?? 0) + 1);
    } else {
      const roles = new Map<ColorRole, number>([[role, 1]]);
      map.set(key, {
        rgba,
        hex,
        roles,
        usageCount: 1,
        maxArea: area,
      });
    }
  };

  let largestBgColor: RgbaColor | null = null;
  let largestBgArea = -1;

  for (const node of nodes) {
    const area = node.rect.width * node.rect.height;

    const bg = parseCssColor(node.styles.backgroundColor);
    if (bg && bg.a > 0.02) {
      const role: ColorRole = !isNeutralColor(bg) && area < 45000 ? 'accent' : 'surface';
      recordColor(bg, role, area);
      if (area > largestBgArea && bg.a >= 0.4) {
        largestBgArea = area;
        largestBgColor = bg;
      }
    }

    if (node.textSnippet || (node.tag === 'svg' && /currentcolor/i.test(node.svgMarkup ?? ''))) {
      const fg = parseCssColor(node.styles.color);
      if (fg && fg.a > 0.05) {
        recordColor(fg, 'text', 0);
      }
    }

    if (node.svgColors && node.svgColors.length > 0) {
      for (const svgHex of node.svgColors) {
        const parsedSvg = parseCssColor(svgHex);
        if (parsedSvg && parsedSvg.a > 0.05) {
          recordColor(parsedSvg, isNeutralColor(parsedSvg) ? 'text' : 'accent', area * 0.25);
        }
      }
    }

    const borderSources = [
      node.styles.border,
      node.styles.borderTop,
      node.styles.borderRight,
      node.styles.borderBottom,
      node.styles.borderLeft,
    ];
    const seenNodeBorders = new Set<string>();
    for (const rawB of borderSources) {
      if (!rawB || seenNodeBorders.has(rawB)) continue;
      seenNodeBorders.add(rawB);
      const borderColor = extractBorderColor(rawB);
      if (borderColor && borderColor.a > 0.02) {
        recordColor(borderColor, 'border', 0);
      }
    }

    for (const pseudo of node.pseudoElements) {
      const pBg = parseCssColor(pseudo.backgroundColor);
      if (pBg && pBg.a > 0.05) {
        recordColor(pBg, isNeutralColor(pBg) ? 'surface' : 'accent', area * 0.5);
      }
    }
  }

  // If no element had an explicit opaque background (and not baked artwork with sampled pixels),
  // record root effective background
  if (!largestBgColor && nodes[0]?.effectiveBackgroundHex && !(preferVisualPalette && sampledColors.length > 0)) {
    const eff = parseCssColor(nodes[0].effectiveBackgroundHex);
    if (eff) {
      largestBgColor = eff;
      recordColor(eff, 'background', nodes[0].rect.width * nodes[0].rect.height);
    }
  }

  const exactTokens: ColorToken[] = Array.from(map.values())
    .map((entry) => {
      const sortedRoles = Array.from(entry.roles.entries()).sort((a, b) => b[1] - a[1]);
      let primaryRole: ColorRole = sortedRoles[0]?.[0] ?? 'surface';
      if (
        largestBgColor &&
        entry.hex === rgbaToHex(largestBgColor) &&
        entry.maxArea >= largestBgArea * 0.8 &&
        primaryRole === 'surface'
      ) {
        primaryRole = 'background';
      }
      return {
        hex: entry.hex,
        rgbString: formatRgbString(entry.rgba),
        role: primaryRole,
        usageCount: entry.usageCount,
        provenance: 'exact-dom' as const,
        alpha: Number(entry.rgba.a.toFixed(2)),
      };
    })
    .sort((a, b) => {
      const roleOrder: Record<ColorRole, number> = {
        background: 0,
        surface: 1,
        accent: 2,
        text: 3,
        border: 4,
        sampled: 5,
      };
      if (roleOrder[a.role] !== roleOrder[b.role]) {
        return roleOrder[a.role] - roleOrder[b.role];
      }
      return b.usageCount - a.usageCount;
    })
    .slice(0, 14);

  // Merge pixel-sampled colors that aren't already closely represented by exact DOM colors
  const exactRgbs = exactTokens
    .map((t) => parseCssColor(t.hex))
    .filter((c): c is RgbaColor => c !== null);

  const sampledTokens: ColorToken[] = [];
  for (const sample of sampledColors) {
    const sampleRgb: RgbaColor = {
      r: sample.rgb[0],
      g: sample.rgb[1],
      b: sample.rgb[2],
      a: 1,
    };
    const isDuplicateOfExact = exactRgbs.some((exact) => colorDistance(exact, sampleRgb) < 26);
    if (!isDuplicateOfExact || exactTokens.length === 0) {
      sampledTokens.push({
        hex: sample.hex,
        rgbString: formatRgbString(sampleRgb),
        role: 'sampled',
        usageCount: 1,
        provenance: 'sampled-pixels',
        alpha: 1,
        visualSharePercent: sample.percentage,
      });
    }
    if (sampledTokens.length >= 6) break;
  }

  const palette = [...exactTokens, ...sampledTokens];

  // Determine overall dark/light polarity (for baked artwork/media, trust the actual visible pixels first!)
  let polarity: 'dark' | 'light' | 'mixed' = 'mixed';
  if (preferVisualPalette && sampledColors[0]) {
    const topSample = sampledColors[0];
    polarity = isDarkColor({ r: topSample.rgb[0], g: topSample.rgb[1], b: topSample.rgb[2] })
      ? 'dark'
      : 'light';
  } else if (largestBgColor) {
    polarity = isDarkColor(largestBgColor) ? 'dark' : 'light';
  } else if (sampledColors[0]) {
    const topSample = sampledColors[0];
    polarity = isDarkColor({ r: topSample.rgb[0], g: topSample.rgb[1], b: topSample.rgb[2] })
      ? 'dark'
      : 'light';
  }

  return { palette, polarity };
}

function buildTypography(nodes: ExtractedNode[]): TypographyToken[] {
  const buckets = new Map<string, TypographyToken>();

  for (const node of nodes) {
    if (!node.textSnippet || !node.styles.fontFamily || !node.styles.fontSize) continue;
    const fontSizePx = Number(Number.parseFloat(node.styles.fontSize).toFixed(1));
    if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) continue;

    const fontWeight = Number.parseInt(node.styles.fontWeight ?? '400', 10) || 400;
    const primaryFont = extractPrimaryFont(node.styles.fontFamily);

    let lineHeightPx: number | null = null;
    if (node.styles.lineHeight && node.styles.lineHeight.endsWith('px')) {
      const parsed = Number.parseFloat(node.styles.lineHeight);
      if (Number.isFinite(parsed)) lineHeightPx = Number(parsed.toFixed(1));
    }
    const lineHeightRatio =
      lineHeightPx !== null ? Number((lineHeightPx / fontSizePx).toFixed(2)) : null;

    const letterSpacing = node.styles.letterSpacing ?? 'normal';
    const key = `${primaryFont}|${fontSizePx}|${fontWeight}`;

    const existing = buckets.get(key);
    if (existing) {
      existing.usageCount += 1;
    } else {
      buckets.set(key, {
        primaryFont,
        fontStack: node.styles.fontFamily,
        fontSizePx,
        fontWeight,
        lineHeightPx,
        lineHeightRatio,
        letterSpacing,
        role: classifyTypographyRole(fontSizePx, fontWeight, node.styles.fontFamily),
        sampleText: node.textSnippet.slice(0, 48),
        usageCount: 1,
      });
    }
  }

  const roleRank: Record<TypographyRole, number> = {
    display: 0,
    heading: 1,
    body: 2,
    label: 3,
    mono: 4,
  };

  return Array.from(buckets.values())
    .sort((a, b) => {
      if (roleRank[a.role] !== roleRank[b.role]) return roleRank[a.role] - roleRank[b.role];
      return b.fontSizePx - a.fontSizePx;
    })
    .slice(0, 10);
}

function buildContrastChecks(nodes: ExtractedNode[]): ContrastCheck[] {
  const seen = new Set<string>();
  const checks: ContrastCheck[] = [];

  for (const node of nodes) {
    if (!node.textSnippet || !node.styles.color || !node.effectiveBackgroundHex) continue;
    const fg = parseCssColor(node.styles.color);
    const bg = parseCssColor(node.effectiveBackgroundHex);
    if (!fg || !bg) continue;

    const fgHex = rgbaToHex(fg);
    const bgHex = rgbaToHex(bg);
    const pairKey = `${fgHex}->${bgHex}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    const fontSizePx = Number.parseFloat(node.styles.fontSize ?? '14') || 14;
    const fontWeight = Number.parseInt(node.styles.fontWeight ?? '400', 10) || 400;
    const ratio = contrastRatio(fg, bg);

    // WCAG 2.1 large text: >= 18.66px bold (700+) OR >= 24px regular
    const isLargeText = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
    const aaLarge = ratio >= 3.0;
    const aaNormal = isLargeText ? aaLarge : ratio >= 4.5;
    const aaaNormal = isLargeText ? ratio >= 4.5 : ratio >= 7.0;

    checks.push({
      foregroundHex: fgHex,
      backgroundHex: bgHex,
      ratio,
      aaNormal,
      aaLarge,
      aaaNormal,
      fontSizePx: Number(fontSizePx.toFixed(1)),
      fontWeight,
      sampleText: node.textSnippet.slice(0, 40),
      isEstimated: node.hasNonSolidBackgroundAncestor || fg.a < 0.99,
    });

    if (checks.length >= 8) break;
  }

  return checks.sort((a, b) => a.ratio - b.ratio);
}

function buildLayoutSummary(
  nodes: ExtractedNode[],
  rect: ViewportRect,
  isVisualOnly: boolean
): LayoutSummary {
  if (isVisualOnly || nodes.length === 0) {
    return {
      primaryModel: 'visual-only',
      flexCount: 0,
      gridCount: 0,
      flexDirections: [],
      gridTemplates: [],
      gapValuesPx: [],
      paddingValuesPx: [],
      spacingScalePx: [],
      spacingGridBase: null,
      dimensionsPx: { width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  }

  let flexCount = 0;
  let gridCount = 0;
  const flexDirections: string[] = [];
  const gridTemplates: string[] = [];
  const gaps: number[] = [];
  const paddings: number[] = [];

  for (const node of nodes) {
    const d = node.styles.display;
    if (d === 'flex' || d === 'inline-flex') {
      flexCount += 1;
      if (node.styles.flexDirection) flexDirections.push(node.styles.flexDirection);
    }
    if (d === 'grid' || d === 'inline-grid') {
      gridCount += 1;
      if (node.styles.gridTemplateColumns) gridTemplates.push(node.styles.gridTemplateColumns);
    }
    gaps.push(...parsePxValues(node.styles.gap));
    paddings.push(...parsePxValues(node.styles.padding));
  }

  const uniqueGaps = Array.from(new Set(gaps)).sort((a, b) => a - b);
  const uniquePaddings = Array.from(new Set(paddings)).sort((a, b) => a - b);
  const spacingScalePx = Array.from(new Set([...uniqueGaps, ...uniquePaddings])).sort((a, b) => a - b);

  let primaryModel: LayoutSummary['primaryModel'] = 'block';
  if (flexCount > 0 && gridCount > 0) primaryModel = 'mixed';
  else if (gridCount > 0) primaryModel = 'grid';
  else if (flexCount > 0) primaryModel = 'flex';

  return {
    primaryModel,
    flexCount,
    gridCount,
    flexDirections: dedupeRanked(flexDirections, 4),
    gridTemplates: dedupeRanked(gridTemplates, 4),
    gapValuesPx: uniqueGaps.slice(0, 8),
    paddingValuesPx: uniquePaddings.slice(0, 8),
    spacingScalePx: spacingScalePx.slice(0, 12),
    spacingGridBase: inferSpacingGridBase([...gaps, ...paddings]),
    dimensionsPx: { width: Math.round(rect.width), height: Math.round(rect.height) },
  };
}

function buildSurfaceSummary(nodes: ExtractedNode[]): SurfaceSummary {
  const radii: string[] = [];
  const borders: string[] = [];
  const shadows: string[] = [];
  const textShadows: string[] = [];
  const transforms: string[] = [];
  const clipPaths: string[] = [];
  const gradients: string[] = [];
  const backdropFilters: string[] = [];

  for (const node of nodes) {
    if (node.styles.borderRadius) radii.push(node.styles.borderRadius);
    if (node.styles.border) {
      borders.push(node.styles.border);
    } else {
      for (const side of [
        node.styles.borderTop,
        node.styles.borderRight,
        node.styles.borderBottom,
        node.styles.borderLeft,
      ]) {
        if (side) borders.push(side);
      }
    }
    if (node.styles.boxShadow) shadows.push(node.styles.boxShadow);
    if (node.styles.textShadow) textShadows.push(node.styles.textShadow);
    if (node.styles.transform) transforms.push(node.styles.transform);
    if (node.styles.clipPath) clipPaths.push(node.styles.clipPath);
    if (node.styles.backgroundImage && /gradient\(/i.test(node.styles.backgroundImage)) {
      gradients.push(node.styles.backgroundImage);
    }
    if (node.styles.backdropFilter) backdropFilters.push(node.styles.backdropFilter);

    for (const pseudo of node.pseudoElements) {
      if (pseudo.borderRadius) radii.push(pseudo.borderRadius);
      if (pseudo.border) borders.push(pseudo.border);
      if (pseudo.boxShadow) shadows.push(pseudo.boxShadow);
      if (pseudo.backgroundImage && /gradient\(/i.test(pseudo.backgroundImage)) {
        gradients.push(pseudo.backgroundImage);
      }
      if (pseudo.backdropFilter) backdropFilters.push(pseudo.backdropFilter);
    }
  }

  return {
    borderRadii: dedupeRanked(radii, 6),
    borders: dedupeRanked(borders, 6),
    shadows: dedupeRanked(shadows, 5),
    textShadows: dedupeRanked(textShadows, 4),
    transforms: dedupeRanked(transforms, 4),
    clipPaths: dedupeRanked(clipPaths, 4),
    gradients: dedupeRanked(gradients, 4),
    backdropFilters: dedupeRanked(backdropFilters, 4),
  };
}

function detectStyleTraits(
  polarity: DesignDNA['polarity'],
  palette: ColorToken[],
  typography: TypographyToken[],
  layout: LayoutSummary,
  surfaces: SurfaceSummary
): StyleTrait[] {
  const traits: StyleTrait[] = [];

  // 1. Polarity
  if (polarity === 'dark') {
    traits.push({
      id: 'dark-polarity',
      label: 'Dark Surface Polarity',
      confidence: 'high',
      evidence: 'Dominant background luminance < 0.18',
    });
  } else if (polarity === 'light') {
    traits.push({
      id: 'light-polarity',
      label: 'Light Surface Polarity',
      confidence: 'high',
      evidence: 'Dominant background luminance >= 0.18',
    });
  }

  // 2. Glassmorphism
  const hasBlur = surfaces.backdropFilters.some((f) => /blur\(/i.test(f));
  const hasTranslucentSurface = palette.some(
    (c) => (c.role === 'surface' || c.role === 'background') && c.alpha > 0.05 && c.alpha < 0.92
  );
  if (hasBlur) {
    traits.push({
      id: 'glassmorphism',
      label: 'Glassmorphism / Frosted Layer',
      confidence: hasTranslucentSurface ? 'high' : 'medium',
      evidence: `Uses ${surfaces.backdropFilters[0]}${hasTranslucentSurface ? ' with translucent surface alpha' : ''}`,
    });
  }

  // 3. Hairline borders vs Brutalist thick borders
  const borderWidths = surfaces.borders.map(extractBorderWidthPx).filter((w) => w > 0);
  if (borderWidths.some((w) => w <= 1.25)) {
    traits.push({
      id: 'hairline-borders',
      label: 'Crisp Hairline Framing',
      confidence: 'high',
      evidence: `1px borders (${surfaces.borders[0]})`,
    });
  }
  const hasHardOffsetShadow = surfaces.shadows.some((s) =>
    /(?:^|,)\s*-?\d+px\s+-?\d+px\s+0px/i.test(s)
  );
  if (hasHardOffsetShadow || borderWidths.some((w) => w >= 2.5)) {
    traits.push({
      id: 'brutalist-geometry',
      label: 'Neo-Brutalist / Hard Edge',
      confidence: hasHardOffsetShadow ? 'high' : 'medium',
      evidence: hasHardOffsetShadow ? 'Zero-blur offset shadow detected' : 'Heavy >= 2.5px border framing',
    });
  } else if (surfaces.shadows.length > 0) {
    traits.push({
      id: 'soft-elevation',
      label: 'Soft Diffused Elevation',
      confidence: 'high',
      evidence: `${surfaces.shadows.length} shadow layer(s) detected`,
    });
  }

  // 4. Pill / Rounded geometry
  if (surfaces.borderRadii.some((r) => /999\d*px|50%/i.test(r))) {
    traits.push({
      id: 'pill-geometry',
      label: 'Pill / Capsule Controls',
      confidence: 'high',
      evidence: 'Full-radius (9999px / 50%) radii detected',
    });
  } else if (surfaces.borderRadii.some((r) => {
    const px = Number.parseFloat(r);
    return Number.isFinite(px) && px >= 12;
  })) {
    traits.push({
      id: 'soft-corners',
      label: 'Generous Corner Rounding',
      confidence: 'medium',
      evidence: `Radii include ${surfaces.borderRadii[0]}`,
    });
  }

  // 5. Gradient surfaces
  if (surfaces.gradients.length > 0) {
    traits.push({
      id: 'gradient-surface',
      label: 'Gradient Surface Treatment',
      confidence: 'high',
      evidence: `${surfaces.gradients.length} CSS gradient declaration(s)`,
    });
  }

  // 6. Technical monospace accents
  const hasMono = typography.some((t) => t.role === 'mono');
  const hasSans = typography.some((t) => t.role !== 'mono');
  if (hasMono && hasSans) {
    traits.push({
      id: 'mono-tech-accents',
      label: 'Editorial / Technical Mono Pairing',
      confidence: 'high',
      evidence: 'Mixes sans-serif typography with monospace metadata accents',
    });
  }

  // 7. Rhythm discipline
  if (layout.spacingGridBase) {
    traits.push({
      id: `grid-${layout.spacingGridBase}px`,
      label: `${layout.spacingGridBase}px Spacing Rhythm`,
      confidence: 'medium',
      evidence: `>=70% of measured gaps/paddings align to ${layout.spacingGridBase}px increments`,
    });
  }

  return traits;
}

export function analyzeDesignDNA(
  dom: RawDomExtraction,
  sampledColors: SampledColor[],
  rect: ViewportRect
): DesignDNA {
  const nodes = flattenNodes(dom.roots);
  const preferVisualPalette =
    dom.captureMode === 'visual-only' || Boolean(dom.containsGraphicArtwork);
  const { palette, polarity } = buildPalette(nodes, sampledColors, preferVisualPalette);
  const typography = buildTypography(nodes);
  const contrastChecks = buildContrastChecks(nodes);
  const layout = buildLayoutSummary(nodes, rect, dom.captureMode === 'visual-only');
  const surfaces = buildSurfaceSummary(nodes);
  const traits = detectStyleTraits(polarity, palette, typography, layout, surfaces);

  const pageFallbackTypography = dom.pageFallbackTypography ?? [];
  const effectiveTypography = preferVisualPalette
    ? typography.length > 1
      ? typography
      : []
    : typography.length > 0
      ? typography
      : pageFallbackTypography;
  const primaryFonts = Array.from(new Set(effectiveTypography.map((t) => t.primaryFont))).slice(0, 2);
  const traitLabels = traits.slice(0, 3).map((t) => t.label);
  const modeNote =
    dom.captureMode === 'visual-only'
      ? 'Visual-only pixel capture'
      : `${layout.primaryModel.toUpperCase()} layout (${dom.totalNodesScanned} nodes)`;

  const parts = [
    `${polarity.charAt(0).toUpperCase() + polarity.slice(1)} UI`,
    modeNote,
    primaryFonts.length > 0 ? `Typography: ${primaryFonts.join(' + ')}` : null,
    traitLabels.length > 0 ? `Traits: ${traitLabels.join(', ')}` : null,
  ].filter(Boolean);

  return {
    polarity,
    palette,
    typography,
    contrastChecks,
    layout,
    surfaces,
    traits,
    cssVariables: dom.cssVariables,
    fontStylesheetUrls: dom.fontStylesheetUrls ?? [],
    fontFaceRules: dom.fontFaceRules ?? [],
    pageFallbackTypography,
    summaryText: parts.join(' · '),
  };
}
