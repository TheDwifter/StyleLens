export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clampUnit(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function parseAlpha(raw: string | undefined): number {
  if (!raw) return 1;
  const trimmed = raw.trim();
  if (trimmed.endsWith('%')) {
    const parsed = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(parsed) ? clampUnit(parsed / 100) : 1;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? clampUnit(parsed) : 1;
}

/**
 * Parses common computed CSS color strings:
 * - rgb(r, g, b) / rgba(r, g, b, a)
 * - rgb(r g b / a) (CSS Color Level 4)
 * - #rgb, #rgba, #rrggbb, #rrggbbaa
 * - transparent
 */
export function parseCssColor(input: string | undefined | null): RgbaColor | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (!value || value === 'none' || value === 'inherit' || value === 'initial') {
    return null;
  }
  if (value === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  // Hex notation
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = Number.parseInt(hex[0]! + hex[0]!, 16);
      const g = Number.parseInt(hex[1]! + hex[1]!, 16);
      const b = Number.parseInt(hex[2]! + hex[2]!, 16);
      const a = hex.length === 4 ? Number.parseInt(hex[3]! + hex[3]!, 16) / 255 : 1;
      if ([r, g, b, a].some((v) => Number.isNaN(v))) return null;
      return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b, a].some((v) => Number.isNaN(v))) return null;
      return { r, g, b, a };
    }
    return null;
  }

  // rgb() / rgba() comma or space syntax
  const rgbMatch = value.match(/^rgba?\(\s*([^)]+)\s*\)$/);
  if (rgbMatch && rgbMatch[1]) {
    const body = rgbMatch[1];
    // Handle modern slash syntax: "255 128 0 / 0.5"
    const [colorPart, alphaPart] = body.split('/');
    const channels = (colorPart ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (channels.length >= 3) {
      const parseChannel = (ch: string): number => {
        if (ch.endsWith('%')) {
          return (Number.parseFloat(ch.slice(0, -1)) / 100) * 255;
        }
        return Number.parseFloat(ch);
      };
      const r = parseChannel(channels[0]!);
      const g = parseChannel(channels[1]!);
      const b = parseChannel(channels[2]!);
      if ([r, g, b].some((v) => !Number.isFinite(v))) return null;

      const a = alphaPart !== undefined ? parseAlpha(alphaPart) : parseAlpha(channels[3]);
      return {
        r: clampByte(r),
        g: clampByte(g),
        b: clampByte(b),
        a,
      };
    }
  }

  return null;
}

export function rgbaToHex(color: RgbaColor, includeAlpha = false): string {
  const toHex = (v: number) => clampByte(v).toString(16).padStart(2, '0');
  const base = `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`.toUpperCase();
  if (includeAlpha && color.a < 0.995) {
    return `${base}${toHex(color.a * 255).toUpperCase()}`;
  }
  return base;
}

export function formatRgbString(color: RgbaColor): string {
  if (color.a < 0.995) {
    return `rgba(${clampByte(color.r)}, ${clampByte(color.g)}, ${clampByte(color.b)}, ${Number(color.a.toFixed(2))})`;
  }
  return `rgb(${clampByte(color.r)}, ${clampByte(color.g)}, ${clampByte(color.b)})`;
}

/**
 * Alpha-composites foreground over background using standard Porter-Duff source-over.
 */
export function compositeOver(fg: RgbaColor, bg: RgbaColor): RgbaColor {
  const outA = fg.a + bg.a * (1 - fg.a);
  if (outA <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  return {
    r: clampByte((fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / outA),
    g: clampByte((fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / outA),
    b: clampByte((fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / outA),
    a: clampUnit(outA),
  };
}

/**
 * WCAG 2.1 relative luminance (0 = black, 1 = white).
 */
export function relativeLuminance(color: Pick<RgbaColor, 'r' | 'g' | 'b'>): number {
  const linearize = (channel: number): number => {
    const s = clampByte(channel) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/**
 * WCAG 2.1 contrast ratio between two opaque colors (1.0 to 21.0).
 * If foreground has alpha < 1, it is composited over background first.
 */
export function contrastRatio(fg: RgbaColor, bg: RgbaColor): number {
  const opaqueBg = bg.a < 1 ? compositeOver(bg, { r: 255, g: 255, b: 255, a: 1 }) : bg;
  const resolvedFg = fg.a < 1 ? compositeOver(fg, opaqueBg) : fg;
  const l1 = relativeLuminance(resolvedFg);
  const l2 = relativeLuminance(opaqueBg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

export function colorDistance(
  a: Pick<RgbaColor, 'r' | 'g' | 'b'>,
  b: Pick<RgbaColor, 'r' | 'g' | 'b'>
): number {
  // Redmean weighted Euclidean distance for better perceptual grouping
  const rMean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr +
      4 * dg * dg +
      (2 + (255 - rMean) / 256) * db * db
  );
}

export function rgbToHsl(color: Pick<RgbaColor, 'r' | 'g' | 'b'>): { h: number; s: number; l: number } {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    case b:
      h = (r - g) / d + 4;
      break;
  }
  return { h: h * 60, s, l };
}

export function isNeutralColor(color: Pick<RgbaColor, 'r' | 'g' | 'b'>): boolean {
  const { s, l } = rgbToHsl(color);
  return s < 0.14 || l < 0.07 || l > 0.95;
}

export function isDarkColor(color: Pick<RgbaColor, 'r' | 'g' | 'b'>): boolean {
  return relativeLuminance(color) < 0.18;
}
