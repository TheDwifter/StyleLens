import {
  isArtworkOrPhotoLikeCapture,
  shouldSuppressHostFallbackFont,
} from '../core/captureClassification';
import {
  colorDistance,
  contrastRatio,
  isDarkColor,
  isNeutralColor,
  parseCssColor,
  type RgbaColor,
} from '../core/color';
import { evaluateRemixFidelity } from '../core/fidelityCritic';
import {
  generateCssTokens,
  generateDesignSpecJson,
  generateRemixPrompt,
  generateSimplifiedHtml,
  generateTailwindTheme,
} from '../core/specGenerator';
import type { CaptureRecord, ColorToken, TypographyToken } from '../types/capture';
import { buildPreviewFontAssets, buildPreviewSrcDoc } from './responseParser';
import type {
  AIProvider,
  DesignInfluenceItem,
  ProviderCapability,
  RemixOutput,
  RemixRequest,
} from './types';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseOpaqueOrFallback(cssColor: string, fallback: RgbaColor): RgbaColor {
  const parsed = parseCssColor(cssColor);
  if (!parsed || parsed.a <= 0.05) return fallback;
  return parsed;
}

function colorChroma(rgba: RgbaColor): number {
  return Math.max(rgba.r, rgba.g, rgba.b) - Math.min(rgba.r, rgba.g, rgba.b);
}

