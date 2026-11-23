interface OrbIconProps {
  /** Width and height in pixels. */
  size?: number;
  /** Set when the mark sits on a white / light surface, so its dots are drawn dark. */
  onLight?: boolean;
}

/**
 * StyleLens's capture mark: four small dots that keep re-arranging themselves, square to
 * triangle to diamond and back, like points settling on a shape. Pure CSS (see `.sl-dots` in
 * index.css); holds still when the user prefers reduced motion.
 */
export function OrbIcon({ size = 14, onLight = false }: OrbIconProps) {
  return (
    <span
      aria-hidden="true"
      className={`sl-dots ${onLight ? 'sl-dots--on-light' : ''}`}
      style={{ width: size, height: size }}
    >
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}