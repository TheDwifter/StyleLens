import {
  Check,
  Image as ImageIcon,
  Loader2,
  Lock,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildPreviewFontAssets, buildPreviewSrcDoc } from '../../ai/responseParser';
import { buildLocalAssetKit } from '../../core/assetKitExporter';
import {
  canRenderLiveFontPreview,
  isArtworkOrPhotoLikeCapture,
  shouldSuppressHostFallbackFont,
} from '../../core/captureClassification';
import { guessPictureText, matchOriginalCase } from '../../core/chatImagePrompts';
import { generateCssTokens } from '../../core/specGenerator';
import type { UiLanguage } from '../../storage/aiSettingsStore';
import type { CaptureRecord } from '../../types/capture';
import type { CapturePhase } from '../hooks/useCaptureController';
import { getTranslations } from '../i18n/translations';
import { blobToDataUrl, ensurePngBlob } from '../utils/chatSender';
import { AiLauncherBar } from './AiLauncherBar';
import { AutoThreeImageSender } from './AutoThreeImageSender';
import { OrbIcon } from './OrbIcon';

interface SimpleModeViewProps {
  record: CaptureRecord | null;
  previewUrl: string | null;
  phase: CapturePhase;
  language: UiLanguage;
  customWord: string;
  onCustomWordChange: (word: string) => void;
  onStartCapture: () => void;
  onPickNew: () => void;
  onCancelCapture: () => void;
  onSwitchToStudio: () => void;
}

const GLITCH_CHARS = '01X/#@%&*<>[]_~+=';

function scrambleGlitchText(text: string, progress: number): string {
  return text
    .split('')
    .map((ch, idx) => {
      if (ch === ' ') return ' ';
      if (progress > 0.78 && idx % 2 === 0) return ch;
      const code = (idx * 17 + Math.floor(progress * 53)) % GLITCH_CHARS.length;
      return GLITCH_CHARS[code] ?? ch;
    })
    .join('');
}

