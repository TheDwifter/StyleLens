import type { ChatImageStep } from '../../core/chatImagePrompts';
import type {
  AssistantImageDescriptor,
  ChatProbeResponse,
  ChatSubmitResponse,
  PasteToChatResponse,
} from '../../types/messages';

export type StepPhase =
  | 'waiting'
  | 'pasting'
  | 'sending'
  | 'needs-manual-send'
  | 'generating'
  | 'extracting'
  | 'done'
  | 'no-image'
  | 'failed';

export type RunOutcome =
  | { status: 'complete'; imagesProduced: number }
  | { status: 'partial'; imagesProduced: number; totalSteps: number }
  | { status: 'paused-no-image'; stepIndex: number; imagesProduced: number; totalSteps: number }
  | { status: 'no-chat'; reason?: string }
  | { status: 'cancelled' }
  | { status: 'failed'; stepIndex: number; reason: string };

export interface DynamicStepPayload {
  prompt: string;
  imageDataUrl?: string;
  requireImage?: boolean;
  fileName?: string;
  /** Optional pre-step abort reason (e.g., `GROK_REQUIRES_MASTER_IMAGE`). */
  abortReason?: string;
}

export interface ThreeImageRunDeps {
  paste: (
    prompt: string,
    tabId?: number,
    requireImage?: boolean,
    imageDataUrlOverride?: string,
    fileName?: string
  ) => Promise<PasteToChatResponse | undefined>;
  submit: (tabId: number) => Promise<ChatSubmitResponse | undefined>;
  /** `runToken` (from the paste response) makes the probe ignore every visual that pre-dates this step's paste. */
  probe: (tabId: number, runToken?: string) => Promise<ChatProbeResponse | undefined>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  isCancelled: () => boolean;
  onProgress: (stepIndex: number, phase: StepPhase) => void;
  /** Optional dynamic resolver invoked right before each step (enables Master-Image chaining into Steps 2 & 3!). */
  getStepPayload?: (stepIndex: number) => Promise<DynamicStepPayload> | DynamicStepPayload;
  /** Invoked immediately after a step renders a brand-new assistant image (before the next step starts). */
  onStepImageDetected?: (
    stepIndex: number,
    image: AssistantImageDescriptor | undefined,
    tabId: number,
    /** Paste-time token of this step; pass it to extraction so a pre-existing image is never grabbed. */
    runToken?: string
  ) => Promise<void> | void;
  /** When true, require the reference image to attach atomically BEFORE pasting prompt text. */
  requireImage?: boolean;
  /** Optional index to start/resume from (defaults to 0). */
  startIndex?: number;
  /** Optional pre-locked tabId (e.g. when separating an image already sitting in the active chat). */
  initialTabId?: number;
  /** Optional count of already-extracted layers before `startIndex` (0 on resume-after-no-image; 1 when separating existing chat Master Image). */
  initialImagesProduced?: number;
  /** Called when the AI answered a step with a refusal instead of a picture. */
  onAiDeclined?: (stepIndex: number) => void;
  /** When true, do not pause on Step 0 producing no image; continue through remaining steps. */
  continueOnNoImage?: boolean;
}

export interface ThreeImageRunTiming {
  pollMs: number;
  /** Post-send settle to absorb unannotated user upload thumbnails into baseline. */
  postSendSettleMs: number;
  /** Fast completion wait once a brand-new rendered AI image actually appeared. */
  minReplyMsWithImage: number;
  quietMsAfterImage: number;
  /** Patient wait when Stop/spinner disappeared WITHOUT a new image (covers 20–45s Gemini/ChatGPT draws!). */
  minReplyMsNoImage: number;
  quietMsNoImage: number;
  /** Patient wait when neither a Stop button nor a new image was ever observed. */
  minReplyMsNoStopSeen: number;
  quietMsNoStopSeen: number;
  /** Hard timeout per step (reports real TIMEOUT failure, never falsely marks 'done'). */
  maxReplyMs: number;
  /** How long to wait for the user to press Send manually if auto-send failed. */
  manualSendMs: number;
  /** Pause between a finished reply and the next message so chat UIs finish hydrating. */
  betweenStepsMs: number;
}

