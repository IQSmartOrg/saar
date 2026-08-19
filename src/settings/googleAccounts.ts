import { logger } from '@/utils/logger';

const log = logger('settings.googleAccounts');

export interface GoogleAccount {
  readonly authuser: number;
  readonly name: string;
  readonly email: string;
}

export type ProbeOutcome =
  | 'parsed'
  | 'no-label'
  | 'redirected'
  | 'http-error'
  | 'threw';

export interface ProbeResult {
  readonly authuser: number;
  readonly outcome: ProbeOutcome;
  readonly account: GoogleAccount | null;
  readonly error?: string;
}

export interface ListAccountsOptions {
  readonly maxIndex?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export const DEFAULT_MAX_INDEX = 9;

/**
 * Google account switcher contains the account name and email in an
 * aria-label, for example:
 *
 * aria-label="Google Account: Parag Patil &#10;(parag@example.com)"
 *
 * We anchor on the email rather than depending on what separates the
 * name from the email, because Google changes that markup.
 */
export const ACCOUNT_LABEL_RE =
  /aria-label="Google Account:([^"]*?)\(([^)"\s]+@[^)"\s]+)\)"/;

function cleanAccountName(value: string): string {
  return value
    .replace(/&lt;[^&]*&gt;|<[^>]*>/g, ' ')
    .replace(/&#x?[0-9a-fA-F]+;/g, ' ')
    .replace(/&[a-zA-Z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseAccountLabel(
  html: string,
): { name: string; email: string } | null {
  const match = ACCOUNT_LABEL_RE.exec(html);

  if (!match) {
    return null;
  }

  const email = match[2]!.trim();

  if (!email) {
    return null;
  }

  const name = cleanAccountName(match[1]!);

  return {
    name: name || email,
    email,
  };
}

export function accountProbeUrl(authuser: number): string {
  return `https://meet.google.com/home?authuser=${authuser}`;
}

/**
 * Probe one authuser index.
 *
 * We use redirect: 'manual' because an unused authuser can redirect to
 * Google's sign-in page. Following that redirect would cause unnecessary
 * cross-origin/CORS errors in the extension.
 */
export async function probeAccount(
  authuser: number,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
): Promise<ProbeResult> {
  try {
    const response = await fetchImpl(accountProbeUrl(authuser), {
      signal,
      redirect: 'manual',
    });

    if (response.type === 'opaqueredirect' || response.status === 0) {
      log.info(`probe ${authuser}: redirected`);

      return {
        authuser,
        outcome: 'redirected',
        account: null,
      };
    }

    if (!response.ok) {
      log.warning(`probe ${authuser}: http-error`, {
        status: response.status,
      });

      return {
        authuser,
        outcome: 'http-error',
        account: null,
      };
    }

    const html = await response.text();
    const parsed = parseAccountLabel(html);

    if (!parsed) {
      log.warning(`probe ${authuser}: no-label`, {
        bytes: html.length,
        mentionsAccount: html.includes('Google Account:'),
      });

      return {
        authuser,
        outcome: 'no-label',
        account: null,
      };
    }

    const account: GoogleAccount = {
      authuser,
      ...parsed,
    };

    log.info(`probe ${authuser}: parsed`, {
      email: account.email,
      name: account.name,
    });

    return {
      authuser,
      outcome: 'parsed',
      account,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);

    log.warning(`probe ${authuser}: threw`, {
      error: message,
    });

    return {
      authuser,
      outcome: 'threw',
      account: null,
      error: message,
    };
  }
}

/**
 * Find all Google accounts signed into the Chrome profile.
 *
 * authuser indexes are expected to be consecutive. Once Google returns an
 * account we've already seen, we've reached the end of the account list.
 *
 * maxIndex is only a safety limit in case Google's behavior changes.
 */
export async function listGoogleAccounts(
  options: ListAccountsOptions = {},
): Promise<GoogleAccount[]> {
  const {
    maxIndex = DEFAULT_MAX_INDEX,
    fetchImpl = globalThis.fetch.bind(globalThis),
    signal,
  } = options;

  const accounts: GoogleAccount[] = [];
  const seen = new Set<string>();

  for (let authuser = 0; authuser <= maxIndex; authuser++) {
    const result = await probeAccount(authuser, fetchImpl, signal);

    if (!result.account) {
      continue;
    }

    const email = result.account.email.toLowerCase();

    // Google returned an account we've already seen.
    // This means we've reached the end of the account list.
    if (seen.has(email)) {
      log.info(`probe ${authuser}: duplicate, stopping`, {
        email: result.account.email,
      });

      break;
    }

    seen.add(email);
    accounts.push(result.account);
  }

  log.info('account scan finished', {
    found: accounts.length,
    accounts: accounts.map(
      (account) => `${account.authuser}:${account.email}`,
    ),
  });

  return accounts;
}

export function describeAccount(account: GoogleAccount): string {
  return account.name === account.email
    ? account.email
    : `${account.name} (${account.email})`;
}