import type { CaptureRecord, ColorToken, ExtractedNode } from '../types/capture';
import {
  isArtworkOrPhotoLikeCapture,
  shouldSuppressHostFallbackFont,
} from './captureClassification';
import { contrastRatio, isNeutralColor, parseCssColor, rgbaToHex } from './color';
import { formatBlueprintForPrompt, generateFaithfulSnapshot } from './faithfulSnapshot';

const PURE_WHITE_RGB = { r: 255, g: 255, b: 255, a: 1 } as const;
const PURE_BLACK_RGB = { r: 0, g: 0, b: 0, a: 1 } as const;

function isArtworkOrPhotoCapture(record: CaptureRecord): boolean {
  return isArtworkOrPhotoLikeCapture(record);
}

function getSampledPalette(record: CaptureRecord): ColorToken[] {
  return [...record.dna.palette]
    .filter((c) => c.provenance === 'sampled-pixels')
    .sort((a, b) => (b.visualSharePercent ?? 0) - (a.visualSharePercent ?? 0));
}

function getEffectivePaletteForPrompt(record: CaptureRecord): ColorToken[] {
  if (isArtworkOrPhotoCapture(record)) {
    const sampled = getSampledPalette(record);
    if (sampled.length > 0) return sampled;
  }
  return record.dna.palette;
}

/**
 * On photographic/artwork captures (e.g. a product image inside Google Images or an e-commerce tile),
 * a single stray captured text node (<= 1 typography bucket, e.g. a "Google Sans" overlay badge)
 * is host webpage chrome rather than the artwork's baked lettering.
 */
function getEffectiveTypographyForPrompt(record: CaptureRecord) {
  const { dna } = record;
  if (shouldSuppressHostFallbackFont(record)) {
    return [];
  }
  if (isArtworkOrPhotoCapture(record) && dna.typography.length <= 1) {
    return [];
  }
  return dna.typography;
}

function resolveRootBackdropHex(record: CaptureRecord): string {
  const { dna } = record;
  // On photographic/artwork captures (e.g. a white-backdrop product image inside Google Images dark mode),
  // ALWAYS trust the cropped image's dominant sampled-pixels color BEFORE any host exact-dom container color!
  if (isArtworkOrPhotoCapture(record)) {
    const dominantSampled = getSampledPalette(record)[0];
    return (
      dominantSampled?.hex ??
      dna.palette[0]?.hex ??
      record.roots[0]?.effectiveBackgroundHex ??
      (dna.polarity === 'light' ? '#FFFFFF' : '#000000')
    );
  }
  return (
    record.roots[0]?.effectiveBackgroundHex ??
    dna.palette.find((c) => c.role === 'background')?.hex ??
    dna.palette.find((c) => c.role === 'surface')?.hex ??
    dna.palette[0]?.hex ??
    (dna.polarity === 'light' ? '#FFFFFF' : '#000000')
  );
}

function resolvePrimaryTextFillHex(record: CaptureRecord, rootBackdropHex: string): string {
  const { dna } = record;
  const isArtwork = isArtworkOrPhotoCapture(record);
  const preferredPalette = getEffectivePaletteForPrompt(record);

  if (!isArtwork) {
    const exactText = dna.palette.find((c) => c.role === 'text')?.hex;
    if (exactText) return exactText;
  }

  // Pick the palette token with highest visual contrast against the resolved backdrop
  // (on photographic/artwork captures, search sampled pixels BEFORE any host exact-dom container colors!)
  const backdropRgb = parseCssColor(rootBackdropHex);
  const searchPools = isArtwork ? [preferredPalette, dna.palette] : [dna.palette];
  if (backdropRgb) {
    for (const pool of searchPools) {
      if (pool.length === 0) continue;
      let bestHex: string | null = null;
      let bestContrast = 0;
      for (const token of pool) {
        if (token.hex.toUpperCase() === rootBackdropHex.toUpperCase()) continue;
        const rgb = parseCssColor(token.hex);
        if (!rgb) continue;
        const ratio = contrastRatio(rgb, backdropRgb);
        if (ratio > bestContrast) {
          bestContrast = ratio;
          bestHex = token.hex;
        }
      }
      if (bestHex && bestContrast >= 2.2) return bestHex;
    }
  }

  return (
    preferredPalette.find((c) => c.role === 'accent')?.hex ??
    dna.palette.find((c) => c.role === 'accent')?.hex ??
    (dna.polarity === 'light' ? '#18181B' : '#FFFFFF')
  );
}

function resolveHighContrastFlatBackdrop(
  textFillHex: string,
  polarity: CaptureRecord['dna']['polarity']
): { hex: '#FFFFFF' | '#000000'; label: string } {
  const parsed = parseCssColor(textFillHex);
  const useWhite = parsed
    ? contrastRatio(parsed, PURE_WHITE_RGB) >= contrastRatio(parsed, PURE_BLACK_RGB)
    : polarity === 'light';
  return useWhite
    ? { hex: '#FFFFFF', label: '#FFFFFF (pure solid white)' }
    : { hex: '#000000', label: '#000000 (pure solid black)' };
}

