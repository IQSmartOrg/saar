import { describe, it, expect } from 'vitest';
import {
  describeAccount,
  listGoogleAccounts,
  parseAccountLabel,
  probeAccount,
} from '@/settings/googleAccounts';

/** The real shape, copied from a live meet.google.com response. */
function page(name: string, email: string): string {
  return (
    `<div jsname="x"><a class="gb_B" aria-expanded="false" ` +
    `aria-label="Google Account: ${name}  &#10;(${email})" ` +
    `href="https://accounts.google.com/SignOutOptions">…</a></div>`
  );
}

/** Minimal fetch stub returning a body per authuser index. */
function fakeFetch(byIndex: Record<number, string | null>): typeof fetch {
  return ((url: string) => {
    const parsed = new URL(url);
    const i = Number(parsed.searchParams.get('authuser'));

    // Matches live Meet: the root path redirects to /home, so a probe that
    // asks for `/` with redirect:'manual' never sees a body. Asking for /home
    // is what makes a signed-in account answer directly.
    if (parsed.pathname !== '/home') {
      return Promise.resolve({
        ok: false,
        type: 'opaqueredirect',
        status: 0,
        text: () => Promise.resolve(''),
      });
    }

    const body = byIndex[i];
    if (body === null || body === undefined) {
      // An unused index redirects to the sign-in page.
      return Promise.resolve({
        ok: false,
        type: 'opaqueredirect',
        status: 0,
        text: () => Promise.resolve(''),
      });
    }
    return Promise.resolve({ ok: true, type: 'basic', status: 200, text: () => Promise.resolve(body) });
  }) as unknown as typeof fetch;
}

describe('parseAccountLabel', () => {
  it('reads the name and email out of the account-switcher label', () => {
    const parsed = parseAccountLabel(page('Parag Patil', 'parag@example.com'));
    expect(parsed).toEqual({ name: 'Parag Patil', email: 'parag@example.com' });
  });

  it('handles a real newline as well as the encoded one', () => {
    const html = `<a aria-label="Google Account: Mel Mua \n(mel@example.com)"></a>`;
    expect(parseAccountLabel(html)?.email).toBe('mel@example.com');
  });

  it('falls back to the email when no display name is present', () => {
    const html = `<a aria-label="Google Account:   &#10;(solo@example.com)"></a>`;
    expect(parseAccountLabel(html)).toEqual({
      name: 'solo@example.com',
      email: 'solo@example.com',
    });
  });

  it('returns null when the label is absent', () => {
    expect(parseAccountLabel('<html><body>signed out</body></html>')).toBeNull();
  });

  it('is not fooled by an unrelated aria-label', () => {
    expect(parseAccountLabel('<a aria-label="Google Apps"></a>')).toBeNull();
  });

  it('picks the first account label, which is the one for this authuser', () => {
    const html = page('First Person', 'first@example.com') + page('Other', 'other@example.com');
    expect(parseAccountLabel(html)?.email).toBe('first@example.com');
  });
});

describe('probeAccount', () => {
  it('resolves an index to a named account', async () => {
    const f = fakeFetch({ 0: page('Parag Patil', 'parag@example.com') });
    expect(await probeAccount(0, f)).toEqual({
      authuser: 0,
      name: 'Parag Patil',
      email: 'parag@example.com',
    });
  });

  it('returns null rather than throwing when the request fails', async () => {
    const f = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect(await probeAccount(0, f)).toBeNull();
  });
});

