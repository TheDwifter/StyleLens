import type { FidelityReport } from '../core/fidelityCritic';
import type { RemixTargetStack } from '../core/specGenerator';
import type { CaptureRecord } from '../types/capture';

export type AIProviderId = 'deterministic' | 'chrome-builtin' | 'openai-compatible';

export type ProviderAvailability = 'ready' | 'downloadable' | 'needs-config' | 'unavailable';

export interface ProviderCapability {
  id: AIProviderId;
  label: string;
  availability: ProviderAvailability;
  supportsMultimodal: boolean;
  detail: string;
}

export interface DesignInfluenceItem {
  token: string;
  usage: string;
}

export interface RemixRequest {
  record: CaptureRecord;
  /** Optional second saved capture whose palette/surfaces are blended into the remix. */
  secondaryRecord?: CaptureRecord | null;
  userPrompt: string;
  targetStack: RemixTargetStack;
  signal?: AbortSignal;
  onStatus?: (statusText: string) => void;
}

export interface RemixOutput {
  providerId: AIProviderId;
  modelLabel: string;
  usedVision: boolean;
  promptPackage: string;
  cssTokens: string;
  tailwindTheme: string;
  designSpecJson: string;
  simplifiedHtml: string;
  generatedCode?: string;
  previewHtml?: string;
  designRationale: string[];
  influencedBy: DesignInfluenceItem[];
  fidelityReport?: FidelityReport;
}

export interface AIProvider {
  readonly id: AIProviderId;
  readonly label: string;
  checkCapability(): Promise<ProviderCapability>;
  synthesizeRemix(request: RemixRequest): Promise<RemixOutput>;
}

export interface ChromeLanguageModelSession {
  prompt: (
    input:
      | string
      | Array<{
          role: 'system' | 'user' | 'assistant';
          content:
            | string
            | Array<
                | { type: 'text'; value: string }
                | { type: 'image'; value: Blob | ImageBitmap }
              >;
        }>,
    options?: { signal?: AbortSignal }
  ) => Promise<string>;
  destroy?: () => void;
}

export interface ChromeLanguageModelStatic {
  availability?: (options?: {
    expectedInputs?: Array<{ type: 'text' | 'image' | 'audio'; languages?: string[] }>;
    expectedOutputs?: Array<{ type: 'text'; languages?: string[] }>;
  }) => Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  create?: (options?: {
    initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    expectedInputs?: Array<{ type: 'text' | 'image' | 'audio'; languages?: string[] }>;
    expectedOutputs?: Array<{ type: 'text'; languages?: string[] }>;
    signal?: AbortSignal;
    monitor?: (target: EventTarget) => void;
  }) => Promise<ChromeLanguageModelSession>;
}

export function getChromeLanguageModel(): ChromeLanguageModelStatic | undefined {
  return (globalThis as typeof globalThis & { LanguageModel?: ChromeLanguageModelStatic })
    .LanguageModel;
}

/**
 * Safely probes runtime AI capabilities without downloading model weights or making network calls.
 */
export async function probeAllProviderCapabilities(
  byokConfigured = false
): Promise<ProviderCapability[]> {
  const results: ProviderCapability[] = [
    {
      id: 'deterministic',
      label: 'Offline Design Engine',
      availability: 'ready',
      supportsMultimodal: true,
      detail: '100% offline deterministic Design DNA + live token specimen + prompt packager.',
    },
    {
      id: 'openai-compatible',
      label: 'BYOK AI (DeepSeek / Qwen / Gemini / OpenAI / Ollama)',
      availability: byokConfigured ? 'ready' : 'needs-config',
      supportsMultimodal: true,
      detail: byokConfigured
        ? 'Configured with your own API endpoint (stored locally in Chrome).'
        : 'Zero downloads — paste your own API key (or local Ollama URL) to generate live remixed components.',
    },
  ];

  const lm = getChromeLanguageModel();
  if (lm && typeof lm.availability === 'function') {
    try {
      const multimodalStatus = await lm.availability({
        expectedInputs: [{ type: 'text' }, { type: 'image' }],
        expectedOutputs: [{ type: 'text' }],
      });
      if (multimodalStatus === 'available') {
        results.push({
          id: 'chrome-builtin',
          label: 'Chrome Built-in AI (Gemini Nano)',
          availability: 'ready',
          supportsMultimodal: true,
          detail: 'On-device multimodal Gemini Nano is ready in this Chrome profile.',
        });
        return results;
      }

      const textStatus = await lm.availability({
        expectedInputs: [{ type: 'text' }],
        expectedOutputs: [{ type: 'text' }],
      });
      if (textStatus === 'available') {
        results.push({
          id: 'chrome-builtin',
          label: 'Chrome Built-in AI (Gemini Nano)',
          availability: 'ready',
          supportsMultimodal: false,
          detail: 'On-device text Gemini Nano ready (grounds on exact DOM/CSS tokens).',
        });
      } else if (
        multimodalStatus === 'downloadable' ||
        multimodalStatus === 'downloading' ||
        textStatus === 'downloadable' ||
        textStatus === 'downloading'
      ) {
        results.push({
          id: 'chrome-builtin',
          label: 'Chrome Built-in AI (Gemini Nano)',
          availability: 'downloadable',
          supportsMultimodal: multimodalStatus !== 'unavailable',
          detail: 'Supported by Chrome; weights download only if you explicitly choose this engine.',
        });
      } else {
        results.push({
          id: 'chrome-builtin',
          label: 'Chrome Built-in AI (Gemini Nano)',
          availability: 'unavailable',
          supportsMultimodal: false,
          detail: 'Hardware or region floor not met on this device (use BYOK or Offline Engine).',
        });
      }
    } catch {
      results.push({
        id: 'chrome-builtin',
        label: 'Chrome Built-in AI (Gemini Nano)',
        availability: 'unavailable',
        supportsMultimodal: false,
        detail: 'Built-in LanguageModel API check failed on this browser.',
      });
    }
  } else {
    results.push({
      id: 'chrome-builtin',
      label: 'Chrome Built-in AI (Gemini Nano)',
      availability: 'unavailable',
      supportsMultimodal: false,
      detail: 'Not exposed in this browser build (use BYOK or Offline Engine).',
    });
  }

  return results;
}