export function collectCapturedTextSnippets(record: CaptureRecord): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    const clean = raw?.replace(/[`\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length > 48) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };
  for (const t of record.dna.typography) {
    push(t.sampleText);
    if (out.length >= 6) return out;
  }
  const walk = (nodes: ExtractedNode[]) => {
    for (const node of nodes) {
      if (out.length >= 6) return;
      push(node.textSnippet);
      if (node.children.length > 0) walk(node.children);
    }
  };
  walk(record.roots);
  return out;
}

export type RemixTargetStack = 'react-tailwind' | 'html-css' | 'vue-tailwind';

function slugifyToken(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'token'
  );
}

function groupColorsByRole(palette: ColorToken[]): Record<string, ColorToken[]> {
  const groups: Record<string, ColorToken[]> = {};
  for (const token of palette) {
    const list = groups[token.role] ?? [];
    list.push(token);
    groups[token.role] = list;
  }
  return groups;
}

function formatCssFontStack(primaryFont: string, fontStack: string): string {
  const raw = primaryFont.replace(/^["'\s]+|["'\s]+$/g, '').trim();
  const cleaned = raw
    .replace(/^__/, '')
    .replace(/_[a-f0-9]{5,}$/i, '')
    .replace(/_/g, ' ')
    .trim();
  if (cleaned && cleaned.toLowerCase() !== raw.toLowerCase()) {
    return `"${cleaned}", ${fontStack}`;
  }
  return fontStack;
}

/**
 * Generates clean, copy-ready CSS Custom Properties (:root) with provenance annotations.
 */
export function generateCssTokens(
  record: CaptureRecord,
  includeFallbackFonts = !shouldSuppressHostFallbackFont(record)
): string {
  const { dna, page } = record;
  const lines: string[] = [
    `/* StyleLens Design Tokens — captured from ${page.hostname} */`,
    `/* Polarity: ${dna.polarity} | Mode: ${record.captureMode} */`,
    ':root {',
  ];

  const effectivePalette = !includeFallbackFonts
    ? getEffectivePaletteForPrompt(record)
    : dna.palette;
  const roleCounters: Record<string, number> = {};
  for (const token of effectivePalette.slice(0, 12)) {
    const count = (roleCounters[token.role] ?? 0) + 1;
    roleCounters[token.role] = count;
    const suffix = count === 1 ? '' : `-${count}`;
    const value = token.alpha < 0.99 ? token.rgbString : token.hex;
    const provenanceTag =
      token.provenance === 'exact-dom'
        ? 'exact DOM'
        : `sampled pixels (~${token.visualSharePercent ?? 0}%)`;
    lines.push(`  --sl-color-${token.role}${suffix}: ${value}; /* ${provenanceTag} */`);
  }

  const baseTypography = !includeFallbackFonts
    ? getEffectiveTypographyForPrompt(record)
    : dna.typography;
  const effectiveTypography =
    baseTypography.length > 0
      ? baseTypography
      : includeFallbackFonts
        ? (dna.pageFallbackTypography ?? [])
        : [];
  const primarySans = effectiveTypography.find((t) => t.role !== 'mono');
  const primaryMono = effectiveTypography.find((t) => t.role === 'mono');
  if (primarySans) {
    lines.push(`  --sl-font-sans: ${formatCssFontStack(primarySans.primaryFont, primarySans.fontStack)};`);
  }
  if (primaryMono) {
    lines.push(`  --sl-font-mono: ${formatCssFontStack(primaryMono.primaryFont, primaryMono.fontStack)};`);
  }

  dna.surfaces.borderRadii.slice(0, 3).forEach((radius, idx) => {
    lines.push(`  --sl-radius-${idx + 1}: ${radius};`);
  });

  dna.surfaces.shadows.slice(0, 2).forEach((shadow, idx) => {
    lines.push(`  --sl-shadow-${idx + 1}: ${shadow};`);
  });

  dna.surfaces.backdropFilters.slice(0, 2).forEach((filter, idx) => {
    lines.push(`  --sl-backdrop-${idx + 1}: ${filter};`);
  });

  if (dna.layout.spacingGridBase) {
    lines.push(`  --sl-space-unit: ${dna.layout.spacingGridBase}px;`);
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * Generates Tailwind CSS v4 @theme block for instant drop-in adoption.
 */
export function generateTailwindTheme(record: CaptureRecord): string {
  const { dna, page } = record;
  const lines: string[] = [
    `/* Tailwind v4 @theme tokens extracted by StyleLens (${page.hostname}) */`,
    '@theme {',
  ];

  const roleCounters: Record<string, number> = {};
  for (const token of dna.palette.slice(0, 10)) {
    const count = (roleCounters[token.role] ?? 0) + 1;
    roleCounters[token.role] = count;
    const name = count === 1 ? token.role : `${token.role}-${count}`;
    lines.push(
      `  --color-sl-${slugifyToken(name)}: ${token.alpha < 0.99 ? token.rgbString : token.hex};`
    );
  }

  const effectiveTypography =
    dna.typography.length > 0 ? dna.typography : (dna.pageFallbackTypography ?? []);
  const primarySans = effectiveTypography.find((t) => t.role !== 'mono');
  if (primarySans) {
    lines.push(`  --font-sl-sans: ${primarySans.fontStack};`);
  }
  const primaryMono = effectiveTypography.find((t) => t.role === 'mono');
  if (primaryMono) {
    lines.push(`  --font-sl-mono: ${primaryMono.fontStack};`);
  }

  dna.surfaces.borderRadii.slice(0, 3).forEach((radius, idx) => {
    lines.push(`  --radius-sl-${idx + 1}: ${radius};`);
  });

  dna.surfaces.shadows.slice(0, 2).forEach((shadow, idx) => {
    lines.push(`  --shadow-sl-${idx + 1}: ${shadow};`);
  });

  lines.push('}');
  return lines.join('\n');
}

/**
 * Renders a cleaned structural HTML skeleton (strips noisy hashes & site copy bloat).
 */
export function generateSimplifiedHtml(roots: ExtractedNode[], maxDepth = 4): string {
  if (roots.length === 0) {
    return '<!-- Visual-only capture: no DOM hierarchy available -->';
  }

  const renderNode = (node: ExtractedNode, depth: number): string => {
    const indent = '  '.repeat(depth);
    const attrs: string[] = [];

    if (node.cleanClasses.length > 0) {
      attrs.push(`class="${node.cleanClasses.slice(0, 4).join(' ')}"`);
    }
    if (node.role) {
      attrs.push(`role="${node.role}"`);
    }

    const layoutHints: string[] = [];
    if (node.styles.display === 'flex' || node.styles.display === 'inline-flex') {
      layoutHints.push(`flex:${node.styles.flexDirection ?? 'row'}`);
    } else if (node.styles.display === 'grid' || node.styles.display === 'inline-grid') {
      layoutHints.push('grid');
    }
    if (node.styles.gap) layoutHints.push(`gap:${node.styles.gap}`);
    if (layoutHints.length > 0) {
      attrs.push(`data-layout="${layoutHints.join(' ')}"`);
    }

    const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
    const hasChildren = node.children.length > 0 && depth < maxDepth;

    if (!hasChildren) {
      const text = node.textSnippet ? node.textSnippet.slice(0, 42) : '';
      return `${indent}<${node.tag}${attrStr}>${text}</${node.tag}>`;
    }

    const innerLines = node.children.slice(0, 12).map((child) => renderNode(child, depth + 1));
    if (node.textSnippet) {
      innerLines.unshift(`${indent}  ${node.textSnippet.slice(0, 42)}`);
    }
    return `${indent}<${node.tag}${attrStr}>\n${innerLines.join('\n')}\n${indent}</${node.tag}>`;
  };

  return roots.map((root) => renderNode(root, 0)).join('\n');
}

/**
 * Generates a structured JSON Design Specification suitable for tooling & version control.
 */
export function generateDesignSpecJson(record: CaptureRecord): string {
  const spec = {
    schemaVersion: '1.0.0',
    generator: 'StyleLens',
    source: {
      hostname: record.page.hostname,
      capturedAt: new Date(record.createdAt).toISOString(),
      captureMode: record.captureMode,
      selectionMethod: record.selectionMethod,
      dimensionsPx: record.dna.layout.dimensionsPx,
      ...(record.visualFallbackReason ? { note: record.visualFallbackReason } : {}),
    },
    designDna: {
      polarity: record.dna.polarity,
      summary: record.dna.summaryText,
      traits: record.dna.traits,
      palette: record.dna.palette,
      typography: record.dna.typography.map((t) => ({
        role: t.role,
        primaryFont: t.primaryFont,
        fontSizePx: t.fontSizePx,
        fontWeight: t.fontWeight,
        lineHeightRatio: t.lineHeightRatio,
        letterSpacing: t.letterSpacing,
      })),
      layout: record.dna.layout,
      surfaces: record.dna.surfaces,
      accessibilityContrast: record.dna.contrastChecks.map((c) => ({
        foreground: c.foregroundHex,
        background: c.backgroundHex,
        ratio: c.ratio,
        wcagAA: c.aaNormal,
        isEstimated: c.isEstimated,
      })),
    },
  };
  return JSON.stringify(spec, null, 2);
}

/**
 * Tab 1 Report: Capture Overview (metadata, dimensions, mode, quick palette).
 */
export function generateCaptureReport(record: CaptureRecord): string {
  const { page, rect, viewport, dna } = record;
  const paletteHexes = dna.palette.slice(0, 8).map((c) => `${c.hex} (${c.role})`).join(', ');

  return [
    `# StyleLens Capture Report`,
    ``,
    `- **Source**: ${page.hostname} (${page.title})`,
    `- **URL**: ${page.url}`,
    `- **Captured At**: ${new Date(record.createdAt).toISOString()}`,
    `- **Capture Mode**: ${record.captureMode === 'dom-and-visual' ? 'DOM + Visual Hybrid' : 'Visual-Only Pixel Sampling'}`,
    `- **Selection Method**: ${record.selectionMethod}`,
    `- **Region Dimensions**: ${rect.width}×${rect.height}px (Bitmap ${record.screenshotWidth}×${record.screenshotHeight}px @ ${viewport.devicePixelRatio.toFixed(2)}x DPR)`,
    `- **DOM Scope**: ${record.totalNodesScanned} node(s)${record.truncated ? ' (capped for performance)' : ''}`,
    ...(record.visualFallbackReason ? [`- **Visual-Only Note**: ${record.visualFallbackReason}`] : []),
    ``,
    `## Snapshot Summary`,
    dna.summaryText,
    ...(paletteHexes ? [``, `## Key Colors`, paletteHexes] : []),
  ].join('\n');
}

/**
 * Tab 2 Report: Full Design DNA breakdown (traits, colors, typography, contrast, layout, surfaces, tokens).
 */
export function generateDesignDnaReport(record: CaptureRecord): string {
  const { dna, page } = record;
  const colorGroups = groupColorsByRole(dna.palette);

  const paletteLines = Object.entries(colorGroups).map(([role, tokens]) => {
    const list = tokens
      .map((t) => {
        const val = t.alpha < 0.99 ? `${t.hex} / ${t.rgbString}` : t.hex;
        const prov = t.provenance === 'exact-dom' ? 'exact' : `sampled ~${t.visualSharePercent ?? 0}%`;
        return `${val} [${prov}]`;
      })
      .join(', ');
    return `- **${role}**: ${list}`;
  });

  const typeLines = dna.typography.map((t) => {
    const lh = t.lineHeightRatio ? ` / lh ${t.lineHeightRatio}` : '';
    const ls = t.letterSpacing !== 'normal' ? ` / tracking ${t.letterSpacing}` : '';
    return `- **${t.role}**: \`${t.primaryFont}\` (${t.fontSizePx}px, weight ${t.fontWeight}${lh}${ls}) — stack: \`${t.fontStack}\``;
  });

  const contrastLines = dna.contrastChecks.map((c) => {
    const status = c.aaaNormal ? 'AAA Pass' : c.aaNormal ? 'AA Pass' : c.aaLarge ? 'AA Large Only' : 'Fail';
    return `- \`${c.foregroundHex}\` on \`${c.backgroundHex}\`: **${c.ratio}:1** (${status}${c.isEstimated ? ', estimated over gradient/image' : ''})`;
  });

  const surfaces = dna.surfaces ?? {
    borderRadii: [],
    borders: [],
    shadows: [],
    textShadows: [],
    transforms: [],
    clipPaths: [],
    gradients: [],
    backdropFilters: [],
  };
  const surfaceLines: string[] = [];
  if ((surfaces.borderRadii?.length ?? 0) > 0)
    surfaceLines.push(`- **Border Radii**: ${surfaces.borderRadii.join(', ')}`);
  if ((surfaces.borders?.length ?? 0) > 0)
    surfaceLines.push(`- **Borders**: ${surfaces.borders.join(' | ')}`);
  if ((surfaces.shadows?.length ?? 0) > 0)
    surfaceLines.push(`- **Shadows**: ${surfaces.shadows.join(' | ')}`);
  if ((surfaces.textShadows?.length ?? 0) > 0)
    surfaceLines.push(`- **Text Shadows**: ${surfaces.textShadows.join(' | ')}`);
  if ((surfaces.transforms?.length ?? 0) > 0)
    surfaceLines.push(`- **Transforms**: ${surfaces.transforms.join(' | ')}`);
  if ((surfaces.clipPaths?.length ?? 0) > 0)
    surfaceLines.push(`- **Clip Paths**: ${surfaces.clipPaths.join(' | ')}`);
  if ((surfaces.backdropFilters?.length ?? 0) > 0)
    surfaceLines.push(`- **Backdrop Filters**: ${surfaces.backdropFilters.join(', ')}`);
  if ((surfaces.gradients?.length ?? 0) > 0)
    surfaceLines.push(`- **Gradients**: ${surfaces.gradients.join(' | ')}`);

  return [
    `# StyleLens Design DNA Report (${page.hostname})`,
    ``,
    `- **Polarity**: ${dna.polarity}`,
    `- **Layout Model**: ${dna.layout.primaryModel.toUpperCase()} (${dna.layout.flexCount} flex, ${dna.layout.gridCount} grid)`,
    ...(dna.layout.spacingGridBase ? [`- **Inferred Spacing Grid**: ${dna.layout.spacingGridBase}px base`] : []),
    ...(dna.layout.spacingScalePx.length > 0
      ? [`- **Observed Spacing Scale**: ${dna.layout.spacingScalePx.join('px, ')}px`]
      : []),
    ``,
    `## Detected Style Traits`,
    ...(dna.traits.length > 0
      ? dna.traits.map((t) => `- **${t.label}** (${t.confidence}): ${t.evidence}`)
      : ['- Minimal flat presentation']),
    ``,
    `## Color Palette`,
    ...(paletteLines.length > 0 ? paletteLines : ['- No colors detected']),
    ``,
    `## Typography Hierarchy`,
    ...(typeLines.length > 0 ? typeLines : ['- No DOM text nodes detected']),
    ``,
    `## WCAG 2.1 Contrast Audit`,
    ...(contrastLines.length > 0 ? contrastLines : ['- No text contrast pairs measured']),
    ``,
    `## Surfaces & Visual Effects`,
    ...(surfaceLines.length > 0 ? surfaceLines : ['- Flat surfaces']),
    ``,
    `## Ready-to-Use CSS Custom Properties`,
    '```css',
    generateCssTokens(record),
    '```',
  ].join('\n');
}

