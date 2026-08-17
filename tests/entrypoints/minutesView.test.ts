// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderMinutes } from '@/entrypoints/meetings/minutesView';
import { EMPTY_MINUTES, type MeetingMinutes } from '@/core/types/minutes';

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

  it('renders topics with their points and speakers', () => {
    const node = renderMinutes(
      minutes({
        topics: [{ title: 'Release timing', points: ['QA is green'], speakers: ['Ana', 'Bo'] }],
      }),
    );
    expect(node.querySelector('.topic-t')?.textContent).toBe('Release timing');
    expect(node.querySelector('.topic li')?.textContent).toBe('QA is green');
    expect(node.querySelector('.topic-s')?.textContent).toBe('Ana, Bo');
  });

  it('renders a decision with its context', () => {
    const node = renderMinutes(
      minutes({ decisions: [{ decision: 'Ship Friday', context: 'QA is green' }] }),
    );
    expect(node.querySelector('.dec')?.textContent).toContain('Ship Friday');
    expect(node.querySelector('.dec-c')?.textContent).toBe('QA is green');
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
