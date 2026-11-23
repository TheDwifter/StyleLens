import type { RawSelectionPayload, SampledColor, ViewportMetrics, ViewportRect } from './capture';

/** Messages sent from Service Worker -> Content Script Overlay */
export type OverlayCommandMessage =
  | { type: 'STYLELENS_OVERLAY_ACTIVATE'; language?: 'en' | 'zh-CN' }
  | { type: 'STYLELENS_OVERLAY_CANCEL' };

/** Messages sent from Content Script Overlay -> Service Worker */
export type OverlayEventMessage =
  | { type: 'STYLELENS_SELECTION_COMPLETE'; payload: RawSelectionPayload }
  | { type: 'STYLELENS_SELECTION_CANCELLED' };

/** Messages sent from Side Panel -> Service Worker */
export type SidePanelRequestMessage =
  | { type: 'STYLELENS_REQUEST_START_CAPTURE'; language?: 'en' | 'zh-CN' }
  | { type: 'STYLELENS_REQUEST_CANCEL_CAPTURE' }
  | { type: 'STYLELENS_CONSUME_PENDING_CAPTURE' }
    | {
      type: 'STYLELENS_PASTE_TO_ACTIVE_CHAT';
      imageDataUrl: string;
      promptText: string;
      /** Lock a multi-step run to the same chat tab even if the user switches tabs. */
      tabId?: number;
      /** Atomic image-first gate: if true and the image fails to attach, abort BEFORE inserting prompt text. */
      requireImage?: boolean;
      /** Optional upload filename (e.g. `stylelens-capture.png` or `stylelens-master.png`). */
      fileName?: string;
    }
  | { type: 'STYLELENS_CHAT_SUBMIT'; tabId: number }
  | {
      type: 'STYLELENS_CHAT_PROBE';
      tabId: number;
      /** Paste-time run token: every visual stamped with it pre-dates this run and is ignored. */
      runToken?: string;
    }
  | {
      type: 'STYLELENS_EXTRACT_CHAT_IMAGE';
      tabId?: number;
      /**
       * Paste-time run token. When set, extraction refuses any visual that already existed when the
       * prompt was pasted (omit it only when deliberately grabbing an image already in the chat).
       */
      runToken?: string;
      /** Specific DOM element id discovered by `probeChatGenerationState`; omit to grab the newest finished assistant image. */
      domId?: string;
      /** Optional src URL hint when re-locating a discovered element. */
      srcHint?: string;
    };

export interface PasteToChatResponse {
  ok: boolean;
  insertedImage?: boolean;
  insertedPrompt?: boolean;
  hostname?: string;
  tabId?: number;
  /**
   * Unique token stamped (`data-stylelens-preexisting-run`) onto every `<img>` / `<canvas>` /
   * background-image tile that existed in the chat tab at paste time. Pass it to
   * `STYLELENS_CHAT_PROBE` and `STYLELENS_EXTRACT_CHAT_IMAGE` so only visuals mounted AFTER the
   * paste can ever be detected or extracted as this run's reply.
   */
  runToken?: string;
  reason?:
    | 'NO_ACTIVE_TAB'
    | 'RESTRICTED_URL'
    | 'NO_CHAT_INPUT'
    | 'IMAGE_NOT_ATTACHED'
    | 'INJECTION_FAILED';
  message?: string;
}

export interface ChatSubmitResponse {
  ok: boolean;
  method?: 'button' | 'enter-key';
  reason?: string;
}

/** Descriptor of a single finished assistant-generated visual in the AI chat DOM. */
export interface AssistantImageDescriptor {
  /** Stable per-element DOM id (`sl-img-N`) assigned by the probe so in-place src upgrades stay identity-locked. */
  domId: string;
  /** Canonical identity key (`src` for img/css-bg, or `canvas:<domId>:<w>x<h>`). */
  key: string;
  src: string;
  kind: 'img' | 'canvas' | 'css-bg';
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  /** True when the image lives inside a recognized assistant response container (`model-response`, `generated-image`, etc.). */
  confirmedAssistant: boolean;
}

/** Snapshot of the AI chat page used to decide when a reply has finished. */
export interface ChatProbeResponse {
  ok: boolean;
  /** A visible "Stop" / "Stop generating" control or active loading placeholder exists → AI is still answering. */
  generating: boolean;
  /** Milliseconds since the conversation area last changed (ignores the composer). */
  quietMs: number;
  /** Composer has no typed text (true right after a successful send). */
  composerEmpty: boolean;
  /** Count of rendered large AI output images in the conversation (kept for backward compatibility). */
  largeImageCount?: number;
  /** Ordered list (document order, oldest → newest) of finished assistant-generated images on screen. */
  assistantImages?: AssistantImageDescriptor[];
  /** How many assistant reply blocks are in the conversation (to tell a NEW reply from history). */
  assistantReplyCount?: number;
  /** The newest assistant reply is short text that reads like a refusal (no picture is coming). */
  refusalHint?: boolean;
  reason?: string;
}

export interface ExtractChatImageResponse {
  ok: boolean;
  /** Genuine PNG `data:image/png;base64,...` ready for download or re-upload. */
  dataUrl?: string;
  width?: number;
  height?: number;
  sourceUrl?: string;
  domId?: string;
  tabId?: number;
  method?:
    | 'page-blob-or-data'
    | 'page-canvas'
    | 'sw-credentialed-fetch'
    | 'sw-anonymous-fetch'
    | 'visible-tab-crop';
  reason?:
    | 'NO_ACTIVE_TAB'
    | 'RESTRICTED_URL'
    | 'NO_ASSISTANT_IMAGE'
    | 'IMAGE_NOT_LOADED'
    | 'EXTRACTION_FAILED';
  message?: string;
}

/** Messages broadcast from Service Worker -> Side Panel */
export type ServiceWorkerBroadcastMessage =
  | { type: 'STYLELENS_CAPTURE_STATUS'; status: 'selecting' | 'capturing' | 'idle'; tabHostname?: string }
  | { type: 'STYLELENS_CAPTURE_READY'; captureId: string }
  | { type: 'STYLELENS_CAPTURE_ERROR'; code: CaptureErrorCode; message: string; origin?: string };

export type CaptureErrorCode =
  | 'NO_ACTIVE_TAB'
  | 'RESTRICTED_URL'
  | 'PERMISSION_REQUIRED'
  | 'RATE_LIMITED'
  | 'CAPTURE_FAILED'
  | 'INJECTION_FAILED';

export interface StartCaptureResponse {
  ok: boolean;
  code?: CaptureErrorCode;
  message?: string;
  origin?: string;
}

export type RuntimeMessage =
  | OverlayCommandMessage
  | OverlayEventMessage
  | SidePanelRequestMessage
  | ServiceWorkerBroadcastMessage;

/** Web Worker protocol for off-main-thread screenshot cropping & pixel palette extraction */
export interface ImageWorkerRequest {
  id: string;
  fullViewportDataUrl: string;
  rect: ViewportRect;
  viewport: ViewportMetrics;
  maxColors: number;
}

export interface ImageWorkerSuccessResponse {
  id: string;
  ok: true;
  croppedBlob: Blob;
  width: number;
  height: number;
  sampledColors: SampledColor[];
}

export interface ImageWorkerErrorResponse {
  id: string;
  ok: false;
  error: string;
}

export type ImageWorkerResponse = ImageWorkerSuccessResponse | ImageWorkerErrorResponse;
