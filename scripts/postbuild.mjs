import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(projectRoot, 'dist');

mkdirSync(distDir, { recursive: true });
copyFileSync(resolve(projectRoot, 'manifest.json'), resolve(distDir, 'manifest.json'));

const required = [
  'dist/manifest.json',
  'dist/background.js',
  'dist/sidepanel.html',
  'dist/content/overlay.js',
  'dist/icons/icon-16.png',
  'dist/icons/icon-128.png',
  // Bundled on-device inpainting model (loaded from the extension's own files, never the network)
  'dist/models/lama_int4_int8_r4.onnx',
  'dist/models/ppocrv5_mobile_det.onnx',
];

for (const file of required) {
  if (!existsSync(resolve(projectRoot, file))) {
    throw new Error(`Postbuild check failed: missing required extension artifact ${file}`);
  }
}

console.log('StyleLens dist/ verified and ready to load as an unpacked MV3 extension.');
