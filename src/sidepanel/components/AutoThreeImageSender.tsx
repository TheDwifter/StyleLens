import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Eye,
  Image as ImageIcon,
  Layers,
  Loader2,
  RotateCcw,
  Scissors,
  Send,
  Sparkles,
  Square,
  Type,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isArtworkOrPhotoLikeCapture } from '../../core/captureClassification';
import {
  buildBackgroundOnlyImagePrompt,
  buildCompositeImagePrompt,
  buildTextOnlyImagePrompt,
  buildThreeImageSteps,
  type SeparationSourceMode,
} from '../../core/chatImagePrompts';
import {
  extractTransparentWordmarkPng,
  splitMasterImageLayersLocally,
  traceTransparentWordmarkToVectorSvg,
  type SplitQuality,
} from '../../core/imageLayerProcessor';
import { generateCompleteAgentPrompt } from '../../core/specGenerator';
import { rebuildBackgroundOnDevice } from '../utils/lamaRuntime';
import { detectTextOnDevice } from '../utils/textDetectorRuntime';
import { measureLetteringFromDataUrl } from '../utils/letteringProbe';
import {
  buildStyleCorrectionPrompt,
  compareLettering,
  type LetteringDrift,
  type LetteringMetrics,
} from '../../core/letteringMetrics';
import { OrbIcon } from './OrbIcon';
import type { UiLanguage } from '../../storage/aiSettingsStore';
import type { CaptureRecord } from '../../types/capture';
import type {
  AssistantImageDescriptor,
  ChatProbeResponse,
  ChatSubmitResponse,
  PasteToChatResponse,
} from '../../types/messages';
import { getTranslations } from '../i18n/translations';
import {
  blobToDataUrl,
  classifyActiveChatUrl,
  copyCapturePngToClipboard,
  downscalePngDataUrlForUpload,
  ensurePngBlob,
  executeSendOrCopyBoth,
  extractAssistantChatImage,
  getActiveTabInfo,
  isGrokChatUrl,
  openOrFocusAiChat,
  type ChatActionState,
} from '../utils/chatSender';
import {
  downloadBlob,
  downloadDataUrlPng,
  downloadText,
  slugifyFilenamePart,
} from '../utils/download';
import {
  runThreeImageSequence,
  type DynamicStepPayload,
  type RunOutcome,
  type StepPhase,
} from '../utils/threeImageRun';

interface AutoThreeImageSenderProps {
  record: CaptureRecord;
  customWord: string;
  /** What the captured picture currently says (confirmed by the user in Step 2). */
  originalText?: string;
  language: UiLanguage;
  /** False until the user typed their word (Step 2). */
  enabled: boolean;
  onLocked: () => void;
  onPickNew?: () => void;
  /** Tells the parent when all 3 layers are ready (so it can cue "Pick New Picture"). */
  onAllLayersReadyChange?: (ready: boolean) => void;
}

export type SplitExecutionMode = 'instant-1-prompt' | 'deep-3-prompt';

interface ExtractedPictureLayer {
  dataUrl: string;
  uploadDataUrl: string;
  width: number;
  height: number;
}

interface ExtractedFontLayer {
  rawDataUrl: string;
  transparentDataUrl: string;
  transparentApplied: boolean;
  backdropIsLight: boolean;
  vectorSvg: string;
  splitLocally: boolean;
  width: number;
  height: number;
}

interface ExtractedBackgroundLayer {
  dataUrl: string;
  splitLocally: boolean;
  width: number;
  height: number;
}

interface SeparatedAssets {
  picture: ExtractedPictureLayer | null;
  font: ExtractedFontLayer | null;
  background: ExtractedBackgroundLayer | null;
}

type RunStage =
  | 'idle'
  | 'making'
  | 'checking'
  | 'rebuilding'
  | 'ai-background'
  | 'ai-both'
  | 'ai-deep';
interface RunReport {
  stage: RunStage;
  promptsUsed: number;
  /** How the two extra layers were obtained. */
  route: 'local' | 'ai-background' | 'ai-both' | 'ai-deep' | null;
  reasons: SplitQuality['reasons'];
}
const EMPTY_RUN_REPORT: RunReport = { stage: 'idle', promptsUsed: 0, route: null, reasons: [] };

type RunState =
  | { kind: 'idle' }
  | { kind: 'scanning-existing' }
  | { kind: 'existing-not-found' }
  | { kind: 'text-only-preflight'; aiName: string }
  | { kind: 'running'; phases: StepPhase[] }
  | { kind: 'finished'; phases: StepPhase[]; outcome: RunOutcome; copiedPngFallback?: boolean };

const EMPTY_ASSETS: SeparatedAssets = {
  picture: null,
  font: null,
  background: null,
};

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

const QUICK_IMAGE_AIS = [
  {
    id: 'gemini',
    label: 'Gemini',
    url: 'https://gemini.google.com/app',
    hostMatch: /(?:^|\.)(?:gemini\.google\.com|aistudio\.google\.com)$/i,
  },
  {
    id: 'openai',
    label: 'ChatGPT',
    url: 'https://chatgpt.com/',
    hostMatch: /(?:^|\.)(?:chatgpt\.com|chat\.openai\.com)$/i,
  },
  {
    id: 'grok',
    label: 'Grok',
    url: 'https://grok.com/',
    hostMatch: /(?:^|\.)grok\.com$|(?:^|\.)x\.com\/i\/grok/i,
  },
] as const;

const GLITCH_CHARS = '01X/#@%&*<>[]_~+=';

function scrambleGlitchLabel(text: string, progress: number): string {
  return text
    .split('')
    .map((ch, idx) => {
      if (ch === ' ') return ' ';
      if (progress > 0.78 && idx % 2 === 0) return ch;
      const code = (idx * 19 + Math.floor(progress * 47)) % GLITCH_CHARS.length;
      return GLITCH_CHARS[code] ?? ch;
    })
    .join('');
}

