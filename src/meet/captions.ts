import { CAPTION_SELECTORS, MEET_CONTROLS } from '@/meet/controls';
import { resolveControl, type MatchStrategy } from '@/meet/resolve';
import { sleep as realSleep, type Sleep } from '@/utils/sleep';

/**
 * Turning Meet's live captions on.
 *
 * Pure DOM — no `chrome.*`. Captions are a per-viewer client-side setting, so
 * no host permission and no meeting-host cooperation is needed.
 *
 * Only concerned with *enabling* captions. Reading them back out is a separate
 * problem and lives in CaptionScraper.ts.
 */

/**
 * The caption region only exists in the DOM while captions are on, which makes
 * it a definitive, language-independent readout — unlike the toggle's "Turn on
 * captions" label, which is localised.
 */
export function captionsAreOn(doc: Document, region: string = CAPTION_SELECTORS.region): boolean {
  return doc.querySelector(region) !== null;
}

export interface EnableCaptionsResult {
  readonly ok: boolean;
  /** Which resolver layer found the CC control, or 'none'. */
  readonly matchedBy: MatchStrategy | 'none';
  /** True when captions were already on and nothing was clicked. */
  readonly alreadyOn: boolean;
}

/**
 * Single attempt. Never clicks an already-on toggle: that turns captions back
 * off and silently kills capture.
 */
export function enableCaptions(doc: Document): EnableCaptionsResult {
  if (captionsAreOn(doc)) {
    return { ok: true, matchedBy: 'none', alreadyOn: true };
  }

  const hit = resolveControl(doc, MEET_CONTROLS.captions);
  if (!hit) {
    return { ok: false, matchedBy: 'none', alreadyOn: false };
  }

  hit.el.click();
  return { ok: true, matchedBy: hit.matchedBy, alreadyOn: false };
}

export interface StartCaptionsOptions {
  readonly retries?: number;
  readonly sleep?: Sleep;
  /** How many times to poll for the region to mount after clicking CC. */
  readonly settleAttempts?: number;
  readonly settlePollMs?: number;
}

export interface StartCaptionsOutcome {
  readonly ok: boolean;
  readonly attempts: number;
  readonly matchedBy: MatchStrategy | 'none';
  readonly error?: string;
}

export const DEFAULT_CAPTION_RETRIES = 5;
export const DEFAULT_SETTLE_ATTEMPTS = 20;
export const DEFAULT_SETTLE_POLL_MS = 250;

/**
 * Enables captions and does not return ok until the caption region is actually
 * in the DOM.
 *
 * Waiting for the region is the whole point, not a nicety. Meet mounts it
 * asynchronously after the CC click, so an earlier version that returned as
 * soon as it clicked handed control straight back to the scraper, which looked
 * for a region that did not exist yet, silently attached no observer, and
 * captured nothing for the entire meeting while reporting "capturing".
 *
 * Two nested budgets:
 *   retries  — the CC control itself may not have mounted (1s/2s/4s/8s backoff)
 *   settle   — the control was clicked; wait for the region it creates
 */
export async function startCaptions(
  doc: Document,
  opts: StartCaptionsOptions = {},
): Promise<StartCaptionsOutcome> {
  const {
    retries = DEFAULT_CAPTION_RETRIES,
    sleep = realSleep,
    settleAttempts = DEFAULT_SETTLE_ATTEMPTS,
    settlePollMs = DEFAULT_SETTLE_POLL_MS,
  } = opts;

  let matchedBy: MatchStrategy | 'none' = 'none';
  let everClicked = false;

  for (let attempt = 0; attempt < retries; attempt++) {
    const result = enableCaptions(doc);

    if (result.ok) {
      matchedBy = result.matchedBy;
      everClicked = true;

      // Already on: region is present by definition, nothing to wait for.
      if (result.alreadyOn) {
        return { ok: true, attempts: attempt + 1, matchedBy };
      }

      for (let i = 0; i < settleAttempts; i++) {
        if (captionsAreOn(doc)) {
          return { ok: true, attempts: attempt + 1, matchedBy };
        }
        await sleep(settlePollMs);
      }
      // Clicked, but no region appeared. Fall through and try again — the
      // click may have landed on a control that was not yet interactive.
    } else {
      matchedBy = result.matchedBy;
    }

    // No sleep after the final attempt — nothing would observe it.
    if (attempt < retries - 1) await sleep(1000 * 2 ** attempt);
  }

  return {
    ok: false,
    attempts: retries,
    matchedBy,
    error: everClicked
      ? 'clicked the captions control but the caption region never appeared'
      : 'captions control not found',
  };
}
