import {
  evaluateFidelity,
  FIDELITY_TARGET_PERCENT,
  type FidelityReport,
} from '../core/fidelityCritic';
import {
  generateCssTokens,
  generateDesignSpecJson,
  generateRemixPrompt,
  generateSimplifiedHtml,
  generateTailwindTheme,
} from '../core/specGenerator';
import {
  getPresetById,
  normalizeBaseUrl,
  type ByokConfig,
} from '../storage/aiSettingsStore';
import {
  AI_REMIX_SYSTEM_PROMPT,
  buildLlmUserPrompt,
  parseAiRemixResponse,
} from './responseParser';
import type {
  AIProvider,
  ProviderCapability,
  RemixOutput,
  RemixRequest,
} from './types';

const MAX_VISION_EDGE_PX = 768;

async function blobToCompactDataUrl(blob: Blob): Promise<string> {
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, MAX_VISION_EDGE_PX / Math.max(bitmap.width, bitmap.height, 1));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, w, h);
        const compressed = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        return await rawBlobToDataUrl(compressed);
      }
    } finally {
      bitmap.close();
    }
  }
  return rawBlobToDataUrl(blob);
}

function rawBlobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not serialize screenshot blob.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error.'));
    reader.readAsDataURL(blob);
  });
}

function splitDataUrl(dataUrl: string): { mediaType: string; base64: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match || !match[1] || !match[2]) return null;
  return { mediaType: match[1], base64: match[2] };
}

function mapHttpError(status: number, bodyText: string, endpoint: string): string {
  const snippet = bodyText.slice(0, 180).replace(/\s+/g, ' ').trim();
  if (status === 401 || status === 403) {
    return `Authentication failed (${status}). Check your API key for ${endpoint}.`;
  }
  if (status === 404) {
    return `Endpoint or model not found (404). Verify Base URL and Model name (${snippet || endpoint}).`;
  }
  if (status === 429) {
    return `Rate limit or quota exceeded (429). Wait a moment or check your account balance.`;
  }
  return `Provider returned HTTP ${status}${snippet ? `: ${snippet}` : ''}`;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: { message?: string };
}

interface AnthropicMessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
}

function extractOpenAiText(data: ChatCompletionResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
  }
  if (data.error?.message) throw new Error(data.error.message);
  throw new Error('Provider returned an empty completion.');
}

function extractAnthropicText(data: AnthropicMessagesResponse): string {
  if (Array.isArray(data.content)) {
    const combined = data.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('\n')
      .trim();
    if (combined) return combined;
  }
  if (data.error?.message) throw new Error(data.error.message);
  throw new Error('Claude returned an empty response.');
}

