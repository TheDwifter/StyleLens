import { describe, expect, it } from 'vitest';
import { analyzeDesignDNA } from '../../core/designAnalyzer';
import { DEFAULT_AI_SETTINGS } from '../../storage/aiSettingsStore';
import type { CaptureRecord, RawDomExtraction } from '../../types/capture';
import { askDesignAdvisor, buildOfflineAdvice } from '../designAdvisor';

function makeCaptureFixture(): CaptureRecord {
  const dom: RawDomExtraction = {
    captureMode: 'dom-and-visual',
    selectionMethod: 'element-snap',
    totalNodesScanned: 2,
    truncated: false,
    cssVariables: [],
    roots: [
      {
        id: 'n1',
        tag: 'div',
        cleanClasses: ['card'],
        omittedHashedClassCount: 0,
        rect: { x: 0, y: 0, width: 320, height: 180 },
        styles: {
          display: 'flex',
          position: 'static',
          flexDirection: 'column',
          gap: '16px',
          padding: '24px',
          width: '320px',
          height: '180px',
          backgroundColor: 'rgba(18, 18, 22, 0.8)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '16px',
          backdropFilter: 'blur(12px)',
        },
        effectiveBackgroundHex: '#121216',
        hasNonSolidBackgroundAncestor: false,
        pseudoElements: [],
        children: [
          {
            id: 'n2',
            tag: 'p',
            cleanClasses: ['muted'],
            omittedHashedClassCount: 0,
            textSnippet: 'Low contrast label',
            rect: { x: 24, y: 24, width: 200, height: 20 },
            styles: {
              display: 'block',
              position: 'static',
              width: '200px',
              height: '20px',
              color: 'rgb(82, 82, 91)',
              fontFamily: 'Inter, sans-serif',
              fontSize: '13px',
              fontWeight: '500',
            },
            effectiveBackgroundHex: '#121216',
            hasNonSolidBackgroundAncestor: false,
            pseudoElements: [],
            children: [],
          },
        ],
      },
    ],
  };

  const rect = { x: 0, y: 0, width: 320, height: 180 };
  return {
    id: 'adv-1',
    createdAt: 1763700000000,
    page: { url: 'https://demo.ui', hostname: 'demo.ui', title: 'Demo UI' },
    rect,
    viewport: { width: 1280, height: 800, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    captureMode: 'dom-and-visual',
    selectionMethod: 'element-snap',
    totalNodesScanned: 2,
    truncated: false,
    screenshotBlob: new Blob(['png'], { type: 'image/png' }),
    screenshotWidth: 640,
    screenshotHeight: 360,
    roots: dom.roots,
    dna: analyzeDesignDNA(dom, [], rect),
  };
}

describe('designAdvisor', () => {
  it('guides the user politely when no capture exists yet', () => {
    const reply = buildOfflineAdvice('Audit contrast', null);
    expect(reply).toMatch(/Capture any section/i);
  });

  it('flags exact failing WCAG contrast ratios from the captured Design DNA', () => {
    const record = makeCaptureFixture();
    const reply = buildOfflineAdvice('Can you audit contrast?', record);
    expect(reply).toMatch(/below WCAG AA 4\.5:1/i);
    expect(reply).toContain('#52525B');
  });

  it('gives grounded glassmorphism & layout recreation tips offline', async () => {
    const record = makeCaptureFixture();
    const reply = await askDesignAdvisor({
      question: 'How do I recreate this layout?',
      record,
      history: [],
      aiSettings: DEFAULT_AI_SETTINGS,
    });
    expect(reply.sourceLabel).toBe('Local Advisor');
    expect(reply.text).toMatch(/FLEX container/i);
    expect(reply.text).toMatch(/blur\(12px\)/i);
  });

  it('answers all Simplified Chinese quick-asks in natural Simplified Chinese when language is zh-CN', async () => {
    const record = makeCaptureFixture();
    const zhSettings = { ...DEFAULT_AI_SETTINGS, language: 'zh-CN' as const };

    const contrastReply = await askDesignAdvisor({
      question: '检查可读性与对比度',
      record,
      history: [],
      aiSettings: zhSettings,
    });
    expect(contrastReply.sourceLabel).toBe('本地设计顾问');
    expect(contrastReply.text).toContain('WCAG AA 4.5:1');
    expect(contrastReply.text).toContain('#52525B');
    expect(contrastReply.text).toMatch(/检测到/);

    const recreateReply = await askDesignAdvisor({
      question: '如何 1:1 复刻这个设计？',
      record,
      history: [],
      aiSettings: zhSettings,
    });
    expect(recreateReply.text).toContain('FLEX');
    expect(recreateReply.text).toContain('毛玻璃');

    const colorFontReply = await askDesignAdvisor({
      question: '分析配色与字体搭配',
      record,
      history: [],
      aiSettings: zhSettings,
    });
    expect(colorFontReply.text).toContain('深色主题');
    expect(colorFontReply.text).toContain('Inter');

    const emptyReply = buildOfflineAdvice('检查可读性与对比度', null, 'zh-CN');
    expect(emptyReply).toContain('请先在网页上框选');
  });
});
