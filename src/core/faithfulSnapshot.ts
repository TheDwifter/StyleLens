import { buildPreviewFontAssets, buildPreviewSrcDoc } from '../ai/responseParser';
import type { CaptureRecord, ExtractedNode, ExtractedPseudoElement } from '../types/capture';
import { generateCssTokens } from './specGenerator';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanPrimaryFontName(rawStack: string): string {
  const first = (rawStack.split(',')[0] ?? '').replace(/^["'\s]+|["'\s]+$/g, '');
  return first.replace(/^__/, '').replace(/_[a-f0-9]{5,}$/i, '').replace(/_/g, ' ').trim();
}

function normalizeFontStack(fontStack: string): string {
  const cleaned = cleanPrimaryFontName(fontStack);
  if (!cleaned) return fontStack;
  const firstRaw = (fontStack.split(',')[0] ?? '').replace(/^["'\s]+|["'\s]+$/g, '');
  if (cleaned.toLowerCase() !== firstRaw.toLowerCase()) {
    return `"${cleaned}", ${fontStack}`;
  }
  return fontStack;
}

interface MultiRootOffset {
  leftPx: number;
  topPx: number;
}

function buildNodeCssDeclarations(
  node: ExtractedNode,
  isRoot: boolean,
  multiRootOffset?: MultiRootOffset
): string[] {
  const s = node.styles;
  const decls: string[] = [];

  const push = (prop: string, val: string | undefined) => {
    if (val !== undefined && val !== '') {
      decls.push(`  ${prop}: ${val};`);
    }
  };

  // Inline <svg> rendered inside <span class="sl-nX"> must not stay `display: inline`
  // or browsers ignore explicit width/height on the wrapper span.
  const normalizedDisplay =
    node.tag === 'svg' && (!s.display || s.display === 'inline')
      ? 'inline-block'
      : s.display;
  push('display', normalizedDisplay);

  if (isRoot && multiRootOffset) {
    // Multi-root marquee capture: preserve exact measured 2D screen coordinates inside the canvas
    push('position', 'absolute');
    push('left', `${multiRootOffset.leftPx}px`);
    push('top', `${multiRootOffset.topPx}px`);
  } else if (isRoot) {
    // Normalize fixed/sticky/absolute roots to relative so captured sections render in-flow
    if (
      s.position === 'fixed' ||
      s.position === 'sticky' ||
      s.position === 'absolute' ||
      s.position === 'relative'
    ) {
      push('position', 'relative');
    } else if (s.position && s.position !== 'static') {
      push('position', s.position);
    }
  } else if (s.position === 'fixed' || s.position === 'sticky') {
    // Convert non-root fixed/sticky overlays to absolute inside frame if offset exists, else relative
    const hasOffset = Boolean(s.top || s.right || s.bottom || s.left);
    push('position', hasOffset ? 'absolute' : 'relative');
    if (hasOffset) {
      push('top', s.top);
      push('right', s.right);
      push('bottom', s.bottom);
      push('left', s.left);
    }
  } else if (s.position && s.position !== 'static') {
    push('position', s.position);
    push('top', s.top);
    push('right', s.right);
    push('bottom', s.bottom);
    push('left', s.left);
  }
  push('box-sizing', s.boxSizing ?? 'border-box');

  const isLeafVisualBox =
    !isRoot &&
    node.children.length === 0 &&
    !node.textSnippet &&
    node.rect.width > 0 &&
    node.rect.height > 0;
  const isCompactFramedBadge =
    !isRoot &&
    !node.textSnippet &&
    node.rect.width > 0 &&
    node.rect.width <= 96 &&
    node.rect.height > 0 &&
    node.rect.height <= 96 &&
    Boolean(s.backgroundColor || s.backgroundImage || s.border || s.borderRadius);
  const isFramedLayoutContainer =
    !isRoot &&
    node.children.length > 0 &&
    !s.flex &&
    node.rect.width > 0 &&
    (s.display === 'flex' ||
      s.display === 'grid' ||
      s.display === 'block') &&
    Boolean(
      s.backgroundColor ||
        s.backgroundImage ||
        s.border ||
        s.borderTop ||
        s.borderRight ||
        s.borderBottom ||
        s.borderLeft ||
        s.borderRadius ||
        s.boxShadow ||
        s.display === 'grid'
    );

  const rootWidthDecl = multiRootOffset && multiRootOffset.leftPx > 0
    ? `min(calc(100% - ${multiRootOffset.leftPx}px), ${s.width})`
    : `min(100%, ${s.width})`;

  if (isRoot && (node.tag === 'img' || node.tag === 'svg')) {
    // Root <svg> and <img> need explicit height (not min-height) so `svg { height: 100% }` resolves
    push('width', rootWidthDecl);
    push('height', s.height);
  } else if (isRoot) {
    // Keep roots responsive inside preview stages while honoring exact proportions
    push('width', rootWidthDecl);
    if (s.height && s.height !== '0px') push('min-height', s.height);
  } else if (node.tag === 'img' || node.tag === 'svg' || node.tag === 'hr' || node.tag === 'input') {
    push('width', node.rect.width > 160 ? `min(100%, ${s.width})` : s.width);
    push('height', s.height);
  } else if (isLeafVisualBox || isCompactFramedBadge || s.position === 'absolute') {
    push('width', node.rect.width > 160 ? `min(100%, ${s.width})` : s.width);
    push('height', s.height);
    if (isCompactFramedBadge) push('flex-shrink', '0');
  } else if (isFramedLayoutContainer) {
    push('width', `min(100%, ${s.width})`);
    if (s.minHeight) push('min-height', s.minHeight);
  } else if (s.minHeight) {
    push('min-height', s.minHeight);
  }

  push('flex-direction', s.flexDirection);
  push('justify-content', s.justifyContent);
  push('align-items', s.alignItems);
  push('align-self', s.alignSelf);
  push('flex-wrap', s.flexWrap);
  push('flex', s.flex);
  push('grid-template-columns', s.gridTemplateColumns);
  push('grid-template-rows', s.gridTemplateRows);
  push('grid-column', s.gridColumn);
  push('grid-row', s.gridRow);
  push('place-items', s.placeItems);
  push('gap', s.gap);
  if (!s.gap) {
    push('row-gap', s.rowGap);
    push('column-gap', s.columnGap);
  }
  push('padding', s.padding);
  if (!isRoot) push('margin', s.margin);
  push('min-width', s.minWidth);
  push('max-width', s.maxWidth);

  push('color', s.color);
  push('background-color', s.backgroundColor);
  push('background-image', s.backgroundImage);
  push('background-size', s.backgroundSize);
  push('background-position', s.backgroundPosition);
  push('background-repeat', s.backgroundRepeat);
  if (s.backgroundClip === 'text') {
    push('-webkit-background-clip', 'text');
    push('background-clip', 'text');
    push('-webkit-text-fill-color', s.webkitTextFillColor ?? 'transparent');
  }

  if (s.border && !s.borderTop && !s.borderRight && !s.borderBottom && !s.borderLeft) {
    push('border', s.border);
  } else {
    push('border-top', s.borderTop);
    push('border-right', s.borderRight);
    push('border-bottom', s.borderBottom);
    push('border-left', s.borderLeft);
  }

  push('border-radius', s.borderRadius);
  push('box-shadow', s.boxShadow);
  push('text-shadow', s.textShadow);
  push('transform', s.transform);
  push('transform-origin', s.transformOrigin);
  push('clip-path', s.clipPath);
  push('filter', s.filter);
  push('opacity', s.opacity);
  if (s.backdropFilter) {
    push('-webkit-backdrop-filter', s.backdropFilter);
    push('backdrop-filter', s.backdropFilter);
  }
  push('overflow', s.overflow);
  push('object-fit', s.objectFit);
  push('z-index', s.zIndex);

  if (s.fontFamily) push('font-family', normalizeFontStack(s.fontFamily));
  push('font-size', s.fontSize);
  push('font-weight', s.fontWeight);
  push('font-style', s.fontStyle);
  push('font-stretch', s.fontStretch);
  push('line-height', s.lineHeight);
  push('letter-spacing', s.letterSpacing);
  push('text-transform', s.textTransform);
  push('text-align', s.textAlign);
  push('text-decoration', s.textDecoration);
  push('white-space', s.whiteSpace);
  push('list-style-type', s.listStyleType);

  return decls;
}

function buildPseudoCssRule(selector: string, p: ExtractedPseudoElement): string {
  const decls: string[] = [];
  const push = (prop: string, val: string | undefined) => {
    if (val !== undefined && val !== '') decls.push(`  ${prop}: ${val};`);
  };
  push('content', p.content ?? '""');
  push('position', p.position);
  if (p.inset) {
    push('inset', p.inset);
  } else {
    push('top', p.top);
    push('right', p.right);
    push('bottom', p.bottom);
    push('left', p.left);
  }
  push('width', p.width);
  push('height', p.height);
  push('color', p.color);
  push('background-color', p.backgroundColor);
  push('background-image', p.backgroundImage);
  if (p.border && !p.borderTop && !p.borderRight && !p.borderBottom && !p.borderLeft) {
    push('border', p.border);
  } else {
    push('border-top', p.borderTop);
    push('border-right', p.borderRight);
    push('border-bottom', p.borderBottom);
    push('border-left', p.borderLeft);
  }
  push('border-radius', p.borderRadius);
  push('box-shadow', p.boxShadow);
  if (p.backdropFilter) {
    push('-webkit-backdrop-filter', p.backdropFilter);
    push('backdrop-filter', p.backdropFilter);
  }
  push('transform', p.transform);
  push('clip-path', p.clipPath);
  push('opacity', p.opacity);
  push('z-index', p.zIndex);

  if (decls.length === 0) return '';
  return `${selector}${p.pseudo} {\n${decls.join('\n')}\n}`;
}

export interface FaithfulSnapshotResult {
  scopedCss: string;
  bodyHtml: string;
  combinedSnippet: string;
}

/**
 * Safely budgets a faithful snapshot for LLM prompts without EVER truncating mid-rule,
 * leaving an unclosed <style> tag, or chopping off the HTML body markup.
 */
export function formatBlueprintForPrompt(
  snapshot: FaithfulSnapshotResult,
  maxChars = 7000
): string {
  if (snapshot.combinedSnippet.length <= maxChars) {
    return snapshot.combinedSnippet;
  }

  const maxBodyChars = Math.floor(maxChars * 0.48);
  // First compact oversized inline <svg> path payloads so one verbose logo NEVER drops downstream nav/headings
  let body = snapshot.bodyHtml.replace(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/gi, (full, attrs: string, inner: string) => {
    if (full.length <= 1600) return full;
    const fillMatch = inner.match(/fill="([^"]+)"/i);
    const fillHint = fillMatch?.[1] ? ` fill="${fillMatch[1]}"` : '';
    return `<svg${attrs}${fillHint}><!-- vector paths abbreviated for prompt budget; full inline SVG in Code tab --></svg>`;
  });

  if (body.length > maxBodyChars) {
    const lines = body.split('\n');
    const kept: string[] = [];
    const openStack: string[] = [];
    const voidTagSet = new Set(['img', 'input', 'hr', 'br', 'source', 'meta', 'link', 'path', 'rect', 'circle', 'line', 'polygon', 'polyline', 'ellipse']);
    let len = 0;

    for (const line of lines) {
      if (len + line.length + 1 > maxBodyChars - 96) break;
      kept.push(line);
      len += line.length + 1;

      for (const m of line.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*?(\/?)>/gi)) {
        const isClosing = m[1] === '/';
        const tag = (m[2] ?? '').toLowerCase();
        const isSelfClosing = m[3] === '/' || voidTagSet.has(tag);
        if (isSelfClosing) continue;
        if (isClosing) {
          const idx = openStack.lastIndexOf(tag);
          if (idx !== -1) openStack.splice(idx, 1);
        } else {
          openStack.push(tag);
        }
      }
    }

    const closers = openStack.reverse().map((t) => `</${t}>`).join('\n');
    body = `${kept.join('\n')}\n  <!-- additional child nodes omitted for prompt budget -->\n${closers}`;
  }

  // Only include CSS rules relevant to classes actually present in `body` (plus frame resets)
  const usedClasses = new Set<string>(Array.from(body.matchAll(/\bsl-n\d+\b/g), (m) => m[0]));
  const cssBudget = Math.max(800, maxChars - body.length - 64);
  const rules = snapshot.scopedCss.split('\n\n').filter((rule) => {
    const nodeMatch = rule.match(/^\.(sl-n\d+)\b/);
    if (!nodeMatch) return true; // Keep frame & :where() reset rules
    return usedClasses.has(nodeMatch[1]!);
  });

  const keptRules: string[] = [];
  let cssLen = 0;
  let cssTruncated = false;

  for (const rule of rules) {
    if (cssLen + rule.length + 2 > cssBudget) {
      cssTruncated = true;
      break;
    }
    keptRules.push(rule);
    cssLen += rule.length + 2;
  }

  const cssBlock = cssTruncated
    ? `${keptRules.join('\n\n')}\n/* remaining node rules omitted for prompt budget */`
    : keptRules.join('\n\n');

  return `<style>\n${cssBlock}\n</style>\n${body}`;
}

/**
 * Compiles a captured DOM + computed CSS tree into a clean, self-contained
 * 1-to-1 HTML + scoped CSS recreation (preserving exact fonts, colors, 2D spatial layout,
 * borders, shadows, transforms, clip-paths, pseudo-elements, and inline SVGs).
 */
export function generateFaithfulSnapshot(record: CaptureRecord): FaithfulSnapshotResult {
  if (record.roots.length === 0) {
    const fallbackBg = record.dna.palette[0]?.hex ?? (record.dna.polarity === 'light' ? '#ffffff' : '#09090b');
    const fallbackCss = `.sl-faithful-root {\n  width: min(100%, ${record.rect.width}px);\n  min-height: ${Math.min(260, record.rect.height)}px;\n  background: ${fallbackBg};\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 20px;\n}`;
    const fallbackHtml = `<div class="sl-faithful-root">Visual-only capture (no DOM exposed)</div>`;
    return {
      scopedCss: fallbackCss,
      bodyHtml: fallbackHtml,
      combinedSnippet: `<style>\n${fallbackCss}\n</style>\n${fallbackHtml}`,
    };
  }

  const cssRules: string[] = [];
  const rootBackdrop =
    record.roots[0]?.effectiveBackgroundHex ??
    (record.dna.polarity === 'light' ? '#ffffff' : '#09090b');

  const isMultiRootSpatial = record.roots.length > 1;
  let originX = record.rect.x;
  let originY = record.rect.y;
  let canvasWidth = Math.max(1, record.rect.width);
  let canvasHeight = Math.max(1, record.rect.height);

  if (isMultiRootSpatial) {
    // Clamp origin and canvas width to the user's actual marquee box so a 1440px full-width <h1>
    // block never blows up canvasWidth beyond the dragged region.
    const minRootX = Math.min(...record.roots.map((r) => Math.max(record.rect.x, r.rect.x)));
    const minRootY = Math.min(...record.roots.map((r) => Math.max(record.rect.y, r.rect.y)));
    originX = Math.min(record.rect.x, minRootX);
    originY = Math.min(record.rect.y, minRootY);
    const maxBottom = Math.max(
      record.rect.y + record.rect.height,
      ...record.roots.map((r) => Math.min(record.rect.y + record.rect.height + 24, r.rect.y + r.rect.height))
    );
    canvasWidth = Math.max(1, Math.round(record.rect.width));
    canvasHeight = Math.max(1, Math.round(maxBottom - originY));
  }

  // Zero-specificity :where(...) UA resets guarantee browser defaults never bleed in
  // while NEVER overriding any extracted `.sl-nX` class rule (specificity 0,1,0).
  // Frame uses zero artificial border-radius/padding so flat designs stay 100% faithful.
  cssRules.push(
    isMultiRootSpatial
      ? `.sl-capture-frame {\n  position: relative;\n  width: min(100%, ${canvasWidth}px);\n  min-height: ${canvasHeight}px;\n  background: ${rootBackdrop};\n  overflow-x: clip;\n}`
      : `.sl-capture-frame {\n  position: relative;\n  width: 100%;\n  background: ${rootBackdrop};\n  overflow-x: clip;\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n}`,
    `:where(.sl-capture-frame h1, .sl-capture-frame h2, .sl-capture-frame h3, .sl-capture-frame h4, .sl-capture-frame h5, .sl-capture-frame h6, .sl-capture-frame p, .sl-capture-frame ul, .sl-capture-frame ol, .sl-capture-frame figure, .sl-capture-frame blockquote) {\n  margin: 0;\n  padding: 0;\n}`,
    `:where(.sl-capture-frame ul, .sl-capture-frame ol) {\n  list-style: none;\n}`,
    `:where(.sl-capture-frame a) {\n  color: inherit;\n  text-decoration: none;\n}`,
    `:where(.sl-capture-frame button) {\n  font: inherit;\n  color: inherit;\n  background: transparent;\n  border: none;\n  padding: 0;\n}`,
    `:where(.sl-capture-frame svg) {\n  display: block;\n  width: 100%;\n  height: 100%;\n}`
  );

  const renderNode = (
    node: ExtractedNode,
    depth: number,
    isRoot: boolean,
    multiRootOffset?: MultiRootOffset
  ): string => {
    const className = `sl-${node.id}`;
    const decls = buildNodeCssDeclarations(node, isRoot, multiRootOffset);
    if (decls.length > 0) {
      cssRules.push(`.${className} {\n${decls.join('\n')}\n}`);
    }

    for (const pseudo of node.pseudoElements ?? []) {
      const pRule = buildPseudoCssRule(`.${className}`, pseudo);
      if (pRule) cssRules.push(pRule);
    }

    const indent = '  '.repeat(depth);

    // Inline <svg> vector preserved verbatim (sanitized during extraction)
    if (node.tag === 'svg' && node.svgMarkup) {
      return `${indent}<span class="${className}">${node.svgMarkup}</span>`;
    }

    // <img> preserved with exact dimensions & object-fit
    if (node.tag === 'img') {
      const srcAttr = node.imgSrc ? ` src="${escapeHtml(node.imgSrc)}"` : '';
      const altAttr = ` alt="${escapeHtml(node.imgAlt ?? '')}"`;
      return `${indent}<img class="${className}"${srcAttr}${altAttr} />`;
    }

    const safeTag = /^[a-z][a-z0-9-]*$/i.test(node.tag) ? node.tag : 'div';
    const voidTags = new Set(['input', 'hr', 'br', 'source', 'meta', 'link']);
    if (voidTags.has(safeTag)) {
      return `${indent}<${safeTag} class="${className}" />`;
    }

    if (node.inlineSegments && node.inlineSegments.length > 0) {
      const renderedInline = node.inlineSegments
        .map((seg) => {
          if (seg.kind === 'text') return escapeHtml(seg.text);
          if (seg.kind === 'br') return '<br />';
          const child = node.children[seg.index];
          return child ? renderNode(child, 0, false) : '';
        })
        .join('');
      return `${indent}<${safeTag} class="${className}">${renderedInline}</${safeTag}>`;
    }

    const text = node.textSnippet ? escapeHtml(node.textSnippet) : '';
    if (node.children.length === 0) {
      return `${indent}<${safeTag} class="${className}">${text}</${safeTag}>`;
    }

    const childMarkup = node.children.map((c) => renderNode(c, depth + 1, false)).join('\n');
    const inner = text ? `${indent}  ${text}\n${childMarkup}` : childMarkup;
    return `${indent}<${safeTag} class="${className}">\n${inner}\n${indent}</${safeTag}>`;
  };

  const rootsMarkup = record.roots
    .map((r) =>
      renderNode(
        r,
        1,
        true,
        isMultiRootSpatial
          ? {
              leftPx: Math.max(0, Math.round(r.rect.x - originX)),
              topPx: Math.max(0, Math.round(r.rect.y - originY)),
            }
          : undefined
      )
    )
    .join('\n');
  const bodyHtml = `<div class="sl-capture-frame">\n${rootsMarkup}\n</div>`;
  const scopedCss = cssRules.join('\n\n');

  return {
    scopedCss,
    bodyHtml,
    combinedSnippet: `<style>\n${scopedCss}\n</style>\n${bodyHtml}`,
  };
}

/**
 * Generates a complete, standalone downloadable `.html` file that opens in any browser
 * and renders a 1-to-1 recreation with exact webfonts and computed CSS.
 */
export function generateStandaloneHtmlFile(record: CaptureRecord): string {
  const snapshot = generateFaithfulSnapshot(record);
  const cssTokens = generateCssTokens(record);

  return buildPreviewSrcDoc(
    snapshot.combinedSnippet,
    cssTokens,
    record.dna.polarity,
    buildPreviewFontAssets(record),
    Math.max(680, record.rect.width + 64)
  );
}
