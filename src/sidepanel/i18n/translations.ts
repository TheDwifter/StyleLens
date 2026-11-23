import type { UiLanguage } from '../../storage/aiSettingsStore';

export interface Translations {
  // Header & Modes
  modeSimple: string;
  modeStudio: string;
  tabCapture: string;
  tabKit: string;
  tabDesign: string;
  tabCode: string;
  tabRemix: string;
  scan: string;
  cancel: string;
  recentCaptures: string;
  settingsTitle: string;

  // App chrome
  askForAdvice: string;
  openArrow: string;
  close: string;
  connectAccount: string;
  connectedPrefix: string;
  manageArrow: string;
  connectArrow: string;
  dragBoxBanner: string;
  allowOrigin: (host: string) => string;
  openAiTitle: (label: string) => string;

  // Simple Mode — 3-Step Guided Flow
  step1Short: string;
  step2Short: string;
  step3Short: string;
  onboardingTitle: string;
  onboardingDescBefore: string;
  onboardingDescBold: string;
  onboardingDescAfter: string;
  pickAnythingBtn: string;
  nowDragBox: string;
  readingStyleFonts: string;
  worksOfflineNote: string;

  step1PickedBadge: string;
  pickNewBtn: string;
  xrayDnaBadge: string;
  /** Optional "the picture says" field (helps the AI copy shared letters exactly). */
  step2OriginalLabel: string;
  step2OriginalPlaceholder: string;
  /** Friendly reminder that results can be off, with what to do about it. */
  mistakesNote: string;
  /** Match-the-original's-capitals toggle in Step 2. */
  matchCaseLabel: (styled: string) => string;
  /** Small status label inside the Step 1 viewfinder. */
  viewfinderCaptured: string;
  xrayVisualMode: string;
  xrayDomMode: string;
  xrayPolarityDark: string;
  xrayPolarityLight: string;

  step2Title: string;
  step2StartHere: string;
  step2DoneBadge: string;
  step2Placeholder: string;
  step2TryPrefix: string;
  step2Examples: readonly [string, string, string];
  /** Shown instead of the HTML preview when the picture is a logo/photo with no real webfont to render. */
  step2StyleLockedTitle: string;
  step2StyleLockedDesc: (word: string) => string;
  textOnlyPng: string;
  savedPng: string;
  textOnlySvg: string;
  savedSvg: string;
  backgroundOnly: string;
  savedBg: string;
  copyForFigma: string;
  copiedSvg: string;

  step3Title: string;
  step3LockedNotice: string;
  step3ChooseAiLabel: string;
  step3MoreAi: string;
  step3LessAi: string;
  aiBadgeImages: string;
  aiBadgeCode: string;
  imageStyleMatched: string;
  step3Helper: string;
  sendToAiChat: string;
  makeThreeImages: (word: string) => string;
  runInProgress: string;
  /** What the run is doing right now (shown on the main button while it works). */
  runStage: (
    stage: 'making' | 'checking' | 'rebuilding' | 'ai-background' | 'ai-both' | 'ai-deep'
  ) => string;
  /** Finished-run line: how many AI prompts were used and how the layers were made. */
  runUsedPrompts: (
    prompts: number,
    route: 'local' | 'ai-background' | 'ai-both' | 'ai-deep'
  ) => string;
  /** Plain-language reason the free on-device split was not used. */
  runFallbackReason: (
    reason:
      | 'font-too-narrow'
      | 'font-too-flat'
      | 'ink-left-behind'
      | 'ink-undecided'
      | 'font-too-spread'
      | 'font-mixed-inks'
      | 'lettering-over-artwork'
      | 'text-left-in-background'
  ) => string;
  runComplete: string;
  runPartialBtn: (done: number, total: number) => string;
  runStepComposite: string;
  runStepText: string;
  runStepBg: string;
  runPhaseWaiting: string;
  runPhasePasting: string;
  runPhaseSending: string;
  runPhaseManual: string;
  runPhaseGenerating: string;
  runPhaseExtracting: string;
  runPhaseDone: string;
  runPhaseNoImage: string;
  runPhaseFailed: string;
  runStop: string;
  runKeepPanelOpen: string;
  runNoChat: string;
  runFailed: string;
  runGrokMasterRequired: string;
  runImageAttachBlocked: (copied: boolean) => string;
  runTextOnlyAiNotice: (aiName: string) => string;
  runCopyCodePrompt: string;
  runCopiedCodePrompt: string;
  runTryHereAnyway: string;
  runPausedNoImage: string;
  /** The AI's lettering drifted clearly from the original's measured proportions. */
  styleDriftNotice: (
    issues: Array<
      'too-large' | 'too-small' | 'too-narrow' | 'too-wide' | 'too-thin' | 'too-heavy' | 'too-round'
    >,
    sizeRatio: number
  ) => string;
  styleDriftRetry: string;
  /** The AI answered with a refusal instead of the picture. */
  runAiDeclined: string;
  /** The AI refused one of the follow-up layers. */
  runAiDeclinedLayer: string;
  runRetryStep1: string;
  runContinueSteps23: string;
  runPartialNoImages: string;
  runPartialSomeImages: (done: number, total: number) => string;
  runImageAiTip: string;
  /** Auto mode label, rendered as "<title>" + a glitching "+" + " <unit>" (usually 1 prompt, sometimes more). */
  splitModeInstantTitle: string;
  splitModeInstantUnit: string;
  splitModeInstantAria: string;
  splitModeInstantBadge: string;
  splitModeDeepTitle: string;
  splitModeDeepBadge: string;
  separateExistingBtn: string;
  separateExistingScanning: string;
  separateExistingNotFound: string;
  shelfTitle: string;
  shelfDownloadAll: (n: number) => string;
  shelfDownloadedAll: string;
  shelfCardPicture: string;
  shelfCardFont: string;
  shelfCardBackground: string;
  shelfTransparentTag: string;
  shelfSolidTag: string;
  shelfLocalSplitBadge: string;
  shelfToggleTransparent: string;
  shelfToggleOriginal: string;
  shelfDownloadBtn: string;
  shelfSavedBtn: string;
  shelfVectorSvgBtn: string;
  shelfSavedSvgBtn: string;
  shelfCopySvgBtn: string;
  shelfCopiedSvgBtn: string;
  shelfAiRefineBtn: string;
  shelfPreviewBtn: string;
  shelfPreviewHideBtn: string;
  shelfPreviewTitle: string;
  shelfPreviewLightGrid: string;
  shelfPreviewDarkGrid: string;
  pickNewBottomCta: string;
  pickNewBottomHint: string;
  shelfWaitingCard: string;
  shelfRetryLayer: string;
  singleStepLabel: string;
  singleComposite: string;
  singleText: string;
  singleBg: string;
  compactSending: string;
  compactPastedPressSend: string;
  compactCopyStep2: string;
  compactCopyImg2: string;
  compactPasteNow: string;
  compactPromptInBoxPasteImg: string;
  openProStudioLink: string;

