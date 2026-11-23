import type { PendingCapturePayload, RawSelectionPayload } from '../types/capture';
import type {
  AssistantImageDescriptor,
  CaptureErrorCode,
  ChatProbeResponse,
  ChatSubmitResponse,
  ExtractChatImageResponse,
  OverlayCommandMessage,
  PasteToChatResponse,
  RuntimeMessage,
  ServiceWorkerBroadcastMessage,
  StartCaptureResponse,
} from '../types/messages';
import { resolveAndEmbedWebfonts } from './fontEmbedder';

const PENDING_CAPTURE_KEY = 'stylelens_pending_capture';
const MIN_CAPTURE_INTERVAL_MS = 550; // Guards Chrome's MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND (2/sec)

let lastCaptureTimestamp = 0;

function isRestrictedUrl(
  url: string | undefined,
  language: 'en' | 'zh-CN' = 'en'
): { restricted: boolean; reason?: string } {
  const isZh = language === 'zh-CN';
  if (!url) {
    return {
      restricted: true,
      reason: isZh
        ? '当前标签页没有可供扫描的网页地址。'
        : 'This tab does not expose an inspectable URL.',
    };
  }
  const blockedPrefixes = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'devtools://',
    'view-source:',
    'https://chromewebstore.google.com',
    'https://chrome.google.com/webstore',
  ];
  if (blockedPrefixes.some((prefix) => url.startsWith(prefix))) {
    return {
      restricted: true,
      reason: isZh
        ? 'Chrome 禁止扩展程序扫描浏览器内置页面和 Chrome 应用商店，请切换到普通网页标签页再试。'
        : 'Chrome blocks extensions from inspecting browser internal pages and the Chrome Web Store. Switch to a regular website tab.',
    };
  }
  return { restricted: false };
}

function extractOrigin(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function broadcastToSidePanel(message: ServiceWorkerBroadcastMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel may not be open/mounted yet — pending captures remain safely in storage.session
  });
}

