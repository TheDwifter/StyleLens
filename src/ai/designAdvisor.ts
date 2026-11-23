import { generateDesignDnaReport } from '../core/specGenerator';
import {
  ensureApiOriginPermission,
  normalizeBaseUrl,
  type AiSettings,
  type UiLanguage,
} from '../storage/aiSettingsStore';
import type { CaptureRecord } from '../types/capture';
import { isAnthropicConfig, OpenAICompatibleProvider } from './openaiCompatibleProvider';
import { getChromeLanguageModel } from './types';

export interface AdvisorMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  sourceLabel?: string;
}

export interface AdvisorRequest {
  question: string;
  record: CaptureRecord | null;
  history: AdvisorMessage[];
  aiSettings: AiSettings;
  signal?: AbortSignal;
}

export interface AdvisorReply {
  text: string;
  sourceLabel: string;
}

/**
 * Generates genuinely grounded, deterministic design advice directly from the
 * active capture's extracted Design DNA—works 100% offline with zero keys,
 * supporting both English and Simplified Chinese (`zh-CN`).
 */
export function buildOfflineAdvice(
  question: string,
  record: CaptureRecord | null,
  language: UiLanguage = 'en'
): string {
  const q = question.toLowerCase();
  const isZh = language === 'zh-CN';

  if (!record) {
    return isZh
      ? '请先在网页上框选捕获任意区域（按 Alt+Shift+S 或点击「扫描」按钮），随后我即可为您分析对比度、配色方案、字体层级、间距节奏或 1:1 复刻方法。'
      : 'Capture any section of a webpage first (Alt+Shift+S or the Capture button), and I can audit its contrast, palette, typography, spacing rhythm, or advise on how to recreate it cleanly.';
  }

  const { dna, page } = record;
  const failing = dna.contrastChecks.filter((c) => !c.aaNormal);
  const exactColors = dna.palette.filter((c) => c.provenance === 'exact-dom');
  const sampledColors = dna.palette.filter((c) => c.provenance === 'sampled-pixels');
  const primaryFont = dna.typography[0];
  const hasGlass = dna.traits.some((t) => t.id === 'glassmorphism');
  const polarityZh = dna.polarity === 'dark' ? '深色' : dna.polarity === 'light' ? '浅色' : '混合';

  // Contrast & Accessibility advice
  if (/contrast|wcag|a11y|accessib|readable|legib|对比|可读|无障碍|清晰/.test(q)) {
    if (dna.contrastChecks.length === 0) {
      return isZh
        ? `在 ${page.hostname} 的本次捕获中未检测到可直接测量的 DOM 文本对比组合。复刻这套${polarityZh}界面时，建议正文对比度不低于 4.5:1，大标题不低于 3.0:1。`
        : `No direct DOM text pairs were captured on ${page.hostname}. When recreating this ${dna.polarity} surface, aim for at least 4.5:1 contrast for body copy and 3.0:1 for large headings.`;
    }
    if (failing.length > 0) {
      const worst = failing[0]!;
      return isZh
        ? `检测到 ${failing.length} 组文字低于 WCAG AA 4.5:1 标准 — 最低为 ${worst.foregroundHex} 叠在 ${worst.backgroundHex} 上（对比度 ${worst.ratio}:1${worst.isEstimated ? '，基于非纯色背景估算' : ''}）。建议保持色相不变，将文字亮度调亮（深色背景）或调暗（浅色背景）约 15%。`
        : `${failing.length} text pair(s) fall below WCAG AA 4.5:1 — lowest is ${worst.foregroundHex} on ${worst.backgroundHex} (${worst.ratio}:1${worst.isEstimated ? ', estimated over a non-solid layer' : ''}). Nudge the text luminance lighter (for dark UI) or darker (for light UI) by ~15% while keeping the hue intact.`;
    }
    const lowest = dna.contrastChecks[0]!;
    return isZh
      ? `所有 ${dna.contrastChecks.length} 组实测文本对比度均通过 WCAG AA 标准（最低为 ${lowest.foregroundHex} / ${lowest.backgroundHex} 的 ${lowest.ratio}:1），可直接沿用这套配色而不会影响可读性。`
      : `All ${dna.contrastChecks.length} measured text pairs pass WCAG AA (lowest is ${lowest.ratio}:1 on ${lowest.foregroundHex} / ${lowest.backgroundHex}). You can transfer this palette directly without sacrificing readability.`;
  }

  // Combined Color & Font query (e.g. "Review colors & fonts" / "分析配色与字体搭配")
  const asksColor = /color|colour|palette|theme|swatch|hex|dark|light|accent|配色|颜色|色板|色彩|主题/.test(q);
  const asksFont = /font|type|typo|text|heading|hierarch|read|字体|字号|排版|字重/.test(q);

  if (asksColor && asksFont) {
    const accent = dna.palette.find((c) => c.role === 'accent');
    const bg = dna.palette.find((c) => c.role === 'background' || c.role === 'surface');
    const fonts = Array.from(new Set(dna.typography.map((t) => t.primaryFont))).slice(0, 2);
    if (isZh) {
      const colorPart = `本次捕获采用${polarityZh}主题，提取到 ${exactColors.length} 个精确 DOM 颜色${sampledColors.length > 0 ? `与 ${sampledColors.length} 个像素采样色` : ''}${bg ? `，主背景色为 ${bg.hex}` : ''}${accent ? `，强调色 ${accent.hex} 建议控制在主要按钮与高亮状态（约 10% 面积）` : ''}。`;
      const fontPart =
        fonts.length > 0
          ? `字体方面检测到 ${fonts.join(' + ')}（共 ${dna.typography.length} 级字号，主标题建议优先使用 ${primaryFont?.primaryFont ?? fonts[0]}）。`
          : `本次为视觉图像捕获，未暴露 DOM 字体，建议搭配几何无衬线字体（如 Inter / 思源黑体）。`;
      return `${colorPart}${fontPart}`;
    }
    const colorPart = `This ${dna.polarity} capture blends ${exactColors.length} exact DOM color(s)${bg ? ` anchored on ${bg.hex}` : ''}${accent ? ` with ${accent.hex} reserved for primary actions (~10% weight)` : ''}.`;
    const fontPart =
      fonts.length > 0
        ? ` Typography pairs ${fonts.join(' + ')} across ${dna.typography.length} scale step(s).`
        : ` No DOM font stack was exposed; pair a crisp neo-grotesque sans (Inter / Geist).`;
    return `${colorPart}${fontPart}`;
  }

  // Color & Palette advice
  if (asksColor) {
    const accent = dna.palette.find((c) => c.role === 'accent');
    const bg = dna.palette.find((c) => c.role === 'background' || c.role === 'surface');
    if (isZh) {
      const parts = [
        `本次捕获采用${polarityZh}风格，包含 ${exactColors.length} 个精确 DOM 颜色${sampledColors.length > 0 ? `以及 ${sampledColors.length} 个图像像素采样色` : ''}。`,
        bg ? `基础背景色为 ${bg.hex}。` : null,
        accent
          ? `建议将强调色 ${accent.hex} 克制地用于主要按钮与选中指示器（约占 10% 视觉权重），以保持画面高级感。`
          : '整体以中性色为主，建议仅引入 1 个克制的强调色用于核心按钮和焦点框。',
      ].filter(Boolean);
      return parts.join('');
    }
    const parts = [
      `This capture uses a ${dna.polarity} polarity anchored by ${exactColors.length} exact DOM color(s)${sampledColors.length > 0 ? ` and ${sampledColors.length} pixel-sampled accent(s)` : ''}.`,
      bg ? `Base surface sits at ${bg.hex}.` : null,
      accent
        ? `Keep ${accent.hex} restrained to primary actions and active indicators (~10% visual weight) so the layout stays crisp.`
        : 'It relies mostly on neutral tones—introduce one restrained accent color for primary CTAs and focus rings.',
    ].filter(Boolean);
    return parts.join(' ');
  }

  // Typography & Hierarchy advice
  if (asksFont) {
    if (dna.typography.length === 0) {
      return isZh
        ? `本次 ${record.captureMode} 捕获未暴露 DOM 字体信息。建议使用干净的现代无衬线字体（Inter / Geist / 思源黑体），标题行高 1.25–1.35，正文行高 1.5。`
        : `No DOM typography was exposed in this ${record.captureMode} capture. Pair a clean neo-grotesque sans (Inter / Geist) with a 1.25–1.35 heading line-height and 1.5 body line-height.`;
    }
    const fonts = Array.from(new Set(dna.typography.map((t) => t.primaryFont))).slice(0, 2);
    const sizes = dna.typography.map((t) => t.fontSizePx);
    const maxPx = Math.max(...sizes);
    const minPx = Math.min(...sizes);
    const ratio = minPx > 0 ? Number((maxPx / minPx).toFixed(2)) : 1;
    if (isZh) {
      return `检测到字体 ${fonts.join(' + ')}，共 ${dna.typography.length} 个字号层级（${minPx}px → ${maxPx}px，跨度 ${ratio} 倍）。${
        ratio < 1.35
          ? '当前字号跨度偏紧凑，建议加大标题字号或拉大字重对比以强化视觉层级。'
          : `建议以 ${maxPx}px 的 ${primaryFont?.primaryFont ?? '主字体'} 作为视觉锚点，小标签适当收紧字距。`
      }`;
    }
    return `Detected ${fonts.join(' + ')} across ${dna.typography.length} scale step(s) (${minPx}px → ${maxPx}px, ${ratio}x spread). ${
      ratio < 1.35
        ? 'Your type scale is tight—consider increasing the display/heading step or weight contrast to sharpen visual hierarchy.'
        : `Lead with ${primaryFont?.primaryFont ?? 'the primary font'} at ${maxPx}px and reserve tighter tracking for uppercase micro-labels.`
    }`;
  }

  // Layout, Recreation & Implementation advice
  if (
    /recreat|build|code|layout|spacing|grid|flex|css|tailwind|glass|shadow|export|agent|prompt|复刻|还原|怎么做|如何|布局|间距|毛玻璃|阴影|导出|代码/.test(
      q
    )
  ) {
    if (isZh) {
      const tips: string[] = [
        `建议以 ${dna.layout.primaryModel.toUpperCase()} 容器作为基础结构${dna.layout.spacingGridBase ? `，并对齐实测的 ${dna.layout.spacingGridBase}px 间距网格` : ''}。`,
      ];
      if (hasGlass) {
        tips.push(
          `对于毛玻璃效果（${dna.surfaces.backdropFilters[0]}），请搭配半透明底色与 1px 浅色细边框，确保深色背景下边缘锐利。`
        );
      } else if (dna.surfaces.borders[0]) {
        tips.push(
          `请保留 ${dna.surfaces.borders[0]} 边框与 ${dna.surfaces.borderRadii[0] ?? '8px'} 圆角来还原层次感。`
        );
      }
      tips.push(
        '可在「捕获」页直接点击「一键插入图片 + 风格提示词」发送到 Claude / OpenAI / Gemini / DeepSeek，或打开「套件混搭」导出可编辑三层 SVG 与独立背景。'
      );
      return tips.join('');
    }
    const tips: string[] = [
      `Start from a ${dna.layout.primaryModel.toUpperCase()} container${dna.layout.spacingGridBase ? ` aligned to the measured ${dna.layout.spacingGridBase}px spacing rhythm` : ''}.`,
    ];
    if (hasGlass) {
      tips.push(
        `For the frosted glass surface (${dna.surfaces.backdropFilters[0]}), pair translucent fill alpha with a crisp 1px light hairline border so edges stay sharp on dark backdrops.`
      );
    } else if (dna.surfaces.borders[0]) {
      tips.push(`Preserve the clean surface separation using ${dna.surfaces.borders[0]} and radius ${dna.surfaces.borderRadii[0] ?? '8px'}.`);
    }
    tips.push('Use "Insert Image + Style Prompt" in the Capture tab to send the full Design DNA + cleaned HTML structure straight to Claude, OpenAI, Gemini, or DeepSeek.');
    return tips.join(' ');
  }

  // General holistic critique
  if (isZh) {
    const summaryTips: string[] = [
      `捕获自 ${page.hostname}：${polarityZh}界面（${record.rect.width}×${record.rect.height}px）${dna.traits.length > 0 ? `，包含 ${dna.traits.slice(0, 3).map((t) => t.label).join('、')}` : ''}。`,
      failing.length > 0
        ? `请注意无障碍可读性：有 ${failing.length} 组文字低于 WCAG AA 4.5:1。`
        : '实测文本节点的对比度表现良好。',
      '您可以继续询问配色平衡、字体层级、对比度审计或 1:1 复刻方法。',
    ];
    return summaryTips.join('');
  }
  const summaryTips: string[] = [
    `Captured from ${page.hostname}: ${dna.polarity} UI (${record.rect.width}×${record.rect.height}px)${dna.traits.length > 0 ? ` featuring ${dna.traits.slice(0, 3).map((t) => t.label).join(', ')}` : ''}.`,
    failing.length > 0
      ? `Watch accessibility: ${failing.length} text pair(s) sit below WCAG AA 4.5:1.`
      : 'Contrast looks solid across measured text nodes.',
    'Ask me about contrast, palette balance, typography hierarchy, or how to recreate this cleanly in Tailwind/CSS.',
  ];
  return summaryTips.join(' ');
}