  // Capture Tab (Studio)
  imageBtn: string;
  promptBtn: string;
  savePngBtn: string;
  copied: string;
  saved: string;
  targetWordLabel: string;
  targetWordPlaceholder: string;
  studioLockedNotice: string;
  scanNewPage: string;
  threeLayerKitBtn: string;
  moreDetails: string;
  copyCaptureReport: string;
  previewUnavailable: string;
  websiteLabel: string;
  captureModeLabel: string;
  resolutionLabel: string;
  elementsScannedLabel: string;
  truncationWarning: string;
  captureInsertHint: string;
  modeArtworkPalette: string;
  modeCodeImage: string;
  modeImageOnly: string;
  cappedSuffix: string;

  // Asset Kit & Mixer Tab
  kitTitle: string;
  kitSubtitle: string;
  customTextLabel: string;
  mixerTitle: string;
  mixerTwoSites: string;
  mixerSingleSite: string;
  mixerNoneOption: string;
  mixerEmptyHint: string;
  mixModeAStyleBFrame: string;
  mixModeBalanced: string;
  mixModeAFrameBStyle: string;
  layerComposite: string;
  layerTextOnly: string;
  layerBackground: string;
  copyLayerFigma: (layerLabel: string) => string;
  copiedFigmaToast: string;
  downloadPng2x: string;
  downloadSvg: string;
  downloadBgHtml: string;
  w3cTitle: string;
  w3cSubtitle: string;
  copyJson: string;
  saveJson: string;

  // Design DNA / Code / Remix / EmptyState / Advisor / Settings
  designTitle: string;
  themeSummary: (polarity: 'dark' | 'light' | 'mixed', colorCount: number) => string;
  colorsHeading: string;
  tapToCopy: string;
  noColorsDetected: string;
  showFewerColors: string;
  showAllColors: (count: number) => string;
  fontsHeading: string;
  noTextStylesFound: string;
  showFewerFonts: string;
  showAllFonts: (count: number) => string;
  readabilityContrastTitle: string;
  readabilityContrastSub: string;
  allPass: string;
  lowContrastCount: (count: number) => string;
  spacingLayoutTitle: string;
  spacingLayoutSub: (model: string, traits: number) => string;
  detectedTraits: string;
  layoutModel: string;
  spacingGrid: string;
  pxBaseSuffix: string;
  contrastOn: string;
  estimatedSuffix: string;
  surfaceCornerRounding: string;
  surfaceBorders: string;
  surfaceShadows: string;
  surfaceBackdropBlur: string;
  surfaceGradients: string;
  observedSpacing: string;
  cssVariablesTitle: string;
  cssVariablesSub: (count: number) => string;
  copyReport: string;

  codeTitle: string;
  elementsCount: (count: number, truncated: boolean) => string;
  noHtmlExposed: string;
  faithfulCodeBtn: string;
  cleanHtmlBtn: string;
  copyBtn: string;
  inspectElementsTitle: string;
  inspectElementsSub: string;

  remixTitle: string;
  remixSubtitle: string;
  remixPromptLabel: string;
  remixDefaultPrompt: string;
  remixPromptPlaceholder: string;
  updatePreview: string;
  connectAiKeyBtn: string;
  generateWith: (label: string) => string;
  previewTab: string;
  codeTab: string;
  copyCode: string;
  moreOptionsTitle: string;
  moreOptionsSub: string;
  outputFormatLabel: string;
  blendWithLabel: string;
  noneLabel: string;
  quickIdeasLabel: string;
  remixQuickPrompts: readonly [string, string, string, string];
  fidelityCriticTitle: string;
  remixPreparing: string;
  remixGenerating: string;
  remixSwitchToCode: string;
  fidelityAuditHeading: string;
  fidelityFontsLive: string;
  fidelityPolarityAccents: string;
  fidelityContrastLayout: string;
  fidelitySurfaces: string;
  fidelityStructureSafety: string;
  designInfluencesHeading: string;
  exportAiPromptTab: string;

  emptyTitle: string;
  emptyDescBefore: string;
  emptyDescBold: string;
  emptyDescAfter: string;
  emptyBtn: string;
  shortcutLabel: string;
  systemStatusTitle: string;
  systemStatusSub: string;

  // Settings & Language
  appearanceComfort: string;
  languageLabel: string;
  languageDesc: string;
  stillModeLabel: string;
  stillModeDesc: string;
  aiConnectionMode: string;
  engineByokTitle: string;
  engineByokBadge: string;
  engineByokDesc: string;
  engineOfflineTitle: string;
  engineOfflineBadge: string;
  engineOfflineDesc: string;
  engineChromeTitle: string;
  engineChromeDesc: string;
  chooseProvider: string;
  apiBaseUrl: string;
  modelLabel: string;
  apiKeyLabel: string;
  optionalTag: string;
  clearBtn: string;
  includeScreenshotLabel: string;
  includeScreenshotDesc: string;
  localKeyPrivacyNote: string;
  testConnectionBtn: string;
  testingConnectionBtn: string;
  permissionDeclined: (origin: string) => string;
  testFailedGeneric: string;
  showKeyTitle: string;
  hideKeyTitle: string;
  saveBtn: string;

  // Advisor
  advisorTitle: string;
  advisorGreeting: string;
  advisorPlaceholder: string;
  advisorReviewing: string;
  advisorError: string;
  advisorQuickAsks: readonly [string, string, string];
}

