// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { isInCall, joinMeeting, MeetJoin } from '@/meet/join';

/** The old single-budget tests, expressed as the same budget on every stage. */
const budgetOf = (ms: number) => ({
  bootingMs: ms,
  prejoinMs: ms,
  waitingMs: ms,
  totalMs: ms,
});
import { iconNames, resolveControl, visibleLabel } from '@/meet/resolve';
import { MEET_CONTROLS } from '@/meet/controls';

beforeEach(() => {
  document.body.innerHTML = '';
});

/** Meet renders controls as <button> with a Material icon ligature inside. */
function control(opts: {
  jsname?: string;
  icon?: string;
  aria?: string;
  label?: string;
  id?: string;
}): string {
  const icon = opts.icon ? `<i class="google-symbols" aria-hidden="true">${opts.icon}</i>` : '';
  const label = opts.label ? `<span>${opts.label}</span>` : '';
  return `<button ${opts.id ? `id="${opts.id}"` : ''} role="button"
    ${opts.jsname ? `jsname="${opts.jsname}"` : ''}
    ${opts.aria ? `aria-label="${opts.aria}"` : ''}>${icon}${label}</button>`;
}

describe('visibleLabel / iconNames', () => {
  it('strips Material icon ligatures out of the label', () => {
    document.body.innerHTML = control({ icon: 'add_to_queue', label: 'Join here too' });
    const el = document.querySelector('button')!;
    expect(el.textContent).toContain('add_to_queue'); // raw text is polluted
    expect(visibleLabel(el)).toBe('join here too'); // stripped
  });

  it('reads icon ligature names', () => {
    document.body.innerHTML = control({ icon: 'mic', aria: 'Turn off microphone' });
    expect(iconNames(document.querySelector('button')!)).toContain('mic');
  });
});

describe('resolveControl strategy order', () => {
  it('prefers jsname over every weaker signal', () => {
    document.body.innerHTML =
      control({ id: 'byText', label: 'Join now' }) + control({ id: 'byJsname', jsname: 'hw0c9' });
    const hit = resolveControl(document, MEET_CONTROLS.mic);
    expect(hit?.matchedBy).toBe('jsname');
    expect(hit?.el.id).toBe('byJsname');
  });

  it('falls back to the icon ligature when jsname is gone', () => {
    document.body.innerHTML = control({ id: 'byIcon', icon: 'mic', aria: 'ब्लाह' });
    const hit = resolveControl(document, MEET_CONTROLS.mic);
    expect(hit?.matchedBy).toBe('icon');
    expect(hit?.el.id).toBe('byIcon');
  });

  it('falls back to aria when jsname and icon are both gone', () => {
    document.body.innerHTML = control({ id: 'byAria', aria: 'Turn off microphone' });
    expect(resolveControl(document, MEET_CONTROLS.mic)?.matchedBy).toBe('aria');
  });

  it('returns null rather than guessing when nothing matches', () => {
    document.body.innerHTML = control({ id: 'unrelated', label: 'Upgrade' });
    expect(resolveControl(document, MEET_CONTROLS.mic)).toBeNull();
  });

  it('never returns a wrapper that contains another control', () => {
    // Regression: an earlier version also searched [jsname], so a container div
    // whose textContent included "Join now" won over the button inside it and
    // the click silently did nothing.
    document.body.innerHTML = `
      <div jsname="a9kxte" role="button">
        Switch account Upgrade
        ${control({ id: 'realJoin', label: 'Join now' })}
      </div>`;
    const hit = resolveControl(document, MEET_CONTROLS.join);
    expect(hit?.el.id).toBe('realJoin');
    expect(hit?.el.tagName).toBe('BUTTON');
  });
});

