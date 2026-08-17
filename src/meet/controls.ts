/**
 * Every assumption Saar makes about Google Meet's DOM, in one file.
 *
 * When Meet ships a change this should be the only file that needs editing.
 * Nothing here executes — these are descriptions of what to look for, resolved
 * by `resolve.ts` and used by `join.ts`, `captions.ts` and `CaptionScraper.ts`.
 *
 * There used to be two independent copies of this (`selectors.ts` alongside an
 * inline set in `join.ts`), each with its own resolver, and editing one did not
 * affect the other. That is exactly the drift this file exists to prevent.
 */

export interface ControlSpec {
  /** Values for the jsname attribute, most likely first. */
  readonly jsname?: readonly string[];
  /** Material icon ligature names appearing inside the control. */
  readonly icon?: readonly string[];
  /** Matched against aria-label. Localised — English UIs only. */
  readonly aria?: RegExp;
  /** Lowercased visible labels, most specific first. Localised. */
  readonly text?: readonly string[];
  /** Raw CSS fallback. */
  readonly css?: string;
}

export interface MeetControls {
  readonly mic: ControlSpec;
  readonly camera: ControlSpec;
  readonly captions: ControlSpec;
  readonly leave: ControlSpec;
  readonly join: ControlSpec;
}

/**
 * jsname and icon values were read off a live Meet session and are
 * language-independent; aria and text are English-only fallbacks. Prefer adding
 * a jsname or icon over another aria regex — the first two survive both CSS
 * churn and non-English UIs.
 */
export const MEET_CONTROLS: MeetControls = {
  mic: {
    jsname: ['hw0c9'],
    icon: ['mic', 'mic_off'],
    aria: /microphone/i,
  },
  camera: {
    jsname: ['psRWwc'],
    icon: ['videocam', 'videocam_off'],
    aria: /camera/i,
  },
  captions: {
    jsname: ['RrG0hf'],
    icon: ['closed_caption', 'closed_caption_off', 'closed_caption_disabled'],
    // "caption settings" must not match, hence the plural.
    aria: /captions/i,
  },
  // "Leave call" exists only once you are actually in the meeting — not on the
  // pre-join screen and not while waiting for admission. Together with the
  // captions control it is the evidence isInCall() relies on.
  leave: {
    jsname: ['CQylAd'],
    icon: ['call_end'],
    aria: /leave call/i,
  },
  join: {
    // The join button carries no stable jsname or icon — text is all there is,
    // so this one control is genuinely English-only. clickJoin() falls back to
    // pressing Enter, which Meet treats as "join" in any language.
    text: ['join now', 'ask to join', 'join anyway', 'join meeting', 'join'],
    aria: /^(join now|ask to join)/i,
  },
};

/** Waiting to be admitted by the host. Detected, never clicked. */
export const LOBBY_INDICATOR = '[data-lobby], [aria-label*="Asking to join" i]';

/**
 * The live-caption DOM.
 *
 * Class names cross-checked against two independent open-source scrapers:
 * yunho0130/google-meet-cc-to-srt and s-anand.net's caption recorder. Both
 * report .nMcdL.bj4p3b (block) / .NWpY1d (speaker) / .ygicle.VbkSUe (text),
 * and all four were confirmed against a live meeting on 2026-08-15.
 *
 * The region does not exist in the DOM until captions are turned on, which is
 * what makes it a definitive, language-independent readout of whether they are.
 * A miss before that is expected, not a failure.
 */
export interface CaptionSelectors {
  readonly region: string;
  readonly block: string;
  readonly speaker: string;
  readonly text: string;
}

export const CAPTION_SELECTORS: CaptionSelectors = {
  // Strict on purpose. A bare [aria-live="polite"] fallback here was a real
  // bug: Meet keeps a general announcement region with that attribute whether
  // captions are on or off, so it made captionsAreOn() always true — the CC
  // button was never clicked and the scraper watched the wrong node. The
  // legacy fallback lives in CaptionScraper.region(), where it can require an
  // actual caption block to be present.
  region: '[role="region"][aria-label*="aption" i]',
  block: '.nMcdL.bj4p3b, .nMcdL',
  // .xoMHSc is a second speaker-badge class Recall.ai's bot also matches.
  speaker: '.NWpY1d, .xoMHSc',
  text: '.ygicle.VbkSUe, .ygicle',
};
