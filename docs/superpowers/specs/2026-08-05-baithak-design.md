# Baithak — Design Spec

**Date:** 2026-08-05
**Repo:** `IQSmartOrg/baithak`
**Status:** Design approved, pending implementation plan

बैठक (*baithak*) — a meeting, a sitting. A Chrome extension that sends a dedicated notetaker
account into your Google Meet calls, captures a speaker-attributed transcript, and turns it
into a summary and minutes using any OpenAI-compatible LLM — including a local Ollama.

---

## 1. Goals

- Capture a complete, **speaker-attributed** transcript of a Google Meet call with no
  manual action from the user.
- Produce, at meeting end: a summary, topics discussed, decisions, **per-person action
  items**, and open questions.
- Run entirely against a **user-configured LLM endpoint** — local Ollama by default, or any
  OpenAI-compatible provider (URL + API key + model).
- Keep the transcript-capture core **portable to a headless cloud bot** so that a future
  server-side deployment reuses it unchanged.

## 2. Non-goals (v1)

- Platforms other than Google Meet. The architecture admits them; v1 does not ship them.
- Audio capture, Whisper, or speaker diarization. Designed for, not built.
- Calendar-driven auto-join.
- Any external integration (Notion, Slack, email, Docs).
- Cloud/server component. v1 is local-only.
- Multi-user accounts, sharing, or sync.

## 3. Verified feasibility findings

Confirmed on the development machine (macOS, Ollama 0.18.0) on 2026-08-05:

| Check | Result |
|---|---|
| `GET localhost:11434/v1/models` | ✅ 200, returns OpenAI-shaped model list |
| `POST /v1/chat/completions` with dummy bearer token | ✅ 200, key ignored |
| `response_format: {type: "json_schema"}` on Ollama | ✅ Honoured, returns valid JSON |
| `Origin: chrome-extension://<id>` → Ollama | ❌ **403, empty body** |
| `Origin: http://localhost:3000` → Ollama | ✅ 200 |
| No `Origin` header → Ollama | ✅ 200 |
| `OLLAMA_ORIGINS` on this machine | unset |

Locally available models: `qwen3:14b`, `qwen2.5:7b`, `qwen2.5-coder:14b`, `qwen2.5-coder:32b`.

**Consequence:** a single OpenAI-compatible client covers both Ollama and hosted providers
with no branching. The 403 is the one real blocker and is handled in §10.

### 3.1 Assumptions requiring prototype validation

These are reasoned but unverified. Each must be tested before implementation depends on it.

| # | Assumption | Risk if false |
|---|---|---|
| A1 | A backgrounded Meet tab with active WebRTC keeps mutating the caption DOM | **Fatal.** Whole capture model collapses |
| A2 | `chrome.tabs.update({muted: true})` does not affect caption delivery (captions arrive as server-side text, not derived from local playback) | Feedback loop or no captions |
| A3 | `meet.google.com/xxx-yyyy-zzz?authuser=N` joins as the Nth signed-in account | Bot joins as wrong identity |
| A4 | Meet caption container is locatable by stable structural/`aria` attributes rather than obfuscated class names | Scraper is fragile from day one |

**A1 is the load-bearing one and must be tested first** — open a Meet in a background tab
with captions on, leave it 10 minutes, confirm DOM mutations continue. Chrome exempts tabs
with active WebRTC from freezing, and `MutationObserver` is event-driven rather than
timer-driven, so this should hold; it is cheap to confirm and catastrophic to assume wrongly.

---

## 4. Capture model — the bot account

A **dedicated Google account** joins the meeting in a second tab. The user's own tab is
untouched.

**Why not scrape the user's own tab?** It would work (captions on, overlay hidden via
injected CSS) and is far simpler. The bot model was chosen deliberately because the endgame
is a server-side notetaker, and joining + caption-enabling + scraping as DOM automation ports
directly to a headless Puppeteer bot. Building it now exercises that path.

**Accepted costs:**
- The bot must be admitted from the lobby for meetings outside its Workspace domain.
- It appears as a visible participant — good for consent, but some organisations ban bots.
- A second WebRTC session costs CPU and bandwidth on the user's machine.

