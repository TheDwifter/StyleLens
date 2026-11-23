import type { ExtractedNode, RawDomExtraction } from '../types/capture';

export interface FontEmbedResult {
  fontFaceRules: string[];
  fontStylesheetUrls: string[];
  embeddedCount: number;
  embeddedFamilies: string[];
}

export interface FontEmbedOptions {
  timeoutMs?: number;
  maxStylesheets?: number;
  maxCssBytes?: number;
  maxEmbeddedFaces?: number;
  maxSingleFontBytes?: number;
  maxTotalFontBytes?: number;
  fetchFn?: typeof fetch;
}

interface ParsedFontSource {
  url: string;
  format: 'woff2' | 'woff' | 'truetype' | 'opentype' | 'unknown';
  mime: string;
  priority: number;
  isDataUri: boolean;
}

interface ParsedFontFace {
  rawFamily: string;
  cleanFamily: string;
  fontWeight: string;
  fontStyle: string;
  unicodeRange?: string;
  sources: ParsedFontSource[];
}

interface TargetFontInfo {
  cleanName: string;
  rawNames: Set<string>;
  weights: Set<number>;
  wantsItalic: boolean;
  priorityBoost: number;
}

const SYSTEM_FONTS = new Set([
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
  'pingfang sc',
  'microsoft yahei',
  'hiragino sans gb',
]);

const FONT_CDN_PATTERN =
  /fonts\.googleapis\.com|fonts\.bunny\.net|use\.typekit\.net|fonts\.gstatic\.com|api\.fontshare\.com|fonts\.cdnfonts\.com|rsms\.me|\/fonts?\b/i;

const PRIORITY_SHEET_PATTERN =
  /font|type|typo|theme|global|main|app|bundle|style|layout|_next\/static\/css|\/assets\/|\/static\/|\/chunks\//i;

