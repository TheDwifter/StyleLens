/**
 * Encapsulated CSS for the StyleLens Shadow DOM selection overlay.
 * Minimalist Matte Carbon + Pure White Luminous precision reticle.
 */
export const OVERLAY_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: auto;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}

*, *::before, *::after {
  box-sizing: border-box;
}

.sl-backdrop {
  position: fixed;
  inset: 0;
  cursor: crosshair;
  user-select: none;
  -webkit-user-select: none;
  background: rgba(9, 9, 11, 0.22);
}

.sl-backdrop.is-dragging {
  background: transparent;
}

.sl-scrim {
  position: fixed;
  background: rgba(9, 9, 11, 0.56);
  pointer-events: none;
  display: none;
}

.sl-backdrop.is-dragging .sl-scrim {
  display: block;
}

.sl-hud {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px 10px 18px;
  border-radius: 9999px;
  background: rgba(9, 9, 11, 0.95);
  border: 1.5px solid rgba(255, 255, 255, 0.42);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.72), 0 0 24px rgba(255, 255, 255, 0.16);
  color: #ffffff;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.2;
  pointer-events: auto;
  backdrop-filter: blur(14px);
  max-width: calc(100vw - 24px);
}

.sl-hud-text {
  pointer-events: none;
}

.sl-hud-dot {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: #ffffff;
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.95);
  flex-shrink: 0;
  pointer-events: none;
}

.sl-hud-cancel {
  appearance: none;
  cursor: pointer;
  padding: 5px 11px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: #ffffff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  transition: background 120ms ease, border-color 120ms ease;
}

.sl-hud-cancel:hover {
  background: #ffffff;
  color: #09090b;
  border-color: #ffffff;
}

.sl-hover-box {
  position: fixed;
  pointer-events: none;
  border: 1.5px solid rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 0 14px rgba(255, 255, 255, 0.18);
  border-radius: 2px;
  display: none;
  transition: transform 35ms linear;
}

.sl-marquee-box {
  position: fixed;
  pointer-events: none;
  border: 1.5px solid #ffffff;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.8),
    0 0 18px rgba(255, 255, 255, 0.35);
  display: none;
}

.sl-corner {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 2px solid #ffffff;
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.65);
}
.sl-corner.tl { top: -2px; left: -2px; border-right: 0; border-bottom: 0; }
.sl-corner.tr { top: -2px; right: -2px; border-left: 0; border-bottom: 0; }
.sl-corner.bl { bottom: -2px; left: -2px; border-right: 0; border-top: 0; }
.sl-corner.br { bottom: -2px; right: -2px; border-left: 0; border-top: 0; }

.sl-badge {
  position: fixed;
  pointer-events: none;
  display: none;
  padding: 4px 9px;
  border-radius: 6px;
  background: rgba(14, 14, 16, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.22);
  color: #f4f4f5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.3;
  white-space: nowrap;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.55);
}

.sl-badge-tag {
  color: #ffffff;
  font-weight: 600;
}

.sl-badge-dim {
  color: #a1a1aa;
}
`;
