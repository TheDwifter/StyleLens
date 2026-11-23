import { useCallback, useEffect, useRef, useState } from 'react';
import { OpenAICompatibleProvider } from '../../ai/openaiCompatibleProvider';
import { probeAllProviderCapabilities, type ProviderCapability } from '../../ai/types';
import { analyzeDesignDNA } from '../../core/designAnalyzer';
import {
  DEFAULT_AI_SETTINGS,
  loadAiSettings,
  saveAiSettings,
  type AiSettings,
} from '../../storage/aiSettingsStore';
import {
  deleteCapture,
  getCaptureById,
  listCaptureSummaries,
  saveCapture,
} from '../../storage/captureStore';
import type { CaptureRecord, CaptureSummaryItem, PendingCapturePayload } from '../../types/capture';
import type {
  CaptureErrorCode,
  ImageWorkerRequest,
  ImageWorkerResponse,
  ServiceWorkerBroadcastMessage,
  StartCaptureResponse,
} from '../../types/messages';

export type CapturePhase = 'idle' | 'selecting' | 'processing';

export interface CaptureErrorState {
  code: CaptureErrorCode;
  message: string;
  origin?: string;
}

export interface CaptureController {
  phase: CapturePhase;
  activeCapture: CaptureRecord | null;
  previewUrl: string | null;
  history: CaptureSummaryItem[];
  error: CaptureErrorState | null;
  capabilities: ProviderCapability[];
  aiSettings: AiSettings;
  startCapture: () => Promise<void>;
  cancelCapture: () => Promise<void>;
  clearActiveCapture: () => void;
  grantOriginAndCapture: (origin: string) => Promise<void>;
  selectFromHistory: (id: string) => Promise<void>;
  removeCapture: (id: string) => Promise<void>;
  updateAiSettings: (next: AiSettings) => Promise<void>;
  dismissError: () => void;
}

