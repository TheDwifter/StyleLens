import { isImageSearchHostname } from './captureClassification';
import { compositeOver, isDarkColor, parseCssColor, rgbaToHex, type RgbaColor } from './color';
import type {
  DiscoveredCssVariable,
  ExtractedNode,
  ExtractedPseudoElement,
  ExtractedStyles,
  InlineContentSegment,
  RawDomExtraction,
  SelectionMethod,
  TypographyRole,
  TypographyToken,
  ViewportRect,
} from '../types/capture';

export const OVERLAY_HOST_ID = 'stylelens-overlay-host';
const MAX_NODES = 120;
const MAX_DEPTH = 7;
const MAX_CSS_VARS = 40;

const IGNORED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'LINK',
  'META',
  'HEAD',
  'TITLE',
  'WBR',
]);

const VISUAL_MEDIA_TAGS = new Set(['VIDEO', 'CANVAS', 'IFRAME']);

/** Heuristic detector for CSS-in-JS / CSS Module generated hash class names */
export function isHashedClassName(name: string): boolean {
  if (!name || name.length > 64) return true;
  if (/^(css|sc|emotion|styled|jsx)-[a-z0-9]{4,}$/i.test(name)) return true;
  if (/^[a-z]{1,2}[0-9][a-z0-9]{5,}$/i.test(name)) return true;
  if (/__[a-z0-9_-]{5,}$/i.test(name)) return true;
  if (/^_[a-z0-9]{6,}$/i.test(name)) return true;
  return false;
}

function cleanClassList(el: Element): { clean: string[]; omitted: number } {
  const rawList = typeof el.className === 'string'
    ? el.className.split(/\s+/).filter(Boolean)
    : Array.from(el.classList);

  const clean: string[] = [];
  let omitted = 0;

  for (const cls of rawList) {
    if (isHashedClassName(cls)) {
      omitted += 1;
    } else if (clean.length < 10) {
      clean.push(cls);
    }
  }
  return { clean, omitted };
}

function rectIntersectionArea(a: ViewportRect, b: ViewportRect): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

function toViewportRect(domRect: DOMRect): ViewportRect {
  return {
    x: Math.round(domRect.left),
    y: Math.round(domRect.top),
    width: Math.round(domRect.width),
    height: Math.round(domRect.height),
  };
}

function isElementVisible(el: Element, cs: CSSStyleDeclaration, rect: ViewportRect): boolean {
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  if (Number.parseFloat(cs.opacity || '1') <= 0.01) return false;
  if (rect.width < 1 || rect.height < 1) return false;
  if (el.id === OVERLAY_HOST_ID) return false;
  return true;
}

function getDirectTextSnippet(el: Element): string | undefined {
  const parts: string[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) parts.push(text);
    }
  }
  const combined = parts.join(' ').trim();
  if (!combined) return undefined;
  return combined.length > 220 ? `${combined.slice(0, 217)}...` : combined;
}

const TEXT_CONTAINER_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'button',
  'span',
  'label',
  'li',
  'td',
  'th',
  'blockquote',
  'code',
  'pre',
  'strong',
  'em',
  'small',
  'figcaption',
]);

function resolveCssUrls(cssValue: string, baseUri: string): string {
  if (!cssValue || !/url\(/i.test(cssValue)) return cssValue;
  return cssValue.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (_match, quote: string, assetPath: string) => {
      const trimmed = assetPath.trim();
      if (!trimmed || /^(data:|https?:|#)/i.test(trimmed)) {
        return `url(${quote}${trimmed}${quote})`;
      }
      try {
        const absUrl = new URL(trimmed, baseUri).href;
        return `url("${absUrl}")`;
      } catch {
        return `url(${quote}${trimmed}${quote})`;
      }
    }
  );
}

/**
 * Walks ancestors from `el` up to `<html>` to resolve the effective composited
 * opaque background color and detect whether any gradient/image sits underneath.
 */
function resolveEffectiveBackground(el: Element): {
  hex: string | undefined;
  hasNonSolidAncestor: boolean;
} {
  const layers: RgbaColor[] = [];
  let hasNonSolidAncestor = false;
  let current: Element | null = el;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const cs = window.getComputedStyle(current);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      hasNonSolidAncestor = true;
    }
    const bg = parseCssColor(cs.backgroundColor);
    if (bg && bg.a > 0.01) {
      layers.push(bg);
      if (bg.a >= 0.995) {
        break;
      }
    }
    current = current.parentElement;
  }

  // Default browser canvas backdrop is white if root didn't paint an opaque background
  let acc: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 1; i >= 0; i--) {
    acc = compositeOver(layers[i]!, acc);
  }

  return {
    hex: rgbaToHex(acc),
    hasNonSolidAncestor,
  };
}

function pickNonDefault(value: string | undefined, defaults: readonly string[]): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized || defaults.includes(normalized)) return undefined;
  return normalized;
}

function formatSideBorder(width: string, style: string, color: string): string | undefined {
  if (!width || width === '0px' || !style || style === 'none') return undefined;
  const parsedColor = parseCssColor(color);
  if (parsedColor && parsedColor.a <= 0.01) return undefined;
  return `${width} ${style} ${color}`;
}