describe('MeetJoin — mic and camera off', () => {
  it('mutes mic and camera when they are on', async () => {
    document.body.innerHTML =
      `<button role="button" jsname="hw0c9" aria-label="Turn off microphone" data-is-muted="false"></button>` +
      `<button role="button" jsname="psRWwc" aria-label="Turn off camera" data-is-muted="false"></button>`;
    const clicks: string[] = [];
    document.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => clicks.push(b.getAttribute('jsname')!));
    });

    await new MeetJoin(document).muteMicAndCamera();
    expect(clicks).toEqual(['hw0c9', 'psRWwc']);
  });

  it('does not re-click a control that is already off', async () => {
    // Re-clicking would switch the mic back ON and put the bot live.
    document.body.innerHTML = `<button role="button" jsname="hw0c9" aria-label="Turn on microphone" data-is-muted="true"></button>`;
    let clicks = 0;
    document.querySelector('button')!.addEventListener('click', () => clicks++);
    await new MeetJoin(document).muteMicAndCamera();
    expect(clicks).toBe(0);
  });

  it('reads the off-state from aria when data-is-muted is absent', async () => {
    document.body.innerHTML = control({ jsname: 'hw0c9', aria: 'Turn on microphone' });
    let clicks = 0;
    document.querySelector('button')!.addEventListener('click', () => clicks++);
    await new MeetJoin(document).muteMicAndCamera();
    expect(clicks).toBe(0);
  });
});

describe('MeetJoin — clicking join', () => {
  it('clicks the real Join button, not a wrapper', async () => {
    document.body.innerHTML = `
      <div jsname="a9kxte" role="button">
        noise Join now noise
        <button id="realJoin" role="button"><span>Join now</span></button>
      </div>`;
    // The click bubbles to the wrapper too; what matters is where it originated.
    let origin: string | null = null;
    document.addEventListener('click', (e) => {
      origin ??= (e.target as HTMLElement).id || 'wrapper';
    });

    expect((await new MeetJoin(document).clickJoin()).clicked).toBe(true);
    expect(origin).toBe('realJoin');
  });

  it('prefers "Join now" over "Other ways to join"', async () => {
    document.body.innerHTML =
      control({ id: 'other', label: 'Other ways to join' }) +
      control({ id: 'real', label: 'Join now' });
    const hits: string[] = [];
    document.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => hits.push(b.id));
    });
    await new MeetJoin(document).clickJoin();
    expect(hits).toEqual(['real']);
  });

  it('reports not-clicked, and clicks nothing, when no join button matches', async () => {
    document.body.innerHTML = control({ id: 'x', label: 'अभी शामिल हों' });
    let clicks = 0;
    document.querySelector('#x')!.addEventListener('click', () => clicks++);

    const result = await new MeetJoin(document).clickJoin();
    expect(result.clicked).toBe(false);
    expect(clicks).toBe(0); // never guess at which button is Join
  });

  it('pressEnter is the separate language fallback', () => {
    document.body.innerHTML = '';
    let enter = false;
    document.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') enter = true;
    });
    new MeetJoin(document).pressEnter();
    expect(enter).toBe(true);
  });

  it('flags that admission is needed when the button says "Ask to join"', async () => {
    document.body.innerHTML = control({ id: 'j', label: 'Ask to join' });
    const result = await new MeetJoin(document).clickJoin();
    expect(result.clicked).toBe(true);
    expect(result.needsAdmission).toBe(true);
  });

  it('does not flag admission for a plain "Join now"', async () => {
    document.body.innerHTML = control({ id: 'j', label: 'Join now' });
    expect((await new MeetJoin(document).clickJoin()).needsAdmission).toBe(false);
  });
});

