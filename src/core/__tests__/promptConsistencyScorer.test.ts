import { describe, expect, it } from 'vitest';
import type { CaptureRecord, RawDomExtraction } from '../../types/capture';
import { analyzeDesignDNA } from '../designAnalyzer';
import {
  evaluateChatThreeImageSuite,
  evaluatePromptConsistencySuite,
  PROMPT_CONSISTENCY_THRESHOLD,
  scoreAiChatOutputCompliance,
} from '../promptConsistencyScorer';
import {
  generateCleanBackgroundImagePrompt,
  generateCompleteAgentPrompt,
  generateIsolatedTextImagePrompt,
} from '../specGenerator';

function makeArchetypeRecord(opts: {
  hostname: string;
  polarity: 'light' | 'dark' | 'mixed';
  width: number;
  height: number;
  bgHex: string;
  textHex: string;
  accentHex: string;
  fontName?: string;
  sampleText?: string;
  containsGraphicArtwork: boolean;
  visualOnlySampledPalette?: boolean;
}): CaptureRecord {
  const palette: CaptureRecord['dna']['palette'] = opts.visualOnlySampledPalette
    ? [
        {
          hex: opts.bgHex,
          rgbString: opts.bgHex,
          role: 'sampled',
          usageCount: 3,
          provenance: 'sampled-pixels',
          alpha: 1,
        },
        {
          hex: opts.accentHex,
          rgbString: opts.accentHex,
          role: 'sampled',
          usageCount: 2,
          provenance: 'sampled-pixels',
          alpha: 1,
        },
      ]
    : [
        {
          hex: opts.bgHex,
          rgbString: opts.bgHex,
          role: 'background',
          usageCount: 3,
          provenance: 'exact-dom',
          alpha: 1,
        },
        {
          hex: opts.textHex,
          rgbString: opts.textHex,
          role: 'text',
          usageCount: 2,
          provenance: 'exact-dom',
          alpha: 1,
        },
        {
          hex: opts.accentHex,
          rgbString: opts.accentHex,
          role: 'accent',
          usageCount: 2,
          provenance: 'sampled-pixels',
          alpha: 1,
        },
      ];

  return {
    id: `arch-${opts.hostname}`,
    createdAt: 1763700000000,
    page: {
      url: `https://${opts.hostname}`,
      hostname: opts.hostname,
      title: opts.hostname,
    },
    rect: { x: 0, y: 0, width: opts.width, height: opts.height },
    viewport: { width: 1440, height: 900, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    captureMode: opts.containsGraphicArtwork ? 'visual-only' : 'dom-and-visual',
    containsGraphicArtwork: opts.containsGraphicArtwork,
    selectionMethod: 'marquee',
    totalNodesScanned: opts.containsGraphicArtwork ? 0 : 3,
    truncated: false,
    screenshotBlob: new Blob(['png'], { type: 'image/png' }),
    screenshotWidth: opts.width * 2,
    screenshotHeight: opts.height * 2,
    roots: opts.containsGraphicArtwork
      ? []
      : [
          {
            id: 'r1',
            tag: 'header',
            cleanClasses: ['brand-bar'],
            omittedHashedClassCount: 0,
            textSnippet: opts.sampleText,
            rect: { x: 0, y: 0, width: opts.width, height: opts.height },
            styles: {
              display: 'flex',
              position: 'relative',
              width: `${opts.width}px`,
              height: `${opts.height}px`,
              backgroundColor: opts.bgHex,
              borderRadius: '16px',
            },
            effectiveBackgroundHex: opts.bgHex,
            hasNonSolidBackgroundAncestor: false,
            pseudoElements: [],
            children: [],
          },
        ],
    dna: {
      polarity: opts.polarity,
      palette,
      typography: opts.fontName
        ? [
            {
              primaryFont: opts.fontName,
              fontStack: `"${opts.fontName}", sans-serif`,
              fontSizePx: 28,
              fontWeight: 500,
              lineHeightPx: 34,
              lineHeightRatio: 1.21,
              letterSpacing: '0em',
              role: 'display',
              sampleText: opts.sampleText ?? 'Gmail',
              usageCount: 1,
            },
          ]
        : [],
      contrastChecks: [],
      layout: {
        primaryModel: 'flex',
        flexCount: 1,
        gridCount: 0,
        flexDirections: ['row'],
        gridTemplates: [],
        gapValuesPx: [12],
        paddingValuesPx: [16],
        spacingScalePx: [8, 16],
        spacingGridBase: 8,
        dimensionsPx: { width: opts.width, height: opts.height },
      },
      surfaces: {
        borderRadii: ['16px'],
        borders: [],
        shadows: [],
        textShadows: [],
        transforms: [],
        clipPaths: [],
        gradients: [],
        backdropFilters: [],
      },
      traits: [],
      cssVariables: [],
      fontStylesheetUrls: [],
      fontFaceRules: [],
      pageFallbackTypography: [],
      summaryText: `${opts.polarity} UI`,
    },
  };
}

describe('99% Prompt Consistency & Output Accuracy Scorer', () => {
  it('scores >= 99% PASS across all real-world capture archetypes (including visual-only sampled, dark-text-on-dark-page, mixed polarity, and zh-CN)', () => {
    const archetypes: Array<{
      label: string;
      record: CaptureRecord;
      word?: string;
      lang: 'en' | 'zh-CN';
    }> = [
      {
        label: 'Gmail Header -> Bigger (proprietary Product Sans)',
        record: makeArchetypeRecord({
          hostname: 'mail.google.com',
          polarity: 'light',
          width: 320,
          height: 84,
          bgHex: '#FFFFFF',
          textHex: '#5F6368',
          accentHex: '#EA4335',
          fontName: 'Product Sans',
          sampleText: 'Gmail',
          containsGraphicArtwork: false,
        }),
        word: 'Bigger',
        lang: 'en',
      },
      {
        label: 'Corsair DDR5 RAM -> obama (real visual-only sampled palette ONLY)',
        record: makeArchetypeRecord({
          hostname: 'corsair.com',
          polarity: 'dark',
          width: 560,
          height: 280,
          bgHex: '#181A1F',
          textHex: '#FFFFFF',
          accentHex: '#D4E157',
          containsGraphicArtwork: true,
          visualOnlySampledPalette: true,
        }),
        word: 'obama',
        lang: 'en',
      },
      {
        label: 'Light Pill on Dark Page -> contrast inversion guard (#111111 text MUST get #FFFFFF flat backdrop)',
        record: makeArchetypeRecord({
          hostname: 'linear.app',
          polarity: 'dark',
          width: 360,
          height: 96,
          bgHex: '#0A0A0D',
          textHex: '#111111',
          accentHex: '#5E6AD2',
          fontName: 'Inter',
          sampleText: 'Launch',
          containsGraphicArtwork: false,
        }),
        word: 'Apple',
        lang: 'en',
      },
      {
        label: 'Mixed polarity capture with empty text role (never white-on-white!)',
        record: makeArchetypeRecord({
          hostname: 'stripe.com',
          polarity: 'mixed',
          width: 440,
          height: 160,
          bgHex: '#1A2B49',
          textHex: '#0A2540',
          accentHex: '#635BFF',
          containsGraphicArtwork: true,
          visualOnlySampledPalette: true,
        }),
        word: 'Dollar Tree',
        lang: 'en',
      },
      {
        label: 'Simplified Chinese -> 苹果 (zh-CN full localization)',
        record: makeArchetypeRecord({
          hostname: 'stripe.com',
          polarity: 'light',
          width: 420,
          height: 160,
          bgHex: '#F6F9FC',
          textHex: '#0A2540',
          accentHex: '#635BFF',
          fontName: 'Inter',
          sampleText: 'Stripe',
          containsGraphicArtwork: false,
        }),
        word: '苹果',
        lang: 'zh-CN',
      },
      {
        label: 'Simplified Chinese with empty customWord (zero English leakage)',
        record: makeArchetypeRecord({
          hostname: 'apple.com',
          polarity: 'dark',
          width: 400,
          height: 140,
          bgHex: '#000000',
          textHex: '#F5F5F7',
          accentHex: '#2997FF',
          containsGraphicArtwork: false,
        }),
        word: '',
        lang: 'zh-CN',
      },
    ];

    for (const item of archetypes) {
      const report = evaluatePromptConsistencySuite(item.record, item.word, item.lang);
      expect(report.issues, `Unexpected issues on ${item.label}: ${report.issues.join('; ')}`).toEqual([]);
      expect(report.totalScore, `Score below ${PROMPT_CONSISTENCY_THRESHOLD}% on ${item.label}`).toBeGreaterThanOrEqual(
        PROMPT_CONSISTENCY_THRESHOLD
      );
      expect(report.passedThreshold).toBe(true);

      const chatSuite = evaluateChatThreeImageSuite(item.record, item.word ?? '', item.lang);
      expect(chatSuite.issues, `3-Image issues on ${item.label}: ${chatSuite.issues.join('; ')}`).toEqual([]);
      expect(chatSuite.score).toBe(100);
      expect(chatSuite.passedThreshold).toBe(true);
    }

    // Explicitly assert dark-text-on-dark-page uses pure white #FFFFFF flat cutout backdrop (never black-on-black!)
    const darkPageDarkTextPrompt = generateIsolatedTextImagePrompt(archetypes[2]!.record, 'Apple', 'en');
    expect(darkPageDarkTextPrompt).toContain('`#111111` on `#FFFFFF`');
  });

  it('reproduces and eliminates ALL 5 Google Images RAM photo bugs (zero Google Sans leak, zero #22242A container leak, zero flat-matte rule, zero blocky SVG trace, text-first router lock)', () => {
    // A product photo of RAM modules captured from an image search page
    const googleImagesRamPhoto: CaptureRecord = {
      ...makeArchetypeRecord({
        hostname: 'www.google.com',
        polarity: 'light',
        width: 226,
        height: 117,
        bgHex: '#F7F7F7',
        textHex: '#15151B',
        accentHex: '#E9E7ED',
        containsGraphicArtwork: true,
        visualOnlySampledPalette: true,
      }),
      captureMode: 'dom-and-visual',
      roots: [
        {
          id: 'img-wrap',
          tag: 'img',
          cleanClasses: [],
          omittedHashedClassCount: 0,
          rect: { x: 0, y: 0, width: 226, height: 117 },
          styles: { display: 'block', position: 'static', width: '226px', height: '117px' },
          effectiveBackgroundHex: '#22242A', // Google Images dark-mode page container!
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [],
        },
      ],
      dna: {
        ...makeArchetypeRecord({
          hostname: 'www.google.com',
          polarity: 'light',
          width: 226,
          height: 117,
          bgHex: '#F7F7F7',
          textHex: '#15151B',
          accentHex: '#E9E7ED',
          containsGraphicArtwork: true,
          visualOnlySampledPalette: true,
        }).dna,
        palette: [
          { hex: '#F7F7F7', rgbString: '#F7F7F7', role: 'sampled', usageCount: 30, provenance: 'sampled-pixels', alpha: 1 },
          { hex: '#15151B', rgbString: '#15151B', role: 'sampled', usageCount: 10, provenance: 'sampled-pixels', alpha: 1 },
          { hex: '#E53935', rgbString: '#E53935', role: 'sampled', usageCount: 4, provenance: 'sampled-pixels', alpha: 1 },
        ],
        pageFallbackTypography: [
          {
            primaryFont: 'Google Sans',
            fontStack: '"Google Sans", Arial, sans-serif',
            fontSizePx: 14,
            fontWeight: 700,
            lineHeightPx: 18,
            lineHeightRatio: 1.28,
            letterSpacing: '0em',
            role: 'heading',
            sampleText: 'Google',
            usageCount: 1,
          },
        ],
      },
    };

    const fullPrompt = generateCompleteAgentPrompt(googleImagesRamPhoto, 'Transit', 'en');
    const textPrompt = generateIsolatedTextImagePrompt(googleImagesRamPhoto, 'Transit', 'en');
    const bgPrompt = generateCleanBackgroundImagePrompt(googleImagesRamPhoto, 'en');

    // 1. ZERO Google Sans host font pollution!
    expect(fullPrompt).not.toContain('Google Sans');
    expect(textPrompt).not.toContain('Google Sans');
    // 2. ZERO #22242A host dark-mode container leak — uses real #F7F7F7 photo studio backdrop!
    expect(fullPrompt).toContain('backdrop #F7F7F7');
    expect(fullPrompt).not.toContain('backdrop #22242A');
    expect(bgPrompt).toContain('base backdrop `#F7F7F7`');
    expect(bgPrompt).not.toContain('#22242A');
    // 3. ZERO false "flat solid matte fill / NO 3D gloss" rules on a 3D metallic RAM photo!
    expect(fullPrompt).not.toContain('NO 3D gloss, bevels, or gradients');
    expect(fullPrompt).not.toContain('flat solid matte fill');
    // 4. Explicitly bans blocky/cartoonish SVG polygon traces of the 3D photograph!
    expect(fullPrompt).toContain('DO NOT draw a blocky or cartoonish SVG trace');
    // 5. Permanently excludes WRITE TEXT FIRST & Swatch Card triggers (which broke Gemini into text-only/aborts!)
    expect(fullPrompt).not.toContain('WRITE TEXT FIRST');
    expect(fullPrompt).not.toContain('Swatch Card');

    const score = evaluatePromptConsistencySuite(googleImagesRamPhoto, 'Transit', 'en');
    expect(score.issues).toEqual([]);
    expect(score.totalScore).toBe(100);
    expect(score.passedThreshold).toBe(true);

    const threeImgScore = evaluateChatThreeImageSuite(googleImagesRamPhoto, 'Transit', 'en');
    expect(threeImgScore.issues).toEqual([]);
    expect(threeImgScore.score).toBe(100);
    expect(threeImgScore.passedThreshold).toBe(true);
  });

  it('strictly REJECTS broken AI outputs (Arial <text>, <foreignObject>, raw HTML, invisible fill="none", unclosed SVG, single-triangle cheat, reordered sections) and PASSES 100% compliant outputs', () => {
    // 1. A "Bigger" reply that fails (Arial <text> + raw ```html background)
    const gmailBrokenReply = `
┌──[ 01 · STYLELENS PACKAGE // 01001010 ]──┐
### 01 // Full Composite
### 02 // Isolated Wordmark
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><text font-family="Product Sans, sans-serif">Bigger</text></svg>
\`\`\`
### 03 // Clean Background Layer
\`\`\`html
<div style="background:#fff">Raw HTML code wall</div>
\`\`\`
### 04 // Quick 1-2-3 How To Use
`;
    expect(scoreAiChatOutputCompliance(gmailBrokenReply, 'Bigger', true).passedThreshold).toBe(false);

    // 2. Multi-image object:image{} crash
    const corsairCrashReply = `
01 // Full Composite
object:image{}name=image_generation_content/18390155642568481359
02 // Isolated Wordmark
object:image{}name=image_generation_content/16087837811279682013
`;
    expect(scoreAiChatOutputCompliance(corsairCrashReply, 'obama', false).passedThreshold).toBe(false);

    // 3. <foreignObject> smuggling & invisible fill="none" & unclosed </svg>
    const smuggledReply = `
STYLELENS PACKAGE
### 01 // Full Composite
Bigger
### 02 // Isolated Wordmark
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60">
  <foreignObject width="200" height="60"><div>Bigger</div></foreignObject>
  <path d="M10 10 L50 50" fill="none" />
\`\`\`
### 03 // Clean Background Layer
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 84"></svg>
\`\`\`
### 04 // Quick 1-2-3 How To Use
`;
    const smuggledScore = scoreAiChatOutputCompliance(smuggledReply, 'Bigger', true);
    expect(smuggledScore.passedThreshold).toBe(false);
    expect(smuggledScore.defects.some((d) => d.includes('foreignObject'))).toBe(true);
    expect(smuggledScore.defects.some((d) => d.includes('closing </svg>'))).toBe(true);

    // 4. Trivial 1-triangle cheat for 6-letter "Bigger" + header-only word echo
    const cheatReply = `
\`\`\`text
┌──[ 01 · STYLELENS PACKAGE // 01001010 ]──────────────┐
│  TARGET  : Bigger
└──[ 10110 · READY FOR EXPORT ]────────────────────────┘
\`\`\`
### 01 // Full Composite
Image above.
### 02 // Isolated Wordmark
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" width="220" height="64" viewBox="0 0 220 64">
  <path d="M10 10 L10 54 L36 54 Z" fill="#FFFFFF" />
</svg>
\`\`\`
### 03 // Clean Background Layer
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="84" viewBox="0 0 320 84">
  <rect x="0" y="0" width="320" height="84" rx="16" fill="#FFFFFF" />
</svg>
\`\`\`
### 04 // Quick 1-2-3 How To Use
1. Save image. 2. Copy SVG. 3. Copy BG.
`;
    const cheatScore = scoreAiChatOutputCompliance(cheatReply, 'Bigger', true);
    expect(cheatScore.passedThreshold).toBe(false);
    expect(cheatScore.defects.some((d) => d.includes('insufficient vector letterform'))).toBe(true);
    expect(cheatScore.defects.some((d) => d.includes('missing outside echoed package header'))).toBe(true);

    // 5. Genuine 100% Compliant Hybrid Output (multi-glyph vector <path> SVG + visual text-free BG SVG + dark-fill Exact Text guidance)
    const compliantReply = `
\`\`\`text
┌──[ 01 · STYLELENS PACKAGE // 01001010 ]──────────────┐
│  TARGET  : Bigger
└──[ 10110 · READY FOR EXPORT ]────────────────────────┘
\`\`\`
### 01 // Full Composite
Rendered Layer 1 composite image of Bigger on the exact captured header.
### 02 // Isolated Wordmark
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" width="220" height="64" viewBox="0 0 220 64">
  <path d="M10 10 H28 C34 10 38 14 38 20 C38 25 34 29 28 29 H10 Z M10 29 H30 C37 29 41 34 41 41 C41 48 36 54 28 54 H10 Z" fill="#5F6368" />
  <path d="M50 22 H56 V54 H50 Z M50 11 H56 V17 H50 Z" fill="#5F6368" />
  <path d="M66 38 A14 14 0 1 1 94 38 V58 C94 64 88 68 80 68" fill="#5F6368" />
  <path d="M104 38 A14 14 0 1 1 132 38 V58" fill="#5F6368" />
  <path d="M142 38 A14 14 0 1 1 170 38 H148" fill="#5F6368" />
  <path d="M180 24 H186 V30 C189 25 194 23 200 24 V30 C193 29 186 33 186 41 V54 H180 Z" fill="#5F6368" />
</svg>
\`\`\`
### 03 // Clean Background Layer
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="84" viewBox="0 0 320 84">
  <rect x="0" y="0" width="320" height="84" rx="16" fill="#FFFFFF" />
  <path d="M24 30 H44 M24 42 H44 M24 54 H44" stroke="#5F6368" stroke-width="3" />
</svg>
\`\`\`
### 04 // Quick 1-2-3 How To Use
1. Save the Bigger Layer 1 image.
2. Paste Layer 2 transparent SVG into Figma/Canva (or click Exact Text (AI) in StyleLens).
3. Download Layer 3 clean background SVG.
`;
    const compliantScore = scoreAiChatOutputCompliance(compliantReply, 'Bigger', true);
    expect(compliantScore.defects).toEqual([]);
    expect(compliantScore.score).toBe(100);
    expect(compliantScore.passedThreshold).toBe(true);
  });

  it('runs real analyzeDesignDNA() on a Google Images dark-mode #22242A wrapper + stray Google Sans badge + #F7F7F7 sampled RAM photo and guarantees zero host color/font leaks', () => {
    const rect = { x: 0, y: 0, width: 224, height: 188 };
    const dom: RawDomExtraction = {
      captureMode: 'dom-and-visual',
      selectionMethod: 'marquee',
      containsGraphicArtwork: true,
      graphicArtworkNote: 'Selection contains a 3D product photo.',
      totalNodesScanned: 3,
      truncated: false,
      roots: [
        {
          id: 'host-dark-card',
          tag: 'div',
          cleanClasses: ['image-preview-card'],
          omittedHashedClassCount: 0,
          rect,
          styles: {
            display: 'block',
            position: 'relative',
            width: '224px',
            height: '188px',
            backgroundColor: 'rgb(34, 36, 42)', // #22242A Google Images dark-mode host container!
          },
          effectiveBackgroundHex: '#22242A',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [
            {
              id: 'product-img',
              tag: 'img',
              cleanClasses: [],
              omittedHashedClassCount: 0,
              imgAlt: 'T-Force Delta RGB DDR5 RAM',
              rect,
              styles: { display: 'block', position: 'static', width: '224px', height: '188px' },
              effectiveBackgroundHex: '#22242A',
              hasNonSolidBackgroundAncestor: false,
              pseudoElements: [],
              children: [],
            },
            {
              id: 'host-badge',
              tag: 'span',
              cleanClasses: ['img-dims-pill'],
              omittedHashedClassCount: 0,
              textSnippet: '1000 × 840',
              rect: { x: 8, y: 162, width: 72, height: 18 },
              styles: {
                display: 'inline-flex',
                position: 'absolute',
                width: '72px',
                height: '18px',
                color: 'rgb(232, 234, 237)',
                fontFamily: '"Google Sans", Arial, sans-serif',
                fontSize: '11px',
                fontWeight: '500',
              },
              effectiveBackgroundHex: '#22242A',
              hasNonSolidBackgroundAncestor: false,
              pseudoElements: [],
              children: [],
            },
          ],
        },
      ],
      cssVariables: [],
      pageFallbackTypography: [
        {
          primaryFont: 'Google Sans',
          fontStack: '"Google Sans", Arial, sans-serif',
          fontSizePx: 14,
          fontWeight: 700,
          lineHeightPx: 18,
          lineHeightRatio: 1.28,
          letterSpacing: '0em',
          role: 'heading',
          sampleText: 'Google Images',
          usageCount: 1,
        },
      ],
    };

    const sampledColors = [
      { hex: '#F7F7F7', rgb: [247, 247, 247] as [number, number, number], percentage: 36 },
      { hex: '#15151B', rgb: [21, 21, 27] as [number, number, number], percentage: 28 },
      { hex: '#E53935', rgb: [229, 57, 53] as [number, number, number], percentage: 9 },
    ];

    // Real analyzeDesignDNA() produces exact-dom #22242A BEFORE sampled-pixels #F7F7F7!
    const dna = analyzeDesignDNA(dom, sampledColors, rect);
    expect(dna.palette[0]?.provenance).toBe('exact-dom');
    expect(dna.palette[0]?.hex).toBe('#22242A');
    expect(dna.palette.some((c) => c.provenance === 'sampled-pixels' && c.hex === '#F7F7F7')).toBe(
      true
    );

    const realRecord: CaptureRecord = {
      id: 'real-gimg-ram',
      createdAt: 1763700000000,
      page: {
        url: 'https://www.google.com/search?q=rgb+ram',
        hostname: 'www.google.com',
        title: 'rgb ram - Google Search',
      },
      rect,
      viewport: { width: 1440, height: 900, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
      captureMode: dom.captureMode,
      containsGraphicArtwork: dom.containsGraphicArtwork,
      graphicArtworkNote: dom.graphicArtworkNote,
      selectionMethod: dom.selectionMethod,
      totalNodesScanned: dom.totalNodesScanned,
      truncated: dom.truncated,
      screenshotBlob: new Blob(['png'], { type: 'image/png' }),
      screenshotWidth: rect.width * 2,
      screenshotHeight: rect.height * 2,
      roots: dom.roots,
      dna,
    };

    const fullPrompt = generateCompleteAgentPrompt(realRecord, 'The Real Og', 'en');
    const textPrompt = generateIsolatedTextImagePrompt(realRecord, 'The Real Og', 'en');
    const bgPrompt = generateCleanBackgroundImagePrompt(realRecord, 'en');

    // #F7F7F7 sampled pixels MUST win over #22242A exact-dom host container across ALL 3 prompts!
    expect(fullPrompt).toContain('backdrop #F7F7F7');
    expect(fullPrompt).not.toContain('#22242A');
    expect(textPrompt).not.toContain('#22242A');
    expect(bgPrompt).toContain('base backdrop `#F7F7F7`');
    expect(bgPrompt).not.toContain('#22242A');

    // Stray 1-node Google Sans badge & pageFallbackTypography MUST NOT leak into ANY prompt!
    expect(fullPrompt).not.toContain('Google Sans');
    expect(textPrompt).not.toContain('Google Sans');
    expect(bgPrompt).not.toContain('Google Sans');

    // Isolated text prompt qualifies sampled tone for white/silver metallic lettering on dark heatsinks!
    expect(textPrompt).toContain(
      'highest-contrast sampled tone — match the exact foreground lettering color, silver/white sheen, or gradient directly from the attached photo'
    );

    const score = evaluatePromptConsistencySuite(realRecord, 'The Real Og', 'en');
    expect(score.issues).toEqual([]);
    expect(score.totalScore).toBe(100);
    expect(score.passedThreshold).toBe(true);
  });

  it('closes all 4 runtime compliance blind spots (<svg fill="none"> child dark fill, bare transparent bypass, compact ZM subpaths, and blocky photo polygon trace)', () => {
    // Blind spot A + B: <svg fill="none"><path fill="#111111" /></svg> with ONLY bare "transparent" (no Exact Text (AI)) MUST FAIL!
    const darkChildFillReply = `
\`\`\`text
┌──[ 01 · STYLELENS PACKAGE // 01001010 ]──────────────┐
│  TARGET  : Bigger
└──[ 10110 · READY FOR EXPORT ]────────────────────────┘
\`\`\`
### 01 // Full Composite
Rendered Bigger composite above.
### 02 // Isolated Wordmark
On a transparent background:
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" width="220" height="64" viewBox="0 0 220 64" fill="none">
  <path d="M10 10 H28 V54 H10 Z" fill="#111111" />
  <path d="M50 10 H68 V54 H50 Z" fill="#111111" />
</svg>
\`\`\`
### 03 // Clean Background Layer
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="84" viewBox="0 0 320 84">
  <rect x="0" y="0" width="320" height="84" rx="16" fill="#FFFFFF" />
</svg>
\`\`\`
### 04 // Quick 1-2-3 How To Use
1. Save image. 2. Copy SVG. 3. Copy BG.
`;
    const darkChildScore = scoreAiChatOutputCompliance(darkChildFillReply, 'Bigger', true);
    expect(darkChildScore.passedThreshold).toBe(false);
    expect(darkChildScore.defects.some((d) => d.includes('Dark fill #111111'))).toBe(true);

    // Blind spot C: Compact single-path "ZM" subpaths MUST be counted accurately and PASS!
    const compactPathReply = `
\`\`\`text
┌──[ 01 · STYLELENS PACKAGE // 01001010 ]──────────────┐
│  TARGET  : Test
└──[ 10110 · READY FOR EXPORT ]────────────────────────┘
\`\`\`
### 01 // Full Composite
Rendered Test composite above.
### 02 // Isolated Wordmark
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" width="220" height="64" viewBox="0 0 220 64">
  <path d="M10 10H40V20H28V54H20V20H10ZM50 10H80V20H60V28H76V36H60V44H80V54H50ZM90 10H120V20H100V28H120V54H90V44H110V36H90ZM130 10H160V20H148V54H140V20H130Z" fill="#FFFFFF" />
</svg>
\`\`\`
### 03 // Clean Background Layer
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="84" viewBox="0 0 320 84">
  <rect x="0" y="0" width="320" height="84" rx="16" fill="#111111" />
</svg>
\`\`\`
### 04 // Quick 1-2-3 How To Use
1. Save Test image. 2. Paste SVG into Figma. 3. Reuse background SVG.
`;
    const compactScore = scoreAiChatOutputCompliance(compactPathReply, 'Test', true);
    expect(compactScore.defects).toEqual([]);
    expect(compactScore.score).toBe(100);
    expect(compactScore.passedThreshold).toBe(true);

    // Blind spot D: "The Real Og" blocky multi-polygon RAM SVG failure under isPhotographicOrArtwork = true MUST FAIL!
    const blockyRamPhotoReply = `
\`\`\`text
┌──[ 01 · STYLELENS PACKAGE // 01001010 ]──────────────┐
│  TARGET  : The Real Og
└──[ 10110 · READY FOR EXPORT ]────────────────────────┘
\`\`\`
### 01 // Full Composite
Rendered The Real Og on both DDR5 RAM modules.
### 02 // Isolated Wordmark
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" width="280" height="64" viewBox="0 0 280 64">
  <path d="M10 12 H44 V20 H30 V52 H22 V20 H10 Z" fill="#FFFFFF" />
  <path d="M52 12 H60 V28 H76 V12 H84 V52 H76 V36 H60 V52 H52 Z" fill="#FFFFFF" />
</svg>
\`\`\`
### 03 // Clean Background Layer
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" width="224" height="188" viewBox="0 0 224 188">
  <rect x="0" y="0" width="224" height="188" fill="#F7F7F7" />
  <polygon points="10,20 70,10 112,24 154,10 214,20 206,82 18,82" fill="#15151B" />
  <polygon points="10,106 70,96 112,110 154,96 214,106 206,168 18,168" fill="#15151B" />
</svg>
\`\`\`
### 04 // Quick 1-2-3 How To Use
1. Save Layer 1 image. 2. Copy Layer 2 SVG. 3. Download Layer 3 SVG.
`;
    const blockyScore = scoreAiChatOutputCompliance(blockyRamPhotoReply, 'The Real Og', true, true);
    expect(blockyScore.passedThreshold).toBe(false);
    expect(blockyScore.defects.some((d) => d.includes('blocky polygonal SVG trace'))).toBe(true);
    expect(blockyScore.defects.some((d) => d.includes('omitted Clean BG (AI) guidance'))).toBe(true);

    // Clean photographic Swatch Card + Clean BG (AI) guidance MUST PASS 100/100!
    const cleanPhotoSwatchReply = `
\`\`\`text
┌──[ 01 · STYLELENS PACKAGE // 01001010 ]──────────────┐
│  TARGET  : The Real Og
└──[ 10110 · READY FOR EXPORT ]────────────────────────┘
\`\`\`
### 01 // Full Composite
Rendered The Real Og on both DDR5 RAM modules.
### 02 // Isolated Wordmark
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" width="280" height="64" viewBox="0 0 280 64">
  <path d="M10 12 H44 V20 H30 V52 H22 V20 H10 Z" fill="#FFFFFF" />
  <path d="M52 12 H60 V28 H76 V12 H84 V52 H76 V36 H60 V52 H52 Z" fill="#FFFFFF" />
</svg>
\`\`\`
### 03 // Clean Background Layer
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" width="224" height="188" viewBox="0 0 224 188">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F7F7F7" />
      <stop offset="100%" stop-color="#E9E7ED" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="224" height="188" rx="16" fill="url(#bg)" />
  <rect x="12" y="12" width="200" height="164" rx="12" fill="none" stroke="#15151B" stroke-opacity="0.12" />
  <circle cx="44" cy="148" r="10" fill="#F7F7F7" stroke="#15151B" stroke-opacity="0.2" />
  <circle cx="72" cy="148" r="10" fill="#15151B" />
  <circle cx="100" cy="148" r="10" fill="#E53935" />
</svg>
\`\`\`
### 04 // Quick 1-2-3 How To Use
1. Save the The Real Og Layer 1 composite image.
2. Paste Layer 2 SVG into Figma/Canva (or click Exact Text (AI) in StyleLens).
3. Use Layer 3 Swatch Card (or click Clean BG (AI) in StyleLens for the photorealistic text-erased photo).
`;
    const cleanPhotoScore = scoreAiChatOutputCompliance(
      cleanPhotoSwatchReply,
      'The Real Og',
      true,
      true
    );
    expect(cleanPhotoScore.defects).toEqual([]);
    expect(cleanPhotoScore.score).toBe(100);
    expect(cleanPhotoScore.passedThreshold).toBe(true);
  });
});
