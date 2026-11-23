import { describe, expect, it, vi } from 'vitest';
import type { CaptureRecord, RawDomExtraction } from '../../types/capture';
import type { ChatProbeResponse, ChatSubmitResponse, PasteToChatResponse } from '../../types/messages';
import { buildLocalAssetKit } from '../assetKitExporter';
import {
  COMPOSITE_PROMPT_MAX_CHARS,
  buildBackgroundOnlyImagePrompt,
  buildCompositeImagePrompt,
  guessPictureText,
  buildSeparateExistingImageSteps,
  buildTextOnlyImagePrompt,
  buildThreeImageSteps,
} from '../chatImagePrompts';
import { analyzeDesignDNA } from '../designAnalyzer';
import { evaluateChatThreeImageSuite } from '../promptConsistencyScorer';
import { generateCssTokens, generateIsolatedTextImagePrompt } from '../specGenerator';
import { getTranslations } from '../../sidepanel/i18n/translations';
import { classifyActiveChatUrl, isGrokChatUrl } from '../../sidepanel/utils/chatSender';
import { slugifyFilenamePart } from '../../sidepanel/utils/download';
import {
  runThreeImageSequence,
  type StepPhase,
  type ThreeImageRunTiming,
} from '../../sidepanel/utils/threeImageRun';

