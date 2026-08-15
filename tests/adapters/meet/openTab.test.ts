import { describe, it, expect } from 'vitest';
import { buildMeetUrl } from '@/adapters/meet/openTab';

describe('buildMeetUrl', () => {
  it('targets the meeting as the given account', () => {
    expect(buildMeetUrl('abc-defg-hij', 1)).toBe(
      'https://meet.google.com/abc-defg-hij?authuser=1',
    );
  });

  it('carries the session id through so the content script knows which run it serves', () => {
    expect(buildMeetUrl('abc-defg-hij', 2, 'sess-42')).toBe(
      'https://meet.google.com/abc-defg-hij?authuser=2&saarSession=sess-42',
    );
  });

  it('keeps authuser=0 explicit rather than omitting it', () => {
    // Index 0 is a real account, not "unset" — dropping it would let Meet pick
    // whichever account it fancies.
    expect(buildMeetUrl('abc-defg-hij', 0)).toContain('authuser=0');
  });
});