export function useCaptureController(): CaptureController {
  const [phase, setPhase] = useState<CapturePhase>('idle');
  const [activeCapture, setActiveCapture] = useState<CaptureRecord | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<CaptureSummaryItem[]>([]);
  const [error, setError] = useState<CaptureErrorState | null>(null);
  const [capabilities, setCapabilities] = useState<ProviderCapability[]>([]);
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);

  const workerRef = useRef<Worker | null>(null);
  const activePreviewUrlRef = useRef<string | null>(null);

  const setManagedPreviewBlob = useCallback((blob: Blob | null) => {
    if (activePreviewUrlRef.current) {
      URL.revokeObjectURL(activePreviewUrlRef.current);
      activePreviewUrlRef.current = null;
    }
    if (blob) {
      const url = URL.createObjectURL(blob);
      activePreviewUrlRef.current = url;
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  }, []);

  const getOrCreateWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../../workers/imageProcessor.worker.ts', import.meta.url),
        { type: 'module' }
      );
    }
    return workerRef.current;
  }, []);

  const runImageWorker = useCallback(
    (payload: PendingCapturePayload): Promise<ImageWorkerResponse> => {
      return new Promise((resolve) => {
        const worker = getOrCreateWorker();
        const onMessage = (event: MessageEvent<ImageWorkerResponse>) => {
          if (event.data.id !== payload.id) return;
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          resolve(event.data);
        };
        const onError = (err: ErrorEvent) => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          resolve({
            id: payload.id,
            ok: false,
            error: err.message || 'Image worker crashed while cropping screenshot.',
          });
        };

        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);

        const request: ImageWorkerRequest = {
          id: payload.id,
          fullViewportDataUrl: payload.fullViewportDataUrl,
          rect: payload.rect,
          viewport: payload.viewport,
          maxColors: 6,
        };
        worker.postMessage(request);
      });
    },
    [getOrCreateWorker]
  );

  const refreshHistory = useCallback(async (): Promise<CaptureSummaryItem[]> => {
    const items = await listCaptureSummaries();
    setHistory(items);
    return items;
  }, []);

  const updateAiSettings = useCallback(async (next: AiSettings) => {
    await saveAiSettings(next);
    setAiSettings(next);
    const byokReady = new OpenAICompatibleProvider(next.byok).isConfigured();
    const caps = await probeAllProviderCapabilities(byokReady);
    setCapabilities(caps);
  }, []);

  const consumePendingCapture = useCallback(async () => {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'STYLELENS_CONSUME_PENDING_CAPTURE',
      })) as { pending: PendingCapturePayload | null } | undefined;

      const pending = response?.pending;
      if (!pending) return;

      setPhase('processing');
      setError(null);

      const workerRes = await runImageWorker(pending);
      if (!workerRes.ok) {
        setError({
          code: 'CAPTURE_FAILED',
          message: `Image cropping failed: ${workerRes.error}`,
        });
        setPhase('idle');
        return;
      }

      const dna = analyzeDesignDNA(pending.dom, workerRes.sampledColors, pending.rect);
      const record: CaptureRecord = {
        id: pending.id,
        createdAt: pending.capturedAt,
        page: pending.page,
        rect: pending.rect,
        viewport: pending.viewport,
        captureMode: pending.dom.captureMode,
        visualFallbackReason: pending.dom.visualFallbackReason,
        containsGraphicArtwork: pending.dom.containsGraphicArtwork,
        graphicArtworkNote: pending.dom.graphicArtworkNote,
        selectionMethod: pending.dom.selectionMethod,
        totalNodesScanned: pending.dom.totalNodesScanned,
        truncated: pending.dom.truncated,
        screenshotBlob: workerRes.croppedBlob,
        screenshotWidth: workerRes.width,
        screenshotHeight: workerRes.height,
        roots: pending.dom.roots,
        dna,
      };

      await saveCapture(record);
      setActiveCapture(record);
      setManagedPreviewBlob(record.screenshotBlob);
      await refreshHistory();
      setPhase('idle');
    } catch (err) {
      setError({
        code: 'CAPTURE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to process capture.',
      });
      setPhase('idle');
    }
  }, [refreshHistory, runImageWorker, setManagedPreviewBlob]);

  const startCapture = useCallback(async () => {
    setError(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'STYLELENS_REQUEST_START_CAPTURE',
        language: aiSettings.language ?? 'en',
      })) as StartCaptureResponse | undefined;

      if (res && !res.ok) {
        setPhase('idle');
        setError({
          code: res.code ?? 'INJECTION_FAILED',
          message: res.message ?? 'Could not start capture on active tab.',
          origin: res.origin,
        });
      } else {
        setPhase('selecting');
      }
    } catch (err) {
      setPhase('idle');
      setError({
        code: 'INJECTION_FAILED',
        message: err instanceof Error ? err.message : 'Extension background worker unavailable.',
      });
    }
  }, [aiSettings.language]);

  const cancelCapture = useCallback(async () => {
    setPhase('idle');
    try {
      await chrome.runtime.sendMessage({ type: 'STYLELENS_REQUEST_CANCEL_CAPTURE' });
    } catch {
      // Ignore if tab closed
    }
  }, []);

  const clearActiveCapture = useCallback(() => {
    setActiveCapture(null);
    setManagedPreviewBlob(null);
    setError(null);
  }, [setManagedPreviewBlob]);

  const grantOriginAndCapture = useCallback(
    async (origin: string) => {
      try {
        const granted = await chrome.permissions.request({
          origins: [`${origin}/*`],
        });
        if (granted) {
          setError(null);
          await startCapture();
        }
      } catch (err) {
        setError({
          code: 'PERMISSION_REQUIRED',
          message: err instanceof Error ? err.message : 'Permission request declined.',
          origin,
        });
      }
    },
    [startCapture]
  );

  const selectFromHistory = useCallback(
    async (id: string) => {
      const record = await getCaptureById(id);
      if (!record) return;
      setActiveCapture(record);
      setManagedPreviewBlob(record.screenshotBlob);
      setError(null);
    },
    [setManagedPreviewBlob]
  );

  const removeCapture = useCallback(
    async (id: string) => {
      await deleteCapture(id);
      const updated = await refreshHistory();
      if (activeCapture?.id === id) {
        if (updated[0]) {
          const next = await getCaptureById(updated[0].id);
          setActiveCapture(next);
          setManagedPreviewBlob(next?.screenshotBlob ?? null);
        } else {
          setActiveCapture(null);
          setManagedPreviewBlob(null);
        }
      }
    },
    [activeCapture?.id, refreshHistory, setManagedPreviewBlob]
  );

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const [loadedSettings, summaries] = await Promise.all([
        loadAiSettings(),
        refreshHistory(),
      ]);
      if (cancelled) return;
      setAiSettings(loadedSettings);

      const byokReady = new OpenAICompatibleProvider(loadedSettings.byok).isConfigured();
      const caps = await probeAllProviderCapabilities(byokReady);
      if (cancelled) return;
      setCapabilities(caps);

      if (summaries[0]) {
        const latest = await getCaptureById(summaries[0].id);
        if (!cancelled && latest) {
          setActiveCapture(latest);
          setManagedPreviewBlob(latest.screenshotBlob);
        }
      }

      if (!cancelled) {
        await consumePendingCapture();
      }
    };

    void init();

    const onRuntimeMessage = (message: ServiceWorkerBroadcastMessage) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'STYLELENS_CAPTURE_STATUS') {
        if (message.status === 'selecting') setPhase('selecting');
        else if (message.status === 'capturing') setPhase('processing');
        else setPhase('idle');
      } else if (message.type === 'STYLELENS_CAPTURE_READY') {
        void consumePendingCapture();
      } else if (message.type === 'STYLELENS_CAPTURE_ERROR') {
        setPhase('idle');
        setError({
          code: message.code,
          message: message.message,
          origin: message.origin,
        });
      }
    };

    chrome.runtime.onMessage.addListener(onRuntimeMessage);

    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      workerRef.current?.terminate();
      workerRef.current = null;
      if (activePreviewUrlRef.current) {
        URL.revokeObjectURL(activePreviewUrlRef.current);
      }
    };
  }, [consumePendingCapture, refreshHistory, setManagedPreviewBlob]);

  return {
    phase,
    activeCapture,
    previewUrl,
    history,
    error,
    capabilities,
    aiSettings,
    startCapture,
    cancelCapture,
    clearActiveCapture,
    grantOriginAndCapture,
    selectFromHistory,
    removeCapture,
    updateAiSettings,
    dismissError: () => setError(null),
  };
}