const EN: Translations = {
  modeSimple: 'Simple',
  modeStudio: 'Studio',
  tabCapture: 'Capture',
  tabKit: 'Kit & Mix',
  tabDesign: 'Design',
  tabCode: 'Code',
  tabRemix: 'Remix',
  scan: 'Scan',
  cancel: 'Cancel',
  recentCaptures: 'Recent Captures',
  settingsTitle: 'Settings & AI Accounts',

  askForAdvice: 'Ask for Advice',
  openArrow: 'Open →',
  close: 'Close',
  connectAccount: 'Connect Account',
  connectedPrefix: 'Connected · ',
  manageArrow: 'Manage →',
  connectArrow: 'Connect →',
  dragBoxBanner: 'Drag a box over anything on the website…',
  allowOrigin: (host) => `Allow ${host}`,
  openAiTitle: (label) => `Open ${label}`,

  step1Short: 'Pick',
  step2Short: 'Type',
  step3Short: 'Make It',
  onboardingTitle: 'Copy any website’s style',
  onboardingDescBefore: 'Click the white button below, then ',
  onboardingDescBold: 'drag a box',
  onboardingDescAfter: ' around any logo, word, or card on your screen.',
  pickAnythingBtn: 'Pick Anything on This Page',
  nowDragBox: 'Now drag a box on the website…',
  readingStyleFonts: 'Reading style & fonts…',
  worksOfflineNote: 'Works on any website · Nothing is shared until you choose.',

  step1PickedBadge: 'Step 1 · Picked Style',
  pickNewBtn: 'Pick a New Picture',
  xrayDnaBadge: 'X-Ray DNA',
  viewfinderCaptured: 'Captured',
  mistakesNote: 'StyleLens can make mistakes. If a layer looks off, one tap redraws it.',
  matchCaseLabel: (styled) => `Match the original's capitals: ${styled}`,
  step2OriginalLabel: 'Picture says:',
  step2OriginalPlaceholder: 'e.g. crave (helps match letters)',
  xrayVisualMode: 'Visual',
  xrayDomMode: 'DOM',
  xrayPolarityDark: 'Dark',
  xrayPolarityLight: 'Light',

  step2Title: 'Step 2 · What should it say?',
  step2StartHere: 'Type here first',
  step2DoneBadge: 'Ready ✓',
  step2Placeholder: 'Type any word, like "Apple"',
  step2TryPrefix: 'Try:',
  step2Examples: ['Apple', 'Dollar Tree', 'My Brand'],
  step2StyleLockedTitle: 'Style locked from your picture',
  step2StyleLockedDesc: (word) =>
    word
      ? `The AI will draw "${word}" in this exact lettering in Step 3.`
      : 'Type a word. The AI will draw it in this exact lettering.',
  textOnlyPng: 'Text Only (PNG)',
  savedPng: 'Saved PNG',
  textOnlySvg: 'Text Only (SVG)',
  savedSvg: 'Saved SVG',
  backgroundOnly: 'Background Only',
  savedBg: 'Saved BG',
  copyForFigma: 'Copy for Figma',
  copiedSvg: 'Copied SVG',

  step3Title: 'Step 3 · Pick your AI & Send',
  step3LockedNotice: 'Complete Step 2 above first — type the word you want created.',
  step3ChooseAiLabel: '1-Click open your AI:',
  step3MoreAi: 'More AI',
  step3LessAi: 'Less',
  aiBadgeImages: 'Images',
  aiBadgeCode: 'Code',
  imageStyleMatched: 'Image Style · Matched by AI',
  step3Helper: 'Tap an image-making AI above (Gemini, ChatGPT, Grok), then press the white button once.',
  sendToAiChat: 'Type your word first',
  makeThreeImages: (word) => `Make & Separate "${word}"`,
  runInProgress: 'Creating & separating layers…',
  runStage: (stage) =>
    stage === 'making'
      ? 'Prompt 1: making your picture…'
      : stage === 'checking'
        ? 'Checking if it can be split here for free…'
        : stage === 'rebuilding'
          ? 'Rebuilding the background on your device…'
          : stage === 'ai-background'
          ? 'Asking the AI for the background only (1 more prompt)…'
          : stage === 'ai-both'
            ? 'Asking the AI for lettering + background (2 more prompts)…'
            : 'Making all 3 layers with the AI (3 prompts)…',
  runUsedPrompts: (prompts, route) => {
    // Savings are stated in AI prompts, the one thing StyleLens actually counts, against the
    // 3 prompts the "Always AI" path sends. Shown only for a full run that started at prompt 1:
    // a run with 0 prompts (splitting a picture already in the chat) has no baseline to save from.
    const count = `Used ${prompts} AI prompt${prompts === 1 ? '' : 's'}`;
    const saved = 3 - prompts;
    if ((route === 'local' || route === 'ai-background') && prompts >= 1 && saved > 0) {
      return `${count} · saved ${saved} (about ${(saved * 1290).toLocaleString('en-US')} tokens) on this picture.`;
    }
    if (prompts === 0) return 'Layers split on your device, no AI prompt used.';
    return route === 'ai-both'
      ? `${count} · this picture needed all 3.`
      : route === 'ai-deep'
        ? `${count} · all layers made by the AI.`
        : `${count}.`;
  },
  runFallbackReason: (reason) =>
    reason === 'lettering-over-artwork'
      ? 'Why: the lettering sits on top of artwork.'
      : reason === 'text-left-in-background'
        ? 'Why: traces of the old lettering were still visible in the background.'
      : reason === 'font-too-narrow'
        ? 'Why: only part of the word could be found.'
        : reason === 'font-too-flat' || reason === 'font-too-spread' || reason === 'font-mixed-inks'
          ? 'Why: the picture is too busy to find the lettering.'
          : reason === 'ink-left-behind'
            ? 'Why: some letters were missed.'
            : 'Why: lettering and artwork could not be told apart.',
  runComplete: 'All 3 layers ready to download!',
  runPartialBtn: (done, total) => `${done}/${total} layers ready — Try again`,
  runStepComposite: 'Master picture with your word',
  runStepText: 'Separated font / writing',
  runStepBg: 'Separated clean background',
  runPhaseWaiting: 'Next',
  runPhasePasting: 'Adding…',
  runPhaseSending: 'Sending…',
  runPhaseManual: 'Press Send in the chat',
  runPhaseGenerating: 'AI is drawing…',
  runPhaseExtracting: 'Saving layer…',
  runPhaseDone: 'Ready',
  runPhaseNoImage: 'No image',
  runPhaseFailed: "Didn't work",
  runStop: 'Stop',
  runKeepPanelOpen: 'Keep this panel open. StyleLens creates the picture once, then separates its font and background.',
  runNoChat: 'First open an image-making AI chat below (Gemini, ChatGPT, or Grok), then press the white button again.',
  runFailed: 'It stopped part way. Press the white button or Retry on the missing card below.',
  runGrokMasterRequired:
    'Grok needs the picture attached before separating layers. Tap "Separate Image Already in Chat" once the picture is visible, or switch to Gemini / ChatGPT.',
  runImageAttachBlocked: (copied) =>
    copied
      ? 'This site blocked auto-attach — your picture is copied! Click the chat box, press Ctrl+V (or +), then tap a single button below.'
      : 'This site blocked auto-attach. Click the + upload button in the chat to attach your picture, or switch to Gemini / ChatGPT.',
  runTextOnlyAiNotice: (aiName) =>
    `${aiName} writes code & text and cannot draw pictures. Open Gemini, ChatGPT, or Grok below in 1 click:`,
  runCopyCodePrompt: 'Copy Code/SVG Prompt',
  runCopiedCodePrompt: 'Code Prompt Copied!',
  runTryHereAnyway: 'Try running here anyway',
  runPausedNoImage:
    'Step 1 finished before an image was detected. If the picture already appeared in your chat, click "Separate Image Already in Chat" below (no regeneration needed!), or retry Step 1:',
  runAiDeclined:
    'The AI declined to make this picture. It does that for some images, often well-known characters or brands, and StyleLens cannot change it. Try again, or pick a different picture:',
  runAiDeclinedLayer:
    'The AI declined to make one of the layers. Tap Retry on it, or use the layers that are ready.',
  styleDriftNotice: (issues, sizeRatio) => {
    const parts = issues.map((i) =>
      i === 'too-large'
        ? `about ${sizeRatio.toFixed(1)}x too big`
        : i === 'too-small'
          ? 'too small'
          : i === 'too-narrow'
            ? 'narrower'
            : i === 'too-wide'
              ? 'wider'
              : i === 'too-thin'
                ? 'thinner'
                : i === 'too-round'
                  ? 'rounder, like a standard font'
                  : 'heavier'
    );
    return `The AI drew the lettering differently from your picture: ${parts.join(', ')}.`;
  },
  styleDriftRetry: 'Redraw closer to the original (1 prompt)',
  runRetryStep1: 'Retry Step 1',
  runContinueSteps23: 'Continue Steps 2 & 3',
  runPartialNoImages:
    'This AI replied without drawing images. Switch to an image-capable chat like Gemini, ChatGPT, or Grok and press the white button again.',
  runPartialSomeImages: (done, total) =>
    `${done} of ${total} layers are ready below. Tap Retry on any missing layer without regenerating your picture.`,
  runImageAiTip: 'Best in image-capable chats (Gemini, ChatGPT, Grok, Qwen).',
  splitModeInstantTitle: 'Auto · 1',
  splitModeInstantUnit: 'prompt',
  splitModeInstantAria: 'Auto: usually 1 AI prompt, up to 3 for complex pictures',
  // 2 skipped pictures x 1,290 output tokens per Gemini 2.5 Flash Image picture (Google's pricing)
  splitModeInstantBadge: 'Up to 2,580 tokens saved',
  splitModeDeepTitle: 'Always AI · 3 prompts',
  splitModeDeepBadge: 'Best for 3D photos',
  separateExistingBtn: 'Separate Image Already in Chat',
  separateExistingScanning: 'Reading picture from chat…',
  separateExistingNotFound:
    'No finished AI picture found on this tab yet. Open Gemini, ChatGPT, or Grok with a finished picture first.',
  shelfTitle: 'Your Separated Files',
  shelfDownloadAll: (n) => `Download All (${n})`,
  shelfDownloadedAll: 'All Saved ✓',
  shelfCardPicture: 'Full Picture',
  shelfCardFont: 'Font / Writing',
  shelfCardBackground: 'Clean Background',
  shelfTransparentTag: 'Transparent PNG',
  shelfSolidTag: 'Solid Backdrop PNG',
  shelfLocalSplitBadge: '0-Token X-Ray Split',
  shelfToggleTransparent: 'Transparent',
  shelfToggleOriginal: 'Original',
  shelfDownloadBtn: 'Download',
  shelfSavedBtn: 'Saved ✓',
  shelfVectorSvgBtn: 'Vector SVG',
  shelfSavedSvgBtn: 'Saved SVG ✓',
  shelfCopySvgBtn: 'Copy for Figma',
  shelfCopiedSvgBtn: 'Copied SVG ✓',
  shelfAiRefineBtn: 'AI Refine',
  shelfPreviewBtn: 'Preview',
  shelfPreviewHideBtn: 'Hide Preview',
  shelfPreviewTitle: 'Large Layer Preview (Inspect Before Downloading)',
  shelfPreviewLightGrid: 'Light Grid',
  shelfPreviewDarkGrid: 'Dark Grid',
  pickNewBottomCta: 'Pick a New Picture (Start Over)',
  pickNewBottomHint: 'Finished with this picture? Tap below to pick a new style from any webpage:',
  shelfWaitingCard: 'Separating from your picture…',
  shelfRetryLayer: 'Retry',
  singleStepLabel: 'Or paste just one (then press Send):',
  singleComposite: 'Picture',
  singleText: 'Font',
  singleBg: 'Background',
  compactSending: 'Adding…',
  compactPastedPressSend: 'Pasted · Send',
  compactCopyStep2: '1/2 · Copy Prompt →',
  compactCopyImg2: '1/2 · Copy Image →',
  compactPasteNow: 'Copied · Ctrl+V',
  compactPromptInBoxPasteImg: 'Text In · Ctrl+V Img',
  openProStudioLink: 'Open Pro Studio (3-Layer Kit, Style Mixer, Code & W3C Tokens) →',

  imageBtn: 'Image',
  promptBtn: 'Prompt',
  savePngBtn: 'Save PNG',
  copied: 'Copied',
  saved: 'Saved',
  targetWordLabel: 'Target Word / Brand Name',
  targetWordPlaceholder: 'Type 1 word (e.g. "Apple", "Dollar Tree")',
  studioLockedNotice: 'Type a target word above to unlock the 3-image auto-sender.',
  scanNewPage: 'Scan New Page',
  threeLayerKitBtn: '3-Layer Kit →',
  moreDetails: 'More details',
  copyCaptureReport: 'Copy Capture Report',
  previewUnavailable: 'Preview unavailable',
  websiteLabel: 'Website',
  captureModeLabel: 'Capture Mode',
  resolutionLabel: 'Image Resolution',
  elementsScannedLabel: 'Elements Scanned',
  truncationWarning:
    'Large region hit the 120-element capture cap — drag a tighter box around a single component for complete 1:1 code accuracy.',
  captureInsertHint:
    'Open Gemini, ChatGPT, or Grok above and click the white button to auto-generate all 3 images one by one (or use the Prompt button above to copy the full code spec for Claude/Cursor).',
  modeArtworkPalette: 'Artwork + Palette',
  modeCodeImage: 'Code + Image',
  modeImageOnly: 'Image Only',
  cappedSuffix: ' (capped)',

  kitTitle: '3-Layer Asset Kit & Style Mixer',
  kitSubtitle: 'Export isolated wordmarks, backgrounds, Figma SVGs & W3C tokens',
  customTextLabel: 'Custom Text / Wordmark',
  mixerTitle: 'Cross-Site Style Mixer',
  mixerTwoSites: '2 sites mixed',
  mixerSingleSite: 'Single site',
  mixerNoneOption: 'None (Site A only)',
  mixerEmptyHint: 'Scan a second website to mix colors & fonts from Site A with layout & frames from Site B.',
  mixModeAStyleBFrame: 'A Style + B Frame',
  mixModeBalanced: 'Balanced Mix',
  mixModeAFrameBStyle: 'A Frame + B Style',
  layerComposite: 'Composite',
  layerTextOnly: 'Text Only',
  layerBackground: 'Background',
  copyLayerFigma: (layer) => `Copy ${layer} SVG for Figma / Canva`,
  copiedFigmaToast: 'Copied Editable SVG — Paste into Figma / Canva',
  downloadPng2x: 'Download PNG (2×)',
  downloadSvg: 'Download SVG',
  downloadBgHtml: 'Download Standalone Background HTML',
  w3cTitle: 'W3C Design Tokens (Figma / DTCG JSON)',
  w3cSubtitle: 'Standard $type / $value tokens for enterprise design systems',
  copyJson: 'Copy JSON',
  saveJson: 'Save .json',

  designTitle: 'Design',
  themeSummary: (polarity, count) => `${polarity} theme · ${count} colors`,
  colorsHeading: 'Colors',
  tapToCopy: 'Tap to copy',
  noColorsDetected: 'No colors detected.',
  showFewerColors: 'Show fewer colors',
  showAllColors: (count) => `Show all ${count} colors`,
  fontsHeading: 'Fonts',
  noTextStylesFound: 'No text styles found in this area.',
  showFewerFonts: 'Show fewer fonts',
  showAllFonts: (count) => `Show all ${count} fonts`,
  readabilityContrastTitle: 'Readability & Contrast',
  readabilityContrastSub: 'WCAG 2.1 accessibility check',
  allPass: 'All Pass',
  lowContrastCount: (count) => `${count} Low`,
  spacingLayoutTitle: 'Spacing, Layout & Effects',
  spacingLayoutSub: (model, traits) => `${model.toUpperCase()} layout · ${traits} detected traits`,
  detectedTraits: 'Detected Traits',
  layoutModel: 'Layout Model',
  spacingGrid: 'Spacing Grid',
  pxBaseSuffix: 'px base',
  contrastOn: ' on ',
  estimatedSuffix: ' (estimated)',
  surfaceCornerRounding: 'Corner Rounding',
  surfaceBorders: 'Borders',
  surfaceShadows: 'Shadows',
  surfaceBackdropBlur: 'Backdrop Blur',
  surfaceGradients: 'Gradients',
  observedSpacing: 'Observed Spacing',
  cssVariablesTitle: 'Website CSS Variables',
  cssVariablesSub: (count) => `${count} custom tokens discovered`,
  copyReport: 'Copy Report',

  codeTitle: 'Code',
  elementsCount: (count, truncated) => `${count} elements${truncated ? ' (capped)' : ''}`,
  noHtmlExposed:
    'This capture came from a video, canvas, or protected frame, so no underlying HTML is exposed.',
  faithfulCodeBtn: '1:1 HTML + CSS',
  cleanHtmlBtn: 'Clean HTML',
  copyBtn: 'Copy',
  inspectElementsTitle: 'Inspect Elements & CSS',
  inspectElementsSub: "Explore each tag's exact computed styles",

  remixTitle: 'Remix',
  remixSubtitle: 'Reuse this style for something new',
  remixPromptLabel: 'What would you like to build?',
  remixDefaultPrompt:
    'Create a modern dashboard card using this website’s colors, typography, and spacing.',
  remixPromptPlaceholder: 'Describe your new component or layout...',
  updatePreview: 'Update Preview',
  connectAiKeyBtn: 'Connect AI Key',
  generateWith: (label) => `Generate (${label})`,
  previewTab: 'Preview',
  codeTab: 'Code',
  copyCode: 'Copy Code',
  moreOptionsTitle: 'More options',
  moreOptionsSub: 'Framework, prompt ideas & style blending',
  outputFormatLabel: 'Output Format',
  blendWithLabel: 'Blend with capture',
  noneLabel: 'None',
  quickIdeasLabel: 'Quick ideas',
  remixQuickPrompts: [
    'Modern AI dashboard card using this exact style',
    'Website navbar & hero header with these fonts and colors',
    'Pro pricing plan card matching this design system',
    'Clean search command modal with these surfaces',
  ],
  fidelityCriticTitle: 'Fidelity Critic, Tokens & Prompt',
  remixPreparing: 'Preparing design tokens...',
  remixGenerating: 'Generating...',
  remixSwitchToCode: 'Switch to the Code view to inspect the generated component.',
  fidelityAuditHeading: 'Fidelity Critic Audit',
  fidelityFontsLive: 'Fonts (Live):',
  fidelityPolarityAccents: 'Polarity & Accents:',
  fidelityContrastLayout: 'Contrast & Layout:',
  fidelitySurfaces: 'Surfaces:',
  fidelityStructureSafety: 'Structure & Safety:',
  designInfluencesHeading: 'Design influences applied',
  exportAiPromptTab: 'AI Prompt',

  emptyTitle: 'Select anything on a webpage',
  emptyDescBefore: 'Click ',
  emptyDescBold: 'Start Scanning',
  emptyDescAfter:
    ', then click and drag a box around any section to save its image, colors, fonts, and clean code.',
  emptyBtn: 'Start Scanning',
  shortcutLabel: 'Shortcut:',
  systemStatusTitle: 'System status',
  systemStatusSub: 'Local engines & AI readiness',

  appearanceComfort: 'Appearance & Language',
  languageLabel: 'Language / 语言',
  languageDesc: 'Switch the entire StyleLens interface between English and Simplified Chinese.',
  stillModeLabel: 'Still Mode (Pause logo & click glitch effects)',
  stillModeDesc: 'Pauses the cycling StyleLens header wordmark & click glitch animations while keeping the minimal 90° grid calm.',
  aiConnectionMode: 'AI Connection Mode',
  engineByokTitle: 'Connect AI Account',
  engineByokBadge: 'Recommended',
  engineByokDesc:
    'Plug in Claude, ChatGPT, DeepSeek, Gemini, Kimi, Qwen, or local Ollama directly in Chrome.',
  engineOfflineTitle: 'Offline Mode (No Account Needed)',
  engineOfflineBadge: 'Ready',
  engineOfflineDesc:
    'Generates 1-to-1 faithful HTML/CSS blueprints, CSS tokens, and copy-paste prompts completely offline.',
  engineChromeTitle: 'Chrome Built-in AI (Gemini Nano)',
  engineChromeDesc: 'On-device Chrome model when supported.',
  chooseProvider: 'Choose Provider',
  apiBaseUrl: 'API Base URL',
  modelLabel: 'Model',
  apiKeyLabel: 'API Key',
  optionalTag: '(Optional)',
  clearBtn: 'Clear',
  includeScreenshotLabel: 'Include screenshot (Vision)',
  includeScreenshotDesc: 'Turn on for vision models (Claude, ChatGPT, Gemini, Qwen-VL).',
  localKeyPrivacyNote: 'Your key stays strictly inside your local Chrome storage.',
  testConnectionBtn: 'Test Connection',
  testingConnectionBtn: 'Testing Connection...',
  permissionDeclined: (origin) => `Permission for ${origin} was declined.`,
  testFailedGeneric: 'Test failed.',
  showKeyTitle: 'Show key',
  hideKeyTitle: 'Hide key',
  saveBtn: 'Save',

  advisorTitle: 'Design Advisor',
  advisorGreeting: 'Ask me if you want design advice, contrast checks, or help recreating this capture.',
  advisorPlaceholder: 'Ask about colors, fonts, or contrast...',
  advisorReviewing: 'Reviewing capture...',
  advisorError: 'Could not reach the AI provider. Try again or review the Design tab directly.',
  advisorQuickAsks: [
    'Check readability & contrast',
    'How do I recreate this?',
    'Review colors & fonts',
  ],
};

