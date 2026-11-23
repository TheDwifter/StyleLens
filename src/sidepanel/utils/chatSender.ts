import type { CaptureRecord } from '../../types/capture';
import type { ExtractChatImageResponse, PasteToChatResponse } from '../../types/messages';

export type ChatActionState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent-both'; hostname: string }
  | { kind: 'sent-image-only' }
  | { kind: 'sent-prompt-only' }
  | { kind: 'awaiting-prompt'; imageAlreadyInChat?: boolean }
  | { kind: 'awaiting-image' }
  | { kind: 'copied-prompt' }
  | { kind: 'copied-image' };

const cachedPngByBlob = new WeakMap<Blob, Promise<Blob>>();
const cachedDataUrlByBlob = new WeakMap<Blob, Promise<string>>();

export function blobToDataUrl(blob: Blob): Promise<string> {
  const existing = cachedDataUrlByBlob.get(blob);
  if (existing) return existing;

  const promise = new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => {
      cachedDataUrlByBlob.delete(blob);
      reject(reader.error ?? new Error('Failed to encode PNG'));
    };
    reader.readAsDataURL(blob);
  });
  cachedDataUrlByBlob.set(blob, promise);
  return promise;
}

/**
 * Smart 1-click AI tab launcher: if the user already has that AI open in the current
 * window (e.g. Gemini, Claude, ChatGPT, DeepSeek, Kimi, Grok at x.com/i/grok), switches
 * directly to that tab instead of spawning duplicate tabs; otherwise opens a clean new tab!
 */
export async function openOrFocusAiChat(targetUrl: string, hostMatchPattern: RegExp): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const existing = tabs.find((t) => {
        if (!t.url) return false;
        try {
          const parsed = new URL(t.url);
          const hostAndPath = `${parsed.hostname}${parsed.pathname}`;
          return hostMatchPattern.test(parsed.hostname) || hostMatchPattern.test(hostAndPath);
        } catch {
          return false;
        }
      });
      if (existing?.id !== undefined) {
        await chrome.tabs.update(existing.id, { active: true });
        return;
      }
      await chrome.tabs.create({ url: targetUrl, active: true });
      return;
    } catch {
      // Fallback below
    }
  }
  window.open(targetUrl, '_blank', 'noopener,noreferrer');
}

function hasPngMagicBytes(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 8) return false;
  const b = new Uint8Array(buf, 0, 8);
  return (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  );
}

/**
 * Ensures the returned Blob contains GENUINE PNG bytes (`89 50 4E 47 ...`), transcoding
 * WebP/JPEG via `<canvas>` instead of spoofing `image/png` onto raw WebP/JPEG bytes.
 */
export function ensurePngBlob(blob: Blob): Promise<Blob> {
  const existing = cachedPngByBlob.get(blob);
  if (existing) return existing;

  const promise = (async (): Promise<Blob> => {
    const buf = await blob.arrayBuffer();
    if (hasPngMagicBytes(buf)) {
      return blob.type === 'image/png' ? blob : new Blob([buf], { type: 'image/png' });
    }

    // Transcode real WebP / JPEG / AVIF bytes into genuine PNG via Canvas when in browser context
    if (typeof document !== 'undefined' && typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          const pngBlob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob((out) => resolve(out), 'image/png')
          );
          if (pngBlob && pngBlob.size > 0) return pngBlob;
        } else {
          bitmap.close();
        }
      } catch {
        // Fall through to HTMLImageElement / mock fallback
      }
    }

    if (typeof document !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const objUrl = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('Image decode failed'));
          el.src = objUrl;
        });
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w > 0 && h > 0) {
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            const pngBlob = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob((out) => resolve(out), 'image/png')
            );
            if (pngBlob && pngBlob.size > 0) return pngBlob;
          }
        }
      } catch {
        // Headless test environment fallback below
      } finally {
        URL.revokeObjectURL(objUrl);
      }
    }

    return blob.type === 'image/png' ? blob : new Blob([buf], { type: 'image/png' });
  })().catch((err) => {
    cachedPngByBlob.delete(blob);
    throw err;
  });

  cachedPngByBlob.set(blob, promise);
  return promise;
}

/**
 * Produces a lightweight upload-safe PNG DataURL (caps longest edge to `maxEdge` when large)
 * so Steps 2 & 3 re-attach the Master Image in <1s without hitting `executeScript` arg limits,
 * while preserving the original full-resolution PNG untouched for the user's Download button.
 */
