export type CaptureMode = 'dom-and-visual' | 'visual-only';

export type SelectionMethod = 'marquee' | 'element-snap';

export type TokenProvenance = 'exact-dom' | 'sampled-pixels' | 'inferred';

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportMetrics {
  width: number;
  height: number;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
}

export interface PageContext {
  url: string;
  hostname: string;
  title: string;
}

export interface ExtractedStyles {
  display: string;
  position: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  boxSizing?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  alignSelf?: string;
  flexWrap?: string;
  flex?: string;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gridColumn?: string;
  gridRow?: string;
  placeItems?: string;
  gap?: string;
  rowGap?: string;
  columnGap?: string;
  padding?: string;
  margin?: string;
  width: string;
  height: string;
  minWidth?: string;
  maxWidth?: string;
  minHeight?: string;
  color?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  backgroundClip?: string;
  webkitTextFillColor?: string;
  border?: string;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
  borderRadius?: string;
  boxShadow?: string;
  textShadow?: string;
  transform?: string;
  transformOrigin?: string;
  clipPath?: string;
  filter?: string;
  opacity?: string;
  backdropFilter?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  fontStyle?: string;
  fontStretch?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textTransform?: string;
  textAlign?: string;
  textDecoration?: string;
  whiteSpace?: string;
  listStyleType?: string;
  overflow?: string;
  objectFit?: string;
  zIndex?: string;
}

export interface ExtractedPseudoElement {
  pseudo: '::before' | '::after';
  content?: string;
  position?: string;
  inset?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  width?: string;
  height?: string;
  color?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  border?: string;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
  borderRadius?: string;
  boxShadow?: string;
  backdropFilter?: string;
  transform?: string;
  clipPath?: string;
  opacity?: string;
  zIndex?: string;
}

export type InlineContentSegment =
  | { kind: 'text'; text: string }
  | { kind: 'child'; index: number }
  | { kind: 'br' };

export interface ExtractedNode {
  id: string;
  tag: string;
  role?: string;
  ariaLabel?: string;
  cleanClasses: string[];
  omittedHashedClassCount: number;
  textSnippet?: string;
  /** Preserves exact interleaved order of text nodes and inline child elements (e.g. `<p>Hello <code>flex</code> world</p>`). */
  inlineSegments?: InlineContentSegment[];
  /** Sanitized inline SVG outerHTML when tag === 'svg' (for exact 1-to-1 vector fidelity). */
  svgMarkup?: string;
  /** Exact non-transparent hex fill/stroke colors harvested from inline <svg> vector shapes (e.g. brand logo colors). */
  svgColors?: string[];
  /** Resolved image URL & alt text when tag === 'img'. */
  imgSrc?: string;
  imgAlt?: string;
  rect: ViewportRect;
  styles: ExtractedStyles;
  /** Effective composited opaque background behind this element (walking ancestors). */
  effectiveBackgroundHex?: string;
  /** True when an ancestor uses a gradient or image background, making contrast approximate. */
  hasNonSolidBackgroundAncestor: boolean;
  pseudoElements: ExtractedPseudoElement[];
  children: ExtractedNode[];
}

export interface DiscoveredCssVariable {
  name: string;
  value: string;
}

export interface RawDomExtraction {
  captureMode: CaptureMode;
  visualFallbackReason?: string;
  /** True when the selected region is mostly an <img>, <picture>, or <svg> graphic rather than live HTML text. */
  containsGraphicArtwork?: boolean;
  graphicArtworkNote?: string;
  selectionMethod: SelectionMethod;
  totalNodesScanned: number;
  truncated: boolean;
  roots: ExtractedNode[];
  cssVariables: DiscoveredCssVariable[];
  fontStylesheetUrls?: string[];
  /** All active page stylesheet <link> URLs so the MV3 service worker can harvest cross-origin @font-face rules. */
  pageStylesheetUrls?: string[];
  fontFaceRules?: string[];
  /** Active loaded font family names reported by `document.fonts`. */
  loadedFontFamilies?: string[];
  /** Surrounding page heading/body typography fallback when the selected region is artwork/media with 0 live text. */
  pageFallbackTypography?: TypographyToken[];
}

