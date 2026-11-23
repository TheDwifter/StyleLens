import {
  describeLetteringForPrompt,
  letteringFeatureWords,
  type LetteringMetrics,
} from './letteringMetrics';
import type { CaptureRecord } from '../types/capture';
import {
  isArtworkOrPhotoLikeCapture,
  shouldSuppressHostFallbackFont,
} from './captureClassification';
import { contrastRatio, parseCssColor } from './color';
import { collectCapturedTextSnippets } from './specGenerator';

/**
 * StyleLens Chained Master-Image Separation prompts with X-Ray Design DNA Telemetry —
 * positive, visual, clash-free prompts engineered for >= 99.99% reliability across
 * Gemini/Hydrogen, ChatGPT, Grok, Qwen, and Copilot:
 *
 *   1. `composite`       — Create the 1 Master Image (captured reference + X-Ray Style DNA -> target text on scene)
 *   2. `text-only`       — Separate ONLY the exact existing target lettering FROM that Master Image
 *                          onto a flat, uniform solid backdrop (ready for client-side RGBA alpha matting
 *                          & sub-pixel vector `<path>` tracing!)
 *   3. `background-only` — Separate the exact pixel-locked clean background FROM that Master Image
 *                          by removing ONLY the target lettering (zero scene regeneration!)
 *
 * Design invariants:
 * - Authentic X-Ray Style DNA telemetry (sampled/DOM palette hexes + shares, luminance polarity,
 *   exact capture dimensions & aspect ratio, surface geometry, and verified brand typography)
 *   injected into Step 1 (`composite`) and standalone Step 2 (`original-attached`).
 * - Zero trademark/IP moderation bait ("trademark", "brand/school", "mascot", "bitten Apple")
 * - Zero pink-elephant / fake-checkerboard words ("transparent", "checkerboard", "PNG", "cutout",
 *   "Arial", "SVG", "HTML", "code", "gibberish")
 * - 3-tier outer-edge & combined-fill-and-outline solid backdrop rule (pure white / pure black /
 *   medium neutral gray) with zero raw hex codes inside Step 2's backdrop instruction!
 */
export type ChatImageStepId = 'composite' | 'text-only' | 'background-only';

/**
 * Controls what source image Steps 2 (`text-only`) and 3 (`background-only`) separate from:
 * - `master-attached`: PRIMARY — attaches the extracted Step 1 Master Image directly (zero regeneration!)
 * - `master-thread`:   FALLBACK (Gemini/ChatGPT only, NEVER Grok) — references the Master Image already in chat
 * - `original-attached`: STANDALONE — single-step button clicked before a Step 1 Master Image exists
 */
export type SeparationSourceMode = 'master-attached' | 'master-thread' | 'original-attached';

export interface ChatSeparationOptions {
  sourceMode?: SeparationSourceMode;
  /** True when separating an image already sitting in an existing multi-turn chat thread. */
  existingMasterInChat?: boolean;
}

export interface ChatImageStep {
  id: ChatImageStepId;
  prompt: string;
}

const PURE_WHITE_RGB = { r: 255, g: 255, b: 255, a: 1 } as const;
const PURE_BLACK_RGB = { r: 0, g: 0, b: 0, a: 1 } as const;

const GENERIC_SYSTEM_FONT_RE =
  /^(?:system-ui|-apple-system|blinkmacsystemfont|segoe ui|arial|helvetica(?:\s+neue)?|times new roman|sans-serif|serif|monospace)$/i;

