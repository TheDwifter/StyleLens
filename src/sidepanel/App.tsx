import { AlertCircle, Link2, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { OpenAICompatibleProvider } from '../ai/openaiCompatibleProvider';
import { getPresetById, type UiLanguage, type UiMode } from '../storage/aiSettingsStore';
import { AiSettingsModal } from './components/AiSettingsModal';
import { AssetKitMixerTab } from './components/AssetKitMixerTab';
import { CaptureTab } from './components/CaptureTab';
import { DesignAdvisorWidget } from './components/DesignAdvisorWidget';
import { DesignDnaTab } from './components/DesignDnaTab';
import { EmptyState } from './components/EmptyState';
import { Header, type SidePanelTab } from './components/Header';
import { NoirNeonBackdrop } from './components/NoirNeonBackdrop';
import { RemixTab } from './components/RemixTab';
import { SimpleModeView } from './components/SimpleModeView';
import { StructureTab } from './components/StructureTab';
import { useCaptureController } from './hooks/useCaptureController';
import { getTranslations } from './i18n/translations';
import { triggerLetterGlitch } from './utils/textGlitch';

const INTERACTIVE_SELECTOR = 'button, a, [role="button"]';

export function App() {
  const controller = useCaptureController();
  const [activeTab, setActiveTab] = useState<SidePanelTab>('capture');
  const [customWord, setCustomWord] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [showAdvisor, setShowAdvisor] = useState(false);
  const lastCaptureIdRef = useRef<string | null>(null);

  // When a brand-new capture arrives (e.g. via Alt+Shift+S or toolbar icon), clear Step 2's
  // previous customWord so Step 2 starts fresh and unchecked for the newly captured style.
  useEffect(() => {
    const nextId = controller.activeCapture?.id ?? null;
    if (nextId && lastCaptureIdRef.current && nextId !== lastCaptureIdRef.current) {
      setCustomWord('');
    }
    if (nextId) {
      lastCaptureIdRef.current = nextId;
    }
  }, [controller.activeCapture?.id]);

  const handlePickNew = () => {
    lastCaptureIdRef.current = null;
    controller.clearActiveCapture();
    setCustomWord('');
    void controller.startCapture();
  };

  const uiMode: UiMode = controller.aiSettings.uiMode === 'studio' ? 'studio' : 'simple';
  const language: UiLanguage = controller.aiSettings.language === 'zh-CN' ? 'zh-CN' : 'en';
  const stillMode = Boolean(controller.aiSettings.stillMode);
  const t = getTranslations(language);

  const handleUiModeChange = (nextMode: UiMode) => {
    void controller.updateAiSettings({
      ...controller.aiSettings,
      uiMode: nextMode,
    });
  };

  const handleLanguageChange = (nextLang: UiLanguage) => {
    void controller.updateAiSettings({
      ...controller.aiSettings,
      language: nextLang,
    });
  };

  // Subtle white-light letter glitch strictly on top <header> / tabs — respects Still Mode too!
  useEffect(() => {
    if (stillMode) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      const interactive = target?.closest<HTMLElement>(INTERACTIVE_SELECTOR);
      if (!interactive || interactive.hasAttribute('disabled')) return;
      if (!interactive.closest('header')) return;
      if (interactive.closest('[data-no-glitch="true"]')) return;
      triggerLetterGlitch(interactive);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [stillMode]);

  const handleSelectHistory = async (id: string) => {
    await controller.selectFromHistory(id);
    setActiveTab('capture');
  };

  const byokConnected =
    controller.aiSettings.activeProvider === 'openai-compatible' &&
    new OpenAICompatibleProvider(controller.aiSettings.byok).isConfigured();
  const aiEngineActive = byokConnected || controller.aiSettings.activeProvider === 'chrome-builtin';
  const connectedLabel = byokConnected
    ? getPresetById(controller.aiSettings.byok.presetId).label
    : controller.aiSettings.activeProvider === 'chrome-builtin'
      ? 'Chrome AI'
      : null;

  return (
    <div className="sl-stealth-canvas relative flex h-screen flex-col overflow-hidden text-zinc-100">
      <NoirNeonBackdrop stillMode={stillMode} />

      <div className="relative z-10 flex h-full flex-col">
        <Header
          uiMode={uiMode}
          onUiModeChange={handleUiModeChange}
          language={language}
          onLanguageChange={handleLanguageChange}
          stillMode={stillMode}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          phase={controller.phase}
          activeCapture={controller.activeCapture}
          history={controller.history}
          aiEngineActive={aiEngineActive}
          showAdvisor={showAdvisor}
          onToggleAdvisor={() => setShowAdvisor((prev) => !prev)}
          onStartCapture={() => void controller.startCapture()}
          onCancelCapture={() => void controller.cancelCapture()}
          onSelectHistory={(id) => void handleSelectHistory(id)}
          onOpenSettings={() => setShowSettings(true)}
        />

        {/* Contextual Error Banner */}
        {controller.error && (
          <div className="sl-card mx-4 mt-3 rounded-xl border-white/25 p-3 text-[12px] text-zinc-200">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-white" />
                <div className="space-y-2">
                  <p>{controller.error.message}</p>
                  {controller.error.code === 'PERMISSION_REQUIRED' && controller.error.origin && (
                    <button
                      type="button"
                      onClick={() => void controller.grantOriginAndCapture(controller.error!.origin!)}
                      className="sl-btn-white inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px]"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {t.allowOrigin(controller.error.origin.replace(/^https?:\/\//, ''))}
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={controller.dismissError}
                className="text-zinc-500 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Active Scan Banner (Studio mode — Simple mode shows inline step guidance) */}
        {uiMode === 'studio' && controller.phase === 'selecting' && (
          <div className="sl-card mx-4 mt-3 flex items-center justify-between rounded-xl border-white/25 px-3.5 py-2.5 text-[12px] text-white">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
              <span>{t.dragBoxBanner}</span>
            </div>
            <span className="sl-mono text-[10.5px] text-zinc-400">ESC</span>
          </div>
        )}

        {/* Main Scrollable Content */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          {uiMode === 'simple' ? (
            <SimpleModeView
              record={controller.activeCapture}
              previewUrl={controller.previewUrl}
              phase={controller.phase}
              language={language}
              customWord={customWord}
              onCustomWordChange={setCustomWord}
              onStartCapture={() => void controller.startCapture()}
              onPickNew={handlePickNew}
              onCancelCapture={() => void controller.cancelCapture()}
              onSwitchToStudio={() => {
                handleUiModeChange('studio');
                setActiveTab(controller.activeCapture ? 'kit' : 'capture');
              }}
            />
          ) : !controller.activeCapture ? (
            <EmptyState
              onStartCapture={() => void controller.startCapture()}
              capabilities={controller.capabilities}
              language={language}
            />
          ) : activeTab === 'capture' ? (
            <CaptureTab
              record={controller.activeCapture}
              previewUrl={controller.previewUrl}
              language={language}
              customWord={customWord}
              onCustomWordChange={setCustomWord}
              onRecapture={() => void controller.startCapture()}
              onDelete={() => void controller.removeCapture(controller.activeCapture!.id)}
              onOpenAssetKit={() => setActiveTab('kit')}
            />
          ) : activeTab === 'kit' ? (
            <AssetKitMixerTab
              record={controller.activeCapture}
              history={controller.history}
              language={language}
              customWord={customWord}
              onCustomWordChange={setCustomWord}
            />
          ) : activeTab === 'dna' ? (
            <DesignDnaTab record={controller.activeCapture} language={language} />
          ) : activeTab === 'structure' ? (
            <StructureTab record={controller.activeCapture} language={language} />
          ) : (
            <RemixTab
              record={controller.activeCapture}
              history={controller.history}
              aiSettings={controller.aiSettings}
              language={language}
              onOpenSettings={() => setShowSettings(true)}
            />
          )}
        </main>

        {/* Bottom Connect Account Bar — Shown in Pro Studio Mode */}
        {uiMode === 'studio' && (
          <footer className="shrink-0 border-t border-white/[0.08] bg-[#09090c]/90 px-4 py-2.5 backdrop-blur-md">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="sl-btn-carbon flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left transition"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Link2 className="h-4 w-4 shrink-0 text-white" />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[12.5px] font-semibold text-white">
                    {connectedLabel ? `${t.connectedPrefix}${connectedLabel}` : t.connectAccount}
                    {connectedLabel && (
                      <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]" />
                    )}
                  </span>
                  <span className="block truncate text-[10.5px] text-zinc-500">
                    Claude · OpenAI · Gemini · DeepSeek · Kimi
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-[11.5px] text-zinc-400">
                {connectedLabel ? t.manageArrow : t.connectArrow}
              </span>
            </button>
          </footer>
        )}

        <DesignAdvisorWidget
          open={showAdvisor}
          onClose={() => setShowAdvisor(false)}
          record={controller.activeCapture}
          aiSettings={controller.aiSettings}
          language={language}
        />

        {showSettings && (
          <AiSettingsModal
            settings={controller.aiSettings}
            capabilities={controller.capabilities}
            onSave={controller.updateAiSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
      </div>
    </div>
  );
}
