import {
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  Sparkles,
  Trash2,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { testByokConnection } from '../../ai/openaiCompatibleProvider';
import type { AIProviderId, ProviderCapability } from '../../ai/types';
import {
  BYOK_PRESETS,
  ensureApiOriginPermission,
  getPresetById,
  type AiSettings,
  type ByokPresetId,
  type UiLanguage,
} from '../../storage/aiSettingsStore';
import { getTranslations } from '../i18n/translations';

interface AiSettingsModalProps {
  settings: AiSettings;
  capabilities: ProviderCapability[];
  onSave: (next: AiSettings) => Promise<void>;
  onClose: () => void;
}

const PROVIDER_DOT_COLOR: Record<ByokPresetId, string> = {
  claude: 'bg-amber-400',
  openai: 'bg-emerald-400',
  deepseek: 'bg-sky-400',
  gemini: 'bg-blue-300',
  kimi: 'bg-violet-300',
  qwen: 'bg-indigo-300',
  openrouter: 'bg-zinc-300',
  ollama: 'bg-slate-400',
  custom: 'bg-zinc-500',
};

export function AiSettingsModal({
  settings,
  capabilities,
  onSave,
  onClose,
}: AiSettingsModalProps) {
  const [draft, setDraft] = useState<AiSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const selectedPreset = getPresetById(draft.byok.presetId);
  const chromeAiCap = capabilities.find((c) => c.id === 'chrome-builtin');
  const activeLanguage: UiLanguage = draft.language === 'zh-CN' ? 'zh-CN' : 'en';
  const t = getTranslations(activeLanguage);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSelectProvider = (provider: AIProviderId) => {
    setDraft((prev) => ({ ...prev, activeProvider: provider }));
    setTestResult(null);
  };

  const handleSelectPreset = (presetId: ByokPresetId) => {
    const preset = getPresetById(presetId);
    setDraft((prev) => ({
      ...prev,
      activeProvider: 'openai-compatible',
      byok: {
        ...prev.byok,
        presetId,
        baseUrl: preset.baseUrl || prev.byok.baseUrl,
        model: preset.defaultModel || prev.byok.model,
        includeScreenshot: preset.supportsVision,
      },
    }));
    setTestResult(null);
  };

  const handleSaveOnly = async () => {
    if (draft.activeProvider === 'openai-compatible' && draft.byok.baseUrl.trim()) {
      await ensureApiOriginPermission(draft.byok.baseUrl).catch(() => {});
    }
    await onSave(draft);
    onClose();
  };

  const handleSaveAndTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const perm = await ensureApiOriginPermission(draft.byok.baseUrl);
      if (!perm.granted && perm.originPattern) {
        setTestResult({
          ok: false,
          message: t.permissionDeclined(perm.originPattern),
        });
        setTesting(false);
        return;
      }

      await onSave(draft);
      const result = await testByokConnection(draft.byok);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : t.testFailedGeneric,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="sl-stealth-canvas fixed inset-0 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#0b0b0d] px-4 py-3">
        <span className="text-[14px] font-semibold tracking-tight text-white">
          {t.settingsTitle}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="space-y-2">
          <div className="text-[11.5px] font-medium uppercase tracking-wider text-zinc-400">
            {t.appearanceComfort}
          </div>

          {/* Language Selector (English / 简体中文) */}
          <div className="sl-card flex items-center justify-between gap-3 rounded-xl px-3.5 py-3">
            <div className="min-w-0 pr-2">
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-white">
                <Globe className="h-3.5 w-3.5 text-zinc-300" />
                <span>{t.languageLabel}</span>
              </div>
              <div className="text-[11.5px] text-zinc-400">{t.languageDesc}</div>
            </div>
            <div
              role="group"
              aria-label="Language"
              className="inline-flex shrink-0 rounded-lg border border-white/[0.14] bg-[#09090c] p-0.5 text-[11.5px]"
            >
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, language: 'en' }))}
                className={`rounded-md px-2.5 py-1 font-semibold transition ${
                  activeLanguage === 'en' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, language: 'zh-CN' }))}
                className={`rounded-md px-2.5 py-1 font-semibold transition ${
                  activeLanguage === 'zh-CN'
                    ? 'bg-white text-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                简体中文
              </button>
            </div>
          </div>

          <label className="sl-card flex cursor-pointer items-center justify-between rounded-xl px-3.5 py-3">
            <div className="pr-3">
              <div className="text-[12.5px] font-medium text-white">{t.stillModeLabel}</div>
              <div className="text-[11.5px] text-zinc-400">{t.stillModeDesc}</div>
            </div>
            <input
              type="checkbox"
              checked={Boolean(draft.stillMode)}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  stillMode: e.target.checked,
                }))
              }
              className="h-4 w-4 accent-white"
            />
          </label>
        </section>

        <section className="space-y-2.5">
          <div className="text-[11.5px] font-medium uppercase tracking-wider text-zinc-400">
            {t.aiConnectionMode}
          </div>

          {/* 1. Burnished Gold — Connect AI Account */}
          <EngineOption
            tone="gold"
            icon={<Sparkles className="h-4 w-4 text-amber-300" />}
            selected={draft.activeProvider === 'openai-compatible'}
            title={t.engineByokTitle}
            badge={t.engineByokBadge}
            description={t.engineByokDesc}
            onClick={() => handleSelectProvider('openai-compatible')}
          />

          {/* 2. Brushed Platinum Silver — Offline Mode */}
          <EngineOption
            tone="silver"
            icon={<WifiOff className="h-4 w-4 text-zinc-200" />}
            selected={draft.activeProvider === 'deterministic'}
            title={t.engineOfflineTitle}
            badge={t.engineOfflineBadge}
            description={t.engineOfflineDesc}
            onClick={() => handleSelectProvider('deterministic')}
          />

          {/* 3. Cool Slate Titanium — Chrome Built-in AI */}
          <EngineOption
            tone="titanium"
            icon={<Cpu className="h-4 w-4 text-slate-300" />}
            selected={draft.activeProvider === 'chrome-builtin'}
            title={t.engineChromeTitle}
            badge={chromeAiCap?.availability ?? 'unavailable'}
            description={
              activeLanguage === 'zh-CN'
                ? t.engineChromeDesc
                : (chromeAiCap?.detail ?? t.engineChromeDesc)
            }
            disabled={chromeAiCap?.availability === 'unavailable'}
            onClick={() => handleSelectProvider('chrome-builtin')}
          />
        </section>

        {draft.activeProvider === 'openai-compatible' && (
          <section className="rounded-xl border border-amber-300/25 bg-gradient-to-b from-[#171512] to-[#111114] p-4 space-y-3.5">
            <div className="space-y-2">
              <div className="text-[12px] font-medium text-amber-200/90">{t.chooseProvider}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {BYOK_PRESETS.map((preset) => {
                  const active = draft.byok.presetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset.id)}
                      className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-left text-[12px] transition ${
                        active
                          ? 'border-amber-300/70 bg-amber-400/12 text-white shadow-[0_0_12px_rgba(251,191,36,0.12)]'
                          : 'border-white/[0.08] bg-[#0b0b0d]/90 text-zinc-300 hover:border-amber-300/35 hover:text-white'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${PROVIDER_DOT_COLOR[preset.id]}`}
                        />
                        <span className="truncate font-medium">{preset.label}</span>
                      </span>
                      <span className="sl-mono ml-1 shrink-0 text-[9.5px] text-zinc-500">
                        {preset.vendor}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11.5px] text-zinc-400">{t.apiBaseUrl}</label>
              <input
                type="url"
                value={draft.byok.baseUrl}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    byok: { ...prev.byok, baseUrl: e.target.value },
                  }))
                }
                placeholder="https://api.anthropic.com/v1"
                className="sl-mono w-full rounded-lg border border-white/[0.12] bg-[#0b0b0d] px-3 py-2 text-[12px] text-white placeholder:text-zinc-600 focus:border-amber-300/60 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11.5px] text-zinc-400">{t.modelLabel}</label>
              <input
                type="text"
                value={draft.byok.model}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    byok: { ...prev.byok, model: e.target.value },
                  }))
                }
                placeholder={selectedPreset.defaultModel || 'model-id'}
                className="sl-mono w-full rounded-lg border border-white/[0.12] bg-[#0b0b0d] px-3 py-2 text-[12px] text-white placeholder:text-zinc-600 focus:border-amber-300/60 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[11.5px] text-zinc-400">
                  <KeyRound className="h-3 w-3 text-amber-300/80" />
                  {t.apiKeyLabel} {!selectedPreset.requiresApiKey && t.optionalTag}
                </label>
                {draft.byok.apiKey && (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        byok: { ...prev.byok, apiKey: '' },
                      }))
                    }
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-white"
                  >
                    <Trash2 className="h-3 w-3" />
                    {t.clearBtn}
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={draft.byok.apiKey}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      byok: { ...prev.byok, apiKey: e.target.value },
                    }))
                  }
                  placeholder={selectedPreset.keyHint}
                  className="sl-mono w-full rounded-lg border border-white/[0.12] bg-[#0b0b0d] py-2 pl-3 pr-9 text-[12px] text-white placeholder:text-zinc-600 focus:border-amber-300/60 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                  title={showKey ? t.hideKeyTitle : t.showKeyTitle}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/[0.08] bg-[#0b0b0d] px-3 py-2.5">
              <div className="pr-3">
                <div className="text-[12px] font-medium text-zinc-200">
                  {t.includeScreenshotLabel}
                </div>
                <div className="text-[11px] text-zinc-500">{t.includeScreenshotDesc}</div>
              </div>
              <input
                type="checkbox"
                checked={draft.byok.includeScreenshot}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    byok: { ...prev.byok, includeScreenshot: e.target.checked },
                  }))
                }
                className="h-4 w-4 accent-amber-400"
              />
            </label>

            <div className="flex items-start gap-2 text-[11px] text-zinc-400">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300/80" />
              <span>{t.localKeyPrivacyNote}</span>
            </div>

            {testResult && (
              <div
                className={`flex items-start gap-2 rounded-lg border p-2.5 text-[12px] ${
                  testResult.ok
                    ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100'
                    : 'border-amber-400/40 bg-amber-500/10 text-amber-100'
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}

            <button
              type="button"
              disabled={testing}
              onClick={() => void handleSaveAndTest()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300/45 bg-amber-400/15 py-2 text-[12px] font-semibold text-amber-100 transition hover:bg-amber-400/25 disabled:opacity-50"
            >
              {testing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t.testingConnectionBtn}
                </>
              ) : (
                <>
                  <Cpu className="h-3.5 w-3.5" />
                  {t.testConnectionBtn}
                </>
              )}
            </button>
          </section>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-white/[0.08] bg-[#0b0b0d] px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="sl-btn-carbon rounded-lg px-3.5 py-2 text-[12px]"
        >
          {t.cancel}
        </button>
        <button
          type="button"
          onClick={() => void handleSaveOnly()}
          className="sl-btn-white rounded-lg px-4 py-2 text-[12px]"
        >
          {t.saveBtn}
        </button>
      </div>
    </div>
  );
}

interface EngineOptionProps {
  tone: 'gold' | 'silver' | 'titanium';
  icon: ReactNode;
  selected: boolean;
  title: string;
  badge: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}

function EngineOption({
  tone,
  icon,
  selected,
  title,
  badge,
  description,
  disabled,
  onClick,
}: EngineOptionProps) {
  const palette = {
    gold: {
      base: 'border-amber-400/40 border-l-[3px] border-l-amber-400 bg-gradient-to-br from-amber-400/[0.17] via-yellow-500/[0.06] to-[#131214] hover:border-amber-300/75 hover:from-amber-400/[0.22]',
      active: 'border-amber-300 border-l-[3px] border-l-amber-300 bg-gradient-to-br from-amber-400/[0.26] via-yellow-500/[0.11] to-[#171410] shadow-[0_0_24px_rgba(251,191,36,0.20)]',
      iconWrap: 'border-amber-300/50 bg-gradient-to-br from-amber-300/25 to-amber-500/10 text-amber-200',
      titleColor: 'text-amber-100',
      badge: 'border-amber-300/60 bg-amber-400/20 text-amber-100',
    },
    silver: {
      base: 'border-zinc-300/35 border-l-[3px] border-l-zinc-200 bg-gradient-to-br from-zinc-200/[0.15] via-neutral-300/[0.06] to-[#131316] hover:border-zinc-100/70 hover:from-white/[0.19]',
      active: 'border-zinc-100 border-l-[3px] border-l-white bg-gradient-to-br from-white/[0.22] via-zinc-300/[0.10] to-[#18181c] shadow-[0_0_24px_rgba(255,255,255,0.16)]',
      iconWrap: 'border-zinc-200/45 bg-gradient-to-br from-white/20 to-zinc-400/10 text-white',
      titleColor: 'text-white',
      badge: 'border-zinc-200/55 bg-white/15 text-zinc-100',
    },
    titanium: {
      base: 'border-slate-400/35 border-l-[3px] border-l-slate-400 bg-gradient-to-br from-slate-300/[0.14] via-sky-300/[0.05] to-[#121418] hover:border-slate-300/65 hover:from-slate-300/[0.19]',
      active: 'border-slate-200/85 border-l-[3px] border-l-slate-200 bg-gradient-to-br from-slate-300/[0.22] via-sky-400/[0.09] to-[#161a21] shadow-[0_0_24px_rgba(148,163,184,0.18)]',
      iconWrap: 'border-slate-300/45 bg-gradient-to-br from-slate-300/22 to-slate-500/10 text-slate-200',
      titleColor: 'text-slate-100',
      badge: 'border-slate-300/50 bg-slate-400/20 text-slate-100',
    },
  }[tone];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full rounded-xl border p-3.5 text-left transition ${
        disabled
          ? `${palette.base} cursor-not-allowed opacity-65`
          : selected
            ? palette.active
            : palette.base
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${palette.iconWrap}`}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[13px] font-semibold ${palette.titleColor}`}>{title}</span>
            <span
              className={`sl-mono shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${palette.badge}`}
            >
              {badge}
            </span>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-300/90">{description}</p>
        </div>
      </div>
    </button>
  );
}