export async function downscalePngDataUrlForUpload(
  dataUrl: string,
  maxEdge = 1536
): Promise<string> {
  if (typeof document === 'undefined' || !dataUrl.startsWith('data:image/')) return dataUrl;
  if (dataUrl.length < 3_500_000) return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = dataUrl;
    });
    const nw = img.naturalWidth || img.width;
    const nh = img.naturalHeight || img.height;
    const longest = Math.max(nw, nh);
    if (longest <= maxEdge || nw < 16 || nh < 16) return dataUrl;
    const scale = maxEdge / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(16, Math.round(nw * scale));
    canvas.height = Math.max(16, Math.round(nh * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return dataUrl;
  }
}

export type ActiveChatHostKind = 'image-ai' | 'text-only-ai' | 'non-ai';

/**
 * 0ms Pre-flight host classification for the active browser tab so StyleLens NEVER wastes
 * 90 seconds trying to generate raster images inside Claude/DeepSeek/Perplexity/Kimi or
 * on a non-chat website like Google Search.
 */
export function classifyActiveChatUrl(rawUrl: string | undefined): {
  kind: ActiveChatHostKind;
  hostname: string;
  label?: string;
} {
  if (!rawUrl) return { kind: 'non-ai', hostname: '' };
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { kind: 'non-ai', hostname: parsed.protocol };
    }
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (/(?:^|\.)claude\.ai$/i.test(host)) return { kind: 'text-only-ai', hostname: host, label: 'Claude' };
    if (/(?:^|\.)deepseek\.com$/i.test(host)) return { kind: 'text-only-ai', hostname: host, label: 'DeepSeek' };
    if (/(?:^|\.)perplexity\.ai$/i.test(host)) return { kind: 'text-only-ai', hostname: host, label: 'Perplexity' };
    if (/(?:^|\.)(?:kimi\.moonshot\.cn|kimi\.com|kimi\.ai|moonshot\.cn)$/i.test(host)) {
      return { kind: 'text-only-ai', hostname: host, label: 'Kimi' };
    }

    if (
      /(?:gemini\.google|aistudio\.google|labs\.google|chatgpt\.com|chat\.openai\.com|grok\.com|copilot\.microsoft|qwen\.ai|qwenlm\.ai|qianwen\.com|tongyi\.aliyun\.com|poe\.com|mistral\.ai|hydrogen|localhost|127\.0\.0\.1)/i.test(
        host
      ) ||
      (/(?:^|\.)x\.com$/i.test(host) && path.startsWith('/i/grok'))
    ) {
      return { kind: 'image-ai', hostname: host };
    }

    // Known search/social/source sites (including non-Grok x.com routes) are never chat targets
    if (
      /(?:^|\.)(?:google\.|bing\.com|duckduckgo\.com|pinterest\.|yandex\.|youtube\.com|github\.com|x\.com)/i.test(
        host
      )
    ) {
      return { kind: 'non-ai', hostname: host };
    }

    // Allow unknown internal/enterprise AI webapps to attempt composer detection
    return { kind: 'image-ai', hostname: host };
  } catch {
    return { kind: 'non-ai', hostname: '' };
  }
}

/** Returns true when the tab is Grok (`grok.com` or `x.com/i/grok`), which requires attached images. */
export function isGrokChatUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    return /(?:^|\.)grok\.com$/i.test(host) || (/(?:^|\.)x\.com$/i.test(host) && path.startsWith('/i/grok'));
  } catch {
    return false;
  }
}

export async function getActiveTabInfo(): Promise<{ id?: number; url?: string } | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const active = tabs[0];
    return active ? { id: active.id, url: active.url } : null;
  } catch {
    return null;
  }
}

export async function extractAssistantChatImage(opts?: {
  tabId?: number;
  domId?: string;
  srcHint?: string;
  /** Paste-time run token: restricts extraction to visuals mounted after that paste. */
  runToken?: string;
}): Promise<ExtractChatImageResponse | undefined> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return undefined;
  try {
    return (await chrome.runtime.sendMessage({
      type: 'STYLELENS_EXTRACT_CHAT_IMAGE',
      tabId: opts?.tabId,
      domId: opts?.domId,
      srcHint: opts?.srcHint,
      runToken: opts?.runToken,
    })) as ExtractChatImageResponse | undefined;
  } catch {
    return undefined;
  }
}

