import { afterEach, describe, expect, it, vi } from 'vitest';
import { deterministicProvider } from '../../ai/deterministicProvider';
import { OpenAICompatibleProvider } from '../../ai/openaiCompatibleProvider';
import { buildPreviewFontAssets, buildPreviewSrcDoc } from '../../ai/responseParser';
import type { CaptureRecord, ExtractedNode, RawDomExtraction } from '../../types/capture';
import { analyzeDesignDNA } from '../designAnalyzer';
import { extractDomFromSelection } from '../domExtractor';
import { formatBlueprintForPrompt, generateFaithfulSnapshot, generateStandaloneHtmlFile } from '../faithfulSnapshot';
import {
  evaluateFidelity,
  evaluatePromptFidelity,
  evaluateRemixFidelity,
  FIDELITY_TARGET_PERCENT,
} from '../fidelityCritic';
import { generateCompleteAgentPrompt } from '../specGenerator';

function buildRecordFromDom(dom: RawDomExtraction, width = 420, height = 260): CaptureRecord {
  const rect = { x: 0, y: 0, width, height };
  const dna = analyzeDesignDNA(dom, [], rect);
  return {
    id: 'bench-1',
    createdAt: 1763700000000,
    page: { url: 'https://benchmark.dev', hostname: 'benchmark.dev', title: 'Benchmark' },
    rect,
    viewport: { width: 1440, height: 900, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    captureMode: dom.captureMode,
    visualFallbackReason: dom.visualFallbackReason,
    containsGraphicArtwork: dom.containsGraphicArtwork,
    graphicArtworkNote: dom.graphicArtworkNote,
    selectionMethod: 'marquee',
    totalNodesScanned: dom.totalNodesScanned,
    truncated: false,
    screenshotBlob: new Blob(['png'], { type: 'image/png' }),
    screenshotWidth: width * 2,
    screenshotHeight: height * 2,
    roots: dom.roots,
    dna,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('98% Strict X-Ray Fidelity Critic Benchmark Suite', () => {
  it('achieves >= 98% fidelity on a Dark Glassmorphism SaaS Pricing Card', () => {
    const root: ExtractedNode = {
      id: 'n1',
      tag: 'section',
      cleanClasses: ['pricing-card'],
      omittedHashedClassCount: 0,
      rect: { x: 0, y: 0, width: 360, height: 280 },
      styles: {
        display: 'flex',
        position: 'relative',
        flexDirection: 'column',
        gap: '16px',
        padding: '24px',
        width: '360px',
        height: '280px',
        backgroundColor: 'rgba(18, 18, 22, 0.78)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: '16px',
        boxShadow: '0px 24px 48px rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(18px)',
      },
      effectiveBackgroundHex: '#09090B',
      hasNonSolidBackgroundAncestor: false,
      pseudoElements: [],
      children: [
        {
          id: 'n2',
          tag: 'h2',
          cleanClasses: ['title'],
          omittedHashedClassCount: 0,
          textSnippet: 'Pro Plan',
          rect: { x: 24, y: 24, width: 200, height: 32 },
          styles: {
            display: 'block',
            position: 'static',
            width: '200px',
            height: '32px',
            color: 'rgb(255, 255, 255)',
            fontFamily: '"Space Grotesk", sans-serif',
            fontSize: '24px',
            fontWeight: '700',
            lineHeight: '30px',
            letterSpacing: '-0.02em',
          },
          effectiveBackgroundHex: '#121216',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [],
        },
        {
          id: 'n3',
          tag: 'button',
          cleanClasses: ['cta'],
          omittedHashedClassCount: 0,
          textSnippet: 'Start Free Trial',
          rect: { x: 24, y: 200, width: 160, height: 40 },
          styles: {
            display: 'inline-flex',
            position: 'static',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '10px 18px',
            width: '160px',
            height: '40px',
            color: 'rgb(9, 9, 11)',
            backgroundColor: 'rgb(255, 255, 255)',
            borderRadius: '9999px',
            fontFamily: '"Inter", sans-serif',
            fontSize: '14px',
            fontWeight: '600',
          },
          effectiveBackgroundHex: '#FFFFFF',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [],
        },
      ],
    };

    const record = buildRecordFromDom({
      captureMode: 'dom-and-visual',
      selectionMethod: 'marquee',
      totalNodesScanned: 3,
      truncated: false,
      roots: [root],
      cssVariables: [],
      fontStylesheetUrls: ['https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap'],
    });

    const standaloneHtml = generateStandaloneHtmlFile(record);
    const report = evaluateFidelity(record, standaloneHtml);

    expect(report.totalScore).toBeGreaterThanOrEqual(FIDELITY_TARGET_PERCENT);
    expect(report.passedThreshold).toBe(true);
    expect(standaloneHtml).toContain('Space+Grotesk');
    expect(standaloneHtml).toContain('backdrop-filter: blur(18px)');
  });

  it('achieves >= 98% fidelity on a Bold Comic Display Banner with tilt, text-shadow, and clip-path', () => {
    const root: ExtractedNode = {
      id: 'n1',
      tag: 'header',
      cleanClasses: ['comic-burst'],
      omittedHashedClassCount: 0,
      rect: { x: 0, y: 0, width: 460, height: 180 },
      styles: {
        display: 'flex',
        position: 'relative',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '12px',
        padding: '20px 28px',
        width: '460px',
        height: '180px',
        backgroundColor: 'rgb(230, 36, 41)',
        clipPath: 'polygon(4% 12%, 98% 0%, 95% 92%, 0% 100%)',
        boxShadow: '6px 6px 0px rgb(0, 0, 0)',
      },
      effectiveBackgroundHex: '#E62429',
      hasNonSolidBackgroundAncestor: false,
      pseudoElements: [],
      children: [
        {
          id: 'n2',
          tag: 'h1',
          cleanClasses: ['hero-wordmark'],
          omittedHashedClassCount: 0,
          textSnippet: 'NOVI COMICS',
          rect: { x: 28, y: 40, width: 320, height: 64 },
          styles: {
            display: 'block',
            position: 'static',
            width: '320px',
            height: '64px',
            color: 'rgb(255, 255, 255)',
            fontFamily: '"Bangers", Impact, sans-serif',
            fontSize: '48px',
            fontWeight: '700',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            textShadow: '3px 3px 0px rgb(0, 0, 0)',
            transform: 'rotate(-3deg)',
          },
          effectiveBackgroundHex: '#E62429',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [],
        },
      ],
    };

    const record = buildRecordFromDom({
      captureMode: 'dom-and-visual',
      selectionMethod: 'marquee',
      totalNodesScanned: 2,
      truncated: false,
      roots: [root],
      cssVariables: [],
    });

    const snapshot = generateFaithfulSnapshot(record);
    const report = evaluateFidelity(record, snapshot.combinedSnippet);

    expect(report.totalScore).toBeGreaterThanOrEqual(FIDELITY_TARGET_PERCENT);
    expect(snapshot.combinedSnippet).toContain('clip-path: polygon(4% 12%, 98% 0%, 95% 92%, 0% 100%)');
    expect(snapshot.combinedSnippet).toContain('transform: rotate(-3deg)');
    expect(snapshot.combinedSnippet).toContain('text-shadow: 3px 3px 0px rgb(0, 0, 0)');
  });

  it('achieves >= 98% fidelity on a Navbar preserving inline <svg> logo vector verbatim', () => {
    const root: ExtractedNode = {
      id: 'n1',
      tag: 'nav',
      cleanClasses: ['top-nav'],
      omittedHashedClassCount: 0,
      rect: { x: 0, y: 0, width: 900, height: 64 },
      styles: {
        display: 'flex',
        position: 'static',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '24px',
        padding: '12px 24px',
        width: '900px',
        height: '64px',
        backgroundColor: 'rgb(10, 10, 12)',
        borderBottom: '1px solid rgb(39, 39, 42)',
      },
      effectiveBackgroundHex: '#0A0A0C',
      hasNonSolidBackgroundAncestor: false,
      pseudoElements: [],
      children: [
        {
          id: 'n2',
          tag: 'svg',
          cleanClasses: ['brand-mark'],
          omittedHashedClassCount: 0,
          svgMarkup: '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#ffffff" /></svg>',
          rect: { x: 24, y: 20, width: 24, height: 24 },
          styles: { display: 'block', position: 'static', width: '24px', height: '24px' },
          effectiveBackgroundHex: '#0A0A0C',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [],
        },
        {
          id: 'n3',
          tag: 'a',
          cleanClasses: ['nav-link'],
          omittedHashedClassCount: 0,
          textSnippet: 'Documentation',
          rect: { x: 100, y: 20, width: 110, height: 24 },
          styles: {
            display: 'inline-block',
            position: 'static',
            width: '110px',
            height: '24px',
            color: 'rgb(244, 244, 245)',
            fontFamily: '"Geist", sans-serif',
            fontSize: '14px',
            fontWeight: '500',
          },
          effectiveBackgroundHex: '#0A0A0C',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [],
        },
      ],
    };

    const record = buildRecordFromDom({
      captureMode: 'dom-and-visual',
      selectionMethod: 'element-snap',
      totalNodesScanned: 3,
      truncated: false,
      roots: [root],
      cssVariables: [],
    });

    const snapshot = generateFaithfulSnapshot(record);
    const report = evaluateFidelity(record, snapshot.combinedSnippet);
    expect(report.totalScore).toBeGreaterThanOrEqual(FIDELITY_TARGET_PERCENT);
    expect(snapshot.combinedSnippet).toContain('<svg viewBox="0 0 24 24"');
  });

  it('honestly flags baked raster <img> artwork below 98% and advises attaching the cropped PNG', () => {
    const record = buildRecordFromDom({
      captureMode: 'dom-and-visual',
      containsGraphicArtwork: true,
      graphicArtworkNote: 'Mostly rendered artwork (<img>).',
      selectionMethod: 'marquee',
      totalNodesScanned: 1,
      truncated: false,
      roots: [
        {
          id: 'n1',
          tag: 'img',
          cleanClasses: ['logo'],
          omittedHashedClassCount: 0,
          imgSrc: 'https://example.com/logo.png',
          imgAlt: 'Zumiez',
          rect: { x: 0, y: 0, width: 240, height: 70 },
          styles: {
            display: 'block',
            position: 'static',
            width: '240px',
            height: '70px',
            backgroundColor: 'rgb(255, 255, 255)',
          },
          effectiveBackgroundHex: '#FFFFFF',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [],
        },
      ],
      cssVariables: [],
    });

    const snapshot = generateFaithfulSnapshot(record);
    const report = evaluateFidelity(record, snapshot.combinedSnippet);
    expect(report.isBakedVisualOnly).toBe(true);
    expect(report.passedThreshold).toBe(false);
    expect(report.issues.some((i) => /attach the cropped PNG/i.test(i))).toBe(true);
  });

  it('auto-triggers Critic Self-Repair pass when a connected AI returns < 98% fidelity', async () => {
    const root: ExtractedNode = {
      id: 'n1',
      tag: 'section',
      cleanClasses: ['card'],
      omittedHashedClassCount: 0,
      rect: { x: 0, y: 0, width: 320, height: 180 },
      styles: {
        display: 'flex',
        position: 'static',
        flexDirection: 'column',
        gap: '16px',
        padding: '24px',
        width: '320px',
        height: '180px',
        backgroundColor: 'rgb(15, 23, 42)',
        borderRadius: '14px',
      },
      effectiveBackgroundHex: '#0F172A',
      hasNonSolidBackgroundAncestor: false,
      pseudoElements: [],
      children: [
        {
          id: 'n2',
          tag: 'h2',
          cleanClasses: ['title'],
          omittedHashedClassCount: 0,
          textSnippet: 'Analytics',
          rect: { x: 24, y: 24, width: 180, height: 28 },
          styles: {
            display: 'block',
            position: 'static',
            width: '180px',
            height: '28px',
            color: 'rgb(248, 250, 252)',
            fontFamily: '"Plus Jakarta Sans", sans-serif',
            fontSize: '22px',
            fontWeight: '700',
          },
          effectiveBackgroundHex: '#0F172A',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [],
        },
      ],
    };

    const record = buildRecordFromDom({
      captureMode: 'dom-and-visual',
      selectionMethod: 'element-snap',
      totalNodesScanned: 2,
      truncated: false,
      roots: [root],
      cssVariables: [],
    });

    // Pass 1: sloppy AI forgets font, color, gap, radius (< 95%)
    // Pass 2 (auto-triggered Critic repair): AI restores all exact tokens (>= 95%)
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    previewHtml: '<div><p>Generic</p></div>',
                    code: '<div>Generic</div>',
                    influencedBy: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    previewHtml:
                      '<style>.c{display:flex;gap:16px;padding:24px;background:#0F172A;border-radius:14px;}.t{font-family:"Plus Jakarta Sans",sans-serif;font-size:22px;font-weight:700;color:#F8FAFC;}</style><section class="c"><h2 class="t">Northwind</h2></section>',
                    code: '<section style={{display:"flex",gap:"16px",padding:"24px",background:"#0F172A",borderRadius:"14px"}}><h2 style={{fontFamily:"Plus Jakarta Sans",fontSize:"22px",fontWeight:700,color:"#F8FAFC"}}>Northwind</h2></section>',
                    influencedBy: [{ token: 'Plus Jakarta Sans 22px', usage: 'Exact heading font' }],
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        )
      );

    const provider = new OpenAICompatibleProvider({
      presetId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-test',
      includeScreenshot: false,
    });

    const result = await provider.synthesizeRemix({
      record,
      userPrompt: 'Make it say Northwind',
      targetStack: 'react-tailwind',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.fidelityReport?.totalScore).toBeGreaterThanOrEqual(FIDELITY_TARGET_PERCENT);
    expect(result.fidelityReport?.passedThreshold).toBe(true);
    expect(result.previewHtml).toContain('Plus Jakarta Sans');
  });

  it('end-to-end extracts sticky navbar, currentColor SVG, positioned badge, leaf divider, and relative bg URL at >= 98% fidelity', () => {
    // Mock pseudo-element getComputedStyle safely in jsdom
    const origGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      if (pseudo) {
        return { content: 'none' } as CSSStyleDeclaration;
      }
      return origGetComputedStyle(el);
    });

    document.body.innerHTML = '';
    const nav = document.createElement('nav');
    nav.setAttribute(
      'style',
      'display: flex; position: fixed; top: 0px; left: 0px; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 24px; background-color: rgb(11, 11, 14); background-image: url("/assets/noise.png"); border-bottom: 1px solid rgb(39, 39, 42);'
    );

    const logoSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    logoSvg.setAttribute('viewBox', '0 0 24 24');
    logoSvg.setAttribute('style', 'display: inline; color: rgb(251, 191, 36);');
    logoSvg.innerHTML = '<path d="M12 2L22 12L12 22L2 12Z" fill="currentColor" />';

    const divider = document.createElement('div');
    divider.setAttribute('style', 'display: block; background-color: rgb(255, 255, 255); border-radius: 9999px;');

    const titleWrap = document.createElement('div');
    titleWrap.setAttribute('style', 'display: flex; position: relative; align-items: center; gap: 8px;');

    const brand = document.createElement('a');
    brand.textContent = 'StyleLens';
    brand.setAttribute(
      'style',
      'display: inline-block; color: rgb(255, 255, 255); font-family: "Space Grotesk", sans-serif; font-size: 18px; font-weight: 700;'
    );

    const badge = document.createElement('span');
    badge.textContent = 'NEW';
    badge.setAttribute(
      'style',
      'display: inline-flex; position: absolute; top: -6px; right: -8px; padding: 2px 6px; background-color: rgb(251, 191, 36); color: rgb(9, 9, 11); border-radius: 9999px; font-family: "Inter", sans-serif; font-size: 10px; font-weight: 700;'
    );

    titleWrap.append(brand, badge);
    nav.append(logoSvg, divider, titleWrap);
    document.body.appendChild(nav);

    // Stub bounding rects in jsdom
    const rectMap = new Map<Element, DOMRect>([
      [nav, new DOMRect(0, 0, 880, 56)],
      [logoSvg, new DOMRect(24, 16, 24, 24)],
      [divider, new DOMRect(56, 27, 48, 2)],
      [titleWrap, new DOMRect(120, 14, 140, 28)],
      [brand, new DOMRect(120, 14, 90, 24)],
      [badge, new DOMRect(212, 8, 36, 16)],
    ]);
    for (const [el, r] of rectMap.entries()) {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(r);
    }

    const dom = extractDomFromSelection(document, { x: 0, y: 0, width: 880, height: 56 }, 'element-snap', nav);
    expect(dom.containsGraphicArtwork).toBe(false);

    const record = buildRecordFromDom(dom, 880, 56);
    const standaloneHtml = generateStandaloneHtmlFile(record);
    const report = evaluateFidelity(record, standaloneHtml);

    // Verify all 1-to-1 browser fixes worked end-to-end
    expect(report.totalScore).toBeGreaterThanOrEqual(FIDELITY_TARGET_PERCENT);
    expect(report.passedThreshold).toBe(true);
    expect(standaloneHtml).toContain('position: relative;');
    expect(standaloneHtml).not.toContain('position: fixed;');
    expect(standaloneHtml).toContain('position: absolute;');
    expect(standaloneHtml).toContain('top: -6px;');
    expect(standaloneHtml).toContain('right: -8px;');
    expect(standaloneHtml).toContain('fill="currentColor"');
    expect(standaloneHtml).toContain('display: inline-block;');
    expect(standaloneHtml).toContain('color: rgb(251, 191, 36);');
    expect(standaloneHtml).toContain('width: 48px;');
    expect(standaloneHtml).toContain('height: 2px;');
    expect(standaloneHtml).toContain(':where(.sl-capture-frame a) {');
    expect(standaloneHtml).toContain(':where(.sl-capture-frame button) {');
    expect(standaloneHtml).toContain('max-width: 944px;');
    expect(standaloneHtml).toContain('margin: auto;');
    expect(standaloneHtml).toMatch(/url\("https?:\/\/[^"]+\/assets\/noise\.png"\)/);
    expect(standaloneHtml).toContain('family=Space+Grotesk&display=swap');
    expect(standaloneHtml).toContain('family=Space+Grotesk:wght@400;700&display=swap');

    // Verify prompt formatter never chops off bodyHtml or leaves unclosed <style>
    const budgeted = formatBlueprintForPrompt(generateFaithfulSnapshot(record), 1200);
    expect(budgeted).toContain('</style>');
    expect(budgeted).toContain('<div class="sl-capture-frame">');
  });

  it('prevents HTTP 400 weight queries on single-weight display fonts and blocks Critic gaming', () => {
    const root: ExtractedNode = {
      id: 'n1',
      tag: 'section',
      cleanClasses: ['card'],
      omittedHashedClassCount: 0,
      rect: { x: 0, y: 0, width: 320, height: 180 },
      styles: {
        display: 'flex',
        position: 'relative',
        flexDirection: 'column',
        gap: '16px',
        padding: '24px',
        width: '320px',
        height: '180px',
        backgroundColor: 'rgb(15, 23, 42)',
        borderRadius: '16px',
        boxShadow: '0px 24px 48px rgba(0, 0, 0, 0.5)',
      },
      effectiveBackgroundHex: '#0F172A',
      hasNonSolidBackgroundAncestor: false,
      pseudoElements: [],
      children: [
        {
          id: 'n2',
          tag: 'h2',
          cleanClasses: ['heading'],
          omittedHashedClassCount: 0,
          textSnippet: 'Dashboard',
          rect: { x: 24, y: 24, width: 180, height: 30 },
          styles: {
            display: 'block',
            position: 'static',
            width: '180px',
            height: '30px',
            color: 'rgb(255, 255, 255)',
            fontFamily: '"Sora", sans-serif',
            fontSize: '24px',
            fontWeight: '700',
          },
          effectiveBackgroundHex: '#0F172A',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [],
        },
        {
          id: 'n3',
          tag: 'span',
          cleanClasses: ['pill'],
          omittedHashedClassCount: 0,
          textSnippet: 'BETA',
          rect: { x: 260, y: 12, width: 44, height: 20 },
          styles: {
            display: 'inline-flex',
            position: 'absolute',
            top: '12px',
            right: '12px',
            width: '44px',
            height: '20px',
            color: 'rgb(9, 9, 11)',
            backgroundColor: 'rgb(251, 191, 36)',
            fontFamily: '"Bangers", Impact, sans-serif',
            fontSize: '16px',
            fontWeight: '700',
          },
          effectiveBackgroundHex: '#FBBF24',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [],
        },
        {
          id: 'n4',
          tag: 'svg',
          cleanClasses: ['icon'],
          omittedHashedClassCount: 0,
          svgMarkup: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="currentColor" /></svg>',
          rect: { x: 24, y: 80, width: 16, height: 16 },
          styles: {
            display: 'inline',
            position: 'static',
            width: '16px',
            height: '16px',
            color: 'rgb(251, 191, 36)',
          },
          effectiveBackgroundHex: '#0F172A',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [],
        },
      ],
    };

    const record = buildRecordFromDom({
      captureMode: 'dom-and-visual',
      selectionMethod: 'element-snap',
      totalNodesScanned: 4,
      truncated: false,
      roots: [root],
      cssVariables: [],
    });

    // Verify faithful standalone HTML emits plain Bangers link (no :wght@400;700 400 error) and passes >= 95%
    const faithfulHtml = generateStandaloneHtmlFile(record);
    expect(faithfulHtml).toContain('family=Bangers&display=swap');
    expect(faithfulHtml).not.toContain('family=Bangers:wght@');
    expect(evaluateFidelity(record, faithfulHtml).totalScore).toBeGreaterThanOrEqual(
      FIDELITY_TARGET_PERCENT
    );

    // Anti-gaming check: comments, wrong font link (Inter instead of Sora), padding pretending to be gap/font-size,
    // and background-color pretending to be foreground color MUST all be caught!
    const gamedStandalone = `<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&display=swap" /><style>/* font-family: Sora; font-size: 24px; gap: 16px; #FBBF24 */ .c{display:flex;padding:16px 24px;background-color:#0F172A;border-radius:4px;box-shadow:0 0 1px red;}</style></head><body><section class="c"><h2>Dashboard</h2><span>BETA</span><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="currentColor" /></svg></section></body></html>`;
    const report = evaluateFidelity(record, gamedStandalone);

    expect(report.passedThreshold).toBe(false);
    expect(report.totalScore).toBeLessThan(60);
    expect(report.issues.some((i) => /Missing webfont loader.*Sora/i.test(i))).toBe(true);
    expect(report.issues.some((i) => /Missing font-size 16px/i.test(i))).toBe(true);
    expect(report.issues.some((i) => /Missing gap 16px/i.test(i))).toBe(true);
    expect(report.issues.some((i) => /Missing position: absolute/i.test(i))).toBe(true);
    expect(report.issues.some((i) => /Missing border-radius/i.test(i))).toBe(true);
    expect(report.issues.some((i) => /Missing box-shadow/i.test(i))).toBe(true);
    expect(report.issues.some((i) => /Missing inherited foreground color/i.test(i))).toBe(true);
  });

  it('recreates live tailwindcss.com interleaved inline <code> paragraph order and CTA pill at >= 98% fidelity', () => {
    const origGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      if (pseudo) return { content: 'none' } as CSSStyleDeclaration;
      return origGetComputedStyle(el);
    });

    document.body.innerHTML = '';
    const hero = document.createElement('section');
    hero.setAttribute(
      'style',
      'display: flex; position: relative; flex-direction: column; gap: 20px; padding: 32px; background-color: rgb(255, 255, 255);'
    );

    const h1 = document.createElement('h1');
    h1.textContent = 'Rapidly build modern websites without ever leaving your HTML.';
    h1.setAttribute(
      'style',
      'display: block; color: rgb(3, 7, 18); font-family: "Inter", sans-serif; font-size: 48px; font-weight: 500; letter-spacing: -0.05em;'
    );

    const p = document.createElement('p');
    p.setAttribute(
      'style',
      'display: block; color: rgb(75, 85, 99); font-family: "Inter", sans-serif; font-size: 18px; font-weight: 500;'
    );
    p.append(document.createTextNode('A utility-first CSS framework packed with classes like '));
    const codeFlex = document.createElement('code');
    codeFlex.textContent = 'flex';
    codeFlex.setAttribute(
      'style',
      'display: inline; color: rgb(14, 165, 233); font-family: "IBM Plex Mono", monospace; font-size: 16px; font-weight: 500;'
    );
    p.append(codeFlex, document.createTextNode(' and '));
    const codeRotate = document.createElement('code');
    codeRotate.textContent = 'rotate-90';
    codeRotate.setAttribute(
      'style',
      'display: inline; color: rgb(14, 165, 233); font-family: "IBM Plex Mono", monospace; font-size: 16px; font-weight: 500;'
    );
    p.append(codeRotate, document.createTextNode(' directly in your markup.'));

    const cta = document.createElement('a');
    cta.textContent = 'Get started';
    cta.setAttribute(
      'style',
      'display: inline-block; padding: 8px 16px; background-color: rgb(0, 0, 0); color: rgb(255, 255, 255); border-radius: 32px; font-family: "Inter", sans-serif; font-size: 14px; font-weight: 600;'
    );

    hero.append(h1, p, cta);
    document.body.appendChild(hero);

    const rects = new Map<Element, DOMRect>([
      [hero, new DOMRect(0, 0, 706, 320)],
      [h1, new DOMRect(32, 32, 642, 96)],
      [p, new DOMRect(32, 148, 642, 60)],
      [codeFlex, new DOMRect(360, 148, 36, 20)],
      [codeRotate, new DOMRect(430, 148, 84, 20)],
      [cta, new DOMRect(32, 228, 108, 40)],
    ]);
    for (const [el, r] of rects.entries()) {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(r);
    }

    const dom = extractDomFromSelection(document, { x: 0, y: 0, width: 706, height: 320 }, 'element-snap', hero);
    const record = buildRecordFromDom(dom, 706, 320);
    const standalone = generateStandaloneHtmlFile(record);
    const report = evaluateFidelity(record, standalone);

    expect(report.totalScore).toBeGreaterThanOrEqual(FIDELITY_TARGET_PERCENT);
    expect(report.passedThreshold).toBe(true);
    expect(standalone).toContain('overflow-x: clip;');
    // Interleaved <code> elements stay inline in exact original DOM order!
    expect(standalone).toMatch(
      /classes like <code class="sl-n\d+">flex<\/code> and <code class="sl-n\d+">rotate-90<\/code> directly in your markup\./
    );
  });

  it('recreates H&M-style multi-row marquee (red SVG + top nav + giant MEN\'S JEANS) at >= 98% and rejects glossy pill hallucinations', () => {
    const origGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      if (pseudo) return { content: 'none' } as CSSStyleDeclaration;
      return origGetComputedStyle(el);
    });

    document.body.innerHTML = '';
    document.body.setAttribute('style', 'background-color: rgb(0, 0, 0);');

    const wrapper = document.createElement('div');
    wrapper.setAttribute('style', 'background-color: rgb(0, 0, 0);');

    // Root 1: Top-left H&M inline SVG with CSS-styled red fill on <path> (no inline fill attr!)
    const logoSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    logoSvg.setAttribute('viewBox', '0 0 60 40');
    logoSvg.setAttribute('class', 'brand-logo');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 36L14 4L24 36M34 36L44 4L54 36');
    path.setAttribute('style', 'fill: rgb(235, 0, 16);');
    logoSvg.appendChild(path);

    // Root 2: Top-center nav bar (WOMEN / MEN / KIDS / HOME)
    const nav = document.createElement('nav');
    nav.setAttribute(
      'style',
      'display: flex; flex-direction: row; align-items: center; gap: 28px; background-color: rgb(0, 0, 0);'
    );
    const links: Array<{ label: string; active: boolean; x: number; w: number }> = [
      { label: 'WOMEN', active: false, x: 120, w: 56 },
      { label: 'MEN', active: true, x: 204, w: 34 },
      { label: 'KIDS', active: false, x: 266, w: 36 },
      { label: 'HOME', active: false, x: 330, w: 46 },
    ];
    const linkEls: HTMLAnchorElement[] = [];
    for (const item of links) {
      const a = document.createElement('a');
      a.textContent = item.label;
      a.setAttribute(
        'style',
        `display: inline-block; color: ${item.active ? 'rgb(242, 242, 242)' : 'rgb(160, 160, 160)'}; font-family: "HM Sans", Arial, sans-serif; font-size: 13px; font-weight: ${item.active ? '700' : '400'}; text-transform: uppercase;`
      );
      nav.appendChild(a);
      linkEls.push(a);
    }

    // Root 3: Lower full-width headline MEN'S JEANS
    const h1 = document.createElement('h1');
    h1.textContent = "MEN'S JEANS";
    h1.setAttribute(
      'style',
      'display: block; color: rgb(242, 242, 242); background-color: rgb(0, 0, 0); font-family: "HM Sans", Arial, sans-serif; font-size: 52px; font-weight: 700; text-transform: uppercase; letter-spacing: -0.02em;'
    );

    wrapper.append(logoSvg, nav, h1);
    document.body.appendChild(wrapper);

    const rects = new Map<Element, DOMRect>([
      [wrapper, new DOMRect(0, 0, 1200, 800)],
      [logoSvg, new DOMRect(12, 8, 52, 36)],
      [nav, new DOMRect(120, 16, 256, 20)],
      [h1, new DOMRect(12, 92, 396, 58)],
    ]);
    linkEls.forEach((a, idx) => {
      const meta = links[idx]!;
      rects.set(a, new DOMRect(meta.x, 16, meta.w, 20));
    });
    for (const [el, r] of rects.entries()) {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(r);
    }

    const selectionRect = { x: 0, y: 0, width: 420, height: 180 };
    const dom = extractDomFromSelection(document, selectionRect, 'marquee');

    // Must extract multiple roots (logoSvg, nav, h1) and preserve exact red SVG fill #EB0010
    expect(dom.roots.length).toBe(3);
    const svgRoot = dom.roots.find((r) => r.tag === 'svg');
    expect(svgRoot?.svgColors).toContain('#EB0010');
    expect(svgRoot?.svgMarkup).toContain('fill="#EB0010"');

    const record = buildRecordFromDom(dom, 420, 180);
    expect(record.dna.palette.some((c) => c.hex === '#EB0010' && c.provenance === 'exact-dom')).toBe(true);

    // 1. Standalone 1:1 HTML recreation MUST hit >= 98% with 2D coordinates and ZERO fake border-radius
    const standalone = generateStandaloneHtmlFile(record);
    const htmlReport = evaluateFidelity(record, standalone);
    expect(htmlReport.totalScore).toBeGreaterThanOrEqual(FIDELITY_TARGET_PERCENT);
    expect(htmlReport.passedThreshold).toBe(true);
    expect(standalone).toContain('left: 12px;');
    expect(standalone).toContain('left: 120px;');
    expect(standalone).toContain('top: 92px;');
    expect(standalone).not.toContain('border-radius: 10px');

    // 2. Copy Style Prompt MUST hit >= 98% with X-Ray Spatial Visual Map + Anti-Hallucination Rules
    const copyStylePrompt = generateCompleteAgentPrompt(record);
    const promptReport = evaluatePromptFidelity(record, copyStylePrompt);
    expect(promptReport.totalScore).toBeGreaterThanOrEqual(FIDELITY_TARGET_PERCENT);
    expect(promptReport.passedThreshold).toBe(true);
    expect(copyStylePrompt).toContain('Row 1 — Top');
    expect(copyStylePrompt).toContain('Row 2 — Lower');
    expect(copyStylePrompt).toContain('#EB0010');
    expect(copyStylePrompt).toContain("MEN'S JEANS");
    expect(copyStylePrompt).toContain('NO invented pill');
    expect(copyStylePrompt).toContain('NO 3D gloss');
    expect(copyStylePrompt).toContain('NO layout collapsing');

    // 3. A glossy black pill hallucination (like the broken "P&M | MENS JEANS" output) MUST FAIL hard!
    const brokenGlossyPill = `<style>.pill{display:flex;align-items:center;border-radius:9999px;background:linear-gradient(180deg,#222,#000);border:1px solid #555;box-shadow:0 8px 24px rgba(0,0,0,0.8);padding:12px 24px;color:#fff;font-family:Impact;font-size:28px;font-weight:700;}</style><div class="pill"><span>P&M</span> | <span>MENS JEANS</span></div>`;
    const pillReport = evaluateFidelity(record, brokenGlossyPill);
    expect(pillReport.passedThreshold).toBe(false);
    expect(pillReport.totalScore).toBeLessThan(55);
    expect(pillReport.issues.some((i) => /Hallucinated rounded\/pill border-radius/i.test(i))).toBe(true);
    expect(pillReport.issues.some((i) => /Hallucinated glossy\/gradient/i.test(i))).toBe(true);
    expect(pillReport.issues.some((i) => /#EB0010/i.test(i))).toBe(true);
  });

  it('handles realistic 1440px block <h1>, oversized <header>, <svg><use>, <br>, fontStretch, and proprietary fonts without HTTP 400 links', () => {
    const origGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      if (pseudo) return { content: 'none' } as CSSStyleDeclaration;
      return origGetComputedStyle(el);
    });

    document.body.innerHTML = '';
    document.body.setAttribute('style', 'background-color: rgb(0, 0, 0);');

    // Hidden sprite <symbol> referenced via <use href="#hm-mark">
    const sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sprite.setAttribute('style', 'display: none;');
    sprite.innerHTML =
      '<symbol id="hm-mark" viewBox="0 0 60 40"><path d="M4 36L14 4L24 36" /></symbol>';
    document.body.appendChild(sprite);

    // Oversized 1440px <header> with space-between and right-side icons outside marquee
    const header = document.createElement('header');
    header.setAttribute(
      'style',
      'display: flex; justify-content: space-between; align-items: center; background-color: rgb(0, 0, 0);'
    );

    const logoSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    logoSvg.setAttribute('aria-label', 'H&M');
    logoSvg.setAttribute('style', 'fill: rgb(235, 0, 16);');
    const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    useEl.setAttribute('href', '#hm-mark');
    useEl.setAttribute('style', 'fill: rgb(235, 0, 16);');
    logoSvg.appendChild(useEl);

    const nav = document.createElement('nav');
    nav.setAttribute('style', 'display: flex; flex-direction: row; gap: 24px;');
    const menLink = document.createElement('a');
    menLink.textContent = 'MEN';
    menLink.setAttribute(
      'style',
      'display: inline-block; color: rgb(242, 242, 242); font-family: "HM Sans", Arial, sans-serif; font-size: 13px; font-weight: 700; text-transform: uppercase;'
    );
    nav.appendChild(menLink);

    const rightIcon = document.createElement('button');
    rightIcon.textContent = 'BAG';
    rightIcon.setAttribute('style', 'color: rgb(255, 255, 255);');

    header.append(logoSvg, nav, rightIcon);

    // Full-width 1440px block <h1> with <br> and condensed font-stretch
    const h1 = document.createElement('h1');
    h1.setAttribute(
      'style',
      'display: block; color: rgb(242, 242, 242); font-family: "HM Sans", Arial, sans-serif; font-size: 52px; font-weight: 700; font-stretch: condensed; text-transform: uppercase;'
    );
    h1.append(
      document.createTextNode("MEN'S"),
      document.createElement('br'),
      document.createTextNode('JEANS')
    );

    document.body.append(header, h1);

    const rects = new Map<Element, DOMRect>([
      [header, new DOMRect(0, 0, 1440, 56)],
      [logoSvg, new DOMRect(12, 8, 52, 36)],
      [nav, new DOMRect(140, 16, 180, 20)],
      [menLink, new DOMRect(140, 16, 40, 20)],
      [rightIcon, new DOMRect(1360, 16, 48, 24)],
      [h1, new DOMRect(12, 88, 1416, 110)],
    ]);
    for (const [el, r] of rects.entries()) {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(r);
    }

    const dom = extractDomFromSelection(document, { x: 0, y: 0, width: 380, height: 210 }, 'marquee');
    // Oversized 1440px <header> is excluded in favor of tight children, and 1416px <h1> is KEPT!
    expect(dom.roots.some((r) => r.tag === 'header')).toBe(false);
    expect(dom.roots.some((r) => r.tag === 'h1')).toBe(true);
    const svgNode = dom.roots.find((r) => r.tag === 'svg');
    expect(svgNode?.ariaLabel).toBe('H&M');
    expect(svgNode?.svgMarkup).toContain('M4 36L14 4L24 36');
    expect(svgNode?.svgColors).toContain('#EB0010');

    const record = buildRecordFromDom(dom, 380, 210);
    const standalone = generateStandaloneHtmlFile(record);
    // Proprietary "HM Sans" MUST NOT trigger a bogus Google Fonts 400 <link>!
    expect(standalone).not.toContain('fonts.googleapis.com/css2?family=HM+Sans');
    // Multi-line <br /> and condensed font-stretch are preserved, canvasWidth stays clamped to 380px!
    expect(standalone).toContain('<br />');
    expect(standalone).toContain('font-stretch: condensed;');
    expect(standalone).toContain('width: min(100%, 380px);');
    // Root <svg> gets exact height (not just min-height)
    expect(standalone).toContain('height: 36px;');
    expect(evaluateFidelity(record, standalone).totalScore).toBeGreaterThanOrEqual(
      FIDELITY_TARGET_PERCENT
    );
    // Prompt Fidelity Critic MUST also pass >= 98% on <br> multi-line headings (no false negative!)
    const brPrompt = generateCompleteAgentPrompt(record);
    expect(brPrompt).toContain('"H&M"');
    expect(evaluatePromptFidelity(record, brPrompt).passedThreshold).toBe(true);

    // Tailwind `rounded-none` and explicit CSS `box-shadow: none` MUST NOT false-fail flat purity checks!
    const withFlatExplicitReset = standalone
      .replace('<div class="sl-capture-frame">', '<div class="sl-capture-frame rounded-none">')
      .replace('overflow-x: clip;', 'overflow-x: clip;\n  box-shadow: none;');
    const roundedNoneReport = evaluateFidelity(record, withFlatExplicitReset);
    expect(roundedNoneReport.passedThreshold).toBe(true);
    expect(roundedNoneReport.issues.some((i) => /Hallucinated/i.test(i))).toBe(false);
  });

  it('keeps outer anti-pill guardrail despite tiny 14px child dot, keeps <h1> above >20 links, and never rounds 97.5 up to 98', () => {
    // Construct a dense header with 22 utility links + a tiny 14px rounded cart dot + <a><span>SHOP</span></a> + <h1>MEN'S JEANS</h1>
    const navChildren: ExtractedNode[] = [];
    for (let i = 0; i < 22; i++) {
      navChildren.push({
        id: `n${i + 10}`,
        tag: 'a',
        cleanClasses: ['util-link'],
        omittedHashedClassCount: 0,
        textSnippet: `Item ${i + 1}`,
        rect: { x: 10 + i * 16, y: 10, width: 14, height: 14 },
        styles: {
          display: 'inline-block',
          position: 'static',
          width: '14px',
          height: '14px',
          color: 'rgb(160, 160, 160)',
          fontFamily: '"Inter", sans-serif',
          fontSize: '12px',
          fontWeight: '400',
        },
        effectiveBackgroundHex: '#000000',
        hasNonSolidBackgroundAncestor: false,
        pseudoElements: [],
        children: [],
      });
    }

    // Tiny 14px circular cart dot (border-radius: 50%) — MUST NOT disable outer anti-pill guardrail!
    navChildren.push({
      id: 'n40',
      tag: 'span',
      cleanClasses: ['cart-dot'],
      omittedHashedClassCount: 0,
      rect: { x: 370, y: 10, width: 14, height: 14 },
      styles: {
        display: 'inline-block',
        position: 'static',
        width: '14px',
        height: '14px',
        backgroundColor: 'rgb(235, 0, 16)',
        borderRadius: '50%',
      },
      effectiveBackgroundHex: '#EB0010',
      hasNonSolidBackgroundAncestor: false,
      pseudoElements: [],
      children: [],
    });

    // 2-level nested wrapper CTA <a><div><span>SHOP</span></div></a>
    navChildren.push({
      id: 'n41',
      tag: 'a',
      cleanClasses: ['cta-wrap'],
      omittedHashedClassCount: 0,
      rect: { x: 390, y: 8, width: 64, height: 24 },
      styles: {
        display: 'inline-flex',
        position: 'static',
        width: '64px',
        height: '24px',
        backgroundColor: 'rgb(255, 255, 255)',
        border: '1px solid rgb(255, 255, 255)',
      },
      effectiveBackgroundHex: '#FFFFFF',
      hasNonSolidBackgroundAncestor: false,
      pseudoElements: [],
      children: [
        {
          id: 'n41b',
          tag: 'div',
          cleanClasses: ['cta-inner'],
          omittedHashedClassCount: 0,
          rect: { x: 394, y: 10, width: 56, height: 20 },
          styles: { display: 'flex', position: 'static', width: '56px', height: '20px' },
          effectiveBackgroundHex: '#FFFFFF',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [
            {
              id: 'n42',
              tag: 'span',
              cleanClasses: ['cta-label'],
              omittedHashedClassCount: 0,
              textSnippet: 'SHOP',
              rect: { x: 398, y: 12, width: 48, height: 16 },
              styles: {
                display: 'inline',
                position: 'static',
                width: '48px',
                height: '16px',
                color: 'rgb(0, 0, 0)',
                fontFamily: '"Inter", sans-serif',
                fontSize: '12px',
                fontWeight: '700',
              },
              effectiveBackgroundHex: '#FFFFFF',
              hasNonSolidBackgroundAncestor: false,
              pseudoElements: [],
              children: [],
            },
          ],
        },
      ],
    });

    const headerRoot: ExtractedNode = {
      id: 'n1',
      tag: 'div',
      cleanClasses: ['top-row'],
      omittedHashedClassCount: 0,
      rect: { x: 0, y: 0, width: 460, height: 40 },
      styles: {
        display: 'flex',
        position: 'static',
        flexDirection: 'row',
        width: '460px',
        height: '40px',
        backgroundColor: 'rgb(0, 0, 0)',
      },
      effectiveBackgroundHex: '#000000',
      hasNonSolidBackgroundAncestor: false,
      pseudoElements: [],
      children: navChildren,
    };

    const h1Root: ExtractedNode = {
      id: 'n2',
      tag: 'h1',
      cleanClasses: ['hero-title'],
      omittedHashedClassCount: 0,
      textSnippet: "MEN'S JEANS",
      rect: { x: 12, y: 80, width: 400, height: 56 },
      styles: {
        display: 'block',
        position: 'static',
        width: '400px',
        height: '56px',
        color: 'rgb(242, 242, 242)',
        backgroundColor: 'rgb(0, 0, 0)',
        fontFamily: '"Inter", sans-serif',
        fontSize: '52px',
        fontWeight: '700',
        textTransform: 'uppercase',
      },
      effectiveBackgroundHex: '#000000',
      hasNonSolidBackgroundAncestor: false,
      pseudoElements: [],
      children: [],
    };

    const record = buildRecordFromDom(
      {
        captureMode: 'dom-and-visual',
        selectionMethod: 'marquee',
        totalNodesScanned: 26,
        truncated: false,
        roots: [headerRoot, h1Root],
        cssVariables: [],
      },
      460,
      160
    );

    const prompt = generateCompleteAgentPrompt(record);
    // 1. <h1>MEN'S JEANS</h1> MUST NOT be dropped despite 24 items above it!
    expect(prompt).toContain("MEN'S JEANS");
    // 2. Outer anti-pill guardrail STILL fires despite the tiny 14px cart dot!
    expect(prompt).toContain('NO invented pill');
    // 3. Wrapper <a><span>SHOP</span></a> inherits #FFFFFF fill & border in the Spatial Map!
    expect(prompt).toMatch(/"SHOP"[^\n]*fill #FFFFFF/);
    // 4. Prompt Fidelity Critic passes >= 98%
    expect(evaluatePromptFidelity(record, prompt).passedThreshold).toBe(true);

    // 5. Strict NO-ROUNDING-UP test: dropping `font-size: 52px` on a 3-token profile drops below 98.0 and MUST FAIL!
    const standalone = generateStandaloneHtmlFile(record);
    const missingH1Size = standalone.replace(/font-size:\s*52px;/g, 'font-size: 16px;');
    const strictReport = evaluateFidelity(record, missingH1Size);
    expect(strictReport.passedThreshold).toBe(false);
    expect(strictReport.totalScore).toBeLessThan(FIDELITY_TARGET_PERCENT);

    // 6. Mixed-radius outer container check: `<header class="rounded-full">` MUST be caught even with the tiny 14px cart dot!
    const outerPillHijack = standalone.replace(
      '<div class="sl-capture-frame">',
      '<header class="sl-capture-frame rounded-full">'
    );
    const outerPillReport = evaluateFidelity(record, outerPillHijack);
    expect(outerPillReport.passedThreshold).toBe(false);
    expect(outerPillReport.issues.some((i) => /Hallucinated rounded\/pill/i.test(i))).toBe(true);
  });

  it('never renders a blank white/black Remix preview on empty photo/wrapper captures and never awards 100% to blank HTML', async () => {
    // Regression: a white full-bleed wrapper div with 0 text nodes
    const emptyWrapperRecord = buildRecordFromDom(
      {
        captureMode: 'dom-and-visual',
        selectionMethod: 'marquee',
        totalNodesScanned: 1,
        truncated: false,
        roots: [
          {
            id: 'n1',
            tag: 'div',
            cleanClasses: ['hero-stage'],
            omittedHashedClassCount: 0,
            rect: { x: 0, y: 0, width: 420, height: 520 },
            styles: {
              display: 'block',
              position: 'relative',
              width: '420px',
              height: '520px',
              backgroundColor: 'rgb(255, 255, 255)',
            },
            effectiveBackgroundHex: '#FFFFFF',
            hasNonSolidBackgroundAncestor: false,
            pseudoElements: [],
            children: [],
          },
        ],
        cssVariables: [],
      },
      420,
      520
    );

    // 1. Blank HTML shell MUST NOT score 100% in Fidelity Critic
    const blankAudit = evaluateFidelity(
      emptyWrapperRecord,
      '<style>.box{background:#FFFFFF;width:420px;height:520px;}</style><div class="box"></div>'
    );
    expect(blankAudit.passedThreshold).toBe(false);
    expect(blankAudit.totalScore).toBeLessThanOrEqual(15);
    expect(blankAudit.issues.some((i) => /blank canvas/i.test(i))).toBe(true);

    // 2. Remix offline preview MUST render a visible, contrast-safe website UI (NOT a blank white box!)
    const remixDash = await deterministicProvider.synthesizeRemix({
      record: emptyWrapperRecord,
      userPrompt: 'Create a modern dashboard card using this website style.',
      targetStack: 'react-tailwind',
    });
    expect(remixDash.previewHtml).toContain('sl-spec-card');
    expect(remixDash.previewHtml).toContain('Launch UI');
    // Guaranteed readable dark text (#09090B) on white card surface (never white-on-white!)
    expect(remixDash.previewHtml).toContain('color: #09090B');

    // 3. Prompt-responsive template switching works immediately (pricing & navbar)
    const remixPricing = await deterministicProvider.synthesizeRemix({
      record: emptyWrapperRecord,
      userPrompt: 'Pro pricing plan card',
      targetStack: 'react-tailwind',
    });
    expect(remixPricing.previewHtml).toContain('$29');

    const remixNav = await deterministicProvider.synthesizeRemix({
      record: emptyWrapperRecord,
      userPrompt: 'Website navbar header',
      targetStack: 'react-tailwind',
    });
    expect(remixNav.previewHtml).toContain('sl-spec-nav');

    // 4. Pure baked artwork captures omit noisy empty <div> CSS boilerplate from Copy Style Prompt
    const bakedRecord = buildRecordFromDom(
      {
        captureMode: 'dom-and-visual',
        containsGraphicArtwork: true,
        graphicArtworkNote: 'Baked artwork',
        selectionMethod: 'marquee',
        totalNodesScanned: 1,
        truncated: false,
        roots: emptyWrapperRecord.roots,
        cssVariables: [],
      },
      420,
      210
    );
    const bakedPrompt = generateCompleteAgentPrompt(bakedRecord);
    expect(bakedPrompt).toContain('2.00:1 aspect');
    expect(bakedPrompt).toContain('100% literal accuracy');
    expect(bakedPrompt).not.toContain('## Verified 1-to-1 HTML + Scoped CSS Blueprint');
  });

  it('uses dominant visual polarity + vibrant primary/secondary accents in Remix (Bones Reds black/red/gold graphic never becomes a generic white card)', async () => {
    const dom: RawDomExtraction = {
      captureMode: 'dom-and-visual',
      containsGraphicArtwork: true,
      graphicArtworkNote: 'Mostly rendered artwork (<img>).',
      selectionMethod: 'marquee',
      totalNodesScanned: 1,
      truncated: false,
      roots: [
        {
          id: 'n1',
          tag: 'img',
          cleanClasses: ['promo-img'],
          omittedHashedClassCount: 0,
          imgSrc: 'https://bonesbearings.com/reds.png',
          imgAlt: 'Bones Reds',
          rect: { x: 0, y: 0, width: 400, height: 400 },
          styles: { display: 'block', position: 'static', width: '400px', height: '400px' },
          // Hidden white <body> behind the black/red/gold <img>!
          effectiveBackgroundHex: '#FFFFFF',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [],
        },
      ],
      cssVariables: [],
    };

    const sampledPixels = [
      { hex: '#000000', rgb: [0, 0, 0] as [number, number, number], percentage: 58 },
      { hex: '#D43821', rgb: [212, 56, 33] as [number, number, number], percentage: 22 },
      { hex: '#BFA466', rgb: [191, 164, 102] as [number, number, number], percentage: 16 },
    ];

    const dna = analyzeDesignDNA(dom, sampledPixels, { x: 0, y: 0, width: 400, height: 400 });
    expect(dna.polarity).toBe('dark');

    const record: CaptureRecord = {
      id: 'bones-1',
      createdAt: 1763700000000,
      page: { url: 'https://bonesbearings.com', hostname: 'bonesbearings.com', title: 'Bones' },
      rect: { x: 0, y: 0, width: 400, height: 400 },
      viewport: { width: 1440, height: 900, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
      captureMode: dom.captureMode,
      containsGraphicArtwork: true,
      selectionMethod: 'marquee',
      totalNodesScanned: 1,
      truncated: false,
      screenshotBlob: new Blob(['png'], { type: 'image/png' }),
      screenshotWidth: 800,
      screenshotHeight: 800,
      roots: dom.roots,
      dna,
    };

    const remix = await deterministicProvider.synthesizeRemix({
      record,
      userPrompt: 'Create a modern dashboard card using this website style.',
      targetStack: 'react-tailwind',
    });

    // Must use dark #000000 canvas + Bones Red (#D43821) primary accent + Gold (#BFA466) secondary accent!
    expect(remix.previewHtml).toContain('background: #000000;');
    expect(remix.previewHtml).toContain('#D43821');
    expect(remix.previewHtml).toContain('#BFA466');
    expect(remix.previewHtml).toContain('border-top: 3px solid #D43821;');
    // Without page fallback fonts, strict Remix Critic refuses to award >= 98% or fake "Inter"!
    expect(remix.previewHtml).not.toContain('INTER');
    expect(remix.fidelityReport?.passedThreshold).toBe(false);
  });

  it('strict Remix Fidelity Critic enforces real embedded fonts, catches CORS-blocked fonts & Inter hijacks, and certifies >= 98% when real fonts load', async () => {
    const bonesWithEmbeddedFontDom: RawDomExtraction = {
      captureMode: 'dom-and-visual',
      containsGraphicArtwork: true,
      graphicArtworkNote: 'Mostly rendered artwork (<img>).',
      selectionMethod: 'marquee',
      totalNodesScanned: 1,
      truncated: false,
      roots: [
        {
          id: 'n1',
          tag: 'img',
          cleanClasses: ['promo-img'],
          omittedHashedClassCount: 0,
          imgSrc: 'https://bonesbearings.com/reds.png',
          imgAlt: 'Bones Reds',
          rect: { x: 0, y: 0, width: 400, height: 400 },
          styles: { display: 'block', position: 'static', width: '400px', height: '400px' },
          effectiveBackgroundHex: '#FFFFFF',
          hasNonSolidBackgroundAncestor: false,
          pseudoElements: [],
          children: [],
        },
      ],
      cssVariables: [],
      pageFallbackTypography: [
        {
          primaryFont: 'Bones Custom Display',
          fontStack: '"Bones Custom Display", Arial, sans-serif',
          fontSizePx: 34,
          fontWeight: 700,
          lineHeightPx: 38,
          lineHeightRatio: 1.12,
          letterSpacing: '0.02em',
          role: 'display',
          sampleText: 'BONES REDS BEARINGS',
          usageCount: 3,
        },
      ],
      // Embedded base64 woff2 (CORS-proof inside <iframe sandbox="" srcDoc>)
      fontFaceRules: [
        '@font-face { font-family: "Bones Custom Display"; font-style: normal; font-weight: 700; font-display: swap; src: url("data:font/woff2;base64,d09GMgABAAAAAA==") format("woff2"); }',
      ],
    };

    const sampledPixels = [
      { hex: '#000000', rgb: [0, 0, 0] as [number, number, number], percentage: 58 },
      { hex: '#D43821', rgb: [212, 56, 33] as [number, number, number], percentage: 22 },
      { hex: '#BFA466', rgb: [191, 164, 102] as [number, number, number], percentage: 16 },
    ];

    const dna = analyzeDesignDNA(bonesWithEmbeddedFontDom, sampledPixels, {
      x: 0,
      y: 0,
      width: 400,
      height: 400,
    });
    const record: CaptureRecord = {
      id: 'bones-embedded-1',
      createdAt: 1763700000000,
      page: { url: 'https://bonesbearings.com', hostname: 'bonesbearings.com', title: 'Bones' },
      rect: { x: 0, y: 0, width: 400, height: 400 },
      viewport: { width: 1440, height: 900, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
      captureMode: 'dom-and-visual',
      containsGraphicArtwork: true,
      selectionMethod: 'marquee',
      totalNodesScanned: 1,
      truncated: false,
      screenshotBlob: new Blob(['png'], { type: 'image/png' }),
      screenshotWidth: 800,
      screenshotHeight: 800,
      roots: bonesWithEmbeddedFontDom.roots,
      dna,
    };

    // 1. With real embedded base64 @font-face + dark/red/gold brand tokens -> MUST hit >= 98%!
    const remix = await deterministicProvider.synthesizeRemix({
      record,
      userPrompt: 'Create a modern dashboard card using this website style.',
      targetStack: 'react-tailwind',
    });
    expect(remix.previewHtml).toContain('Bones Custom Display');
    expect(remix.previewHtml).toContain('EXACT FONT');
    expect(remix.fidelityReport?.totalScore).toBeGreaterThanOrEqual(FIDELITY_TARGET_PERCENT);
    expect(remix.fidelityReport?.passedThreshold).toBe(true);

    // 2. If @font-face only has an un-embedded cross-origin URL (CORS-blocked in Origin: null iframe) -> MUST FAIL!
    const unembeddedRecord: CaptureRecord = {
      ...record,
      dna: {
        ...record.dna,
        fontFaceRules: [
          '@font-face { font-family: "Bones Custom Display"; font-weight: 700; src: url("https://cdn.bonesbearings.com/bones.woff2") format("woff2"); }',
        ],
      },
    };
    const unembeddedRemix = await deterministicProvider.synthesizeRemix({
      record: unembeddedRecord,
      userPrompt: 'Create a modern dashboard card',
      targetStack: 'react-tailwind',
    });
    expect(unembeddedRemix.fidelityReport?.passedThreshold).toBe(false);
    expect(
      unembeddedRemix.fidelityReport?.issues.some((i) =>
        /No CORS-safe embedded @font-face/i.test(i)
      )
    ).toBe(true);

    // 3. Anti-gaming check: hijacking heading font to "Inter" AND turning dark canvas white MUST CRUSH score!
    const gamedWhiteInterDoc = buildPreviewSrcDoc(
      `<style>.sl-spec-wrap{background:#FFFFFF;font-family:"Inter",sans-serif;}.sl-spec-card{background:#FFFFFF;color:#09090B;}.sl-spec-title{font-family:"Inter",sans-serif;font-weight:700;}.sl-cta{background:#09090B;color:#FFFFFF;}</style><div class="sl-spec-wrap"><section class="sl-spec-card"><span class="sl-dot" style="background:#D43821"></span><h2 class="sl-spec-title">Generic</h2><button class="sl-cta">Go</button></section></div>`,
      '',
      'light',
      buildPreviewFontAssets(record)
    );
    const gamedAudit = evaluateRemixFidelity(record, gamedWhiteInterDoc);
    expect(gamedAudit.passedThreshold).toBe(false);
    expect(gamedAudit.totalScore).toBeLessThan(65);
    expect(gamedAudit.issues.some((i) => /polarity mismatch/i.test(i))).toBe(true);
    expect(gamedAudit.issues.some((i) => /Primary brand accent #D43821/i.test(i))).toBe(true);
    expect(gamedAudit.issues.some((i) => /Bones Custom Display/i.test(i))).toBe(true);

    // 4. Expanded Google Fonts catalog (e.g. "Chakra Petch") loads cleanly without embedded binary and passes >= 98%!
    const chakraRecord: CaptureRecord = {
      ...record,
      dna: {
        ...record.dna,
        fontFaceRules: [],
        pageFallbackTypography: [
          {
            primaryFont: 'Chakra Petch',
            fontStack: '"Chakra Petch", sans-serif',
            fontSizePx: 28,
            fontWeight: 700,
            lineHeightPx: 32,
            lineHeightRatio: 1.14,
            letterSpacing: '0.01em',
            role: 'heading',
            sampleText: 'CYBER DECK',
            usageCount: 2,
          },
        ],
      },
    };
    const chakraRemix = await deterministicProvider.synthesizeRemix({
      record: chakraRecord,
      userPrompt: 'Create a modern dashboard card',
      targetStack: 'react-tailwind',
    });
    expect(chakraRemix.fidelityReport?.totalScore).toBeGreaterThanOrEqual(FIDELITY_TARGET_PERCENT);
    expect(chakraRemix.fidelityReport?.passedThreshold).toBe(true);

    // 5. Dual-font website (Playfair Display heading + Lato body) MUST PASS >= 98% (no heading-vs-body false failure!)
    const dualFontRecord: CaptureRecord = {
      ...record,
      containsGraphicArtwork: false,
      dna: {
        ...record.dna,
        fontFaceRules: [],
        typography: [
          {
            primaryFont: 'Playfair Display',
            fontStack: '"Playfair Display", Georgia, serif',
            fontSizePx: 36,
            fontWeight: 700,
            lineHeightPx: 42,
            lineHeightRatio: 1.17,
            letterSpacing: '-0.01em',
            role: 'display',
            sampleText: 'Editorial Headline',
            usageCount: 2,
          },
          {
            primaryFont: 'Lato',
            fontStack: '"Lato", sans-serif',
            fontSizePx: 15,
            fontWeight: 400,
            lineHeightPx: 22,
            lineHeightRatio: 1.47,
            letterSpacing: 'normal',
            role: 'body',
            sampleText: 'Body paragraph copy',
            usageCount: 4,
          },
        ],
        surfaces: {
          ...record.dna.surfaces,
          borders: ['1px solid rgb(191, 164, 102)'],
          // Bright-to-dark conflicting gradient that would break naive white text contrast!
          gradients: ['linear-gradient(90deg, #FFFFFF 0%, #000000 100%)'],
        },
      },
    };
    const dualRemix = await deterministicProvider.synthesizeRemix({
      record: dualFontRecord,
      userPrompt: 'Create a modern dashboard card',
      targetStack: 'react-tailwind',
    });
    expect(dualRemix.fidelityReport?.totalScore).toBeGreaterThanOrEqual(FIDELITY_TARGET_PERCENT);
    expect(dualRemix.fidelityReport?.passedThreshold).toBe(true);
    // Conflicting white-to-black gradient safely falls back to accent band so card text keeps >= 4.5:1 contrast!
    expect(dualRemix.previewHtml).toContain('sl-grad-band');

    // 6. Anti-gaming torture test: dead CSS classes, `Arial, "Playfair Display"`, `border: none`,
    //    `Inter+Tight` pretending to be `Inter`, and missing `.sl-spec-title` MUST ALL FAIL!
    const deadCssGameDoc = `<!doctype html><html><head>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@700&display=swap" />
      <style>
        @font-face { font-family: "OtherFont"; src: url("data:font/woff2;base64,bGF0b3BsYXlmYWlyZGlzcGxheQ==") format("woff2"); }
        .unused-ghost { font-family: "Playfair Display"; color: #D43821; border: 1px solid #BFA466; }
        .sl-spec-wrap { background: #000000; display: flex; }
        .sl-spec-card { background: #141418; color: #FAFAFA; font-family: Arial, "Lato"; }
        .sl-spec-title { font-family: Arial, "Playfair Display"; font-weight: 700; }
        .sl-cta { border: none; background: #141418; color: #333333; }
      </style></head><body>
      <div class="sl-spec-wrap"><section class="sl-spec-card"><h2 class="sl-spec-title">Gamed</h2><button class="sl-cta">Buy</button></section></div>
    </body></html>`;
    const deadGameAudit = evaluateRemixFidelity(dualFontRecord, deadCssGameDoc);
    expect(deadGameAudit.passedThreshold).toBe(false);
    expect(deadGameAudit.totalScore).toBeLessThan(50);
    expect(deadGameAudit.issues.some((i) => /not leading with captured font "Playfair Display"/i.test(i))).toBe(true);
    expect(deadGameAudit.issues.some((i) => /not leading with captured body font "Lato"/i.test(i))).toBe(true);
    expect(deadGameAudit.issues.some((i) => /No CORS-safe.*Playfair Display/i.test(i))).toBe(true);
    expect(deadGameAudit.issues.some((i) => /Primary brand accent #D43821/i.test(i))).toBe(true);
    expect(deadGameAudit.issues.some((i) => /visible border framing/i.test(i))).toBe(true);
    expect(deadGameAudit.issues.some((i) => /CTA button contrast too low/i.test(i))).toBe(true);
  });
});