export function cleanWebfontFamilyName(raw: string): string {
  const unquoted = raw.replace(/^["'\s]+|["'\s]+$/g, '').trim();
  if (!unquoted) return '';
  return unquoted
    .replace(/^__/, '')
    .replace(/_[a-f0-9]{5,}$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeCssToken(value: string): string {
  return value.replace(/[;{}<>\\"]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeFontWeight(raw: string | undefined): string {
  if (!raw) return '400';
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === 'normal') return '400';
  if (cleaned === 'bold') return '700';
  const rangeMatch = cleaned.match(/^(\d{3,4})\s+(\d{3,4})$/);
  if (rangeMatch?.[1] && rangeMatch[2]) {
    return `${rangeMatch[1]} ${rangeMatch[2]}`;
  }
  const singleMatch = cleaned.match(/\b(\d{3,4})\b/);
  if (singleMatch?.[1]) return singleMatch[1];
  return '400';
}

function fontWeightCovers(faceWeight: string, targetWeight: number): boolean {
  const rangeMatch = faceWeight.match(/^(\d{3,4})\s+(\d{3,4})$/);
  if (rangeMatch?.[1] && rangeMatch[2]) {
    const min = Number.parseInt(rangeMatch[1], 10);
    const max = Number.parseInt(rangeMatch[2], 10);
    return targetWeight >= min && targetWeight <= max;
  }
  const single = Number.parseInt(faceWeight, 10) || 400;
  return single === targetWeight;
}

function isVariableWeight(faceWeight: string): boolean {
  return /^\d{3,4}\s+\d{3,4}$/.test(faceWeight);
}

/**
 * Checks whether a CSS `unicode-range` covers standard ASCII Latin letters (A-Z / a-z),
 * preventing Cyrillic/Greek/Vietnamese subsets from hijacking English font slots.
 */
export function unicodeRangeCoversBasicLatin(unicodeRange?: string): boolean {
  if (!unicodeRange || !unicodeRange.trim()) return true;
  const segments = unicodeRange.split(',');
  let coveredChars = 0;

  for (const rawSeg of segments) {
    const seg = rawSeg.trim().toUpperCase();
    if (!seg.startsWith('U+')) continue;
    const body = seg.slice(2);

    let start = -1;
    let end = -1;

    if (body.includes('?')) {
      const minHex = body.replace(/\?/g, '0');
      const maxHex = body.replace(/\?/g, 'F');
      start = Number.parseInt(minHex, 16);
      end = Number.parseInt(maxHex, 16);
    } else if (body.includes('-')) {
      const [s, e] = body.split('-');
      if (s && e) {
        start = Number.parseInt(s, 16);
        end = Number.parseInt(e, 16);
      }
    } else {
      start = Number.parseInt(body, 16);
      end = start;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) continue;
    // Fast-path: covers full A-z range (0x0041..0x007A)
    if (start <= 0x0041 && end >= 0x007a) return true;

    const overlapStart = Math.max(start, 0x0041);
    const overlapEnd = Math.min(end, 0x007a);
    if (overlapEnd >= overlapStart) {
      coveredChars += overlapEnd - overlapStart + 1;
      if (coveredChars >= 26) return true;
    }
  }

  return false;
}

function inferFormatAndMime(
  url: string,
  explicitFormat?: string
): { format: ParsedFontSource['format']; mime: string; priority: number } | null {
  const fmt = (explicitFormat ?? '').toLowerCase().trim();
  const isData = /^data:/i.test(url);
  const pathLower = isData ? '' : (url.split('?')[0]?.split('#')[0]?.toLowerCase() ?? '');
  const dataHeader = isData ? (url.slice(0, 80).toLowerCase()) : '';

  if (
    fmt.includes('woff2') ||
    pathLower.endsWith('.woff2') ||
    /^data:(?:font\/woff2|application\/(?:x-)?font-woff2)/i.test(dataHeader)
  ) {
    return { format: 'woff2', mime: 'font/woff2', priority: 100 };
  }
  if (
    fmt === 'woff' ||
    fmt === '"woff"' ||
    pathLower.endsWith('.woff') ||
    /^data:(?:font\/woff|application\/(?:x-)?font-woff)(?:;|,)/i.test(dataHeader)
  ) {
    return { format: 'woff', mime: 'font/woff', priority: 70 };
  }
  if (
    fmt.includes('truetype') ||
    pathLower.endsWith('.ttf') ||
    /^data:(?:font\/ttf|application\/(?:x-)?font-ttf|application\/(?:x-)?font-truetype)/i.test(dataHeader)
  ) {
    return { format: 'truetype', mime: 'font/ttf', priority: 50 };
  }
  if (
    fmt.includes('opentype') ||
    pathLower.endsWith('.otf') ||
    /^data:(?:font\/otf|application\/(?:x-)?font-otf|application\/(?:x-)?font-opentype)/i.test(dataHeader)
  ) {
    return { format: 'opentype', mime: 'font/otf', priority: 40 };
  }
  if (
    fmt.includes('embedded-opentype') ||
    fmt.includes('svg') ||
    pathLower.endsWith('.eot') ||
    pathLower.endsWith('.svg')
  ) {
    return null;
  }
  if (isData && /^data:(?:font\/|application\/(?:x-font|font|octet-stream))/i.test(dataHeader)) {
    return { format: 'unknown', mime: 'font/woff2', priority: 60 };
  }
  // Extensionless CDN font endpoints (e.g. Typekit / Cloud.typography / proxy URLs)
  if (/^https?:\/\//i.test(url)) {
    return { format: 'unknown', mime: 'font/woff2', priority: 30 };
  }
  return null;
}

/**
 * Quote- and parenthesis-aware CSS declaration splitter so semicolons inside
 * `url("data:font/woff2;charset=utf-8;base64,...")` never truncate `src:` declarations.
 */
function parseCssDeclarations(blockBody: string): Array<{ prop: string; value: string }> {
  const decls: Array<{ prop: string; value: string }> = [];
  let inQuote: '"' | "'" | null = null;
  let parenDepth = 0;
  let start = 0;

  const pushSegment = (segment: string) => {
    const trimmed = segment.trim();
    if (!trimmed) return;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) return;
    const prop = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (prop && value) {
      decls.push({ prop, value });
    }
  };

  for (let i = 0; i < blockBody.length; i++) {
    const ch = blockBody[i]!;
    if (inQuote) {
      if (ch === inQuote && blockBody[i - 1] !== '\\') {
        inQuote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (ch === ';' && parenDepth === 0) {
      pushSegment(blockBody.slice(start, i));
      start = i + 1;
    }
  }
  if (start < blockBody.length) {
    pushSegment(blockBody.slice(start));
  }
  return decls;
}

function parseSrcUrls(srcValue: string, baseUrl: string): ParsedFontSource[] {
  const sources: ParsedFontSource[] = [];
  const pattern =
    /url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(\s*(['"]?)([^'")]+)\3\s*\))?/gi;

  for (const match of srcValue.matchAll(pattern)) {
    const rawUrl = (match[2] ?? '').trim();
    const explicitFormat = match[4]?.trim();
    if (!rawUrl || rawUrl.startsWith('#')) continue;

    let resolvedUrl = rawUrl;
    const isDataUri = /^data:/i.test(rawUrl);
    if (!isDataUri) {
      try {
        resolvedUrl = new URL(rawUrl, baseUrl).href;
      } catch {
        continue;
      }
      if (!/^https?:\/\//i.test(resolvedUrl)) continue;
    }

    const meta = inferFormatAndMime(resolvedUrl, explicitFormat);
    if (!meta) continue;
    sources.push({
      url: resolvedUrl,
      format: meta.format,
      mime: meta.mime,
      priority: meta.priority + (isDataUri ? 15 : 0),
      isDataUri,
    });
  }

  return sources.sort((a, b) => b.priority - a.priority);
}

/**
 * Extracts all `@font-face` declarations and `@import` stylesheet URLs from a CSS text blob.
 */
export function parseCssFontMetadata(
  cssText: string,
  baseUrl: string
): { fontFaces: ParsedFontFace[]; importUrls: string[] } {
  // Strip CSS comments so commented-out @font-face rules aren't matched
  const cleanCss = cssText.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const importUrls: string[] = [];

  const importPattern = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/gi;
  for (const match of cleanCss.matchAll(importPattern)) {
    const rawHref = (match[2] ?? '').trim();
    if (!rawHref) continue;
    try {
      const abs = new URL(rawHref, baseUrl).href;
      if (/^https?:\/\//i.test(abs) && !importUrls.includes(abs)) {
        importUrls.push(abs);
      }
    } catch {
      // Ignore invalid import URL
    }
  }

  const fontFaces: ParsedFontFace[] = [];
  const facePattern = /@font-face\s*\{([^}]+)\}/gi;

  for (const match of cleanCss.matchAll(facePattern)) {
    const body = match[1];
    if (!body) continue;

    const decls = parseCssDeclarations(body);
    let rawFamilyVal = '';
    let rawWeightVal: string | undefined;
    let rawStyleVal: string | undefined;
    let rawUnicodeVal: string | undefined;
    const allSources: ParsedFontSource[] = [];

    for (const d of decls) {
      if (d.prop === 'font-family') rawFamilyVal = d.value;
      else if (d.prop === 'font-weight') rawWeightVal = d.value;
      else if (d.prop === 'font-style') rawStyleVal = d.value;
      else if (d.prop === 'unicode-range') rawUnicodeVal = d.value;
      else if (d.prop === 'src') {
        allSources.push(...parseSrcUrls(d.value, baseUrl));
      }
    }

    if (!rawFamilyVal || allSources.length === 0) continue;
    const rawFamily = rawFamilyVal.trim().replace(/^["']|["']$/g, '').trim();
    const cleanFamily = cleanWebfontFamilyName(rawFamily);
    if (!rawFamily || !cleanFamily) continue;

    allSources.sort((a, b) => b.priority - a.priority);

    fontFaces.push({
      rawFamily,
      cleanFamily,
      fontWeight: normalizeFontWeight(rawWeightVal),
      fontStyle: (rawStyleVal ?? 'normal').trim().toLowerCase() === 'italic' ? 'italic' : 'normal',
      unicodeRange: rawUnicodeVal?.trim(),
      sources: allSources,
    });
  }

  return { fontFaces, importUrls };
}

function collectTargetFonts(dom: RawDomExtraction): Map<string, TargetFontInfo> {
  const targets = new Map<string, TargetFontInfo>();

  const registerStack = (
    fontStack: string | undefined,
    weightRaw: string | number | undefined,
    styleRaw: string | undefined,
    priorityBoost: number
  ) => {
    if (!fontStack) return;
    const weight =
      typeof weightRaw === 'number'
        ? weightRaw
        : Number.parseInt(String(weightRaw ?? '400'), 10) || 400;
    const isItalic = String(styleRaw ?? '').toLowerCase() === 'italic';

    // Scan the entire comma-separated stack so custom webfonts placed after system aliases are never dropped
    const parts = fontStack.split(',');
    parts.forEach((part, idx) => {
      const raw = part.replace(/^["'\s]+|["'\s]+$/g, '').trim();
      const clean = cleanWebfontFamilyName(raw);
      const lower = clean.toLowerCase();
      if (!clean || SYSTEM_FONTS.has(lower) || SYSTEM_FONTS.has(raw.toLowerCase())) return;

      const existing = targets.get(lower);
      const boost = Math.max(20, priorityBoost - idx * 35);
      if (existing) {
        existing.rawNames.add(raw.toLowerCase());
        existing.weights.add(weight);
        if (isItalic) existing.wantsItalic = true;
        existing.priorityBoost = Math.max(existing.priorityBoost, boost);
      } else {
        targets.set(lower, {
          cleanName: clean,
          rawNames: new Set([raw.toLowerCase(), lower]),
          weights: new Set([weight]),
          wantsItalic: isItalic,
          priorityBoost: boost,
        });
      }
    });
  };

  // 1. Highest priority: fonts explicitly used in selected capture DOM nodes
  const stack: ExtractedNode[] = [...dom.roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.styles.fontFamily) {
      registerStack(node.styles.fontFamily, node.styles.fontWeight, node.styles.fontStyle, 220);
    }
    for (const child of node.children) stack.push(child);
  }

  // 2. Second priority: host page fallback typography (critical for artwork/<img> captures!)
  for (const token of dom.pageFallbackTypography ?? []) {
    registerStack(token.fontStack || token.primaryFont, token.fontWeight, 'normal', 180);
  }

  // 3. Third priority: fonts reported as `status === 'loaded'` by `document.fonts`
  for (const loaded of dom.loadedFontFamilies ?? []) {
    registerStack(loaded, 400, 'normal', 90);
  }

  return targets;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function detectFontFormatFromBytes(
  buffer: ArrayBuffer
): { mime: string; format: string } | 'invalid-html' | null {
  const bytes = new Uint8Array(buffer, 0, Math.min(32, buffer.byteLength));
  if (bytes.length < 4) return null;

  // Reject HTML / XML / JSON error bodies even if the CDN omitted Content-Type
  let asciiPrefix = '';
  for (let i = 0; i < bytes.length; i++) {
    asciiPrefix += String.fromCharCode(bytes[i]!);
  }
  if (/^\s*(?:<!doctype|<html|<head|<body|<svg|<\?xml|\{)/i.test(asciiPrefix)) {
    return 'invalid-html';
  }

  // WOFF2: 'wOF2'
  if (bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32) {
    return { mime: 'font/woff2', format: 'woff2' };
  }
  // WOFF: 'wOFF'
  if (bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return { mime: 'font/woff', format: 'woff' };
  }
  // OpenType CFF: 'OTTO'
  if (bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f) {
    return { mime: 'font/otf', format: 'opentype' };
  }
  // TrueType: 0x00010000 or 'true'
  if (
    (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) ||
    (bytes[0] === 0x74 && bytes[1] === 0x72 && bytes[2] === 0x75 && bytes[3] === 0x65)
  ) {
    return { mime: 'font/ttf', format: 'truetype' };
  }

  return null;
}

function resolveMimeFromResponse(
  responseContentType: string | null,
  source: ParsedFontSource,
  buffer?: ArrayBuffer
): { mime: string; format: string } | null {
  if (buffer) {
    const sniffed = detectFontFormatFromBytes(buffer);
    if (sniffed === 'invalid-html') return null;
    if (sniffed) return sniffed;
  }

  const ct = (responseContentType ?? '').toLowerCase();
  if (ct.includes('woff2')) return { mime: 'font/woff2', format: 'woff2' };
  if (ct.includes('woff')) return { mime: 'font/woff', format: 'woff' };
  if (ct.includes('ttf') || ct.includes('truetype')) return { mime: 'font/ttf', format: 'truetype' };
  if (ct.includes('otf') || ct.includes('opentype')) return { mime: 'font/otf', format: 'opentype' };

  const format = source.format === 'unknown' ? '' : source.format;
  return { mime: source.mime, format };
}

function buildEmbeddedFontFaceCss(
  familyName: string,
  fontStyle: string,
  fontWeight: string,
  dataUri: string,
  format: string,
  unicodeRange?: string
): string {
  const safeFamily = sanitizeCssToken(familyName);
  const safeStyle = fontStyle === 'italic' ? 'italic' : 'normal';
  const safeWeight = normalizeFontWeight(fontWeight);
  const safeRange =
    unicodeRange && /^[U+\da-fA-F,\-\s?]+$/.test(unicodeRange.trim())
      ? ` unicode-range: ${unicodeRange.trim()};`
      : '';
  const formatClause = format ? ` format("${sanitizeCssToken(format)}")` : '';

  return `@font-face { font-family: "${safeFamily}"; font-style: ${safeStyle}; font-weight: ${safeWeight}; font-display: swap; src: url("${dataUri}")${formatClause};${safeRange} }`;
}

/**
 * Fetches cross-origin stylesheets and font binaries from the MV3 Service Worker
 * (exempt from `<iframe sandbox="" srcDoc>` opaque `Origin: null` CORS blocking),
 * converts matching `.woff2`/`.woff`/`.ttf` binaries into base64 data-URI `@font-face`
 * rules, and returns them prepended ahead of fallback rules.
 */
export async function resolveAndEmbedWebfonts(
  dom: RawDomExtraction,
  pageUrl: string,
  options: FontEmbedOptions = {}
): Promise<FontEmbedResult> {
  const timeoutMs = options.timeoutMs ?? 2400;
  const maxStylesheets = options.maxStylesheets ?? 12;
  const maxCssBytes = options.maxCssBytes ?? 1_500_000;
  const maxEmbeddedFaces = options.maxEmbeddedFaces ?? 4;
  const maxSingleFontBytes = options.maxSingleFontBytes ?? 180_000;
  const maxTotalFontBytes = options.maxTotalFontBytes ?? 480_000;
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  const existingFontFaceRules = dom.fontFaceRules ?? [];
  const discoveredFontSheetUrls = new Set<string>(dom.fontStylesheetUrls ?? []);

  const targets = collectTargetFonts(dom);
  if (targets.size === 0 || typeof fetchFn !== 'function') {
    return {
      fontFaceRules: existingFontFaceRules,
      fontStylesheetUrls: Array.from(discoveredFontSheetUrls).slice(0, 6),
      embeddedCount: 0,
      embeddedFamilies: [],
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const candidateFaces: ParsedFontFace[] = [];

    // 1. Parse any @font-face rules already captured by content script CSSOM
    if (existingFontFaceRules.length > 0) {
      const parsedInline = parseCssFontMetadata(existingFontFaceRules.join('\n'), pageUrl);
      candidateFaces.push(...parsedInline.fontFaces);
    }

    // 2. Prioritize font CDN stylesheets first, then likely theme/app stylesheets
    const rawSheetUrls = Array.from(
      new Set([...(dom.fontStylesheetUrls ?? []), ...(dom.pageStylesheetUrls ?? [])])
    )
      .filter((u) => /^https?:\/\//i.test(u))
      .sort((a, b) => {
        const aScore = (FONT_CDN_PATTERN.test(a) ? 20 : 0) + (PRIORITY_SHEET_PATTERN.test(a) ? 10 : 0);
        const bScore = (FONT_CDN_PATTERN.test(b) ? 20 : 0) + (PRIORITY_SHEET_PATTERN.test(b) ? 10 : 0);
        return bScore - aScore;
      })
      .slice(0, maxStylesheets);

    const fetchedSheetUrls = new Set<string>();
    const pendingImports: string[] = [];

    const fetchSheet = async (sheetUrl: string) => {
      if (fetchedSheetUrls.has(sheetUrl) || controller.signal.aborted) return;
      fetchedSheetUrls.add(sheetUrl);
      try {
        const resp = await fetchFn(sheetUrl, {
          signal: controller.signal,
          credentials: 'omit',
        });
        if (!resp.ok) return;
        const ct = (resp.headers.get('content-type') ?? '').toLowerCase();
        if (ct.includes('text/html') || ct.includes('application/json')) return;
        const contentLength = Number.parseInt(resp.headers.get('content-length') ?? '0', 10);
        if (contentLength > maxCssBytes) return;
        const cssText = await resp.text();
        if (!cssText || cssText.length > maxCssBytes) return;

        const { fontFaces, importUrls } = parseCssFontMetadata(cssText, sheetUrl);
        candidateFaces.push(...fontFaces);
        for (const imp of importUrls) {
          if (FONT_CDN_PATTERN.test(imp) && imp.startsWith('https://')) {
            discoveredFontSheetUrls.add(imp);
          }
          if (!fetchedSheetUrls.has(imp) && pendingImports.length < 4) {
            pendingImports.push(imp);
          }
        }
      } catch {
        // Ignore individual stylesheet fetch/timeout failures
      }
    };

    await Promise.all(rawSheetUrls.map((u) => fetchSheet(u)));

    // Follow 1 level of @import URLs (e.g. main.css importing fonts.css)
    if (pendingImports.length > 0 && !controller.signal.aborted) {
      await Promise.all(pendingImports.slice(0, 3).map((u) => fetchSheet(u)));
    }

    // 3. Match and rank candidate @font-face declarations against target families
    const matchedCandidates: Array<{
      face: ParsedFontFace;
      target: TargetFontInfo;
      source: ParsedFontSource;
      score: number;
      coversLatin: boolean;
    }> = [];

    for (const face of candidateFaces) {
      const cleanLower = face.cleanFamily.toLowerCase();
      const rawLower = face.rawFamily.toLowerCase();

      let target = targets.get(cleanLower);
      if (!target) {
        for (const t of targets.values()) {
          if (t.rawNames.has(rawLower) || t.rawNames.has(cleanLower)) {
            target = t;
            break;
          }
        }
      }
      if (!target) continue;

      const bestSource = face.sources[0];
      if (!bestSource) continue;

      const coversLatin = unicodeRangeCoversBasicLatin(face.unicodeRange);
      const weightMatches = Array.from(target.weights).some((w) =>
        fontWeightCovers(face.fontWeight, w)
      );
      const isVar = isVariableWeight(face.fontWeight);
      const styleMatches =
        face.fontStyle === 'normal' || (face.fontStyle === 'italic' && target.wantsItalic);

      let score = target.priorityBoost + bestSource.priority;
      score += coversLatin ? 180 : -400;
      if (isVar) score += 75;
      if (weightMatches) score += 60;
      if (styleMatches) score += 30;
      else score -= 45;
      if (!face.unicodeRange) score += 20;

      matchedCandidates.push({
        face,
        target,
        source: bestSource,
        score,
        coversLatin,
      });
    }

    // Filter out non-Latin subsets whenever ANY Latin-compatible candidate exists for the same family
    const latinFamilies = new Set(
      matchedCandidates
        .filter((c) => c.coversLatin)
        .map((c) => c.face.cleanFamily.toLowerCase())
    );
    const filteredCandidates = matchedCandidates
      .filter((c) => c.coversLatin || !latinFamilies.has(c.face.cleanFamily.toLowerCase()))
      .sort((a, b) => b.score - a.score);

    // Select up to `maxEmbeddedFaces` distinct (family, weight, style) entries,
    // balancing across distinct target families first so both heading AND body fonts embed!
    const selected: typeof filteredCandidates = [];
    const seenSlot = new Set<string>();
    const seenUrls = new Set<string>();
    const familiesCovered = new Set<string>();

    // Pass A: Pick the #1 best face for each distinct target family first
    for (const cand of filteredCandidates) {
      if (selected.length >= maxEmbeddedFaces) break;
      const famKey = cand.face.cleanFamily.toLowerCase();
      if (familiesCovered.has(famKey)) continue;
      const slotKey = `${famKey}|${cand.face.fontWeight}|${cand.face.fontStyle}`;
      if (seenSlot.has(slotKey) || seenUrls.has(cand.source.url)) continue;

      familiesCovered.add(famKey);
      seenSlot.add(slotKey);
      seenUrls.add(cand.source.url);
      selected.push(cand);
    }

    // Pass B: Fill remaining slots with additional weights (e.g., 700 bold + 400 regular)
    for (const cand of filteredCandidates) {
      if (selected.length >= maxEmbeddedFaces) break;
      const famKey = cand.face.cleanFamily.toLowerCase();
      const slotKey = `${famKey}|${cand.face.fontWeight}|${cand.face.fontStyle}`;
      if (seenSlot.has(slotKey) || seenUrls.has(cand.source.url)) continue;

      // Skip secondary weights if we already embedded a variable font for this family + style
      const alreadyVariable = selected.some(
        (s) =>
          s.face.cleanFamily.toLowerCase() === famKey &&
          s.face.fontStyle === cand.face.fontStyle &&
          isVariableWeight(s.face.fontWeight)
      );
      if (alreadyVariable) continue;

      seenSlot.add(slotKey);
      seenUrls.add(cand.source.url);
      selected.push(cand);
    }

    // 4. Download selected font binaries in parallel & inline as base64 data URIs
    let totalBytes = 0;
    const embeddedRules: string[] = [];
    const embeddedFamiliesSet = new Set<string>();

    const downloaded = await Promise.all(
      selected.map(async (item) => {
        if (item.source.isDataUri) {
          if (
            !/^data:(?:font\/[a-z0-9.+-]+|application\/(?:x-font-[a-z0-9.+-]+|font-[a-z0-9.+-]+|octet-stream))(?:;[a-z0-9-]+=[a-z0-9._-]+)*;base64,[A-Za-z0-9+/=\s]+$/i.test(
              item.source.url
            )
          ) {
            return null;
          }
          const commaPos = item.source.url.indexOf(',');
          const b64Len = commaPos >= 0 ? item.source.url.length - commaPos - 1 : item.source.url.length;
          const byteLength = Math.floor((b64Len * 3) / 4);
          if (byteLength === 0 || byteLength > maxSingleFontBytes) return null;
          return {
            item,
            dataUri: item.source.url.replace(/\s+/g, ''),
            format: item.source.format === 'unknown' ? '' : item.source.format,
            byteLength,
          };
        }
        if (controller.signal.aborted) return null;
        try {
          const resp = await fetchFn(item.source.url, {
            signal: controller.signal,
            credentials: 'omit',
          });
          if (!resp.ok) return null;
          const respCt = (resp.headers.get('content-type') ?? '').toLowerCase();
          if (
            respCt.includes('text/html') ||
            respCt.includes('application/json') ||
            respCt.includes('text/plain') ||
            respCt.includes('text/css')
          ) {
            return null;
          }
          const contentLen = Number.parseInt(resp.headers.get('content-length') ?? '0', 10);
          if (contentLen > maxSingleFontBytes) return null;

          const buf = await resp.arrayBuffer();
          if (buf.byteLength === 0 || buf.byteLength > maxSingleFontBytes) return null;

          const resolved = resolveMimeFromResponse(
            resp.headers.get('content-type'),
            item.source,
            buf
          );
          if (!resolved) return null;
          const b64 = arrayBufferToBase64(buf);
          return {
            item,
            dataUri: `data:${resolved.mime};base64,${b64}`,
            format: resolved.format,
            byteLength: buf.byteLength,
          };
        } catch {
          return null;
        }
      })
    );

    for (const entry of downloaded) {
      if (!entry) continue;
      if (totalBytes + entry.byteLength > maxTotalFontBytes) continue;
      totalBytes += entry.byteLength;

      const { face } = entry.item;
      const primaryRule = buildEmbeddedFontFaceCss(
        face.rawFamily,
        face.fontStyle,
        face.fontWeight,
        entry.dataUri,
        entry.format,
        face.unicodeRange
      );
      embeddedRules.push(primaryRule);
      embeddedFamiliesSet.add(face.cleanFamily);

      // If Next.js / Webpack hashed family name (e.g. "__Space_Grotesk_a1b2c3"),
      // ALWAYS emit a clean alias ("Space Grotesk") up to maxSingleFontBytes so clean font names always resolve!
      if (face.rawFamily.toLowerCase() !== face.cleanFamily.toLowerCase()) {
        embeddedRules.push(
          buildEmbeddedFontFaceCss(
            face.cleanFamily,
            face.fontStyle,
            face.fontWeight,
            entry.dataUri,
            entry.format,
            face.unicodeRange
          )
        );
      }
    }

    // Prepend embedded base64 rules ahead of any remaining non-embedded CSSOM rules
    const mergedRules = [...embeddedRules];
    for (const rule of existingFontFaceRules) {
      if (mergedRules.length >= 48) break;
      if (!mergedRules.includes(rule)) {
        mergedRules.push(rule);
      }
    }

    return {
      fontFaceRules: mergedRules,
      fontStylesheetUrls: Array.from(discoveredFontSheetUrls).slice(0, 6),
      embeddedCount: embeddedFamiliesSet.size,
      embeddedFamilies: Array.from(embeddedFamiliesSet),
    };
  } finally {
    clearTimeout(timer);
  }
}