function sanitizeWord(raw: string | undefined): string {
  return (
    raw
      ?.replace(/[`"“”\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) ?? ''
  );
}

function cleanFontFamilyName(raw: string): string {
  const first = (raw.split(',')[0] ?? raw).replace(/^["'\s]+|["'\s]+$/g, '').trim();
  return (
    first
      .replace(/^__/, '')
      .replace(/_[a-f0-9]{5,}$/i, '')
      .replace(/_/g, ' ')
      .trim() || first
  );
}

/** Original visible words in the capture (live DOM only — photos/logos/search tiles have no reliable DOM text). */
function findOriginalText(record: CaptureRecord): string | null {
  if (isArtworkOrPhotoLikeCapture(record) || shouldSuppressHostFallbackFont(record)) return null;
  const snippet = collectCapturedTextSnippets(record)[0];
  return snippet && snippet.length <= 40 ? snippet.replace(/["“”]/g, '') : null;
}

/** Real font name for live DOM text (never leaks Google Images chrome fonts or generic Arial fallbacks). */
function findLiveFontHint(record: CaptureRecord): string | null {
  if (isArtworkOrPhotoLikeCapture(record) || shouldSuppressHostFallbackFont(record)) return null;
  const t = record.dna.typography[0];
  if (!t) return null;
  const clean = cleanFontFamilyName(t.primaryFont);
  if (!clean || GENERIC_SYSTEM_FONT_RE.test(clean)) return null;
  return `${clean}, weight ${t.fontWeight}`;
}

/**
 * Returns a deterministic single solid backdrop ONLY for live DOM captures with exact CSS text
 * color (never guessed from whole-image pixel histograms on 3D hardware/logo photos).
 */
function resolveLiveTextBackdrop(record: CaptureRecord): {
  en: 'solid pure white' | 'solid pure black' | 'solid medium neutral gray';
  zh: '纯白纯色' | '纯黑纯色' | '均匀的中性灰纯色';
} | null {
  if (isArtworkOrPhotoLikeCapture(record) || shouldSuppressHostFallbackFont(record)) return null;
  const exactTextHex = record.dna.palette.find(
    (c) => c.provenance === 'exact-dom' && c.role === 'text'
  )?.hex;
  if (!exactTextHex) return null;
  const parsed = parseCssColor(exactTextHex);
  if (!parsed) return null;

  const textIsDark = contrastRatio(parsed, PURE_WHITE_RGB) >= contrastRatio(parsed, PURE_BLACK_RGB);

  const shadows = record.dna.surfaces?.textShadows ?? [];
  for (const sh of shadows) {
    const colorMatch = sh.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}\b/);
    const shColor = colorMatch ? parseCssColor(colorMatch[0]) : null;
    if (!shColor || shColor.a < 0.35) continue;
    const shadowIsDark =
      contrastRatio(shColor, PURE_WHITE_RGB) >= contrastRatio(shColor, PURE_BLACK_RGB);
    if (shadowIsDark !== textIsDark) {
      return { en: 'solid medium neutral gray', zh: '均匀的中性灰纯色' };
    }
  }

  return textIsDark
    ? { en: 'solid pure white', zh: '纯白纯色' }
    : { en: 'solid pure black', zh: '纯黑纯色' };
}

/**
 * Builds the compact X-Ray Design DNA Telemetry line from the capture's measured pixel/DOM palette,
 * luminance polarity, aspect geometry, surface traits, and verified brand typography.
 * Strictly excludes dark-mode search-engine container colors (e.g. `#22242A` on Google Images)
 * and search-engine chrome fonts (`Google Sans`).
 */
export function buildXRayTelemetryLine(
  record: CaptureRecord,
  language: 'en' | 'zh-CN' = 'en',
  stepId: 'composite' | 'text-only' = 'composite'
): string {
  const { dna, rect } = record;
  const isArtwork = isArtworkOrPhotoLikeCapture(record);
  const suppressHost = shouldSuppressHostFallbackFont(record);

  const sampled = [...dna.palette]
    .filter((c) => c.provenance === 'sampled-pixels')
    .sort((a, b) => (b.visualSharePercent ?? 0) - (a.visualSharePercent ?? 0));

  let palettePool = dna.palette;
  if (isArtwork || suppressHost) {
    palettePool = sampled.length > 0 ? sampled : suppressHost ? [] : dna.palette;
  } else {
    const rank: Record<string, number> = {
      background: 0,
      text: 1,
      accent: 2,
      surface: 3,
      sampled: 4,
      border: 5,
    };
    palettePool = [...dna.palette].sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9));
  }

  const seenHex = new Set<string>();
  const colorTokens: string[] = [];
  for (const tok of palettePool) {
    const upper = tok.hex.toUpperCase();
    if (seenHex.has(upper)) continue;
    seenHex.add(upper);
    colorTokens.push(
      typeof tok.visualSharePercent === 'number' && tok.visualSharePercent > 0
        ? `${upper} (${Math.round(tok.visualSharePercent)}%)`
        : upper
    );
    if (colorTokens.length >= 4) break;
  }

  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const aspect = (w / h).toFixed(2);

  const surfaceHints: string[] = [];
  if (stepId === 'composite') {
    const rawRadius = dna.surfaces?.borderRadii?.[0]?.trim();
    if (rawRadius && rawRadius !== '0px' && rawRadius.length <= 16) {
      surfaceHints.push(language === 'zh-CN' ? `圆角 ${rawRadius}` : `radius ${rawRadius}`);
    }
    if ((dna.surfaces?.gradients?.length ?? 0) > 0) {
      surfaceHints.push(language === 'zh-CN' ? '渐变质感' : 'gradient surface');
    }
    if ((dna.surfaces?.shadows?.length ?? 0) > 0) {
      surfaceHints.push(language === 'zh-CN' ? '立体阴影' : 'soft shadow');
    }
    if ((dna.surfaces?.backdropFilters?.length ?? 0) > 0) {
      surfaceHints.push(language === 'zh-CN' ? '毛玻璃' : 'frosted glass');
    }
  }

  const liveType = !isArtwork && !suppressHost ? dna.typography[0] : undefined;
  const fontHint = liveType
    ? (() => {
        const cleanFont = cleanFontFamilyName(liveType.primaryFont);
        if (!cleanFont || GENERIC_SYSTEM_FONT_RE.test(cleanFont)) return null;
        const ls = liveType.letterSpacing;
        const tracking =
          ls && ls !== 'normal' && ls !== '0em' && ls !== '0px'
            ? language === 'zh-CN'
              ? ` 字距 ${ls}`
              : ` tracking ${ls}`
            : '';
        return language === 'zh-CN'
          ? `字体 ${cleanFont} ${liveType.fontWeight}${tracking}`
          : `font ${cleanFont} ${liveType.fontWeight}${tracking}`;
      })()
    : null;

  if (language === 'zh-CN') {
    const polarity =
      dna.polarity === 'dark' ? '深色基调' : dna.polarity === 'light' ? '浅色基调' : '混合明暗';
    const parts = [
      colorTokens.length > 0 ? `配色 ${colorTokens.join(' · ')}` : null,
      polarity,
      stepId === 'composite' ? `尺寸 ${w}×${h}px (${aspect}:1)` : null,
      ...surfaceHints.slice(0, 2),
      fontHint,
    ].filter(Boolean);
    return `X-Ray 设计基因（仅作色彩与比例参考，勿将文字数值印入画面）：${parts.join(' | ')}。`;
  }

  const polarity =
    dna.polarity === 'dark'
      ? 'dark polarity'
      : dna.polarity === 'light'
        ? 'light polarity'
        : 'mixed polarity';
  const parts = [
    colorTokens.length > 0 ? `palette ${colorTokens.join(' · ')}` : null,
    polarity,
    stepId === 'composite' ? `${w}×${h}px (${aspect}:1)` : null,
    ...surfaceHints.slice(0, 2),
    fontHint,
  ].filter(Boolean);
  return `X-Ray Style DNA (reference colors & proportions only — do not draw values as text): ${parts.join(' | ')}.`;
}

function buildStep2BackdropRule(
  record: CaptureRecord,
  targetLabel: string,
  language: 'en' | 'zh-CN',
  sourceMode: SeparationSourceMode
): string {
  const concreteBackdrop =
    sourceMode === 'original-attached' ? resolveLiveTextBackdrop(record) : null;

  if (language === 'zh-CN') {
    if (concreteBackdrop) {
      return `将分离出的 ${targetLabel} 文字居中摆放，四周留出充足干净的空白边距，放在完全平坦、均匀、无纹理的${concreteBackdrop.zh}背景上。`;
    }
    return `将分离出的 ${targetLabel} 文字居中摆放，四周留出充足空白边距，放在完全平坦、均匀、无纹理的单一纯色背景上：如果文字为深色或黑色，使用纯白纯色背景；如果文字为白色、银色、金色、发光或亮彩色，使用纯黑纯色背景；如果文字同时包含深黑与亮白填充或描边，使用均匀的中性灰纯色背景。`;
  }

  if (concreteBackdrop) {
    return `Center the isolated ${targetLabel} lettering with generous margin on a completely flat, uniform ${concreteBackdrop.en} background.`;
  }
  return `Center the isolated ${targetLabel} lettering with generous margin on one flat, uniform solid background: use a solid pure white background for dark or black letters, a solid pure black background for white, silver, gold, glowing, or bright letters, or a solid medium neutral gray background if the letters mix both dark black and bright white fills or outlines.`;
}

/**
 * Upper bound for the picture prompt. Plain prose of this length is fine for image chats; what
 * knocked them into text-only answers in the past was asking for code blocks, tables or several
 * images in one turn, which this prompt never does.
 */
export const COMPOSITE_PROMPT_MAX_CHARS = 1900;

/**
 * If the original lettering is set in one case only (all capitals like "INSOMNIA", or all
 * lowercase like "crave"), returns the typed words in that same case; otherwise null.
 * Mixed-case input on an all-caps logo makes image models mix capital and small letters.
 */
export function matchOriginalCase(original: string, word: string): string | null {
  const letters = original.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2 || !word.trim()) return null;
  const allUpper = letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  const allLower = letters === letters.toLowerCase() && letters !== letters.toUpperCase();
  const styled = allUpper ? word.toUpperCase() : allLower ? word.toLowerCase() : null;
  return styled && styled !== word ? styled : null;
}

/** "Make it" -> "M-a-k-e i-t": spelling it out letter by letter helps image models get it right. */
function spellOut(word: string): string {
  return word
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => [...part].join('-'))
    .join(' ');
}

