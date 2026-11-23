import type { CaptureRecord } from '../types/capture';
import {
  isArtworkOrPhotoLikeCapture,
  shouldSuppressHostFallbackFont,
} from './captureClassification';
import {
  buildThreeImageSteps,
  COMPOSITE_PROMPT_MAX_CHARS,
  type SeparationSourceMode,
} from './chatImagePrompts';
import { contrastRatio, parseCssColor } from './color';
import {
  generateCleanBackgroundImagePrompt,
  generateCompleteAgentPrompt,
  generateIsolatedTextImagePrompt,
} from './specGenerator';

/** Release bar: must reach >= 99.0 / 100 to pass. */
export const PROMPT_CONSISTENCY_THRESHOLD = 99;

const PURE_BLACK = { r: 0, g: 0, b: 0, a: 1 } as const;

export interface ConsistencyCategoryScore {
  score: number;
  max: number;
  detail: string;
}

export interface PromptConsistencyReport {
  totalScore: number;
  passedThreshold: boolean;
  verdict: string;
  issues: string[];
  breakdown: {
    hybridDelivery: ConsistencyCategoryScore;
    isolatedFontAccuracy: ConsistencyCategoryScore;
    visualBackgroundDelivery: ConsistencyCategoryScore;
    groundingAndSafety: ConsistencyCategoryScore;
    multilingualAndStructure: ConsistencyCategoryScore;
  };
}

export interface AiChatComplianceReport {
  score: number;
  passedThreshold: boolean;
  defects: string[];
}

/**
 * Strictly scores StyleLens's complete AI prompt suite (Hybrid 3-Layer Prompt +
 * Dedicated Exact-Font Isolated Text Image Prompt + Dedicated Clean Background Plate Prompt)
 * out of 100 points using structural, contrast-math, cross-prompt isolation, and contradiction
 * audits. Passing requires >= 99 / 100.
 */
