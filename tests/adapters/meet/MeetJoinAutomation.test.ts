// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { MeetJoinAutomation } from '@/adapters/meet/MeetJoinAutomation';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('MeetJoinAutomation', () => {
  it('clicks mic and camera toggles only when they are currently on', async () => {
    document.body.innerHTML = `
      <div role="button" aria-label="Turn off microphone" data-is-muted="false"></div>
      <div role="button" aria-label="Turn off camera" data-is-muted="false"></div>`;
    const mic = document.querySelector('[aria-label*="microphone" i]')!;
    const cam = document.querySelector('[aria-label*="camera" i]')!;
    let micClicks = 0;
    let camClicks = 0;
    mic.addEventListener('click', () => micClicks++);
    cam.addEventListener('click', () => camClicks++);

    await new MeetJoinAutomation(document).muteMicAndCamera();
    expect(micClicks).toBe(1);
    expect(camClicks).toBe(1);
  });

  it('does not re-click a mic that is already muted', async () => {
    document.body.innerHTML = `<div role="button" aria-label="Turn on microphone" data-is-muted="true"></div>`;
    const mic = document.querySelector('[aria-label*="microphone" i]')!;
    let clicks = 0;
    mic.addEventListener('click', () => clicks++);
    await new MeetJoinAutomation(document).muteMicAndCamera();
    expect(clicks).toBe(0);
  });

  it('falls back to the aria-label when data-is-muted is absent', async () => {
    document.body.innerHTML = `<div role="button" aria-label="Turn on microphone"></div>`;
    const mic = document.querySelector('[aria-label*="microphone" i]')!;
    let clicks = 0;
    mic.addEventListener('click', () => clicks++);
    await new MeetJoinAutomation(document).muteMicAndCamera();
    expect(clicks).toBe(0);
  });

  it('tolerates missing mic and camera controls', async () => {
    await expect(new MeetJoinAutomation(document).muteMicAndCamera()).resolves.toBeUndefined();
  });

  it('clickJoin returns false when no join button is present', async () => {
    expect(await new MeetJoinAutomation(document).clickJoin()).toBe(false);
  });

  it('clickJoin finds the button by its visible label', async () => {
    document.body.innerHTML = `<button jsname="x">Join now</button>`;
    let clicked = false;
    document.querySelector('button')!.addEventListener('click', () => {
      clicked = true;
    });
    expect(await new MeetJoinAutomation(document).clickJoin()).toBe(true);
    expect(clicked).toBe(true);
  });

  it('clickJoin also matches "Ask to join"', async () => {
    document.body.innerHTML = `<button jsname="x">Ask to join</button>`;
    expect(await new MeetJoinAutomation(document).clickJoin()).toBe(true);
  });

  it('clickJoin finds a plain button with no jsname or role', async () => {
    document.body.innerHTML = `<button>Join now</button>`;
    let clicked = false;
    document.querySelector('button')!.addEventListener('click', () => {
      clicked = true;
    });
    expect(await new MeetJoinAutomation(document).clickJoin()).toBe(true);
    expect(clicked).toBe(true);
  });

  it('clickJoin reads text out of nested spans', async () => {
    document.body.innerHTML = `<div role="button"><span><span>Join now</span></span></div>`;
    let clicked = false;
    document.querySelector('[role="button"]')!.addEventListener('click', () => {
      clicked = true;
    });
    expect(await new MeetJoinAutomation(document).clickJoin()).toBe(true);
    expect(clicked).toBe(true);
  });

  it('clickJoin prefers "Join now" over a generic "Join with a code"', async () => {
    document.body.innerHTML = `
      <button id="generic">Join with a code</button>
      <button id="real">Join now</button>`;
    const hits: string[] = [];
    document.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => hits.push(b.id));
    });
    await new MeetJoinAutomation(document).clickJoin();
    expect(hits).toEqual(['real']);
  });

  it('clickJoin skips disabled buttons', async () => {
    document.body.innerHTML = `<button disabled>Join now</button>`;
    expect(await new MeetJoinAutomation(document).clickJoin()).toBe(false);
  });

  it('clickJoin skips aria-disabled buttons', async () => {
    document.body.innerHTML = `<div role="button" aria-disabled="true">Join now</div>`;
    expect(await new MeetJoinAutomation(document).clickJoin()).toBe(false);
  });

  it('isInCall is false on a bare pre-join screen', () => {
    document.body.innerHTML = `<button>Join now</button>`;
    expect(new MeetJoinAutomation(document).isInCall()).toBe(false);
  });

  it('isInCall is true once the captions control exists', () => {
    document.body.innerHTML = `<div role="button" aria-label="Turn on captions"></div>`;
    expect(new MeetJoinAutomation(document).isInCall()).toBe(true);
  });

  it('isInCall is true once participant tiles exist', () => {
    document.body.innerHTML = `<div data-participant-id="1"></div>`;
    expect(new MeetJoinAutomation(document).isInCall()).toBe(true);
  });

  it('isInCall stays false while in the lobby, even if tiles are rendered', () => {
    document.body.innerHTML = `
      <div aria-label="Asking to join"></div>
      <div data-participant-id="1"></div>`;
    expect(new MeetJoinAutomation(document).isInCall()).toBe(false);
  });

  it('detects the lobby state', () => {
    document.body.innerHTML = `<div aria-label="Asking to join"></div>`;
    expect(new MeetJoinAutomation(document).isInLobby()).toBe(true);
  });

  it('reports no lobby when the indicator is absent', () => {
    expect(new MeetJoinAutomation(document).isInLobby()).toBe(false);
  });

  it('enableCaptions clicks the toggle and reports success', async () => {
    document.body.innerHTML = `<div role="button" aria-label="Turn on captions"></div>`;
    let clicked = false;
    document.querySelector('[role="button"]')!.addEventListener('click', () => {
      clicked = true;
    });
    expect(await new MeetJoinAutomation(document).enableCaptions()).toBe(true);
    expect(clicked).toBe(true);
  });

  it('enableCaptions does not toggle captions back off when already on', async () => {
    document.body.innerHTML = `<div role="button" aria-label="Turn off captions"></div>`;
    let clicked = false;
    document.querySelector('[role="button"]')!.addEventListener('click', () => {
      clicked = true;
    });
    expect(await new MeetJoinAutomation(document).enableCaptions()).toBe(true);
    expect(clicked).toBe(false);
  });

  it('enableCaptions reports failure when the control is missing', async () => {
    expect(await new MeetJoinAutomation(document).enableCaptions()).toBe(false);
  });

  it('counts participant tiles', () => {
    document.body.innerHTML = `<div data-participant-id="1"></div><div data-participant-id="2"></div>`;
    expect(new MeetJoinAutomation(document).participantCount()).toBe(2);
  });
});
