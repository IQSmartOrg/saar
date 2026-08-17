import type { MeetingMinutes } from '@/minutes/types';
import { el } from '@/ui/dom';

/**
 * Rendering minutes.
 *
 * Two decisions carry this view:
 *
 * 1. **Outcomes are separated from narrative.** Decisions, action items and
 *    open questions go in a sticky rail rather than below the topics. On a
 *    75-minute meeting the actionable part was a long scroll past everything
 *    else, which is backwards — it is the reason the page gets opened.
 * 2. **Every action item shows the sentence it came from.** Output from a small
 *    local model is only as useful as it is checkable, and the quote is what
 *    turns "the model says Ana agreed" into something a reader can verify
 *    without opening the transcript.
 */

function section(heading: string): HTMLElement {
  const s = el('section', 'mins-section');
  s.append(el('h3', 'sec-h', heading));
  return s;
}

/** A rail panel, with the count in its header so the size is visible unopened. */
function panel(heading: string, count: number): HTMLElement {
  const p = el('div', 'panel');
  const head = el('div', 'panel-h');
  head.append(el('span', undefined, heading), el('span', 'count', String(count)));
  p.append(head);
  return p;
}

function renderTopics(minutes: MeetingMinutes): HTMLElement {
  const s = section('Topics');
  minutes.topics.forEach((t, i) => {
    const topic = el('div', 'topic');
    const head = el('div', 'topic-head');
    // Numbered because the topics are in the order they were discussed, so the
    // number carries real information and gives a long meeting a spine.
    head.append(
      el('span', 'topic-n', String(i + 1).padStart(2, '0')),
      el('span', 'topic-t', t.title),
    );
    topic.append(head);

    if (t.points.length > 0) {
      const ul = el('ul');
      for (const p of t.points) ul.append(el('li', undefined, p));
      topic.append(ul);
    }
    if (t.speakers.length > 0) {
      const row = el('div', 'who-row');
      for (const name of t.speakers) row.append(el('span', 'who-chip', name));
      topic.append(row);
    }
    s.append(topic);
  });
  return s;
}

function renderActionItems(minutes: MeetingMinutes): HTMLElement {
  const p = panel('Action items', minutes.actionItems.length);
  for (const a of minutes.actionItems) {
    const item = el('div', 'action');
    const top = el('div', 'a-top');

    const owner = el('span', 'owner', a.owner);
    // Owners are constrained to people who actually spoke; anything else
    // becomes "Unassigned" and must not read like a real name.
    if (a.owner === 'Unassigned') owner.classList.add('none');
    top.append(owner);
    if (a.due !== null && a.due !== '') top.append(el('span', 'due', `by ${a.due}`));

    item.append(top, el('div', 'a-task', a.task));
    if (a.quote !== '') item.append(el('blockquote', 'quote', a.quote));
    p.append(item);
  }
  return p;
}

function renderDecisions(minutes: MeetingMinutes): HTMLElement {
  const p = panel('Decisions', minutes.decisions.length);
  for (const d of minutes.decisions) {
    const row = el('div', 'decision');
    row.append(el('span', 'tick', '✓'));
    const body = el('div');
    body.append(el('div', 'd-text', d.decision));
    if (d.context !== '') body.append(el('div', 'd-ctx', d.context));
    row.append(body);
    p.append(row);
  }
  return p;
}

function renderQuestions(minutes: MeetingMinutes): HTMLElement {
  const p = panel('Open questions', minutes.openQuestions.length);
  const ul = el('ul', 'qs');
  for (const q of minutes.openQuestions) ul.append(el('li', undefined, q));
  p.append(ul);
  return p;
}

export function renderMinutes(minutes: MeetingMinutes): HTMLElement {
  const root = el('div', 'mins');

  // Unparseable model output is kept verbatim rather than discarded, so show
  // it plainly instead of pretending the meeting produced nothing.
  if (minutes.raw !== undefined && minutes.topics.length === 0) {
    const s = section('Summary');
    s.append(el('p', 'summary raw', minutes.raw.trim()));
    s.append(
      el(
        'p',
        'note',
        'The model’s reply could not be read as structured minutes, so it is shown as written.',
      ),
    );
    root.append(s);
    return root;
  }

  const main = el('main', 'mins-main');
  if (minutes.summary !== '') {
    const s = section('Summary');
    s.append(el('p', 'summary', minutes.summary));
    main.append(s);
  }
  if (minutes.topics.length > 0) main.append(renderTopics(minutes));

  const rail = el('aside', 'rail');
  if (minutes.actionItems.length > 0) rail.append(renderActionItems(minutes));
  if (minutes.decisions.length > 0) rail.append(renderDecisions(minutes));
  if (minutes.openQuestions.length > 0) rail.append(renderQuestions(minutes));

  if (main.children.length === 0 && rail.children.length === 0) {
    root.append(el('p', 'note', 'The model returned nothing for this meeting.'));
    return root;
  }

  // A meeting with outcomes but no narrative (or the reverse) gets the full
  // width rather than an empty column beside it.
  if (rail.children.length === 0) {
    root.classList.add('no-rail');
  } else if (main.children.length === 0) {
    root.classList.add('rail-only');
  }

  if (main.children.length > 0) root.append(main);
  if (rail.children.length > 0) root.append(rail);
  return root;
}