/** Letters of the new word that do NOT occur in the original word (case-insensitive). */
function missingLetters(original: string, word: string): string[] {
  const have = new Set(original.toLowerCase());
  const out: string[] = [];
  for (const ch of word.toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(ch) && !have.has(ch) && !out.includes(ch)) out.push(ch);
  }
  return out;
}

/**
 * Best guess at what a captured PICTURE says, from the image's alt text (e.g. Google Images'
 * "Crave logo" -> "Crave"). Only a suggestion: the user confirms or corrects it in Step 2.
 */
export function guessPictureText(record: Pick<CaptureRecord, 'roots'>): string {
  const stack = [...record.roots];
  while (stack.length > 0) {
    const node = stack.shift()!;
    const alt = (node.imgAlt || node.ariaLabel || '').trim();
    if (alt) {
      const cleaned = alt
        .split(/\s[-–—|:]\s|\s\(|,/)[0]!
        .replace(/\b(?:logo|logos|logotype|icon|wordmark|png|jpg|svg|vector|image|picture|brand)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned.length >= 2 && cleaned.length <= 24 && cleaned.split(' ').length <= 3) return cleaned;
    }
    stack.push(...node.children);
  }
  return '';
}

/** Letters of the new word that also occur in the original word (case-insensitive), in order. */
function sharedLetters(original: string, word: string): string[] {
  const have = new Set(original.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
  const out: string[] = [];
  for (const ch of word.toLowerCase()) {
    if (have.has(ch) && !out.includes(ch)) out.push(ch);
  }
  return out;
}

export function buildCompositeImagePrompt(
  record: CaptureRecord,
  customWord: string,
  language: 'en' | 'zh-CN' = 'en',
  /** Measured proportions and shapes of the ORIGINAL lettering (see letteringMetrics.ts). */
  originalLettering?: LetteringMetrics | null,
  /** What the picture currently says, confirmed by the user (pictures have no text to read). */
  originalTextOverride?: string
): string {
  const word = sanitizeWord(customWord);
  const original = sanitizeWord(originalTextOverride) || findOriginalText(record);
  const font = findLiveFontHint(record);
  const xrayLine = buildXRayTelemetryLine(record, language, 'composite');
  const measured =
    originalLettering && originalLettering.letterCount >= 2 ? originalLettering : null;
  const shared = original && word ? sharedLetters(original, word) : [];

  if (language === 'zh-CN') {
    const targetPhrase = word ? `「${word}」` : '我输入的文字';
    const f = measured ? letteringFeatureWords(measured) : null;
    return [
      `请基于我附上的图片，直接生成 1 张编辑后的图片。`,
      original
        ? `把图中的文字「${original}」替换成：${targetPhrase}。`
        : `把图中的主要文字替换成：${targetPhrase}。`,
      `完整保留原图 100% 的背景、物体或徽章图案、颜色、光影、构图和比例。`,
      font
        ? `原文字使用的字体是 ${font}，新文字必须使用同一字体。`
        : `原文字是定制的标志字形，不是常见字体。请复刻它的字形，不要换成任何常见或通用字体。`,
      `按以下步骤绘制新文字：`,
      original
        ? `1. 原文字是「${original}」。`
        : `1. 先逐个字母读出图中原有的文字。`,
      shared.length > 0
        ? `2. 新文字中与原文字相同的字母（${shared.join('、')}）必须从图中原样复制：相同的骨架、弧线、转角、笔画收尾和宽度。`
        : `2. 新文字中凡是原文字里也有的字母，必须从图中原样复制：相同的骨架、弧线、转角、笔画收尾和宽度。`,
      `3. 其余字母用同样的部件绘制：相同的笔画粗细、弧线与转角形状、笔画收尾和比例，让整个词看起来出自同一位设计师之手。`,
      `4. 保持与原文字相同的字高和位置，以及相同的字距、颜色、渐变和质感；边缘处理须完全一致，原有的描边、阴影或发光要保留，原本没有的一律不要添加。`,
      f
        ? `原文字实测：${f.width}；${f.weight}（约为字高的 ${f.strokePct}%）；${f.curves}${f.height ? `；${f.height}` : ''}；字距${f.spacing}；字高约占画面高度的 ${f.sizePct}%。`
        : null,
      word
        ? `严格按此逐字拼写：${word}——仅作画面中的纯文字排版，不要根据该词字面含义改动图案或配色。`
        : `请把新文字严格当作纯文字排版，保持原图原有的配色、画风与图案不变。`,
      xrayLine,
      `输出这一张编辑后的图片，并在下方附上一句简短感谢语，提醒用户可在 StyleLens 扩展窗口中预览、复制并下载分离好的字体图层与干净背景图层。`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  const targetQuoted = word ? `"${word}"` : 'my requested words';
  const lines: Array<string | null> = [
    `Create 1 edited image from the attached picture.`,
    original
      ? `Replace the words "${original}" with ${targetQuoted}.`
      : `Replace the main words in the attached picture with ${targetQuoted}.`,
    `Keep 100% of the background, objects, emblems, colors, lighting, framing and scale identical.`,
    font
      ? `The original text is set in ${font}; use exactly that typeface for the new text.`
      : `The existing lettering is a custom logotype, not a standard font. Reproduce its letterforms; do not substitute any common or generic typeface.`,
    `Build the new word in four steps:`,
    original
      ? `1. The existing word is "${original}".`
      : `1. Read the existing word in the picture letter by letter.`,
    shared.length > 0
      ? `2. The letters ${shared.join(', ')} appear in both words: copy each one exactly from the picture, with the same skeleton, curves, corners, stroke endings and width. The other letters (${missingLetters(original ?? '', word).join(', ') || 'none'}) are new.`
      : `2. Every letter of ${targetQuoted} that also appears in that word must be copied exactly from the picture, with the same skeleton, curves, corners, stroke endings and width.`,
    `3. Draw every other letter from the same parts: the same stroke thickness, curve and corner shape, stroke endings and proportions, so the word looks drawn by one designer.`,
    `4. Draw the new text at the same letter height and position as the original, with the same spacing, color, gradient and finish.`,
    measured ? describeLetteringForPrompt(measured) : null,
    `Copy its edges exactly: keep any outline, shadow or glow it has; add none it lacks.`,
    word
      ? `Spell it literally as: ${word}${word.replace(/\s+/g, '').length >= 3 ? ` (${spellOut(word)})` : ''} — strictly as typed text inside this existing artwork, without changing the artwork's colors, style, or symbols to match the word's meaning.`
      : `Use my requested words strictly as typed text inside this existing artwork, preserving the artwork's original colors, style, and symbols.`,
    xrayLine,
    `Return the 1 edited image, then a one-line thank-you note pointing to the StyleLens extension window.`,
  ];
  const full = lines.filter((l): l is string => Boolean(l)).join('\n');
  if (full.length <= COMPOSITE_PROMPT_MAX_CHARS || !measured) return full;
  // Very long words: fall back to the short measurement line
  return lines
    .map((l) => (l && measured && l === describeLetteringForPrompt(measured) ? describeLetteringForPrompt(measured, true) : l))
    .filter((l): l is string => Boolean(l))
    .join('\n');
}
export function buildTextOnlyImagePrompt(
  record: CaptureRecord,
  customWord: string,
  language: 'en' | 'zh-CN' = 'en',
  options?: ChatSeparationOptions
): string {
  const word = sanitizeWord(customWord);
  const sourceMode: SeparationSourceMode = options?.sourceMode ?? 'original-attached';
  const font = sourceMode === 'original-attached' ? findLiveFontHint(record) : null;

  if (language === 'zh-CN') {
    const targetPhrase = word ? `「${word}」` : '画面中的文字';
    const backdropLine = buildStep2BackdropRule(record, targetPhrase, 'zh-CN', sourceMode);

    if (sourceMode === 'master-attached') {
      return [
        `请直接编辑我附上的图片，分离并提取出画面中已有的 ${targetPhrase} 文字本身，放到完全平坦、均匀、无纹理的纯色背景上。`,
        `只保留附图中已经画好的 ${targetPhrase} 这几个字，不要重新设计或改写字体风格——严格锁定原有字母的字形、笔画粗细、倾斜角度、字距、颜色、渐变与表面质感，把周围全部物体、徽章、光影与背景场景移除。`,
        backdropLine,
        `背景必须完全平整均匀，无任何阴影、渐变、边框、纹理或多余图案，只保留原有文字。只输出这一张图片。`,
      ].join('\n');
    }

    if (sourceMode === 'master-thread') {
      const refPhrase = options?.existingMasterInChat
        ? '你上方最新生成的完整合成图片'
        : '你上一条回复刚刚生成的合成图片';
      return [
        `请直接基于${refPhrase}，从中分离并提取出画面中已有的 ${targetPhrase} 文字本身，放到完全平坦、均匀、无纹理的纯色背景上。`,
        `只保留那张图里已经画好的 ${targetPhrase} 这几个字，不要重新设计或改写字体风格——严格锁定原有字母的字形、笔画粗细、倾斜角度、字距、颜色、渐变与表面质感，把周围全部物体、徽章、光影与背景场景移除。`,
        backdropLine,
        `背景必须完全平整均匀，无任何阴影、渐变、边框、纹理或多余图案，只保留原有文字。只输出这一张图片。`,
      ].join('\n');
    }

    const xrayLineZh = buildXRayTelemetryLine(record, 'zh-CN', 'text-only');
    return [
      `请参考我附上图片中的文字造型，直接生成 1 张只包含造型文字的图片。`,
      `画面中只显示这几个字：${targetPhrase}，严格复刻附图中文字的字形结构、笔画粗细、衬线或弧度、倾斜角度、颜色、渐变与表面质感${font ? `（参考原字体 ${font}）` : ''}。`,
      backdropLine,
      `整个画面除了居中的造型文字与平整纯色背景之外，不包含任何场景、图案、边框或多余文字。`,
      xrayLineZh,
      word
        ? `严格按此逐字拼写：${word}，只把「${word}」当作纯造型文字呈现。只输出这一张图片。`
        : `只输出这一张图片。`,
    ].join('\n');
  }

  const targetQuoted = word ? `"${word}"` : 'the main lettering';
  const backdropLine = buildStep2BackdropRule(record, targetQuoted, 'en', sourceMode);

  if (sourceMode === 'master-attached') {
    return [
      `Edit the attached image to isolate ONLY the existing ${targetQuoted} lettering onto a flat, uniform solid background.`,
      `Extract the exact ${targetQuoted} writing already shown without redesigning or restyling any letter — keep identical shapes, weight, slant, colors, gradients, and finish while removing the object, emblem, and scene.`,
      backdropLine,
      `Keep the background smooth and uniform with zero shadows, borders, or extra marks. Return only the 1 image.`,
    ].join('\n');
  }

  if (sourceMode === 'master-thread') {
    const refPhrase = options?.existingMasterInChat
      ? 'the latest full composite picture you generated above'
      : 'the composite picture you just generated in your previous reply';
    return [
      `Create 1 image by extracting ONLY the existing ${targetQuoted} lettering from ${refPhrase} onto a flat, uniform solid background.`,
      `Lift the exact ${targetQuoted} writing already shown without redesigning or restyling any letter — keep identical shapes, weight, slant, colors, gradients, and finish while removing the object, emblem, and scene.`,
      backdropLine,
      `Keep the background smooth and uniform with zero shadows, borders, or extra marks. Return only the 1 image.`,
    ].join('\n');
  }

  const xrayLineEn = buildXRayTelemetryLine(record, 'en', 'text-only');
  return [
    `Create 1 image showing ONLY the styled text ${targetQuoted}, using the attached picture as the lettering reference.`,
    `Match the exact letter shapes, stroke weight, slant, color, gradient, and surface finish of the lettering in the attached picture${font ? ` (${font})` : ''}.`,
    backdropLine,
    `Show only the centered styled letters on that uniform solid background with zero scene or borders.`,
    xrayLineEn,
    word
      ? `Spell it literally as: ${word} — strictly as styled letters without icons. Return only the 1 image.`
      : `Return only the 1 image.`,
  ].join('\n');
}

export function buildBackgroundOnlyImagePrompt(
  record: CaptureRecord,
  language: 'en' | 'zh-CN' = 'en',
  customWord?: string,
  options?: ChatSeparationOptions
): string {
  const sourceMode: SeparationSourceMode = options?.sourceMode ?? 'original-attached';
  const word = sanitizeWord(customWord);
  const original = findOriginalText(record);
  const targetToRemove = sourceMode === 'original-attached' ? original : word || original;

  if (language === 'zh-CN') {
    if (sourceMode === 'master-attached') {
      return [
        `请直接编辑我附上的这张图片，只把画面中${targetToRemove ? `文字「${targetToRemove}」以及所有` : '所有'}可见的文字、字母和数字干净移除，只保留这张图原本的干净背景。`,
        `不要重新生成或改变场景——100% 原封不动地锁定这张图的构图、宽高比、视角、主体物体轮廓、徽章形状、颜色、光影、反光和阴影位置。`,
        `只无缝修补文字原本所在位置的底面表面，使其自然延续周围的材质纹理、弧度、色彩渐变与光线明暗。`,
        `确保最终画面里没有任何文字、字母或数字。只输出这一张干净的背景底图。`,
      ].join('\n');
    }

    if (sourceMode === 'master-thread') {
      const refPhrase = options?.existingMasterInChat
        ? '你上方最新生成的完整合成图片'
        : '你在第一轮回复中生成的完整合成图片';
      return [
        `请直接编辑${refPhrase}${targetToRemove ? `（带有「${targetToRemove}」文字的那张图）` : ''}，只把画面中${targetToRemove ? `文字「${targetToRemove}」以及所有` : '所有'}可见的文字、字母和数字干净移除，只保留那张图原本的干净背景。`,
        `不要重新生成或改变场景——100% 原封不动地锁定那张完整合成图的构图、宽高比、视角、主体物体轮廓、徽章形状、颜色、光影、反光和阴影位置。`,
        `只无缝修补文字原本所在位置的底面表面，使其自然延续周围的材质纹理、弧度、色彩渐变与光线明暗。`,
        `确保最终画面里没有任何文字、字母或数字。只输出这一张干净的背景底图。`,
      ].join('\n');
    }

    return [
      `请基于我附上的图片，生成 1 张去除全部文字后的干净背景图。`,
      `自然清除画面中所有的文字、字母和数字${original ? `（包括「${original}」）` : ''}，并用周围原本的材质纹理、颜色、光影和反光无缝修补文字原来的位置。`,
      `100% 完整保留原图的背景、主体物体、非文字图案、阴影、光线和构图尺寸。`,
      `让原本有文字的位置恢复为干净自然的表面，不留任何字母、文字或数字。只输出这一张图片。`,
    ].join('\n');
  }

  if (sourceMode === 'master-attached') {
    return [
      `Edit the attached image to cleanly remove ${targetToRemove ? `the text "${targetToRemove}" and every other` : 'every'} visible word, letter, and number, leaving only this exact clean background scene.`,
      `Do not regenerate or alter the scene — keep 100% of this exact image identical: preserve the exact same framing, aspect ratio, camera angle, physical object proportions, emblem contours, colors, lighting, reflections, and shadows.`,
      `Seamlessly reconstruct only the surface areas directly behind the removed lettering so they naturally continue the surrounding material, curvature, color gradient, and lighting.`,
      `Leave the entire image completely free of any letters, words, or numbers. Return only the 1 clean background image.`,
    ].join('\n');
  }

  if (sourceMode === 'master-thread') {
    const refPhrase = options?.existingMasterInChat
      ? 'the latest full composite picture you generated above'
      : 'the composite picture you generated in your first reply';
    return [
      `Edit ${refPhrase}${targetToRemove ? ` (the full scene showing "${targetToRemove}")` : ''} to cleanly remove ${targetToRemove ? `the text "${targetToRemove}" and every other` : 'every'} visible word, letter, and number, leaving only that exact clean background scene.`,
      `Do not regenerate or alter the scene — keep 100% of that composite image identical: preserve the exact same framing, aspect ratio, camera angle, physical object proportions, emblem contours, colors, lighting, reflections, and shadows.`,
      `Seamlessly reconstruct only the surface areas directly behind the removed lettering so they naturally continue the surrounding material, curvature, color gradient, and lighting.`,
      `Leave the entire image completely free of any letters, words, or numbers. Return only the 1 clean background image.`,
    ].join('\n');
  }

  return [
    `Create 1 edited image from the attached picture with all words and letters cleanly removed.`,
    `Smoothly remove every word, letter, and number${original ? ` (including "${original}")` : ''} and naturally fill those spots with the exact surrounding surface texture, grain, color, and lighting.`,
    `Keep 100% of the background, physical object, non-text artwork, shadows, reflections, and framing identical.`,
    `Leave every area where words previously appeared completely clean and free of any letters or numbers. Return only the 1 clean image.`,
  ].join('\n');
}

/**
 * The 3 core outputs, always in this exact order:
 *   0. `composite`       — Master edited picture (original screenshot -> target word on scene)
 *   1. `text-only`       — Isolated font/writing separated FROM the Master Image
 *   2. `background-only` — Clean background separated FROM the Master Image
 */
export function buildThreeImageSteps(
  record: CaptureRecord,
  customWord: string,
  language: 'en' | 'zh-CN' = 'en',
  options?: ChatSeparationOptions
): ChatImageStep[] {
  const separationOpts: ChatSeparationOptions = {
    sourceMode: options?.sourceMode ?? 'master-attached',
    existingMasterInChat: options?.existingMasterInChat,
  };
  return [
    { id: 'composite', prompt: buildCompositeImagePrompt(record, customWord, language) },
    {
      id: 'text-only',
      prompt: buildTextOnlyImagePrompt(record, customWord, language, separationOpts),
    },
    {
      id: 'background-only',
      prompt: buildBackgroundOnlyImagePrompt(record, language, customWord, separationOpts),
    },
  ];
}

/**
 * Builds ONLY the 2 separation steps (`text-only` + `background-only`) for separating an
 * already-generated Master Image currently sitting in the active AI chat (zero Step 1 regeneration!).
 */
export function buildSeparateExistingImageSteps(
  record: CaptureRecord,
  customWord: string,
  language: 'en' | 'zh-CN' = 'en',
  sourceMode: Exclude<SeparationSourceMode, 'original-attached'> = 'master-attached'
): ChatImageStep[] {
  const opts: ChatSeparationOptions = {
    sourceMode,
    existingMasterInChat: true,
  };
  return [
    { id: 'text-only', prompt: buildTextOnlyImagePrompt(record, customWord, language, opts) },
    {
      id: 'background-only',
      prompt: buildBackgroundOnlyImagePrompt(record, language, customWord, opts),
    },
  ];
}
