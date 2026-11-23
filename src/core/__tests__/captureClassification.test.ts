import { describe, expect, it } from 'vitest';
import type { ExtractedNode, TypographyToken } from '../../types/capture';
import { canRenderLiveFontPreview } from '../captureClassification';

type PreviewInput = Parameters<typeof canRenderLiveFontPreview>[0];

function node(tag: string, width: number, height: number): ExtractedNode {
  return {
    tag,
    rect: { x: 0, y: 0, width, height },
    styles: {},
    children: [],
  } as unknown as ExtractedNode;
}

function typo(primaryFont: string): TypographyToken {
  return { primaryFont } as unknown as TypographyToken;
}

function capture(overrides: {
  hostname: string;
  roots?: ExtractedNode[];
  typography?: TypographyToken[];
  containsGraphicArtwork?: boolean;
  captureMode?: string;
}): PreviewInput {
  return {
    containsGraphicArtwork: overrides.containsGraphicArtwork ?? false,
    captureMode: overrides.captureMode ?? 'dom',
    page: { hostname: overrides.hostname },
    rect: { x: 0, y: 0, width: 468, height: 328 },
    roots: overrides.roots ?? [],
    dna: { typography: overrides.typography ?? [] },
  } as unknown as PreviewInput;
}

/**
 * Step 2 may only show the HTML/CSS "live word" preview when it can render the user's word in
 * the font that was actually captured. On a raster logo (a logo found on an image search page)
 * there is no webfont — the preview fell back to generic sans-serif and looked plain wrong.
 */
describe('canRenderLiveFontPreview (Step 2 preview honesty gate)', () => {
  it('is false for a raster logo picked on Google Images (Disney+ -> "Record")', () => {
    expect(
      canRenderLiveFontPreview(
        capture({
          hostname: 'www.google.com',
          roots: [node('img', 440, 300)],
          typography: [typo('Google Sans')],
        })
      )
    ).toBe(false);
  });

  it('is false for baked graphic artwork and visual-only captures on brand sites', () => {
    expect(
      canRenderLiveFontPreview(
        capture({
          hostname: 'www.disneyplus.com',
          containsGraphicArtwork: true,
          typography: [typo('Avenir Next')],
        })
      )
    ).toBe(false);
    expect(
      canRenderLiveFontPreview(
        capture({ hostname: 'pepsi.ca', captureMode: 'visual-only', typography: [typo('Pepsi Owners')] })
      )
    ).toBe(false);
  });

  it('is false when no typography was captured at all (nothing honest to render)', () => {
    expect(canRenderLiveFontPreview(capture({ hostname: 'uwo.ca', typography: [] }))).toBe(false);
  });

  it('is true for live DOM text with a real captured brand font', () => {
    expect(
      canRenderLiveFontPreview(
        capture({
          hostname: 'www.pepsi.ca',
          roots: [node('h1', 300, 80)],
          typography: [typo('Pepsi Owners')],
        })
      )
    ).toBe(true);
  });
});
