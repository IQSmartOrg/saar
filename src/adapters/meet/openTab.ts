/**
 * Opening a Meet link in a background tab as a chosen Google account.
 *
 * The only file in adapters/meet that touches `chrome.*`, and the sole
 * exemption from the folder's chrome-free ESLint rule (see eslint.config.js).
 * Everything else here stays extension-free so it runs unchanged under
 * Puppeteer or in a plain DOM test; concentrating the tab plumbing in one file
 * is what makes that possible.
 */

export interface OpenMeetTabRequest {
  readonly meetingCode: string;
  /** Google multi-login `authuser` index that identifies the account. */
  readonly accountIndex: number;
  /** Round-tripped through the URL so the content script knows which run it serves. */
  readonly sessionId?: string;
}

export interface OpenMeetTabResult {
  readonly ok: boolean;
  readonly tabId?: number;
  readonly url?: string;
  readonly error?: string;
}

/**
 * `?authuser=N` selects the Nth signed-in account in the profile. The index is
 * positional: it shifts whenever an account signs in or out, so callers must
 * re-validate it rather than trusting a stored value indefinitely.
 */
export function buildMeetUrl(code: string, accountIndex: number, sessionId?: string): string {
  const url = new URL(`https://meet.google.com/${code}`);
  url.searchParams.set('authuser', String(accountIndex));
  if (sessionId !== undefined) url.searchParams.set('saarSession', sessionId);
  return url.toString();
}

export async function openMeetTab(req: OpenMeetTabRequest): Promise<OpenMeetTabResult> {
  const url = buildMeetUrl(req.meetingCode, req.accountIndex, req.sessionId);

  try {
    const tab = await chrome.tabs.create({ url, active: false });
    if (tab.id === undefined) return { ok: false, url, error: 'tab has no id' };

    // Mute before any media can start — otherwise this tab plays meeting audio
    // out the speakers, the user's microphone picks it up, and it re-enters the
    // meeting as a feedback loop.
    await chrome.tabs.update(tab.id, { muted: true });

    return { ok: true, tabId: tab.id, url };
  } catch (e) {
    return { ok: false, url, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Idempotent: closing an already-closed tab is not an error. */
export async function closeMeetTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* already gone */
  }
}
