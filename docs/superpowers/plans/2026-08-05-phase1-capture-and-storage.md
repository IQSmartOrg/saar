# Saar Phase 1 — Capture & Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension that auto-detects a Google Meet call, sends a dedicated notetaker account into it in a muted background tab, scrapes live captions into speaker-attributed segments, persists them to IndexedDB, and lets the user read, export, and delete transcripts.

**Architecture:** Ports and adapters. `src/core/**` is pure TypeScript with no `chrome.*` and no DOM — domain types, ports, and the batching/export logic. `src/adapters/meet/**` is DOM-only (no `chrome.*`) so it lifts unchanged into a headless Puppeteer bot later. `src/entrypoints/**` is the only place `chrome.*` appears broadly; the background service worker is the sole composition root. Both boundaries are lint-enforced, not conventions.

**Tech Stack:** WXT (MV3 framework), TypeScript, Vitest, fake-indexeddb, happy-dom, ESLint + typescript-eslint, dependency-cruiser.

**Explicitly NOT in this phase:** `LlmClient`, `Summarizer`, `MeetingMinutes`, provider settings, the Ollama layer, and the `saveMinutes`/`getMinutes` repository methods. Phase 1 ends with a durable, readable, exportable transcript.

## Global Constraints

- **Node 24.19.0.** WXT 0.21.3 declares `engines.node >= 22`; the machine's shell default is still v20.18.0. Every `npm`/`npx` command must run under Node 24. New shells do **not** pick this up automatically — prefix with `. "$HOME/.nvm/nvm.sh" && nvm use` (the repo `.nvmrc` supplies the version).
- **TypeScript pinned to `5.9.3`.** Do **not** install TypeScript 7. `typescript-eslint@8.66.0` declares `typescript: ">=4.8.4 <6.1.0"`, and typescript-eslint is what enforces the `adapters/meet` chrome-free rule. TS 7 breaks the lint stack.
- Exact versions: `wxt@0.21.3`, `vitest@4.1.10`, `typescript@5.9.3`, `eslint@10.8.0`, `typescript-eslint@8.66.0`, `dependency-cruiser@18.1.1`, `fake-indexeddb@6.2.5`, `happy-dom@20.11.1`.
- **TypeScript `strict: true`** in `tsconfig.json`. No `any` in `src/core/**`.
- **Layer rule 1:** `src/core/**` may not import from `src/adapters/**` or `src/entrypoints/**`.
- **Layer rule 2:** `src/adapters/meet/**` may not reference the `chrome` global.
- **Brand:** teal `#1A414E`, mint `#D9EFEA`. Icons already exist at `assets/icon-{16,32,48,128}.png`.
- **Commit messages must NOT contain a `Co-Authored-By` trailer.**
- **Spec deviation to apply:** the spec's §5.1 shows `src/extension/`. WXT requires entrypoints in `src/entrypoints/`. Use `src/entrypoints/`; everything else in §5.1 stands.
- **Spec deviation to apply:** `TranscriptRepository` in §6 lists `saveMinutes`/`getMinutes`. Omit both in Phase 1 — they arrive with the summarizer. Keep the full `SessionStatus` union from §6 (including `'summarizing'`/`'complete'`) even though Phase 1 never emits them, so the persisted enum needs no migration later.
- **Spec deviation to apply:** §4.1 describes reading the Google accounts chooser page to discover the notetaker's `authuser` index automatically, then dry-run validating it. Phase 1 ships **manual index entry** in the popup instead (Task 16). Auto-discovery and re-validation are deferred — the failure mode is a bot joining as the wrong identity, which the user will notice immediately in the participant list.
- **Spec deviation to apply:** §13 says an un-admitted bot should keep polling until the meeting ends. Phase 1 gives up after the 3-minute lobby timeout and marks the session `failed` (Task 14). Simpler, and an un-admitted bot after 3 minutes almost always means nobody is going to admit it.
- **Spec deviation to apply:** §7.2 says the meeting title is editable in the detail UI. Phase 1 captures the title at join time but does not offer editing.

---

### Task 0: Validate assumptions A1/A2/A3 and capture caption DOM fixtures

**This task gates Task 6.** `MeetCaptionScraper` cannot be written correctly without real caption DOM, and if A1 is false the entire bot-tab capture model is dead. No code depends on anything here until it is done.

**Files:**
- Create: `docs/superpowers/notes/meet-dom-findings.md`
- Create: `tests/fixtures/meet/captions-initial.html`
- Create: `tests/fixtures/meet/captions-revised.html`
- Create: `tests/fixtures/meet/captions-rolled.html`

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/superpowers/notes/meet-dom-findings.md`, containing the four confirmed CSS selector strings that Task 6 copies verbatim into `MEET_SELECTORS`, plus PASS/FAIL verdicts for A1, A2, A3. Three HTML fixtures used by Task 6's tests.

- [ ] **Step 1: Start a Meet call and turn captions on**

Open `https://meet.google.com/new` in Chrome. Click the **CC** (captions) button in the bottom bar. Speak a few sentences so at least two caption blocks appear. If you can get a second person in the call, do — you need at least two distinct speaker names for the fixtures.

- [ ] **Step 2: Identify the caption container and record the selectors**

In DevTools, right-click a caption line → Inspect. Walk up the DOM until you find the element that contains *all* caption blocks. Run this in the console to test selector candidates:

```js
// Try each; the winner is the one that returns exactly one stable element
document.querySelectorAll('[aria-live="polite"]')
document.querySelectorAll('div[role="region"][aria-label*="aption" i]')
document.querySelectorAll('[jsname][aria-live]')
```

Record four selectors in `docs/superpowers/notes/meet-dom-findings.md`:

```markdown
# Meet DOM findings — captured YYYY-MM-DD, Chrome <version>

## Selectors (copy verbatim into src/adapters/meet/selectors.ts)

- captionRegion: `<selector>`   # container holding all blocks
- captionBlock:  `<selector>`   # one per speaker turn, relative to region
- blockSpeaker:  `<selector>`   # speaker name, relative to block
- blockText:     `<selector>`   # utterance text, relative to block

## Assumption verdicts
- A1 backgrounded tab keeps mutating: PASS | FAIL
- A2 muted tab still receives captions: PASS | FAIL
- A3 ?authuser=N joins as Nth account:  PASS | FAIL
```

Prefer `aria-*`, `role`, and `jsname` attributes over obfuscated class names like `.a4cQT` — class names rotate, these are more stable.

- [ ] **Step 3: Capture the three fixtures**

With captions running, run this once per fixture state, pasting the clipboard into the matching file:

```js
// replace REGION with your captionRegion selector
copy(document.querySelector('REGION').outerHTML)
```

- `captions-initial.html` — capture while someone is mid-sentence (an unfinished block).
- `captions-revised.html` — capture the *same* block a second later, after Meet has rewritten it longer. This is the in-place-rewrite behaviour from spec §8.
- `captions-rolled.html` — capture after enough speech that the first block has scrolled out of the rolling window.

- [ ] **Step 4: Test A1 — does a backgrounded tab keep mutating?**

Paste into the Meet tab's console, then switch to a different tab/window and leave it for 10 minutes with people talking:

```js
(() => {
  const root = document.querySelector('REGION');           // your captionRegion
  let n = 0; const t0 = Date.now(); const log = [];
  const obs = new MutationObserver(m => {
    n += m.length;
    const t = Math.round((Date.now() - t0) / 1000);
    if (!log.length || t - log[log.length - 1].t >= 30) {
      log.push({ t, n });
      console.log(`[saar] t=${t}s mutations=${n}`);
    }
  });
  obs.observe(root, { childList: true, subtree: true, characterData: true });
  window.__saarStop = () => { obs.disconnect(); console.table(log); };
  console.log('[saar] observing', root);
})();
```

Return to the tab, run `__saarStop()`. **PASS** if the mutation count kept climbing across the whole 10 minutes. **FAIL** if it flatlined while backgrounded.

> **If A1 FAILS: stop and report.** The bot-tab model is not viable. The fallback is scraping the user's own foreground tab with the caption overlay hidden via injected CSS — same scraper, different host. That changes Tasks 11–14 and needs a spec amendment before continuing.

- [ ] **Step 5: Test A2 — does muting the tab break captions?**

Right-click the Meet tab → **Mute site**. Confirm captions keep appearing in the DOM. **PASS** if they do. (They should: captions arrive from Google's servers as text and have nothing to do with local audio playback.)

- [ ] **Step 6: Test A3 — does `?authuser=N` pick the right account?**

Sign a second Google account into the same Chrome profile. Open `https://meet.google.com/<code>?authuser=1`. Confirm the pre-join screen shows the *second* account's name/avatar. Record which index maps to which account.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/notes/meet-dom-findings.md tests/fixtures/meet/
git commit -m "test: capture Meet caption DOM fixtures and assumption verdicts"
```

---

### Task 1: Project scaffold

**Files:**
- Create: `.nvmrc`, `package.json`, `tsconfig.json`, `wxt.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.dependency-cruiser.cjs`, `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run check` (typecheck + lint + deps + test), `npm run dev`, `npm run build`. All later tasks assume `npm test` runs Vitest and `npm run check` gates commits.

- [ ] **Step 1: Pin Node and scaffold package.json**

```bash
cd /Users/parag/melsta/saar
echo "24.19.0" > .nvmrc
. "$HOME/.nvm/nvm.sh" && nvm use
node --version   # must print v24.19.0
```

Create `package.json`:

```json
{
  "name": "saar",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "postinstall": "wxt prepare",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "deps": "depcruise src --config .dependency-cruiser.cjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "npm run typecheck && npm run lint && npm run deps && npm test"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.287",
    "dependency-cruiser": "18.1.1",
    "eslint": "10.8.0",
    "fake-indexeddb": "6.2.5",
    "happy-dom": "20.11.1",
    "typescript": "5.9.3",
    "typescript-eslint": "8.66.0",
    "vitest": "4.1.10",
    "wxt": "0.21.3"
  }
}
```

- [ ] **Step 2: Install**

```bash
. "$HOME/.nvm/nvm.sh" && nvm use && npm install
```

Expected: installs cleanly. If npm reports an `EBADENGINE` warning for wxt, Node is wrong — re-run `nvm use`.

- [ ] **Step 3: Create the config files**

`tsconfig.json`:

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "types": ["chrome", "vitest/globals"]
  },
  "include": ["src", "tests", "*.config.ts", "*.config.js"]
}
```

`wxt.config.ts`:

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Saar',
    description: 'AI note-taking for your meetings.',
    version: '0.1.0',
    permissions: ['tabs', 'storage', 'notifications', 'scripting'],
    host_permissions: ['https://meet.google.com/*'],
    icons: {
      16: '/icon-16.png',
      32: '/icon-32.png',
      48: '/icon-48.png',
      128: '/icon-128.png',
    },
  },
  publicDir: '../assets',
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    // Default to node. Tests needing a DOM opt in per file with
    // `// @vitest-environment happy-dom` on the first line.
    // (Vitest 4 removed `environmentMatchGlobs` — do not try to use it.)
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
```

`eslint.config.js` — this file is what enforces layer rule 2:

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.wxt/**', '.output/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/adapters/meet/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'adapters/meet must stay chrome-free so it ports to Puppeteer. See spec §5.' },
      ],
    },
  },
);
```

`.dependency-cruiser.cjs` — this file is what enforces layer rule 1:

```js
module.exports = {
  forbidden: [
    {
      name: 'core-stays-pure',
      severity: 'error',
      comment: 'core/** must not depend on adapters or entrypoints (spec §5)',
      from: { path: '^src/core' },
      to: { path: '^src/(adapters|entrypoints)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
```

`.gitignore`:

```
node_modules/
.wxt/
.output/
*.zip
.DS_Store
```

- [ ] **Step 4: Verify the toolchain runs**