export function evaluatePromptConsistencySuite(
  record: CaptureRecord,
  customWord?: string,
  language: 'en' | 'zh-CN' = 'en'
): PromptConsistencyReport {
  const fullPrompt = generateCompleteAgentPrompt(record, customWord, language);
  const textImagePrompt = generateIsolatedTextImagePrompt(record, customWord, language);
  const bgImagePrompt = generateCleanBackgroundImagePrompt(record, language);
  const trimmedWord = customWord?.trim() ?? '';
  const issues: string[] = [];

  // 1. Hybrid Delivery & Multi-Image Crash Immunity (20 pts)
  // NOTE: `WRITE TEXT FIRST` and `Swatch Card` are explicitly BANNED because they forced Gemini into
  // text-only mode with zero Layer 1 image (`Brock`) or mid-stream aborts (`McMaster`).
  let hybridScore = 0;
  const hasBrokenTextFirstTrap = /WRITE TEXT FIRST|Swatch Card/i.test(fullPrompt);
  if (
    !hasBrokenTextFirstTrap &&
    /MANDATORY HYBRID REPLY/i.test(fullPrompt) &&
    /NEVER IMAGE-ONLY,\s*NEVER TEXT-ONLY/i.test(fullPrompt)
  ) {
    hybridScore += 5;
  } else {
    issues.push(
      hasBrokenTextFirstTrap
        ? 'Hybrid prompt re-introduced broken WRITE TEXT FIRST or Swatch Card triggers.'
        : 'Hybrid prompt lacks explicit hybrid delivery contract.'
    );
  }

  if (
    /EXACTLY ONE \(1\) IMAGE GENERATION CALL TOTAL/i.test(fullPrompt) &&
    /AT MOST ONCE/i.test(fullPrompt)
  ) {
    hybridScore += 5;
  } else {
    issues.push('Hybrid prompt does not strictly cap raster generation to 1 image call.');
  }

  const hasMultiImageTrigger =
    /if multiple images are supported|plus isolated cutout image|plus clean background image/i.test(
      fullPrompt
    );
  const bansExtraCalls =
    /Do NOT call the image generator for Layer 2/i.test(fullPrompt) &&
    /Do NOT call the image generator for Layer 3/i.test(fullPrompt);
  if (!hasMultiImageTrigger && bansExtraCalls) {
    hybridScore += 6;
  } else {
    issues.push('Multi-image call triggers still present or Layer 2/3 image ban missing.');
  }

  const idx1 = fullPrompt.indexOf('### 01 // Full Composite');
  const idx2 = fullPrompt.indexOf('### 02 // Isolated Wordmark');
  const idx3 = fullPrompt.indexOf('### 03 // Clean Background Layer');
  const idx4 = fullPrompt.indexOf('### 04 // Quick 1-2-3 How To Use');
  const hasFallbackClause = /has no image generator/i.test(fullPrompt);
  if (idx1 !== -1 && idx1 < idx2 && idx2 < idx3 && idx3 < idx4 && hasFallbackClause) {
    hybridScore += 4;
  } else {
    issues.push('4-section ordering or text-only AI fallback clause incomplete.');
  }

  // 2. Isolated Text Exact-Font Accuracy & Mathematical Contrast Safety (25 pts)
  let fontScore = 0;
  if (
    /ANTI-ARIAL SVG FONT RULE/i.test(fullPrompt) &&
    /NEVER fall back to Arial/i.test(fullPrompt) &&
    /ZERO `<text>` tags/i.test(fullPrompt) &&
    /ZERO `<foreignObject>`/i.test(fullPrompt)
  ) {
    fontScore += 7;
  } else {
    issues.push('Layer 2 SVG does not strictly ban <text> / <foreignObject> Arial fallbacks.');
  }

  if (
    /bespoke vector `<path/i.test(fullPrompt) &&
    /transparent background/i.test(fullPrompt) &&
    /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/i.test(fullPrompt) &&
    /viewBox/i.test(fullPrompt)
  ) {
    fontScore += 6;
  } else {
    issues.push('Layer 2 SVG lacks explicit vector <path> / transparent viewBox contract.');
  }

  // Verify mathematical contrast ratio >= 4.5 between primary lettering fill and flat cutout backdrop!
  const pairMatch = textImagePrompt.match(
    /Primary Lettering Fill\*\*:\s*`(#[0-9A-Fa-f]{6})`\s*on\s*`(#[0-9A-Fa-f]{6})`/
  );
  if (pairMatch?.[1] && pairMatch[2]) {
    const fg = parseCssColor(pairMatch[1]);
    const bg = parseCssColor(pairMatch[2]);
    const ratio = fg && bg ? contrastRatio(fg, bg) : 0;
    if (ratio >= 4.5) {
      fontScore += 6;
    } else {
      issues.push(
        `Contrast inversion in isolated text prompt: ${pairMatch[1]} on ${pairMatch[2]} (${ratio.toFixed(2)}:1 < 4.5:1).`
      );
    }
  } else {
    issues.push('Isolated text image prompt missing verified fill-on-backdrop hex pair.');
  }

  const isArtworkCapture =
    Boolean(record.containsGraphicArtwork) || record.captureMode === 'visual-only';
  const dominantSampledHex = [...record.dna.palette]
    .filter((c) => c.provenance === 'sampled-pixels')
    .sort((a, b) => (b.visualSharePercent ?? 0) - (a.visualSharePercent ?? 0))[0]?.hex;
  const hostLeakedFonts = [
    record.dna.pageFallbackTypography?.[0]?.primaryFont,
    ...(record.containsGraphicArtwork && record.dna.typography.length <= 1
      ? [record.dna.typography[0]?.primaryFont]
      : []),
  ].filter((f): f is string => Boolean(f));
  const leakedHostFont = hostLeakedFonts.find(
    (font) =>
      isArtworkCapture &&
      record.dna.typography.length <= 1 &&
      (fullPrompt.includes(`\`${font}\``) ||
        textImagePrompt.includes(`\`${font}\``) ||
        fullPrompt.includes(`--sl-font-sans: "${font}"`))
  );
  const leakedHostFontOnArtwork = Boolean(leakedHostFont);

  if (
    /OUTPUT FORMAT \(RASTER IMAGE ONLY\)/i.test(textImagePrompt) &&
    /do \*\*NOT\*\* return SVG or HTML code blocks/i.test(textImagePrompt) &&
    /CRITICAL EXACT-FONT LOCK/i.test(textImagePrompt) &&
    /ZERO icons, ZERO logos, ZERO badges/i.test(textImagePrompt) &&
    !leakedHostFontOnArtwork
  ) {
    fontScore += 6;
  } else {
    issues.push(
      leakedHostFontOnArtwork
        ? `Host webpage font (${leakedHostFont}) leaked into photographic artwork prompt!`
        : 'Dedicated isolated text image prompt lacks raster-only lock or flat cutout isolation.'
    );
  }

  // 3. Guaranteed Visual Background Delivery (25 pts)
  let bgScore = 0;
  if (
    /LAYER 1 SCENE & BACKGROUND LOCK/i.test(fullPrompt) &&
    /EXACT original background/i.test(fullPrompt) &&
    /plain blank box/i.test(fullPrompt)
  ) {
    bgScore += 6;
  } else {
    issues.push('Layer 1 lacks scene/background preservation lock against blank box replacement.');
  }

  // Verify ZERO HTML contradiction AND recency reminder locking visual ```svg output
  const hasHtmlContradiction =
    /For code output \(HTML\/CSS\/React\/Vue\): build directly from/i.test(fullPrompt) ||
    /^```html\b/im.test(fullPrompt);
  const hasFinalReminder =
    /FINAL OUTPUT REMINDER/i.test(fullPrompt) &&
    /visual text-free ```svg``` \(NEVER ```html`\)/i.test(fullPrompt);
  if (
    /CRITICAL VISUAL BACKGROUND RULE/i.test(fullPrompt) &&
    /NEVER ```html/i.test(fullPrompt) &&
    !hasHtmlContradiction &&
    hasFinalReminder
  ) {
    bgScore += 8;
  } else {
    issues.push(
      'Section 03 visual SVG rule is missing or undermined by an HTML blueprint/code contradiction.'
    );
  }

  // Verify artwork captures use real dominant sampled-pixels backdrop (ignoring host dark-mode exact-dom container!),
  // ban blocky/cartoonish SVG polygon traces of photographs, and never emit false "flat solid matte fill" DOM rules!
  const expectedViewBox = `viewBox="0 0 ${record.rect.width} ${record.rect.height}"`;
  const sampledBackdropHex = dominantSampledHex ?? record.dna.palette[0]?.hex;
  const hostExactBgHex = record.dna.palette.find(
    (c) =>
      c.provenance === 'exact-dom' &&
      (c.role === 'background' || c.role === 'surface') &&
      c.hex.toUpperCase() !== sampledBackdropHex?.toUpperCase()
  )?.hex;
  const leakedHostBackdrop =
    isArtworkCapture &&
    Boolean(dominantSampledHex) &&
    Boolean(hostExactBgHex) &&
    (fullPrompt.includes(`backdrop ${hostExactBgHex}`) ||
      bgImagePrompt.includes(`base backdrop \`${hostExactBgHex}\``));
  const sampledBackdropRespected =
    !isArtworkCapture ||
    !sampledBackdropHex ||
    (!leakedHostBackdrop &&
      fullPrompt.includes(`backdrop ${sampledBackdropHex}`) &&
      bgImagePrompt.includes(`base backdrop \`${sampledBackdropHex}\``));
  const artworkGuardOk =
    !isArtworkCapture ||
    (/Clean BG \(AI\)/i.test(fullPrompt) &&
      /DO NOT draw a blocky or cartoonish SVG trace/i.test(fullPrompt) &&
      !/NO 3D gloss, bevels, or gradients/i.test(fullPrompt) &&
      !/flat solid matte fill/i.test(fullPrompt));

  if (
    fullPrompt.includes(expectedViewBox) &&
    /ZERO `<text>` tags, ZERO `<foreignObject>`, ZERO letter glyphs/i.test(fullPrompt) &&
    sampledBackdropRespected &&
    artworkGuardOk
  ) {
    bgScore += 5;
  } else {
    issues.push(
      'Layer 3 SVG missing exact viewBox, zero-text lock, artwork sampled backdrop, anti-blocky photo guard, or emitted false flat-matte rules on a photo.'
    );
  }

  const sampleTextToErase = record.dna.typography[0]?.sampleText?.trim();
  const eraseListOk = !sampleTextToErase || bgImagePrompt.includes(`\`${sampleTextToErase}\``);
  if (
    /OUTPUT FORMAT \(RASTER IMAGE ONLY\)/i.test(bgImagePrompt) &&
    /do \*\*NOT\*\* return SVG or HTML code blocks/i.test(bgImagePrompt) &&
    /EXACT 1-TO-1 SCENE & OBJECT PRESERVATION/i.test(bgImagePrompt) &&
    /COMPLETE, SEAMLESS TEXT REMOVAL/i.test(bgImagePrompt) &&
    bgImagePrompt.includes(`${record.rect.width}×${record.rect.height}px`) &&
    eraseListOk
  ) {
    bgScore += 6;
  } else {
    issues.push(
      'Dedicated clean background prompt missing raster-only directive, scene lock, or concrete erase-target text list.'
    );
  }

  // 4. Anti-Brand-Substitution, Cross-Prompt Isolation & X-Ray Grounding (15 pts)
  let groundingScore = 0;
  const wordLocked =
    (!trimmedWord ||
      (fullPrompt.includes(`\`${trimmedWord}\``) && textImagePrompt.includes(`\`${trimmedWord}\``))) &&
    /ANTI-BRAND-SUBSTITUTION/i.test(fullPrompt) &&
    /ANTI-BRAND-SUBSTITUTION/i.test(textImagePrompt);
  const bgIsolatedFromTargetWord =
    !trimmedWord ||
    !new RegExp(`render[^\\n]*${trimmedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(
      bgImagePrompt
    );
  if (wordLocked && bgIsolatedFromTargetWord) {
    groundingScore += 5;
  } else {
    issues.push('Target literal spelling lock, anti-brand-substitution, or BG prompt isolation failed.');
  }

  const bansMetadataInArt =
    /NEVER draw binary digits, box borders, CSS, or hex codes inside/i.test(fullPrompt) &&
    /NEVER DRAW METADATA/i.test(textImagePrompt) &&
    /never leave stray letters, gibberish text, hex codes, CSS, or binary borders/i.test(
      bgImagePrompt
    );
  if (bansMetadataInArt) {
    groundingScore += 5;
  } else {
    issues.push('Missing strict ban on rendering hex/CSS/binary metadata inside generated images.');
  }

  const primaryHex = isArtworkCapture
    ? (dominantSampledHex ?? record.dna.palette[0]?.hex)
    : record.dna.palette[0]?.hex;
  const hasGrounding =
    fullPrompt.includes('## X-Ray Spatial Visual Layout Map') &&
    fullPrompt.includes('## STRICT DO-NOT-INVENT RULES') &&
    (!primaryHex || (fullPrompt.includes(primaryHex) && bgImagePrompt.includes(primaryHex)));
  if (hasGrounding) {
    groundingScore += 5;
  } else {
    issues.push('X-Ray spatial layout, negative rules, or measured hex palette missing.');
  }

  // 5. Multilingual (`en` / `zh-CN`) & Structure Integrity (15 pts)
  let structureScore = 0;
  if (
    fullPrompt.includes('STYLELENS PACKAGE // 01001010') &&
    fullPrompt.includes('READY FOR EXPORT')
  ) {
    structureScore += 5;
  } else {
    issues.push('Packaged StyleLens header missing from hybrid prompt.');
  }

  if (language === 'zh-CN') {
    const zhOk =
      fullPrompt.includes('Simplified Chinese (简体中文)') &&
      textImagePrompt.includes('简体中文') &&
      bgImagePrompt.includes('简体中文') &&
      !fullPrompt.includes('my requested word(s)') &&
      !textImagePrompt.includes('my requested word(s)');
    if (zhOk) {
      structureScore += 5;
    } else {
      issues.push('Simplified Chinese directive incomplete or leaked English target placeholder.');
    }
  } else {
    const enOk =
      !fullPrompt.includes('Simplified Chinese (简体中文)') &&
      !textImagePrompt.includes('简体中文') &&
      !bgImagePrompt.includes('简体中文');
    if (enOk) {
      structureScore += 5;
    } else {
      issues.push('Unexpected Chinese directive present in English prompt mode.');
    }
  }

  const noDualFormatContradiction =
    !fullPrompt.includes('inline ```html ... ``` (or ```svg') &&
    !fullPrompt.includes('(```svg and ```html) ONLY') &&
    fullPrompt.includes('Exact Text (AI)') &&
    fullPrompt.includes('Clean BG (AI)');
  if (noDualFormatContradiction) {
    structureScore += 5;
  } else {
    issues.push('Conflicting dual-format instructions or missing raster extractor guidance in Section 04.');
  }

  const totalScore = hybridScore + fontScore + bgScore + groundingScore + structureScore;
  const passedThreshold = totalScore >= PROMPT_CONSISTENCY_THRESHOLD;

  return {
    totalScore,
    passedThreshold,
    verdict: passedThreshold
      ? `${totalScore}% PASS (>= ${PROMPT_CONSISTENCY_THRESHOLD}% Prompt Consistency Bar)`
      : `${totalScore}% FAIL (< ${PROMPT_CONSISTENCY_THRESHOLD}% — ${issues[0] ?? 'Fix required'})`,
    issues,
    breakdown: {
      hybridDelivery: { score: hybridScore, max: 20, detail: '1-image cap + hybrid 4-section template' },
      isolatedFontAccuracy: { score: fontScore, max: 25, detail: 'Anti-Arial <path> SVG + contrast-verified raster font prompt' },
      visualBackgroundDelivery: { score: bgScore, max: 25, detail: 'Zero-HTML-contradiction visual SVG + sampled backdrop + clean BG prompt' },
      groundingAndSafety: { score: groundingScore, max: 15, detail: 'Anti-brand-substitution + prompt isolation + zero metadata in images' },
      multilingualAndStructure: { score: structureScore, max: 15, detail: 'Packaged frame + clean EN/zh-CN parity + zero contradictions' },
    },
  };
}

function validateSvgBlockStructure(svgCode: string, label: string): string[] {
  const errs: string[] = [];
  if (!/<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/i.test(svgCode)) {
    errs.push(`HIGH: ${label} SVG missing xmlns="http://www.w3.org/2000/svg".`);
  }
  if (!/\bviewBox="[^"]+"/i.test(svgCode)) {
    errs.push(`HIGH: ${label} SVG missing explicit viewBox attribute.`);
  }
  if (!/<\/svg>/i.test(svgCode)) {
    errs.push(`CRITICAL: ${label} SVG is truncated / missing closing </svg>.`);
  }
  if (/<foreignObject[\s>]/i.test(svgCode)) {
    errs.push(`CRITICAL: ${label} SVG smuggles HTML/system fonts via <foreignObject>.`);
  }
  if (/<text[\s>]|<tspan[\s>]/i.test(svgCode)) {
    errs.push(`CRITICAL: ${label} SVG contains forbidden <text>/<tspan> element.`);
  }
  return errs;
}

