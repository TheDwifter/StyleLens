import { shouldSuppressHostFallbackFont } from '../core/captureClassification';
import { formatBlueprintForPrompt, generateFaithfulSnapshot } from '../core/faithfulSnapshot';
import {
  buildNegativeConstraints,
  buildSpatialVisualMap,
  generateCssTokens,
  generateDesignSpecJson,
  type RemixTargetStack,
} from '../core/specGenerator';
import type { CaptureRecord } from '../types/capture';
import type { DesignInfluenceItem } from './types';

export interface ParsedAiRemix {
  code: string;
  previewHtml: string;
  influencedBy: DesignInfluenceItem[];
}

export const AI_REMIX_SYSTEM_PROMPT = `You are StyleLens 1-to-1 X-Ray Remix Engine, a senior design-systems and frontend engineer.
Your job is to REPLICATE the exact format, 2D layout hierarchy, typography (font family, size, weight, casing, tracking), exact hex colors, spacing rhythm, borders, shadows, transforms, and inline SVGs from the user's selected web capture at >= 98% visual fidelity — changing ONLY the text/brand/content requested by the user.

STRICT RULES:
1. Follow the X-Ray Spatial Visual Layout Map and Verified 1-to-1 HTML + CSS Blueprint verbatim for structure, row order, proportions, colors, and typography. NEVER collapse multi-row layouts into a single pill/bar, and NEVER invent rounded pill frames, glossy gradients, borders, or "|" dividers that are absent in the blueprint.
2. Replace original brand names/copywriting with the user's requested content while preserving exact colors (including brand SVG accent colors), font sizes/weights, and visual hierarchy.
3. Return ONLY a single valid JSON object (no markdown commentary before or after) matching this exact schema:
{
  "previewHtml": "<style>/* scoped pure CSS preserving exact extracted tokens and layout */</style><div class=\\"sl-root\\">...</div>",
  "code": "/* Clean, production-ready component code in the user's requested stack */",
  "influencedBy": [
    { "token": "Short token name (e.g. #000000 flat canvas + #EB0010 brand SVG)", "usage": "Concise explanation of how it preserved exact 1-to-1 fidelity" }
  ]
}
4. In "previewHtml": use ONLY self-contained HTML + inline <style>. NEVER include <script>, external CDN links, or inline event handlers (onclick=...). Make it match the captured visual design >= 98%.`;

export function buildLlmUserPrompt(
  record: CaptureRecord,
  userGoal: string,
  targetStack: RemixTargetStack,
  secondaryRecord?: CaptureRecord | null
): string {
  const stackName: Record<RemixTargetStack, string> = {
    'react-tailwind': 'React + TypeScript + Tailwind CSS',
    'html-css': 'Semantic HTML5 + Modern CSS',
    'vue-tailwind': 'Vue 3 (<script setup lang="ts">) + Tailwind CSS',
  };

  const faithfulBlueprint =
    record.roots.length > 0
      ? formatBlueprintForPrompt(generateFaithfulSnapshot(record), 7000)
      : '<!-- Visual-only capture -->';
  const spatialMap = buildSpatialVisualMap(record);
  const negativeRules = buildNegativeConstraints(record, spatialMap.rowCount);

  const webfontNote =
    record.dna.fontStylesheetUrls && record.dna.fontStylesheetUrls.length > 0
      ? `\nWEBFONT STYLESHEET SOURCES:\n${record.dna.fontStylesheetUrls.join('\n')}`
      : '';

  const parts: string[] = [
    `USER GOAL: ${userGoal.trim() || 'Recreate this exact visual design language 1-to-1.'}`,
    `TARGET CODE STACK: ${stackName[targetStack]}`,
    ``,
    ...(spatialMap.lines.length > 0
      ? [`X-RAY SPATIAL VISUAL LAYOUT MAP (preserve exact row count, element positions, typography & colors):`, ...spatialMap.lines, ``]
      : []),
    ...(negativeRules.length > 0
      ? [`STRICT DO-NOT-INVENT ANTI-HALLUCINATION RULES:`, ...negativeRules, ``]
      : []),
    `PRIMARY DESIGN DNA (JSON):`,
    generateDesignSpecJson(record),
    ``,
    `PRIMARY CSS TOKENS:`,
    generateCssTokens(record),
    webfontNote,
    ``,
    `VERIFIED 1-TO-1 FAITHFUL HTML + SCOPED CSS BLUEPRINT (preserve exact font families, font sizes/weights, hex colors, padding, gaps, borders, radii, shadows, backdrop-filters, transforms, 2D positioning, and inline SVGs; change ONLY text/content needed for USER GOAL to achieve >= 98% identical fidelity):`,
    faithfulBlueprint,
  ];

  if (secondaryRecord) {
    parts.push(
      ``,
      `SECONDARY BLEND REFERENCE (blend palette/surface accents from ${secondaryRecord.page.hostname} where harmonious):`,
      generateCssTokens(secondaryRecord),
      `Secondary traits: ${secondaryRecord.dna.traits.map((t) => t.label).join(', ') || secondaryRecord.dna.polarity}`
    );
  }

  parts.push(
    ``,
    `Respond ONLY with the strict JSON object containing "previewHtml", "code", and "influencedBy" (3 to 5 items).`
  );

  return parts.join('\n');
}

