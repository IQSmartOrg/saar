import { describe, it, expect } from 'vitest';
import { newSessionId } from '@/session/types';

describe('newSessionId', () => {
  it('returns a distinct uuid each call', () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
