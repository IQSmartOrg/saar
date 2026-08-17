/**
 * Reading and building Google Meet URLs.
 *
 * Pure string work, no DOM and no `chrome.*` — the one piece of Meet knowledge
 * both the content scripts and the background worker need.
 */

const CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/** Extracts a Meet meeting code from a URL, or null if it is not a meeting. */
export function parseMeetingCode(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'meet.google.com') return null;
  const first = parsed.pathname.split('/').filter(Boolean)[0];
  if (first === undefined) return null;
  return CODE_RE.test(first) ? first : null;
}

/** The bot's own tab carries `?authuser=`; it must never trigger a second bot. */
export function isBotTab(url: string): boolean {
  try {
    return new URL(url).searchParams.has('authuser');
  } catch {
    return false;
  }
}

/**
 * The URL the notetaker tab opens.
 *
 * `authuser=N` selects the Nth signed-in account in the profile. The index is
 * positional: it shifts whenever an account signs in or out, so callers must
 * re-validate it rather than trusting a stored value indefinitely.
 *
 * `saarSession` rides along so the bot-agent content script knows which run it
 * serves — a content script cannot be told anything at injection time.
 */
export function botTabUrl(code: string, accountIndex: number, sessionId: string): string {
  const url = new URL(`https://meet.google.com/${code}`);
  url.searchParams.set('authuser', String(accountIndex));
  url.searchParams.set('saarSession', sessionId);
  return url.toString();
}