describe('MeetJoin — lobby and in-call detection', () => {
  it('detects the lobby', () => {
    document.body.innerHTML = `<div aria-label="Asking to join"></div>`;
    expect(new MeetJoin(document).isInLobby()).toBe(true);
  });

  it('isInCall is false on a bare pre-join screen', () => {
    document.body.innerHTML = control({ label: 'Join now' });
    expect(new MeetJoin(document).isInCall()).toBe(false);
  });

  it('isInCall is true once the captions control exists', () => {
    document.body.innerHTML = control({ jsname: 'RrG0hf', aria: 'Turn on captions' });
    expect(new MeetJoin(document).isInCall()).toBe(true);
  });

  it('isInCall is true once the leave-call control exists', () => {
    document.body.innerHTML = control({ jsname: 'CQylAd', aria: 'Leave call' });
    expect(new MeetJoin(document).isInCall()).toBe(true);
  });

  it('isInCall is FALSE when only a participant tile exists', () => {
    // Regression: a self-preview tile with data-participant-id is present on
    // the pre-join screen and while awaiting admission. Treating it as proof of
    // being in the call made the agent burn all its caption retries ~25s before
    // the CC button existed.
    document.body.innerHTML = `<div data-participant-id="1"></div>`;
    expect(new MeetJoin(document).isInCall()).toBe(false);
  });

  it('isInCall stays false in the lobby even with in-call controls rendered', () => {
    document.body.innerHTML =
      `<div aria-label="Asking to join"></div>` + control({ jsname: 'CQylAd', aria: 'Leave call' });
    expect(new MeetJoin(document).isInCall()).toBe(false);
  });
});

describe('isInCall — the gate on the user own tab', () => {
  // The user's tab must not trigger the bot until the user has actually
  // entered. The URL is /xxx-yyyy-zzz on the pre-join screen too, so the URL
  // alone cannot tell the two apart — this predicate is what does.

  it('is false on the pre-join screen, mic/camera/join controls and all', () => {
    document.body.innerHTML =
      control({ jsname: 'hw0c9', aria: 'Turn off microphone' }) +
      control({ jsname: 'psRWwc', aria: 'Turn off camera' }) +
      control({ id: 'join', label: 'Join now' }) +
      `<div data-participant-id="self-preview"></div>`;
    expect(isInCall(document)).toBe(false);
  });

  it('is false while waiting to be admitted', () => {
    document.body.innerHTML =
      `<div aria-label="Asking to join"></div>` + `<div data-participant-id="1"></div>`;
    expect(isInCall(document)).toBe(false);
  });

  it('flips to true once the in-call control bar mounts', () => {
    document.body.innerHTML = control({ id: 'join', label: 'Join now' });
    expect(isInCall(document)).toBe(false);

    // What Meet renders after the user is actually in.
    document.body.innerHTML =
      control({ jsname: 'CQylAd', aria: 'Leave call' }) +
      control({ jsname: 'RrG0hf', aria: 'Turn on captions' });
    expect(isInCall(document)).toBe(true);
  });

  it('does not mutate the page it inspects', () => {
    // It runs on the user's own tab; it must never click anything there.
    document.body.innerHTML =
      control({ id: 'join', label: 'Join now' }) +
      control({ jsname: 'hw0c9', aria: 'Turn off microphone' });
    let clicks = 0;
    document.addEventListener('click', () => clicks++);
    const before = document.body.innerHTML;

    isInCall(document);

    expect(clicks).toBe(0);
    expect(document.body.innerHTML).toBe(before);
  });
});

describe('MeetJoin — drift reporting', () => {
  it('report() surfaces which strategy matched, so drift is visible early', async () => {
    document.body.innerHTML = control({ id: 'm', aria: 'Turn off microphone' });
    const j = new MeetJoin(document);
    await j.muteMicAndCamera();
    const byName = Object.fromEntries(j.report().map((r) => [r.control, r.matchedBy]));
    expect(byName['mic']).toBe('aria'); // degraded from jsname — early warning
    expect(byName['camera']).toBe('none');
  });
});

