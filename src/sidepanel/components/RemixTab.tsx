import {
  AlertCircle,
  Download,
  Loader2,
  Settings,
  Square,
  Wand2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { chromeBuiltInProvider } from '../../ai/chromeBuiltInProvider';
import { deterministicProvider, resolveBrandPalette } from '../../ai/deterministicProvider';
import { OpenAICompatibleProvider } from '../../ai/openaiCompatibleProvider';
import { buildPreviewFontAssets } from '../../ai/responseParser';
import type { RemixOutput } from '../../ai/types';
import type { RemixTargetStack } from '../../core/specGenerator';
import {
  ensureApiOriginPermission,
  getPresetById,
  type AiSettings,
  type UiLanguage,
} from '../../storage/aiSettingsStore';
import { getCaptureById } from '../../storage/captureStore';
import type { CaptureRecord, CaptureSummaryItem } from '../../types/capture';
import { getTranslations } from '../i18n/translations';
import { downloadText } from '../utils/download';
import { CopyButton } from './CopyButton';
import { Disclosure } from './Disclosure';
import { LivePreviewFrame } from './LivePreviewFrame';

interface RemixTabProps {
  record: CaptureRecord;
  history: CaptureSummaryItem[];
  aiSettings: AiSettings;
  language?: UiLanguage;
  onOpenSettings: () => void;
}

type MainView = 'preview' | 'code';
type ExportTab = 'prompt' | 'css' | 'tailwind' | 'json';

export function RemixTab({
  record,
  history,
  aiSettings,
  language = 'en',
  onOpenSettings,
}: RemixTabProps) {
  const t = getTranslations(language);
  const enDefaultPrompt = getTranslations('en').remixDefaultPrompt;
  const zhDefaultPrompt = getTranslations('zh-CN').remixDefaultPrompt;
  const [userPrompt, setUserPrompt] = useState(t.remixDefaultPrompt);
  const [targetStack, setTargetStack] = useState<RemixTargetStack>('react-tailwind');
  const [blendCaptureId, setBlendCaptureId] = useState<string>('');
  const [secondaryRecord, setSecondaryRecord] = useState<CaptureRecord | null>(null);

  // Sync default prompt cleanly when switching language (only if untouched!)
  useEffect(() => {
    setUserPrompt((prev) =>
      prev === enDefaultPrompt || prev === zhDefaultPrompt ? t.remixDefaultPrompt : prev
    );
  }, [language, enDefaultPrompt, zhDefaultPrompt, t.remixDefaultPrompt]);

  const [mainView, setMainView] = useState<MainView>('preview');
  const [exportTab, setExportTab] = useState<ExportTab>('prompt');
  const [output, setOutput] = useState<RemixOutput | null>(null);

  const [generating, setGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [genError, setGenError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const otherCaptures = history.filter((item) => item.id !== record.id);

  useEffect(() => {
    setBlendCaptureId('');
    setSecondaryRecord(null);
  }, [record.id]);

  useEffect(() => {
    if (!blendCaptureId || blendCaptureId === record.id) {
      setSecondaryRecord(null);
      return;
    }
    let alive = true;
    void getCaptureById(blendCaptureId).then((rec) => {
      if (alive) setSecondaryRecord(rec);
    });
    return () => {
      alive = false;
    };
  }, [blendCaptureId, record.id]);

  useEffect(() => {
    // Avoid racing with stale secondaryRecord during capture transitions
    const effectiveSecondary =
      blendCaptureId && secondaryRecord?.id === blendCaptureId ? secondaryRecord : null;
    let alive = true;
    setGenError(null);
    void deterministicProvider
      .synthesizeRemix({
        record,
        secondaryRecord: effectiveSecondary,
        userPrompt,
        targetStack,
      })
      .then((res) => {
        if (alive) setOutput(res);
      });
    return () => {
      alive = false;
    };
  }, [record, blendCaptureId, secondaryRecord, targetStack]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const byokProvider = new OpenAICompatibleProvider(aiSettings.byok);
  const byokReady = byokProvider.isConfigured();
  const presetLabel = getPresetById(aiSettings.byok.presetId).label;

  const generateButtonLabel = (() => {
    if (aiSettings.activeProvider === 'openai-compatible') {
      return byokReady ? t.generateWith(presetLabel) : t.connectAiKeyBtn;
    }
    if (aiSettings.activeProvider === 'chrome-builtin') {
      return t.generateWith('Chrome AI');
    }
    return t.updatePreview;
  })();

  const handleGenerate = async () => {
    setGenError(null);

    if (aiSettings.activeProvider === 'openai-compatible' && !byokReady) {
      onOpenSettings();
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setGenerating(true);
    setStatusMessage(t.remixPreparing);

    try {
      let result: RemixOutput;

      if (aiSettings.activeProvider === 'openai-compatible') {
        const perm = await ensureApiOriginPermission(aiSettings.byok.baseUrl);
        if (!perm.granted && perm.originPattern) {
          throw new Error(
            `Permission for ${perm.originPattern} is required so StyleLens can call your AI provider directly.`
          );
        }

        result = await byokProvider.synthesizeRemix({
          record,
          secondaryRecord,
          userPrompt,
          targetStack,
          signal: controller.signal,
          onStatus: setStatusMessage,
        });
      } else if (aiSettings.activeProvider === 'chrome-builtin') {
        result = await chromeBuiltInProvider.synthesizeRemix({
          record,
          secondaryRecord,
          userPrompt,
          targetStack,
          signal: controller.signal,
          onStatus: setStatusMessage,
        });
      } else {
        result = await deterministicProvider.synthesizeRemix({
          record,
          secondaryRecord,
          userPrompt,
          targetStack,
        });
      }

      setOutput(result);
      setMainView(result.previewHtml ? 'preview' : 'code');
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
      setStatusMessage('');
      abortRef.current = null;
    }
  };

  const handleCancelGeneration = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setGenerating(false);
    setStatusMessage('');
  };

  const primaryCodeText = output?.generatedCode ?? output?.promptPackage ?? '';

  const exportText = (() => {
    if (!output) return '';
    if (exportTab === 'prompt') return output.promptPackage;
    if (exportTab === 'css') return output.cssTokens;
    if (exportTab === 'tailwind') return output.tailwindTheme;
    return output.designSpecJson;
  })();

  const handleDownloadCode = async () => {
    if (!primaryCodeText) return;
    const ext =
      targetStack === 'react-tailwind'
        ? 'tsx'
        : targetStack === 'vue-tailwind'
          ? 'vue'
          : 'html';
    await downloadText(primaryCodeText, `stylelens-remix-${record.page.hostname}.${ext}`, 'text/plain');
  };

  // Single source of truth for preview polarity & memoized font assets (prevents iframe reload on every keystroke!)
  const activeSecondary =
    blendCaptureId && secondaryRecord?.id === blendCaptureId ? secondaryRecord : null;
  const effectivePreviewPolarity = useMemo(
    () => resolveBrandPalette(record, activeSecondary).polarityLabel,
    [record, activeSecondary]
  );
  const previewFontAssets = useMemo(() => buildPreviewFontAssets(record), [record]);

  return (
    <div className="space-y-4 p-4">
      {/* Clean Header + Copy Report */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight text-white">{t.remixTitle}</h1>
          <p className="text-[12px] text-zinc-500">{t.remixSubtitle}</p>
        </div>
        <CopyButton
          text={output?.promptPackage ?? ''}
          label={t.copyReport}
          copiedLabel={t.copied}
          title={t.copyReport}
        />
      </div>

      {/* Simple Prompt Input + Generate Button */}
      <section className="sl-card space-y-3 rounded-xl p-4">
        <label htmlFor="sl-remix-prompt" className="block text-[12.5px] font-medium text-zinc-200">
          {t.remixPromptLabel}
        </label>
        <textarea
          id="sl-remix-prompt"
          rows={3}
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          placeholder={t.remixPromptPlaceholder}
          className="w-full resize-none rounded-lg border border-white/[0.1] bg-[#0b0b0d] p-3 text-[13px] leading-relaxed text-white placeholder:text-zinc-600 focus:border-white/35 focus:outline-none"
        />

        <div className="flex items-center gap-2">
          {generating ? (
            <button
              type="button"
              onClick={handleCancelGeneration}
              className="sl-btn-carbon flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-[12.5px] text-white"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="truncate">{statusMessage || t.remixGenerating}</span>
              <Square className="ml-1 h-2.5 w-2.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleGenerate()}
              className="sl-btn-white flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-[13px] transition"
            >
              <Wand2 className="h-4 w-4" />
              {generateButtonLabel}
            </button>
          )}

          <button
            type="button"
            onClick={onOpenSettings}
            className="sl-btn-carbon flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-lg"
            title="AI Engine Settings (DeepSeek, Qwen, Gemini, OpenAI, Ollama)"
          >
            <Settings className="h-4 w-4 text-zinc-300" />
          </button>
        </div>
      </section>

      {genError && (
        <div className="sl-card flex items-start gap-2 rounded-xl border-white/25 p-3 text-[12px] text-zinc-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-white" />
          <span>{genError}</span>
        </div>
      )}

      {/* Clean Preview / Code Output */}
      {output && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#111114] p-0.5 text-[12px]">
              <button
                type="button"
                onClick={() => setMainView('preview')}
                className={`rounded-md px-3 py-1 font-medium transition ${
                  mainView === 'preview' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {t.previewTab}
              </button>
              <button
                type="button"
                onClick={() => setMainView('code')}
                className={`rounded-md px-3 py-1 font-medium transition ${
                  mainView === 'code' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {t.codeTab}
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <CopyButton
                text={primaryCodeText}
                label={t.copyCode}
                copiedLabel={t.copied}
                className="py-1.5"
              />
              <button
                type="button"
                onClick={() => void handleDownloadCode()}
                className="sl-btn-carbon flex h-[30px] w-[30px] items-center justify-center rounded-lg"
                title="Save code file"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {mainView === 'preview' ? (
            output.previewHtml ? (
              <LivePreviewFrame
                previewHtml={output.previewHtml}
                cssTokens={output.cssTokens}
                polarity={effectivePreviewPolarity}
                modelLabel={output.modelLabel}
                usedVision={output.usedVision}
                fontAssets={previewFontAssets}
                fidelityReport={output.fidelityReport}
              />
            ) : (
              <div className="sl-card rounded-xl p-4 text-[12.5px] text-zinc-400">
                {t.remixSwitchToCode}
              </div>
            )
          ) : (
            <pre className="sl-mono sl-card max-h-72 overflow-auto rounded-xl p-4 text-[11.5px] leading-relaxed text-zinc-300 whitespace-pre-wrap">
              {primaryCodeText}
            </pre>
          )}
        </section>
      )}

      {/* Progressive Disclosure 1: Framework, Ideas & Style Blend */}
      <Disclosure title={t.moreOptionsTitle} subtitle={t.moreOptionsSub}>
        <div className="space-y-3.5 text-[12px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-400">{t.outputFormatLabel}</span>
            <select
              value={targetStack}
              onChange={(e) => setTargetStack(e.target.value as RemixTargetStack)}
              className="rounded-lg border border-white/[0.12] bg-[#0b0b0d] px-2.5 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-white/35"
            >
              <option value="react-tailwind">React + Tailwind</option>
              <option value="html-css">HTML + CSS</option>
              <option value="vue-tailwind">Vue + Tailwind</option>
            </select>
          </div>

          {otherCaptures.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-400">{t.blendWithLabel}</span>
              <select
                value={blendCaptureId}
                onChange={(e) => setBlendCaptureId(e.target.value)}
                className="max-w-[180px] truncate rounded-lg border border-white/[0.12] bg-[#0b0b0d] px-2.5 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-white/35"
              >
                <option value="">{t.noneLabel}</option>
                {otherCaptures.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.hostname} ({item.width}×{item.height})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5 pt-1">
            <div className="text-zinc-500">{t.quickIdeasLabel}</div>
            <div className="flex flex-col gap-1.5">
              {t.remixQuickPrompts.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setUserPrompt(preset);
                    if (aiSettings.activeProvider === 'deterministic') {
                      void deterministicProvider
                        .synthesizeRemix({
                          record,
                          secondaryRecord,
                          userPrompt: preset,
                          targetStack,
                        })
                        .then((res) => setOutput(res));
                    }
                  }}
                  className="rounded-lg border border-white/[0.08] bg-[#0b0b0d] px-3 py-2 text-left text-[12px] text-zinc-300 transition hover:border-white/25 hover:text-white"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Disclosure>

      {/* Progressive Disclosure 2: Fidelity Critic Breakdown & Raw Exports */}
      {output && (
        <Disclosure
          title={t.fidelityCriticTitle}
          subtitle={
            output.fidelityReport
              ? output.fidelityReport.verdict
              : 'CSS variables, Tailwind v4, JSON spec'
          }
        >
          <div className="space-y-3.5">
            {output.fidelityReport && (
              <div className="space-y-2 rounded-lg border border-white/[0.08] bg-[#0b0b0d] p-3 text-[11.5px]">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">{t.fidelityAuditHeading}</span>
                  <span
                    className={`sl-mono font-semibold ${
                      output.fidelityReport.passedThreshold ? 'text-emerald-300' : 'text-amber-300'
                    }`}
                  >
                    {output.fidelityReport.totalScore}% / 100%
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[11px] text-zinc-400">
                  <div>
                    {t.fidelityFontsLive}{' '}
                    <span className="sl-mono text-zinc-200">
                      {output.fidelityReport.breakdown.typography.score}/
                      {output.fidelityReport.breakdown.typography.max}
                    </span>
                  </div>
                  <div>
                    {t.fidelityPolarityAccents}{' '}
                    <span className="sl-mono text-zinc-200">
                      {output.fidelityReport.breakdown.colors.score}/
                      {output.fidelityReport.breakdown.colors.max}
                    </span>
                  </div>
                  <div>
                    {t.fidelityContrastLayout}{' '}
                    <span className="sl-mono text-zinc-200">
                      {output.fidelityReport.breakdown.layout.score}/
                      {output.fidelityReport.breakdown.layout.max}
                    </span>
                  </div>
                  <div>
                    {t.fidelitySurfaces}{' '}
                    <span className="sl-mono text-zinc-200">
                      {output.fidelityReport.breakdown.surfaces.score}/
                      {output.fidelityReport.breakdown.surfaces.max}
                    </span>
                  </div>
                  <div className="col-span-2">
                    {t.fidelityStructureSafety}{' '}
                    <span className="sl-mono text-zinc-200">
                      {output.fidelityReport.breakdown.structure.score}/
                      {output.fidelityReport.breakdown.structure.max}
                    </span>
                  </div>
                </div>
                {output.fidelityReport.issues.length > 0 && (
                  <ul className="space-y-0.5 border-t border-white/[0.06] pt-2 text-[11px] text-amber-200/85">
                    {output.fidelityReport.issues.slice(0, 4).map((iss, idx) => (
                      <li key={idx}>• {iss}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {output.influencedBy.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11.5px] text-zinc-500">{t.designInfluencesHeading}</div>
                {output.influencedBy.map((item, idx) => (
                  <div key={idx} className="text-[12px] leading-snug">
                    <span className="sl-mono font-medium text-white">{item.token}</span>
                    <span className="text-zinc-400"> — {item.usage}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2 border-t border-white/[0.07] pt-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      ['prompt', t.exportAiPromptTab],
                      ['css', 'CSS'],
                      ['tailwind', 'Tailwind'],
                      ['json', 'JSON'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setExportTab(id)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                        exportTab === id
                          ? 'bg-white text-black'
                          : 'border border-white/[0.08] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <CopyButton
                  text={exportText}
                  label={t.copyBtn}
                  copiedLabel={t.copied}
                  className="py-1 text-[11px]"
                />
              </div>

              <pre className="sl-mono max-h-56 overflow-auto rounded-lg border border-white/[0.07] bg-[#0b0b0d] p-3 text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap">
                {exportText}
              </pre>
            </div>
          </div>
        </Disclosure>
      )}
    </div>
  );
}