export interface RawSelectionPayload {
  rect: ViewportRect;
  viewport: ViewportMetrics;
  page: PageContext;
  dom: RawDomExtraction;
  capturedAt: number;
}

export interface PendingCapturePayload extends RawSelectionPayload {
  id: string;
  fullViewportDataUrl: string;
}

export interface SampledColor {
  hex: string;
  rgb: [number, number, number];
  percentage: number;
}

export type ColorRole =
  | 'background'
  | 'surface'
  | 'text'
  | 'accent'
  | 'border'
  | 'sampled';

export interface ColorToken {
  hex: string;
  rgbString: string;
  role: ColorRole;
  usageCount: number;
  provenance: TokenProvenance;
  alpha: number;
  /** Percentage of pixels in cropped screenshot when provenance is sampled-pixels. */
  visualSharePercent?: number;
}

export type TypographyRole = 'display' | 'heading' | 'body' | 'label' | 'mono';

export interface TypographyToken {
  primaryFont: string;
  fontStack: string;
  fontSizePx: number;
  fontWeight: number;
  lineHeightPx: number | null;
  lineHeightRatio: number | null;
  letterSpacing: string;
  role: TypographyRole;
  sampleText: string;
  usageCount: number;
}

export interface ContrastCheck {
  foregroundHex: string;
  backgroundHex: string;
  ratio: number;
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  fontSizePx: number;
  fontWeight: number;
  sampleText: string;
  /** Explicitly marks whether background included a gradient/image/translucent layer. */
  isEstimated: boolean;
}

export interface LayoutSummary {
  primaryModel: 'flex' | 'grid' | 'block' | 'mixed' | 'visual-only';
  flexCount: number;
  gridCount: number;
  flexDirections: string[];
  gridTemplates: string[];
  gapValuesPx: number[];
  paddingValuesPx: number[];
  spacingScalePx: number[];
  spacingGridBase: 4 | 8 | null;
  dimensionsPx: { width: number; height: number };
}

export interface SurfaceSummary {
  borderRadii: string[];
  borders: string[];
  shadows: string[];
  textShadows: string[];
  transforms: string[];
  clipPaths: string[];
  gradients: string[];
  backdropFilters: string[];
}

export interface StyleTrait {
  id: string;
  label: string;
  confidence: 'high' | 'medium';
  evidence: string;
}

export interface DesignDNA {
  polarity: 'dark' | 'light' | 'mixed';
  palette: ColorToken[];
  typography: TypographyToken[];
  contrastChecks: ContrastCheck[];
  layout: LayoutSummary;
  surfaces: SurfaceSummary;
  traits: StyleTrait[];
  cssVariables: DiscoveredCssVariable[];
  fontStylesheetUrls?: string[];
  fontFaceRules?: string[];
  pageFallbackTypography?: TypographyToken[];
  summaryText: string;
}

export interface CaptureRecord {
  id: string;
  createdAt: number;
  page: PageContext;
  rect: ViewportRect;
  viewport: ViewportMetrics;
  captureMode: CaptureMode;
  visualFallbackReason?: string;
  containsGraphicArtwork?: boolean;
  graphicArtworkNote?: string;
  selectionMethod: SelectionMethod;
  totalNodesScanned: number;
  truncated: boolean;
  screenshotBlob: Blob;
  screenshotWidth: number;
  screenshotHeight: number;
  roots: ExtractedNode[];
  dna: DesignDNA;
}

export interface CaptureSummaryItem {
  id: string;
  createdAt: number;
  hostname: string;
  title: string;
  width: number;
  height: number;
  captureMode: CaptureMode;
  topColors: string[];
}
