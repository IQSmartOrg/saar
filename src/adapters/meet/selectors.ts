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
  captionRegion: '[role="region"][aria-label*="aption" i], [aria-live="polite"]',
  captionBlock: '.nMcdL.bj4p3b, .nMcdL',
  blockSpeaker: '.NWpY1d',
  blockText: '.ygicle.VbkSUe, .ygicle',
};

export interface JoinControlSelectors {
  readonly micToggle: string;
  readonly cameraToggle: string;
  readonly joinButton: string;
  readonly lobbyIndicator: string;
  readonly captionsToggle: string;
  readonly participantTile: string;
}

export const JOIN_CONTROL_SELECTORS: JoinControlSelectors = {
  micToggle: '[aria-label*="microphone" i][role="button"]',
  cameraToggle: '[aria-label*="camera" i][role="button"]',
  joinButton: 'button, [role="button"], [jsname]',
  lobbyIndicator: '[data-lobby], [aria-label*="Asking to join" i]',
  captionsToggle: '[aria-label*="captions" i][role="button"]',
  participantTile: '[data-participant-id]',
};