export async function copyCapturePngToClipboard(
  record: CaptureRecord,
  overrideDataUrl?: string
): Promise<boolean> {
  try {
    if (typeof ClipboardItem === 'undefined') return false;
    let pngBlob: Blob | null = null;
    if (overrideDataUrl && overrideDataUrl.startsWith('data:image/')) {
      const resp = await fetch(overrideDataUrl);
      pngBlob = await ensurePngBlob(await resp.blob());
    } else if (record.screenshotBlob.size > 0) {
      pngBlob = await ensurePngBlob(record.screenshotBlob);
    }
    if (!pngBlob) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shared 1-click active-chat Image + Prompt injector with atomic image-first protection
 * and honest focus-safe 2-step clipboard fallback. Supports attaching an extracted Master Image
 * via `imageDataUrlOverride` so single-step Font / Background buttons never regenerate from scratch.
 */
export async function executeSendOrCopyBoth(
  record: CaptureRecord,
  promptText: string,
  currentState: ChatActionState,
  onDownloadFallback: () => Promise<void>,
  options?: { imageDataUrlOverride?: string; fileName?: string }
): Promise<{ nextState: ChatActionState; autoResetMs?: number }> {
  const resolveImageBlobAndUrl = async (): Promise<{ pngBlob: Blob | null; imageDataUrl: string }> => {
    if (options?.imageDataUrlOverride && options.imageDataUrlOverride.startsWith('data:image/')) {
      try {
        const uploadUrl = await downscalePngDataUrlForUpload(options.imageDataUrlOverride);
        const resp = await fetch(uploadUrl);
        const pngBlob = await ensurePngBlob(await resp.blob());
        return { pngBlob, imageDataUrl: uploadUrl };
      } catch {
        return { pngBlob: null, imageDataUrl: options.imageDataUrlOverride };
      }
    }
    if (record.screenshotBlob.size > 0) {
      const pngBlob = await ensurePngBlob(record.screenshotBlob);
      const imageDataUrl = await blobToDataUrl(pngBlob);
      return { pngBlob, imageDataUrl };
    }
    return { pngBlob: null, imageDataUrl: '' };
  };

  // Step 2A: copy full Style Prompt text (click restores Side Panel focus so clipboard write succeeds!)
  if (currentState.kind === 'awaiting-prompt') {
    try {
      await navigator.clipboard.writeText(promptText);
      return { nextState: { kind: 'copied-prompt' }, autoResetMs: 2600 };
    } catch {
      return { nextState: { kind: 'idle' } };
    }
  }

  // Step 2B: copy PNG image after prompt landed in chat when tab focus blocked background write
  if (currentState.kind === 'awaiting-image') {
    try {
      const { pngBlob } = await resolveImageBlobAndUrl();
      if (pngBlob && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        return { nextState: { kind: 'copied-image' }, autoResetMs: 2600 };
      }
    } catch {
      await onDownloadFallback();
    }
    return { nextState: { kind: 'idle' } };
  }

  // Step 0: Attempt atomic 1-click direct insertion into active AI chat tab (Gemini, Hydrogen, ChatGPT, Grok, Qwen)
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    try {
      const { pngBlob, imageDataUrl } = await resolveImageBlobAndUrl();
      const res = (await chrome.runtime.sendMessage({
        type: 'STYLELENS_PASTE_TO_ACTIVE_CHAT',
        imageDataUrl,
        promptText,
        requireImage: Boolean(imageDataUrl),
        fileName: options?.fileName || (options?.imageDataUrlOverride ? 'stylelens-master.png' : 'stylelens-capture.png'),
      })) as PasteToChatResponse | undefined;

      if (res?.ok && res.insertedImage && res.insertedPrompt) {
        return {
          nextState: { kind: 'sent-both', hostname: res.hostname || 'AI chat' },
          autoResetMs: 3200,
        };
      }
      if (res?.ok && res.insertedImage && !res.insertedPrompt) {
        try {
          await navigator.clipboard.writeText(promptText);
          return { nextState: { kind: 'sent-image-only' }, autoResetMs: 3200 };
        } catch {
          return { nextState: { kind: 'awaiting-prompt', imageAlreadyInChat: true } };
        }
      }
      if (res?.ok && !res.insertedImage && res.insertedPrompt) {
        try {
          if (!pngBlob || typeof ClipboardItem === 'undefined') {
            throw new Error('ClipboardItem unavailable');
          }
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
          return { nextState: { kind: 'sent-prompt-only' }, autoResetMs: 3200 };
        } catch {
          return { nextState: { kind: 'awaiting-image' } };
        }
      }
    } catch {
      // Fall through cleanly to 2-step clipboard flow
    }
  }

  // Fallback when active tab isn't an AI chat page: Step 1 copies cropped PNG image
  try {
    const { pngBlob } = await resolveImageBlobAndUrl();
    if (pngBlob && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      return { nextState: { kind: 'awaiting-prompt' } };
    }
    await navigator.clipboard.writeText(promptText);
    return { nextState: { kind: 'copied-prompt' }, autoResetMs: 2200 };
  } catch {
    try {
      await navigator.clipboard.writeText(promptText);
      return { nextState: { kind: 'copied-prompt' }, autoResetMs: 2200 };
    } catch {
      return { nextState: { kind: 'idle' } };
    }
  }
}