/**
 * Runtime compliance grader that evaluates an actual AI chat response markdown payload
 * against EVERY real-world failure mode (multi-image crashes, Arial <text> / <foreignObject>
 * smuggling, invisible fill="none" paths, single-triangle cheats, raw ```html backgrounds,
 * malformed/unclosed SVGs, section reordering, and header-only word echoes).
 */
export function scoreAiChatOutputCompliance(
  aiResponseMarkdown: string,
  expectedTargetWord: string,
  hasRenderedLayer1Image = true,
  isPhotographicOrArtwork = false
): AiChatComplianceReport {
  let score = 100;
  const defects: string[] = [];

  // 1. Detect raw multi-image UI crash tokens (e.g. object:image{}name=image_generation_content/...)
  if (/object:image\{\}|image_generation_content\/\d+/i.test(aiResponseMarkdown)) {
    score -= 40;
    defects.push('CRITICAL: Multi-image UI crash detected (raw object:image{} token leaked).');
  }

  // 2. Verify Layer 1 rendered image exists
  if (!hasRenderedLayer1Image) {
    score -= 30;
    defects.push('CRITICAL: Layer 1 Full Composite image missing.');
  }

  // 3. Verify all 4 sections exist AND appear in strict 01 < 02 < 03 < 04 order
  const sec1Idx = aiResponseMarkdown.search(/01\s*\/\/\s*Full Composite/i);
  const sec2Idx = aiResponseMarkdown.search(/02\s*\/\/\s*Isolated Wordmark/i);
  const sec3Idx = aiResponseMarkdown.search(/03\s*\/\/\s*Clean Background/i);
  const sec4Idx = aiResponseMarkdown.search(/04\s*\/\/\s*Quick/i);

  if (sec1Idx === -1 || sec2Idx === -1 || sec3Idx === -1 || sec4Idx === -1) {
    score -= 35;
    defects.push('CRITICAL: Missing one or more mandatory 01–04 sections (image-only or partial reply).');
  } else if (!(sec1Idx < sec2Idx && sec2Idx < sec3Idx && sec3Idx < sec4Idx)) {
    score -= 20;
    defects.push('HIGH: Sections 01–04 are out of required top-to-bottom order.');
  }

  // 4. Validate Section 02 independently even if Section 03 is omitted or reordered
  if (sec2Idx !== -1) {
    const nextAfterSec2 = [sec3Idx, sec4Idx]
      .filter((i) => i > sec2Idx)
      .sort((a, b) => a - b)[0];
    const sec2Body = aiResponseMarkdown.slice(sec2Idx, nextAfterSec2);

    if (/```html\b/i.test(sec2Body)) {
      score -= 25;
      defects.push('CRITICAL: Section 02 leaked raw ```html instead of vector ```svg.');
    }

    const svgMatch = sec2Body.match(/```svg\s*([\s\S]*?)```/i);
    if (!svgMatch?.[1]) {
      score -= 25;
      defects.push('HIGH: Section 02 missing rendered ```svg code block.');
    } else {
      const svgCode = svgMatch[1];
      const structErrs = validateSvgBlockStructure(svgCode, 'Section 02');
      for (const err of structErrs) {
        score -= err.startsWith('CRITICAL') ? 30 : 12;
        defects.push(err);
      }

      const pathMatches = Array.from(svgCode.matchAll(/<path\b([^>]*)\/?>/gi));
      const nonEmptyPaths = pathMatches.filter((m) => {
        const attrs = m[1] ?? '';
        const dMatch = attrs.match(/\bd="([^"]+)"/i);
        return Boolean(dMatch?.[1]?.trim());
      });
      if (nonEmptyPaths.length === 0) {
        score -= 25;
        defects.push('HIGH: Section 02 SVG contains no non-empty vector <path d="..."> letterforms.');
      } else {
        // Check visible fill/stroke (reject fill="none" with no stroke!)
        const hasVisiblePaint = nonEmptyPaths.some((m) => {
          const attrs = m[1] ?? '';
          const fillMatch = attrs.match(/\bfill="([^"]+)"/i);
          const strokeMatch = attrs.match(/\bstroke="([^"]+)"/i);
          const hasFill =
            fillMatch ? fillMatch[1]!.toLowerCase() !== 'none' : !/fill\s*=\s*"none"/i.test(svgCode);
          const hasStroke = Boolean(strokeMatch && strokeMatch[1]!.toLowerCase() !== 'none');
          return hasFill || hasStroke;
        });
        if (!hasVisiblePaint) {
          score -= 20;
          defects.push('CRITICAL: Section 02 SVG paths are invisible (fill="none" with no stroke).');
        }

        // Prevent trivial 1-shape cheat for multi-character target words (>= 4 chars)
        // Handles both spaced ("Z M10 10") and compact SVG syntax ("ZM10 10", "0m20 0", "M.5 .5")
        const charCount = expectedTargetWord.replace(/\s+/g, '').length;
        const allD = nonEmptyPaths.map((m) => m[1]?.match(/\bd="([^"]+)"/i)?.[1] ?? '').join(' ');
        const moveCommands = (allD.match(/(?:^|[\s,0-9Zz])M\s*-?(?:\d|\.\d)/gi) ?? []).length;
        if (charCount >= 4 && nonEmptyPaths.length < 2 && moveCommands < Math.min(3, charCount)) {
          score -= 15;
          defects.push(
            `HIGH: Section 02 SVG has insufficient vector letterform geometry (${nonEmptyPaths.length} path, ${moveCommands} subpaths) for "${expectedTargetWord}".`
          );
        }

        // Check dark-on-dark preview legibility guidance across ALL child shape/group fills
        // (ignores root `<svg fill="none">` so `<svg fill="none"><path fill="#111"/></svg>` is NEVER skipped!)
        const svgOpenTagMatch = svgCode.match(/<svg\b([^>]*)>/i);
        const rootFillVal = svgOpenTagMatch?.[1]?.match(/\bfill="([^"]+)"/i)?.[1]?.trim();
        const childPaintTags = Array.from(
          svgCode.matchAll(/<(?:path|rect|circle|polygon|ellipse|polyline|g)\b([^>]*)\/?>/gi)
        );
        const explicitChildFills: string[] = [];
        let hasGradientOrUrlFill = false;
        let hasImplicitBlackShape = false;
        for (const tag of childPaintTags) {
          const attrs = tag[1] ?? '';
          const fMatch = attrs.match(/\bfill="([^"]+)"/i);
          const fVal = fMatch?.[1]?.trim();
          if (fVal) {
            if (/^url\(/i.test(fVal)) {
              hasGradientOrUrlFill = true;
            } else if (!/^(?:none|transparent)$/i.test(fVal)) {
              explicitChildFills.push(fVal);
            }
          } else if (!/^<g\b/i.test(tag[0])) {
            const sMatch = attrs.match(/\bstroke="([^"]+)"/i);
            const hasStrokeOnly =
              Boolean(sMatch && !/^(?:none|transparent)$/i.test(sMatch[1]!)) &&
              rootFillVal?.toLowerCase() === 'none';
            if (!hasStrokeOnly) {
              hasImplicitBlackShape = true;
            }
          }
        }

        const effectiveFills: Array<{
          label: string;
          rgb: { r: number; g: number; b: number; a: number };
        }> = [];
        for (const rawFill of explicitChildFills) {
          const parsed = parseCssColor(rawFill);
          if (parsed) effectiveFills.push({ label: rawFill, rgb: parsed });
        }
        if (effectiveFills.length === 0 && !hasGradientOrUrlFill) {
          if (
            rootFillVal &&
            !/^(?:none|transparent)$/i.test(rootFillVal) &&
            !/^url\(/i.test(rootFillVal)
          ) {
            const parsedRoot = parseCssColor(rootFillVal);
            if (parsedRoot) effectiveFills.push({ label: rootFillVal, rgb: parsedRoot });
          } else if (hasImplicitBlackShape && rootFillVal?.toLowerCase() !== 'none') {
            effectiveFills.push({ label: '#000000 (default)', rgb: PURE_BLACK });
          }
        }

        const darkFillSample = effectiveFills.find(
          (entry) => contrastRatio(entry.rgb, PURE_BLACK) < 4.5
        );
        if (darkFillSample) {
          const hasCutoutHint =
            /Exact Text \(AI\)|high-contrast.*(?:cutout|raster|canvas)|light[- ]mode|dark[- ]mode.*(?:dim|preview|visibility)/i.test(
              aiResponseMarkdown
            );
          if (!hasCutoutHint) {
            score -= 5;
            defects.push(
              `MEDIUM: Dark fill ${darkFillSample.label} on transparent SVG lacks dark-mode visibility / Exact Text (AI) guidance.`
            );
          }
        }
      }
    }
  }

  // 5. Validate Section 03 clean visual SVG background
  if (sec3Idx !== -1) {
    const nextAfterSec3 = sec4Idx > sec3Idx ? sec4Idx : undefined;
    const sec3Body = aiResponseMarkdown.slice(sec3Idx, nextAfterSec3);
    const hasRawHtml = /```html\b/i.test(sec3Body);
    const bgSvgMatch = sec3Body.match(/```svg\s*([\s\S]*?)```/i);
    if (hasRawHtml || !bgSvgMatch?.[1]) {
      score -= 25;
      defects.push('CRITICAL: Section 03 returned raw ```html code or omitted visual ```svg background.');
    } else {
      const bgSvg = bgSvgMatch[1];
      const structErrs = validateSvgBlockStructure(bgSvg, 'Section 03');
      for (const err of structErrs) {
        score -= err.startsWith('CRITICAL') ? 20 : 10;
        defects.push(err);
      }
      if (!/<(?:rect|path|circle|ellipse|polygon|polyline|line)\b/i.test(bgSvg)) {
        score -= 20;
        defects.push('CRITICAL: Section 03 background SVG is empty (no visible shapes).');
      }
      if (isPhotographicOrArtwork) {
        const polygonCount = (bgSvg.match(/<(?:polygon|polyline)\b/gi) ?? []).length;
        const bgPaths = Array.from(bgSvg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*\/?>/gi));
        const jaggedTracePaths = bgPaths.filter((m) => {
          const d = m[1] ?? '';
          const angledLines = (d.match(/(?:^|[\s,0-9Zz])[Ll]\s*-?(?:\d|\.\d)/g) ?? []).length;
          const totalLineCmds = (d.match(/(?:^|[\s,0-9Zz])[LlHhVv]\s*-?(?:\d|\.\d)/g) ?? []).length;
          return angledLines >= 3 || totalLineCmds >= 5;
        }).length;
        if (polygonCount + jaggedTracePaths >= 2) {
          score -= 20;
          defects.push(
            'CRITICAL: Section 03 attempted a blocky polygonal SVG trace of a 3D photograph instead of a clean minimal vector backdrop frame.'
          );
        }
      }
    }
  }

  if (isPhotographicOrArtwork) {
    const sec4Body = sec4Idx !== -1 ? aiResponseMarkdown.slice(sec4Idx) : aiResponseMarkdown;
    if (!/Clean BG \(AI\)/i.test(sec4Body)) {
      score -= 10;
      defects.push(
        'HIGH: Photographic capture reply omitted Clean BG (AI) guidance in Section 04 for photorealistic background extraction.'
      );
    }
  }

  if (!aiResponseMarkdown.includes('STYLELENS PACKAGE')) {
    score -= 5;
    defects.push('MEDIUM: Missing STYLELENS PACKAGE packaged header.');
  }

  // Verify target word appears OUTSIDE the echoed ASCII package header!
  if (expectedTargetWord.trim()) {
    const bodyWithoutHeader = aiResponseMarkdown.replace(
      /```text[\s\S]*?STYLELENS PACKAGE[\s\S]*?```/i,
      ''
    );
    if (!bodyWithoutHeader.toLowerCase().includes(expectedTargetWord.trim().toLowerCase())) {
      score -= 10;
      defects.push(
        `HIGH: Target word "${expectedTargetWord}" missing outside echoed package header.`
      );
    }
  }

  const finalScore = Math.max(0, score);
  return {
    score: finalScore,
    passedThreshold: finalScore >= PROMPT_CONSISTENCY_THRESHOLD,
    defects,
  };
}

export interface ChatThreeImageSuiteReport {
  score: number;
  passedThreshold: boolean;
  issues: string[];
}

/**
 * Strictly scores the primary 3-Image Chained Master-Image Separation suite (`buildThreeImageSteps`)
 * out of 100 points (>= 99 PASS): enforces image-first starts, concise length, zero trademark/IP
 * safety bait, zero pink-elephant / fake-checkerboard words (transparent/checkerboard/PNG/cutout/
 * Arial/SVG/HTML/code/hex/gibberish), chained Master-Image separation locks (`master-attached` /
 * `master-thread` / `original-attached`), 3-tier outer-edge & combined-outline solid backdrop rules,
 * zero host font leaks, and strict EN/zh-CN parity.
 */
export function evaluateChatThreeImageSuite(
  record: CaptureRecord,
  customWord: string,
  language: 'en' | 'zh-CN' = 'en',
  sourceMode: SeparationSourceMode = 'master-attached'
): ChatThreeImageSuiteReport {
  const steps = buildThreeImageSteps(record, customWord, language, { sourceMode });
  const issues: string[] = [];
  let score = 100;

  if (steps.map((s) => s.id).join(',') !== 'composite,text-only,background-only') {
    score -= 25;
    issues.push('Three-image steps must be ordered exactly: composite, text-only, background-only.');
  }

  const trimmed = customWord.trim();
  const isArtwork = isArtworkOrPhotoLikeCapture(record);
  const suppressHost = shouldSuppressHostFallbackFont(record);
  const allCombined = steps.map((s) => s.prompt).join('\n');
  const step1 = steps[0]?.prompt ?? '';
  const step2 = steps[1]?.prompt ?? '';
  const step3 = steps[2]?.prompt ?? '';

  // 1. Image-first start & concise budget (15 pts)
  for (const step of steps) {
    const startsImageFirst =
      language === 'zh-CN'
        ? /^请(?:基于|直接|参考)/.test(step.prompt)
        : /^(?:Create 1|Edit\b)/i.test(step.prompt);
    if (!startsImageFirst) {
      score -= 8;
      issues.push(`Step ${step.id} does not start immediately with a direct image-creation/editing instruction.`);
    }
    // The picture prompt carries the detailed lettering instructions; follow-up prompts stay short
    const limit = step.id === 'composite' ? COMPOSITE_PROMPT_MAX_CHARS : 980;
    if (step.prompt.length > limit) {
      score -= 5;
      issues.push(`Step ${step.id} prompt exceeds ${limit} chars (${step.prompt.length}) — risk of text-mode routing.`);
    }
  }

  const hasFriendlyStyleLensNote =
    language === 'zh-CN'
      ? /StyleLens/.test(step1) && /扩展窗口/.test(step1) && /感谢/.test(step1)
      : /StyleLens/i.test(step1) && /extension window/i.test(step1) && /thank-you/i.test(step1);
  if (!hasFriendlyStyleLensNote) {
    score -= 5;
    issues.push('Step 1 prompt is missing the friendly StyleLens extension window thank-you note.');
  }

  // 2. X-Ray Style DNA Telemetry & Anti-Host-Container-Hex Shield (15 pts)
  const xrayLineRe =
    language === 'zh-CN'
      ? /^X-Ray 设计基因（[^）]*）：[^\n]+$/gm
      : /^X-Ray Style DNA \([^)]*\):[^\n]+$/gm;
  const xrayLine1 = step1.match(xrayLineRe)?.[0] ?? '';
  if (!xrayLine1) {
    score -= 15;
    issues.push('Step 1 (composite) is missing the mandatory X-Ray Style DNA telemetry line.');
  } else {
    const expectedDims = `${Math.max(1, Math.round(record.rect.width))}×${Math.max(1, Math.round(record.rect.height))}px`;
    const hasPolarity =
      language === 'zh-CN'
        ? /深色基调|浅色基调|混合明暗/.test(xrayLine1)
        : /dark polarity|light polarity|mixed polarity/i.test(xrayLine1);
    if (!xrayLine1.includes(expectedDims) || !hasPolarity) {
      score -= 8;
      issues.push('X-Ray Style DNA line is missing exact capture dimensions or luminance polarity.');
    }
    const expectsPaletteHex =
      record.dna.palette.some((c) => c.provenance === 'sampled-pixels') ||
      (!isArtwork && !suppressHost && record.dna.palette.length > 0);
    if (expectsPaletteHex && !/#[0-9A-Fa-f]{6}/.test(xrayLine1)) {
      score -= 8;
      issues.push('X-Ray Style DNA line is missing extracted palette color anchors.');
    }
  }

  if (sourceMode === 'original-attached') {
    const xrayLine2 = step2.match(xrayLineRe)?.[0] ?? '';
    if (!xrayLine2) {
      score -= 8;
      issues.push('Standalone Step 2 (original-attached) is missing the X-Ray Style DNA telemetry line.');
    } else if (/radius |圆角 |soft shadow|立体阴影/i.test(xrayLine2)) {
      score -= 8;
      issues.push('Step 2 X-Ray DNA leaked container card radius/shadow onto isolated lettering.');
    }
  }

  // Host wrapper container hex leak check (e.g. Google Images dark-mode #22242A wrapper)
  if ((isArtwork || suppressHost) && record.dna.palette.some((c) => c.provenance === 'sampled-pixels')) {
    const sampledHexes = new Set(
      record.dna.palette
        .filter((c) => c.provenance === 'sampled-pixels')
        .map((c) => c.hex.toUpperCase())
    );
    for (const domTok of record.dna.palette.filter((c) => c.provenance === 'exact-dom')) {
      const upper = domTok.hex.toUpperCase();
      if (!sampledHexes.has(upper) && allCombined.toUpperCase().includes(upper)) {
        score -= 15;
        issues.push(`Artwork prompt leaked un-sampled host DOM container color ${upper}.`);
      }
    }
  }

  // 3. Zero trademark/safety bait & zero pink-elephant / unscoped hex codes (20 pts)
  const trademarkBaitRe =
    /\btrademark\b|brand\/school|school logo|\bmascot\b|bitten Apple|green Dollar Tree logo|real-world "[^"]+" brand|真实品牌或学校标志/i;
  if (trademarkBaitRe.test(allCombined)) {
    score -= 15;
    issues.push('Prompt contains trademark/IP moderation bait that can trigger Grok/Gemini image refusals.');
  }

  const pinkWordsRe =
    /\btransparent\b|透明|\bcheckerboard\b|棋盘格|\bPNG\b|\bcutout\b|\bArial\b|\bSVG\b|\bHTML\b|\bno code\b|代码|\bgibberish\b|乱码|1-click cutout|一键抠图|WRITE TEXT FIRST|Swatch Card/i;
  if (pinkWordsRe.test(allCombined)) {
    score -= 15;
    issues.push(
      'Prompt contains pink-elephant or fake-checkerboard tokens (transparent/checkerboard/PNG/cutout/Arial/SVG/code).'
    );
  }

  const step1BodyNoXray = step1.replace(xrayLineRe, '');
  const step2BodyNoXray =
    sourceMode === 'original-attached' ? step2.replace(xrayLineRe, '') : step2;
  if (
    /#[0-9A-Fa-f]{6}/.test(step1BodyNoXray) ||
    /#[0-9A-Fa-f]{6}/.test(step2BodyNoXray) ||
    /#[0-9A-Fa-f]{6}/.test(step3)
  ) {
    score -= 15;
    issues.push(
      'Prompt leaked raw hex codes outside the X-Ray Style DNA line (Step 2 backdrop rule & Step 3 must remain hex-free).'
    );
  }

  // 3. Literal word lock & Chained Master-Image Separation contract (25 pts)
  if (trimmed) {
    if (!step1.includes(trimmed) || !step2.includes(trimmed)) {
      score -= 12;
      issues.push(`Target word "${trimmed}" missing from Step 1 or Step 2 prompt.`);
    }
    if (sourceMode === 'original-attached') {
      if (step3.includes(trimmed)) {
        score -= 10;
        issues.push(`Standalone Step 3 (original-attached background-only) leaked target word "${trimmed}".`);
      }
    } else {
      // In master-attached / master-thread separation, Step 3 MUST name `trimmed` as the text to REMOVE,
      // with zero positive rendering instructions!
      const namesTargetForRemoval =
        language === 'zh-CN'
          ? step3.includes(`文字「${trimmed}」`)
          : step3.includes(`remove the text "${trimmed}"`);
      if (!namesTargetForRemoval) {
        score -= 10;
        issues.push(`Master-image Step 3 must explicitly name "${trimmed}" as the existing text to remove.`);
      }
      if (/\b(?:render|spell it literally)\b|逐字拼写/i.test(step3)) {
        score -= 10;
        issues.push('Step 3 (background-only) contains positive text-rendering instructions.');
      }
    }
  } else if (allCombined.includes('""') || allCombined.includes('「」')) {
    score -= 10;
    issues.push('Empty customWord produced empty quotes in prompt.');
  }

  if (sourceMode === 'master-attached' || sourceMode === 'master-thread') {
    const step2LocksNoRedesign =
      language === 'zh-CN'
        ? /分离并提取/.test(step2) && /不要重新设计/.test(step2)
        : /(?:isolate|extract)/i.test(step2) && /without redesigning/i.test(step2);
    if (!step2LocksNoRedesign) {
      score -= 10;
      issues.push('Step 2 master separation prompt must explicitly forbid redesigning/restyling the existing letters.');
    }
    const step3LocksNoRegen =
      language === 'zh-CN'
        ? /不要重新生成/.test(step3) && /原封不动/.test(step3)
        : /do not regenerate/i.test(step3) && /100% of (?:this exact|that composite) image identical/i.test(step3);
    if (!step3LocksNoRegen) {
      score -= 10;
      issues.push('Step 3 master separation prompt must explicitly lock against regenerating or altering the scene.');
    }
  }

  // 4. Source-mode reference integrity (10 pts)
  if (sourceMode === 'master-attached') {
    const step2Attached = language === 'zh-CN' ? step2.includes('我附上的') : /attached image/i.test(step2);
    const step3Attached = language === 'zh-CN' ? step3.includes('我附上的') : /attached image/i.test(step3);
    if (!step2Attached || !step3Attached) {
      score -= 10;
      issues.push('master-attached Steps 2 & 3 must directly reference the attached Master Image.');
    }
  } else if (sourceMode === 'master-thread') {
    const step2RefsPrev =
      language === 'zh-CN' ? /上一条回复|上方最新生成/.test(step2) : /previous reply|generated above/i.test(step2);
    const step3RefsFirst =
      language === 'zh-CN' ? /第一轮回复|上方最新生成/.test(step3) : /first reply|generated above/i.test(step3);
    const leaksAttached =
      language === 'zh-CN'
        ? step2.includes('我附上的') || step3.includes('我附上的')
        : /attached (?:image|picture)/i.test(`${step2}\n${step3}`);
    if (!step2RefsPrev || !step3RefsFirst || leaksAttached) {
      score -= 10;
      issues.push('master-thread Steps 2 & 3 must reference the thread composite (Step 3 -> first reply, never attached image).');
    }
  }

  // 5. Safe Step 2 alpha-matting solid backdrop rule (10 pts)
  const hasExactDomText =
    sourceMode === 'original-attached' &&
    !isArtwork &&
    !suppressHost &&
    record.dna.palette.some((c) => c.provenance === 'exact-dom' && c.role === 'text');
  if (hasExactDomText) {
    const matches =
      language === 'zh-CN'
        ? [
            step2.includes('纯白纯色背景'),
            step2.includes('纯黑纯色背景'),
            step2.includes('均匀的中性灰纯色背景'),
          ].filter(Boolean).length
        : [
            step2.includes('solid pure white background'),
            step2.includes('solid pure black background'),
            step2.includes('solid medium neutral gray background'),
          ].filter(Boolean).length;
    if (matches !== 1) {
      score -= 15;
      issues.push('Standalone live DOM capture with exact CSS text color must emit ONE concrete solid backdrop in Step 2.');
    }
  } else {
    const has3TierRule =
      language === 'zh-CN'
        ? step2.includes('纯白纯色背景') &&
          step2.includes('纯黑纯色背景') &&
          step2.includes('中性灰纯色背景')
        : step2.includes('solid pure white background') &&
          step2.includes('solid pure black background') &&
          step2.includes('solid medium neutral gray background');
    if (!has3TierRule) {
      score -= 15;
      issues.push(
        'Master-image / photo Step 2 must include all 3 solid backdrop tiers (pure white, pure black, and medium neutral gray for combined black+white outlines).'
      );
    }
  }

  // 6. Zero host font pollution & strict EN/zh-CN parity (10 pts)
  const hostFallbackFont = record.dna.pageFallbackTypography?.[0]?.primaryFont;
  if (isArtwork && hostFallbackFont && allCombined.includes(hostFallbackFont)) {
    score -= 10;
    issues.push(`Host fallback font "${hostFallbackFont}" leaked into artwork 3-image prompts.`);
  }
  if (language === 'zh-CN' && /Create 1|Edit the attached|Return only the 1/i.test(allCombined)) {
    score -= 10;
    issues.push('Simplified Chinese 3-image prompts leaked English phrases.');
  }
  if (language === 'en' && /[\u4e00-\u9fff]/.test(allCombined) && !/[\u4e00-\u9fff]/.test(trimmed)) {
    score -= 10;
    issues.push('English 3-image prompts leaked Chinese characters.');
  }

  const finalScore = Math.max(0, score);
  return {
    score: finalScore,
    passedThreshold: finalScore >= PROMPT_CONSISTENCY_THRESHOLD,
    issues,
  };
}
