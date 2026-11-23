import { Crosshair, History, Loader2, MessageSquare, Settings, X } from 'lucide-react';
import { useState } from 'react';
import type { UiLanguage, UiMode } from '../../storage/aiSettingsStore';
import type { CaptureRecord, CaptureSummaryItem } from '../../types/capture';
import type { CapturePhase } from '../hooks/useCaptureController';
import { getTranslations } from '../i18n/translations';
import { GlitchBrandWordmark } from './GlitchBrandWordmark';

export type SidePanelTab = 'capture' | 'kit' | 'dna' | 'structure' | 'remix';

interface HeaderProps {
  uiMode: UiMode;
  onUiModeChange: (mode: UiMode) => void;
  language: UiLanguage;
  onLanguageChange: (lang: UiLanguage) => void;
  stillMode: boolean;
  activeTab: SidePanelTab;
  onTabChange: (tab: SidePanelTab) => void;
  phase: CapturePhase;
  activeCapture: CaptureRecord | null;
  history: CaptureSummaryItem[];
  aiEngineActive: boolean;
  showAdvisor: boolean;
  onToggleAdvisor: () => void;
  onStartCapture: () => void;
  onCancelCapture: () => void;
  onSelectHistory: (id: string) => void;
  onOpenSettings: () => void;
}