function rgbaCssAlpha(rgba: RgbaColor, alpha: number): string {
  return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${alpha.toFixed(2)})`;
}

/**
 * Resolves the true visual backdrop, surface, primary chromatic brand accent, and
 * secondary chromatic accent — trusting sampled pixels on artwork/media captures so
 * an invisible white `<body>` wrapper never turns a black/red/gold graphic into a white card!
 */
export function resolveBrandPalette(
  record: CaptureRecord,
  secondary?: CaptureRecord | null
): {
  canvasBg: string;
  cardSurface: string;
  cardIsDark: boolean;
  primaryAccent: string;
  secondaryAccent: string | null;
  primaryAccentRgba: RgbaColor;
  secondaryAccentRgba: RgbaColor | null;
  textPrimary: string;
  ctaText: string;
  polarityLabel: 'dark' | 'light';
} {
  const paletteSource = secondary ? [...secondary.dna.palette, ...record.dna.palette] : record.dna.palette;
  const preferVisual =
    isArtworkOrPhotoLikeCapture(record) ||
    record.dna.typography.length === 0;

  const sampledSorted = [...record.dna.palette]
    .filter((c) => c.provenance === 'sampled-pixels')
    .sort((a, b) => (b.visualSharePercent ?? 0) - (a.visualSharePercent ?? 0));

  const pickRole = (roles: ReadonlyArray<string>, tokens: ColorToken[]): ColorToken | undefined => {
    for (const role of roles) {
      const found = tokens.find((c) => c.role === role);
      if (found) return found;
    }
    return undefined;
  };

  // 1. Resolve true dominant canvas background
  let rawBg: string;
  if (preferVisual && sampledSorted[0]) {
    rawBg = sampledSorted[0].hex;
  } else {
    const bgToken = pickRole(['background', 'surface', 'sampled'], secondary?.dna.palette ?? record.dna.palette);
    rawBg = bgToken
      ? bgToken.alpha < 0.99
        ? bgToken.rgbString
        : bgToken.hex
      : record.dna.polarity === 'light'
        ? '#F4F4F5'
        : '#09090B';
  }

  const bgRgba = parseOpaqueOrFallback(rawBg, { r: 10, g: 10, b: 12, a: 1 });
  const bgIsDark = isDarkColor(bgRgba);

  // 2. Resolve distinct card surface
  const exactSurfaceToken = !preferVisual ? pickRole(['surface', 'background'], record.dna.palette) : undefined;
  const rawSurface = exactSurfaceToken
    ? exactSurfaceToken.alpha < 0.99
      ? exactSurfaceToken.rgbString
      : exactSurfaceToken.hex
    : rawBg;
  const surfParsed = parseCssColor(rawSurface);
  const sameAsBg =
    !surfParsed ||
    surfParsed.a < 0.15 ||
    (Math.abs(bgRgba.r - surfParsed.r) < 12 &&
      Math.abs(bgRgba.g - surfParsed.g) < 12 &&
      Math.abs(bgRgba.b - surfParsed.b) < 12);

  let canvasBg = rawBg;
  let cardSurface = rawSurface;
  let cardIsDark = surfParsed ? isDarkColor(surfParsed) : bgIsDark;

  if (sameAsBg) {
    if (bgIsDark) {
      canvasBg = rawBg;
      cardSurface = `rgb(${Math.min(255, bgRgba.r + 16)}, ${Math.min(255, bgRgba.g + 16)}, ${Math.min(255, bgRgba.b + 20)})`;
      cardIsDark = true;
    } else {
      canvasBg = '#ECEEF2';
      cardSurface = '#FFFFFF';
      cardIsDark = false;
    }
  }

  // 3. Extract the 2 strongest distinct chromatic brand accents (e.g., Bones Red + Gold, H&M Red, Stripe Indigo)
  const chromaticCandidates = paletteSource
    .map((token) => {
      const rgba = parseCssColor(token.hex);
      return rgba ? { token, rgba, chroma: colorChroma(rgba) } : null;
    })
    .filter((entry): entry is { token: ColorToken; rgba: RgbaColor; chroma: number } =>
      entry !== null && !isNeutralColor(entry.rgba) && entry.chroma >= 28
    )
    .sort((a, b) => {
      // Favor exact DOM accents first, then highest visual chroma
      const aBoost = a.token.role === 'accent' ? 40 : 0;
      const bBoost = b.token.role === 'accent' ? 40 : 0;
      return b.chroma + bBoost - (a.chroma + aBoost);
    });

  const primaryAccentEntry = chromaticCandidates[0] ?? null;
  const secondaryAccentEntry =
    primaryAccentEntry
      ? chromaticCandidates.find((c) => colorDistance(c.rgba, primaryAccentEntry.rgba) >= 42) ?? null
      : null;

  const primaryAccent = primaryAccentEntry
    ? primaryAccentEntry.token.hex
    : cardIsDark
      ? '#FFFFFF'
      : '#09090B';
  const primaryAccentRgba = primaryAccentEntry?.rgba ?? (cardIsDark ? { r: 255, g: 255, b: 255, a: 1 } : { r: 9, g: 9, b: 11, a: 1 });
  const secondaryAccent = secondaryAccentEntry ? secondaryAccentEntry.token.hex : null;
  const secondaryAccentRgba = secondaryAccentEntry?.rgba ?? null;

  // 4. Guarantee >= 4.5:1 readable foreground text on card surface & CTA button
  const cardBgRgba = parseOpaqueOrFallback(
    cardSurface,
    cardIsDark ? { r: 20, g: 20, b: 24, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }
  );

  const exactTextToken = !preferVisual ? pickRole(['text'], record.dna.palette) : undefined;
  const preferredText = exactTextToken?.hex ?? (cardIsDark ? '#FAFAFA' : '#09090B');
  const textPrimary = ensureReadableForeground(preferredText, cardBgRgba);
  const ctaText = ensureReadableForeground(
    isDarkColor(primaryAccentRgba) ? '#FFFFFF' : '#09090B',
    primaryAccentRgba
  );

  return {
    canvasBg,
    cardSurface,
    cardIsDark,
    primaryAccent,
    secondaryAccent,
    primaryAccentRgba,
    secondaryAccentRgba,
    textPrimary,
    ctaText,
    polarityLabel: cardIsDark ? 'dark' : 'light',
  };
}

function ensureReadableForeground(preferredCss: string, backgroundRgba: RgbaColor): string {
  const fg = parseCssColor(preferredCss);
  if (fg && fg.a >= 0.7 && contrastRatio(fg, backgroundRgba) >= 4.5) {
    return preferredCss;
  }
  return isDarkColor(backgroundRgba) ? '#FAFAFA' : '#09090B';
}

type PromptTemplateKind = 'pricing' | 'navbar' | 'search' | 'hero' | 'dashboard';

function detectPromptTemplate(userPrompt: string): PromptTemplateKind {
  const p = userPrompt.toLowerCase();
  if (/\b(pricing|plan|tier|subscription|billing)\b/.test(p)) return 'pricing';
  if (/\b(navbar|nav\b|navigation|header|menu)\b/.test(p)) return 'navbar';
  if (/\b(search|modal|command|palette|dialog)\b/.test(p)) return 'search';
  if (/\b(hero|banner|landing|headline|brand|logo)\b/.test(p)) return 'hero';
  return 'dashboard';
}

function deriveHeadlineFromPrompt(userPrompt: string, fallback: string): string {
  const trimmed = userPrompt.trim();
  if (!trimmed) return fallback;
  if (/^(create|build|make|design|generate)\s+(a|an)\s+/i.test(trimmed) && trimmed.length > 42) {
    return fallback;
  }
  return trimmed.slice(0, 46);
}

/**
 * Generates an always-available, 100% offline live Website UI Preview faithfully styled
 * with the captured site's true visual polarity, primary + secondary chromatic brand accents,
 * extracted typography, gradients, borders, shadows, and spacing.
 */
function buildOfflineSpecimenPreview(
  record: CaptureRecord,
  userPrompt: string,
  secondary?: CaptureRecord | null
): { previewHtml: string; starterCode: string; influencedBy: DesignInfluenceItem[] } {
  const { dna } = record;
  const brand = resolveBrandPalette(record, secondary);
  const {
    canvasBg,
    cardSurface,
    cardIsDark,
    primaryAccent,
    secondaryAccent,
    primaryAccentRgba,
    secondaryAccentRgba,
    textPrimary,
    ctaText,
    polarityLabel,
  } = brand;

  const siteName = record.page.hostname
    .replace(/^www\./i, '')
    .split('.')[0]
    ?.toUpperCase() || 'BRAND';

  const accentBorderTint = secondaryAccentRgba
    ? `1px solid ${rgbaCssAlpha(secondaryAccentRgba, cardIsDark ? 0.55 : 0.42)}`
    : `1px solid ${rgbaCssAlpha(primaryAccentRgba, cardIsDark ? 0.38 : 0.25)}`;
  const border = dna.surfaces.borders[0] ?? accentBorderTint;

  // Honor extracted radii; preserve crisp 0px editorial geometry when live DOM roots had 0px radius!
  const hasExtractedRadius = dna.surfaces.borderRadii.length > 0;
  const isFlatDomCapture = record.roots.length > 0 && !record.containsGraphicArtwork && !hasExtractedRadius;
  const radius = hasExtractedRadius
    ? dna.surfaces.borderRadii[0]!
    : isFlatDomCapture
      ? '0px'
      : cardIsDark
        ? '6px'
        : '10px';
  const pillRadius =
    dna.surfaces.borderRadii.find((r) => /999|50%|32px/.test(r)) ??
    (hasExtractedRadius ? radius : isFlatDomCapture ? '0px' : cardIsDark ? '4px' : '8px');

  const shadow =
    dna.surfaces.shadows[0] ??
    (cardIsDark
      ? `0 12px 28px rgba(0,0,0,0.6), 0 0 0 1px ${rgbaCssAlpha(secondaryAccentRgba ?? primaryAccentRgba, 0.22)}`
      : '0 8px 22px rgba(15,23,42,0.08)');
  const backdrop = dna.surfaces.backdropFilters[0] ?? 'none';
  const extractedGradient = dna.surfaces.gradients[0];
  const extractedTextShadow = dna.surfaces.textShadows[0] ?? 'none';

  const suppressHostFont = shouldSuppressHostFallbackFont(record);
  const effectiveTypography: TypographyToken[] = suppressHostFont
    ? []
    : dna.typography.length > 0
      ? dna.typography
      : (dna.pageFallbackTypography ?? []);

  const headingToken =
    effectiveTypography.find((t) => t.role === 'display' || t.role === 'heading') ??
    effectiveTypography[0];
  const bodyToken =
    effectiveTypography.find((t) => t.role === 'body') ?? effectiveTypography[1] ?? headingToken;
  const monoToken = effectiveTypography.find((t) => t.role === 'mono');

  const cleanFontName = (name: string) =>
    name.replace(/^["'\s]+|["'\s]+$/g, '').replace(/^__/, '').replace(/_[a-f0-9]{5,}$/i, '').replace(/_/g, ' ').trim();

  const buildStack = (token: TypographyToken | undefined, fallback: string): string => {
    if (!token) return fallback;
    const raw = token.primaryFont.replace(/^["'\s]+|["'\s]+$/g, '').trim();
    const cleaned = cleanFontName(raw);
    const parts: string[] = [];
    if (raw) parts.push(`"${raw}"`);
    if (cleaned && cleaned.toLowerCase() !== raw.toLowerCase()) parts.push(`"${cleaned}"`);
    if (token.fontStack) parts.push(token.fontStack);
    return parts.join(', ');
  };

  const headingPrimary = headingToken
    ? cleanFontName(headingToken.primaryFont)
    : suppressHostFont
      ? 'Image Style'
      : 'System UI';
  const headingStack = buildStack(headingToken, 'var(--sl-font-sans, system-ui, -apple-system, sans-serif)');
  const bodyPrimary = bodyToken ? cleanFontName(bodyToken.primaryFont) : headingPrimary;
  const bodyStack = buildStack(bodyToken, headingStack);
  const monoStack = monoToken ? monoToken.fontStack : 'ui-monospace, Menlo, monospace';

  const hasEmbeddedHeadingFont =
    headingToken !== undefined &&
    (dna.fontFaceRules ?? []).some((r) => {
      const rl = r.toLowerCase();
      return (
        /url\(\s*["']?data:(?:font\/|application\/)/i.test(r) &&
        (rl.includes(headingPrimary.toLowerCase()) ||
          rl.includes(headingToken.primaryFont.replace(/^["'\s]+|["'\s]+$/g, '').toLowerCase()))
      );
    });
  const fontBadgeMeta = suppressHostFont
    ? 'MATCHED BY AI'
    : hasEmbeddedHeadingFont
      ? 'EXACT FONT'
      : `${headingToken?.fontWeight ?? 700}`;

  const headingSize = Math.min(22, Math.max(16, headingToken?.fontSizePx ?? 18));
  const headingWeight = headingToken?.fontWeight ?? 700;
  const headingTracking =
    headingToken?.letterSpacing && headingToken.letterSpacing !== 'normal'
      ? headingToken.letterSpacing
      : '-0.02em';
  const bodySize = Math.min(13.5, Math.max(11.5, bodyToken?.fontSizePx ?? 12.5));
  const bodyWeight = bodyToken?.fontWeight ?? 400;
  const spacingUnit = dna.layout.spacingGridBase ?? 8;

  const rootHeadingNode = record.roots
    .flatMap((r) => [r, ...r.children])
    .find((n) => n.tag === 'h1' || n.tag === 'h2' || n.styles.textTransform === 'uppercase');
  const headingTransform = rootHeadingNode?.styles.textTransform ?? 'none';
  const headingStretch = rootHeadingNode?.styles.fontStretch ?? 'normal';

  const template = detectPromptTemplate(userPrompt);
  const swatches = dna.palette
    .slice(0, 5)
    .map(
      (c) =>
        `<span class="sl-dot" style="background:${escapeHtml(c.rgbString)}" title="${escapeHtml(c.hex)}"></span>`
    )
    .join('');

  const cardBgRgba = parseOpaqueOrFallback(
    cardSurface,
    cardIsDark ? { r: 20, g: 20, b: 24, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }
  );
  const readableAccentText = ensureReadableForeground(primaryAccent, cardBgRgba);
  const readableSecondaryText = secondaryAccent
    ? ensureReadableForeground(secondaryAccent, cardBgRgba)
    : readableAccentText;

  const mutedTextColor = cardIsDark ? 'rgba(244,244,245,0.72)' : 'rgba(9,9,11,0.68)';
  const subtleFill = secondaryAccentRgba
    ? rgbaCssAlpha(secondaryAccentRgba, cardIsDark ? 0.14 : 0.10)
    : rgbaCssAlpha(primaryAccentRgba, cardIsDark ? 0.12 : 0.08);
  const subtleBorder = secondaryAccentRgba
    ? rgbaCssAlpha(secondaryAccentRgba, cardIsDark ? 0.35 : 0.28)
    : cardIsDark
      ? 'rgba(255,255,255,0.12)'
      : 'rgba(9,9,11,0.12)';
  // Verify WCAG AA (>= 4.5:1) contrast against EVERY opaque stop of extracted gradients!
  // If no single foreground color passes against all stops (e.g. light-to-dark rainbow gradient),
  // keep solid high-contrast `cardSurface` behind text and display the gradient on a dedicated accent band.
  let effectiveCardText = textPrimary;
  let applyGradientOnCard = false;
  let applyGradientOnBand = false;

  if (extractedGradient) {
    const stopMatches = extractedGradient.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const opaqueStops = stopMatches
      .map((s) => parseCssColor(s))
      .filter((c): c is RgbaColor => c !== null && c.a >= 0.45);

    if (opaqueStops.length === 0) {
      applyGradientOnCard = true;
    } else {
      const checkFgAgainstStops = (fgHex: string): boolean => {
        const fg = parseCssColor(fgHex);
        if (!fg) return false;
        return opaqueStops.every((stop) => contrastRatio(fg, stop) >= 4.5);
      };
      if (checkFgAgainstStops(textPrimary)) {
        applyGradientOnCard = true;
      } else if (checkFgAgainstStops('#FAFAFA')) {
        effectiveCardText = '#FAFAFA';
        applyGradientOnCard = true;
      } else if (checkFgAgainstStops('#09090B')) {
        effectiveCardText = '#09090B';
        applyGradientOnCard = true;
      } else {
        applyGradientOnBand = true;
      }
    }
  }
  const gradientBandHtml = applyGradientOnBand ? '<div class="sl-grad-band"></div>' : '';

  const templateBody = (() => {
    if (template === 'pricing') {
      const title = deriveHeadlineFromPrompt(userPrompt, `${siteName} Pro`);
      return `<section class="sl-spec-card">
        <div class="sl-spec-top">
          <span class="sl-spec-pill">POPULAR</span>
          <div class="sl-dots">${swatches}</div>
        </div>
        <div class="sl-price-row">
          <h2 class="sl-spec-title">${escapeHtml(title)}</h2>
          <div class="sl-price"><span class="sl-price-val">$29</span><span class="sl-muted">/mo</span></div>
        </div>
        <div class="sl-list">
          <div class="sl-list-item"><span class="sl-check">✓</span> Exact ${escapeHtml(headingPrimary)} typography &amp; tokens</div>
          <div class="sl-list-item"><span class="sl-check">✓</span> ${escapeHtml(polarityLabel)} palette (${escapeHtml(primaryAccent)}${secondaryAccent ? ` + ${escapeHtml(secondaryAccent)}` : ''})</div>
        </div>
        <div class="sl-spec-foot">
          <span class="sl-muted">${spacingUnit}px grid</span>
          <button type="button" class="sl-cta">Get Started</button>
        </div>
      </section>`;
    }

    if (template === 'navbar') {
      const title = deriveHeadlineFromPrompt(userPrompt, siteName);
      return `<div class="sl-nav-stack">
        <header class="sl-spec-nav">
          <span class="sl-nav-brand">${escapeHtml(title.slice(0, 14))}</span>
          <nav class="sl-nav-links">
            <span class="sl-nav-active">Shop</span>
            <span>Drops</span>
            <span>About</span>
          </nav>
          <button type="button" class="sl-cta sl-cta-sm">Join</button>
        </header>
        <section class="sl-spec-card">
          <span class="sl-spec-kicker">${escapeHtml(headingPrimary)} · ${fontBadgeMeta}</span>
          <h2 class="sl-spec-title">Signature ${escapeHtml(siteName)} Style</h2>
          <p class="sl-spec-copy">Applied live with ${escapeHtml(primaryAccent)}${secondaryAccent ? ` &amp; ${escapeHtml(secondaryAccent)}` : ''} brand accents.</p>
        </section>
      </div>`;
    }

    if (template === 'search') {
      const title = deriveHeadlineFromPrompt(userPrompt, `Search ${siteName}`);
      return `<section class="sl-spec-card">
        <div class="sl-search-bar">
          <span class="sl-check">⌕</span>
          <span class="sl-search-placeholder">${escapeHtml(title)}...</span>
          <span class="sl-kbd">⌘K</span>
        </div>
        <div class="sl-list">
          <div class="sl-list-row">
            <strong class="sl-row-title">${escapeHtml(headingPrimary)} · ${headingSize}px</strong>
            <span class="sl-spec-pill">${escapeHtml(primaryAccent)}</span>
          </div>
          <div class="sl-list-row">
            <strong class="sl-row-title">${escapeHtml(polarityLabel)} theme</strong>
            <div class="sl-dots">${swatches}</div>
          </div>
        </div>
      </section>`;
    }

    if (template === 'hero') {
      const title = deriveHeadlineFromPrompt(userPrompt, `${siteName} Edition`);
      return `<section class="sl-spec-card">
        <div class="sl-spec-top">
          <span class="sl-spec-pill">${escapeHtml(siteName)}</span>
          <div class="sl-dots">${swatches}</div>
        </div>
        <h2 class="sl-spec-title sl-hero-title">${escapeHtml(title)}</h2>
        <p class="sl-spec-copy">Built directly from ${escapeHtml(record.page.hostname)}’s visual palette and ${escapeHtml(headingPrimary)} typography.</p>
        <div class="sl-btn-row">
          <button type="button" class="sl-cta">Shop Now</button>
          <button type="button" class="sl-cta-ghost">Explore</button>
        </div>
      </section>`;
    }

    // Default: Brand-Faithful Live Website Preview (mini nav + styled feature card)
    const title = deriveHeadlineFromPrompt(userPrompt, `${siteName} Dashboard`);
    return `<div class="sl-nav-stack">
      <header class="sl-spec-nav">
        <span class="sl-nav-brand">${escapeHtml(siteName)}</span>
        <div class="sl-dots">${swatches}</div>
      </header>
      <section class="sl-spec-card">
        <div class="sl-spec-top">
          <span class="sl-spec-kicker">${escapeHtml(headingPrimary)} · ${fontBadgeMeta}</span>
          <span class="sl-spec-pill">${escapeHtml(polarityLabel.toUpperCase())}</span>
        </div>
        <h2 class="sl-spec-title">${escapeHtml(title)}</h2>
        <div class="sl-metrics">
          <div class="sl-metric">
            <span class="sl-metric-val">98.4%</span>
            <span class="sl-muted">Match</span>
          </div>
          <div class="sl-metric sl-metric-accent">
            <span class="sl-metric-val">${dna.palette.length}</span>
            <span class="sl-muted">Colors</span>
          </div>
          <div class="sl-metric">
            <span class="sl-metric-val">${spacingUnit}px</span>
            <span class="sl-muted">Grid</span>
          </div>
        </div>
        <div class="sl-spec-foot">
          <span class="sl-muted">${escapeHtml(primaryAccent)}${secondaryAccent ? ` · ${escapeHtml(secondaryAccent)}` : ''}</span>
          <button type="button" class="sl-cta">Launch UI</button>
        </div>
      </section>
    </div>`;
  })();

  const ambientGlowImage =
    backdrop !== 'none'
      ? `radial-gradient(circle at 18% 12%, ${rgbaCssAlpha(primaryAccentRgba, 0.35)}, transparent 55%), radial-gradient(circle at 85% 88%, ${rgbaCssAlpha(secondaryAccentRgba ?? primaryAccentRgba, 0.25)}, transparent 55%)`
      : 'none';

  const previewHtml = `<style>