**Incidental benefit:** because the bot is a separate account, Meet labels the user by their
**real name** rather than "You". Speaker attribution needs no participant-list resolution.

### 4.1 Bot account setup

Both accounts sign into the **same Chrome profile** via Google multi-login. Onboarding then:

1. Reads the signed-in account list from the Google accounts chooser page.
2. Asks the user which account is the notetaker.
3. Stores that account's **`authuser` index** in settings.
4. Runs a dry-run join against a throwaway meeting code to confirm the index resolves to the
   expected identity (validates assumption A3).

If the user later signs accounts in or out, indices shift. The extension re-validates the
stored index on each join and surfaces a "reconfigure notetaker account" error on mismatch
rather than silently joining as the wrong identity.

### 4.2 Safety requirements

1. The bot joins with **microphone off and camera off**, set on the pre-join screen.
2. The bot tab is muted via `chrome.tabs.update({muted: true})` **before** media starts.
   Without this, the bot tab plays meeting audio through the user's speakers, the user's
   microphone picks it up, and it re-enters the meeting — an audio feedback loop.
3. The bot leaves when **the user** leaves, not when the meeting empties. The tool must not
   record conversations the user is absent from.

---

## 5. Architecture

**Ports and adapters.** The domain core is pure TypeScript with no `chrome.*` and no DOM.
Every platform-specific concern sits behind an interface.

This is not ceremony. Two lint-enforced rules make the cloud port real rather than
aspirational:

1. `core/**` may not import from `adapters/**` or `extension/**` — enforced by
   `dependency-cruiser`.
2. `adapters/meet/**` may not reference the `chrome` global — enforced by
   `no-restricted-globals`.

Rule 2 guarantees the scraper and join automation run unchanged under Puppeteer. Without it,
one stray `chrome.storage` call silently kills the cloud path months later.

### 5.1 Module layout

```
src/
  core/                            # pure TS — no chrome, no DOM
    types/                         # domain models
    ports/                         # interfaces only
    summarization/                 # MapReduceSummarizer, chunker, prompts, schema
    minutes/                       # MoM assembly and validation
  adapters/
    meet/
      MeetCaptionScraper.ts        # DOM only — portable to Puppeteer
      MeetJoinAutomation.ts        # DOM only — portable to Puppeteer
      selectors.ts                 # ← every Google DOM assumption, one file
    llm/
      OpenAiCompatibleClient.ts
    storage/
      IndexedDbTranscriptRepository.ts
      ChromeSettingsStore.ts
    bot/
      ChromeTabBot.ts              # chrome.tabs lifecycle
  extension/                       # the only place chrome.* lives broadly
    background/                    # service worker: composition root + orchestration
    content/meet-detector/         # runs on the user's Meet tab
    content/bot-agent/             # runs on the bot tab
    ui/                            # meetings list, meeting detail, settings
  shared/
    messaging/                     # discriminated-union message bus
```

`selectors.ts` isolates every Google DOM assumption. When Meet ships a change, that is the
only file to touch.

Adapters are constructor-injected. Nothing imports a concrete singleton. The service worker
is the sole composition root.

---

## 6. Core interfaces

```ts
// core/types/transcript.ts
export type TranscriptSourceKind =
  | 'meet-captions'
  | 'teams-captions'      // future
  | 'audio-whisper';      // future

export interface TranscriptSegment {
  readonly id: string;              // stable per caption block
  readonly final: boolean;          // Meet rewrites caption text in place
  readonly speaker: string | null;  // null tolerated — audio sources may not know
  readonly text: string;
  readonly tStart: number;          // seconds from meeting start
  readonly tEnd: number;
  readonly source: TranscriptSourceKind;
  readonly confidence?: number;     // audio sources only
}

export type SessionStatus =
  | 'joining' | 'in-lobby' | 'capturing'
  | 'ended' | 'summarizing' | 'complete' | 'failed';

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
```

```ts
// core/ports/TranscriptSource.ts  ← the portable seam
export interface TranscriptSource {
  readonly kind: TranscriptSourceKind;
  start(sink: SegmentSink): Promise<void>;
  stop(): Promise<void>;
  health(): SourceHealth;
}

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
```

