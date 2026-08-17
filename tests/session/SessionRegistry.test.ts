import { describe, it, expect } from 'vitest';
import { SessionRegistry, type ActiveSession } from '@/session/SessionRegistry';

const s = (over: Partial<ActiveSession> = {}): ActiveSession => ({
  sessionId: 's1',
  meetingCode: 'abc-defg-hij',
  userTabId: 1,
  botTabId: 42,
  ...over,
});

describe('SessionRegistry', () => {
  it('finds an active session by meeting code', () => {
    const r = new SessionRegistry([s()]);
    expect(r.byMeetingCode('abc-defg-hij')?.sessionId).toBe('s1');
    expect(r.byMeetingCode('nope-nope-nop')).toBeNull();
  });

  it('finds by either tab id, since either closing ends the session', () => {
    const r = new SessionRegistry([s()]);
    expect(r.byTabId(42)?.sessionId).toBe('s1');
    expect(r.byTabId(1)?.sessionId).toBe('s1');
    expect(r.byTabId(7)).toBeNull();
  });

  it('finds by session id', () => {
    const r = new SessionRegistry([s()]);
    expect(r.bySessionId('s1')?.meetingCode).toBe('abc-defg-hij');
    expect(r.bySessionId('missing')).toBeNull();
  });

  it('add is idempotent per meeting code', () => {
    const r = new SessionRegistry([]);
    r.add(s());
    r.add(s({ sessionId: 's2' }));
    expect(r.all()).toHaveLength(1);
    expect(r.all()[0]!.sessionId).toBe('s1');
  });

  it('add accepts distinct meeting codes', () => {
    const r = new SessionRegistry([]);
    r.add(s());
    r.add(s({ sessionId: 's2', meetingCode: 'xyz-wxyz-abc' }));
    expect(r.all()).toHaveLength(2);
  });

  it('remove drops the session', () => {
    const r = new SessionRegistry([s()]);
    r.remove('s1');
    expect(r.all()).toEqual([]);
  });

  it('remove of an unknown id is a no-op', () => {
    const r = new SessionRegistry([s()]);
    r.remove('missing');
    expect(r.all()).toHaveLength(1);
  });

  it('serialises and rehydrates losslessly', () => {
    const r = new SessionRegistry([s()]);
    expect(SessionRegistry.fromJSON(r.toJSON()).all()).toEqual(r.all());
  });

  it('rehydrates to empty from junk, so a corrupt store cannot crash the worker', () => {
    expect(SessionRegistry.fromJSON(undefined).all()).toEqual([]);
    expect(SessionRegistry.fromJSON('nonsense').all()).toEqual([]);
  });

  it('toJSON returns a copy, not the internal array', () => {
    const r = new SessionRegistry([s()]);
    r.toJSON().push(s({ sessionId: 'sneaky', meetingCode: 'zzz-zzzz-zzz' }));
    expect(r.all()).toHaveLength(1);
  });
});
