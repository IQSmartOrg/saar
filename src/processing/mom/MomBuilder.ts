import type { LlmClient } from '@/processing/llm/LlmClient';
import type { TranscriptSegment } from '@/capture/types';
import {
  planChunks,
  estimateTokens,
  DEFAULT_PROMPT_ALLOWANCE,
  type Chunk,
} from '@/processing/mom/chunker';
import { mapPrompt, reducePrompt, repairPrompt, MINUTES_SCHEMA } from '@/processing/mom/prompts';
import {
  coerceChunkNotes,
  coerceMinutes,
  minutesFromRawText,
  parseLoose,
} from '@/processing/mom/parse';
import { EMPTY_MINUTES, type MeetingMinutes } from '@/minutes/types';
import type { ChunkNotes, MomProgress } from '@/processing/mom/types';

/**
 * Map-reduce over a transcript, one step at a time.
 *
 * Deliberately NOT a single `summarize()` that runs to completion. An MV3
 * service worker is terminated after ~30s idle, and summarising an hour-long
 * meeting against a local model takes minutes — so the caller drives this one
 * step per call, persisting between steps. A worker that dies mid-run resumes
 * from the last completed chunk instead of starting over.
 *
 * Map-reduce rather than one big prompt for a second reason: Ollama silently
 * truncates input past `num_ctx` without erroring, so a single-prompt approach
 * would quietly lose the back half of a long meeting with no failure anywhere.
 */

export interface MomJobState {
  readonly sessionId: string;
  readonly speakers: readonly string[];
  /** Chunk texts, computed once so resumption never re-chunks. */
  readonly chunkTexts: readonly string[];
  /** Notes for chunks completed so far; length is the resume point. */
  readonly notes: readonly ChunkNotes[];
  readonly phase: MomProgress['phase'];
  readonly minutes: MeetingMinutes | null;
  readonly error?: string;
  readonly attempts: number;
  /** Milliseconds each completed step took, used to estimate what is left. */
  readonly callMs: readonly number[];
  /**
   * The user has stopped this run.
   *
   * A flag rather than a `paused` phase, deliberately: the phase stays exactly
   * where it was, so resuming picks up at the same chunk instead of re-planning.
   * Only the scheduler reads it — `step()` does not, because whoever calls it
   * has already decided to do work.
   */
  readonly paused: boolean;
}

export interface StepResult {
  readonly state: MomJobState;
  readonly progress: MomProgress;
  /** False once there is nothing left to do. */
  readonly more: boolean;
}

export const MAX_REDUCE_INPUT_TOKENS_RATIO = 0.6;