`upsert` plus `final` models Meet's in-place caption rewriting directly: the scraper needs no
diff logic, and the live view gets interim text for free.

```ts
// core/ports/MeetingBot.ts       ChromeTabBot now → PuppeteerBot in cloud
export interface MeetingBot {
  join(req: JoinRequest): Promise<JoinResult>;
  leave(): Promise<void>;
  onEnded(cb: (reason: EndReason) => void): Unsubscribe;
}

export interface JoinRequest {
  readonly meetingCode: string;
  readonly accountIndex: number;    // Google authuser index
  readonly displayNameHint?: string;
}

export type EndReason =
  | 'user-left' | 'bot-removed' | 'meeting-ended'
  | 'tab-closed' | 'lobby-timeout' | 'error';
```

```ts
// core/ports/TranscriptRepository.ts   IndexedDb now → Http in cloud
export interface TranscriptRepository {
  createSession(s: MeetingSession): Promise<void>;
  updateSession(id: string, patch: Partial<MeetingSession>): Promise<void>;
  appendSegments(id: string, segs: readonly TranscriptSegment[]): Promise<void>;
  getSegments(id: string): Promise<readonly TranscriptSegment[]>;
  saveMinutes(id: string, m: MeetingMinutes): Promise<void>;
  getMinutes(id: string): Promise<MeetingMinutes | null>;
  listSessions(): Promise<readonly MeetingSession[]>;
  deleteSession(id: string): Promise<void>;
}
```

```ts
// core/ports/LlmClient.ts        OpenAiCompatibleClient — the only implementation
export interface LlmClient {
  complete(req: CompletionRequest): Promise<CompletionResult>;
  listModels(): Promise<readonly ModelInfo[]>;
  health(): Promise<HealthResult>;
}

export interface CompletionRequest {
  readonly messages: readonly ChatMessage[];
  readonly jsonSchema?: object;     // best-effort; never depended upon
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly signal?: AbortSignal;
}
```

```ts
// core/ports/Summarizer.ts       MapReduceSummarizer(llm: LlmClient)
export interface Summarizer {
  summarize(
    segs: readonly TranscriptSegment[],
    opts: SummarizeOptions,
  ): Promise<MeetingMinutes>;
}

export interface SummarizeOptions {
  readonly speakers: readonly string[];   // constrains action-item owners
  readonly contextTokens: number;
  readonly onProgress?: (done: number, total: number) => void;
  readonly signal?: AbortSignal;
}
```

```ts
// core/ports/SettingsStore.ts
export interface SettingsStore {
  get(): Promise<Settings>;
  set(patch: Partial<Settings>): Promise<void>;
  onChange(cb: (s: Settings) => void): Unsubscribe;
}

// core/ports/Clock.ts — injected for deterministic tests
export interface Clock { now(): number; }
```

---

## 7. Runtime flow

```
User opens meet.google.com/abc-defg-hij
  → meet-detector (content script) → service worker
  → SW renders "Baithak joining… cancel?" toast in the user's tab (5s)
  → SW: tabs.create({ url: "…?authuser=<botIndex>", active: false })
       + tabs.update({ muted: true })            ← before media starts
  → bot-agent (content script on bot tab):
       pre-join screen → mic off, cam off → click Join
  → if lobby: poll until admitted (3 min timeout → notify user to admit)
  → click captions control by aria-label
       → verify caption container appeared
       → retry with exponential backoff, max 5 attempts
  → MeetCaptionScraper mounts MutationObserver
       ↓ segments, batched every 2s or 20 segments
  → SW → IndexedDbTranscriptRepository
  → user leaves meeting (see §7.1)
  → SW closes bot tab → session status 'ended'
  → MapReduceSummarizer → LlmClient → saveMinutes
  → chrome notification: "Minutes ready — <meeting title>"
```

### 7.1 Detecting that the user left

`meet-detector` on the user's tab treats **any** of the following as the user having left,
whichever fires first:

- the tab navigates away from `/xxx-yyyy-zzz` (Meet routes to a post-call screen on leave);
- the post-call "You left the meeting" / "Return to home screen" view appears;
- the tab is closed — detected by the service worker via `chrome.tabs.onRemoved`;
- the `chrome.runtime` port from the content script disconnects.

