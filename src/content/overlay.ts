import { OVERLAY_HOST_ID, extractDomFromSelection } from '../core/domExtractor';
import { OVERLAY_CSS } from './overlayStyles';
import type { RawSelectionPayload, SelectionMethod, ViewportRect } from '../types/capture';
import type { OverlayCommandMessage, OverlayEventMessage } from '../types/messages';

declare global {
  interface Window {
    __STYLELENS_OVERLAY_INSTALLED__?: boolean;
  }
}

const DRAG_THRESHOLD_PX = 5;
const MIN_CAPTURE_DIM_PX = 12;

interface OverlaySession {
  host: HTMLDivElement;
  cleanup: () => void;
}

let activeSession: OverlaySession | null = null;

function waitForCleanPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function sendOverlayEvent(msg: OverlayEventMessage): void {
  try {
    void chrome.runtime.sendMessage(msg);
  } catch {
    // Extension context invalidated during reload — fail silently
  }
}

function findTargetElementAtPoint(host: Element, x: number, y: number): Element | null {
  const stack = document.elementsFromPoint(x, y);
  for (const el of stack) {
    if (el === host || host.contains(el)) continue;
    if (el === document.documentElement || el === document.body) continue;
    return el;
  }
  return null;
}

function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const firstClass = Array.from(el.classList).find((c) => c.length <= 28 && !/__/.test(c));
  return firstClass ? `${tag}.${firstClass}` : tag;
}

function clampRectToViewport(rect: ViewportRect): ViewportRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = Math.max(0, Math.min(vw - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(vh - 1, Math.round(rect.y)));
  const right = Math.max(x + 1, Math.min(vw, Math.round(rect.x + rect.width)));
  const bottom = Math.max(y + 1, Math.min(vh, Math.round(rect.y + rect.height)));
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function teardownOverlay(notifyCancel = false): void {
  if (activeSession) {
    activeSession.cleanup();
    activeSession = null;
  }
  const stray = document.getElementById(OVERLAY_HOST_ID);
  if (stray) stray.remove();

  if (notifyCancel) {
    sendOverlayEvent({ type: 'STYLELENS_SELECTION_CANCELLED' });
  }
}

function attachStyles(shadow: ShadowRoot): void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(OVERLAY_CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const styleEl = document.createElement('style');
    styleEl.textContent = OVERLAY_CSS;
    shadow.appendChild(styleEl);
  }
}