describe('listGoogleAccounts', () => {
  it('lists every signed-in account in authuser order', async () => {
    const f = fakeFetch({
      0: page('Parag Patil', 'parag@example.com'),
      1: page('Saar Notetaker', 'notetaker@example.com'),
      2: page('Mel Mua', 'mel@example.com'),
    });
    const accounts = await listGoogleAccounts({ fetchImpl: f, maxIndex: 5 });
    expect(accounts.map((a) => a.authuser)).toEqual([0, 1, 2]);
    expect(accounts[1]!.name).toBe('Saar Notetaker');
  });

  it('reports each person once, however often the primary is served back', async () => {
    // Google does NOT error on an index with no account — it quietly serves
    // the primary one, so a naive scan reports duplicates forever.
    const primary = page('Parag Patil', 'parag@example.com');
    const f = fakeFetch({
      0: primary,
      1: page('Mel Mua', 'mel@example.com'),
      2: primary,
      3: primary,
      4: primary,
    });
    const accounts = await listGoogleAccounts({ fetchImpl: f, maxIndex: 6 });
    expect(accounts.map((a) => a.email)).toEqual(['parag@example.com', 'mel@example.com']);
  });

  it('does not let one hole hide the accounts behind it', async () => {
    // The bug: the scan returned at the first miss, so an account signed out
    // of slot 1 silently truncated the list to a single entry.
    const f = fakeFetch({
      0: page('Parag Patil', 'parag@example.com'),
      1: null,
      2: page('Mel Mua', 'mel@example.com'),
      3: page('Ana Roy', 'ana@example.com'),
    });
    const accounts = await listGoogleAccounts({ fetchImpl: f, maxIndex: 6 });
    expect(accounts.map((a) => a.email)).toEqual([
      'parag@example.com',
      'mel@example.com',
      'ana@example.com',
    ]);
  });

  it('does not let one repeated account hide the ones behind it', async () => {
    const primary = page('Parag Patil', 'parag@example.com');
    const f = fakeFetch({ 0: primary, 1: primary, 2: page('Mel Mua', 'mel@example.com') });
    const accounts = await listGoogleAccounts({ fetchImpl: f, maxIndex: 6 });
    expect(accounts.map((a) => a.email)).toEqual(['parag@example.com', 'mel@example.com']);
  });

  it('keeps the lowest index when the same account answers twice', async () => {
    // authuser is what gets used to join, so the first slot that works wins.
    const primary = page('Parag Patil', 'parag@example.com');
    const f = fakeFetch({ 0: primary, 1: primary });
    const accounts = await listGoogleAccounts({ fetchImpl: f, maxIndex: 4 });
    expect(accounts[0]?.authuser).toBe(0);
  });

  it('is case-insensitive when spotting the duplicate', async () => {
    const f = fakeFetch({
      0: page('Parag Patil', 'Parag@Example.com'),
      1: page('Parag Patil', 'parag@example.com'),
    });
    expect(await listGoogleAccounts({ fetchImpl: f, maxIndex: 4 })).toHaveLength(1);
  });

  it('concludes after a run of empty indices', async () => {
    const f = fakeFetch({ 0: page('Only One', 'one@example.com') });
    expect(await listGoogleAccounts({ fetchImpl: f, maxIndex: 6 })).toHaveLength(1);
  });

  it('returns nothing when signed out entirely', async () => {
    expect(await listGoogleAccounts({ fetchImpl: fakeFetch({}), maxIndex: 3 })).toEqual([]);
  });

  it('never probes past maxIndex', async () => {
    let calls = 0;
    const f = ((url: string) => {
      calls++;
      const i = Number(new URL(url).searchParams.get('authuser'));
      return Promise.resolve({
        ok: true,
        type: 'basic',
        status: 200,
        text: () => Promise.resolve(page(`P${i}`, `p${i}@example.com`)),
      });
    }) as unknown as typeof fetch;

    await listGoogleAccounts({ fetchImpl: f, maxIndex: 2 });
    expect(calls).toBe(3); // 0, 1, 2
  });
});

describe('describeAccount', () => {
  it('shows the name with the email beside it', () => {
    expect(describeAccount({ authuser: 1, name: 'Mel Mua', email: 'mel@example.com' })).toBe(
      'Mel Mua (mel@example.com)',
    );
  });

  it('does not repeat the email when that is all we have', () => {
    expect(
      describeAccount({ authuser: 0, name: 'solo@example.com', email: 'solo@example.com' }),
    ).toBe('solo@example.com');
  });
});

