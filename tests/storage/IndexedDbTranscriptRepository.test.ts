import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDbTranscriptRepository } from '@/storage/IndexedDbTranscriptRepository';
import type { MeetingSession } from '@/session/types';
import type { TranscriptSegment } from '@/capture/types';

function session(id: string, startedAt: number): MeetingSession {
  return {
    id,
    platform: 'google-meet',
    meetingCode: 'abc-defg-hij',
    title: 'Sync',
    startedAt,
    endedAt: null,
    participants: [],
    status: 'capturing',
  };
}

function seg(id: string, text: string, final = false, tStart = 0): TranscriptSegment {
  return { id, final, speaker: 'Priya Nair', text, tStart, tEnd: tStart + 2, source: 'meet-captions' };
}

let repo: IndexedDbTranscriptRepository;
beforeEach(() => {
  repo = new IndexedDbTranscriptRepository(`saar-test-${Math.random()}`);
});

describe('IndexedDbTranscriptRepository', () => {
  it('round-trips a session', async () => {
    await repo.createSession(session('s1', 100));
    expect((await repo.getSession('s1'))?.meetingCode).toBe('abc-defg-hij');
  });

  it('returns null for an unknown session', async () => {
    expect(await repo.getSession('nope')).toBeNull();
  });

  it('patches a session without clobbering other fields', async () => {
    await repo.createSession(session('s1', 100));
    await repo.updateSession('s1', { status: 'ended', endedAt: 900 });
    const s = await repo.getSession('s1');
    expect(s?.status).toBe('ended');
    expect(s?.endedAt).toBe(900);
    expect(s?.title).toBe('Sync');
  });

  it('updating an unknown session is a no-op', async () => {
    await repo.updateSession('ghost', { status: 'ended' });
    expect(await repo.getSession('ghost')).toBeNull();
  });

  it('lists sessions newest first', async () => {
    await repo.createSession(session('old', 100));
    await repo.createSession(session('new', 999));
    expect((await repo.listSessions()).map((s) => s.id)).toEqual(['new', 'old']);
  });

  it('upserts segments by id rather than duplicating revisions', async () => {
    await repo.createSession(session('s1', 0));
    await repo.appendSegments('s1', [seg('a', 'I think')]);
    await repo.appendSegments('s1', [seg('a', 'I think we should ship', true)]);

    const all = await repo.getSegments('s1');
    expect(all).toHaveLength(1);
    expect(all[0]!.text).toBe('I think we should ship');
    expect(all[0]!.final).toBe(true);
  });

  it('returns segments ordered by tStart', async () => {
    await repo.createSession(session('s1', 0));
    await repo.appendSegments('s1', [seg('b', 'second', true, 30), seg('a', 'first', true, 5)]);
    expect((await repo.getSegments('s1')).map((s) => s.text)).toEqual(['first', 'second']);
  });

  it('does not leak storage keys into returned segments', async () => {
    await repo.createSession(session('s1', 0));
    await repo.appendSegments('s1', [seg('a', 'one', true)]);
    const got = (await repo.getSegments('s1'))[0]!;
    expect(got).not.toHaveProperty('sessionId');
    expect(got).not.toHaveProperty('segId');
    expect(got.id).toBe('a');
  });

  it('keeps segments of different sessions separate', async () => {
    await repo.createSession(session('s1', 0));
    await repo.createSession(session('s2', 0));
    await repo.appendSegments('s1', [seg('a', 'one', true)]);
    await repo.appendSegments('s2', [seg('a', 'two', true)]);
    expect((await repo.getSegments('s1'))[0]!.text).toBe('one');
    expect((await repo.getSegments('s2'))[0]!.text).toBe('two');
  });

  it('appending an empty batch is a no-op', async () => {
    await repo.createSession(session('s1', 0));
    await repo.appendSegments('s1', []);
    expect(await repo.getSegments('s1')).toEqual([]);
  });

  it('deleting a session removes its segments too', async () => {
    await repo.createSession(session('s1', 0));
    await repo.appendSegments('s1', [seg('a', 'one', true)]);
    await repo.deleteSession('s1');
    expect(await repo.getSession('s1')).toBeNull();
    expect(await repo.getSegments('s1')).toEqual([]);
  });

  it('deleting one session leaves another intact', async () => {
    await repo.createSession(session('s1', 0));
    await repo.createSession(session('s2', 0));
    await repo.appendSegments('s2', [seg('a', 'keep me', true)]);
    await repo.deleteSession('s1');
    expect((await repo.getSegments('s2'))[0]!.text).toBe('keep me');
  });
});
