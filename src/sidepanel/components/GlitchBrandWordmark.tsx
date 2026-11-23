import { useEffect, useRef, useState } from 'react';
import type { UiLanguage } from '../../storage/aiSettingsStore';

interface GlitchBrandWordmarkProps {
  language: UiLanguage;
  stillMode?: boolean;
}

interface FontShowcasePreset {
  fontFamily: string;
  fontWeight: number;
  fontStyle?: 'normal' | 'italic';
  letterSpacing: string;
  textTransform?: 'none' | 'uppercase';
  fontSize: string;
  chineseText?: boolean;
  /** Extra hard-edged shadow, used to thicken a monospace face into chunky arcade-style blocks. */
  textShadow?: string;
}

const ENGLISH_FONT_CYCLE: readonly FontShowcasePreset[] = [
  {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    fontSize: '13.5px',
  },
  {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontWeight: 700,
    fontStyle: 'italic',
    letterSpacing: '0em',
    fontSize: '13.5px',
  },
  {
    fontFamily: 'ui-monospace, "JetBrains Mono", Consolas, monospace',
    fontWeight: 600,
    letterSpacing: '0.01em',
    fontSize: '12.5px',
  },
  {
    fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
    fontWeight: 700,
    letterSpacing: '0.12em',
    fontSize: '13.5px',
    chineseText: true,
  },
  {
    fontFamily: 'Impact, "Arial Black", sans-serif',
    fontWeight: 700,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
    fontSize: '13px',
  },
  {
    fontFamily: '"Trebuchet MS", Verdana, sans-serif',
    fontWeight: 300,
    letterSpacing: '0.06em',
    fontSize: '12.5px',
  },
  {
    fontFamily: '"Courier New", Courier, monospace',
    fontWeight: 700,
    letterSpacing: '0em',
    fontSize: '12.5px',
  },
  // Cursive / handwriting (system script faces; falls back to the browser's generic cursive)
  {
    fontFamily:
      '"Segoe Script", "Brush Script MT", "Snell Roundhand", "Apple Chancery", "Lucida Handwriting", cursive',
    fontWeight: 600,
    letterSpacing: '0em',
    fontSize: '12.5px',
  },
  // Chunky retro arcade look. No pixel font is bundled, so a monospace face is thickened with a
  // hard 1px offset shadow into square-ish blocks.
  {
    fontFamily: '"Lucida Console", "Courier New", monospace',
    fontWeight: 900,
    letterSpacing: '0.09em',
    textTransform: 'uppercase',
    fontSize: '10.5px',
    textShadow: '1px 0 0 currentColor, 0 1px 0 currentColor, 1px 1px 0 currentColor',
  },
];

const CHINESE_FONT_CYCLE: readonly FontShowcasePreset[] = [
  {
    fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
    fontWeight: 700,
    letterSpacing: '0.12em',
    fontSize: '14px',
    chineseText: true,
  },
  {
    fontFamily: 'SimSun, "Songti SC", Georgia, serif',
    fontWeight: 700,
    letterSpacing: '0.16em',
    fontSize: '14.5px',
    chineseText: true,
  },
  {
    fontFamily: 'KaiTi, "Kaiti SC", Georgia, serif',
    fontWeight: 600,
    letterSpacing: '0.14em',
    fontSize: '15px',
    chineseText: true,
  },
  {
    fontFamily: 'ui-monospace, "JetBrains Mono", Consolas, monospace',
    fontWeight: 600,
    letterSpacing: '0.03em',
    fontSize: '13px',
    chineseText: false,
  },
];

const GLITCH_GLYPHS = '01#X$样镜式<>';
const ENGLISH_BRAND = 'StyleLens';
const CHINESE_BRAND = '样式镜';

function scrambleTarget(target: string, progress: number): string {
  const lockedCount = Math.floor(target.length * progress);
  let out = '';
  for (let i = 0; i < target.length; i++) {
    if (i < lockedCount) {
      out += target[i];
    } else {
      out += GLITCH_GLYPHS[Math.floor(Math.random() * GLITCH_GLYPHS.length)];
    }
  }
  return out;
}

