import { STATUS_LABEL, STATUS_TONE, type UiStatus } from '@/processing/status';
import { progressPercent, type MomProgress } from '@/processing/mom/types';
import { el } from '@/ui/dom';

/**
 * The status pill.
 *
 * While summarising it shows a percentage rather than a fraction: the fraction
 * counted model calls, which disagreed with every other number on screen. A
 * percentage is self-contained and still moves.
 */
export function statusChip(state: UiStatus, progress?: MomProgress): HTMLElement {
  const node = el('span', `chip ${STATUS_TONE[state]}`);
  if (state === 'recording') node.append(el('span', 'dotp'));
  const label =
    state === 'processing' && progress !== undefined
      ? `${progressPercent(progress)}%`
      : STATUS_LABEL[state];
  node.append(document.createTextNode(label));
  return node;
}