export function AutoThreeImageSender({
  record,
  customWord,
  originalText,
  language,
  enabled,
  onLocked,
  onPickNew,
  onAllLayersReadyChange,
}: AutoThreeImageSenderProps) {
  const t = getTranslations(language);
  const word = customWord.trim();
  const defaultSteps = useMemo(
    () => buildThreeImageSteps(record, word, language, { sourceMode: 'master-attached' }),
    [record, word, language]
  );
  const isArtwork = useMemo(() => isArtworkOrPhotoLikeCapture(record), [record]);

  const [splitMode, setSplitMode] = useState<SplitExecutionMode>('instant-1-prompt');
  // Honest run report: what the run is doing right now, how many AI prompts it has sent, and
  // (after a local split was rejected) why the AI had to be asked for more.
  const [runReport, setRunReport] = useState<RunReport>(EMPTY_RUN_REPORT);
  const runReportRef = useRef<RunReport>(EMPTY_RUN_REPORT);
  const updateRunReport = (patch: Partial<RunReport>) => {
    const next = { ...runReportRef.current, ...patch };
    runReportRef.current = next;
    setRunReport(next);
  };
  const countPromptSent = () => updateRunReport({ promptsUsed: runReportRef.current.promptsUsed + 1 });
  const [run, setRun] = useState<RunState>({ kind: 'idle' });
  const applyRun = setRun;
  // True when the AI answered the last run with a refusal instead of a picture
  const [aiDeclined, setAiDeclined] = useState(false);
  // Style accuracy: measured proportions of the ORIGINAL lettering (sent with prompt 1), and how
  // far the AI's lettering drifted from them (offered as a one-prompt "redraw closer" retry).
  const originalLetteringRef = useRef<LetteringMetrics | null>(null);
  const correctionPromptRef = useRef<string | null>(null);
  const [styleDrift, setStyleDrift] = useState<LetteringDrift | null>(null);
  const [assets, setAssets] = useState<SeparatedAssets>(EMPTY_ASSETS);
  const [fontViewMode, setFontViewMode] = useState<'transparent' | 'original'>('transparent');
  const [previewLayer, setPreviewLayer] = useState<'picture' | 'font' | 'background' | null>(null);
  const [previewGridLight, setPreviewGridLight] = useState<boolean>(true);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [copiedCodePrompt, setCopiedCodePrompt] = useState(false);
  const [bottomGlitch, setBottomGlitch] = useState<number | null>(null);

  const cancelRef = useRef(false);
  // Identifies the run the user most recently started. A run that is no longer the current one
  // (the word or picture changed, or a newer run began) must stop and must not touch the UI.
  const runGenRef = useRef(0);
  const runningRef = useRef(false);
  const assetsRef = useRef<SeparatedAssets>(EMPTY_ASSETS);
  const savedTimerRef = useRef<number | null>(null);
  const bottomGlitchTimerRef = useRef<number | null>(null);

  const [singleTarget, setSingleTarget] = useState<number | null>(null);
  const [singleState, setSingleState] = useState<ChatActionState>({ kind: 'idle' });
  const singleResetRef = useRef<number | null>(null);

  // Synchronously update `assetsRef.current` BEFORE queueing React state so sequential async
  // steps immediately read the latest extracted Master Image without React 18 batching lag!
  const updateAssets = (updater: (prev: SeparatedAssets) => SeparatedAssets) => {
    const next = updater(assetsRef.current);
    assetsRef.current = next;
    setAssets(next);
  };

  const handleBottomPickNewWithGlitch = () => {
    if (!onPickNew) return;
    if (bottomGlitchTimerRef.current !== null) {
      window.clearInterval(bottomGlitchTimerRef.current);
    }
    let tick = 0;
    const totalTicks = 7;
    setBottomGlitch(0);
    bottomGlitchTimerRef.current = window.setInterval(() => {
      tick += 1;
      if (tick >= totalTicks) {
        if (bottomGlitchTimerRef.current !== null) {
          window.clearInterval(bottomGlitchTimerRef.current);
          bottomGlitchTimerRef.current = null;
        }
        setBottomGlitch(null);
        onPickNew();
      } else {
        setBottomGlitch(tick / totalTicks);
      }
    }, 36);
  };

  // Always cancel any active run and reset layers when the capture or word changes
  useEffect(() => {
    cancelRef.current = true;
    runGenRef.current += 1;
    runningRef.current = false;
    runReportRef.current = EMPTY_RUN_REPORT;
    setRunReport(EMPTY_RUN_REPORT);
    setAiDeclined(false);
    setStyleDrift(null);
    originalLetteringRef.current = null;
    correctionPromptRef.current = null;
    setRun({ kind: 'idle' });
    assetsRef.current = EMPTY_ASSETS;
    setAssets(EMPTY_ASSETS);
    setFontViewMode('transparent');
    setPreviewLayer(null);
    setSingleTarget(null);
    setSingleState({ kind: 'idle' });
    setCopiedCodePrompt(false);
  }, [record.id, word]);

  useEffect(() => {
    return () => {
      cancelRef.current = true;
      if (singleResetRef.current !== null) window.clearTimeout(singleResetRef.current);
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
      if (bottomGlitchTimerRef.current !== null) window.clearInterval(bottomGlitchTimerRef.current);
    };
  }, []);

  const stepLabels = [t.runStepComposite, t.runStepText, t.runStepBg];
  const stepIcons = [ImageIcon, Type, Layers];

  const getOriginalImageDataUrl = async (): Promise<string> => {
    if (record.screenshotBlob.size === 0) return '';
    const png = await ensurePngBlob(record.screenshotBlob);
    return blobToDataUrl(png);
  };

  const flashSaved = (key: string) => {
    setSavedKey(key);
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => {
      setSavedKey((prev) => (prev === key ? null : prev));
      savedTimerRef.current = null;
    }, 1800);
  };

  /**
   * Runs the 0-token client-side X-Ray splitter on an extracted Master Image (`fullDataUrl`),
   * populating BOTH Card 2 (Transparent Font PNG + Vector `<path>` SVG) and Card 3 (Clean Background PNG)
   * in <120ms without spending extra AI tokens.
   */
  const tryInstantLocalSplitFromMaster = async (
    fullDataUrl: string,
    originalImageDataUrl: string,
    shouldAbort: () => boolean
  ): Promise<'full' | 'font-only' | 'failed' | 'aborted'> => {
    updateRunReport({ stage: 'checking' });
    const localSplit = await splitMasterImageLayersLocally(fullDataUrl, {
      targetWord: word,
      originalDataUrl: originalImageDataUrl,
      // Lettering over artwork: rebuild the hidden artwork with the bundled model on this device
      // instead of spending another AI prompt (and risking a refusal). If the model cannot run,
      // it returns null and the AI is asked as before.
      detectTextMask: (rgba, w, h) => detectTextOnDevice(rgba, w, h),
      inpaintOverArtwork: async (rgba, w, h, eraseMask) => {
        updateRunReport({ stage: 'rebuilding' });
        return rebuildBackgroundOnDevice(rgba, w, h, eraseMask);
      },
    });
    // The split (and the on-device model) can take a while: if the run was stopped or replaced
    // meanwhile, its layers belong to a different word and must not be stored or shown.
    if (shouldAbort()) return 'aborted';
    // Honesty gate: a layer is only stored (and shown as ready) when the splitter's own
    // self-check passed for it. A doubtful Font means both layers go to the AI; a good Font over
    // artwork that cannot be rebuilt locally keeps the Font and sends only the background.
    if (
      !localSplit.applied ||
      !localSplit.quality.fontOk ||
      !localSplit.fontTransparentDataUrl ||
      !localSplit.backgroundDataUrl
    ) {
      updateRunReport({ reasons: localSplit.quality.reasons });
      return 'failed';
    }
    const backgroundOk = localSplit.quality.backgroundOk;
    // Compare the AI's lettering with the original's measured proportions
    const original = originalLetteringRef.current;
    const generated = localSplit.letteringMetrics;
    if (original && generated && original.letterCount >= 2 && generated.letterCount >= 2) {
      const drift = compareLettering(original, generated);
      setStyleDrift(drift.issues.length > 0 ? drift : null);
    }
    updateRunReport({ reasons: localSplit.quality.reasons });
    updateAssets((prev) => ({
      ...prev,
      font: {
        rawDataUrl: localSplit.fontTransparentDataUrl,
        transparentDataUrl: localSplit.fontTransparentDataUrl,
        transparentApplied: true,
        backdropIsLight: localSplit.backdropIsLight,
        vectorSvg: localSplit.vectorSvg,
        splitLocally: true,
        width: localSplit.width,
        height: localSplit.height,
      },
      background: backgroundOk
        ? {
            dataUrl: localSplit.backgroundDataUrl,
            splitLocally: true,
            width: localSplit.width,
            height: localSplit.height,
          }
        : null,
    }));
    setFontViewMode('transparent');
    return backgroundOk ? 'full' : 'font-only';
  };

  /**
   * Extracts a finished step's raster PNG from the locked chat tab and populates the
   * Download Shelf immediately (running alpha-matting + vector `<path>` tracing on Step 1's font!).
   */
  const extractAndStoreStepLayer = async (
    layerIndex: number,
    descriptor: AssistantImageDescriptor | undefined,
    tabId: number,
    runToken?: string
  ): Promise<void> => {
    // `runToken` locks extraction to visuals mounted AFTER this step's paste: even the
    // "newest image on the page" retry below can never fall back to an older turn's image.
    let extracted = await extractAssistantChatImage({
      tabId,
      domId: descriptor?.domId,
      srcHint: descriptor?.src,
      runToken,
    });
    if (!extracted?.ok || !extracted.dataUrl) {
      await sleep(900);
      extracted = await extractAssistantChatImage({ tabId, runToken });
    }
    if (!extracted?.ok || !extracted.dataUrl) return;

    const fullDataUrl = extracted.dataUrl;
    const width = extracted.width || descriptor?.naturalWidth || 0;
    const height = extracted.height || descriptor?.naturalHeight || 0;

    if (layerIndex === 0) {
      const uploadDataUrl = await downscalePngDataUrlForUpload(fullDataUrl);
      // Always wipe font & background when storing a new Master Picture so stale layers from an
      // older run can NEVER appear alongside a newly extracted Master Picture!
      updateAssets(() => ({
        picture: { dataUrl: fullDataUrl, uploadDataUrl, width, height },
        font: null,
        background: null,
      }));
      return;
    }

    if (layerIndex === 1) {
      const matted = await extractTransparentWordmarkPng(fullDataUrl);
      const transparentUrl = matted.applied ? matted.dataUrl : fullDataUrl;
      const vectorSvg = matted.applied
        ? await traceTransparentWordmarkToVectorSvg(transparentUrl)
        : '';
      updateAssets((prev) => ({
        ...prev,
        font: {
          rawDataUrl: fullDataUrl,
          transparentDataUrl: transparentUrl,
          transparentApplied: matted.applied,
          backdropIsLight: matted.backdropIsLight,
          vectorSvg,
          splitLocally: false,
          width: matted.width || width,
          height: matted.height || height,
        },
      }));
      if (matted.applied) setFontViewMode('transparent');
      return;
    }

    if (layerIndex === 2) {
      updateAssets((prev) => ({
        ...prev,
        background: { dataUrl: fullDataUrl, splitLocally: false, width, height },
      }));
    }
  };

  const buildPayloadForLayer = (
    layerIndex: number,
    originalImageDataUrl: string,
    tabIsGrok: boolean,
    existingMasterInChat: boolean
  ): DynamicStepPayload => {
    if (layerIndex === 0) {
      return {
        prompt: (() => {
          // A "redraw closer to the original" retry sends its correction prompt once
          const correction = correctionPromptRef.current;
          correctionPromptRef.current = null;
          return correction ?? buildCompositeImagePrompt(
              record,
              word,
              language,
              originalLetteringRef.current,
              originalText
            );
        })(),
        imageDataUrl: originalImageDataUrl,
        requireImage: Boolean(originalImageDataUrl),
        fileName: 'stylelens-capture.png',
      };
    }

    const masterUploadUrl = assetsRef.current.picture?.uploadDataUrl ?? '';
    if (masterUploadUrl) {
      const mode: SeparationSourceMode = 'master-attached';
      return {
        prompt:
          layerIndex === 1
            ? buildTextOnlyImagePrompt(record, word, language, {
                sourceMode: mode,
                existingMasterInChat,
              })
            : buildBackgroundOnlyImagePrompt(record, language, word, {
                sourceMode: mode,
                existingMasterInChat,
              }),
        imageDataUrl: masterUploadUrl,
        requireImage: true,
        fileName: 'stylelens-master.png',
      };
    }

    // Grok NEVER supports blind zero-image follow-up edits — abort cleanly with actionable hint!
    if (tabIsGrok) {
      return {
        prompt: '',
        abortReason: 'GROK_REQUIRES_MASTER_IMAGE',
      };
    }

    // Gemini / ChatGPT fallback when Master pixels couldn't be extracted: reference thread composite
    const mode: SeparationSourceMode = 'master-thread';
    return {
      prompt:
        layerIndex === 1
          ? buildTextOnlyImagePrompt(record, word, language, {
              sourceMode: mode,
              existingMasterInChat,
            })
          : buildBackgroundOnlyImagePrompt(record, language, word, {
              sourceMode: mode,
              existingMasterInChat,
            }),
      imageDataUrl: '',
      requireImage: false,
    };
  };

  const runLayeredFlow = async (opts?: {
    startIndex?: number;
    skipHostWarning?: boolean;
    continueOnNoImage?: boolean;
    existingMaster?: { tabId: number; picture: ExtractedPictureLayer };
    singleLayerRetryIndex?: 1 | 2;
    alreadyLocked?: boolean;
    forceMode?: SplitExecutionMode;
    /** Chat tab an automatic follow-up must stay on (never "whatever tab is active now"). */
    lockedTabId?: number;
  }) => {
    if (!enabled) {
      if (opts?.alreadyLocked) runningRef.current = false;
      onLocked();
      return;
    }
    if (runningRef.current && !opts?.alreadyLocked) return;
    runningRef.current = true;
    if (!opts?.alreadyLocked) runGenRef.current += 1;
    const runGen = runGenRef.current;
    const isStale = () => runGenRef.current !== runGen;
    const isCancelled = () => cancelRef.current || isStale();
    // A run that has been replaced must never repaint the panel over the newer run
    const setRun = (next: RunState) => {
      if (!isStale()) applyRun(next);
    };

    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        setRun({
          kind: 'finished',
          phases: ['failed', 'waiting', 'waiting'],
          outcome: { status: 'no-chat' },
        });
        return;
      }

      const activeTab = await getActiveTabInfo();
      const hostInfo = classifyActiveChatUrl(activeTab?.url);
      const tabIsGrok = isGrokChatUrl(activeTab?.url);

      if (!opts?.skipHostWarning) {
        if (hostInfo.kind === 'non-ai') {
          setRun({
            kind: 'finished',
            phases: ['waiting', 'waiting', 'waiting'],
            outcome: { status: 'no-chat', reason: 'NO_CHAT_INPUT' },
          });
          return;
        }
        if (hostInfo.kind === 'text-only-ai') {
          setRun({ kind: 'text-only-preflight', aiName: hostInfo.label ?? hostInfo.hostname });
          return;
        }
      }

      const effectiveMode = opts?.forceMode ?? splitMode;
      const existingMasterInChat = Boolean(opts?.existingMaster);
      const startIndex = opts?.existingMaster ? 1 : (opts?.startIndex ?? 0);

      // Reset stale layers ONLY when starting fresh from Step 0
      if (startIndex === 0 && opts?.singleLayerRetryIndex === undefined) {
        assetsRef.current = EMPTY_ASSETS;
        setAssets(EMPTY_ASSETS);
      }
      // A run the user started (not an automatic fallback continuing one) begins a new report
      if (!opts?.alreadyLocked && opts?.singleLayerRetryIndex !== undefined) {
        // A manual one-layer AI refine is not a full run: no prompt-count line for it
        updateRunReport(EMPTY_RUN_REPORT);
      } else if (!opts?.alreadyLocked) {
        updateRunReport({
          ...EMPTY_RUN_REPORT,
          stage: effectiveMode === 'instant-1-prompt' && startIndex === 0 ? 'making' : 'ai-deep',
          route: effectiveMode === 'instant-1-prompt' && startIndex === 0 ? null : 'ai-deep',
        });
      }

      // Only a run the user started clears a previous Stop; an automatic follow-up must not
      if (!opts?.alreadyLocked) {
        cancelRef.current = false;
        setAiDeclined(false);
      }

      const originalImageDataUrl = await getOriginalImageDataUrl().catch(() => '');
      if (isCancelled()) return;
      // Measure the original lettering once per fresh run (about a second, on this device)
      if (startIndex === 0 && opts?.singleLayerRetryIndex === undefined) {
        setStyleDrift(null);
        originalLetteringRef.current = await measureLetteringFromDataUrl(originalImageDataUrl);
        if (isCancelled()) return;
      }

      // 1. Single-layer targeted AI Refine / Retry (e.g., upgrade ONLY Card 2 or Card 3 via AI!)
      if (opts?.singleLayerRetryIndex !== undefined) {
        const targetIdx = opts.singleLayerRetryIndex;
        let phases: StepPhase[] = [
          assetsRef.current.picture ? 'done' : 'no-image',
          targetIdx === 1 ? 'waiting' : assetsRef.current.font ? 'done' : 'no-image',
          targetIdx === 2 ? 'waiting' : assetsRef.current.background ? 'done' : 'no-image',
        ];
        setRun({ kind: 'running', phases });

        const retryStep = defaultSteps[targetIdx]!;
        const outcome = await runThreeImageSequence([retryStep], {
          initialTabId: opts.lockedTabId ?? activeTab?.id,
          requireImage: false,
          getStepPayload: () =>
            buildPayloadForLayer(targetIdx, originalImageDataUrl, tabIsGrok, true),
          paste: (prompt, tabId, requireImage, imageOverride, fileName) =>
            chrome.runtime.sendMessage({
              type: 'STYLELENS_PASTE_TO_ACTIVE_CHAT',
              imageDataUrl: imageOverride ?? '',
              promptText: prompt,
              tabId,
              requireImage,
              fileName,
            }) as Promise<PasteToChatResponse | undefined>,
          submit: (tabId) => {
            countPromptSent();
            return chrome.runtime.sendMessage({ type: 'STYLELENS_CHAT_SUBMIT', tabId }) as Promise<
              ChatSubmitResponse | undefined
            >;
          },
          probe: (tabId, runToken) =>
            chrome.runtime.sendMessage({
              type: 'STYLELENS_CHAT_PROBE',
              tabId,
              runToken,
            }) as Promise<ChatProbeResponse | undefined>,
          onStepImageDetected: async (_idx, descriptor, tabId, runToken) => {
            await extractAndStoreStepLayer(targetIdx, descriptor, tabId, runToken);
          },
          onAiDeclined: () => setAiDeclined(true),
          sleep,
          now: () => Date.now(),
          isCancelled,
          onProgress: (_idx, phase) => {
            phases = phases.map((p, idx) => (idx === targetIdx ? phase : p));
            setRun({ kind: 'running', phases });
          },
        });

        const totalReady = [
          assetsRef.current.picture,
          assetsRef.current.font,
          assetsRef.current.background,
        ].filter(Boolean).length;

        let copiedPngFallback = false;
        if (outcome.status === 'failed' && outcome.reason === 'IMAGE_NOT_ATTACHED') {
          copiedPngFallback = await copyCapturePngToClipboard(
            record,
            assetsRef.current.picture?.uploadDataUrl
          );
        }

        const finalOutcome: RunOutcome =
          outcome.status === 'complete' || outcome.status === 'partial'
            ? totalReady >= 3
              ? { status: 'complete', imagesProduced: 3 }
              : { status: 'partial', imagesProduced: totalReady, totalSteps: 3 }
            : outcome;

        setRun({ kind: 'finished', phases, outcome: finalOutcome, copiedPngFallback });
        return;
      }

      // 2. AUTO MODE: 1 prompt, then the free on-device split; the AI is asked for more only when
      //    the split fails its self-check (so the saving applies to pictures that pass, not all).
      if (effectiveMode === 'instant-1-prompt' && startIndex === 0) {
        let phases: StepPhase[] = ['waiting', 'waiting', 'waiting'];
        setRun({ kind: 'running', phases });

        const step0Only = [defaultSteps[0]!];
        let step0RunToken: string | undefined;
        let step0TabId: number | undefined;
        const outcome = await runThreeImageSequence(step0Only, {
          initialTabId: activeTab?.id,
          getStepPayload: () =>
            buildPayloadForLayer(0, originalImageDataUrl, tabIsGrok, false),
          paste: (prompt, tabId, requireImage, imageOverride, fileName) =>
            chrome.runtime.sendMessage({
              type: 'STYLELENS_PASTE_TO_ACTIVE_CHAT',
              imageDataUrl: imageOverride ?? originalImageDataUrl,
              promptText: prompt,
              tabId,
              requireImage,
              fileName,
            }) as Promise<PasteToChatResponse | undefined>,
          submit: (tabId) => {
            countPromptSent();
            return chrome.runtime.sendMessage({ type: 'STYLELENS_CHAT_SUBMIT', tabId }) as Promise<
              ChatSubmitResponse | undefined
            >;
          },
          probe: (tabId, runToken) =>
            chrome.runtime.sendMessage({
              type: 'STYLELENS_CHAT_PROBE',
              tabId,
              runToken,
            }) as Promise<ChatProbeResponse | undefined>,
          onStepImageDetected: async (_idx, descriptor, tabId, runToken) => {
            step0RunToken = runToken;
            step0TabId = tabId;
            await extractAndStoreStepLayer(0, descriptor, tabId, runToken);
          },
          onAiDeclined: () => setAiDeclined(true),
          sleep,
          now: () => Date.now(),
          isCancelled,
          onProgress: (_idx, phase) => {
            phases = [phase, phases[1]!, phases[2]!];
            setRun({ kind: 'running', phases });
          },
        });

        // Late retry stays locked to the SAME chat tab and the SAME run token, so it can only
        // ever pick up this run's new image — never an older picture sitting in the thread.
        const retryTabId = step0TabId ?? activeTab?.id;
        if (outcome.status === 'complete' && !assetsRef.current.picture && retryTabId !== undefined) {
          await extractAndStoreStepLayer(0, undefined, retryTabId, step0RunToken);
        }

        if (outcome.status === 'complete' && assetsRef.current.picture) {
          phases = ['done', 'extracting', 'extracting'];
          setRun({ kind: 'running', phases });
          const splitVerdict = await tryInstantLocalSplitFromMaster(
            assetsRef.current.picture.dataUrl,
            originalImageDataUrl,
            isCancelled
          );
          if (isStale()) return;
          if (splitVerdict === 'aborted' || cancelRef.current) {
            // Stopped while splitting: the Full Picture is ready, the other two are not
            const stoppedPhases: StepPhase[] = ['done', 'no-image', 'no-image'];
            setRun({
              kind: 'finished',
              phases: stoppedPhases,
              outcome: { status: 'partial', imagesProduced: 1, totalSteps: 3 },
            });
            return;
          }
          if (splitVerdict === 'full') {
            updateRunReport({ stage: 'idle', route: 'local' });
            const donePhases: StepPhase[] = ['done', 'done', 'done'];
            setRun({
              kind: 'finished',
              phases: donePhases,
              outcome: { status: 'complete', imagesProduced: 3 },
            });
            return;
          }
          const fallbackTabId = step0TabId ?? activeTab?.id;
          if (splitVerdict === 'font-only') {
            // Lettering lay across artwork: the Font is good, but the hidden artwork can only be
            // redrawn by the AI. Fetch ONLY the Clean Background (1 extra prompt, not 2).
            updateRunReport({ stage: 'ai-background', route: 'ai-background' });
            await runLayeredFlow({
              skipHostWarning: true,
              alreadyLocked: true,
              singleLayerRetryIndex: 2,
              lockedTabId: fallbackTabId,
            });
            return;
          }
          // The local split failed its self-check: never show it as ready. Get the Font and the
          // Clean Background from the AI, reusing the Master Picture already in the chat.
          if (fallbackTabId !== undefined) {
            updateRunReport({ stage: 'ai-both', route: 'ai-both' });
            await runLayeredFlow({
              skipHostWarning: true,
              alreadyLocked: true,
              forceMode: 'deep-3-prompt',
              existingMaster: { tabId: fallbackTabId, picture: assetsRef.current.picture },
            });
            return;
          }
          const partialPhases: StepPhase[] = ['done', 'no-image', 'no-image'];
          setRun({
            kind: 'finished',
            phases: partialPhases,
            outcome: { status: 'partial', imagesProduced: 1, totalSteps: 3 },
          });
          return;
        }

        // If Step 0 finished with 0 images (or extraction failed), surface the standard paused-no-image recovery bar
        if (
          (outcome.status === 'partial' && outcome.imagesProduced === 0) ||
          (outcome.status === 'complete' && !assetsRef.current.picture)
        ) {
          const pausedPhases: StepPhase[] = ['no-image', 'waiting', 'waiting'];
          setRun({
            kind: 'finished',
            phases: pausedPhases,
            outcome: {
              status: 'paused-no-image',
              stepIndex: 0,
              imagesProduced: 0,
              totalSteps: 3,
            },
          });
          return;
        }

        let copiedPngFallback = false;
        if (outcome.status === 'failed' && outcome.reason === 'IMAGE_NOT_ATTACHED') {
          copiedPngFallback = await copyCapturePngToClipboard(record);
        }
        setRun({ kind: 'finished', phases, outcome, copiedPngFallback });
        return;
      }

      // 3. Full 3-Step AI Deep Split (0 -> 1 -> 2) OR Existing-Master AI Deep Separation (1 -> 2)
      let phases: StepPhase[] = defaultSteps.map((_, idx) => {
        if (opts?.existingMaster && idx === 0) return 'done';
        if (idx < startIndex) return assetsRef.current.picture && idx === 0 ? 'done' : 'no-image';
        return 'waiting';
      });
      setRun({ kind: 'running', phases });

      const initialImagesProduced = opts?.existingMaster
        ? 1
        : startIndex > 0 && assetsRef.current.picture
          ? 1
          : 0;

      const outcome = await runThreeImageSequence(defaultSteps, {
        initialTabId: opts?.existingMaster?.tabId,
        initialImagesProduced,
        startIndex,
        continueOnNoImage: opts?.continueOnNoImage || Boolean(opts?.existingMaster),
        getStepPayload: (stepIndex) =>
          buildPayloadForLayer(stepIndex, originalImageDataUrl, tabIsGrok, existingMasterInChat),
        paste: (prompt, tabId, requireImage, imageOverride, fileName) =>
          chrome.runtime.sendMessage({
            type: 'STYLELENS_PASTE_TO_ACTIVE_CHAT',
            imageDataUrl: imageOverride ?? originalImageDataUrl,
            promptText: prompt,
            tabId,
            requireImage,
            fileName,
          }) as Promise<PasteToChatResponse | undefined>,
        submit: (tabId) => {
          countPromptSent();
          return chrome.runtime.sendMessage({ type: 'STYLELENS_CHAT_SUBMIT', tabId }) as Promise<
            ChatSubmitResponse | undefined
          >;
        },
        probe: (tabId, runToken) =>
          chrome.runtime.sendMessage({
            type: 'STYLELENS_CHAT_PROBE',
            tabId,
            runToken,
          }) as Promise<ChatProbeResponse | undefined>,
        onStepImageDetected: async (stepIndex, descriptor, tabId, runToken) => {
          await extractAndStoreStepLayer(stepIndex, descriptor, tabId, runToken);
        },
        onAiDeclined: () => setAiDeclined(true),
        sleep,
        now: () => Date.now(),
        isCancelled,
        onProgress: (index, phase) => {
          phases = phases.map((p, i) => (i === index ? phase : p));
          setRun({ kind: 'running', phases });
        },
      });

      let copiedPngFallback = false;
      if (outcome.status === 'failed' && outcome.reason === 'IMAGE_NOT_ATTACHED') {
        const attachUrl =
          outcome.stepIndex > 0 ? assetsRef.current.picture?.uploadDataUrl : undefined;
        copiedPngFallback = await copyCapturePngToClipboard(record, attachUrl);
      }
      if (isStale()) return;
      setRun({ kind: 'finished', phases, outcome, copiedPngFallback });
    } catch {
      // Never leave the panel stuck on "running" if something unexpected throws
      if (!isStale()) {
        setRun({
          kind: 'finished',
          phases: ['failed', 'waiting', 'waiting'],
          outcome: { status: 'failed', stepIndex: 0, reason: 'UNEXPECTED_ERROR' },
        });
      }
    } finally {
      if (!isStale()) runningRef.current = false;
    }
  };

  /**
   * 1-Click "Separate Image Already in Chat": pulls the finished Master Image already sitting
   * in Gemini/ChatGPT/Grok into Card 1. In `instant-1-prompt` mode, splits Font + Vector SVG +
   * Clean Background locally in <120ms with ZERO AI prompts (falling back to AI Deep Split if complex)!
   */
  const handleSeparateExistingChatImage = async () => {
    if (!enabled) {
      onLocked();
      return;
    }
    if (runningRef.current) return;
    runningRef.current = true;
    runGenRef.current += 1;
    const runGen = runGenRef.current;
    const isStale = () => runGenRef.current !== runGen;
    cancelRef.current = false;
    updateRunReport({ ...EMPTY_RUN_REPORT, stage: 'checking' });
    let handedOff = false;

    try {
      const activeTab = await getActiveTabInfo();
      const hostInfo = classifyActiveChatUrl(activeTab?.url);
      if (hostInfo.kind === 'non-ai') {
        setRun({ kind: 'existing-not-found' });
        return;
      }
      if (hostInfo.kind === 'text-only-ai') {
        setRun({ kind: 'text-only-preflight', aiName: hostInfo.label ?? hostInfo.hostname });
        return;
      }

      setRun({ kind: 'scanning-existing' });
      const extracted = await extractAssistantChatImage({ tabId: activeTab?.id });
      if (!extracted?.ok || !extracted.dataUrl || typeof extracted.tabId !== 'number') {
        setRun({ kind: 'existing-not-found' });
        return;
      }

      const uploadDataUrl = await downscalePngDataUrlForUpload(extracted.dataUrl);
      const pictureLayer: ExtractedPictureLayer = {
        dataUrl: extracted.dataUrl,
        uploadDataUrl,
        width: extracted.width || 0,
        height: extracted.height || 0,
      };

      const nextAssets: SeparatedAssets = {
        picture: pictureLayer,
        font: null,
        background: null,
      };
      assetsRef.current = nextAssets;
      setAssets(nextAssets);

      if (splitMode === 'instant-1-prompt') {
        const originalImageDataUrl = await getOriginalImageDataUrl().catch(() => '');
        const splitVerdict = await tryInstantLocalSplitFromMaster(
          extracted.dataUrl,
          originalImageDataUrl,
          () => cancelRef.current || isStale()
        );
        if (isStale()) return;
        if (splitVerdict === 'aborted') {
          setRun({
            kind: 'finished',
            phases: ['done', 'no-image', 'no-image'],
            outcome: { status: 'partial', imagesProduced: 1, totalSteps: 3 },
          });
          return;
        }
        if (splitVerdict === 'full') {
          updateRunReport({ stage: 'idle', route: 'local' });
          setRun({
            kind: 'finished',
            phases: ['done', 'done', 'done'],
            outcome: { status: 'complete', imagesProduced: 3 },
          });
          return;
        }
        if (splitVerdict === 'font-only') {
          handedOff = true;
          updateRunReport({ stage: 'ai-background', route: 'ai-background' });
          await runLayeredFlow({
            skipHostWarning: true,
            alreadyLocked: true,
            singleLayerRetryIndex: 2,
            lockedTabId: extracted.tabId,
          });
          return;
        }
      }

      handedOff = true;
      await runLayeredFlow({
        skipHostWarning: true,
        alreadyLocked: true,
        forceMode: 'deep-3-prompt',
        existingMaster: { tabId: extracted.tabId, picture: pictureLayer },
      });
    } catch {
      if (!isStale()) applyRun({ kind: 'existing-not-found' });
    } finally {
      if (!handedOff && !isStale()) {
        runningRef.current = false;
      }
    }
  };

  const stopRun = () => {
    cancelRef.current = true;
  };

  const handleCopyCodePrompt = async () => {
    try {
      await navigator.clipboard.writeText(generateCompleteAgentPrompt(record, word, language));
      setCopiedCodePrompt(true);
      window.setTimeout(() => setCopiedCodePrompt(false), 2200);
    } catch {
      // ignore clipboard errors
    }
  };

  const sendSingle = async (index: number) => {
    if (!enabled) {
      onLocked();
      return;
    }
    if (runningRef.current) return;
    if (singleResetRef.current !== null) {
      window.clearTimeout(singleResetRef.current);
      singleResetRef.current = null;
    }

    const hasMaster = Boolean(assetsRef.current.picture?.uploadDataUrl);
    const promptForIndex =
      index === 0
        ? buildCompositeImagePrompt(record, word, language)
        : index === 1
          ? buildTextOnlyImagePrompt(record, word, language, {
              sourceMode: hasMaster ? 'master-attached' : 'original-attached',
            })
          : buildBackgroundOnlyImagePrompt(record, language, word, {
              sourceMode: hasMaster ? 'master-attached' : 'original-attached',
            });

    const current: ChatActionState = singleTarget === index ? singleState : { kind: 'idle' };
    setSingleTarget(index);
    if (current.kind === 'idle') setSingleState({ kind: 'sending' });
    const { nextState, autoResetMs } = await executeSendOrCopyBoth(
      record,
      promptForIndex,
      current,
      async () => {
        await downloadBlob(record.screenshotBlob, `stylelens-${record.page.hostname}.png`);
      },
      index > 0 && hasMaster
        ? {
            imageDataUrlOverride: assetsRef.current.picture?.uploadDataUrl,
            fileName: 'stylelens-master.png',
          }
        : { fileName: 'stylelens-capture.png' }
    );
    setSingleState(nextState);
    if (autoResetMs) {
      singleResetRef.current = window.setTimeout(() => {
        setSingleState({ kind: 'idle' });
        singleResetRef.current = null;
      }, autoResetMs);
    }
  };

  const fileSlug = slugifyFilenamePart(word || record.page.hostname, 'stylelens');

  const handleDownloadPicture = async () => {
    if (!assets.picture) return;
    const ok = await downloadDataUrlPng(assets.picture.dataUrl, `${fileSlug}-picture.png`);
    if (ok) flashSaved('pic');
  };

  const handleDownloadFont = async () => {
    if (!assets.font) return;
    const useTransparent = assets.font.transparentApplied && fontViewMode === 'transparent';
    const url = useTransparent ? assets.font.transparentDataUrl : assets.font.rawDataUrl;
    const suffix = useTransparent ? 'font.png' : 'font-solid.png';
    const ok = await downloadDataUrlPng(url, `${fileSlug}-${suffix}`);
    if (ok) flashSaved('font');
  };

  const handleDownloadFontVectorSvg = async () => {
    if (!assets.font?.vectorSvg) return;
    const ok = await downloadText(
      assets.font.vectorSvg,
      `${fileSlug}-font-vector.svg`,
      'image/svg+xml'
    );
    if (ok) flashSaved('font-svg');
  };

  const handleCopyFontVectorSvg = async () => {
    if (!assets.font?.vectorSvg) return;
    try {
      await navigator.clipboard.writeText(assets.font.vectorSvg);
      flashSaved('font-copy-svg');
    } catch {
      await handleDownloadFontVectorSvg();
    }
  };

  const handleDownloadBackground = async () => {
    if (!assets.background) return;
    const ok = await downloadDataUrlPng(assets.background.dataUrl, `${fileSlug}-background.png`);
    if (ok) flashSaved('bg');
  };

  const handleDownloadAll = async () => {
    const queue: Array<{ url: string; name: string }> = [];
    if (assets.picture) {
      queue.push({ url: assets.picture.dataUrl, name: `${fileSlug}-picture.png` });
    }
    if (assets.font) {
      const useTransparent = assets.font.transparentApplied && fontViewMode === 'transparent';
      queue.push({
        url: useTransparent ? assets.font.transparentDataUrl : assets.font.rawDataUrl,
        name: `${fileSlug}-${useTransparent ? 'font.png' : 'font-solid.png'}`,
      });
    }
    if (assets.background) {
      queue.push({ url: assets.background.dataUrl, name: `${fileSlug}-background.png` });
    }
    if (queue.length === 0) return;

    let anyOk = false;
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]!;
      const ok = await downloadDataUrlPng(item.url, item.name);
      if (ok) anyOk = true;
      if (i < queue.length - 1) await sleep(250);
    }
    if (anyOk) flashSaved('all');
  };

  const singleLabel = (index: number, idleText: string): string => {
    if (singleTarget !== index) return idleText;
    const s = singleState;
    if (s.kind === 'sending') return t.compactSending;
    if (s.kind === 'sent-both') return t.compactPastedPressSend;
    if (s.kind === 'sent-prompt-only') return t.compactPromptInBoxPasteImg;
    if (s.kind === 'awaiting-prompt') return t.compactCopyStep2;
    if (s.kind === 'awaiting-image') return t.compactCopyImg2;
    if (s.kind !== 'idle') return t.compactPasteNow;
    return idleText;
  };

  const phaseText = (phase: StepPhase): string => {
    switch (phase) {
      case 'pasting':
        return t.runPhasePasting;
      case 'sending':
        return t.runPhaseSending;
      case 'needs-manual-send':
        return t.runPhaseManual;
      case 'generating':
        return t.runPhaseGenerating;
      case 'extracting':
        return t.runPhaseExtracting;
      case 'done':
        return t.runPhaseDone;
      case 'no-image':
        return t.runPhaseNoImage;
      case 'failed':
        return t.runPhaseFailed;
      default:
        return t.runPhaseWaiting;
    }
  };

  const renderQuickImageAiButtons = () => (
    <div className="grid grid-cols-3 gap-1.5 pt-1">
      {QUICK_IMAGE_AIS.map((ai) => (
        <button
          key={ai.id}
          type="button"
          onClick={() => void openOrFocusAiChat(ai.url, ai.hostMatch)}
          className="sl-btn-carbon rounded-lg px-2 py-1.5 text-[11.5px] font-semibold text-white transition hover:border-white/45"
        >
          {ai.label}
        </button>
      ))}
    </div>
  );

  const isRunning = run.kind === 'running' || run.kind === 'scanning-existing';
  const phases = run.kind === 'running' || run.kind === 'finished' ? run.phases : null;
  const readyCount = [assets.picture, assets.font, assets.background].filter(Boolean).length;
  const allLayersReady = readyCount === 3;
  useEffect(() => {
    onAllLayersReadyChange?.(allLayersReady);
  }, [allLayersReady, onAllLayersReadyChange]);
  const showShelf = readyCount > 0;

  return (
    <div className="space-y-2.5">
      {/* Mode switch: a two-position slider, deliberately NOT pure white, so it reads as a setting
          you flip rather than an action button. A soft silver thumb slides to the chosen side. */}
      <div
        className="sl-mode-switch relative grid grid-cols-2 rounded-xl p-1"
        role="radiogroup"
        aria-label="Split mode"
      >
        <span
          aria-hidden="true"
          className={`sl-mode-thumb ${splitMode === 'deep-3-prompt' ? 'sl-mode-thumb--right' : ''}`}
        />
        <button
          type="button"
          role="radio"
          aria-checked={splitMode === 'instant-1-prompt'}
          aria-label={t.splitModeInstantAria}
          disabled={isRunning}
          onClick={() => setSplitMode('instant-1-prompt')}
          className={`relative z-[1] flex flex-col items-center justify-center rounded-lg px-2 py-1.5 text-center transition-colors duration-200 disabled:opacity-50 ${
            splitMode === 'instant-1-prompt' ? 'text-[#111114]' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span className="flex items-center gap-1 text-[11.5px] font-semibold">
            <Zap className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {t.splitModeInstantTitle}
              <span className="sl-plus-glitch" aria-hidden="true">
                +
              </span>{' '}
              {t.splitModeInstantUnit}
            </span>
          </span>
          <span
            className={`text-[9.5px] font-medium ${
              splitMode === 'instant-1-prompt' ? 'text-emerald-800' : 'text-emerald-300/70'
            }`}
          >
            {t.splitModeInstantBadge}
          </span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={splitMode === 'deep-3-prompt'}
          disabled={isRunning}
          onClick={() => setSplitMode('deep-3-prompt')}
          className={`relative z-[1] flex flex-col items-center justify-center rounded-lg px-2 py-1.5 text-center transition-colors duration-200 disabled:opacity-50 ${
            splitMode === 'deep-3-prompt' ? 'text-[#111114]' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span className="flex items-center gap-1 text-[11.5px] font-semibold">
            <Sparkles className="h-3 w-3 shrink-0" />
            <span className="truncate">{t.splitModeDeepTitle}</span>
          </span>
          <span
            className={`text-[9.5px] font-medium ${
              splitMode === 'deep-3-prompt' ? 'text-zinc-600' : 'text-zinc-500'
            }`}
          >
            {t.splitModeDeepBadge}
          </span>
        </button>
      </div>
      {/* Primary CTA: Create Master Picture once -> Separate Font + Clean Background */}
      <button
        type="button"
        onClick={() => {
          // If Card 1 is already ready after a partial 1/3 or 2/3 run, resume missing separation steps
          // instead of wiping Card 1 and regenerating Step 1 from scratch!
          if (
            run.kind === 'finished' &&
            run.outcome.status === 'partial' &&
            assetsRef.current.picture &&
            (!assetsRef.current.font || !assetsRef.current.background)
          ) {
            if (assetsRef.current.font && !assetsRef.current.background) {
              void runLayeredFlow({ skipHostWarning: true, singleLayerRetryIndex: 2 });
            } else if (!assetsRef.current.font && assetsRef.current.background) {
              void runLayeredFlow({ skipHostWarning: true, singleLayerRetryIndex: 1 });
            } else {
              void runLayeredFlow({
                startIndex: 1,
                continueOnNoImage: true,
                skipHostWarning: true,
                forceMode: 'deep-3-prompt',
              });
            }
            return;
          }
          void runLayeredFlow();
        }}
        disabled={isRunning}
        aria-disabled={!enabled || isRunning}
        className={`flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[14px] font-semibold transition disabled:cursor-not-allowed ${
          !enabled
            ? 'cursor-pointer border border-white/15 bg-white/10 text-zinc-300 hover:border-white/35'
            : run.kind === 'finished' && run.outcome.status === 'complete'
              ? 'border border-emerald-300/70 bg-emerald-200 text-black'
              : run.kind === 'finished' &&
                  (run.outcome.status === 'partial' || run.outcome.status === 'paused-no-image')
                ? 'border border-amber-300/80 bg-gradient-to-r from-amber-200 via-amber-100 to-white text-black'
                : `sl-btn-white ${enabled && run.kind === 'idle' ? 'sl-cue' : ''}`
        }`}
      >
        {run.kind === 'running' ? (
          <>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span>{runReport.stage === 'idle' ? t.runInProgress : t.runStage(runReport.stage)}</span>
          </>
        ) : run.kind === 'finished' && run.outcome.status === 'complete' ? (
          <>
            <Check className="h-4 w-4 shrink-0" />
            <span>{t.runComplete}</span>
          </>
        ) : run.kind === 'finished' &&
          (run.outcome.status === 'partial' || run.outcome.status === 'paused-no-image') ? (
          <>
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{t.runPartialBtn(run.outcome.imagesProduced, run.outcome.totalSteps)}</span>
          </>
        ) : (
          <>
            <Send className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {word ? t.makeThreeImages(word.slice(0, 18)) : t.sendToAiChat}
            </span>
          </>
        )}
      </button>

      {/* Honest run report: how many AI prompts this run used and, if the free on-device split
          was not good enough, why the AI was asked for more. */}
      {run.kind === 'finished' && run.outcome.status === 'complete' && runReport.route && (
        <p
          data-testid="sl-run-report"
          className="px-1 text-center text-[11px] leading-snug text-zinc-400"
        >
          {t.runUsedPrompts(runReport.promptsUsed, runReport.route)}
          {runReport.route !== 'local' && runReport.route !== 'ai-deep' && runReport.reasons[0]
            ? ` ${t.runFallbackReason(runReport.reasons[0])}`
            : ''}
        </p>
      )}

      {/* Style drift: the AI drew the lettering clearly bigger / narrower / thinner than the
          original. Say what is off and offer one corrective prompt; never send it unasked. */}
      {styleDrift && !isRunning && run.kind === 'finished' && originalLetteringRef.current && (
        <div
          data-testid="sl-style-drift"
          className="space-y-1.5 rounded-lg border border-amber-300/25 bg-amber-300/[0.06] px-2.5 py-2"
        >
          <p className="text-[11.5px] leading-snug text-amber-100">
            {t.styleDriftNotice(styleDrift.issues, styleDrift.sizeRatio)}
          </p>
          <button
            type="button"
            onClick={() => {
              const original = originalLetteringRef.current;
              if (!original || !styleDrift) return;
              correctionPromptRef.current = buildStyleCorrectionPrompt(word, styleDrift, original);
              void runLayeredFlow();
            }}
            className="sl-btn-carbon flex w-full items-center justify-center rounded-md py-1.5 text-[12px] font-semibold text-white"
          >
            {t.styleDriftRetry}
          </button>
        </div>
      )}

      {run.kind === 'finished' && (
        <p className="px-1 text-center text-[10.5px] leading-snug text-zinc-500">{t.mistakesNote}</p>
      )}

      {/* Calm Secondary 1-Click Action: Separate an AI image ALREADY sitting in chat (hidden once all 3 layers are ready to keep UI minimal!) */}
      {readyCount < 3 && (
        <button
          type="button"
          onClick={() => void handleSeparateExistingChatImage()}
          disabled={isRunning}
          aria-disabled={!enabled || isRunning}
          className="sl-btn-carbon flex w-full items-center justify-center gap-2 rounded-xl border-white/20 py-2 text-[12px] font-semibold text-white transition hover:border-white/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {run.kind === 'scanning-existing' ? (
            <>
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span>{t.separateExistingScanning}</span>
            </>
          ) : (
            <>
              <Scissors className="h-3.5 w-3.5 shrink-0 text-white" />
              <span>{t.separateExistingBtn}</span>
            </>
          )}
        </button>
      )}

      {run.kind === 'existing-not-found' && (
        <div className="sl-card space-y-2 rounded-xl border-amber-300/35 p-2.5" aria-live="polite">
          <p className="text-[11.5px] font-medium leading-snug text-amber-200">
            {t.separateExistingNotFound}
          </p>
          {renderQuickImageAiButtons()}
        </div>
      )}

      {/* 0ms Pre-Flight Card when active tab is a text/code-only AI (Claude, DeepSeek, Kimi, Perplexity) */}
      {run.kind === 'text-only-preflight' && (
        <div
          className="sl-card space-y-2 rounded-xl border-amber-300/35 p-2.5"
          aria-live="polite"
        >
          <p className="text-[11.5px] font-medium leading-snug text-amber-200">
            {t.runTextOnlyAiNotice(run.aiName)}
          </p>
          {renderQuickImageAiButtons()}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {!isArtwork && (
              <button
                type="button"
                onClick={() => void handleCopyCodePrompt()}
                className="sl-btn-carbon inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-white"
              >
                {copiedCodePrompt ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-300" />
                    <span>{t.runCopiedCodePrompt}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>{t.runCopyCodePrompt}</span>
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => void runLayeredFlow({ skipHostWarning: true })}
              className="text-[11px] text-zinc-400 underline decoration-zinc-600 underline-offset-2 transition hover:text-white"
            >
              {t.runTryHereAnyway}
            </button>
          </div>
        </div>
      )}

      {/* Minimalist Zero-Scroll 3-Row Download Shelf (Picture / Transparent Font + Vector SVG / Clean Background) */}
      {showShelf && (
        <div className="sl-card space-y-2 rounded-xl border-white/25 p-2.5" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-white">
              {t.shelfTitle} ({readyCount}/3)
            </span>
            {readyCount >= 2 && (
              <button
                type="button"
                onClick={() => void handleDownloadAll()}
                className="sl-btn-white inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition"
              >
                {savedKey === 'all' ? (
                  <>
                    <Check className="h-3 w-3" />
                    <span>{t.shelfDownloadedAll}</span>
                  </>
                ) : (
                  <>
                    <Download className="h-3 w-3" />
                    <span>{t.shelfDownloadAll(readyCount)}</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            {/* Row 1: Full Picture */}
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0b0b0f] px-2 py-1.5">
              <button
                type="button"
                disabled={!assets.picture}
                onClick={() => {
                  if (!assets.picture) return;
                  setPreviewLayer((prev) => (prev === 'picture' ? null : 'picture'));
                }}
                title={t.shelfPreviewBtn}
                className="sl-checkerboard flex h-[38px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded border border-white/15 transition hover:border-white/50 disabled:cursor-default"
              >
                {assets.picture ? (
                  <img
                    src={assets.picture.dataUrl}
                    alt={t.shelfCardPicture}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5 text-zinc-600" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold text-white">
                  {t.shelfCardPicture}
                </div>
                <div className="truncate text-[10px] text-zinc-400">
                  {assets.picture
                    ? `${assets.picture.width > 0 ? `${assets.picture.width}×${assets.picture.height} · ` : ''}PNG`
                    : t.shelfWaitingCard}
                </div>
              </div>
              {assets.picture && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewLayer((prev) => (prev === 'picture' ? null : 'picture'))
                    }
                    title={t.shelfPreviewBtn}
                    className={`inline-flex items-center justify-center rounded-md border p-1.5 text-[10.5px] transition ${
                      previewLayer === 'picture'
                        ? 'border-white bg-white text-black'
                        : 'border-white/15 text-zinc-300 hover:border-white/45 hover:text-white'
                    }`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadPicture()}
                    className="sl-btn-carbon inline-flex items-center gap-1 rounded-lg border-white/25 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:border-white/60"
                  >
                    {savedKey === 'pic' ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-300" />
                        <span className="text-emerald-200">{t.shelfSavedBtn}</span>
                      </>
                    ) : (
                      <>
                        <Download className="h-3 w-3" />
                        <span>{t.shelfDownloadBtn}</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Row 2: Font / Writing (True Transparent PNG Cutout + Vector `<path>` SVG) */}
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0b0b0f] px-2 py-1.5">
              <button
                type="button"
                disabled={!assets.font}
                onClick={() => {
                  if (!assets.font) return;
                  setPreviewGridLight(assets.font.backdropIsLight);
                  setPreviewLayer((prev) => (prev === 'font' ? null : 'font'));
                }}
                title={t.shelfPreviewBtn}
                className={`flex h-[38px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded border border-white/15 transition hover:border-white/50 disabled:cursor-default ${
                  assets.font?.transparentApplied && fontViewMode === 'transparent'
                    ? assets.font.backdropIsLight
                      ? 'sl-checkerboard-light'
                      : 'sl-checkerboard-dark'
                    : 'sl-checkerboard'
                }`}
              >
                {assets.font ? (
                  <img
                    src={
                      assets.font.transparentApplied && fontViewMode === 'transparent'
                        ? assets.font.transparentDataUrl
                        : assets.font.rawDataUrl
                    }
                    alt={t.shelfCardFont}
                    className="max-h-full max-w-full object-contain p-0.5"
                  />
                ) : isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                ) : (
                  <Type className="h-3.5 w-3.5 text-zinc-600" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold text-white">
                  {t.shelfCardFont}
                </div>
                <div className="truncate text-[10px] text-emerald-300">
                  {assets.font
                    ? assets.font.transparentApplied && fontViewMode === 'transparent'
                      ? t.shelfTransparentTag
                      : t.shelfSolidTag
                    : isRunning
                      ? t.shelfWaitingCard
                      : t.runPhaseNoImage}
                </div>
              </div>
              {assets.font ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (assets.font) setPreviewGridLight(assets.font.backdropIsLight);
                      setPreviewLayer((prev) => (prev === 'font' ? null : 'font'));
                    }}
                    title={t.shelfPreviewBtn}
                    className={`inline-flex items-center justify-center rounded-md border p-1.5 text-[10.5px] transition ${
                      previewLayer === 'font'
                        ? 'border-white bg-white text-black'
                        : 'border-white/15 text-zinc-300 hover:border-white/45 hover:text-white'
                    }`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  {assets.font.vectorSvg && (
                    <button
                      type="button"
                      onClick={() => void handleDownloadFontVectorSvg()}
                      title={t.shelfVectorSvgBtn}
                      className="sl-btn-carbon inline-flex items-center rounded-md px-1.5 py-1 text-[10px] font-semibold text-white"
                    >
                      {savedKey === 'font-svg' ? '✓ SVG' : 'SVG'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleDownloadFont()}
                    className="sl-btn-carbon inline-flex items-center gap-1 rounded-lg border-white/25 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:border-white/60"
                  >
                    {savedKey === 'font' ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-300" />
                        <span className="text-emerald-200">{t.shelfSavedBtn}</span>
                      </>
                    ) : (
                      <>
                        <Download className="h-3 w-3" />
                        <span>{t.shelfDownloadBtn}</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                !isRunning &&
                assets.picture && (
                  <button
                    type="button"
                    onClick={() =>
                      void runLayeredFlow({
                        skipHostWarning: true,
                        singleLayerRetryIndex: 1,
                      })
                    }
                    className="sl-btn-carbon inline-flex shrink-0 items-center gap-1 rounded-lg border-white/30 px-2 py-1 text-[11px] font-semibold text-white"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>{t.shelfRetryLayer}</span>
                  </button>
                )
              )}
            </div>

            {/* Row 3: Clean Background */}
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0b0b0f] px-2 py-1.5">
              <button
                type="button"
                disabled={!assets.background}
                onClick={() => {
                  if (!assets.background) return;
                  setPreviewLayer((prev) => (prev === 'background' ? null : 'background'));
                }}
                title={t.shelfPreviewBtn}
                className="sl-checkerboard flex h-[38px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded border border-white/15 transition hover:border-white/50 disabled:cursor-default"
              >
                {assets.background ? (
                  <img
                    src={assets.background.dataUrl}
                    alt={t.shelfCardBackground}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                ) : (
                  <Layers className="h-3.5 w-3.5 text-zinc-600" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold text-white">
                  {t.shelfCardBackground}
                </div>
                <div className="truncate text-[10px] text-zinc-400">
                  {assets.background
                    ? `${assets.background.width > 0 ? `${assets.background.width}×${assets.background.height} · ` : ''}PNG`
                    : isRunning
                      ? t.shelfWaitingCard
                      : t.runPhaseNoImage}
                </div>
              </div>
              {assets.background ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewLayer((prev) => (prev === 'background' ? null : 'background'))
                    }
                    title={t.shelfPreviewBtn}
                    className={`inline-flex items-center justify-center rounded-md border p-1.5 text-[10.5px] transition ${
                      previewLayer === 'background'
                        ? 'border-white bg-white text-black'
                        : 'border-white/15 text-zinc-300 hover:border-white/45 hover:text-white'
                    }`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadBackground()}
                    className="sl-btn-carbon inline-flex items-center gap-1 rounded-lg border-white/25 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:border-white/60"
                  >
                    {savedKey === 'bg' ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-300" />
                        <span className="text-emerald-200">{t.shelfSavedBtn}</span>
                      </>
                    ) : (
                      <>
                        <Download className="h-3 w-3" />
                        <span>{t.shelfDownloadBtn}</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                !isRunning &&
                assets.picture && (
                  <button
                    type="button"
                    onClick={() =>
                      void runLayeredFlow({
                        skipHostWarning: true,
                        singleLayerRetryIndex: 2,
                      })
                    }
                    className="sl-btn-carbon inline-flex shrink-0 items-center gap-1 rounded-lg border-white/30 px-2 py-1 text-[11px] font-semibold text-white"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>{t.shelfRetryLayer}</span>
                  </button>
                )
              )}
            </div>
          </div>

          {/* Compact On-Demand Layer Preview Inspector (opens only when user taps 👁 or thumbnail) */}
          {previewLayer && (
            <div className="space-y-1.5 rounded-xl border border-white/25 bg-[#07070b] p-2">
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1">
                  {assets.picture && (
                    <button
                      type="button"
                      onClick={() => setPreviewLayer('picture')}
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold transition ${
                        previewLayer === 'picture'
                          ? 'bg-white text-black'
                          : 'border border-white/15 text-zinc-300 hover:text-white'
                      }`}
                    >
                      1 · {t.shelfCardPicture}
                    </button>
                  )}
                  {assets.font && (
                    <button
                      type="button"
                      onClick={() => setPreviewLayer('font')}
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold transition ${
                        previewLayer === 'font'
                          ? 'bg-white text-black'
                          : 'border border-white/15 text-zinc-300 hover:text-white'
                      }`}
                    >
                      2 · {t.shelfCardFont}
                    </button>
                  )}
                  {assets.background && (
                    <button
                      type="button"
                      onClick={() => setPreviewLayer('background')}
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold transition ${
                        previewLayer === 'background'
                          ? 'bg-white text-black'
                          : 'border border-white/15 text-zinc-300 hover:text-white'
                      }`}
                    >
                      3 · {t.shelfCardBackground}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {previewLayer === 'font' && (
                    <>
                      {assets.font?.vectorSvg && (
                        <button
                          type="button"
                          onClick={() => void handleCopyFontVectorSvg()}
                          className="rounded border border-white/15 px-1.5 py-0.5 text-[9.5px] font-medium text-zinc-200 hover:border-white/40"
                        >
                          {savedKey === 'font-copy-svg' ? t.shelfCopiedSvgBtn : t.shelfCopySvgBtn}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPreviewGridLight((prev) => !prev)}
                        className="rounded border border-white/15 px-1.5 py-0.5 text-[9.5px] font-medium text-zinc-200 hover:border-white/40"
                      >
                        {previewGridLight ? t.shelfPreviewLightGrid : t.shelfPreviewDarkGrid}
                      </button>
                    </>
                  )}
                  {(previewLayer === 'font' || previewLayer === 'background') &&
                    !isRunning &&
                    assets.picture && (
                      <button
                        type="button"
                        onClick={() =>
                          void runLayeredFlow({
                            skipHostWarning: true,
                            singleLayerRetryIndex: previewLayer === 'font' ? 1 : 2,
                          })
                        }
                        className="inline-flex items-center gap-0.5 rounded border border-white/15 px-1.5 py-0.5 text-[9.5px] font-medium text-zinc-300 hover:border-white/40 hover:text-white"
                      >
                        <Sparkles className="h-2.5 w-2.5" />
                        <span>{t.shelfAiRefineBtn}</span>
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={() => setPreviewLayer(null)}
                    className="inline-flex items-center rounded border border-white/15 p-0.5 text-zinc-300 hover:border-white/40 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <div
                className={`flex h-[132px] w-full items-center justify-center overflow-hidden rounded-lg border border-white/15 p-1.5 ${
                  previewLayer === 'font'
                    ? previewGridLight
                      ? 'sl-checkerboard-light'
                      : 'sl-checkerboard-dark'
                    : 'sl-checkerboard'
                }`}
              >
                {previewLayer === 'picture' && assets.picture && (
                  <img
                    src={assets.picture.dataUrl}
                    alt={t.shelfCardPicture}
                    className="max-h-full max-w-full object-contain"
                  />
                )}
                {previewLayer === 'font' && assets.font && (
                  <img
                    src={
                      assets.font.transparentApplied && fontViewMode === 'transparent'
                        ? assets.font.transparentDataUrl
                        : assets.font.rawDataUrl
                    }
                    alt={t.shelfCardFont}
                    className="max-h-full max-w-full object-contain"
                  />
                )}
                {previewLayer === 'background' && assets.background && (
                  <img
                    src={assets.background.dataUrl}
                    alt={t.shelfCardBackground}
                    className="max-h-full max-w-full object-contain"
                  />
                )}
              </div>
            </div>
          )}

          {/* Sleek Monochrome "Pick a New Picture (Start Over)" Button with Letter Glitch Effect */}
          {onPickNew && !isRunning && (
            <button
              type="button"
              onClick={handleBottomPickNewWithGlitch}
              className={`sl-sheen ${readyCount === 3 ? 'sl-cue ' : ''}flex w-full items-center justify-center gap-2 rounded-xl border border-white/80 bg-white py-2 text-[12px] font-bold text-black shadow-[0_0_14px_rgba(255,255,255,0.2)] transition hover:bg-zinc-200 active:scale-[0.99] ${
                bottomGlitch !== null ? 'sl-mono tracking-wider' : ''
              }`}
            >
              <OrbIcon size={14} onLight />
              <span>
                {bottomGlitch !== null
                  ? scrambleGlitchLabel(t.pickNewBottomCta, bottomGlitch)
                  : t.pickNewBottomCta}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Live 1 → 2 → 3 progress (shown only while running or when not all 3 layers are complete) */}
      {phases && (isRunning || readyCount < 3) && (
        <div className="sl-card space-y-1.5 rounded-xl p-2.5" aria-live="polite">
          {phases.map((phase, i) => {
            const Icon = stepIcons[i] ?? ImageIcon;
            const active =
              phase === 'pasting' ||
              phase === 'sending' ||
              phase === 'generating' ||
              phase === 'extracting' ||
              phase === 'needs-manual-send';
            return (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    phase === 'done'
                      ? 'bg-emerald-300 text-black'
                      : phase === 'no-image'
                        ? 'bg-amber-300 text-black'
                        : phase === 'failed'
                          ? 'bg-red-400 text-black'
                          : active
                            ? 'bg-white text-black'
                            : 'bg-white/10 text-zinc-400'
                  }`}
                >
                  {phase === 'done' ? (
                    <Check className="h-2.5 w-2.5" />
                  ) : phase === 'no-image' ? (
                    <AlertTriangle className="h-2.5 w-2.5" />
                  ) : phase === 'failed' ? (
                    <X className="h-2.5 w-2.5" />
                  ) : (
                    i + 1
                  )}
                </span>
                <Icon className={`h-3 w-3 shrink-0 ${active ? 'text-white' : 'text-zinc-500'}`} />
                <span className={`min-w-0 flex-1 truncate ${active || phase === 'done' ? 'text-white' : 'text-zinc-400'}`}>
                  {stepLabels[i]}
                </span>
                <span
                  className={`flex shrink-0 items-center gap-1 text-[11px] ${
                    phase === 'needs-manual-send' || phase === 'no-image'
                      ? 'font-semibold text-amber-200'
                      : phase === 'done'
                        ? 'text-emerald-300'
                        : phase === 'failed'
                          ? 'text-red-300'
                          : 'text-zinc-400'
                  }`}
                >
                  {active && phase !== 'needs-manual-send' && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  {phaseText(phase)}
                </span>
              </div>
            );
          })}

          {run.kind === 'running' && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-[11px] leading-snug text-zinc-500">{t.runKeepPanelOpen}</p>
              <button
                type="button"
                onClick={stopRun}
                className="flex shrink-0 items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-white/40 hover:text-white"
              >
                <Square className="h-3 w-3" />
                {t.runStop}
              </button>
            </div>
          )}

          {run.kind === 'finished' && run.outcome.status === 'no-chat' && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[11.5px] font-medium text-amber-200">{t.runNoChat}</p>
              {renderQuickImageAiButtons()}
            </div>
          )}

          {run.kind === 'finished' &&
            run.outcome.status === 'failed' &&
            run.outcome.reason === 'IMAGE_NOT_ATTACHED' && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11.5px] font-medium leading-snug text-amber-200">
                  {t.runImageAttachBlocked(Boolean(run.copiedPngFallback))}
                </p>
                {renderQuickImageAiButtons()}
              </div>
            )}

          {run.kind === 'finished' &&
            run.outcome.status === 'failed' &&
            run.outcome.reason === 'GROK_REQUIRES_MASTER_IMAGE' && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11.5px] font-medium leading-snug text-amber-200">
                  {t.runGrokMasterRequired}
                </p>
                {renderQuickImageAiButtons()}
              </div>
            )}

          {run.kind === 'finished' &&
            run.outcome.status === 'failed' &&
            run.outcome.reason !== 'IMAGE_NOT_ATTACHED' &&
            run.outcome.reason !== 'GROK_REQUIRES_MASTER_IMAGE' && (
              <p className="pt-1 text-[11.5px] font-medium text-amber-200">{t.runFailed}</p>
            )}

          {aiDeclined && run.kind === 'finished' && run.outcome.status === 'partial' && (
            <p className="pt-1 text-[11.5px] font-medium leading-snug text-amber-200">
              {t.runAiDeclinedLayer}
            </p>
          )}

          {run.kind === 'finished' && run.outcome.status === 'paused-no-image' && (
            <div className="space-y-2 pt-1">
              <p className="text-[11.5px] font-medium leading-snug text-amber-200">
                {aiDeclined ? t.runAiDeclined : t.runPausedNoImage}
              </p>
              <button
                type="button"
                onClick={() => void handleSeparateExistingChatImage()}
                className="sl-btn-white flex w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-[11.5px] font-semibold"
              >
                <Scissors className="h-3.5 w-3.5" />
                <span>{t.separateExistingBtn}</span>
              </button>
              {renderQuickImageAiButtons()}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => void runLayeredFlow({ startIndex: 0, skipHostWarning: true })}
                  className="sl-btn-carbon rounded-lg px-2 py-1.5 text-[11px] font-semibold text-white"
                >
                  {t.runRetryStep1}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void runLayeredFlow({
                      startIndex: 1,
                      continueOnNoImage: true,
                      skipHostWarning: true,
                      forceMode: 'deep-3-prompt',
                    })
                  }
                  className="sl-btn-carbon rounded-lg px-2 py-1.5 text-[11px] font-semibold text-zinc-200"
                >
                  {t.runContinueSteps23}
                </button>
              </div>
            </div>
          )}

          {run.kind === 'finished' && run.outcome.status === 'partial' && (
            <p className="pt-1 text-[11.5px] font-medium text-amber-200">
              {run.outcome.imagesProduced === 0
                ? t.runPartialNoImages
                : t.runPartialSomeImages(run.outcome.imagesProduced, run.outcome.totalSteps)}
            </p>
          )}
        </div>
      )}

      {/* Hide manual single-step paste footer once all 3 layers are ready to keep the view compact */}
      {readyCount < 3 && (
        <div className="space-y-1">
          <div className="text-[10.5px] font-medium text-zinc-500">{t.singleStepLabel}</div>
          <div className="grid grid-cols-3 gap-1.5">
            {[t.singleComposite, t.singleText, t.singleBg].map((label, i) => {
              const Icon = stepIcons[i] ?? ImageIcon;
              const state = singleTarget === i ? singleState : { kind: 'idle' as const };
              return (
                <button
                  key={label}
                  type="button"
                  disabled={isRunning || state.kind === 'sending'}
                  aria-disabled={!enabled || isRunning}
                  onClick={() => void sendSingle(i)}
                  className={`flex min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] transition disabled:opacity-50 ${
                    state.kind === 'awaiting-prompt' || state.kind === 'awaiting-image'
                      ? 'border border-amber-300/80 bg-amber-100 font-semibold text-black'
                      : state.kind !== 'idle' && state.kind !== 'sending'
                        ? 'border border-emerald-300/70 bg-emerald-200 font-semibold text-black'
                        : 'sl-btn-carbon'
                  }`}
                >
                  {state.kind === 'sending' ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  ) : state.kind !== 'idle' ? (
                    <Check className="h-3 w-3 shrink-0" />
                  ) : (
                    <Icon className="h-3 w-3 shrink-0 text-white" />
                  )}
                  <span className="truncate">{singleLabel(i, label)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
