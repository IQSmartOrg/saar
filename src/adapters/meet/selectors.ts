/**
 * Every Google DOM assumption lives in this file. When Meet ships a change,
 * this should be the only file that needs editing.
 *
 * ⚠️ UNVERIFIED — these are the starting hypothesis from spec §8, not values
 * observed in a live meeting. Task 0 of the phase-1 plan confirms or corrects
 * them and records the result in docs/superpowers/notes/meet-dom-findings.md.
 * The scraper's *logic* is tested against synthetic DOM matching this shape;
 * only the selector strings themselves are pending confirmation.
 */
export interface MeetSelectors {
  readonly captionRegion: string;
  readonly captionBlock: string;
  readonly blockSpeaker: string;
  readonly blockText: string;
}

export const MEET_SELECTORS: MeetSelectors = {
  captionRegion: '[aria-live="polite"]',
  captionBlock: '[data-speaker-block], .saar-caption-block',
  blockSpeaker: '[data-speaker-name], .saar-caption-speaker',
  blockText: '[data-speaker-text], .saar-caption-text',
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