async function activateOverlayInTab(
  tab: chrome.tabs.Tab,
  language?: 'en' | 'zh-CN'
): Promise<StartCaptureResponse> {
  let resolvedLanguage: 'en' | 'zh-CN' = language ?? 'en';
  if (!language) {
    try {
      const data = await chrome.storage.local.get('stylelens_ai_settings_v1');
      const saved = data['stylelens_ai_settings_v1'] as { language?: unknown } | undefined;
      if (saved?.language === 'zh-CN') resolvedLanguage = 'zh-CN';
    } catch {
      // Fallback to English if storage read fails
    }
  }
  const isZh = resolvedLanguage === 'zh-CN';

  if (tab.id === undefined) {
    return {
      ok: false,
      code: 'NO_ACTIVE_TAB',
      message: isZh ? '未找到当前活动标签页。' : 'No active browser tab found.',
    };
  }

  const check = isRestrictedUrl(tab.url, resolvedLanguage);
  if (check.restricted) {
    broadcastToSidePanel({
      type: 'STYLELENS_CAPTURE_ERROR',
      code: 'RESTRICTED_URL',
      message: check.reason ?? (isZh ? '此页面无法扫描。' : 'This page cannot be inspected.'),
    });
    return { ok: false, code: 'RESTRICTED_URL', message: check.reason };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/overlay.js'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isPermError = /Cannot access|permission|host permission|activeTab/i.test(msg);
    const origin = extractOrigin(tab.url);
    const code: CaptureErrorCode = isPermError ? 'PERMISSION_REQUIRED' : 'INJECTION_FAILED';
    const friendly = isPermError
      ? isZh
        ? 'Chrome 限制了此标签页的自动访问权限。请点击工具栏中的 StyleLens 图标（或按 Alt+Shift+S）刷新权限。'
        : 'Chrome restricted automatic access on this tab. Click the StyleLens icon in your toolbar (or press Alt+Shift+S) to refresh access on this website.'
      : isZh
        ? `无法在此标签页启动扫描，请刷新页面或点击工具栏 StyleLens 图标（${msg}）。`
        : `Could not start scan on this tab. Try reloading the page or clicking the StyleLens toolbar icon (${msg}).`;

    broadcastToSidePanel({
      type: 'STYLELENS_CAPTURE_ERROR',
      code,
      message: friendly,
      origin,
    });
    return { ok: false, code, message: friendly, origin };
  }

  try {
    const activateMsg: OverlayCommandMessage = {
      type: 'STYLELENS_OVERLAY_ACTIVATE',
      language: resolvedLanguage,
    };
    await chrome.tabs.sendMessage(tab.id, activateMsg);
    const hostname = extractOrigin(tab.url)?.replace(/^https?:\/\//, '') ?? 'active tab';
    broadcastToSidePanel({
      type: 'STYLELENS_CAPTURE_STATUS',
      status: 'selecting',
      tabHostname: hostname,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    broadcastToSidePanel({
      type: 'STYLELENS_CAPTURE_ERROR',
      code: 'INJECTION_FAILED',
      message: isZh ? `扫描层启动失败：${msg}` : `Overlay failed to start: ${msg}`,
    });
    return { ok: false, code: 'INJECTION_FAILED', message: msg };
  }
}

async function captureTabWithRateLimit(
  windowId: number,
  options: { format: 'png' | 'jpeg'; quality?: number }
): Promise<string> {
  // Always respect Chrome's MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND (2 calls / sec)
  const elapsed = Date.now() - lastCaptureTimestamp;
  if (elapsed < MIN_CAPTURE_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_CAPTURE_INTERVAL_MS - elapsed));
  }
  lastCaptureTimestamp = Date.now();
  return chrome.tabs.captureVisibleTab(windowId, options);
}

async function handleSelectionComplete(
  payload: RawSelectionPayload,
  senderTab: chrome.tabs.Tab | undefined
): Promise<void> {
  if (!senderTab || senderTab.windowId === undefined) {
    broadcastToSidePanel({
      type: 'STYLELENS_CAPTURE_ERROR',
      code: 'CAPTURE_FAILED',
      message: 'Could not identify source window for screenshot capture.',
    });
    return;
  }

  broadcastToSidePanel({ type: 'STYLELENS_CAPTURE_STATUS', status: 'capturing' });

  // Fetch & embed cross-origin @font-face binaries in parallel with viewport screenshot capture
  // (service worker bypasses `<iframe sandbox="" srcDoc>` opaque Origin: null CORS blocks!)
  const fontEmbedPromise = resolveAndEmbedWebfonts(payload.dom, payload.page.url).catch(() => null);

  let dataUrl: string;
  try {
    dataUrl = await captureTabWithRateLimit(senderTab.windowId, { format: 'png' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isQuota = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(msg);
    broadcastToSidePanel({
      type: 'STYLELENS_CAPTURE_ERROR',
      code: isQuota ? 'RATE_LIMITED' : 'CAPTURE_FAILED',
      message: isQuota
        ? 'Capture rate limit reached. Wait a moment and try again.'
        : `Screenshot capture failed: ${msg}`,
    });
    broadcastToSidePanel({ type: 'STYLELENS_CAPTURE_STATUS', status: 'idle' });
    return;
  }

  const embeddedFonts = await fontEmbedPromise;
  const enrichedDom = embeddedFonts
    ? {
        ...payload.dom,
        fontFaceRules: embeddedFonts.fontFaceRules,
        fontStylesheetUrls: embeddedFonts.fontStylesheetUrls,
      }
    : payload.dom;

  const captureId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const pending: PendingCapturePayload = {
    ...payload,
    dom: enrichedDom,
    id: captureId,
    fullViewportDataUrl: dataUrl,
  };

  try {
    await chrome.storage.session.set({ [PENDING_CAPTURE_KEY]: pending });
  } catch {
    // Fallback to JPEG quality 90 if a huge 5K PNG exceeds chrome.storage.session's 10MB quota
    try {
      const jpegUrl = await captureTabWithRateLimit(senderTab.windowId, {
        format: 'jpeg',
        quality: 90,
      });
      await chrome.storage.session.set({
        [PENDING_CAPTURE_KEY]: { ...pending, fullViewportDataUrl: jpegUrl },
      });
    } catch {
      // Final fallback: strip embedded base64 font binaries if storage.session is still tight
      try {
        const leanDom = {
          ...enrichedDom,
          fontFaceRules: (enrichedDom.fontFaceRules ?? []).filter(
            (r) => !/data:(?:font\/|application\/)/i.test(r)
          ),
        };
        const jpegUrl = await captureTabWithRateLimit(senderTab.windowId, {
          format: 'jpeg',
          quality: 85,
        });
        await chrome.storage.session.set({
          [PENDING_CAPTURE_KEY]: { ...pending, dom: leanDom, fullViewportDataUrl: jpegUrl },
        });
      } catch (fallbackErr) {
        broadcastToSidePanel({
          type: 'STYLELENS_CAPTURE_ERROR',
          code: 'CAPTURE_FAILED',
          message: `Screenshot exceeded session buffer: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
        });
        broadcastToSidePanel({ type: 'STYLELENS_CAPTURE_STATUS', status: 'idle' });
        return;
      }
    }
  }

  broadcastToSidePanel({ type: 'STYLELENS_CAPTURE_READY', captureId });
  broadcastToSidePanel({ type: 'STYLELENS_CAPTURE_STATUS', status: 'idle' });
}

// Keep manual action click handler so we both open the side panel synchronously
// AND arm the selection overlay using the freshly granted activeTab permission.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
});

chrome.action.onClicked.addListener((tab) => {
  // CRITICAL: Must be called synchronously inside the click listener to preserve user gesture!
  if (tab.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
  void activateOverlayInTab(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'start-capture') return;
  if (tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    void activateOverlayInTab(tab);
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const active = tabs[0];
    if (active?.windowId !== undefined) {
      chrome.sidePanel.open({ windowId: active.windowId }).catch(() => {});
      void activateOverlayInTab(active);
    }
  });
});

/**
 * Self-contained page injector executed via `chrome.scripting.executeScript` on the active AI
 * chat tab (Gemini, Hydrogen, ChatGPT, Claude, DeepSeek, Kimi, Perplexity).
 * Attaches the cropped PNG via synthetic `ClipboardEvent('paste')` (with `<input type="file">`
 * fallback) AND inserts the Style Prompt text cleanly in 1 single click — solving the browser/app
 * limitation where a single `Ctrl+V` discards `text/plain` when `image/png` is present.
 */
async function injectImageAndPromptIntoActiveChat(
  imageDataUrl: string,
  promptText: string,
  requireImage = false,
  fileName = 'stylelens-capture.png'
): Promise<PasteToChatResponse> {
  const hostname = window.location.hostname;

  const queryAllDeep = (root: Document | ShadowRoot, selector: string, depth = 0): HTMLElement[] => {
    const found: HTMLElement[] = [];
    if (depth > 10) return found;
    try {
      for (const el of Array.from(root.querySelectorAll(selector))) {
        if (el instanceof HTMLElement) found.push(el);
      }
      for (const node of Array.from(root.querySelectorAll('*'))) {
        if (node instanceof HTMLElement && node.id !== 'stylelens-overlay-host' && node.shadowRoot) {
          found.push(...queryAllDeep(node.shadowRoot, selector, depth + 1));
        }
      }
    } catch {
      // Ignore invalid selector/shadow root issues
    }
    return found;
  };

  const isVisibleEditable = (el: HTMLElement): boolean => {
    if (el.closest('#stylelens-overlay-host') || el.closest('[role="dialog"]')) return false;
    if (el instanceof HTMLTextAreaElement && (el.disabled || el.readOnly)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 90 || rect.height < 18) return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number.parseFloat(cs.opacity || '1') <= 0.05) {
      return false;
    }
    return true;
  };

  const isSearchLike = (el: HTMLElement): boolean => {
    const role = (el.getAttribute('role') || '').toLowerCase();
    const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''}`.toLowerCase();
    if (role === 'searchbox') return true;
    if (/\bsearch\b/.test(label) && !/\bask\b|\bprompt\b|\bmessage\b|\bchat\b/.test(label)) {
      return true;
    }
    return false;
  };

  const isKnownAiChatHost =
    /(?:gemini\.google|aistudio\.google|labs\.google|chatgpt\.com|chat\.openai\.com|claude\.ai|deepseek\.com|moonshot\.cn|kimi\.com|kimi\.ai|perplexity\.ai|poe\.com|grok\.com|copilot\.microsoft|qwen\.ai|qwenlm\.ai|qianwen\.com|tongyi\.aliyun\.com|mistral\.ai|hydrogen|v0\.dev|bolt\.new|lovable\.dev|replit\.com|localhost|127\.0\.0\.1)/i.test(
      hostname
    ) ||
    (/(?:^|\.)x\.com$/i.test(hostname) &&
      window.location.pathname.toLowerCase().startsWith('/i/grok'));

  // Tier 1A: Strict AI-chat-only signatures (safe on any domain, including internal Hydrogen/Gemini hosts)
  const strictAiOnlySelectors = [
    'rich-textarea .ql-editor[contenteditable="true"]',
    '#prompt-textarea',
    'textarea[data-testid*="prompt"]',
    'textarea[id*="prompt"]',
  ];

  // Tier 1B: Broader chat editor selectors — ONLY permitted on recognized AI chat hosts
  const broadAiChatSelectors = [
    '.ql-editor[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'textarea[placeholder*="ask" i]',
    'textarea[placeholder*="message" i]',
    'textarea[placeholder*="send" i]',
    'textarea[placeholder*="know" i]',
    '[role="textbox"][contenteditable="true"][aria-label*="prompt" i]',
    '[role="textbox"][contenteditable="true"][aria-label*="enter" i]',
    '[role="textbox"][contenteditable="true"][aria-label*="message" i]',
  ];

  const candidateSelectors = isKnownAiChatHost
    ? [...strictAiOnlySelectors, ...broadAiChatSelectors]
    : strictAiOnlySelectors;

  let editor: HTMLElement | null = null;
  for (const sel of candidateSelectors) {
    const matches = queryAllDeep(document, sel).filter((el) => isVisibleEditable(el) && !isSearchLike(el));
    if (matches.length > 0) {
      editor = matches[matches.length - 1] ?? null;
      break;
    }
  }

  // Tier 2: Currently focused editable element
  if (!editor) {
    let active: Element | null = document.activeElement;
    while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    if (
      active instanceof HTMLElement &&
      (active.tagName === 'TEXTAREA' || active.isContentEditable) &&
      isVisibleEditable(active) &&
      !isSearchLike(active)
    ) {
      const activeMeta = `${active.getAttribute('aria-label') || ''} ${active.getAttribute('placeholder') || ''} ${active.id || ''}`.toLowerCase();
      const hasPromptHint = /\b(prompt|ask|gemini|claude|chatgpt|grok|hydrogen|assistant|ai)\b/i.test(activeMeta);
      let nearFileInput = false;
      let ancestor: HTMLElement | null = active.parentElement;
      for (let depth = 0; depth < 6 && ancestor; depth++) {
        if (ancestor.querySelector('input[type="file"]')) {
          nearFileInput = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (isKnownAiChatHost || hasPromptHint || nearFileInput) {
        editor = active;
      }
    }
  }

  // Tier 3: Generic visible multiline composer — ONLY on recognized AI chat hosts
  if (!editor && isKnownAiChatHost) {
    const generic = queryAllDeep(
      document,
      '[role="textbox"][contenteditable="true"], [contenteditable="true"], textarea'
    ).filter((el) => isVisibleEditable(el) && !isSearchLike(el));

    if (generic.length > 0) {
      const vh = window.innerHeight || 800;
      generic.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const aScore = (ra.top > vh * 0.45 ? 50000 : 0) + ra.width * Math.min(ra.height, 220);
        const bScore = (rb.top > vh * 0.45 ? 50000 : 0) + rb.width * Math.min(rb.height, 220);
        return bScore - aScore;
      });
      editor = generic[0] ?? null;
    }
  }

  if (!editor) {
    return {
      ok: false,
      insertedImage: false,
      insertedPrompt: false,
      hostname,
      reason: 'NO_CHAT_INPUT',
      message: 'No active AI chat box detected on this tab.',
    };
  }

  // ATOMIC PRE-EXISTING VISUAL STAMP: mark every <img> / <canvas> / background-image tile that is
  // in this tab RIGHT NOW (document + open ShadowRoots + same-origin iframes) with this run's
  // token. The probe and the extractor ignore anything carrying the token, so an image from an
  // earlier turn in the thread can never be detected or extracted as this run's reply — no matter
  // how the sidepanel's own baseline was built or whether an old image's `src` later refreshes.
  const runToken = `sl-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const preexistingSrcs = new Set<string>();
  const rememberPreexistingSrc = (src: string | null | undefined) => {
    // Element stamps already cover inline data: URLs; only remember compact https:/blob: URLs.
    if (src && src.length <= 4096) preexistingSrcs.add(src);
  };
  const stampPreexistingVisuals = (root: Document | ShadowRoot, depth = 0): void => {
    if (depth > 10) return;
    try {
      for (const node of Array.from(root.querySelectorAll('*'))) {
        if (!node || node.nodeType !== 1) continue;
        const el = node as HTMLElement;
        if (el.id === 'stylelens-overlay-host') continue;
        const tag = el.tagName;
        try {
          if (tag === 'IMG') {
            el.setAttribute('data-stylelens-preexisting-run', runToken);
            rememberPreexistingSrc((el as HTMLImageElement).currentSrc);
            rememberPreexistingSrc((el as HTMLImageElement).src);
          } else if (tag === 'CANVAS') {
            el.setAttribute('data-stylelens-preexisting-run', runToken);
          } else if (
            el.matches('[style*="background-image"], generated-image *, single-image *')
          ) {
            el.setAttribute('data-stylelens-preexisting-run', runToken);
            const view = el.ownerDocument?.defaultView ?? window;
            const bg = el.style?.backgroundImage || view.getComputedStyle(el).backgroundImage || '';
            const bgUrl = bg.match(/url\(\s*["']?([^"')]+)["']?\s*\)/i)?.[1];
            rememberPreexistingSrc(bgUrl);
          }
        } catch {
          // Ignore read-only / detached nodes
        }
        if (el.shadowRoot) stampPreexistingVisuals(el.shadowRoot, depth + 1);
        if (tag === 'IFRAME') {
          try {
            const doc = (el as HTMLIFrameElement).contentDocument;
            if (doc) stampPreexistingVisuals(doc, depth + 1);
          } catch {
            // Cross-origin iframe
          }
        }
      }
    } catch {
      // Ignore traversal errors
    }
  };
  const commitPreexistingStamp = () => {
    stampPreexistingVisuals(document);
    try {
      (
        window as unknown as { __stylelensPreexistingRun?: { token: string; srcs: string[] } }
      ).__stylelensPreexistingRun = { token: runToken, srcs: Array.from(preexistingSrcs) };
    } catch {
      // Ignore
    }
  };
  commitPreexistingStamp();

  // Locate the tightest composer wrapper around `editor` (includes toolbar + preview tray, excludes whole chat thread)
  const findComposerContainer = (targetEditor: HTMLElement): HTMLElement => {
    const vh = window.innerHeight || 800;
    let node: Node | null = targetEditor;
    let best: HTMLElement = targetEditor;
    for (let depth = 0; depth < 8 && node; depth++) {
      if (node instanceof HTMLElement) {
        if (node === document.body || node === document.documentElement || node.tagName === 'MAIN') {
          break;
        }
        const rect = node.getBoundingClientRect();
        if (rect.height > 0 && rect.height < vh * 0.65) {
          best = node;
          if (
            node.tagName === 'FORM' ||
            node.tagName.toLowerCase() === 'input-area-v2' ||
            node.querySelector('input[type="file"], button[type="submit"], button[aria-label*="send" i]')
          ) {
            if (depth >= 2) {
              // Keep stepping 1–2 levels higher only if the parent stays compact (captures sibling preview trays)
              const parent = node.parentElement;
              if (
                parent &&
                parent !== document.body &&
                parent.tagName !== 'MAIN' &&
                parent.getBoundingClientRect().height < vh * 0.55
              ) {
                best = parent;
              }
              break;
            }
          }
        }
      }
      node = node instanceof ShadowRoot ? node.host : node.parentNode;
    }
    return best;
  };

  const composerContainer = findComposerContainer(editor);
  const editorRootNode = editor.getRootNode();
  const isNodeVisible = (el: HTMLElement): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number.parseFloat(cs.opacity || '1') > 0.05;
  };

  let insertedImage = false;
  let insertedPrompt = false;

  const composerAttachmentSelector = [
    'img[src^="blob:"]',
    'img[src^="data:image/"]',
    'img[alt*="stylelens" i]',
    '[data-testid*="attachment" i]',
    '[data-testid*="file-thumbnail" i]',
    '[data-testid*="image-preview" i]',
    '[class*="file-preview" i]',
    '[class*="attachment-preview" i]',
    '[class*="image-preview" i]',
    '[class*="upload-preview" i]',
    'button[aria-label*="remove" i]',
    'button[aria-label*="delete" i]',
    'button[title*="remove" i]',
    'button[aria-label*="移除"]',
    'button[aria-label*="删除"]',
    '[role="progressbar"]',
    '[aria-busy="true"]',
    '[class*="upload-progress" i]',
    '[class*="spinner" i]',
    'mat-progress-spinner',
  ].join(', ');

  const countAttachments = (): number => {
    let count = 0;
    try {
      const seen = new Set<Element>();
      const visitedRoots = new Set<ParentNode>();
      const addAll = (root: ParentNode, depth = 0) => {
        if (depth > 6 || visitedRoots.has(root)) return;
        visitedRoots.add(root);
        for (const el of Array.from(root.querySelectorAll(composerAttachmentSelector))) {
          if (el instanceof HTMLElement && isNodeVisible(el)) seen.add(el);
        }
        // Catch CSS background-image blob:/data: preview tiles (e.g. ChatGPT attachment thumbnails)
        for (const el of Array.from(
          root.querySelectorAll('[style*="background-image"], [class*="thumb" i], [class*="preview" i], [class*="image" i]')
        )) {
          if (!(el instanceof HTMLElement) || !isNodeVisible(el)) continue;
          const inlineBg = el.style?.backgroundImage || '';
          const bg = inlineBg || window.getComputedStyle(el).backgroundImage || '';
          if (/url\(\s*["']?(?:blob:|data:image\/)/i.test(bg)) {
            seen.add(el);
          }
        }
        // Traverse nested open ShadowRoots inside the composer (e.g. Hydrogen ucs-* web components)
        for (const node of Array.from(root.querySelectorAll('*'))) {
          if (node instanceof HTMLElement && node.id !== 'stylelens-overlay-host' && node.shadowRoot) {
            addAll(node.shadowRoot, depth + 1);
          }
        }
      };
      addAll(composerContainer);
      if (editorRootNode instanceof ShadowRoot) addAll(editorRootNode);
      count = seen.size + editor!.querySelectorAll('img').length;

      // Also detect filename chips rendered outside the editable textarea inside the composer
      const composerText = (composerContainer.textContent || '').toLowerCase();
      const editorText = (
        editor instanceof HTMLTextAreaElement ? editor.value : editor!.textContent || ''
      ).toLowerCase();
      const targetNameLower = fileName.toLowerCase();
      if (
        (composerText.includes(targetNameLower) || composerText.includes('stylelens-')) &&
        !editorText.includes(targetNameLower)
      ) {
        count += 1;
      }
    } catch {
      // Ignore query errors
    }
    return count;
  };

  // Observe composerContainer (+ nested open ShadowRoots!) for attachment/spinner deltas
  const waitForAttachmentIncrease = (before: number, maxWaitMs: number): Promise<boolean> => {
    if (countAttachments() > before) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const observers: MutationObserver[] = [];
      const watched = new Set<Node>();
      let pollId: ReturnType<typeof setInterval> | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        for (const obs of observers) obs.disconnect();
        if (pollId !== null) clearInterval(pollId);
        if (timeoutId !== null) clearTimeout(timeoutId);
        resolve(result);
      };

      const check = () => {
        if (countAttachments() > before) finish(true);
      };

      const watchNode = (target: Node | null, depth = 0) => {
        if (!target || depth > 6 || watched.has(target)) return;
        watched.add(target);
        try {
          const obs = new MutationObserver(check);
          obs.observe(target, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'style', 'class', 'aria-busy', 'hidden'],
          });
          observers.push(obs);
          if (target instanceof HTMLElement || target instanceof ShadowRoot) {
            for (const child of Array.from(target.querySelectorAll('*'))) {
              if (child instanceof HTMLElement && child.id !== 'stylelens-overlay-host' && child.shadowRoot) {
                watchNode(child.shadowRoot, depth + 1);
              }
            }
          }
        } catch {
          // Fallback to poll
        }
      };

      watchNode(composerContainer);
      if (editorRootNode instanceof ShadowRoot) watchNode(editorRootNode);

      pollId = setInterval(check, 20);
      timeoutId = setTimeout(() => finish(countAttachments() > before), maxWaitMs);
    });
  };

  const findComposerScopedFileInput = (targetEditor: HTMLElement): HTMLInputElement | null => {
    const isImageFileInput = (el: Element): el is HTMLInputElement => {
      if (!(el instanceof HTMLInputElement) || el.type !== 'file' || el.disabled) return false;
      const meta = `${el.id} ${el.name} ${el.className} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-testid') || ''}`.toLowerCase();
      if (/\b(?:avatar|profile|logo|wallpaper|theme|banner|icon)\b/.test(meta)) return false;
      const acc = (el.accept || '').toLowerCase();
      return !acc || acc.includes('image') || acc.includes('*') || acc.includes('.png');
    };

    const scoreInput = (input: HTMLInputElement, edCenterY: number): number => {
      const acc = (input.accept || '').toLowerCase();
      let score = 0;
      if (acc.includes('image') || acc.includes('.png')) score += 200;
      if (composerContainer.contains(input)) score += 500;
      const r = input.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        score -= Math.min(300, Math.abs(r.top - edCenterY) * 0.5);
      }
      return score;
    };

    const edRect = targetEditor.getBoundingClientRect();
    const edCenterY = edRect.top + edRect.height / 2;

    // Walk up up to 10 ancestors (do NOT break early on <form> if nothing found inside <form>!)
    let current: Node | null = targetEditor;
    for (let depth = 0; depth < 10 && current; depth++) {
      if (
        current instanceof HTMLElement &&
        (current === document.body || current === document.documentElement)
      ) {
        break;
      }
      if (current instanceof HTMLElement || current instanceof ShadowRoot) {
        const localInputs = Array.from(current.querySelectorAll('input[type="file"]')).filter(
          isImageFileInput
        );
        if (localInputs.length > 0) {
          localInputs.sort((a, b) => scoreInput(b, edCenterY) - scoreInput(a, edCenterY));
          return localInputs[0] ?? null;
        }
      }
      current = current instanceof ShadowRoot ? current.host : current.parentNode;
    }

    // On recognized AI chat hosts, rank all valid page-level image inputs (handles multi-input UIs like Grok & ChatGPT!)
    if (isKnownAiChatHost) {
      const allPageInputs = queryAllDeep(document, 'input[type="file"]').filter(isImageFileInput);
      if (allPageInputs.length > 0) {
        allPageInputs.sort((a, b) => scoreInput(b, edCenterY) - scoreInput(a, edCenterY));
        return allPageInputs[0] ?? null;
      }
    }
    return null;
  };

  const snapshotComposerUserSrcs = () => {
    try {
      const w = window as unknown as {
        __stylelensKnownUserSrcs?: string[];
        __stylelensLastPromptSnippet?: string;
      };
      const existing = new Set<string>(w.__stylelensKnownUserSrcs ?? []);
      const scan = (root: ParentNode) => {
        for (const img of Array.from(root.querySelectorAll('img'))) {
          if (img.currentSrc) existing.add(img.currentSrc);
          if (img.src) existing.add(img.src);
        }
      };
      scan(composerContainer);
      if (editorRootNode instanceof ShadowRoot) scan(editorRootNode);
      w.__stylelensKnownUserSrcs = Array.from(existing).slice(-30);
      if (promptText.trim()) {
        w.__stylelensLastPromptSnippet = promptText
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 32)
          .toLowerCase();
      }
    } catch {
      // Ignore snapshot errors
    }
  };

  // Step A: Zero-double-attach 3-stage cascade (`paste` -> `<input type="file">` -> `DragEvent('drop')`)
  const hasImagePayload = Boolean(imageDataUrl && imageDataUrl.startsWith('data:image/'));
  if (hasImagePayload) {
    try {
      const commaIdx = imageDataUrl.indexOf(',');
      const mimeMatch = imageDataUrl.slice(0, Math.max(0, commaIdx)).match(/^data:(image\/[a-z0-9.+-]+);base64$/i);
      const fileMime = mimeMatch?.[1]?.toLowerCase() || 'image/png';
      const b64 = commaIdx >= 0 ? imageDataUrl.slice(commaIdx + 1) : '';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      const makeTransfer = () => {
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], fileName, { type: fileMime }));
        return dt;
      };

      const beforeCount = countAttachments();

      // Stage 1: Synthetic ClipboardEvent('paste')
      editor.focus();
      const pasteDt = makeTransfer();
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: pasteDt,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      editor.dispatchEvent(pasteEvent);

      const attachedViaPaste = await waitForAttachmentIncrease(
        beforeCount,
        pasteEvent.defaultPrevented ? 1500 : 900
      );
      if (attachedViaPaste) {
        insertedImage = true;
      }

      // Stage 2: Ranked composer/page `<input type="file">` (ONLY if Stage 1 yielded 0 attachment delta!)
      if (!insertedImage) {
        const targetInput = findComposerScopedFileInput(editor);
        if (targetInput) {
          const inputDt = makeTransfer();
          try {
            targetInput.value = '';
          } catch {
            // Ignore read-only reset
          }
          const filesSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'files'
          )?.set;
          if (filesSetter) filesSetter.call(targetInput, inputDt.files);
          else targetInput.files = inputDt.files;
          targetInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          targetInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          insertedImage = await waitForAttachmentIncrease(beforeCount, 950);
        }
      }

      // Stage 3: Synthetic DragEvent('dragenter' -> 'dragover' -> 'drop') (ONLY if Stages 1 & 2 yielded 0 delta!)
      if (!insertedImage) {
        const dropTargets =
          composerContainer !== editor ? [editor, composerContainer] : [editor];
        for (const dropTarget of dropTargets) {
          const dropDt = makeTransfer();
          for (const type of ['dragenter', 'dragover', 'drop'] as const) {
            dropTarget.dispatchEvent(
              new DragEvent(type, {
                dataTransfer: dropDt,
                bubbles: true,
                cancelable: true,
                composed: true,
              })
            );
          }
          if (await waitForAttachmentIncrease(beforeCount, 1200)) {
            insertedImage = true;
            break;
          }
        }
      }
    } catch {
      insertedImage = false;
    }
  }

  // ATOMIC IMAGE-FIRST GATE: If an image was required and failed to attach, ABORT BEFORE Step B!
  // Never leave an orphan "Create 1 edited image from the attached picture" prompt sitting in Grok/ChatGPT!
  if (requireImage && hasImagePayload && !insertedImage) {
    return {
      ok: false,
      insertedImage: false,
      insertedPrompt: false,
      hostname,
      reason: 'IMAGE_NOT_ATTACHED',
      message: 'Could not attach reference image to this chat composer.',
    };
  }

  // Step B: Fast atomic Style Prompt insertion (preserving any text the user already typed)
  if (promptText) {
    // Strip leading Markdown heading markers & emphasis characters so ProseMirror/Quill/TipTap
    // rich formatting does NOT trigger a false-negative probe mismatch and duplicate paste!
    const cleanForProbe = (s: string) => s.replace(/[*_`~]+/g, '').trim();
    const probeLine =
      promptText
        .split('\n')
        .map((line) => cleanForProbe(line.replace(/^#+\s*/, '')))
        .find((line) => line.length >= 12) ?? cleanForProbe(promptText);
    const probe = probeLine.slice(0, 24).trim();
    editor.focus();

    if (editor instanceof HTMLTextAreaElement) {
      const existing = editor.value || '';
      const nextVal = existing.trim().length > 0 ? `${existing}\n\n${promptText}` : promptText;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(editor, nextVal);
      else editor.value = nextVal;

      editor.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertFromPaste',
          data: promptText,
        })
      );
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
      insertedPrompt = cleanForProbe(editor.value).includes(probe);
    } else {
      const getText = () => editor!.innerText || editor!.textContent || '';
      const existing = getText().trim();
      const textToInsert = existing.length > 0 ? `\n\n${promptText}` : promptText;

      const moveCaretToEnd = () => {
        try {
          const rootNode = editor!.getRootNode();
          const shadowSel =
            rootNode instanceof ShadowRoot &&
            typeof (rootNode as ShadowRoot & { getSelection?: () => Selection | null }).getSelection ===
              'function'
              ? (rootNode as ShadowRoot & { getSelection: () => Selection | null }).getSelection()
              : null;
          const sel = shadowSel ?? window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editor!);
          range.collapse(false);
          sel?.removeAllRanges();
          sel?.addRange(range);
        } catch {
          // Ignore selection errors
        }
      };

      // Strategy 1 (FASTEST — ~15ms atomic Quill/ProseMirror transaction)
      moveCaretToEnd();
      try {
        const textDt = new DataTransfer();
        textDt.setData('text/plain', textToInsert);
        editor.dispatchEvent(
          new ClipboardEvent('paste', {
            clipboardData: textDt,
            bubbles: true,
            cancelable: true,
            composed: true,
          })
        );
      } catch {
        // Fallback below
      }
      await new Promise((r) => setTimeout(r, 30));
      insertedPrompt = cleanForProbe(getText()).includes(probe);

      // Strategy 2: Native insertText fallback
      if (!insertedPrompt) {
        moveCaretToEnd();
        try {
          document.execCommand('insertText', false, textToInsert);
        } catch {
          // Fallback below
        }
        await new Promise((r) => setTimeout(r, 35));
        insertedPrompt = cleanForProbe(getText()).includes(probe);
      }

      // Strategy 3: Direct text node + InputEvent
      if (!insertedPrompt) {
        try {
          editor.appendChild(document.createTextNode(textToInsert));
          editor.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              composed: true,
              inputType: 'insertText',
              data: textToInsert,
            })
          );
        } catch {
          // Give up cleanly
        }
        await new Promise((r) => setTimeout(r, 90));
        insertedPrompt = cleanForProbe(getText()).includes(probe);
      }
    }
  }

  snapshotComposerUserSrcs();
  // Re-stamp right before handing control back (Send has NOT been pressed yet), so the composer's
  // freshly attached upload preview is also recorded as pre-existing.
  commitPreexistingStamp();

  return {
    ok: insertedImage || insertedPrompt,
    insertedImage,
    insertedPrompt,
    hostname,
    runToken,
  };
}

/**
 * Self-contained page injector: presses the AI chat's Send button (waiting while an attached image
 * is still uploading and the button is disabled), falling back to a synthetic Enter key press.
 * Success is verified by the composer clearing.
 */
async function submitActiveChatComposer(): Promise<ChatSubmitResponse> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const queryAllDeep = (root: Document | ShadowRoot, selector: string, depth = 0): HTMLElement[] => {
    const found: HTMLElement[] = [];
    if (depth > 10) return found;
    try {
      for (const el of Array.from(root.querySelectorAll(selector))) {
        if (el instanceof HTMLElement) found.push(el);
      }
      for (const node of Array.from(root.querySelectorAll('*'))) {
        if (node instanceof HTMLElement && node.id !== 'stylelens-overlay-host' && node.shadowRoot) {
          found.push(...queryAllDeep(node.shadowRoot, selector, depth + 1));
        }
      }
    } catch {
      // ignore
    }
    return found;
  };
  const isVisible = (el: HTMLElement): boolean => {
    if (el.closest('#stylelens-overlay-host') || el.closest('[role="dialog"]')) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number.parseFloat(cs.opacity || '1') > 0.05;
  };
  const isSearchLike = (el: HTMLElement): boolean => {
    const role = (el.getAttribute('role') || '').toLowerCase();
    const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''}`.toLowerCase();
    if (role === 'searchbox') return true;
    return /\bsearch\b/.test(label) && !/\bask\b|\bprompt\b|\bmessage\b|\bchat\b/.test(label);
  };
  const editorSelectors = [
    'rich-textarea .ql-editor[contenteditable="true"]',
    '#prompt-textarea',
    'textarea[data-testid*="prompt"]',
    'textarea[id*="prompt"]',
    '.ql-editor[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'textarea[placeholder*="ask" i]',
    'textarea[placeholder*="message" i]',
    'textarea[placeholder*="send" i]',
    'textarea[placeholder*="know" i]',
    '[role="textbox"][contenteditable="true"]',
    'textarea',
    '[contenteditable="true"]',
  ];
  let editor: HTMLElement | null = null;
  for (const sel of editorSelectors) {
    const matches = queryAllDeep(document, sel).filter(
      (el) =>
        isVisible(el) &&
        !isSearchLike(el) &&
        !(el instanceof HTMLTextAreaElement && (el.disabled || el.readOnly)) &&
        el.getBoundingClientRect().width >= 90 &&
        el.getBoundingClientRect().height >= 18
    );
    if (matches.length > 0) {
      editor = matches[matches.length - 1] ?? null;
      break;
    }
  }
  if (!editor) return { ok: false, reason: 'NO_CHAT_INPUT' };
  const ed = editor;
  const getText = () =>
    ed instanceof HTMLTextAreaElement ? ed.value : ed.innerText || ed.textContent || '';
  const waitCleared = async (ms: number): Promise<boolean> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (getText().trim().length === 0) return true;
      await sleep(100);
    }
    return getText().trim().length === 0;
  };
  if (getText().trim().length === 0) return { ok: false, reason: 'EMPTY_COMPOSER' };

  const labelOf = (el: HTMLElement): string =>
    `${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-testid') || ''} ${el.getAttribute('title') || ''} ${el.id || ''} ${typeof el.className === 'string' ? el.className : ''} ${(el.textContent || '').trim().slice(0, 24)}`.toLowerCase();
  const isDisabled = (el: HTMLElement): boolean =>
    (el instanceof HTMLButtonElement && el.disabled) ||
    el.hasAttribute('disabled') ||
    el.getAttribute('aria-disabled') === 'true';
  const isSendLike = (el: HTMLElement): boolean => {
    const label = labelOf(el);
    if (
      /\bstop\b|stop[-_]?button|stopbutton|停止|中止|attach|upload|voice|mic|dictat|feedback|report|share|copy|edit|retry|regenerate|new chat|cancel|remove|delete|clear|close|dismiss|移除|删除|think|search|deepsearch|model|tool|canvas|menu|more/.test(
        label
      )
    ) {
      return false;
    }
    // Check explicit attribute type="submit" ONLY (NOT `.type === 'submit'`, which HTML defaults
    // on EVERY <button> inside a <form> that omits type="button", such as Remove Attachment buttons!)
    if (el instanceof HTMLButtonElement && el.getAttribute('type')?.toLowerCase() === 'submit') {
      return true;
    }
    return /\bsend\b|send[-_]?button|sendbutton|submit|发送|提交|\bask\b/.test(label);
  };
  const isNearEditor = (el: HTMLElement): boolean => {
    const edRect = ed.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // Handles tall multi-line editors (>= 260px height!) by checking overlap/proximity to editor edges
    return r.top < edRect.bottom + 240 && r.bottom > edRect.top - 240;
  };
  const findComposerContainer = (): HTMLElement | null => {
    const vh = window.innerHeight || 800;
    let node: Node | null = ed;
    let best: HTMLElement | null = null;
    for (let depth = 0; depth < 7 && node; depth++) {
      if (node instanceof HTMLElement) {
        if (node === document.body || node.tagName === 'MAIN') break;
        if (node.getBoundingClientRect().height < vh * 0.65) {
          best = node;
        }
        if (node.tagName === 'FORM' || node.tagName.toLowerCase() === 'input-area-v2') break;
      }
      node = node instanceof ShadowRoot ? node.host : node.parentNode;
    }
    return best;
  };
  const isAttachmentStillUploading = (): boolean => {
    const box = findComposerContainer();
    if (!box) return false;
    const spinners = Array.from(
      box.querySelectorAll(
        '[role="progressbar"], [aria-busy="true"], [aria-label*="uploading" i], [class*="upload-progress" i], [class*="spinner" i], mat-progress-spinner'
      )
    );
    return spinners.some((s) => s instanceof HTMLElement && isVisible(s));
  };
  const hasStopControl = (): boolean =>
    queryAllDeep(document, 'button, [role="button"]').some((el) => {
      if (!isVisible(el)) return false;
      const label = labelOf(el);
      const hasStopIcon = Boolean(el.querySelector('mat-icon[fonticon="stop"], mat-icon[fonticon="stop_circle"]'));
      return hasStopIcon || /\bstop\b|stop[-_]?button|stopbutton|停止|中止/.test(label);
    });
  const findSendButton = (): HTMLElement | null => {
    let node: Node | null = ed;
    for (let depth = 0; depth < 8 && node; depth++) {
      if (node instanceof HTMLElement && (node === document.body || node.tagName === 'MAIN')) break;
      if (node instanceof HTMLElement || node instanceof ShadowRoot) {
        const buttons = Array.from(node.querySelectorAll('button, [role="button"]')).filter(
          (b): b is HTMLElement => b instanceof HTMLElement && isVisible(b) && isSendLike(b) && isNearEditor(b)
        );
        if (buttons.length > 0) return buttons[buttons.length - 1] ?? null;
      }
      if (node instanceof HTMLElement && node.tagName === 'FORM') break;
      node = node instanceof ShadowRoot ? node.host : node.parentNode;
    }
    const global = queryAllDeep(
      document,
      'button[type="submit"], button[data-testid="send-button"], #composer-submit-button, button.send-button, button[aria-label*="Send" i], button[aria-label*="Submit" i], button[aria-label*="发送"]'
    ).filter((b) => isVisible(b) && isSendLike(b) && isNearEditor(b));
    return global[global.length - 1] ?? null;
  };
  const pressEnter = () => {
    ed.focus();
    const init: KeyboardEventInit = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    ed.dispatchEvent(new KeyboardEvent('keydown', init));
    ed.dispatchEvent(new KeyboardEvent('keypress', init));
    ed.dispatchEvent(new KeyboardEvent('keyup', init));
  };
  const snapshotAndResetWatch = () => {
    const w = window as unknown as {
      __stylelensChatWatch?: { last: number };
      __stylelensKnownUserSrcs?: string[];
      __stylelensLastPromptSnippet?: string;
    };
    if (w.__stylelensChatWatch) w.__stylelensChatWatch.last = Date.now();
    try {
      const box = findComposerContainer();
      if (box) {
        const existing = new Set<string>(w.__stylelensKnownUserSrcs ?? []);
        for (const img of Array.from(box.querySelectorAll('img'))) {
          if (img.currentSrc) existing.add(img.currentSrc);
          if (img.src) existing.add(img.src);
        }
        w.__stylelensKnownUserSrcs = Array.from(existing).slice(-30);
      }
      const curText = getText().replace(/\s+/g, ' ').trim();
      if (curText) w.__stylelensLastPromptSnippet = curText.slice(0, 32).toLowerCase();
    } catch {
      // ignore
    }
  };

  // Let pasted PNG attachment finish its initial upload handshake before clicking Send
  const uploadWaitStart = Date.now();
  while (Date.now() - uploadWaitStart < 10000 && isAttachmentStillUploading()) {
    await sleep(200);
  }
  await sleep(300);

  const start = Date.now();
  let triedDisabledEnter = false;
  // Up to 45s: the attached screenshot may still be uploading (Send stays disabled until it finishes)
  while (Date.now() - start < 45000) {
    if (isAttachmentStillUploading() || hasStopControl()) {
      await sleep(250);
      continue;
    }
    const btn = findSendButton();
    if (btn && !isDisabled(btn)) {
      snapshotAndResetWatch();
      btn.click();
      if (await waitCleared(3500)) {
        snapshotAndResetWatch();
        return { ok: true, method: 'button' };
      }
    } else if (btn && isDisabled(btn) && !triedDisabledEnter && Date.now() - start > 4000) {
      triedDisabledEnter = true;
      snapshotAndResetWatch();
      pressEnter();
      if (await waitCleared(2000)) {
        snapshotAndResetWatch();
        return { ok: true, method: 'enter-key' };
      }
    } else if (!btn && Date.now() - start > 1500) {
      snapshotAndResetWatch();
      pressEnter();
      if (await waitCleared(2000)) {
        snapshotAndResetWatch();
        return { ok: true, method: 'enter-key' };
      }
    }
    await sleep(250);
  }
  if (!hasStopControl()) {
    snapshotAndResetWatch();
    pressEnter();
    if (await waitCleared(2500)) {
      snapshotAndResetWatch();
      return { ok: true, method: 'enter-key' };
    }
  }
  return { ok: false, reason: 'SEND_NOT_CONFIRMED' };
}

