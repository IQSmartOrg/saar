import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  // Not the default '.output': a dot-directory is hidden in the macOS file
  // picker, which makes "Load unpacked" needlessly fiddly.
  outDir: 'dist',
  // The Chrome Web Store listing is generated from this block, so every field
  // below is either required by the store or answers a question a reviewer will
  // otherwise ask. Nothing here is decorative.
  manifest: {
    name: 'Saar',
    // Shown under the icon on the extensions page, where the full name is
    // truncated. The store allows 12 characters.
    short_name: 'Saar',
    // Store limit is 132 characters, and it is shown in full in search results.
    description: 'AI note-taking for your meetings. Joins your Google Meet calls, records captions, writes the minutes.',
    homepage_url: 'https://iqsmartorg.github.io/saar/',
    // Owned by .github/workflows/release.yml, which rewrites it (via
    // scripts/set-version.mjs) on the release branch it cuts. It is NOT kept in
    // step on main and is not meant to be — the release workflow writes this
    // value and never reads it, so what is committed here only labels local
    // dev builds. The git tags are the record of what has actually shipped.
    version: '0.1.4',
    /**
     * Chrome ignores an update whose version is not higher than the installed
     * one, and it refuses to install below this floor at all.
     *
     * 111 because the UI is built on `color-mix()`, which lands there. Below it
     * every chip and progress bar loses its background — the extension still
     * works, but it looks broken, which is worse than refusing to install.
     * Everything else we rely on is older: `chrome.storage.session` is 102,
     * `optional_host_permissions` 101. `text-wrap: balance` (114) is the one
     * thing above the floor, and it degrades to ordinary wrapping.
     */
    minimum_chrome_version: '111',

    /**
     * Four permissions, and the store will ask about each:
     *
     *   tabs          opening the notetaker tab MUTED. Muting via
     *                 `tabs.update({muted})` is the permission-bearing part, and
     *                 it is not optional: an unmuted bot tab plays the meeting
     *                 out the speakers, the user's mic picks it up, and it
     *                 re-enters the call as a feedback loop.
     *   storage       settings, resumable summarisation jobs, live session state
     *   notifications "transcript saved", "minutes ready", and every failure —
     *                 the only way to reach someone whose popup is shut
     *   alarms        the stop-signal watchdog. A setTimeout in an MV3 worker
     *                 dies with the worker, so the liveness guarantee needs an
     *                 alarm to survive termination.
     *
     * `scripting` was declared here and never used — both content scripts are
     * declared statically. Removed: the store rejects permissions the code does
     * not exercise, and rightly.
     */
    permissions: ['tabs', 'storage', 'notifications', 'alarms'],

    // The only site Saar reads or acts on. Everything it does happens in a Meet
    // tab; it has no access to any other page.
    host_permissions: ['https://meet.google.com/*'],
    /**
     * OPTIONAL, and the field a store reviewer will look at hardest.
     *
     * Saar sends transcripts to whichever model endpoint the user configures,
     * and that endpoint is theirs to choose — a self-hosted vLLM, a company
     * gateway, anything OpenAI-compatible. It cannot be enumerated at build
     * time, hence the wildcard.
     *
     * What keeps that defensible:
     *   - It is optional. Nothing is granted at install; Chrome never shows a
     *     "read your data on all websites" prompt for it.
     *   - It is requested at the moment the user turns AI summaries on, for the
     *     one origin their URL resolves to (`https://api.openai.com/*`), never
     *     the wildcard itself.
     *   - AI summaries are off by default. Someone who only wants transcripts
     *     is never asked for this at all.
     *
     * The two localhost entries are what make a local Ollama work with NO
     * setup: Chrome omits the Origin header on requests to a host the extension
     * has permission for, so Ollama's extension-origin block never applies.
     * Verified 2026-08-15 against Ollama 0.18 — without the permission Chrome
     * sends `Origin: chrome-extension://<id>` and Ollama answers 403.
     */
    optional_host_permissions: ['http://localhost/*', 'http://127.0.0.1/*', 'https://*/*'],
    action: {
      default_popup: 'popup.html',
      default_title: 'Saar',
      // No `theme_icons` here: it is a Firefox/Safari feature only — Chrome's
      // `chrome.action` has no theme-aware icon support at all (no
      // `theme_icons`, no `onThemeChanged`, nothing; see w3c/webextensions#229,
      // still open). A Chrome build can only react to the OS theme from a
      // context with a DOM, which a service worker does not have, so instead
      // the toolbar icon is user-chosen via the `iconTheme` setting and applied
      // at runtime with `chrome.action.setIcon` — see `background/icon.ts`.
      // This is only the icon Chrome shows before that first runs; it matches
      // `iconTheme`'s default.
      default_icon: {
        16: '/icon-light-16.png',
        32: '/icon-light-32.png',
        48: '/icon-light-48.png',
        128: '/icon-light-128.png',
      },
    },
    icons: {
      16: '/icon-16.png',
      32: '/icon-32.png',
      48: '/icon-48.png',
      128: '/icon-128.png',
    },
  },
  // Resolved from the project root, not srcDir — '../assets' silently points
  // outside the repo and copies nothing.
  publicDir: 'assets',
});