function tryParseJsonCandidate(candidate: string): Partial<ParsedAiRemix> | null {
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    const code = typeof parsed.code === 'string' ? parsed.code.trim() : '';
    const previewHtml = typeof parsed.previewHtml === 'string' ? parsed.previewHtml.trim() : '';

    const influencedBy: DesignInfluenceItem[] = [];
    if (Array.isArray(parsed.influencedBy)) {
      for (const item of parsed.influencedBy) {
        if (
          item &&
          typeof item === 'object' &&
          typeof (item as Record<string, unknown>).token === 'string' &&
          typeof (item as Record<string, unknown>).usage === 'string'
        ) {
          influencedBy.push({
            token: ((item as Record<string, unknown>).token as string).trim(),
            usage: ((item as Record<string, unknown>).usage as string).trim(),
          });
        }
      }
    }

    if (!code && !previewHtml) return null;
    return { code, previewHtml, influencedBy };
  } catch {
    return null;
  }
}

/**
 * Extracts a balanced outermost JSON object from text that may include prose or markdown fences.
 */
function extractJsonObjectSubstring(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Parses model output robustly:
 * 1. Direct JSON parse
 * 2. Fenced ```json ... ``` block
 * 3. Balanced outermost `{ ... }` extraction
 * 4. Graceful markdown code-fence fallback (```html / ```tsx / ```vue / ```css)
 */
export function parseAiRemixResponse(rawText: string): ParsedAiRemix {
  const trimmed = rawText.trim();

  // 1. Direct JSON
  const direct = tryParseJsonCandidate(trimmed);
  if (direct) {
    return {
      code: direct.code || direct.previewHtml || trimmed,
      previewHtml: direct.previewHtml || (looksLikeHtml(direct.code) ? direct.code! : ''),
      influencedBy: direct.influencedBy ?? [],
    };
  }

  // 2. Fenced JSON block
  const jsonFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (jsonFence?.[1]) {
    const fromFence = tryParseJsonCandidate(jsonFence[1].trim());
    if (fromFence) {
      return {
        code: fromFence.code || fromFence.previewHtml || trimmed,
        previewHtml: fromFence.previewHtml || (looksLikeHtml(fromFence.code) ? fromFence.code! : ''),
        influencedBy: fromFence.influencedBy ?? [],
      };
    }
  }

  // 3. Balanced JSON object inside prose
  const balanced = extractJsonObjectSubstring(trimmed);
  if (balanced) {
    const fromBalanced = tryParseJsonCandidate(balanced);
    if (fromBalanced) {
      return {
        code: fromBalanced.code || fromBalanced.previewHtml || trimmed,
        previewHtml:
          fromBalanced.previewHtml || (looksLikeHtml(fromBalanced.code) ? fromBalanced.code! : ''),
        influencedBy: fromBalanced.influencedBy ?? [],
      };
    }
  }

  // 4. Fallback: extract fenced code blocks if a smaller model didn't follow JSON
  const fenceMatches = Array.from(trimmed.matchAll(/```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```/g));
  let extractedCode = '';
  let extractedHtml = '';

  for (const match of fenceMatches) {
    const lang = (match[1] ?? '').toLowerCase();
    const content = (match[2] ?? '').trim();
    if (!content) continue;
    if (lang === 'html' && !extractedHtml) {
      extractedHtml = content;
    } else if (!extractedCode) {
      extractedCode = content;
    }
  }

  if (!extractedCode && extractedHtml) extractedCode = extractedHtml;
  if (!extractedCode) extractedCode = trimmed;
  if (!extractedHtml && looksLikeHtml(extractedCode)) extractedHtml = extractedCode;

  return {
    code: extractedCode,
    previewHtml: extractedHtml,
    influencedBy: [],
  };
}

function looksLikeHtml(text: string | undefined): boolean {
  if (!text) return false;
  return /<(div|section|main|header|nav|article|style|button)\b/i.test(text) && !/\bexport\s+(default\s+)?function\b/.test(text);
}

/**
 * Defense-in-depth sanitizer for HTML rendered inside `<iframe sandbox="" srcDoc>`.
 * Note: The iframe already blocks all JS via empty `sandbox=""`, and this strips
 * executable tags/attributes before the markup even reaches the iframe.
 */
export function sanitizePreviewHtml(rawHtml: string): string {
  return rawHtml
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<(iframe|object|embed|applet|base)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(iframe|object|embed|applet|base)\b[^>]*\/?>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

export interface PreviewFontAssets {
  fontStylesheetUrls?: string[];
  fontFaceRules?: string[];
  primaryFonts?: string[];
  fontWeightsByFamily?: Record<string, number[]>;
}

/**
 * Single source of truth for assembling webfont assets for `<iframe sandbox="" srcDoc>`
 * and the strict Remix Fidelity Critic — combining selected typography, host-page fallback
 * typography (critical on artwork/<img> captures), embedded base64 `@font-face` rules, and
 * external font stylesheets.
 */
export function buildPreviewFontAssets(record: CaptureRecord): PreviewFontAssets {
  if (shouldSuppressHostFallbackFont(record)) {
    return {
      fontStylesheetUrls: [],
      fontFaceRules: [],
      primaryFonts: [],
      fontWeightsByFamily: {},
    };
  }
  const effectiveTypography =
    record.dna.typography.length > 0
      ? record.dna.typography
      : (record.dna.pageFallbackTypography ?? []);

  const primaryFonts: string[] = [];
  const seenFonts = new Set<string>();
  const fontWeightsByFamily: Record<string, number[]> = {};

  for (const t of effectiveTypography) {
    const raw = t.primaryFont.replace(/^["'\s]+|["'\s]+$/g, '').trim();
    const cleaned = raw
      .replace(/^__/, '')
      .replace(/_[a-f0-9]{5,}$/i, '')
      .replace(/_/g, ' ')
      .trim();
    const key = cleaned.toLowerCase();
    if (raw && !seenFonts.has(raw.toLowerCase())) {
      seenFonts.add(raw.toLowerCase());
      primaryFonts.push(raw);
    }
    if (key) {
      const set = new Set(fontWeightsByFamily[key] ?? []);
      set.add(t.fontWeight);
      fontWeightsByFamily[key] = Array.from(set).sort((a, b) => a - b);
    }
  }

  return {
    fontStylesheetUrls: record.dna.fontStylesheetUrls,
    fontFaceRules: record.dna.fontFaceRules,
    primaryFonts,
    fontWeightsByFamily,
  };
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

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const KNOWN_GOOGLE_FONTS = new Set([
  'inter',
  'inter tight',
  'roboto',
  'roboto condensed',
  'roboto slab',
  'roboto mono',
  'open sans',
  'lato',
  'montserrat',
  'poppins',
  'space grotesk',
  'space mono',
  'plus jakarta sans',
  'dm sans',
  'dm serif display',
  'dm serif text',
  'dm mono',
  'sora',
  'outfit',
  'urbanist',
  'geist',
  'geist mono',
  'ibm plex sans',
  'ibm plex serif',
  'ibm plex mono',
  'jetbrains mono',
  'fira sans',
  'fira code',
  'fira mono',
  'source sans 3',
  'source sans pro',
  'source serif 4',
  'source serif pro',
  'source code pro',
  'ubuntu',
  'ubuntu mono',
  'work sans',
  'manrope',
  'figtree',
  'syne',
  'syne mono',
  'playfair display',
  'playfair',
  'merriweather',
  'merriweather sans',
  'lora',
  'oswald',
  'raleway',
  'nunito',
  'nunito sans',
  'rubik',
  'rubik mono one',
  'mulish',
  'barlow',
  'barlow condensed',
  'barlow semi condensed',
  'archivo',
  'archivo black',
  'archivo narrow',
  'bricolage grotesque',
  'familjen grotesk',
  'darker grotesque',
  'schibsted grotesk',
  'hanken grotesk',
  'instrument serif',
  'instrument sans',
  'fraunces',
  'newsreader',
  'cormorant',
  'cormorant garamond',
  'eb garamond',
  'libre baskerville',
  'libre franklin',
  'libre caslon display',
  'libre caslon text',
  'bodoni moda',
  'cinzel',
  'cinzel decorative',
  'spectral',
  'crimson pro',
  'crimson text',
  'cardo',
  'vollkorn',
  'zilla slab',
  'domine',
  'bitter',
  'arvo',
  'rokkitt',
  'prata',
  'marcellus',
  'yeseva one',
  'ultra',
  'young serif',
  'italiana',
  'gilda display',
  'tenor sans',
  'forum',
  'aboreto',
  'belleza',
  'julius sans one',
  'poiret one',
  'pt sans',
  'pt sans narrow',
  'pt serif',
  'pt mono',
  'titillium web',
  'chakra petch',
  'kanit',
  'orbitron',
  'exo',
  'exo 2',
  'rajdhani',
  'teko',
  'saira',
  'saira condensed',
  'saira extra condensed',
  'big shoulders display',
  'yanone kaffeesatz',
  'fjalla one',
  'antonio',
  'six caps',
  'league gothic',
  'pathway gothic one',
  'abel',
  'encode sans',
  'encode sans condensed',
  'red hat display',
  'red hat text',
  'red hat mono',
  'lexend',
  'albert sans',
  'onest',
  'be vietnam pro',
  'public sans',
  'epilogue',
  'chivo',
  'josefin sans',
  'quicksand',
  'karla',
  'heebo',
  'mukta',
  'assistant',
  'cabin',
  'varela round',
  'dosis',
  'prompt',
  'overpass',
  'overpass mono',
  'signika',
  'catamaran',
  'asap',
  'maven pro',
  'questrial',
  'oxygen',
  'oxygen mono',
  'hind',
  'cairo',
  'changa',
  'khand',
  'unbounded',
  'oxanium',
  'michroma',
  'audiowide',
  'syncopate',
  'goldman',
  'zen dots',
  'bruno ace',
  'silkscreen',
  'vt323',
  'share tech mono',
  'inconsolata',
  'azeret mono',
  'courier prime',
  'anonymous pro',
  'bangers',
  'anton',
  'bebas neue',
  'righteous',
  'permanent marker',
  'press start 2p',
  'monoton',
  'lobster',
  'pacifico',
  'abril fatface',
  'alfa slab one',
  'bungee',
  'bungee shade',
  'bungee inline',
  'black ops one',
  'luckiest guy',
  'staatliches',
  'fredoka',
  'fredoka one',
  'passion one',
  'russo one',
  'fugaz one',
  'racing sans one',
  'titan one',
  'sigmar one',
  'bowlby one sc',
  'dela gothic one',
  'shrikhand',
  'chewy',
  'boogaloo',
  'rock salt',
  'special elite',
  'pirata one',
  'new rocker',
  'metal mania',
  'creepster',
  'caveat',
  'dancing script',
  'satisfy',
  'kalam',
  'noto sans',
  'noto serif',
  'noto sans sc',
  'noto sans jp',
  'noto sans kr',
  'tinos',
  'arimo',
  'cousine',
  'wix madefor display',
  'gabarito',
  'golos text',
  'geologica',
  'reddit sans',
  'reddit mono',
  'funnel display',
  'funnel sans',
  'afacad',
]);

const SINGLE_WEIGHT_DISPLAY_FONTS = new Set([
  'bangers',
  'anton',
  'bebas neue',
  'righteous',
  'permanent marker',
  'press start 2p',
  'monoton',
  'lobster',
  'pacifico',
  'abril fatface',
  'alfa slab one',
  'bungee',
  'bungee shade',
  'bungee inline',
  'black ops one',
  'luckiest guy',
  'staatliches',
  'fredoka one',
  'passion one',
  'russo one',
  'archivo black',
  'fjalla one',
  'six caps',
  'league gothic',
  'pathway gothic one',
  'abel',
  'ultra',
  'yeseva one',
  'prata',
  'marcellus',
  'young serif',
  'dm serif display',
  'dm serif text',
  'italiana',
  'gilda display',
  'tenor sans',
  'forum',
  'aboreto',
  'belleza',
  'julius sans one',
  'poiret one',
  'michroma',
  'audiowide',
  'zen dots',
  'bruno ace',
  'vt323',
  'share tech mono',
  'rubik mono one',
  'fugaz one',
  'racing sans one',
  'titan one',
  'sigmar one',
  'bowlby one sc',
  'dela gothic one',
  'shrikhand',
  'chewy',
  'boogaloo',
  'rock salt',
  'special elite',
  'pirata one',
  'new rocker',
  'metal mania',
  'creepster',
  'satisfy',
]);

/**
 * Parses ONLY the exact `font-family:` declaration from a `@font-face` rule
 * (NEVER scanning the base64 payload, which could randomly contain short font names like "exo" or "lato"!).
 */
export function extractFontFaceFamilyLower(rule: string): string {
  const m = rule.match(/font-family\s*:\s*([^;{}]+)/i);
  if (!m?.[1]) return '';
  return m[1].trim().replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Checks whether a webfont stylesheet URL (e.g. Google Fonts / Bunny Fonts) explicitly
 * requests the exact family name — preventing `"Inter"` from falsely matching `"Inter+Tight"`.
 */
export function stylesheetUrlMatchesFamily(url: string, familyLower: string): boolean {
  const target = familyLower.trim().toLowerCase();
  if (!target) return false;
  try {
    const parsed = new URL(url);
    const familyParams = parsed.searchParams.getAll('family');
    for (const param of familyParams) {
      // Handle CSS1 multi-family syntax `family=Inter:400|Roboto:700` AND CSS2 `family=Inter:wght@400;700`
      for (const piece of param.split('|')) {
        const nameOnly = (piece.split(':')[0] ?? '').replace(/\+/g, ' ').trim().toLowerCase();
        if (nameOnly === target) return true;
      }
    }
  } catch {
    // Fall back to exact URL segment boundary match
  }
  const escapedPlus = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\+');
  return new RegExp(`(?:[?&|]|%7c)family=${escapedPlus}(?:[:&|]|%3a|$)`, 'i').test(url);
}

function fontFacesCoverFamilyWeights(
  fontFaceRules: string[],
  familyLower: string,
  observedWeights: number[],
  rawLower?: string
): boolean {
  const matchingRules = fontFaceRules.filter((r) => {
    const declaredFamily = extractFontFaceFamilyLower(r);
    if (!declaredFamily) return false;
    const matchesName =
      declaredFamily === familyLower || (rawLower ? declaredFamily === rawLower : false);
    if (!matchesName) return false;
    // Only consider the family safely covered inside `<iframe sandbox="" srcDoc>` (Origin: null)
    // when the @font-face uses an embedded base64 data URI or a CORS-open font CDN!
    return (
      /url\(\s*["']?data:/i.test(r) ||
      /fonts\.gstatic\.com|fonts\.bunny\.net|use\.typekit\.net|cdn\.jsdelivr\.net/i.test(r)
    );
  });
  if (matchingRules.length === 0) return false;
  if (observedWeights.length === 0) return true;
  // Variable fonts (e.g. font-weight: 100 900 or 100 1000) cover all weights in range
  const hasRangeRule = matchingRules.some((r) => /font-weight\s*:\s*\d{3,4}\s+\d{3,4}/i.test(r));
  if (hasRangeRule) return true;
  return observedWeights.every((w) =>
    matchingRules.some((r) => new RegExp(`font-weight\\s*:\\s*${w}\\b`, 'i').test(r))
  );
}

function buildFontLinksHtml(fontAssets?: PreviewFontAssets): {
  linksHtml: string;
  fontFaceCss: string;
} {
  if (!fontAssets) return { linksHtml: '', fontFaceCss: '' };

  const safeSheetUrls = (fontAssets.fontStylesheetUrls ?? [])
    .filter((u) => /^https:\/\/[^\s"<>]+$/i.test(u))
    .slice(0, 6);

  const linkTags = safeSheetUrls.map(
    (url) => `<link rel="stylesheet" href="${escapeHtmlAttr(url)}" />`
  );

  const fontFaceList = (fontAssets.fontFaceRules ?? [])
    .filter((r) => !/<\/style/i.test(r))
    .slice(0, 48);

  // Add per-family Google Fonts fallback for captured non-system font names not already covered.
  // Separate <link> tags per family ensure one proprietary font never triggers a cascading HTTP 400.
  const extraFamilies: string[] = [];

  for (const rawFont of fontAssets.primaryFonts ?? []) {
    const clean = rawFont.replace(/["']/g, '').trim();
    const lower = clean.toLowerCase();
    if (!clean || clean.length > 48 || SYSTEM_FONTS.has(lower)) continue;
    // Strip Next.js / Webpack hashed internal font names like __Inter_a1b2c3
    const normalized = clean.replace(/^__/, '').replace(/_[a-f0-9]{5,}$/i, '').replace(/_/g, ' ').trim();
    const normLower = normalized.toLowerCase();
    if (!normalized || SYSTEM_FONTS.has(normLower)) continue;
    // Only emit Google Fonts fallback links for verified Google Fonts families
    // (never fire HTTP 400 requests for proprietary brand fonts like "HM Sans").
    if (!KNOWN_GOOGLE_FONTS.has(normLower)) continue;

    const observedWeights = fontAssets.fontWeightsByFamily?.[normLower] ?? [];
    if (
      safeSheetUrls.some((url) => stylesheetUrlMatchesFamily(url, normLower)) ||
      fontFacesCoverFamilyWeights(fontFaceList, normLower, observedWeights, lower)
    ) {
      continue;
    }
    if (!extraFamilies.includes(normalized) && extraFamilies.length < 4) {
      extraFamilies.push(normalized);
    }
  }

  for (const fam of extraFamilies) {
    const encoded = encodeURIComponent(fam).replace(/%20/g, '+');
    const famLower = fam.toLowerCase();
    const observedWeights = fontAssets.fontWeightsByFamily?.[famLower] ?? [];
    const nonRegularWeights = observedWeights.filter((w) => w >= 100 && w <= 900 && w !== 400);

    // Emit single clean link for known single-weight display fonts or regular-only weights (zero HTTP 400s)
    if (SINGLE_WEIGHT_DISPLAY_FONTS.has(famLower) || nonRegularWeights.length === 0) {
      linkTags.push(
        `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encoded}&display=swap" />`
      );
    } else {
      const weightSet = Array.from(new Set([400, ...observedWeights.filter((w) => w >= 100 && w <= 900)]))
        .sort((a, b) => a - b)
        .join(';');
      linkTags.push(
        `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encoded}&display=swap" />`
      );
      linkTags.push(
        `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encoded}:wght@${weightSet}&display=swap" />`
      );
    }
  }

  const fontFaceCss = fontFaceList.join('\n');

  return {
    linksHtml: linkTags.join('\n'),
    fontFaceCss,
  };
}

/**
 * Wraps sanitized preview HTML into a self-contained HTML document with extracted
 * CSS Custom Properties, real webfont links/@font-face rules, and matching polarity canvas.
 */
export function buildPreviewSrcDoc(
  rawPreviewHtml: string,
  cssTokens: string,
  polarity: 'dark' | 'light' | 'mixed',
  fontAssets?: PreviewFontAssets,
  stageMaxWidthPx = 680
): string {
  const safeBody = sanitizePreviewHtml(rawPreviewHtml);
  const canvasBg = polarity === 'light' ? '#f4f4f5' : '#09090b';
  const canvasText = polarity === 'light' ? '#18181b' : '#f4f4f5';
  const { linksHtml, fontFaceCss } = buildFontLinksHtml(fontAssets);
  const safeMaxWidth = Math.max(320, Math.min(1920, Math.round(stageMaxWidthPx)));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${linksHtml}
<style>
${fontFaceCss}
${cssTokens}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 8px;
  min-height: 100vh;
  background: ${canvasBg};
  color: ${canvasText};
  font-family: var(--sl-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
  -webkit-font-smoothing: antialiased;
  display: flex;
  flex-direction: column;
}
.sl-stage {
  width: 100%;
  max-width: ${safeMaxWidth}px;
  margin: auto;
}
</style>
</head>
<body>
<div class="sl-stage">${safeBody}</div>
</body>
</html>`;
}
