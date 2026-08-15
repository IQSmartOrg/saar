// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { MeetJoinAutomation } from '@/adapters/meet/MeetJoinAutomation';
import { resolveControl, visibleLabel, iconNames } from '@/adapters/meet/resolve';
import { MEET_CONTROLS } from '@/adapters/meet/selectors';

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
    const hit = resolveControl(document, MEET_CONTROLS.mic);
    expect(hit?.matchedBy).toBe('aria');
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

describe('MeetJoinAutomation', () => {
  it('mutes mic and camera when they are on', async () => {
    document.body.innerHTML =
      `<button role="button" jsname="hw0c9" aria-label="Turn off microphone" data-is-muted="false"></button>` +
      `<button role="button" jsname="psRWwc" aria-label="Turn off camera" data-is-muted="false"></button>`;
    const clicks: string[] = [];
    document.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => clicks.push(b.getAttribute('jsname')!));
    });

    await new MeetJoinAutomation(document).muteMicAndCamera();
    expect(clicks).toEqual(['hw0c9', 'psRWwc']);
  });

  it('does not re-click a control that is already off', async () => {
    document.body.innerHTML = `<button role="button" jsname="hw0c9" aria-label="Turn on microphone" data-is-muted="true"></button>`;
    let clicks = 0;
    document.querySelector('button')!.addEventListener('click', () => clicks++);
    await new MeetJoinAutomation(document).muteMicAndCamera();
    expect(clicks).toBe(0);
  });

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

    expect(await new MeetJoinAutomation(document).clickJoin()).toBe(true);
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
    await new MeetJoinAutomation(document).clickJoin();
    expect(hits).toEqual(['real']);
  });

  it('reports false and falls back to Enter when no join button matches', async () => {
    document.body.innerHTML = control({ id: 'x', label: 'अभी शामिल हों' });
    let enter = false;
    document.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') enter = true;
    });
    expect(await new MeetJoinAutomation(document).clickJoin()).toBe(false);
    expect(enter).toBe(true);
  });

  it('detects the lobby', () => {
    document.body.innerHTML = `<div aria-label="Asking to join"></div>`;
    expect(new MeetJoinAutomation(document).isInLobby()).toBe(true);
  });

  it('isInCall is false on a bare pre-join screen', () => {
    document.body.innerHTML = control({ label: 'Join now' });
    expect(new MeetJoinAutomation(document).isInCall()).toBe(false);
  });

  it('isInCall is true once the captions control exists', () => {
    document.body.innerHTML = control({ jsname: 'RrG0hf', aria: 'Turn on captions' });
    expect(new MeetJoinAutomation(document).isInCall()).toBe(true);
  });

  it('isInCall is FALSE when only a participant tile exists', () => {
    // Regression: a self-preview tile with data-participant-id is present on
    // the pre-join screen and while awaiting admission. Treating it as proof of
    // being in the call made the agent burn all its caption retries ~25s before
    // the CC button existed.
    document.body.innerHTML = `<div data-participant-id="1"></div>`;
    expect(new MeetJoinAutomation(document).isInCall()).toBe(false);
  });

  it('isInCall is true once the leave-call control exists', () => {
    document.body.innerHTML = control({ jsname: 'CQylAd', aria: 'Leave call' });
    expect(new MeetJoinAutomation(document).isInCall()).toBe(true);
  });

  it('isInCall is false while awaiting admission, tile and all', () => {
    document.body.innerHTML =
      `<div data-participant-id="1"></div>` + control({ label: 'Cancel' });
    expect(new MeetJoinAutomation(document).isInCall()).toBe(false);
  });

  it('isInCall stays false in the lobby even with in-call controls rendered', () => {
    document.body.innerHTML =
      `<div aria-label="Asking to join"></div>` + control({ jsname: 'CQylAd', aria: 'Leave call' });
    expect(new MeetJoinAutomation(document).isInCall()).toBe(false);
  });

  it('enableCaptions clicks the toggle when the caption region is absent', async () => {
    document.body.innerHTML = control({ jsname: 'RrG0hf', aria: 'Turn on captions' });
    let clicked = false;
    document.querySelector('button')!.addEventListener('click', () => {
      clicked = true;
    });
    expect(await new MeetJoinAutomation(document).enableCaptions()).toBe(true);
    expect(clicked).toBe(true);
  });

  it('enableCaptions leaves captions alone when the region already exists', async () => {
    // Region present => captions on. Language-independent, unlike the label.
    document.body.innerHTML =
      `<div role="region" aria-label="Captions"></div>` +
      control({ jsname: 'RrG0hf', aria: 'बंद करें' });
    let clicked = false;
    document.querySelector('button')!.addEventListener('click', () => {
      clicked = true;
    });
    expect(await new MeetJoinAutomation(document).enableCaptions()).toBe(true);
    expect(clicked).toBe(false);
  });

  it('captionsAreOn is false for a bare aria-live announcement region', () => {
    document.body.innerHTML = '<div aria-live="polite"></div>';
    expect(new MeetJoinAutomation(document).captionsAreOn()).toBe(false);
  });

  it('clicks CC when only the announcement region is present', async () => {
    // The exact live failure: agent reported success without clicking.
    document.body.innerHTML =
      '<div aria-live="polite"></div>' + control({ jsname: 'RrG0hf', aria: 'Turn on captions' });
    let clicked = false;
    document.querySelector('button')!.addEventListener('click', () => { clicked = true; });
    expect(await new MeetJoinAutomation(document).enableCaptions()).toBe(true);
    expect(clicked).toBe(true);
  });

  it('enableCaptions reports failure when the control is missing', async () => {
    expect(await new MeetJoinAutomation(document).enableCaptions()).toBe(false);
  });

  it('counts participant tiles', () => {
    document.body.innerHTML = `<div data-participant-id="1"></div><div data-participant-id="2"></div>`;
    expect(new MeetJoinAutomation(document).participantCount()).toBe(2);
  });

  it('report() surfaces which strategy matched, so drift is visible early', async () => {
    document.body.innerHTML = control({ id: 'm', aria: 'Turn off microphone' });
    const j = new MeetJoinAutomation(document);
    await j.muteMicAndCamera();
    const byName = Object.fromEntries(j.report().map((r) => [r.control, r.matchedBy]));
    expect(byName['mic']).toBe('aria'); // degraded from jsname — early warning
    expect(byName['camera']).toBe('none');
  });
});