/**
 * Answers user design questions using the configured AI engine (BYOK / Chrome AI)
 * when available, and gracefully falls back to the offline Design DNA advisor.
 */
export async function askDesignAdvisor(req: AdvisorRequest): Promise<AdvisorReply> {
  const { question, record, history, aiSettings, signal } = req;
  const language: UiLanguage = aiSettings.language === 'zh-CN' ? 'zh-CN' : 'en';

  const systemPrompt = [
    'You are StyleLens Advisor, a concise senior UI/UX design engineer inside a Chrome extension side panel.',
    'Give practical, direct, high-craft design advice in 2–4 crisp sentences (no fluff, no markdown walls).',
    ...(language === 'zh-CN'
      ? ['IMPORTANT: Respond strictly in clear, concise Simplified Chinese (简体中文).']
      : []),
    record
      ? `CURRENT CAPTURE CONTEXT:\n${generateDesignDnaReport(record).slice(0, 2600)}`
      : 'No webpage capture is loaded yet; give brief, actionable design guidance.',
  ].join('\n\n');

  // 1. Try BYOK OpenAI-compatible provider if selected & configured
  if (aiSettings.activeProvider === 'openai-compatible') {
    const byok = new OpenAICompatibleProvider(aiSettings.byok);
    if (byok.isConfigured()) {
      const perm = await ensureApiOriginPermission(aiSettings.byok.baseUrl).catch(() => ({
        granted: false,
      }));
      if (perm.granted) {
        try {
          const baseUrl = normalizeBaseUrl(aiSettings.byok.baseUrl);
          const recentMessages = history.slice(-4).map((m) => ({
            role: m.role,
            content: m.text,
          }));

          if (isAnthropicConfig(aiSettings.byok)) {
            const res = await fetch(`${baseUrl}/messages`, {
              method: 'POST',
              signal,
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': aiSettings.byok.apiKey.trim(),
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
              },
              body: JSON.stringify({
                model: aiSettings.byok.model.trim(),
                max_tokens: 280,
                system: systemPrompt,
                messages: [...recentMessages, { role: 'user', content: question }],
              }),
            });
            if (res.ok) {
              const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
              const reply = data.content?.find((b) => b.type === 'text')?.text?.trim();
              if (reply) {
                return { text: reply, sourceLabel: aiSettings.byok.model.trim() };
              }
            }
          } else {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (aiSettings.byok.apiKey.trim()) {
              headers.Authorization = `Bearer ${aiSettings.byok.apiKey.trim()}`;
            }
            const res = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers,
              signal,
              body: JSON.stringify({
                model: aiSettings.byok.model.trim(),
                temperature: 0.4,
                max_tokens: 280,
                messages: [
                  { role: 'system', content: systemPrompt },
                  ...recentMessages,
                  { role: 'user', content: question },
                ],
              }),
            });

            if (res.ok) {
              const data = (await res.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
              };
              const reply = data.choices?.[0]?.message?.content?.trim();
              if (reply) {
                return { text: reply, sourceLabel: aiSettings.byok.model.trim() };
              }
            }
          }
        } catch {
          // Gracefully fall back to local advisor so the chatbot never dead-ends
        }
      }
    }
  }

  // 2. Try Chrome Built-in AI if explicitly selected and ready
  if (aiSettings.activeProvider === 'chrome-builtin') {
    const lm = getChromeLanguageModel();
    if (lm && typeof lm.availability === 'function' && typeof lm.create === 'function') {
      try {
        const status = await lm.availability({
          expectedInputs: [{ type: 'text' }],
          expectedOutputs: [{ type: 'text' }],
        });
        if (status === 'available') {
          const session = await lm.create({
            initialPrompts: [{ role: 'system', content: systemPrompt }],
            expectedInputs: [{ type: 'text' }],
            expectedOutputs: [{ type: 'text' }],
            signal,
          });
          try {
            const reply = (await session.prompt(question, { signal })).trim();
            if (reply) {
              return { text: reply, sourceLabel: 'Gemini Nano' };
            }
          } finally {
            session.destroy?.();
          }
        }
      } catch {
        // Fall through to deterministic advisor
      }
    }
  }

  // 3. Always-available deterministic grounded advisor
  return {
    text: buildOfflineAdvice(question, record, language),
    sourceLabel: language === 'zh-CN' ? '本地设计顾问' : 'Local Advisor',
  };
}
