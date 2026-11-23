import { describe, expect, it } from 'vitest';
import {
  extractTransparentWordmarkFromRgba,
  splitMasterImageRgba,
  traceWordmarkRgbaToVectorSvg,
} from '../imageLayerProcessor';

function createBuffer(
  width: number,
  height: number,
  fill: [number, number, number, number]
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    buf[o] = fill[0];
    buf[o + 1] = fill[1];
    buf[o + 2] = fill[2];
    buf[o + 3] = fill[3];
  }
  return buf;
}

function setPx(
  buf: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  rgba: [number, number, number, number]
) {
  const o = (y * width + x) * 4;
  buf[o] = rgba[0];
  buf[o + 1] = rgba[1];
  buf[o + 2] = rgba[2];
  buf[o + 3] = rgba[3];
}

function getPx(buf: Uint8ClampedArray, width: number, x: number, y: number) {
  const o = (y * width + x) * 4;
  return { r: buf[o]!, g: buf[o + 1]!, b: buf[o + 2]!, a: buf[o + 3]! };
}

function fillRect(
  buf: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgba: [number, number, number, number]
) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      setPx(buf, width, x, y, rgba);
    }
  }
}

describe('imageLayerProcessor (5-Stage Transparent PNG Alpha-Matting Engine)', () => {
  it('1. clears white backdrop, clears O counter hole, and de-fringes anti-aliased gray edges on black lettering (e.g. Pepsi Rots)', () => {
    const w = 100;
    const h = 80;
    const buf = createBuffer(w, h, [255, 255, 255, 255]);

    // Draw a solid black "O" with thick walls (10px stroke) and an enclosed white counter hole (x=40..59, y=30..49)
    fillRect(buf, w, 30, 20, 69, 59, [10, 10, 10, 255]);
    fillRect(buf, w, 40, 30, 59, 49, [255, 255, 255, 255]);

    // Add a 1px 16%-opaque simulated anti-aliased gray outer fringe (blended black over white: 0.16*10 + 0.84*255 ≈ 216)
    for (let x = 30; x <= 69; x++) {
      setPx(buf, w, x, 19, [222, 222, 222, 255]);
      setPx(buf, w, x, 60, [222, 222, 222, 255]);
    }

    const res = extractTransparentWordmarkFromRgba(buf, w, h);
    expect(res.applied).toBe(true);
    expect(res.backdropIsLight).toBe(true);
    expect(res.holesCleared).toBeGreaterThanOrEqual(1);

    // Exterior corner is transparent
    expect(getPx(res.data, w, 4, 4).a).toBe(0);
    // Solid black stroke stays 100% opaque
    expect(getPx(res.data, w, 34, 34).a).toBe(255);
    expect(getPx(res.data, w, 34, 34).r).toBeLessThan(20);
    // Inner "O" counter hole is cleanly cleared to transparent!
    expect(getPx(res.data, w, 50, 40).a).toBe(0);
    // Anti-aliased outer fringe pixel is semi-transparent AND de-fringed away from frosty white!
    const edgePx = getPx(res.data, w, 50, 19);
    expect(edgePx.a).toBeGreaterThan(0);
    expect(edgePx.a).toBeLessThan(255);
    expect(edgePx.r).toBeLessThan(65);
  });

  it('2. clears black backdrop, clears enclosed counter hole, and de-fringes bright white lettering', () => {
    const w = 100;
    const h = 80;
    const buf = createBuffer(w, h, [0, 0, 0, 255]);

    // Draw bright white "O" with dark inner hole
    fillRect(buf, w, 28, 18, 71, 61, [250, 250, 250, 255]);
    fillRect(buf, w, 40, 30, 59, 49, [0, 0, 0, 255]);

    // 1px soft anti-aliased fringe (dark gray ~30 over pure black)
    for (let x = 28; x <= 71; x++) {
      setPx(buf, w, x, 17, [30, 30, 30, 255]);
    }

    const res = extractTransparentWordmarkFromRgba(buf, w, h);
    expect(res.applied).toBe(true);
    expect(res.backdropIsLight).toBe(false);
    expect(res.holesCleared).toBeGreaterThanOrEqual(1);

    expect(getPx(res.data, w, 3, 3).a).toBe(0);
    expect(getPx(res.data, w, 32, 32).a).toBe(255);
    expect(getPx(res.data, w, 50, 40).a).toBe(0);
    // De-fringed edge recovers bright foreground instead of muddy dark gray!
    const edgePx = getPx(res.data, w, 50, 17);
    expect(edgePx.a).toBeGreaterThan(0);
    expect(edgePx.a).toBeLessThan(255);
    expect(edgePx.r).toBeGreaterThan(200);
  });

  it('3. preserves white sticker outlines around black letters on a neutral gray (#808080) backdrop while clearing the gray counter hole', () => {
    const w = 100;
    const h = 80;
    const buf = createBuffer(w, h, [128, 128, 128, 255]);

    // White sticker outline -> Black letter body -> White inner rim -> Gray center counter hole
    fillRect(buf, w, 24, 16, 75, 63, [255, 255, 255, 255]);
    fillRect(buf, w, 29, 21, 70, 58, [12, 12, 12, 255]);
    fillRect(buf, w, 39, 31, 60, 48, [255, 255, 255, 255]);
    fillRect(buf, w, 43, 35, 56, 44, [128, 128, 128, 255]);

    const res = extractTransparentWordmarkFromRgba(buf, w, h);
    expect(res.applied).toBe(true);
    expect(getPx(res.data, w, 2, 2).a).toBe(0); // Exterior gray cleared
    expect(getPx(res.data, w, 26, 26).a).toBe(255); // White sticker outline 100% preserved!
    expect(getPx(res.data, w, 33, 33).a).toBe(255); // Black letter body 100% preserved!
    expect(getPx(res.data, w, 41, 40).a).toBe(255); // Inner white rim 100% preserved!
    expect(getPx(res.data, w, 50, 40).a).toBe(0); // Gray center hole cleared!
  });

  it('4. adversarial shield: preserves white-filled outlined O + I on #FFFFFF while clearing only the depth-2 inner O counter', () => {
    const w = 140;
    const h = 80;
    const buf = createBuffer(w, h, [255, 255, 255, 255]);

    // Letter "O": 3px black outer border -> white letter fill -> 3px black inner border -> white depth-2 counter hole
    fillRect(buf, w, 16, 14, 68, 66, [0, 0, 0, 255]);
    fillRect(buf, w, 19, 17, 65, 63, [255, 255, 255, 255]);
    fillRect(buf, w, 31, 29, 53, 51, [0, 0, 0, 255]);
    fillRect(buf, w, 34, 32, 50, 48, [255, 255, 255, 255]);

    // Letter "I": 3px black outer border -> white letter fill (non-loop outlined letter)
    fillRect(buf, w, 86, 14, 114, 66, [0, 0, 0, 255]);
    fillRect(buf, w, 89, 17, 111, 63, [255, 255, 255, 255]);

    const res = extractTransparentWordmarkFromRgba(buf, w, h);
    expect(res.applied).toBe(true);
    // Exterior white is transparent
    expect(getPx(res.data, w, 4, 4).a).toBe(0);
    // White fill of "O" is PRESERVED (Depth-2 Nested-Island Shield!)
    expect(getPx(res.data, w, 24, 40).a).toBe(255);
    // White fill of "I" is PRESERVED (Thin-Wall + Fill-Dominance Shield!)
    expect(getPx(res.data, w, 100, 40).a).toBe(255);
    // Depth-2 inner hole of "O" IS cleanly cleared to transparent!
    expect(getPx(res.data, w, 42, 40).a).toBe(0);
  });

  it('5. handles subtle diffusion vignetting AND cleans up an isolated bottom-right sparkle watermark dot', () => {
    const w = 120;
    const h = 100;
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Gentle vignette: #FFFFFF top-left -> #F2F2F2 bottom-right
        const v = Math.round(255 - 12 * ((x / w + y / h) / 2));
        setPx(buf, w, x, y, [v, v, v, 255]);
      }
    }
    // Centered dark wordmark
    fillRect(buf, w, 28, 32, 86, 62, [15, 15, 20, 255]);
    // Tiny isolated 4x4 Gemini sparkle dot in bottom-right corner ([0.90W..W, 0.90H..H])
    fillRect(buf, w, 113, 93, 116, 96, [120, 120, 130, 255]);

    const res = extractTransparentWordmarkFromRgba(buf, w, h);
    expect(res.applied).toBe(true);
    expect(getPx(res.data, w, 3, 3).a).toBe(0);
    expect(getPx(res.data, w, 118, 2).a).toBe(0);
    expect(getPx(res.data, w, 55, 48).a).toBe(255); // Main wordmark preserved
    expect(getPx(res.data, w, 114, 94).a).toBe(0); // Isolated BR watermark removed!
  });

  it('6. cleanly rejects multi-color photo scenes (never corrupts a Pepsi can photo!)', () => {
    const w = 100;
    const h = 80;
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Red top-left, blue top-right, metallic gray bottom-left, dark navy bottom-right
        const color: [number, number, number, number] =
          y < h / 2
            ? x < w / 2
              ? [210, 30, 40, 255]
              : [15, 65, 185, 255]
            : x < w / 2
              ? [180, 185, 195, 255]
              : [8, 18, 60, 255];
        setPx(buf, w, x, y, color);
      }
    }

    const res = extractTransparentWordmarkFromRgba(buf, w, h);
    expect(res.applied).toBe(false);
    expect(res.reason).toBe('corner-mismatch');
    // Original pixels completely untouched
    expect(getPx(res.data, w, 5, 5)).toEqual({ r: 210, g: 30, b: 40, a: 255 });
  });

  it('7. cleanly skips images that are already transparent', () => {
    const w = 64;
    const h = 64;
    const buf = createBuffer(w, h, [0, 0, 0, 0]);
    fillRect(buf, w, 20, 20, 44, 44, [255, 50, 50, 255]);

    const res = extractTransparentWordmarkFromRgba(buf, w, h);
    expect(res.applied).toBe(false);
    expect(res.reason).toBe('already-transparent');
  });

  it('8. uses 4-connected exterior BFS so thin 1px diagonal strokes enclosing a tinted fill NEVER leak', () => {
    const w = 80;
    const h = 80;
    const buf = createBuffer(w, h, [255, 255, 255, 255]);

    // Draw a 1px-thick black diamond outline enclosing a distinct tinted cream/gold interior (#FFF2CC)
    const cx = 40;
    const cy = 40;
    const rad = 18;
    for (let y = cy - rad; y <= cy + rad; y++) {
      for (let x = cx - rad; x <= cx + rad; x++) {
        const manhattan = Math.abs(x - cx) + Math.abs(y - cy);
        if (manhattan === rad) {
          setPx(buf, w, x, y, [0, 0, 0, 255]);
        } else if (manhattan < rad) {
          // Pale tinted gold interior that could be damaged if exterior BFS leaked diagonally!
          setPx(buf, w, x, y, [255, 232, 160, 255]);
        }
      }
    }

    const res = extractTransparentWordmarkFromRgba(buf, w, h);
    expect(res.applied).toBe(true);
    expect(getPx(res.data, w, 5, 5).a).toBe(0); // Exterior cleared
    expect(getPx(res.data, w, cx, cy).a).toBe(255); // Enclosed tinted interior 100% protected!
  });

  it('9. preserves 1px–2px hairline thin strokes and 1px dark outlines (never aborts as empty-or-solid-image) while still clearing holes & de-fringing', () => {
    const w = 120;
    const h = 80;
    const buf = createBuffer(w, h, [255, 255, 255, 255]);

    // 2px-thick hairline letter "T" (EVERY stroke pixel touches exterior white!)
    fillRect(buf, w, 18, 20, 48, 21, [12, 12, 12, 255]); // 2px top bar
    fillRect(buf, w, 32, 22, 33, 58, [12, 12, 12, 255]); // 2px vertical stem
    // 1px 50% anti-aliased gray fringe along top of the 2px bar
    for (let x = 18; x <= 48; x++) {
      setPx(buf, w, x, 19, [134, 134, 134, 255]);
    }

    // 1px-thick hairline dark box "O" enclosing an interior white counter hole
    fillRect(buf, w, 66, 20, 96, 58, [12, 12, 12, 255]);
    fillRect(buf, w, 67, 21, 95, 57, [255, 255, 255, 255]);

    const res = extractTransparentWordmarkFromRgba(buf, w, h);
    expect(res.applied).toBe(true);
    // Exterior cleared
    expect(getPx(res.data, w, 4, 4).a).toBe(0);
    // 2px hairline "T" stem & bar stay 100% solid opaque!
    expect(getPx(res.data, w, 32, 40).a).toBe(255);
    expect(getPx(res.data, w, 25, 20).a).toBe(255);
    // 1px anti-aliased fringe along the 2px hairline bar is semi-transparent AND de-fringed dark!
    const fringe = getPx(res.data, w, 25, 19);
    expect(fringe.a).toBeGreaterThan(20);
    expect(fringe.a).toBeLessThan(240);
    expect(fringe.r).toBeLessThan(50);
    // 1px dark outline "O" wall stays 100% opaque!
    expect(getPx(res.data, w, 66, 40).a).toBe(255);
  });

  it('10. 0-Token Master Splitter (top emblem + bottom wordmark, e.g. Alibaba -> Ali way): separates bottom letters into fontData, keeps top emblem in backgroundData, and inpaints orange surface', () => {
    const w = 140;
    const h = 100;
    const buf = createBuffer(w, h, [230, 85, 37, 255]); // Alibaba orange #E65525

    // Top white brand emblem (x=55..82, y=14..34)
    fillRect(buf, w, 55, 14, 82, 34, [255, 255, 255, 255]);

    // Bottom 4-letter horizontal wordmark (y=62..78)
    fillRect(buf, w, 24, 62, 36, 78, [255, 255, 255, 255]); // L1
    fillRect(buf, w, 46, 62, 58, 78, [255, 255, 255, 255]); // L2
    fillRect(buf, w, 68, 62, 80, 78, [255, 255, 255, 255]); // L3
    fillRect(buf, w, 90, 62, 102, 78, [255, 255, 255, 255]); // L4

    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'Aliw' });
    expect(split.applied).toBe(true);
    expect(split.emblemsPreservedCount).toBeGreaterThanOrEqual(1);

    // Font layer contains the bottom letters (opaque white) and EXCLUDES the top emblem!
    expect(getPx(split.fontData, w, 30, 70).a).toBe(255);
    expect(getPx(split.fontData, w, 74, 70).a).toBe(255);
    expect(getPx(split.fontData, w, 68, 24).a).toBe(0); // Top emblem NOT in font cutout!

    // Background layer PRESERVES the top white emblem and INPAINTS the bottom letters to orange!
    const emblemBgPx = getPx(split.backgroundData, w, 68, 24);
    expect(emblemBgPx.r).toBeGreaterThan(240);
    expect(emblemBgPx.g).toBeGreaterThan(240);
    const inpaintedLetterPx = getPx(split.backgroundData, w, 30, 70);
    expect(inpaintedLetterPx.r).toBeGreaterThan(200);
    expect(inpaintedLetterPx.g).toBeLessThan(120); // Orange, not white!
  });

  it('11. 0-Token Master Splitter (same-Y-band side-by-side emblem + stencil wordmark, e.g. Red tree + Apple): peels left emblem and extracts only the 5 letters', () => {
    const w = 180;
    const h = 80;
    const buf = createBuffer(w, h, [255, 255, 255, 255]);

    // Left oversized circular/tree emblem on the SAME Y-band (x=12..44, y=18..62 -> 33x45)
    fillRect(buf, w, 12, 18, 44, 62, [184, 51, 26, 255]);

    // Right 5-letter wordmark "Apple" (y=28..52 -> height 25, separated by gap)
    const letterStarts = [64, 84, 104, 124, 144];
    for (const lx of letterStarts) {
      fillRect(buf, w, lx, 28, lx + 12, 52, [184, 51, 26, 255]);
    }

    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'Apple' });
    expect(split.applied).toBe(true);
    expect(split.emblemsPreservedCount).toBe(1);

    // Left emblem is excluded from fontData and preserved in backgroundData!
    expect(getPx(split.fontData, w, 25, 40).a).toBe(0);
    expect(getPx(split.backgroundData, w, 25, 40).r).toBe(184);
    expect(getPx(split.backgroundData, w, 25, 40).g).toBe(51);

    // Right "Apple" letters are extracted into fontData and inpainted to white in backgroundData!
    expect(getPx(split.fontData, w, 70, 40).a).toBe(255);
    expect(getPx(split.backgroundData, w, 70, 40).g).toBeGreaterThan(235);
  });

  it('12. Sub-Pixel Vector <path> SVG Tracer: converts transparent wordmark RGBA into standalone <svg> with quadratic Bezier <path d="M... Q... Z" fill-rule="evenodd"/> and zero <image> tags', () => {
    const w = 120;
    const h = 70;
    const rgba = createBuffer(w, h, [0, 0, 0, 0]);

    // Letter "O" with transparent inner hole in red #D93025
    fillRect(rgba, w, 18, 14, 54, 54, [217, 48, 37, 255]);
    fillRect(rgba, w, 28, 24, 44, 44, [0, 0, 0, 0]);

    // Letter "I" in red #D93025
    fillRect(rgba, w, 72, 14, 88, 54, [217, 48, 37, 255]);

    const svg = traceWordmarkRgbaToVectorSvg(rgba, w, h);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 70"');
    expect(svg).toContain('fill="#D93025"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toMatch(/<path d="M [^"]+ Q [^"]+ Z"/);
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('data:image');
  });

  it('13. Same-prefix replacement ("Alibaba" -> "Ali way") with compatible originalData NEVER amputates the leading letter "A"', () => {
    const w = 180;
    const h = 90;
    const orig = createBuffer(w, h, [230, 85, 37, 255]);
    const master = createBuffer(w, h, [230, 85, 37, 255]);

    // Top white brand emblem present in BOTH original and master
    fillRect(orig, w, 72, 10, 102, 28, [255, 255, 255, 255]);
    fillRect(master, w, 72, 10, 102, 28, [255, 255, 255, 255]);

    // Leading "A" at x=20..32, y=54..72 present identically in BOTH original ("Alibaba") and master ("Ali way")!
    fillRect(orig, w, 20, 54, 32, 72, [255, 255, 255, 255]);
    fillRect(master, w, 20, 54, 32, 72, [255, 255, 255, 255]);

    // Remaining 5 letters of "Ali way" at x=42, 62, 86, 108, 130 (changed from original!)
    const restStarts = [42, 62, 86, 108, 130];
    for (const lx of restStarts) {
      fillRect(master, w, lx, 54, lx + 12, 72, [255, 255, 255, 255]);
    }

    const split = splitMasterImageRgba(master, w, h, {
      targetWord: 'Ali way',
      originalData: orig,
      originalWidth: w,
      originalHeight: h,
    });
    expect(split.applied).toBe(true);
    // Leading "A" MUST be preserved in fontData (alpha=255) and erased from backgroundData!
    expect(getPx(split.fontData, w, 26, 63).a).toBe(255);
    expect(getPx(split.backgroundData, w, 26, 63).g).toBeLessThan(120);
    // Top emblem MUST stay excluded from fontData and preserved in backgroundData!
    expect(getPx(split.fontData, w, 86, 18).a).toBe(0);
    expect(getPx(split.backgroundData, w, 86, 18).g).toBeGreaterThan(240);
  });

  it('14. Diacritic & CJK Top-Radical Absorption: keeps lowercase "i" dot in "aim" and CJK top radical in "苹" inside fontData while keeping detached top emblem in backgroundData', () => {
    const w = 160;
    const h = 110;
    const buf = createBuffer(w, h, [230, 85, 37, 255]);

    // Detached top brand emblem at y=10..28
    fillRect(buf, w, 62, 10, 94, 28, [255, 255, 255, 255]);

    // Lowercase "aim" at y=68..84 (x=28..40 "a", x=54..59 "i" stem, x=74..92 "m")
    fillRect(buf, w, 28, 68, 40, 84, [255, 255, 255, 255]); // 'a'
    fillRect(buf, w, 54, 68, 59, 84, [255, 255, 255, 255]); // 'i' stem
    fillRect(buf, w, 54, 60, 59, 64, [255, 255, 255, 255]); // 'i' dot (3px gap above stem, no capital ascender in band!)
    fillRect(buf, w, 74, 68, 92, 84, [255, 255, 255, 255]); // 'm'

    // Split-radical CJK character "苹" at x=112..130: top grass radical `艹` (y=60..64) + bottom `平` (y=68..84)
    fillRect(buf, w, 112, 60, 130, 64, [255, 255, 255, 255]); // top radical `艹`
    fillRect(buf, w, 112, 68, 130, 84, [255, 255, 255, 255]); // bottom body `平`

    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'aim苹' });
    expect(split.applied).toBe(true);
    // 'i' dot AND CJK top radical `艹` MUST be absorbed into fontData and inpainted out of backgroundData!
    expect(getPx(split.fontData, w, 56, 62).a).toBe(255);
    expect(getPx(split.backgroundData, w, 56, 62).g).toBeLessThan(120);
    expect(getPx(split.fontData, w, 120, 62).a).toBe(255);
    expect(getPx(split.backgroundData, w, 120, 62).g).toBeLessThan(120);
    // Detached top brand emblem at y=10..28 stays in backgroundData (0 in fontData)!
    expect(getPx(split.fontData, w, 78, 18).a).toBe(0);
    expect(getPx(split.backgroundData, w, 78, 18).g).toBeGreaterThan(240);
  });

  it('15. Outlined two-tone lettering on mid-tone orange card preserves contrasting dark outline rim pixels (perpDist > 30)', () => {
    const w = 140;
    const h = 80;
    const buf = createBuffer(w, h, [230, 85, 37, 255]); // Mid-tone orange #E65525

    // 3 letters of white text [255,255,255] with a 1px deep black drop-shadow/outline rim [12,12,12]
    const starts = [24, 58, 92];
    for (const lx of starts) {
      fillRect(buf, w, lx - 1, 27, lx + 17, 53, [12, 12, 12, 255]); // 1px black outline
      fillRect(buf, w, lx, 28, lx + 16, 52, [255, 255, 255, 255]); // white letter core
    }

    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'Rim' });
    expect(split.applied).toBe(true);
    // White core is 100% opaque
    expect(getPx(split.fontData, w, 30, 40).a).toBe(255);
    // Contrasting 1px black outline rim is ALSO preserved as 100% opaque (not erased by negative projection!)
    expect(getPx(split.fontData, w, 23, 40).a).toBe(255);
    expect(getPx(split.fontData, w, 23, 40).r).toBeLessThan(25);
  });

  it('16. Tightly-kerned NoFrills "Banana®" banner splits ALL 6 letters (red B + black anana) while preserving left blue shield in background', () => {
    const w = 320;
    const h = 80;
    // Bright NoFrills yellow banner #F6DE05
    const buf = createBuffer(w, h, [246, 222, 5, 255]);

    // Left Blue Shield emblem (#0264A9) at x=14..52, y=16..64 with inner Red Maple Leaf (#E51C23)
    fillRect(buf, w, 14, 16, 52, 64, [2, 100, 169, 255]);
    fillRect(buf, w, 26, 30, 40, 50, [229, 28, 35, 255]);

    // Tightly-kerned 6 letters of "Banana" (y=18..62, gap only 3px — well below old 0.1*medH=4.5px merge threshold,
    // plus faint 10% anti-aliased halo bridging the 3px gaps!)
    // Letter 0: Red 'B' (#E51C23) at x=72..98
    fillRect(buf, w, 72, 18, 98, 62, [229, 28, 35, 255]);
    // Letters 1..5: Black 'a','n','a','n','a' (#222429) with 3px kerning gaps and faint anti-aliased bridges
    const letterBoxes: Array<[number, number]> = [
      [102, 126], // 'a'
      [130, 154], // 'n'
      [158, 182], // 'a'
      [186, 210], // 'n'
      [216, 240], // 'a' (slightly wider 5px gap before final 'a', plus trailing '®' speck!)
    ];
    for (const [x0, x1] of letterBoxes) {
      // Faint 12% anti-aliased halo extending 2px left/right into the kerning gap (distField ≈ 35 > tLow=14!)
      fillRect(buf, w, x0 - 2, 24, x1 + 2, 62, [220, 198, 10, 255]);
      fillRect(buf, w, x0, 24, x1, 62, [34, 36, 41, 255]);
    }
    // Tiny trailing '®' trademark speck at x=244..250, y=18..24
    fillRect(buf, w, 244, 18, 250, 24, [34, 36, 41, 255]);

    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'Banana' });
    expect(split.applied).toBe(true);

    // 1. Left Blue Shield emblem (and its inner red maple leaf) MUST stay in Clean Background and NOT in Font!
    expect(getPx(split.fontData, w, 20, 40).a).toBe(0);
    expect(getPx(split.fontData, w, 33, 40).a).toBe(0);
    expect(getPx(split.backgroundData, w, 20, 40).b).toBeGreaterThan(150);
    expect(getPx(split.backgroundData, w, 33, 40).r).toBeGreaterThan(200);

    // 2. Red 'B' AND every black letter 'a','n','a','n','a' MUST be in Font (alpha=255) AND erased to yellow in Clean Background!
    for (const cx of [85, 114, 142, 170, 198, 228]) {
      expect(getPx(split.fontData, w, cx, 42).a).toBe(255);
      const bgPx = getPx(split.backgroundData, w, cx, 42);
      expect(bgPx.r).toBeGreaterThan(220);
      expect(bgPx.g).toBeGreaterThan(195);
      expect(bgPx.b).toBeLessThan(35);
    }
  });

  it('17. Physically-touching connected script/bold letters ("Banan" fused + separate "a" + "®") never get peeled as an edge emblem', () => {
    const w = 320;
    const h = 80;
    const buf = createBuffer(w, h, [246, 222, 5, 255]);

    // Left Blue Shield emblem (#0264A9) at x=12..48, y=16..64
    fillRect(buf, w, 12, 16, 48, 64, [2, 100, 169, 255]);

    // Suppose "Banan" is drawn as a SOLID fused connected block (x=72..210, y=22..62) with 2px serif bridges
    // while only the last 'a' (x=218..242) and '®' (x=246..252) are separate components!
    fillRect(buf, w, 72, 22, 210, 62, [34, 36, 41, 255]);
    fillRect(buf, w, 218, 22, 242, 62, [34, 36, 41, 255]);
    fillRect(buf, w, 246, 18, 252, 24, [34, 36, 41, 255]);

    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'Banana' });
    expect(split.applied).toBe(true);

    // Left Blue Shield stays in Clean Background (alpha=0 in Font)
    expect(getPx(split.fontData, w, 30, 40).a).toBe(0);
    expect(getPx(split.backgroundData, w, 30, 40).b).toBeGreaterThan(150);

    // BOTH fused "Banan" (x=85..200) AND separate final "a" (x=230) MUST be in Font (alpha=255) and erased from Clean Background!
    for (const cx of [85, 120, 155, 195, 230]) {
      expect(getPx(split.fontData, w, cx, 42).a).toBe(255);
      const bgPx = getPx(split.backgroundData, w, cx, 42);
      expect(bgPx.r).toBeGreaterThan(220);
      expect(bgPx.g).toBeGreaterThan(195);
      expect(bgPx.b).toBeLessThan(35);
    }
  });

  it('18. Center emblem between two words (Baidu "bye [blue paw] bye"): extracts left & right red "bye" into Font and keeps center blue paw + toe pads in Clean Background', () => {
    const w = 300;
    const h = 120;
    // Light #F7F7F7 card backdrop
    const buf = createBuffer(w, h, [247, 247, 247, 255]);

    // Left red "bye" (#DB0603) at x=20..36 ('b'), x=44..60 ('y'), x=68..84 ('e'), y=54..88
    fillRect(buf, w, 20, 54, 36, 88, [219, 6, 3, 255]);
    fillRect(buf, w, 44, 54, 60, 88, [219, 6, 3, 255]);
    fillRect(buf, w, 68, 54, 84, 88, [219, 6, 3, 255]);

    // Center Blue Paw emblem (#2317D5):
    // - 4 blue toe pads above the text band at y=22..38
    fillRect(buf, w, 108, 26, 118, 38, [35, 23, 213, 255]);
    fillRect(buf, w, 126, 20, 136, 34, [35, 23, 213, 255]);
    fillRect(buf, w, 146, 20, 156, 34, [35, 23, 213, 255]);
    fillRect(buf, w, 164, 26, 174, 38, [35, 23, 213, 255]);
    // - Main blue paw pad sitting right in the middle of the horizontal text band (x=114..168, y=46..92)
    fillRect(buf, w, 114, 46, 168, 92, [35, 23, 213, 255]);

    // Right red "bye" (#DB0603) at x=196..212 ('b'), x=220..236 ('y'), x=244..260 ('e'), y=54..88
    fillRect(buf, w, 196, 54, 212, 88, [219, 6, 3, 255]);
    fillRect(buf, w, 220, 54, 236, 88, [219, 6, 3, 255]);
    fillRect(buf, w, 244, 54, 260, 88, [219, 6, 3, 255]);

    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'bye bye' });
    expect(split.applied).toBe(true);

    // 1. Center Blue Paw Pad AND upper blue toe pads stay in Clean Background (alpha=0 in Font!)
    expect(getPx(split.fontData, w, 140, 70).a).toBe(0);
    expect(getPx(split.fontData, w, 131, 27).a).toBe(0);
    expect(getPx(split.backgroundData, w, 140, 70).b).toBeGreaterThan(190);
    expect(getPx(split.backgroundData, w, 131, 27).b).toBeGreaterThan(190);

    // 2. All 6 red letters of left "bye" & right "bye" are in Font (alpha=255) and erased to white in Clean Background!
    for (const cx of [28, 52, 76, 204, 228, 252]) {
      expect(getPx(split.fontData, w, cx, 70).a).toBe(255);
      const bgPx = getPx(split.backgroundData, w, cx, 70);
      expect(bgPx.r).toBeGreaterThan(230);
      expect(bgPx.g).toBeGreaterThan(230);
      expect(bgPx.b).toBeGreaterThan(230);
    }
  });

  it('19. Plain stencil word with NO emblem ("Apple"): never peels the leading capital "A" into Clean Background, whatever the target word length', () => {
    const w = 512;
    const h = 286;
    const red: [number, number, number, number] = [184, 51, 26, 255];
    const draw = () => {
      const buf = createBuffer(w, h, [255, 255, 255, 255]);
      // 'A': wide solid capital (cap height y=100..170)
      fillRect(buf, w, 125, 100, 190, 170, red);
      // 'p' x2: stencil stem island + bowl island separated by a 3px bridge gap (descender to y=190)
      for (const x0 of [200, 255]) {
        fillRect(buf, w, x0, 120, x0 + 14, 190, red);
        fillRect(buf, w, x0 + 18, 120, x0 + 45, 170, red);
      }
      // 'l'
      fillRect(buf, w, 310, 100, 324, 170, red);
      // 'e': two stencil islands
      fillRect(buf, w, 334, 120, 356, 170, red);
      fillRect(buf, w, 360, 120, 380, 150, red);
      return buf;
    };

    // "Record" (6) is the exact mismatch from the failed run: the shelf split an "Apple" picture
    // while the typed word was "Record", so the stencil islands looked like surplus columns.
    for (const targetWord of ['Record', 'Apple', '']) {
      const split = splitMasterImageRgba(draw(), w, h, { targetWord });
      expect(split.applied).toBe(true);
      expect(split.emblemsPreservedCount).toBe(0);
      expect(split.textBBox?.minX).toBeLessThanOrEqual(126);

      // Every glyph (leading 'A' included) is in Font and erased to white in Clean Background
      for (const [cx, cy] of [
        [157, 135],
        [207, 150],
        [232, 145],
        [262, 150],
        [287, 145],
        [317, 135],
        [345, 145],
        [370, 135],
      ] as const) {
        expect(getPx(split.fontData, w, cx, cy).a).toBe(255);
        const bgPx = getPx(split.backgroundData, w, cx, cy);
        expect(bgPx.r).toBeGreaterThan(235);
        expect(bgPx.g).toBeGreaterThan(235);
        expect(bgPx.b).toBeGreaterThan(235);
      }
    }
  });

  it('20. Smooth 2D diagonal gradient + arch + swash capital ("Record+"): keeps all 7 glyphs incl. the tall "R", leaves the arch in Clean Background, and inpaints the true local gradient', () => {
    const w = 640;
    const h = 400;
    // #53A0B3 teal (bottom-left) -> #0F203C deep navy (top-right): ~145 RGB units across the canvas
    const gradientAt = (x: number, y: number): [number, number, number] => {
      const t = (x / (w - 1) + (1 - y / (h - 1))) / 2;
      return [
        Math.round(83 + (15 - 83) * t),
        Math.round(160 + (32 - 160) * t),
        Math.round(179 + (60 - 179) * t),
      ];
    };
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b] = gradientAt(x, y);
        setPx(buf, w, x, y, [r, g, b, 255]);
      }
    }
    const white: [number, number, number, number] = [255, 255, 255, 255];
    const eraseTo = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const [r, g, b] = gradientAt(x, y);
          setPx(buf, w, x, y, [r, g, b, 255]);
        }
      }
    };

    // Thin white arch curving over the whole word (never touching a letter)
    for (let x = 200; x <= 560; x++) {
      const top = Math.round(30 + ((x - 380) / 180) ** 2 * 110);
      fillRect(buf, w, x, top, x, top + 8, white);
    }

    // 'R': tall swash capital, 2.1x the lowercase height (y=140..310), same white ink
    fillRect(buf, w, 40, 140, 180, 158, white); // top swash
    fillRect(buf, w, 80, 140, 100, 310, white); // stem
    fillRect(buf, w, 160, 158, 180, 230, white); // bowl side
    fillRect(buf, w, 100, 212, 180, 230, white); // bowl bottom
    fillRect(buf, w, 140, 230, 162, 310, white); // leg
    // 'e'
    fillRect(buf, w, 188, 220, 248, 300, white);
    eraseTo(208, 238, 248, 252);
    eraseTo(208, 268, 248, 282);
    // 'c'
    fillRect(buf, w, 256, 220, 316, 300, white);
    eraseTo(276, 240, 316, 280);
    // 'o' (closed counter)
    fillRect(buf, w, 324, 220, 384, 300, white);
    eraseTo(342, 238, 366, 282);
    // 'r'
    fillRect(buf, w, 392, 220, 412, 300, white);
    fillRect(buf, w, 412, 220, 442, 240, white);
    // 'd' (tall ascender)
    fillRect(buf, w, 450, 220, 498, 300, white);
    eraseTo(468, 238, 498, 282);
    fillRect(buf, w, 498, 150, 518, 300, white);
    // '+'
    fillRect(buf, w, 526, 250, 604, 266, white);
    fillRect(buf, w, 557, 215, 573, 300, white);

    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'Record' });
    expect(split.applied).toBe(true);
    expect(split.backdropIsLight).toBe(false);
    expect(split.backgroundConfidence).toBeGreaterThan(0.7);
    // Only the arch is a preserved non-text element (no phantom "emblem" in the light gradient corner)
    expect(split.emblemsPreservedCount).toBe(1);

    // 1. All 7 glyphs (tall leading 'R' included) are opaque in Font...
    const glyphProbes: Array<[number, number]> = [
      [90, 250], // R stem
      [110, 149], // R swash
      [198, 260], // e
      [266, 260], // c
      [333, 260], // o
      [402, 260], // r
      [508, 190], // d ascender
      [565, 258], // +
    ];
    for (const [gx, gy] of glyphProbes) {
      expect(getPx(split.fontData, w, gx, gy).a).toBe(255);
      // ...and erased back to the TRUE local gradient color in Clean Background (no ghost patch)
      const expected = gradientAt(gx, gy);
      const bgPx = getPx(split.backgroundData, w, gx, gy);
      expect(Math.abs(bgPx.r - expected[0])).toBeLessThanOrEqual(8);
      expect(Math.abs(bgPx.g - expected[1])).toBeLessThanOrEqual(8);
      expect(Math.abs(bgPx.b - expected[2])).toBeLessThanOrEqual(8);
    }
    expect(split.textBBox?.minX).toBeLessThanOrEqual(41);
    expect(split.textBBox?.maxX).toBeGreaterThanOrEqual(603);

    // 2. The arch stays in Clean Background and out of Font
    expect(getPx(split.fontData, w, 380, 34).a).toBe(0);
    expect(getPx(split.backgroundData, w, 380, 34).r).toBeGreaterThan(240);

    // 3. Far gradient corners are untouched and never flagged as foreground
    for (const [cx, cy] of [
      [6, 392],
      [632, 6],
      [6, 6],
      [632, 392],
    ] as const) {
      expect(getPx(split.fontData, w, cx, cy).a).toBe(0);
      const expected = gradientAt(cx, cy);
      const bgPx = getPx(split.backgroundData, w, cx, cy);
      expect(bgPx.r).toBe(expected[0]);
      expect(bgPx.g).toBe(expected[1]);
      expect(bgPx.b).toBe(expected[2]);
    }
  });

  it('21. Same-ink emblem that stands off by a wide gap is still peeled, while a same-ink capital at letter spacing is kept (leading-letter immunity is gap-based, not size-based)', () => {
    const w = 260;
    const h = 90;
    const ink: [number, number, number, number] = [20, 60, 140, 255];
    const draw = (firstGlyphRight: number) => {
      const buf = createBuffer(w, h, [255, 255, 255, 255]);
      // Tall first shape (y=14..74, 1.9x the letters) ending at `firstGlyphRight`
      fillRect(buf, w, firstGlyphRight - 34, 14, firstGlyphRight, 74, ink);
      // 5 letters, 14px wide, 6px apart, starting at x=100
      for (let i = 0; i < 5; i++) {
        fillRect(buf, w, 100 + i * 20, 42, 113 + i * 20, 74, ink);
      }
      return buf;
    };

    // Capital initial at normal letter spacing (6px gap) -> stays in Font
    const asLetter = splitMasterImageRgba(draw(93), w, h, { targetWord: 'Maple' });
    expect(asLetter.applied).toBe(true);
    expect(getPx(asLetter.fontData, w, 76, 44).a).toBe(255);
    expect(asLetter.emblemsPreservedCount).toBe(0);

    // Same shape pushed 40px away from the word -> an emblem, kept in Clean Background
    const asEmblem = splitMasterImageRgba(draw(59), w, h, { targetWord: 'Maple' });
    expect(asEmblem.applied).toBe(true);
    expect(getPx(asEmblem.fontData, w, 42, 44).a).toBe(0);
    expect(getPx(asEmblem.backgroundData, w, 42, 44).b).toBe(140);
    expect(getPx(asEmblem.fontData, w, 106, 58).a).toBe(255);
    expect(asEmblem.emblemsPreservedCount).toBe(1);
  });

  it('22. Same-ink script touching a decorated frame with rows of halftone dots (Coca-Cola -> "Rope and Oil"): frees the lettering from the frame, ignores the dot rows, and keeps frame + dots in Clean Background', () => {
    const w = 640;
    const h = 440;
    const red: [number, number, number, number] = [200, 40, 40, 255];
    const buf = createBuffer(w, h, [246, 246, 246, 255]);

    // Red frame hugging all four image edges (20px thick)
    fillRect(buf, w, 0, 0, w - 1, 19, red);
    fillRect(buf, w, 0, h - 20, w - 1, h - 1, red);
    fillRect(buf, w, 0, 0, 19, h - 1, red);
    fillRect(buf, w, w - 20, 0, w - 1, h - 1, red);

    // Two rows of 17 free halftone dots: far more "columns" than the fused script has letters
    for (let x = 80; x <= 560; x += 30) {
      fillRect(buf, w, x, 60, x + 9, 69, red);
      fillRect(buf, w, x, 370, x + 9, 379, red);
    }

    // Fused script word in the SAME red ink: 3 connected blocks (y=160..280)
    fillRect(buf, w, 90, 160, 250, 280, red);
    fillRect(buf, w, 270, 160, 400, 280, red);
    fillRect(buf, w, 420, 160, 540, 280, red);
    // The first letter's swash brushes the frame through a thin 4px neck
    fillRect(buf, w, 20, 200, 89, 203, red);

    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'Rope and Oil' });
    expect(split.applied).toBe(true);
    expect(split.backdropIsLight).toBe(true);

    // 1. All three script blocks (incl. the one welded to the frame) are in Font and erased to
    //    the white card color in Clean Background
    for (const cx of [170, 335, 480]) {
      expect(getPx(split.fontData, w, cx, 220).a).toBe(255);
      const bgPx = getPx(split.backgroundData, w, cx, 220);
      expect(bgPx.r).toBeGreaterThan(235);
      expect(bgPx.g).toBeGreaterThan(235);
      expect(bgPx.b).toBeGreaterThan(235);
    }
    expect(split.textBBox?.minY).toBeGreaterThanOrEqual(150);
    expect(split.textBBox?.maxY).toBeLessThanOrEqual(290);

    // 2. Frame and halftone dots never reach Font and stay intact in Clean Background
    for (const [px, py] of [
      [10, 10],
      [630, 430],
      [10, 220],
      [85, 65],
      [325, 375],
    ] as const) {
      expect(getPx(split.fontData, w, px, py).a).toBe(0);
      const bgPx = getPx(split.backgroundData, w, px, py);
      expect(bgPx.r).toBe(200);
      expect(bgPx.g).toBe(40);
    }
  });

  it('23. Newspaper masthead banner (NYT -> "The diary of A Kid", 1024x132): takes ONLY the big title; ruling lines, the boxed motto and the small print stay in Clean Background', () => {
    const w = 1024;
    const h = 132;
    const ink: [number, number, number, number] = [20, 20, 20, 255];
    const buf = createBuffer(w, h, [242, 241, 226, 255]);

    // Big blackletter title: 14 glyph blocks (y=14..84)
    const titleXs: number[] = [];
    for (let i = 0; i < 14; i++) {
      const x0 = 215 + i * 52;
      titleXs.push(x0 + 20);
      fillRect(buf, w, x0, 14, x0 + 40, 84, ink);
    }
    // Long ruling lines under the title and at the bottom (sharp, 2px)
    fillRect(buf, w, 10, 100, 1013, 101, ink);
    fillRect(buf, w, 10, 126, 1013, 127, ink);
    // Boxed motto on the left: hollow outline + two lines of tiny print inside
    fillRect(buf, w, 12, 20, 175, 21, ink);
    fillRect(buf, w, 12, 78, 175, 79, ink);
    fillRect(buf, w, 12, 20, 13, 79, ink);
    fillRect(buf, w, 174, 20, 175, 79, ink);
    for (let x = 30; x <= 150; x += 10) {
      fillRect(buf, w, x, 38, x + 5, 45, ink);
      fillRect(buf, w, x, 54, x + 5, 61, ink);
    }
    // Dateline: a long row of tiny print between the rules
    for (let x = 20; x <= 1000; x += 12) {
      fillRect(buf, w, x, 108, x + 6, 117, ink);
    }

    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'The diary of  A Kid' });
    expect(split.applied).toBe(true);

    // 1. Every title glyph is in Font and erased to paper color in Clean Background
    for (const cx of titleXs) {
      expect(getPx(split.fontData, w, cx, 50).a).toBe(255);
      const bgPx = getPx(split.backgroundData, w, cx, 50);
      expect(bgPx.r).toBeGreaterThan(225);
      expect(bgPx.g).toBeGreaterThan(225);
    }
    expect(split.textBBox?.minX).toBeGreaterThanOrEqual(205);
    expect(split.textBBox?.maxY).toBeLessThanOrEqual(92);

    // 2. Rules, motto box, motto print and dateline stay out of Font and intact in Clean Background
    for (const [px, py] of [
      [500, 100],
      [500, 127],
      [90, 20],
      [13, 50],
      [32, 41],
      [23, 112],
      [503, 112],
    ] as const) {
      expect(getPx(split.fontData, w, px, py).a).toBe(0);
      expect(getPx(split.backgroundData, w, px, py).r).toBe(20);
    }
    expect(split.quality).toEqual({ fontOk: true, backgroundOk: true, reasons: [] });
  });

  it('24. Lettering lying ACROSS artwork (Lakers -> "RAPTORS" over a gold basketball): separates the letters by ink colour, keeps ball + seams out of Font, and flags the background as needing the AI', () => {
    const w = 640;
    const h = 400;
    const gold: [number, number, number, number] = [246, 168, 28, 255];
    const purple: [number, number, number, number] = [43, 9, 102, 255];
    const black: [number, number, number, number] = [15, 15, 15, 255];
    const buf = createBuffer(w, h, [246, 246, 246, 255]);

    // Gold ball (radius 170, centred) with black seam lines
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((x - 320) ** 2 + (y - 200) ** 2 <= 170 ** 2) setPx(buf, w, x, y, gold);
      }
    }
    fillRect(buf, w, 316, 32, 322, 368, black);
    fillRect(buf, w, 152, 96, 488, 101, black);
    fillRect(buf, w, 152, 300, 488, 305, black);

    // 7 purple letters across the ball; the first and last sit partly/fully on the white card
    const letterXs = [60, 138, 216, 294, 372, 450, 528];
    for (const x0 of letterXs) fillRect(buf, w, x0, 150, x0 + 54, 250, purple);

    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'Raptors' });
    expect(split.applied).toBe(true);

    // 1. Every letter is in Font: on the card, on the ball's edge, and in the middle of the ball
    for (const x0 of letterXs) {
      expect(getPx(split.fontData, w, x0 + 27, 200).a).toBe(255);
      expect(getPx(split.fontData, w, x0 + 27, 200).b).toBeGreaterThan(80);
    }
    expect(split.textBBox?.minX).toBeLessThanOrEqual(62);
    expect(split.textBBox?.maxX).toBeGreaterThanOrEqual(580);
    expect(split.textBBox?.minY).toBeGreaterThanOrEqual(140);
    expect(split.textBBox?.maxY).toBeLessThanOrEqual(260);

    // 2. Ball and seams never reach Font and stay in Clean Background
    for (const [px, py] of [
      [320, 60],
      [250, 330],
      [319, 340],
      [300, 98],
    ] as const) {
      expect(getPx(split.fontData, w, px, py).a).toBe(0);
    }
    expect(getPx(split.backgroundData, w, 250, 330)).toMatchObject({ r: 246, g: 168, b: 28 });
    expect(getPx(split.backgroundData, w, 319, 340).r).toBeLessThan(40);

    // 3. Erased letters over the ball are refilled with the ball's colour, not the card's white
    const refilled = getPx(split.backgroundData, w, 243, 200);
    expect(refilled.r).toBeGreaterThan(220);
    expect(refilled.b).toBeLessThan(120);

    // 4. Self-check: the Font is trustworthy, the locally rebuilt background is not
    expect(split.quality.fontOk).toBe(true);
    expect(split.quality.backgroundOk).toBe(false);
    expect(split.quality.reasons).toEqual(['lettering-over-artwork']);
  });

  it('25. Self-check: a split that found only one letter of a 7-letter word is reported as not OK (never shown as ready)', () => {
    const w = 400;
    const h = 200;
    const buf = createBuffer(w, h, [255, 255, 255, 255]);
    // Only a single glyph is detectable
    fillRect(buf, w, 300, 60, 340, 140, [43, 9, 102, 255]);

    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'Raptors' });
    expect(split.applied).toBe(true);
    expect(split.quality.fontOk).toBe(false);
    expect(split.quality.backgroundOk).toBe(false);
    expect(split.quality.reasons).toContain('font-too-narrow');

    // The same glyph is a perfectly fine result for a 1-letter word
    const single = splitMasterImageRgba(buf, w, h, { targetWord: 'S' });
    expect(single.quality.fontOk).toBe(true);
    expect(single.quality.backgroundOk).toBe(true);
  });

  it('27. Lettering overlapping a colour band that runs off the picture (Marlboro -> "Dollar Tree"): the band is artwork, the other ink is the word', () => {
    const w = 640;
    const h = 400;
    const red: [number, number, number, number] = [176, 46, 34, 255];
    const black: [number, number, number, number] = [10, 10, 10, 255];
    const buf = createBuffer(w, h, [255, 255, 255, 255]);
    // Red roof band across the top, running off the left, top and right edges
    fillRect(buf, w, 0, 0, w - 1, 160, red);
    // Six tall black letters standing on the white card, their tops overlapping the red band
    const letterXs = [60, 150, 240, 330, 420, 510];
    for (const x0 of letterXs) fillRect(buf, w, x0, 130, x0 + 60, 330, black);

    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'Dollar' });
    expect(split.applied).toBe(true);
    for (const x0 of letterXs) {
      // Both the part over the red band and the part on the white card belong to the Font
      expect(getPx(split.fontData, w, x0 + 30, 145).a).toBe(255);
      expect(getPx(split.fontData, w, x0 + 30, 250).a).toBe(255);
      expect(getPx(split.fontData, w, x0 + 30, 250).r).toBeLessThan(40);
    }
    // The red band never reaches the Font and stays in the Clean Background
    expect(getPx(split.fontData, w, 320, 40).a).toBe(0);
    expect(getPx(split.backgroundData, w, 320, 40)).toMatchObject({ r: 176, g: 46, b: 34 });
    // Trustworthy Font; the background under the overlap is for the on-device model
    expect(split.quality.fontOk).toBe(true);
    expect(split.quality.reasons).not.toContain('ink-undecided');
    expect(split.eraseMask[250 * w + 90]).toBe(1);
    expect(split.eraseMask[40 * w + 320]).toBe(0);
  });

  it('26. Self-check false-alarm guard: a large two-colour badge that does NOT touch the word must not send a cleanly split word to the AI', () => {
    const w = 640;
    const h = 480;
    const buf = createBuffer(w, h, [255, 255, 255, 255]);

    // A clean 5-letter word across the top
    for (let i = 0; i < 5; i++) {
      fillRect(buf, w, 150 + i * 70, 40, 200 + i * 70, 110, [20, 20, 20, 255]);
    }
    // A big two-colour badge well below it (red disc with a blue square core, ~15% of the image)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((x - 320) ** 2 + (y - 320) ** 2 <= 130 ** 2) setPx(buf, w, x, y, [200, 30, 40, 255]);
      }
    }
    fillRect(buf, w, 250, 250, 390, 390, [20, 60, 190, 255]);

    const split = splitMasterImageRgba(buf, w, h, { targetWord: 'Maple' });
    expect(split.applied).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(getPx(split.fontData, w, 175 + i * 70, 75).a).toBe(255);
    }
    // Badge untouched and out of Font
    expect(getPx(split.fontData, w, 320, 220).a).toBe(0);
    expect(getPx(split.backgroundData, w, 320, 220)).toMatchObject({ r: 200, g: 30, b: 40 });
    expect(getPx(split.backgroundData, w, 320, 320)).toMatchObject({ r: 20, g: 60, b: 190 });
    expect(split.quality).toEqual({ fontOk: true, backgroundOk: true, reasons: [] });
  });
});
