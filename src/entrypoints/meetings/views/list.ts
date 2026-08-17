import type { MeetingSession } from '@/session/types';
import type { UiStatus } from '@/processing/status';
import type { MomProgress } from '@/processing/mom/types';
import { el } from '@/ui/dom';
import { durationMinutes, groupByDay, matches } from '@/entrypoints/meetings/listModel';
import { statusChip } from '@/entrypoints/meetings/views/chip';

export interface ListViewModel {
  readonly sessions: readonly MeetingSession[];
  readonly query: string;
  readonly selectedId: string | null;
  /** Transcript text per session, for searching inside meetings. */
  readonly transcripts: ReadonlyMap<string, string>;
  readonly statusOf: (session: MeetingSession) => UiStatus;
  readonly progressOf: (sessionId: string) => MomProgress | undefined;
  readonly onSelect: (sessionId: string) => void;
}

function emptyState(query: string): HTMLElement {
  const empty = el('div', 'list-empty');
  const blank = query.trim() === '';
  empty.append(
    el('p', 'empty-t', blank ? 'No meetings yet' : 'Nothing matches'),
    el(
      'p',
      'note',
      blank
        ? 'Saar saves a transcript every time it joins a Meet call.'
        : 'Try a word someone actually said.',
    ),
  );
  return empty;
}

/** The sidebar: meetings grouped by day, newest first. */
export function renderList(root: HTMLElement, vm: ListViewModel): void {
  const visible = vm.sessions.filter((s) => matches(s, vm.query, vm.transcripts.get(s.id)));
  root.replaceChildren();

  if (visible.length === 0) {
    root.append(emptyState(vm.query));
    return;
  }

  for (const group of groupByDay(visible)) {
    root.append(el('div', 'grouphead', group.label));
    for (const session of group.sessions) {
      const item = el('button', 'item');
      item.type = 'button';
      if (session.id === vm.selectedId) item.classList.add('on');

      const row = el('div', 'item-row');
      row.append(
        el('span', 'item-t', session.title ?? session.meetingCode),
        statusChip(vm.statusOf(session), vm.progressOf(session.id)),
      );

      const mins = durationMinutes(session);
      const when = new Date(session.startedAt).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
      const meta = [when, mins === null ? null : `${mins} min`].filter(Boolean).join(' · ');

      item.append(row, el('span', 'item-m', meta));
      item.addEventListener('click', () => vm.onSelect(session.id));
      root.append(item);
    }
  }
}