describe('joinMeeting driver', () => {
  /** Deterministic clock: every sleep advances virtual time, nothing is real. */
  function fakeTime() {
    let t = 0;
    return {
      now: () => t,
      sleep: (ms: number) => {
        t += ms;
        return Promise.resolve();
      },
    };
  }

  it('returns ok immediately when already in the call', async () => {
    document.body.innerHTML = control({ jsname: 'CQylAd', aria: 'Leave call' });
    const out = await joinMeeting(document, fakeTime());
    expect(out.ok).toBe(true);
    expect(out.wasInLobby).toBe(false);
  });

  it('mutes, clicks join, then succeeds once in-call controls appear', async () => {
    document.body.innerHTML =
      `<button role="button" jsname="hw0c9" aria-label="Turn off microphone" data-is-muted="false"></button>` +
      `<button role="button" jsname="psRWwc" aria-label="Turn off camera" data-is-muted="false"></button>` +
      control({ id: 'join', label: 'Join now' });

    const muted: string[] = [];
    document.querySelectorAll('[jsname]').forEach((b) => {
      b.addEventListener('click', () => {
        muted.push(b.getAttribute('jsname')!);
        b.setAttribute('data-is-muted', 'true'); // reflects on the next pass
      });
    });
    // Joining swaps the pre-join screen for the in-call one.
    document.querySelector('#join')!.addEventListener('click', () => {
      document.body.innerHTML = control({ jsname: 'CQylAd', aria: 'Leave call' });
    });

    const out = await joinMeeting(document, fakeTime());
    expect(out.ok).toBe(true);
    expect(muted).toEqual(['hw0c9', 'psRWwc']); // mic and camera off BEFORE joining
  });

  it('does NOT click join while the mic control has not rendered yet', async () => {
    // The live bug: on the first pass the control bar is not mounted, so
    // muteMicAndCamera() silently does nothing — and the old loop clicked Join
    // anyway, putting the bot in the meeting with a hot microphone.
    document.body.innerHTML = control({ id: 'join', label: 'Join now' });
    let joinClicks = 0;
    document.querySelector('#join')!.addEventListener('click', () => joinClicks++);

    const out = await joinMeeting(document, { ...fakeTime(), budgets: budgetOf(10_000), pollMs: 1000 });

    expect(joinClicks).toBe(0);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/could not confirm microphone and camera were off/);
  });

  it('does NOT click join when only the mic is off and the camera is missing', async () => {
    document.body.innerHTML =
      `<button role="button" jsname="hw0c9" aria-label="Turn on microphone" data-is-muted="true"></button>` +
      control({ id: 'join', label: 'Join now' });
    let joinClicks = 0;
    document.querySelector('#join')!.addEventListener('click', () => joinClicks++);

    await joinMeeting(document, { ...fakeTime(), budgets: budgetOf(10_000), pollMs: 1000 });
    expect(joinClicks).toBe(0);
  });

  it('joins on a later pass, once the controls render and read as off', async () => {
    document.body.innerHTML = control({ id: 'join', label: 'Join now' });
    const order: string[] = [];

    const t = fakeTime();
    const out = await joinMeeting(document, {
      now: t.now,
      budgets: budgetOf(20_000),
      pollMs: 1000,
      sleep: (ms) => {
        void t.sleep(ms);
        if (t.now() === 1000) {
          // Control bar mounts, already muted.
          document.body.innerHTML =
            `<button role="button" jsname="hw0c9" aria-label="Turn on microphone" data-is-muted="true"></button>` +
            `<button role="button" jsname="psRWwc" aria-label="Turn on camera" data-is-muted="true"></button>` +
            control({ id: 'join', label: 'Join now' });
          document.querySelector('#join')!.addEventListener('click', () => {
            order.push('join');
            document.body.innerHTML = control({ jsname: 'CQylAd', aria: 'Leave call' });
          });
        }
        return Promise.resolve();
      },
    });

    expect(out.ok).toBe(true);
    expect(order).toEqual(['join']); // clicked exactly once, and only when safe
  });

  it('waits a pass for the click to take effect before joining', async () => {
    // Meet re-renders asynchronously, so a control clicked this pass still
    // reads "on". We must not treat "I clicked it" as "it is off".
    document.body.innerHTML =
      `<button id="mic" role="button" jsname="hw0c9" aria-label="Turn off microphone" data-is-muted="false"></button>` +
      `<button id="cam" role="button" jsname="psRWwc" aria-label="Turn off camera" data-is-muted="false"></button>` +
      control({ id: 'join', label: 'Join now' });

    const seq: string[] = [];
    for (const id of ['mic', 'cam']) {
      document.querySelector('#' + id)!.addEventListener('click', function (this: HTMLElement) {
        seq.push(id);
        this.setAttribute('data-is-muted', 'true'); // takes effect for the NEXT pass
      });
    }
    document.querySelector('#join')!.addEventListener('click', () => {
      seq.push('join');
      document.body.innerHTML = control({ jsname: 'CQylAd', aria: 'Leave call' });
    });

    const out = await joinMeeting(document, { ...fakeTime(), budgets: budgetOf(20_000), pollMs: 1000 });

    expect(out.ok).toBe(true);
    expect(seq).toEqual(['mic', 'cam', 'join']); // both off strictly before join
  });

  it('reports the lobby once, not on every poll', async () => {
    document.body.innerHTML = `<div aria-label="Asking to join"></div>`;
    let lobbyCalls = 0;
    const out = await joinMeeting(document, {
      ...fakeTime(),
      budgets: budgetOf(10_000),
      pollMs: 1000,
      onLobby: () => lobbyCalls++,
    });
    expect(out.ok).toBe(false);
    expect(out.wasInLobby).toBe(true);
    expect(lobbyCalls).toBe(1);
    expect(out.error).toMatch(/did not admit/);
  });

  it('never clicks join while sitting in the lobby', async () => {
    document.body.innerHTML =
      `<div aria-label="Asking to join"></div>` + control({ id: 'join', label: 'Join now' });
    let joinClicks = 0;
    document.querySelector('#join')!.addEventListener('click', () => joinClicks++);
    await joinMeeting(document, { ...fakeTime(), budgets: budgetOf(10_000), pollMs: 1000 });
    expect(joinClicks).toBe(0);
  });

  it('names the stage that stalled: no join button is a pre-join failure', async () => {
    // Mic and camera confirmed off, so the safety gate is satisfied — there is
    // simply no join button to click, ever. That is a different failure from
    // being queued and never admitted, and it now says so.
    document.body.innerHTML =
      `<button role="button" jsname="hw0c9" aria-label="Turn on microphone" data-is-muted="true"></button>` +
      `<button role="button" jsname="psRWwc" aria-label="Turn on camera" data-is-muted="true"></button>` +
      control({ id: 'x', label: 'Upgrade' });
    const out = await joinMeeting(document, { ...fakeTime(), budgets: budgetOf(5000), pollMs: 1000 });
    expect(out.ok).toBe(false);
    expect(out.wasInLobby).toBe(false);
    expect(out.error).toMatch(/pre-join screen never appeared/);
    expect(out.error).not.toMatch(/admit/);
  });

  it('succeeds if admission lands during the final sleep', async () => {
    // The loop condition can expire on the same tick admission happens; the
    // post-loop check is what stops that being reported as a failure.
    document.body.innerHTML = control({ id: 'join', label: 'Join now' });
    const t = fakeTime();
    const out = await joinMeeting(document, {
      now: t.now,
      budgets: budgetOf(3000),
      pollMs: 1000,
      sleep: (ms) => {
        void t.sleep(ms);
        if (t.now() >= 3000) {
          document.body.innerHTML = control({ jsname: 'CQylAd', aria: 'Leave call' });
        }
        return Promise.resolve();
      },
    });
    expect(out.ok).toBe(true);
  });
});