/**
 * Self-contained page probe: reports whether the AI is still answering (Stop control, active
 * progress/shimmer/skeleton/lottie placeholders, unfinished `<generated-image>`, or downloading
 * assistant images), how long the conversation (including open ShadowRoots) has been quiet, and
 * ordered identity descriptors (`assistantImages`) + `largeImageCount` for all rendered AI outputs.
 * When `runToken` is given, any visual stamped with it at paste time (or re-mounted with a `src`
 * that existed at paste time) is skipped, so only this run's brand-new reply images are reported.
 */
function probeChatGenerationState(runToken = ''): ChatProbeResponse {
  const isElem = (node: unknown): node is HTMLElement =>
    Boolean(node && typeof node === 'object' && (node as Node).nodeType === 1);

  const queryAllDeep = (root: Document | ShadowRoot, selector: string, depth = 0): HTMLElement[] => {
    const found: HTMLElement[] = [];
    if (depth > 10) return found;
    try {
      for (const el of Array.from(root.querySelectorAll(selector))) {
        if (isElem(el)) found.push(el);
      }
      for (const node of Array.from(root.querySelectorAll('*'))) {
        if (isElem(node) && node.id !== 'stylelens-overlay-host') {
          if (node.shadowRoot) {
            found.push(...queryAllDeep(node.shadowRoot, selector, depth + 1));
          }
          if (node.tagName === 'IFRAME') {
            try {
              const doc = (node as HTMLIFrameElement).contentDocument;
              if (doc) found.push(...queryAllDeep(doc, selector, depth + 1));
            } catch {
              // Cross-origin iframe
            }
          }
        }
      }
    } catch {
      // ignore
    }
    return found;
  };
  // Crosses open ShadowRoot boundaries (unlike native `el.closest()`, which stops at ShadowRoot!)
  const closestDeep = (el: Element | null, selector: string): Element | null => {
    let cur: Node | null = el;
    for (let depth = 0; depth < 32 && cur; depth++) {
      if (isElem(cur)) {
        try {
          const hit = cur.closest(selector);
          if (hit) return hit;
        } catch {
          // ignore selector error
        }
        const root = cur.getRootNode?.();
        if (root && typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot && root.host) {
          cur = root.host;
          continue;
        }
        return null;
      }
      if (typeof ShadowRoot !== 'undefined' && cur instanceof ShadowRoot) {
        cur = cur.host;
      } else {
        cur = cur.parentNode;
      }
    }
    return null;
  };
  const isVisible = (el: HTMLElement): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const view = el.ownerDocument?.defaultView ?? window;
    const cs = view.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number.parseFloat(cs.opacity || '1') > 0.05;
  };

  // STRICT user-turn selector ONLY — NEVER put bare `[class*="attachment" i]` here because
  // Gemini/ChatGPT wrap generated assistant images in attachment/media containers!
  const strictUserTurnSelector =
    'user-query, user-query-content, [data-message-author-role="user"], [data-testid*="user-message" i], [data-testid*="user-turn" i], [data-author="user"], [data-role="user"], [class*="user-query" i], [class*="user-message" i], [class*="userMessage"], [class*="user-turn" i], [class*="message-user" i], [class*="chat-item-user" i]';

  // Positive assistant response & generated-image container whitelist
  const assistantContainerSelector =
    'model-response, response-container, generated-image, single-image, ucs-response-image, image-generation-response, response-element, structured-content-container, message-content, [data-message-author-role="assistant"], [data-message-author-role="model"], [data-testid*="assistant" i], [data-testid*="model-response" i], [data-testid*="generated-image" i], [data-author="assistant"], [data-author="model"], [data-role="assistant"], [class*="model-response" i], [class*="response-container" i], [class*="assistant-message" i], [class*="assistantMessage"], [class*="bot-message" i], [class*="generated-image" i], [class*="generated_image" i], [class*="single-image" i]';

  const strictComposerSelector =
    'input-area-v2, [data-testid*="composer" i], rich-textarea, .ql-editor, #prompt-textarea, textarea, div.ProseMirror, [contenteditable="true"], [class*="input-area" i], [class*="composer" i]';

  const isInsideComposer = (el: Element | null): boolean => {
    if (!el) return false;
    if (closestDeep(el, strictComposerSelector)) return true;
    const form = closestDeep(el, 'form');
    if (form && isElem(form)) {
      const vh = window.innerHeight || 800;
      const hasEditor = Boolean(
        form.querySelector('rich-textarea, textarea, div.ProseMirror, [contenteditable="true"], [role="textbox"]')
      );
      if (
        hasEditor &&
        form.getBoundingClientRect().height < vh * 0.65 &&
        !form.querySelector(strictUserTurnSelector) &&
        !form.querySelector(assistantContainerSelector)
      ) {
        return true;
      }
    }
    return false;
  };

  type WatchState = {
    last: number;
    observer: MutationObserver | null;
    observed: WeakSet<Node>;
  };
  const w = window as unknown as {
    __stylelensChatWatch?: WatchState;
    __stylelensKnownUserSrcs?: string[];
    __stylelensLastPromptSnippet?: string;
    __stylelensNextImgId?: number;
    __stylelensPreexistingRun?: { token: string; srcs: string[] };
  };

  // Paste-time stamp check: a visual that existed before this run's prompt was pasted is never a reply.
  const preexistingSrcs = new Set<string>(
    runToken && w.__stylelensPreexistingRun?.token === runToken
      ? w.__stylelensPreexistingRun.srcs
      : []
  );
  const isStampedPreexisting = (el: Element): boolean =>
    Boolean(runToken) && el.getAttribute('data-stylelens-preexisting-run') === runToken;
  const isPreexistingSrc = (src: string | undefined): boolean =>
    Boolean(src) && preexistingSrcs.has(src as string);

  const ensureDomId = (el: HTMLElement): string => {
    const existing = el.getAttribute('data-stylelens-img-id');
    if (existing) return existing;
    const next = (w.__stylelensNextImgId ?? 0) + 1;
    w.__stylelensNextImgId = next;
    const id = `sl-img-${next}`;
    try {
      el.setAttribute('data-stylelens-img-id', id);
    } catch {
      // ignore read-only attributes
    }
    return id;
  };

  const attachWatchToRoot = (state: WatchState, root: Node | null) => {
    if (!root || !state.observer || state.observed.has(root)) return;
    try {
      state.observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        // Never watch 'class'/'style' globally or hover/shimmer animations pin quietMs === 0!
        attributeFilter: ['src', 'srcset', 'aria-busy', 'data-is-streaming', 'data-state'],
      });
      state.observed.add(root);
    } catch {
      // ignore
    }
  };

  if (!w.__stylelensChatWatch) {
    const state: WatchState = {
      last: Date.now(),
      observer: null,
      observed: new WeakSet<Node>(),
    };
    try {
      state.observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          const target = m.target instanceof Element ? m.target : m.target.parentElement;
          if (isInsideComposer(target)) continue;
          state.last = Date.now();
          return;
        }
      });
      attachWatchToRoot(state, document.body);
    } catch {
      // ignore
    }
    w.__stylelensChatWatch = state;
  }

  // Also observe newly mounted open ShadowRoots (e.g. Gemini / Hydrogen image-generation containers)
  const watchShadowRoots = (root: Document | ShadowRoot, depth = 0) => {
    if (depth > 8 || !w.__stylelensChatWatch) return;
    try {
      for (const node of Array.from(root.querySelectorAll('*'))) {
        if (node instanceof HTMLElement && node.id !== 'stylelens-overlay-host' && node.shadowRoot) {
          if (!isInsideComposer(node)) {
            attachWatchToRoot(w.__stylelensChatWatch, node.shadowRoot);
          }
          watchShadowRoots(node.shadowRoot, depth + 1);
        }
      }
    } catch {
      // ignore
    }
  };
  watchShadowRoots(document);

  const hasStopButton = queryAllDeep(document, 'button, [role="button"]').some((el) => {
    if (!isVisible(el) || el.closest('[role="dialog"]')) return false;
    const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-testid') || ''} ${el.getAttribute('title') || ''} ${(el.textContent || '').trim().slice(0, 24)}`.toLowerCase();
    const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    if (/\bstop\b|stop[-_]?button|stopbutton|cancel.*(?:generat|response)|停止|中止/.test(label)) {
      return true;
    }
    if (/\bstop-button\b|\bstop\b|stopbutton/.test(cls)) return true;
    const matIcon = el.querySelector('mat-icon');
    if (matIcon) {
      const fi = (matIcon.getAttribute('fonticon') || matIcon.textContent || '').trim().toLowerCase();
      if (fi === 'stop' || fi === 'stop_circle') return true;
    }
    // Icon-only SVG square Stop button inside composer (e.g. Grok/Qwen unlabelled Stop square)
    if (
      isInsideComposer(el) &&
      !/attach|upload|voice|mic|send|submit|plus|add|close|remove|delete|copy|share|edit|like|dislike|download|menu|more|model|think|search|tool/.test(
        `${label} ${cls}`
      )
    ) {
      const br = el.getBoundingClientRect();
      if (br.width <= 56 && br.height <= 56) {
        const rectNode = el.querySelector('svg rect');
        if (rectNode) {
          const rr = rectNode.getBoundingClientRect();
          if (rr.width >= 6 && rr.height >= 6 && rr.width <= 22 && Math.abs(rr.width - rr.height) <= 3) {
            return true;
          }
        }
      }
    }
    return false;
  });

  const hasConversationSpinner =
    queryAllDeep(
      document,
      '[role="progressbar"], [aria-busy="true"], ucs-image-generation-loading, mat-progress-spinner, mat-progress-bar, lottie-animation, [class*="shimmer" i], [data-is-streaming="true"], [class*="image-generation"][class*="loading" i], [class*="image-generation"][class*="progress" i], [class*="loading-image" i], [class*="thinking-indicator" i], model-response [class*="loading-indicator" i], model-response [class*="skeleton" i], model-response [class*="generating" i], response-container [class*="skeleton" i]'
    ).some((el) => isVisible(el) && !isInsideComposer(el) && !el.closest('[role="dialog"]')) ||
    // Unfinished Gemini <generated-image> / <single-image> containers (walks nested open ShadowRoots too,
    // and never pins generating=true on errored/failed image containers!)
    queryAllDeep(document, 'generated-image, single-image').some((container) => {
      if (!isVisible(container) || isInsideComposer(container) || container.closest('[role="dialog"]')) {
        return false;
      }
      const collectInner = (root: Element | ShadowRoot, sel: string, d = 0): HTMLElement[] => {
        const out: HTMLElement[] = [];
        if (d > 6) return out;
        for (const el of Array.from(root.querySelectorAll(sel))) {
          if (el instanceof HTMLElement) out.push(el);
        }
        if (root instanceof HTMLElement && root.shadowRoot) {
          out.push(...collectInner(root.shadowRoot, sel, d + 1));
        }
        for (const child of Array.from(root.querySelectorAll('*'))) {
          if (child instanceof HTMLElement && child.shadowRoot) {
            out.push(...collectInner(child.shadowRoot, sel, d + 1));
          }
        }
        return out;
      };
      const innerImgs = collectInner(container, 'img').filter(
        (n): n is HTMLImageElement => n.tagName === 'IMG'
      );
      const innerCanvases = collectInner(container, 'canvas').filter(
        (n): n is HTMLCanvasElement => n.tagName === 'CANVAS'
      );
      const hasFinishedImg = innerImgs.some(
        (img) => img.complete && img.naturalWidth >= 60 && img.naturalHeight >= 20
      );
      const hasFinishedCanvas = innerCanvases.some((c) => c.width >= 60 && c.height >= 20);
      if (hasFinishedImg || hasFinishedCanvas) return false;

      // Never treat a broken/errored <img> or text-only error card (without a spinner) as still loading
      const hasErroredImg = innerImgs.some(
        (img) => img.complete && Boolean(img.currentSrc || img.src) && img.naturalWidth === 0
      );
      if (hasErroredImg) return false;
      const hasInnerSpinner =
        collectInner(
          container,
          '[role="progressbar"], [aria-busy="true"], [class*="shimmer" i], [class*="loading" i], [class*="spinner" i], mat-progress-spinner, mat-progress-bar, lottie-animation'
        ).length > 0;
      const containerText = (container.textContent || '').trim();
      if (
        !hasInnerSpinner &&
        /unable to generate|something went wrong|couldn['’]t generate|failed to generate|生成失败|无法生成/i.test(
          containerText
        )
      ) {
        return false;
      }
      return hasInnerSpinner || innerImgs.some((img) => !img.complete) || containerText.length === 0;
    });

  const knownUserSrcs = new Set<string>(w.__stylelensKnownUserSrcs ?? []);
  const lastSnippet = (w.__stylelensLastPromptSnippet || '').trim();
  const vh = window.innerHeight || 800;

  const isProbableUnannotatedUserThumbnail = (el: HTMLElement, r: DOMRect): boolean => {
    if (
      el.closest('[data-testid*="file-thumbnail" i], [class*="file-preview" i]') &&
      Math.max(r.width, r.height) < 180
    ) {
      return true;
    }
    // Check if the nearest compact turn wrapper contains our exact sent prompt snippet (Tailwind-only Grok user turn)
    // Strictly bounded to compact thumbnail sizes (<260px) so a large generated Grok image (e.g. 384x384)
    // inside a shared turn wrapper is NEVER dropped!
    if (lastSnippet.length >= 14 && Math.max(r.width, r.height) < 260) {
      let cur: HTMLElement | null = el.parentElement;
      for (let d = 0; d < 5 && cur; d++) {
        if (cur === document.body || cur.tagName === 'MAIN') break;
        const cr = cur.getBoundingClientRect();
        if (cr.height > 0 && cr.height < vh * 0.65) {
          const normText = (cur.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          if (normText.includes(lastSnippet)) {
            const largeImgsInWrapper = Array.from(cur.querySelectorAll('img')).filter((img) => {
              const ir = img.getBoundingClientRect();
              return Math.max(ir.width, ir.height) >= 260;
            }).length;
            if (largeImgsInWrapper === 0) return true;
          }
        }
        cur = cur.parentElement;
      }
    }
    // Row-relative flush-right thumbnail guard (never drops centered or narrow split-screen assistant images!)
    if (r.width < 220 && r.height < 220) {
      let row: HTMLElement | null = el.parentElement;
      for (let d = 0; d < 5 && row; d++) {
        if (row === document.body) break;
        const rr = row.getBoundingClientRect();
        if (rr.width >= 320 && rr.height < vh * 0.7) {
          const leftMargin = r.left - rr.left;
          const rightMargin = rr.right - r.right;
          if (leftMargin > Math.max(24, rightMargin * 2.2) && leftMargin > rr.width * 0.35) {
            return true;
          }
          break;
        }
        row = row.parentElement;
      }
    }
    return false;
  };

  let hasLoadingAssistantImage = false;
  const assistantImages: AssistantImageDescriptor[] = [];
  const seenKeys = new Set<string>();

  // 1. Scan <img> elements across document + open ShadowRoots + same-origin iframes
  for (const rawEl of queryAllDeep(document, 'img')) {
    if (rawEl.tagName !== 'IMG') continue;
    const el = rawEl as HTMLImageElement;
    if (isStampedPreexisting(el)) continue;
    if (closestDeep(el, '#stylelens-overlay-host') || closestDeep(el, '[role="dialog"]')) continue;
    if (isInsideComposer(el)) continue;

    const insideUserTurn = Boolean(closestDeep(el, strictUserTurnSelector));
    if (insideUserTurn) continue;
    const confirmedAssistant = Boolean(closestDeep(el, assistantContainerSelector));

    const src = el.currentSrc || el.src || '';
    if (!src) continue;
    if (isPreexistingSrc(src) || isPreexistingSrc(el.src)) continue;
    if (/\.svg(?:$|\?)/i.test(src) || src.startsWith('data:image/svg')) continue;

    const r = el.getBoundingClientRect();
    const imgClsAndLabel = `${el.getAttribute('aria-label') || ''} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase();
    const imgAlt = (el.alt || '').toLowerCase();
    if (/stylelens-(?:capture|master|source)/.test(`${imgAlt} ${imgClsAndLabel}`)) continue;
    if (!confirmedAssistant && Math.max(r.width, r.height) < 120 && /avatar|favicon|emoji/.test(imgClsAndLabel)) {
      continue;
    }

    // Catch assistant images still downloading even before layout width decodes (>0 or confirmedAssistant)
    if (!el.complete) {
      if (confirmedAssistant || (r.width >= 40 && r.height >= 20)) {
        hasLoadingAssistantImage = true;
      }
      continue;
    }

    if (!isVisible(el)) continue;
    if (!confirmedAssistant) {
      if (knownUserSrcs.has(src) || knownUserSrcs.has(el.src)) continue;
      if (isProbableUnannotatedUserThumbnail(el, r)) continue;
    }

    const meetsSize = confirmedAssistant
      ? r.width >= 60 &&
        r.height >= 20 &&
        el.naturalWidth >= 60 &&
        el.naturalHeight >= 20 &&
        el.naturalWidth * el.naturalHeight >= 2000
      : r.width >= 72 &&
        r.height >= 24 &&
        el.naturalWidth >= 80 &&
        el.naturalHeight >= 28 &&
        el.naturalWidth * el.naturalHeight >= 3200;

    if (meetsSize) {
      const domId = ensureDomId(el);
      const key = src;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        assistantImages.push({
          domId,
          key,
          src,
          kind: 'img',
          naturalWidth: el.naturalWidth,
          naturalHeight: el.naturalHeight,
          renderedWidth: Math.round(r.width),
          renderedHeight: Math.round(r.height),
          confirmedAssistant,
        });
      }
    }
  }

  // 2. Scan rendered <canvas> outputs inside assistant turns
  for (const rawEl of queryAllDeep(document, 'canvas')) {
    if (rawEl.tagName !== 'CANVAS') continue;
    const el = rawEl as HTMLCanvasElement;
    if (isStampedPreexisting(el)) continue;
    if (!isVisible(el) || closestDeep(el, '#stylelens-overlay-host') || closestDeep(el, '[role="dialog"]')) continue;
    if (isInsideComposer(el) || closestDeep(el, strictUserTurnSelector)) continue;
    const confirmedAssistant = Boolean(closestDeep(el, assistantContainerSelector));
    if (!confirmedAssistant) continue;
    const r = el.getBoundingClientRect();
    if (
      r.width >= 60 &&
      r.height >= 20 &&
      el.width >= 60 &&
      el.height >= 20 &&
      el.width * el.height >= 2000
    ) {
      const domId = ensureDomId(el);
      const key = `canvas:${domId}:${el.width}x${el.height}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        assistantImages.push({
          domId,
          key,
          src: '',
          kind: 'canvas',
          naturalWidth: el.width,
          naturalHeight: el.height,
          renderedWidth: Math.round(r.width),
          renderedHeight: Math.round(r.height),
          confirmedAssistant: true,
        });
      }
    }
  }

  // 3. Scan large raster CSS background-image tiles inside confirmed assistant containers
  for (const el of queryAllDeep(
    document,
    'model-response [style*="background-image"], generated-image [style*="background-image"], generated-image *, single-image *, [data-message-author-role="assistant"] [style*="background-image"]'
  )) {
    if (
      isStampedPreexisting(el) ||
      !isVisible(el) ||
      isInsideComposer(el) ||
      closestDeep(el, '[role="dialog"]') ||
      closestDeep(el, strictUserTurnSelector)
    ) {
      continue;
    }
    const view = el.ownerDocument?.defaultView ?? window;
    const bg = el.style?.backgroundImage || view.getComputedStyle(el).backgroundImage || '';
    if (!bg || bg === 'none') continue;
    const m = bg.match(/url\(\s*["']?((?:https?:|blob:|data:image\/(?!svg))[^"')]+)["']?\s*\)/i);
    const url = m?.[1];
    if (!url || knownUserSrcs.has(url) || isPreexistingSrc(url)) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 100 && r.height >= 24) {
      const domId = ensureDomId(el);
      if (!seenKeys.has(url)) {
        seenKeys.add(url);
        assistantImages.push({
          domId,
          key: url,
          src: url,
          kind: 'css-bg',
          naturalWidth: Math.round(r.width * (window.devicePixelRatio || 1)),
          naturalHeight: Math.round(r.height * (window.devicePixelRatio || 1)),
          renderedWidth: Math.round(r.width),
          renderedHeight: Math.round(r.height),
          confirmedAssistant: true,
        });
      }
    }
  }

  const generating = hasStopButton || hasConversationSpinner || hasLoadingAssistantImage;

  const isSearchLike = (el: HTMLElement): boolean => {
    const role = (el.getAttribute('role') || '').toLowerCase();
    const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''}`.toLowerCase();
    if (role === 'searchbox') return true;
    return /\bsearch\b/.test(label) && !/\bask\b|\bprompt\b|\bmessage\b|\bchat\b/.test(label);
  };
  const editorSelectors = [
    'rich-textarea .ql-editor[contenteditable="true"]',
    '#prompt-textarea',
    'textarea[data-testid*="prompt"]',
    'textarea[id*="prompt"]',
    '.ql-editor[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'textarea[placeholder*="ask" i]',
    'textarea[placeholder*="message" i]',
    'textarea[placeholder*="send" i]',
    'textarea[placeholder*="know" i]',
    '[role="textbox"][contenteditable="true"]',
    'textarea',
    '[contenteditable="true"]',
  ];
  let editor: HTMLElement | undefined;
  for (const sel of editorSelectors) {
    const matches = queryAllDeep(document, sel).filter(
      (el) =>
        isVisible(el) &&
        !el.closest('#stylelens-overlay-host') &&
        !el.closest('[role="dialog"]') &&
        !isSearchLike(el) &&
        el.getBoundingClientRect().width >= 90 &&
        el.getBoundingClientRect().height >= 18
    );
    if (matches.length > 0) {
      editor = matches[matches.length - 1];
      break;
    }
  }
  const text = !editor
    ? ''
    : editor instanceof HTMLTextAreaElement
      ? editor.value
      : editor.innerText || editor.textContent || '';

  // Refusal detection: when the AI answers with a short text-only "can't do that" message, no
  // picture is coming. Reporting it lets the run stop in seconds instead of waiting ~50 s.
  const replyNodes = queryAllDeep(
    document,
    'model-response, [data-message-author-role="assistant"], [data-message-author-role="model"], [data-testid*="assistant-message" i]'
  ).filter((el) => !isInsideComposer(el));
  const lastReply = replyNodes[replyNodes.length - 1];
  // Visible text only (innerText), so hidden "thinking" text cannot trigger it
  const lastReplyText = lastReply
    ? ((lastReply as HTMLElement).innerText ?? lastReply.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
    : '';
  const refusalHint =
    lastReplyText.length > 0 &&
    lastReplyText.length < 700 &&
    /don['’]t seem to have access to that content|can['’]t help with that|can['’]t assist with that|can['’]t (?:create|generate|make|edit|produce) (?:that|this|the|an?|images?)|unable to (?:create|generate|help|assist)|not able to (?:create|generate|help|assist)|against (?:our|my) (?:content )?polic|violat\w* (?:our|my|the) (?:content )?polic|无法生成|无法协助|不能帮你|无法为你/.test(
      lastReplyText
    );

  return {
    ok: true,
    assistantReplyCount: replyNodes.length,
    refusalHint,
    generating,
    quietMs: Date.now() - w.__stylelensChatWatch.last,
    composerEmpty: text.trim().length === 0,
    largeImageCount: assistantImages.length,
    assistantImages,
  };
}

interface PageImageExtractAttempt {
  status: 'extracted' | 'needs-sw-fetch' | 'not-found' | 'not-loaded';
  dataUrl?: string;
  src?: string;
  domId?: string;
  width?: number;
  height?: number;
  method?: 'page-blob-or-data' | 'page-canvas';
}

/**
 * Self-contained page extractor (Path A): locates a specific or newest finished assistant image
 * across document + ShadowRoots + same-origin iframes, extracts `blob:` / `data:` / `<canvas>` /
 * same-origin `<img>` directly as genuine PNG, or hands cross-origin `https://` URLs back to the
 * Service Worker for CORS-immune full-resolution fetching.
 */
