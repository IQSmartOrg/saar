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
