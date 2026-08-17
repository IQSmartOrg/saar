import type { ChatMessage } from '@/processing/LlmClient';
import type { ChunkNotes } from '@/processing/types';

/**
 * Prompts and the output schema.
 *
 * Two things every prompt here does deliberately:
 *
 * 1. **States the schema in words as well as sending it.** `json_schema` is
 *    honoured by some providers and ignored by others, so the prompt must
 *    stand on its own.
 * 2. **Names the allowed speakers.** An unconstrained model invents
 *    participants, and an action item assigned to someone who was not present
 *    destroys trust in every other line.
 */

export const MINUTES_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          points: { type: 'array', items: { type: 'string' } },
          speakers: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'points'],
      },
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { decision: { type: 'string' }, context: { type: 'string' } },
        required: ['decision'],
      },
    },
    actionItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          task: { type: 'string' },
          due: { type: ['string', 'null'] },
          quote: { type: 'string' },
        },
        required: ['owner', 'task'],
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'topics', 'decisions', 'actionItems', 'openQuestions'],
} as const;

const SHAPE = `{
  "summary": "string",
  "topics": [{ "title": "string", "points": ["string"], "speakers": ["string"] }],
  "decisions": [{ "decision": "string", "context": "string" }],
  "actionItems": [{ "owner": "string", "task": "string", "due": "string or null", "quote": "string" }],
  "openQuestions": ["string"]
}`;

function speakerRule(speakers: readonly string[]): string {
  if (speakers.length === 0) {
    return 'No speaker names are known. Use "Unassigned" as the owner of every action item.';
  }
  return [
    `The only people in this meeting are: ${speakers.join(', ')}.`,
    'Every action item owner MUST be exactly one of those names, or "Unassigned".',
    'Never invent a participant.',
  ].join(' ');
}

const BASE_RULES = [
  'Reply with JSON only. No prose before or after, no code fences.',
  'Never invent facts. If something was not said, leave the field empty.',
  'Quotes must be copied verbatim from the transcript.',
].join(' ');

/** Map phase: one chunk of transcript → structured notes. */
export function mapPrompt(
  chunkText: string,
  speakers: readonly string[],
  part: number,
  total: number,
): ChatMessage[] {
  const position =
    total > 1
      ? `This is part ${part} of ${total} of a longer meeting, so it may begin or end mid-discussion. Record only what this part actually contains.`
      : 'This is the complete meeting.';

  return [
    {
      role: 'system',
      content: [
        'You extract structured notes from meeting transcripts.',
        BASE_RULES,
        speakerRule(speakers),
        `Use exactly this shape:\n${SHAPE}`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [position, '', 'Transcript:', chunkText].join('\n'),
    },
  ];
}

/** Reduce phase: notes from every chunk → one set of minutes. */
export function reducePrompt(
  notes: readonly ChunkNotes[],
  speakers: readonly string[],
): ChatMessage[] {
  const body = notes
    .map((n, i) => `--- Notes from part ${i + 1} ---\n${JSON.stringify(n, null, 2)}`)
    .join('\n\n');

  return [
    {
      role: 'system',
      content: [
        'You merge partial meeting notes into one set of minutes.',
        BASE_RULES,
        speakerRule(speakers),
        'Merge duplicates: the parts overlap, so the same decision or action may appear more than once. State each exactly once, keeping the fullest wording.',
        'Order topics as they occurred. The summary must cover the whole meeting in 3-5 sentences.',
        `Use exactly this shape:\n${SHAPE}`,
      ].join('\n'),
    },
    { role: 'user', content: body },
  ];
}

/**
 * Retry prompt after unparseable output. Strictly narrower than the original —
 * a model that failed to produce JSON rarely succeeds when asked the same way.
 */
export function repairPrompt(previous: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You convert text into strict JSON.',
        'Output a single JSON object and nothing else. No commentary, no code fences.',
        `Use exactly this shape:\n${SHAPE}`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Convert the following into that JSON object:\n\n${previous}`,
    },
  ];
}
