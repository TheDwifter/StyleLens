import { inpaintErasedRegion, type InpaintModelRunner } from '../../core/onDeviceInpaint';

/**
 * Loads and runs the bundled LaMa inpainting model (37 MB, shipped inside the extension under
 * `models/`) with ONNX Runtime Web. Nothing is downloaded at run time and no picture leaves the
 * device. The engine and the model are loaded lazily, the first time a picture actually needs
 * them.
 *
 * Backend: WebGPU (well under a second per picture once loaded). Computers without a usable
 * graphics adapter skip the model and the caller asks the chat AI instead.
 *
 * Weak-computer safeguards:
 * - Very low-memory devices, and devices without WebGPU, skip the model entirely.
 * - Every rebuild runs under a time budget; a machine that is too slow gives up cleanly rather
 *   than leaving the user staring at a spinner.
 * - The model's memory is released after a few idle minutes.
 */
const MODEL_FILE = 'models/lama_int4_int8_r4.onnx';

/** Total budget for one rebuild, including the one-time model load. */
const FIRST_RUN_BUDGET_MS = 90_000;
/** Budget once the model is already loaded. */
const WARM_RUN_BUDGET_MS = 45_000;
/** Free the model's memory after this much idle time. */
const IDLE_RELEASE_MS = 4 * 60_000;
/** `navigator.deviceMemory` (GB) at or below which the model is not attempted. */
const MIN_DEVICE_MEMORY_GB = 2;

export type InpaintBackend = 'webgpu' | 'wasm';

export type InpaintSkipReason = 'low-memory' | 'no-gpu' | 'timeout' | 'failed';

export interface InpaintDiagnostics {
  backend: InpaintBackend | null;
  /** Why the last rebuild did not produce a picture, if it did not. */
  lastSkipReason: InpaintSkipReason | null;
  lastLoadMs: number | null;
  lastRunMs: number | null;
}

const diagnostics: InpaintDiagnostics = {
  backend: null,
  lastSkipReason: null,
  lastLoadMs: null,
  lastRunMs: null,
};

/** Test / troubleshooting hook: force a backend instead of auto-detecting. */
let forcedBackend: InpaintBackend | null = null;
export function forceInpaintBackend(backend: InpaintBackend | null): void {
  forcedBackend = backend;
}

export function getInpaintDiagnostics(): InpaintDiagnostics {
  return { ...diagnostics };
}

function assetUrl(relativePath: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(relativePath);
  }
  return new URL(relativePath, document.baseURI).toString();
}

/** True when this device should not attempt the model at all. */
export function isDeviceTooWeakForInpaint(
  nav: { deviceMemory?: number } | undefined = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { deviceMemory?: number })
    : undefined
): boolean {
  const memory = nav?.deviceMemory;
  return typeof memory === 'number' && memory > 0 && memory <= MIN_DEVICE_MEMORY_GB;
}

async function hasUsableWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (!gpu) return false;
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

interface LoadedModel {
  runner: InpaintModelRunner;
  backend: InpaintBackend;
  release: () => Promise<void>;
}

let loading: Promise<LoadedModel> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

