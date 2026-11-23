import { describe, expect, it } from 'vitest';
import { analyzeDesignDNA } from '../designAnalyzer';
import { isHashedClassName } from '../domExtractor';
import type { ExtractedNode, RawDomExtraction, SampledColor } from '../../types/capture';

function makeGlassCardDom(): RawDomExtraction {
  const buttonNode: ExtractedNode = {
    id: 'n3',
    tag: 'button',
    cleanClasses: ['btn-primary'],
    omittedHashedClassCount: 1,
    textSnippet: 'Upgrade Plan',
    rect: { x: 40, y: 180, width: 140, height: 38 },
    styles: {
      display: 'inline-flex',
      position: 'static',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '8px 16px',
      width: '140px',
      height: '38px',
      color: 'rgb(255, 255, 255)',
      backgroundColor: 'rgb(99, 102, 241)',
      borderRadius: '9999px',
      fontFamily: '"Inter", sans-serif',
      fontSize: '14px',
      fontWeight: '600',
      lineHeight: '20px',
    },
    effectiveBackgroundHex: '#6366F1',
    hasNonSolidBackgroundAncestor: false,
    pseudoElements: [],
    children: [],
  };

  const titleNode: ExtractedNode = {
    id: 'n2',
    tag: 'h2',
    cleanClasses: ['card-title'],
    omittedHashedClassCount: 0,
    textSnippet: 'Pro Workspace',
    rect: { x: 40, y: 40, width: 220, height: 32 },
    styles: {
      display: 'block',
      position: 'static',
      width: '220px',
      height: '32px',
      color: 'rgb(244, 244, 245)',
      fontFamily: '"Inter", system-ui, sans-serif',
      fontSize: '24px',
      fontWeight: '700',
      lineHeight: '32px',
    },
    effectiveBackgroundHex: '#18181B',
    hasNonSolidBackgroundAncestor: false,
    pseudoElements: [],
    children: [],
  };

  const rootCard: ExtractedNode = {
    id: 'n1',
    tag: 'section',
    cleanClasses: ['pricing-card'],
    omittedHashedClassCount: 2,
    rect: { x: 20, y: 20, width: 320, height: 240 },
    styles: {
      display: 'flex',
      position: 'relative',
      flexDirection: 'column',
      gap: '16px',
      padding: '24px',
      width: '320px',
      height: '240px',
      backgroundColor: 'rgba(24, 24, 27, 0.72)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '16px',
      boxShadow: '0px 20px 40px rgba(0, 0, 0, 0.45)',
      backdropFilter: 'blur(16px)',
    },
    effectiveBackgroundHex: '#18181B',
    hasNonSolidBackgroundAncestor: false,
    pseudoElements: [],
    children: [titleNode, buttonNode],
  };

  return {
    captureMode: 'dom-and-visual',
    selectionMethod: 'element-snap',
    totalNodesScanned: 3,
    truncated: false,
    roots: [rootCard],
    cssVariables: [{ name: '--accent-primary', value: '#6366f1' }],
  };
}

describe('designAnalyzer', () => {
  it('identifies CSS-in-JS and CSS Module hashed class names while keeping semantic classes', () => {
    expect(isHashedClassName('css-1a2b3c4')).toBe(true);
    expect(isHashedClassName('Card_root__x9f2a1')).toBe(true);
    expect(isHashedClassName('pricing-card')).toBe(false);
    expect(isHashedClassName('flex')).toBe(false);
  });

  it('extracts glassmorphism, dark polarity, 8px rhythm, exact+sampled palette, and WCAG checks', () => {
    const dom = makeGlassCardDom();
    const sampled: SampledColor[] = [
      { hex: '#18181B', rgb: [24, 24, 27], percentage: 68.5 }, // duplicates exact DOM, should be skipped
      { hex: '#38BDF8', rgb: [56, 189, 248], percentage: 9.2 }, // unique visual accent, should be kept as sampled
    ];

    const dna = analyzeDesignDNA(dom, sampled, { x: 20, y: 20, width: 320, height: 240 });

    expect(dna.polarity).toBe('dark');
    expect(dna.layout.primaryModel).toBe('flex');
    expect(dna.layout.spacingGridBase).toBe(8);

    const traitIds = dna.traits.map((t) => t.id);
    expect(traitIds).toContain('dark-polarity');
    expect(traitIds).toContain('glassmorphism');
    expect(traitIds).toContain('hairline-borders');
    expect(traitIds).toContain('pill-geometry');

    // Exact DOM colors and deduplicated sampled color
    const exactColors = dna.palette.filter((c) => c.provenance === 'exact-dom');
    const sampledColors = dna.palette.filter((c) => c.provenance === 'sampled-pixels');
    expect(exactColors.some((c) => c.hex === '#6366F1' && c.role === 'accent')).toBe(true);
    expect(sampledColors).toHaveLength(1);
    expect(sampledColors[0]?.hex).toBe('#38BDF8');

    // Typography hierarchy
    expect(dna.typography).toHaveLength(2);
    expect(dna.typography[0]?.role).toBe('heading');
    expect(dna.typography[0]?.primaryFont).toBe('Inter');

    // WCAG contrast checks
    expect(dna.contrastChecks.length).toBeGreaterThanOrEqual(2);
    const titleCheck = dna.contrastChecks.find((c) => c.foregroundHex === '#F4F4F5');
    expect(titleCheck?.aaNormal).toBe(true);
    expect(titleCheck?.isEstimated).toBe(false);
  });

  it('handles visual-only captures honestly without fabricating typography or layout', () => {
    const visualOnlyDom: RawDomExtraction = {
      captureMode: 'visual-only',
      visualFallbackReason: 'Selected region is a <video> frame.',
      selectionMethod: 'marquee',
      totalNodesScanned: 1,
      truncated: false,
      roots: [],
      cssVariables: [],
    };
    const sampled: SampledColor[] = [
      { hex: '#0F172A', rgb: [15, 23, 42], percentage: 52.1 },
      { hex: '#F97316', rgb: [249, 115, 22], percentage: 18.4 },
    ];

    const dna = analyzeDesignDNA(visualOnlyDom, sampled, { x: 0, y: 0, width: 400, height: 225 });
    expect(dna.layout.primaryModel).toBe('visual-only');
    expect(dna.typography).toHaveLength(0);
    expect(dna.palette).toHaveLength(2);
    expect(dna.palette.every((c) => c.provenance === 'sampled-pixels')).toBe(true);
  });
});
