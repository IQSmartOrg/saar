import { describe, it, expect } from 'vitest';
import { progressOf, type MomJobState } from '@/processing/MomBuilder';

/**
 * Jobs outlive the code that wrote them — one survives a browser restart by
 * design — so reading a job written by an older build is normal, not an edge
 * case.
 */
describe('jobs persisted before callMs existed', () => {
  const legacy = {
    sessionId: 's1',
    speakers: ['Ana'],
    chunkTexts: ['a', 'b', 'c'],
    notes: [{}, {}],
    phase: 'mapping',
    minutes: null,
    attempts: 0,
    // callMs deliberately absent
  } as unknown as MomJobState;

  it('does not throw when computing progress', () => {
    // This crash took down both the summariser and the popup activity list,
    // since progressOf is on both paths.
    expect(() => progressOf(legacy)).not.toThrow();
  });

  it('reports progress with no estimate rather than failing', () => {
    const p = progressOf(legacy);
    expect(p.phase).toBe('mapping');
    expect(p.done).toBe(2);
    expect(p.total).toBe(4);
    expect(p.etaMs).toBeUndefined();
  });
});
