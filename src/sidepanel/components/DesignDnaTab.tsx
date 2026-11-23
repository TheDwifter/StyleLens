import { Check, Copy, Eye, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { shouldSuppressHostFallbackFont } from '../../core/captureClassification';
import { generateDesignDnaReport } from '../../core/specGenerator';
import type { UiLanguage } from '../../storage/aiSettingsStore';
import type { CaptureRecord } from '../../types/capture';
import { getTranslations } from '../i18n/translations';
import { CopyButton } from './CopyButton';
import { Disclosure } from './Disclosure';

interface DesignDnaTabProps {
  record: CaptureRecord;
  language?: UiLanguage;
}

export function DesignDnaTab({ record, language = 'en' }: DesignDnaTabProps) {
  const t = getTranslations(language);
  const { dna } = record;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showAllColors, setShowAllColors] = useState(false);
  const [showAllFonts, setShowAllFonts] = useState(false);

  const dnaReport = useMemo(() => generateDesignDnaReport(record), [record]);

  const displayTypography = shouldSuppressHostFallbackFont(record) ? [] : dna.typography;
  const visibleColors = showAllColors ? dna.palette : dna.palette.slice(0, 4);
  const visibleFonts = showAllFonts ? displayTypography : displayTypography.slice(0, 2);
  const failingContrastCount = dna.contrastChecks.filter((c) => !c.aaNormal).length;

  const copyValue = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1400);
    } catch {
      // Clipboard fallback unavailable
    }
  };

  return (
    <div className="space-y-4 p-4">
      {/* Clean Header + Copy Report */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight text-white">{t.designTitle}</h1>
          <p className="text-[12px] text-zinc-500 capitalize">
            {t.themeSummary(dna.polarity, dna.palette.length)}
          </p>
        </div>
        <CopyButton
          text={dnaReport}
          label={t.copyReport}
          copiedLabel={t.copied}
          title={t.copyReport}
        />
      </div>

      {/* Main Colors (Shows Top 4 Cleanly, Rest Behind Show More) */}
      <section className="sl-card space-y-3 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-white">{t.colorsHeading}</h2>
          <span className="text-[11.5px] text-zinc-500">{t.tapToCopy}</span>
        </div>

        {dna.palette.length === 0 ? (
          <p className="text-[12.5px] text-zinc-500">{t.noColorsDetected}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {visibleColors.map((token, idx) => {
                const key = `color-${token.hex}-${idx}`;
                const copyText = token.alpha < 0.99 ? token.rgbString : token.hex;
                const isCopied = copiedKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => void copyValue(key, copyText)}
                    className="group flex items-center gap-2.5 rounded-lg border border-white/[0.07] bg-[#0b0b0d] p-2.5 text-left transition hover:border-white/25"
                  >
                    <div
                      className="h-7 w-7 shrink-0 rounded-md border border-white/15"
                      style={{ backgroundColor: token.rgbString }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="sl-mono truncate text-[12px] font-medium text-white">
                          {token.hex}
                        </span>
                        {isCopied ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-white" />
                        ) : (
                          <Copy className="h-3 w-3 shrink-0 text-zinc-600 opacity-0 transition group-hover:opacity-100" />
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-500">
                        <span className="capitalize">{token.role}</span>
                        {token.provenance === 'sampled-pixels' && (
                          <span className="inline-flex items-center gap-0.5 text-zinc-400" title="Sampled from image pixels">
                            <Eye className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {dna.palette.length > 4 && (
              <button
                type="button"
                onClick={() => setShowAllColors((prev) => !prev)}
                className="w-full rounded-lg border border-white/[0.07] py-1.5 text-[12px] text-zinc-400 transition hover:border-white/20 hover:text-white"
              >
                {showAllColors ? t.showFewerColors : t.showAllColors(dna.palette.length)}
              </button>
            )}
          </>
        )}
      </section>

      {/* Main Fonts (Shows Top 2 Cleanly, Rest Behind Show More) */}
      <section className="sl-card space-y-3 rounded-xl p-4">
        <h2 className="text-[13px] font-medium text-white">{t.fontsHeading}</h2>
        {displayTypography.length === 0 ? (
          <p className="text-[12.5px] text-zinc-500">{t.noTextStylesFound}</p>
        ) : (
          <>
            <div className="divide-y divide-white/[0.06]">
              {visibleFonts.map((type, idx) => (
                <div
                  key={`${type.primaryFont}-${type.fontSizePx}-${idx}`}
                  className="py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-white">
                      {type.primaryFont}
                    </span>
                    <span className="sl-mono shrink-0 text-[11.5px] text-zinc-400">
                      {type.fontSizePx}px · {type.fontWeight}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-zinc-500">“{type.sampleText}”</p>
                </div>
              ))}
            </div>

            {displayTypography.length > 2 && (
              <button
                type="button"
                onClick={() => setShowAllFonts((prev) => !prev)}
                className="w-full rounded-lg border border-white/[0.07] py-1.5 text-[12px] text-zinc-400 transition hover:border-white/20 hover:text-white"
              >
                {showAllFonts ? t.showFewerFonts : t.showAllFonts(displayTypography.length)}
              </button>
            )}
          </>
        )}
      </section>

      {/* Progressive Disclosure: Contrast Audit */}
      {dna.contrastChecks.length > 0 && (
        <Disclosure
          title={t.readabilityContrastTitle}
          subtitle={t.readabilityContrastSub}
          badge={
            failingContrastCount === 0 ? (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-zinc-200">
                {t.allPass}
              </span>
            ) : (
              <span className="rounded-full border border-white/20 px-2 py-0.5 text-[11px] font-medium text-white">
                {t.lowContrastCount(failingContrastCount)}
              </span>
            )
          }
        >
          <div className="divide-y divide-white/[0.06]">
            {dna.contrastChecks.map((check, idx) => (
              <div
                key={`${check.foregroundHex}-${check.backgroundHex}-${idx}`}
                className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div
                    className="flex h-7 w-9 shrink-0 items-center justify-center rounded border border-white/15 text-[11.5px] font-semibold"
                    style={{
                      backgroundColor: check.backgroundHex,
                      color: check.foregroundHex,
                    }}
                  >
                    Aa
                  </div>
                  <div className="min-w-0">
                    <div className="sl-mono truncate text-[11.5px] text-zinc-200">
                      {check.foregroundHex}
                      {t.contrastOn}
                      {check.backgroundHex}
                    </div>
                    <div className="truncate text-[11px] text-zinc-500">
                      {check.sampleText}
                      {check.isEstimated ? t.estimatedSuffix : ''}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="sl-mono text-[11.5px] text-zinc-300">{check.ratio}:1</span>
                  {check.aaNormal ? (
                    <ShieldCheck className="h-4 w-4 text-zinc-200" />
                  ) : (
                    <ShieldAlert className="h-4 w-4 text-zinc-400" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </Disclosure>
      )}

      {/* Progressive Disclosure: Spacing, Layout, Surfaces & Style Traits */}
      <Disclosure
        title={t.spacingLayoutTitle}
        subtitle={t.spacingLayoutSub(dna.layout.primaryModel, dna.traits.length)}
      >
        <div className="space-y-4 text-[12px]">
          {dna.traits.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11.5px] text-zinc-500">{t.detectedTraits}</div>
              <div className="flex flex-wrap gap-1.5">
                {dna.traits.map((trait) => (
                  <span
                    key={trait.id}
                    title={trait.evidence}
                    className="rounded-full border border-white/[0.1] bg-[#0b0b0d] px-2.5 py-1 text-[11px] text-zinc-200"
                  >
                    {trait.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="divide-y divide-white/[0.06]">
            <div className="flex items-center justify-between py-2">
              <span className="text-zinc-500">{t.layoutModel}</span>
              <span className="sl-mono uppercase text-zinc-200">
                {dna.layout.primaryModel}
                {dna.layout.flexCount > 0 ? ` · ${dna.layout.flexCount} flex` : ''}
                {dna.layout.gridCount > 0 ? ` · ${dna.layout.gridCount} grid` : ''}
              </span>
            </div>
            {dna.layout.spacingGridBase && (
              <div className="flex items-center justify-between py-2">
                <span className="text-zinc-500">{t.spacingGrid}</span>
                <span className="sl-mono text-zinc-200">
                  {dna.layout.spacingGridBase}
                  {t.pxBaseSuffix}
                </span>
              </div>
            )}
          </div>

          {dna.layout.spacingScalePx.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11.5px] text-zinc-500">{t.observedSpacing}</div>
              <div className="flex flex-wrap gap-1.5">
                {dna.layout.spacingScalePx.map((px) => (
                  <span
                    key={px}
                    className="sl-mono rounded border border-white/[0.08] bg-[#0b0b0d] px-2 py-0.5 text-[11px] text-zinc-300"
                  >
                    {px}px
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2.5 border-t border-white/[0.06] pt-3">
            <SurfaceRow label={t.surfaceCornerRounding} values={dna.surfaces.borderRadii} />
            <SurfaceRow label={t.surfaceBorders} values={dna.surfaces.borders} />
            <SurfaceRow label={t.surfaceShadows} values={dna.surfaces.shadows} />
            <SurfaceRow label={t.surfaceBackdropBlur} values={dna.surfaces.backdropFilters} />
            <SurfaceRow label={t.surfaceGradients} values={dna.surfaces.gradients} />
          </div>
        </div>
      </Disclosure>

      {/* Progressive Disclosure: Site CSS Variables */}
      {dna.cssVariables.length > 0 && (
        <Disclosure
          title={t.cssVariablesTitle}
          subtitle={t.cssVariablesSub(dna.cssVariables.length)}
        >
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {dna.cssVariables.slice(0, 24).map((v) => (
              <div key={v.name} className="sl-mono flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-zinc-200">{v.name}</span>
                <span className="truncate text-zinc-500">{v.value}</span>
              </div>
            ))}
          </div>
        </Disclosure>
      )}
    </div>
  );
}

function SurfaceRow({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-[11.5px] text-zinc-500">{label}</div>
      {values.slice(0, 3).map((val, idx) => (
        <div
          key={`${label}-${idx}`}
          className="sl-mono break-all rounded-md border border-white/[0.06] bg-[#0b0b0d] px-2.5 py-1.5 text-[11px] text-zinc-300"
        >
          {val}
        </div>
      ))}
    </div>
  );
}
