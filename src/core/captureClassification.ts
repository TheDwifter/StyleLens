import type {
  CaptureRecord,
  ExtractedNode,
  RawDomExtraction,
  TypographyToken,
  ViewportRect,
} from '../types/capture';

const IMAGE_SEARCH_HOST_RE = /(?:^|\.)(?:google\.|bing\.com|duckduckgo\.com|pinterest\.|yandex\.)/i;

/**
 * Search-engine / aggregator UI chrome fonts (e.g. Google's "Google Sans" / "Product Sans" / "Roboto")
 * that appear on search result cards and must NEVER be misreported as a captured logo's brand font.
 */
const SEARCH_CHROME_FONT_RE =
  /^(?:google sans(?:\s+(?:text|display|mono))?|product sans|roboto|arial|helvetica(?:\s+neue)?|segoe ui|noto sans|pingfang sc|microsoft yahei|system-ui|-apple-system|blinkmacsystemfont|sans-serif)$/i;

export function isImageSearchHostname(hostname: string | undefined): boolean {
  return Boolean(hostname && IMAGE_SEARCH_HOST_RE.test(hostname));
}

export function isSearchChromeFontFamily(rawFontName: string | undefined): boolean {
  if (!rawFontName) return false;
  const clean = (rawFontName.split(',')[0] ?? rawFontName)
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim();
  return SEARCH_CHROME_FONT_RE.test(clean);
}

function isVisualMediaNode(node: ExtractedNode): boolean {
  if (
    node.tag === 'img' ||
    node.tag === 'picture' ||
    node.tag === 'canvas' ||
    node.tag === 'video' ||
    node.tag === 'svg' ||
    node.tag === 'image'
  ) {
    return true;
  }
  const bg = node.styles?.backgroundImage;
  return Boolean(bg && bg !== 'none' && /url\(/i.test(bg));
}

export function hasLargeVisualMediaNode(
  roots: ExtractedNode[],
  rect: ViewportRect,
  areaThreshold = 0.45
): boolean {
  const captureArea = Math.max(1, rect.width * rect.height);
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (isVisualMediaNode(node)) {
      const w = Math.max(0, node.rect.width);
      const h = Math.max(0, node.rect.height);
      const area = w * h;
      if (area >= captureArea * areaThreshold) return true;
      if (areaThreshold <= 0.2 && w >= 36 && h >= 36) return true;
    }
    for (const child of node.children) stack.push(child);
  }
  return false;
}

export function isArtworkOrPhotoLikeDom(
  dom: Pick<RawDomExtraction, 'containsGraphicArtwork' | 'captureMode' | 'roots'>,
  rect: ViewportRect,
  hostname: string
): boolean {
  if (Boolean(dom.containsGraphicArtwork) || dom.captureMode === 'visual-only') {
    return true;
  }
  return isImageSearchHostname(hostname) && hasLargeVisualMediaNode(dom.roots, rect, 0.15);
}

/**
 * Unified artwork/photo detector shared across prompts, Step 2 previews, Remix, and Fidelity Critic.
 * Returns true for baked graphic artwork, visual-only captures, and image-search grid thumbnails
 * (Google Images, Bing, DuckDuckGo, Pinterest, Yandex) where host chrome text/fonts like "Google Sans"
 * must NEVER leak into the user's typography or AI prompts.
 */
export function isArtworkOrPhotoLikeCapture(
  record: Pick<CaptureRecord, 'containsGraphicArtwork' | 'captureMode' | 'page' | 'rect' | 'roots'>
): boolean {
  if (Boolean(record.containsGraphicArtwork) || record.captureMode === 'visual-only') {
    return true;
  }
  return (
    isImageSearchHostname(record.page.hostname) &&
    hasLargeVisualMediaNode(record.roots, record.rect, 0.15)
  );
}

/**
 * True when host-page fallback or grazed UI typography belongs to an image search engine / aggregator
 * (e.g. "Google Sans" on www.google.com) rather than the brand whose logo/photo was captured.
 * Preserves brand-site fallback fonts (e.g. Bones Custom Display on bonesbearings.com, Pepsi on pepsi.ca)
 * while 100% blocking "GOOGLE SANS · EXACT FONT" leaks in Step 2 preview, Asset Kit, and Remix!
 */
export function shouldSuppressHostFallbackFont(
  record: Pick<
    CaptureRecord,
    'containsGraphicArtwork' | 'captureMode' | 'page' | 'rect' | 'roots'
  > & {
    dna?: Pick<CaptureRecord['dna'], 'typography'>;
  }
): boolean {
  if (!isImageSearchHostname(record.page.hostname)) return false;
  if (isArtworkOrPhotoLikeCapture(record)) return true;
  if (hasLargeVisualMediaNode(record.roots, record.rect, 0.08)) return true;
  const typo = record.dna?.typography ?? [];
  return typo.length === 0 || typo.every((t) => isSearchChromeFontFamily(t.primaryFont));
}

/**
 * True only when the capture is live DOM text with real captured typography, i.e. the one case
 * where an HTML/CSS preview can honestly render the user's word in the captured font.
 * For raster logos / photos / image-search thumbnails there are only pixels (no webfont), so any
 * HTML preview would fall back to a generic system font and misrepresent the style: Step 2 must
 * show the picture itself as the locked style reference instead.
 */
export function canRenderLiveFontPreview(
  record: Pick<
    CaptureRecord,
    'containsGraphicArtwork' | 'captureMode' | 'page' | 'rect' | 'roots'
  > & {
    dna?: Pick<CaptureRecord['dna'], 'typography'>;
  }
): boolean {
  if (isArtworkOrPhotoLikeCapture(record) || shouldSuppressHostFallbackFont(record)) return false;
  return filterCapturedTypography(record, record.dna?.typography ?? []).length > 0;
}

/**
 * Strips search-engine UI chrome typography tokens (e.g. grazed "Google Sans" captions on
 * www.google.com) while preserving 100% of typography on non-search brand websites.
 */
export function filterCapturedTypography(
  record: Pick<
    CaptureRecord,
    'containsGraphicArtwork' | 'captureMode' | 'page' | 'rect' | 'roots'
  > & {
    dna?: Pick<CaptureRecord['dna'], 'typography'>;
  },
  tokens: TypographyToken[]
): TypographyToken[] {
  if (shouldSuppressHostFallbackFont(record)) return [];
  if (!isImageSearchHostname(record.page.hostname)) return tokens;
  return tokens.filter((t) => !isSearchChromeFontFamily(t.primaryFont));
}