function activateOverlay(language: 'en' | 'zh-CN' = 'en'): void {
  teardownOverlay(false);

  const isZh = language === 'zh-CN';
  const promptIdleText = isZh
    ? '在网页上拖动框选任意元素 — 或直接点击'
    : 'Drag a box over anything you want to copy — or click it';
  const promptReleaseText = isZh ? '松开鼠标即可捕获风格' : 'Let go to capture this style';
  const cancelLabel = isZh ? '取消 (Esc)' : 'Cancel (Esc)';

  const host = document.createElement('div');
  host.id = OVERLAY_HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  attachStyles(shadow);

  const backdrop = document.createElement('div');
  backdrop.className = 'sl-backdrop';

  // Four surrounding scrim boxes keep the selected area at 100% original clarity
  const scrimTop = document.createElement('div');
  const scrimRight = document.createElement('div');
  const scrimBottom = document.createElement('div');
  const scrimLeft = document.createElement('div');
  for (const s of [scrimTop, scrimRight, scrimBottom, scrimLeft]) {
    s.className = 'sl-scrim';
    backdrop.appendChild(s);
  }

  const hoverBox = document.createElement('div');
  hoverBox.className = 'sl-hover-box';

  const marqueeBox = document.createElement('div');
  marqueeBox.className = 'sl-marquee-box';
  for (const pos of ['tl', 'tr', 'bl', 'br']) {
    const corner = document.createElement('span');
    corner.className = `sl-corner ${pos}`;
    marqueeBox.appendChild(corner);
  }

  const badge = document.createElement('div');
  badge.className = 'sl-badge';

  const hud = document.createElement('div');
  hud.className = 'sl-hud';
  const hudDot = document.createElement('span');
  hudDot.className = 'sl-hud-dot';
  const hudLabel = document.createElement('span');
  hudLabel.className = 'sl-hud-text';
  hudLabel.textContent = promptIdleText;
  const hudCancelBtn = document.createElement('button');
  hudCancelBtn.type = 'button';
  hudCancelBtn.className = 'sl-hud-cancel';
  hudCancelBtn.textContent = cancelLabel;
  const cancelFromHud = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    teardownOverlay(true);
  };
  hudCancelBtn.addEventListener('pointerdown', cancelFromHud);
  hudCancelBtn.addEventListener('click', cancelFromHud);
  hud.append(hudDot, hudLabel, hudCancelBtn);

  backdrop.append(hoverBox, marqueeBox, badge, hud);
  shadow.appendChild(backdrop);
  document.documentElement.appendChild(host);

  let isPointerDown = false;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let hoveredEl: Element | null = null;
  let hoverRafId: number | null = null;

  const positionBadge = (anchorRect: ViewportRect, labelHtml: string) => {
    badge.innerHTML = labelHtml;
    badge.style.display = 'block';
    const badgeW = badge.offsetWidth || 140;
    const badgeH = badge.offsetHeight || 26;
    const left = Math.max(8, Math.min(window.innerWidth - badgeW - 8, anchorRect.x));
    const top =
      anchorRect.y >= badgeH + 10
        ? anchorRect.y - badgeH - 8
        : Math.min(window.innerHeight - badgeH - 8, anchorRect.y + anchorRect.height + 8);
    badge.style.left = `${left}px`;
    badge.style.top = `${top}px`;
  };

  const updateScrimAndMarquee = (rect: ViewportRect) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    marqueeBox.style.display = 'block';
    marqueeBox.style.left = `${rect.x}px`;
    marqueeBox.style.top = `${rect.y}px`;
    marqueeBox.style.width = `${rect.width}px`;
    marqueeBox.style.height = `${rect.height}px`;

    scrimTop.style.cssText = `top:0;left:0;width:${vw}px;height:${rect.y}px;`;
    scrimBottom.style.cssText = `top:${rect.y + rect.height}px;left:0;width:${vw}px;height:${Math.max(0, vh - (rect.y + rect.height))}px;`;
    scrimLeft.style.cssText = `top:${rect.y}px;left:0;width:${rect.x}px;height:${rect.height}px;`;
    scrimRight.style.cssText = `top:${rect.y}px;left:${rect.x + rect.width}px;width:${Math.max(0, vw - (rect.x + rect.width))}px;height:${rect.height}px;`;

    positionBadge(
      rect,
      `<span class="sl-badge-tag">BOX SCAN</span> · <span class="sl-badge-dim">${rect.width} × ${rect.height}px</span>`
    );
  };

  const updateHoverHighlight = (clientX: number, clientY: number) => {
    const target = findTargetElementAtPoint(host, clientX, clientY);
    hoveredEl = target;
    if (!target) {
      hoverBox.style.display = 'none';
      badge.style.display = 'none';
      return;
    }

    const domRect = target.getBoundingClientRect();
    const clamped = clampRectToViewport({
      x: domRect.left,
      y: domRect.top,
      width: domRect.width,
      height: domRect.height,
    });

    hoverBox.style.display = 'block';
    hoverBox.style.left = `${clamped.x}px`;
    hoverBox.style.top = `${clamped.y}px`;
    hoverBox.style.width = `${clamped.width}px`;
    hoverBox.style.height = `${clamped.height}px`;

    const desc = describeElement(target);
    positionBadge(
      clamped,
      `<span class="sl-badge-tag">${desc}</span> · <span class="sl-badge-dim">${clamped.width}×${clamped.height}</span>`
    );
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.composedPath().includes(hudCancelBtn)) return;
    if (e.button !== 0) {
      e.preventDefault();
      teardownOverlay(true);
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    isPointerDown = true;
    isDragging = false;
    startX = e.clientX;
    startY = e.clientY;
    currentX = e.clientX;
    currentY = e.clientY;
  };

  const onPointerMove = (e: PointerEvent) => {
    currentX = e.clientX;
    currentY = e.clientY;

    if (!isPointerDown) {
      if (hoverRafId === null) {
        hoverRafId = requestAnimationFrame(() => {
          hoverRafId = null;
          if (!isPointerDown) {
            updateHoverHighlight(currentX, currentY);
          }
        });
      }
      return;
    }

    const dx = Math.abs(currentX - startX);
    const dy = Math.abs(currentY - startY);
    if (!isDragging && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      isDragging = true;
      backdrop.classList.add('is-dragging');
      hoverBox.style.display = 'none';
      hudLabel.textContent = promptReleaseText;
    }

    if (isDragging) {
      const rect = clampRectToViewport({
        x: Math.min(startX, currentX),
        y: Math.min(startY, currentY),
        width: Math.abs(currentX - startX),
        height: Math.abs(currentY - startY),
      });
      updateScrimAndMarquee(rect);
    }
  };

  const onPointerUp = async (e: PointerEvent) => {
    if (!isPointerDown) return;
    e.preventDefault();
    e.stopPropagation();
    isPointerDown = false;

    let finalRect: ViewportRect | null = null;
    let selectionMethod: SelectionMethod = 'marquee';
    let snappedEl: Element | null = null;

    if (isDragging) {
      const candidate = clampRectToViewport({
        x: Math.min(startX, e.clientX),
        y: Math.min(startY, e.clientY),
        width: Math.abs(e.clientX - startX),
        height: Math.abs(e.clientY - startY),
      });
      if (candidate.width >= MIN_CAPTURE_DIM_PX && candidate.height >= MIN_CAPTURE_DIM_PX) {
        finalRect = candidate;
        selectionMethod = 'marquee';
      }
    } else {
      const target = hoveredEl ?? findTargetElementAtPoint(host, e.clientX, e.clientY);
      if (target) {
        const r = target.getBoundingClientRect();
        const candidate = clampRectToViewport({
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
        });
        if (candidate.width >= MIN_CAPTURE_DIM_PX && candidate.height >= MIN_CAPTURE_DIM_PX) {
          finalRect = candidate;
          selectionMethod = 'element-snap';
          snappedEl = target;
        }
      }
    }

    if (!finalRect) {
      teardownOverlay(true);
      return;
    }

    // Hide overlay and wait two compositor frames before DOM extraction + screenshot
    host.style.display = 'none';
    await waitForCleanPaint();

    const dom = extractDomFromSelection(document, finalRect, selectionMethod, snappedEl);
    const payload: RawSelectionPayload = {
      rect: finalRect,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      page: {
        url: window.location.href,
        hostname: window.location.hostname || 'local-page',
        title: document.title || window.location.hostname || 'Untitled Page',
      },
      dom,
      capturedAt: Date.now(),
    };

    teardownOverlay(false);
    sendOverlayEvent({ type: 'STYLELENS_SELECTION_COMPLETE', payload });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      teardownOverlay(true);
    }
  };

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    teardownOverlay(true);
  };

  // Bind pointermove & pointerup on window so fast box drags never lose tracking at viewport edges
  backdrop.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  backdrop.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown, true);

  activeSession = {
    host,
    cleanup: () => {
      if (hoverRafId !== null) cancelAnimationFrame(hoverRafId);
      backdrop.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      backdrop.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown, true);
      host.remove();
    },
  };
}

if (!window.__STYLELENS_OVERLAY_INSTALLED__) {
  window.__STYLELENS_OVERLAY_INSTALLED__ = true;

  chrome.runtime.onMessage.addListener((message: OverlayCommandMessage, _sender, sendResponse) => {
    if (message?.type === 'STYLELENS_OVERLAY_ACTIVATE') {
      activateOverlay(message.language ?? 'en');
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === 'STYLELENS_OVERLAY_CANCEL') {
      teardownOverlay(false);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
}