async function extractChatImageInTab(
  domId: string,
  srcHint: string,
  runToken = ''
): Promise<PageImageExtractAttempt> {
  const isElem = (node: unknown): node is HTMLElement =>
    Boolean(node && typeof node === 'object' && (node as Node).nodeType === 1);

  const queryAllDeep = (root: Document | ShadowRoot, selector: string, depth = 0): HTMLElement[] => {
    const found: HTMLElement[] = [];
    if (depth > 10) return found;
    try {
      for (const el of Array.from(root.querySelectorAll(selector))) {
        if (isElem(el)) found.push(el);
      }
      for (const node of Array.from(root.querySelectorAll('*'))) {
        if (isElem(node) && node.id !== 'stylelens-overlay-host') {
          if (node.shadowRoot) {
            found.push(...queryAllDeep(node.shadowRoot, selector, depth + 1));
          }
          if (node.tagName === 'IFRAME') {
            try {
              const doc = (node as HTMLIFrameElement).contentDocument;
              if (doc) found.push(...queryAllDeep(doc, selector, depth + 1));
            } catch {
              // ignore cross-origin iframe
            }
          }
        }
      }
    } catch {
      // ignore
    }
    return found;
  };
  const closestDeep = (el: Element | null, selector: string): Element | null => {
    let cur: Node | null = el;
    for (let depth = 0; depth < 32 && cur; depth++) {
      if (isElem(cur)) {
        try {
          const hit = cur.closest(selector);
          if (hit) return hit;
        } catch {
          // ignore
        }
        const root = cur.getRootNode?.();
        if (root && typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot && root.host) {
          cur = root.host;
          continue;
        }
        return null;
      }
      if (typeof ShadowRoot !== 'undefined' && cur instanceof ShadowRoot) {
        cur = cur.host;
      } else {
        cur = cur.parentNode;
      }
    }
    return null;
  };
  const isVisible = (el: HTMLElement): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const view = el.ownerDocument?.defaultView ?? window;
    const cs = view.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number.parseFloat(cs.opacity || '1') > 0.05;
  };
  const strictUserTurnSelector =
    'user-query, user-query-content, [data-message-author-role="user"], [data-testid*="user-message" i], [data-testid*="user-turn" i], [data-author="user"], [data-role="user"], [class*="user-query" i], [class*="user-message" i], [class*="userMessage"], [class*="user-turn" i], [class*="message-user" i], [class*="chat-item-user" i]';
  const assistantContainerSelector =
    'model-response, response-container, generated-image, single-image, ucs-response-image, image-generation-response, response-element, structured-content-container, message-content, [data-message-author-role="assistant"], [data-message-author-role="model"], [data-testid*="assistant" i], [data-testid*="model-response" i], [data-testid*="generated-image" i], [data-author="assistant"], [data-author="model"], [data-role="assistant"], [class*="model-response" i], [class*="response-container" i], [class*="assistant-message" i], [class*="assistantMessage"], [class*="bot-message" i], [class*="generated-image" i], [class*="generated_image" i], [class*="single-image" i]';
  const strictComposerSelector =
    'input-area-v2, [data-testid*="composer" i], rich-textarea, .ql-editor, #prompt-textarea, textarea, div.ProseMirror, [contenteditable="true"], [class*="input-area" i], [class*="composer" i]';

  const w = window as unknown as {
    __stylelensKnownUserSrcs?: string[];
    __stylelensLastPromptSnippet?: string;
    __stylelensNextImgId?: number;
    __stylelensPreexistingRun?: { token: string; srcs: string[] };
  };
  const knownUserSrcs = new Set<string>(w.__stylelensKnownUserSrcs ?? []);
  const lastSnippet = (w.__stylelensLastPromptSnippet || '').trim();
  const vh = window.innerHeight || 800;

  // Paste-time stamp check (see `injectImageAndPromptIntoActiveChat`): with a `runToken`, a visual
  // that already existed when this run's prompt was pasted can NEVER be extracted as the reply.
  const preexistingSrcs = new Set<string>(
    runToken && w.__stylelensPreexistingRun?.token === runToken
      ? w.__stylelensPreexistingRun.srcs
      : []
  );
  const isStampedPreexisting = (el: Element): boolean =>
    Boolean(runToken) && el.getAttribute('data-stylelens-preexisting-run') === runToken;
  const isPreexistingSrc = (src: string | undefined): boolean =>
    Boolean(src) && preexistingSrcs.has(src as string);

  const isProbableUnannotatedUserThumbnail = (el: HTMLElement, r: DOMRect): boolean => {
    if (
      el.closest('[data-testid*="file-thumbnail" i], [class*="file-preview" i]') &&
      Math.max(r.width, r.height) < 180
    ) {
      return true;
    }
    if (lastSnippet.length >= 14 && Math.max(r.width, r.height) < 260) {
      let cur: HTMLElement | null = el.parentElement;
      for (let d = 0; d < 5 && cur; d++) {
        if (cur === document.body || cur.tagName === 'MAIN') break;
        const cr = cur.getBoundingClientRect();
        if (cr.height > 0 && cr.height < vh * 0.65) {
          const normText = (cur.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          if (normText.includes(lastSnippet)) {
            const largeImgsInWrapper = Array.from(cur.querySelectorAll('img')).filter((img) => {
              const ir = img.getBoundingClientRect();
              return Math.max(ir.width, ir.height) >= 260;
            }).length;
            if (largeImgsInWrapper === 0) return true;
          }
        }
        cur = cur.parentElement;
      }
    }
    if (r.width < 220 && r.height < 220) {
      let row: HTMLElement | null = el.parentElement;
      for (let d = 0; d < 5 && row; d++) {
        if (row === document.body) break;
        const rr = row.getBoundingClientRect();
        if (rr.width >= 320 && rr.height < vh * 0.7) {
          const leftMargin = r.left - rr.left;
          const rightMargin = rr.right - r.right;
          if (leftMargin > Math.max(24, rightMargin * 2.2) && leftMargin > rr.width * 0.35) {
            return true;
          }
          break;
        }
        row = row.parentElement;
      }
    }
    return false;
  };

  const ensureDomId = (el: HTMLElement): string => {
    const existing = el.getAttribute('data-stylelens-img-id');
    if (existing) return existing;
    const next = (w.__stylelensNextImgId ?? 0) + 1;
    w.__stylelensNextImgId = next;
    const id = `sl-img-${next}`;
    try {
      el.setAttribute('data-stylelens-img-id', id);
    } catch {
      // ignore
    }
    return id;
  };

  let targetEl: HTMLElement | null = null;
  let targetSrc = '';
  let targetKind: 'img' | 'canvas' | 'css-bg' = 'img';

  if (domId) {
    const byId = queryAllDeep(document, `[data-stylelens-img-id="${domId.replace(/"/g, '')}"]`);
    if (byId[0]) {
      targetEl = byId[0];
      if (targetEl.tagName === 'IMG') {
        const imgEl = targetEl as HTMLImageElement;
        targetKind = 'img';
        targetSrc = imgEl.currentSrc || imgEl.src || '';
      } else if (targetEl.tagName === 'CANVAS') {
        targetKind = 'canvas';
      } else {
        targetKind = 'css-bg';
        const view = targetEl.ownerDocument?.defaultView ?? window;
        const bg = targetEl.style?.backgroundImage || view.getComputedStyle(targetEl).backgroundImage || '';
        const m = bg.match(/url\(\s*["']?([^"')]+)["']?\s*\)/i);
        targetSrc = m?.[1] || '';
      }
    }
    // A domId that resolves to a pre-existing visual is stale: drop it and fall through.
    if (targetEl && (isStampedPreexisting(targetEl) || isPreexistingSrc(targetSrc))) {
      targetEl = null;
      targetSrc = '';
      targetKind = 'img';
    }
  }

  if (!targetEl && srcHint && !isPreexistingSrc(srcHint)) {
    const allImgs = queryAllDeep(document, 'img');
    for (let i = allImgs.length - 1; i >= 0; i--) {
      const raw = allImgs[i];
      if (raw && raw.tagName === 'IMG') {
        const img = raw as HTMLImageElement;
        if (isStampedPreexisting(img)) continue;
        if (img.currentSrc === srcHint || img.src === srcHint) {
          targetEl = img;
          targetKind = 'img';
          targetSrc = img.currentSrc || img.src || '';
          break;
        }
      }
    }
  }

  // If no domId/srcHint matched, pick the newest finished assistant visual on the page!
  if (!targetEl) {
    const candidates: Array<{ el: HTMLElement; src: string; kind: 'img' | 'canvas' | 'css-bg'; confirmed: boolean }> = [];
    for (const rawEl of queryAllDeep(document, 'img')) {
      if (rawEl.tagName !== 'IMG') continue;
      const el = rawEl as HTMLImageElement;
      if (isStampedPreexisting(el)) continue;
      if (!isVisible(el) || closestDeep(el, '#stylelens-overlay-host') || closestDeep(el, '[role="dialog"]')) continue;
      if (closestDeep(el, strictComposerSelector)) continue;
      if (closestDeep(el, strictUserTurnSelector)) continue;
      const confirmed = Boolean(closestDeep(el, assistantContainerSelector));
      const src = el.currentSrc || el.src || '';
      if (!src || /\.svg(?:$|\?)/i.test(src) || src.startsWith('data:image/svg')) continue;
      if (isPreexistingSrc(src) || isPreexistingSrc(el.src)) continue;
      const r = el.getBoundingClientRect();
      const clsLabel = `${el.getAttribute('aria-label') || ''} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase();
      if (/stylelens-(?:capture|master|source)/.test(`${(el.alt || '').toLowerCase()} ${clsLabel}`)) continue;
      if (!confirmed && Math.max(r.width, r.height) < 120 && /avatar|favicon|emoji/.test(clsLabel)) continue;
      if (!confirmed && (knownUserSrcs.has(src) || knownUserSrcs.has(el.src))) continue;
      if (!confirmed && isProbableUnannotatedUserThumbnail(el, r)) continue;
      const meetsSize = confirmed
        ? el.complete &&
          el.naturalWidth >= 60 &&
          el.naturalHeight >= 20 &&
          el.naturalWidth * el.naturalHeight >= 2000 &&
          r.width >= 60 &&
          r.height >= 20
        : el.complete &&
          el.naturalWidth >= 80 &&
          el.naturalHeight >= 28 &&
          el.naturalWidth * el.naturalHeight >= 3200 &&
          r.width >= 72 &&
          r.height >= 24;
      if (meetsSize) {
        candidates.push({ el, src, kind: 'img', confirmed });
      }
    }
    for (const rawEl of queryAllDeep(document, 'canvas')) {
      if (rawEl.tagName !== 'CANVAS') continue;
      const el = rawEl as HTMLCanvasElement;
      if (isStampedPreexisting(el)) continue;
      if (!isVisible(el) || closestDeep(el, '#stylelens-overlay-host') || closestDeep(el, '[role="dialog"]')) continue;
      if (!closestDeep(el, assistantContainerSelector) || closestDeep(el, strictComposerSelector) || closestDeep(el, strictUserTurnSelector)) continue;
      const r = el.getBoundingClientRect();
      if (el.width >= 60 && el.height >= 20 && el.width * el.height >= 2000 && r.width >= 60 && r.height >= 20) {
        candidates.push({ el, src: '', kind: 'canvas', confirmed: true });
      }
    }
    for (const el of queryAllDeep(
      document,
      'model-response [style*="background-image"], generated-image [style*="background-image"], generated-image *, single-image *, [data-message-author-role="assistant"] [style*="background-image"]'
    )) {
      if (isStampedPreexisting(el)) continue;
      if (!isVisible(el) || closestDeep(el, strictComposerSelector) || closestDeep(el, '[role="dialog"]') || closestDeep(el, strictUserTurnSelector)) continue;
      const view = el.ownerDocument?.defaultView ?? window;
      const bg = el.style?.backgroundImage || view.getComputedStyle(el).backgroundImage || '';
      if (!bg || bg === 'none') continue;
      const m = bg.match(/url\(\s*["']?((?:https?:|blob:|data:image\/(?!svg))[^"')]+)["']?\s*\)/i);
      const url = m?.[1];
      if (!url || knownUserSrcs.has(url) || isPreexistingSrc(url)) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 100 && r.height >= 24) {
        candidates.push({ el, src: url, kind: 'css-bg', confirmed: true });
      }
    }
    const confirmedList = candidates.filter((c) => c.confirmed);
    const picked = (confirmedList.length > 0 ? confirmedList : candidates).at(-1);
    if (picked) {
      targetEl = picked.el;
      targetSrc = picked.src;
      targetKind = picked.kind;
    }
  }

  if (!targetEl) {
    return { status: 'not-found' };
  }

  const resolvedDomId = ensureDomId(targetEl);

  if (targetKind === 'canvas' && targetEl.tagName === 'CANVAS') {
    const canvasEl = targetEl as HTMLCanvasElement;
    try {
      const dataUrl = canvasEl.toDataURL('image/png');
      return {
        status: 'extracted',
        dataUrl,
        domId: resolvedDomId,
        width: canvasEl.width,
        height: canvasEl.height,
        method: 'page-canvas',
      };
    } catch {
      return { status: 'needs-sw-fetch', domId: resolvedDomId, src: '' };
    }
  }

  if (targetKind === 'img' && targetEl.tagName === 'IMG') {
    const imgTarget = targetEl as HTMLImageElement;
    if (!imgTarget.complete) {
      try {
        await Promise.race([
          imgTarget.decode(),
          new Promise<void>((r) => setTimeout(r, 2500)),
        ]);
      } catch {
        // ignore decode rejection
      }
    }
    if (!imgTarget.complete || imgTarget.naturalWidth < 16 || imgTarget.naturalHeight < 16) {
      return { status: 'not-loaded', domId: resolvedDomId, src: targetSrc };
    }

    const nw = imgTarget.naturalWidth;
    const nh = imgTarget.naturalHeight;

    // Direct data:image/png pass-through; transcode data:image/webp or jpeg to genuine PNG
    if (targetSrc.startsWith('data:image/png')) {
      return {
        status: 'extracted',
        dataUrl: targetSrc,
        src: targetSrc,
        domId: resolvedDomId,
        width: nw,
        height: nh,
        method: 'page-blob-or-data',
      };
    }

    if (targetSrc.startsWith('data:image/')) {
      try {
        const c = document.createElement('canvas');
        c.width = nw;
        c.height = nh;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(imgTarget, 0, 0, nw, nh);
          return {
            status: 'extracted',
            dataUrl: c.toDataURL('image/png'),
            src: targetSrc,
            domId: resolvedDomId,
            width: nw,
            height: nh,
            method: 'page-blob-or-data',
          };
        }
      } catch {
        // fall through
      }
    }

    // Page-scoped blob: URLs MUST be extracted inside the page (Service Workers cannot fetch page blobs!)
    if (targetSrc.startsWith('blob:')) {
      try {
        const resp = await fetch(targetSrc);
        if (resp.ok) {
          const blob = await resp.blob();
          const bmp = await createImageBitmap(blob);
          const c = document.createElement('canvas');
          c.width = bmp.width;
          c.height = bmp.height;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(bmp, 0, 0);
            bmp.close();
            return {
              status: 'extracted',
              dataUrl: c.toDataURL('image/png'),
              src: targetSrc,
              domId: resolvedDomId,
              width: c.width,
              height: c.height,
              method: 'page-blob-or-data',
            };
          }
          bmp.close();
        }
      } catch {
        // Blob may have been revoked after decode — fall back to drawing the already-decoded <img>!
      }
      try {
        const c = document.createElement('canvas');
        c.width = nw;
        c.height = nh;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(imgTarget, 0, 0, nw, nh);
          return {
            status: 'extracted',
            dataUrl: c.toDataURL('image/png'),
            src: targetSrc,
            domId: resolvedDomId,
            width: nw,
            height: nh,
            method: 'page-canvas',
          };
        }
      } catch {
        return { status: 'needs-sw-fetch', domId: resolvedDomId, src: targetSrc, width: nw, height: nh };
      }
    }

    // Same-origin or CORS-clean http(s): try fast canvas draw first; otherwise delegate to SW <all_urls> fetch!
    let sameOrigin = false;
    try {
      sameOrigin = new URL(targetSrc, window.location.href).origin === window.location.origin;
    } catch {
      sameOrigin = false;
    }
    if (sameOrigin || imgTarget.crossOrigin === 'anonymous') {
      try {
        const c = document.createElement('canvas');
        c.width = nw;
        c.height = nh;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(imgTarget, 0, 0, nw, nh);
          const pngUrl = c.toDataURL('image/png');
          return {
            status: 'extracted',
            dataUrl: pngUrl,
            src: targetSrc,
            domId: resolvedDomId,
            width: nw,
            height: nh,
            method: 'page-canvas',
          };
        }
      } catch {
        // Tainted canvas — delegate to Service Worker fetch
      }
    }

    return {
      status: 'needs-sw-fetch',
      src: targetSrc,
      domId: resolvedDomId,
      width: nw,
      height: nh,
    };
  }

  // Handle page-scoped `data:image/` & `blob:` URLs on `css-bg` elements directly inside the page
  if (targetKind === 'css-bg' && targetSrc) {
    if (targetSrc.startsWith('data:image/png')) {
      const r = targetEl.getBoundingClientRect();
      return {
        status: 'extracted',
        dataUrl: targetSrc,
        src: targetSrc,
        domId: resolvedDomId,
        width: Math.round(r.width),
        height: Math.round(r.height),
        method: 'page-blob-or-data',
      };
    }
    if (targetSrc.startsWith('data:image/') || targetSrc.startsWith('blob:')) {
      try {
        const resp = await fetch(targetSrc);
        if (resp.ok) {
          const blob = await resp.blob();
          const bmp = await createImageBitmap(blob);
          const c = document.createElement('canvas');
          c.width = bmp.width;
          c.height = bmp.height;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(bmp, 0, 0);
            bmp.close();
            return {
              status: 'extracted',
              dataUrl: c.toDataURL('image/png'),
              src: targetSrc,
              domId: resolvedDomId,
              width: c.width,
              height: c.height,
              method: 'page-blob-or-data',
            };
          }
          bmp.close();
        }
      } catch {
        // Fall through to needs-sw-fetch / Path C crop
      }
    }
  }

  return {
    status: 'needs-sw-fetch',
    src: targetSrc,
    domId: resolvedDomId,
  };
}

interface ScrollCropRectResult {
  ok: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

/**
 * Self-contained Path C fallback helper: locates the target assistant image across document +
 * open ShadowRoots + same-origin IFRAMEs, scrolls cleanly into view, and returns top-level
 * viewport coordinates (translating cumulative iframe offsets) for `captureVisibleTab` cropping.
 */
async function scrollAndMeasureChatImage(
  domId: string,
  srcHint: string
): Promise<ScrollCropRectResult> {
  interface LocatedElement {
    el: HTMLElement;
    iframeChain: HTMLIFrameElement[];
  }
  const queryAllDeepWithFrames = (
    root: Document | ShadowRoot,
    selector: string,
    iframeChain: HTMLIFrameElement[] = [],
    depth = 0
  ): LocatedElement[] => {
    const found: LocatedElement[] = [];
    if (depth > 10) return found;
    try {
      for (const el of Array.from(root.querySelectorAll(selector))) {
        if (el && (el as Node).nodeType === 1) found.push({ el: el as HTMLElement, iframeChain });
      }
      for (const node of Array.from(root.querySelectorAll('*'))) {
        if (node && (node as Node).nodeType === 1 && (node as HTMLElement).id !== 'stylelens-overlay-host') {
          const elNode = node as HTMLElement;
          if (elNode.shadowRoot) {
            found.push(...queryAllDeepWithFrames(elNode.shadowRoot, selector, iframeChain, depth + 1));
          }
          if (elNode.tagName === 'IFRAME') {
            try {
              const iframeEl = elNode as HTMLIFrameElement;
              const doc = iframeEl.contentDocument;
              if (doc) {
                found.push(
                  ...queryAllDeepWithFrames(doc, selector, [...iframeChain, iframeEl], depth + 1)
                );
              }
            } catch {
              // Cross-origin iframe
            }
          }
        }
      }
    } catch {
      // ignore
    }
    return found;
  };

  let located: LocatedElement | null = null;
  if (domId) {
    located =
      queryAllDeepWithFrames(document, `[data-stylelens-img-id="${domId.replace(/"/g, '')}"]`)[0] ??
      null;
  }
  if (!located && srcHint) {
    const imgs = queryAllDeepWithFrames(document, 'img');
    for (let i = imgs.length - 1; i >= 0; i--) {
      const item = imgs[i]!;
      if (item.el.tagName === 'IMG') {
        const imgEl = item.el as HTMLImageElement;
        if (imgEl.currentSrc === srcHint || imgEl.src === srcHint) {
          located = item;
          break;
        }
      }
    }
  }
  if (!located) {
    return { ok: false, x: 0, y: 0, width: 0, height: 0, viewportWidth: 0, viewportHeight: 0 };
  }

  for (const frame of located.iframeChain) {
    try {
      frame.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    } catch {
      frame.scrollIntoView();
    }
  }
  try {
    located.el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
  } catch {
    located.el.scrollIntoView();
  }
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

  const rect = located.el.getBoundingClientRect();
  let offsetX = 0;
  let offsetY = 0;
  for (const frame of located.iframeChain) {
    const fr = frame.getBoundingClientRect();
    offsetX += fr.left;
    offsetY += fr.top;
  }

  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  const x = Math.max(0, rect.left + offsetX);
  const y = Math.max(0, rect.top + offsetY);
  const right = Math.min(vw, rect.right + offsetX);
  const bottom = Math.min(vh, rect.bottom + offsetY);
  const w = Math.max(0, right - x);
  const h = Math.max(0, bottom - y);
  return {
    ok: w >= 32 && h >= 18,
    x,
    y,
    width: w,
    height: h,
    viewportWidth: vw,
    viewportHeight: vh,
  };
}

