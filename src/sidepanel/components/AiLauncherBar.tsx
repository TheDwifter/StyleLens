import { ChevronDown, ChevronUp } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import type { UiLanguage } from '../../storage/aiSettingsStore';
import { getTranslations } from '../i18n/translations';
import { openOrFocusAiChat } from '../utils/chatSender';

interface AiLauncherBarProps {
  language: UiLanguage;
  disabled?: boolean;
}

interface AiPlatformItem {
  id: string;
  label: string;
  url: string;
  hostMatch: RegExp;
  supportsImageGen: boolean;
  accentClass: string;
  renderIcon: (uid: string) => ReactNode;
}

const OPENAI_ROSETTE_ANGLES = [0, 60, 120, 180, 240, 300] as const;

const PRIMARY_AI_PLATFORMS: readonly AiPlatformItem[] = [
  {
    id: 'claude',
    label: 'Claude',
    url: 'https://claude.ai/new',
    hostMatch: /(?:^|\.)claude\.ai$/i,
    supportsImageGen: false,
    accentClass: 'hover:border-amber-400/60 hover:bg-amber-400/[0.08]',
    renderIcon: () => (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        {/* Iconic Claude pixel mascot (terracotta body, side arms, 4 blocky legs, > < eyes) */}
        <path
          d="M3.5 2.5H20.5V7H22.5V12H20.5V21.5H18.5V17H16.8V21.5H14.8V17H9.2V21.5H7.2V17H5.5V21.5H3.5V12H1.5V7H3.5V2.5Z"
          fill="#C17954"
        />
        <path
          d="M5.6 7.4L8.6 9.0L5.6 10.6M18.4 7.4L15.4 9.0L18.4 10.6"
          stroke="#0A0A0A"
          strokeWidth="1.5"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      </svg>
    ),
  },
  {
    id: 'openai',
    label: 'OpenAI',
    url: 'https://chatgpt.com/',
    hostMatch: /(?:^|\.)(?:chatgpt\.com|chat\.openai\.com)$/i,
    supportsImageGen: true,
    accentClass: 'hover:border-emerald-400/60 hover:bg-emerald-400/[0.08]',
    renderIcon: () => (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="11.2" fill="#4B9377" />
        <g stroke="#FFFFFF" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
          {OPENAI_ROSETTE_ANGLES.map((deg) => (
            <path
              key={deg}
              d="M9.75 13.30 L9.75 7.20 A2.65 2.65 0 1 1 15.01 7.67"
              transform={`rotate(${deg} 12 12)`}
            />
          ))}
        </g>
      </svg>
    ),
  },
  {
    id: 'gemini',
    label: 'Gemini',
    url: 'https://gemini.google.com/app',
    hostMatch: /(?:^|\.)(?:gemini\.google\.com|aistudio\.google\.com)$/i,
    supportsImageGen: true,
    accentClass: 'hover:border-sky-400/60 hover:bg-sky-400/[0.08]',
    renderIcon: (uid) => (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={`${uid}-gem`} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#4285F4" />
            <stop offset="55%" stopColor="#7B8BF7" />
            <stop offset="100%" stopColor="#A78BFA" />
          </linearGradient>
        </defs>
        <path
          d="M12 2.2C13.4 8.0 16.0 10.6 21.8 12C16.0 13.4 13.4 16.0 12 21.8C10.6 16.0 8.0 13.4 2.2 12C8.0 10.6 10.6 8.0 12 2.2Z"
          fill={`url(#${uid}-gem)`}
        />
      </svg>
    ),
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    hostMatch: /(?:^|\.)deepseek\.com$/i,
    supportsImageGen: false,
    accentClass: 'hover:border-indigo-400/60 hover:bg-indigo-400/[0.08]',
    renderIcon: () => (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        {/* Authentic DeepSeek curved whale silhouette with true transparent belly hollow & upturned fluke */}
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M17.4 8.9C16.0 7.7 14.3 5.2 12.6 4.0C12.0 3.5 11.8 2.8 12.8 1.9C11.4 1.6 10.1 2.0 9.1 2.6C4.1 2.2 0.8 6.0 0.8 11.2C0.8 16.9 5.0 21.8 10.4 21.8C12.4 21.8 14.1 21.0 15.2 19.7C16.5 20.1 18.2 20.2 19.0 19.5C19.5 19.0 18.8 18.2 17.5 17.7C19.4 15.6 20.4 12.6 20.4 8.7C22.4 8.5 23.6 6.2 23.5 3.6C23.4 2.8 22.8 2.9 22.4 3.4C21.3 4.6 19.9 4.5 19.2 5.2C19.0 3.7 17.9 3.5 17.3 1.7C17.0 1.0 16.4 1.3 16.1 2.1C15.4 4.3 16.2 6.8 17.7 8.1Z M2.2 9.4C5.4 8.6 9.3 11.1 11.6 15.4C12.4 16.9 13.7 18.6 14.9 19.2C12.4 19.4 10.6 17.7 8.8 16.4C8.0 15.8 7.6 16.3 8.0 17.3C8.4 18.2 8.2 18.8 7.3 18.7C4.4 18.2 2.2 14.1 2.2 9.4Z"
          fill="#4D6BFE"
        />
        {/* Signature white curved cheek patch & eye dot */}
        <path
          d="M12.6 10.3C13.5 9.2 15.0 10.2 15.8 12.1C16.2 13.0 15.5 13.8 14.5 13.5C13.5 13.1 13.5 11.8 13.8 11.2C13.5 10.6 12.9 10.6 12.6 10.3Z"
          fill="#FFFFFF"
        />
        <circle cx="12.9" cy="11.5" r="0.65" fill="#FFFFFF" />
      </svg>
    ),
  },
];

