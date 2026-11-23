import { detectText, type TextDetection } from '../../core/textDetection';

/**
 * Loads and runs the bundled text-detection model (PP-OCRv5 mobile detector, 4.8 MB) with ONNX
 * Runtime Web, from the extension's own files. It is small enough to run on any computer: WebGPU
 * when available, otherwise single-threaded WebAssembly (well under a second for one picture).
 * Never throws: on any problem it returns null and StyleLens simply works without it.
 */
const MODEL_FILE = 'models/ppocrv5_mobile_det.onnx';
const BUDGET_MS = 20_000;

type Runner = (input: Float32Array, width: number, height: number) => Promise<Float32Array>;
let loading: Promise<Runner> | null = null;

function assetUrl(relativePath: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) return chrome.runtime.getURL(relativePath);
  return new URL(relativePath, document.baseURI).toString();
}

async function loadDetector(): Promise<Runner> {
  const ort = await import('onnxruntime-web/webgpu');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const response = await fetch(assetUrl(MODEL_FILE));
  if (!response.ok) throw new Error(`Text detector missing (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const providers = typeof navigator !== 'undefined' && 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm'];
  let lastError: unknown;
  for (const provider of providers) {
    try {
      const session = await ort.InferenceSession.create(bytes, { executionProviders: [provider] });
      return async (input, width, height) => {
        const result = await session.run({ x: new ort.Tensor('float32', input, [1, 3, height, width]) });
        const out = result[session.outputNames[0]!];
        if (!out) throw new Error('Text detector returned no output');
        return out.data as Float32Array;
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Text detector could not start');
}

function getDetector(): Promise<Runner> {
  if (!loading) {
    loading = loadDetector().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

export async function detectTextOnDevice(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): Promise<TextDetection | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const work = (async () => detectText(rgba, width, height, await getDetector()))();
    work.catch(() => undefined);
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), BUDGET_MS);
    });
    return await Promise.race([work, timeout]);
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}