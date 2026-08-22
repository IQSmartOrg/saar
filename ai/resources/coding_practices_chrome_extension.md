# Chrome Extension (Manifest V3) Practices

Saar is a Manifest V3 extension built with WXT (`wxt.config.ts`). The rules
below are the ones this codebase already enforces — via ESLint,
dependency-cruiser, or the manifest itself — not general internet advice.
Read `wxt.config.ts` before touching permissions or the manifest; it already
explains, permission by permission, why each one is there.

## Permissions: minimal, and justified in the manifest's own comments

- Every entry in `permissions` and `host_permissions` must be exercised by
  code that ships, and the Chrome Web Store review will ask about each one —
  see `wxt.config.ts`'s permissions block for the standing justification of
  `tabs`, `storage`, `notifications`, `alarms`, and the
  `https://meet.google.com/*` host permission.
- New permissions that aren't yet used get removed, not left "for later" —
  `scripting` was declared once and dropped for exactly this reason.
- Anything host-scoped that isn't required at install belongs in
  `optional_host_permissions`, requested at the moment the feature needing
  it is turned on (see how AI summaries request the user's chosen provider
  host only when "Summarise with AI" is enabled) — never widen
  `host_permissions` to cover a case only some users hit.

## MV3 service worker lifetime

- The background service worker is not persistent. A `setTimeout` inside it
  dies the moment Chrome kills the worker — anything that must survive
  worker termination (the stop-signal watchdog, resumable jobs) is built on
  `chrome.alarms`, not `setTimeout`/`setInterval`.
- Session state that must survive a worker restart goes in
  `chrome.storage.session` or `.local`, not a module-level variable — module
  state does not survive termination either.

## Storage: `local` vs `sync`, and never conflate them

- Settings, including any API key, are stored in `chrome.storage.local` and
  never `chrome.storage.sync` — `sync` replicates to every device signed
  into the user's Google account, and a secret should not travel. See
  `ChromeSettingsStore`.
- Don't add a new persisted field to `sync` without the same reasoning check:
  would this be bad to silently replicate to another machine?

## No remote code execution

MV3 forbids executing code that isn't part of the reviewed package — no
dynamically fetched `<script>`, no `eval` of remote content, no dynamic
`import()` of a URL. Fetching data (JSON, an image, plain text) and
rendering it with local code is fine; fetching and executing script from
anywhere off-package is not, and the Store review will reject it.

## Tabs opened by the extension: mute anything that isn't the user

Any tab the extension opens on the user's behalf that could produce audio
(the Meet notetaker tab) must be muted via `tabs.update({ muted: true })`
before it can make sound — an unmuted bot tab plays the meeting out the
speakers and re-enters the call through the user's own microphone as a
feedback loop. This is why `tabs` is a required permission rather than
something to avoid.

## Architecture boundaries (enforced by `.dependency-cruiser.cjs` and ESLint)

This isn't Chrome-specific advice in general, but it is specific to how this
extension stays testable and portable, and it's enforced, not a suggestion:

- **Domain modules** (`src/meet`, `capture`, `session`, `minutes`,
  `processing`, `storage`, `settings`, `messaging`, `utils`) must not import
  from `src/entrypoints`, `agents`, `background`, or `ui`. They know nothing
  about Chrome or the extension shell.
- **`src/meet` must run unchanged under Puppeteer** — no extension-specific
  module, and ESLint bans the bare `chrome` global inside `src/meet` and
  `src/utils` entirely (`no-restricted-globals`). Chrome-shaped wiring around
  Meet automation belongs in `src/agents`.
- **`src/processing`** (the summarisation pipeline) is chrome-free except for
  `src/processing/job`, which is the one place allowed to persist/schedule
  against `chrome.*` — same ESLint rule, scoped to that one subdirectory.
- **`src/utils` is leaf code** — it may depend on nothing else under `src/`.
  If a "util" needs a dependency, it isn't a util; it belongs in a module.
- **`src/ui` is presentation only** — it must not reach into storage, the
  model/processing layer, the background worker, or agents.
- No circular imports, and no orphaned files outside `src/entrypoints`
  (`no-orphans` warns on a file nothing imports — usually dead code or a
  missing wire-up).

Run `npm run deps` to check these boundaries and `npm run check` (typecheck +
lint + deps + tests) before considering a change done.