const ZH_CN: Translations = {
  modeSimple: '极简',
  modeStudio: '工作室',
  tabCapture: '捕获',
  tabKit: '套件混搭',
  tabDesign: '设计',
  tabCode: '代码',
  tabRemix: '重混',
  scan: '扫描',
  cancel: '取消',
  recentCaptures: '最近捕获',
  settingsTitle: '设置与 AI 账号',

  askForAdvice: '设计建议',
  openArrow: '打开 →',
  close: '关闭',
  connectAccount: '连接 AI 账号',
  connectedPrefix: '已连接 · ',
  manageArrow: '管理 →',
  connectArrow: '连接 →',
  dragBoxBanner: '请在网页上拖动框选任意区域…',
  allowOrigin: (host) => `允许访问 ${host}`,
  openAiTitle: (label) => `打开 ${label}`,

  step1Short: '选择',
  step2Short: '输入',
  step3Short: '生成',
  onboardingTitle: '复制任意网站的设计风格',
  onboardingDescBefore: '点击下方白色按钮，然后在网页上',
  onboardingDescBold: '拖动框选',
  onboardingDescAfter: '任意标志、标题或卡片。',
  pickAnythingBtn: '选择此页面上的任意内容',
  nowDragBox: '现在请在网页上拖动框选…',
  readingStyleFonts: '正在提取字体与样式…',
  worksOfflineNote: '适用于任意网站 · 仅在您主动点击发送时分享内容。',

  step1PickedBadge: '第 1 步 · 已选风格',
  pickNewBtn: '重新框选新图',
  xrayDnaBadge: 'X-Ray 基因',
  viewfinderCaptured: '已拍摄',
  mistakesNote: '样式镜也可能出错。如果某个图层不对，点一下即可重新生成。',
  matchCaseLabel: (styled) => `与原图大小写一致：${styled}`,
  step2OriginalLabel: '图中原文：',
  step2OriginalPlaceholder: '例如 crave（有助于还原字母）',
  xrayVisualMode: '图像',
  xrayDomMode: '源码',
  xrayPolarityDark: '深色',
  xrayPolarityLight: '浅色',

  step2Title: '第 2 步 · 要改成什么文字？',
  step2StartHere: '请先在这里输入',
  step2DoneBadge: '已就绪 ✓',
  step2Placeholder: '输入任意词，例如「苹果」或 "Apple"',
  step2TryPrefix: '试试：',
  step2Examples: ['苹果', 'Apple', '我的品牌'],
  step2StyleLockedTitle: '已锁定图片中的字体风格',
  step2StyleLockedDesc: (word) =>
    word
      ? `第 3 步中，AI 会用这种字体原样写出「${word}」。`
      : '输入文字后，AI 会用这种字体原样写出来。',
  textOnlyPng: '仅文字 (PNG)',
  savedPng: '已保存 PNG',
  textOnlySvg: '仅文字 (SVG)',
  savedSvg: '已保存 SVG',
  backgroundOnly: '仅背景图层',
  savedBg: '已保存背景',
  copyForFigma: '复制到 Figma',
  copiedSvg: '已复制 SVG',

  step3Title: '第 3 步 · 打开 AI 并发送',
  step3LockedNotice: '请先完成上方第 2 步 — 输入您想生成的文字。',
  step3ChooseAiLabel: '一键打开常用 AI：',
  step3MoreAi: '更多 AI',
  step3LessAi: '收起',
  aiBadgeImages: '可生图',
  aiBadgeCode: '代码',
  imageStyleMatched: '图像风格 · AI 智能匹配',
  step3Helper: '点击上方支持画图的 AI（如 Gemini、ChatGPT、Grok），再按一次白色按钮即可自动生成 3 张图。',
  sendToAiChat: '请先输入文字',
  makeThreeImages: (word) => `生成并分离「${word}」`,
  runInProgress: '正在生成并分离图层…',
  runStage: (stage) =>
    stage === 'making'
      ? '第 1 次提示：正在生成图片…'
      : stage === 'checking'
        ? '正在检查能否在本机免费分离…'
        : stage === 'rebuilding'
          ? '正在本机重建背景…'
          : stage === 'ai-background'
          ? '正在请 AI 只生成背景（再用 1 次提示）…'
          : stage === 'ai-both'
            ? '正在请 AI 生成文字和背景（再用 2 次提示）…'
            : '正在用 AI 生成全部 3 个图层（3 次提示）…',
  runUsedPrompts: (prompts, route) => {
    const count = `共用 ${prompts} 次 AI 提示`;
    const saved = 3 - prompts;
    if ((route === 'local' || route === 'ai-background') && prompts >= 1 && saved > 0) {
      return `${count} · 这张图省下 ${saved} 次（约 ${(saved * 1290).toLocaleString('en-US')} 个 token）。`;
    }
    if (prompts === 0) return '图层在本机分离，未使用 AI 提示。';
    return route === 'ai-both'
      ? `${count} · 这张图需要全部 3 次。`
      : route === 'ai-deep'
        ? `${count} · 全部图层由 AI 生成。`
        : `${count}。`;
  },
  runFallbackReason: (reason) =>
    reason === 'lettering-over-artwork'
      ? '原因：文字压在图案上。'
      : reason === 'text-left-in-background'
        ? '原因：背景里还残留着原文字的痕迹。'
      : reason === 'font-too-narrow'
        ? '原因：只找到了部分文字。'
        : reason === 'font-too-flat' || reason === 'font-too-spread' || reason === 'font-mixed-inks'
          ? '原因：画面太复杂，无法找出文字。'
          : reason === 'ink-left-behind'
            ? '原因：漏掉了部分字母。'
            : '原因：无法区分文字和图案。',
  runComplete: '全部 3 个图层已就绪，可直接下载！',
  runPartialBtn: (done, total) => `已就绪 ${done}/${total} 个图层 — 重试`,
  runStepComposite: '含目标文字的完整主图',
  runStepText: '分离出的独立字体 / 文字',
  runStepBg: '分离出的纯净无字背景',
  runPhaseWaiting: '等待中',
  runPhasePasting: '正在添加…',
  runPhaseSending: '正在发送…',
  runPhaseManual: '请在对话框里按发送',
  runPhaseGenerating: 'AI 正在画图…',
  runPhaseExtracting: '提取图层中…',
  runPhaseDone: '已就绪',
  runPhaseNoImage: '未出图',
  runPhaseFailed: '未成功',
  runStop: '停止',
  runKeepPanelOpen: '请保持此面板打开，StyleLens 会先生成主图，再直接分离字体与背景。',
  runNoChat: '请先点击下方图标打开支持画图的 AI（Gemini、ChatGPT 或 Grok），再按一次白色按钮。',
  runFailed: '中途停止了，可点击白色按钮或缺失卡片上的「重试」。',
  runGrokMasterRequired:
    'Grok 需要附上主图才能分离图层。待对话中出图后点击「直接分离对话中已有的图片」，或切换到 Gemini / ChatGPT。',
  runImageAttachBlocked: (copied) =>
    copied
      ? '该网站拦截了自动上传 — 图片已复制到剪贴板！请点输入框按 Ctrl+V（或点 + 上传），再点下方单个按钮。'
      : '该网站拦截了自动上传。请先点对话框中的 + 号上传截图，或切换到 Gemini / ChatGPT。',
  runTextOnlyAiNotice: (aiName) =>
    `${aiName} 主要用于写代码和文字，无法直接生成图片。点下方一键打开支持画图的 AI：`,
  runCopyCodePrompt: '复制代码/SVG 提示词',
  runCopiedCodePrompt: '已复制代码提示词！',
  runTryHereAnyway: '仍要在此页面尝试',
  runPausedNoImage:
    '第 1 步结束时暂未检测到图片。若对话中已经出图，直接点下方「直接分离对话中已有的图片」（无需重新生成！），或重试第 1 步：',
  runAiDeclined:
    'AI 拒绝生成这张图片。它对部分图片（常见于知名角色或品牌）会这样，样式镜无法改变这一点。请重试，或换一张图片：',
  runAiDeclinedLayer: 'AI 拒绝生成其中一个图层。请点该图层的重试，或直接使用已就绪的图层。',
  styleDriftNotice: (issues, sizeRatio) => {
    const parts = issues.map((i) =>
      i === 'too-large'
        ? `大了约 ${sizeRatio.toFixed(1)} 倍`
        : i === 'too-small'
          ? '偏小'
          : i === 'too-narrow'
            ? '偏窄'
            : i === 'too-wide'
              ? '偏宽'
              : i === 'too-thin'
                ? '笔画偏细'
                : i === 'too-round'
                  ? '弧线偏圆，像普通字体'
                  : '笔画偏粗'
    );
    return `AI 画出的文字与原图不同：${parts.join('、')}。`;
  },
  styleDriftRetry: '按原图重新绘制（1 次提示）',
  runRetryStep1: '重试第 1 步',
  runContinueSteps23: '继续第 2、3 步',
  runPartialNoImages:
    '当前 AI 只回复了文字没有画图。请切换到支持生图的 AI（如 Gemini、ChatGPT、Grok、通义千问）再按白色按钮。',
  runPartialSomeImages: (done, total) =>
    `下方已就绪 ${done}/${total} 个图层。可点击缺失图层上的「重试」，无需重新生成主图。`,
  runImageAiTip: '建议使用支持生图的 AI 对话（Gemini、ChatGPT、Grok、通义千问）。',
  splitModeInstantTitle: '自动 · 1',
  splitModeInstantUnit: '次提示',
  splitModeInstantAria: '自动：通常只需 1 次 AI 提示，复杂图片最多 3 次',
  splitModeInstantBadge: '最多节省 2,580 个 token',
  splitModeDeepTitle: '始终用 AI · 3 次提示',
  splitModeDeepBadge: '适合 3D 实拍',
  separateExistingBtn: '直接分离对话中已有的图片',
  separateExistingScanning: '正在读取对话中的图片…',
  separateExistingNotFound:
    '当前标签页未找到已生成的 AI 图片。请先切换到已出图的 Gemini、ChatGPT 或 Grok 页面。',
  shelfTitle: '已分离的可下载文件',
  shelfDownloadAll: (n) => `一键下载全部 (${n})`,
  shelfDownloadedAll: '已全部保存 ✓',
  shelfCardPicture: '完整图片',
  shelfCardFont: '字体 / 文字',
  shelfCardBackground: '纯净背景',
  shelfTransparentTag: '透明背景 PNG',
  shelfSolidTag: '纯色底图 PNG',
  shelfLocalSplitBadge: '0 额度 X-Ray 分离',
  shelfToggleTransparent: '透明',
  shelfToggleOriginal: '原底色',
  shelfDownloadBtn: '下载',
  shelfSavedBtn: '已保存 ✓',
  shelfVectorSvgBtn: '矢量 SVG',
  shelfSavedSvgBtn: '已存 SVG ✓',
  shelfCopySvgBtn: '复制到 Figma',
  shelfCopiedSvgBtn: '已复制 SVG ✓',
  shelfAiRefineBtn: 'AI 精修',
  shelfPreviewBtn: '预览大图',
  shelfPreviewHideBtn: '收起预览',
  shelfPreviewTitle: '图层大图预览（下载前可仔细查看）',
  shelfPreviewLightGrid: '浅色网格',
  shelfPreviewDarkGrid: '深色网格',
  pickNewBottomCta: '重新框选下一张图片（重新开始）',
  pickNewBottomHint: '这张图片做完了？点击下方醒目按钮即可去网页框选下一张图片：',
  shelfWaitingCard: '正在从主图分离…',
  shelfRetryLayer: '重试',
  singleStepLabel: '或只填入其中一个（再按发送）：',
  singleComposite: '原图',
  singleText: '字体',
  singleBg: '背景',
  compactSending: '填入中…',
  compactPastedPressSend: '已填入 · 请发送',
  compactCopyStep2: '1/2 · 复制提示 →',
  compactCopyImg2: '1/2 · 复制图片 →',
  compactPasteNow: '已复制 · Ctrl+V',
  compactPromptInBoxPasteImg: '已填词 · Ctrl+V 贴图',
  openProStudioLink: '打开专业工作室（三层套件、风格混搭、代码与 W3C Tokens）→',

  imageBtn: '图片',
  promptBtn: '提示词',
  savePngBtn: '保存 PNG',
  copied: '已复制',
  saved: '已保存',
  targetWordLabel: '目标文字 / 品牌名称',
  targetWordPlaceholder: '输入 1 个词（例如「苹果」或 "Apple"）',
  studioLockedNotice: '请先在上方输入目标文字，即可解锁一键连续生成 3 张图。',
  scanNewPage: '扫描新页面',
  threeLayerKitBtn: '三层套件 →',
  moreDetails: '更多详情',
  copyCaptureReport: '复制捕获报告',
  previewUnavailable: '暂无预览',
  websiteLabel: '来源网站',
  captureModeLabel: '捕获模式',
  resolutionLabel: '图片分辨率',
  elementsScannedLabel: '扫描元素数',
  truncationWarning:
    '所选区域超过 120 个元素上限 — 请缩小框选范围到单个组件，以获得更精确的 1:1 代码还原。',
  captureInsertHint:
    '打开上方 Gemini / ChatGPT / Grok 后点击白色按钮即可自动连续生成 3 张图；开发者也可点上方「提示词」复制完整源码规范给 Claude 或 Cursor。',
  modeArtworkPalette: '艺术图 + 配色',
  modeCodeImage: '源码 + 截图',
  modeImageOnly: '纯截图模式',
  cappedSuffix: '（已达上限）',

  kitTitle: '三层素材套件与跨站混搭',
  kitSubtitle: '导出独立文字图层、无字背景、Figma SVG 与 W3C 设计规范',
  customTextLabel: '自定义文字 / 标识',
  mixerTitle: '跨站风格混搭器',
  mixerTwoSites: '已混搭 2 个网站',
  mixerSingleSite: '单个网站',
  mixerNoneOption: '无（仅使用网站 A）',
  mixerEmptyHint: '再扫描第二个网站，即可将网站 A 的配色字体与网站 B 的框架圆角自由混搭。',
  mixModeAStyleBFrame: 'A 风格 + B 框架',
  mixModeBalanced: '均衡混搭',
  mixModeAFrameBStyle: 'A 框架 + B 风格',
  layerComposite: '完整合成',
  layerTextOnly: '仅文字',
  layerBackground: '仅背景',
  copyLayerFigma: (layer) => `复制${layer} SVG（直接粘贴至 Figma / Canva）`,
  copiedFigmaToast: '已复制可编辑 SVG — 直接粘贴到 Figma / Canva',
  downloadPng2x: '下载高清 PNG (2×)',
  downloadSvg: '下载 SVG 矢量',
  downloadBgHtml: '下载独立背景 HTML',
  w3cTitle: 'W3C 设计令牌 (Figma / DTCG JSON)',
  w3cSubtitle: '标准 $type / $value 格式，可直接导入企业设计系统',
  copyJson: '复制 JSON',
  saveJson: '保存 .json',

  designTitle: '设计规范',
  themeSummary: (polarity, count) =>
    `${polarity === 'dark' ? '深色' : polarity === 'light' ? '浅色' : '混合'}主题 · ${count} 种配色`,
  colorsHeading: '提取配色',
  tapToCopy: '点击复制',
  noColorsDetected: '未检测到颜色。',
  showFewerColors: '收起部分颜色',
  showAllColors: (count) => `查看全部 ${count} 种颜色`,
  fontsHeading: '字体系统',
  noTextStylesFound: '此区域未检测到文字样式。',
  showFewerFonts: '收起字体列表',
  showAllFonts: (count) => `查看全部 ${count} 种字体`,
  readabilityContrastTitle: '可读性与对比度审计',
  readabilityContrastSub: 'WCAG 2.1 无障碍对比度检测',
  allPass: '全部通过',
  lowContrastCount: (count) => `${count} 项偏低`,
  spacingLayoutTitle: '间距、布局与视觉特效',
  spacingLayoutSub: (model, traits) => `${model.toUpperCase()} 布局 · 识别到 ${traits} 项视觉特征`,
  detectedTraits: '识别到的风格特征',
  layoutModel: '布局模型',
  spacingGrid: '间距网格',
  pxBaseSuffix: 'px 基准',
  contrastOn: ' 叠于 ',
  estimatedSuffix: '（估算值）',
  surfaceCornerRounding: '圆角',
  surfaceBorders: '边框',
  surfaceShadows: '阴影',
  surfaceBackdropBlur: '背景模糊 / 毛玻璃',
  surfaceGradients: '渐变效果',
  observedSpacing: '实测间距标尺',
  cssVariablesTitle: '网站原生 CSS 变量',
  cssVariablesSub: (count) => `发现 ${count} 个自定义令牌`,
  copyReport: '复制报告',

  codeTitle: '源码蓝图',
  elementsCount: (count, truncated) => `共 ${count} 个元素${truncated ? '（已达上限）' : ''}`,
  noHtmlExposed: '该捕获来自视频、画布或受保护框架，因此无法提取底层 HTML。',
  faithfulCodeBtn: '1:1 HTML + CSS',
  cleanHtmlBtn: '精简 HTML',
  copyBtn: '复制',
  inspectElementsTitle: '查看元素树与计算样式',
  inspectElementsSub: '逐一检查每个标签的精确 CSS 属性',

  remixTitle: '风格重混',
  remixSubtitle: '用这套设计风格快速预览新组件',
  remixPromptLabel: '您想生成什么组件？',
  remixDefaultPrompt: '使用该网站的配色、字体和间距创建一个现代仪表盘卡片。',
  remixPromptPlaceholder: '描述您想生成的新组件或页面布局…',
  updatePreview: '更新预览',
  connectAiKeyBtn: '连接 AI 密钥',
  generateWith: (label) => `生成预览 (${label})`,
  previewTab: '实时预览',
  codeTab: '代码',
  copyCode: '复制代码',
  moreOptionsTitle: '更多选项',
  moreOptionsSub: '输出框架、快捷灵感与双站融合',
  outputFormatLabel: '输出格式',
  blendWithLabel: '融合另一份捕获',
  noneLabel: '不融合',
  quickIdeasLabel: '快捷灵感',
  remixQuickPrompts: [
    '使用这套风格生成现代 AI 仪表盘卡片',
    '应用此配色和字体制作网站导航栏与首屏标题',
    '匹配该设计系统的专业版定价方案卡片',
    '采用相同表面质感的极简搜索指令弹窗',
  ],
  fidelityCriticTitle: '还原度评分、设计令牌与提示词',
  remixPreparing: '正在准备设计令牌…',
  remixGenerating: '正在生成…',
  remixSwitchToCode: '请切换至「代码」视图查看生成的组件源码。',
  fidelityAuditHeading: '还原度严审评分',
  fidelityFontsLive: '字体（实时）：',
  fidelityPolarityAccents: '明暗与强调色：',
  fidelityContrastLayout: '对比度与布局：',
  fidelitySurfaces: '表面质感：',
  fidelityStructureSafety: '结构与安全性：',
  designInfluencesHeading: '已应用的设计要素',
  exportAiPromptTab: 'AI 提示词',

  emptyTitle: '框选网页上的任意设计元素',
  emptyDescBefore: '点击 ',
  emptyDescBold: '开始扫描',
  emptyDescAfter: '，然后在网页上拖动框选任意区域，即可保存高清截图、配色、字体与 1:1 源码。',
  emptyBtn: '开始扫描',
  shortcutLabel: '快捷键：',
  systemStatusTitle: '系统引擎状态',
  systemStatusSub: '本地渲染与 AI 就绪状态',

  appearanceComfort: '外观与语言设置',
  languageLabel: '界面语言 / Language',
  languageDesc: '一键将整个样式镜（StyleLens）切换为简体中文或英文。',
  stillModeLabel: '静止模式（暂停标题与点击故障动效）',
  stillModeDesc: '暂停顶部样式镜字体循环与点击故障动效，同时保持极简 90° 网格背景沉稳清晰。',
  aiConnectionMode: 'AI 连接引擎',
  engineByokTitle: '连接自有 AI 账号',
  engineByokBadge: '推荐',
  engineByokDesc: '直接在浏览器中连接 Claude、ChatGPT、DeepSeek、Gemini、Kimi、通义千问或本地 Ollama。',
  engineOfflineTitle: '离线模式（无需账号）',
  engineOfflineBadge: '就绪',
  engineOfflineDesc: '完全离线生成 1:1 源码蓝图、CSS 令牌、三层素材包与一键提示词。',
  engineChromeTitle: 'Chrome 内置 AI (Gemini Nano)',
  engineChromeDesc: '浏览器支持时可调用端侧本地模型。',
  chooseProvider: '选择服务商',
  apiBaseUrl: 'API 接口地址 (Base URL)',
  modelLabel: '模型名称 (Model)',
  apiKeyLabel: 'API 密钥',
  optionalTag: '（可选）',
  clearBtn: '清除',
  includeScreenshotLabel: '附带截图（多模态视觉）',
  includeScreenshotDesc: '连接视觉模型（Claude / ChatGPT / Gemini / Qwen-VL）时建议开启。',
  localKeyPrivacyNote: '您的密钥仅保存在本地 Chrome 存储中，绝不上传第三方服务器。',
  testConnectionBtn: '测试连接',
  testingConnectionBtn: '正在测试连接…',
  permissionDeclined: (origin) => `访问 ${origin} 的网络权限已被拒绝。`,
  testFailedGeneric: '连接测试失败。',
  showKeyTitle: '显示密钥',
  hideKeyTitle: '隐藏密钥',
  saveBtn: '保存设置',

  advisorTitle: '设计顾问',
  advisorGreeting: '有任何关于配色对比度、字体搭配或 1:1 复刻的问题，随时问我。',
  advisorPlaceholder: '询问配色、字体或对比度建议…',
  advisorReviewing: '正在分析捕获结果…',
  advisorError: '无法连接 AI 服务商，请重试或直接查看「设计」标签页。',
  advisorQuickAsks: [
    '检查可读性与对比度',
    '如何 1:1 复刻这个设计？',
    '分析配色与字体搭配',
  ],
};

export function getTranslations(language: UiLanguage = 'en'): Translations {
  return language === 'zh-CN' ? ZH_CN : EN;
}
