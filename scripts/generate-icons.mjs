import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Generates 4x4 MSAA supersampled Matte-Carbon & Pure-White Optical Lens icons
 * (16, 32, 48, 128) — inspired by machined stealth hardware + luminous white ring geometry.
 */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function roundedRectSdf(px, py, halfW, halfH, r) {
  const qx = Math.abs(px) - halfW + r;
  const qy = Math.abs(py) - halfH + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function samplePixel(nx, ny, aa) {
  // Squircle container in normalized [-1, 1] space
  const bgSdf = roundedRectSdf(nx, ny, 0.92, 0.92, 0.28);
  const alpha = 1 - smoothstep(-aa, aa, bgSdf);
  if (alpha <= 0.001) return [0, 0, 0, 0];

  // Machined anodized dark carbon gradient (subtle top-left studio light)
  const lightDir = clamp(1 - Math.hypot(nx + 0.55, ny + 0.65) * 0.68);
  let r = 10 + lightDir * 17;
  let g = 10 + lightDir * 17;
  let b = 12 + lightDir * 20;

  // Subtle diagonal stealth blade seam (inspired by reference matte geometry)
  const diagDist = Math.abs((nx + ny) * 0.7071);
  if (diagDist < 0.012 && Math.hypot(nx, ny) > 0.48) {
    const seam = (1 - diagDist / 0.012) * 14;
    r += seam;
    g += seam;
    b += seam + 2;
  }

  // Crisp studio specular bevel rim along the top/left edge
  const rimDist = Math.abs(bgSdf + 0.028);
  const rimBand = 1 - smoothstep(0, 0.032, rimDist);
  const topLeftBias = clamp(0.45 - (nx * 0.35 + ny * 0.45), 0.15, 1);
  const rimBoost = rimBand * topLeftBias * 68;
  r += rimBoost;
  g += rimBoost;
  b += rimBoost + rimBand * 4;

  // Deep recessed optical lens barrel well
  const dist = Math.hypot(nx, ny);
  const wellMask = 1 - smoothstep(0.42, 0.49, dist);
  r = r * (1 - wellMask * 0.55) + 4 * (wellMask * 0.55);
  g = g * (1 - wellMask * 0.55) + 4 * (wellMask * 0.55);
  b = b * (1 - wellMask * 0.55) + 6 * (wellMask * 0.55);

  // Subtle dark chrome outer ring around lens well
  const outerRing = 1 - smoothstep(0.005, 0.025, Math.abs(dist - 0.51));
  r += outerRing * 28;
  g += outerRing * 28;
  b += outerRing * 32;

  // Signature Luminous Pure-White Halo Ring (centerpiece)
  const ringRadius = 0.37;
  const ringDist = Math.abs(dist - ringRadius);
  // Soft atmospheric white bloom
  const bloom = Math.exp(-ringDist * 13.5) * 115;
  r += bloom;
  g += bloom;
  b += bloom * 1.03;

  // Razor-sharp white neon tube core
  const ringCore = 1 - smoothstep(0.022, 0.045, ringDist);
  r = r * (1 - ringCore) + 255 * ringCore;
  g = g * (1 - ringCore) + 255 * ringCore;
  b = b * (1 - ringCore) + 255 * ringCore;

  // Inner optical prism diamond (4-point star/lens facet)
  const diamondDist = Math.abs(nx) + Math.abs(ny);
  const diamondCore = 1 - smoothstep(0.11, 0.155, diamondDist);
  const diamondGlow = Math.exp(-Math.max(0, diamondDist - 0.13) * 12) * 55;
  r += diamondGlow;
  g += diamondGlow;
  b += diamondGlow * 1.04;

  // Sculpted silver-white inner facet
  if (diamondCore > 0) {
    const facetShade = 215 + clamp((0.12 - nx - ny) * 260, -25, 40);
    r = r * (1 - diamondCore) + facetShade * diamondCore;
    g = g * (1 - diamondCore) + facetShade * diamondCore;
    b = b * (1 - diamondCore) + Math.min(255, facetShade + 5) * diamondCore;
  }

  // Four precision corner viewfinder brackets (clean brushed titanium-white)
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const bracketOuter = 0.71;
  const bracketInner = 0.5;
  const bw = 0.024;
  const onH = Math.abs(ay - bracketOuter) < bw && ax <= bracketOuter + bw && ax >= bracketInner;
  const onV = Math.abs(ax - bracketOuter) < bw && ay <= bracketOuter + bw && ay >= bracketInner;
  if (onH || onV) {
    const bAlpha = 0.82;
    r = r * (1 - bAlpha) + 232 * bAlpha;
    g = g * (1 - bAlpha) + 234 * bAlpha;
    b = b * (1 - bAlpha) + 240 * bAlpha;
  }

  // Subtle top-right specular optical catchlight dot
  const glint = Math.exp(-Math.hypot(nx - 0.24, ny + 0.24) * 14) * 95;
  r += glint;
  g += glint;
  b += glint;

  return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255), alpha * 255];
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 4; // 4x4 MSAA supersampling for crisp edges even at 16px
  const aa = 1.5 / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rAcc = 0;
      let gAcc = 0;
      let bAcc = 0;
      let aAcc = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          const nx = (px / size) * 2 - 1;
          const ny = (py / size) * 2 - 1;
          const [r, g, b, a] = samplePixel(nx, ny, aa);
          rAcc += r * (a / 255);
          gAcc += g * (a / 255);
          bAcc += b * (a / 255);
          aAcc += a;
        }
      }

      const n = samples * samples;
      const outA = aAcc / n;
      const idx = (y * size + x) * 4;
      if (outA > 0.5) {
        const invA = 255 / outA;
        rgba[idx] = Math.round(clamp((rAcc / n) * invA, 0, 255));
        rgba[idx + 1] = Math.round(clamp((gAcc / n) * invA, 0, 255));
        rgba[idx + 2] = Math.round(clamp((bAcc / n) * invA, 0, 255));
        rgba[idx + 3] = Math.round(clamp(outA, 0, 255));
      }
    }
  }

  return encodePng(size, size, rgba);
}

const outDir = resolve(projectRoot, 'public/icons');
mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(outDir, `icon-${size}.png`), renderIcon(size));
}
console.log(`Generated 4x MSAA Optical Lens PNG icons in ${outDir}`);
