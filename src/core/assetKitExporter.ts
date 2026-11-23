import { resolveBrandPalette } from '../ai/deterministicProvider';
import { extractFontFaceFamilyLower } from '../ai/responseParser';
import type { CaptureRecord, ColorToken, TypographyToken } from '../types/capture';
import {
  filterCapturedTypography,
  isArtworkOrPhotoLikeCapture,
  isImageSearchHostname,
  shouldSuppressHostFallbackFont,
} from './captureClassification';
import { contrastRatio, parseCssColor, rgbaToHex, type RgbaColor } from './color';

export type CrossSiteMixMode = 'A-colors-B-layout' | 'balanced' | 'A-layout-B-colors';

export interface ResolvedStyleProfile {
  displayWord: string;
  headingFontRaw: string;
  headingFontClean: string;
  headingFontStack: string;
  bodyFontClean: string;
  bodyFontStack: string;
  fontWeight: number;
  letterSpacing: string;
  textTransform: 'uppercase' | 'lowercase' | 'capitalize' | 'none';
  fontStretch: string;
  hasEmbeddedFont: boolean;
  isArtworkStyleMatch: boolean;
  embeddedFontRules: string[];
  canvasBg: string;
  cardSurface: string;
  cardIsDark: boolean;
  textColor: string;
  wordmarkCutoutColor: string;
  primaryAccent: string;
  secondaryAccent: string | null;
  borderColor: string;
  borderWidthPx: number;
  borderRadiusPx: number;
  gradientCss: string | null;
  textShadowCss: string | null;
  boxShadowCss: string | null;
}

export interface LocalAssetKit {
  profile: ResolvedStyleProfile;
  /** Layer 1: Full styled composite (background + typography) — editable 2-group SVG for Figma/Canva */
  compositeSvg: string;
  /** Layer 2: Isolated wordmark ONLY on transparent background — editable vector SVG */
  wordmarkSvg: string;
  /** Layer 3: Isolated clean background/frame ONLY (zero text) — editable vector SVG */
  backgroundSvg: string;
  /** Live interactive HTML preview snippet rendered inside `<iframe sandbox="" srcDoc>` */
  liveCompositeHtml: string;
  /** Clean standalone HTML/CSS for the isolated background/layout template */
  backgroundHtml: string;
  /** W3C Design Tokens Community Group (DTCG) JSON export (imports into Figma Tokens Studio) */
  w3cTokensJson: string;
  width: number;
  height: number;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeStyleBlockCss(css: string): string {
  // Valid in BOTH XML standalone SVG (Figma/Canva/new Image) AND HTML5 <iframe srcDoc>
  // (avoiding <![CDATA[ which HTML5 <style> treats as raw CSS syntax!)
  return css
    .replace(/<\/style/gi, '')
    .replace(/[<>]/g, '')
    .replace(/&/g, '');
}

function sanitizeInlineCssValue(val: string | null): string | null {
  if (!val) return null;
  return val.replace(/<\/style/gi, '').replace(/[<>]/g, '');
}

function cleanFontName(raw: string): string {
  return raw
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/^__/, '')
    .replace(/_[a-f0-9]{5,}$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFirstPx(cssVal: string | undefined, fallback: number): number {
  if (!cssVal) return fallback;
  const m = cssVal.match(/(\d+(?:\.\d+)?)px/i);
  if (!m?.[1]) return fallback;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? Math.max(0, Math.min(64, Math.round(n))) : fallback;
}

function parseBorderParts(
  borderShorthand: string | undefined,
  fallbackColor: string
): { widthPx: number; color: string } {
  if (!borderShorthand) return { widthPx: 1, color: fallbackColor };
  const widthPx = Math.max(1, Math.min(8, parseFirstPx(borderShorthand, 1)));
  const colorMatch = borderShorthand.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}\b/);
  const parsed = colorMatch ? parseCssColor(colorMatch[0]) : null;
  const color = parsed && parsed.a > 0.05 ? rgbaToHex(parsed, false) : fallbackColor;
  return { widthPx, color };
}