function extractCuratedStyles(
  cs: CSSStyleDeclaration,
  rect: ViewportRect,
  hasText: boolean,
  tag: string,
  baseUri: string
): ExtractedStyles {
  const display = cs.display || 'block';
  const isFlex = display === 'flex' || display === 'inline-flex';
  const isGrid = display === 'grid' || display === 'inline-grid';

  const bgColor = parseCssColor(cs.backgroundColor);
  const hasVisibleBg = bgColor !== null && bgColor.a > 0.01;
  const position = cs.position || 'static';

  const styles: ExtractedStyles = {
    display,
    position,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };

  if (position !== 'static') {
    styles.top = pickNonDefault(cs.top, ['auto']);
    styles.right = pickNonDefault(cs.right, ['auto']);
    styles.bottom = pickNonDefault(cs.bottom, ['auto']);
    styles.left = pickNonDefault(cs.left, ['auto']);
  }

  styles.boxSizing = pickNonDefault(cs.boxSizing, ['content-box']);

  if (isFlex) {
    styles.flexDirection = cs.flexDirection;
    styles.justifyContent = pickNonDefault(cs.justifyContent, ['normal', 'flex-start', 'start']);
    styles.alignItems = pickNonDefault(cs.alignItems, ['normal', 'stretch']);
    styles.flexWrap = pickNonDefault(cs.flexWrap, ['nowrap']);
  }

  if (isGrid) {
    styles.gridTemplateColumns = pickNonDefault(cs.gridTemplateColumns, ['none']);
    styles.gridTemplateRows = pickNonDefault(cs.gridTemplateRows, ['none']);
    styles.placeItems = pickNonDefault(cs.placeItems, ['normal', 'normal normal', 'stretch']);
  }

  if (isFlex || isGrid) {
    styles.gap = pickNonDefault(cs.gap, ['normal', '0px', '0px 0px']);
    styles.rowGap = pickNonDefault(cs.rowGap, ['normal', '0px']);
    styles.columnGap = pickNonDefault(cs.columnGap, ['normal', '0px']);
  }

  styles.alignSelf = pickNonDefault(cs.alignSelf, ['auto', 'normal']);
  styles.flex = pickNonDefault(cs.flex, ['0 1 auto', 'none']);
  styles.gridColumn = pickNonDefault(cs.gridColumn, ['auto', 'auto / auto']);
  styles.gridRow = pickNonDefault(cs.gridRow, ['auto', 'auto / auto']);
  styles.padding = pickNonDefault(cs.padding, ['0px', '0px 0px 0px 0px']);
  styles.margin = pickNonDefault(cs.margin, ['0px', '0px 0px 0px 0px']);
  styles.minWidth = pickNonDefault(cs.minWidth, ['0px', 'auto', 'none']);
  styles.maxWidth = pickNonDefault(cs.maxWidth, ['none']);
  styles.minHeight = pickNonDefault(cs.minHeight, ['0px', 'auto', 'none']);

  if (hasVisibleBg) {
    styles.backgroundColor = cs.backgroundColor;
  }
  const rawBgImage = pickNonDefault(cs.backgroundImage, ['none']);
  if (rawBgImage) {
    styles.backgroundImage = resolveCssUrls(rawBgImage, baseUri);
    styles.backgroundSize = pickNonDefault(cs.backgroundSize, ['auto', 'auto auto']);
    styles.backgroundPosition = pickNonDefault(cs.backgroundPosition, ['0% 0%']);
    styles.backgroundRepeat = pickNonDefault(cs.backgroundRepeat, ['repeat']);
  }
  const bgClip =
    cs.backgroundClip ||
    (cs as CSSStyleDeclaration & { webkitBackgroundClip?: string }).webkitBackgroundClip;
  if (bgClip === 'text') {
    styles.backgroundClip = 'text';
    const textFill = (cs as CSSStyleDeclaration & { webkitTextFillColor?: string })
      .webkitTextFillColor;
    if (textFill) styles.webkitTextFillColor = textFill;
  }

  const bTop = formatSideBorder(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor);
  const bRight = formatSideBorder(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor);
  const bBottom = formatSideBorder(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor);
  const bLeft = formatSideBorder(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor);
  if (bTop && bTop === bRight && bTop === bBottom && bTop === bLeft) {
    styles.border = bTop;
  } else {
    styles.borderTop = bTop;
    styles.borderRight = bRight;
    styles.borderBottom = bBottom;
    styles.borderLeft = bLeft;
  }

  styles.borderRadius = pickNonDefault(cs.borderRadius, ['0px', '0px 0px 0px 0px']);
  styles.boxShadow = pickNonDefault(cs.boxShadow, ['none']);
  styles.textShadow = pickNonDefault(cs.textShadow, ['none']);
  styles.transform = pickNonDefault(cs.transform, ['none', 'matrix(1, 0, 0, 1, 0, 0)']);
  if (styles.transform) {
    styles.transformOrigin = pickNonDefault(cs.transformOrigin, ['50% 50%', '50% 50% 0px']);
  }
  styles.clipPath = pickNonDefault(cs.clipPath, ['none']);
  styles.filter = pickNonDefault(cs.filter, ['none']);
  styles.opacity = pickNonDefault(cs.opacity, ['1']);

  const backdrop =
    cs.backdropFilter ||
    (cs as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter;
  styles.backdropFilter = pickNonDefault(backdrop, ['none']);
  const rawOverflow = pickNonDefault(cs.overflow, ['visible', 'visible visible']);
  if (rawOverflow) {
    styles.overflow = rawOverflow;
  } else {
    const ox = cs.overflowX || 'visible';
    const oy = cs.overflowY || 'visible';
    if (ox !== 'visible' || oy !== 'visible') {
      styles.overflow = ox === oy ? ox : `${ox} ${oy}`;
    }
  }
  styles.objectFit = pickNonDefault(cs.objectFit, ['fill']);
  styles.zIndex = pickNonDefault(cs.zIndex, ['auto', '0']);
  styles.textAlign = pickNonDefault(cs.textAlign, ['start', 'left']);

  if (tag === 'ul' || tag === 'ol' || tag === 'li') {
    styles.listStyleType = pickNonDefault(cs.listStyleType, ['none']);
  }

  const isTextLike = hasText || TEXT_CONTAINER_TAGS.has(tag);
  if (isTextLike || tag === 'svg') {
    styles.color = cs.color;
  }

  if (isTextLike) {
    styles.fontFamily = cs.fontFamily;
    styles.fontSize = cs.fontSize;
    styles.fontWeight = cs.fontWeight;
    styles.fontStyle = pickNonDefault(cs.fontStyle, ['normal']);
    styles.fontStretch = pickNonDefault(cs.fontStretch, ['100%', 'normal']);
    styles.lineHeight = pickNonDefault(cs.lineHeight, ['normal']);
    styles.letterSpacing = pickNonDefault(cs.letterSpacing, ['normal', '0px']);
    styles.textTransform = pickNonDefault(cs.textTransform, ['none']);
    styles.textDecoration = pickNonDefault(cs.textDecorationLine || cs.textDecoration, ['none']);
    styles.whiteSpace = pickNonDefault(cs.whiteSpace, ['normal']);
  }

  return styles;
}

function extractPseudoElements(el: Element, baseUri: string): ExtractedPseudoElement[] {
  const results: ExtractedPseudoElement[] = [];
  for (const pseudo of ['::before', '::after'] as const) {
    const cs = window.getComputedStyle(el, pseudo);
    if (!cs.content || cs.content === 'none' || cs.content === 'normal') continue;

    const bgColor = parseCssColor(cs.backgroundColor);
    const hasBg = bgColor !== null && bgColor.a > 0.01;
    const rawBgImage = pickNonDefault(cs.backgroundImage, ['none']);
    const bgImage = rawBgImage ? resolveCssUrls(rawBgImage, baseUri) : undefined;
    const bTop = formatSideBorder(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor);
    const bRight = formatSideBorder(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor);
    const bBottom = formatSideBorder(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor);
    const bLeft = formatSideBorder(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor);
    const uniformBorder = bTop && bTop === bRight && bTop === bBottom && bTop === bLeft ? bTop : undefined;
    const anyBorder = uniformBorder ?? bTop ?? bBottom ?? bLeft ?? bRight;
    const boxShadow = pickNonDefault(cs.boxShadow, ['none']);
    const backdrop = pickNonDefault(cs.backdropFilter, ['none']);
    const transform = pickNonDefault(cs.transform, ['none', 'matrix(1, 0, 0, 1, 0, 0)']);
    const clipPath = pickNonDefault(cs.clipPath, ['none']);
    const hasVisibleTextContent = cs.content !== '""' && cs.content !== "''";

    if (hasBg || bgImage || anyBorder || boxShadow || backdrop || clipPath || hasVisibleTextContent) {
      results.push({
        pseudo,
        content: cs.content,
        position: pickNonDefault(cs.position, ['static']),
        inset: pickNonDefault(cs.inset, ['auto']),
        top: pickNonDefault(cs.top, ['auto']),
        right: pickNonDefault(cs.right, ['auto']),
        bottom: pickNonDefault(cs.bottom, ['auto']),
        left: pickNonDefault(cs.left, ['auto']),
        width: pickNonDefault(cs.width, ['auto', '0px']),
        height: pickNonDefault(cs.height, ['auto', '0px']),
        color: hasVisibleTextContent ? cs.color : undefined,
        backgroundColor: hasBg ? cs.backgroundColor : undefined,
        backgroundImage: bgImage,
        border: uniformBorder ?? anyBorder,
        borderTop: uniformBorder ? undefined : bTop,
        borderRight: uniformBorder ? undefined : bRight,
        borderBottom: uniformBorder ? undefined : bBottom,
        borderLeft: uniformBorder ? undefined : bLeft,
        borderRadius: pickNonDefault(cs.borderRadius, ['0px']),
        boxShadow,
        backdropFilter: backdrop,
        transform,
        clipPath,
        opacity: pickNonDefault(cs.opacity, ['1']),
        zIndex: pickNonDefault(cs.zIndex, ['auto', '0']),
      });
    }
  }
  return results;
}

function walkCssRules(rules: CSSRuleList, visitor: (rule: CSSRule) => boolean | void): void {
  for (const rule of Array.from(rules)) {
    if (visitor(rule) === false) return;
    const grouping = rule as CSSRule & { cssRules?: CSSRuleList };
    if (grouping.cssRules && grouping.cssRules.length > 0) {
      walkCssRules(grouping.cssRules, visitor);
    }
  }
}

/**
 * Opportunistically harvests `:root` CSS custom properties from same-origin stylesheets
 * (recursing into `@layer`, `@media`, and `@supports` grouping rules for Tailwind v4+).
 * Cross-origin sheets throw SecurityError and are safely skipped.
 */
function discoverRootCssVariables(doc: Document): DiscoveredCssVariable[] {
  const found = new Map<string, string>();

  try {
    const sheets = Array.from(doc.styleSheets);
    for (const sheet of sheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // Cross-origin stylesheet — expected and safe to skip
      }

      walkCssRules(rules, (rule) => {
        if (found.size >= MAX_CSS_VARS) return false;
        if (!(rule instanceof CSSStyleRule)) return;
        if (!/:root|html|\[data-theme/.test(rule.selectorText)) return;

        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style.item(i);
          if (!prop.startsWith('--')) continue;
          const val = rule.style.getPropertyValue(prop).trim();
          if (val && !found.has(prop)) {
            found.set(prop, val);
            if (found.size >= MAX_CSS_VARS) return false;
          }
        }
      });

      if (found.size >= MAX_CSS_VARS) break;
    }
  } catch {
    // Never let stylesheet inspection fail extraction
  }

  return Array.from(found, ([name, value]) => ({ name, value }));
}

