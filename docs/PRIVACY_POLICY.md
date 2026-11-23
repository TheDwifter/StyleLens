# StyleLens Privacy Policy

Last updated: 23 November 2026

StyleLens is a browser extension that captures a region of a web page you choose, reads its
design details, and helps you recreate that style with different words using an AI chat that
you open and control yourself.

## What StyleLens handles

| Data | When | Where it goes |
|---|---|---|
| A screenshot of the region you select, and the style details read from it (colours, fonts, sizes, layout) | Only when you press Pick and drag a box | Stored on your device, in the browser's local storage for this extension |
| The word(s) you type | When you type them | Kept on your device for the current session |
| The picture and prompt you choose to send | Only when you press the send button | Pasted into the AI chat tab that you have open (for example Gemini or ChatGPT). From that point the AI provider's own privacy policy applies |
| Pictures the AI chat returns | After the AI answers | Read from that chat tab and processed on your device |
| An API key and endpoint, if you enter them in the optional AI settings | When you save them | Stored on your device; used only to call the endpoint you entered |

## What StyleLens does not do

- It has no server of its own. It does not send your captures, words, pictures or browsing
  activity to the developer.
- It contains no analytics, advertising or tracking code.
- It does not read pages in the background. It reads a page only when you start a capture on it,
  and reads an AI chat tab only while a run you started is in progress.
- It does not sell your data. It passes your picture and words to a third party only when you press send, and only to the AI chat or API endpoint you chose.

## On-device processing

Finding text, separating lettering from the background, and rebuilding the background behind
erased lettering happen entirely on your device. The models used for this are bundled inside the
extension; no picture is uploaded for them and nothing is downloaded at run time.

## Third parties

When you send a picture and prompt to an AI chat, or call an API endpoint you configured, that
provider receives the content you sent and handles it under its own terms and privacy policy.
StyleLens is not affiliated with, endorsed by, or sponsored by those providers.

## Limited use

StyleLens's use of information received from browser APIs adheres to the Chrome Web Store User
Data Policy, including the Limited Use requirements. Data is used only to provide the features
described above, is not used for advertising or creditworthiness, and is not read by humans.

## Storage and deletion

Captures and settings stay in this extension's local storage on your device. StyleLens keeps
your 25 most recent captures and deletes older ones automatically. You can delete a capture at
any time from the Capture tab in Studio mode. Removing the extension deletes everything it stored.

## Children

StyleLens is not directed at children under 13.

## Changes and contact

This policy may be updated; the date above will change when it is.
Questions or requests: open an issue at https://github.com/TheDwifter/StyleLens/issues
