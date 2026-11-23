import {
  AlertTriangle,
  Check,
  Copy,
  Crosshair,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { generateCaptureReport, generateCompleteAgentPrompt } from '../../core/specGenerator';
import type { UiLanguage } from '../../storage/aiSettingsStore';
import type { CaptureRecord } from '../../types/capture';
import { getTranslations } from '../i18n/translations';
import { blobToDataUrl, ensurePngBlob } from '../utils/chatSender';
import { downloadBlob } from '../utils/download';
import { AiLauncherBar } from './AiLauncherBar';
import { AutoThreeImageSender } from './AutoThreeImageSender';
import { CopyButton } from './CopyButton';
import { Disclosure } from './Disclosure';

interface CaptureTabProps {
  record: CaptureRecord;
  previewUrl: string | null;
  language?: UiLanguage;
  customWord: string;
  onCustomWordChange: (word: string) => void;
  onRecapture: () => void;
  onDelete: () => void;
  onOpenAssetKit: () => void;
}

export function CaptureTab({
  record,
  previewUrl,
  language = 'en',
  customWord,
  onCustomWordChange,
  onRecapture,
  onDelete,
  onOpenAssetKit,
}: CaptureTabProps) {
  const t = getTranslations(language);
  const [savedPng, setSavedPng] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const wordInputRef = useRef<HTMLInputElement | null>(null);

  const captureReport = useMemo(() => generateCaptureReport(record), [record]);
  const completeAgentPrompt = useMemo(
    () => generateCompleteAgentPrompt(record, customWord, language),
    [record, customWord, language]
  );

  // Pre-warm base64 PNG cache in background for instant 1-click chat send
  useEffect(() => {
    if (record.screenshotBlob.size === 0) return;
    void ensurePngBlob(record.screenshotBlob)
      .then((png) => blobToDataUrl(png))
      .catch(() => {});
  }, [record]);

  const handleDownloadPng = async () => {
    const filename = `stylelens-${record.page.hostname}-${record.rect.width}x${record.rect.height}.png`;
    const ok = await downloadBlob(record.screenshotBlob, filename);
    if (ok) {
      setSavedPng(true);
      setTimeout(() => setSavedPng(false), 1800);
    }
  };

  const handleCopyImage = async () => {
    try {
      const pngBlob = await ensurePngBlob(record.screenshotBlob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      setCopiedImage(true);
      setTimeout(() => setCopiedImage(false), 1800);
    } catch {
      await handleDownloadPng();
    }
  };

  return (
    <div className="space-y-4 p-4">
      {/* Clean Screenshot Preview + Instant Copy Image & Save PNG */}
      <div className="sl-card overflow-hidden rounded-xl">
        <div className="sl-checkerboard flex max-h-56 min-h-36 items-center justify-center p-4">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={`Captured region from ${record.page.hostname}`}
              className="max-h-48 max-w-full rounded border border-white/10 object-contain shadow-2xl"
            />
          ) : (
            <span className="text-[12px] text-zinc-500">{t.previewUnavailable}</span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1.5 border-t border-white/[0.07] p-2.5">
          <button
            type="button"
            onClick={() => void handleCopyImage()}
            className="sl-btn-carbon flex items-center justify-center gap-1 rounded-lg py-2 text-[11.5px] transition"
            title={t.imageBtn}
          >
            {copiedImage ? (
              <>
                <Check className="h-3.5 w-3.5 text-white" />
                <span>{t.copied}</span>
              </>
            ) : (
              <>
                <ImageIcon className="h-3.5 w-3.5 text-white" />
                <span>{t.imageBtn}</span>
              </>
            )}
          </button>

          <CopyButton
            text={completeAgentPrompt}
            label={t.promptBtn}
            copiedLabel={t.copied}
            className="w-full py-2 text-[11.5px]"
            title={t.promptBtn}
          />

          <button
            type="button"
            onClick={() => void handleDownloadPng()}
            className="sl-btn-carbon flex items-center justify-center gap-1 rounded-lg py-2 text-[11.5px] transition"
            title={t.savePngBtn}
          >
            {savedPng ? (
              <>
                <Check className="h-3.5 w-3.5 text-white" />
                <span>{t.saved}</span>
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5 text-white" />
                <span>{t.savePngBtn}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Quick 1-Word Target Input (binds directly into the 3-Image AI Runner!) */}
      <div className="sl-card rounded-xl p-3 space-y-1.5">
        <label htmlFor="sl-capture-word" className="block text-[11.5px] font-medium text-zinc-300">
          {t.targetWordLabel}
        </label>
        <input
          ref={wordInputRef}
          id="sl-capture-word"
          type="text"
          value={customWord}
          onChange={(e) => onCustomWordChange(e.target.value)}
          placeholder={t.targetWordPlaceholder}
          className="w-full rounded-lg border border-white/15 bg-[#09090c] px-3 py-2 text-[13px] text-white placeholder:text-zinc-500 focus:border-white/50 focus:outline-none"
        />
      </div>

      {/* 1-Click AI Launcher + 3-Image Sequential Auto-Sender */}
      <div className="space-y-2.5">
        <div className="sl-card rounded-xl p-3">
          <AiLauncherBar language={language} />
        </div>

        {customWord.trim().length === 0 && (
          <p className="text-[12px] font-medium text-amber-200/90">{t.studioLockedNotice}</p>
        )}

        <AutoThreeImageSender
          record={record}
          customWord={customWord}
          language={language}
          enabled={customWord.trim().length > 0}
          onLocked={() => {
            wordInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            wordInputRef.current?.focus();
          }}
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onRecapture}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-white/35 bg-[#1b1b21] py-2.5 text-[13px] font-bold tracking-tight text-white shadow-[0_0_16px_rgba(255,255,255,0.08)] transition hover:border-white/70 hover:bg-[#24242c]"
          >
            <Crosshair className="h-4 w-4 text-white" />
            <span>{t.scanNewPage}</span>
          </button>
          <button
            type="button"
            onClick={onOpenAssetKit}
            className="sl-btn-carbon flex items-center justify-center rounded-lg py-2.5 text-[12.5px] transition"
          >
            {t.threeLayerKitBtn}
          </button>
        </div>

        {/* Surface 120-element truncation above the fold so users know to drag a tighter box */}
        {record.truncated && (
          <div className="sl-card flex items-start gap-2.5 rounded-xl border-amber-300/30 p-3 text-[12px] text-amber-100/90">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <p>{t.truncationWarning}</p>
          </div>
        )}

        {/* Helpful 1-Click Chat Insert / 2-Step Clipboard Tip (or Graphic Artwork Alert) */}
        {record.containsGraphicArtwork && record.graphicArtworkNote ? (
          <div className="sl-card flex items-start gap-2.5 rounded-xl border-white/20 p-3 text-[12px] text-zinc-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-white" />
            <p>{record.graphicArtworkNote}</p>
          </div>
        ) : record.captureMode === 'visual-only' && record.visualFallbackReason ? (
          <div className="sl-card flex items-start gap-2.5 rounded-xl border-white/20 p-3 text-[12px] text-zinc-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-white" />
            <p>{record.visualFallbackReason}</p>
          </div>
        ) : (
          <p className="flex items-start gap-1.5 px-1 text-[11.5px] leading-snug text-zinc-400">
            <Copy className="mt-0.5 h-3 w-3 shrink-0 text-zinc-300" />
            <span>{t.captureInsertHint}</span>
          </p>
        )}
      </div>

      {/* Progressive Disclosure: All Technical Details & Delete */}
      <Disclosure
        title={t.moreDetails}
        subtitle={`${record.page.hostname} · ${record.rect.width}×${record.rect.height}px`}
      >
        <div className="space-y-3.5">
          <p className="text-[12.5px] leading-relaxed text-zinc-300">{record.dna.summaryText}</p>

          <div className="divide-y divide-white/[0.06] text-[12px]">
            <div className="flex items-center justify-between py-2">
              <span className="text-zinc-500">{t.websiteLabel}</span>
              <a
                href={record.page.url}
                target="_blank"
                rel="noreferrer"
                className="flex max-w-[190px] items-center gap-1 truncate text-zinc-200 hover:text-white"
              >
                <span className="truncate">{record.page.hostname}</span>
                <ExternalLink className="h-3 w-3 shrink-0 text-zinc-500" />
              </a>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-zinc-500">{t.captureModeLabel}</span>
              <span className="text-zinc-200">
                {record.containsGraphicArtwork
                  ? t.modeArtworkPalette
                  : record.captureMode === 'dom-and-visual'
                    ? t.modeCodeImage
                    : t.modeImageOnly}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-zinc-500">{t.resolutionLabel}</span>
              <span className="sl-mono text-zinc-200">
                {record.screenshotWidth}×{record.screenshotHeight}px (
                {record.viewport.devicePixelRatio.toFixed(1)}x)
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-zinc-500">{t.elementsScannedLabel}</span>
              <span className="sl-mono text-zinc-200">
                {record.totalNodesScanned}
                {record.truncated ? t.cappedSuffix : ''}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <CopyButton
              text={captureReport}
              label={t.copyCaptureReport}
              copiedLabel={t.copied}
              className="flex-1 py-2"
            />
            <button
              type="button"
              onClick={onDelete}
              className="sl-btn-carbon flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:text-white"
              title="Delete capture"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}