export function Header({
  uiMode,
  onUiModeChange,
  language,
  onLanguageChange,
  stillMode,
  activeTab,
  onTabChange,
  phase,
  activeCapture,
  history,
  aiEngineActive,
  showAdvisor,
  onToggleAdvisor,
  onStartCapture,
  onCancelCapture,
  onSelectHistory,
  onOpenSettings,
}: HeaderProps) {
  const [showHistory, setShowHistory] = useState(false);
  const hasCapture = activeCapture !== null;
  const t = getTranslations(language);

  const tabs: Array<{ id: SidePanelTab; label: string }> = [
    { id: 'capture', label: t.tabCapture },
    { id: 'kit', label: t.tabKit },
    { id: 'dna', label: t.tabDesign },
    { id: 'structure', label: t.tabCode },
    { id: 'remix', label: t.tabRemix },
  ];

  const nextLanguage: UiLanguage = language === 'zh-CN' ? 'en' : 'zh-CN';

  return (
    <header className="relative z-20 shrink-0 border-b border-white/[0.08] bg-[#09090c]/92 backdrop-blur-md">
      {/* Minimalist Formal Top Bar — exact budget 295px (zero wrap/clip even at 320px Side Panel width!) */}
      <div className="flex items-center justify-between gap-1.5 px-2.5 py-2">
        <div className="flex shrink-0 items-center gap-1.5">
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0 drop-shadow-[0_0_8px_rgba(255,255,255,0.28)]"
          >
            <rect
              x="1"
              y="1"
              width="22"
              height="22"
              rx="6"
              fill="#111114"
              stroke="rgba(255,255,255,0.24)"
              strokeWidth="1"
            />
            <path
              d="M5.5 8.5V5.5H8.5M15.5 5.5H18.5V8.5M5.5 15.5V18.5H8.5M15.5 18.5H18.5V15.5"
              stroke="rgba(255,255,255,0.75)"
              strokeWidth="1.2"
              strokeLinecap="square"
            />
            <circle cx="12" cy="12" r="4.6" stroke="#ffffff" strokeWidth="1.5" />
            <polygon points="12,9.7 14.3,12 12,14.3 9.7,12" fill="#ffffff" />
          </svg>
          <GlitchBrandWordmark language={language} stillMode={stillMode} />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* 1-Click Simplified Chinese / English Switch */}
          <button
            type="button"
            data-no-glitch="true"
            onClick={() => onLanguageChange(nextLanguage)}
            className="sl-btn-carbon flex h-7 items-center justify-center rounded-lg px-2 text-[11px] font-semibold text-zinc-200 transition hover:text-white"
            title={language === 'zh-CN' ? 'Switch to English' : '切换为简体中文'}
            aria-label={language === 'zh-CN' ? 'Switch to English' : '切换为简体中文'}
          >
            <span>{language === 'zh-CN' ? 'EN' : '中文'}</span>
          </button>

          {/* Guided Simple Mode vs. Full Pro Studio Pill */}
          <div
            role="group"
            aria-label="Interface mode"
            data-no-glitch="true"
            className="inline-flex rounded-lg border border-white/[0.12] bg-[#101014] p-0.5 text-[10.5px]"
          >
            <button
              type="button"
              onClick={() => onUiModeChange('simple')}
              className={`rounded-md px-1.5 py-0.5 font-semibold transition ${
                uiMode === 'simple' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
              }`}
              title={t.modeSimple}
            >
              {t.modeSimple}
            </button>
            <button
              type="button"
              onClick={() => onUiModeChange('studio')}
              className={`rounded-md px-1.5 py-0.5 font-semibold transition ${
                uiMode === 'studio' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
              }`}
              title={t.modeStudio}
            >
              {t.modeStudio}
            </button>
          </div>

          <button
            type="button"
            data-no-glitch="true"
            onClick={onOpenSettings}
            className="sl-btn-carbon relative flex h-7 w-7 items-center justify-center rounded-lg"
            title={t.settingsTitle}
            aria-label={t.settingsTitle}
          >
            <Settings className="h-3.5 w-3.5 text-zinc-300" />
            {aiEngineActive && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]" />
            )}
          </button>
        </div>
      </div>

      {/* Pro Studio 5-Tab Navigation + Compact Studio Action Bar (hidden in Simple Mode!) */}
      {uiMode === 'studio' && (
        <>
          <nav className="grid grid-cols-5 border-t border-white/[0.06] px-1">
            {tabs.map((tab) => {
              const disabled = !hasCapture && tab.id !== 'capture';
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onTabChange(tab.id)}
                  className={`relative truncate px-0.5 py-2 text-[11.5px] font-medium transition ${
                    isActive
                      ? 'text-white'
                      : disabled
                        ? 'cursor-not-allowed text-zinc-700'
                        : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {tab.label}
                  {isActive && (
                    <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.75)]" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Compact Studio Utility Row: Scan + History + Ask for Advice */}
          <div className="flex items-center gap-1.5 border-t border-white/[0.06] bg-[#0b0b0e]/85 px-2.5 py-1.5">
            {phase === 'selecting' ? (
              <button
                key="studio-cancel"
                type="button"
                data-no-glitch="true"
                onClick={onCancelCapture}
                className="sl-btn-carbon flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12px] text-white"
              >
                <X className="h-3.5 w-3.5" />
                {t.cancel}
              </button>
            ) : phase === 'processing' ? (
              <button
                key="studio-processing"
                type="button"
                data-no-glitch="true"
                disabled
                className="sl-btn-carbon flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12px] text-zinc-400"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                {t.scan}
              </button>
            ) : (
              <button
                key="studio-scan"
                type="button"
                data-no-glitch="true"
                onClick={onStartCapture}
                className="sl-btn-white flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12px] transition"
              >
                <Crosshair className="h-3.5 w-3.5" />
                {t.scan}
              </button>
            )}

            {history.length > 0 && (
              <div className="relative shrink-0">
                <button
                  type="button"
                  data-no-glitch="true"
                  onClick={() => setShowHistory((prev) => !prev)}
                  className="sl-btn-carbon flex h-8 items-center gap-1 rounded-lg px-2 text-[12px]"
                  title={t.recentCaptures}
                >
                  <History className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="sl-mono text-[11px]">{history.length}</span>
                </button>

                {showHistory && (
                  <div
                    data-no-glitch="true"
                    className="absolute left-0 top-9 z-40 w-56 rounded-xl border border-white/[0.12] bg-[#111114] p-1.5 shadow-2xl"
                  >
                    <div className="mb-1 flex items-center justify-between px-2.5 py-1.5">
                      <span className="text-[11px] font-medium text-zinc-400">
                        {t.recentCaptures}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowHistory(false)}
                        className="text-zinc-500 hover:text-white"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="max-h-60 space-y-0.5 overflow-y-auto">
                      {history.map((item) => {
                        const isCurrent = item.id === activeCapture?.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              onSelectHistory(item.id);
                              setShowHistory(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition ${
                              isCurrent
                                ? 'bg-white/10 text-white'
                                : 'text-zinc-300 hover:bg-white/[0.05]'
                            }`}
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <div className="truncate text-[12px] font-medium">
                                {item.hostname}
                              </div>
                              <div className="sl-mono text-[10.5px] text-zinc-500">
                                {item.width}×{item.height}px
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {item.topColors.slice(0, 3).map((hex, i) => (
                                <span
                                  key={`${item.id}-${i}`}
                                  className="h-2.5 w-2.5 rounded-full border border-white/20"
                                  style={{ backgroundColor: hex }}
                                />
                              ))}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              data-no-glitch="true"
              onClick={onToggleAdvisor}
              className="sl-btn-carbon flex h-8 min-w-0 flex-1 items-center justify-between gap-1.5 rounded-lg px-2.5 text-[12px] transition"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-white" />
                <span className="truncate font-medium text-white">{t.askForAdvice}</span>
              </span>
              <span className="shrink-0 text-[11px] text-zinc-400">
                {showAdvisor ? t.close : t.openArrow}
              </span>
            </button>
          </div>
        </>
      )}
    </header>
  );
}
