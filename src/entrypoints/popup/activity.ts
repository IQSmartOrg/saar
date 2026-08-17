import type { Activity } from '@/shared/messaging/messages';
import { describeEta, describePhase, progressPercent } from '@/processing/types';

/**
 * Rendering the "Now" list.
 *
 * Kept apart from main.ts because this is the only part of the popup with real
 * logic in it, and it is worth being able to test the states without a browser.
 */

export function elapsed(since: number): string {
  const secs = Math.max(0, Math.round((Date.now() - since) / 1000));
  const m = Math.floor(secs / 60);
  return `${m}:${String(secs % 60).padStart(2, '0')}`;
}

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

function chip(kind: string, label: string, withDot = false): HTMLElement {
  const node = el('span', `chip ${kind}`);
  if (withDot) node.append(el('span', 'dot'));
  node.append(document.createTextNode(label));
  return node;
}

/** The animated level meter. Decorative, so it is hidden from screen readers. */
function bars(): HTMLElement {
  const wrap = el('div', 'bars');
  wrap.setAttribute('aria-hidden', 'true');
  const delays = [0, 0.12, 0.26, 0.06, 0.31, 0.17, 0.23, 0.09, 0.35, 0.14];
  for (const d of delays) {
    const bar = el('i');
    bar.style.animationDelay = `${d}s`;
    wrap.append(bar);
  }
  return wrap;
}

function track(percent: number): HTMLElement {
  const outer = el('div', 'track');
  outer.setAttribute('role', 'progressbar');
  outer.setAttribute('aria-valuenow', String(percent));
  outer.setAttribute('aria-valuemin', '0');
  outer.setAttribute('aria-valuemax', '100');
  const fill = el('span');
  fill.style.width = `${percent}%`;
  outer.append(fill);
  return outer;
}

export interface ActivityHandlers {
  readonly onStop: (sessionId: string) => void;
  readonly onRetry: (sessionId: string) => void;
  readonly onOpen: (sessionId: string) => void;
}

function card(a: Activity, on: ActivityHandlers): HTMLElement {
  const node = el('article', 'card');
  const top = el('div', 'card-top');
  node.append(top);

  switch (a.kind) {
    case 'recording': {
      top.append(chip('live', 'Recording', true), el('span', 'card-time', elapsed(a.startedAt)));
      node.append(
        el('div', 'card-title', a.title),
        el('div', 'card-meta', `${a.lines} ${a.lines === 1 ? 'line' : 'lines'} captured`),
        bars(),
      );
      const stop = el('button', 'btn stop', 'Stop notetaker');
      stop.type = 'button';
      stop.addEventListener('click', () => on.onStop(a.sessionId));
      node.append(stop);
      break;
    }

    case 'processing': {
      const eta = describeEta(a.progress.etaMs);
      top.append(chip('work', 'Writing minutes'));
      if (eta !== null) top.append(el('span', 'card-time', eta));
      node.append(
        el('div', 'card-title', a.title),
        el('div', 'card-meta', describePhase(a.progress)),
        track(progressPercent(a.progress)),
      );
      break;
    }

    case 'ready': {
      node.classList.add('done');
      top.append(chip('ready', '✓ Minutes ready'));
      const counts = [
        `${a.decisions} ${a.decisions === 1 ? 'decision' : 'decisions'}`,
        `${a.actionItems} ${a.actionItems === 1 ? 'action item' : 'action items'}`,
      ].join(' · ');
      node.append(el('div', 'card-title', a.title), el('div', 'card-meta', counts));
      const view = el('button', 'btn tiny', 'View minutes');
      view.type = 'button';
      view.addEventListener('click', () => on.onOpen(a.sessionId));
      node.append(view);
      break;
    }

    case 'failed': {
      node.classList.add('failed');
      top.append(chip('bad', 'Couldn’t write minutes'));
      node.append(
        el('div', 'card-title', a.title),
        el('div', 'card-meta err', a.error),
        // The transcript survives every summarisation failure by design; saying
        // so is the difference between a retry and a panic.
        el('p', 'note', 'The transcript is saved. Nothing was lost.'),
      );
      const pair = el('div', 'btn-pair');
      const retry = el('button', 'btn tiny', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => on.onRetry(a.sessionId));
      const open = el('button', 'btn tiny ghost', 'View transcript');
      open.type = 'button';
      open.addEventListener('click', () => on.onOpen(a.sessionId));
      pair.append(retry, open);
      node.append(pair);
      break;
    }
  }

  return node;
}

/**
 * Recording first, then anything still processing, then settled meetings.
 *
 * Stop is pressed under time pressure mid-meeting, so the live card must never
 * drift down the list as finished work accumulates behind it.
 */
const ORDER: Record<Activity['kind'], number> = {
  recording: 0,
  processing: 1,
  failed: 2,
  ready: 3,
};

export function renderActivity(
  root: HTMLElement,
  activities: readonly Activity[],
  on: ActivityHandlers,
): void {
  root.replaceChildren();

  if (activities.length === 0) {
    const empty = el('div', 'empty');
    empty.append(
      el('p', 'empty-t', 'Nothing in progress'),
      el('p', 'note', 'Saar joins automatically when you enter a Meet call.'),
    );
    root.append(empty);
    return;
  }

  const sorted = [...activities].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  const live = sorted.some((a) => a.kind === 'recording');

  for (const a of sorted) {
    const node = card(a, on);
    // Finished work recedes behind a live meeting rather than competing with it.
    if (live && a.kind !== 'recording') node.classList.add('quiet');
    root.append(node);
  }
}
