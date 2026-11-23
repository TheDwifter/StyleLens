import type { AIProviderId } from '../ai/types';

export type ByokPresetId =
  | 'claude'
  | 'openai'
  | 'deepseek'
  | 'gemini'
  | 'kimi'
  | 'qwen'
  | 'openrouter'
  | 'ollama'
  | 'custom';

export type ApiProtocol = 'openai' | 'anthropic';

export interface ByokPreset {
  id: ByokPresetId;
  label: string;
  vendor: string;
  regionTag: string;
  protocol: ApiProtocol;
  baseUrl: string;
  defaultModel: string;
  supportsVision: boolean;
  requiresApiKey: boolean;
  keyHint: string;
}

export const BYOK_PRESETS: readonly ByokPreset[] = [
  {
    id: 'claude',
    label: 'Claude',
    vendor: 'Anthropic',
    regionTag: 'Global',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    supportsVision: true,
    requiresApiKey: true,
    keyHint: 'sk-ant-...',
  },
  {
    id: 'openai',
    label: 'ChatGPT',
    vendor: 'OpenAI',
    regionTag: 'Global',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    supportsVision: true,
    requiresApiKey: true,
    keyHint: 'sk-...',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    vendor: 'DeepSeek',
    regionTag: 'CN / Global',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    supportsVision: false,
    requiresApiKey: true,
    keyHint: 'sk-...',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    vendor: 'Google',
    regionTag: 'Global',
    protocol: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    supportsVision: true,
    requiresApiKey: true,
    keyHint: 'AIza...',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    vendor: 'Moonshot',
    regionTag: 'CN',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    supportsVision: false,
    requiresApiKey: true,
    keyHint: 'sk-...',
  },
  {
    id: 'qwen',
    label: 'Qwen',
    vendor: 'Alibaba',
    regionTag: 'CN',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    supportsVision: true,
    requiresApiKey: true,
    keyHint: 'sk-... (qwen-vl-max for vision)',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    vendor: 'Multi-Model',
    regionTag: 'Global',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.5-flash',
    supportsVision: true,
    requiresApiKey: true,
    keyHint: 'sk-or-...',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    vendor: 'Local PC',
    regionTag: 'Local',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder:7b',
    supportsVision: false,
    requiresApiKey: false,
    keyHint: 'Optional (leave blank for local Ollama)',
  },
  {
    id: 'custom',
    label: 'Custom API',
    vendor: 'OpenAI-Compat',
    regionTag: 'Any',
    protocol: 'openai',
    baseUrl: '',
    defaultModel: '',
    supportsVision: false,
    requiresApiKey: true,
    keyHint: 'Optional bearer token',
  },
] as const;

export interface ByokConfig {
  presetId: ByokPresetId;
  baseUrl: string;
  model: string;
  apiKey: string;
  includeScreenshot: boolean;
}

export type UiMode = 'simple' | 'studio';
export type UiLanguage = 'en' | 'zh-CN';

export interface AiSettings {
  activeProvider: AIProviderId;
  byok: ByokConfig;
  uiMode?: UiMode;
  stillMode?: boolean;
  language?: UiLanguage;
}

const STORAGE_KEY = 'stylelens_ai_settings_v1';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  activeProvider: 'deterministic',
  byok: {
    presetId: 'claude',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    apiKey: '',
    includeScreenshot: true,
  },
  uiMode: 'simple',
  stillMode: false,
  language: 'en',
};

export function getPresetById(id: ByokPresetId): ByokPreset {
  return BYOK_PRESETS.find((p) => p.id === id) ?? BYOK_PRESETS[0]!;
}

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export function extractEndpointOriginPattern(baseUrl: string): string | null {
  try {
    const parsed = new URL(normalizeBaseUrl(baseUrl));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}

export async function loadAiSettings(): Promise<AiSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return DEFAULT_AI_SETTINGS;
  }
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const saved = data[STORAGE_KEY] as Partial<AiSettings> | undefined;
    if (!saved) return DEFAULT_AI_SETTINGS;
    return {
      activeProvider: saved.activeProvider ?? DEFAULT_AI_SETTINGS.activeProvider,
      byok: {
        ...DEFAULT_AI_SETTINGS.byok,
        ...(saved.byok ?? {}),
      },
      uiMode: saved.uiMode === 'studio' ? 'studio' : 'simple',
      stillMode: Boolean(saved.stillMode),
      language: saved.language === 'zh-CN' ? 'zh-CN' : 'en',
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

export async function ensureApiOriginPermission(
  baseUrl: string
): Promise<{ granted: boolean; originPattern: string | null }> {
  const originPattern = extractEndpointOriginPattern(baseUrl);
  if (!originPattern) return { granted: false, originPattern: null };
  if (typeof chrome === 'undefined' || !chrome.permissions) {
    return { granted: true, originPattern };
  }

  const already = await chrome.permissions.contains({ origins: [originPattern] });
  if (already) return { granted: true, originPattern };

  const requested = await chrome.permissions.request({ origins: [originPattern] });
  return { granted: requested, originPattern };
}
