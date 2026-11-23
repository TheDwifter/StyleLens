import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeDesignDNA } from '../../core/designAnalyzer';
import type { CaptureRecord, RawDomExtraction } from '../../types/capture';
import { OpenAICompatibleProvider, testByokConnection } from '../openaiCompatibleProvider';

function makeRecord(): CaptureRecord {
  const dom: RawDomExtraction = {
    captureMode: 'dom-and-visual',
    selectionMethod: 'element-snap',
    totalNodesScanned: 1,
    truncated: false,
    cssVariables: [],
    roots: [
      {
        id: 'n1',
        tag: 'div',
        cleanClasses: ['card'],
        omittedHashedClassCount: 0,
        textSnippet: 'Revenue',
        rect: { x: 0, y: 0, width: 320, height: 180 },
        styles: {
          display: 'flex',
          position: 'static',
          flexDirection: 'column',
          gap: '12px',
          padding: '20px',
          width: '320px',
          height: '180px',
          color: 'rgb(244, 244, 245)',
          backgroundColor: 'rgb(18, 18, 22)',
          borderRadius: '14px',
          fontFamily: 'Inter, sans-serif',
          fontSize: '16px',
          fontWeight: '600',
        },
        effectiveBackgroundHex: '#121216',
        hasNonSolidBackgroundAncestor: false,
        pseudoElements: [],
        children: [],
      },
    ],
  };

  const rect = { x: 0, y: 0, width: 320, height: 180 };
  return {
    id: 'rec-1',
    createdAt: 1763700000000,
    page: { url: 'https://example.dev', hostname: 'example.dev', title: 'Example' },
    rect,
    viewport: { width: 1280, height: 800, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    captureMode: 'dom-and-visual',
    selectionMethod: 'element-snap',
    totalNodesScanned: 1,
    truncated: false,
    screenshotBlob: new Blob(['png-bytes'], { type: 'image/png' }),
    screenshotWidth: 640,
    screenshotHeight: 360,
    roots: dom.roots,
    dna: analyzeDesignDNA(dom, [], rect),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenAICompatibleProvider', () => {
  it('validates configuration cleanly (Ollama needs no key, DeepSeek requires key)', () => {
    const ollama = new OpenAICompatibleProvider({
      presetId: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5-coder:7b',
      apiKey: '',
      includeScreenshot: false,
    });
    expect(ollama.isConfigured()).toBe(true);

    const deepseekNoKey = new OpenAICompatibleProvider({
      presetId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: '',
      includeScreenshot: false,
    });
    expect(deepseekNoKey.isConfigured()).toBe(false);
  });

  it('calls OpenAI-compatible chat completions and parses structured JSON remix output', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  previewHtml:
                    '<style>.kpi{display:flex;gap:12px;padding:20px;background:#121216;border-radius:14px;color:#F4F4F5;font-family:Inter,sans-serif;font-size:16px;font-weight:600;}</style><div class="kpi">99.9%</div>',
                  code: 'export function KpiCard() { return <div className="flex gap-[12px] p-[20px] bg-[#121216] text-[#F4F4F5] font-semibold text-[16px]" style={{ fontFamily: "Inter, sans-serif", borderRadius: "14px" }}>99.9%</div>; }',
                  influencedBy: [
                    { token: '#121216 surface', usage: 'Used for dark card background' },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const provider = new OpenAICompatibleProvider({
      presetId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1/',
      model: 'deepseek-chat',
      apiKey: 'sk-test-key',
      includeScreenshot: false,
    });

    const result = await provider.synthesizeRemix({
      record: makeRecord(),
      userPrompt: 'Build a KPI card',
      targetStack: 'react-tailwind',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-key');

    expect(result.modelLabel).toBe('deepseek-chat');
    expect(result.usedVision).toBe(false);
    expect(result.previewHtml).toContain('99.9%');
    expect(result.generatedCode).toContain('KpiCard');
    expect(result.influencedBy[0]?.token).toBe('#121216 surface');
    expect(result.fidelityReport?.passedThreshold).toBe(true);
  });

  it('returns clear error message on 401 unauthorized', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Invalid API key', { status: 401 })
    );

    const testRes = await testByokConnection({
      presetId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-bad',
      includeScreenshot: false,
    });

    expect(testRes.ok).toBe(false);
    expect(testRes.message).toMatch(/Authentication failed \(401\)/);
  });

  it('calls native Anthropic Messages API when Claude preset is selected', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                previewHtml: '<div>Claude Card</div>',
                code: 'export const ClaudeCard = () => <div>Claude Card</div>;',
                influencedBy: [{ token: 'Inter 16px', usage: 'Applied to card heading' }],
              }),
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const claude = new OpenAICompatibleProvider({
      presetId: 'claude',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'sk-ant-test',
      includeScreenshot: false,
    });

    const out = await claude.synthesizeRemix({
      record: makeRecord(),
      userPrompt: 'Build a card',
      targetStack: 'react-tailwind',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(out.previewHtml).toBe('<div>Claude Card</div>');
  });
});
