import { describe, expect, it } from 'vitest';
import type { CaptureRecord } from '../../types/capture';
import {
  buildLocalAssetKit,
  generateW3cDesignTokensJson,
  mixCaptureRecords,
} from '../assetKitExporter';
import { evaluatePromptFidelity } from '../fidelityCritic';
import { generateCompleteAgentPrompt } from '../specGenerator';
import { getTranslations } from '../../sidepanel/i18n/translations';

function makeRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  const base: CaptureRecord = {
    id: 'cap-a',
    createdAt: 1763700000000,
    page: {
      url: 'https://budweiser.example.com',
      hostname: 'budweiser.example.com',
      title: 'Budweiser Brand',
    },
    rect: { x: 0, y: 0, width: 420, height: 180 },
    viewport: { width: 1440, height: 900, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    captureMode: 'dom-and-visual',
    containsGraphicArtwork: false,
    selectionMethod: 'marquee',
    totalNodesScanned: 2,
    truncated: false,
    screenshotBlob: new Blob(['png'], { type: 'image/png' }),
    screenshotWidth: 840,
    screenshotHeight: 360,
    roots: [
      {
        id: 'n1',
        tag: 'section',
        cleanClasses: ['hero'],
        omittedHashedClassCount: 0,
        rect: { x: 0, y: 0, width: 420, height: 180 },
        styles: {
          display: 'flex',
          position: 'relative',
          width: '420px',
          height: '180px',
          backgroundColor: 'rgb(14, 14, 18)',
          border: '2px solid rgb(200, 16, 46)',
          borderRadius: '14px',
          backgroundImage: 'linear-gradient(90deg, #121216 0%, #241014 100%)',
        },
        effectiveBackgroundHex: '#0E0E12',
        hasNonSolidBackgroundAncestor: false,
        pseudoElements: [],
        children: [
          {
            id: 'n2',
            tag: 'h1',
            cleanClasses: ['wordmark'],
            omittedHashedClassCount: 0,
            textSnippet: 'BUDWEISER',
            rect: { x: 24, y: 40, width: 320, height: 64 },
            styles: {
              display: 'block',
              position: 'static',
              width: '320px',
              height: '64px',
              color: 'rgb(255, 255, 255)',
              fontFamily: '"Playfair Display", Georgia, serif',
              fontSize: '42px',
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              textShadow: '2px 3px 0px rgb(0, 0, 0)',
            },
            effectiveBackgroundHex: '#0E0E12',
            hasNonSolidBackgroundAncestor: false,
            pseudoElements: [],
            children: [],
          },
        ],
      },
    ],
    dna: {
      polarity: 'dark',
      palette: [
        {
          hex: '#0E0E12',
          rgbString: 'rgb(14, 14, 18)',
          role: 'background',
          usageCount: 2,
          provenance: 'exact-dom',
          alpha: 1,
        },
        {
          hex: '#C8102E',
          rgbString: 'rgb(200, 16, 46)',
          role: 'accent',
          usageCount: 2,
          provenance: 'exact-dom',
          alpha: 1,
        },
        {
          hex: '#FFFFFF',
          rgbString: 'rgb(255, 255, 255)',
          role: 'text',
          usageCount: 1,
          provenance: 'exact-dom',
          alpha: 1,
        },
      ],
      typography: [
        {
          primaryFont: 'Playfair Display',
          fontStack: '"Playfair Display", Georgia, serif',
          fontSizePx: 42,
          fontWeight: 700,
          lineHeightPx: 48,
          lineHeightRatio: 1.14,
          letterSpacing: '0.03em',
          role: 'display',
          sampleText: 'BUDWEISER',
          usageCount: 1,
        },
      ],
      contrastChecks: [],
      layout: {
        primaryModel: 'flex',
        flexCount: 1,
        gridCount: 0,
        flexDirections: ['row'],
        gridTemplates: [],
        gapValuesPx: [],
        paddingValuesPx: [24],
        spacingScalePx: [8, 16, 24],
        spacingGridBase: 8,
        dimensionsPx: { width: 420, height: 180 },
      },
      surfaces: {
        borderRadii: ['14px'],
        borders: ['2px solid rgb(200, 16, 46)'],
        shadows: ['0px 18px 36px rgba(0, 0, 0, 0.5)'],
        textShadows: ['2px 3px 0px rgb(0, 0, 0)'],
        transforms: [],
        clipPaths: [],
        gradients: ['linear-gradient(90deg, #121216 0%, #241014 100%)'],
        backdropFilters: [],
      },
      traits: [],
      cssVariables: [],
      fontStylesheetUrls: [],
      fontFaceRules: [
        '@font-face { font-family: "Playfair Display"; font-style: normal; font-weight: 700; src: url("data:font/woff2;base64,d09GMgABAAAAAA==") format("woff2"); }',
      ],
      pageFallbackTypography: [],
      summaryText: 'Dark UI · FLEX layout',
    },
  };

  return {
    ...base,
    ...overrides,
    dna: {
      ...base.dna,
      ...(overrides.dna ?? {}),
    },
  };
}

