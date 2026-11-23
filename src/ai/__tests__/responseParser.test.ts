import { describe, expect, it } from 'vitest';
import {
  buildPreviewSrcDoc,
  parseAiRemixResponse,
  sanitizePreviewHtml,
} from '../responseParser';

describe('responseParser', () => {
  it('parses clean strict JSON output', () => {
    const raw = JSON.stringify({
      previewHtml: '<div class="card">Hello</div>',
      code: 'export function Card() { return <div />; }',
      influencedBy: [
        { token: '#6366F1 accent', usage: 'Used for primary CTA fill' },
      ],
    });

    const parsed = parseAiRemixResponse(raw);
    expect(parsed.previewHtml).toBe('<div class="card">Hello</div>');
    expect(parsed.code).toContain('export function Card');
    expect(parsed.influencedBy).toHaveLength(1);
    expect(parsed.influencedBy[0]?.token).toBe('#6366F1 accent');
  });

  it('parses JSON wrapped in markdown fences and surrounding prose', () => {
    const raw = `Here is your remixed design:
\`\`\`json
{
  "previewHtml": "<section>Dashboard</section>",
  "code": "<section class='p-4'>Dashboard</section>",
  "influencedBy": [{ "token": "16px radius", "usage": "Card frame rounding" }]
}
\`\`\`
Enjoy!`;

    const parsed = parseAiRemixResponse(raw);
    expect(parsed.previewHtml).toBe('<section>Dashboard</section>');
    expect(parsed.code).toContain("class='p-4'");
    expect(parsed.influencedBy[0]?.token).toBe('16px radius');
  });

  it('gracefully extracts code fences when a small model skips JSON format', () => {
    const raw = `Sure!
\`\`\`tsx
export function MetricCard() { return <div>42</div>; }
\`\`\`
\`\`\`html
<div class="metric">42</div>
\`\`\``;

    const parsed = parseAiRemixResponse(raw);
    expect(parsed.code).toContain('MetricCard');
    expect(parsed.previewHtml).toBe('<div class="metric">42</div>');
    expect(parsed.influencedBy).toEqual([]);
  });

  it('strips scripts, iframes, inline event handlers, and javascript: links in preview HTML', () => {
    const hostile = `<style>.btn{color:red}</style><div onclick="alert(1)" onmouseover='evil()'><a href="javascript:steal()">Link</a><script>fetch("https://evil.test")</script><iframe src="https://evil.test"></iframe><button>Safe</button></div>`;
    const safe = sanitizePreviewHtml(hostile);

    expect(safe).not.toMatch(/<script/i);
    expect(safe).not.toMatch(/<iframe/i);
    expect(safe).not.toMatch(/onclick=/i);
    expect(safe).not.toMatch(/onmouseover=/i);
    expect(safe).not.toMatch(/javascript:/i);
    expect(safe).toContain('<style>.btn{color:red}</style>');
    expect(safe).toContain('<button>Safe</button>');
  });

  it('builds a complete self-contained srcDoc with extracted CSS variables, polarity, and webfont links', () => {
    const doc = buildPreviewSrcDoc(
      '<div>Preview</div>',
      ':root { --sl-color-accent: #6366F1; }',
      'dark',
      {
        fontStylesheetUrls: ['https://fonts.googleapis.com/css2?family=Space+Grotesk&display=swap'],
        fontFaceRules: ['@font-face { font-family: "CustomBrand"; src: url("https://cdn.example/f.woff2"); }'],
        primaryFonts: ['Playfair Display', 'Arial'],
      }
    );
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('--sl-color-accent: #6366F1;');
    expect(doc).toContain('background: #09090b;');
    expect(doc).toContain('Space+Grotesk');
    expect(doc).toContain('Playfair+Display');
    expect(doc).toContain('@font-face { font-family: "CustomBrand"');
    expect(doc).not.toContain('family=Arial');
    expect(doc).toContain('<div>Preview</div>');
  });
});
