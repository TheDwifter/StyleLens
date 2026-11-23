import { Crosshair } from 'lucide-react';
import type { ProviderCapability } from '../../ai/types';
import type { UiLanguage } from '../../storage/aiSettingsStore';
import { getTranslations } from '../i18n/translations';
import { Disclosure } from './Disclosure';

interface EmptyStateProps {
  onStartCapture: () => void;
  capabilities: ProviderCapability[];
  language?: UiLanguage;
}

export function EmptyState({
  onStartCapture,
  capabilities,
  language = 'en',
}: EmptyStateProps) {
  const t = getTranslations(language);
  return (
    <div className="flex h-full flex-col justify-between gap-5 p-5">
      <div className="my-auto space-y-6">
        <div className="space-y-3">
          <div className="sl-white-ring h-9 w-9 rounded-full" />
          <h1 className="text-[20px] font-semibold leading-snug tracking-tight text-white">
            {t.emptyTitle}
          </h1>
          <p className="text-[13.5px] leading-relaxed text-zinc-400">
            {t.emptyDescBefore}
            <strong className="font-medium text-zinc-200">{t.emptyDescBold}</strong>
            {t.emptyDescAfter}
          </p>
        </div>

        <button
          type="button"
          onClick={onStartCapture}
          className="sl-btn-white flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[13.5px] transition"
        >
          <Crosshair className="h-4 w-4" />
          {t.emptyBtn}
        </button>

        <p className="text-center text-[12px] text-zinc-500">
          {t.shortcutLabel} <span className="sl-mono text-zinc-300">Alt + Shift + S</span>
        </p>
      </div>

      <Disclosure title={t.systemStatusTitle} subtitle={t.systemStatusSub}>
        <div className="space-y-2">
          {capabilities.map((cap) => (
            <div key={cap.id} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="truncate text-zinc-400">{cap.label}</span>
              <span className="sl-mono shrink-0 text-[11px] text-zinc-200">{cap.availability}</span>
            </div>
          ))}
        </div>
      </Disclosure>
    </div>
  );
}
