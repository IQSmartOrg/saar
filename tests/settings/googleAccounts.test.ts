import { describe, it, expect } from 'vitest';

import {
  describeAccount,
  listGoogleAccounts,
  parseAccountLabel,
  probeAccount,
} from '@/settings/googleAccounts';

function page(name: string, email: string): string {
  return `
    <a
      aria-label="Google Account: ${name} &#10;(${email})"
    ></a>
  `;
}

function fakeFetch(
  accounts: Record<number, string | null>,
): typeof fetch {
  return (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    const authuser = Number(searchParams.get('authuser'));

    if (pathname !== '/home') {
      return {
        ok: false,
        type: 'opaqueredirect',
        status: 0,
        text: async () => '',
      } as Response;
    }

    const body = accounts[authuser];

    if (body == null) {
      return {
        ok: false,
        type: 'opaqueredirect',
        status: 0,
        text: async () => '',
      } as Response;
    }

    return {
      ok: true,
      type: 'basic',
      status: 200,
      text: async () => body,
    } as Response;
  }) as typeof fetch;
}

describe('parseAccountLabel', () => {
  it('parses name and email', () => {
    expect(
      parseAccountLabel(page('Parag Patil', 'parag@example.com')),
    ).toEqual({
      name: 'Parag Patil',
      email: 'parag@example.com',
    });
  });

  it('handles different separators between name and email', () => {
    const labels = [
      'Google Account: Parag BOT &#10;(parag@example.com)',
      'Google Account: Parag BOT &#xa;(parag@example.com)',
      'Google Account: Parag BOT \n(parag@example.com)',
      'Google Account: Parag BOT (parag@example.com)',
      'Google Account: Parag BOT&nbsp;&#10;(parag@example.com)',
      'Google Account: Parag BOT&lt;br&gt;(parag@example.com)',
    ];

    for (const label of labels) {
      expect(parseAccountLabel(`<a aria-label="${label}"></a>`)).toEqual({
        name: 'Parag BOT',
        email: 'parag@example.com',
      });
    }
  });

  it('uses email when the display name is missing', () => {
    expect(
      parseAccountLabel(
        '<a aria-label="Google Account: &#10;(solo@example.com)"></a>',
      ),
    ).toEqual({
      name: 'solo@example.com',
      email: 'solo@example.com',
    });
  });

  it('returns null when there is no account label', () => {
    expect(
      parseAccountLabel('<html><body>signed out</body></html>'),
    ).toBeNull();
  });

  it('ignores non-account labels', () => {
    expect(
      parseAccountLabel('<a aria-label="Google Apps"></a>'),
    ).toBeNull();

    expect(
      parseAccountLabel(
        '<a aria-label="Google Account: Parag (personal)"></a>',
      ),
    ).toBeNull();
  });
});

describe('probeAccount', () => {
  it('returns the account for a valid authuser index', async () => {
    const fetchImpl = fakeFetch({
      0: page('Parag Patil', 'parag@example.com'),
    });

    const result = await probeAccount(0, fetchImpl);

    expect(result).toEqual({
      authuser: 0,
      outcome: 'parsed',
      account: {
        authuser: 0,
        name: 'Parag Patil',
        email: 'parag@example.com',
      },
    });
  });

  it('handles an unused authuser index', async () => {
    const fetchImpl = fakeFetch({});

    const result = await probeAccount(2, fetchImpl);

    expect(result.outcome).toBe('redirected');
    expect(result.account).toBeNull();
  });

  it('handles fetch failures', async () => {
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as typeof fetch;

    const result = await probeAccount(0, fetchImpl);

    expect(result.outcome).toBe('threw');
    expect(result.account).toBeNull();
  });
});

describe('listGoogleAccounts', () => {
  it('lists consecutive signed-in accounts in authuser order', async () => {
    const fetchImpl = fakeFetch({
      0: page('Parag Patil', 'parag@example.com'),
      1: page('Mel Mua', 'mel@example.com'),
      2: page('Saar Notetaker', 'notetaker@example.com'),
    });

    const accounts = await listGoogleAccounts({
      fetchImpl,
      maxIndex: 5,
    });

    expect(accounts).toEqual([
      {
        authuser: 0,
        name: 'Parag Patil',
        email: 'parag@example.com',
      },
      {
        authuser: 1,
        name: 'Mel Mua',
        email: 'mel@example.com',
      },
      {
        authuser: 2,
        name: 'Saar Notetaker',
        email: 'notetaker@example.com',
      },
    ]);
  });

  it('stops when Google returns a previously seen account', async () => {
    const primary = page('Parag Patil', 'parag@example.com');

    const fetchImpl = fakeFetch({
      0: primary,
      1: page('Mel Mua', 'mel@example.com'),
      2: primary,
      3: page('Should Not Be Found', 'later@example.com'),
    });

    const accounts = await listGoogleAccounts({
      fetchImpl,
      maxIndex: 5,
    });

    expect(accounts.map((account) => account.email)).toEqual([
      'parag@example.com',
      'mel@example.com',
    ]);
  });

  it('deduplicates email case-insensitively', async () => {
    const fetchImpl = fakeFetch({
      0: page('Parag Patil', 'Parag@Example.com'),
      1: page('Parag Patil', 'parag@example.com'),
    });

    const accounts = await listGoogleAccounts({
      fetchImpl,
      maxIndex: 5,
    });

    expect(accounts).toHaveLength(1);
  });

  it('returns no accounts when signed out', async () => {
    const accounts = await listGoogleAccounts({
      fetchImpl: fakeFetch({}),
      maxIndex: 5,
    });

    expect(accounts).toEqual([]);
  });

  it('does not probe past maxIndex', async () => {
    const probed: number[] = [];

    const fetchImpl = (async (url: string) => {
      const authuser = Number(
        new URL(url).searchParams.get('authuser'),
      );

      probed.push(authuser);

      return {
        ok: true,
        type: 'basic',
        status: 200,
        text: async () =>
          page(`Person ${authuser}`, `person${authuser}@example.com`),
      } as Response;
    }) as typeof fetch;

    await listGoogleAccounts({
      fetchImpl,
      maxIndex: 2,
    });

    expect(probed).toEqual([0, 1, 2]);
  });
});

describe('describeAccount', () => {
  it('shows name and email', () => {
    expect(
      describeAccount({
        authuser: 0,
        name: 'Parag Patil',
        email: 'parag@example.com',
      }),
    ).toBe('Parag Patil (parag@example.com)');
  });

  it('shows only email when there is no separate display name', () => {
    expect(
      describeAccount({
        authuser: 0,
        name: 'parag@example.com',
        email: 'parag@example.com',
      }),
    ).toBe('parag@example.com');
  });
});