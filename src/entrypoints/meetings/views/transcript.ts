import type { TranscriptSegment } from '@/capture/types';
import { formatTimestamp } from '@/utils/time';
import { el } from '@/ui/dom';

/** One caption block. `data-seg` is how the live tick finds it again. */
export function transcriptLine(segment: TranscriptSegment): HTMLElement {
  const line = el('div', 'line');
  line.dataset['seg'] = segment.id;
  if (!segment.final) line.classList.add('interim');

  const who = el('div', 'who');
  who.append(
    el('span', 'who-name', segment.speaker ?? 'Unknown'),
    el('span', 'tstamp', formatTimestamp(segment.tStart)),
  );
  line.append(who, el('div', 'said', segment.text));
  return line;
}

/**
 * The transcript.
 *
 * While recording, the newest block is still being revised by Meet's ASR, so
 * filtering to final-only hides the last thing anyone said — exactly the part
 * someone watching a live meeting wants to see.
 */
export function renderTranscript(
  segments: readonly TranscriptSegment[],
  live: boolean,
): HTMLElement {
  const shown = live ? segments : segments.filter((s) => s.final);

  if (shown.length === 0) {
    const box = el('div', 'state-box');
    box.append(
      el('div', 'state-t', 'No transcript captured'),
      el('p', 'note', 'Captions may not have been running for this meeting.'),
    );
    return box;
  }

  const wrap = el('div', 'lines');
  for (const segment of shown) wrap.append(transcriptLine(segment));
  return wrap;
}