describe('reading the whole page', () => {
  it('finds the label even when it sits at the very end of a huge page', async () => {
    // The live bug: an early-abort scan gave up at 1.5MB, but Meet puts the
    // account-switcher markup at ~97% of a 2.3MB page. Every probe returned
    // null and the dropdown reported "no accounts found".
    const filler = 'x'.repeat(2_200_000);
    const html = `<html><body>${filler}${page('Late Person', 'late@example.com')}</body></html>`;
    const f = fakeFetch({ 0: html });

    const accounts = await listGoogleAccounts({ fetchImpl: f, maxIndex: 1 });
    expect(accounts[0]?.email).toBe('late@example.com');
  });
});

describe('an index with no account behind it', () => {
  it('never follows the sign-in redirect off meet.google.com', async () => {
    // Meet redirects an unused authuser to accounts.google.com/ServiceLogin,
    // an origin the extension has no permission for. Following it throws a
    // CORS error on every probe past the last real account.
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const f = ((url: string, init: RequestInit) => {
      seen.push({ url, init });
      return Promise.resolve({ ok: true, type: 'basic', status: 200, text: () => Promise.resolve(page('P', 'p@example.com')) });
    }) as unknown as typeof fetch;

    await listGoogleAccounts({ fetchImpl: f, maxIndex: 0 });
    expect(seen[0]?.init.redirect).toBe('manual');
    // Asking for /home directly is what keeps a valid account from redirecting.
    expect(seen[0]?.url).toContain('/home?authuser=0');
  });

  it('reads an opaque redirect as "not signed in" rather than an error', async () => {
    const f = (() =>
      Promise.resolve({
        ok: false,
        type: 'opaqueredirect',
        status: 0,
        text: () => Promise.resolve(''),
      })) as unknown as typeof fetch;

    expect(await probeAccount(3, f)).toBeNull();
  });

  it('ends the scan once the unused indices run on', async () => {
    const f = ((url: string) => {
      const i = Number(new URL(url).searchParams.get('authuser'));
      if (i >= 2) {
        return Promise.resolve({ ok: false, type: 'opaqueredirect', status: 0, text: () => Promise.resolve('') });
      }
      return Promise.resolve({
        ok: true, type: 'basic', status: 200,
        text: () => Promise.resolve(page(`P${i}`, `p${i}@example.com`)),
      });
    }) as unknown as typeof fetch;

    const accounts = await listGoogleAccounts({ fetchImpl: f, maxIndex: 6 });
    expect(accounts.map((a) => a.authuser)).toEqual([0, 1]);
  });
});

describe('regression: the root path always redirects', () => {
  it('still finds accounts even though /?authuser=N redirects to /home', async () => {
    // The break: probing `/` with redirect:'manual' turned EVERY index into an
    // opaque redirect, so the scan stopped at 0 and the dropdown was empty
    // while the extension was otherwise working fine.
    const f = fakeFetch({
      0: page('Parag Patil', 'parag@example.com'),
      1: page('Mel Mua', 'mel@example.com'),
    });
    const accounts = await listGoogleAccounts({ fetchImpl: f, maxIndex: 4 });
    expect(accounts).toHaveLength(2);
    expect(accounts[0]?.name).toBe('Parag Patil');
  });
});

describe('sparse authuser indices', () => {
  it('finds a fourth account sitting behind two dead slots', async () => {
    // The reported symptom: four accounts signed in, three listed. Indices are
    // not dense, and the scan used to give up at the first gap.
    const f = fakeFetch({
      0: page('One', 'one@example.com'),
      1: page('Two', 'two@example.com'),
      2: page('Three', 'three@example.com'),
      3: null,
      4: null,
      5: page('Four', 'four@example.com'),
    });
    const accounts = await listGoogleAccounts({ fetchImpl: f });
    expect(accounts.map((a) => a.email)).toEqual([
      'one@example.com',
      'two@example.com',
      'three@example.com',
      'four@example.com',
    ]);
  });

  it('still terminates on a profile with a single account', async () => {
    const f = fakeFetch({ 0: page('Only', 'only@example.com') });
    expect(await listGoogleAccounts({ fetchImpl: f })).toHaveLength(1);
  });

  it('reaches an account at the top of the range', async () => {
    const f = fakeFetch({ 0: page('One', 'one@example.com') });
    const accounts = await listGoogleAccounts({ fetchImpl: f, maxIndex: 9 });
    expect(accounts).toHaveLength(1);
  });
});
