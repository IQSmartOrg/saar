// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { captionsAreOn, enableCaptions, startCaptions } from '@/meet/captions';

beforeEach(() => {
  document.body.innerHTML = '';
});

const CC_BUTTON = `<button role="button" jsname="RrG0hf" aria-label="Turn on captions"></button>`;
const CC_REGION = `<div role="region" aria-label="Captions"></div>`;

function clickCount(selector: string): () => number {
  let n = 0;
  document.querySelector(selector)!.addEventListener('click', () => n++);
  return () => n;
}

describe('captionsAreOn', () => {
  it('is true when the caption region exists', () => {
    document.body.innerHTML = CC_REGION;
    expect(captionsAreOn(document)).toBe(true);
  });

  it('is false for a bare aria-live announcement region', () => {
    // Meet keeps a general announcement region whether captions are on or off.
    // Matching it made captionsAreOn() always true, so the CC button was never
    // clicked and nothing was ever captured.
    document.body.innerHTML = '<div aria-live="polite"></div>';
    expect(captionsAreOn(document)).toBe(false);
  });

  it('is false on an empty page', () => {
    expect(captionsAreOn(document)).toBe(false);
  });
});

describe('enableCaptions', () => {
  it('clicks the toggle when the caption region is absent', () => {
    document.body.innerHTML = CC_BUTTON;
    const clicks = clickCount('button');
    const result = enableCaptions(document);
    expect(result.ok).toBe(true);
    expect(result.alreadyOn).toBe(false);
    expect(result.matchedBy).toBe('jsname');
    expect(clicks()).toBe(1);
  });

  it('leaves captions alone when the region already exists', () => {
    // Clicking an already-on toggle turns captions back OFF.
    document.body.innerHTML =
      CC_REGION + `<button role="button" jsname="RrG0hf" aria-label="बंद करें"></button>`;
    const clicks = clickCount('button');
    const result = enableCaptions(document);
    expect(result.ok).toBe(true);
    expect(result.alreadyOn).toBe(true);
    expect(clicks()).toBe(0);
  });

  it('clicks CC when only the announcement region is present', () => {
    // The exact live failure: reported success without ever clicking.
    document.body.innerHTML = '<div aria-live="polite"></div>' + CC_BUTTON;
    const clicks = clickCount('button');
    expect(enableCaptions(document).ok).toBe(true);
    expect(clicks()).toBe(1);
  });

  it('reports failure when the control is missing', () => {
    const result = enableCaptions(document);
    expect(result.ok).toBe(false);
    expect(result.matchedBy).toBe('none');
  });

  it('falls back to the icon ligature when jsname is gone', () => {
    document.body.innerHTML =
      `<button role="button" aria-label="ब्लाह"><i class="google-symbols" aria-hidden="true">closed_caption_off</i></button>`;
    expect(enableCaptions(document).matchedBy).toBe('icon');
  });
});

describe('startCaptions', () => {
  const noSleep = () => Promise.resolve();

  it('does NOT report success until the caption region actually mounts', async () => {
    // The live bug: Meet mounts the region asynchronously after the CC click.
    // Returning ok on the click alone let the scraper start against a page with
    // no region, attach no observer, and capture nothing all meeting while the
    // session reported "capturing".
    document.body.innerHTML = CC_BUTTON;
    let polls = 0;
    const out = await startCaptions(document, {
      settlePollMs: 10,
      sleep: () => {
        // Region appears only on the 4th poll after the click.
        if (++polls === 4) document.body.insertAdjacentHTML('beforeend', CC_REGION);
        return Promise.resolve();
      },
    });
    expect(out.ok).toBe(true);
    expect(captionsAreOn(document)).toBe(true); // proven, not assumed
  });

  it('fails when the control is clicked but no region ever appears', async () => {
    document.body.innerHTML = CC_BUTTON;
    const out = await startCaptions(document, {
      retries: 2,
      settleAttempts: 3,
      sleep: noSleep,
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/never appeared/);
  });

  it('returns immediately when captions are already on', async () => {
    document.body.innerHTML = CC_REGION + CC_BUTTON;
    const waits: number[] = [];
    const out = await startCaptions(document, {
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(1);
    expect(waits).toEqual([]); // nothing to wait for
  });

  it('retries until the control mounts', async () => {
    // The CC control is not in the DOM the instant the call opens.
    let ticks = 0;
    const out = await startCaptions(document, {
      settleAttempts: 1,
      sleep: () => {
        if (++ticks === 2) document.body.innerHTML = CC_BUTTON + CC_REGION;
        return Promise.resolve();
      },
    });
    expect(out.ok).toBe(true);
  });

  it('gives up after the configured number of retries', async () => {
    const out = await startCaptions(document, { retries: 3, sleep: noSleep });
    expect(out.ok).toBe(false);
    expect(out.attempts).toBe(3);
    expect(out.error).toBe('captions control not found');
  });

  it('backs off exponentially and does not sleep after the last attempt', async () => {
    const waits: number[] = [];
    await startCaptions(document, {
      retries: 4,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    // No CC control at all, so no settle polling — only the retry backoff.
    expect(waits).toEqual([1000, 2000, 4000]); // 4 attempts, 3 sleeps
  });
});
