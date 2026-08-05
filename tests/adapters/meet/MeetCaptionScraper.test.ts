// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { MeetCaptionScraper } from '@/adapters/meet/MeetCaptionScraper';
import { MEET_SELECTORS } from '@/adapters/meet/selectors';
import type { Clock } from '@/core/ports/Clock';
import type { TranscriptSegment } from '@/core/types/transcript';

/**
 * Synthetic caption DOM matching the shape MEET_SELECTORS expects. Task 0
 * replaces these with HTML captured from a live meeting; the scraper logic
 * exercised here is identical either way.
 */
function captionDom(blocks: Array<{ speaker: string; text: string }>): string {
  const items = blocks
    .map(
      (b) => `
    <div class="nMcdL bj4p3b">
      <img src="https://lh3.googleusercontent.com/a/x" />
      <span class="NWpY1d">${b.speaker}</span>
      <div class="ygicle VbkSUe">${b.text}</div>
    </div>`,
    )
    .join('');
  return `<div role="region" aria-label="Captions">${items}</div>`;
}

function collectingSink() {
  const seen: TranscriptSegment[] = [];
  return { sink: { upsert: (s: TranscriptSegment) => seen.push(s) }, seen };
}

let t = 0;
const clock: Clock = { now: () => t };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  t = 0;
  document.body.innerHTML = '';
});

describe('MeetCaptionScraper', () => {
  it('reports selectorsMatched=false when the caption region is absent', () => {
    document.body.innerHTML = '<div>no captions here</div>';
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    expect(s.health().selectorsMatched).toBe(false);
    expect(s.health().ok).toBe(false);
  });

  it('emits one segment per caption block with speaker and text', async () => {
    document.body.innerHTML = captionDom([
      { speaker: 'Priya Nair', text: 'Shall we start?' },
      { speaker: 'Rahul Shah', text: 'Yes.' },
    ]);
    const { sink, seen } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    await s.start(sink);

    expect(seen).toHaveLength(2);
    expect(seen[0]!.speaker).toBe('Priya Nair');
    expect(seen[0]!.text).toBe('Shall we start?');
    expect(seen[0]!.source).toBe('meet-captions');
    expect(seen[0]!.final).toBe(false);
    await s.stop();
  });

  it('skips blocks with empty text', async () => {
    document.body.innerHTML = captionDom([{ speaker: 'Priya Nair', text: '' }]);
    const { sink, seen } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    await s.start(sink);
    expect(seen).toHaveLength(0);
    await s.stop();
  });

  it('re-upserts the same id when Meet rewrites a block in place', async () => {
    document.body.innerHTML = captionDom([{ speaker: 'Priya Nair', text: 'I think' }]);
    const { sink, seen } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    await s.start(sink);

    const firstId = seen[0]!.id;
    document.querySelector('.ygicle')!.textContent = 'I think we should ship';
    await tick();

    const revised = seen.filter((x) => x.id === firstId);
    expect(revised.length).toBeGreaterThan(1);
    expect(revised.at(-1)!.text).toBe('I think we should ship');
    expect(revised.at(-1)!.final).toBe(false);
    await s.stop();
  });

  it('does not re-emit when a mutation leaves the text unchanged', async () => {
    document.body.innerHTML = captionDom([{ speaker: 'Priya Nair', text: 'stable' }]);
    const { sink, seen } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    await s.start(sink);
    const before = seen.length;

    document.querySelector('[role="region"]')!.setAttribute('data-noise', '1');
    await tick();

    expect(seen).toHaveLength(before);
    await s.stop();
  });

  it('marks a block final once it leaves the rolling window', async () => {
    document.body.innerHTML = captionDom([{ speaker: 'Priya Nair', text: 'first turn' }]);
    const { sink, seen } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    await s.start(sink);
    const firstId = seen[0]!.id;

    const region = document.querySelector('[role="region"]')!;
    region.innerHTML = `
      <div class="nMcdL bj4p3b">
        <span class="NWpY1d">Rahul Shah</span>
        <div class="ygicle VbkSUe">second turn</div>
      </div>`;
    await tick();

    expect(seen.filter((x) => x.id === firstId).at(-1)!.final).toBe(true);
    await s.stop();
  });

  it('finalises every open block on stop', async () => {
    document.body.innerHTML = captionDom([
      { speaker: 'Priya Nair', text: 'one' },
      { speaker: 'Rahul Shah', text: 'two' },
    ]);
    const { sink, seen } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    await s.start(sink);
    await s.stop();

    for (const id of new Set(seen.map((x) => x.id))) {
      expect(seen.filter((x) => x.id === id).at(-1)!.final).toBe(true);
    }
  });

  it('records tStart from first sighting and tEnd at finalisation', async () => {
    document.body.innerHTML = captionDom([{ speaker: 'Priya Nair', text: 'timed' }]);
    const { sink, seen } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    t = 10_000;
    await s.start(sink);
    t = 25_000;
    await s.stop();

    const final = seen.at(-1)!;
    expect(final.tStart).toBe(0);
    expect(final.tEnd).toBe(15);
  });

  it('falls back to structure when Google rotates the class names', async () => {
    // Same shape, but .NWpY1d / .ygicle renamed — the selectors miss entirely.
    document.body.innerHTML = `
      <div role="region" aria-label="Captions">
        <div class="nMcdL bj4p3b">
          <img src="https://lh3.googleusercontent.com/a/x" />
          <span class="renamed-speaker">Priya Nair</span>
          <div class="renamed-text">still captured</div>
        </div>
      </div>`;
    const { sink, seen } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    await s.start(sink);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.speaker).toBe('Priya Nair');
    expect(seen[0]!.text).toBe('still captured');
    await s.stop();
  });

  it('matches the caption region by aria-live when the semantic role is absent', async () => {
    document.body.innerHTML = `
      <div aria-live="polite">
        <div class="nMcdL bj4p3b">
          <span class="NWpY1d">Rahul Shah</span>
          <div class="ygicle VbkSUe">legacy layout</div>
        </div>
      </div>`;
    const { sink, seen } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    await s.start(sink);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.text).toBe('legacy layout');
    await s.stop();
  });

  it('health reports ok once segments have been seen', async () => {
    document.body.innerHTML = captionDom([{ speaker: 'Priya Nair', text: 'hello' }]);
    const { sink } = collectingSink();
    const s = new MeetCaptionScraper(document, clock, MEET_SELECTORS);
    await s.start(sink);

    const h = s.health();
    expect(h.ok).toBe(true);
    expect(h.selectorsMatched).toBe(true);
    expect(h.segmentsSeen).toBeGreaterThan(0);
    await s.stop();
  });
});
