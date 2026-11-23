import { evaluateFidelity } from '../core/fidelityCritic';
import {
  generateCssTokens,
  generateDesignSpecJson,
  generateRemixPrompt,
  generateSimplifiedHtml,
  generateTailwindTheme,
} from '../core/specGenerator';
import {
  AI_REMIX_SYSTEM_PROMPT,
  buildLlmUserPrompt,
  parseAiRemixResponse,
} from './responseParser';
import {
  getChromeLanguageModel,
  type AIProvider,
  type ChromeLanguageModelSession,
  type ProviderCapability,
  type RemixOutput,
  type RemixRequest,
} from './types';

/**
 * Optional on-device provider backed by Chrome's built-in Prompt API (LanguageModel / Gemini Nano).
 * Runs directly inside the Side Panel document context (never in the Service Worker)
 * and NEVER auto-downloads weights unless the user explicitly triggers generation.
 */
export class ChromeBuiltInProvider implements AIProvider {
  readonly id = 'chrome-builtin' as const;
  readonly label = 'Chrome Built-in AI (Gemini Nano)';

  async checkCapability(): Promise<ProviderCapability> {
    const lm = getChromeLanguageModel();
    if (!lm || typeof lm.availability !== 'function') {
      return {
        id: this.id,
        label: this.label,
        availability: 'unavailable',
        supportsMultimodal: false,
        detail: 'Chrome LanguageModel API is not available in this browser.',
      };
    }

    try {
      const mm = await lm.availability({
        expectedInputs: [{ type: 'text' }, { type: 'image' }],
        expectedOutputs: [{ type: 'text' }],
      });
      if (mm === 'available') {
        return {
          id: this.id,
          label: this.label,
          availability: 'ready',
          supportsMultimodal: true,
          detail: 'On-device multimodal Gemini Nano ready.',
        };
      }
      const txt = await lm.availability({
        expectedInputs: [{ type: 'text' }],
        expectedOutputs: [{ type: 'text' }],
      });
      if (txt === 'available') {
        return {
          id: this.id,
          label: this.label,
          availability: 'ready',
          supportsMultimodal: false,
          detail: 'On-device text Gemini Nano ready.',
        };
      }
      if (mm === 'downloadable' || mm === 'downloading' || txt === 'downloadable' || txt === 'downloading') {
        return {
          id: this.id,
          label: this.label,
          availability: 'downloadable',
          supportsMultimodal: mm !== 'unavailable',
          detail: 'Downloadable on demand (requires ~22 GB free disk space).',
        };
      }
    } catch {
      // Fall through to unavailable
    }

    return {
      id: this.id,
      label: this.label,
      availability: 'unavailable',
      supportsMultimodal: false,
      detail: 'Not supported on this device or Chrome profile.',
    };
  }

  async synthesizeRemix(request: RemixRequest): Promise<RemixOutput> {
    const lm = getChromeLanguageModel();
    if (!lm || typeof lm.create !== 'function' || typeof lm.availability !== 'function') {
      throw new Error(
        'Chrome Built-in AI (LanguageModel) is unavailable in this browser. Switch to BYOK AI or Offline Mode in Settings.'
      );
    }

    const { record, secondaryRecord, userPrompt, targetStack, signal, onStatus } = request;

    const mmStatus = await lm.availability({
      expectedInputs: [{ type: 'text' }, { type: 'image' }],
      expectedOutputs: [{ type: 'text' }],
    });
    const useImage = mmStatus !== 'unavailable' && record.screenshotBlob.size > 0;

    if (!useImage) {
      const textStatus = await lm.availability({
        expectedInputs: [{ type: 'text' }],
        expectedOutputs: [{ type: 'text' }],
      });
      if (textStatus === 'unavailable') {
        throw new Error(
          'Chrome Built-in Gemini Nano is unavailable on this hardware/region. Use BYOK AI (DeepSeek, Qwen, Gemini, OpenAI, or Ollama) instead.'
        );
      }
    }

    onStatus?.(
      mmStatus === 'downloadable'
        ? 'Downloading Chrome Built-in Gemini Nano (one-time)...'
        : 'Starting on-device Gemini Nano session...'
    );

    let session: ChromeLanguageModelSession | null = null;
    try {
      session = await lm.create({
        initialPrompts: [{ role: 'system', content: AI_REMIX_SYSTEM_PROMPT }],
        expectedInputs: useImage
          ? [{ type: 'text' }, { type: 'image' }]
          : [{ type: 'text' }],
        expectedOutputs: [{ type: 'text' }],
        signal,
        monitor: (target) => {
          target.addEventListener('downloadprogress', (ev: Event) => {
            const loaded = (ev as Event & { loaded?: number }).loaded;
            if (typeof loaded === 'number') {
              onStatus?.(`Downloading Gemini Nano (${Math.round(loaded * 100)}%)...`);
            }
          });
        },
      });

      const promptText = buildLlmUserPrompt(record, userPrompt, targetStack, secondaryRecord);
      onStatus?.('Generating remixed UI on device...');

      const rawText = useImage
        ? await session.prompt(
            [
              {
                role: 'user',
                content: [
                  { type: 'text', value: promptText },
                  { type: 'image', value: record.screenshotBlob },
                ],
              },
            ],
            { signal }
          )
        : await session.prompt(promptText, { signal });

      const parsed = parseAiRemixResponse(rawText);
      const influencedBy =
        parsed.influencedBy.length > 0
          ? parsed.influencedBy
          : [
              {
                token: `${record.dna.polarity} polarity + extracted DOM tokens`,
                usage: 'Passed to on-device Gemini Nano alongside visual context.',
              },
            ];

      const candidateForAudit = parsed.previewHtml || parsed.code;
      const fidelityReport = evaluateFidelity(record, candidateForAudit);

      return {
        providerId: this.id,
        modelLabel: useImage ? 'Gemini Nano (Multimodal)' : 'Gemini Nano (On-Device)',
        usedVision: useImage,
        promptPackage: generateRemixPrompt(record, userPrompt, targetStack),
        cssTokens: generateCssTokens(record),
        tailwindTheme: generateTailwindTheme(record),
        designSpecJson: generateDesignSpecJson(record),
        simplifiedHtml: generateSimplifiedHtml(record.roots),
        generatedCode: parsed.code,
        previewHtml: parsed.previewHtml || undefined,
        designRationale: influencedBy.map((item) => `${item.token}: ${item.usage}`),
        influencedBy,
        fidelityReport,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('On-device generation cancelled.');
      }
      throw err;
    } finally {
      // Immediately free GPU/VRAM held by Gemini Nano session
      session?.destroy?.();
    }
  }
}

export const chromeBuiltInProvider = new ChromeBuiltInProvider();