export const DEFAULT_RUN_TIMING: ThreeImageRunTiming = {
  pollMs: 1000,
  postSendSettleMs: 1500,
  minReplyMsWithImage: 3500,
  quietMsAfterImage: 2000,
  minReplyMsNoImage: 35000,
  quietMsNoImage: 10000,
  minReplyMsNoStopSeen: 50000,
  quietMsNoStopSeen: 10000,
  maxReplyMs: 240000,
  manualSendMs: 180000,
  betweenStepsMs: 3000,
};

const NO_CHAT_REASONS = new Set(['NO_CHAT_INPUT', 'NO_ACTIVE_TAB', 'RESTRICTED_URL']);

/**
 * Runs the 3-step Master-Image Generation & Separation flow in the SAME locked chat tab:
 *   0. Edited composite (Master Image) — or already extracted when separating an existing chat image
 *   1. Separated Font / Writing FROM the Master Image (solid uniform backdrop -> transparent PNG)
 *   2. Separated Clean Background FROM the Master Image (zero scene regeneration)
 *
 * Guarantees:
 * - Identity-based assistant image tracking (`assistantImages`) with 100% `largeImageCount` fallback
 * - `postSendSettleMs` NEVER absorbs `confirmedAssistant: true` images into baseline
 * - Atomic image-first attachment (never strands orphan prompt text without the image!)
 * - Extracts Step 0's Master Image immediately via `onStepImageDetected` before Step 1 runs
 * - Patient 35s/50s no-image waits so 20–45s Gemini/ChatGPT renders never abort prematurely
 * - Step 0 circuit breaker pauses cleanly on 0-image Step 0 without flooding Steps 1 & 2
 */