async function loadModel(): Promise<LoadedModel> {
  const startedAt = performance.now();
  const ort = await import('onnxruntime-web/webgpu');
  // The engine's .wasm file is emitted by the bundler next to this code and found automatically;
  // it ships inside the extension like every other asset.
  // Threads need a cross-origin-isolated page; an extension side panel is not one.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;

  const response = await fetch(assetUrl(MODEL_FILE));
  if (!response.ok) throw new Error(`Inpainting model missing (${response.status})`);
  const modelBytes = new Uint8Array(await response.arrayBuffer());

  // Without a usable graphics adapter the only option is single-threaded WebAssembly on the
  // panel's own thread: measured at ~19 s per picture on a fast 24-core desktop, so minutes on a
  // weak laptop, with the panel frozen meanwhile. That is worse than asking the chat AI, so the
  // model is only used with WebGPU (the WebAssembly path stays available for tests).
  const attempts: InpaintBackend[] = forcedBackend
    ? [forcedBackend]
    : (await hasUsableWebGpu())
      ? ['webgpu']
      : [];
  if (attempts.length === 0) throw new Error('No WebGPU adapter: on-device rebuild skipped');
  let lastError: unknown;
  for (const backend of attempts) {
    try {
      const session = await ort.InferenceSession.create(modelBytes, {
        executionProviders: [backend],
        // Required by this quantised model: fold its stored int4/int8 weights back to float
        extra: { session: { disable_quant_qdq: '1' } },
      });
      const runner: InpaintModelRunner = async (image, mask, size) => {
        const result = await session.run({
          image: new ort.Tensor('float32', image, [1, 3, size, size]),
          mask: new ort.Tensor('float32', mask, [1, 1, size, size]),
        });
        const first = result[session.outputNames[0]!];
        if (!first) throw new Error('Inpainting model returned no output');
        return first.data as Float32Array;
      };
      diagnostics.backend = backend;
      diagnostics.lastLoadMs = Math.round(performance.now() - startedAt);
      return { runner, backend, release: () => session.release() };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Inpainting model could not start');
}

function getModel(): Promise<LoadedModel> {
  if (!loading) {
    loading = loadModel().catch((err) => {
      loading = null; // allow a later retry
      throw err;
    });
  }
  return loading;
}

/** Frees the model's memory now. Safe to call at any time; the next rebuild reloads it. */
export async function releaseInpaintModel(): Promise<void> {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const pending = loading;
  loading = null;
  if (!pending) return;
  try {
    await (await pending).release();
  } catch {
    // Already gone or never loaded
  }
}

function scheduleIdleRelease(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    void releaseInpaintModel();
  }, IDLE_RELEASE_MS);
}

/** Which backend the model is running on, once loaded (for diagnostics / the run report). */
export async function getInpaintBackend(): Promise<InpaintBackend | null> {
  try {
    return (await getModel()).backend;
  } catch {
    return null;
  }
}

/**
 * Rebuilds the picture under `eraseMask` on this device. Returns null (never throws) when the
 * device is too weak, the model cannot run, or it does not finish within its time budget, so
 * callers can fall back to asking the chat AI. `getInpaintDiagnostics()` says which.
 */
export async function rebuildBackgroundOnDevice(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  eraseMask: Uint8Array
): Promise<Uint8ClampedArray | null> {
  diagnostics.lastSkipReason = null;
  if (isDeviceTooWeakForInpaint()) {
    diagnostics.lastSkipReason = 'low-memory';
    return null;
  }

  const wasLoaded = loading !== null;
  const budgetMs = wasLoaded ? WARM_RUN_BUDGET_MS : FIRST_RUN_BUDGET_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), budgetMs);
  });

  const work = (async () => {
    const { runner } = await getModel();
    const startedAt = performance.now();
    const rebuilt = await inpaintErasedRegion(rgba, width, height, eraseMask, runner);
    diagnostics.lastRunMs = Math.round(performance.now() - startedAt);
    return rebuilt;
  })();
  // If the budget wins the race, the work may still settle later: never leave it unhandled.
  work.catch(() => undefined);

  try {
    const outcome = await Promise.race([work, timedOut]);
    if (outcome === 'timeout') {
      diagnostics.lastSkipReason = 'timeout';
      // A machine this slow should not keep the model in memory for another attempt
      void releaseInpaintModel();
      return null;
    }
    if (!outcome) diagnostics.lastSkipReason = 'failed';
    else scheduleIdleRelease();
    return outcome;
  } catch (err) {
    diagnostics.lastSkipReason =
      err instanceof Error && /No WebGPU adapter/.test(err.message) ? 'no-gpu' : 'failed';
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
