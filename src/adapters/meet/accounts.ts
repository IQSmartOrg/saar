/**
 * Discovering which Google accounts are signed into this Chrome profile.
 *
 * `?authuser=N` selects the Nth signed-in account, but the index is opaque —
 * nobody knows whether they are account 1 or 3, and the numbering shifts as
 * accounts sign in and out. So we resolve each index to a real name and email
 * and let the user pick a person instead of a number.
 *
 * There is no supported Chrome API for this. `chrome.identity` exposes only
 * the profile's primary account, and Google's ListAccounts endpoint answers
 * 400 to callers other than Chrome itself (verified 2026-08-15). What is left
 * is reading the account back off a Google page we already have permission
 * for — so this deliberately targets an `aria-label`, the most durable signal
 * available, rather than one of Google's obfuscated JSON keys.
 *
 * No `chrome.*` here: fetch only, so it is testable without a browser.
 */

export interface GoogleAccount {
  /** The `authuser` index this account answers on. */
  readonly authuser: number;
  readonly name: string;
  readonly email: string;
}

/**
 * The account-switcher button's label, which carries both name and email:
 *
 *   aria-label="Google Account: Parag Patil  &#10;(someone@gmail.com)"
 *
 * `&#10;` is an encoded newline Google inserts between the two.
 */
export const ACCOUNT_LABEL_RE =
  /aria-label="Google Account:\s*([^"(]*?)\s*(?:&#10;|\n)\s*\(([^)"]+)\)"/;

export function parseAccountLabel(html: string): { name: string; email: string } | null {
  const m = ACCOUNT_LABEL_RE.exec(html);
  if (!m) return null;
  const name = (m[1] ?? '').trim();
  const email = (m[2] ?? '').trim();
  if (email === '') return null;
  return { name: name === '' ? email : name, email };
}

/**
 * The whole page, deliberately.
 *
 * An earlier version streamed the body and gave up after 1.5MB to save
 * bandwidth. That silently broke everything: the account-switcher markup sits
 * at ~97% of a 2.3MB page (byte 2,246,350 of 2,315,657 when measured), so the
 * scan stopped just short of the only thing it was looking for, every probe
 * returned null, and the dropdown reported "no accounts found". There is no
 * early exit to be had — the label is at the end, so read to the end.
 */
export async function fetchAccountHtml(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  // Two things have to be true at once here, and getting one without the other
  // is how this has broken twice:
  //
  //   1. A signed-in index must return HTML. `/?authuser=N` always redirects
  //      to `/home?authuser=N`, so asking for `/home` directly means a valid
  //      account answers 200 with no redirect at all. Requesting the un-redirected
  //      path with redirect:'manual' made EVERY index look signed out.
  //   2. An unused index must not throw. Meet redirects those to
  //      accounts.google.com/ServiceLogin — an origin this extension has no
  //      permission for — so following it logs a CORS error on every probe past
  //      the last real account. redirect:'manual' stops before that happens.
  const res = await fetchImpl(url, { signal, redirect: 'manual' });

  // An opaque redirect reports status 0 and an empty body: with `/home` as the
  // target, the only thing left to redirect to is the sign-in page, so this is
  // the signal that the index is not signed in.
  if (res.type === 'opaqueredirect' || res.status === 0) return '';
  if (!res.ok) return '';
  return await res.text();
}

/**
 * The page an account probe asks for.
 *
 * `/home` rather than `/`: the root path redirects here anyway, and asking for
 * the destination means a signed-in account answers without any redirect to
 * interpret.
 */
export function accountProbeUrl(authuser: number): string {
  return `https://meet.google.com/home?authuser=${authuser}`;
}

export interface ListAccountsOptions {
  readonly maxIndex?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

/**
 * Highest `authuser` index probed.
 *
 * Nine rather than six: indices are not guaranteed to be dense. Signing an
 * account in and out leaves holes, so the fourth account in a profile can sit
 * at index 5 or 7 with dead slots before it.
 */
export const DEFAULT_MAX_INDEX = 9;

/** How many indices to probe concurrently. */
export const PROBE_BATCH = 4;

/**
 * Empty indices in a row before the scan concludes.
 *
 * Three, not one: every index past the last real account looks identical to a
 * hole in the middle of the range, because Google answers both by serving the
 * primary account again. One miss meant a single signed-out slot hid every
 * account behind it; three tolerates a realistic gap while still stopping.
 */
export const STOP_AFTER_MISSES = 3;

export async function probeAccount(
  authuser: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<GoogleAccount | null> {
  try {
    const html = await fetchAccountHtml(accountProbeUrl(authuser), fetchImpl, signal);
    const parsed = parseAccountLabel(html);
    return parsed === null ? null : { authuser, ...parsed };
  } catch {
    return null;
  }
}

/**
 * Every account signed into this profile, in `authuser` order.
 *
 * Two things make this harder than walking 0,1,2… until it stops:
 *
 * 1. An index with no account does not error. Google either redirects to the
 *    sign-in page or quietly serves the PRIMARY account again, so a naive scan
 *    reports the same person several times over.
 * 2. Neither of those means "the list has ended". They can happen in the
 *    middle of the range — an account signed out of one slot leaves a hole
 *    with live accounts behind it.
 *
 * So a single miss or repeat is skipped rather than treated as the end, and
 * the scan only concludes after `STOP_AFTER_MISSES` in a row. Stopping at the
 * first one truncated the list at the hole and silently hid every account
 * after it.
 */
export async function listGoogleAccounts(
  opts: ListAccountsOptions = {},
): Promise<GoogleAccount[]> {
  const {
    maxIndex = DEFAULT_MAX_INDEX,
    fetchImpl = globalThis.fetch.bind(globalThis),
    signal,
  } = opts;

  const found: GoogleAccount[] = [];
  const seen = new Set<string>();
  let consecutiveMisses = 0;

  // Batched rather than one-at-a-time or all-at-once. Each page is ~2.3MB and
  // a ~500ms round trip: sequential took over 4s, while firing every index at
  // once always pulls ~16MB even for a profile with two accounts.
  for (let start = 0; start <= maxIndex; start += PROBE_BATCH) {
    const batch: number[] = [];
    for (let i = start; i <= Math.min(start + PROBE_BATCH - 1, maxIndex); i++) batch.push(i);

    const probed = await Promise.all(batch.map((i) => probeAccount(i, fetchImpl, signal)));

    for (const account of probed) {
      // Not signed in at this index, or the primary account served again.
      const isNew = account !== null && !seen.has(account.email.toLowerCase());
      if (!isNew) {
        consecutiveMisses += 1;
        continue;
      }

      consecutiveMisses = 0;
      seen.add(account.email.toLowerCase());
      found.push(account);
    }

    // Checked per batch rather than per index: the batch is already fetched,
    // so there is nothing to save by bailing mid-way through one.
    if (consecutiveMisses >= STOP_AFTER_MISSES) break;
  }

  return found;
}

/** "Parag Patil (parag@example.com)" — what the dropdown shows. */
export function describeAccount(a: GoogleAccount): string {
  return a.name === a.email ? a.email : `${a.name} (${a.email})`;
}