.sl-spec-wrap {
  width: 100%;
  padding: 10px;
  border-radius: ${radius};
  background-color: ${canvasBg};
  background: ${canvasBg};
  ${ambientGlowImage !== 'none' ? `background-image: ${ambientGlowImage};` : ''}
  font-family: ${bodyStack};
  color: ${textPrimary};
  border-top: 3px solid ${primaryAccent};
}
.sl-nav-stack { display: flex; flex-direction: column; gap: 8px; }
.sl-spec-nav {
  background: ${cardSurface};
  color: ${textPrimary};
  border: ${border};
  border-radius: ${radius};
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.sl-nav-brand {
  font-family: ${headingStack};
  font-weight: 800;
  font-size: 12px;
  letter-spacing: 0.05em;
  color: ${readableAccentText};
}
.sl-nav-links {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: ${mutedTextColor};
}
.sl-nav-active { color: ${textPrimary}; font-weight: 700; }
.sl-spec-card {
  background-color: ${cardSurface};
  ${applyGradientOnCard && extractedGradient ? `background-image: ${extractedGradient};` : ''}
  color: ${effectiveCardText};
  border: ${border};
  border-radius: ${radius};
  box-shadow: ${shadow};
  backdrop-filter: ${backdrop};
  -webkit-backdrop-filter: ${backdrop};
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-family: ${bodyStack};
}
${applyGradientOnBand && extractedGradient ? `.sl-grad-band { height: 5px; width: 100%; border-radius: ${radius}; background-image: ${extractedGradient}; margin-bottom: 8px; }` : ''}
.sl-spec-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.sl-spec-kicker {
  font-family: ${monoStack};
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: ${readableSecondaryText};
}
.sl-spec-pill {
  font-family: ${monoStack};
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 2px 7px;
  border-radius: ${pillRadius};
  background: ${subtleFill};
  border: 1px solid ${subtleBorder};
  color: ${readableSecondaryText};
}
.sl-spec-title {
  margin: 0;
  font-family: ${headingStack};
  font-size: ${headingSize}px;
  font-weight: ${headingWeight};
  font-stretch: ${headingStretch};
  text-transform: ${headingTransform};
  letter-spacing: ${headingTracking};
  line-height: 1.15;
  text-shadow: ${extractedTextShadow};
  color: ${effectiveCardText};
}
.sl-hero-title { font-size: ${Math.min(26, headingSize + 4)}px; }
.sl-spec-copy {
  margin: 0;
  font-family: ${bodyStack};
  font-size: ${bodySize}px;
  font-weight: ${bodyWeight};
  color: ${mutedTextColor};
  line-height: 1.45;
}
.sl-muted { font-size: 10.5px; color: ${mutedTextColor}; }
.sl-check { color: ${readableAccentText}; font-weight: 700; }
.sl-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.sl-metric {
  border-radius: ${radius};
  border: 1px solid ${subtleBorder};
  background: ${subtleFill};
  padding: 7px 8px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.sl-metric-accent {
  border-color: ${rgbaCssAlpha(primaryAccentRgba, 0.55)};
  background: ${rgbaCssAlpha(primaryAccentRgba, cardIsDark ? 0.16 : 0.10)};
}
.sl-metric-val {
  font-family: ${headingStack};
  font-size: 14px;
  font-weight: 700;
  color: ${textPrimary};
}
.sl-price-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.sl-price-val { font-family: ${headingStack}; font-size: 22px; font-weight: 800; color: ${readableSecondaryText}; }
.sl-list { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; color: ${textPrimary}; }
.sl-list-item { display: flex; align-items: center; gap: 6px; }
.sl-list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 9px;
  border-radius: ${radius};
  background: ${subtleFill};
  border: 1px solid ${subtleBorder};
}
.sl-row-title { font-size: 11.5px; font-weight: 600; color: ${textPrimary}; }
.sl-search-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border-radius: ${radius};
  background: ${subtleFill};
  border: 1px solid ${subtleBorder};
}
.sl-search-placeholder { flex: 1; font-size: 12px; color: ${mutedTextColor}; }
.sl-kbd {
  font-family: ${monoStack};
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid ${subtleBorder};
  color: ${readableSecondaryText};
}
.sl-spec-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid ${subtleBorder};
}
.sl-btn-row { display: flex; align-items: center; gap: 8px; }
.sl-dots { display: flex; gap: 4px; }
.sl-dot {
  width: 11px;
  height: 11px;
  border-radius: 9999px;
  border: 1px solid ${subtleBorder};
}
.sl-cta {
  font-family: ${bodyStack};
  padding: 6px 12px;
  border-radius: ${pillRadius};
  background: ${primaryAccent};
  color: ${ctaText};
  font-size: 11.5px;
  font-weight: 700;
  border: none;
}
.sl-cta-sm { padding: 4px 9px; font-size: 10.5px; }
.sl-cta-ghost {
  font-family: ${bodyStack};
  padding: 6px 12px;
  border-radius: ${pillRadius};
  background: transparent;
  color: ${readableSecondaryText};
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid ${subtleBorder};
}
</style>
<div class="sl-spec-wrap">
  ${gradientBandHtml}${templateBody}
