import type { Clock } from '@/utils/clock';
import type { SegmentSink, SourceHealth, TranscriptSource } from '@/capture/TranscriptSource';
import type { TranscriptSegment, TranscriptSourceKind } from '@/capture/types';
import { CAPTION_SELECTORS, type CaptionSelectors } from '@/meet/controls';

interface OpenBlock {
  readonly id: string;
  readonly tStart: number;
  speaker: string | null;
  text: string;
}

let seq = 0;

/**
 * Reads Google Meet's live caption DOM.
 *
 * Meet keeps a rolling window of a few speaker blocks and rewrites a block's
 * text in place as its ASR refines the utterance. We therefore key blocks by
 * DOM node identity (WeakMap), re-emit on every change with final=false, and
 * emit final=true only once a block leaves the window or capture stops.
 *
 * No `chrome.*` here by design — this class must run unchanged under Puppeteer
 * for the cloud bot. The lint rule in eslint.config.js enforces that.
 */
export class CaptionScraper implements TranscriptSource {
  readonly kind: TranscriptSourceKind = 'meet-captions';

  private observer: MutationObserver | null = null;
  private sink: SegmentSink | null = null;
  private readonly open = new WeakMap<Element, OpenBlock>();
  private live = new Map<string, { el: Element; block: OpenBlock }>();
  private startedAt = 0;
  private segmentsSeen = 0;
  private lastSegmentAt: number | null = null;
  private matched = false;

  constructor(
    private readonly doc: Document,
    private readonly clock: Clock,
    private readonly selectors: CaptionSelectors = CAPTION_SELECTORS,
  ) {
    this.matched = this.region() !== null;
  }

  /**
   * The captions region.
   *
   * Falls back to an [aria-live] ancestor of a real caption block only when the
   * semantic region is missing. The fallback deliberately requires a block to
   * exist: Meet keeps an empty [aria-live] announcement region on the page at
   * all times, and matching that unconditionally makes the scraper observe a
   * node that never receives captions.
   */
  private region(): Element | null {
    const strict = this.doc.querySelector(this.selectors.region);
    if (strict) return strict;

    const block = this.doc.querySelector(this.selectors.block);
    return block?.closest('[aria-live]') ?? null;
  }

  async start(sink: SegmentSink): Promise<void> {
    const region = this.region();
    this.matched = region !== null;
    if (!region) return;

    this.sink = sink;
    this.startedAt = this.clock.now();

    this.observer = new MutationObserver(() => this.scan());
    this.observer.observe(region, { childList: true, subtree: true, characterData: true });
    this.scan();
  }

  async stop(): Promise<void> {
    this.observer?.disconnect();
    this.observer = null;
    for (const { block } of this.live.values()) this.emit(block, true);
    this.live.clear();
    this.sink = null;
  }

  health(): SourceHealth {
    return {
      ok: this.matched && this.segmentsSeen > 0,
      selectorsMatched: this.matched,
      segmentsSeen: this.segmentsSeen,
      lastSegmentAt: this.lastSegmentAt,
      detail: this.matched ? undefined : 'caption region not found — check meet/controls.ts',
    };
  }

  private scan(): void {
    const region = this.region();
    if (!region) return;

    const present = new Map<string, { el: Element; block: OpenBlock }>();

    for (const el of Array.from(region.querySelectorAll(this.selectors.block))) {
      const speaker = this.readSpeaker(el);
      const text = this.readText(el);
      if (text === '') continue;

      let block = this.open.get(el);
      const isNew = block === undefined;
      if (block === undefined) {
        block = { id: `meet-${++seq}`, tStart: this.relNow(), speaker, text };
        this.open.set(el, block);
      }

      const changed = block.text !== text || block.speaker !== speaker;
      block.speaker = speaker;
      block.text = text;
      present.set(block.id, { el, block });

      if (isNew || changed) this.emit(block, false);
    }

    // Anything that was live but is no longer present has scrolled out of the
    // rolling window — that is our signal the utterance is finished.
    for (const [id, entry] of this.live) {
      if (!present.has(id)) this.emit(entry.block, true);
    }
    this.live = present;
  }

  /**
   * Meet's class names rotate. When the configured selector misses we fall back
   * to structure — the speaker is the first <span> in a caption block — so a
   * renamed class degrades attribution rather than losing the whole transcript.
   */
  private readSpeaker(block: Element): string | null {
    const bySelector = block.querySelector(this.selectors.speaker)?.textContent?.trim();
    if (bySelector) return bySelector;
    return block.querySelector('span')?.textContent?.trim() || null;
  }

  /** Fallback: the caption text is the last non-image child that carries text. */
  private readText(block: Element): string {
    const bySelector = block.querySelector(this.selectors.text)?.textContent?.trim();
    if (bySelector) return bySelector;

    const speaker = this.readSpeaker(block);
    const candidates = Array.from(block.querySelectorAll('div, span')).filter((el) => {
      if (el.querySelector('img')) return false;
      const t = el.textContent?.trim() ?? '';
      return t !== '' && t !== speaker;
    });
    return candidates.at(-1)?.textContent?.trim() ?? '';
  }

  private relNow(): number {
    return Math.round((this.clock.now() - this.startedAt) / 1000);
  }

  private emit(block: OpenBlock, final: boolean): void {
    const segment: TranscriptSegment = {
      id: block.id,
      final,
      speaker: block.speaker,
      text: block.text,
      tStart: block.tStart,
      tEnd: this.relNow(),
      source: 'meet-captions',
    };
    this.segmentsSeen += 1;
    this.lastSegmentAt = this.clock.now();
    this.sink?.upsert(segment);
  }
}
