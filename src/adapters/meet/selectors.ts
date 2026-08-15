/**
 * Every Google DOM assumption lives in this file. When Meet ships a change,
 * this should be the only file that needs editing.
 *
 * Strategy: semantic attributes first (role/aria-label survive redesigns),
 * obfuscated class names second (accurate but rotate without notice).
 * `querySelector` with a comma list takes the first match in document order,
 * which is fine here because only one variant exists at a time.
 *
 * Class names cross-checked against two independent open-source scrapers,
 * 2026-08: yunho0130/google-meet-cc-to-srt and s-anand.net's caption recorder.
 * Both report .nMcdL.bj4p3b (block) / .NWpY1d (speaker) / .ygicle.VbkSUe (text).
 *
 * ⚠️ Not yet confirmed against a live meeting on this machine — Task 0 of the
 * phase-1 plan does that and records the result in
 * docs/superpowers/notes/meet-dom-findings.md.
 *
 * NOTE: the caption region does not exist in the DOM until captions are turned
 * on. A selector miss before that is expected, not a failure.
 */
export interface MeetSelectors {
  readonly captionRegion: string;
  readonly captionBlock: string;
  readonly blockSpeaker: string;
  readonly blockText: string;
}

export const MEET_SELECTORS: MeetSelectors = {
  // Strict on purpose. A bare [aria-live="polite"] fallback here was a real
  // bug: Meet keeps a general announcement region with that attribute whether
  // captions are on or off, so it made captionsAreOn() always true — the CC
  // button was never clicked and the scraper watched the wrong node. The
  // legacy fallback now lives in MeetCaptionScraper.region(), where it can
  // require an actual caption block to be present.
  captionRegion: '[role="region"][aria-label*="aption" i]',
  captionBlock: '.nMcdL.bj4p3b, .nMcdL',
  // .xoMHSc is a second speaker-badge class Recall.ai's bot also matches.
  blockSpeaker: '.NWpY1d, .xoMHSc',
  blockText: '.ygicle.VbkSUe, .ygicle',
};

import type { ControlSpec } from '@/adapters/meet/resolve';

/**
 * Controls resolved through the prioritised chain in resolve.ts.
 *
 * jsname and icon values were read off a live Meet session on 2026-08-05 and
 * are language-independent; aria and text are English-only fallbacks. Prefer
 * adding a jsname or icon over another aria regex — the first two survive both
 * CSS churn and non-English UIs.
 */
export interface MeetControls {
  readonly mic: ControlSpec;
  readonly camera: ControlSpec;
  readonly captions: ControlSpec;
  readonly leave: ControlSpec;
  readonly join: ControlSpec;
}

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
    // so this one control is genuinely English-only. MeetJoinAutomation falls
    // back to pressing Enter, which Meet treats as "join" in any language.
    text: ['join now', 'ask to join', 'join anyway', 'join meeting', 'join'],
    aria: /^(join now|ask to join)/i,
  },
};

/** Selectors for things that are detected rather than clicked. */
export interface StateSelectors {
  readonly lobbyIndicator: string;
  readonly participantTile: string;
}

export const MEET_STATE_SELECTORS: StateSelectors = {
  lobbyIndicator: '[data-lobby], [aria-label*="Asking to join" i]',
  // Deliberately NOT [data-requested-participant-id]: that is on the pre-join
  // self-preview tile, so including it makes isInCall() true before we have
  // joined anything.
  participantTile: '[data-participant-id]',
};
