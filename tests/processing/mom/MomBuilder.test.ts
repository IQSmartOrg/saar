import { describe, it, expect } from 'vitest';
import { MomBuilder, planJob, progressOf, type MomJobState } from '@/processing/mom/MomBuilder';
import type { CompletionRequest, LlmClient } from '@/processing/llm/LlmClient';
import type { TranscriptSegment } from '@/capture/types';

function seg(text: string, speaker: string, tStart: number): TranscriptSegment {
  return {
    id: `s-${tStart}`,
    final: true,
    speaker,
    text,
    tStart,
    tEnd: tStart + 1,
    source: 'meet-captions',
  };
}

/** Records every call and replies with whatever the test queued. */
class FakeLlm implements LlmClient {
  calls: CompletionRequest[] = [];
  constructor(private readonly replies: string[] | (() => string)) {}

  complete(req: CompletionRequest): Promise<{ text: string }> {
    this.calls.push(req);
    if (typeof this.replies === 'function') return Promise.resolve({ text: this.replies() });
    const next = this.replies.shift();
    if (next === undefined) throw new Error('FakeLlm ran out of replies');
    return Promise.resolve({ text: next });
  }
  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }
  health(): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }
}

const NOTES = JSON.stringify({
  summary: 'Discussed the release.',
  topics: [{ title: 'Release', points: ['ship Friday'], speakers: ['Ana'] }],
  decisions: [{ decision: 'Ship on Friday', context: 'QA is green' }],
  actionItems: [{ owner: 'Ana', task: 'cut the build', due: null, quote: 'I will cut it' }],
  openQuestions: ['who writes the notes?'],
});

/** Enough transcript to force several chunks at a small context. */
function bigTranscript(turns: number): TranscriptSegment[] {
  return Array.from({ length: turns }, (_, i) =>
    seg(`${'discussion '.repeat(30)} point ${i}`, i % 2 === 0 ? 'Ana' : 'Bo', i),
  );
}

async function runToCompletion(
  builder: MomBuilder,
  start: MomJobState,
  maxSteps = 50,
): Promise<MomJobState> {
  let state = start;
  for (let i = 0; i < maxSteps; i++) {
    const r = await builder.step(state);
    state = r.state;
    if (!r.more) break;
  }
  return state;
}

describe('planJob', () => {
  it('chunks up front so resuming never re-chunks', () => {
    const job = planJob('s1', bigTranscript(30), { contextTokens: 1000 });
    expect(job.chunkTexts.length).toBeGreaterThan(1);
    expect(job.notes).toEqual([]);
    expect(job.phase).toBe('mapping');
  });

  it('fails cleanly when nothing was captured', () => {
    const job = planJob('s1', [], { contextTokens: 4096 });
    expect(job.phase).toBe('failed');
    expect(job.error).toMatch(/nothing was captured/);
  });

  it('collects the speaker list for the owner constraint', () => {
    const job = planJob('s1', bigTranscript(4), { contextTokens: 4096 });
    expect([...job.speakers].sort()).toEqual(['Ana', 'Bo']);
  });
});

describe('step — one unit of work at a time', () => {
  it('advances exactly one chunk per call', () => {
    const job = planJob('s1', bigTranscript(30), { contextTokens: 1000 });
    expect(job.chunkTexts.length).toBeGreaterThan(2);

    const llm = new FakeLlm(() => NOTES);
    const builder = new MomBuilder(llm, { contextTokens: 1000 });

    return builder.step(job).then(async (first) => {
      expect(first.state.notes).toHaveLength(1);
      const second = await builder.step(first.state);
      expect(second.state.notes).toHaveLength(2);
    });
  });

  it('resumes from persisted state without redoing finished chunks', async () => {
    // The whole point: an MV3 worker dies mid-run and must not start over.
    const job = planJob('s1', bigTranscript(30), { contextTokens: 1000 });
    const llm = new FakeLlm(() => NOTES);
    const builder = new MomBuilder(llm, { contextTokens: 1000 });

    const after = (await builder.step(job)).state;
    const revived = JSON.parse(JSON.stringify(after)) as MomJobState;

    const callsBefore = llm.calls.length;
    await builder.step(revived);
    // Exactly one further call — chunk 1 was not re-summarised.
    expect(llm.calls.length).toBe(callsBefore + 1);
  });

  it('produces minutes at the end', async () => {
    const job = planJob('s1', bigTranscript(30), { contextTokens: 1000 });
    const builder = new MomBuilder(new FakeLlm(() => NOTES), { contextTokens: 1000 });
    const final = await runToCompletion(builder, job);

    expect(final.phase).toBe('done');
    expect(final.minutes?.decisions[0]?.decision).toBe('Ship on Friday');
    expect(final.minutes?.actionItems[0]?.owner).toBe('Ana');
  });

  it('skips the reduce call entirely for a single chunk', async () => {
    const job = planJob('s1', [seg('short meeting', 'Ana', 0)], { contextTokens: 4096 });
    expect(job.chunkTexts).toHaveLength(1);

    const llm = new FakeLlm(() => NOTES);
    const final = await runToCompletion(new MomBuilder(llm, { contextTokens: 4096 }), job);

    expect(final.phase).toBe('done');
    expect(llm.calls).toHaveLength(1); // map only
  });
});

