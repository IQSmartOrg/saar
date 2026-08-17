import {
  EMPTY_MINUTES,
  type ActionItem,
  type Decision,
  type MeetingMinutes,
  type Topic,
} from '@/core/types/minutes';
import type { ChunkNotes } from '@/processing/types';

/**
 * Getting structured data out of a model that was asked for JSON.
 *
 * Never assume the response is JSON. `response_format: json_schema` works on
 * some providers and is ignored by others, and small local models wrap output
 * in prose or code fences regardless. So: extract, repair, and coerce — and
 * where a field cannot be recovered, drop that field rather than the whole
 * result.
 */

/** Pulls the first balanced {...} out of arbitrary text, ignoring braces in strings. */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  // Unterminated — a truncated response. Close what is open and let the parser
  // try; a partially recovered chunk beats discarding it.
  if (depth > 0) return text.slice(start) + '}'.repeat(depth);
  return null;
}

/** Strips ``` fences and trailing commas, both common in small-model output. */
export function repairJson(text: string): string {
  return text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .trim();
}

export function parseLoose<T = unknown>(text: string): T | null {
  const candidates = [text, repairJson(text)];
  const extracted = extractJsonObject(text);
  if (extracted) candidates.push(extracted, repairJson(extracted));

  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      /* try the next repair */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Coercion
 * ------------------------------------------------------------------ */

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(str).filter((s) => s !== '');
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

export function coerceTopics(v: unknown): Topic[] {
  return arr(v)
    .map((t) => {
      const o = rec(t);
      return {
        title: str(o['title']),
        points: strArray(o['points']),
        speakers: strArray(o['speakers']),
      };
    })
    .filter((t) => t.title !== '' || t.points.length > 0);
}

export function coerceDecisions(v: unknown): Decision[] {
  return arr(v)
    .map((d) => {
      const o = rec(d);
      return { decision: str(o['decision']), context: str(o['context']) };
    })
    .filter((d) => d.decision !== '');
}

export const UNASSIGNED = 'Unassigned';

/**
 * Action items, with owners constrained to people who actually spoke.
 *
 * Without this a 7B model cheerfully invents participants, and an action item
 * assigned to someone who was not in the meeting is worse than no action item.
 * Matching is case-insensitive and accepts a first name, because models
 * routinely shorten "Priya Nair" to "Priya".
 */
export function coerceActionItems(v: unknown, speakers: readonly string[]): ActionItem[] {
  const resolveOwner = (raw: string): string => {
    if (raw === '') return UNASSIGNED;
    const lower = raw.toLowerCase();
    const exact = speakers.find((s) => s.toLowerCase() === lower);
    if (exact) return exact;
    const byFirstName = speakers.find((s) => {
      const first = s.split(/\s+/)[0]?.toLowerCase();
      return first !== undefined && (first === lower || lower.startsWith(first));
    });
    return byFirstName ?? UNASSIGNED;
  };

  return arr(v)
    .map((a) => {
      const o = rec(a);
      const due = str(o['due']);
      return {
        owner: resolveOwner(str(o['owner'])),
        task: str(o['task']),
        due: due === '' || due.toLowerCase() === 'null' ? null : due,
        quote: str(o['quote']),
      };
    })
    .filter((a) => a.task !== '');
}

export function coerceChunkNotes(v: unknown, speakers: readonly string[]): ChunkNotes {
  const o = rec(v);
  return {
    summary: str(o['summary']),
    topics: coerceTopics(o['topics']),
    decisions: coerceDecisions(o['decisions']),
    actionItems: coerceActionItems(o['actionItems'], speakers),
    openQuestions: strArray(o['openQuestions']),
  };
}

export function coerceMinutes(v: unknown, speakers: readonly string[]): MeetingMinutes {
  const o = rec(v);
  return {
    summary: str(o['summary']),
    topics: coerceTopics(o['topics']),
    decisions: coerceDecisions(o['decisions']),
    actionItems: coerceActionItems(o['actionItems'], speakers),
    openQuestions: strArray(o['openQuestions']),
  };
}

/**
 * Last resort when nothing parses: keep the model's prose verbatim.
 *
 * Losing a meeting's minutes because a model emitted an unbalanced brace would
 * be indefensible when the text itself is right there.
 */
export function minutesFromRawText(text: string): MeetingMinutes {
  return { ...EMPTY_MINUTES, summary: text.trim(), raw: text };
}