```bash
. "$HOME/.nvm/nvm.sh" && nvm use && npm run typecheck && npm run lint && npm run deps
```

Expected: all three pass with no files yet to check. `npm test` will report "no test files found" — that is fine at this point.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold WXT + TypeScript + Vitest with layer lint rules"
```

---

### Task 2: Core domain types

**Files:**
- Create: `src/core/types/transcript.ts`
- Create: `src/core/types/session.ts`
- Test: `tests/core/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TranscriptSourceKind`, `TranscriptSegment`, `SessionStatus`, `MeetingSession`, `newSessionId()`. Every later task imports these.

- [ ] **Step 1: Write the failing test**

`tests/core/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { newSessionId } from '@/core/types/session';

describe('newSessionId', () => {
  it('returns a distinct uuid each call', () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `. "$HOME/.nvm/nvm.sh" && nvm use && npx vitest run tests/core/types.test.ts`
Expected: FAIL — cannot resolve `@/core/types/session`.

- [ ] **Step 3: Write the implementation**

`src/core/types/transcript.ts`:

```ts
export type TranscriptSourceKind =
  | 'meet-captions'
  | 'teams-captions'
  | 'audio-whisper';

export interface TranscriptSegment {
  readonly id: string;
  readonly final: boolean;
  readonly speaker: string | null;
  readonly text: string;
  readonly tStart: number;
  readonly tEnd: number;
  readonly source: TranscriptSourceKind;
  readonly confidence?: number;
}
```

`src/core/types/session.ts`:

```ts
export type SessionStatus =
  | 'joining'
  | 'in-lobby'
  | 'capturing'
  | 'ended'
  | 'summarizing'
  | 'complete'
  | 'failed';

export interface MeetingSession {
  readonly id: string;
  readonly platform: 'google-meet';
  readonly meetingCode: string;
  readonly title: string | null;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly participants: readonly string[];
  readonly status: SessionStatus;
  readonly error?: string;
}

export function newSessionId(): string {
  return crypto.randomUUID();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/types tests/core/types.test.ts
git commit -m "feat: add core transcript and session domain types"
```

---

### Task 3: Core ports

**Files:**
- Create: `src/core/ports/TranscriptSource.ts`, `src/core/ports/MeetingBot.ts`, `src/core/ports/TranscriptRepository.ts`, `src/core/ports/SettingsStore.ts`, `src/core/ports/Clock.ts`, `src/core/ports/Scheduler.ts`

**Interfaces:**
- Consumes: `TranscriptSegment`, `MeetingSession`, `TranscriptSourceKind` (Task 2).
- Produces: `TranscriptSource`, `SegmentSink`, `SourceHealth`, `MeetingBot`, `JoinRequest`, `JoinResult`, `EndReason`, `Unsubscribe`, `TranscriptRepository`, `SettingsStore`, `Settings`, `DEFAULT_SETTINGS`, `Clock`, `SystemClock`, `Scheduler`, `SystemScheduler`.

These are type-only declarations plus two trivial implementations; there is no behaviour to test until Task 4 consumes them.

- [ ] **Step 1: Write the port files**

`src/core/ports/Clock.ts`:

```ts
export interface Clock {
  now(): number;
}

export const SystemClock: Clock = { now: () => Date.now() };
```

`src/core/ports/Scheduler.ts`:

```ts
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export const SystemScheduler: Scheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (h) => globalThis.clearTimeout(h),
};
```

`src/core/ports/TranscriptSource.ts`:

```ts
import type { TranscriptSegment, TranscriptSourceKind } from '@/core/types/transcript';

export interface SegmentSink {
  upsert(segment: TranscriptSegment): void;
}

export interface SourceHealth {
  readonly ok: boolean;
  readonly selectorsMatched: boolean;
  readonly segmentsSeen: number;
  readonly lastSegmentAt: number | null;
  readonly detail?: string;
}

export interface TranscriptSource {
  readonly kind: TranscriptSourceKind;
  start(sink: SegmentSink): Promise<void>;
  stop(): Promise<void>;
  health(): SourceHealth;
}
```

`src/core/ports/MeetingBot.ts`:

```ts
export type Unsubscribe = () => void;

export type EndReason =
  | 'user-left'
  | 'bot-removed'
  | 'meeting-ended'
  | 'tab-closed'
  | 'lobby-timeout'
  | 'error';

export interface JoinRequest {
  readonly sessionId: string;
  readonly meetingCode: string;
  readonly accountIndex: number;
  readonly displayNameHint?: string;
}

export interface JoinResult {
  readonly ok: boolean;
  readonly tabId?: number;
  readonly error?: string;
}

export interface MeetingBot {
  join(req: JoinRequest): Promise<JoinResult>;
  leave(): Promise<void>;
  onEnded(cb: (reason: EndReason) => void): Unsubscribe;
}
```

`src/core/ports/TranscriptRepository.ts`:

```ts
import type { MeetingSession } from '@/core/types/session';
import type { TranscriptSegment } from '@/core/types/transcript';

export interface TranscriptRepository {
  createSession(session: MeetingSession): Promise<void>;
  updateSession(id: string, patch: Partial<MeetingSession>): Promise<void>;
  getSession(id: string): Promise<MeetingSession | null>;
  listSessions(): Promise<readonly MeetingSession[]>;
  deleteSession(id: string): Promise<void>;
  appendSegments(id: string, segments: readonly TranscriptSegment[]): Promise<void>;
  getSegments(id: string): Promise<readonly TranscriptSegment[]>;
}
```

`src/core/ports/SettingsStore.ts`:

```ts
import type { Unsubscribe } from '@/core/ports/MeetingBot';

export interface Settings {
  readonly botAccountIndex: number | null;
  readonly autoJoin: boolean;
  readonly toastDelayMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  botAccountIndex: null,
  autoJoin: true,
  toastDelayMs: 5000,
};

export interface SettingsStore {
  get(): Promise<Settings>;
  set(patch: Partial<Settings>): Promise<void>;
  onChange(cb: (s: Settings) => void): Unsubscribe;
}
```

- [ ] **Step 2: Verify it compiles and the layer rules hold**

Run: `. "$HOME/.nvm/nvm.sh" && nvm use && npm run typecheck && npm run deps`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add src/core/ports
git commit -m "feat: add core ports for source, bot, repository, settings"
```

---

### Task 4: SegmentBatcher

Meet rewrites a caption block many times per second. Writing one IndexedDB row per mutation would be dozens of transactions per utterance. The batcher collapses repeated upserts of the same segment id and flushes on whichever comes first: 20 distinct segments or 2 seconds.

**Files:**
- Create: `src/core/capture/SegmentBatcher.ts`
- Test: `tests/core/SegmentBatcher.test.ts`

**Interfaces:**
- Consumes: `SegmentSink` (Task 3), `TranscriptSegment` (Task 2), `Scheduler` (Task 3).
- Produces: `class SegmentBatcher implements SegmentSink` with constructor `(flush: (segs: TranscriptSegment[]) => void, opts: BatcherOptions, scheduler: Scheduler)`, methods `upsert(seg)`, `flushNow()`, `dispose()`, and `DEFAULT_BATCHER_OPTIONS`.

- [ ] **Step 1: Write the failing test**

`tests/core/SegmentBatcher.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SegmentBatcher } from '@/core/capture/SegmentBatcher';
import type { Scheduler } from '@/core/ports/Scheduler';
import type { TranscriptSegment } from '@/core/types/transcript';

function seg(id: string, text: string, final = false): TranscriptSegment {
  return { id, final, speaker: 'Priya Nair', text, tStart: 0, tEnd: 1, source: 'meet-captions' };
}

function fakeScheduler() {
  const pending = new Map<number, () => void>();
  let next = 1;
  const s: Scheduler = {
    setTimeout: (fn) => { const h = next++; pending.set(h, fn); return h; },
    clearTimeout: (h) => { pending.delete(h); },
  };
  return { scheduler: s, fireAll: () => { const fns = [...pending.values()]; pending.clear(); fns.forEach(f => f()); }, size: () => pending.size };
}

describe('SegmentBatcher', () => {
  it('collapses repeated upserts of the same id into one flushed segment', () => {
    const flush = vi.fn();
    const { scheduler, fireAll } = fakeScheduler();
    const b = new SegmentBatcher(flush, { maxSegments: 20, maxDelayMs: 2000 }, scheduler);

    b.upsert(seg('a', 'I think'));
    b.upsert(seg('a', 'I think we should'));
    b.upsert(seg('a', 'I think we should ship', true));
    fireAll();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]![0]).toEqual([seg('a', 'I think we should ship', true)]);
  });

  it('flushes immediately once maxSegments distinct ids are buffered', () => {
    const flush = vi.fn();
    const { scheduler } = fakeScheduler();
    const b = new SegmentBatcher(flush, { maxSegments: 3, maxDelayMs: 2000 }, scheduler);

    b.upsert(seg('a', 'one'));
    b.upsert(seg('b', 'two'));
    expect(flush).not.toHaveBeenCalled();
    b.upsert(seg('c', 'three'));

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]![0]).toHaveLength(3);
  });

  it('preserves first-seen order across flushes', () => {
    const flush = vi.fn();
    const { scheduler, fireAll } = fakeScheduler();
    const b = new SegmentBatcher(flush, { maxSegments: 20, maxDelayMs: 2000 }, scheduler);

    b.upsert(seg('b', 'second'));
    b.upsert(seg('a', 'first'));
    b.upsert(seg('b', 'second revised'));
    fireAll();

    expect(flush.mock.calls[0]![0].map((s: TranscriptSegment) => s.id)).toEqual(['b', 'a']);
  });

  it('does nothing on flush when the buffer is empty', () => {
    const flush = vi.fn();
    const { scheduler, fireAll } = fakeScheduler();
    new SegmentBatcher(flush, { maxSegments: 20, maxDelayMs: 2000 }, scheduler);
    fireAll();
    expect(flush).not.toHaveBeenCalled();
  });

  it('dispose flushes what is buffered and cancels the timer', () => {
    const flush = vi.fn();
    const { scheduler, size } = fakeScheduler();
    const b = new SegmentBatcher(flush, { maxSegments: 20, maxDelayMs: 2000 }, scheduler);

    b.upsert(seg('a', 'partial'));
    b.dispose();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(size()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/SegmentBatcher.test.ts`
Expected: FAIL — cannot resolve `@/core/capture/SegmentBatcher`.

- [ ] **Step 3: Write the implementation**

`src/core/capture/SegmentBatcher.ts`:

```ts
import type { SegmentSink } from '@/core/ports/TranscriptSource';
import type { Scheduler } from '@/core/ports/Scheduler';
import type { TranscriptSegment } from '@/core/types/transcript';

export interface BatcherOptions {
  readonly maxSegments: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_BATCHER_OPTIONS: BatcherOptions = {
  maxSegments: 20,
  maxDelayMs: 2000,
};

export class SegmentBatcher implements SegmentSink {
  // Map preserves first-insertion order, which is the order we flush in.
  private buffer = new Map<string, TranscriptSegment>();
  private timer: number | null = null;

  constructor(
    private readonly flush: (segments: TranscriptSegment[]) => void,
    private readonly opts: BatcherOptions,
    private readonly scheduler: Scheduler,
  ) {}

  upsert(segment: TranscriptSegment): void {
    this.buffer.set(segment.id, segment);

    if (this.buffer.size >= this.opts.maxSegments) {
      this.flushNow();
      return;
    }
    if (this.timer === null) {
      this.timer = this.scheduler.setTimeout(() => {
        this.timer = null;
        this.flushNow();
      }, this.opts.maxDelayMs);
    }
  }

  flushNow(): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.size === 0) return;
    const batch = [...this.buffer.values()];
    this.buffer.clear();
    this.flush(batch);
  }

  dispose(): void {
    this.flushNow();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/SegmentBatcher.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/capture tests/core/SegmentBatcher.test.ts
git commit -m "feat: add SegmentBatcher collapsing caption rewrites into batched writes"
```

---

### Task 5: Markdown export

**Files:**
- Create: `src/core/export/toMarkdown.ts`
- Test: `tests/core/toMarkdown.test.ts`

**Interfaces:**
- Consumes: `MeetingSession` (Task 2), `TranscriptSegment` (Task 2).
- Produces: `transcriptToMarkdown(session: MeetingSession, segments: readonly TranscriptSegment[]): string`, `formatTimestamp(seconds: number): string`.

- [ ] **Step 1: Write the failing test**

`tests/core/toMarkdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { transcriptToMarkdown, formatTimestamp } from '@/core/export/toMarkdown';
import type { MeetingSession } from '@/core/types/session';
import type { TranscriptSegment } from '@/core/types/transcript';

const session: MeetingSession = {
  id: 's1',
  platform: 'google-meet',
  meetingCode: 'abc-defg-hij',
  title: 'Weekly Sync',
  startedAt: Date.UTC(2026, 7, 5, 9, 30),
  endedAt: Date.UTC(2026, 7, 5, 10, 0),
  participants: ['Priya Nair', 'Rahul Shah'],
  status: 'ended',
};

function seg(p: Partial<TranscriptSegment>): TranscriptSegment {
  return { id: 'x', final: true, speaker: 'Priya Nair', text: 'hello', tStart: 0, tEnd: 2, source: 'meet-captions', ...p };
}

describe('formatTimestamp', () => {
  it('formats seconds as mm:ss', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(75)).toBe('01:15');
  });
  it('formats past an hour as hh:mm:ss', () => {
    expect(formatTimestamp(3725)).toBe('01:02:05');
  });
});

describe('transcriptToMarkdown', () => {
  it('renders a title, metadata, and speaker-prefixed lines', () => {
    const md = transcriptToMarkdown(session, [
      seg({ id: 'a', speaker: 'Priya Nair', text: 'Shall we start?', tStart: 5 }),
      seg({ id: 'b', speaker: 'Rahul Shah', text: 'Yes.', tStart: 9 }),
    ]);
    expect(md).toContain('# Weekly Sync');
    expect(md).toContain('abc-defg-hij');
    expect(md).toContain('Priya Nair, Rahul Shah');
    expect(md).toContain('**Priya Nair** [00:05] Shall we start?');
    expect(md).toContain('**Rahul Shah** [00:09] Yes.');
  });

  it('falls back to the meeting code when there is no title', () => {
    expect(transcriptToMarkdown({ ...session, title: null }, [])).toContain('# abc-defg-hij');
  });

  it('labels unattributed segments', () => {
    const md = transcriptToMarkdown(session, [seg({ speaker: null, text: 'inaudible', tStart: 3 })]);
    expect(md).toContain('**Unknown** [00:03] inaudible');
  });

  it('skips non-final segments so partial captions never reach the export', () => {
    const md = transcriptToMarkdown(session, [
      seg({ id: 'a', text: 'complete thought', final: true }),
      seg({ id: 'b', text: 'half a thou', final: false }),
    ]);
    expect(md).toContain('complete thought');
    expect(md).not.toContain('half a thou');
  });

  it('states plainly when there is no transcript', () => {
    expect(transcriptToMarkdown(session, [])).toContain('_No transcript captured._');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/toMarkdown.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/export/toMarkdown.ts`:

```ts
import type { MeetingSession } from '@/core/types/session';
import type { TranscriptSegment } from '@/core/types/transcript';

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function durationLine(session: MeetingSession): string {
  if (session.endedAt === null) return '';
  const mins = Math.round((session.endedAt - session.startedAt) / 60000);
  return `- **Duration:** ${mins} min\n`;
}

export function transcriptToMarkdown(
  session: MeetingSession,
  segments: readonly TranscriptSegment[],
): string {
  const heading = session.title ?? session.meetingCode;
  const started = new Date(session.startedAt).toISOString();

  let out = `# ${heading}\n\n`;
  out += `- **Meeting:** ${session.meetingCode}\n`;
  out += `- **Started:** ${started}\n`;
  out += durationLine(session);
  if (session.participants.length > 0) {
    out += `- **Participants:** ${session.participants.join(', ')}\n`;
  }
  out += `\n## Transcript\n\n`;

  const finals = segments.filter((s) => s.final);
  if (finals.length === 0) {
    out += '_No transcript captured._\n';
    return out;
  }

  for (const s of finals) {
    const who = s.speaker ?? 'Unknown';
    out += `**${who}** [${formatTimestamp(s.tStart)}] ${s.text}\n\n`;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/toMarkdown.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/export tests/core/toMarkdown.test.ts
git commit -m "feat: add markdown transcript export"
```

---

### Task 6: MeetCaptionScraper and selectors

**Depends on Task 0.** Use the selector strings and HTML fixtures produced there.

**Files:**
- Create: `src/adapters/meet/selectors.ts`
- Create: `src/adapters/meet/MeetCaptionScraper.ts`
- Test: `tests/adapters/meet/MeetCaptionScraper.test.ts`

**Interfaces:**
- Consumes: `TranscriptSource`, `SegmentSink`, `SourceHealth` (Task 3), `Clock` (Task 3), fixtures + selectors (Task 0).
- Produces: `MEET_SELECTORS: MeetSelectors`, `interface MeetSelectors`, `class MeetCaptionScraper implements TranscriptSource` with constructor `(doc: Document, clock: Clock, selectors?: MeetSelectors)`.

- [ ] **Step 1: Write selectors.ts using the values recorded in Task 0**

Open `docs/superpowers/notes/meet-dom-findings.md` and copy the four confirmed selector strings into this file. The values below are the starting hypothesis from the spec — **replace each one with what Task 0 actually recorded.**

`src/adapters/meet/selectors.ts`:

```ts
export interface MeetSelectors {
  readonly captionRegion: string;
  readonly captionBlock: string;
  readonly blockSpeaker: string;
  readonly blockText: string;
}

// Every Google DOM assumption lives here. When Meet ships a change,
// this is the only file that should need editing.
// Confirmed against Chrome <version> on <date> — see
// docs/superpowers/notes/meet-dom-findings.md
export const MEET_SELECTORS: MeetSelectors = {
  captionRegion: '<from Task 0>',
  captionBlock: '<from Task 0>',
  blockSpeaker: '<from Task 0>',
  blockText: '<from Task 0>',
};
```

- [ ] **Step 2: Write the failing test**

`tests/adapters/meet/MeetCaptionScraper.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { MeetCaptionScraper } from '@/adapters/meet/MeetCaptionScraper';
import { MEET_SELECTORS } from '@/adapters/meet/selectors';
import type { Clock } from '@/core/ports/Clock';
import type { TranscriptSegment } from '@/core/types/transcript';

function fixture(name: string): string {
  return readFileSync(`tests/fixtures/meet/${name}.html`, 'utf8');
}

function collectingSink() {
  const seen: TranscriptSegment[] = [];
  return { sink: { upsert: (s: TranscriptSegment) => seen.push(s) }, seen };
}

let t = 0;
const clock: Clock = { now: () => t };

beforeEach(() => { t = 0; });

describe('MeetCaptionScraper', () => {
  it('reports selectorsMatched=false when the caption region is absent', () => {
    document.body.innerHTML = '<div>no captions here</div>';
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    expect(s.health().selectorsMatched).toBe(false);
    expect(s.health().ok).toBe(false);
  });

  it('emits one segment per caption block with speaker and text', async () => {
    document.body.innerHTML = fixture('captions-initial');
    const { sink, seen } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    await s.start(sink);
    await s.stop();

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]!.speaker).toBeTruthy();
    expect(seen[0]!.text).toBeTruthy();
    expect(seen[0]!.source).toBe('meet-captions');
  });

  it('re-upserts the same id when Meet rewrites a block in place', async () => {
    document.body.innerHTML = fixture('captions-initial');
    const { sink, seen } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    await s.start(sink);

    const firstId = seen[0]!.id;
    const firstText = seen[0]!.text;

    // Simulate Meet lengthening the same block's text node in place.
    const region = document.querySelector(MEET_SELECTORS.captionRegion)!;
    const block = region.querySelector(MEET_SELECTORS.captionBlock)!;
    const textEl = block.querySelector(MEET_SELECTORS.blockText)!;
    textEl.textContent = `${firstText} and then some more`;
    await new Promise((r) => setTimeout(r, 0));

    const revised = seen.filter((x) => x.id === firstId);
    expect(revised.length).toBeGreaterThan(1);
    expect(revised.at(-1)!.text).toContain('and then some more');
    await s.stop();
  });

  it('marks a block final once it leaves the rolling window', async () => {
    document.body.innerHTML = fixture('captions-initial');
    const { sink, seen } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    await s.start(sink);
    const firstId = seen[0]!.id;

    document.body.innerHTML = fixture('captions-rolled');
    await new Promise((r) => setTimeout(r, 0));
    await s.stop();

    const last = seen.filter((x) => x.id === firstId).at(-1)!;
    expect(last.final).toBe(true);
  });

  it('finalises every open block on stop', async () => {
    document.body.innerHTML = fixture('captions-initial');
    const { sink, seen } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    await s.start(sink);
    await s.stop();

    const ids = new Set(seen.map((x) => x.id));
    for (const id of ids) {
      expect(seen.filter((x) => x.id === id).at(-1)!.final).toBe(true);
    }
  });

  it('records tStart from first sighting and tEnd at finalisation', async () => {
    document.body.innerHTML = fixture('captions-initial');
    const { sink, seen } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    t = 10_000;
    await s.start(sink);
    t = 25_000;
    await s.stop();

    const final = seen.at(-1)!;
    expect(final.tStart).toBe(0);
    expect(final.tEnd).toBe(15);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/adapters/meet/MeetCaptionScraper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

`src/adapters/meet/MeetCaptionScraper.ts`:

```ts
import type { Clock } from '@/core/ports/Clock';
import type { SegmentSink, SourceHealth, TranscriptSource } from '@/core/ports/TranscriptSource';
import type { TranscriptSegment, TranscriptSourceKind } from '@/core/types/transcript';
import { MEET_SELECTORS, type MeetSelectors } from '@/adapters/meet/selectors';

interface OpenBlock {
  readonly id: string;
  readonly tStart: number;
  speaker: string | null;
  text: string;
}

let seq = 0;

/**
 * Reads Google Meet's live caption DOM.
 *
 * Meet keeps a rolling window of a few speaker blocks and rewrites a block's
 * text in place as its ASR refines the utterance. We therefore key blocks by
 * DOM node identity (WeakMap), re-emit on every change with final=false, and
 * emit final=true only once a block leaves the window or capture stops.
 *
 * No `chrome.*` here by design — this class must run unchanged under Puppeteer.
 */
export class MeetCaptionScraper implements TranscriptSource {
  readonly kind: TranscriptSourceKind = 'meet-captions';

  private observer: MutationObserver | null = null;
  private sink: SegmentSink | null = null;
  private readonly open = new WeakMap<Element, OpenBlock>();
  private live = new Map<string, { el: Element; block: OpenBlock }>();
  private startedAt = 0;
  private segmentsSeen = 0;
  private lastSegmentAt: number | null = null;
  private matched = false;

  constructor(
    private readonly doc: Document,
    private readonly clock: Clock,
    private readonly selectors: MeetSelectors = MEET_SELECTORS,
  ) {
    this.matched = this.region() !== null;
  }

  private region(): Element | null {
    return this.doc.querySelector(this.selectors.captionRegion);
  }

  async start(sink: SegmentSink): Promise<void> {
    const region = this.region();
    this.matched = region !== null;
    if (!region) return;

    this.sink = sink;
    this.startedAt = this.clock.now();

    this.observer = new MutationObserver(() => this.scan());
    this.observer.observe(region, { childList: true, subtree: true, characterData: true });
    this.scan();
  }

  async stop(): Promise<void> {
    this.observer?.disconnect();
    this.observer = null;
    for (const { block } of this.live.values()) this.emit(block, true);
    this.live.clear();
    this.sink = null;
  }

  health(): SourceHealth {
    return {
      ok: this.matched && this.segmentsSeen > 0,
      selectorsMatched: this.matched,
      segmentsSeen: this.segmentsSeen,
      lastSegmentAt: this.lastSegmentAt,
      detail: this.matched ? undefined : 'caption region not found — check selectors.ts',
    };
  }

  private scan(): void {
    const region = this.region();
    if (!region) return;

    const present = new Map<string, { el: Element; block: OpenBlock }>();

    for (const el of Array.from(region.querySelectorAll(this.selectors.captionBlock))) {
      const speaker = el.querySelector(this.selectors.blockSpeaker)?.textContent?.trim() || null;
      const text = el.querySelector(this.selectors.blockText)?.textContent?.trim() ?? '';
      if (text === '') continue;

      let block = this.open.get(el);
      if (!block) {
        block = { id: `meet-${++seq}`, tStart: this.relNow(), speaker, text };
        this.open.set(el, block);
      }

      const changed = block.text !== text || block.speaker !== speaker;
      block.speaker = speaker;
      block.text = text;
      present.set(block.id, { el, block });

      if (changed || !this.live.has(block.id)) this.emit(block, false);
    }

    // Anything that was live but is no longer in the DOM has scrolled out.
    for (const [id, entry] of this.live) {
      if (!present.has(id)) this.emit(entry.block, true);
    }
    this.live = present;
  }

  private relNow(): number {
    return Math.round((this.clock.now() - this.startedAt) / 1000);
  }

  private emit(block: OpenBlock, final: boolean): void {
    const segment: TranscriptSegment = {
      id: block.id,
      final,
      speaker: block.speaker,
      text: block.text,
      tStart: block.tStart,
      tEnd: this.relNow(),
      source: 'meet-captions',
    };
    this.segmentsSeen += 1;
    this.lastSegmentAt = this.clock.now();
    this.sink?.upsert(segment);
  }
}
```

- [ ] **Step 5: Run tests and reconcile against the real fixtures**

Run: `npx vitest run tests/adapters/meet/MeetCaptionScraper.test.ts`
Expected: PASS, 6 tests.

If a test fails because the fixture's structure differs from the assumed selector relationships (e.g. speaker and text live in the same node rather than separate children), fix `selectors.ts` and the parsing in `scan()` to match the real DOM — the fixture is ground truth, not the code.

- [ ] **Step 6: Verify the chrome-free lint rule actually fires**

```bash
echo "const x = chrome.runtime.id;" >> src/adapters/meet/selectors.ts
npm run lint    # expected: ERROR on no-restricted-globals 'chrome'
git checkout src/adapters/meet/selectors.ts
npm run lint    # expected: clean
```

- [ ] **Step 7: Commit**

```bash
git add src/adapters/meet tests/adapters/meet
git commit -m "feat: add Meet caption scraper with fixture-driven tests"
```

---

### Task 7: IndexedDbTranscriptRepository

**Files:**
- Create: `src/adapters/storage/IndexedDbTranscriptRepository.ts`
- Test: `tests/adapters/storage/IndexedDbTranscriptRepository.test.ts`

**Interfaces:**
- Consumes: `TranscriptRepository` (Task 3), `MeetingSession` (Task 2), `TranscriptSegment` (Task 2).
- Produces: `class IndexedDbTranscriptRepository implements TranscriptRepository`, constructor `(dbName?: string)`, plus `DB_NAME` and `DB_VERSION` constants.

Segments use a compound key `[sessionId, segId]` so `put()` gives upsert semantics for free — re-writing a revised caption block overwrites its row rather than duplicating it.

- [ ] **Step 1: Write the failing test**

`tests/adapters/storage/IndexedDbTranscriptRepository.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDbTranscriptRepository } from '@/adapters/storage/IndexedDbTranscriptRepository';
import type { MeetingSession } from '@/core/types/session';
import type { TranscriptSegment } from '@/core/types/transcript';

function session(id: string, startedAt: number): MeetingSession {
  return {
    id, platform: 'google-meet', meetingCode: 'abc-defg-hij', title: 'Sync',
    startedAt, endedAt: null, participants: [], status: 'capturing',
  };
}

function seg(id: string, text: string, final = false, tStart = 0): TranscriptSegment {
  return { id, final, speaker: 'Priya Nair', text, tStart, tEnd: tStart + 2, source: 'meet-captions' };
}

let repo: IndexedDbTranscriptRepository;
beforeEach(() => { repo = new IndexedDbTranscriptRepository(`saar-test-${Math.random()}`); });

describe('IndexedDbTranscriptRepository', () => {
  it('round-trips a session', async () => {
    await repo.createSession(session('s1', 100));
    expect((await repo.getSession('s1'))?.meetingCode).toBe('abc-defg-hij');
  });

  it('returns null for an unknown session', async () => {
    expect(await repo.getSession('nope')).toBeNull();
  });

  it('patches a session without clobbering other fields', async () => {
    await repo.createSession(session('s1', 100));
    await repo.updateSession('s1', { status: 'ended', endedAt: 900 });
    const s = await repo.getSession('s1');
    expect(s?.status).toBe('ended');
    expect(s?.endedAt).toBe(900);
    expect(s?.title).toBe('Sync');
  });

  it('lists sessions newest first', async () => {
    await repo.createSession(session('old', 100));
    await repo.createSession(session('new', 999));
    expect((await repo.listSessions()).map((s) => s.id)).toEqual(['new', 'old']);
  });

  it('upserts segments by id rather than duplicating revisions', async () => {
    await repo.createSession(session('s1', 0));
    await repo.appendSegments('s1', [seg('a', 'I think')]);
    await repo.appendSegments('s1', [seg('a', 'I think we should ship', true)]);

    const all = await repo.getSegments('s1');
    expect(all).toHaveLength(1);
    expect(all[0]!.text).toBe('I think we should ship');
    expect(all[0]!.final).toBe(true);
  });

  it('returns segments ordered by tStart', async () => {
    await repo.createSession(session('s1', 0));
    await repo.appendSegments('s1', [seg('b', 'second', true, 30), seg('a', 'first', true, 5)]);
    expect((await repo.getSegments('s1')).map((s) => s.text)).toEqual(['first', 'second']);
  });

  it('keeps segments of different sessions separate', async () => {
    await repo.createSession(session('s1', 0));
    await repo.createSession(session('s2', 0));
    await repo.appendSegments('s1', [seg('a', 'one', true)]);
    await repo.appendSegments('s2', [seg('a', 'two', true)]);
    expect((await repo.getSegments('s1'))[0]!.text).toBe('one');
    expect((await repo.getSegments('s2'))[0]!.text).toBe('two');
  });

  it('deleting a session removes its segments too', async () => {
    await repo.createSession(session('s1', 0));
    await repo.appendSegments('s1', [seg('a', 'one', true)]);
    await repo.deleteSession('s1');
    expect(await repo.getSession('s1')).toBeNull();
    expect(await repo.getSegments('s1')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/storage/IndexedDbTranscriptRepository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/adapters/storage/IndexedDbTranscriptRepository.ts`:

```ts
import type { TranscriptRepository } from '@/core/ports/TranscriptRepository';
import type { MeetingSession } from '@/core/types/session';
import type { TranscriptSegment } from '@/core/types/transcript';

export const DB_NAME = 'saar';
export const DB_VERSION = 1;

interface SegmentRow extends TranscriptSegment {
  readonly sessionId: string;
  readonly segId: string;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbTranscriptRepository implements TranscriptRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly dbName: string = DB_NAME) {}

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sessions')) {
          const s = db.createObjectStore('sessions', { keyPath: 'id' });
          s.createIndex('startedAt', 'startedAt');
        }
        if (!db.objectStoreNames.contains('segments')) {
          const g = db.createObjectStore('segments', { keyPath: ['sessionId', 'segId'] });
          g.createIndex('sessionId', 'sessionId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  private async tx(store: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.db();
    return db.transaction(store, mode).objectStore(store);
  }

  async createSession(session: MeetingSession): Promise<void> {
    await promisify((await this.tx('sessions', 'readwrite')).put(session));
  }

  async updateSession(id: string, patch: Partial<MeetingSession>): Promise<void> {
    const store = await this.tx('sessions', 'readwrite');
    const current = await promisify<MeetingSession | undefined>(store.get(id));
    if (!current) return;
    await promisify(store.put({ ...current, ...patch, id }));
  }

  async getSession(id: string): Promise<MeetingSession | null> {
    const store = await this.tx('sessions', 'readonly');
    return (await promisify<MeetingSession | undefined>(store.get(id))) ?? null;
  }

  async listSessions(): Promise<readonly MeetingSession[]> {
    const store = await this.tx('sessions', 'readonly');
    const all = await promisify<MeetingSession[]>(store.getAll());
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }

  async deleteSession(id: string): Promise<void> {
    const db = await this.db();
    const t = db.transaction(['sessions', 'segments'], 'readwrite');
    t.objectStore('sessions').delete(id);
    const idx = t.objectStore('segments').index('sessionId');
    const keys = await promisify<IDBValidKey[]>(idx.getAllKeys(IDBKeyRange.only(id)));
    for (const k of keys) t.objectStore('segments').delete(k);
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async appendSegments(id: string, segments: readonly TranscriptSegment[]): Promise<void> {
    if (segments.length === 0) return;
    const db = await this.db();
    const t = db.transaction('segments', 'readwrite');
    const store = t.objectStore('segments');
    for (const s of segments) {
      const row: SegmentRow = { ...s, sessionId: id, segId: s.id };
      store.put(row);
    }
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async getSegments(id: string): Promise<readonly TranscriptSegment[]> {
    const store = await this.tx('segments', 'readonly');
    const rows = await promisify<SegmentRow[]>(store.index('sessionId').getAll(IDBKeyRange.only(id)));
    return rows
      .sort((a, b) => a.tStart - b.tStart)
      .map(({ sessionId: _s, segId: _g, ...seg }) => seg);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/storage/IndexedDbTranscriptRepository.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/storage tests/adapters/storage
git commit -m "feat: add IndexedDB transcript repository with upsert semantics"
```

---

### Task 8: MeetJoinAutomation

**Files:**
- Create: `src/adapters/meet/MeetJoinAutomation.ts`
- Test: `tests/adapters/meet/MeetJoinAutomation.test.ts`

**Interfaces:**
- Consumes: `MeetSelectors` (Task 6).
- Produces: `class MeetJoinAutomation` with `(doc: Document, selectors?: MeetSelectors)`, methods `muteMicAndCamera(): Promise<void>`, `clickJoin(): Promise<boolean>`, `isInLobby(): boolean`, `enableCaptions(): Promise<boolean>`, `participantCount(): number`. Also `JOIN_CONTROL_SELECTORS`.

Like the scraper, this must stay `chrome`-free.

- [ ] **Step 1: Extend selectors.ts with join controls**

Append to `src/adapters/meet/selectors.ts`:

```ts
export interface JoinControlSelectors {
  readonly micToggle: string;
  readonly cameraToggle: string;
  readonly joinButton: string;
  readonly lobbyIndicator: string;
  readonly captionsToggle: string;
  readonly participantTile: string;
}

// Confirmed in Task 0 — replace any value that did not match.
export const JOIN_CONTROL_SELECTORS: JoinControlSelectors = {
  micToggle: '[aria-label*="microphone" i][role="button"]',
  cameraToggle: '[aria-label*="camera" i][role="button"]',
  joinButton: 'button[jsname], [role="button"]',
  lobbyIndicator: '[data-lobby], [aria-label*="Asking to join" i]',
  captionsToggle: '[aria-label*="captions" i][role="button"]',
  participantTile: '[data-participant-id]',
};
```

- [ ] **Step 2: Write the failing test**

`tests/adapters/meet/MeetJoinAutomation.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { MeetJoinAutomation } from '@/adapters/meet/MeetJoinAutomation';

beforeEach(() => { document.body.innerHTML = ''; });

describe('MeetJoinAutomation', () => {
  it('clicks mic and camera toggles only when they are currently on', async () => {
    document.body.innerHTML = `
      <div role="button" aria-label="Turn off microphone" data-is-muted="false"></div>
      <div role="button" aria-label="Turn off camera" data-is-muted="false"></div>`;
    const mic = document.querySelector('[aria-label*="microphone" i]')!;
    const cam = document.querySelector('[aria-label*="camera" i]')!;
    let micClicks = 0, camClicks = 0;
    mic.addEventListener('click', () => micClicks++);
    cam.addEventListener('click', () => camClicks++);

    await new MeetJoinAutomation(document).muteMicAndCamera();
    expect(micClicks).toBe(1);
    expect(camClicks).toBe(1);
  });

  it('does not re-click a mic that is already muted', async () => {
    document.body.innerHTML = `<div role="button" aria-label="Turn on microphone" data-is-muted="true"></div>`;
    const mic = document.querySelector('[aria-label*="microphone" i]')!;
    let clicks = 0;
    mic.addEventListener('click', () => clicks++);
    await new MeetJoinAutomation(document).muteMicAndCamera();
    expect(clicks).toBe(0);
  });

  it('clickJoin returns false when no join button is present', async () => {
    expect(await new MeetJoinAutomation(document).clickJoin()).toBe(false);
  });

  it('clickJoin finds the button by its visible label', async () => {
    document.body.innerHTML = `<button jsname="x">Join now</button>`;
    let clicked = false;
    document.querySelector('button')!.addEventListener('click', () => { clicked = true; });
    expect(await new MeetJoinAutomation(document).clickJoin()).toBe(true);
    expect(clicked).toBe(true);
  });

  it('detects the lobby state', () => {
    document.body.innerHTML = `<div aria-label="Asking to join"></div>`;
    expect(new MeetJoinAutomation(document).isInLobby()).toBe(true);
  });

  it('reports no lobby when the indicator is absent', () => {
    expect(new MeetJoinAutomation(document).isInLobby()).toBe(false);
  });

  it('enableCaptions clicks the toggle and reports success', async () => {
    document.body.innerHTML = `<div role="button" aria-label="Turn on captions"></div>`;
    let clicked = false;
    document.querySelector('[role="button"]')!.addEventListener('click', () => { clicked = true; });
    expect(await new MeetJoinAutomation(document).enableCaptions()).toBe(true);
    expect(clicked).toBe(true);
  });

  it('enableCaptions reports failure when the control is missing', async () => {
    expect(await new MeetJoinAutomation(document).enableCaptions()).toBe(false);
  });

  it('counts participant tiles', () => {
    document.body.innerHTML = `<div data-participant-id="1"></div><div data-participant-id="2"></div>`;
    expect(new MeetJoinAutomation(document).participantCount()).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/adapters/meet/MeetJoinAutomation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

`src/adapters/meet/MeetJoinAutomation.ts`:

```ts
import { JOIN_CONTROL_SELECTORS, type JoinControlSelectors } from '@/adapters/meet/selectors';

const JOIN_LABELS = ['join now', 'ask to join', 'join'];

/**
 * Drives Meet's pre-join and in-call controls via DOM interaction only.
 * `element.click()` works on Meet's React handlers even though the event is
 * untrusted; synthetic KeyboardEvents do not, so never use keyboard shortcuts.
 *
 * No `chrome.*` here — this must run unchanged under Puppeteer.
 */
export class MeetJoinAutomation {
  constructor(
    private readonly doc: Document,
    private readonly sel: JoinControlSelectors = JOIN_CONTROL_SELECTORS,
  ) {}

  private isOff(el: Element): boolean {
    const muted = el.getAttribute('data-is-muted');
    if (muted !== null) return muted === 'true';
    return /turn on/i.test(el.getAttribute('aria-label') ?? '');
  }

  async muteMicAndCamera(): Promise<void> {
    for (const selector of [this.sel.micToggle, this.sel.cameraToggle]) {
      const el = this.doc.querySelector<HTMLElement>(selector);
      if (el && !this.isOff(el)) el.click();
    }
  }

  async clickJoin(): Promise<boolean> {
    const candidates = Array.from(this.doc.querySelectorAll<HTMLElement>(this.sel.joinButton));
    const btn = candidates.find((el) => {
      const label = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`.toLowerCase().trim();
      return JOIN_LABELS.some((l) => label.includes(l));
    });
    if (!btn) return false;
    btn.click();
    return true;
  }

  isInLobby(): boolean {
    return this.doc.querySelector(this.sel.lobbyIndicator) !== null;
  }

  async enableCaptions(): Promise<boolean> {
    const el = this.doc.querySelector<HTMLElement>(this.sel.captionsToggle);
    if (!el) return false;
    if (/turn on/i.test(el.getAttribute('aria-label') ?? '')) el.click();
    return true;
  }

  participantCount(): number {
    return this.doc.querySelectorAll(this.sel.participantTile).length;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/adapters/meet/MeetJoinAutomation.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/meet tests/adapters/meet/MeetJoinAutomation.test.ts
git commit -m "feat: add Meet join and caption-enable automation"
```

---

### Task 9: Typed message bus

**Files:**
- Create: `src/shared/messaging/messages.ts`
- Test: `tests/shared/messages.test.ts`

**Interfaces:**
- Consumes: `TranscriptSegment` (Task 2), `SessionStatus` (Task 2), `SourceHealth` (Task 3).
- Produces: `type Message` (discriminated union), `PORT_NAME`, `assertNever(x: never): never`.

- [ ] **Step 1: Write the failing test**

`tests/shared/messages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assertNever, PORT_NAME, type Message } from '@/shared/messaging/messages';

describe('message bus', () => {
  it('exposes a stable port name', () => {
    expect(PORT_NAME).toBe('saar-bot');
  });

  it('assertNever throws when an unhandled variant reaches it', () => {
    expect(() => assertNever('surprise' as never)).toThrow(/Unhandled/);
  });

  it('narrows exhaustively over the union', () => {
    const describeMsg = (m: Message): string => {
      switch (m.type) {
        case 'MEETING_DETECTED': return `detected ${m.meetingCode}`;
        case 'JOIN_CANCELLED':   return 'cancelled';
        case 'BOT_STATE':        return `state ${m.status}`;
        case 'SEGMENT_BATCH':    return `batch ${m.segments.length}`;
        case 'SOURCE_HEALTH':    return `health ${m.health.ok}`;
        case 'USER_LEFT':        return 'left';
        default:                 return assertNever(m);
      }
    };
    expect(describeMsg({ type: 'MEETING_DETECTED', meetingCode: 'abc-defg-hij', tabId: 1, title: null })).toBe('detected abc-defg-hij');
    expect(describeMsg({ type: 'SEGMENT_BATCH', sessionId: 's', segments: [] })).toBe('batch 0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/messages.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/shared/messaging/messages.ts`:

```ts
import type { SourceHealth } from '@/core/ports/TranscriptSource';
import type { SessionStatus } from '@/core/types/session';
import type { TranscriptSegment } from '@/core/types/transcript';

export const PORT_NAME = 'saar-bot';

export type Message =
  | { type: 'MEETING_DETECTED'; meetingCode: string; tabId: number; title: string | null }
  | { type: 'JOIN_CANCELLED'; meetingCode: string }
  | { type: 'BOT_STATE'; sessionId: string; status: SessionStatus; detail?: string }
  | { type: 'SEGMENT_BATCH'; sessionId: string; segments: TranscriptSegment[] }
  | { type: 'SOURCE_HEALTH'; sessionId: string; health: SourceHealth }
  | { type: 'USER_LEFT'; meetingCode: string };

export function assertNever(x: never): never {
  throw new Error(`Unhandled message variant: ${JSON.stringify(x)}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/messages.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared tests/shared
git commit -m "feat: add typed message bus with exhaustive narrowing"
```

---

### Task 10: ChromeSettingsStore

**Files:**
- Create: `src/adapters/storage/ChromeSettingsStore.ts`
- Test: `tests/adapters/storage/ChromeSettingsStore.test.ts`

**Interfaces:**
- Consumes: `SettingsStore`, `Settings`, `DEFAULT_SETTINGS` (Task 3).
- Produces: `class ChromeSettingsStore implements SettingsStore`, `SETTINGS_KEY`.

- [ ] **Step 1: Write the failing test**

`tests/adapters/storage/ChromeSettingsStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChromeSettingsStore, SETTINGS_KEY } from '@/adapters/storage/ChromeSettingsStore';
import { DEFAULT_SETTINGS } from '@/core/ports/SettingsStore';

let store: Record<string, unknown>;
let listeners: Array<(c: Record<string, { newValue?: unknown }>, area: string) => void>;

beforeEach(() => {
  store = {};
  listeners = [];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => { Object.assign(store, items); },
      },
      onChanged: {
        addListener: (fn: (typeof listeners)[number]) => listeners.push(fn),
        removeListener: (fn: (typeof listeners)[number]) => {
          listeners = listeners.filter((l) => l !== fn);
        },
      },
    },
  });
});

describe('ChromeSettingsStore', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await new ChromeSettingsStore().get()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a patch over the defaults', async () => {
    const s = new ChromeSettingsStore();
    await s.set({ botAccountIndex: 1 });
    const got = await s.get();
    expect(got.botAccountIndex).toBe(1);
    expect(got.autoJoin).toBe(DEFAULT_SETTINGS.autoJoin);
  });

  it('notifies subscribers on change', async () => {
    const s = new ChromeSettingsStore();
    const seen: number[] = [];
    s.onChange((next) => seen.push(next.toastDelayMs));
    listeners.forEach((l) => l({ [SETTINGS_KEY]: { newValue: { ...DEFAULT_SETTINGS, toastDelayMs: 99 } } }, 'local'));
    expect(seen).toEqual([99]);
  });

  it('unsubscribe stops further notifications', async () => {
    const s = new ChromeSettingsStore();
    const seen: number[] = [];
    const off = s.onChange((next) => seen.push(next.toastDelayMs));
    off();
    listeners.forEach((l) => l({ [SETTINGS_KEY]: { newValue: { ...DEFAULT_SETTINGS, toastDelayMs: 99 } } }, 'local'));
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/storage/ChromeSettingsStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/adapters/storage/ChromeSettingsStore.ts`:

```ts
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from '@/core/ports/SettingsStore';
import type { Unsubscribe } from '@/core/ports/MeetingBot';

export const SETTINGS_KEY = 'saar:settings';

export class ChromeSettingsStore implements SettingsStore {
  async get(): Promise<Settings> {
    const raw = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw[SETTINGS_KEY] as Partial<Settings> | undefined) };
  }

  async set(patch: Partial<Settings>): Promise<void> {
    const next = { ...(await this.get()), ...patch };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  }

  onChange(cb: (s: Settings) => void): Unsubscribe {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ): void => {
      if (area !== 'local') return;
      const change = changes[SETTINGS_KEY];
      if (!change) return;
      cb({ ...DEFAULT_SETTINGS, ...(change.newValue as Partial<Settings> | undefined) });
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/storage/ChromeSettingsStore.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/storage/ChromeSettingsStore.ts tests/adapters/storage/ChromeSettingsStore.test.ts
git commit -m "feat: add chrome.storage-backed settings store"
```

---

### Task 11: ChromeTabBot

**Files:**
- Create: `src/adapters/bot/ChromeTabBot.ts`
- Test: `tests/adapters/bot/ChromeTabBot.test.ts`

**Interfaces:**
- Consumes: `MeetingBot`, `JoinRequest`, `JoinResult`, `EndReason`, `Unsubscribe` (Task 3).
- Produces: `class ChromeTabBot implements MeetingBot`, `buildMeetUrl(code: string, accountIndex: number): string`.

Safety-critical: the tab must be created inactive and muted **before** media starts (spec §4.2).

- [ ] **Step 1: Write the failing test**

`tests/adapters/bot/ChromeTabBot.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChromeTabBot, buildMeetUrl } from '@/adapters/bot/ChromeTabBot';

let created: Array<Record<string, unknown>>;
let updated: Array<[number, Record<string, unknown>]>;
let removed: number[];
let removeListeners: Array<(tabId: number) => void>;

beforeEach(() => {
  created = []; updated = []; removed = []; removeListeners = [];
  vi.stubGlobal('chrome', {
    tabs: {
      create: async (opts: Record<string, unknown>) => { created.push(opts); return { id: 42 }; },
      update: async (id: number, opts: Record<string, unknown>) => { updated.push([id, opts]); return { id }; },
      remove: async (id: number) => { removed.push(id); },
      onRemoved: {
        addListener: (fn: (t: number) => void) => removeListeners.push(fn),
        removeListener: (fn: (t: number) => void) => { removeListeners = removeListeners.filter(l => l !== fn); },
      },
    },
  });
});

describe('buildMeetUrl', () => {
  it('appends the authuser index', () => {
    expect(buildMeetUrl('abc-defg-hij', 1)).toBe('https://meet.google.com/abc-defg-hij?authuser=1');
  });
});

describe('ChromeTabBot', () => {
  it('creates the tab inactive and mutes it before returning', async () => {
    const bot = new ChromeTabBot();
    const res = await bot.join({ sessionId: 's1', meetingCode: 'abc-defg-hij', accountIndex: 1 });

    expect(res.ok).toBe(true);
    expect(res.tabId).toBe(42);
    expect(created[0]!.active).toBe(false);
    expect(updated).toContainEqual([42, { muted: true }]);
  });

  it('passes the session id to the bot tab via saarSession', async () => {
    const bot = new ChromeTabBot();
    await bot.join({ sessionId: 's1', meetingCode: 'abc-defg-hij', accountIndex: 1 });
    expect(created[0]!.url).toBe('https://meet.google.com/abc-defg-hij?authuser=1&saarSession=s1');
  });

  it('reports tab-closed when the bot tab disappears', async () => {
    const bot = new ChromeTabBot();
    await bot.join({ sessionId: 's1', meetingCode: 'abc-defg-hij', accountIndex: 0 });
    const reasons: string[] = [];
    bot.onEnded((r) => reasons.push(r));

    removeListeners.forEach((l) => l(42));
    expect(reasons).toEqual(['tab-closed']);
  });

  it('ignores removal of unrelated tabs', async () => {
    const bot = new ChromeTabBot();
    await bot.join({ sessionId: 's1', meetingCode: 'abc-defg-hij', accountIndex: 0 });
    const reasons: string[] = [];
    bot.onEnded((r) => reasons.push(r));

    removeListeners.forEach((l) => l(999));
    expect(reasons).toEqual([]);
  });

  it('leave closes the tab exactly once', async () => {
    const bot = new ChromeTabBot();
    await bot.join({ sessionId: 's1', meetingCode: 'abc-defg-hij', accountIndex: 0 });
    await bot.leave();
    await bot.leave();
    expect(removed).toEqual([42]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/bot/ChromeTabBot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/adapters/bot/ChromeTabBot.ts`:

```ts
import type { EndReason, JoinRequest, JoinResult, MeetingBot, Unsubscribe } from '@/core/ports/MeetingBot';

export function buildMeetUrl(code: string, accountIndex: number): string {
  return `https://meet.google.com/${code}?authuser=${accountIndex}`;
}

export class ChromeTabBot implements MeetingBot {
  private tabId: number | null = null;
  private listeners = new Set<(r: EndReason) => void>();
  private onRemoved = (tabId: number): void => {
    if (tabId === this.tabId) {
      this.tabId = null;
      this.fire('tab-closed');
    }
  };

  async join(req: JoinRequest): Promise<JoinResult> {
    try {
      // saarSession tells the bot-agent content script which session it serves.
      const url = `${buildMeetUrl(req.meetingCode, req.accountIndex)}&saarSession=${req.sessionId}`;
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab.id === undefined) return { ok: false, error: 'tab has no id' };

      this.tabId = tab.id;
      // Mute before any media can start — otherwise the bot tab plays meeting
      // audio out the speakers and the user's mic feeds it back in (spec §4.2).
      await chrome.tabs.update(tab.id, { muted: true });
      chrome.tabs.onRemoved.addListener(this.onRemoved);
      return { ok: true, tabId: tab.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async leave(): Promise<void> {
    const id = this.tabId;
    this.tabId = null;
    chrome.tabs.onRemoved.removeListener(this.onRemoved);
    if (id !== null) {
      try { await chrome.tabs.remove(id); } catch { /* already gone */ }
    }
  }

  onEnded(cb: (reason: EndReason) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private fire(reason: EndReason): void {
    for (const l of this.listeners) l(reason);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/bot/ChromeTabBot.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/bot tests/adapters/bot
git commit -m "feat: add ChromeTabBot creating a muted background bot tab"
```

---

### Task 12: Meeting-code parsing and the meet-detector content script

**Files:**
- Create: `src/core/meet/meetingCode.ts`
- Create: `src/entrypoints/meet-detector.content.ts`
- Test: `tests/core/meetingCode.test.ts`

**Interfaces:**
- Consumes: `Message`, `PORT_NAME` (Task 9).
- Produces: `parseMeetingCode(url: string): string | null`, `isBotTab(url: string): boolean`. The content script sends `MEETING_DETECTED` and `USER_LEFT`.

- [ ] **Step 1: Write the failing test**

`tests/core/meetingCode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseMeetingCode, isBotTab } from '@/core/meet/meetingCode';

describe('parseMeetingCode', () => {
  it('extracts a standard xxx-yyyy-zzz code', () => {
    expect(parseMeetingCode('https://meet.google.com/abc-defg-hij')).toBe('abc-defg-hij');
  });
  it('ignores query strings', () => {
    expect(parseMeetingCode('https://meet.google.com/abc-defg-hij?authuser=1')).toBe('abc-defg-hij');
  });
  it('rejects the landing page', () => {
    expect(parseMeetingCode('https://meet.google.com/')).toBeNull();
  });
  it('rejects non-meeting routes', () => {
    expect(parseMeetingCode('https://meet.google.com/landing')).toBeNull();
    expect(parseMeetingCode('https://meet.google.com/new')).toBeNull();
  });
  it('rejects other hosts', () => {
    expect(parseMeetingCode('https://example.com/abc-defg-hij')).toBeNull();
  });
});

describe('isBotTab', () => {
  it('is true when authuser is present', () => {
    expect(isBotTab('https://meet.google.com/abc-defg-hij?authuser=1')).toBe(true);
  });
  it('is false without authuser', () => {
    expect(isBotTab('https://meet.google.com/abc-defg-hij')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/meetingCode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/meet/meetingCode.ts`:

```ts
const CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

export function parseMeetingCode(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.hostname !== 'meet.google.com') return null;
  const first = parsed.pathname.split('/').filter(Boolean)[0];
  if (first === undefined) return null;
  return CODE_RE.test(first) ? first : null;
}

export function isBotTab(url: string): boolean {
  try { return new URL(url).searchParams.has('authuser'); } catch { return false; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/meetingCode.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the content script**

`src/entrypoints/meet-detector.content.ts`:

```ts
import { parseMeetingCode, isBotTab } from '@/core/meet/meetingCode';
import type { Message } from '@/shared/messaging/messages';

export default defineContentScript({
  matches: ['https://meet.google.com/*'],
  main() {
    // The bot's own tab must never trigger a second bot.
    if (isBotTab(location.href)) return;

    let announced: string | null = null;

    const send = (m: Message): void => { void chrome.runtime.sendMessage(m); };

    const check = (): void => {
      const code = parseMeetingCode(location.href);
      if (code && code !== announced) {
        announced = code;
        send({ type: 'MEETING_DETECTED', meetingCode: code, tabId: -1, title: document.title || null });
      } else if (!code && announced) {
        send({ type: 'USER_LEFT', meetingCode: announced });
        announced = null;
      }
    };

    check();
    // Meet is a SPA: it rewrites the URL on join and on leave.
    const push = history.pushState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => { push(...args); check(); };
    addEventListener('popstate', check);
    setInterval(check, 2000);

    addEventListener('pagehide', () => {
      if (announced) send({ type: 'USER_LEFT', meetingCode: announced });
    });
  },
});
```

- [ ] **Step 6: Verify it builds**

Run: `. "$HOME/.nvm/nvm.sh" && nvm use && npm run build`
Expected: build succeeds; `.output/chrome-mv3/` contains the content script.

- [ ] **Step 7: Commit**

```bash
git add src/core/meet src/entrypoints/meet-detector.content.ts tests/core/meetingCode.test.ts
git commit -m "feat: add meeting code parsing and meet-detector content script"
```

---

### Task 13: Join-toast UI in the user's tab

**Files:**
- Create: `src/entrypoints/meet-detector/toast.ts`
- Modify: `src/entrypoints/meet-detector.content.ts`
- Test: `tests/entrypoints/toast.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `showJoinToast(doc: Document, delayMs: number, onCancel: () => void, onProceed: () => void): () => void` — returns a dismiss function.

- [ ] **Step 1: Write the failing test**

`tests/entrypoints/toast.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showJoinToast } from '@/entrypoints/meet-detector/toast';

beforeEach(() => { document.body.innerHTML = ''; vi.useFakeTimers(); });

describe('showJoinToast', () => {
  it('renders a toast naming the product', () => {
    showJoinToast(document, 5000, () => {}, () => {});
    expect(document.body.textContent).toContain('Saar');
  });

  it('calls onProceed once the delay elapses', () => {
    const proceed = vi.fn();
    showJoinToast(document, 5000, () => {}, proceed);
    vi.advanceTimersByTime(5000);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('cancel prevents onProceed and fires onCancel', () => {
    const proceed = vi.fn();
    const cancel = vi.fn();
    showJoinToast(document, 5000, cancel, proceed);
    document.querySelector<HTMLButtonElement>('[data-saar-cancel]')!.click();
    vi.advanceTimersByTime(5000);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(proceed).not.toHaveBeenCalled();
  });

  it('removes itself from the DOM after proceeding', () => {
    showJoinToast(document, 5000, () => {}, () => {});
    vi.advanceTimersByTime(5000);
    expect(document.querySelector('[data-saar-toast]')).toBeNull();
  });

  it('the returned dismiss function is idempotent', () => {
    const proceed = vi.fn();
    const dismiss = showJoinToast(document, 5000, () => {}, proceed);
    dismiss();
    dismiss();
    vi.advanceTimersByTime(5000);
    expect(proceed).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/entrypoints/toast.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/entrypoints/meet-detector/toast.ts`:

```ts
const TEAL = '#1A414E';
const MINT = '#D9EFEA';

export function showJoinToast(
  doc: Document,
  delayMs: number,
  onCancel: () => void,
  onProceed: () => void,
): () => void {
  const host = doc.createElement('div');
  host.setAttribute('data-saar-toast', '');
  host.style.cssText = [
    'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:2147483647', `background:${MINT}`, `color:${TEAL}`,
    'padding:12px 16px', 'border-radius:12px', 'display:flex', 'gap:12px',
    'align-items:center', 'font:14px system-ui,sans-serif',
    'box-shadow:0 4px 16px rgba(0,0,0,.2)',
  ].join(';');

  const label = doc.createElement('span');
  label.textContent = 'Saar is joining to take notes…';

  const cancel = doc.createElement('button');
  cancel.setAttribute('data-saar-cancel', '');
  cancel.textContent = 'Cancel';
  cancel.style.cssText = `background:${TEAL};color:${MINT};border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit`;

  host.append(label, cancel);
  doc.body.appendChild(host);

  let settled = false;
  const finish = (fn?: () => void): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    host.remove();
    fn?.();
  };

  const timer = setTimeout(() => finish(onProceed), delayMs);
  cancel.addEventListener('click', () => finish(onCancel));

  return () => finish();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/entrypoints/toast.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire the toast into the detector**

In `src/entrypoints/meet-detector.content.ts`, replace the `MEETING_DETECTED` branch inside `check()` with:

```ts
      if (code && code !== announced) {
        announced = code;
        const settings = await chrome.storage.local.get('saar:settings');
        const cfg = (settings['saar:settings'] ?? {}) as { autoJoin?: boolean; toastDelayMs?: number };
        if (cfg.autoJoin === false) return;
        showJoinToast(
          document,
          cfg.toastDelayMs ?? 5000,
          () => send({ type: 'JOIN_CANCELLED', meetingCode: code }),
          () => send({ type: 'MEETING_DETECTED', meetingCode: code, tabId: -1, title: document.title || null }),
        );
      }
```

Add `import { showJoinToast } from '@/entrypoints/meet-detector/toast';` at the top and make `check` an `async` function.

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints tests/entrypoints
git commit -m "feat: add cancellable join toast in the user's Meet tab"
```

---

### Task 14: bot-agent content script

**Files:**
- Create: `src/entrypoints/bot-agent.content.ts`

**Interfaces:**
- Consumes: `MeetJoinAutomation` (Task 8), `MeetCaptionScraper` (Task 6), `SegmentBatcher` + `DEFAULT_BATCHER_OPTIONS` (Task 4), `SystemClock` (Task 3), `SystemScheduler` (Task 3), `Message` + `PORT_NAME` (Task 9), `isBotTab` (Task 12).
- Produces: a long-lived `chrome.runtime.connect` port that streams `SEGMENT_BATCH`, `BOT_STATE`, and `SOURCE_HEALTH` to the background worker.

The port is load-bearing twice over: it streams data, and it keeps the MV3 service worker alive for the duration of the meeting (spec §14).

- [ ] **Step 1: Write the content script**

`src/entrypoints/bot-agent.content.ts`:

```ts
import { MeetCaptionScraper } from '@/adapters/meet/MeetCaptionScraper';
import { MeetJoinAutomation } from '@/adapters/meet/MeetJoinAutomation';
import { SegmentBatcher, DEFAULT_BATCHER_OPTIONS } from '@/core/capture/SegmentBatcher';
import { SystemClock } from '@/core/ports/Clock';
import { SystemScheduler } from '@/core/ports/Scheduler';
import { isBotTab } from '@/core/meet/meetingCode';
import { PORT_NAME, type Message } from '@/shared/messaging/messages';

const LOBBY_TIMEOUT_MS = 180_000;
const CAPTION_RETRIES = 5;
const IDLE_END_MS = 900_000; // 15 min with no segments — backstop (spec §7.1)

export default defineContentScript({
  matches: ['https://meet.google.com/*'],
  async main() {
    if (!isBotTab(location.href)) return;

    const sessionId = new URL(location.href).searchParams.get('saarSession');
    if (sessionId === null) return;

    const port = chrome.runtime.connect({ name: PORT_NAME });
    const send = (m: Message): void => port.postMessage(m);

    type BotStatus = 'joining' | 'in-lobby' | 'capturing' | 'ended' | 'failed';
    const sendState = (status: BotStatus, detail?: string): void => {
      send({ type: 'BOT_STATE', sessionId, status, detail });
    };

    const join = new MeetJoinAutomation(document);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    sendState('joining');

    // 1. Pre-join: mic and camera off, then join.
    for (let i = 0; i < 20; i++) {
      await join.muteMicAndCamera();
      if (await join.clickJoin()) break;
      await sleep(500);
    }

    // 2. Wait out the lobby.
    const lobbyDeadline = Date.now() + LOBBY_TIMEOUT_MS;
    while (join.isInLobby()) {
      sendState('in-lobby');
      if (Date.now() > lobbyDeadline) {
        sendState('failed', 'not admitted within 3 minutes');
        return;
      }
      await sleep(3000);
    }

    // 3. Turn captions on, with backoff.
    let captionsOn = false;
    for (let attempt = 0; attempt < CAPTION_RETRIES; attempt++) {
      captionsOn = await join.enableCaptions();
      if (captionsOn) break;
      await sleep(1000 * 2 ** attempt);
    }
    if (!captionsOn) {
      sendState('failed', 'captions control not found');
      return;
    }

    // 4. Scrape.
    const batcher = new SegmentBatcher(
      (segments) => send({ type: 'SEGMENT_BATCH', sessionId, segments }),
      DEFAULT_BATCHER_OPTIONS,
      SystemScheduler,
    );
    const scraper = new MeetCaptionScraper(document, SystemClock);
    await scraper.start(batcher);
    sendState('capturing');

    const health = setInterval(() => {
      const h = scraper.health();
      send({ type: 'SOURCE_HEALTH', sessionId, health: h });
      const idle = h.lastSegmentAt !== null && Date.now() - h.lastSegmentAt > IDLE_END_MS;
      if (idle && join.participantCount() <= 1) void teardown('ended');
    }, 30_000);

    async function teardown(status: 'ended' | 'failed'): Promise<void> {
      clearInterval(health);
      await scraper.stop();
      batcher.dispose();
      sendState(status);
      port.disconnect();
    }

    addEventListener('pagehide', () => { void teardown('ended'); });
    port.onDisconnect.addListener(() => { void scraper.stop(); });
  },
});
```

- [ ] **Step 2: Verify it typechecks and builds**

Run: `. "$HOME/.nvm/nvm.sh" && nvm use && npm run typecheck && npm run build`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/entrypoints/bot-agent.content.ts
git commit -m "feat: add bot-agent content script driving join, captions, and scraping"
```

---

### Task 15: Background service worker orchestration

**Files:**
- Create: `src/entrypoints/background.ts`
- Create: `src/core/session/sessionState.ts`
- Test: `tests/core/sessionState.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `SessionRegistry` (pure, testable), and the composition root that wires `ChromeTabBot`, `IndexedDbTranscriptRepository`, `ChromeSettingsStore` together.

Session state must survive service-worker termination, so the registry is pure data persisted to `chrome.storage.session` (spec §14).

- [ ] **Step 1: Write the failing test**

`tests/core/sessionState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SessionRegistry, type ActiveSession } from '@/core/session/sessionState';

const s = (over: Partial<ActiveSession> = {}): ActiveSession => ({
  sessionId: 's1', meetingCode: 'abc-defg-hij', userTabId: 1, botTabId: 42, ...over,
});

describe('SessionRegistry', () => {
  it('finds an active session by meeting code', () => {
    const r = new SessionRegistry([s()]);
    expect(r.byMeetingCode('abc-defg-hij')?.sessionId).toBe('s1');
    expect(r.byMeetingCode('nope-nope-nop')).toBeNull();
  });

  it('finds by bot tab id', () => {
    const r = new SessionRegistry([s()]);
    expect(r.byBotTab(42)?.sessionId).toBe('s1');
    expect(r.byBotTab(7)).toBeNull();
  });

  it('add is idempotent per meeting code', () => {
    const r = new SessionRegistry([]);
    r.add(s());
    r.add(s({ sessionId: 's2' }));
    expect(r.all()).toHaveLength(1);
    expect(r.all()[0]!.sessionId).toBe('s1');
  });

  it('remove drops the session', () => {
    const r = new SessionRegistry([s()]);
    r.remove('s1');
    expect(r.all()).toEqual([]);
  });

  it('remove of an unknown id is a no-op', () => {
    const r = new SessionRegistry([s()]);
    r.remove('missing');
    expect(r.all()).toHaveLength(1);
  });

  it('serialises and rehydrates losslessly', () => {
    const r = new SessionRegistry([s()]);
    expect(SessionRegistry.fromJSON(r.toJSON()).all()).toEqual(r.all());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/sessionState.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the registry**

`src/core/session/sessionState.ts`:

```ts
export interface ActiveSession {
  readonly sessionId: string;
  readonly meetingCode: string;
  readonly userTabId: number;
  readonly botTabId: number | null;
}

export class SessionRegistry {
  constructor(private sessions: ActiveSession[] = []) {}

  static fromJSON(raw: unknown): SessionRegistry {
    return new SessionRegistry(Array.isArray(raw) ? (raw as ActiveSession[]) : []);
  }

  toJSON(): ActiveSession[] { return [...this.sessions]; }
  all(): readonly ActiveSession[] { return this.sessions; }

  add(s: ActiveSession): void {
    if (this.byMeetingCode(s.meetingCode)) return;
    this.sessions.push(s);
  }

  remove(sessionId: string): void {
    this.sessions = this.sessions.filter((x) => x.sessionId !== sessionId);
  }

  byMeetingCode(code: string): ActiveSession | null {
    return this.sessions.find((x) => x.meetingCode === code) ?? null;
  }

  byBotTab(tabId: number): ActiveSession | null {
    return this.sessions.find((x) => x.botTabId === tabId) ?? null;
  }

  bySessionId(id: string): ActiveSession | null {
    return this.sessions.find((x) => x.sessionId === id) ?? null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/sessionState.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the background worker**

`src/entrypoints/background.ts`:

```ts
import { ChromeTabBot } from '@/adapters/bot/ChromeTabBot';
import { IndexedDbTranscriptRepository } from '@/adapters/storage/IndexedDbTranscriptRepository';
import { ChromeSettingsStore } from '@/adapters/storage/ChromeSettingsStore';
import { SessionRegistry, type ActiveSession } from '@/core/session/sessionState';
import { newSessionId } from '@/core/types/session';
import { PORT_NAME, assertNever, type Message } from '@/shared/messaging/messages';

const STATE_KEY = 'saar:sessions';

export default defineBackground(() => {
  const repo = new IndexedDbTranscriptRepository();
  const settings = new ChromeSettingsStore();
  const bots = new Map<string, ChromeTabBot>();

  async function loadRegistry(): Promise<SessionRegistry> {
    const raw = await chrome.storage.session.get(STATE_KEY);
    return SessionRegistry.fromJSON(raw[STATE_KEY]);
  }

  async function saveRegistry(r: SessionRegistry): Promise<void> {
    await chrome.storage.session.set({ [STATE_KEY]: r.toJSON() });
  }

  async function startSession(code: string, userTabId: number, title: string | null): Promise<void> {
    const reg = await loadRegistry();
    if (reg.byMeetingCode(code)) return;              // idempotent

    const cfg = await settings.get();
    if (cfg.botAccountIndex === null) {
      await notify('Saar needs setup', 'Choose the notetaker Google account in Saar settings.');
      return;
    }

    const sessionId = newSessionId();
    await repo.createSession({
      id: sessionId, platform: 'google-meet', meetingCode: code,
      title, startedAt: Date.now(), endedAt: null, participants: [], status: 'joining',
    });

    // Go through the MeetingBot port, never chrome.tabs directly — the port is
    // what PuppeteerBot will replace in the cloud build (spec §18).
    const bot = new ChromeTabBot();
    bots.set(sessionId, bot);
    const result = await bot.join({ sessionId, meetingCode: code, accountIndex: cfg.botAccountIndex });
    if (!result.ok) {
      await repo.updateSession(sessionId, { status: 'failed', error: result.error });
      bots.delete(sessionId);
      return;
    }

    const entry: ActiveSession = { sessionId, meetingCode: code, userTabId, botTabId: result.tabId ?? null };
    reg.add(entry);
    await saveRegistry(reg);
  }

  async function endSession(sessionId: string): Promise<void> {
    const reg = await loadRegistry();
    const entry = reg.bySessionId(sessionId);
    if (!entry) return;                                // idempotent

    reg.remove(sessionId);
    await saveRegistry(reg);

    // Prefer the bot's own leave(). After a service-worker restart the in-memory
    // bot is gone, so fall back to closing the tab id we persisted.
    const bot = bots.get(sessionId);
    if (bot) {
      await bot.leave();
    } else if (entry.botTabId !== null) {
      try { await chrome.tabs.remove(entry.botTabId); } catch { /* already gone */ }
    }
    bots.delete(sessionId);
    await repo.updateSession(sessionId, { status: 'ended', endedAt: Date.now() });

    const session = await repo.getSession(sessionId);
    await notify('Transcript saved', session?.title ?? entry.meetingCode);
  }

  async function notify(title: string, message: string): Promise<void> {
    await chrome.notifications.create({
      type: 'basic', iconUrl: '/icon-128.png', title, message,
    });
  }

  chrome.runtime.onMessage.addListener((msg: Message, sender) => {
    void (async () => {
      switch (msg.type) {
        case 'MEETING_DETECTED':
          if (sender.tab?.id !== undefined) {
            await startSession(msg.meetingCode, sender.tab.id, msg.title);
          }
          break;
        case 'JOIN_CANCELLED':
          break;
        case 'USER_LEFT': {
          const reg = await loadRegistry();
          const entry = reg.byMeetingCode(msg.meetingCode);
          if (entry) await endSession(entry.sessionId);
          break;
        }
        case 'BOT_STATE':
        case 'SEGMENT_BATCH':
        case 'SOURCE_HEALTH':
          break;                                        // arrive over the port, not sendMessage
        default:
          assertNever(msg);
      }
    })();
    return false;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;

    port.onMessage.addListener((msg: Message) => {
      void (async () => {
        switch (msg.type) {
          case 'SEGMENT_BATCH':
            await repo.appendSegments(msg.sessionId, msg.segments);
            break;
          case 'BOT_STATE':
            await repo.updateSession(msg.sessionId, { status: msg.status, error: msg.detail });
            if (msg.status === 'ended' || msg.status === 'failed') await endSession(msg.sessionId);
            break;
          case 'SOURCE_HEALTH':
            if (!msg.health.selectorsMatched) {
              await notify('Saar: captions not detected', 'Meet\'s caption DOM may have changed.');
            }
            break;
          default:
            break;
        }
      })();
    });
  });

  // Belt-and-braces user-left signal (spec §7.1).
  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const reg = await loadRegistry();
      const entry = reg.all().find((x) => x.userTabId === tabId || x.botTabId === tabId);
      if (entry) await endSession(entry.sessionId);
    })();
  });
});
```

- [ ] **Step 6: Verify build and full check**

Run: `. "$HOME/.nvm/nvm.sh" && nvm use && npm run check && npm run build`
Expected: typecheck, lint, deps, and all tests pass; build produces `.output/chrome-mv3/`.

- [ ] **Step 7: Commit**

```bash
git add src/core/session src/entrypoints/background.ts tests/core/sessionState.test.ts
git commit -m "feat: add background orchestration with session state persistence"
```

---

### Task 16: Meetings UI

**Files:**
- Create: `src/entrypoints/meetings/index.html`, `src/entrypoints/meetings/main.ts`, `src/entrypoints/meetings/style.css`
- Create: `src/entrypoints/popup/index.html`, `src/entrypoints/popup/main.ts`
- Modify: `wxt.config.ts` (add `action` with `default_popup`)

**Interfaces:**
- Consumes: `IndexedDbTranscriptRepository` (Task 7), `transcriptToMarkdown` + `formatTimestamp` (Task 5), `ChromeSettingsStore` (Task 10).
- Produces: the meetings list/detail page and the toolbar popup.

- [ ] **Step 1: Write the meetings page**

`src/entrypoints/meetings/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Saar — Meetings</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <header><img src="/logo-lockup.png" alt="Saar" height="32" /></header>
    <main>
      <ul id="list"></ul>
      <section id="detail" hidden></section>
    </main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/entrypoints/meetings/style.css`:

```css
:root { --teal: #1A414E; --mint: #D9EFEA; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: var(--teal); background: #fff; }
header { padding: 16px 24px; background: var(--mint); }
main { display: grid; grid-template-columns: 320px 1fr; gap: 24px; padding: 24px; }
ul { list-style: none; margin: 0; padding: 0; }
li { padding: 12px; border-radius: 10px; cursor: pointer; }
li:hover, li[aria-selected="true"] { background: var(--mint); }
li h3 { margin: 0 0 4px; font-size: 15px; }
li small { opacity: .7; }
button { background: var(--teal); color: var(--mint); border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; font: inherit; margin-right: 8px; }
.line { margin: 0 0 10px; }
.who { font-weight: 600; }
.ts { opacity: .6; font-variant-numeric: tabular-nums; margin: 0 6px; }
@media (prefers-color-scheme: dark) {
  body { background: #10262d; color: var(--mint); }
  header, li:hover, li[aria-selected="true"] { background: #17323b; }
}
```

`src/entrypoints/meetings/main.ts`:

```ts
import { IndexedDbTranscriptRepository } from '@/adapters/storage/IndexedDbTranscriptRepository';
import { transcriptToMarkdown, formatTimestamp } from '@/core/export/toMarkdown';
import type { MeetingSession } from '@/core/types/session';

const repo = new IndexedDbTranscriptRepository();
const list = document.getElementById('list') as HTMLUListElement;
const detail = document.getElementById('detail') as HTMLElement;

function download(name: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

async function renderDetail(session: MeetingSession): Promise<void> {
  const segments = await repo.getSegments(session.id);
  const finals = segments.filter((s) => s.final);
  detail.hidden = false;
  detail.innerHTML = '';

  const h2 = document.createElement('h2');
  h2.textContent = session.title ?? session.meetingCode;

  const copy = document.createElement('button');
  copy.textContent = 'Copy as Markdown';
  copy.onclick = () => void navigator.clipboard.writeText(transcriptToMarkdown(session, segments));

  const dl = document.createElement('button');
  dl.textContent = 'Download .md';
  dl.onclick = () => download(`${session.meetingCode}.md`, transcriptToMarkdown(session, segments));

  const del = document.createElement('button');
  del.textContent = 'Delete';
  del.onclick = async () => {
    if (!confirm('Delete this meeting and its transcript? This cannot be undone.')) return;
    await repo.deleteSession(session.id);
    detail.hidden = true;
    await renderList();
  };

  detail.append(h2, copy, dl, del);

  if (finals.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No transcript captured.';
    detail.append(p);
    return;
  }
  for (const s of finals) {
    const p = document.createElement('p');
    p.className = 'line';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = s.speaker ?? 'Unknown';
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = formatTimestamp(s.tStart);
    p.append(who, ts, document.createTextNode(s.text));
    detail.append(p);
  }
}

async function renderList(): Promise<void> {
  const sessions = await repo.listSessions();
  list.innerHTML = '';
  for (const s of sessions) {
    const li = document.createElement('li');
    const h3 = document.createElement('h3');
    h3.textContent = s.title ?? s.meetingCode;
    const small = document.createElement('small');
    small.textContent = `${new Date(s.startedAt).toLocaleString()} · ${s.status}`;
    li.append(h3, small);
    li.onclick = () => {
      for (const other of list.children) other.removeAttribute('aria-selected');
      li.setAttribute('aria-selected', 'true');
      void renderDetail(s);
    };
    list.append(li);
  }
  if (sessions.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No meetings recorded yet.';
    list.append(li);
  }
}

void renderList();
```

- [ ] **Step 2: Write the popup**

`src/entrypoints/popup/index.html`:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Saar</title></head>
  <body style="width:280px;margin:0;font:14px system-ui,sans-serif;color:#1A414E">
    <div style="background:#D9EFEA;padding:12px"><img src="/logo-lockup.png" alt="Saar" height="24" /></div>
    <div style="padding:12px">
      <p id="status" style="margin:0 0 12px">Idle</p>
      <label style="display:block;margin-bottom:12px">
        Notetaker account index
        <input id="account" type="number" min="0" style="width:100%;padding:6px;margin-top:4px" />
      </label>
      <button id="open" style="background:#1A414E;color:#D9EFEA;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;font:inherit">
        Open meetings
      </button>
    </div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/entrypoints/popup/main.ts`:

```ts
import { ChromeSettingsStore } from '@/adapters/storage/ChromeSettingsStore';

const settings = new ChromeSettingsStore();
const account = document.getElementById('account') as HTMLInputElement;
const status = document.getElementById('status') as HTMLElement;

void (async () => {
  const cfg = await settings.get();
  account.value = cfg.botAccountIndex === null ? '' : String(cfg.botAccountIndex);
  status.textContent = cfg.botAccountIndex === null
    ? 'Set the notetaker account index to start.'
    : 'Ready — Saar will join your next Meet call.';
})();

account.addEventListener('change', () => {
  const n = account.value === '' ? null : Number(account.value);
  void settings.set({ botAccountIndex: Number.isFinite(n) ? n : null });
});

(document.getElementById('open') as HTMLButtonElement).onclick = () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('/meetings.html') });
};
```

- [ ] **Step 3: Register the popup in the manifest**

In `wxt.config.ts`, add inside `manifest`:

```ts
    action: { default_popup: 'popup.html', default_title: 'Saar' },
```

- [ ] **Step 4: Verify build**

Run: `. "$HOME/.nvm/nvm.sh" && nvm use && npm run check && npm run build`
Expected: all pass; `.output/chrome-mv3/` contains `popup.html` and `meetings.html`.

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/meetings src/entrypoints/popup wxt.config.ts
git commit -m "feat: add meetings list, transcript detail, and popup"
```

---

### Task 17: End-to-end verification against a real meeting

**Files:**
- Create: `docs/superpowers/notes/phase1-e2e-results.md`

**Interfaces:**
- Consumes: the built extension.
- Produces: a pass/fail record for each acceptance criterion.

- [ ] **Step 1: Load the extension**

```bash
. "$HOME/.nvm/nvm.sh" && nvm use && npm run build
```

Open `chrome://extensions`, enable Developer mode, **Load unpacked** → `.output/chrome-mv3/`.

- [ ] **Step 2: Configure the notetaker account**

Sign the dedicated account into the same Chrome profile. Open the Saar popup and set the account index recorded in Task 0 step 6.

- [ ] **Step 3: Run a real meeting and record results**

Start a Meet call, let the toast proceed, speak for at least three minutes with a second participant, then leave. Record each result in `docs/superpowers/notes/phase1-e2e-results.md`:

```markdown
# Phase 1 E2E — YYYY-MM-DD, Chrome <version>

| # | Criterion | Result |
|---|---|---|
| 1 | Toast appears on joining a Meet, cancellable | |
| 2 | Bot tab opens in background and is muted (no echo, no double audio) | |
| 3 | Bot joins with mic and camera off | |
| 4 | Captions turn on in the bot tab without manual action | |
| 5 | Segments accumulate in the meetings UI during the call | |
| 6 | Speaker names are correct, including your own real name | |
| 7 | Leaving the call closes the bot tab within ~5s | |
| 8 | Transcript survives a service-worker restart (chrome://serviceworker-internals → Stop) | |
| 9 | Copy as Markdown and Download .md produce correct output | |
| 10 | Delete removes both session and segments | |
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/notes/phase1-e2e-results.md
git commit -m "docs: record phase 1 end-to-end verification results"
```

---

## Phase 1 acceptance

Phase 1 is done when `npm run check` is green, the extension builds, and all ten criteria in Task 17 pass. At that point the transcript is durable and exportable, and Phase 2 (the `LlmClient`, `Summarizer`, and minutes UI) can be planned against a working capture pipeline.