/**
 * Animated header brand wordmark demonstrating StyleLens's typography takeover:
 * smoothly runs a monochrome letter-scramble glitch every ~3.2s across contrasting
 * sans, serif, monospace, display, and random Simplified Chinese ("样式镜") styles.
 * Respects both `stillMode` and OS `prefers-reduced-motion`.
 */
export function GlitchBrandWordmark({ language, stillMode = false }: GlitchBrandWordmarkProps) {
  const cycle = language === 'zh-CN' ? CHINESE_FONT_CYCLE : ENGLISH_FONT_CYCLE;
  const baseText = language === 'zh-CN' ? CHINESE_BRAND : ENGLISH_BRAND;

  const [presetIdx, setPresetIdx] = useState(0);
  const [displayText, setDisplayText] = useState(baseText);
  const [isGlitching, setIsGlitching] = useState(false);
  const stepTimersRef = useRef<number[]>([]);

  useEffect(() => {
    setPresetIdx(0);
    setDisplayText(language === 'zh-CN' ? CHINESE_BRAND : ENGLISH_BRAND);
    setIsGlitching(false);
  }, [language]);

  useEffect(() => {
    const clearStepTimers = () => {
      for (const id of stepTimersRef.current) window.clearTimeout(id);
      stepTimersRef.current = [];
    };

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (stillMode || reducedMotion) {
      clearStepTimers();
      setPresetIdx(0);
      setDisplayText(language === 'zh-CN' ? CHINESE_BRAND : ENGLISH_BRAND);
      setIsGlitching(false);
      return;
    }

    let currentIdx = 0;
    const intervalId = window.setInterval(() => {
      clearStepTimers();

      // Occasionally jump directly to the Chinese glitch preset (in EN mode) for lively randomness
      let nextIdx = (currentIdx + 1) % cycle.length;
      if (language === 'en' && Math.random() < 0.22) {
        const zhIdx = cycle.findIndex((p) => p.chineseText);
        if (zhIdx !== -1 && currentIdx !== zhIdx) nextIdx = zhIdx;
      }
      currentIdx = nextIdx;
      const nextPreset = cycle[nextIdx]!;
      const nextWord = nextPreset.chineseText ? CHINESE_BRAND : ENGLISH_BRAND;

      setIsGlitching(true);
      const frames = [0.15, 0.45, 0.78, 1];
      frames.forEach((prog, frameIdx) => {
        const tId = window.setTimeout(() => {
          if (frameIdx === 2) {
            setPresetIdx(nextIdx);
          }
          if (prog >= 1) {
            setDisplayText(nextWord);
            setIsGlitching(false);
          } else {
            setDisplayText(scrambleTarget(nextWord, prog));
          }
        }, frameIdx * 52);
        stepTimersRef.current.push(tId);
      });
    }, 3200);

    return () => {
      window.clearInterval(intervalId);
      clearStepTimers();
    };
  }, [stillMode, language, cycle]);

  const activePreset = cycle[presetIdx % cycle.length] ?? cycle[0]!;

  return (
    <span
      className={`inline-flex h-5 w-[82px] shrink-0 items-center overflow-hidden whitespace-nowrap text-white transition-[letter-spacing] duration-150 ${
        isGlitching ? 'sl-glitching' : ''
      }`}
      style={{
        fontFamily: activePreset.fontFamily,
        fontWeight: activePreset.fontWeight,
        fontStyle: activePreset.fontStyle ?? 'normal',
        letterSpacing: activePreset.letterSpacing,
        textTransform: activePreset.textTransform ?? 'none',
        fontSize: activePreset.fontSize,
        textShadow: isGlitching ? undefined : activePreset.textShadow,
      }}
      title={language === 'zh-CN' ? '样式镜 (StyleLens)' : 'StyleLens — live typography demo'}
    >
      {displayText}
    </span>
  );
}
