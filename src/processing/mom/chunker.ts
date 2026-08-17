import type { TranscriptSegment } from '@/capture/types';

/**
 * Splitting a transcript into pieces a model can actually read.
 *
 * Two rules that are not negotiable:
 *
 * 1. **Never split mid-utterance.** Chunk boundaries land between speaker
 *    turns, so a sentence is never cut in half and attribution never smears
 *    across a boundary.
 * 2. **Budget against the CONFIGURED context, not the provider's real one.**
 *    Ollama silently truncates input past `num_ctx` without erroring, and
 *    `num_ctx` cannot be raised through the OpenAI-compatible layer. A chunk
 *    that overflows therefore does not fail — it quietly loses its tail, which
 *    is far worse.
 */

/** Roughly 4 characters per token. Deliberately conservative. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface Utterance {
  readonly speaker: string;
  readonly text: string;
  readonly tStart: number;
}

export interface Chunk {
  readonly index: number;
  readonly utterances: readonly Utterance[];
  readonly text: string;
  readonly tokens: number;
}

export const UNATTRIBUTED = 'Unknown speaker';

/**
 * Collapses raw caption segments into utterances.
 *
 * Only `final` segments count: Meet rewrites a caption block many times as its
 * ASR refines it, so including interim ones would feed the model the same
 * sentence a dozen times in progressively more complete forms.
 *
 * Consecutive segments from one speaker are merged, because Meet emits a
 * paragraph as several blocks and a model reads it better whole.
 */
export function toUtterances(segments: readonly TranscriptSegment[]): Utterance[] {
  const finals = segments.filter((s) => s.final && s.text.trim() !== '');
  const ordered = [...finals].sort((a, b) => a.tStart - b.tStart);

  const out: Utterance[] = [];
  for (const s of ordered) {
    const speaker = s.speaker?.trim() || UNATTRIBUTED;
    const text = s.text.trim();
    const prev = out.at(-1);
    if (prev && prev.speaker === speaker) {
      out[out.length - 1] = { ...prev, text: `${prev.text} ${text}` };
    } else {
      out.push({ speaker, text, tStart: s.tStart });
    }
  }
  return out;
}

export function renderUtterance(u: Utterance): string {
  return `${u.speaker}: ${u.text}`;
}

export function speakersOf(utterances: readonly Utterance[]): string[] {
  return [...new Set(utterances.map((u) => u.speaker))].filter((s) => s !== UNATTRIBUTED);
}

export interface ChunkOptions {
  /** Token budget for the transcript portion of one prompt. */
  readonly budgetTokens: number;
  /** Fraction of the previous chunk repeated at the head of the next. */
  readonly overlapRatio?: number;
}

export const DEFAULT_OVERLAP_RATIO = 0.15;

/**
 * Splits utterances into overlapping chunks.
 *
 * The overlap exists so a decision stated at the end of one chunk and
 * justified at the start of the next is visible whole to at least one call.
 * Duplicate findings are cheap — the reduce phase dedupes — whereas a decision
 * severed by a boundary is lost outright.
 *
 * A single utterance larger than the whole budget is emitted alone rather than
 * dropped: a truncated record of it beats no record.
 */
export function chunkUtterances(
  utterances: readonly Utterance[],
  opts: ChunkOptions,
): Chunk[] {
  const budget = Math.max(1, opts.budgetTokens);
  const overlapRatio = opts.overlapRatio ?? DEFAULT_OVERLAP_RATIO;
  if (utterances.length === 0) return [];

  const chunks: Chunk[] = [];
  let current: Utterance[] = [];
  let tokens = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const text = current.map(renderUtterance).join('\n');
    chunks.push({
      index: chunks.length,
      utterances: current,
      text,
      tokens: estimateTokens(text),
    });
  };

  /** Tail of the just-flushed chunk, re-seeded into the next one. */
  const overlapTail = (): Utterance[] => {
    if (overlapRatio <= 0 || current.length === 0) return [];
    const want = Math.floor(budget * overlapRatio);
    const tail: Utterance[] = [];
    let acc = 0;
    for (let i = current.length - 1; i >= 0; i--) {
      const cost = estimateTokens(renderUtterance(current[i]!));
      if (acc + cost > want) break;
      tail.unshift(current[i]!);
      acc += cost;
    }
    // Never carry the entire chunk forward — that would not terminate.
    return tail.length === current.length ? tail.slice(1) : tail;
  };

  for (const u of utterances) {
    const cost = estimateTokens(renderUtterance(u));

    if (current.length > 0 && tokens + cost > budget) {
      flush();
      const tail = overlapTail();
      current = [...tail];
      tokens = tail.reduce((n, t) => n + estimateTokens(renderUtterance(t)), 0);
    }

    current.push(u);
    tokens += cost;

    // One utterance bigger than the budget: emit it alone and reset.
    if (current.length === 1 && tokens > budget) {
      flush();
      current = [];
      tokens = 0;
    }
  }

  flush();
  return chunks;
}

/**
 * Convenience: segments straight to chunks.
 *
 * The budget subtracts a prompt allowance because the transcript is not the
 * only thing in the request — instructions and the speaker list share the
 * window, and forgetting them is how a "safely sized" chunk overflows.
 */
export interface PlanOptions {
  readonly contextTokens: number;
  readonly promptAllowanceTokens?: number;
  readonly overlapRatio?: number;
}

export const DEFAULT_PROMPT_ALLOWANCE = 900;

export interface ChunkPlan {
  readonly chunks: readonly Chunk[];
  readonly speakers: readonly string[];
  readonly utteranceCount: number;
}

export function planChunks(
  segments: readonly TranscriptSegment[],
  opts: PlanOptions,
): ChunkPlan {
  const utterances = toUtterances(segments);
  const allowance = opts.promptAllowanceTokens ?? DEFAULT_PROMPT_ALLOWANCE;
  const budget = Math.max(200, opts.contextTokens - allowance);

  return {
    chunks: chunkUtterances(utterances, {
      budgetTokens: budget,
      overlapRatio: opts.overlapRatio,
    }),
    speakers: speakersOf(utterances),
    utteranceCount: utterances.length,
  };
}