/**
 * Tab 3 Report: Simplified HTML Hierarchy + Key Per-Node Computed CSS.
 */
export function generateStructureReport(record: CaptureRecord): string {
  const { page, roots } = record;
  const skeleton = generateSimplifiedHtml(roots, 5);

  const nodeBreakdowns: string[] = [];
  const walk = (node: ExtractedNode, depth: number) => {
    if (nodeBreakdowns.length >= 24) return;
    const prefix = '  '.repeat(depth);
    const cls = node.cleanClasses.length > 0 ? `.${node.cleanClasses.slice(0, 3).join('.')}` : '';
    const keyProps = Object.entries(node.styles)
      .filter(([k, v]) => v !== undefined && v !== '' && k !== 'width' && k !== 'height')
      .slice(0, 8)
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ');
    nodeBreakdowns.push(
      `${prefix}- \`<${node.tag}${cls}>\` (${node.rect.width}×${node.rect.height}px)${keyProps ? ` — ${keyProps}` : ''}`
    );
    for (const child of node.children) {
      walk(child, depth + 1);
    }
  };
  for (const root of roots) walk(root, 0);

  return [
    `# StyleLens Structure & Computed CSS Report (${page.hostname})`,
    ``,
    `- **Nodes Extracted**: ${record.totalNodesScanned}${record.truncated ? ' (capped)' : ''}`,
    ``,
    `## Cleaned HTML Skeleton`,
    '```html',
    skeleton,
    '```',
    ...(nodeBreakdowns.length > 0
      ? [``, `## Per-Node Curated Computed Styles`, ...nodeBreakdowns]
      : []),
  ].join('\n');
}

interface SpatialVisualItem {
  relX: number;
  relY: number;
  centerY: number;
  width: number;
  height: number;
  zone: string;
  priority: number;
  description: string;
}

interface InheritedWrapperFrame {
  bgHex?: string | null;
  borderDesc?: string | null;
  radius?: string;
}

function describeNodeBorder(styles: ExtractedNode['styles']): string | null {
  if (styles.border) return `border ${styles.border}`;
  const sides: string[] = [];
  if (styles.borderTop) sides.push(`border-top ${styles.borderTop}`);
  if (styles.borderRight) sides.push(`border-right ${styles.borderRight}`);
  if (styles.borderBottom) sides.push(`border-bottom ${styles.borderBottom}`);
  if (styles.borderLeft) sides.push(`border-left ${styles.borderLeft}`);
  return sides.length > 0 ? sides.join(', ') : null;
}

