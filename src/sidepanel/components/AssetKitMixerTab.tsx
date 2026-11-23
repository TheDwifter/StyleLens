import {
  Check,
  Code2,
  Copy,
  Download,
  FileJson,
  Layers,
  Shuffle,
  Type,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildPreviewFontAssets, buildPreviewSrcDoc } from '../../ai/responseParser';
import {
  buildLocalAssetKit,
  mixCaptureRecords,
  svgStringToPngBlob,
  type CrossSiteMixMode,
} from '../../core/assetKitExporter';
import { shouldSuppressHostFallbackFont } from '../../core/captureClassification';
import { isDarkColor, parseCssColor } from '../../core/color';
import { generateCssTokens } from '../../core/specGenerator';
import type { UiLanguage } from '../../storage/aiSettingsStore';
import { getCaptureById } from '../../storage/captureStore';
import type { CaptureRecord, CaptureSummaryItem } from '../../types/capture';
import { getTranslations } from '../i18n/translations';
import { downloadBlob, downloadText } from '../utils/download';
import { CopyButton } from './CopyButton';
import { Disclosure } from './Disclosure';

interface AssetKitMixerTabProps {
  record: CaptureRecord;
  history: CaptureSummaryItem[];
  language?: UiLanguage;
  customWord: string;
  onCustomWordChange: (word: string) => void;
}

type LayerView = 'composite' | 'wordmark' | 'background';

function slugifyName(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 28) || 'stylelens'
  );
}

