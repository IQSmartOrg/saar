import { JOIN_CONTROL_SELECTORS, type JoinControlSelectors } from '@/adapters/meet/selectors';

/** Most specific first — "join" alone would also match "Join with a code". */
const JOIN_LABELS = ['join now', 'ask to join', 'join anyway', 'join meeting', 'join'];

/**
 * Drives Meet's pre-join and in-call controls via DOM interaction only.
 *
 * `element.click()` works on Meet's React handlers even though the synthetic
 * event is untrusted; synthetic KeyboardEvents do NOT, so never reach for
 * Meet's keyboard shortcuts here.
 *
 * No `chrome.*` — this must run unchanged under Puppeteer for the cloud bot.
 */
export class MeetJoinAutomation {
  constructor(
    private readonly doc: Document,
    private readonly sel: JoinControlSelectors = JOIN_CONTROL_SELECTORS,
  ) {}

  /** True when the control is already in the "off" state. */
  private isOff(el: Element): boolean {
    const muted = el.getAttribute('data-is-muted');
    if (muted !== null) return muted === 'true';
    // "Turn on X" means X is currently off.
    return /turn on/i.test(el.getAttribute('aria-label') ?? '');
  }

  async muteMicAndCamera(): Promise<void> {
    for (const selector of [this.sel.micToggle, this.sel.cameraToggle]) {
      const el = this.doc.querySelector<HTMLElement>(selector);
      if (el && !this.isOff(el)) el.click();
    }
  }

  async clickJoin(): Promise<boolean> {
    const candidates = Array.from(
      this.doc.querySelectorAll<HTMLElement>(this.sel.joinButton),
    ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true');

    // Walk labels most-specific first so "Join now" wins over a generic "Join".
    for (const wanted of JOIN_LABELS) {
      const btn = candidates.find((el) => {
        const label = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim();
        return label.includes(wanted);
      });
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  isInLobby(): boolean {
    return this.doc.querySelector(this.sel.lobbyIndicator) !== null;
  }

  /**
   * True once we are actually inside the call, as opposed to sitting on the
   * pre-join screen or in the lobby. The captions control and participant tiles
   * only exist in-call, so either one is sufficient evidence.
   *
   * This is what lets a human click "Join now" themselves when clickJoin()
   * cannot find the button — the agent just waits until it observes that it is
   * in the meeting, however that happened.
   */
  isInCall(): boolean {
    if (this.isInLobby()) return false;
    return (
      this.doc.querySelector(this.sel.captionsToggle) !== null ||
      this.doc.querySelector(this.sel.participantTile) !== null
    );
  }

  async enableCaptions(): Promise<boolean> {
    const el = this.doc.querySelector<HTMLElement>(this.sel.captionsToggle);
    if (!el) return false;
    // Only click when captions are off — clicking an already-on toggle turns
    // them back off and silently kills capture.
    if (/turn on/i.test(el.getAttribute('aria-label') ?? '')) el.click();
    return true;
  }

  participantCount(): number {
    return this.doc.querySelectorAll(this.sel.participantTile).length;
  }
}
