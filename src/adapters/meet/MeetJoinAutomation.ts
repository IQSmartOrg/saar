import { JOIN_CONTROL_SELECTORS, type JoinControlSelectors } from '@/adapters/meet/selectors';

const JOIN_LABELS = ['join now', 'ask to join', 'join'];

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
    const candidates = Array.from(this.doc.querySelectorAll<HTMLElement>(this.sel.joinButton));
    const btn = candidates.find((el) => {
      const label = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`
        .toLowerCase()
        .trim();
      return JOIN_LABELS.some((l) => label.includes(l));
    });
    if (!btn) return false;
    btn.click();
    return true;
  }

  isInLobby(): boolean {
    return this.doc.querySelector(this.sel.lobbyIndicator) !== null;
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
