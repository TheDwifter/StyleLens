# StyleLens

You find lettering you love on a web page and want it with your own words. Asking an AI chat to
"change the text" usually loses the style, and you get back one flat picture you can't reuse.

StyleLens is an open-source browser extension that sits in your side panel. Drag a box around any
logo, banner or headline, type your words, and get three files: the picture with your words in the
original style, the lettering on its own, and the background without it.

<!-- Demo: add docs/media/demo.gif (about 20 seconds, no third-party logos) and uncomment:
![StyleLens turning a headline into new words](docs/media/demo.gif)
-->

## What you get

| File | What it is |
|---|---|
| **Full Picture** | Your words in the original style |
| **Font / Writing** | Only the lettering, on a see-through background, plus a vector outline |
| **Clean Background** | The picture with the lettering removed |

## How it works

- **No backend, no account, no API key.** It works with the image-capable AI chat you already use
  (Gemini, ChatGPT or Grok) in a normal browser tab. Nothing goes to a server of ours, because
  there isn't one.
- **Usually one AI prompt.** The AI draws the new picture once; StyleLens separates the lettering
  and background on your own computer. That saves up to 2,580 tokens per picture compared with
  asking for all three images.
- **Two AI models run on your device.** A text detector (PaddleOCR PP-OCRv5, 4.8 MB) finds where
  the lettering is, and an inpainting model (LaMa, 37 MB) rebuilds the artwork hidden behind it.
  Both ship inside the extension and run with ONNX Runtime Web. The background rebuild needs
  WebGPU; on computers without it, StyleLens uses its pixel-based rebuild instead.
- **It checks its own work.** A self-check reviews every split. If one looks wrong, StyleLens asks
  the AI for one or two more pictures instead of handing you a bad file, and tells you why.
- **The prompt is measured, not guessed.** It reads real colours, sizes and fonts from the page,
  measures letter height, width and stroke weight, and tells the AI which letters the old and new
  words share. If the result drifts from the original, you get a one-tap "Redraw closer".
- **You stay in control.** It only works on the page you pick from and the chat tab you start a
  run in, and only while that run lasts. **Always AI** mode is there if you prefer three prompts
  every time.

Works in Chrome and Edge (Manifest V3).

## Install

Until the Chrome Web Store listing is live:

1. Download `StyleLens-1.0.0.zip` from [Releases](https://github.com/TheDwifter/StyleLens/releases)
   and unzip it.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder.
4. Open the side panel from the toolbar icon or press `Alt+Shift+S`.

Then open Gemini, ChatGPT or Grok in another tab, signed in to your own account.

## Good to know

- The AI redraws your words, so the style can still drift from the original. Results vary with
  the AI you use and from run to run.
- Photos, busy illustrations and well-known characters can take up to three prompts, and the AI
  sometimes refuses them.
- The background rebuild in a session can take up to 15 seconds.
- Only recreate artwork you have the right to use. StyleLens is not affiliated with any AI provider.

Privacy: [docs/PRIVACY_POLICY.md](docs/PRIVACY_POLICY.md).

## Build from source

```bash
npm install
npm run build      # production build into dist/
npm test           # unit tests: splitter, self-check, prompts, text detection, chat-tab handling
npm run typecheck  # strict TypeScript
```

Load the `dist` folder with **Load unpacked**. Architecture notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Feedback

Bug reports and ideas are welcome in [Issues](https://github.com/TheDwifter/StyleLens/issues).
A picture where the split went wrong (without third-party logos, if you can) helps most.

## Licence

MIT, see [LICENSE](LICENSE). The bundled models are Apache-2.0; see
[THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt).