export async function runThreeImageSequence(
  steps: ChatImageStep[],
  deps: ThreeImageRunDeps,
  timing: ThreeImageRunTiming = DEFAULT_RUN_TIMING
): Promise<RunOutcome> {
  let tabId: number | undefined = deps.initialTabId;
  const defaultRequireImage = deps.requireImage ?? false;
  const startIndex = Math.max(0, deps.startIndex ?? 0);
  let imagesProduced = Math.max(0, Math.min(startIndex, deps.initialImagesProduced ?? 0));

  for (let i = startIndex; i < steps.length; i++) {
    const step = steps[i]!;
    if (deps.isCancelled()) return { status: 'cancelled' };

    // Resolve dynamic per-step payload (lets Steps 1 & 2 attach the extracted Master Image!)
    let stepPrompt = step.prompt;
    let stepImageOverride: string | undefined;
    let stepRequireImage = defaultRequireImage;
    let stepFileName: string | undefined;

    if (deps.getStepPayload) {
      const payload = await deps.getStepPayload(i);
      if (payload.abortReason) {
        deps.onProgress(i, 'failed');
        return { status: 'failed', stepIndex: i, reason: payload.abortReason };
      }
      stepPrompt = payload.prompt;
      stepImageOverride = payload.imageDataUrl;
      stepRequireImage = payload.requireImage ?? defaultRequireImage;
      stepFileName = payload.fileName;
    }

    // 1. Atomic image-first paste
    deps.onProgress(i, 'pasting');
    let pasted = await deps
      .paste(stepPrompt, tabId, stepRequireImage, stepImageOverride, stepFileName)
      .catch(() => undefined);
    if (!pasted?.ok && i > startIndex && pasted?.reason !== 'IMAGE_NOT_ATTACHED') {
      await deps.sleep(2000);
      if (deps.isCancelled()) return { status: 'cancelled' };
      pasted = await deps
        .paste(stepPrompt, tabId, stepRequireImage, stepImageOverride, stepFileName)
        .catch(() => undefined);
    }

    if (!pasted?.ok || !pasted.insertedPrompt) {
      deps.onProgress(i, 'failed');
      const reason = pasted?.reason;
      if (i === startIndex && (!pasted || !reason || NO_CHAT_REASONS.has(reason))) {
        return { status: 'no-chat', reason };
      }
      return { status: 'failed', stepIndex: i, reason: reason ?? 'PASTE_FAILED' };
    }

    if (stepRequireImage && !pasted.insertedImage) {
      deps.onProgress(i, 'failed');
      return { status: 'failed', stepIndex: i, reason: 'IMAGE_NOT_ATTACHED' };
    }

    if (typeof pasted.tabId === 'number') tabId = pasted.tabId;
    if (tabId === undefined) {
      deps.onProgress(i, 'failed');
      return { status: 'failed', stepIndex: i, reason: 'NO_TAB_ID' };
    }

    // Paste-time DOM stamp token: every visual that existed in the tab when the prompt was pasted
    // carries it, so the probe below can only ever report images mounted AFTER this paste.
    const runToken = pasted.runToken;

    // Snapshot conversation assistant images & arm MutationObserver BEFORE clicking Send
    const beforeProbe = await deps.probe(tabId, runToken).catch(() => undefined);
    let baselineLargeImages = beforeProbe?.largeImageCount ?? 0;
    // If the baseline probe failed, no reply can be proven new: refusal shortcut stays off
    const baselineReplyCount = beforeProbe?.assistantReplyCount ?? Number.POSITIVE_INFINITY;
    const baselineDomIds = new Set<string>(
      (beforeProbe?.assistantImages ?? []).map((img) => img.domId)
    );
    const baselineKeys = new Set<string>(
      (beforeProbe?.assistantImages ?? []).map((img) => img.key)
    );

    // 2. Press Send (falls back smoothly to waiting for manual Send)
    if (deps.isCancelled()) return { status: 'cancelled' };
    deps.onProgress(i, 'sending');
    await deps.sleep(300);
    const submitted = await deps.submit(tabId).catch(() => undefined);
    if (!submitted?.ok) {
      deps.onProgress(i, 'needs-manual-send');
      const manualStart = deps.now();
      let userSent = false;
      while (deps.now() - manualStart < timing.manualSendMs) {
        if (deps.isCancelled()) return { status: 'cancelled' };
        await deps.sleep(timing.pollMs);
        const p = await deps.probe(tabId, runToken).catch(() => undefined);
        if (p?.ok && p.composerEmpty) {
          userSent = true;
          break;
        }
      }
      if (!userSent) {
        deps.onProgress(i, 'failed');
        return { status: 'failed', stepIndex: i, reason: 'NOT_SENT' };
      }
    }

    // 3. Post-send settle: absorb ONLY unannotated user upload thumbnails into baseline —
    //    NEVER absorb `confirmedAssistant === true` images!
    deps.onProgress(i, 'generating');
    const sentAt = deps.now();
    let sawStop = false;
    let detectedImage: AssistantImageDescriptor | undefined;
    let stepProducedImage = false;

    if (timing.postSendSettleMs > 0) {
      await deps.sleep(timing.postSendSettleMs);
      if (deps.isCancelled()) return { status: 'cancelled' };
      const postSendProbe = await deps.probe(tabId, runToken).catch(() => undefined);
      if (postSendProbe?.ok) {
        if (postSendProbe.generating) sawStop = true;
        if (Array.isArray(postSendProbe.assistantImages)) {
          for (const img of postSendProbe.assistantImages) {
            const isSmallUserThumb =
              !img.confirmedAssistant &&
              Math.max(img.renderedWidth || 0, img.renderedHeight || 0) < 220;
            if (isSmallUserThumb) {
              baselineDomIds.add(img.domId);
              baselineKeys.add(img.key);
            } else if (!baselineDomIds.has(img.domId) && !baselineKeys.has(img.key)) {
              detectedImage = img;
              stepProducedImage = true;
            }
          }
        } else if ((postSendProbe.largeImageCount ?? 0) > baselineLargeImages) {
          baselineLargeImages = postSendProbe.largeImageCount ?? baselineLargeImages;
        }
      }
    }

    // 4. Poll until AI finishes this reply
    let doneStreak = 0;
    let stepReady = false;
    let aiDeclined = false;
    let refusalStreak = 0;
    while (deps.now() - sentAt < timing.maxReplyMs) {
      if (deps.isCancelled()) return { status: 'cancelled' };
      await deps.sleep(timing.pollMs);
      const p = await deps.probe(tabId, runToken).catch(() => undefined);
      if (!p?.ok) {
        doneStreak = 0;
        continue;
      }

      if (Array.isArray(p.assistantImages)) {
        const fresh = p.assistantImages.filter(
          (img) => !baselineDomIds.has(img.domId) && !baselineKeys.has(img.key)
        );
        if (fresh.length > 0) {
          const confirmed = fresh.filter((img) => img.confirmedAssistant);
          detectedImage = (confirmed.length > 0 ? confirmed : fresh).at(-1);
          stepProducedImage = true;
        }
      } else if ((p.largeImageCount ?? 0) > baselineLargeImages) {
        stepProducedImage = true;
      }

      if (p.generating) {
        sawStop = true;
        doneStreak = 0;
        continue;
      }
      const elapsed = deps.now() - sentAt;
      // The AI answered with a short refusal instead of a picture: stop waiting now. Only a
      // reply that appeared AFTER this send counts (an old refusal higher up the thread does not).
      const looksDeclined =
        !stepProducedImage &&
        p.refusalHint === true &&
        (p.assistantReplyCount ?? 0) > baselineReplyCount &&
        elapsed >= 4000 &&
        p.quietMs >= 2500;
      // Two polls in a row, so a reply that only briefly reads like a refusal (a late picture
      // still mounting) cannot end a working run
      refusalStreak = looksDeclined ? refusalStreak + 1 : 0;
      if (refusalStreak >= 2) {
        aiDeclined = true;
        stepReady = true;
        break;
      }
      const ready = stepProducedImage
        ? elapsed >= timing.minReplyMsWithImage && p.quietMs >= timing.quietMsAfterImage
        : sawStop
          ? elapsed >= timing.minReplyMsNoImage && p.quietMs >= timing.quietMsNoImage
          : elapsed >= timing.minReplyMsNoStopSeen && p.quietMs >= timing.quietMsNoStopSeen;

      if (ready) {
        doneStreak += 1;
        if (doneStreak >= 2) {
          stepReady = true;
          break;
        }
      } else {
        doneStreak = 0;
      }
    }

    if (!stepReady) {
      deps.onProgress(i, 'failed');
      return { status: 'failed', stepIndex: i, reason: 'TIMEOUT' };
    }

    if (stepProducedImage) {
      imagesProduced += 1;
      if (deps.onStepImageDetected) {
        deps.onProgress(i, 'extracting');
        try {
          await deps.onStepImageDetected(i, detectedImage, tabId, runToken);
        } catch {
          // Extraction failure must never crash the run; UI keeps step status honest
        }
      }
      deps.onProgress(i, 'done');
    } else {
      if (aiDeclined) deps.onAiDeclined?.(i);
      deps.onProgress(i, 'no-image');
      // Anti-Cascade Circuit Breaker: if Step 0 finishes with 0 images, pause cleanly
      // instead of spamming Steps 2 & 3 on top of a stalled/unsupported chat!
      if (i === 0 && steps.length > 1 && !deps.continueOnNoImage) {
        return {
          status: 'paused-no-image',
          stepIndex: 0,
          imagesProduced,
          totalSteps: steps.length,
        };
      }
    }

    if (i < steps.length - 1) await deps.sleep(timing.betweenStepsMs);
  }

  if (imagesProduced >= steps.length) {
    return { status: 'complete', imagesProduced };
  }
  return { status: 'partial', imagesProduced, totalSteps: steps.length };
}