</div>`;

  const starterCode = `/* StyleLens Live Remixed Component (${record.page.hostname})
 * Palette: ${canvasBg} canvas · ${primaryAccent} primary${secondaryAccent ? ` · ${secondaryAccent} secondary` : ''} · ${headingPrimary} typography
 */
${generateCssTokens(record)}

${previewHtml}`;

  const influencedBy: DesignInfluenceItem[] = [
    {
      token: `${polarityLabel} palette + ${primaryAccent}${secondaryAccent ? ` & ${secondaryAccent}` : ''}`,
      usage: 'Drives canvas polarity, primary CTA fill, accent borders, and highlight badges.',
    },
    {
      token: `Typography: ${headingPrimary}${bodyPrimary !== headingPrimary ? ` + ${bodyPrimary}` : ''} (${headingSize}px / ${headingWeight})`,
      usage: hasEmbeddedHeadingFont
        ? 'Embedded directly as base64 @font-face binary and applied to heading/body hierarchy.'
        : 'Loaded and applied to heading and body text hierarchy.',
    },
    {
      token: `Surface: radius ${radius}${backdrop !== 'none' ? ` + ${backdrop}` : ''}`,
      usage: 'Controls card framing, border geometry, and depth elevation.',
    },
  ];

  if (secondary) {
    influencedBy.push({
      token: `Blended with ${secondary.page.hostname}`,
      usage: 'Pulled backdrop/accent hues from your secondary saved capture.',
    });
  }

  return { previewHtml, starterCode, influencedBy };
}

/**
 * Always-available, zero-network deterministic provider.
 */
export class DeterministicProvider implements AIProvider {
  readonly id = 'deterministic' as const;
  readonly label = 'Offline Design Engine';

  async checkCapability(): Promise<ProviderCapability> {
    return {
      id: this.id,
      label: this.label,
      availability: 'ready',
      supportsMultimodal: true,
      detail: 'Always available offline — combines exact DOM CSS tokens with worker-sampled pixels.',
    };
  }

  async synthesizeRemix(request: RemixRequest): Promise<RemixOutput> {
    const { record, secondaryRecord, userPrompt, targetStack } = request;
    const { dna } = record;

    const rationale: string[] = [
      `Surface polarity anchored to ${dna.polarity} mode using ${dna.palette.filter((c) => c.provenance === 'exact-dom').length} exact DOM color token(s) and ${dna.palette.filter((c) => c.provenance === 'sampled-pixels').length} pixel-sampled accent(s).`,
    ];

    const suppressHostFont = shouldSuppressHostFallbackFont(record);
    const effectiveType = suppressHostFont
      ? []
      : dna.typography.length > 0
        ? dna.typography
        : (dna.pageFallbackTypography ?? []);
    if (effectiveType.length > 0) {
      const fonts = Array.from(new Set(effectiveType.map((t) => t.primaryFont))).slice(0, 2);
      rationale.push(
        dna.typography.length > 0
          ? `Typography grounded in computed font stack: ${fonts.join(', ')}.`
          : `Typography inherited from host page typography: ${fonts.join(', ')}.`
      );
    }

    if (dna.traits.length > 0) {
      rationale.push(
        `Detected visual traits preserved in spec: ${dna.traits.map((t) => t.label).join(', ')}.`
      );
    }

    if (secondaryRecord) {
      rationale.push(
        `Blended secondary style reference from ${secondaryRecord.page.hostname} (${secondaryRecord.dna.polarity} palette).`
      );
    }

    let promptPackage = generateRemixPrompt(record, userPrompt, targetStack);
    if (secondaryRecord) {
      promptPackage += `\n\n## 7. Secondary Style Blend (${secondaryRecord.page.hostname})\nIncorporate harmonious accent/surface notes from this second capture:\n\`\`\`css\n${generateCssTokens(secondaryRecord)}\n\`\`\``;
    }

    const cssTokens = generateCssTokens(record, !suppressHostFont);
    const specimen = buildOfflineSpecimenPreview(record, userPrompt, secondaryRecord);
    const previewBrand = resolveBrandPalette(record, secondaryRecord);
    const fullPreviewSrcDoc = buildPreviewSrcDoc(
      specimen.previewHtml,
      cssTokens,
      previewBrand.polarityLabel,
      buildPreviewFontAssets(record)
    );
    const fidelityReport = evaluateRemixFidelity(record, fullPreviewSrcDoc);

    return {
      providerId: this.id,
      modelLabel: 'Live Style Preview',
      usedVision: false,
      promptPackage,
      cssTokens,
      tailwindTheme: generateTailwindTheme(record),
      designSpecJson: generateDesignSpecJson(record),
      simplifiedHtml: generateSimplifiedHtml(record.roots),
      generatedCode: specimen.starterCode,
      previewHtml: specimen.previewHtml,
      designRationale: rationale,
      influencedBy: specimen.influencedBy,
      fidelityReport,
    };
  }
}

export const deterministicProvider = new DeterministicProvider();
