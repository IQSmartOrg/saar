import type { MeetingSession } from '@/session/types';
import type { UiStatus } from '@/processing/status';
import type { MomAction } from '@/messaging/messages';
import {
  describePaused,
  describePhase,
  progressPercent,
  type MomProgress,
} from '@/processing/mom/types';
import { button, el } from '@/ui/dom';
import { statusChip } from '@/entrypoints/meetings/views/chip';

/**
 * The nodes a live tick updates in place, handed back rather than looked up
 * again later. Re-rendering the pane on a timer replaced everything every two
 * seconds, which read as a blink and threw away scroll position and text
 * selection along with it.
 */
export interface StateBox {
  readonly node: HTMLElement;
  readonly phase?: HTMLElement;
  readonly fill?: HTMLElement;
}

export interface StateBoxHandlers {
  readonly onRetry: () => void;
  readonly onMom: (action: MomAction) => void;
}

/**
 * A run under way, or one the user has stopped.
 *
 * Cancel is the quieter button on purpose: pausing is reversible, and
 * cancelling discards every chunk already summarised.
 */
function runningBox(
  state: UiStatus,
  progress: MomProgress | undefined,
  on: StateBoxHandlers,
): StateBox {
  const node = el('div', 'state-box');
  const paused = state === 'paused';

  // No chip on a running job. It counted model calls (0/8) while the line below
  // counted transcript parts (1 of 7) — both right, both visible, and together
  // they read as a contradiction. The sentence and the bar are enough. Paused
  // is different: there the chip is the whole point.
  if (paused) node.append(statusChip('paused'));

  let text: string;
  if (progress === undefined) text = paused ? 'Paused' : 'Writing the minutes…';
  else text = paused ? describePaused(progress) : describePhase(progress);

  const phase = el('div', 'state-t', text);
  const track = el('div', 'track');
  const fill = el('span');
  fill.style.width = `${progress ? progressPercent(progress) : 0}%`;
  track.append(fill);

  node.append(
    phase,
    track,
    el(
      'p',
      'note',
      paused
        ? 'Nothing is running. Resuming picks up where it stopped.'
        : 'You can read the transcript while this runs.',
    ),
  );

  const actions = el('div', 'actions');
  actions.append(
    paused
      ? button('Resume', 'act primary', () => on.onMom('resume'))
      : button('Pause', 'act primary', () => on.onMom('pause')),
    button('Cancel', 'act quiet', () => on.onMom('cancel')),
  );
  node.append(actions);

  return { node, phase, fill };
}

/** What stands in for the minutes when there are none to show. */
export function renderStateBox(
  session: MeetingSession,
  state: UiStatus,
  progress: MomProgress | undefined,
  on: StateBoxHandlers,
): StateBox {
  if (state === 'processing' || state === 'paused') return runningBox(state, progress, on);

  const node = el('div', 'state-box');

  if (state === 'failed') {
    node.classList.add('bad');
    node.append(
      statusChip('failed'),
      el('div', 'state-t', session.error ?? 'The model did not answer.'),
      // The transcript survives every summarisation failure by design.
      el('p', 'note', 'The transcript is saved. Nothing was lost.'),
    );
    const actions = el('div', 'actions');
    actions.append(button('Try again', 'act primary', on.onRetry));
    node.append(actions);
    return { node };
  }

  node.append(
    el('div', 'state-t', 'No summary for this meeting'),
    el('p', 'note', 'AI summaries were off when it was recorded. The transcript is complete.'),
  );
  const actions = el('div', 'actions');
  actions.append(button('Summarise now', 'act primary', on.onRetry));
  node.append(actions);
  return { node };
}
