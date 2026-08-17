import { describe, it, expect } from 'vitest';
import {
  chunkUtterances,
  estimateTokens,
  planChunks,
  speakersOf,
  toUtterances,
  UNATTRIBUTED,
  type Utterance,
} from '@/processing/chunker';
import type { TranscriptSegment } from '@/core/types/transcript';

function seg(p: Partial<TranscriptSegment> & { text: string }): TranscriptSegment {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    final: p.final ?? true,
    // `in` rather than ??, so an explicit null is honoured.
    speaker: 'speaker' in p ? p.speaker! : 'Ana',
    text: p.text,
    tStart: p.tStart ?? 0,
    tEnd: p.tEnd ?? 1,
    source: 'meet-captions',
  };
}

const u = (speaker: string, text: string, tStart = 0): Utterance => ({ speaker, text, tStart });

describe('toUtterances', () => {
  it('drops interim segments', () => {
    // Meet rewrites a caption block as its ASR refines it. Including interim
    // versions would feed the model the same sentence a dozen times.
    const out = toUtterances([
      seg({ text: 'we should', final: false }),
      seg({ text: 'we should ship Friday', final: true }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('we should ship Friday');
  });

  it('merges consecutive turns from the same speaker', () => {
    const out = toUtterances([
      seg({ speaker: 'Ana', text: 'First part.', tStart: 0 }),
      seg({ speaker: 'Ana', text: 'Second part.', tStart: 1 }),
      seg({ speaker: 'Bo', text: 'Reply.', tStart: 2 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe('First part. Second part.');
  });

  it('orders by time regardless of arrival order', () => {
    const out = toUtterances([
      seg({ speaker: 'Bo', text: 'second', tStart: 10 }),
      seg({ speaker: 'Ana', text: 'first', tStart: 1 }),
    ]);
    expect(out.map((x) => x.text)).toEqual(['first', 'second']);
  });

  it('labels unattributed audio rather than dropping it', () => {
    const out = toUtterances([seg({ speaker: null, text: 'anonymous line' })]);
    expect(out[0]!.speaker).toBe(UNATTRIBUTED);
  });

  it('ignores empty and whitespace-only text', () => {
    expect(toUtterances([seg({ text: '   ' }), seg({ text: '' })])).toEqual([]);
  });
});

describe('speakersOf', () => {
  it('is unique and excludes the unattributed placeholder', () => {
    const list = speakersOf([u('Ana', 'x'), u('Bo', 'y'), u('Ana', 'z'), u(UNATTRIBUTED, 'w')]);
    expect(list).toEqual(['Ana', 'Bo']);
  });
});

describe('chunkUtterances', () => {
  const long = (n: number): string => 'word '.repeat(n).trim();

  it('keeps everything in one chunk when it fits', () => {
    const chunks = chunkUtterances([u('Ana', 'short'), u('Bo', 'also short')], {
      budgetTokens: 1000,
    });
    expect(chunks).toHaveLength(1);
  });

  it('splits when the budget is exceeded', () => {
    const utterances = Array.from({ length: 20 }, (_, i) => u(`S${i}`, long(50)));
    const chunks = chunkUtterances(utterances, { budgetTokens: 200, overlapRatio: 0 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('never splits inside an utterance', () => {
    const utterances = Array.from({ length: 20 }, (_, i) => u(`S${i}`, long(40)));
    const chunks = chunkUtterances(utterances, { budgetTokens: 200, overlapRatio: 0 });
    for (const c of chunks) {
      for (const utt of c.utterances) {
        expect(c.text).toContain(utt.text);
      }
    }
  });

  it('covers every utterance across the chunks', () => {
    const utterances = Array.from({ length: 25 }, (_, i) => u('Ana', `line-${i} ${long(30)}`));
    const chunks = chunkUtterances(utterances, { budgetTokens: 300 });
    const seen = new Set(chunks.flatMap((c) => c.utterances.map((x) => x.text)));
    expect(seen.size).toBe(25);
  });

  it('overlaps chunks so a decision spanning a boundary survives', () => {
    const utterances = Array.from({ length: 30 }, (_, i) => u('Ana', `line-${i} ${long(20)}`));
    const withOverlap = chunkUtterances(utterances, { budgetTokens: 300, overlapRatio: 0.3 });
    expect(withOverlap.length).toBeGreaterThan(1);

    const first = withOverlap[0]!.utterances.map((x) => x.text);
    const second = withOverlap[1]!.utterances.map((x) => x.text);
    expect(second.some((t) => first.includes(t))).toBe(true);
  });

  it('terminates when overlap would otherwise loop forever', () => {
    // A pathological ratio must not carry the whole chunk forward each time.
    const utterances = Array.from({ length: 12 }, (_, i) => u('Ana', `line-${i} ${long(25)}`));
    const chunks = chunkUtterances(utterances, { budgetTokens: 200, overlapRatio: 0.99 });
    expect(chunks.length).toBeLessThan(50);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('emits an oversized single utterance alone rather than dropping it', () => {
    // A truncated record beats no record.
    const chunks = chunkUtterances([u('Ana', long(5000))], { budgetTokens: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.tokens).toBeGreaterThan(100);
  });

  it('returns nothing for an empty transcript', () => {
    expect(chunkUtterances([], { budgetTokens: 100 })).toEqual([]);
  });
});

describe('planChunks', () => {
  it('reserves room for the prompt, not just the transcript', () => {
    // Instructions and the speaker list share the window. Budgeting the whole
    // context for transcript is how a "safely sized" chunk overflows.
    const segments = Array.from({ length: 40 }, (_, i) =>
      seg({ speaker: 'Ana', text: `line ${i} ${'word '.repeat(40)}`, tStart: i }),
    );
    const plan = planChunks(segments, { contextTokens: 4096 });
    for (const c of plan.chunks) {
      expect(c.tokens).toBeLessThanOrEqual(4096);
    }
  });

  it('keeps a floor when the configured context is tiny', () => {
    const plan = planChunks([seg({ text: 'hello there' })], { contextTokens: 100 });
    expect(plan.chunks.length).toBeGreaterThan(0);
  });

  it('reports the speakers for owner constraint', () => {
    const plan = planChunks(
      [seg({ speaker: 'Ana', text: 'a' }), seg({ speaker: 'Bo', text: 'b', tStart: 5 })],
      { contextTokens: 4096 },
    );
    expect(plan.speakers).toEqual(['Ana', 'Bo']);
  });
});

describe('estimateTokens', () => {
  it('is conservative — never under-counts badly', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});
