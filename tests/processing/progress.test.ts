import { describe, it, expect } from 'vitest';
import { planJob, progressOf, MomBuilder, type MomJobState } from '@/processing/MomBuilder';
import { describeEta, describePhase, progressPercent } from '@/processing/types';
import type { CompletionRequest, LlmClient } from '@/processing/LlmClient';
import type { TranscriptSegment } from '@/core/types/transcript';

function transcript(turns: number): TranscriptSegment[] {
  return Array.from({ length: turns }, (_, i) => ({
    id: `s${i}`,
    final: true,
    speaker: i % 2 === 0 ? 'Ana' : 'Bo',
    text: `${'discussion '.repeat(30)} point ${i}`,
    tStart: i,
    tEnd: i + 1,
    source: 'meet-captions' as const,
  }));
}

const NOTES = JSON.stringify({
  summary: 'x',
  topics: [],
  decisions: [],
  actionItems: [],
  openQuestions: [],
});

class FakeLlm implements LlmClient {
  complete(_req: CompletionRequest): Promise<{ text: string }> {
    return Promise.resolve({ text: NOTES });
  }
  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }
  health(): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }
}

describe('progress never goes backwards', () => {
  it('uses the same denominator in every phase', async () => {
    // The bug: mapping counted chunks while reducing counted chunks+1, so the
    // bar reached 100% and then jumped back to ~87% for the final merge.
    const job = planJob('s1', transcript(30), { contextTokens: 1000 });
    const builder = new MomBuilder(new FakeLlm(), { contextTokens: 1000 });

    const seen: number[] = [];
    let state: MomJobState = job;
    seen.push(progressPercent(progressOf(state)));

    for (let i = 0; i < 40; i++) {
      const r = await builder.step(state);
      state = r.state;
      seen.push(progressPercent(progressOf(state)));
      if (!r.more) break;
    }

    expect(state.phase).toBe('done');
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
    expect(seen.at(-1)).toBe(100);
  });

  it('reserves the last step of the bar for the merge', () => {
    const job = planJob('s1', transcript(30), { contextTokens: 1000 });
    const chunks = job.chunkTexts.length;
    // Every chunk mapped, merge still to come.
    const mapped = { ...job, notes: Array.from({ length: chunks }, () => ({}) as never) };
    expect(progressPercent(progressOf(mapped))).toBeLessThan(100);
  });
});

describe('describePhase', () => {
  it('names the transcript part, excluding the merge from the count', () => {
    const job = planJob('s1', transcript(30), { contextTokens: 1000 });
    const chunks = job.chunkTexts.length;
    const p = progressOf({ ...job, notes: [{}, {}] as never[] });
    expect(describePhase(p)).toBe(`Reading the transcript — part 3 of ${chunks}`);
  });

  it('switches wording for the merge', () => {
    const job = planJob('s1', transcript(30), { contextTokens: 1000 });
    expect(describePhase(progressOf({ ...job, phase: 'reducing' }))).toBe('Writing the minutes…');
  });
});

describe('eta', () => {
  it('stays silent until at least one call has been timed', () => {
    const job = planJob('s1', transcript(30), { contextTokens: 1000 });
    expect(progressOf(job).etaMs).toBeUndefined();
    expect(describeEta(undefined)).toBeNull();
  });

  it('projects from the calls already measured', async () => {
    const job = planJob('s1', transcript(30), { contextTokens: 1000 });
    // now() is read once at the start of a step and once at the end, so
    // advancing 10s per read makes every step take exactly 10s.
    let clock = 0;
    const tick = (): number => (clock += 10_000);
    const builder = new MomBuilder(new FakeLlm(), { contextTokens: 1000 }, tick);

    const after = (await builder.step(job)).state;
    const eta = progressOf(after).etaMs;
    expect(eta).toBeGreaterThan(0);
  });

  it('rounds into human words', () => {
    expect(describeEta(20_000)).toBe('less than a minute left');
    expect(describeEta(125_000)).toBe('about 2 min left');
  });
});