describe('resilience', () => {
  it('keeps going when one chunk comes back unparseable', async () => {
    // Losing one chunk's notes is survivable; stalling the meeting is not.
    const job = planJob('s1', bigTranscript(30), { contextTokens: 1000 });
    let n = 0;
    const llm = new FakeLlm(() => (n++ === 0 ? 'total nonsense, no json' : NOTES));
    const final = await runToCompletion(new MomBuilder(llm, { contextTokens: 1000 }), job);
    expect(final.phase).toBe('done');
  });

  it('retries once with a stricter prompt before giving up on parsing', async () => {
    const job = planJob('s1', [seg('short', 'Ana', 0)], { contextTokens: 4096 });
    const llm = new FakeLlm(['not json at all', NOTES]);
    const final = await runToCompletion(new MomBuilder(llm, { contextTokens: 4096 }), job);

    expect(llm.calls).toHaveLength(2); // original + repair
    expect(final.phase).toBe('done');
    expect(final.minutes?.summary).toBe('Discussed the release.');
  });

  it('keeps the raw text rather than losing the meeting when nothing parses', async () => {
    const job = planJob('s1', bigTranscript(30), { contextTokens: 1000 });
    const final = await runToCompletion(
      new MomBuilder(new FakeLlm(() => 'prose only, never json'), { contextTokens: 1000 }),
      job,
    );
    expect(final.phase).toBe('done');
    expect(final.minutes?.raw).toBeTruthy();
  });

  it('reports a model failure as state instead of throwing', async () => {
    // The transcript is already saved. A summary failure must never take the
    // meeting down with it.
    const llm: LlmClient = {
      complete: () => Promise.reject(new Error('connection refused')),
      listModels: () => Promise.resolve([]),
      health: () => Promise.resolve({ ok: false }),
    };
    const job = planJob('s1', [seg('short', 'Ana', 0)], { contextTokens: 4096 });
    const result = await new MomBuilder(llm, { contextTokens: 4096 }).step(job);

    expect(result.state.phase).toBe('failed');
    expect(result.state.error).toMatch(/connection refused/);
    expect(result.more).toBe(false);
  });

  it('does nothing further once done or failed', async () => {
    const llm = new FakeLlm([]);
    const builder = new MomBuilder(llm, { contextTokens: 4096 });
    const done = { ...planJob('s1', [seg('x', 'Ana', 0)]), phase: 'done' as const };
    const r = await builder.step(done);
    expect(r.more).toBe(false);
    expect(llm.calls).toHaveLength(0);
  });
});

describe('prompt contents', () => {
  it('names the allowed speakers so the model cannot invent participants', async () => {
    const job = planJob('s1', bigTranscript(6), { contextTokens: 4096 });
    const llm = new FakeLlm(() => NOTES);
    await new MomBuilder(llm, { contextTokens: 4096 }).step(job);

    const system = llm.calls[0]!.messages[0]!.content;
    expect(system).toContain('Ana');
    expect(system).toContain('Bo');
    expect(system).toMatch(/never invent/i);
  });

  it('tells the model which part of the meeting it is reading', async () => {
    const job = planJob('s1', bigTranscript(30), { contextTokens: 1000 });
    const llm = new FakeLlm(() => NOTES);
    await new MomBuilder(llm, { contextTokens: 1000 }).step(job);
    expect(llm.calls[0]!.messages[1]!.content).toMatch(/part 1 of \d+/);
  });
});

describe('progressOf', () => {
  it('walks from mapping through reducing to done', async () => {
    const job = planJob('s1', bigTranscript(30), { contextTokens: 1000 });
    expect(progressOf(job).phase).toBe('mapping');

    const builder = new MomBuilder(new FakeLlm(() => NOTES), { contextTokens: 1000 });
    const final = await runToCompletion(builder, job);
    expect(progressOf(final).phase).toBe('done');
    expect(progressOf(final).done).toBe(progressOf(final).total);
  });
});

describe('context budgeting', () => {
  it('reserves room for the REPLY, not just the prompt', () => {
    // Verified against a live qwen3:14b: a four-line transcript drew a
    // 602-token reply. Input and output share num_ctx, and Ollama answers an
    // overflow by silently truncating, so the reply must be budgeted for.
    const segments = bigTranscript(60);
    const withOutput = planJob('s1', segments, { contextTokens: 4096, maxTokens: 1500 });
    const withoutOutput = planJob('s1', segments, { contextTokens: 4096, maxTokens: 0 });

    expect(withOutput.chunkTexts.length).toBeGreaterThan(withoutOutput.chunkTexts.length);
  });

  it('applies the default reply reservation when maxTokens is omitted', () => {
    const segments = bigTranscript(60);
    const implicit = planJob('s1', segments, { contextTokens: 4096 });
    const explicit = planJob('s1', segments, { contextTokens: 4096, maxTokens: 1500 });
    expect(implicit.chunkTexts.length).toBe(explicit.chunkTexts.length);
  });
});