export function isAnthropicConfig(config: ByokConfig): boolean {
  const preset = getPresetById(config.presetId);
  return preset.protocol === 'anthropic' || /api\.anthropic\.com/i.test(config.baseUrl);
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id = 'openai-compatible' as const;
  readonly label = 'Connected Account AI';

  constructor(private readonly config: ByokConfig) {}

  isConfigured(): boolean {
    const preset = getPresetById(this.config.presetId);
    const hasUrl = normalizeBaseUrl(this.config.baseUrl).length > 0;
    const hasModel = this.config.model.trim().length > 0;
    const hasKey = !preset.requiresApiKey || this.config.apiKey.trim().length > 0;
    return hasUrl && hasModel && hasKey;
  }

  async checkCapability(): Promise<ProviderCapability> {
    const ready = this.isConfigured();
    return {
      id: this.id,
      label: this.label,
      availability: ready ? 'ready' : 'needs-config',
      supportsMultimodal: this.config.includeScreenshot,
      detail: ready
        ? `${this.config.model} via ${normalizeBaseUrl(this.config.baseUrl)}`
        : 'Connect Claude, ChatGPT, DeepSeek, Gemini, Kimi, or Ollama.',
    };
  }

  async synthesizeRemix(request: RemixRequest): Promise<RemixOutput> {
    if (!this.isConfigured()) {
      throw new Error('Connect an AI account first using Connect Account at the bottom.');
    }

    const { record, secondaryRecord, userPrompt, targetStack, signal, onStatus } = request;
    const baseUrl = normalizeBaseUrl(this.config.baseUrl);
    const userText = buildLlmUserPrompt(record, userPrompt, targetStack, secondaryRecord);
    const useAnthropic = isAnthropicConfig(this.config);

    let usedVision = false;
    let imageDataUrl: string | null = null;

    if (this.config.includeScreenshot && record.screenshotBlob.size > 0) {
      onStatus?.('Preparing screenshot for vision context...');
      try {
        imageDataUrl = await blobToCompactDataUrl(record.screenshotBlob);
        usedVision = true;
      } catch {
        usedVision = false;
      }
    }

    onStatus?.(`Generating with ${this.config.model}...`);

    let rawText: string;
    if (useAnthropic) {
      rawText = await this.callAnthropic(baseUrl, userText, imageDataUrl, signal);
    } else {
      rawText = await this.callOpenAi(baseUrl, userText, imageDataUrl, signal);
    }

    const auditParsedOutput = (candidate: ReturnType<typeof parseAiRemixResponse>): FidelityReport => {
      const hasPreview = Boolean(candidate.previewHtml.trim());
      const hasCode = Boolean(candidate.code.trim());
      if (hasPreview && hasCode) {
        const previewReport = evaluateFidelity(record, candidate.previewHtml);
        const codeReport = evaluateFidelity(record, candidate.code);
        // Take the stricter (lower) score so tokens in `code` can NEVER mask broken `previewHtml`
        const weaker = previewReport.totalScore <= codeReport.totalScore ? previewReport : codeReport;
        const mergedIssues = Array.from(new Set([...previewReport.issues, ...codeReport.issues]));
        const passed = previewReport.passedThreshold && codeReport.passedThreshold;
        return {
          ...weaker,
          passedThreshold: passed,
          issues: mergedIssues,
        };
      }
      return evaluateFidelity(record, candidate.previewHtml || candidate.code);
    };

    let parsed = parseAiRemixResponse(rawText);
    let fidelityReport = auditParsedOutput(parsed);

    // Automated 98% Fidelity Critic Self-Repair Loop:
    // If live DOM recreation scores below 98%, automatically feed exact missing tokens / hallucination violations back (up to 2 passes).
    for (
      let attempt = 1;
      attempt <= 2 &&
      !fidelityReport.passedThreshold &&
      !fidelityReport.isBakedVisualOnly &&
      fidelityReport.issues.length > 0 &&
      !signal?.aborted;
      attempt += 1
    ) {
      onStatus?.(
        `Fidelity Critic scored ${fidelityReport.totalScore}% (< ${FIDELITY_TARGET_PERCENT}%) — auto-refining (pass ${attempt}/2)...`
      );
      const repairPrompt = [
        userText,
        ``,
        `--- STRICT 98% FIDELITY CRITIC AUDIT (CURRENT SCORE: ${fidelityReport.totalScore}% — MUST REACH >= ${FIDELITY_TARGET_PERCENT}%) ---`,
        `Your previous output had these exact fidelity violations:`,
        ...fidelityReport.issues.slice(0, 12).map((issue) => `- ${issue}`),
        ``,
        `Fix EVERY missing font, color, SVG accent, 2D layout coordinate, border, shadow, backdrop, or hallucinated decoration in BOTH "previewHtml" and "code" while preserving the user's goal. Return ONLY the strict JSON object.`,
      ].join('\n');

      try {
        const repairedRaw = useAnthropic
          ? await this.callAnthropic(baseUrl, repairPrompt, imageDataUrl, signal)
          : await this.callOpenAi(baseUrl, repairPrompt, imageDataUrl, signal);
        const repairedParsed = parseAiRemixResponse(repairedRaw);
        const repairedReport = auditParsedOutput(repairedParsed);
        const preservesPreview = !parsed.previewHtml || Boolean(repairedParsed.previewHtml);
        if (preservesPreview && repairedReport.totalScore >= fidelityReport.totalScore) {
          parsed = repairedParsed;
          fidelityReport = repairedReport;
        }
      } catch {
        break;
      }
    }

    const influencedBy =
      parsed.influencedBy.length > 0
        ? parsed.influencedBy
        : [
            {
              token: `${record.dna.polarity} theme + ${record.dna.palette.slice(0, 2).map((c) => c.hex).join(', ')}`,
              usage: 'Grounded color and surface hierarchy passed in Design DNA spec.',
            },
          ];

    return {
      providerId: this.id,
      modelLabel: this.config.model.trim(),
      usedVision,
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
  }

  private async callAnthropic(
    baseUrl: string,
    userText: string,
    imageDataUrl: string | null,
    signal?: AbortSignal
  ): Promise<string> {
    const endpoint = `${baseUrl}/messages`;
    const parts: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    > = [];

    if (imageDataUrl) {
      const split = splitDataUrl(imageDataUrl);
      if (split) {
        parts.push({
          type: 'image',
          source: { type: 'base64', media_type: split.mediaType, data: split.base64 },
        });
      }
    }
    parts.push({ type: 'text', text: userText });

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey.trim(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: this.config.model.trim(),
          max_tokens: 4096,
          temperature: 0.2,
          system: AI_REMIX_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: parts }],
        }),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Generation cancelled.');
      }
      throw new Error(`Network error calling Claude (${err instanceof Error ? err.message : String(err)}).`);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(mapHttpError(response.status, errText, baseUrl));
    }

    const json = (await response.json()) as AnthropicMessagesResponse;
    return extractAnthropicText(json);
  }

  private async callOpenAi(
    baseUrl: string,
    userText: string,
    imageDataUrl: string | null,
    signal?: AbortSignal
  ): Promise<string> {
    const endpoint = `${baseUrl}/chat/completions`;
    const userContent = imageDataUrl
      ? [
          { type: 'text' as const, text: userText },
          { type: 'image_url' as const, image_url: { url: imageDataUrl } },
        ]
      : userText;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey.trim()) {
      headers.Authorization = `Bearer ${this.config.apiKey.trim()}`;
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: this.config.model.trim(),
          temperature: 0.2,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: AI_REMIX_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
        }),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Generation cancelled.');
      }
      throw new Error(
        `Network/CORS error calling ${baseUrl}. Try Test Connection in Connect Account (${err instanceof Error ? err.message : String(err)}).`
      );
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(mapHttpError(response.status, errText, baseUrl));
    }

    const json = (await response.json()) as ChatCompletionResponse;
    return extractOpenAiText(json);
  }
}

export async function testByokConnection(
  config: ByokConfig
): Promise<{ ok: boolean; message: string }> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const model = config.model.trim();
  if (!baseUrl || !model) {
    return { ok: false, message: 'Enter both Base URL and Model name.' };
  }

  try {
    if (isAnthropicConfig(config)) {
      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey.trim(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply with OK' }],
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, message: mapHttpError(res.status, text, baseUrl) };
      }
      return { ok: true, message: `Connected to Claude (${model}) successfully.` };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey.trim()) {
      headers.Authorization = `Bearer ${config.apiKey.trim()}`;
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 16,
        temperature: 0,
        messages: [{ role: 'user', content: 'Reply with OK' }],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, message: mapHttpError(res.status, text, baseUrl) };
    }

    return { ok: true, message: `Connected to ${model} successfully.` };
  } catch (err) {
    return {
      ok: false,
      message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
