import type { MeetingSession } from '@/session/types';
import type { TranscriptSegment } from '@/capture/types';
import type { MeetingMinutes } from '@/minutes/types';
import { meetingToMarkdown, minutesToMarkdown, transcriptToMarkdown } from '@/minutes/toMarkdown';
import { canSummarise, type UiStatus } from '@/processing/status';
import type { MomAction } from '@/messaging/messages';
import type { MomProgress } from '@/processing/mom/types';
import { button, el } from '@/ui/dom';
import { durationMinutes } from '@/entrypoints/meetings/listModel';
import { copyToClipboard, downloadMarkdown } from '@/entrypoints/meetings/exportActions';
import { renderMinutes } from '@/entrypoints/meetings/views/minutes';
import { renderStateBox } from '@/entrypoints/meetings/views/stateBox';
import { renderTranscript } from '@/entrypoints/meetings/views/transcript';

export type DetailTab = 'minutes' | 'transcript';

export interface DetailViewModel {
  readonly session: MeetingSession;
  readonly segments: readonly TranscriptSegment[];
  readonly minutes: MeetingMinutes | null;
  readonly state: UiStatus;
  readonly progress: MomProgress | undefined;
  readonly tab: DetailTab;
  readonly onTab: (tab: DetailTab) => void;
  readonly onRetry: () => void;
  readonly onDelete: () => void;
  /** Pause, resume or abandon the summarisation run. */
  readonly onMom: (action: MomAction) => void;
}

/** Nodes a live tick updates in place, so nothing is re-rendered on a timer. */
export interface DetailNodes {
  readonly lines?: HTMLElement;
  readonly phase?: HTMLElement;
  readonly fill?: HTMLElement;
}

export function renderEmptyDetail(root: HTMLElement): void {
  const empty = el('div', 'detail-empty');
  empty.append(
    el('p', 'empty-t', 'Pick a meeting'),
    el('p', 'note', 'Its minutes and transcript appear here.'),
  );
  root.replaceChildren(empty);
}

function renderHeader(vm: DetailViewModel, lineCount: number): HTMLElement {
  const { session } = vm;

  const head = el('div', 'd-head');
  head.append(el('h2', 'd-title', session.title ?? session.meetingCode));

  const mins = durationMinutes(session);
  const meta = [
    new Date(session.startedAt).toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    mins === null ? null : `${mins} min`,
    `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`,
    session.meetingCode,
  ]
    .filter(Boolean)
    .join(' · ');
  head.append(el('div', 'd-meta', meta));

  const top = el('div', 'd-top');
  const identity = el('div', 'd-identity');
  identity.append(head);
  top.append(identity, button('Delete', 'act danger', vm.onDelete));
  return top;
}

/**
 * One control bar: tabs, the actions that belong to whichever is showing, and
 * re-run pushed to the far end. Three stacked rows pushed the meeting itself
 * below the fold.
 */
function renderBar(vm: DetailViewModel, lineCount: number): HTMLElement {
  const { session, segments, minutes, state, tab } = vm;

  const bar = el('div', 'bar');
  const tabs = el('div', 'tabs');
  tabs.append(
    button('Minutes', tab === 'minutes' ? 'on' : '', () => vm.onTab('minutes')),
    button(`Transcript · ${lineCount}`, tab === 'transcript' ? 'on' : '', () =>
      vm.onTab('transcript'),
    ),
  );
  bar.append(tabs);

  const showingMinutes = tab === 'minutes' && minutes !== null;

  const copy = button(showingMinutes ? 'Copy minutes' : 'Copy transcript', 'act primary', () =>
    copyToClipboard(
      copy,
      showingMinutes ? minutesToMarkdown(minutes) : transcriptToMarkdown(session, segments),
    ),
  );

  const download = button('Download .md', 'act', () => {
    // One complete file regardless of the tab: minutes without the transcript
    // lose the evidence behind them.
    downloadMarkdown(`${session.meetingCode}.md`, meetingToMarkdown(session, segments, minutes));
  });
  download.title = 'Minutes and full transcript in one file';

  // Nothing worth copying yet on an empty or unwritten section.
  if (showingMinutes || lineCount > 0) bar.append(copy, download);

  bar.append(el('span', 'spacer'));
  if (canSummarise(state, lineCount > 0)) {
    bar.append(
      button(minutes === null ? 'Summarise' : 'Re-run summary', 'act quiet', vm.onRetry),
    );
  }
  return bar;
}

export function renderDetail(root: HTMLElement, vm: DetailViewModel): DetailNodes {
  const { session, segments, minutes, state, tab } = vm;

  // Interim blocks are shown while recording, so count them too — otherwise a
  // live meeting reads "0 lines" while text is visibly arriving.
  const shown = state === 'recording' ? segments : segments.filter((s) => s.final);

  root.replaceChildren(renderHeader(vm, shown.length), renderBar(vm, shown.length));

  if (tab === 'transcript') {
    const lines = renderTranscript(segments, state === 'recording');
    root.append(lines);
    return { lines };
  }

  if (minutes !== null) {
    root.append(renderMinutes(minutes));
    return {};
  }

  const box = renderStateBox(session, state, vm.progress, {
    onRetry: vm.onRetry,
    onMom: vm.onMom,
  });
  root.append(box.node);
  return { ...(box.phase && { phase: box.phase }), ...(box.fill && { fill: box.fill }) };
}