const FONT_HOST_PATTERN =
  /fonts\.googleapis\.com|fonts\.bunny\.net|use\.typekit\.net|fonts\.gstatic\.com|api\.fontshare\.com|fonts\.cdnfonts\.com|rsms\.me|cloud\.typography\.com|fast\.fonts\.net|fonts\.adobe\.com|\/fonts?\b/i;

const GENERIC_SYSTEM_FONT_NAMES = new Set([
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

/**
 * Discovers active webfont stylesheet <link> URLs, all page stylesheet URLs (for CORS-free
 * service-worker @font-face harvesting), loaded document.fonts families, and accessible
 * CSSOM @font-face rules (including inside `@layer`/`@media` blocks).
 */
function discoverWebfontAssets(doc: Document): {
  fontStylesheetUrls: string[];
  pageStylesheetUrls: string[];
  fontFaceRules: string[];
  loadedFontFamilies: string[];
} {
  const fontStylesheetUrls: string[] = [];
  const seenFontUrls = new Set<string>();
  const pageStylesheetUrls: string[] = [];
  const seenPageUrls = new Set<string>();
  const fontFaceRules: string[] = [];
  const loadedFontFamilies: string[] = [];

  const registerStylesheetUrl = (rawHref: string, base: string) => {
    if (!rawHref) return;
    try {
      const abs = new URL(rawHref, base).href;
      if (!/^https?:\/\//i.test(abs)) return;
      if (abs.startsWith('https://') && FONT_HOST_PATTERN.test(abs) && !seenFontUrls.has(abs)) {
        if (fontStylesheetUrls.length < 6) {
          seenFontUrls.add(abs);
          fontStylesheetUrls.push(abs);
        }
      }
      if (!seenPageUrls.has(abs) && pageStylesheetUrls.length < 20) {
        seenPageUrls.add(abs);
        pageStylesheetUrls.push(abs);
      }
    } catch {
      // Ignore invalid URL
    }
  };

  try {
    const links = Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'));
    for (const link of links) {
      const rawHref = link.getAttribute('href');
      if (rawHref) registerStylesheetUrl(rawHref, doc.baseURI);
    }
  } catch {
    // Never fail extraction on stylesheet inspection
  }

  try {
    const sheets = Array.from(doc.styleSheets);
    for (const sheet of sheets) {
      if (sheet.href) {
        registerStylesheetUrl(sheet.href, doc.baseURI);
      }
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      const base = sheet.href || doc.baseURI;
      walkCssRules(rules, (rule) => {
        if (typeof CSSImportRule !== 'undefined' && rule instanceof CSSImportRule && rule.href) {
          registerStylesheetUrl(rule.href, base);
          return;
        }
        if (typeof CSSFontFaceRule !== 'undefined' && rule instanceof CSSFontFaceRule) {
          const resolvedCss = resolveCssUrls(rule.cssText, base);
          const isDataUriFace = /url\(\s*["']?data:/i.test(resolvedCss);
          const maxLen = isDataUriFace ? 180_000 : 2500;
          if (resolvedCss.length <= maxLen && fontFaceRules.length < 160) {
            fontFaceRules.push(resolvedCss);
          }
        }
      });
    }
  } catch {
    // Ignore CSSOM access errors
  }

  // Inspect FontFaceSet (`document.fonts`) to capture the exact font families loaded by the page
  try {
    const fontSet = (doc as Document & { fonts?: Iterable<{ family: string; status: string }> }).fonts;
    if (fontSet && typeof fontSet[Symbol.iterator] === 'function') {
      const seenLoaded = new Set<string>();
      for (const face of fontSet) {
        if (!face || face.status !== 'loaded' || !face.family) continue;
        const clean = face.family.replace(/^["'\s]+|["'\s]+$/g, '').trim();
        const lower = clean.toLowerCase();
        if (!clean || GENERIC_SYSTEM_FONT_NAMES.has(lower) || seenLoaded.has(lower)) continue;
        seenLoaded.add(lower);
        loadedFontFamilies.push(clean);
        if (loadedFontFamilies.length >= 16) break;
      }
    }
  } catch {
    // FontFaceSet unavailable in jsdom / restricted docs
  }

  return { fontStylesheetUrls, pageStylesheetUrls, fontFaceRules, loadedFontFamilies };
}

/**
 * Samples the host page's primary visible heading & body typography so artwork/media
 * captures (which have 0 live text nodes inside the marquee) still inherit the real
 * website's fonts in Remix Preview instead of falling back to hardcoded "Inter".
 */
function extractPageFallbackTypography(doc: Document): TypographyToken[] {
  if (!doc.body) return [];

  const buckets = new Map<string, TypographyToken>();
  const classifyRole = (sizePx: number, weight: number, stack: string): TypographyRole => {
    if (/mono|consolas|menlo|fira code|jetbrains|courier|sfmono/i.test(stack)) return 'mono';
    if (sizePx >= 30) return 'display';
    if (sizePx >= 18 || (sizePx >= 15 && weight >= 600)) return 'heading';
    if (sizePx <= 12.5) return 'label';
    return 'body';
  };

  // Query prioritized buckets separately so sites with 100+ megamenu nav links never starve <h1> or <main p>
  const bucketSpecs: Array<{ selector: string; limit: number }> = [
    { selector: 'h1, h2, h3, h4', limit: 16 },
    { selector: 'main p, article p, section p, p', limit: 16 },
    { selector: 'nav a, header a', limit: 8 },
    { selector: 'body', limit: 1 },
  ];
  const seenEls = new Set<Element>();
  const candidates: Element[] = [];
  for (const spec of bucketSpecs) {
    try {
      let added = 0;
      for (const el of Array.from(doc.querySelectorAll(spec.selector))) {
        if (seenEls.has(el)) continue;
        seenEls.add(el);
        candidates.push(el);
        added += 1;
        if (added >= spec.limit) break;
      }
    } catch {
      // Ignore selector error
    }
  }

  for (const el of candidates) {
    if (isInsideOverlay(el)) continue;
    let cs: CSSStyleDeclaration;
    try {
      cs = window.getComputedStyle(el);
    } catch {
      continue;
    }

    const isBody = el.tagName === 'BODY';
    if (!isBody) {
      const rect = toViewportRect(el.getBoundingClientRect());
      if (!isElementVisible(el, cs, rect)) continue;
    }

    const text = isBody
      ? (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Body text'
      : (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48);
    if (!text) continue;

    const fontStack = cs.fontFamily;
    const fontSizePx = Number(Number.parseFloat(cs.fontSize || '16').toFixed(1));
    if (!fontStack || !Number.isFinite(fontSizePx) || fontSizePx <= 0) continue;

    const primaryFont = (fontStack.split(',')[0] ?? fontStack).replace(/^["'\s]+|["'\s]+$/g, '').trim();
    if (!primaryFont) continue;

    const fontWeight = Number.parseInt(cs.fontWeight || '400', 10) || 400;
    const role: TypographyRole =
      el.tagName === 'H1'
        ? 'display'
        : el.tagName === 'H2' || el.tagName === 'H3'
          ? 'heading'
          : isBody
            ? 'body'
            : classifyRole(fontSizePx, fontWeight, fontStack);

    let lineHeightPx: number | null = null;
    if (cs.lineHeight && cs.lineHeight.endsWith('px')) {
      const parsed = Number.parseFloat(cs.lineHeight);
      if (Number.isFinite(parsed)) lineHeightPx = Number(parsed.toFixed(1));
    }
    const lineHeightRatio =
      lineHeightPx !== null ? Number((lineHeightPx / fontSizePx).toFixed(2)) : null;

    const key = `${role}|${primaryFont.toLowerCase()}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.usageCount += 1;
      if (fontSizePx > existing.fontSizePx && (role === 'display' || role === 'heading')) {
        existing.fontSizePx = fontSizePx;
        existing.fontWeight = fontWeight;
      }
    } else {
      buckets.set(key, {
        primaryFont,
        fontStack,
        fontSizePx,
        fontWeight,
        lineHeightPx,
        lineHeightRatio,
        letterSpacing: cs.letterSpacing || 'normal',
        role,
        sampleText: text,
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
      // Prefer real non-system webfont families over generic system fonts
      const aSys = GENERIC_SYSTEM_FONT_NAMES.has(a.primaryFont.toLowerCase()) ? 1 : 0;
      const bSys = GENERIC_SYSTEM_FONT_NAMES.has(b.primaryFont.toLowerCase()) ? 1 : 0;
      if (aSys !== bSys) return aSys - bSys;
      if (roleRank[a.role] !== roleRank[b.role]) return roleRank[a.role] - roleRank[b.role];
      return b.fontSizePx - a.fontSizePx;
    })
    .slice(0, 4);
}

const SVG_SHAPE_SELECTOR = 'path, rect, circle, polygon, polyline, ellipse, line, text, g, use';

function extractSanitizedInlineSvg(
  svgEl: Element,
  svgCs: CSSStyleDeclaration,
  effectiveBackgroundHex?: string
): { svgMarkup?: string; svgColors: string[] } {
  const colorSet = new Set<string>();
  const doc = svgEl.ownerDocument;
  const bgParsed = effectiveBackgroundHex ? parseCssColor(effectiveBackgroundHex) : null;
  const onDarkBg = bgParsed ? isDarkColor(bgParsed) : false;

  const registerColor = (raw: string | null | undefined, fallbackColor: string) => {
    if (!raw) return;
    const trimmed = raw.trim();
    if (!trimmed || /^(none|transparent|url\()/i.test(trimmed)) return;
    const resolved = /^currentcolor$/i.test(trimmed) ? fallbackColor : trimmed;
    const parsed = parseCssColor(resolved);
    if (parsed && parsed.a > 0.05) {
      colorSet.add(rgbaToHex(parsed, false));
    }
  };

  const cloned = svgEl.cloneNode(true) as Element;

  // Read SVG root attributes AND computed fill/stroke (handles `<svg style="fill: #eb0010">`)
  const rootAttrFill = svgEl.getAttribute('fill');
  const rootAttrStroke = svgEl.getAttribute('stroke');
  registerColor(rootAttrFill, svgCs.color);
  registerColor(rootAttrStroke, svgCs.color);
  if (svgCs.fill && svgCs.fill !== 'none' && !/^url\(/i.test(svgCs.fill)) {
    const parsedRootFill = parseCssColor(svgCs.fill);
    if (parsedRootFill && parsedRootFill.a > 0.05) {
      const hex = rgbaToHex(parsedRootFill, false);
      if (rootAttrFill || hex !== '#000000' || !onDarkBg) {
        if (!rootAttrFill && hex !== '#000000') cloned.setAttribute('fill', hex);
        if (hex !== '#000000' || Boolean(rootAttrFill) || Boolean((svgEl as SVGElement).style?.fill)) {
          colorSet.add(hex);
        }
      }
    }
  }
  if (svgCs.stroke && svgCs.stroke !== 'none' && !/^url\(/i.test(svgCs.stroke)) {
    const parsedRootStroke = parseCssColor(svgCs.stroke);
    if (parsedRootStroke && parsedRootStroke.a > 0.05) {
      const hex = rgbaToHex(parsedRootStroke, false);
      if (!rootAttrStroke) cloned.setAttribute('stroke', hex);
      colorSet.add(hex);
    }
  }

  const origShapes = Array.from(svgEl.querySelectorAll(SVG_SHAPE_SELECTOR)).slice(0, 150);
  const cloneShapes = Array.from(cloned.querySelectorAll(SVG_SHAPE_SELECTOR)).slice(0, 150);

  for (let i = 0; i < origShapes.length; i++) {
    const orig = origShapes[i]!;
    const clone = cloneShapes[i];
    const attrFill = orig.getAttribute('fill');
    const attrStroke = orig.getAttribute('stroke');

    let shapeCs: CSSStyleDeclaration | null = null;
    try {
      shapeCs = window.getComputedStyle(orig);
    } catch {
      shapeCs = null;
    }
    const localColor = shapeCs?.color || svgCs.color;

    registerColor(attrFill, localColor);
    registerColor(attrStroke, localColor);

    // Inline child `currentColor` when the child overrides `color` via CSS class
    if (clone && attrFill && /^currentcolor$/i.test(attrFill) && localColor && localColor !== svgCs.color) {
      const parsedLocal = parseCssColor(localColor);
      if (parsedLocal && parsedLocal.a > 0.05) {
        clone.setAttribute('fill', rgbaToHex(parsedLocal, false));
      }
    }
    if (clone && attrStroke && /^currentcolor$/i.test(attrStroke) && localColor && localColor !== svgCs.color) {
      const parsedLocal = parseCssColor(localColor);
      if (parsedLocal && parsedLocal.a > 0.05) {
        clone.setAttribute('stroke', rgbaToHex(parsedLocal, false));
      }
    }

    // Inline local `<use href="#symbolId">` references OR resolve relative external sprite URLs
    if (orig.tagName.toLowerCase() === 'use' && clone && doc) {
      const href = orig.getAttribute('href') || orig.getAttribute('xlink:href');
      if (href && href.startsWith('#')) {
        const refEl = doc.getElementById(href.slice(1));
        if (refEl) {
          const refViewBox = refEl.getAttribute('viewBox');
          if (refViewBox && !cloned.getAttribute('viewBox')) {
            cloned.setAttribute('viewBox', refViewBox);
          }
          const group = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
          const compFill = shapeCs?.fill;
          if (compFill && compFill !== 'none' && !/^url\(/i.test(compFill)) {
            const pFill = parseCssColor(compFill);
            if (pFill && pFill.a > 0.05) {
              const hex = rgbaToHex(pFill, false);
              group.setAttribute('fill', hex);
              if (hex !== '#000000' || !onDarkBg) colorSet.add(hex);
            }
          }
          for (const symChild of Array.from(refEl.children)) {
            const clonedSymChild = symChild.cloneNode(true) as Element;
            registerColor(symChild.getAttribute('fill'), localColor);
            registerColor(symChild.getAttribute('stroke'), localColor);
            group.appendChild(clonedSymChild);
          }
          clone.replaceWith(group);
          continue;
        }
      } else if (href && !/^(https?:|data:)/i.test(href)) {
        try {
          const absSprite = new URL(href, doc.baseURI).href;
          clone.setAttribute('href', absSprite);
          clone.removeAttribute('xlink:href');
        } catch {
          // Keep original href if URL resolution fails
        }
      }
    }

    if (shapeCs) {
      const compFill = shapeCs.fill;
      const compStroke = shapeCs.stroke;
      if (compFill && compFill !== 'none' && !/^url\(/i.test(compFill)) {
        const parsedFill = parseCssColor(compFill);
        if (parsedFill && parsedFill.a > 0.05) {
          const hex = rgbaToHex(parsedFill, false);
          if (clone && !attrFill) {
            clone.setAttribute('fill', hex);
          }
          const explicitStyleFill = Boolean((orig as SVGElement).style?.fill);
          if (attrFill || explicitStyleFill || hex !== '#000000' || !onDarkBg) {
            colorSet.add(hex);
          }
        }
      }
      if (compStroke && compStroke !== 'none' && !/^url\(/i.test(compStroke)) {
        const parsedStroke = parseCssColor(compStroke);
        if (parsedStroke && parsedStroke.a > 0.05) {
          const hex = rgbaToHex(parsedStroke, false);
          if (clone && !attrStroke) {
            clone.setAttribute('stroke', hex);
          }
          colorSet.add(hex);
        }
      }
    }
  }

  // Fallback to SVG computed color if shapes used currentColor
  if (colorSet.size === 0 && /currentcolor/i.test(svgEl.outerHTML)) {
    registerColor(svgCs.color, svgCs.color);
  }

  const rawSvg = cloned.outerHTML
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  return {
    svgMarkup: rawSvg.length <= 16_000 ? rawSvg : undefined,
    svgColors: Array.from(colorSet).slice(0, 6),
  };
}

function isInsideOverlay(el: Element): boolean {
  let curr: Element | null = el;
  while (curr) {
    if (curr.id === OVERLAY_HOST_ID) return true;
    curr = curr.parentElement;
  }
  return false;
}

function buildNodeTree(
  el: Element,
  selectionRect: ViewportRect | null,
  depth: number,
  counter: { count: number; truncated: boolean; idSeq: number }
): ExtractedNode | null {
  if (IGNORED_TAGS.has(el.tagName) || isInsideOverlay(el)) return null;
  if (counter.count >= MAX_NODES) {
    counter.truncated = true;
    return null;
  }

  const cs = window.getComputedStyle(el);
  const rect = toViewportRect(el.getBoundingClientRect());
  if (!isElementVisible(el, cs, rect)) return null;

  if (selectionRect && rectIntersectionArea(rect, selectionRect) <= 0) {
    return null;
  }

  counter.count += 1;
  counter.idSeq += 1;

  const textSnippet = getDirectTextSnippet(el);
  const { clean, omitted } = cleanClassList(el);
  const { hex: effectiveBackgroundHex, hasNonSolidAncestor } = resolveEffectiveBackground(el);

  // Capture sanitized inline <svg> vector markup (with computed fills & <use> inlined) + vector color palette
  let svgMarkup: string | undefined;
  let svgColors: string[] | undefined;
  if (el.tagName.toLowerCase() === 'svg') {
    const svgExtracted = extractSanitizedInlineSvg(el, cs, effectiveBackgroundHex);
    svgMarkup = svgExtracted.svgMarkup;
    if (svgExtracted.svgColors.length > 0) {
      svgColors = svgExtracted.svgColors;
    }
  }

  // Capture resolved <img> src & alt for faithful component snapshots
  let imgSrc: string | undefined;
  let imgAlt: string | undefined;
  if (el.tagName === 'IMG') {
    const imgEl = el as HTMLImageElement;
    const resolved = imgEl.currentSrc || imgEl.src;
    if (resolved && /^https?:\/\//i.test(resolved)) {
      imgSrc = resolved;
    }
    if (imgEl.alt) imgAlt = imgEl.alt.slice(0, 80);
  }

  const children: ExtractedNode[] = [];
  const rawSegments: InlineContentSegment[] = [];
  let hasInterleavedText = false;
  let hasBr = false;

  if (depth < MAX_DEPTH && el.tagName.toLowerCase() !== 'svg') {
    for (const childNode of Array.from(el.childNodes)) {
      if (childNode.nodeType === Node.TEXT_NODE) {
        const raw = (childNode.textContent ?? '').replace(/\s+/g, ' ');
        if (raw.trim().length > 0) {
          hasInterleavedText = true;
          rawSegments.push({ kind: 'text', text: raw.slice(0, 220) });
        }
      } else if (childNode.nodeType === Node.ELEMENT_NODE) {
        const childEl = childNode as Element;
        if (childEl.tagName === 'BR') {
          hasBr = true;
          rawSegments.push({ kind: 'br' });
          continue;
        }
        if (counter.count >= MAX_NODES) {
          counter.truncated = true;
          break;
        }
        const extractedChild = buildNodeTree(
          childEl,
          selectionRect,
          depth + 1,
          counter
        );
        if (extractedChild) {
          const childIdx = children.length;
          children.push(extractedChild);
          rawSegments.push({ kind: 'child', index: childIdx });
        }
      }
    }
  } else if (el.children.length > 0 && el.tagName.toLowerCase() !== 'svg') {
    counter.truncated = true;
  }

  const inlineSegments =
    (hasInterleavedText && (children.length > 0 || hasBr)) ? rawSegments : undefined;

  const tag = el.tagName.toLowerCase();
  const baseUri = el.ownerDocument?.baseURI || window.location.href;
  const rawAriaLabel =
    el.getAttribute('aria-label')?.trim() ||
    (tag === 'svg' ? el.querySelector('title')?.textContent?.trim() : undefined) ||
    el.getAttribute('title')?.trim();
  const ariaLabel = rawAriaLabel ? rawAriaLabel.slice(0, 80) : undefined;

  return {
    id: `n${counter.idSeq}`,
    tag,
    role: el.getAttribute('role') ?? undefined,
    ariaLabel,
    cleanClasses: clean,
    omittedHashedClassCount: omitted,
    textSnippet,
    inlineSegments,
    svgMarkup,
    svgColors,
    imgSrc,
    imgAlt,
    rect,
    styles: extractCuratedStyles(cs, rect, Boolean(textSnippet), tag, baseUri),
    effectiveBackgroundHex,
    hasNonSolidBackgroundAncestor: hasNonSolidAncestor,
    pseudoElements: extractPseudoElements(el, baseUri),
    children,
  };
}

/**
 * Selects the best root element(s) inside a user-drawn marquee box.
 * Strategy:
 * 1. Find all visible elements intersecting the marquee with meaningful overlap.
 * 2. Check if a single tight container closely frames the selection (IoU >= 0.45).
 * 3. Otherwise collect the minimal non-overlapping top-level intersecting elements.
 */
function findMarqueeRoots(doc: Document, rect: ViewportRect): {
  elements: Element[];
  visualOnlyReason?: string;
} {
  const selectionArea = Math.max(1, rect.width * rect.height);
  const candidates: Array<{ el: Element; elRect: ViewportRect; overlap: number; elArea: number; iou: number }> = [];

  const body = doc.body;
  if (!body) return { elements: [], visualOnlyReason: 'Document body is unavailable.' };

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.nextNode();
  let inspected = 0;
  const MAX_WALK = 2500;

  while (node && inspected < MAX_WALK) {
    const el = node as Element;
    inspected += 1;

    if (!IGNORED_TAGS.has(el.tagName) && el.tagName !== 'BR' && !isInsideOverlay(el)) {
      const elRect = toViewportRect(el.getBoundingClientRect());
      if (elRect.width >= 2 && elRect.height >= 2) {
        const overlap = rectIntersectionArea(elRect, rect);
        if (overlap > 0) {
          const elArea = elRect.width * elRect.height;
          const union = selectionArea + elArea - overlap;
          const iou = union > 0 ? overlap / union : 0;
          const elementCoverage = overlap / elArea;
          const selectionCoverage = overlap / selectionArea;

          // Include elements meaningfully inside the dragged box, tightly wrapping it,
          // whose center lies inside the box, OR full-width text blocks (e.g. 1440px <h1>)
          // whose vertical band sits inside the marquee with direct text.
          const centerX = elRect.x + elRect.width / 2;
          const centerY = elRect.y + elRect.height / 2;
          const centerInside =
            centerX >= rect.x &&
            centerX <= rect.x + rect.width &&
            centerY >= rect.y &&
            centerY <= rect.y + rect.height;

          const yOverlap = Math.max(
            0,
            Math.min(elRect.y + elRect.height, rect.y + rect.height) - Math.max(elRect.y, rect.y)
          );
          const isWideTextBlockInBox =
            Boolean(getDirectTextSnippet(el)) &&
            elRect.height > 0 &&
            yOverlap / elRect.height >= 0.55 &&
            overlap / Math.min(elArea, selectionArea) >= 0.15;

          if (
            elementCoverage >= 0.25 ||
            iou >= 0.45 ||
            centerInside ||
            isWideTextBlockInBox ||
            (VISUAL_MEDIA_TAGS.has(el.tagName) && selectionCoverage >= 0.5)
          ) {
            candidates.push({ el, elRect, overlap, elArea, iou });
          }
        }
      }
    }

    node = walker.nextNode();
  }

  // Check if the selection primarily targets a <video>, <canvas>, or <iframe>
  const dominantMedia = candidates.find(
    (c) => VISUAL_MEDIA_TAGS.has(c.el.tagName) && c.overlap / selectionArea >= 0.6
  );
  if (dominantMedia) {
    const tag = dominantMedia.el.tagName.toLowerCase();
    const reasonMap: Record<string, string> = {
      video: 'Selected region is a <video> frame. Underlying scene pixels do not expose HTML/CSS — switched to Visual-Only sampling.',
      canvas: 'Selected region is a <canvas>/WebGL surface. Rendered pixels do not expose child DOM — switched to Visual-Only sampling.',
      iframe: 'Selected region is an embedded <iframe>. Cross-origin frame internals are isolated by browser security policy — switched to Visual-Only sampling.',
    };
    return {
      elements: [dominantMedia.el],
      visualOnlyReason: reasonMap[tag] ?? 'Visual-only media surface selected.',
    };
  }

  if (candidates.length === 0) {
    // Fallback to element at center of marquee
    const centerEl = doc.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (centerEl && centerEl !== doc.body && centerEl !== doc.documentElement && !isInsideOverlay(centerEl)) {
      return { elements: [centerEl] };
    }
    return {
      elements: [],
      visualOnlyReason: 'No inspectable DOM nodes intersected this region — displaying pixel-sampled palette only.',
    };
  }

  // Prefer a single clean wrapper whose bounds closely match the marquee
  const bestSingle = candidates
    .filter((c) => c.iou >= 0.5 && c.elArea <= selectionArea * 1.8)
    .sort((a, b) => b.iou - a.iou)[0];

  if (bestSingle) {
    return { elements: [bestSingle.el] };
  }

  // Exclude oversized partial-width containers (e.g. a 1440px <header> when the user dragged a 420px marquee)
  // whenever tighter child candidates exist inside the selection — prevents `justify-content: space-between`
  // from teleporting center nav items after right-edge siblings are pruned.
  const effectiveCandidates = candidates.filter((c) => {
    const isOversizedContainer =
      c.el.children.length > 0 &&
      !getDirectTextSnippet(c.el) &&
      (c.elRect.width > rect.width * 1.35 || c.elArea > selectionArea * 2.2);
    if (!isOversizedContainer) return true;
    const hasChildCandidate = candidates.some((other) => other.el !== c.el && c.el.contains(other.el));
    return !hasChildCandidate;
  });

  // Otherwise take top-level candidates (prune descendants of already-selected elements)
  const pool = effectiveCandidates.length > 0 ? effectiveCandidates : candidates;
  const candidateSet = new Set(pool.map((c) => c.el));
  const topLevel = pool
    .filter((c) => {
      let parent = c.el.parentElement;
      while (parent) {
        if (candidateSet.has(parent)) return false;
        parent = parent.parentElement;
      }
      return true;
    })
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 12)
    .map((c) => c.el);

  return { elements: topLevel };
}

const RASTER_ARTWORK_TAGS = new Set(['img', 'picture', 'image']);

function detectGraphicArtwork(
  roots: ExtractedNode[],
  selectionRect: ViewportRect,
  hostname = ''
): { containsGraphicArtwork: boolean; graphicArtworkNote?: string } {
  const selectionArea = Math.max(1, selectionRect.width * selectionRect.height);
  let maxGraphicRatio = 0;
  let graphicTag = '';
  let textNodeCount = 0;
  let maxTextSnippetLen = 0;

  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.textSnippet) {
      textNodeCount += 1;
      maxTextSnippetLen = Math.max(maxTextSnippetLen, node.textSnippet.trim().length);
    }

    const overlapRatio = rectIntersectionArea(node.rect, selectionRect) / selectionArea;
    // Inline <svg> with captured vector markup IS recreated 1-to-1 verbatim;
    // only raster <img>/<picture>, background-image URLs, or uncaptured oversized <svg> count as baked artwork.
    const isUncapturedGraphic =
      RASTER_ARTWORK_TAGS.has(node.tag) || (node.tag === 'svg' && !node.svgMarkup);

    if (isUncapturedGraphic && overlapRatio > maxGraphicRatio) {
      maxGraphicRatio = overlapRatio;
      graphicTag = node.tag;
    } else if (
      node.styles.backgroundImage &&
      /url\(/i.test(node.styles.backgroundImage) &&
      overlapRatio > maxGraphicRatio
    ) {
      maxGraphicRatio = overlapRatio;
      graphicTag = 'background-image';
    }

    for (const child of node.children) stack.push(child);
  }

  const isSearchGridThumb =
    isImageSearchHostname(hostname) &&
    maxGraphicRatio >= 0.45 &&
    textNodeCount <= 4 &&
    maxTextSnippetLen <= 60;

  if ((maxGraphicRatio >= 0.4 && textNodeCount <= 1) || isSearchGridThumb) {
    return {
      containsGraphicArtwork: true,
      graphicArtworkNote: `Mostly rendered artwork (<${graphicTag}>) with baked-in lettering/shapes. Use Image AI (Gemini, ChatGPT, Grok, Qwen) to edit text, extract the exact font, and clean the background.`,
    };
  }
  return { containsGraphicArtwork: false };
}

export function extractDomFromSelection(
  doc: Document,
  rect: ViewportRect,
  selectionMethod: SelectionMethod,
  snappedElement?: Element | null
): RawDomExtraction {
  const counter = { count: 0, truncated: false, idSeq: 0 };
  const cssVariables = discoverRootCssVariables(doc);
  const { fontStylesheetUrls, pageStylesheetUrls, fontFaceRules, loadedFontFamilies } =
    discoverWebfontAssets(doc);
  const pageFallbackTypography = extractPageFallbackTypography(doc);

  if (selectionMethod === 'element-snap' && snappedElement && !isInsideOverlay(snappedElement)) {
    if (VISUAL_MEDIA_TAGS.has(snappedElement.tagName)) {
      const tag = snappedElement.tagName.toLowerCase();
      const root = buildNodeTree(snappedElement, null, 0, counter);
      return {
        captureMode: 'visual-only',
        visualFallbackReason: `Selected element is a <${tag}> surface whose internal pixels are not exposed as DOM. Showing pixel-sampled visual tokens.`,
        selectionMethod,
        totalNodesScanned: counter.count,
        truncated: counter.truncated,
        roots: root ? [root] : [],
        cssVariables,
        fontStylesheetUrls,
        pageStylesheetUrls,
        fontFaceRules,
        loadedFontFamilies,
        pageFallbackTypography,
      };
    }

    const root = buildNodeTree(snappedElement, null, 0, counter);
    const roots = root ? [root] : [];
    const artwork = detectGraphicArtwork(roots, rect, doc.location?.hostname ?? '');
    return {
      captureMode: root ? 'dom-and-visual' : 'visual-only',
      visualFallbackReason: root ? undefined : 'Target element could not be serialized.',
      containsGraphicArtwork: artwork.containsGraphicArtwork,
      graphicArtworkNote: artwork.graphicArtworkNote,
      selectionMethod,
      totalNodesScanned: counter.count,
      truncated: counter.truncated,
      roots,
      cssVariables,
      fontStylesheetUrls,
      pageStylesheetUrls,
      fontFaceRules,
      loadedFontFamilies,
      pageFallbackTypography,
    };
  }

  const { elements, visualOnlyReason } = findMarqueeRoots(doc, rect);
  const roots: ExtractedNode[] = [];
  for (const el of elements) {
    const tree = buildNodeTree(el, visualOnlyReason ? null : rect, 0, counter);
    if (tree) roots.push(tree);
  }

  const artwork = detectGraphicArtwork(roots, rect, doc.location?.hostname ?? '');

  return {
    captureMode: visualOnlyReason || roots.length === 0 ? 'visual-only' : 'dom-and-visual',
    visualFallbackReason: visualOnlyReason,
    containsGraphicArtwork: artwork.containsGraphicArtwork,
    graphicArtworkNote: artwork.graphicArtworkNote,
    selectionMethod,
    totalNodesScanned: counter.count,
    truncated: counter.truncated,
    roots,
    cssVariables,
    fontStylesheetUrls,
    pageStylesheetUrls,
    fontFaceRules,
    loadedFontFamilies,
    pageFallbackTypography,
  };
}