function makeCapture(opts: {
  hostname?: string;
  containsGraphicArtwork: boolean;
  fontName?: string;
  sampleText?: string;
  textColorRgb?: string;
}): CaptureRecord {
  const rect = { x: 0, y: 0, width: 320, height: 180 };
  const dom: RawDomExtraction = opts.containsGraphicArtwork
    ? {
        captureMode: 'dom-and-visual',
        selectionMethod: 'marquee',
        containsGraphicArtwork: true,
        totalNodesScanned: 2,
        truncated: false,
        roots: [
          {
            id: 'r1',
            tag: 'div',
            cleanClasses: [],
            omittedHashedClassCount: 0,
            rect,
            styles: {
              display: 'block',
              position: 'relative',
              width: '320px',
              height: '180px',
              backgroundColor: 'rgb(34, 36, 42)',
            },
            effectiveBackgroundHex: '#22242A',
            hasNonSolidBackgroundAncestor: false,
            pseudoElements: [],
            children: [
              {
                id: 'img1',
                tag: 'img',
                cleanClasses: [],
                omittedHashedClassCount: 0,
                imgAlt: 'University Crest',
                rect,
                styles: { display: 'block', position: 'static', width: '320px', height: '180px' },
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
            sampleText: 'Google',
            usageCount: 1,
          },
        ],
        fontFaceRules: [
          '@font-face { font-family: "Google Sans"; src: url("data:font/woff2;base64,AAA") format("woff2"); }',
        ],
      }
    : {
        captureMode: 'dom-and-visual',
        selectionMethod: 'marquee',
        containsGraphicArtwork: false,
        totalNodesScanned: 2,
        truncated: false,
        roots: [
          {
            id: 'r1',
            tag: 'header',
            cleanClasses: ['brand'],
            omittedHashedClassCount: 0,
            textSnippet: opts.sampleText ?? 'Western',
            rect,
            styles: {
              display: 'flex',
              position: 'relative',
              width: '320px',
              height: '180px',
              backgroundColor: 'rgb(255, 255, 255)',
              color: opts.textColorRgb ?? 'rgb(79, 38, 131)',
              fontFamily: `"${opts.fontName ?? 'Georgia'}", serif`,
              fontSize: '36px',
              fontWeight: '700',
            },
            effectiveBackgroundHex: '#FFFFFF',
            hasNonSolidBackgroundAncestor: false,
            pseudoElements: [],
            children: [],
          },
        ],
        cssVariables: [],
      };

  const sampled = [
    { hex: '#FFFFFF', rgb: [255, 255, 255] as [number, number, number], percentage: 60 },
    { hex: '#4F2683', rgb: [79, 38, 131] as [number, number, number], percentage: 30 },
  ];

  const dna = analyzeDesignDNA(dom, sampled, rect);

  return {
    id: 'test-cap-1',
    createdAt: 1763700000000,
    page: {
      url: `https://${opts.hostname ?? 'www.google.com'}`,
      hostname: opts.hostname ?? 'www.google.com',
      title: 'Test',
    },
    rect,
    viewport: { width: 1440, height: 900, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    captureMode: dom.captureMode,
    containsGraphicArtwork: dom.containsGraphicArtwork,
    selectionMethod: 'marquee',
    totalNodesScanned: dom.totalNodesScanned,
    truncated: false,
    screenshotBlob: new Blob(['png'], { type: 'image/png' }),
    screenshotWidth: 640,
    screenshotHeight: 360,
    roots: dom.roots,
    dna,
  };
}

const FAST_TIMING: ThreeImageRunTiming = {
  pollMs: 1000,
  postSendSettleMs: 1500,
  minReplyMsWithImage: 3500,
  quietMsAfterImage: 2000,
  minReplyMsNoImage: 18000,
  quietMsNoImage: 8000,
  minReplyMsNoStopSeen: 28000,
  quietMsNoStopSeen: 8000,
  maxReplyMs: 120000,
  manualSendMs: 10000,
  betweenStepsMs: 3000,
};

describe('3-Image Chained Master-Image Separation Prompts, Host Routing, Preview Isolation & Runner', () => {
  it('builds clash-free Master-Image separation prompts across master-attached, master-thread, and original-attached modes with zero checkerboard/trademark/pink-elephant bait', () => {
    const photoRecord = makeCapture({ containsGraphicArtwork: true });

    // Primary chained Master-Image separation mode ('master-attached')
    const masterSteps = buildThreeImageSteps(photoRecord, 'Rots', 'en', {
      sourceMode: 'master-attached',
    });
    expect(masterSteps.map((s) => s.id)).toEqual(['composite', 'text-only', 'background-only']);

    for (const step of masterSteps) {
      expect(step.prompt).toMatch(/^(?:Create 1|Edit the attached image)\b/i);
      expect(step.prompt.length).toBeLessThan(step.id === 'composite' ? COMPOSITE_PROMPT_MAX_CHARS : 980);
      expect(step.prompt).not.toMatch(
        /WRITE TEXT FIRST|STYLELENS PACKAGE|Swatch Card|\btrademark\b|brand\/school|\bmascot\b|bitten Apple|Dollar Tree|\btransparent\b|\bcheckerboard\b|\bPNG\b|\bcutout\b|\bArial\b|\bSVG\b|\bHTML\b|no code|\bgibberish\b/i
      );
      expect(step.prompt).not.toContain('Google Sans');
      // Only the X-Ray Style DNA telemetry line may contain extracted palette hex anchors;
      // the rest of the prompt (including Step 2 backdrop rules & Step 3) must remain 100% hex-free!
      const bodyWithoutXray = step.prompt.replace(/^X-Ray Style DNA \([^)]*\):[^\n]+$/gm, '');
      expect(bodyWithoutXray).not.toMatch(/#[0-9A-Fa-f]{6}/);
    }

    // Step 1: Includes authentic X-Ray Style DNA telemetry (sampled palette, polarity, dimensions)
    expect(masterSteps[0]!.prompt).toContain('X-Ray Style DNA');
    expect(masterSteps[0]!.prompt).toContain('320×180px');
    expect(masterSteps[0]!.prompt).not.toContain('#22242A'); // Never leaks un-sampled Google Images container hex!

    // Step 1: Positive meaning-isolation anti-brand-substitution
    expect(masterSteps[0]!.prompt).toContain('Rots');
    expect(masterSteps[0]!.prompt).toContain('without changing the artwork');

    // Step 1: Style-fidelity guard (Budweiser -> "Left" came back with an extra white keyline and
    // oversized lettering): edges and letter size must be pinned to the original lettering.
    expect(masterSteps[0]!.prompt).toContain('keep any outline, shadow or glow it has; add none it lacks');
    expect(masterSteps[0]!.prompt).toContain('at the same letter height and position');
    const zhComposite = buildThreeImageSteps(photoRecord, 'Rots', 'zh-CN', {
      sourceMode: 'master-attached',
    })[0]!.prompt;
    expect(zhComposite).toContain('原本没有的一律不要添加');
    expect(zhComposite).toContain('相同的字高和位置');

    // Measured proportions of the original lettering are added, and the prompt stays < 980 chars
    const measured = buildCompositeImagePrompt(photoRecord, 'Made it', 'en', {
      letterHeightFrac: 0.2,
      wordWidthFrac: 0.64,
      centreX: 0.5,
      centreY: 0.56,
      letterAspect: 1.0,
      strokeRatio: 0.25,
      spacingRatio: 0.14,
      letterCount: 5,
      cornerFill: 0.8,
      heightSpread: 0.02,
    });
    // Detailed lettering instructions: no default font, copy shared letters, measured shapes
    expect(measured).toContain('custom logotype, not a standard font');
    expect(measured).toContain('do not substitute any common or generic typeface');
    expect(measured).toContain('Read the existing word in the picture letter by letter');
    expect(measured).toContain('copied exactly from the picture');
    expect(measured).toContain('heavy strokes');
    expect(measured).toContain('squarish curves shaped like rounded rectangles');
    expect(measured).toContain('every letter exactly the same height');
    expect(measured).toContain('about 20% of the picture height');
    expect(measured.length).toBeLessThan(COMPOSITE_PROMPT_MAX_CHARS);
    expect(measured).not.toMatch(/```/);

    // Picture captures: the user-confirmed original word lets the prompt name the shared letters
    const crave = buildCompositeImagePrompt(
      photoRecord,
      'clanker',
      'en',
      {
        letterHeightFrac: 0.2,
        wordWidthFrac: 0.64,
        centreX: 0.5,
        centreY: 0.56,
        letterAspect: 1.0,
        strokeRatio: 0.25,
        spacingRatio: 0.14,
        letterCount: 5,
        cornerFill: 0.8,
        heightSpread: 0.02,
      },
      'crave'
    );
    expect(crave).toContain('Replace the words "crave" with "clanker"');
    expect(crave).toContain('The letters c, a, e, r appear in both words');
    expect(crave).toContain('The other letters (l, n, k) are new');
    expect(crave).toContain('(c-l-a-n-k-e-r)');
    expect(crave.length).toBeLessThan(COMPOSITE_PROMPT_MAX_CHARS);
    expect(crave).not.toMatch(/\bArial\b|\bHelvetica\b|\bGotham\b|\bMontserrat\b/);

    // A Google Images alt text gives a starting guess for what the picture says
    expect(
      guessPictureText({
        roots: [
          { tag: 'div', children: [{ tag: 'img', imgAlt: 'Crave logo - Wikipedia', children: [] }] },
        ] as never,
      })
    ).toBe('Crave');
    // Step 2: Extracts existing lettering from Master Image with 3-tier outer-edge + combined-outline neutral-gray backdrop rule
    expect(masterSteps[1]!.prompt).toMatch(/without redesigning/i);
    expect(masterSteps[1]!.prompt).toContain('solid pure white background');
    expect(masterSteps[1]!.prompt).toContain('solid pure black background');
    expect(masterSteps[1]!.prompt).toContain('solid medium neutral gray background');
    // Step 3: Pixel-locked clean background removing "Rots" without regenerating scene!
    expect(masterSteps[2]!.prompt).toContain('remove the text "Rots"');
    expect(masterSteps[2]!.prompt).toMatch(/Do not regenerate/i);

    for (const mode of ['master-attached', 'master-thread', 'original-attached'] as const) {
      const enSuite = evaluateChatThreeImageSuite(photoRecord, 'Apple', 'en', mode);
      expect(enSuite.issues).toEqual([]);
      expect(enSuite.score).toBe(100);
      expect(enSuite.passedThreshold).toBe(true);

      const zhSuite = evaluateChatThreeImageSuite(photoRecord, '苹果', 'zh-CN', mode);
      expect(zhSuite.issues).toEqual([]);
      expect(zhSuite.score).toBe(100);
      expect(zhSuite.passedThreshold).toBe(true);
    }

    // Separate Existing Chat Image helper (2 steps only, zero Step 1 regeneration!)
    const existingSteps = buildSeparateExistingImageSteps(photoRecord, 'Rots', 'en', 'master-attached');
    expect(existingSteps.map((s) => s.id)).toEqual(['text-only', 'background-only']);
    expect(existingSteps[0]!.prompt).toContain('Edit the attached image');
    expect(existingSteps[1]!.prompt).toContain('remove the text "Rots"');

    // In existing-chat master-thread fallback, references "latest full composite picture you generated above" (not "first reply")
    const existingThread = buildSeparateExistingImageSteps(photoRecord, 'Rots', 'en', 'master-thread');
    expect(existingThread[1]!.prompt).toContain('latest full composite picture you generated above');
    expect(existingThread[1]!.prompt).not.toMatch(/attached image/i);
  });

  it('uses deterministic single backdrop on standalone live DOM exact-text captures, handles empty word safely, and achieves 100% EN/zh-CN translation parity', () => {
    const darkInkDom = makeCapture({
      hostname: 'uwo.ca',
      containsGraphicArtwork: false,
      fontName: 'Georgia',
      sampleText: 'Western',
      textColorRgb: 'rgb(79, 38, 131)',
    });

    const composite = buildCompositeImagePrompt(darkInkDom, 'Brock', 'en');
    expect(composite).toContain('Replace the words "Western" with "Brock"');
    expect(composite).toContain('Georgia, weight 700');

    const textOnlyDarkInk = buildTextOnlyImagePrompt(darkInkDom, 'Brock', 'en', {
      sourceMode: 'original-attached',
    });
    expect(textOnlyDarkInk).toContain('solid pure white background');
    expect(textOnlyDarkInk).not.toContain('solid pure black');

    const lightInkDom = makeCapture({
      hostname: 'linear.app',
      containsGraphicArtwork: false,
      fontName: 'Inter',
      sampleText: 'Linear',
      textColorRgb: 'rgb(245, 245, 247)',
    });
    const textOnlyLightInk = buildTextOnlyImagePrompt(lightInkDom, 'Brock', 'en', {
      sourceMode: 'original-attached',
    });
    expect(textOnlyLightInk).toContain('solid pure black background');
    expect(textOnlyLightInk).not.toContain('solid pure white');

    const bgOnly = buildBackgroundOnlyImagePrompt(darkInkDom, 'en');
    expect(bgOnly).toContain('(including "Western")');

    expect(buildCompositeImagePrompt(darkInkDom, '', 'en')).not.toContain('""');
    expect(buildTextOnlyImagePrompt(darkInkDom, '', 'en')).not.toContain('""');

    const zhSuite = evaluateChatThreeImageSuite(darkInkDom, '苹果', 'zh-CN', 'original-attached');
    expect(zhSuite.issues).toEqual([]);
    expect(zhSuite.score).toBe(100);
    expect(zhSuite.passedThreshold).toBe(true);

    // Strict EN / zh-CN UI translation key parity + Unicode filename slugs
    const enKeys = Object.keys(getTranslations('en')).sort();
    const zhKeys = Object.keys(getTranslations('zh-CN')).sort();
    expect(zhKeys).toEqual(enKeys);
    expect(slugifyFilenamePart('Rots')).toBe('rots');
    expect(slugifyFilenamePart('苹果 品牌')).toBe('苹果-品牌');
  });

  it('suppresses GOOGLE SANS · EXACT FONT and preserves exact typed casing ("Apple") in Step 2 preview on Google Images captures', () => {
    const googleLogo = makeCapture({ hostname: 'www.google.com', containsGraphicArtwork: true });
    const kit = buildLocalAssetKit(googleLogo, 'Apple');
    expect(kit.profile.displayWord).toBe('Apple'); // Never forced to "APPLE"!
    expect(kit.profile.isArtworkStyleMatch).toBe(true);
    expect(kit.profile.headingFontClean).toBe('Image Style');
    expect(kit.profile.hasEmbeddedFont).toBe(false);
    expect(kit.liveCompositeHtml).toContain('IMAGE STYLE · MATCHED BY AI');
    expect(kit.liveCompositeHtml).not.toContain('Google Sans');
    expect(kit.liveCompositeHtml).not.toContain('GOOGLE SANS');

    // Loose marquee grazing 2 tiny Google Sans captions alongside a large <img> (containsGraphicArtwork: false)
    const rect = { x: 0, y: 0, width: 320, height: 240 };
    const looseGoogleDom: RawDomExtraction = {
      captureMode: 'dom-and-visual',
      selectionMethod: 'marquee',
      containsGraphicArtwork: false,
      totalNodesScanned: 4,
      truncated: false,
      roots: [
        {
          id: 'g-card',
          tag: 'div',
          cleanClasses: [],
          omittedHashedClassCount: 0,
          rect,
          styles: { display: 'block', position: 'relative', width: '320px', height: '240px' },
          effectiveBackgroundHex: '#202124',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [
            {
              id: 'g-img',
              tag: 'img',
              cleanClasses: [],
              omittedHashedClassCount: 0,
              rect: { x: 0, y: 0, width: 300, height: 190 },
              styles: { display: 'block', position: 'static', width: '300px', height: '190px' },
              effectiveBackgroundHex: '#202124',
              hasNonSolidBackgroundAncestor: false,
              pseudoElements: [],
              children: [],
            },
            {
              id: 'g-cap-1',
              tag: 'span',
              cleanClasses: [],
              omittedHashedClassCount: 0,
              textSnippet: 'Stinger Logo',
              rect: { x: 0, y: 196, width: 180, height: 18 },
              styles: {
                display: 'block',
                position: 'static',
                width: '180px',
                height: '18px',
                fontFamily: '"Google Sans", Arial, sans-serif',
                fontSize: '13px',
                fontWeight: '500',
              },
              effectiveBackgroundHex: '#202124',
              hasNonSolidBackgroundAncestor: false,
              pseudoElements: [],
              children: [],
            },
            {
              id: 'g-cap-2',
              tag: 'span',
              cleanClasses: [],
              omittedHashedClassCount: 0,
              textSnippet: 'stingers.ca',
              rect: { x: 0, y: 218, width: 80, height: 14 },
              styles: {
                display: 'block',
                position: 'static',
                width: '80px',
                height: '14px',
                fontFamily: '"Google Sans", Arial, sans-serif',
                fontSize: '11px',
                fontWeight: '400',
              },
              effectiveBackgroundHex: '#202124',
              hasNonSolidBackgroundAncestor: false,
              pseudoElements: [],
              children: [],
            },
          ],
        },
      ],
      cssVariables: [],
    };
    const looseRecord: CaptureRecord = {
      ...googleLogo,
      containsGraphicArtwork: false,
      rect,
      roots: looseGoogleDom.roots,
      dna: analyzeDesignDNA(looseGoogleDom, [], rect),
    };
    const looseKit = buildLocalAssetKit(looseRecord, 'Apple');
    expect(looseKit.liveCompositeHtml).not.toContain('Google Sans');
    expect(looseKit.liveCompositeHtml).toContain('IMAGE STYLE · MATCHED BY AI');
    for (const s of buildThreeImageSteps(looseRecord, 'Apple', 'en')) {
      expect(s.prompt).not.toContain('Google Sans');
      expect(s.prompt).not.toContain('Stinger Logo');
    }

    // Padded marquee on www.google.com where the logo <img> is only 20% of the box (< 45%) + grazed Google Sans label
    // (e.g. "Alibaba" -> "Ali way")
    const paddedGoogleDom: RawDomExtraction = {
      ...looseGoogleDom,
      roots: [
        {
          ...looseGoogleDom.roots[0]!,
          children: [
            {
              ...looseGoogleDom.roots[0]!.children[0]!,
              rect: { x: 0, y: 0, width: 120, height: 110 }, // ~17% of 320x240 marquee
            },
            looseGoogleDom.roots[0]!.children[1]!,
          ],
        },
      ],
    };
    const paddedGoogleRecord: CaptureRecord = {
      ...looseRecord,
      roots: paddedGoogleDom.roots,
      dna: analyzeDesignDNA(paddedGoogleDom, [], rect),
    };
    const paddedKit = buildLocalAssetKit(paddedGoogleRecord, 'Ali way');
    expect(paddedKit.liveCompositeHtml).toContain('IMAGE STYLE · MATCHED BY AI');
    expect(paddedKit.liveCompositeHtml).not.toContain('Google Sans');
    expect(paddedKit.liveCompositeHtml).not.toContain('GOOGLE SANS');
  });

  it('classifies AI hosts accurately at 0ms pre-flight (Image AI vs Text/Code AI vs Non-AI)', () => {
    expect(classifyActiveChatUrl('https://gemini.google.com/app').kind).toBe('image-ai');
    expect(classifyActiveChatUrl('https://chatgpt.com/').kind).toBe('image-ai');
    expect(classifyActiveChatUrl('https://grok.com/').kind).toBe('image-ai');
    expect(classifyActiveChatUrl('https://x.com/i/grok').kind).toBe('image-ai');
    expect(classifyActiveChatUrl('https://chat.qwen.ai/').kind).toBe('image-ai');
    expect(classifyActiveChatUrl('https://qwenlm.ai/').kind).toBe('image-ai');
    expect(classifyActiveChatUrl('https://qianwen.com/').kind).toBe('image-ai');

    expect(isGrokChatUrl('https://grok.com/')).toBe(true);
    expect(isGrokChatUrl('https://x.com/i/grok')).toBe(true);
    expect(isGrokChatUrl('https://x.com/home')).toBe(false);
    expect(isGrokChatUrl('https://gemini.google.com/app')).toBe(false);

    expect(classifyActiveChatUrl('https://claude.ai/new')).toMatchObject({
      kind: 'text-only-ai',
      label: 'Claude',
    });
    expect(classifyActiveChatUrl('https://chat.deepseek.com/')).toMatchObject({
      kind: 'text-only-ai',
      label: 'DeepSeek',
    });
    expect(classifyActiveChatUrl('https://kimi.moonshot.cn/').kind).toBe('text-only-ai');
    expect(classifyActiveChatUrl('https://www.perplexity.ai/').kind).toBe('text-only-ai');

    expect(classifyActiveChatUrl('https://www.google.com/search?q=logo').kind).toBe('non-ai');
    expect(classifyActiveChatUrl('https://x.com/home').kind).toBe('non-ai');
    expect(classifyActiveChatUrl('chrome://extensions').kind).toBe('non-ai');
  });

  it('runs all 3 steps sequentially on locked tabId, absorbs user uploads at 1500ms settle, and detects real rendered images cleanly', async () => {
    const record = makeCapture({ containsGraphicArtwork: true });
    const steps = buildThreeImageSteps(record, 'Brock', 'en');

    let clock = 0;
    let currentLargeImages = 0;
    let stepStartedAt = 0;
    let activeStepIdx = -1;
    let stepSubmitted = false;
    const pasteCalls: Array<{ prompt: string; tabId?: number; requireImage?: boolean }> = [];
    const progressLog: Array<{ i: number; phase: StepPhase }> = [];

    const outcome = await runThreeImageSequence(
      steps,
      {
        requireImage: true,
        paste: async (prompt, tabId, requireImage): Promise<PasteToChatResponse> => {
          pasteCalls.push({ prompt, tabId, requireImage });
          activeStepIdx += 1;
          stepSubmitted = false;
          return {
            ok: true,
            insertedImage: true,
            insertedPrompt: true,
            tabId: 42,
            hostname: 'gemini.google.com',
          };
        },
        submit: async (tabId): Promise<ChatSubmitResponse> => {
          expect(tabId).toBe(42);
          stepStartedAt = clock;
          stepSubmitted = true;
          return { ok: true, method: 'button' };
        },
        probe: async (): Promise<ChatProbeResponse> => {
          if (!stepSubmitted) {
            return {
              ok: true,
              generating: false,
              quietMs: 5000,
              composerEmpty: false,
              largeImageCount: currentLargeImages,
            };
          }
          const sinceSend = clock - stepStartedAt;
          if (activeStepIdx === 0) {
            if (sinceSend >= 4000) currentLargeImages = Math.max(currentLargeImages, 1);
            return {
              ok: true,
              generating: sinceSend < 4000,
              quietMs: sinceSend < 4000 ? 0 : sinceSend - 4000,
              composerEmpty: true,
              largeImageCount: currentLargeImages,
            };
          }
          if (activeStepIdx === 1) {
            // No Stop button ever shown, user upload bubble appears at 800ms (absorbed by 1500ms settle!),
            // real AI image renders at 18s -> must wait for the real AI image!
            const withUserBubble = sinceSend >= 800 ? 2 : 1;
            if (sinceSend >= 18000) currentLargeImages = Math.max(currentLargeImages, 3);
            return {
              ok: true,
              generating: false,
              quietMs: sinceSend < 18000 ? sinceSend : sinceSend - 18000,
              composerEmpty: true,
              largeImageCount: Math.max(currentLargeImages, withUserBubble),
            };
          }
          if (sinceSend >= 5000) currentLargeImages = Math.max(currentLargeImages, 4);
          return {
            ok: true,
            generating: sinceSend < 5000,
            quietMs: sinceSend < 5000 ? 0 : sinceSend - 5000,
            composerEmpty: true,
            largeImageCount: currentLargeImages,
          };
        },
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
        isCancelled: () => false,
        onProgress: (i, phase) => {
          progressLog.push({ i, phase });
        },
      },
      FAST_TIMING
    );

    expect(outcome).toEqual({ status: 'complete', imagesProduced: 3 });
    expect(pasteCalls).toHaveLength(3);
    expect(pasteCalls.every((c) => c.requireImage === true)).toBe(true);
    expect(pasteCalls[0]!.tabId).toBeUndefined();
    expect(pasteCalls[1]!.tabId).toBe(42);
    expect(pasteCalls[2]!.tabId).toBe(42);
    expect(progressLog.filter((p) => p.phase === 'done').map((p) => p.i)).toEqual([0, 1, 2]);
  });

  it('enforces atomic IMAGE_NOT_ATTACHED failure (never misreported as no-chat), Step 1 circuit breaker, patient sawStop no-image wait, TIMEOUT, manual send, and cancel', async () => {
    const record = makeCapture({ containsGraphicArtwork: true });
    const steps = buildThreeImageSteps(record, 'McMaster', 'en');

    // 1. Atomic IMAGE_NOT_ATTACHED at Step 0 MUST return 'failed' (NOT 'no-chat'!)
    const attachBlocked = await runThreeImageSequence(
      steps,
      {
        requireImage: true,
        paste: async () => ({
          ok: false,
          insertedImage: false,
          insertedPrompt: false,
          reason: 'IMAGE_NOT_ATTACHED',
          hostname: 'grok.com',
        }),
        submit: async () => ({ ok: false }),
        probe: async () => ({ ok: false, generating: false, quietMs: 0, composerEmpty: false }),
        sleep: async () => {},
        now: () => 0,
        isCancelled: () => false,
        onProgress: vi.fn(),
      },
      FAST_TIMING
    );
    expect(attachBlocked).toEqual({
      status: 'failed',
      stepIndex: 0,
      reason: 'IMAGE_NOT_ATTACHED',
    });

    // 2. Step 1 circuit breaker: if Step 0 finishes with 0 images (even after sawStop!), MUST wait >= minReplyMsNoImage (18s) AND pause cleanly instead of trampling Steps 2 & 3!
    let breakerClock = 0;
    let sendAt = 0;
    let pasteCount = 0;
    const breakerPhases: Array<{ i: number; phase: StepPhase }> = [];
    const breakerOutcome = await runThreeImageSequence(
      steps,
      {
        requireImage: true,
        paste: async () => {
          pasteCount += 1;
          return { ok: true, insertedImage: true, insertedPrompt: true, tabId: 11 };
        },
        submit: async () => {
          sendAt = breakerClock;
          return { ok: true, method: 'button' };
        },
        probe: async () => {
          const since = breakerClock - sendAt;
          return {
            ok: true,
            generating: since < 2000, // simulates brief Stop/spinner flash!
            quietMs: since < 2000 ? 0 : since - 2000,
            composerEmpty: true,
            largeImageCount: 0,
          };
        },
        sleep: async (ms) => {
          breakerClock += ms;
        },
        now: () => breakerClock,
        isCancelled: () => false,
        onProgress: (i, phase) => breakerPhases.push({ i, phase }),
      },
      FAST_TIMING
    );
    expect(breakerOutcome).toEqual({
      status: 'paused-no-image',
      stepIndex: 0,
      imagesProduced: 0,
      totalSteps: 3,
    });
    expect(pasteCount).toBe(1); // Did NOT spam Steps 2 & 3!
    expect(breakerClock - sendAt).toBeGreaterThanOrEqual(FAST_TIMING.minReplyMsNoImage);
    expect(breakerPhases.some((p) => p.phase === 'no-image' && p.i === 0)).toBe(true);

    // 3. Hard TIMEOUT past maxReplyMs -> fails cleanly with TIMEOUT, never 'done'
    let timeoutClock = 0;
    const timeoutOutcome = await runThreeImageSequence(
      steps.slice(0, 1),
      {
        requireImage: true,
        paste: async () => ({ ok: true, insertedImage: true, insertedPrompt: true, tabId: 12 }),
        submit: async () => ({ ok: true, method: 'button' }),
        probe: async () => ({
          ok: true,
          generating: true,
          quietMs: 0,
          composerEmpty: true,
          largeImageCount: 0,
        }),
        sleep: async (ms) => {
          timeoutClock += ms;
        },
        now: () => timeoutClock,
        isCancelled: () => false,
        onProgress: vi.fn(),
      },
      { ...FAST_TIMING, maxReplyMs: 5000 }
    );
    expect(timeoutOutcome).toEqual({ status: 'failed', stepIndex: 0, reason: 'TIMEOUT' });

    // 4. Manual send fallback + real image -> completes cleanly
    let manualClock = 0;
    let manualSentAt = 0;
    const manualOutcome = await runThreeImageSequence(
      steps.slice(0, 1),
      {
        requireImage: true,
        paste: async () => ({ ok: true, insertedImage: true, insertedPrompt: true, tabId: 15 }),
        submit: async () => ({ ok: false, reason: 'SEND_NOT_CONFIRMED' }),
        probe: async () => {
          const cleared = manualClock >= 2500;
          if (cleared && manualSentAt === 0) manualSentAt = manualClock;
          const since = manualSentAt > 0 ? manualClock - manualSentAt : 0;
          return {
            ok: true,
            generating: false,
            quietMs: since >= 4000 ? since - 4000 : since,
            composerEmpty: cleared,
            largeImageCount: since >= 4000 ? 1 : 0,
          };
        },
        sleep: async (ms) => {
          manualClock += ms;
        },
        now: () => manualClock,
        isCancelled: () => false,
        onProgress: vi.fn(),
      },
      FAST_TIMING
    );
    expect(manualOutcome).toEqual({ status: 'complete', imagesProduced: 1 });

    // 5. No AI chat open on Step 0 -> immediate 'no-chat'
    const noChat = await runThreeImageSequence(
      steps,
      {
        requireImage: true,
        paste: async () => ({ ok: false, reason: 'NO_CHAT_INPUT' }),
        submit: async () => ({ ok: false }),
        probe: async () => ({ ok: false, generating: false, quietMs: 0, composerEmpty: false }),
        sleep: async () => {},
        now: () => 0,
        isCancelled: () => false,
        onProgress: vi.fn(),
      },
      FAST_TIMING
    );
    expect(noChat).toEqual({ status: 'no-chat', reason: 'NO_CHAT_INPUT' });

    // 6. Cancel mid-run stops immediately without starting Step 2
    let cancelled = false;
    let cancelPasteCount = 0;
    const cancelOutcome = await runThreeImageSequence(
      steps,
      {
        requireImage: true,
        paste: async () => {
          cancelPasteCount += 1;
          return { ok: true, insertedImage: true, insertedPrompt: true, tabId: 9 };
        },
        submit: async () => {
          cancelled = true;
          return { ok: true, method: 'button' };
        },
        probe: async () => ({ ok: true, generating: true, quietMs: 0, composerEmpty: true, largeImageCount: 0 }),
        sleep: async () => {},
        now: () => 0,
        isCancelled: () => cancelled,
        onProgress: vi.fn(),
      },
      FAST_TIMING
    );
    expect(cancelOutcome).toEqual({ status: 'cancelled' });
    expect(cancelPasteCount).toBe(1);
  });

  it('prevents false complete when resuming from startIndex=1, blocks uppercase host h1 casing leaks on Google Images, and defaults generateCssTokens to suppress Google Sans', async () => {
    const record = makeCapture({ hostname: 'www.google.com', containsGraphicArtwork: true });
    const steps = buildThreeImageSteps(record, 'Apple', 'en');

    // 1. Resuming from startIndex=1 (after Step 0 produced no image) MUST return 'partial' (2/3), NEVER 'complete'!
    let clock = 0;
    let sendAt = 0;
    let imgCount = 0;
    let submitted = false;
    const resumedOutcome = await runThreeImageSequence(
      steps,
      {
        requireImage: true,
        startIndex: 1,
        continueOnNoImage: true,
        paste: async () => {
          submitted = false;
          return { ok: true, insertedImage: true, insertedPrompt: true, tabId: 33 };
        },
        submit: async () => {
          sendAt = clock;
          submitted = true;
          return { ok: true, method: 'button' };
        },
        probe: async () => {
          if (!submitted) {
            return { ok: true, generating: false, quietMs: 5000, composerEmpty: false, largeImageCount: imgCount };
          }
          const since = clock - sendAt;
          if (since >= 4000) imgCount = Math.max(imgCount, since >= 4000 ? imgCount + 1 : imgCount);
          return {
            ok: true,
            generating: since < 4000,
            quietMs: since < 4000 ? 0 : since - 4000,
            composerEmpty: true,
            largeImageCount: imgCount,
          };
        },
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
        isCancelled: () => false,
        onProgress: vi.fn(),
      },
      FAST_TIMING
    );
    expect(resumedOutcome).toEqual({ status: 'partial', imagesProduced: 2, totalSteps: 3 });

    // 2. Google Images capture grazing an uppercase host <h1> ("SPONSORED") MUST preserve "Apple" casing!
    const uppercaseGoogleRecord: CaptureRecord = {
      ...record,
      roots: [
        ...record.roots,
        {
          id: 'host-h1',
          tag: 'h1',
          cleanClasses: ['ad-badge'],
          omittedHashedClassCount: 0,
          textSnippet: 'SPONSORED',
          rect: { x: 0, y: 0, width: 90, height: 16 },
          styles: {
            display: 'block',
            position: 'static',
            width: '90px',
            height: '16px',
            textTransform: 'uppercase',
            fontFamily: '"Google Sans", sans-serif',
            fontSize: '12px',
            fontWeight: '700',
          },
          effectiveBackgroundHex: '#202124',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [],
        },
      ],
    };
    const kit = buildLocalAssetKit(uppercaseGoogleRecord, 'Apple');
    expect(kit.profile.displayWord).toBe('Apple');
    expect(kit.profile.textTransform).toBe('none');

    // 3. Default generateCssTokens() suppresses Google Sans on Google Images & isolated prompt has zero trademark/mascot bait
    expect(generateCssTokens(uppercaseGoogleRecord)).not.toContain('Google Sans');
    expect(generateIsolatedTextImagePrompt(uppercaseGoogleRecord, 'Apple', 'en')).not.toMatch(
      /company logo, icon, mascot/i
    );
  });

  it('tracks assistantImages by identity (never absorbs confirmedAssistant during postSendSettleMs), chains extracted Master Image into Steps 2 & 3, supports Separate Existing Chat Image, and guards Grok', async () => {
    const record = makeCapture({ hostname: 'www.pepsi.ca', containsGraphicArtwork: true });
    const steps = buildThreeImageSteps(record, 'Rots', 'en', { sourceMode: 'master-attached' });

    // 1. Full chained run: Step 0 fast confirmedAssistant image appears at 1000ms (inside 1500ms settle!)
    //    AND upgrades src in-place from preview -> HD; Steps 1 & 2 MUST receive extracted Master PNG!
    let clock = 0;
    let sendAt = 0;
    let currentStep = -1;
    let submitted = false;
    let extractedMasterUrl = '';
    const pastedUploads: Array<{ i: number; img?: string; fileName?: string }> = [];
    const extractedSteps: Array<{ i: number; domId?: string; src?: string }> = [];

    const chainedOutcome = await runThreeImageSequence(
      steps,
      {
        getStepPayload: (i) =>
          i === 0
            ? {
                prompt: steps[0]!.prompt,
                imageDataUrl: 'data:image/png;base64,ORIGINAL_PEPSI',
                requireImage: true,
                fileName: 'stylelens-capture.png',
              }
            : {
                prompt: steps[i]!.prompt,
                imageDataUrl: extractedMasterUrl,
                requireImage: true,
                fileName: 'stylelens-master.png',
              },
        paste: async (_prompt, _tabId, _req, imgOverride, fileName) => {
          currentStep += 1;
          submitted = false;
          pastedUploads.push({ i: currentStep, img: imgOverride, fileName });
          return { ok: true, insertedImage: true, insertedPrompt: true, tabId: 77 };
        },
        submit: async () => {
          sendAt = clock;
          submitted = true;
          return { ok: true, method: 'button' };
        },
        probe: async (): Promise<ChatProbeResponse> => {
          const imgs: NonNullable<ChatProbeResponse['assistantImages']> = [];
          const since = submitted ? clock - sendAt : 0;

          // Step 0 fast confirmedAssistant image renders at 1000ms (DURING 1500ms postSendSettleMs!)
          // and upgrades in-place to HD URL at 2500ms on the SAME domId `sl-img-1`!
          if (currentStep > 0 || (currentStep === 0 && submitted && since >= 1000)) {
            imgs.push({
              domId: 'sl-img-1',
              key: currentStep > 0 || since >= 2500 ? 'https://lh3.googleusercontent.com/rots-hd' : 'https://lh3.googleusercontent.com/rots-preview',
              src: currentStep > 0 || since >= 2500 ? 'https://lh3.googleusercontent.com/rots-hd' : 'https://lh3.googleusercontent.com/rots-preview',
              kind: 'img',
              naturalWidth: 1024,
              naturalHeight: 768,
              renderedWidth: 512,
              renderedHeight: 384,
              confirmedAssistant: true,
            });
          }
          // Step 1: unannotated user thumbnail appears at 800ms (MUST be absorbed!), real Font image at 4000ms
          if (currentStep === 1 && submitted && since >= 800) {
            imgs.push({
              domId: 'sl-user-echo-1',
              key: 'blob:user-upload-master-1',
              src: 'blob:user-upload-master-1',
              kind: 'img',
              naturalWidth: 200,
              naturalHeight: 150,
              renderedWidth: 120,
              renderedHeight: 90,
              confirmedAssistant: false,
            });
          }
          if (currentStep > 1 || (currentStep === 1 && submitted && since >= 4000)) {
            imgs.push({
              domId: 'sl-img-2',
              key: 'https://lh3.googleusercontent.com/rots-font',
              src: 'https://lh3.googleusercontent.com/rots-font',
              kind: 'img',
              naturalWidth: 1024,
              naturalHeight: 512,
              renderedWidth: 512,
              renderedHeight: 256,
              confirmedAssistant: true,
            });
          }
          if (currentStep === 2 && submitted && since >= 4000) {
            imgs.push({
              domId: 'sl-img-3',
              key: 'https://lh3.googleusercontent.com/rots-bg',
              src: 'https://lh3.googleusercontent.com/rots-bg',
              kind: 'img',
              naturalWidth: 1024,
              naturalHeight: 768,
              renderedWidth: 512,
              renderedHeight: 384,
              confirmedAssistant: true,
            });
          }

          const readyAt = currentStep === 0 ? 2500 : 4000;
          return {
            ok: true,
            generating: submitted && since < readyAt,
            quietMs: submitted ? Math.max(0, since - readyAt) : 5000,
            composerEmpty: submitted,
            largeImageCount: imgs.length,
            assistantImages: imgs,
          };
        },
        onStepImageDetected: async (idx, desc) => {
          extractedSteps.push({ i: idx, domId: desc?.domId, src: desc?.src });
          if (idx === 0) {
            extractedMasterUrl = 'data:image/png;base64,EXTRACTED_ROTS_MASTER';
          }
        },
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
        isCancelled: () => false,
        onProgress: vi.fn(),
      },
      FAST_TIMING
    );

    expect(chainedOutcome).toEqual({ status: 'complete', imagesProduced: 3 });
    expect(extractedSteps).toEqual([
      { i: 0, domId: 'sl-img-1', src: 'https://lh3.googleusercontent.com/rots-hd' },
      { i: 1, domId: 'sl-img-2', src: 'https://lh3.googleusercontent.com/rots-font' },
      { i: 2, domId: 'sl-img-3', src: 'https://lh3.googleusercontent.com/rots-bg' },
    ]);
    // Step 0 sent ORIGINAL_PEPSI; Steps 1 & 2 sent EXTRACTED_ROTS_MASTER (`stylelens-master.png`)!
    expect(pastedUploads[0]).toEqual({
      i: 0,
      img: 'data:image/png;base64,ORIGINAL_PEPSI',
      fileName: 'stylelens-capture.png',
    });
    expect(pastedUploads[1]).toEqual({
      i: 1,
      img: 'data:image/png;base64,EXTRACTED_ROTS_MASTER',
      fileName: 'stylelens-master.png',
    });
    expect(pastedUploads[2]).toEqual({
      i: 2,
      img: 'data:image/png;base64,EXTRACTED_ROTS_MASTER',
      fileName: 'stylelens-master.png',
    });

    // 2. "Separate Image Already in Chat" (`startIndex: 1`, `initialImagesProduced: 1`) completes cleanly at 3/3!
    let exClock = 0;
    let exSendAt = 0;
    let exStep = 0;
    let exSub = false;
    const existingOutcome = await runThreeImageSequence(
      steps,
      {
        startIndex: 1,
        initialTabId: 88,
        initialImagesProduced: 1,
        continueOnNoImage: true,
        paste: async (_p, tabId) => {
          expect(tabId).toBe(88);
          exStep += 1;
          exSub = false;
          return { ok: true, insertedImage: true, insertedPrompt: true, tabId: 88 };
        },
        submit: async () => {
          exSendAt = exClock;
          exSub = true;
          return { ok: true, method: 'button' };
        },
        probe: async (): Promise<ChatProbeResponse> => {
          const since = exSub ? exClock - exSendAt : 0;
          const imgs: NonNullable<ChatProbeResponse['assistantImages']> = [
            {
              domId: 'existing-rots',
              key: 'https://lh3.googleusercontent.com/existing-rots',
              src: 'https://lh3.googleusercontent.com/existing-rots',
              kind: 'img',
              naturalWidth: 1024,
              naturalHeight: 768,
              renderedWidth: 512,
              renderedHeight: 384,
              confirmedAssistant: true,
            },
          ];
          if (exStep > 1 || (exStep === 1 && exSub && since >= 4000)) {
            imgs.push({
              domId: 'new-font',
              key: 'https://lh3.googleusercontent.com/new-font',
              src: 'https://lh3.googleusercontent.com/new-font',
              kind: 'img',
              naturalWidth: 1024,
              naturalHeight: 512,
              renderedWidth: 512,
              renderedHeight: 256,
              confirmedAssistant: true,
            });
          }
          if (exStep === 2 && exSub && since >= 4000) {
            imgs.push({
              domId: 'new-bg',
              key: 'https://lh3.googleusercontent.com/new-bg',
              src: 'https://lh3.googleusercontent.com/new-bg',
              kind: 'img',
              naturalWidth: 1024,
              naturalHeight: 768,
              renderedWidth: 512,
              renderedHeight: 384,
              confirmedAssistant: true,
            });
          }
          return {
            ok: true,
            generating: exSub && since < 4000,
            quietMs: exSub ? Math.max(0, since - 4000) : 5000,
            composerEmpty: exSub,
            largeImageCount: imgs.length,
            assistantImages: imgs,
          };
        },
        sleep: async (ms) => {
          exClock += ms;
        },
        now: () => exClock,
        isCancelled: () => false,
        onProgress: vi.fn(),
      },
      FAST_TIMING
    );
    expect(existingOutcome).toEqual({ status: 'complete', imagesProduced: 3 });
    expect(exStep).toBe(2); // Ran ONLY Steps 2 & 3 (zero Step 1 regeneration!)

    // 3. Grok safety guard: getStepPayload abortReason halts cleanly before pasting any zero-image prompt!
    const grokPaste = vi.fn();
    const grokOutcome = await runThreeImageSequence(
      steps,
      {
        startIndex: 1,
        getStepPayload: () => ({ prompt: '', abortReason: 'GROK_REQUIRES_MASTER_IMAGE' }),
        paste: grokPaste,
        submit: async () => ({ ok: false }),
        probe: async () => ({ ok: false, generating: false, quietMs: 0, composerEmpty: false }),
        sleep: async () => {},
        now: () => 0,
        isCancelled: () => false,
        onProgress: vi.fn(),
      },
      FAST_TIMING
    );
    expect(grokOutcome).toEqual({
      status: 'failed',
      stepIndex: 1,
      reason: 'GROK_REQUIRES_MASTER_IMAGE',
    });
    expect(grokPaste).not.toHaveBeenCalled();
  });
});