Belt-and-braces because any single signal can be missed if the service worker was asleep. All
four converge on the same handler, which is idempotent — a session already `ended` ignores
repeat signals.

**Independent backstop:** if the bot tab observes no new caption segments for 15 minutes
*and* its participant count drops to one, it ends the session itself. This prevents an
orphaned bot sitting in an empty meeting indefinitely if every user-side signal is missed.

### 7.2 Session identity and title

- **Session id:** `crypto.randomUUID()`, assigned when the toast is confirmed, before the bot
  tab is created — so segments always have a session to attach to.
- **Title:** read from the Meet tab's `document.title` (Meet sets it to the calendar event
  name when the meeting originates from an invite), falling back to the meeting code. The
  title is captured at join time and is editable in the meeting detail UI, since Meet does
  not reliably expose one for ad-hoc calls.

---

## 8. Caption scraping mechanics

Google Meet keeps a **rolling window of roughly three speaker blocks** and **rewrites the
text of a block in place** as its ASR refines the utterance — `"I think we should"` becomes
`"I think we should ship Friday"` in the same node.

The scraper therefore must not append on every mutation. It:

1. Assigns each visible caption block a stable `id` derived from its DOM node identity plus
   the speaker name and first-seen timestamp.
2. On mutation, re-reads the block and `upsert`s with `final: false`.
3. When a block leaves the rolling window, emits a final `upsert` with `final: true`.
4. On unmount (meeting end), finalises every still-open block.

Timestamps: `tStart` is recorded when the block is first observed, `tEnd` when it is
finalised, both relative to session start.

**Requirement:** the user's dedicated bot account must have captions enabled. The extension
clicks the control automatically; on Meet this is a per-viewer client-side setting, so no
host permission is needed.

---

## 9. Storage

**IndexedDB**, not `chrome.storage.local` — the latter caps around 10MB and transcripts
accumulate quickly.

Object stores:
- `sessions` — keyed by session id, indexed by `startedAt`
- `segments` — keyed by `[sessionId, seq]`, indexed by `sessionId`
- `minutes` — keyed by session id

Segments are written in batches (2s or 20 segments, whichever first) to avoid a transaction
per caption mutation.

**Retention:** indefinite, with per-meeting delete in the UI. No auto-purge in v1.

---

## 10. LLM provider layer

One client speaking **OpenAI Chat Completions**. Ollama is not a special case — it is a
profile.

```ts
interface ProviderProfile {
  id: string;
  label: string;              // "Local Ollama"
  baseUrl: string;            // "http://localhost:11434/v1"
  apiKey: string;             // Ollama ignores it; field kept for uniformity
  model: string;              // "qwen3:14b"
  contextTokens: number;      // default 4096 — conservative
}
```

Settings UI: **Base URL + API key + Model**, with one-click presets (Local Ollama, OpenAI,
Groq, OpenRouter, Together, Custom). On save, the client calls `GET {baseUrl}/models` to
validate the connection and populate the model dropdown.

### 10.1 Portability rules

**Never depend on `json_schema`.** It works on Ollama 0.18 and on OpenAI, but support is
uneven across providers. The client sends the schema *and* prompts for JSON *and* parses
defensively: extract the first balanced `{…}`, attempt repair, retry once with a stricter
prompt, and only then fall back to storing the raw text rather than discarding the result.

**Chunk against `contextTokens`, not the provider's real limit.** Ollama's OpenAI-compatible
layer does not accept `num_ctx`, so context cannot be raised through this API. Because
summarization is map-reduce, chunks stay well under the default and this never matters.

### 10.2 The Ollama 403

Ollama rejects `chrome-extension://` origins by default (verified, §3). Onboarding runs a
live connection test and, on a 403 from a localhost endpoint, displays the fix with the
extension's real ID substituted:

```bash
launchctl setenv OLLAMA_ORIGINS "chrome-extension://<chrome.runtime.id>"
# then restart Ollama
```

This is the default path: one-time, 30 seconds, and it is the sanctioned mechanism.