// =============================================================================
// Service Worker-ONLY Media Helpers (NEVER referenced inside executeScript funcs!)
// =============================================================================

function swBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function swSniffRasterMime(
  buf: ArrayBuffer
): { mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif'; pngDims?: { w: number; h: number } } | null {
  if (buf.byteLength < 64 || buf.byteLength > 25 * 1024 * 1024) return null;
  const b = new Uint8Array(buf, 0, Math.min(24, buf.byteLength));
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 24 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    const view = new DataView(buf, 16, 8);
    return {
      mime: 'image/png',
      pngDims: { w: view.getUint32(0, false), h: view.getUint32(4, false) },
    };
  }
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mime: 'image/jpeg' };
  }
  // WebP: RIFF....WEBP
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return { mime: 'image/webp' };
  }
  // AVIF/HEIF: ....ftyp
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    return { mime: 'image/avif' };
  }
  return null;
}

async function swFetchAndNormalizeToPng(
  srcUrl: string
): Promise<{
  ok: true;
  dataUrl: string;
  width: number;
  height: number;
  method: 'sw-credentialed-fetch' | 'sw-anonymous-fetch';
} | null> {
  if (!/^https?:\/\//i.test(srcUrl)) return null;

  const attempts: Array<{
    credentials: RequestCredentials;
    cache: RequestCache;
    method: 'sw-credentialed-fetch' | 'sw-anonymous-fetch';
  }> = [
    { credentials: 'include', cache: 'force-cache', method: 'sw-credentialed-fetch' },
    { credentials: 'omit', cache: 'default', method: 'sw-anonymous-fetch' },
  ];

  for (const attempt of attempts) {
    try {
      const resp = await fetch(srcUrl, {
        credentials: attempt.credentials,
        cache: attempt.cache,
        signal: AbortSignal.timeout(12_000),
      });
      if (!resp.ok) continue;
      const buf = await resp.arrayBuffer();
      const sniffed = swSniffRasterMime(buf);
      if (!sniffed) continue;

      if (sniffed.mime === 'image/png' && sniffed.pngDims) {
        return {
          ok: true,
          dataUrl: `data:image/png;base64,${swBufferToBase64(buf)}`,
          width: sniffed.pngDims.w,
          height: sniffed.pngDims.h,
          method: attempt.method,
        };
      }

      // Transcode WebP / JPEG / AVIF to genuine PNG bytes via OffscreenCanvas
      const blob = new Blob([buf], { type: sniffed.mime });
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bitmap.close();
        continue;
      }
      ctx.drawImage(bitmap, 0, 0);
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close();
      const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
      const pngBuf = await pngBlob.arrayBuffer();
      return {
        ok: true,
        dataUrl: `data:image/png;base64,${swBufferToBase64(pngBuf)}`,
        width,
        height,
        method: attempt.method,
      };
    } catch {
      // Try next attempt
    }
  }
  return null;
}

