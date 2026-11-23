interface NoirNeonBackdropProps {
  stillMode?: boolean;
}

/**
 * Clean, formal 90-degree orthogonal Matte Noir architectural grid backdrop.
 * Strictly horizontal & vertical (0° / 90°) hairline rails, subtle intersection crosshairs (+),
 * and refined luminous white corner framing brackets — zero binary glitch clutter.
 * Always sits behind frosted cards (`pointer-events: none`).
 */
export function NoirNeonBackdrop({ stillMode = false }: NoirNeonBackdropProps) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 z-0 overflow-hidden select-none ${
        stillMode ? 'sl-still-mode' : ''
      }`}
    >
      <svg
        viewBox="0 0 420 820"
        preserveAspectRatio="xMidYMid slice"
        className="sl-ortho-grid-layer absolute inset-0 h-full w-full"
      >
        <defs>
          <filter id="sl-ortho-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.2" result="blur1" />
            <feGaussianBlur stdDeviation="8" result="blur2" />
            <feMerge>
              <feMergeNode in="blur2" />
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="sl-h-fade" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="18%" stopColor="#ffffff" stopOpacity="0.82" />
            <stop offset="82%" stopColor="#ffffff" stopOpacity="0.82" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sl-v-fade" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="18%" stopColor="#ffffff" stopOpacity="0.8" />
            <stop offset="82%" stopColor="#ffffff" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Minimal Formal 90° Architectural Grid Hairlines */}
        <g stroke="rgba(255,255,255,0.042)" strokeWidth="0.75">
          {/* Vertical rails */}
          <line x1="20" y1="0" x2="20" y2="820" />
          <line x1="210" y1="0" x2="210" y2="820" />
          <line x1="400" y1="0" x2="400" y2="820" />
          {/* Horizontal rails */}
          <line x1="0" y1="96" x2="420" y2="96" />
          <line x1="0" y1="296" x2="420" y2="296" />
          <line x1="0" y1="516" x2="420" y2="516" />
          <line x1="0" y1="720" x2="420" y2="720" />
        </g>

        {/* Formal 90° Intersection Crosshairs (+) */}
        <g stroke="rgba(255,255,255,0.16)" strokeWidth="1">
          <path d="M16 96 H24 M20 92 V100" />
          <path d="M396 96 H404 M400 92 V100" />
          <path d="M16 516 H24 M20 512 V520" />
          <path d="M396 516 H404 M400 512 V520" />
          <path d="M206 296 H214 M210 292 V300" />
          <path d="M206 720 H214 M210 716 V724" />
        </g>

        {/* Subtle Luminous White 90° Architectural Corner Brackets & Orthogonal Rails */}
        <g filter="url(#sl-ortho-glow)" opacity="0.32">
          {/* Top-right 90° corner bracket */}
          <path
            d="M312 68 H400 V158"
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="square"
          />
          {/* Bottom-left 90° corner bracket */}
          <path
            d="M20 632 V746 H124"
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="square"
          />
          {/* Orthogonal horizontal & vertical hairline accents */}
          <line x1="20" y1="296" x2="156" y2="296" stroke="url(#sl-h-fade)" strokeWidth="1.4" />
          <line x1="264" y1="516" x2="400" y2="516" stroke="url(#sl-h-fade)" strokeWidth="1.4" />
          <line x1="400" y1="330" x2="400" y2="516" stroke="url(#sl-v-fade)" strokeWidth="1.4" />
          <line x1="20" y1="96" x2="20" y2="260" stroke="url(#sl-v-fade)" strokeWidth="1.4" />
        </g>
      </svg>
    </div>
  );
}
