import {
  MEET_CONTROLS,
  MEET_SELECTORS,
  MEET_STATE_SELECTORS,
  type MeetControls,
  type MeetSelectors,
  type StateSelectors,
} from '@/adapters/meet/selectors';
import { resolveControl, type MatchStrategy } from '@/adapters/meet/resolve';

export interface ControlReport {
  readonly control: string;
  readonly matchedBy: MatchStrategy | 'none';
}

/**
 * Drives Meet's pre-join and in-call controls via DOM interaction only.
 *
 * `element.click()` works on Meet's React handlers even though the synthetic
 * event is untrusted; synthetic KeyboardEvents do NOT, so keyboard shortcuts
 * are never used for controls. (The Enter fallback in clickJoin is dispatched
 * on the document and is best-effort for exactly that reason.)
 *
 * Every lookup goes through resolveControl, which tries jsname → icon → aria →
 * text and reports which layer matched. `report()` surfaces that so a drift
 * toward the weaker layers is visible before anything actually breaks.
 *
 * No `chrome.*` — this must run unchanged under Puppeteer.
 */
export class MeetJoinAutomation {
  private matches = new Map<string, MatchStrategy | 'none'>();

  constructor(
    private readonly doc: Document,
    private readonly controls: MeetControls = MEET_CONTROLS,
    private readonly state: StateSelectors = MEET_STATE_SELECTORS,
    private readonly selectors: MeetSelectors = MEET_SELECTORS,
  ) {}

  private find(name: keyof MeetControls): HTMLElement | null {
    const hit = resolveControl(this.doc, this.controls[name]);
    this.matches.set(name, hit?.matchedBy ?? 'none');
    return hit?.el ?? null;
  }

  /** Which strategy matched each control the last time it was looked up. */
  report(): readonly ControlReport[] {
    return [...this.matches].map(([control, matchedBy]) => ({ control, matchedBy }));
  }

  /** True when a toggle is already in the "off" state. */
  private isOff(el: Element): boolean {
    const muted = el.getAttribute('data-is-muted');
    if (muted !== null) return muted === 'true';
    // "Turn on X" means X is currently off. English-only, hence the attribute
    // check first.
    return /turn on/i.test(el.getAttribute('aria-label') ?? '');
  }

  async muteMicAndCamera(): Promise<void> {
    for (const name of ['mic', 'camera'] as const) {
      const el = this.find(name);
      if (el && !this.isOff(el)) el.click();
    }
  }

  async clickJoin(): Promise<boolean> {
    const btn = this.find('join');
    if (btn) {
      btn.click();
      return true;
    }

    // Nothing matched — the label is probably in a language we do not carry.
    // Meet activates the focused primary action on Enter, so this is the one
    // language-independent way in. Best-effort: untrusted key events are often
    // ignored, which is why it is a fallback and not the primary path.
    this.doc.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
    );
    return false;
  }

  isInLobby(): boolean {
    return this.doc.querySelector(this.state.lobbyIndicator) !== null;
  }

  /**
   * True once we are actually inside the call, rather than on the pre-join
   * screen or in the lobby. The captions control and participant tiles only
   * exist in-call, so either is sufficient evidence.
   *
   * This is what lets a human click "Join now" themselves when clickJoin()
   * cannot find the button — the agent waits until it observes that it is in
   * the meeting, however that happened.
   */
  isInCall(): boolean {
    if (this.isInLobby()) return false;
    // Deliberately NOT participantCount(): a self-preview tile carrying
    // data-participant-id exists on the pre-join screen and while waiting for
    // the host to admit us. Treating that as "in the call" made the agent race
    // ahead and burn every caption retry ~25s before the CC button appeared.
    // Only controls that exist exclusively in-call count as evidence.
    return this.find('captions') !== null || this.find('leave') !== null;
  }

  /**
   * The caption region only exists in the DOM while captions are on, which
   * makes it a definitive, language-independent readout — unlike the toggle's
   * "Turn on captions" label, which is localised.
   */
  captionsAreOn(): boolean {
    return this.doc.querySelector(this.selectors.captionRegion) !== null;
  }

  async enableCaptions(): Promise<boolean> {
    // Never click an already-on toggle: that turns captions back off and
    // silently kills capture.
    if (this.captionsAreOn()) return true;
    const el = this.find('captions');
    if (!el) return false;
    el.click();
    return true;
  }

  participantCount(): number {
    return this.doc.querySelectorAll(this.state.participantTile).length;
  }
}