/**
 * "Ask to join" meetings.
 *
 * The reported bug: joining worked where the button said "Join now" and failed
 * where it said "Ask to join". The difference is that the second one puts you
 * in a queue, and the old loop kept clicking throughout it — every click
 * withdrew and re-issued the knock, so the host's prompt kept disappearing.
 */
describe('joinMeeting — meetings that require admission', () => {
  function fakeTime() {
    let t = 0;
    return { now: () => t, sleep: (ms: number) => { t += ms; return Promise.resolve(); } };
  }

  /** A pre-join screen with the mic and camera already off. */
  const OFF_CONTROLS =
    `<button role="button" jsname="hw0c9" aria-label="Turn on microphone" data-is-muted="true"></button>` +
    `<button role="button" jsname="psRWwc" aria-label="Turn on camera" data-is-muted="true"></button>`;

  it('clicks "Ask to join" exactly once while waiting to be admitted', async () => {
    document.body.innerHTML = OFF_CONTROLS + control({ id: 'ask', label: 'Ask to join' });
    let clicks = 0;
    document.querySelector('#ask')!.addEventListener('click', () => {
      clicks++;
      // Meet swaps the button for its waiting screen — whose markup we do not
      // match, which is exactly the condition that used to cause re-clicking.
      document.body.innerHTML = OFF_CONTROLS + '<div>Waiting for someone to let you in</div>';
    });

    const out = await joinMeeting(document, { ...fakeTime(), budgets: budgetOf(60_000), pollMs: 1000 });

    expect(clicks).toBe(1);
    expect(out.ok).toBe(false); // never admitted, in this test
    expect(out.needsAdmission).toBe(true);
  });

  it('reports the lobby immediately, on the button label alone', async () => {
    document.body.innerHTML = OFF_CONTROLS + control({ id: 'ask', label: 'Ask to join' });
    document.querySelector('#ask')!.addEventListener('click', () => {
      document.body.innerHTML = OFF_CONTROLS;
    });

    const seen: number[] = [];
    const clock = fakeTime();
    await joinMeeting(document, {
      ...clock,
      budgets: budgetOf(20_000),
      pollMs: 1000,
      onLobby: () => seen.push(clock.now()),
    });

    // Once, and on the pass that clicked — not after some later inference.
    expect(seen).toEqual([0]);
  });

  it('succeeds when the host admits us part-way through the wait', async () => {
    document.body.innerHTML = OFF_CONTROLS + control({ id: 'ask', label: 'Ask to join' });
    document.querySelector('#ask')!.addEventListener('click', () => {
      document.body.innerHTML = OFF_CONTROLS + '<div>Asking to be let in</div>';
      // The host lets us in a few polls later.
      setTimeout(() => {}, 0);
    });

    const clock = fakeTime();
    let admitted = false;
    const out = await joinMeeting(document, {
      ...clock,
      budgets: budgetOf(60_000),
      pollMs: 1000,
      sleep: (ms: number) => {
        clock.sleep(ms);
        if (!admitted && clock.now() >= 5000) {
          admitted = true;
          document.body.innerHTML = control({ jsname: 'CQylAd', aria: 'Leave call' });
        }
        return Promise.resolve();
      },
    });

    expect(out.ok).toBe(true);
    expect(out.wasInLobby).toBe(true);
  });

  it('retries a click that did not take, but slowly', async () => {
    // The button staying put means the click did not land. Worth retrying —
    // just not ninety times.
    document.body.innerHTML = OFF_CONTROLS + control({ id: 'ask', label: 'Ask to join' });
    let clicks = 0;
    document.querySelector('#ask')!.addEventListener('click', () => clicks++);

    await joinMeeting(document, { ...fakeTime(), budgets: budgetOf(60_000), pollMs: 1000 });

    // 60s at one retry per 10s, not 60 at one per poll.
    expect(clicks).toBeGreaterThan(1);
    expect(clicks).toBeLessThanOrEqual(7);
  });

  it('never presses Enter more than once when no button is recognised', async () => {
    document.body.innerHTML = OFF_CONTROLS + control({ id: 'x', label: 'अभी शामिल हों' });
    let enters = 0;
    document.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') enters++;
    });

    await joinMeeting(document, { ...fakeTime(), budgets: budgetOf(60_000), pollMs: 1000 });

    expect(enters).toBe(1);
  });
});