export function SimpleModeView({
  record,
  previewUrl,
  phase,
  language,
  customWord,
  onCustomWordChange,
  onStartCapture,
  onPickNew,
  onCancelCapture,
  onSwitchToStudio,
}: SimpleModeViewProps) {
  const t = getTranslations(language);
  const [glitchStep, setGlitchStep] = useState<number | null>(null);
  const glitchTimerRef = useRef<number | null>(null);
  const wordInputRef = useRef<HTMLInputElement | null>(null);
  // Once all 3 layers are ready, the next thing to press is "Pick New Picture": cue it.
  const [allLayersReady, setAllLayersReady] = useState(false);
  // What the captured picture says. Pictures carry no text the extension can read, so the AI is
  // told the word explicitly (it can then copy shared letters like the "a" in "crave").
  const [originalText, setOriginalText] = useState('');
  const [matchCase, setMatchCase] = useState(true);
  useEffect(() => {
    setOriginalText(record ? guessPictureText(record) : '');
  }, [record?.id]);
  // One brief shutter flash over the viewfinder when "Pick New Picture" is pressed
  const [flashing, setFlashing] = useState(false);

  const handlePickNewWithGlitch = () => {
    if (glitchTimerRef.current !== null) {
      window.clearInterval(glitchTimerRef.current);
    }
    let tick = 0;
    const totalTicks = 7;
    setFlashing(true);
    window.setTimeout(() => setFlashing(false), 260);
    setGlitchStep(0);
    glitchTimerRef.current = window.setInterval(() => {
      tick += 1;
      if (tick >= totalTicks) {
        if (glitchTimerRef.current !== null) {
          window.clearInterval(glitchTimerRef.current);
          glitchTimerRef.current = null;
        }
        setGlitchStep(null);
        onPickNew();
      } else {
        setGlitchStep(tick / totalTicks);
      }
    }, 36);
  };

  // Pre-warm base64 PNG cache in background so Step 3 sends with 0ms image encoding latency!
  useEffect(() => {
    if (!record || record.screenshotBlob.size === 0) return;
    void ensurePngBlob(record.screenshotBlob)
      .then((png) => blobToDataUrl(png))
      .catch(() => {});
  }, [record]);

  useEffect(() => {
    return () => {
      if (glitchTimerRef.current !== null) {
        window.clearInterval(glitchTimerRef.current);
      }
    };
  }, []);

  const previewFontAssets = useMemo(
    () => (record ? buildPreviewFontAssets(record) : undefined),
    [record]
  );

  const cssTokens = useMemo(
    () => (record ? generateCssTokens(record, !shouldSuppressHostFallbackFont(record)) : ''),
    [record]
  );

  const assetKit = useMemo(
    () => (record ? buildLocalAssetKit(record, customWord) : null),
    [record, customWord]
  );

  // Compact X-Ray DNA swatch & geometry proof for Step 1 card (excludes un-sampled search-host chrome colors)
  const xrayDnaSummary = useMemo(() => {
    if (!record) return null;
    const isArtwork = isArtworkOrPhotoLikeCapture(record);
    const suppressHost = shouldSuppressHostFallbackFont(record);
    const sampled = [...record.dna.palette]
      .filter((c) => c.provenance === 'sampled-pixels')
      .sort((a, b) => (b.visualSharePercent ?? 0) - (a.visualSharePercent ?? 0));
    const pool =
      isArtwork || suppressHost
        ? sampled.length > 0
          ? sampled
          : suppressHost
            ? []
            : record.dna.palette
        : record.dna.palette;
    const seen = new Set<string>();
    const hexes: string[] = [];
    for (const tok of pool) {
      const upper = tok.hex.toUpperCase();
      if (seen.has(upper)) continue;
      seen.add(upper);
      hexes.push(upper);
      if (hexes.length >= 4) break;
    }
    return {
      hexes,
      dims: `${Math.max(1, Math.round(record.rect.width))}×${Math.max(1, Math.round(record.rect.height))}px`,
      isVisual: isArtwork || suppressHost,
      isDark: record.dna.polarity === 'dark',
    };
  }, [record]);

  // An HTML/CSS preview is only honest when the capture is live DOM text with a real captured
  // font. For a raster logo/photo there is no webfont, so the preview would show the word in a
  // generic system font and look "wrong"; Step 2 shows the picture as the locked style instead.
  const showLiveFontPreview = useMemo(
    () => (record ? canRenderLiveFontPreview(record) : false),
    [record]
  );

  const liveWordSrcDoc = useMemo(() => {
    if (!record || !assetKit || !showLiveFontPreview) return '';
    return buildPreviewSrcDoc(
      assetKit.liveCompositeHtml,
      cssTokens,
      assetKit.profile.cardIsDark ? 'dark' : 'light',
      previewFontAssets,
      460
    );
  }, [record, assetKit, cssTokens, previewFontAssets, showLiveFontPreview]);

  const hasTypedWord = customWord.trim().length > 0;
  const step3Unlocked = hasTypedWord;
  const activeStep: 1 | 2 | 3 = !record ? 1 : step3Unlocked ? 3 : 2;

  return (
    <div className="space-y-2 p-3">
      {/* Formal Sequential 1 → 2 → 3 Step Rail */}
      <ol
        className="sl-card grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1 rounded-xl p-1"
        aria-label="Steps"
      >
        {[
          { num: 1 as const, label: t.step1Short },
          { num: 2 as const, label: t.step2Short },
          { num: 3 as const, label: t.step3Short },
        ].flatMap((step, idx) => {
          const isCurrent = activeStep === step.num;
          const isDone = activeStep > step.num;
          const pill = (
            <li
              key={step.num}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-semibold transition ${
                isCurrent
                  ? 'bg-white text-black shadow-[0_0_16px_rgba(255,255,255,0.28)]'
                  : isDone
                    ? 'bg-white/[0.1] text-white'
                    : 'text-zinc-500'
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                  isCurrent
                    ? 'bg-black text-white'
                    : isDone
                      ? 'bg-emerald-400/25 text-emerald-200'
                      : 'border border-zinc-700 text-zinc-500'
                }`}
              >
                {isDone ? <Check className="h-2.5 w-2.5" /> : step.num}
              </span>
              <span>{step.label}</span>
            </li>
          );
          if (idx < 2) {
            return [
              pill,
              <li
                key={`arr-${step.num}`}
                aria-hidden="true"
                className="list-none text-[11px] font-bold text-zinc-600"
              >
                →
              </li>,
            ];
          }
          return [pill];
        })}
      </ol>

      {/* No Capture Yet: Calm, Unmistakable Step 1 Onboarding */}
      {!record ? (
        <div className="sl-card space-y-5 rounded-xl border-white/35 p-5 shadow-[0_0_24px_rgba(255,255,255,0.06)]">
          <div className="space-y-2.5">
            <div className="sl-white-ring h-10 w-10 rounded-full" />
            <h1 className="text-[20px] font-semibold leading-snug tracking-tight text-white">
              {t.onboardingTitle}
            </h1>
            <p className="text-[14px] leading-relaxed text-zinc-300">
              {t.onboardingDescBefore}
              <strong className="font-semibold text-white">{t.onboardingDescBold}</strong>
              {t.onboardingDescAfter}
            </p>
          </div>

          {phase === 'selecting' ? (
            <div className="space-y-2.5">
              <div className="rounded-xl border border-white/35 bg-white/[0.08] p-3.5 text-center text-[13.5px] font-medium text-white">
                {t.nowDragBox}
              </div>
              <button
                type="button"
                onClick={onCancelCapture}
                className="sl-btn-carbon flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[13.5px] transition"
              >
                <X className="h-4 w-4" />
                {t.cancel}
              </button>
            </div>
          ) : phase === 'processing' ? (
            <button
              type="button"
              disabled
              className="sl-btn-carbon flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[14px] text-zinc-300"
            >
              <Loader2 className="h-4 w-4 animate-spin text-white" />
              {t.readingStyleFonts}
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartCapture}
              className="sl-btn-white sl-cue flex w-full items-center justify-center gap-2.5 rounded-xl px-4 py-3.5 text-[14.5px] transition"
            >
              <OrbIcon size={16} onLight />
              {t.pickAnythingBtn}
            </button>
          )}

          <p className="text-center text-[12px] text-zinc-400">{t.worksOfflineNote}</p>
        </div>
      ) : (
        <>
          {/* STEP 1 (Completed): a camera-viewfinder card. The picture you captured sits in the
              frame and the shutter-style button under it is the way back to capture a new one. */}
          <section className="sl-card space-y-2 rounded-xl p-2.5">
            <div className="sl-viewfinder sl-checkerboard relative flex h-[88px] items-center justify-center overflow-hidden rounded-lg border border-white/10">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={`Picked from ${record.page.hostname}`}
                  className="max-h-full max-w-full object-contain p-2.5"
                />
              ) : (
                <ImageIcon className="h-4 w-4 text-zinc-500" />
              )}
              <span className="sl-vf-corner sl-vf-tl" aria-hidden="true" />
              <span className="sl-vf-corner sl-vf-tr" aria-hidden="true" />
              <span className="sl-vf-corner sl-vf-bl" aria-hidden="true" />
              <span className="sl-vf-corner sl-vf-br" aria-hidden="true" />
              <span className="sl-vf-label left-2.5 top-1.5">{t.viewfinderCaptured}</span>
              <span className="sl-vf-label bottom-1.5 left-2.5 max-w-[55%] truncate normal-case tracking-normal">
                {glitchStep !== null
                  ? scrambleGlitchText(record.page.hostname, glitchStep)
                  : record.page.hostname}
              </span>
              {xrayDnaSummary && (
                <span className="sl-vf-label bottom-1.5 right-2.5 normal-case tracking-normal">
                  {xrayDnaSummary.hexes.slice(0, 3).map((hex) => (
                    <span
                      key={hex}
                      title={hex}
                      style={{ backgroundColor: hex }}
                      className="h-1.5 w-1.5 shrink-0 rounded-full border border-white/40"
                    />
                  ))}
                  <span>{xrayDnaSummary.dims}</span>
                </span>
              )}
              {flashing && <span className="sl-vf-flash" aria-hidden="true" />}
            </div>

            {phase === 'selecting' ? (
              <button
                type="button"
                onClick={onCancelCapture}
                className="sl-btn-carbon flex min-h-[44px] w-full items-center justify-center rounded-lg text-[13.5px] text-white"
              >
                {t.cancel}
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePickNewWithGlitch}
                className={`sl-sheen ${allLayersReady ? 'sl-cue ' : ''}flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-white/80 bg-white text-[14px] font-bold text-black shadow-[0_0_12px_rgba(255,255,255,0.2)] transition hover:bg-zinc-200 active:scale-[0.99] ${
                  glitchStep !== null ? 'sl-mono tracking-wider' : ''
                }`}
              >
                <OrbIcon size={15} onLight />
                <span>
                  {glitchStep !== null
                    ? scrambleGlitchText(t.pickNewBtn, glitchStep)
                    : t.pickNewBtn}
                </span>
              </button>
            )}
          </section>
          {/* STEP 2: Minimalist Word Input + Compact Live Style Strip */}
          <section
            className={`sl-card space-y-2 rounded-xl p-3 transition-all ${
              activeStep === 2
                ? 'border-white/75 shadow-[0_0_20px_rgba(255,255,255,0.12)] ring-1 ring-white/30'
                : 'border-white/[0.1]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="sl-simple-word-input"
                className="text-[13px] font-semibold text-white"
              >
                {t.step2Title}
              </label>
              {activeStep === 2 ? (
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-black">
                  {t.step2StartHere}
                </span>
              ) : (
                <span className="rounded-full border border-emerald-400/35 bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                  {t.step2DoneBadge}
                </span>
              )}
            </div>

            <div className="space-y-1">
              <input
                ref={wordInputRef}
                id="sl-simple-word-input"
                type="text"
                value={customWord}
                onChange={(e) => onCustomWordChange(e.target.value)}
                placeholder={t.step2Placeholder}
                className={`w-full rounded-lg border bg-[#07070a] px-3 py-2 text-[14px] font-medium text-white placeholder:text-zinc-500 focus:outline-none ${
                  activeStep === 2
                    ? 'border-white/60 focus:border-white'
                    : 'border-white/15 focus:border-white/60'
                }`}
              />
              {!showLiveFontPreview && (
                <label className="flex items-center gap-2 pt-0.5 text-[11px] text-zinc-400">
                  <span className="shrink-0">{t.step2OriginalLabel}</span>
                  <input
                    type="text"
                    value={originalText}
                    onChange={(e) => setOriginalText(e.target.value.slice(0, 40))}
                    placeholder={t.step2OriginalPlaceholder}
                    className="min-w-0 flex-1 rounded-md border border-white/12 bg-[#07070a] px-2 py-1 text-[12px] text-white placeholder:text-zinc-600 focus:border-white/50 focus:outline-none"
                  />
                </label>
              )}
              {!showLiveFontPreview && matchOriginalCase(originalText, customWord.trim()) && (
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
                  <input
                    type="checkbox"
                    checked={matchCase}
                    onChange={(e) => setMatchCase(e.target.checked)}
                    className="h-3 w-3 accent-white"
                  />
                  <span className="truncate">
                    {t.matchCaseLabel(matchOriginalCase(originalText, customWord.trim()) ?? '')}
                  </span>
                </label>
              )}
              {!hasTypedWord && (
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                  <span className="text-[11px] text-zinc-400">{t.step2TryPrefix}</span>
                  {t.step2Examples.map((word) => (
                    <button
                      key={word}
                      type="button"
                      onClick={() => onCustomWordChange(word)}
                      className="rounded-full border border-white/20 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white transition hover:border-white/60 hover:bg-white/[0.14]"
                    >
                      {word}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Compact Live Word Preview Strip: ONLY for live DOM text with a real captured font */}
            {assetKit && showLiveFontPreview && (
              <div className="overflow-hidden rounded-lg border border-white/12 bg-[#08080a]">
                <iframe
                  title="Live preview of your word in this website's style"
                  sandbox=""
                  srcDoc={liveWordSrcDoc}
                  className="h-[72px] w-full bg-transparent"
                />
              </div>
            )}

            {/* Logo / photo capture: no fake generic-font preview. Show the picture as the locked style. */}
            {!showLiveFontPreview && (
              <div
                data-testid="sl-style-locked-strip"
                className="flex items-center gap-2.5 rounded-lg border border-white/12 bg-[#08080a] px-2.5 py-2"
              >
                <div className="sl-checkerboard flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 p-0.5">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt=""
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5 text-zinc-500" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
                    <Lock className="h-3 w-3 shrink-0" />
                    <span className="truncate">{t.step2StyleLockedTitle}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
                    {t.step2StyleLockedDesc(customWord.trim())}
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* STEP 3: Soft-Gated until Step 2 is Completed + 1-Click AI Launcher + Send Button */}
          <section
            className={`sl-card space-y-2.5 rounded-xl p-3 transition-all ${
              step3Unlocked
                ? 'border-white/75 shadow-[0_0_20px_rgba(255,255,255,0.12)] ring-1 ring-white/25'
                : 'border-white/[0.06] opacity-55'
            }`}
          >
            <div className="space-y-0.5">
              <div className="text-[13px] font-semibold text-white">{t.step3Title}</div>
              {!step3Unlocked ? (
                <p className="text-[11.5px] font-medium text-amber-200/90">
                  {t.step3LockedNotice}
                </p>
              ) : (
                <p className="text-[11.5px] leading-snug text-zinc-400">{t.step3Helper}</p>
              )}
            </div>

            {/* 1-Click AI Launcher (Claude, OpenAI, Gemini, DeepSeek + Expand Arrow for Kimi & more!) */}
            <AiLauncherBar language={language} disabled={!step3Unlocked} />

            {record && (
              <AutoThreeImageSender
                record={record}
                customWord={
                  matchCase && !showLiveFontPreview
                    ? (matchOriginalCase(originalText, customWord.trim()) ?? customWord)
                    : customWord
                }
                originalText={showLiveFontPreview ? undefined : originalText}
                language={language}
                enabled={step3Unlocked}
                onPickNew={handlePickNewWithGlitch}
                onAllLayersReadyChange={setAllLayersReady}
                onLocked={() => {
                  wordInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  wordInputRef.current?.focus();
                }}
              />
            )}
          </section>

          {/* Quiet Link to Pro Studio */}
          <button
            type="button"
            onClick={onSwitchToStudio}
            className="flex w-full items-center justify-center gap-1.5 py-1 text-[12px] text-zinc-400 transition hover:text-white"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{t.openProStudioLink}</span>
          </button>
        </>
      )}
    </div>
  );
}
