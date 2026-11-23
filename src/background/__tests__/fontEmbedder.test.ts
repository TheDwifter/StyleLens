import { describe, expect, it, vi } from 'vitest';
import type { RawDomExtraction } from '../../types/capture';
import {
  arrayBufferToBase64,
  parseCssFontMetadata,
  resolveAndEmbedWebfonts,
  unicodeRangeCoversBasicLatin,
} from '../fontEmbedder';

const FAKE_WOFF2_BYTES = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00, 0x41, 0x42]);

function makeBaseDom(overrides: Partial<RawDomExtraction> = {}): RawDomExtraction {
  return {
    captureMode: 'dom-and-visual',
    selectionMethod: 'marquee',
    totalNodesScanned: 1,
    truncated: false,
    roots: [],
    cssVariables: [],
    fontStylesheetUrls: [],
    pageStylesheetUrls: [],
    fontFaceRules: [],
    loadedFontFamilies: [],
    pageFallbackTypography: [],
    ...overrides,
  };
}

describe('fontEmbedder (MV3 CORS-free webfont embedding)', () => {
  it('correctly distinguishes basic Latin unicode-range subsets from Cyrillic/Vietnamese subsets', () => {
    expect(unicodeRangeCoversBasicLatin(undefined)).toBe(true);
    expect(unicodeRangeCoversBasicLatin('U+0000-00FF, U+0131, U+0152-0153')).toBe(true);
    expect(unicodeRangeCoversBasicLatin('U+00??')).toBe(true);
    expect(unicodeRangeCoversBasicLatin('U+0460-052F, U+1C80-1C88')).toBe(false);
    expect(unicodeRangeCoversBasicLatin('U+0102-0103, U+0110-0111, U+1EA0-1EF9')).toBe(false);
  });

  it('fetches cross-origin theme CSS + @import, picks Latin woff2 over Cyrillic, and embeds base64 @font-face', async () => {
    const themeCss = `
      @import url("./fonts/brand-fonts.css");
      body { color: #fff; }
    `;
    const brandFontsCss = `
      /* cyrillic-ext */
      @font-face {
        font-family: 'Oswald';
        font-style: normal;
        font-weight: 700;
        src: url("../webfonts/oswald-cyrillic.woff2") format("woff2");
        unicode-range: U+0460-052F;
      }
      /* latin */
      @font-face {
        font-family: 'Oswald';
        font-style: normal;
        font-weight: 700;
        src: url("../webfonts/oswald-latin.woff2") format("woff2"),
             url("../webfonts/oswald-latin.ttf") format("truetype");
        unicode-range: U+0000-00FF;
      }
    `;

    const fetchedUrls: string[] = [];
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchedUrls.push(url);
      if (url === 'https://cdn.bonesbearings.com/assets/theme.css') {
        return new Response(themeCss, {
          status: 200,
          headers: { 'content-type': 'text/css' },
        });
      }
      if (url === 'https://cdn.bonesbearings.com/assets/fonts/brand-fonts.css') {
        return new Response(brandFontsCss, {
          status: 200,
          headers: { 'content-type': 'text/css' },
        });
      }
      if (url === 'https://cdn.bonesbearings.com/assets/webfonts/oswald-latin.woff2') {
        return new Response(FAKE_WOFF2_BYTES, {
          status: 200,
          headers: { 'content-type': 'font/woff2' },
        });
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    // Artwork capture with 0 live text in selection, relying on pageFallbackTypography!
    const dom = makeBaseDom({
      containsGraphicArtwork: true,
      pageStylesheetUrls: ['https://cdn.bonesbearings.com/assets/theme.css'],
      pageFallbackTypography: [
        {
          primaryFont: 'Oswald',
          fontStack: '"Oswald", Arial, sans-serif',
          fontSizePx: 36,
          fontWeight: 700,
          lineHeightPx: 40,
          lineHeightRatio: 1.11,
          letterSpacing: '0.02em',
          role: 'display',
          sampleText: 'BONES REDS',
          usageCount: 2,
        },
      ],
    });

    const result = await resolveAndEmbedWebfonts(dom, 'https://bonesbearings.com/', {
      fetchFn: mockFetch,
    });

    expect(result.embeddedCount).toBe(1);
    expect(result.embeddedFamilies).toEqual(['Oswald']);
    expect(fetchedUrls).toContain('https://cdn.bonesbearings.com/assets/webfonts/oswald-latin.woff2');
    expect(fetchedUrls).not.toContain(
      'https://cdn.bonesbearings.com/assets/webfonts/oswald-cyrillic.woff2'
    );
    expect(result.fontFaceRules[0]).toContain('font-family: "Oswald"');
    expect(result.fontFaceRules[0]).toContain('url("data:font/woff2;base64,');
    expect(result.fontFaceRules[0]).toContain('format("woff2")');
  });

  it('aliases Next.js / Webpack hashed @font-face names to clean family names too', async () => {
    const nextCss = `
      @font-face {
        font-family: "__Space_Grotesk_a1b2c3";
        font-style: normal;
        font-weight: 300 700;
        src: url("/_next/static/media/space-grotesk.woff2") format("woff2");
      }
    `;

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('.css')) {
        return new Response(nextCss, { status: 200, headers: { 'content-type': 'text/css' } });
      }
      return new Response(FAKE_WOFF2_BYTES, { status: 200, headers: { 'content-type': 'font/woff2' } });
    }) as unknown as typeof fetch;

    const dom = makeBaseDom({
      pageStylesheetUrls: ['https://example.com/_next/static/css/app.css'],
      loadedFontFamilies: ['__Space_Grotesk_a1b2c3'],
    });

    const result = await resolveAndEmbedWebfonts(dom, 'https://example.com/', {
      fetchFn: mockFetch,
    });

    expect(result.embeddedCount).toBe(1);
    expect(result.fontFaceRules.some((r) => r.includes('font-family: "__Space_Grotesk_a1b2c3"'))).toBe(
      true
    );
    expect(result.fontFaceRules.some((r) => r.includes('font-family: "Space Grotesk"'))).toBe(true);
    expect(result.fontFaceRules.every((r) => r.includes('data:font/woff2;base64,'))).toBe(true);
  });

  it('rejects WAF/soft-404 text/html responses pretending to be font binaries and enforces byte budgets', async () => {
    const css = `
      @font-face {
        font-family: "HM Sans";
        font-weight: 700;
        src: url("https://assets.hm.com/hm-sans.woff2") format("woff2");
      }
      @font-face {
        font-family: "HugeFont";
        font-weight: 400;
        src: url("https://assets.hm.com/huge.woff2") format("woff2");
      }
    `;

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('.css')) {
        return new Response(css, { status: 200, headers: { 'content-type': 'text/css' } });
      }
      if (url.includes('hm-sans')) {
        return new Response('<!doctype html><html>Blocked</html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      return new Response(new Uint8Array(250_000), {
        status: 200,
        headers: { 'content-type': 'font/woff2' },
      });
    }) as unknown as typeof fetch;

    const dom = makeBaseDom({
      pageStylesheetUrls: ['https://assets.hm.com/main.css'],
      loadedFontFamilies: ['HM Sans', 'HugeFont'],
    });

    const result = await resolveAndEmbedWebfonts(dom, 'https://www2.hm.com/', {
      fetchFn: mockFetch,
      maxSingleFontBytes: 180_000,
    });

    expect(result.embeddedCount).toBe(0);
    expect(result.fontFaceRules).toEqual([]);
  });

  it('ignores CSS comments when parsing @font-face declarations', () => {
    const parsed = parseCssFontMetadata(
      `/* @font-face { font-family: "FakeFont"; src: url("fake.woff2"); } */
       @font-face { font-family: "RealFont"; font-weight: bold; src: url("/fonts/real.woff2") format("woff2"); }`,
      'https://site.dev/css/app.css'
    );
    expect(parsed.fontFaces).toHaveLength(1);
    expect(parsed.fontFaces[0]?.cleanFamily).toBe('RealFont');
    expect(parsed.fontFaces[0]?.fontWeight).toBe('700');
    expect(parsed.fontFaces[0]?.sources[0]?.url).toBe('https://site.dev/fonts/real.woff2');
  });

  it('preserves inline data:*;charset=utf-8;base64,... @font-face URIs (no semicolon truncation) and variable weights 100 1000', async () => {
    const b64 = arrayBufferToBase64(FAKE_WOFF2_BYTES.buffer);
    const inlineCss = `
      @font-face {
        font-family: "InlineBrand";
        font-weight: 100 1000;
        src: url("data:font/woff2;charset=utf-8;base64,${b64}") format("woff2"),
             url("https://cdn.site.dev/fallback.woff2") format("woff2");
      }
    `;

    const parsed = parseCssFontMetadata(inlineCss, 'https://site.dev/');
    expect(parsed.fontFaces).toHaveLength(1);
    expect(parsed.fontFaces[0]?.fontWeight).toBe('100 1000');
    expect(parsed.fontFaces[0]?.sources).toHaveLength(2);
    expect(parsed.fontFaces[0]?.sources[0]?.isDataUri).toBe(true);
    expect(parsed.fontFaces[0]?.sources[0]?.url).toContain(`base64,${b64}`);

    const dom = makeBaseDom({
      fontFaceRules: [inlineCss],
      loadedFontFamilies: ['InlineBrand'],
    });
    const result = await resolveAndEmbedWebfonts(dom, 'https://site.dev/', {
      fetchFn: vi.fn() as unknown as typeof fetch,
    });
    expect(result.embeddedCount).toBe(1);
    expect(result.fontFaceRules[0]).toContain('font-weight: 100 1000;');
    expect(result.fontFaceRules[0]).toContain(`base64,${b64}`);
  });

  it('handles >450KB Shopify/Next.js CSS bundles, >90KB Next.js hashed font aliases, and magic-byte TTF sniffing', async () => {
    const padding = '/*p*/'.repeat(110_000); // ~550KB stylesheet
    const bigCss = `${padding}
      @font-face {
        font-family: "__Display_Hero_f1e2d3";
        font-weight: 400 900;
        src: url("https://cdn.shop.dev/font-endpoint-no-ext");
      }
    `;
    // 110KB fake TrueType font (magic bytes 0x00 0x01 0x00 0x00)
    const bigTtf = new Uint8Array(110_000);
    bigTtf[0] = 0x00;
    bigTtf[1] = 0x01;
    bigTtf[2] = 0x00;
    bigTtf[3] = 0x00;

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('.css')) {
        return new Response(bigCss, { status: 200, headers: { 'content-type': 'text/css' } });
      }
      return new Response(bigTtf, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    }) as unknown as typeof fetch;

    const dom = makeBaseDom({
      pageStylesheetUrls: ['https://cdn.shop.dev/_next/static/css/9a8b7c6d.css'],
      loadedFontFamilies: ['__Display_Hero_f1e2d3'],
    });

    const result = await resolveAndEmbedWebfonts(dom, 'https://shop.dev/', {
      fetchFn: mockFetch,
    });

    expect(result.embeddedCount).toBe(1);
    // Clean alias MUST still be emitted even when font is >90KB, and magic-byte sniffing detects TrueType!
    expect(result.fontFaceRules.some((r) => r.includes('font-family: "Display Hero"'))).toBe(true);
    expect(result.fontFaceRules[0]).toContain('data:font/ttf;base64,');
    expect(result.fontFaceRules[0]).toContain('format("truetype")');
  });
});
