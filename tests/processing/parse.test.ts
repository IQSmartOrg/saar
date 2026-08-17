import { describe, it, expect } from 'vitest';
import {
  coerceActionItems,
  coerceMinutes,
  extractJsonObject,
  minutesFromRawText,
  parseLoose,
  repairJson,
  UNASSIGNED,
} from '@/processing/parse';

describe('extractJsonObject', () => {
  it('pulls the object out of surrounding prose', () => {
    const text = 'Sure! Here are the minutes:\n{"summary":"ok"}\nHope that helps.';
    expect(extractJsonObject(text)).toBe('{"summary":"ok"}');
  });

  it('handles nested objects', () => {
    const text = 'x {"a":{"b":{"c":1}}} y';
    expect(extractJsonObject(text)).toBe('{"a":{"b":{"c":1}}}');
  });

  it('is not fooled by braces inside strings', () => {
    const text = '{"summary":"we discussed {scope} and }braces{"}';
    expect(JSON.parse(extractJsonObject(text)!)).toHaveProperty('summary');
  });

  it('is not fooled by escaped quotes', () => {
    const text = String.raw`{"summary":"they said \"ship it\" today"}`;
    expect(JSON.parse(extractJsonObject(text)!).summary).toContain('ship it');
  });

  it('closes a truncated object so a cut-off response is still usable', () => {
    // Hitting max_tokens mid-object should not cost us the whole chunk.
    const out = extractJsonObject('{"summary":"partial","topics":[');
    expect(out?.endsWith('}')).toBe(true);
  });

  it('returns null when there is no object at all', () => {
    expect(extractJsonObject('no json here')).toBeNull();
  });
});

describe('repairJson', () => {
  it('strips code fences', () => {
    expect(repairJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('removes trailing commas', () => {
    expect(JSON.parse(repairJson('{"a":1,}'))).toEqual({ a: 1 });
  });
});

describe('parseLoose', () => {
  it('parses clean JSON', () => {
    expect(parseLoose('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses fenced JSON', () => {
    expect(parseLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('parses JSON buried in prose', () => {
    expect(parseLoose('Here you go:\n{"a":1}\nThanks!')).toEqual({ a: 1 });
  });

  it('returns null when nothing is recoverable', () => {
    expect(parseLoose('completely unstructured reply')).toBeNull();
  });
});

describe('coerceActionItems — owner constraint', () => {
  const speakers = ['Priya Nair', 'Tom Baker'];

  it('keeps an exact speaker match', () => {
    const [item] = coerceActionItems([{ owner: 'Priya Nair', task: 'ship' }], speakers);
    expect(item!.owner).toBe('Priya Nair');
  });

  it('resolves a first name to the full name', () => {
    // Models routinely shorten "Priya Nair" to "Priya".
    const [item] = coerceActionItems([{ owner: 'priya', task: 'ship' }], speakers);
    expect(item!.owner).toBe('Priya Nair');
  });

  it('refuses an invented participant', () => {
    // An action assigned to someone who was not there destroys trust in every
    // other line of the minutes.
    const [item] = coerceActionItems([{ owner: 'Sandra Who', task: 'ship' }], speakers);
    expect(item!.owner).toBe(UNASSIGNED);
  });

  it('falls back to Unassigned when no speakers are known', () => {
    const [item] = coerceActionItems([{ owner: 'Anyone', task: 'ship' }], []);
    expect(item!.owner).toBe(UNASSIGNED);
  });

  it('drops items with no task', () => {
    expect(coerceActionItems([{ owner: 'Priya Nair', task: '' }], speakers)).toEqual([]);
  });

  it('normalises a "null" string due date to null', () => {
    const [item] = coerceActionItems([{ owner: 'Tom Baker', task: 'x', due: 'null' }], speakers);
    expect(item!.due).toBeNull();
  });
});

describe('coerceMinutes', () => {
  it('survives entirely wrong types without throwing', () => {
    const m = coerceMinutes(
      { summary: 42, topics: 'nope', decisions: null, actionItems: {}, openQuestions: [1, 'ok'] },
      [],
    );
    expect(m.summary).toBe('');
    expect(m.topics).toEqual([]);
    expect(m.decisions).toEqual([]);
    expect(m.actionItems).toEqual([]);
    expect(m.openQuestions).toEqual(['ok']);
  });

  it('drops topics that carry neither a title nor points', () => {
    const m = coerceMinutes({ topics: [{ title: '', points: [] }, { title: 'Real' }] }, []);
    expect(m.topics).toHaveLength(1);
  });
});

describe('minutesFromRawText', () => {
  it('keeps the prose rather than losing the meeting', () => {
    // Losing minutes to an unbalanced brace would be indefensible when the
    // text itself is right there.
    const m = minutesFromRawText('The team agreed to ship on Friday.');
    expect(m.summary).toContain('ship on Friday');
    expect(m.raw).toBeTruthy();
  });
});