/**
 * Per-stage budgets, which is the point of the state machine.
 *
 * A meeting whose pre-join screen is slow must not lose the admission time it
 * was going to need — under one shared budget it silently did.
 */
describe('joinMeeting — stage budgets', () => {
  function fakeTime() {
    let t = 0;
    return { now: () => t, sleep: (ms: number) => { t += ms; return Promise.resolve(); } };
  }

  const OFF =
    `<button role="button" jsname="hw0c9" aria-label="Turn on microphone" data-is-muted="true"></button>` +
    `<button role="button" jsname="psRWwc" aria-label="Turn on camera" data-is-muted="true"></button>`;

  it('a slow pre-join screen does not eat the admission budget', async () => {
    // Nothing at all for 15s, then the button appears; we click and queue.
    document.body.innerHTML = '';
    const clock = fakeTime();

    const out = await joinMeeting(document, {
      now: clock.now,
      pollMs: 1000,
      budgets: { bootingMs: 20_000, prejoinMs: 20_000, waitingMs: 40_000, totalMs: 300_000 },
      sleep: (ms: number) => {
        clock.sleep(ms);
        if (clock.now() === 15_000) {
          document.body.innerHTML = OFF + control({ id: 'ask', label: 'Ask to join' });
          document.querySelector('#ask')!.addEventListener('click', () => {
            document.body.innerHTML = OFF; // queued; waiting screen we cannot match
          });
        }
        return Promise.resolve();
      },
    });

    expect(out.ok).toBe(false);
    expect(out.needsAdmission).toBe(true);
    // It failed on the WAITING budget, having spent 15s booting first. Under a
    // single 40s budget it would have died mid-queue instead.
    expect(out.error).toMatch(/did not admit/);
    expect(clock.now()).toBeGreaterThan(50_000);
  });

  it('gives up on a blank page in seconds, not minutes', async () => {
    document.body.innerHTML = '';
    const clock = fakeTime();

    const out = await joinMeeting(document, {
      now: clock.now,
      pollMs: 1000,
      sleep: (ms: number) => { clock.sleep(ms); return Promise.resolve(); },
      budgets: { bootingMs: 20_000, prejoinMs: 45_000, waitingMs: 300_000, totalMs: 360_000 },
    });

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/pre-join screen never appeared/);
    // The old design sat here for the full 180s learning nothing.
    expect(clock.now()).toBeLessThan(25_000);
  });

  it('records the stages it went through, for diagnosing a slow join', async () => {
    document.body.innerHTML = OFF + control({ id: 'ask', label: 'Ask to join' });
    document.querySelector('#ask')!.addEventListener('click', () => {
      document.body.innerHTML = OFF;
    });
    const clock = fakeTime();

    const out = await joinMeeting(document, {
      now: clock.now,
      pollMs: 1000,
      sleep: (ms: number) => { clock.sleep(ms); return Promise.resolve(); },
      budgets: { bootingMs: 5000, prejoinMs: 5000, waitingMs: 5000, totalMs: 60_000 },
    });

    expect(out.visited.map((v) => v.state)).toEqual(['prejoin', 'waiting']);
    expect(out.visited.every((v) => v.ms >= 0)).toBe(true);
  });
});