**Rejected as default:** a `declarativeNetRequest` rule stripping the `Origin` header would
make it work with zero configuration, but Ollama blocks extension origins deliberately — to
prevent arbitrary extensions using the local model. Silently stripping the header defeats
that protection. It may ship behind an explicit opt-in toggle with a plain-language warning.

---

## 11. Summarization

**Map:** transcript → chunks aligned to speaker boundaries with ~15% overlap → per-chunk
structured notes.
**Reduce:** concatenate chunk notes → final minutes. If the notes themselves exceed the
budget, reduce recursively.

Rationale: Ollama silently truncates input exceeding `num_ctx` without erroring, so a
single-prompt approach would quietly lose the second half of a long meeting. Map-reduce is
robust regardless of provider and produces better output on long transcripts.

### 11.1 Output schema

```json
{
  "summary": "3-5 sentence narrative",
  "topics": [
    { "title": "…", "points": ["…"], "speakers": ["…"] }
  ],
  "decisions": [
    { "decision": "…", "context": "…" }
  ],
  "actionItems": [
    { "owner": "Priya Nair", "task": "…", "due": null, "quote": "…" }
  ],
  "openQuestions": ["…"]
}
```

- `owner` is constrained to the actual speaker list passed in `SummarizeOptions`, or
  `"Unassigned"`. Without this constraint a 7B model invents participants.
- `quote` anchors each action item to real transcript text. This is what makes output
  trustworthy at local-model quality — the user can verify any claim against the source.

---

## 12. UI

Three surfaces, all in-extension:

- **Popup** — current meeting status, cancel/stop notetaker, link to the meetings list.
- **Meetings list** — date, title, duration, participants, status. Per-meeting delete.
- **Meeting detail** — summary, topics, decisions, per-person action items, open questions,
  and the full transcript. **Copy as Markdown** and **Download .md**. **Re-run summary**
  button (re-summarizes from stored segments, useful after changing model or provider).
- **Settings** — provider profiles, bot account index, connection test, join behaviour.

---

## 13. Failure handling

The through-line: **capture and summarization are independently durable.** Capture never
blocks on the LLM, and a failed summary is always re-runnable from stored segments.

| Failure | Behaviour |
|---|---|
| LLM unreachable / errors | Transcript already saved. Summary queued, "Retry" in UI. Never lose a meeting to a down model |
| Bot not admitted within 3 min | Notify in the user's tab; keep polling until meeting ends |
| Captions never appear | Explicit "captions not detected" error surfaced in the popup — never a silent empty transcript |
| Meet DOM changed | Scraper self-checks selectors on mount; `SourceHealth.selectorsMatched === false` reports loudly |
| Bot tab closed manually | SW detects, marks session ended, summarizes what it has |
| Bot removed from meeting | Same as above, `EndReason: 'bot-removed'` |
| Unparseable JSON from LLM | Repair → one stricter retry → store raw text |
| Service worker terminated mid-meeting | State rehydrated from `chrome.storage.session` (§14) |

---

## 14. MV3 constraints

**Service workers terminate after ~30 seconds idle.** Module-level state in the background
script will vanish during a quiet stretch of a meeting. Two mitigations, both required:

1. All session state persists to `chrome.storage.session` and rehydrates on wake.
2. The bot tab holds a long-lived `chrome.runtime.connect` port, which keeps the worker
   alive while connected.

**Typed messaging.** `chrome.runtime.sendMessage` is `any` by default. All messages are a
discriminated union with an exhaustive `switch` in the handler, making every message contract
a compile-time check.

```ts
type Message =
  | { type: 'MEETING_DETECTED'; meetingCode: string; tabId: number }
  | { type: 'JOIN_CANCELLED';   meetingCode: string }
  | { type: 'BOT_STATE';        sessionId: string; status: SessionStatus }
  | { type: 'SEGMENT_BATCH';    sessionId: string; segments: TranscriptSegment[] }
  | { type: 'SOURCE_HEALTH';    sessionId: string; health: SourceHealth }
  | { type: 'USER_LEFT';        meetingCode: string };
```

---

## 15. Permissions and security

