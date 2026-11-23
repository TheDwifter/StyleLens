import ts from 'typescript';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_TIMING,
  runThreeImageSequence,
} from '../../sidepanel/utils/threeImageRun';
import type {
  AssistantImageDescriptor,
  ChatProbeResponse,
  PasteToChatResponse,
} from '../../types/messages';
// Raw source text only: the service worker module itself is never executed in this test.
import SW_SOURCE from '../serviceWorker.ts?raw';

/**
 * Regression suite for the Disney+ -> "Record" failure, where
 * Step 3 extracted an OLD "Apple" image from an earlier turn of the same Gemini thread instead
 * of the newly generated "Record+" image.
 *
 * The page functions are loaded the way Chrome MV3 runs them: each `executeScript({ func })`
 * target is serialized on its own (`func.toString()`), so it is extracted from the source by
 * name, transpiled, and evaluated STANDALONE. Any reference to a module-level helper would throw
 * a ReferenceError here, exactly as it would inside the chat tab.
 */
const SW_AST = ts.createSourceFile('serviceWorker.ts', SW_SOURCE, ts.ScriptTarget.ES2022, true);

function loadPageFunction<T>(name: string): T {
  const decl = SW_AST.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name
  );
  if (!decl) throw new Error(`Function ${name} not found in serviceWorker.ts`);
  const js = ts.transpileModule(decl.getText(SW_AST), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function(`${js}\nreturn ${name};`)() as T;
}

interface PageExtractAttempt {
  status: 'extracted' | 'needs-sw-fetch' | 'not-found' | 'not-loaded';
  dataUrl?: string;
  src?: string;
  domId?: string;
}

const inject = loadPageFunction<
  (
    imageDataUrl: string,
    promptText: string,
    requireImage?: boolean,
    fileName?: string
  ) => Promise<PasteToChatResponse>
>('injectImageAndPromptIntoActiveChat');
const probe = loadPageFunction<(runToken?: string) => ChatProbeResponse>('probeChatGenerationState');
const extract = loadPageFunction<
  (domId: string, srcHint: string, runToken?: string) => Promise<PageExtractAttempt>
>('extractChatImageInTab');

const STAMP_ATTR = 'data-stylelens-preexisting-run';
const PROMPT = 'Create 1 edited image from the attached picture. Replace the main words with "Record".';
const APPLE_SRC = 'https://lh3.googleusercontent.com/gg/old-apple-1024x572';
const RECORD_SRC = 'data:image/png;base64,UkVDT1JEKw==';

/** A decoded, laid-out chat image (jsdom never loads or lays out real pixels). */
function makeLoadedImage(src: string, naturalWidth = 1024, naturalHeight = 572): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: naturalWidth, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: naturalHeight, configurable: true });
  return img;
}

function appendAssistantTurn(img: HTMLElement): HTMLElement {
  const turn = document.createElement('model-response');
  turn.appendChild(img);
  document.querySelector('main')!.appendChild(turn);
  return turn;
}

const originalRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  // Give every element a visible box so "is it rendered / big enough" checks behave like a real tab
  HTMLElement.prototype.getBoundingClientRect = function () {
    const tall = this.tagName === 'MAIN' || this.tagName === 'BODY' || this.tagName === 'HTML';
    const width = 600;
    const height = tall ? 4000 : 120;
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

/** Drops the page-side state the functions keep on `window` (and stops the probe's observer). */
function resetPageState() {
  const w = window as unknown as Record<string, unknown> & {
    __stylelensChatWatch?: { observer: MutationObserver | null };
  };
  w.__stylelensChatWatch?.observer?.disconnect();
  for (const key of Object.keys(w)) {
    if (key.startsWith('__stylelens')) delete w[key];
  }
}

afterAll(() => {
  resetPageState();
  HTMLElement.prototype.getBoundingClientRect = originalRect;
});

beforeEach(() => {
  resetPageState();
  document.body.innerHTML =
    '<main></main><div class="composer-shell"><textarea id="prompt-textarea"></textarea></div>';
});

describe('Paste-time pre-existing visual stamp (old chat images can never be the new reply)', () => {
  it('stamps every existing <img>/<canvas> (incl. open ShadowRoots) at paste time and returns a unique runToken', async () => {
    const oldApple = makeLoadedImage(APPLE_SRC);
    appendAssistantTurn(oldApple);
    const oldCanvas = document.createElement('canvas');
    appendAssistantTurn(oldCanvas);
    const shadowHost = document.createElement('div');
    document.querySelector('main')!.appendChild(shadowHost);
    const shadowImg = makeLoadedImage('https://example.com/in-shadow.png');
    shadowHost.attachShadow({ mode: 'open' }).appendChild(shadowImg);

    const first = await inject('', PROMPT);
    expect(first.ok).toBe(true);
    expect(first.insertedPrompt).toBe(true);
    expect(first.runToken).toMatch(/^sl-run-\d+-/);
    expect(oldApple.getAttribute(STAMP_ATTR)).toBe(first.runToken);
    expect(oldCanvas.getAttribute(STAMP_ATTR)).toBe(first.runToken);
    expect(shadowImg.getAttribute(STAMP_ATTR)).toBe(first.runToken);

    // A later paste re-stamps everything with a fresh, different token
    const second = await inject('', PROMPT);
    expect(second.runToken).not.toBe(first.runToken);
    expect(oldApple.getAttribute(STAMP_ATTR)).toBe(second.runToken);
  });

  it('probe ignores the old "Apple" image and reports ONLY the image mounted after the paste', async () => {
    const oldApple = makeLoadedImage(APPLE_SRC);
    appendAssistantTurn(oldApple);

    // Without a token the probe still sees whatever is in the thread (legacy behavior)
    expect(probe().assistantImages?.map((i) => i.src)).toEqual([APPLE_SRC]);

    const pasted = await inject('', PROMPT);
    const runToken = pasted.runToken!;

    // The exact moment of the original bug: right after Send, "Record+" does not exist yet.
    expect(probe(runToken).assistantImages).toEqual([]);

    // Gemini finishes drawing "Record+"
    appendAssistantTurn(makeLoadedImage(RECORD_SRC));
    const after = probe(runToken).assistantImages ?? [];
    expect(after).toHaveLength(1);
    expect(after[0]!.src).toBe(RECORD_SRC);
    expect(after[0]!.confirmedAssistant).toBe(true);
  });

  it('keeps ignoring an old image whose src refreshes in place or that is re-mounted as a new element', async () => {
    const oldApple = makeLoadedImage(APPLE_SRC);
    const oldTurn = appendAssistantTurn(oldApple);
    const runToken = (await inject('', PROMPT)).runToken!;

    // 1. The old element swaps to a refreshed URL (stamp stays on the element)
    oldApple.src = 'https://lh3.googleusercontent.com/gg/old-apple-refreshed';
    expect(probe(runToken).assistantImages).toEqual([]);

    // 2. The framework re-mounts the old picture as a brand-new, unstamped <img> with its old URL
    oldTurn.appendChild(makeLoadedImage(APPLE_SRC));
    expect(probe(runToken).assistantImages).toEqual([]);
  });

  it('extraction with a runToken never returns a pre-existing image, even via a stale domId, a stale src hint, or the "newest image" fallback', async () => {
    const oldApple = makeLoadedImage(APPLE_SRC);
    appendAssistantTurn(oldApple);
    const staleDomId = probe().assistantImages![0]!.domId; // old image already has an `sl-img-N` id
    const runToken = (await inject('', PROMPT)).runToken!;

    // No new image yet: every lookup path must come back empty instead of handing over "Apple"
    expect((await extract(staleDomId, APPLE_SRC, runToken)).status).toBe('not-found');
    expect((await extract('', APPLE_SRC, runToken)).status).toBe('not-found');
    expect((await extract('', '', runToken)).status).toBe('not-found');

    // New image arrives: the same stale hints now resolve to the NEW picture only
    appendAssistantTurn(makeLoadedImage(RECORD_SRC));
    const viaStaleHints = await extract(staleDomId, APPLE_SRC, runToken);
    expect(viaStaleHints.status).toBe('extracted');
    expect(viaStaleHints.dataUrl).toBe(RECORD_SRC);
    const viaFallback = await extract('', '', runToken);
    expect(viaFallback.dataUrl).toBe(RECORD_SRC);
  });

  it('without a runToken ("Separate image already in chat") extraction still reaches existing images', async () => {
    appendAssistantTurn(makeLoadedImage(RECORD_SRC));
    await inject('', PROMPT);
    const existing = await extract('', '');
    expect(existing.status).toBe('extracted');
    expect(existing.dataUrl).toBe(RECORD_SRC);
  });
});

describe('runThreeImageSequence threads the paste runToken into every probe and into extraction', () => {
  it('waits for the real new image instead of finishing on an old thread image at ~3.5s', async () => {
    const RUN_TOKEN = 'sl-run-1795372400146-abc123';
    const oldApple: AssistantImageDescriptor = {
      domId: 'sl-img-2',
      key: APPLE_SRC,
      src: APPLE_SRC,
      kind: 'img',
      naturalWidth: 1024,
      naturalHeight: 572,
      renderedWidth: 600,
      renderedHeight: 335,
      confirmedAssistant: true,
    };
    const newRecord: AssistantImageDescriptor = {
      ...oldApple,
      domId: 'sl-img-3',
      key: RECORD_SRC,
      src: RECORD_SRC,
    };

    let clock = 0;
    let sentAt = -1;
    const probeTokens: Array<string | undefined> = [];
    const detected: Array<{ src?: string; runToken?: string; at: number }> = [];

    const outcome = await runThreeImageSequence(
      [{ prompt: PROMPT } as never],
      {
        paste: async () => ({
          ok: true,
          insertedImage: true,
          insertedPrompt: true,
          tabId: 7,
          runToken: RUN_TOKEN,
        }),
        submit: async () => {
          sentAt = clock;
          return { ok: true, method: 'button' };
        },
        // Models the page: the baseline probe is taken BEFORE the old image is visible to it
        // (the original bug), so only the stamp can keep "Apple" out; "Record+" lands at 12s.
        probe: async (_tabId, runToken) => {
          probeTokens.push(runToken);
          const sinceSend = sentAt < 0 ? -1 : clock - sentAt;
          const images: AssistantImageDescriptor[] = [];
          if (sinceSend >= 0 && runToken !== RUN_TOKEN) images.push(oldApple);
          if (sinceSend >= 12000) images.push(newRecord);
          return {
            ok: true,
            generating: sinceSend >= 0 && sinceSend < 12000,
            quietMs: sinceSend >= 12000 ? sinceSend - 12000 : 0,
            composerEmpty: sinceSend >= 0,
            largeImageCount: images.length,
            assistantImages: images,
          };
        },
        onStepImageDetected: (_i, image, _tabId, runToken) => {
          detected.push({ src: image?.src, runToken, at: clock - sentAt });
        },
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
        isCancelled: () => false,
        onProgress: () => {},
      },
      DEFAULT_RUN_TIMING
    );

    expect(outcome).toEqual({ status: 'complete', imagesProduced: 1 });
    expect(probeTokens.length).toBeGreaterThan(3);
    expect(probeTokens.every((t) => t === RUN_TOKEN)).toBe(true);
    expect(detected).toHaveLength(1);
    expect(detected[0]!.src).toBe(RECORD_SRC);
    expect(detected[0]!.runToken).toBe(RUN_TOKEN);
    expect(detected[0]!.at).toBeGreaterThanOrEqual(12000);
  });
});

describe('AI refusal detection (a "can\'t do that" reply ends the wait in seconds, not ~50 s)', () => {
  const REFUSAL =
    "Normally I can help with things like this, but I don't seem to have access to that content. You can try again or ask me for something else.";

  it('probe reports a short refusal reply and counts assistant replies; a normal reply is not flagged', () => {
    const main = document.querySelector('main')!;
    const ok = document.createElement('model-response');
    ok.textContent = 'Here is the edited image with the requested text replacement.';
    main.appendChild(ok);
    let state = probe();
    expect(state.assistantReplyCount).toBe(1);
    expect(state.refusalHint).toBe(false);

    const refused = document.createElement('model-response');
    refused.textContent = REFUSAL;
    main.appendChild(refused);
    state = probe();
    expect(state.assistantReplyCount).toBe(2);
    expect(state.refusalHint).toBe(true);
  });

  it('the run stops early on a NEW refusal and tells the UI, but ignores an old refusal already in the thread', async () => {
    const runOnce = async (replyCountAfterSend: number) => {
      let clock = 0;
      let sentAt = -1;
      const declined: number[] = [];
      const outcome = await runThreeImageSequence(
        [{ prompt: PROMPT } as never],
        {
          paste: async () => ({ ok: true, insertedImage: true, insertedPrompt: true, tabId: 7 }),
          submit: async () => {
            sentAt = clock;
            return { ok: true, method: 'button' };
          },
          // The thread already holds 1 reply (itself an old refusal) before this send
          probe: async () => {
            const sinceSend = sentAt < 0 ? -1 : clock - sentAt;
            return {
              ok: true,
              generating: false,
              quietMs: sinceSend < 0 ? 5000 : Math.max(0, sinceSend - 2000),
              composerEmpty: sinceSend >= 0,
              largeImageCount: 0,
              assistantImages: [],
              assistantReplyCount: sinceSend >= 2000 ? replyCountAfterSend : 1,
              refusalHint: true,
            };
          },
          onAiDeclined: (i) => declined.push(i),
          sleep: async (ms) => {
            clock += ms;
          },
          now: () => clock,
          isCancelled: () => false,
          onProgress: () => {},
        },
        DEFAULT_RUN_TIMING
      );
      return { outcome, declined, waitedMs: clock - sentAt };
    };

    // A new reply appeared (count 1 -> 2) and it is a refusal: stop within seconds
    const fresh = await runOnce(2);
    expect(fresh.declined).toEqual([0]);
    expect(fresh.outcome).toEqual({ status: 'partial', imagesProduced: 0, totalSteps: 1 });
    expect(fresh.waitedMs).toBeLessThan(10000);

    // No new reply yet (count stays 1): the old refusal must not end the run early
    const stale = await runOnce(1);
    expect(stale.declined).toEqual([]);
    expect(stale.waitedMs).toBeGreaterThanOrEqual(DEFAULT_RUN_TIMING.minReplyMsNoStopSeen);
  });
});