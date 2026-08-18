// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { keepRendering } from '@/agents/keepRendering';

/**
 * The page-level half of making a hidden notetaker work.
 *
 * Two independent problems: Meet asks whether it is visible, and the browser
 * decides whether to schedule frames. Overriding the first does nothing for the
 * second, which is why both are handled and both are pinned here.
 */

/** Pretends the tab really is hidden, the way Chrome reports it. */
function setRealHidden(hidden: boolean): void {
  Object.defineProperty(Document.prototype, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(Document.prototype, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
}

let nativeRafCalls: number;

beforeEach(() => {
  nativeRafCalls = 0;
  // A stand-in for the browser's frame scheduler, so delegation is observable.
  window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
    nativeRafCalls += 1;
    return window.setTimeout(() => cb(0), 0);
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number): void => window.clearTimeout(id)) as never;
  setRealHidden(false);
});

describe('what Meet is told', () => {
  it('reports visible even when the tab is really hidden', () => {
    setRealHidden(true);
    keepRendering(window);
    expect(document.hidden).toBe(false);
    expect(document.visibilityState).toBe('visible');
  });

  it('swallows visibilitychange, which Meet uses to pause work', () => {
    keepRendering(window);
    const onChange = vi.fn();
    document.addEventListener('visibilitychange', onChange);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('answers hasFocus, which some code paths ask instead', () => {
    keepRendering(window);
    expect(document.hasFocus()).toBe(true);
  });
});

describe('frame scheduling', () => {
  it('leaves a genuinely visible tab on the native scheduler', () => {
    // A foreground tab keeps real vsync-aligned animation; only a hidden one
    // pays for the timer substitute.
    setRealHidden(false);
    keepRendering(window);
    window.requestAnimationFrame(() => {});
    expect(nativeRafCalls).toBe(1);
  });

  it('drives frames from a timer when the tab is really hidden', async () => {
    setRealHidden(true);
    keepRendering(window);

    const ran = await new Promise<boolean>((resolve) => {
      window.requestAnimationFrame(() => resolve(true));
      setTimeout(() => resolve(false), 200);
    });

    expect(ran).toBe(true);
    // The browser scheduler was never asked, because it would never answer.
    expect(nativeRafCalls).toBe(0);
  });

  it('passes a timestamp, as a real frame callback receives', async () => {
    setRealHidden(true);
    keepRendering(window);
    const t = await new Promise<number>((resolve) => {
      window.requestAnimationFrame((ts) => resolve(ts));
    });
    expect(typeof t).toBe('number');
  });

  it('cancelAnimationFrame stops a pending timer-backed frame', async () => {
    setRealHidden(true);
    keepRendering(window);

    const cb = vi.fn();
    const id = window.requestAnimationFrame(cb);
    window.cancelAnimationFrame(id);

    await new Promise((r) => setTimeout(r, 80));
    expect(cb).not.toHaveBeenCalled();
  });

  it('keeps working across many frames, as an hour-long meeting needs', async () => {
    setRealHidden(true);
    keepRendering(window);

    let frames = 0;
    await new Promise<void>((resolve) => {
      const loop = (): void => {
        frames += 1;
        if (frames >= 5) return resolve();
        window.requestAnimationFrame(loop);
      };
      window.requestAnimationFrame(loop);
    });

    expect(frames).toBe(5);
  });
});