export function AssetKitMixerTab({
  record,
  history,
  language = 'en',
  customWord,
  onCustomWordChange,
}: AssetKitMixerTabProps) {
  const t = getTranslations(language);
  const [secondaryId, setSecondaryId] = useState<string>('');
  const [secondaryRecord, setSecondaryRecord] = useState<CaptureRecord | null>(null);
  const [mixMode, setMixMode] = useState<CrossSiteMixMode>('balanced');
  const [layerView, setLayerView] = useState<LayerView>('composite');
  const [feedback, setFeedback] = useState<string | null>(null);

  const mixModes: ReadonlyArray<{ id: CrossSiteMixMode; label: string }> = [
    { id: 'A-colors-B-layout', label: t.mixModeAStyleBFrame },
    { id: 'balanced', label: t.mixModeBalanced },
    { id: 'A-layout-B-colors', label: t.mixModeAFrameBStyle },
  ];

  const otherCaptures = useMemo(
    () => history.filter((item) => item.id !== record.id),
    [history, record.id]
  );

  useEffect(() => {
    setSecondaryId('');
    setSecondaryRecord(null);
  }, [record.id]);

  useEffect(() => {
    if (!secondaryId || secondaryId === record.id) {
      setSecondaryRecord(null);
      return;
    }
    let alive = true;
    void getCaptureById(secondaryId).then((rec) => {
      if (alive) setSecondaryRecord(rec);
    });
    return () => {
      alive = false;
    };
  }, [secondaryId, record.id]);

  const activeSecondary =
    secondaryId && secondaryRecord?.id === secondaryId ? secondaryRecord : null;

  const effectiveRecord = useMemo(
    () => (activeSecondary ? mixCaptureRecords(record, activeSecondary, mixMode) : record),
    [record, activeSecondary, mixMode]
  );

  // Never double-mix: effectiveRecord already contains the blended palette/layout!
  // Pass activeSecondary.page.hostname ONLY for W3C $extensions.stylelens.blendedWith metadata.
  const assetKit = useMemo(
    () => buildLocalAssetKit(effectiveRecord, customWord, activeSecondary?.page.hostname),
    [effectiveRecord, customWord, activeSecondary?.page.hostname]
  );

  const fontAssets = useMemo(
    () => buildPreviewFontAssets(effectiveRecord),
    [effectiveRecord]
  );

  const cssTokens = useMemo(
    () => generateCssTokens(effectiveRecord, !shouldSuppressHostFallbackFont(effectiveRecord)),
    [effectiveRecord]
  );

  const activeLayerSvg =
    layerView === 'wordmark'
      ? assetKit.wordmarkSvg
      : layerView === 'background'
        ? assetKit.backgroundSvg
        : assetKit.compositeSvg;

  // Guarantee readable contrast when previewing isolated transparent wordmark (dark text -> light canvas, light text -> dark canvas!)
  const wordmarkPreviewPolarity = useMemo<'dark' | 'light'>(() => {
    const parsed = parseCssColor(assetKit.profile.wordmarkCutoutColor);
    if (!parsed) return 'dark';
    return isDarkColor(parsed) ? 'light' : 'dark';
  }, [assetKit.profile.wordmarkCutoutColor]);

  const activeLayerSrcDoc = useMemo(() => {
    const html = `<style>
      .sl-svg-stage {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px;
      }
      .sl-svg-stage svg {
        width: 100%;
        height: auto;
        max-height: 156px;
        display: block;
      }
    </style>
    <div class="sl-svg-stage">${activeLayerSvg}</div>`;
    return buildPreviewSrcDoc(
      html,
      cssTokens,
      layerView === 'wordmark'
        ? wordmarkPreviewPolarity
        : assetKit.profile.cardIsDark
          ? 'dark'
          : 'light',
      fontAssets,
      640
    );
  }, [activeLayerSvg, cssTokens, layerView, wordmarkPreviewPolarity, assetKit.profile.cardIsDark, fontAssets]);

  const flash = (tag: string) => {
    setFeedback(tag);
    window.setTimeout(() => {
      setFeedback((prev) => (prev === tag ? null : prev));
    }, 1800);
  };

  const baseFilename = `${slugifyName(assetKit.profile.displayWord)}-${layerView}`;

  const handleDownloadPng = async () => {
    try {
      const pngBlob = await svgStringToPngBlob(activeLayerSvg, assetKit.width, assetKit.height, 2);
      const ok = await downloadBlob(pngBlob, `${baseFilename}.png`);
      if (ok) flash('png');
    } catch {
      const ok = await downloadText(activeLayerSvg, `${baseFilename}.svg`, 'image/svg+xml');
      if (ok) flash('png');
    }
  };

  const handleDownloadSvg = async () => {
    const ok = await downloadText(activeLayerSvg, `${baseFilename}.svg`, 'image/svg+xml');
    if (ok) flash('svg');
  };

  const handleDownloadBgHtml = async () => {
    const ok = await downloadText(
      assetKit.backgroundHtml,
      `${slugifyName(effectiveRecord.page.hostname)}-background.html`,
      'text/html'
    );
    if (ok) flash('html');
  };

  const handleCopyFigmaSvg = async () => {
    try {
      await navigator.clipboard.writeText(activeLayerSvg);
      flash('figma');
    } catch {
      await handleDownloadSvg();
    }
  };

  const handleDownloadW3c = async () => {
    const ok = await downloadText(
      assetKit.w3cTokensJson,
      `design-tokens-${slugifyName(effectiveRecord.page.hostname)}.json`,
      'application/json'
    );
    if (ok) flash('w3c');
  };

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight text-white">{t.kitTitle}</h1>
          <p className="text-[12px] text-zinc-400">{t.kitSubtitle}</p>
        </div>
      </div>

      {/* Custom Text Input */}
      <section className="sl-card space-y-2 rounded-xl p-3.5">
        <label
          htmlFor="sl-studio-word"
          className="flex items-center justify-between text-[12px] font-medium text-zinc-200"
        >
          <span className="flex items-center gap-1.5">
            <Type className="h-3.5 w-3.5 text-white" />
            {t.customTextLabel}
          </span>
          <span className="sl-mono text-[10.5px] text-zinc-400">
            {assetKit.profile.isArtworkStyleMatch
              ? t.imageStyleMatched
              : `${assetKit.profile.headingFontClean}${assetKit.profile.hasEmbeddedFont ? ' · EMBEDDED' : ''}`}
          </span>
        </label>
        <input
          id="sl-studio-word"
          type="text"
          value={customWord}
          onChange={(e) => onCustomWordChange(e.target.value)}
          placeholder={t.step2Placeholder}
          className="w-full rounded-lg border border-white/15 bg-[#09090c] px-3 py-2 text-[13.5px] text-white placeholder:text-zinc-500 focus:border-white/50 focus:outline-none"
        />
      </section>

      {/* Cross-Site Style Mixer */}
      <section className="sl-card space-y-2.5 rounded-xl p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
            <Shuffle className="h-3.5 w-3.5 text-white" />
            {t.mixerTitle}
          </span>
          <span className="sl-mono text-[10.5px] text-zinc-500">
            {activeSecondary ? t.mixerTwoSites : t.mixerSingleSite}
          </span>
        </div>

        {otherCaptures.length > 0 ? (
          <>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[11.5px]">
              <div className="truncate rounded-lg border border-white/12 bg-[#09090c] px-2.5 py-2 text-zinc-200">
                <span className="text-zinc-500">A: </span>
                {record.page.hostname}
              </div>
              <span className="sl-mono text-zinc-500">×</span>
              <select
                aria-label={t.mixerTitle}
                value={secondaryId}
                onChange={(e) => setSecondaryId(e.target.value)}
                className="truncate rounded-lg border border-white/15 bg-[#09090c] px-2 py-2 text-[11.5px] text-white outline-none focus:border-white/45"
              >
                <option value="">{t.mixerNoneOption}</option>
                {otherCaptures.map((item) => (
                  <option key={item.id} value={item.id}>
                    B: {item.hostname}
                  </option>
                ))}
              </select>
            </div>

            {activeSecondary && (
              <div className="grid grid-cols-3 gap-1">
                {mixModes.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMixMode(m.id)}
                    className={`rounded-lg px-2 py-1.5 text-[10.5px] font-medium transition ${
                      mixMode === m.id
                        ? 'bg-white text-black'
                        : 'border border-white/10 bg-[#0a0a0d] text-zinc-400 hover:text-white'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-[12px] text-zinc-400">{t.mixerEmptyHint}</p>
        )}
      </section>

      {/* 3-Layer Visual Preview & Downloads */}
      <section className="sl-card space-y-3 rounded-xl p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-white/[0.1] bg-[#0a0a0d] p-0.5 text-[11.5px]">
            {(
              [
                ['composite', t.layerComposite],
                ['wordmark', t.layerTextOnly],
                ['background', t.layerBackground],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setLayerView(id)}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  layerView === id ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <span className="sl-mono text-[10px] text-zinc-500">
            {assetKit.width}×{assetKit.height}
          </span>
        </div>

        <div className="sl-checkerboard overflow-hidden rounded-lg border border-white/10">
          <iframe
            title={`StyleLens ${layerView} layer preview`}
            sandbox=""
            srcDoc={activeLayerSrcDoc}
            className="h-[172px] w-full bg-transparent"
          />
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => void handleCopyFigmaSvg()}
            className="sl-btn-white col-span-2 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-[12.5px] transition"
          >
            {feedback === 'figma' ? (
              <>
                <Check className="h-4 w-4" />
                <span>{t.copiedFigmaToast}</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>
                  {t.copyLayerFigma(
                    layerView === 'composite'
                      ? t.layerComposite
                      : layerView === 'wordmark'
                        ? t.layerTextOnly
                        : t.layerBackground
                  )}
                </span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => void handleDownloadPng()}
            className="sl-btn-carbon flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] transition"
          >
            {feedback === 'png' ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-300" />
                <span className="text-emerald-200">{t.savedPng}</span>
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5 text-white" />
                <span>{t.downloadPng2x}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => void handleDownloadSvg()}
            className="sl-btn-carbon flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] transition"
          >
            {feedback === 'svg' ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-300" />
                <span className="text-emerald-200">{t.savedSvg}</span>
              </>
            ) : (
              <>
                <Layers className="h-3.5 w-3.5 text-white" />
                <span>{t.downloadSvg}</span>
              </>
            )}
          </button>

          {layerView === 'background' && (
            <button
              type="button"
              onClick={() => void handleDownloadBgHtml()}
              className="sl-btn-carbon col-span-2 flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] transition"
            >
              {feedback === 'html' ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-300" />
                  <span className="text-emerald-200">{t.savedBg}</span>
                </>
              ) : (
                <>
                  <Code2 className="h-3.5 w-3.5 text-white" />
                  <span>{t.downloadBgHtml}</span>
                </>
              )}
            </button>
          )}
        </div>
      </section>

      {/* W3C DTCG Design Tokens Export (Figma Tokens Studio / Style Dictionary) */}
      <Disclosure title={t.w3cTitle} subtitle={t.w3cSubtitle}>
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            <CopyButton
              text={assetKit.w3cTokensJson}
              label={t.copyJson}
              copiedLabel={t.copied}
              className="flex-1 py-2"
            />
            <button
              type="button"
              onClick={() => void handleDownloadW3c()}
              className="sl-btn-carbon flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] transition"
            >
              {feedback === 'w3c' ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-300" />
                  <span className="text-emerald-200">{t.saved}</span>
                </>
              ) : (
                <>
                  <FileJson className="h-3.5 w-3.5 text-white" />
                  <span>{t.saveJson}</span>
                </>
              )}
            </button>
          </div>
          <pre className="sl-mono max-h-52 overflow-auto rounded-lg border border-white/[0.08] bg-[#08080b] p-3 text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap">
            {assetKit.w3cTokensJson}
          </pre>
        </div>
      </Disclosure>
    </div>
  );
}