function pickDefaultDisplayWord(record: CaptureRecord, customWord: string): string {
  const trimmed = customWord.trim();
  if (trimmed) return trimmed.slice(0, 64);

  const suppressHost = shouldSuppressHostFallbackFont(record);
  if (!suppressHost) {
    const firstHeading = record.dna.typography.find(
      (t) => (t.role === 'display' || t.role === 'heading') && t.sampleText.trim().length > 0
    );
    if (firstHeading) return firstHeading.sampleText.trim().slice(0, 36);
  }

  if (isImageSearchHostname(record.page.hostname)) {
    return 'StyleLens';
  }

  const hostBrand = record.page.hostname
    .replace(/^www\./i, '')
    .split('.')[0];
  if (hostBrand && hostBrand.length >= 2) {
    return hostBrand.charAt(0).toUpperCase() + hostBrand.slice(1);
  }
  return 'StyleLens';
}

function applyTextCase(text: string, transform: ResolvedStyleProfile['textTransform']): string {
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize') {
    return text.replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return text;
}

function wrapLines(text: string, maxCharsPerLine: number): string[] {
  if (text.length <= maxCharsPerLine || !text.includes(' ')) {
    return [text];
  }
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine || !current) {
      current = candidate;
    } else if (lines.length < 2) {
      lines.push(current);
      current = word;
    } else {
      // Never drop remaining words — append onto final (3rd) line so auto-sizing shrinks cleanly to fit!
      current = candidate;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

/**
 * Resolves a unified, contrast-safe typography, color, and surface profile from a capture
 * (including embedded base64 `@font-face` binaries and host-page fallback typography).
 */
export function resolveAssetStyleProfile(
  record: CaptureRecord,
  customWord: string,
  secondary?: CaptureRecord | null
): ResolvedStyleProfile {
  const { dna } = record;
  const brand = resolveBrandPalette(record, secondary);
  const isArtwork = isArtworkOrPhotoLikeCapture(record);
  const suppressHostFont = shouldSuppressHostFallbackFont(record);

  const cleanedDomTypography = filterCapturedTypography(record, dna.typography);
  const effectiveTypography: TypographyToken[] = suppressHostFont
    ? []
    : cleanedDomTypography.length > 0
      ? cleanedDomTypography
      : (dna.pageFallbackTypography ?? []);
  const isArtworkStyleMatch =
    (isArtwork || suppressHostFont) && effectiveTypography.length === 0;
  const headingToken =
    effectiveTypography.find((t) => t.role === 'display' || t.role === 'heading') ??
    effectiveTypography[0];
  const bodyToken =
    effectiveTypography.find((t) => t.role === 'body') ?? effectiveTypography[1] ?? headingToken;

  const headingFontRaw = headingToken
    ? headingToken.primaryFont.replace(/^["'\s]+|["'\s]+$/g, '').trim()
    : 'system-ui';
  const headingFontClean = isArtworkStyleMatch
    ? 'Image Style'
    : headingToken
      ? cleanFontName(headingFontRaw) || headingFontRaw
      : 'System UI';

  const stackParts: string[] = [];
  if (headingToken && headingFontRaw) stackParts.push(`"${headingFontRaw}"`);
  if (headingToken && headingFontClean.toLowerCase() !== headingFontRaw.toLowerCase()) {
    stackParts.push(`"${headingFontClean}"`);
  }
  if (headingToken?.fontStack) stackParts.push(headingToken.fontStack);
  const headingFontStack =
    stackParts.length > 0 ? stackParts.join(', ') : '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  const bodyFontRaw = bodyToken
    ? bodyToken.primaryFont.replace(/^["'\s]+|["'\s]+$/g, '').trim()
    : headingFontRaw;
  const bodyFontClean = bodyToken ? cleanFontName(bodyFontRaw) || headingFontClean : headingFontClean;
  const bodyFontStack = bodyToken?.fontStack ? `"${bodyFontClean}", ${bodyToken.fontStack}` : headingFontStack;

  // Collect matching embedded base64 @font-face rules so SVGs & PNGs render the REAL captured font!
  const targetLowers = new Set([
    headingFontClean.toLowerCase(),
    headingFontRaw.toLowerCase(),
    bodyFontClean.toLowerCase(),
  ]);
  const embeddedFontRules = (dna.fontFaceRules ?? []).filter((rule) => {
    if (!/url\(\s*["']?data:(?:font\/|application\/)/i.test(rule)) return false;
    const fam = extractFontFaceFamilyLower(rule);
    return fam.length > 0 && targetLowers.has(fam);
  });

  const rootHeadingNode = suppressHostFont
    ? undefined
    : record.roots
        .flatMap((r) => [r, ...r.children])
        .find((n) => n.tag === 'h1' || n.tag === 'h2' || n.styles.textTransform === 'uppercase');

  const rawTransform = rootHeadingNode?.styles.textTransform?.toLowerCase();
  const textTransform: ResolvedStyleProfile['textTransform'] =
    rawTransform === 'uppercase' || rawTransform === 'lowercase' || rawTransform === 'capitalize'
      ? rawTransform
      : 'none';

  const fontWeight = headingToken?.fontWeight ?? 700;
  const letterSpacing =
    headingToken?.letterSpacing && headingToken.letterSpacing !== 'normal'
      ? headingToken.letterSpacing
      : textTransform === 'uppercase'
        ? '0.04em'
        : '-0.02em';
  const fontStretch = rootHeadingNode?.styles.fontStretch ?? 'normal';

  const hasExtractedRadius = dna.surfaces.borderRadii.length > 0;
  const isFlatDom = record.roots.length > 0 && !isArtwork && !hasExtractedRadius;
  const borderRadiusPx = hasExtractedRadius
    ? parseFirstPx(dna.surfaces.borderRadii[0], 10)
    : isFlatDom
      ? 0
      : 10;

  const borderFallback = brand.secondaryAccent ?? brand.primaryAccent;
  const { widthPx: borderWidthPx, color: borderColor } = parseBorderParts(
    dna.surfaces.borders[0],
    borderFallback
  );

  // Pick a vivid, recognizable color for the transparent-background wordmark cutout
  const textBgParsed = parseCssColor(brand.cardSurface) ?? { r: 16, g: 16, b: 20, a: 1 };
  const exactTextColor = brand.textPrimary;
  const accentParsed = parseCssColor(brand.primaryAccent);
  const accentVisibleOnCard =
    accentParsed !== null && contrastRatio(accentParsed, textBgParsed) >= 3.2;

  const wordmarkCutoutColor =
    isArtwork && accentParsed && brand.primaryAccent !== '#FFFFFF' && brand.primaryAccent !== '#09090B'
      ? brand.primaryAccent
      : accentVisibleOnCard && isArtwork
        ? brand.primaryAccent
        : exactTextColor;

  const rawDisplayWord = pickDefaultDisplayWord(record, customWord);

  return {
    displayWord: applyTextCase(rawDisplayWord, textTransform),
    headingFontRaw,
    headingFontClean,
    headingFontStack,
    bodyFontClean,
    bodyFontStack,
    fontWeight,
    letterSpacing,
    textTransform,
    fontStretch,
    hasEmbeddedFont: !isArtworkStyleMatch && embeddedFontRules.length > 0,
    isArtworkStyleMatch,
    embeddedFontRules: isArtworkStyleMatch ? [] : embeddedFontRules,
    canvasBg: brand.canvasBg,
    cardSurface: brand.cardSurface,
    cardIsDark: brand.cardIsDark,
    textColor: exactTextColor,
    wordmarkCutoutColor,
    primaryAccent: brand.primaryAccent,
    secondaryAccent: brand.secondaryAccent,
    borderColor,
    borderWidthPx,
    borderRadiusPx,
    gradientCss: sanitizeInlineCssValue(dna.surfaces.gradients[0] ?? null),
    textShadowCss: sanitizeInlineCssValue(dna.surfaces.textShadows[0] ?? null),
    boxShadowCss: sanitizeInlineCssValue(dna.surfaces.shadows[0] ?? null),
  };
}

interface ParsedSvgGradient {
  x1: string;
  y1: string;
  x2: string;
  y2: string;
  stops: Array<{ offset: string; color: string; opacity: number }>;
}

function parseCssLinearGradientToSvg(gradientCss: string | null): ParsedSvgGradient | null {
  if (!gradientCss || !/gradient\(/i.test(gradientCss)) return null;
  const colorTokens = gradientCss.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}\b/g);
  if (!colorTokens || colorTokens.length < 2) return null;

  const parsedColors = colorTokens
    .map((tok) => parseCssColor(tok))
    .filter((c): c is RgbaColor => c !== null);
  if (parsedColors.length < 2) return null;

  let x1 = '0%';
  let y1 = '0%';
  let x2 = '100%';
  let y2 = '100%';
  const lower = gradientCss.toLowerCase();
  if (lower.includes('to right') || /\b90deg\b/.test(lower)) {
    x1 = '0%'; y1 = '50%'; x2 = '100%'; y2 = '50%';
  } else if (lower.includes('to bottom') || /\b180deg\b/.test(lower)) {
    x1 = '50%'; y1 = '0%'; x2 = '50%'; y2 = '100%';
  } else if (lower.includes('to left') || /\b270deg\b/.test(lower)) {
    x1 = '100%'; y1 = '50%'; x2 = '0%'; y2 = '50%';
  }

  const stops = parsedColors.slice(0, 5).map((rgba, idx, arr) => ({
    offset: `${Math.round((idx / Math.max(1, arr.length - 1)) * 100)}%`,
    color: rgbaToHex(rgba, false),
    opacity: Number(rgba.a.toFixed(2)),
  }));

  return { x1, y1, x2, y2, stops };
}

function buildTextShadowFilterSvg(id: string, shadowCss: string | null): string {
  if (!shadowCss) return '';
  const pxVals = shadowCss.match(/-?\d+(?:\.\d+)?px/g) ?? [];
  const dx = pxVals[0] ? Number.parseFloat(pxVals[0]) : 2;
  const dy = pxVals[1] ? Number.parseFloat(pxVals[1]) : 2;
  const blur = pxVals[2] ? Math.max(0, Number.parseFloat(pxVals[2]) / 2) : 0;
  const colorMatch = shadowCss.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}\b/);
  const parsed = colorMatch ? parseCssColor(colorMatch[0]) : null;
  const floodColor = parsed ? rgbaToHex(parsed, false) : '#000000';
  const floodOpacity = parsed ? Number(parsed.a.toFixed(2)) : 0.75;

  return `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${blur}" flood-color="${floodColor}" flood-opacity="${floodOpacity}" />
  </filter>`;
}

function computeSvgFontSize(
  lines: string[],
  boxWidth: number,
  boxHeight: number,
  letterSpacingCss: string
): number {
  const longest = Math.max(1, ...lines.map((l) => l.length));
  let trackingFactor = 0.66;
  const emMatch = letterSpacingCss.match(/(\d+(?:\.\d+)?)em/i);
  if (emMatch?.[1]) {
    trackingFactor += Math.max(0, Number.parseFloat(emMatch[1]));
  } else {
    const pxMatch = letterSpacingCss.match(/(\d+(?:\.\d+)?)px/i);
    if (pxMatch?.[1]) {
      trackingFactor += Math.min(0.4, Number.parseFloat(pxMatch[1]) / 32);
    }
  }
  const widthBased = Math.floor((boxWidth * 0.84) / Math.max(3.5, longest * trackingFactor));
  const heightBased = Math.floor((boxHeight * 0.58) / Math.max(1, lines.length));
  return Math.max(13, Math.min(64, widthBased, heightBased));
}

function buildWordmarkTextGroup(
  profile: ResolvedStyleProfile,
  width: number,
  height: number,
  fillColor: string,
  filterId?: string
): string {
  const lines = wrapLines(profile.displayWord, 20);
  const fontSize = computeSvgFontSize(lines, width, height, profile.letterSpacing);
  const lineHeight = Math.round(fontSize * 1.16);
  const totalTextHeight = lineHeight * lines.length;
  const startY = Math.round((height - totalTextHeight) / 2 + fontSize * 0.84);
  const filterAttr = filterId ? ` filter="url(#${filterId})"` : '';

  const tspans = lines
    .map((line, idx) => {
      const y = startY + idx * lineHeight;
      return `<tspan x="${Math.round(width / 2)}" y="${y}">${escapeXml(line)}</tspan>`;
    })
    .join('');

  return `<g id="wordmark-layer">
    <text
      x="${Math.round(width / 2)}"
      y="${startY}"
      text-anchor="middle"
      fill="${escapeXml(fillColor)}"
      font-family="${escapeXml(profile.headingFontStack)}"
      font-size="${fontSize}"
      font-weight="${profile.fontWeight}"
      letter-spacing="${escapeXml(profile.letterSpacing)}"${filterAttr}
    >${tspans}</text>
  </g>`;
}

function buildBackgroundRectGroup(
  profile: ResolvedStyleProfile,
  width: number,
  height: number,
  gradId: string | null
): string {
  const inset = Math.max(2, Math.ceil(profile.borderWidthPx / 2));
  const rx = Math.min(profile.borderRadiusPx, Math.floor(Math.min(width, height) / 4));
  const fillAttr = gradId ? `url(#${gradId})` : escapeXml(profile.cardSurface);
  const accentBarH = 4;

  return `<g id="background-layer">
    <rect x="0" y="0" width="${width}" height="${height}" rx="${rx}" fill="${escapeXml(profile.canvasBg)}" />
    <rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" rx="${Math.max(0, rx - 1)}" fill="${fillAttr}" stroke="${escapeXml(profile.borderColor)}" stroke-width="${profile.borderWidthPx}" />
    <rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${accentBarH}" rx="${Math.min(2, rx)}" fill="${escapeXml(profile.primaryAccent)}" />
  </g>`;
}

/**
 * Generates the complete 3-Layer Local Asset Kit (Composite SVG, Isolated Wordmark SVG,
 * Isolated Background SVG, Live HTML Preview, Standalone Background HTML, and W3C DTCG JSON).
 */
export function buildLocalAssetKit(
  record: CaptureRecord,
  customWord: string,
  blendedWithHostname?: string
): LocalAssetKit {
  const profile = resolveAssetStyleProfile(record, customWord, null);
  const width = 640;
  const height = 220;

  const fontStyleBlock =
    profile.embeddedFontRules.length > 0
      ? `<style type="text/css">\n${sanitizeStyleBlockCss(profile.embeddedFontRules.join('\n'))}\n</style>`
      : '';

  const parsedGrad = parseCssLinearGradientToSvg(profile.gradientCss);
  const gradDef = parsedGrad
    ? `<linearGradient id="sl-bg-grad" x1="${parsedGrad.x1}" y1="${parsedGrad.y1}" x2="${parsedGrad.x2}" y2="${parsedGrad.y2}">
      ${parsedGrad.stops
        .map(
          (s) =>
            `<stop offset="${s.offset}" stop-color="${s.color}" stop-opacity="${s.opacity}" />`
        )
        .join('\n      ')}
    </linearGradient>`
    : '';

  const shadowDef = profile.textShadowCss
    ? buildTextShadowFilterSvg('sl-text-shadow', profile.textShadowCss)
    : '';
  const filterId = shadowDef ? 'sl-text-shadow' : undefined;

  // Pick card text color that guarantees >= 4.5:1 contrast even over a parsed gradient!
  let compositeTextColor = profile.textColor;
  let useGradOnBg = Boolean(parsedGrad);
  if (parsedGrad) {
    const fgParsed = parseCssColor(compositeTextColor);
    const passesAllStops = (fg: RgbaColor) =>
      parsedGrad.stops.every((s) => {
        const sc = parseCssColor(s.color);
        return !sc || s.opacity < 0.45 || contrastRatio(fg, sc) >= 4.5;
      });
    if (!fgParsed || !passesAllStops(fgParsed)) {
      const white = { r: 250, g: 250, b: 250, a: 1 };
      const black = { r: 9, g: 9, b: 11, a: 1 };
      if (passesAllStops(white)) compositeTextColor = '#FAFAFA';
      else if (passesAllStops(black)) compositeTextColor = '#09090B';
      else useGradOnBg = false;
    }
  }

  // Layer 2: Isolated Editable Wordmark SVG (transparent background — ready for Figma/Canva/Video!)
  const wordmarkDefs = [fontStyleBlock, shadowDef].filter(Boolean).join('\n    ');
  const wordmarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(profile.displayWord)}">
  ${wordmarkDefs ? `<defs>\n    ${wordmarkDefs}\n  </defs>` : ''}
  ${buildWordmarkTextGroup(profile, width, height, profile.wordmarkCutoutColor, filterId)}
</svg>`;

  // Layer 3: Isolated Background / Frame SVG (zero text — ready as reusable badge/card template!)
  const bgDefs = [gradDef].filter(Boolean).join('\n    ');
  const backgroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Captured background style from ${escapeXml(record.page.hostname)}">
  ${bgDefs ? `<defs>\n    ${bgDefs}\n  </defs>` : ''}
  ${buildBackgroundRectGroup(profile, width, height, parsedGrad ? 'sl-bg-grad' : null)}
</svg>`;

  // Layer 1: Full Multi-Layer Composite SVG (2 clean Figma-editable <g> layers: background + wordmark)
  const compositeDefs = [fontStyleBlock, useGradOnBg ? gradDef : '', shadowDef]
    .filter(Boolean)
    .join('\n    ');
  const compositeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(profile.displayWord)} styled like ${escapeXml(record.page.hostname)}">
  ${compositeDefs ? `<defs>\n    ${compositeDefs}\n  </defs>` : ''}
  ${buildBackgroundRectGroup(profile, width, height, useGradOnBg ? 'sl-bg-grad' : null)}
  ${buildWordmarkTextGroup(profile, width, height, compositeTextColor, filterId)}
</svg>`;

  // Live HTML preview for Step 2 ("Type Your Word" real-time X-Ray preview inside Side Panel)
  const displayLines = wrapLines(profile.displayWord, 22);
  const liveFontPx = Math.max(18, Math.min(34, Math.floor(280 / Math.max(5, Math.max(...displayLines.map((l) => l.length)) * 0.65))));
  const liveCompositeHtml = `<style>
.sl-live-word-wrap {
  width: 100%;
  min-height: 122px;
  padding: 18px 16px;
  border-radius: ${profile.borderRadiusPx}px;
  background-color: ${profile.cardSurface};
  ${useGradOnBg && profile.gradientCss ? `background-image: ${profile.gradientCss};` : ''}
  border: ${profile.borderWidthPx}px solid ${profile.borderColor};
  border-top: 3px solid ${profile.primaryAccent};
  ${profile.boxShadowCss ? `box-shadow: ${profile.boxShadowCss};` : ''}
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
}
.sl-live-word-text {
  margin: 0;
  font-family: ${profile.headingFontStack};
  font-size: ${liveFontPx}px;
  font-weight: ${profile.fontWeight};
  font-stretch: ${profile.fontStretch};
  letter-spacing: ${profile.letterSpacing};
  line-height: 1.12;
  color: ${compositeTextColor};
  ${profile.textShadowCss ? `text-shadow: ${profile.textShadowCss};` : ''}
  word-break: break-word;
}
.sl-live-word-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.72;
  color: ${compositeTextColor};
}
.sl-live-word-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: ${profile.primaryAccent};
}
</style>
<section class="sl-live-word-wrap">
  <h2 class="sl-live-word-text">${escapeXml(profile.displayWord)}</h2>
  <div class="sl-live-word-meta">
    <span class="sl-live-word-dot"></span>
    <span>${
      profile.isArtworkStyleMatch
        ? 'IMAGE STYLE · MATCHED BY AI'
        : `${escapeXml(profile.headingFontClean)} · ${profile.hasEmbeddedFont ? 'EXACT FONT' : `${profile.fontWeight}`}`
    }</span>
  </div>
</section>`;

  const backgroundHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>StyleLens Background Layer — ${escapeXml(record.page.hostname)}</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: ${profile.canvasBg}; padding: 24px; }
.sl-bg-template {
  width: min(100%, 640px);
  min-height: 220px;
  border-radius: ${profile.borderRadiusPx}px;
  background-color: ${profile.cardSurface};
  ${profile.gradientCss ? `background-image: ${profile.gradientCss};` : ''}
  border: ${profile.borderWidthPx}px solid ${profile.borderColor};
  border-top: 3px solid ${profile.primaryAccent};
  ${profile.boxShadowCss ? `box-shadow: ${profile.boxShadowCss};` : ''}
}
</style>
</head>
<body>
  <div class="sl-bg-template" aria-label="Reusable background surface from ${escapeXml(record.page.hostname)}"></div>
</body>
</html>`;

  const w3cTokensJson = generateW3cDesignTokensJson(record, blendedWithHostname);

  return {
    profile,
    compositeSvg,
    wordmarkSvg,
    backgroundSvg,
    liveCompositeHtml,
    backgroundHtml,
    w3cTokensJson,
    width,
    height,
  };
}

/**
 * Generates an industry-standard W3C Design Tokens Community Group (DTCG) JSON file
 * ready to import into Figma Tokens Studio, Style Dictionary, or enterprise design systems.
 */
export function generateW3cDesignTokensJson(
  record: CaptureRecord,
  blendedWithHostname?: string
): string {
  const { dna } = record;
  const colorGroup: Record<string, { $value: string; $type: 'color'; $description: string }> = {};
  const roleCount: Record<string, number> = {};

  for (const token of dna.palette.slice(0, 12)) {
    const idx = (roleCount[token.role] ?? 0) + 1;
    roleCount[token.role] = idx;
    const key = idx === 1 ? token.role : `${token.role}-${idx}`;
    colorGroup[key] = {
      $value: token.alpha < 0.99 ? token.rgbString : token.hex,
      $type: 'color',
      $description: `${token.provenance === 'exact-dom' ? 'Exact DOM' : 'Sampled pixel'} ${token.role} color from ${record.page.hostname}`,
    };
  }

  const effectiveTypography = shouldSuppressHostFallbackFont(record)
    ? []
    : dna.typography.length > 0
      ? dna.typography
      : (dna.pageFallbackTypography ?? []);
  const typographyGroup: Record<
    string,
    {
      $type: 'typography';
      $value: {
        fontFamily: string;
        fontSize: string;
        fontWeight: number;
        letterSpacing: string;
        lineHeight: string | number;
      };
    }
  > = {};

  for (const t of effectiveTypography.slice(0, 4)) {
    const key = typographyGroup[t.role] ? `${t.role}-${t.fontWeight}` : t.role;
    typographyGroup[key] = {
      $type: 'typography',
      $value: {
        fontFamily: cleanFontName(t.primaryFont) || t.primaryFont,
        fontSize: `${t.fontSizePx}px`,
        fontWeight: t.fontWeight,
        letterSpacing: t.letterSpacing || '0px',
        lineHeight: t.lineHeightPx ? `${t.lineHeightPx}px` : (t.lineHeightRatio ?? 1.4),
      },
    };
  }

  const radiusGroup: Record<string, { $value: string; $type: 'dimension' }> = {};
  dna.surfaces.borderRadii.slice(0, 4).forEach((r, i) => {
    radiusGroup[`radius-${i + 1}`] = { $value: r, $type: 'dimension' };
  });

  const spacingGroup: Record<string, { $value: string; $type: 'dimension' }> = {};
  if (dna.layout.spacingGridBase) {
    spacingGroup['grid-base'] = { $value: `${dna.layout.spacingGridBase}px`, $type: 'dimension' };
  }
  dna.layout.spacingScalePx.slice(0, 6).forEach((px, i) => {
    spacingGroup[`space-${i + 1}`] = { $value: `${px}px`, $type: 'dimension' };
  });

  const shadowGroup: Record<string, { $value: string; $type: 'shadow' }> = {};
  dna.surfaces.shadows.slice(0, 3).forEach((s, i) => {
    shadowGroup[`elevation-${i + 1}`] = { $value: s, $type: 'shadow' };
  });

  const payload = {
    $schema: 'https://tr.designtokens.org/format/',
    color: colorGroup,
    typography: typographyGroup,
    dimension: {
      radius: radiusGroup,
      spacing: spacingGroup,
    },
    ...(Object.keys(shadowGroup).length > 0 ? { shadow: shadowGroup } : {}),
    $extensions: {
      stylelens: {
        sourceUrl: record.page.url,
        hostname: record.page.hostname,
        polarity: dna.polarity,
        captureMode: record.captureMode,
        ...(blendedWithHostname ? { blendedWith: blendedWithHostname } : {}),
      },
    },
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Merges two captured websites into a single unified virtual CaptureRecord so users
 * can mix "Colors & Font from Site A + Layout & Frame from Site B" (or vice versa)
 * and immediately preview, copy for Figma, or export W3C tokens & SVG/PNG assets!
 */
export function mixCaptureRecords(
  primary: CaptureRecord,
  secondary: CaptureRecord,
  mode: CrossSiteMixMode
): CaptureRecord {
  const colorSource = mode === 'A-layout-B-colors' ? secondary : primary;
  const layoutSource = mode === 'A-layout-B-colors' ? primary : secondary;

  let mergedPalette: ColorToken[];
  let mergedPolarity = colorSource.dna.polarity;
  const suppressColorSourceHost = shouldSuppressHostFallbackFont(colorSource);
  let mergedTypography = suppressColorSourceHost
    ? []
    : colorSource.dna.typography.length > 0
      ? colorSource.dna.typography
      : (colorSource.dna.pageFallbackTypography ?? []);
  let mergedSurfaces = layoutSource.dna.surfaces;

  if (mode === 'balanced') {
    // Take dominant backdrop/polarity from Site A + vibrant primary accent & display typography from Site B
    const aBackdrop = primary.dna.palette.filter(
      (c) => c.role === 'background' || c.role === 'surface' || c.role === 'text' || c.role === 'border'
    );
    const bAccents = secondary.dna.palette
      .filter((c) => c.role === 'accent' || c.role === 'sampled')
      .map((c) => ({ ...c, role: 'accent' as const }));
    const aSecondaryAccents = primary.dna.palette
      .filter((c) => c.role === 'accent' || c.role === 'sampled')
      .map((c) => ({ ...c, role: 'sampled' as const }));
    const seen = new Set<string>();
    mergedPalette = [...aBackdrop, ...bAccents, ...aSecondaryAccents]
      .filter((c) => {
        const k = `${c.hex}:${c.role}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 12);
    mergedPolarity = primary.dna.polarity;
    const bHeadingRaw =
      secondary.dna.typography.find((t) => t.role === 'display' || t.role === 'heading') ??
      secondary.dna.typography[0] ??
      secondary.dna.pageFallbackTypography?.[0];
    const aBodyRaw =
      primary.dna.typography.find((t) => t.role === 'body') ??
      primary.dna.pageFallbackTypography?.find((t) => t.role === 'body') ??
      primary.dna.typography[0];
    // Explicitly assign display/body roles so Site B's headline font always leads in balanced mode
    const bHeading: TypographyToken | undefined = bHeadingRaw
      ? { ...bHeadingRaw, role: 'display' }
      : undefined;
    const aBody: TypographyToken | undefined = aBodyRaw
      ? { ...aBodyRaw, role: 'body' }
      : undefined;
    mergedTypography = [bHeading, aBody].filter((t): t is TypographyToken => Boolean(t));
    mergedSurfaces = {
      borderRadii:
        secondary.dna.surfaces.borderRadii.length > 0
          ? secondary.dna.surfaces.borderRadii
          : primary.dna.surfaces.borderRadii,
      borders:
        primary.dna.surfaces.borders.length > 0
          ? primary.dna.surfaces.borders
          : secondary.dna.surfaces.borders,
      shadows:
        secondary.dna.surfaces.shadows.length > 0
          ? secondary.dna.surfaces.shadows
          : primary.dna.surfaces.shadows,
      textShadows: primary.dna.surfaces.textShadows.length > 0
        ? primary.dna.surfaces.textShadows
        : secondary.dna.surfaces.textShadows,
      transforms: primary.dna.surfaces.transforms,
      clipPaths: primary.dna.surfaces.clipPaths,
      gradients:
        secondary.dna.surfaces.gradients.length > 0
          ? secondary.dna.surfaces.gradients
          : primary.dna.surfaces.gradients,
      backdropFilters:
        secondary.dna.surfaces.backdropFilters.length > 0
          ? secondary.dna.surfaces.backdropFilters
          : primary.dna.surfaces.backdropFilters,
    };
  } else {
    mergedPalette = colorSource.dna.palette;
  }

  const mergedFontFaceRules = Array.from(
    new Set([...(primary.dna.fontFaceRules ?? []), ...(secondary.dna.fontFaceRules ?? [])])
  ).slice(0, 48);

  const mergedFontSheetUrls = Array.from(
    new Set([
      ...(primary.dna.fontStylesheetUrls ?? []),
      ...(secondary.dna.fontStylesheetUrls ?? []),
    ])
  ).slice(0, 6);

  const preserveArtworkPalette =
    mode === 'balanced'
      ? Boolean(primary.containsGraphicArtwork)
      : Boolean(colorSource.containsGraphicArtwork);

  return {
    ...primary,
    id: `mix-${primary.id}-${secondary.id}-${mode}`,
    page: {
      url: primary.page.url,
      hostname: `${primary.page.hostname} × ${secondary.page.hostname}`,
      title: `Mixed Style: ${primary.page.hostname} + ${secondary.page.hostname}`,
    },
    containsGraphicArtwork: preserveArtworkPalette,
    dna: {
      ...primary.dna,
      polarity: mergedPolarity,
      palette: mergedPalette,
      typography: mergedTypography,
      pageFallbackTypography:
        colorSource.dna.pageFallbackTypography ?? secondary.dna.pageFallbackTypography ?? [],
      layout: layoutSource.dna.layout,
      surfaces: mergedSurfaces,
      fontFaceRules: mergedFontFaceRules,
      fontStylesheetUrls: mergedFontSheetUrls,
      summaryText: `Mixed ${primary.page.hostname} × ${secondary.page.hostname} (${mode})`,
    },
  };
}

/**
 * Rasterizes any standalone SVG (with embedded base64 `@font-face` rules) into a crisp
 * Retina 2x transparent `image/png` Blob completely offline in the browser!
 */
export function svgStringToPngBlob(
  svgString: string,
  width: number,
  height: number,
  scale = 2
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();

    img.onload = async () => {
      try {
        if (typeof img.decode === 'function') {
          await img.decode().catch(() => {});
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('Canvas 2D context unavailable'));
          return;
        }
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        canvas.toBlob((pngBlob) => {
          if (pngBlob) resolve(pngBlob);
          else reject(new Error('Failed to export PNG blob'));
        }, 'image/png');
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to rasterize SVG into PNG'));
    };

    img.src = url;
  });
}