async function swCropVisibleTabImageToPng(
  tab: chrome.tabs.Tab,
  domId: string,
  srcHint: string
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (tab.id === undefined || tab.windowId === undefined) return null;
  try {
    if (!tab.active) {
      await chrome.tabs.update(tab.id, { active: true });
      await new Promise((r) => setTimeout(r, 150));
    }
    const measureResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrollAndMeasureChatImage,
      args: [domId, srcHint],
    });
    const rect = measureResults[0]?.result as ScrollCropRectResult | undefined;
    if (!rect?.ok || rect.viewportWidth <= 0 || rect.viewportHeight <= 0) return null;

    const viewportPngUrl = await captureTabWithRateLimit(tab.windowId, { format: 'png' });
    const resp = await fetch(viewportPngUrl);
    const fullBlob = await resp.blob();
    const bitmap = await createImageBitmap(fullBlob);
    const scaleX = bitmap.width / rect.viewportWidth;
    const scaleY = bitmap.height / rect.viewportHeight;
    const sx = Math.max(0, Math.round(rect.x * scaleX));
    const sy = Math.max(0, Math.round(rect.y * scaleY));
    const sw = Math.min(bitmap.width - sx, Math.max(1, Math.round(rect.width * scaleX)));
    const sh = Math.min(bitmap.height - sy, Math.max(1, Math.round(rect.height * scaleY)));

    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    bitmap.close();
    const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
    const croppedBuf = await croppedBlob.arrayBuffer();
    return {
      dataUrl: `data:image/png;base64,${swBufferToBase64(croppedBuf)}`,
      width: sw,
      height: sh,
    };
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  switch (message.type) {
    case 'STYLELENS_REQUEST_START_CAPTURE': {
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then((tabs) => {
          const active = tabs[0];
          if (!active) {
            sendResponse({
              ok: false,
              code: 'NO_ACTIVE_TAB',
              message: 'No active browser tab found.',
            } satisfies StartCaptureResponse);
            return;
          }
          return activateOverlayInTab(active, message.language).then((res) => sendResponse(res));
        })
        .catch((err) => {
          sendResponse({
            ok: false,
            code: 'INJECTION_FAILED',
            message: err instanceof Error ? err.message : String(err),
          } satisfies StartCaptureResponse);
        });
      return true;
    }

    case 'STYLELENS_REQUEST_CANCEL_CAPTURE': {
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then(async (tabs) => {
          const active = tabs[0];
          if (active?.id !== undefined) {
            await chrome.tabs
              .sendMessage(active.id, { type: 'STYLELENS_OVERLAY_CANCEL' } satisfies OverlayCommandMessage)
              .catch(() => {});
          }
          broadcastToSidePanel({ type: 'STYLELENS_CAPTURE_STATUS', status: 'idle' });
          sendResponse({ ok: true });
        })
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    case 'STYLELENS_SELECTION_COMPLETE': {
      void handleSelectionComplete(message.payload, sender.tab);
      sendResponse({ ok: true });
      return false;
    }

    case 'STYLELENS_SELECTION_CANCELLED': {
      broadcastToSidePanel({ type: 'STYLELENS_CAPTURE_STATUS', status: 'idle' });
      sendResponse({ ok: true });
      return false;
    }

    case 'STYLELENS_CONSUME_PENDING_CAPTURE': {
      chrome.storage.session
        .get(PENDING_CAPTURE_KEY)
        .then(async (result) => {
          const pending = result[PENDING_CAPTURE_KEY] as PendingCapturePayload | undefined;
          if (pending) {
            await chrome.storage.session.remove(PENDING_CAPTURE_KEY);
          }
          sendResponse({ pending: pending ?? null });
        })
        .catch(() => sendResponse({ pending: null }));
      return true;
    }

    case 'STYLELENS_PASTE_TO_ACTIVE_CHAT': {
      const resolveTab = async (): Promise<chrome.tabs.Tab | undefined> => {
        if (typeof message.tabId === 'number') {
          return chrome.tabs.get(message.tabId).catch(() => undefined);
        }
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        return tabs[0];
      };
      resolveTab()
        .then(async (active) => {
          if (!active || active.id === undefined) {
            sendResponse({
              ok: false,
              reason: 'NO_ACTIVE_TAB',
              message: 'No active tab found.',
            } satisfies PasteToChatResponse);
            return;
          }
          const check = isRestrictedUrl(active.url);
          if (check.restricted) {
            sendResponse({
              ok: false,
              reason: 'RESTRICTED_URL',
              message: check.reason,
            } satisfies PasteToChatResponse);
            return;
          }
          const results = await chrome.scripting.executeScript({
            target: { tabId: active.id },
            func: injectImageAndPromptIntoActiveChat,
            args: [
              message.imageDataUrl,
              message.promptText,
              Boolean(message.requireImage),
              message.fileName || 'stylelens-capture.png',
            ],
          });
          const outcome = results[0]?.result as PasteToChatResponse | undefined;
          sendResponse(
            outcome
              ? { ...outcome, tabId: active.id }
              : {
                  ok: false,
                  reason: 'INJECTION_FAILED',
                  message: 'Could not insert into active chat tab.',
                }
          );
        })
        .catch((err) => {
          sendResponse({
            ok: false,
            reason: 'INJECTION_FAILED',
            message: err instanceof Error ? err.message : String(err),
          } satisfies PasteToChatResponse);
        });
      return true;
    }

    case 'STYLELENS_CHAT_SUBMIT': {
      chrome.scripting
        .executeScript({ target: { tabId: message.tabId }, func: submitActiveChatComposer })
        .then((results) => {
          const outcome = results[0]?.result as ChatSubmitResponse | undefined;
          sendResponse(outcome ?? ({ ok: false, reason: 'INJECTION_FAILED' } satisfies ChatSubmitResponse));
        })
        .catch((err) => {
          sendResponse({
            ok: false,
            reason: err instanceof Error ? err.message : String(err),
          } satisfies ChatSubmitResponse);
        });
      return true;
    }

    case 'STYLELENS_CHAT_PROBE': {
      chrome.scripting
        .executeScript({
          target: { tabId: message.tabId },
          func: probeChatGenerationState,
          args: [message.runToken || ''],
        })
        .then((results) => {
          const outcome = results[0]?.result as ChatProbeResponse | undefined;
          sendResponse(
            outcome ??
              ({ ok: false, generating: false, quietMs: 0, composerEmpty: false } satisfies ChatProbeResponse)
          );
        })
        .catch((err) => {
          sendResponse({
            ok: false,
            generating: false,
            quietMs: 0,
            composerEmpty: false,
            reason: err instanceof Error ? err.message : String(err),
          } satisfies ChatProbeResponse);
        });
      return true;
    }

    case 'STYLELENS_EXTRACT_CHAT_IMAGE': {
      const resolveTab = async (): Promise<chrome.tabs.Tab | undefined> => {
        if (typeof message.tabId === 'number') {
          return chrome.tabs.get(message.tabId).catch(() => undefined);
        }
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        return tabs[0];
      };
      resolveTab()
        .then(async (active) => {
          if (!active || active.id === undefined) {
            sendResponse({
              ok: false,
              reason: 'NO_ACTIVE_TAB',
              message: 'No active browser tab found.',
            } satisfies ExtractChatImageResponse);
            return;
          }
          const check = isRestrictedUrl(active.url);
          if (check.restricted) {
            sendResponse({
              ok: false,
              reason: 'RESTRICTED_URL',
              message: check.reason,
            } satisfies ExtractChatImageResponse);
            return;
          }

          // Path A: Page-side extraction (blob:, data:, <canvas>, same-origin <img>)
          const pageResults = await chrome.scripting.executeScript({
            target: { tabId: active.id },
            func: extractChatImageInTab,
            args: [message.domId || '', message.srcHint || '', message.runToken || ''],
          });
          const attempt = pageResults[0]?.result as PageImageExtractAttempt | undefined;
          if (!attempt || attempt.status === 'not-found') {
            sendResponse({
              ok: false,
              tabId: active.id,
              reason: 'NO_ASSISTANT_IMAGE',
              message: 'No finished assistant image found on this tab.',
            } satisfies ExtractChatImageResponse);
            return;
          }
          if (attempt.status === 'not-loaded') {
            sendResponse({
              ok: false,
              tabId: active.id,
              domId: attempt.domId,
              sourceUrl: attempt.src,
              reason: 'IMAGE_NOT_LOADED',
              message: 'Assistant image is still finishing loading.',
            } satisfies ExtractChatImageResponse);
            return;
          }
          if (attempt.status === 'extracted' && attempt.dataUrl) {
            sendResponse({
              ok: true,
              dataUrl: attempt.dataUrl,
              width: attempt.width,
              height: attempt.height,
              sourceUrl: attempt.src,
              domId: attempt.domId,
              tabId: active.id,
              method: attempt.method,
            } satisfies ExtractChatImageResponse);
            return;
          }

          // Path B: Service Worker CORS-immune fetch (<all_urls>) + genuine PNG normalization
          if (attempt.src) {
            const fetched = await swFetchAndNormalizeToPng(attempt.src);
            if (fetched) {
              sendResponse({
                ok: true,
                dataUrl: fetched.dataUrl,
                width: fetched.width,
                height: fetched.height,
                sourceUrl: attempt.src,
                domId: attempt.domId,
                tabId: active.id,
                method: fetched.method,
              } satisfies ExtractChatImageResponse);
              return;
            }
          }

          // Path C: Visible-tab scroll + captureVisibleTab crop fallback
          const cropped = await swCropVisibleTabImageToPng(
            active,
            attempt.domId || message.domId || '',
            attempt.src || message.srcHint || ''
          );
          if (cropped) {
            sendResponse({
              ok: true,
              dataUrl: cropped.dataUrl,
              width: cropped.width,
              height: cropped.height,
              sourceUrl: attempt.src,
              domId: attempt.domId,
              tabId: active.id,
              method: 'visible-tab-crop',
            } satisfies ExtractChatImageResponse);
            return;
          }

          sendResponse({
            ok: false,
            tabId: active.id,
            domId: attempt.domId,
            sourceUrl: attempt.src,
            reason: 'EXTRACTION_FAILED',
            message: 'Could not extract pixels from the generated image.',
          } satisfies ExtractChatImageResponse);
        })
        .catch((err) => {
          sendResponse({
            ok: false,
            reason: 'EXTRACTION_FAILED',
            message: err instanceof Error ? err.message : String(err),
          } satisfies ExtractChatImageResponse);
        });
      return true;
    }

    default:
      return false;
  }
});
