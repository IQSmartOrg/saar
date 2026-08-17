// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderActivity, elapsed } from '@/entrypoints/popup/panels/activityCards';
import type { Activity } from '@/messaging/messages';

let root: HTMLElement;
const noop = { onStop: () => {}, onRetry: () => {}, onOpen: () => {}, onMom: () => {} };

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root')!;
});

const recording: Activity = {
  kind: 'recording', sessionId: 'a', title: 'Meet – RoadMap', startedAt: Date.now() - 5000, lines: 38,
};
const processing: Activity = {
  kind: 'processing', sessionId: 'b', title: 'Weekly sync',
  progress: { phase: 'mapping', done: 2, total: 8 },
  paused: false,
};
const paused: Activity = { ...processing, paused: true };
const ready: Activity = {
  kind: 'ready', sessionId: 'c', title: 'Retro', decisions: 6, actionItems: 4,
};
const failed: Activity = {
  kind: 'failed', sessionId: 'd', title: 'Standup', error: 'No response from localhost:11434',
};

describe('empty state', () => {
  it('says what will happen rather than looking broken', () => {
    renderActivity(root, [], noop);
    expect(root.textContent).toContain('Nothing in progress');
    expect(root.textContent).toContain('joins automatically');
  });
});

describe('ordering', () => {
  it('always puts the live meeting first', () => {
    // Stop is pressed under time pressure; the card must not drift down the
    // list as finished meetings accumulate.
    renderActivity(root, [ready, processing, failed, recording], noop);
    const first = root.querySelector('.card')!;
    expect(first.textContent).toContain('Meet – RoadMap');
    expect(first.querySelector('.chip.live')).not.toBeNull();
  });

  it('dims everything behind a live meeting', () => {
    renderActivity(root, [recording, processing], noop);
    const cards = [...root.querySelectorAll('.card')];
    expect(cards[0]!.classList.contains('quiet')).toBe(false);
    expect(cards[1]!.classList.contains('quiet')).toBe(true);
  });

  it('does not dim anything when nothing is live', () => {
    renderActivity(root, [processing, ready], noop);
    expect(root.querySelectorAll('.card.quiet')).toHaveLength(0);
  });
});

describe('card contents', () => {
  it('shows a level meter only while recording', () => {
    renderActivity(root, [recording], noop);
    expect(root.querySelector('.bars')).not.toBeNull();
    renderActivity(root, [processing], noop);
    expect(root.querySelector('.bars')).toBeNull();
  });

  it('names the real processing step, not a spinner', () => {
    renderActivity(root, [processing], noop);
    expect(root.textContent).toContain('Reading the transcript — part 3 of 7');
    expect(root.querySelector('.track')!.getAttribute('aria-valuenow')).toBe('25');
  });

  it('shows a percentage rather than a call fraction', () => {
    // "0 / 8" counted model calls while the line below counted transcript
    // parts — two denominators for one moment.
    renderActivity(root, [processing], noop);
    expect(root.querySelector('.card-time')?.textContent).toBe('25%');
    expect(root.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
  });

  it('keeps the estimate beside the phase, not in the headline slot', () => {
    renderActivity(root, [{ ...processing, progress: { ...processing.progress, etaMs: 125_000 } }], noop);
    expect(root.querySelector('.card-time')?.textContent).toBe('25%');
    expect(root.querySelector('.card-meta')?.textContent).toContain('about 2 min left');
  });

  it('offers Pause and Cancel while a run is under way', () => {
    renderActivity(root, [processing], noop);
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Pause');
    expect(labels).toContain('Cancel');
    expect(labels).not.toContain('Resume');
  });

  it('swaps Pause for Resume once paused, and keeps Cancel', () => {
    renderActivity(root, [paused], noop);
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Resume');
    expect(labels).toContain('Cancel');
    expect(labels).not.toContain('Pause');
  });

  it('sends the action the pressed button names', () => {
    const seen: Array<[string, string]> = [];
    renderActivity(root, [processing], {
      ...noop,
      onMom: (sessionId, action) => seen.push([sessionId, action]),
    });
    const find = (label: string): HTMLButtonElement =>
      [...root.querySelectorAll('button')].find((b) => b.textContent === label)!;
    find('Pause').click();
    find('Cancel').click();
    expect(seen).toEqual([
      ['b', 'pause'],
      ['b', 'cancel'],
    ]);
  });

  it('a paused run says where it stopped and shows no estimate', () => {
    // A countdown that never moves reads as stuck, so the ETA is dropped and
    // the line reports progress made rather than work happening.
    renderActivity(root, [{ ...paused, progress: { ...processing.progress, etaMs: 125_000 } }], noop);
    const meta = root.querySelector('.card-meta')?.textContent ?? '';
    expect(meta).toContain('Paused after part 2 of 7');
    expect(meta).not.toContain('min left');
    expect(root.querySelector('.chip')?.textContent).toBe('Paused');
  });

  it('keeps the percentage while paused, so no progress looks lost', () => {
    renderActivity(root, [paused], noop);
    expect(root.querySelector('.card-time')?.textContent).toBe('25%');
  });

  it('reassures that a failed summary did not lose the transcript', () => {
    renderActivity(root, [failed], noop);
    expect(root.textContent).toContain('No response from localhost:11434');
    expect(root.textContent).toContain('The transcript is saved');
  });

  it('pluralises counts', () => {
    renderActivity(root, [{ ...ready, decisions: 1, actionItems: 1 }], noop);
    expect(root.textContent).toContain('1 decision · 1 action item');
  });
});

describe('actions', () => {
  it('stop reports the recording session', () => {
    const onStop = vi.fn();
    renderActivity(root, [recording], { ...noop, onStop });
    root.querySelector<HTMLButtonElement>('.btn.stop')!.click();
    expect(onStop).toHaveBeenCalledWith('a');
  });

  it('retry reports the failed session', () => {
    const onRetry = vi.fn();
    renderActivity(root, [failed], { ...noop, onRetry });
    root.querySelector<HTMLButtonElement>('.btn.tiny')!.click();
    expect(onRetry).toHaveBeenCalledWith('d');
  });

  it('a processing card offers exactly the two controls, and no Open', () => {
    // Was "no actions at all". A run with no stop was the complaint: a long
    // local summary held the queue with nothing the user could do about it.
    renderActivity(root, [processing], noop);
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['Pause', 'Cancel']);
  });
});

describe('elapsed', () => {
  it('formats as m:ss', () => {
    expect(elapsed(Date.now() - 65_000)).toBe('1:05');
  });
});
