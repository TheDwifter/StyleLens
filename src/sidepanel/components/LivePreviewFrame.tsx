import { Maximize2, Minimize2, Monitor, Shield, Smartphone } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildPreviewSrcDoc, type PreviewFontAssets } from '../../ai/responseParser';
import type { FidelityReport } from '../../core/fidelityCritic';

interface LivePreviewFrameProps {
  previewHtml: string;
  cssTokens: string;
  polarity: 'dark' | 'light' | 'mixed';
  modelLabel: string;
  usedVision: boolean;
  fontAssets?: PreviewFontAssets;
  fidelityReport?: FidelityReport;
}

export function LivePreviewFrame({
  previewHtml,
  cssTokens,
  polarity,
  modelLabel,
  usedVision,
  fontAssets,
  fidelityReport,
}: LivePreviewFrameProps) {
  const [viewportMode, setViewportMode] = useState<'fit' | 'mobile'>('fit');
  const [expanded, setExpanded] = useState(false);

  const srcDoc = useMemo(
    () => buildPreviewSrcDoc(previewHtml, cssTokens, polarity, fontAssets),
    [previewHtml, cssTokens, polarity, fontAssets]
  );

  return (
    <div className="sl-card overflow-hidden rounded-xl">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {fidelityReport ? (
            <span
              title={fidelityReport.verdict}
              className={`sl-mono inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                fidelityReport.passedThreshold
                  ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                  : 'border-amber-300/40 bg-amber-400/15 text-amber-200'
              }`}
            >
              {fidelityReport.totalScore}% Match
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-zinc-400"
              title="Rendered safely with JavaScript disabled"
            >
              <Shield className="h-3 w-3 text-zinc-300" />
              Safe Preview
            </span>
          )}
          <span className="truncate text-[11px] text-zinc-500">
            {modelLabel}{usedVision ? ' · Vision' : ''}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setViewportMode('fit')}
            className={`flex h-6 w-6 items-center justify-center rounded transition ${
              viewportMode === 'fit' ? 'bg-white/15 text-white' : 'text-zinc-500 hover:text-zinc-200'
            }`}
            title="Full width"
          >
            <Monitor className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewportMode('mobile')}
            className={`flex h-6 w-6 items-center justify-center rounded transition ${
              viewportMode === 'mobile' ? 'bg-white/15 text-white' : 'text-zinc-500 hover:text-zinc-200'
            }`}
            title="Mobile width"
          >
            <Smartphone className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition hover:bg-white/10 hover:text-white"
            title={expanded ? 'Smaller preview' : 'Larger preview'}
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="sl-checkerboard flex justify-center p-2.5">
        <iframe
          title="StyleLens Live Remixed Component Preview"
          sandbox=""
          srcDoc={srcDoc}
          className={`rounded-md border border-white/10 bg-transparent transition-all ${
            viewportMode === 'mobile' ? 'w-[300px]' : 'w-full'
          } ${expanded ? 'h-[420px]' : 'h-[285px]'}`}
        />
      </div>
    </div>
  );
}