**Host permissions.** The LLM endpoint is user-supplied and cannot be declared at build time.
Use `optional_host_permissions` and call `chrome.permissions.request()` when a profile is
saved — avoiding a broad install-time prompt.

Manifest permissions: `tabs`, `storage`, `notifications`, `scripting`,
`declarativeNetRequestWithHostAccess` (only if the Origin-strip toggle ships).

**API keys** are stored in `chrome.storage.local`, never `chrome.storage.sync` — secrets must
not replicate across devices. The settings UI states plainly that extension storage is not
encrypted and anything with access to the Chrome profile can read it.

**Consent.** The bot is a visible meeting participant, which is inherently disclosing. The
onboarding flow states the user's responsibility to comply with local recording-consent law
and organisational policy.

---

## 16. Testing strategy

- **`core/**`** — Vitest with fake ports. No browser, runs in milliseconds. Covers chunking,
  reduce recursion, JSON repair, minutes validation, owner constraint enforcement.
- **`MeetCaptionScraper` against saved HTML fixtures.** Capture the real caption DOM once from
  a live meeting, including the rewrite-in-place and rolling-window behaviour. From then on,
  Google's DOM changes are regression-tested without joining a call. **This is the
  highest-leverage test in the project.**
- **`OpenAiCompatibleClient`** — against a local mock server plus one live smoke test against
  Ollama.
- **E2E** — Playwright over the join flow, optional and lower priority.

## 17. Tooling

- **WXT** — TypeScript-first MV3 framework; handles manifest generation, content-script
  bundling, and HMR. Preferred over a hand-rolled Vite + `@crxjs` config.
- TypeScript `strict: true`.
- `dependency-cruiser` for layer rules; ESLint `no-restricted-globals` for the
  `adapters/meet/**` chrome-free rule.
- Vitest.

---

## 18. Future direction

The design deliberately admits three extensions without restructuring:

1. **Cloud** — `ChromeTabBot` → `PuppeteerBot`, `IndexedDbTranscriptRepository` →
   `HttpTranscriptRepository`. `MeetCaptionScraper` and `MeetJoinAutomation` move unchanged.
2. **Teams** — a second DOM adapter implementing `TranscriptSource`. Teams web exposes live
   captions with speaker names, and captions are a per-viewer setting as on Meet.
3. **Zoom / audio fallback** — an audio adapter implementing the same `TranscriptSource`.
   Necessary for Zoom specifically, where live transcript is **host-controlled** and cannot be
   enabled unilaterally. This is why `speaker` is nullable and `confidence` exists on
   `TranscriptSegment`: downstream must already tolerate unattributed segments and degrade to
   an "unattributed items" section in the minutes.

---

## 19. Decisions log

| Decision | Rationale | Alternative rejected |
|---|---|---|
| Meet captions, not audio + Whisper | Only approach giving correct speaker names with zero heuristics; per-person action items depend on it | Diarization yields anonymous `SPEAKER_00` labels, which cannot produce per-person actions |
| Dedicated bot account in a second tab | Join + caption automation ports to a headless cloud bot | Scraping the user's own tab with CSS-hidden captions is simpler and solves distraction, but exercises none of the cloud path |
| Auto-detect with 5s cancellable toast | Zero-friction for the common case; nothing to remember; still skippable for sensitive calls | Manual button gets forgotten; calendar-driven needs OAuth and is v2 |
| OpenAI-compatible only | Ollama serves `/v1` and ignores the API key — verified. One code path for local and hosted | Native Ollama API would need a second client and forfeit hosted providers |
| Map-reduce summarization | Ollama truncates silently past `num_ctx`, and `num_ctx` is unreachable via the OpenAI layer | Single prompt loses the tail of long meetings with no error |
| IndexedDB | `chrome.storage.local` caps ~10MB | — |
| Ports and adapters with lint enforcement | Convention alone will not survive months of feature work; one stray `chrome.*` call kills the cloud port | Plain layering |
| Bot leaves when the user leaves | Do not record conversations the user is absent from | Recording until the meeting empties |
| `OLLAMA_ORIGINS` guidance over Origin-stripping | Ollama blocks extension origins deliberately; stripping silently defeats a real protection | DNR header strip, available behind explicit opt-in |