export interface MomOptions {
  readonly contextTokens: number;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export const DEFAULT_MOM_OPTIONS: MomOptions = {
  contextTokens: 4096,
  maxTokens: 1500,
  temperature: 0.2,
};

/** Builds the initial state. Pure: no model call, so it is instant and safe to redo. */
export function planJob(
  sessionId: string,
  segments: readonly TranscriptSegment[],
  opts: MomOptions = DEFAULT_MOM_OPTIONS,
): MomJobState {
  const merged = { ...DEFAULT_MOM_OPTIONS, ...opts };

  // The reply shares the context window with the prompt. Budgeting only
  // against the input is how a "safely sized" chunk still overflows: with a
  // 4096 window and 1500 reserved for output, only ~2600 remain for input, and
  // Ollama answers an overflow by silently truncating rather than erroring.
  const plan = planChunks(segments, {
    contextTokens: merged.contextTokens,
    promptAllowanceTokens: DEFAULT_PROMPT_ALLOWANCE + (merged.maxTokens ?? 0),
  });
  return {
    sessionId,
    speakers: plan.speakers,
    chunkTexts: plan.chunks.map((c: Chunk) => c.text),
    notes: [],
    phase: plan.chunks.length === 0 ? 'failed' : 'mapping',
    minutes: null,
    error: plan.chunks.length === 0 ? 'nothing was captured in this meeting' : undefined,
    attempts: 0,
    callMs: [],
    paused: false,
  };
}

/**
 * Estimated time left, from the calls already timed.
 *
 * Measured rather than guessed, and deliberately absent until at least one call
 * has completed — a countdown invented from nothing is worse than none.
 */
function etaOf(state: MomJobState, remaining: number): number | undefined {
  // Tolerates a job written before callMs existed; see JobStore.normalise.
  const timings = state.callMs ?? [];
  if (timings.length === 0 || remaining <= 0) return undefined;
  const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
  return Math.round(mean * remaining);
}

export function progressOf(state: MomJobState): MomProgress {
  // One call per chunk plus the merge, and the SAME total for every phase.
  // Counting chunks while mapping and chunks+1 while reducing made the bar
  // climb to 100% and then jump backwards for the final step.
  const total = state.chunkTexts.length + 1;

  switch (state.phase) {
    case 'mapping': {
      const done = state.notes.length;
      return { phase: 'mapping', done, total, etaMs: etaOf(state, total - done) };
    }
    case 'reducing':
      return { phase: 'reducing', done: total - 1, total, etaMs: etaOf(state, 1) };
    case 'done':
      return { phase: 'done', done: total, total };
    case 'failed':
      return { phase: 'failed', done: state.notes.length, total, detail: state.error };
    default:
      return { phase: 'queued', done: 0, total };
  }
}

export class MomBuilder {
  constructor(
    private readonly llm: LlmClient,
    private readonly opts: MomOptions = DEFAULT_MOM_OPTIONS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Advances the job by exactly one unit of work: one chunk, or the reduce.
   *
   * Never throws for model-side problems — a failure is returned as state so
   * the caller can persist it and show it. Capture is already durable by this
   * point, and losing a transcript because a model was unreachable would be
   * the worst possible trade.
   */
  async step(state: MomJobState, signal?: AbortSignal): Promise<StepResult> {
    if (state.phase === 'done' || state.phase === 'failed') {
      return { state, progress: progressOf(state), more: false };
    }

    const startedAt = this.now();
    try {
      const result =
        state.phase === 'mapping'
          ? await this.stepMap(state, signal)
          : await this.stepReduce(state, signal);

      const timed: MomJobState = {
        ...result.state,
        callMs: [...(state.callMs ?? []), this.now() - startedAt],
      };
      return { ...result, state: timed, progress: progressOf(timed) };
    } catch (e) {
      const failed: MomJobState = {
        ...state,
        phase: 'failed',
        error: e instanceof Error ? e.message : String(e),
      };
      return { state: failed, progress: progressOf(failed), more: false };
    }
  }

  private async stepMap(state: MomJobState, signal?: AbortSignal): Promise<StepResult> {
    const i = state.notes.length;
    const text = state.chunkTexts[i];

    if (text === undefined) {
      const next: MomJobState = { ...state, phase: 'reducing' };
      return { state: next, progress: progressOf(next), more: true };
    }

    const result = await this.llm.complete({
      messages: mapPrompt(text, state.speakers, i + 1, state.chunkTexts.length),
      jsonSchema: MINUTES_SCHEMA,
      maxTokens: this.opts.maxTokens,
      temperature: this.opts.temperature,
      signal,
    });

    const parsed = await this.parseOrRepair(result.text, signal);
    const notes = coerceChunkNotes(parsed ?? {}, state.speakers);

    const advanced: MomJobState = {
      ...state,
      notes: [...state.notes, notes],
      // A chunk we could not parse still advances the job. Losing one chunk's
      // notes is survivable; stalling the whole meeting on it is not.
      phase: state.notes.length + 1 >= state.chunkTexts.length ? 'reducing' : 'mapping',
    };
    return { state: advanced, progress: progressOf(advanced), more: true };
  }

  private async stepReduce(state: MomJobState, signal?: AbortSignal): Promise<StepResult> {
    // One chunk: its notes already are the minutes, so skip a needless call.
    if (state.notes.length === 1) {
      const only = state.notes[0]!;
      const done: MomJobState = {
        ...state,
        phase: 'done',
        minutes: { ...EMPTY_MINUTES, ...only },
      };
      return { state: done, progress: progressOf(done), more: false };
    }

    const notes = await this.reduceRecursively(state.notes, state.speakers, signal);

    const result = await this.llm.complete({
      messages: reducePrompt(notes, state.speakers),
      jsonSchema: MINUTES_SCHEMA,
      maxTokens: this.opts.maxTokens,
      temperature: this.opts.temperature,
      signal,
    });

    const parsed = await this.parseOrRepair(result.text, signal);
    const minutes =
      parsed === null
        ? minutesFromRawText(result.text)
        : coerceMinutes(parsed, state.speakers);

    const done: MomJobState = { ...state, phase: 'done', minutes };
    return { state: done, progress: progressOf(done), more: false };
  }

  /**
   * Collapses notes in batches when they themselves overflow the context.
   *
   * A three-hour meeting produces enough chunk notes to blow the window on the
   * reduce, which is exactly the silent-truncation failure map-reduce exists to
   * avoid — so the reduce recurses rather than trusting the model to cope.
   */
  private async reduceRecursively(
    notes: readonly ChunkNotes[],
    speakers: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly ChunkNotes[]> {
    const budget = this.opts.contextTokens * MAX_REDUCE_INPUT_TOKENS_RATIO;
    if (estimateTokens(JSON.stringify(notes)) <= budget) return notes;

    const groups: ChunkNotes[][] = [];
    let group: ChunkNotes[] = [];
    let tokens = 0;
    for (const n of notes) {
      const cost = estimateTokens(JSON.stringify(n));
      if (group.length > 0 && tokens + cost > budget) {
        groups.push(group);
        group = [];
        tokens = 0;
      }
      group.push(n);
      tokens += cost;
    }
    if (group.length > 0) groups.push(group);

    // No progress possible — merging would loop forever. Send what we have.
    if (groups.length >= notes.length) return notes;

    const merged: ChunkNotes[] = [];
    for (const g of groups) {
      const result = await this.llm.complete({
        messages: reducePrompt(g, speakers),
        jsonSchema: MINUTES_SCHEMA,
        maxTokens: this.opts.maxTokens,
        temperature: this.opts.temperature,
        signal,
      });
      const parsed = await this.parseOrRepair(result.text, signal);
      merged.push(coerceChunkNotes(parsed ?? {}, speakers));
    }
    return this.reduceRecursively(merged, speakers, signal);
  }

  /** Parse, then one stricter retry, then give up and let the caller keep the text. */
  private async parseOrRepair(text: string, signal?: AbortSignal): Promise<unknown | null> {
    const first = parseLoose(text);
    if (first !== null) return first;

    try {
      const retry = await this.llm.complete({
        messages: repairPrompt(text),
        maxTokens: this.opts.maxTokens,
        temperature: 0,
        signal,
      });
      return parseLoose(retry.text);
    } catch {
      return null;
    }
  }
}
