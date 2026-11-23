/**
 * Cyber-glyph letter-scramble + chromatic RGB text glitch on click.
 * Preserves exact original text nodes via WeakMap so rapid clicks never corrupt labels.
 */
const GLITCH_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#$%*+=';

const originalTextMap = new WeakMap<Text, string>();
const activeIntervalMap = new WeakMap<HTMLElement, number>();

function collectTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const val = textNode.nodeValue ?? '';
    if (val.trim().length > 0 && val.trim().length <= 44) {
      nodes.push(textNode);
    }
    current = walker.nextNode();
  }
  return nodes;
}

function scramblePreserveSpaces(original: string, intensity: number): string {
  let out = '';
  for (let i = 0; i < original.length; i++) {
    const ch = original[i]!;
    if (/\s/.test(ch)) {
      out += ch;
    } else if (Math.random() < intensity) {
      out += GLITCH_GLYPHS[Math.floor(Math.random() * GLITCH_GLYPHS.length)]!;
    } else {
      out += ch;
    }
  }
  return out;
}

export function triggerLetterGlitch(el: HTMLElement): void {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  // Never scramble inside inputs, textareas, selects, or code blocks
  if (el.matches('input, textarea, select, pre, code')) {
    return;
  }

  const prevTimer = activeIntervalMap.get(el);
  if (prevTimer !== undefined) {
    window.clearInterval(prevTimer);
    activeIntervalMap.delete(el);
  }

  const textNodes = collectTextNodes(el);
  for (const node of textNodes) {
    if (!originalTextMap.has(node)) {
      originalTextMap.set(node, node.nodeValue ?? '');
    }
  }

  el.classList.remove('sl-glitching');
  void el.offsetWidth;
  el.classList.add('sl-glitching');

  let frame = 0;
  const totalFrames = 4;

  const timerId = window.setInterval(() => {
    frame += 1;
    if (frame >= totalFrames || !el.isConnected) {
      window.clearInterval(timerId);
      activeIntervalMap.delete(el);
      for (const node of textNodes) {
        const orig = originalTextMap.get(node);
        if (orig !== undefined) {
          node.nodeValue = orig;
          originalTextMap.delete(node);
        }
      }
      el.classList.remove('sl-glitching');
      return;
    }

    const intensity = frame === 1 ? 0.55 : frame === 2 ? 0.35 : 0.18;
    for (const node of textNodes) {
      const orig = originalTextMap.get(node);
      if (orig !== undefined) {
        node.nodeValue = scramblePreserveSpaces(orig, intensity);
      }
    }
  }, 38);

  activeIntervalMap.set(el, timerId);
}
