import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_HOST_ID, extractDomFromSelection } from '../domExtractor';

const nativeGetComputedStyle = window.getComputedStyle.bind(window);

beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    if (pseudo) {
      return { content: 'none' } as CSSStyleDeclaration;
    }
    return nativeGetComputedStyle(el);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockRect(el: Element, rect: { left: number; top: number; width: number; height: number }) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: rect.left,
      y: rect.top,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => ({}),
    }),
  });
}

describe('domExtractor', () => {
  it('extracts a snapped element subtree, strips hashed classes, and skips overlay host', () => {
    document.body.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_HOST_ID;
    document.body.appendChild(overlay);

    const card = document.createElement('article');
    card.className = 'feature-card css-9x8y7z6 Card_root__a1b2c3';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '12px';
    card.style.padding = '16px';
    card.style.backgroundColor = 'rgb(18, 18, 22)';
    card.style.borderRadius = '12px';
    mockRect(card, { left: 20, top: 20, width: 280, height: 160 });

    const heading = document.createElement('h3');
    heading.className = 'card-title';
    heading.textContent = 'Fast Indexing';
    heading.style.color = 'rgb(244, 244, 245)';
    heading.style.fontSize = '18px';
    heading.style.fontWeight = '600';
    heading.style.fontFamily = 'Inter, sans-serif';
    mockRect(heading, { left: 36, top: 36, width: 200, height: 26 });

    card.appendChild(heading);
    document.body.appendChild(card);

    const result = extractDomFromSelection(
      document,
      { x: 20, y: 20, width: 280, height: 160 },
      'element-snap',
      card
    );

    expect(result.captureMode).toBe('dom-and-visual');
    expect(result.totalNodesScanned).toBe(2);
    expect(result.roots).toHaveLength(1);

    const root = result.roots[0]!;
    expect(root.tag).toBe('article');
    expect(root.cleanClasses).toEqual(['feature-card']);
    expect(root.omittedHashedClassCount).toBe(2);
    expect(root.styles.display).toBe('flex');
    expect(root.children).toHaveLength(1);
    expect(root.children[0]?.textSnippet).toBe('Fast Indexing');
  });

  it('switches to visual-only mode when selecting a <video> region', () => {
    document.body.innerHTML = '';

    const video = document.createElement('video');
    video.style.display = 'block';
    mockRect(video, { left: 0, top: 0, width: 640, height: 360 });
    document.body.appendChild(video);

    const result = extractDomFromSelection(
      document,
      { x: 40, y: 40, width: 480, height: 270 },
      'marquee'
    );

    expect(result.captureMode).toBe('visual-only');
    expect(result.visualFallbackReason).toMatch(/<video>/i);
  });
});
