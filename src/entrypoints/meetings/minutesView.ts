import type { MeetingMinutes } from '@/core/types/minutes';

/**
 * Rendering minutes.
 *
 * The load-bearing decision here is that every action item shows the verbatim
 * sentence it came from. Output from a small local model is only as useful as
 * it is checkable, and the quote is what turns "the model says Ana agreed to
 * this" into something a reader can verify without opening the transcript.
 */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(heading: string): HTMLElement {
  const s = el('section', 'mins-section');
  s.append(el('h3', 'sec-h', heading));
  return s;
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

  if (minutes.summary !== '') {
    const s = section('Summary');
    s.append(el('p', 'summary', minutes.summary));
    root.append(s);
  }

  if (minutes.topics.length > 0) {
    const s = section('Topics');
    for (const t of minutes.topics) {
      const topic = el('div', 'topic');
      topic.append(el('div', 'topic-t', t.title));
      if (t.points.length > 0) {
        const ul = el('ul');
        for (const p of t.points) ul.append(el('li', undefined, p));
        topic.append(ul);
      }
      if (t.speakers.length > 0) topic.append(el('div', 'topic-s', t.speakers.join(', ')));
      s.append(topic);
    }
    root.append(s);
  }

  if (minutes.decisions.length > 0) {
    const s = section('Decisions');
    for (const d of minutes.decisions) {
      const row = el('div', 'dec');
      row.append(el('span', 'tick', '✓'));
      const body = el('div');
      body.append(el('div', undefined, d.decision));
      if (d.context !== '') body.append(el('div', 'dec-c', d.context));
      row.append(body);
      s.append(row);
    }
    root.append(s);
  }

  if (minutes.actionItems.length > 0) {
    const s = section('Action items');
    for (const a of minutes.actionItems) {
      const item = el('div', 'action-item');
      const top = el('div', 'ai-top');
      const owner = el('span', 'owner', a.owner);
      // Owners are constrained to people who actually spoke; anything else
      // becomes "Unassigned", and it should look different from a real name.
      if (a.owner === 'Unassigned') owner.classList.add('none');
      top.append(owner);
      if (a.due !== null && a.due !== '') top.append(el('span', 'due', `by ${a.due}`));
      item.append(top, el('div', 'ai-task', a.task));
      if (a.quote !== '') item.append(el('blockquote', 'quote', a.quote));
      s.append(item);
    }
    root.append(s);
  }

  if (minutes.openQuestions.length > 0) {
    const s = section('Open questions');
    const ul = el('ul', 'qs');
    for (const q of minutes.openQuestions) ul.append(el('li', undefined, q));
    s.append(ul);
    root.append(s);
  }

  if (root.children.length === 0) {
    root.append(el('p', 'note', 'The model returned nothing for this meeting.'));
  }
  return root;
}