/**
 * The notetaker tab is opened with `active: false`, and Chrome deprioritizes
 * rendering in hidden tabs. Meet can take a minute or more to draw its pre-join
 * screen there. A budget calibrated on a visible tab made the bot give up
 * before Meet had drawn anything, so it only joined if a human clicked onto the
 * tab and prompted Chrome to prioritise it.
 */
describe('joinMeeting — a slow background tab', () => {
  const OFF =
    `<button role="button" jsname="hw0c9" aria-label="Turn on microphone" data-is-muted="true"></button>` +
    `<button role="button" jsname="psRWwc" aria-label="Turn on camera" data-is-muted="true"></button>`;

  /** Renders the pre-join screen only after `afterMs`, as a hidden tab does. */
  function slowRender(afterMs: number) {
    let t = 0;
    return {
      now: () => t,
      sleep: (ms: number) => {
        t += ms;
        if (t === afterMs) {
          document.body.innerHTML = OFF + control({ id: 'join', label: 'Join now' });
          document.querySelector('#join')!.addEventListener('click', () => {
            document.body.innerHTML = control({ jsname: 'CQylAd', aria: 'Leave call' });
          });
        }
        return Promise.resolve();
      },
    };
  }

  it('still joins when Meet takes a minute to render', async () => {
    document.body.innerHTML = '';
    const clock = slowRender(60_000);

    const out = await joinMeeting(document, { ...clock, pollMs: 2000 });

    expect(out.ok).toBe(true);
    expect(out.visited[0]!.state).toBe('booting');
    expect(out.visited[0]!.ms).toBeGreaterThanOrEqual(60_000);
  });

  it('the default booting budget covers a render far slower than a visible tab', async () => {
    // Guards the number itself: 20s was calibrated on a foreground tab and is
    // the regression this test exists to prevent coming back.
    document.body.innerHTML = '';
    const clock = slowRender(90_000);

    const out = await joinMeeting(document, { ...clock, pollMs: 2000 });

    expect(out.ok).toBe(true);
  });

  it('still gives up eventually on a page that never renders', async () => {
    document.body.innerHTML = '';
    let t = 0;
    const out = await joinMeeting(document, {
      now: () => t,
      sleep: (ms: number) => { t += ms; return Promise.resolve(); },
      pollMs: 2000,
    });

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/pre-join screen never appeared/);
    expect(t).toBeLessThan(150_000);
  });
});