describe('StyleLens 3-Layer Asset Kit, W3C Tokens, Cross-Site Mixer & Zero-Context Prompt', () => {
  it('generates 3 clean decoupled SVG layers with embedded base64 fonts, gradients, and XML XSS escaping', () => {
    const record = makeRecord();
    const kit = buildLocalAssetKit(record, 'Dollar <Tree> & Co');

    // Layer 2: Isolated Wordmark ONLY (transparent cutout, NO background <rect>, embedded base64 font without HTML5-breaking CDATA, XML escaped)
    expect(kit.wordmarkSvg).toContain('<g id="wordmark-layer">');
    expect(kit.wordmarkSvg).not.toContain('<g id="background-layer">');
    expect(kit.wordmarkSvg).not.toContain('<rect ');
    expect(kit.wordmarkSvg).not.toContain('<![CDATA[');
    expect(kit.wordmarkSvg).toContain('<style type="text/css">');
    expect(kit.wordmarkSvg).toContain('DOLLAR &lt;TREE&gt; &amp; CO');
    expect(kit.wordmarkSvg).toContain('data:font/woff2;base64,d09GMgABAAAAAA==');
    expect(kit.wordmarkSvg).toContain('<feDropShadow');

    // Layer 3: Clean Background ONLY (zero <text>, real SVG <linearGradient> for Figma/Canva!)
    expect(kit.backgroundSvg).toContain('<g id="background-layer">');
    expect(kit.backgroundSvg).not.toContain('<text');
    expect(kit.backgroundSvg).toContain('<linearGradient id="sl-bg-grad"');
    expect(kit.backgroundSvg).toContain('#121216');
    expect(kit.backgroundSvg).toContain('#241014');
    expect(kit.backgroundSvg).toContain('#C8102E');

    // Layer 1: Multi-Layer Figma-Ready Composite (both editable groups intact!)
    expect(kit.compositeSvg).toContain('<g id="background-layer">');
    expect(kit.compositeSvg).toContain('<g id="wordmark-layer">');
    expect(kit.liveCompositeHtml).toContain('EXACT FONT');
    expect(kit.liveCompositeHtml).toContain('DOLLAR &lt;TREE&gt; &amp; CO');
  });

  it('outputs valid W3C DTCG Design Tokens JSON with $schema, $type, and $value', () => {
    const record = makeRecord();
    const jsonStr = generateW3cDesignTokensJson(record);
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    expect(parsed.$schema).toBe('https://tr.designtokens.org/format/');
    const colors = parsed.color as Record<string, { $value: string; $type: string }>;
    expect(colors.accent?.$value).toBe('#C8102E');
    expect(colors.accent?.$type).toBe('color');
    const typography = parsed.typography as Record<
      string,
      { $type: string; $value: { fontFamily: string; fontWeight: number } }
    >;
    expect(typography.display?.$type).toBe('typography');
    expect(typography.display?.$value.fontFamily).toBe('Playfair Display');
    expect(typography.display?.$value.fontWeight).toBe(700);
  });

  it('mixes two captured websites accurately across all 3 Cross-Site Mixer modes', () => {
    const siteA = makeRecord();
    const siteB = makeRecord({
      id: 'cap-b',
      page: { url: 'https://stripe.example.com', hostname: 'stripe.example.com', title: 'Stripe' },
      dna: {
        ...siteA.dna,
        polarity: 'light',
        palette: [
          {
            hex: '#F6F9FC',
            rgbString: 'rgb(246, 249, 252)',
            role: 'background',
            usageCount: 2,
            provenance: 'exact-dom',
            alpha: 1,
          },
          {
            hex: '#635BFF',
            rgbString: 'rgb(99, 91, 255)',
            role: 'accent',
            usageCount: 2,
            provenance: 'exact-dom',
            alpha: 1,
          },
        ],
        typography: [
          {
            primaryFont: 'Space Grotesk',
            fontStack: '"Space Grotesk", sans-serif',
            fontSizePx: 32,
            fontWeight: 600,
            lineHeightPx: 38,
            lineHeightRatio: 1.19,
            letterSpacing: '-0.02em',
            role: 'heading',
            sampleText: 'Payments',
            usageCount: 2,
          },
        ],
        surfaces: {
          ...siteA.dna.surfaces,
          borderRadii: ['24px'],
          borders: ['1px solid rgb(99, 91, 255)'],
        },
        fontFaceRules: [
          '@font-face { font-family: "Space Grotesk"; font-weight: 600; src: url("data:font/woff2;base64,AAA=") format("woff2"); }',
        ],
      },
    });

    // Mode 1: A Colors + B Frame (end-to-end into buildLocalAssetKit — MUST keep Site A dark #0E0E12 & #C8102E, NOT Site B!)
    const mix1 = mixCaptureRecords(siteA, siteB, 'A-colors-B-layout');
    expect(mix1.dna.polarity).toBe('dark');
    expect(mix1.dna.palette.some((c) => c.hex === '#C8102E')).toBe(true);
    expect(mix1.dna.surfaces.borderRadii[0]).toBe('24px');
    expect(mix1.dna.fontFaceRules?.length).toBe(2);
    const kit1 = buildLocalAssetKit(mix1, 'Apple', siteB.page.hostname);
    expect(kit1.profile.cardIsDark).toBe(true);
    expect(kit1.profile.primaryAccent).toBe('#C8102E');
    expect(kit1.profile.borderRadiusPx).toBe(24);
    expect(kit1.w3cTokensJson).toContain('"blendedWith": "stripe.example.com"');

    // Mode 2: A Frame + B Colors
    const mix2 = mixCaptureRecords(siteA, siteB, 'A-layout-B-colors');
    expect(mix2.dna.polarity).toBe('light');
    expect(mix2.dna.palette.some((c) => c.hex === '#635BFF')).toBe(true);
    expect(mix2.dna.surfaces.borderRadii[0]).toBe('14px');
    const kit2 = buildLocalAssetKit(mix2, 'Apple', siteB.page.hostname);
    expect(kit2.profile.cardIsDark).toBe(false);
    expect(kit2.profile.primaryAccent).toBe('#635BFF');

    // Mode 3: Balanced (Site A dark canvas + Site B indigo accent & Space Grotesk heading even if Site B token had role 'body'!)
    const siteBBodyOnly = makeRecord({
      ...siteB,
      dna: {
        ...siteB.dna,
        typography: [{ ...siteB.dna.typography[0]!, role: 'body' }],
      },
    });
    const mix3 = mixCaptureRecords(siteA, siteBBodyOnly, 'balanced');
    const kit3 = buildLocalAssetKit(mix3, 'Apple', siteB.page.hostname);
    expect(kit3.profile.cardIsDark).toBe(true);
    expect(kit3.profile.headingFontClean).toBe('Space Grotesk');
    expect(kit3.profile.primaryAccent).toBe('#635BFF');

    // Long multi-word phrases MUST NEVER silently drop words when wrapping SVG lines
    const longKit = buildLocalAssetKit(siteA, 'One Two Three Four Five Six Seven Eight Nine Ten');
    expect(longKit.wordmarkSvg).toContain('TEN');
    expect(longKit.wordmarkSvg).toContain('ONE');
  });

  it('locks 1-word minimal input ("Apple") against brand logo substitution and requests all 3 downloadable layers while passing >= 98% Prompt Fidelity', () => {
    const record = makeRecord();

    const oneWordPrompt = generateCompleteAgentPrompt(record, 'Apple');
    expect(oneWordPrompt).toContain('TARGET TEXT TO RENDER (ZERO-CONTEXT STYLE TRANSFER LOCK)');
    expect(oneWordPrompt).toContain('`Apple`');
    expect(oneWordPrompt).toContain('CRITICAL ANTI-BRAND-SUBSTITUTION RULE');
    expect(oneWordPrompt).toContain('REQUIRED 3-LAYER PRO ASSET PACK OUTPUT');
    expect(oneWordPrompt).toContain('Layer 1 — Full Composite');
    expect(oneWordPrompt).toContain('Layer 2 — Isolated Typography / Wordmark ONLY');
    expect(oneWordPrompt).toContain('Layer 3 — Clean Background / Frame Layout ONLY');
    expect(evaluatePromptFidelity(record, oneWordPrompt).passedThreshold).toBe(true);

    // Even with NO customWord entered in StyleLens, zero-context rule still protects 1-word chat inputs!
    const zeroWordPrompt = generateCompleteAgentPrompt(record);
    expect(zeroWordPrompt).toContain('ZERO-CONTEXT INPUT RULE');
    expect(zeroWordPrompt).toContain('REQUIRED 3-LAYER PRO ASSET PACK OUTPUT');
    expect(evaluatePromptFidelity(record, zeroWordPrompt).passedThreshold).toBe(true);
  });

  it('enforces single-image hybrid delivery contract (no multi-image crashes), Layer 1 scene lock, packaged output, and Simplified Chinese directive', () => {
    const record = makeRecord();

    const enPrompt = generateCompleteAgentPrompt(record, 'Apple', 'en');
    expect(enPrompt).toContain('STRICT DELIVERY CONTRACT');
    expect(enPrompt).toContain('MANDATORY HYBRID REPLY');
    expect(enPrompt).toContain('EXACTLY ONE (1) IMAGE GENERATION CALL TOTAL');
    expect(enPrompt).toContain('LAYER 1 SCENE & BACKGROUND LOCK');
    expect(enPrompt).toContain('Do NOT call the image generator for Layer 2');
    expect(enPrompt).toContain('Do NOT call the image generator for Layer 3');
    expect(enPrompt).not.toContain('if multiple images are supported');
    expect(enPrompt).toContain('STYLELENS PACKAGE // 01001010');
    expect(enPrompt).toContain('NEVER draw binary digits, box borders');
    expect(enPrompt.indexOf('01 // Full Composite')).toBeLessThan(
      enPrompt.indexOf('02 // Isolated Wordmark')
    );
    expect(enPrompt.indexOf('02 // Isolated Wordmark')).toBeLessThan(
      enPrompt.indexOf('03 // Clean Background Layer')
    );
    expect(enPrompt).not.toContain('Simplified Chinese (简体中文)');

    const zhPrompt = generateCompleteAgentPrompt(record, '苹果', 'zh-CN');
    expect(zhPrompt).toContain('`苹果`');
    expect(zhPrompt).toContain('Simplified Chinese (简体中文)');
    expect(zhPrompt).toContain('STYLELENS PACKAGE // 01001010');
    expect(evaluatePromptFidelity(record, zhPrompt).passedThreshold).toBe(true);
  });

  it('provides complete non-empty English and Simplified Chinese translation dictionaries', () => {
    const en = getTranslations('en');
    const zh = getTranslations('zh-CN');

    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zh).sort();
    expect(zhKeys).toEqual(enKeys);

    expect(en.step2StartHere).toBeTruthy();
    expect(zh.step2StartHere).toContain('请先');
    expect(zh.makeThreeImages('苹果')).toContain('苹果');
    expect(zh.modeSimple).not.toBe(en.modeSimple);
    expect(zh.modeStudio).not.toBe(en.modeStudio);
  });
});