function reconstructVisibleText(node: ExtractedNode): string {
  if (node.inlineSegments && node.inlineSegments.length > 0) {
    return node.inlineSegments
      .map((seg) => {
        if (seg.kind === 'text') return seg.text;
        if (seg.kind === 'br') return ' / ';
        const child = node.children[seg.index];
        return child ? reconstructVisibleText(child) : '';
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return (node.textSnippet ?? '').trim();
}

function cleanDisplayFont(fontStack: string | undefined): string {
  if (!fontStack) return 'sans-serif';
  const first = (fontStack.split(',')[0] ?? fontStack).replace(/^["'\s]+|["'\s]+$/g, '');
  return first.replace(/^__/, '').replace(/_[a-f0-9]{5,}$/i, '').replace(/_/g, ' ').trim() || first;
}

function describeColorHex(cssColor: string | undefined): string | null {
  if (!cssColor) return null;
  const parsed = parseCssColor(cssColor);
  if (!parsed || parsed.a <= 0.02) return null;
  const hex = rgbaToHex(parsed, false);
  return parsed.a < 0.98 ? `${hex} (${Math.round(parsed.a * 100)}% opacity)` : hex;
}

function describeSpatialZone(
  relX: number,
  relY: number,
  width: number,
  canvasWidth: number,
  canvasHeight: number
): string {
  const vBand =
    relY < canvasHeight * 0.34 ? 'top' : relY < canvasHeight * 0.67 ? 'middle' : 'lower';
  if (width >= canvasWidth * 0.65) {
    return `${vBand} full-width`;
  }
  const centerX = relX + width / 2;
  const hBand =
    centerX < canvasWidth * 0.34 ? 'left' : centerX < canvasWidth * 0.67 ? 'center' : 'right';
  return `${vBand}-${hBand}`;
}

/**
 * Builds an exact row-by-row X-Ray Spatial Visual Layout Map from captured DOM rects and
 * computed styles so BOTH coding agents and multimodal/image AIs reproduce exact 2D layout,
 * typography hierarchy, SVG logo colors, and visual structure 1-to-1.
 */
export function buildSpatialVisualMap(record: CaptureRecord): {
  lines: string[];
  rowCount: number;
  itemCount: number;
} {
  if (record.roots.length === 0) {
    return { lines: [], rowCount: 0, itemCount: 0 };
  }

  const originX = Math.min(record.rect.x, ...record.roots.map((r) => r.rect.x));
  const originY = Math.min(record.rect.y, ...record.roots.map((r) => r.rect.y));
  const canvasW = Math.max(1, record.rect.width);
  const canvasH = Math.max(1, record.rect.height);

  const items: SpatialVisualItem[] = [];
  const walk = (node: ExtractedNode, parentFrame?: InheritedWrapperFrame) => {
    const relX = Math.max(0, Math.round(node.rect.x - originX));
    const relY = Math.max(0, Math.round(node.rect.y - originY));
    const w = Math.max(1, Math.round(node.rect.width));
    const h = Math.max(1, Math.round(node.rect.height));
    const zone = describeSpatialZone(relX, relY, w, canvasW, canvasH);

    if (node.tag === 'svg') {
      const fills =
        node.svgColors && node.svgColors.length > 0
          ? node.svgColors.join(', ')
          : describeColorHex(node.styles.color) ?? 'inherited color';
      const labelParts: string[] = [];
      if (node.ariaLabel) labelParts.push(`"${node.ariaLabel}"`);
      if (node.cleanClasses[0]) labelParts.push(`(.${node.cleanClasses[0]})`);
      const label = labelParts.length > 0 ? ` ${labelParts.join(' ')}` : '';
      items.push({
        relX,
        relY,
        centerY: relY + h / 2,
        width: w,
        height: h,
        zone,
        priority: 95,
        description: `\`<svg>\`${label} graphic/logo mark — vector color ${fills} (${w}×${h}px; keep exact shape, position & color, changing brand letters only if requested)`,
      });
      return;
    }

    if (node.tag === 'img') {
      const alt = node.imgAlt || node.ariaLabel;
      const altStr = alt ? ` alt="${alt}"` : '';
      items.push({
        relX,
        relY,
        centerY: relY + h / 2,
        width: w,
        height: h,
        zone,
        priority: 92,
        description: `\`<img>\`${altStr} (${w}×${h}px)`,
      });
      return;
    }

    const visibleText = reconstructVisibleText(node);
    const ownBgHex = describeColorHex(node.styles.backgroundColor);
    const ownBorder = describeNodeBorder(node.styles);
    const ownRadius = node.styles.borderRadius;

    if (node.textSnippet && visibleText) {
      const fgHex = describeColorHex(node.styles.color);
      const bgHex = ownBgHex ?? parentFrame?.bgHex ?? null;
      const borderDesc = ownBorder ?? parentFrame?.borderDesc ?? null;
      const radius = ownRadius ?? parentFrame?.radius;
      const fontName = cleanDisplayFont(node.styles.fontFamily);
      const fontSizeNum = Number.parseFloat(node.styles.fontSize ?? '14') || 14;
      const fontWeightNum = Number.parseInt(node.styles.fontWeight ?? '400', 10) || 400;
      const isUpper =
        node.styles.textTransform === 'uppercase' ||
        (/[A-Z]/.test(visibleText) && visibleText === visibleText.toUpperCase());
      const stretchPart = node.styles.fontStretch ? ` ${node.styles.fontStretch}` : '';
      const parts: string[] = [
        `\`<${node.tag}>\` "${visibleText.slice(0, 90)}"`,
        `font \`${fontName}\` ${node.styles.fontSize ?? ''} weight ${node.styles.fontWeight ?? '400'}${stretchPart}${isUpper ? ' UPPERCASE' : ''}`,
      ];
      if (node.styles.letterSpacing && node.styles.letterSpacing !== 'normal') {
        parts.push(`tracking ${node.styles.letterSpacing}`);
      }
      if (fgHex) parts.push(`text ${fgHex}`);
      if (bgHex) parts.push(`fill ${bgHex}`);
      if (borderDesc) parts.push(borderDesc);
      if (radius) parts.push(`radius ${radius}`);
      if (node.styles.transform) parts.push(`transform ${node.styles.transform}`);
      if (node.styles.textShadow) parts.push(`text-shadow ${node.styles.textShadow}`);

      const priority =
        node.tag === 'h1' || fontSizeNum >= 32
          ? 100
          : node.tag === 'h2' || fontSizeNum >= 22
            ? 90
            : node.tag === 'button' || bgHex || fontWeightNum >= 600
              ? 80
              : 55;

      items.push({
        relX,
        relY,
        centerY: relY + h / 2,
        width: w,
        height: h,
        zone,
        priority,
        description: parts.join(', '),
      });
    }

    // Pass CTA/badge wrapper frame recursively down through single/two-child nested wrappers
    // (handles both `<a><span>SHOP</span></a>` and `<a><div><span>SHOP</span></div></a>`)
    const ownFrame: InheritedWrapperFrame | undefined =
      Boolean(ownBgHex || ownBorder || ownRadius)
        ? {
            bgHex: ownBgHex ?? parentFrame?.bgHex,
            borderDesc: ownBorder ?? parentFrame?.borderDesc,
            radius: ownRadius ?? parentFrame?.radius,
          }
        : parentFrame;
    const passFrameToChildren: InheritedWrapperFrame | undefined =
      !node.textSnippet && node.children.length > 0 && node.children.length <= 2
        ? ownFrame
        : undefined;

    for (const child of node.children) walk(child, passFrameToChildren);
  };

  for (const root of record.roots) walk(root);
  if (items.length === 0) return { lines: [], rowCount: 0, itemCount: 0 };

  // Prioritize headings, brand marks, CTAs, and active nav links BEFORE capping at 30 items
  // so <h1> headings are NEVER dropped even on dense headers with >20 utility links.
  const selectedItems =
    items.length > 30
      ? [...items]
          .sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : a.relY - b.relY))
          .slice(0, 30)
      : [...items];

  // Sort selected items top-to-bottom then left-to-right, and cluster into visual rows
  selectedItems.sort((a, b) => (Math.abs(a.centerY - b.centerY) <= 18 ? a.relX - b.relX : a.relY - b.relY));

  const rows: SpatialVisualItem[][] = [];
  for (const item of selectedItems) {
    const existingRow = rows.find((row) => {
      const avgY = row.reduce((acc, it) => acc + it.centerY, 0) / row.length;
      const maxH = Math.max(...row.map((it) => it.height), item.height);
      const tolerance = Math.min(36, Math.max(16, maxH * 0.55));
      return Math.abs(item.centerY - avgY) <= tolerance;
    });
    if (existingRow) {
      existingRow.push(item);
    } else {
      rows.push([item]);
    }
  }

  for (const row of rows) {
    row.sort((a, b) => a.relX - b.relX);
  }
  rows.sort((a, b) => (a[0]?.relY ?? 0) - (b[0]?.relY ?? 0));

  const lines: string[] = [];
  rows.forEach((row, idx) => {
    const minY = Math.min(...row.map((r) => r.relY));
    const maxY = Math.max(...row.map((r) => r.relY + r.height));
    const rowLabel =
      rows.length === 1
        ? `Single Row (y=${minY}–${maxY}px)`
        : idx === 0
          ? `Row ${idx + 1} — Top (y=${minY}–${maxY}px)`
          : idx === rows.length - 1
            ? `Row ${idx + 1} — Lower (y=${minY}–${maxY}px)`
            : `Row ${idx + 1} — Middle (y=${minY}–${maxY}px)`;
    lines.push(`- **${rowLabel}:**`);
    row.forEach((item, colIdx) => {
      lines.push(
        `  ${colIdx + 1}. \`[${item.zone}, x:${item.relX}px y:${item.relY}px, ${item.width}×${item.height}px]\` ${item.description}`
      );
    });
  });

  return { lines, rowCount: rows.length, itemCount: items.length };
}

/**
 * Generates strict anti-hallucination negative constraints derived directly from what is
 * ABSENT on the outer frame & surfaces (immune to tiny 14px child badge dots or single-side hairlines).
 */
export function buildNegativeConstraints(record: CaptureRecord, rowCount: number): string[] {
  const { dna, roots } = record;
  const surfaces = dna.surfaces ?? {
    borderRadii: [],
    borders: [],
    shadows: [],
    textShadows: [],
    transforms: [],
    clipPaths: [],
    gradients: [],
    backdropFilters: [],
  };

  const rules: string[] = [];

  // Photographic / raster artwork captures (e.g. 3D hardware, bottles, clothing, logos inside <img>)
  // MUST NOT receive false DOM-CSS "flat matte / no gloss / no gradients" constraints!
  if (isArtworkOrPhotoCapture(record)) {
    rules.push(
      '- **PRESERVE real 3D lighting, textures & reflections:** Keep 100% of the attached photograph/artwork’s genuine metallic sheen, gradients, glows, shadows, surface grain, perspective, and exact lettering proportions — do NOT flatten it into a cartoonish vector or replace the scene with a plain box.'
    );
    rules.push(
      `- **IGNORE host webpage chrome & search-page fonts:** Do NOT borrow UI fonts or dark/light browser chrome from \`${record.page.hostname}\` — treat ONLY the pixels of the attached cropped image as visual ground truth.`
    );
  } else {
    const outerHasRadius = roots.some((r) => Boolean(r.styles.borderRadius));
    const outerHasFullBorder = roots.some((r) => Boolean(r.styles.border));
    const outerHasShadow = roots.some((r) => Boolean(r.styles.boxShadow));

    if (!outerHasRadius) {
      rules.push(
        '- **NO invented pill, capsule, or rounded card frame:** The outer captured canvas has sharp flat edges (`0px` outer radius). Do NOT wrap the overall layout in a rounded badge, capsule, or pill.'
      );
    }
    if (!outerHasFullBorder) {
      rules.push(
        '- **NO invented outer box borders or divider bars:** Do NOT add glowing container outlines, box frames, or vertical `|` separators that are not in the X-Ray Layout Map.'
      );
    }
    if ((surfaces.gradients?.length ?? 0) === 0) {
      rules.push(
        '- **NO 3D gloss, bevels, or gradients:** Every surface is a flat solid matte fill. Do NOT add metallic sheen, lighting gradients, or glossy effects.'
      );
    }
    if (!outerHasShadow) {
      rules.push(
        '- **NO outer drop shadows or glows:** Outer elevation is completely flat (`box-shadow: none`).'
      );
    }
    if (rowCount >= 2) {
      rules.push(
        `- **NO layout collapsing:** Preserve ALL **${rowCount} distinct horizontal rows** in their exact top-to-bottom spatial hierarchy — NEVER squash multi-row layouts into a single horizontal bar or pill.`
      );
    }
  }

  // Explicitly protect vibrant brand accent hues (e.g. H&M red #EB0010) from being desaturated to white
  const effectivePalette = getEffectivePaletteForPrompt(record);
  const vibrantAccents = Array.from(
    new Set(
      effectivePalette
        .filter((c) => {
          const parsed = parseCssColor(c.hex);
          return parsed !== null && !isNeutralColor(parsed);
        })
        .map((c) => c.hex)
    )
  ).slice(0, 4);

  if (vibrantAccents.length > 0) {
    rules.push(
      `- **PRESERVE exact brand accent color(s) (${vibrantAccents.join(', ')}):** Keep each accent on its exact element/position from the Layout Map — NEVER desaturate colored brand marks into white or gray.`
    );
  }

  return rules;
}

/**
 * Complete Unified Agent Prompt ("Send to AI Chat" / "Copy Style Prompt"):
 * Strict 98%+ 1-to-1 X-Ray style transfer & 3-Layer Asset Pack prompt engineered so
 * even a 1-word minimal input (e.g. "Apple" or "Dollar Tree") renders in the captured
 * reference's exact style (NEVER substituting another brand's real logo!) AND outputs
 * reusable decomposed layers (Composite + Isolated Editable Wordmark + Clean Background).
 */
export function generateCompleteAgentPrompt(
  record: CaptureRecord,
  customWord?: string,
  language: 'en' | 'zh-CN' = 'en'
): string {
  const { dna } = record;
  const trimmedWord =
    customWord
      ?.replace(/[`\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || '';
  const isPhotographicOrArtwork = isArtworkOrPhotoCapture(record);
  const effectivePalette = getEffectivePaletteForPrompt(record);
  const effectiveTypography = getEffectiveTypographyForPrompt(record);
  const colorGroups = groupColorsByRole(effectivePalette);
  const rootBackdrop = resolveRootBackdropHex(record);

  const colorLines = Object.entries(colorGroups).map(([role, tokens]) => {
    const formatted = tokens
      .slice(0, 5)
      .map((t) => {
        const val = t.alpha < 0.99 ? `${t.hex} (${t.rgbString})` : t.hex;
        return t.provenance === 'sampled-pixels' ? `${val} [sampled]` : val;
      })
      .join(', ');
    return `- **${role}**: ${formatted}`;
  });

  const typeLines = effectiveTypography.map((t) => {
    const lh = t.lineHeightRatio ? `, line-height ${t.lineHeightRatio}` : '';
    const ls = t.letterSpacing !== 'normal' ? `, letter-spacing ${t.letterSpacing}` : '';
    return `- **${t.role}**: \`${t.primaryFont}\` — ${t.fontSizePx}px, weight ${t.fontWeight}${lh}${ls} (full stack: \`${t.fontStack}\`)`;
  });

  const surfaces = dna.surfaces ?? {
    borderRadii: [],
    borders: [],
    shadows: [],
    textShadows: [],
    transforms: [],
    clipPaths: [],
    gradients: [],
    backdropFilters: [],
  };
  const effectLines: string[] = [];
  if ((surfaces.borderRadii?.length ?? 0) > 0)
    effectLines.push(`- **Border Radii**: ${surfaces.borderRadii.join(', ')}`);
  if ((surfaces.borders?.length ?? 0) > 0)
    effectLines.push(`- **Borders**: ${surfaces.borders.join(' | ')}`);
  if ((surfaces.shadows?.length ?? 0) > 0)
    effectLines.push(`- **Box Shadows**: ${surfaces.shadows.join(' | ')}`);
  if ((surfaces.textShadows?.length ?? 0) > 0)
    effectLines.push(`- **Text Shadows**: ${surfaces.textShadows.join(' | ')}`);
  if ((surfaces.transforms?.length ?? 0) > 0)
    effectLines.push(`- **Transforms / Tilt**: ${surfaces.transforms.join(' | ')}`);
  if ((surfaces.clipPaths?.length ?? 0) > 0)
    effectLines.push(`- **Clip Paths / Shapes**: ${surfaces.clipPaths.join(' | ')}`);
  if ((surfaces.gradients?.length ?? 0) > 0)
    effectLines.push(`- **Gradients**: ${surfaces.gradients.join(' | ')}`);
  if ((surfaces.backdropFilters?.length ?? 0) > 0)
    effectLines.push(`- **Backdrop Blur / Glass**: ${surfaces.backdropFilters.join(', ')}`);

  const spatialMap = buildSpatialVisualMap(record);
  const negativeRules = buildNegativeConstraints(record, spatialMap.rowCount);
  const aspectRatio =
    record.rect.height > 0 ? (record.rect.width / record.rect.height).toFixed(2) : '1.00';

  const artworkWarning =
    record.captureMode === 'visual-only' || record.containsGraphicArtwork
      ? [
          ``,
          `> **Visual Artwork Mode**: This selection is rendered artwork/photography rather than live HTML text. Use the attached cropped image as the exact visual ground truth for custom lettering, textures, kerning, and composition, while enforcing the measured hex palette and literal spelling lock below.`,
        ]
      : [];

  // Only embed raw HTML+CSS blueprint when the capture actually contains meaningful live UI/typography/vectors
  // (avoids polluting image generators with empty <div> boilerplate on pure photo/raster logo captures like Zara/Zumiez).
  const hasMeaningfulLiveDom =
    record.roots.length > 0 &&
    !record.containsGraphicArtwork &&
    (dna.typography.length > 0 || spatialMap.itemCount >= 1);
  const faithful = hasMeaningfulLiveDom ? generateFaithfulSnapshot(record) : null;
  // Compact blueprint slightly when customWord is locked so chat paste & AI processing stay ultra-fast
  const faithfulBlock = faithful ? formatBlueprintForPrompt(faithful, trimmedWord ? 4400 : 6500) : null;

  const targetWordSection = trimmedWord
    ? [
        `## TARGET TEXT TO RENDER (ZERO-CONTEXT STYLE TRANSFER LOCK)`,
        `- **Exact replacement text**: \`${trimmedWord}\``,
        `- **CRITICAL ANTI-BRAND-SUBSTITUTION RULE**: Treat \`${trimmedWord}\` PURELY as literal text characters to typeset in the attached reference's exact visual style, without changing the reference's colors, emblem, or symbols to match the meaning of \`${trimmedWord}\`. Keep 100% of the attached reference's font/lettering style, colors, badge/ribbon shape, textures, and background — changing ONLY the letters to spell **\`${trimmedWord}\`** with 100% literal accuracy.`,
        ``,
      ]
    : [
        `## ZERO-CONTEXT INPUT RULE (ANTI-BRAND-SUBSTITUTION)`,
        `- Even if I only typed a single word with no extra explanation, treat my word(s) PURELY as literal replacement text to typeset inside the attached reference's exact font, colors, badge, and background — preserving 100% of the reference's original colors, style, and symbols.`,
        ``,
      ];

  const assetPackTarget = trimmedWord
    ? `\`${trimmedWord}\``
    : language === 'zh-CN'
      ? '我输入的文字'
      : 'my requested word(s)';
  const languageDirective =
    language === 'zh-CN'
      ? [
          `- **Response Language**: Write all headings, descriptions, and how-to steps in clear, easy-to-read **Simplified Chinese (简体中文)** while spelling the target text ${assetPackTarget} literally.`,
        ]
      : [];

  // CRITICAL: On photographic/artwork captures (e.g. product photos on Google Images/Amazon),
  // NEVER fall back to `pageFallbackTypography` ("Google Sans" / "Arial") or single stray host overlay badges —
  // that pollutes the prompt with the search engine's UI font instead of the artwork's custom lettering!
  const primaryType = isPhotographicOrArtwork
    ? effectiveTypography[0]
    : (effectiveTypography[0] ?? dna.pageFallbackTypography?.[0]);
  const primaryTextFill = resolvePrimaryTextFillHex(record, rootBackdrop);
  const parsedPrimaryFill = parseCssColor(primaryTextFill);
  const isDarkTextFill = parsedPrimaryFill
    ? contrastRatio(parsedPrimaryFill, PURE_BLACK_RGB) < 4.5
    : dna.polarity === 'light';
  const hasCjkOrComplexScript =
    /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(trimmedWord) || isPhotographicOrArtwork;
  const wordmarkAnatomyHint = primaryType
    ? `\`${primaryType.primaryFont}\` (weight ${primaryType.fontWeight}, size ~${primaryType.fontSizePx}px, fill \`${primaryTextFill}\`${primaryType.letterSpacing !== 'normal' ? `, tracking ${primaryType.letterSpacing}` : ''})`
    : `exact custom lettering visible inside the attached cropped image (match foreground lettering fill/gradient, stroke thickness, slant, and stencil/serif details directly from pixels — ignore host webpage fonts!)`;

  const layer2VisibilityAndScriptNote = [
    isDarkTextFill && !isPhotographicOrArtwork
      ? `Note: \`${primaryTextFill}\` is dark and may look dim on dark-mode chat preview cards — still keep the exact \`${primaryTextFill}\` fill on a transparent background for clean Figma/Canva export (do NOT bake an opaque rectangle behind it), and remind the user in Section 04 that clicking **Exact Text (AI)** in StyleLens creates a high-contrast 100% exact raster cutout.`
      : null,
    hasCjkOrComplexScript
      ? `For custom artwork lettering, 3D textures, cursive script, or CJK strokes, craft clean high-contrast vector \`<path>\` letterforms here (still ZERO \`<text>\` / \`<foreignObject>\` tags) and remind the user in Section 04 to click **Exact Text (AI)** in StyleLens for a 100% pixel-exact raster font cutout.`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  const layer3VisualSvgRule = isPhotographicOrArtwork
    ? `**DO NOT draw a blocky or cartoonish SVG trace of this 3D photograph!** Inline SVG polygons cannot faithfully reproduce photographic lighting, brushed metal, or hardware textures. Instead, use explicit \`xmlns="http://www.w3.org/2000/svg"\` and \`width="${record.rect.width}" height="${record.rect.height}" viewBox="0 0 ${record.rect.width} ${record.rect.height}"\` to render a **clean minimal vector layout frame** using the measured palette backdrop starting from \`${rootBackdrop}\` and subtle architectural framing (**ZERO crude object polygon traces, ZERO \`<text>\` tags, ZERO \`<foreignObject>\`, ZERO letter glyphs**). In Section 04, tell the user to click **Clean BG (AI)** / **Background** in StyleLens (1 click!) for the **100% photorealistic text-erased original photo background**! **Do NOT call the image generator for Layer 3.**`
    : `Use explicit \`xmlns="http://www.w3.org/2000/svg"\` and \`width="${record.rect.width}" height="${record.rect.height}" viewBox="0 0 ${record.rect.width} ${record.rect.height}"\` to visually render the COMPLETE, crisp, high-craft text-free UI background surface (\`${rootBackdrop}\`, smooth \`<linearGradient>\`s, rounded corners, exact borders, subtle \`<feDropShadow>\`, and ALL non-text icons, logos, or emblems from the Reference Geometry below) with **100% of text removed (ZERO \`<text>\` tags, ZERO \`<foreignObject>\`, ZERO letter glyphs)** so it previews visually right inside the chat and downloads in 1 click. **Do NOT call the image generator for Layer 3.**`;

  return [
    `# StyleLens 1-to-1 X-Ray Style Replication Spec (+ 3-Layer Asset Pack)`,
    ``,
    ...targetWordSection,
    `## STRICT DELIVERY CONTRACT (100% CONSISTENT HYBRID OUTPUT)`,
    `- **MANDATORY HYBRID REPLY (NEVER IMAGE-ONLY, NEVER TEXT-ONLY)**: Do **NOT** stop after generating an image, and do **NOT** skip the image. Every single reply MUST include **BOTH**: (A) **EXACTLY ONE (1) generated raster image** for Section 01 (Layer 1 — Full Composite ONLY), **AND** (B) **the complete 4-section StyleLens text + rendered SVG package** in the exact template order!`,
    `- **EXACTLY ONE (1) IMAGE GENERATION CALL TOTAL**: Invoke your image generator **AT MOST ONCE** in this entire reply — EXCLUSIVELY for **Layer 1 — Full Composite**. **NEVER** invoke image generation for Layer 2 or Layer 3 (generating 2–3 images in one turn breaks AI chat UIs and drops images). Both Layer 2 and Layer 3 MUST be pure copy-ready inline \`\`\`svg code blocks ONLY so the chat renders BOTH visually with instant download buttons!`,
    `- **LAYER 1 SCENE & BACKGROUND LOCK**: Your single generated image MUST edit/recreate the attached screenshot 1-to-1 on its **EXACT original background, physical object/product, badge, frame, lighting, and perspective** — replacing ONLY the original words with ${assetPackTarget}. **NEVER** drop the original scene/background or place the word onto a plain blank box!`,
    `- *(If your AI platform has no image generator, render Section 01 as a self-contained runnable \`\`\`svg visual preview instead of omitting it.)*`,
    ``,
    `## REQUIRED 3-LAYER PRO ASSET PACK OUTPUT (STRICT 4-SECTION TEMPLATE)`,
    `Present your reply in this **EXACT top-to-bottom structure** (do not omit or reorder any section):`,
    '```text',
    `┌──[ 01 · STYLELENS PACKAGE // 01001010 ]──────────────┐`,
    `│  TARGET  : ${trimmedWord || '<User Requested Text>'}`,
    `│  SOURCE  : ${record.page.hostname} (${record.rect.width}x${record.rect.height}px)`,
    `│  LAYERS  : [01] Composite Image  [02] Vector Path SVG  [03] Visual BG SVG`,
    `└──[ 10110 · READY FOR EXPORT ]────────────────────────┘`,
    '```',
    `### 01 // Full Composite (Layer 1 — Full Composite · ONLY Generated Image)`,
    `- Generate **THE SINGLE raster image** right here under this heading: ${assetPackTarget} rendered 1-to-1 inside the attached reference's exact original background, object/product, badge, frame, lighting, and font style.`,
    `### 02 // Isolated Wordmark (Layer 2 — Isolated Typography / Wordmark ONLY · Vector Path SVG, NO Image Call)`,
    `- **CRITICAL ANTI-ARIAL SVG FONT RULE**: Sandboxed chat SVG viewers CANNOT load custom/brand/proprietary fonts inside \`<text>\` or \`<foreignObject>\` tags — writing \`<text font-family="Product Sans, sans-serif">\` ALWAYS falls back to ugly generic Arial (INSTANT FAILURE!).`,
    `- Output ONE clean, copy-ready inline \`\`\`svg ... \`\`\` code block with explicit \`xmlns="http://www.w3.org/2000/svg"\`, \`width\`, \`height\`, and tight \`viewBox\` on a **transparent background** where EVERY letter of ${assetPackTarget} is drawn as **distinct bespoke vector \`<path d="..."/>\` glyphs with explicit non-empty \`fill\` (ZERO \`<text>\` tags, ZERO \`<tspan>\`, ZERO \`<foreignObject>\` — NEVER fall back to Arial, Helvetica, or Times!)** accurately tracing ${wordmarkAnatomyHint}: exact stroke thickness, circular/geometric bowls, single-story vs double-story shapes, serifs/stencils/slants, kerning, and exact fill color/gradient from Layer 1. **Do NOT call the image generator for Layer 2.**`,
    ...(layer2VisibilityAndScriptNote ? [`- ${layer2VisibilityAndScriptNote}`] : []),
    `### 03 // Clean Background Layer (Layer 3 — Clean Background / Frame Layout ONLY · Rendered Visual SVG, NO Image Call)`,
    `- **CRITICAL VISUAL BACKGROUND RULE**: Output Section 03 STRICTLY as a standalone inline \`\`\`svg ... \`\`\` graphic (**NEVER \`\`\`html\`!** Raw HTML renders only unreadable source code with NO visual background preview!).`,
    `- ${layer3VisualSvgRule}`,
    `### 04 // Quick 1-2-3 How To Use`,
    `- Write 3 ultra-short, beginner-friendly 1-line steps: (1) save the Layer 1 composite image, (2) download/paste the Layer 2 SVG into Figma/Canva (or click **Exact Text (AI)** in StyleLens for a 100% exact raster font cutout), (3) download/reuse the Layer 3 SVG (or click **Clean BG (AI)** in StyleLens for a photorealistic text-erased background plate).`,
    `- **CRITICAL VISUAL RULE**: Use the binary/box header ONLY for your text reply formatting — NEVER draw binary digits, box borders, CSS, or hex codes inside the generated Layer 1 image!`,
    ...languageDirective,
    ``,
    `## MANDATORY REPLICATION CONTRACT (98%+ EXACT MATCH)`,
    `1. **Replicate the EXACT format, 2D layout, row/column hierarchy, font family, font size/weight, uppercase/lowercase casing, tracking, and exact hex colors** captured from what I selected — treat the X-Ray measurements below as strict ground truth.`,
    `2. **Change ONLY the specific text or brand name I requested in my message (above or below)** — spell EVERY requested character, letter, space, and number with 100% literal accuracy (NEVER drop, swap, or merge letters) while keeping the exact position, color, weight, kerning, scale, and styling of every element.`,
    `3. **If I attached the cropped screenshot image**: match its exact visual geometry, proportions, typography silhouette, textures, and logo character 1-to-1 alongside the measured palette/tokens below.`,
    `4. **Reference Geometry Only (NEVER output raw HTML in your reply)**: Use the X-Ray Spatial Visual Layout Map and Reference Blueprint below ONLY as coordinate, color, radius, and inline \`<svg>\` icon-path reference when rendering the Layer 1 image and authoring Section 02 & Section 03 \`\`\`svg\`\`\` blocks — NEVER emit \`\`\`html\`\`\` or \`<div>\` wrappers in Sections 02–03!`,
    `5. **Never render CSS/metadata as image text**: When generating an image/mockup, NEVER draw CSS rules, hex codes (e.g. \`#000000\`), pixel coordinates, binary borders, or prompt labels as visible text inside the artwork — draw ONLY the clean visual UI.`,
    ...artworkWarning,
    ``,
    `## X-Ray Spatial Visual Layout Map (Canvas: ${record.rect.width}×${record.rect.height}px · ${aspectRatio}:1 aspect, backdrop ${rootBackdrop}, ${dna.polarity} theme)`,
    ...(spatialMap.lines.length > 0 && !(isPhotographicOrArtwork && effectiveTypography.length === 0)
      ? spatialMap.lines
      : [`- Match the exact 2D element positions, proportions, and lettering from the attached cropped screenshot (${record.rect.width}×${record.rect.height}px on ${rootBackdrop}).`]),
    ``,
    `## STRICT DO-NOT-INVENT RULES (ANTI-HALLUCINATION)`,
    ...(negativeRules.length > 0
      ? negativeRules
      : ['- Preserve exact measured radii, borders, shadows, and layout rows without inventing decorative extras.']),
    ``,
    `## Exact Colors (${dna.polarity} theme)`,
    ...(colorLines.length > 0 ? colorLines : ['- Match palette from attached reference image']),
    ``,
    `## Exact Typography`,
    ...(typeLines.length > 0
      ? typeLines
      : isPhotographicOrArtwork
        ? [
            '- Custom/rendered lettering inside artwork — match lettering weight, slant, stencil/serif anatomy, and colors 1-to-1 directly from the attached cropped image (ignore host webpage UI fonts).',
          ]
        : [
            '- Custom/rendered lettering inside artwork (match lettering weight, tilt, and silhouette directly from the attached image)',
            ...((dna.pageFallbackTypography ?? []).slice(0, 2).map(
              (t) =>
                `- **Site ${t.role} font**: \`${t.primaryFont}\` (${t.fontSizePx}px, weight ${t.fontWeight})`
            )),
          ]),
    ...(dna.fontStylesheetUrls && dna.fontStylesheetUrls.length > 0 && !isPhotographicOrArtwork
      ? [`- **Webfont Sources**: ${dna.fontStylesheetUrls.join(', ')}`]
      : []),
    ``,
    `## Measured Layout, Spacing & Effects`,
    `- **Dimensions**: ${record.rect.width}×${record.rect.height}px (${dna.layout.primaryModel.toUpperCase()} layout${dna.layout.spacingGridBase ? `, ${dna.layout.spacingGridBase}px spacing grid` : ''})`,
    ...(dna.layout.spacingScalePx.length > 0
      ? [`- **Spacing Scale**: ${dna.layout.spacingScalePx.join('px, ')}px`]
      : []),
    ...(dna.traits.length > 0
      ? [`- **Style Traits**: ${dna.traits.map((t) => `${t.label} (${t.evidence})`).join('; ')}`]
      : []),
    ...effectLines,
    ``,
    `## Exact CSS Custom Properties`,
    '```css',
    generateCssTokens(record, !isPhotographicOrArtwork),
    '```',
    ...(faithfulBlock
      ? [
          ``,
          `## Verified 1-to-1 HTML + Scoped CSS Blueprint (Internal Reference Geometry Only — Translate to SVG, Do NOT Output HTML)`,
          '```text',
          faithfulBlock,
          '```',
        ]
      : []),
    ``,
    `> **FINAL OUTPUT REMINDER**: Deliver all 4 sections in exact order: \`01\` = **1 composite raster image**, \`02\` = **vector \`<path>\` \`\`\`svg\`\`\` (ZERO \`<text>\`)**, \`03\` = **visual text-free \`\`\`svg\`\`\` (NEVER \`\`\`html\`)**, \`04\` = **3 quick steps**.`,
  ].join('\n');
}

/**
 * Dedicated single-image AI prompt for Layer 2 (Isolated Wordmark / Exact Font Image ONLY).
 * Solves the sandboxed SVG font limitation by invoking the multimodal image generator on ONE
 * focused job: render ONLY the target word in the 100% exact captured font/lettering on a
 * contrast-verified pure uniform flat background (instant 1-click cutout, zero icons/objects/borders).
 */
export function generateIsolatedTextImagePrompt(
  record: CaptureRecord,
  customWord?: string,
  language: 'en' | 'zh-CN' = 'en'
): string {
  const { dna } = record;
  const trimmedWord =
    customWord
      ?.replace(/[`\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || '';
  const targetDisplay = trimmedWord
    ? `\`${trimmedWord}\``
    : language === 'zh-CN'
      ? '我输入的文字'
      : 'my requested word(s)';

  const isPhotographicOrArtwork = isArtworkOrPhotoCapture(record);
  const effectivePalette = getEffectivePaletteForPrompt(record);
  const effectiveTypography = getEffectiveTypographyForPrompt(record);
  const rootBackdrop = resolveRootBackdropHex(record);
  const primaryType = isPhotographicOrArtwork
    ? effectiveTypography[0]
    : (effectiveTypography[0] ?? dna.pageFallbackTypography?.[0]);
  const primaryTextFill = resolvePrimaryTextFillHex(record, rootBackdrop);
  const flatBackdrop = resolveHighContrastFlatBackdrop(primaryTextFill, dna.polarity);
  const paletteSummary = effectivePalette
    .slice(0, 5)
    .map((c) => `${c.hex} (${c.role})`)
    .join(', ');
  const textShadow = dna.surfaces?.textShadows?.[0];
  const transform = dna.surfaces?.transforms?.[0];

  return [
    `# StyleLens Layer 2 — Exact-Font Isolated Wordmark Image (1-Image Cutout)`,
    ``,
    `## TASK (GENERATE EXACTLY ONE ISOLATED TYPOGRAPHY RASTER IMAGE)`,
    `- **OUTPUT FORMAT (RASTER IMAGE ONLY)**: Call your image generator to output **1 high-resolution raster PNG image directly** — do **NOT** return SVG or HTML code blocks.`,
    `- **Exact literal text to render**: ${targetDisplay}`,
    `- **CRITICAL EXACT-FONT LOCK**: Study the lettering/typography inside the attached reference image from \`${record.page.hostname}\`. Render **ONLY** the literal characters ${targetDisplay} centered cleanly in the **100% EXACT same font family, letterform anatomy, stroke thickness, weight, italic/slant angle, uppercase/lowercase casing, kerning, color/gradient, bevel/texture, and shadow** as the reference image — NEVER substitute generic Arial, Helvetica, or a different font!`,
    `- **CRITICAL ANTI-BRAND-SUBSTITUTION RULE**: Treat ${targetDisplay} strictly as literal letters to typeset in the attached reference's exact lettering style, without changing the visual style or adding unrelated symbols.`,
    `- **ISOLATED FLAT CUTOUT BACKGROUND (CONTRAST-VERIFIED)**: Place the wordmark alone centered with generous breathing room on a **100% uniform, flat, solid ${flatBackdrop.label}** backdrop (guaranteed high contrast against \`${primaryTextFill}\`) so it removes cleanly in 1 click. **ZERO icons, ZERO logos, ZERO badges, ZERO ribbons, ZERO background photos/products, ZERO borders, ZERO drop-frames** — ONLY the exact styled typography!`,
    `- **NEVER DRAW METADATA**: Never render hex codes, CSS labels, binary digits, or prompt text inside the image.`,
    ``,
    `## MEASURED TYPOGRAPHY & COLOR GROUND TRUTH`,
    primaryType
      ? `- **Captured Font**: \`${primaryType.primaryFont}\` (weight ${primaryType.fontWeight}, size ${primaryType.fontSizePx}px${primaryType.letterSpacing !== 'normal' ? `, tracking ${primaryType.letterSpacing}` : ''}, stack: \`${primaryType.fontStack}\`)`
      : `- **Captured Font**: Custom/brand display lettering in attached image — replicate every stroke, bowl, serif/stencil slit, and slant 1-to-1 from pixels`,
    `- **Primary Lettering Fill**: \`${primaryTextFill}\` on \`${flatBackdrop.hex}\`${
      isPhotographicOrArtwork && !primaryType
        ? ' (highest-contrast sampled tone — match the exact foreground lettering color, silver/white sheen, or gradient directly from the attached photo)'
        : ''
    }${paletteSummary ? ` · Palette: ${paletteSummary}` : ''}`,
    ...(textShadow ? [`- **Text Shadow / Glow**: \`${textShadow}\``] : []),
    ...(transform ? [`- **Letter Transform / Slant**: \`${transform}\``] : []),
    ...(language === 'zh-CN'
      ? [
          ``,
          `- **回复语言**: 请用简洁明了的**简体中文**写一句简短说明（文字内容本身严格按 ${targetDisplay} 逐字拼写）。`,
        ]
      : []),
  ].join('\n');
}

/**
 * Dedicated single-image AI prompt for Layer 3 (Clean Text-Free Background / Scene Image ONLY).
 * Invokes the multimodal image generator on ONE focused job: reproduce 100% of the captured
 * scene, physical product/object, lighting, badge, and non-text icons with ALL text cleanly erased.
 */
export function generateCleanBackgroundImagePrompt(
  record: CaptureRecord,
  language: 'en' | 'zh-CN' = 'en'
): string {
  const { dna } = record;
  const aspectRatio =
    record.rect.height > 0 ? (record.rect.width / record.rect.height).toFixed(2) : '1.00';
  const rootBackdrop = resolveRootBackdropHex(record);
  const detectedTexts = collectCapturedTextSnippets(record);
  const paletteSummary = getEffectivePaletteForPrompt(record)
    .slice(0, 6)
    .map((c) => `${c.hex} (${c.role})`)
    .join(', ');
  const surfaces = dna.surfaces ?? {
    borderRadii: [],
    borders: [],
    shadows: [],
    textShadows: [],
    transforms: [],
    clipPaths: [],
    gradients: [],
    backdropFilters: [],
  };

  return [
    `# StyleLens Layer 3 — Clean Text-Free Background Image (1-Image Plate)`,
    ``,
    `## TASK (GENERATE EXACTLY ONE CLEAN TEXT-FREE BACKGROUND RASTER IMAGE)`,
    `- **OUTPUT FORMAT (RASTER IMAGE ONLY)**: Call your image generator to output **1 high-resolution raster PNG image directly** — do **NOT** return SVG or HTML code blocks.`,
    `- **EXACT 1-TO-1 SCENE & OBJECT PRESERVATION**: Recreate the attached reference image from \`${record.page.hostname}\` (${record.rect.width}×${record.rect.height}px, ${aspectRatio}:1 aspect ratio) preserving **100% of the exact original background, surface texture, physical product/object (e.g. hardware, bottle, garment, card, pill bar), lighting, reflections, gradients, rounded corners, borders, shadows, and non-text icons/emblems** in their exact positions.`,
    `- **COMPLETE, SEAMLESS TEXT REMOVAL (INPAINT CLEANLY)**: Completely erase **EVERY SINGLE word, letter, number, tagline, and text character** from the image${detectedTexts.length > 0 ? ` (explicitly including: ${detectedTexts.map((s) => `\`${s}\``).join(', ')})` : ''}, seamlessly inpainting the underlying material, lighting, and surface texture where the text used to sit — leaving a **100% clean, empty, text-free background plate** ready for the user to place their own text on top!`,
    `- **STRICT ANTI-HALLUCINATION**: Do NOT invent new objects, do NOT crop or change perspective, do NOT replace the captured background with a generic flat box, and NEVER leave stray letters, gibberish text, hex codes, CSS, or binary borders anywhere in the image.`,
    ``,
    `## MEASURED BACKGROUND & SURFACE GROUND TRUTH`,
    `- **Canvas & Polarity**: ${record.rect.width}×${record.rect.height}px (${aspectRatio}:1) · ${dna.polarity} theme · base backdrop \`${rootBackdrop}\``,
    ...(paletteSummary ? [`- **Measured Palette**: ${paletteSummary}`] : []),
    ...(surfaces.borderRadii?.length ? [`- **Border Radii**: ${surfaces.borderRadii.join(', ')}`] : []),
    ...(surfaces.borders?.length ? [`- **Borders**: ${surfaces.borders.join(' | ')}`] : []),
    ...(surfaces.gradients?.length ? [`- **Gradients**: ${surfaces.gradients.join(' | ')}`] : []),
    ...(surfaces.shadows?.length ? [`- **Shadows**: ${surfaces.shadows.join(' | ')}`] : []),
    ...(surfaces.backdropFilters?.length
      ? [`- **Backdrop Effects**: ${surfaces.backdropFilters.join(', ')}`]
      : []),
    ...(language === 'zh-CN'
      ? [
          ``,
          `- **回复语言**: 请用简洁明了的**简体中文**写一句简短说明，确保生成的图片中**完全没有任何文字或字母**。`,
        ]
      : []),
  ].join('\n');
}

/**
 * Produces an engineered, ready-to-paste AI Remix Prompt Package combining
 * user intent with exact grounded Design DNA tokens.
 */
export function generateRemixPrompt(
  record: CaptureRecord,
  userGoal: string,
  targetStack: RemixTargetStack = 'react-tailwind'
): string {
  const { dna } = record;
  const trimmedGoal =
    userGoal.trim() ||
    'Create a reusable modern UI component inspired by this visual design language.';

  const stackLabels: Record<RemixTargetStack, string> = {
    'react-tailwind': 'React + TypeScript + Tailwind CSS',
    'html-css': 'Semantic HTML5 + Modern CSS (Custom Properties)',
    'vue-tailwind': 'Vue 3 (<script setup lang="ts">) + Tailwind CSS',
  };

  const colorGroups = groupColorsByRole(dna.palette);
  const paletteLines = Object.entries(colorGroups).map(([role, tokens]) => {
    const formatted = tokens
      .slice(0, 4)
      .map((t) => {
        const val = t.alpha < 0.99 ? `${t.hex} (${t.rgbString})` : t.hex;
        return t.provenance === 'sampled-pixels' ? `${val} [sampled]` : val;
      })
      .join(', ');
    return `- **${role}**: ${formatted}`;
  });

  const typeLines = dna.typography.slice(0, 5).map((t) => {
    const lh = t.lineHeightRatio ? ` / lh ${t.lineHeightRatio}` : '';
    const ls = t.letterSpacing !== 'normal' ? `, tracking ${t.letterSpacing}` : '';
    return `- **${t.role}**: \`${t.primaryFont}\` ${t.fontSizePx}px / weight ${t.fontWeight}${lh}${ls}`;
  });

  const surfaceLines: string[] = [];
  if (dna.surfaces.borderRadii.length > 0) {
    surfaceLines.push(`- **Border Radii**: ${dna.surfaces.borderRadii.slice(0, 4).join(', ')}`);
  }
  if (dna.surfaces.borders.length > 0) {
    surfaceLines.push(`- **Borders**: ${dna.surfaces.borders.slice(0, 3).join(' | ')}`);
  }
  if (dna.surfaces.shadows.length > 0) {
    surfaceLines.push(`- **Elevation / Shadows**: ${dna.surfaces.shadows.slice(0, 2).join(' | ')}`);
  }
  if (dna.surfaces.backdropFilters.length > 0) {
    surfaceLines.push(`- **Backdrop Effects**: ${dna.surfaces.backdropFilters.slice(0, 2).join(', ')}`);
  }
  if (dna.surfaces.gradients.length > 0) {
    surfaceLines.push(`- **Gradients**: ${dna.surfaces.gradients.slice(0, 2).join(' | ')}`);
  }

  const traitLines = dna.traits.map((t) => `- **${t.label}** (${t.evidence})`);

  const failingContrast = dna.contrastChecks.filter((c) => !c.aaNormal);
  const a11yNote =
    failingContrast.length > 0
      ? `Note: ${failingContrast.length} captured text pair(s) had contrast below WCAG AA 4.5:1 (lowest ${failingContrast[0]!.ratio}:1). Preserve the aesthetic while ensuring >= 4.5:1 text contrast in the remixed UI.`
      : 'All measured text pairs pass WCAG AA contrast; maintain >= 4.5:1 text contrast.';

  const cssTokens = generateCssTokens(record);
  const spatialMap = buildSpatialVisualMap(record);
  const negativeRules = buildNegativeConstraints(record, spatialMap.rowCount);
  const faithful = record.roots.length > 0 ? generateFaithfulSnapshot(record) : null;
  const blueprintBlock = faithful
    ? formatBlueprintForPrompt(faithful, 7000)
    : generateSimplifiedHtml(record.roots, 3);

  return [
    `# Design Language Transfer Request (Generated by StyleLens)`,
    ``,
    `## 1. Build Goal`,
    `${trimmedGoal}`,
    ``,
    `**Target Stack**: ${stackLabels[targetStack]}`,
    `**Directive**: Replicate the EXACT format, layout hierarchy, font family, font sizes/weights, hex colors, spacing rhythm, borders, shadows, transforms, and visual effects from the X-Ray Spatial Layout Map and Verified 1-to-1 Blueprint below (98%+ fidelity target). Do **not** copy original brand names, copywriting, or unrelated site markup—replace ONLY the requested text/content while preserving the exact visual structure.`,
    ...(spatialMap.lines.length > 0
      ? [
          ``,
          `## 2. X-Ray Spatial Visual Layout Map`,
          ...spatialMap.lines,
        ]
      : []),
    ...(negativeRules.length > 0
      ? [
          ``,
          `### Strict Do-Not-Invent Rules`,
          ...negativeRules,
        ]
      : []),
    ``,
    `## 3. Extracted Design DNA`,
    `- **Visual Polarity**: ${dna.polarity}`,
    `- **Reference Capture**: ${dna.layout.dimensionsPx.width}×${dna.layout.dimensionsPx.height}px (${record.captureMode === 'visual-only' ? 'pixel-sampled visual reference' : `exact DOM + pixel hybrid`})`,
    ...(dna.layout.spacingGridBase
      ? [
          `- **Spacing Rhythm**: ${dna.layout.spacingGridBase}px base grid (observed scale: ${dna.layout.spacingScalePx.slice(0, 8).join('px, ')}px)`,
        ]
      : dna.layout.spacingScalePx.length > 0
        ? [`- **Observed Spacing**: ${dna.layout.spacingScalePx.slice(0, 8).join('px, ')}px`]
        : []),
    ``,
    `### Style Traits`,
    ...(traitLines.length > 0 ? traitLines : ['- Clean minimalist interface']),
    ``,
    `### Color Palette`,
    ...(paletteLines.length > 0 ? paletteLines : ['- Use extracted tokens below']),
    ``,
    `### Typography Hierarchy`,
    ...(typeLines.length > 0
      ? typeLines
      : ['- Not exposed via DOM (infer clean geometric sans pairing)']),
    ...(dna.fontStylesheetUrls && dna.fontStylesheetUrls.length > 0
      ? [`- **Webfont Sources**: ${dna.fontStylesheetUrls.join(', ')}`]
      : []),
    ``,
    `### Surfaces & Visual Effects`,
    ...(surfaceLines.length > 0 ? surfaceLines : ['- Flat surfaces with subtle framing']),
    ``,
    `### Accessibility Guardrail`,
    a11yNote,
    ``,
    `## 4. Ready-to-Use CSS Tokens`,
    '```css',
    cssTokens,
    '```',
    ``,
    `## 5. Verified 1-to-1 HTML + Scoped CSS Blueprint`,
    '```html',
    blueprintBlock,
    '```',
    ``,
    `## 6. Output Expectations`,
    `1. Implement the requested UI using the exact Design DNA tokens and 1-to-1 Blueprint above.`,
    `2. Keep layout responsive, accessible (keyboard & WCAG AA contrast), and free of placeholder TODOs.`,
    `3. Briefly list which extracted tokens (colors, typography, radius/shadow/glass traits) drove your design decisions.`,
  ].join('\n');
}
