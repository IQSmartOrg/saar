// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderMinutes } from '@/entrypoints/meetings/views/minutes';
import { EMPTY_MINUTES, type MeetingMinutes } from '@/minutes/types';

function minutes(p: Partial<MeetingMinutes> = {}): MeetingMinutes {
  return { ...EMPTY_MINUTES, ...p };
}

describe('action items', () => {
  it('shows the verbatim quote behind every item', () => {
    // The whole point: output from a small local model is only as useful as it
    // is checkable, and the quote is what makes a claim verifiable.
    const node = renderMinutes(
      minutes({
        actionItems: [
          {
            owner: 'Ana Roy',
            task: 'Rewrite the annual tier copy',
            due: 'Thursday',
            quote: 'I will take the rewrite.',
          },
        ],
      }),
    );
    expect(node.querySelector('.quote')?.textContent).toBe('I will take the rewrite.');
    expect(node.querySelector('.owner')?.textContent).toBe('Ana Roy');
    expect(node.querySelector('.due')?.textContent).toBe('by Thursday');
    // It belongs to the rail, not the narrative column.
    expect(node.querySelector('.rail .action')).not.toBeNull();
  });

  it('marks an unassigned owner as different from a real name', () => {
    const node = renderMinutes(
      minutes({
        actionItems: [{ owner: 'Unassigned', task: 'Write the help article', due: null, quote: '' }],
      }),
    );
    expect(node.querySelector('.owner')?.classList.contains('none')).toBe(true);
  });

  it('omits the due chip when there is no date', () => {
    const node = renderMinutes(
      minutes({ actionItems: [{ owner: 'Bo', task: 'Ship it', due: null, quote: '' }] }),
    );
    expect(node.querySelector('.due')).toBeNull();
  });

  it('omits the quote block when the model gave none', () => {
    const node = renderMinutes(
      minutes({ actionItems: [{ owner: 'Bo', task: 'Ship it', due: null, quote: '' }] }),
    );
    expect(node.querySelector('.quote')).toBeNull();
  });
});

describe('sections', () => {
  it('renders only the sections that have content', () => {
    const node = renderMinutes(minutes({ summary: 'We shipped.' }));
    const headings = [...node.querySelectorAll('.sec-h')].map((h) => h.textContent);
    expect(headings).toEqual(['Summary']);
  });

  it('numbers topics in the order they were discussed', () => {
    const node = renderMinutes(
      minutes({
        topics: [
          { title: 'First', points: [], speakers: [] },
          { title: 'Second', points: [], speakers: [] },
        ],
      }),
    );
    expect([...node.querySelectorAll('.topic-n')].map((n) => n.textContent)).toEqual(['01', '02']);
  });

  it('renders topics with their points and speakers', () => {
    const node = renderMinutes(
      minutes({
        topics: [{ title: 'Release timing', points: ['QA is green'], speakers: ['Ana', 'Bo'] }],
      }),
    );
    expect(node.querySelector('.topic-t')?.textContent).toBe('Release timing');
    expect(node.querySelector('.topic li')?.textContent).toBe('QA is green');
    // Speakers are chips now, not a run-on grey line.
    expect([...node.querySelectorAll('.who-chip')].map((c) => c.textContent)).toEqual(['Ana', 'Bo']);
  });

  it('renders a decision with its context', () => {
    const node = renderMinutes(
      minutes({ decisions: [{ decision: 'Ship Friday', context: 'QA is green' }] }),
    );
    expect(node.querySelector('.decision')?.textContent).toContain('Ship Friday');
    expect(node.querySelector('.d-ctx')?.textContent).toBe('QA is green');
  });
});

describe('outcomes go in the rail, narrative in the main column', () => {
  const full = minutes({
    summary: 'We met.',
    topics: [{ title: 'Release', points: ['QA green'], speakers: ['Ana'] }],
    decisions: [{ decision: 'Ship Friday', context: '' }],
    actionItems: [{ owner: 'Ana', task: 'Cut the build', due: null, quote: '' }],
    openQuestions: ['Who tells support?'],
  });

  it('puts summary and topics in the main column', () => {
    const node = renderMinutes(full);
    expect(node.querySelector('.mins-main .summary')).not.toBeNull();
    expect(node.querySelector('.mins-main .topic')).not.toBeNull();
  });

  it('puts every actionable section in the rail', () => {
    // These were below every topic before — a long scroll past the narrative
    // to reach the only part anyone has to act on.
    const node = renderMinutes(full);
    const headings = [...node.querySelectorAll('.rail .panel-h')].map(
      (h) => h.firstChild?.textContent,
    );
    expect(headings).toEqual(['Action items', 'Decisions', 'Open questions']);
  });

  it('shows each panel count without opening it', () => {
    const node = renderMinutes(full);
    expect([...node.querySelectorAll('.rail .count')].map((c) => c.textContent)).toEqual([
      '1',
      '1',
      '1',
    ]);
  });

  it('gives the narrative full width when there are no outcomes', () => {
    const node = renderMinutes(minutes({ summary: 'Just a chat.' }));
    expect(node.classList.contains('no-rail')).toBe(true);
    expect(node.querySelector('.rail')).toBeNull();
  });

  it('gives the rail full width when there is no narrative', () => {
    const node = renderMinutes(
      minutes({ decisions: [{ decision: 'Ship it', context: '' }] }),
    );
    expect(node.classList.contains('rail-only')).toBe(true);
  });
});

describe('degraded output', () => {
  it('shows unparseable model output rather than pretending nothing happened', () => {
    // Losing a meeting's minutes to an unbalanced brace would be indefensible
    // when the text itself is right there.
    const node = renderMinutes(minutes({ summary: 'prose', raw: 'The team agreed to ship.' }));
    expect(node.querySelector('.summary.raw')?.textContent).toBe('The team agreed to ship.');
    expect(node.textContent).toContain('could not be read as structured minutes');
  });

  it('says so plainly when the model returned nothing at all', () => {
    expect(renderMinutes(minutes()).textContent).toContain('returned nothing');
  });
});