/**
 * Disabled controls.
 *
 * Meet renders the mic and camera buttons disabled while it is still acquiring
 * devices — long enough to matter in the hidden tab the notetaker runs in. The
 * safety gate resolved them through the click filter, which discards disabled
 * controls, so it could not confirm a mute it was looking straight at and the
 * bot silently declined to join until someone focused the tab.
 */
describe('MeetJoin — controls that are present but not pressable', () => {
  const disabledOff =
    `<button role="button" jsname="hw0c9" aria-label="Turn on microphone" data-is-muted="true" aria-disabled="true"></button>` +
    `<button role="button" jsname="psRWwc" aria-label="Turn on camera" data-is-muted="true" aria-disabled="true"></button>`;

  it('confirms a mute that is reported by a disabled control', () => {
    document.body.innerHTML = disabledOff;
    expect(new MeetJoin(document).micAndCameraConfirmedOff()).toBe(true);
  });

  it('reads the state even though the control cannot be clicked', () => {
    document.body.innerHTML = disabledOff;
    expect(new MeetJoin(document).muteState()).toEqual({ mic: true, camera: true });
  });

  it('does not report a mute that is not there', () => {
    document.body.innerHTML = disabledOff.replace(/data-is-muted="true"/g, 'data-is-muted="false"');
    expect(new MeetJoin(document).micAndCameraConfirmedOff()).toBe(false);
  });

  it('never clicks a disabled control, since the click would do nothing', async () => {
    document.body.innerHTML = disabledOff.replace(/data-is-muted="true"/g, 'data-is-muted="false"');
    let clicks = 0;
    document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => clicks++));
    await new MeetJoin(document).muteMicAndCamera();
    expect(clicks).toBe(0);
  });

  it('still clicks an enabled control that reads as on', async () => {
    document.body.innerHTML =
      `<button role="button" jsname="hw0c9" aria-label="Turn off microphone" data-is-muted="false"></button>`;
    let clicks = 0;
    document.querySelector('button')!.addEventListener('click', () => clicks++);
    await new MeetJoin(document).muteMicAndCamera();
    expect(clicks).toBe(1);
  });

  it('joins a meeting whose mute controls are disabled but already off', async () => {
    // End to end: this is the case that stopped the bot joining on its own.
    document.body.innerHTML = disabledOff + control({ id: 'join', label: 'Join now' });
    document.querySelector('#join')!.addEventListener('click', () => {
      document.body.innerHTML = control({ jsname: 'CQylAd', aria: 'Leave call' });
    });
    let t = 0;
    const out = await joinMeeting(document, {
      now: () => t,
      sleep: (ms: number) => { t += ms; return Promise.resolve(); },
      pollMs: 2000,
    });
    expect(out.ok).toBe(true);
  });
});