const EXTRA_AI_PLATFORMS: readonly AiPlatformItem[] = [
  {
    id: 'kimi',
    label: 'Kimi',
    url: 'https://kimi.moonshot.cn/',
    hostMatch: /(?:^|\.)(?:kimi\.moonshot\.cn|kimi\.ai|moonshot\.cn)$/i,
    supportsImageGen: false,
    accentClass: 'hover:border-blue-400/60 hover:bg-blue-400/[0.08]',
    renderIcon: () => (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <rect x="0.8" y="0.8" width="22.4" height="22.4" rx="5.2" fill="#060608" stroke="rgba(255,255,255,0.18)" strokeWidth="0.9" />
        {/* Bold white geometric K with signature flared bottom-right foot */}
        <path
          d="M5.4 5.4H8.2V11.3L14.2 5.4H17.6L11.3 11.7L17.9 18.2V19.1H15.2C14.1 19.1 13.3 18.6 12.5 17.8L8.2 13.3V18.8H5.4V5.4Z"
          fill="#FFFFFF"
        />
        {/* Signature bright blue rounded speech-droplet badge in top-right corner */}
        <path
          d="M19.8 2.2C21.2 2.2 22.3 3.3 22.3 4.7C22.3 6.1 21.2 7.2 19.8 7.2H17.7V5.1C17.7 3.5 18.6 2.2 19.8 2.2Z"
          fill="#3B82F6"
        />
      </svg>
    ),
  },
  {
    id: 'qwen',
    label: 'Qwen 通义',
    url: 'https://chat.qwen.ai/',
    hostMatch: /(?:^|\.)(?:chat\.qwen\.ai|qwen\.ai|qwenlm\.ai|qianwen\.com|tongyi\.aliyun\.com)$/i,
    supportsImageGen: true,
    accentClass: 'hover:border-indigo-400/60 hover:bg-indigo-400/[0.08]',
    renderIcon: (uid) => (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={`${uid}-qwen`} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#6D5EF7" />
            <stop offset="100%" stopColor="#4334C7" />
          </linearGradient>
        </defs>
        {/* 3D Isometric Qwen Purple Hexagram Outer Extrusion */}
        <polygon
          points="12,1.5 15.2,6.4 21.0,6.4 18.2,11.6 21.2,16.8 15.3,16.8 12.2,22.2 8.8,17.2 3.0,17.2 5.8,12.0 2.8,6.8 8.7,6.8"
          fill={`url(#${uid}-qwen)`}
        />
        {/* Crisp White Interlocking Ribbon Face */}
        <path
          d="M11.6 3.1L14.3 7.6H19.1L16.7 11.9L19.0 15.8H14.2L11.8 20.1L9.3 15.8H4.9L7.2 11.9L4.9 7.8H9.5L11.6 3.1Z"
          fill="#F4F4FF"
        />
        {/* Signature Centered Inverted Purple Triangle */}
        <polygon points="8.9,9.9 15.1,9.9 12.0,15.2" fill={`url(#${uid}-qwen)`} />
      </svg>
    ),
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    url: 'https://www.perplexity.ai/',
    hostMatch: /(?:^|\.)perplexity\.ai$/i,
    supportsImageGen: false,
    accentClass: 'hover:border-teal-400/60 hover:bg-teal-400/[0.08]',
    renderIcon: () => (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <rect x="0.8" y="0.8" width="22.4" height="22.4" rx="5.2" fill="#2B6777" />
        {/* Crisp White Symmetrical Perplexity Folded-Prism Mark */}
        <g stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="square" strokeLinejoin="miter">
          <line x1="12" y1="3.8" x2="12" y2="20.2" />
          <path d="M6.8 4.6L12 9.4L17.2 4.6V9.4H6.8V4.6Z" />
          <path d="M4.6 9.4H19.4V15.4H16.8M4.6 9.4V15.4H7.2" />
          <path d="M7.2 19.3V13.8L12 9.4L16.8 13.8V19.3L12 15.1L7.2 19.3Z" />
        </g>
      </svg>
    ),
  },
  {
    id: 'grok',
    label: 'Grok',
    url: 'https://grok.com/',
    hostMatch: /(?:^|\.)grok\.com$|(?:^|\.)x\.com\/i\/grok/i,
    supportsImageGen: true,
    accentClass: 'hover:border-zinc-300/60 hover:bg-white/[0.08]',
    renderIcon: () => (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <rect x="0.8" y="0.8" width="22.4" height="22.4" rx="5.2" fill="#050507" stroke="rgba(255,255,255,0.2)" strokeWidth="0.9" />
        {/* Iconic White Grok Slashed Orbital Mark */}
        <path
          d="M15.2 7.5A5.6 5.6 0 0 0 7.4 14.5C7.1 15.6 6.1 17.5 4.4 19.2C7.3 17.5 10.6 14.2 13.7 11.1L19.6 4.8C17.9 6.6 15.4 9.0 13.9 10.2"
          stroke="#FFFFFF"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9.6 16.8A5.6 5.6 0 0 0 16.9 9.5"
          stroke="#FFFFFF"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        <path d="M18.9 5.3L10.3 14.3" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'copilot',
    label: 'Copilot',
    url: 'https://copilot.microsoft.com/',
    hostMatch: /(?:^|\.)copilot\.microsoft\.com$/i,
    supportsImageGen: true,
    accentClass: 'hover:border-cyan-400/60 hover:bg-cyan-400/[0.08]',
    renderIcon: (uid) => (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={`${uid}-cop-l`} x1="4" y1="4" x2="13" y2="19" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="55%" stopColor="#06B6D4" />
            <stop offset="100%" stopColor="#A3E635" />
          </linearGradient>
          <linearGradient id={`${uid}-cop-r`} x1="20" y1="6" x2="10" y2="20" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#9333EA" />
            <stop offset="55%" stopColor="#EC4899" />
            <stop offset="100%" stopColor="#F97316" />
          </linearGradient>
        </defs>
        {/* Left Folded Ribbon (Blue -> Cyan -> Lime) */}
        <path
          d="M5.6 7.4C6.4 5.1 8.4 4.2 10.6 4.2H14.5C12.7 4.2 11.4 5.5 10.8 7.5L8.9 14.2C8.3 16.3 6.8 17.5 4.8 17.5H3.8C2.8 17.5 2.2 16.5 2.6 15.4L5.6 7.4Z"
          fill={`url(#${uid}-cop-l)`}
        />
        {/* Right Folded Ribbon (Violet -> Pink -> Orange) */}
        <path
          d="M18.4 16.6C17.6 18.9 15.6 19.8 13.4 19.8H9.5C11.3 19.8 12.6 18.5 13.2 16.5L15.1 9.8C15.7 7.7 17.2 6.5 19.2 6.5H20.2C21.2 6.5 21.8 7.5 21.4 8.6L18.4 16.6Z"
          fill={`url(#${uid}-cop-r)`}
        />
        {/* Top-Right & Bottom-Left Fold Depth Connectors */}
        <path
          d="M14.5 4.2C16.2 4.2 17.3 5.2 17.8 6.8L15.0 7.6C14.6 6.3 13.6 5.6 12.4 5.6L14.5 4.2Z"
          fill="#6366F1"
        />
        <path
          d="M9.5 19.8C7.8 19.8 6.7 18.8 6.2 17.2L9.0 16.4C9.4 17.7 10.4 18.4 11.6 18.4L9.5 19.8Z"
          fill="#EA580C"
        />
      </svg>
    ),
  },
];

/**
 * 1-Click AI Launcher Bar displayed inside Step 3 (and Studio Capture):
 * Shows Claude, OpenAI (ChatGPT), Gemini, and DeepSeek prominently as 4 icon tiles
 * with a clean arrow toggle revealing Kimi, Qwen, Perplexity, Grok, and Copilot.
 */
export function AiLauncherBar({ language, disabled = false }: AiLauncherBarProps) {
  const [expanded, setExpanded] = useState(false);
  const uid = useId();
  const t = getTranslations(language);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-medium text-zinc-300">{t.step3ChooseAiLabel}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1 rounded-md border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-zinc-300 transition hover:border-white/35 hover:text-white disabled:pointer-events-none disabled:opacity-50"
          aria-expanded={expanded}
        >
          <span>{expanded ? t.step3LessAi : t.step3MoreAi}</span>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {/* Primary 4 AI Platforms: Claude, OpenAI, Gemini, DeepSeek */}
      <div className="grid grid-cols-4 gap-1.5">
        {PRIMARY_AI_PLATFORMS.map((ai) => (
          <button
            key={ai.id}
            type="button"
            disabled={disabled}
            onClick={() => void openOrFocusAiChat(ai.url, ai.hostMatch)}
            className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border border-white/12 bg-[#0a0a0d] px-1.5 py-2 text-[11px] font-medium text-zinc-200 transition disabled:pointer-events-none disabled:opacity-50 ${ai.accentClass}`}
            title={t.openAiTitle(ai.label)}
          >
            {ai.renderIcon(uid)}
            <span className="max-w-full truncate pt-0.5">{ai.label}</span>
            <span
              className={`text-[9px] font-semibold tracking-wide ${
                ai.supportsImageGen ? 'text-emerald-300/85' : 'text-zinc-500'
              }`}
            >
              {ai.supportsImageGen ? t.aiBadgeImages : t.aiBadgeCode}
            </span>
          </button>
        ))}
      </div>

      {/* Expandable Popular AI Drawer (Kimi, Qwen, Perplexity, Grok, Copilot) */}
      {expanded && (
        <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-white/[0.08] bg-[#08080b] p-1.5">
          {EXTRA_AI_PLATFORMS.map((ai) => (
            <button
              key={ai.id}
              type="button"
              disabled={disabled}
              onClick={() => void openOrFocusAiChat(ai.url, ai.hostMatch)}
              className={`flex items-center justify-center gap-1.5 rounded-md border border-white/10 bg-[#101014] px-2 py-1.5 text-[11px] font-medium text-zinc-200 transition disabled:pointer-events-none disabled:opacity-50 ${ai.accentClass}`}
              title={t.openAiTitle(ai.label)}
            >
              {ai.renderIcon(uid)}
              <span className="truncate">{ai.label}</span>
              {ai.supportsImageGen && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
                  title={t.aiBadgeImages}
                  aria-label={t.aiBadgeImages}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
