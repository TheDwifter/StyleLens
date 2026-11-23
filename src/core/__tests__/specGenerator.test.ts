import { describe, expect, it } from 'vitest';
import { analyzeDesignDNA } from '../designAnalyzer';
import {
  generateCaptureReport,
  generateCompleteAgentPrompt,
  generateCssTokens,
  generateDesignDnaReport,
  generateDesignSpecJson,
  generateRemixPrompt,
  generateSimplifiedHtml,
  generateStructureReport,
  generateTailwindTheme,
} from '../specGenerator';
import type { CaptureRecord, RawDomExtraction } from '../../types/capture';

function buildFixtureRecord(): CaptureRecord {
  const dom: RawDomExtraction = {
    captureMode: 'dom-and-visual',
    selectionMethod: 'marquee',
    totalNodesScanned: 2,
    truncated: false,
    cssVariables: [],
    roots: [
      {
        id: 'n1',
        tag: 'nav',
        cleanClasses: ['top-nav'],
        omittedHashedClassCount: 0,
        rect: { x: 0, y: 0, width: 960, height: 64 },
        styles: {
          display: 'flex',
          position: 'sticky',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '24px',
          padding: '16px 24px',
          width: '960px',
          height: '64px',
          backgroundColor: 'rgb(10, 10, 12)',
          border: '1px solid rgb(39, 39, 42)',
          borderRadius: '12px',
        },
        effectiveBackgroundHex: '#0A0A0C',
        hasNonSolidBackgroundAncestor: false,
        pseudoElements: [],
        children: [
          {
            id: 'n2',
            tag: 'a',
            cleanClasses: ['brand'],
            omittedHashedClassCount: 0,
            textSnippet: 'Linearity',
            rect: { x: 24, y: 20, width: 80, height: 24 },
            styles: {
              display: 'inline-block',
              position: 'static',
              width: '80px',
              height: '24px',
              color: 'rgb(250, 250, 250)',
              fontFamily: '"Geist", sans-serif',
              fontSize: '15px',
              fontWeight: '600',
              lineHeight: '24px',
            },
            effectiveBackgroundHex: '#0A0A0C',
            hasNonSolidBackgroundAncestor: false,
            pseudoElements: [],
            children: [],
          },
        ],
      },
    ],
  };

  const rect = { x: 0, y: 0, width: 960, height: 64 };
  const dna = analyzeDesignDNA(dom, [], rect);

  return {
    id: 'cap-1',
    createdAt: 1763700000000,
    page: {
      url: 'https://example.design/navbar',
      hostname: 'example.design',
      title: 'Example Design',
    },
    rect,
    viewport: { width: 1440, height: 900, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    captureMode: 'dom-and-visual',
    selectionMethod: 'marquee',
    totalNodesScanned: 2,
    truncated: false,
    screenshotBlob: new Blob(['fake'], { type: 'image/png' }),
    screenshotWidth: 1920,
    screenshotHeight: 128,
    roots: dom.roots,
    dna,
  };
}

describe('specGenerator', () => {
  it('generates valid CSS tokens, Tailwind v4 @theme, JSON spec, skeleton HTML, and Remix Prompt', () => {
    const record = buildFixtureRecord();

    const css = generateCssTokens(record);
    expect(css).toContain(':root {');
    expect(css).toContain('--sl-color-background: #0A0A0C;');
    expect(css).toContain('--sl-font-sans: "Geist", sans-serif;');

    const tw = generateTailwindTheme(record);
    expect(tw).toContain('@theme {');
    expect(tw).toContain('--color-sl-background: #0A0A0C;');

    const html = generateSimplifiedHtml(record.roots);
    expect(html).toContain('<nav class="top-nav" data-layout="flex:row gap:24px">');
    expect(html).toContain('<a class="brand">Linearity</a>');

    const parsedJson = JSON.parse(generateDesignSpecJson(record)) as {
      schemaVersion: string;
      designDna: { polarity: string };
    };
    expect(parsedJson.schemaVersion).toBe('1.0.0');
    expect(parsedJson.designDna.polarity).toBe('dark');

    const prompt = generateRemixPrompt(record, 'Build an AI command bar', 'react-tailwind');
    expect(prompt).toContain('Build an AI command bar');
    expect(prompt).toContain('React + TypeScript + Tailwind CSS');
    expect(prompt).toContain('#0A0A0C');
    expect(prompt).toContain('Do **not** copy original brand names');

    const capReport = generateCaptureReport(record);
    expect(capReport).toContain('# StyleLens Capture Report');
    expect(capReport).toContain('960×64px');

    const dnaReport = generateDesignDnaReport(record);
    expect(dnaReport).toContain('# StyleLens Design DNA Report');
    expect(dnaReport).toContain('## WCAG 2.1 Contrast Audit');

    const structReport = generateStructureReport(record);
    expect(structReport).toContain('# StyleLens Structure & Computed CSS Report');
    expect(structReport).toContain('<nav class="top-nav"');

    const fullPrompt = generateCompleteAgentPrompt(record);
    expect(fullPrompt).toContain('# StyleLens 1-to-1 X-Ray Style Replication Spec');
    expect(fullPrompt).toContain('## X-Ray Spatial Visual Layout Map');
    expect(fullPrompt).toContain('## STRICT DO-NOT-INVENT RULES');
    expect(fullPrompt).toContain('## Exact Colors');
    expect(fullPrompt).toContain('## Exact Typography');
    expect(fullPrompt).toContain('## Exact CSS Custom Properties');
    expect(fullPrompt).toContain('## Verified 1-to-1 HTML + Scoped CSS Blueprint');
  });

  it('handles legacy IndexedDB records missing newer surface arrays without throwing', () => {
    const legacy = buildFixtureRecord();
    // Simulate a pre-v0.7.0 saved record where textShadows/transforms/clipPaths were undefined
    const rawSurfaces = legacy.dna.surfaces as unknown as Record<string, unknown>;
    delete rawSurfaces.textShadows;
    delete rawSurfaces.transforms;
    delete rawSurfaces.clipPaths;

    expect(() => generateDesignDnaReport(legacy)).not.toThrow();
    expect(() => generateCompleteAgentPrompt(legacy)).not.toThrow();
  });
});
