import { describe, it, expect } from 'vitest';
import { parseMeetingCode, isBotTab } from '@/core/meet/meetingCode';

describe('parseMeetingCode', () => {
  it('extracts a standard xxx-yyyy-zzz code', () => {
    expect(parseMeetingCode('https://meet.google.com/abc-defg-hij')).toBe('abc-defg-hij');
  });
  it('ignores query strings', () => {
    expect(parseMeetingCode('https://meet.google.com/abc-defg-hij?authuser=1')).toBe('abc-defg-hij');
  });
  it('rejects the landing page', () => {
    expect(parseMeetingCode('https://meet.google.com/')).toBeNull();
  });
  it('rejects non-meeting routes', () => {
    expect(parseMeetingCode('https://meet.google.com/landing')).toBeNull();
    expect(parseMeetingCode('https://meet.google.com/new')).toBeNull();
  });
  it('rejects other hosts', () => {
    expect(parseMeetingCode('https://example.com/abc-defg-hij')).toBeNull();
  });
  it('rejects malformed urls', () => {
    expect(parseMeetingCode('not a url')).toBeNull();
  });
  it('rejects codes with the wrong shape', () => {
    expect(parseMeetingCode('https://meet.google.com/ab-defg-hij')).toBeNull();
    expect(parseMeetingCode('https://meet.google.com/abc-def1-hij')).toBeNull();
  });
});

describe('isBotTab', () => {
  it('is true when authuser is present', () => {
    expect(isBotTab('https://meet.google.com/abc-defg-hij?authuser=1')).toBe(true);
  });
  it('is false without authuser', () => {
    expect(isBotTab('https://meet.google.com/abc-defg-hij')).toBe(false);
  });
  it('is false for malformed urls', () => {
    expect(isBotTab('nonsense')).toBe(false);
  });
});
