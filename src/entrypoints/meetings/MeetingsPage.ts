import { IndexedDbTranscriptRepository } from '@/storage/IndexedDbTranscriptRepository';
import { JobStore } from '@/processing/job/JobStore';
import { progressOf } from '@/processing/mom/MomBuilder';
import { describePhase, progressPercent } from '@/processing/mom/types';
import type { Message, MomAction } from '@/messaging/messages';
import { byId } from '@/ui/dom';
import { TRANSCRIPT_SEARCH_MIN } from '@/entrypoints/meetings/listModel';
import {
  EMPTY_PAGE_DATA,
  loadPageData,
  statusOf,
  type PageData,
} from '@/entrypoints/meetings/pageData';
import { renderList } from '@/entrypoints/meetings/views/list';
import {
  renderDetail,
  renderEmptyDetail,
  type DetailNodes,
  type DetailTab,
} from '@/entrypoints/meetings/views/detail';
import { transcriptLine } from '@/entrypoints/meetings/views/transcript';

const TICK_MS = 2000;

/**
 * The meetings page controller.
 *
 * It owns the page's state and decides *when* to draw; the `views/` files
 * decide *what* to draw. The split matters most for the live tick below, which
 * has to update a handful of nodes without re-rendering anything around them.
 */
export class MeetingsPage {
  private readonly repo = new IndexedDbTranscriptRepository();
  private readonly jobs = new JobStore();

  private readonly listRoot = byId('list');
  private readonly detailRoot = byId('detail');
  private readonly search = byId<HTMLInputElement>('search');

  private data: PageData = EMPTY_PAGE_DATA;
  private selectedId: string | null = null;
  private tab: DetailTab = 'minutes';

  /** Transcript text per session, loaded on demand and reused for search. */
  private readonly transcripts = new Map<string, string>();
  private live: (DetailNodes & { sessionId: string }) | null = null;

  async start(): Promise<void> {
    this.search.addEventListener('input', () => {
      this.drawList();
      if (this.search.value.trim().length >= TRANSCRIPT_SEARCH_MIN) void this.warmTranscripts();
    });

    // The popup deep-links to a specific meeting: meetings.html#<sessionId>
    const fromHash = location.hash.slice(1);
    if (fromHash !== '') this.selectedId = fromHash;

    await this.refresh();
    void this.warmTranscripts();
    setInterval(() => void this.tick(), TICK_MS);
  }

  /* -- state -------------------------------------------------------- */

  private async refresh(): Promise<void> {
    this.data = await loadPageData(this.repo, this.jobs);
    if (this.selectedId !== null && !this.selected()) this.selectedId = null;
    this.drawList();
    await this.drawDetail();
  }

  private selected() {
    return this.data.sessions.find((s) => s.id === this.selectedId);
  }

  private select(sessionId: string): void {
    this.selectedId = sessionId;
    const session = this.selected();
    // Nothing to summarise yet during a live call — open on the words instead.
    this.tab = session && statusOf(this.data, session) === 'recording' ? 'transcript' : 'minutes';
    history.replaceState(null, '', `#${sessionId}`);
    this.drawList();
    void this.drawDetail();
  }

  /** Loads transcripts once so search can look inside them. */
  private async warmTranscripts(): Promise<void> {
    for (const session of this.data.sessions) {
      if (this.transcripts.has(session.id)) continue;
      const segments = await this.repo.getSegments(session.id);
      this.transcripts.set(
        session.id,
        segments
          .filter((s) => s.final)
          .map((s) => `${s.speaker ?? ''} ${s.text}`)
          .join('\n'),
      );
    }
    this.drawList();
  }

  private async retry(sessionId: string): Promise<void> {
    const ok = (await chrome.runtime.sendMessage({
      type: 'RETRY_REQUESTED',
      sessionId,
    } satisfies Message)) as boolean | undefined;
    if (ok === false) {
      // Refusing loudly beats clearing the error and doing nothing.
      alert('Turn on "Summarise with AI" in the Saar popup first.');
      return;
    }
    await this.refresh();
  }

  private async controlMom(sessionId: string, action: MomAction): Promise<void> {
    await chrome.runtime.sendMessage({
      type: 'MOM_CONTROL',
      sessionId,
      action,
    } satisfies Message);
    await this.refresh();
  }

  private async remove(sessionId: string): Promise<void> {
    if (!confirm('Delete this meeting, its transcript and its minutes? This cannot be undone.')) {
      return;
    }
    await this.repo.deleteSession(sessionId);
    this.transcripts.delete(sessionId);
    this.selectedId = null;
    await this.refresh();
  }

  /* -- drawing ------------------------------------------------------ */

  private drawList(): void {
    renderList(this.listRoot, {
      sessions: this.data.sessions,
      query: this.search.value,
      selectedId: this.selectedId,
      transcripts: this.transcripts,
      statusOf: (session) => statusOf(this.data, session),
      progressOf: (id) => this.data.progressById.get(id),
      onSelect: (id) => this.select(id),
    });
  }

  private async drawDetail(): Promise<void> {
    const session = this.selected();
    if (!session) {
      this.live = null;
      renderEmptyDetail(this.detailRoot);
      return;
    }

    const [segments, minutes] = await Promise.all([
      this.repo.getSegments(session.id),
      this.repo.getMinutes(session.id),
    ]);

    const nodes = renderDetail(this.detailRoot, {
      session,
      segments,
      minutes,
      state: statusOf(this.data, session),
      progress: this.data.progressById.get(session.id),
      tab: this.tab,
      onTab: (tab) => {
        this.tab = tab;
        void this.drawDetail();
      },
      onRetry: () => void this.retry(session.id),
      onDelete: () => void this.remove(session.id),
      onMom: (action) => void this.controlMom(session.id, action),
    });
    this.live = { sessionId: session.id, ...nodes };
  }

  /* -- the live tick ------------------------------------------------ */

  /**
   * Whether anything on screen is actually changing.
   *
   * Deliberately narrow. Polling because *some* meeting elsewhere is busy meant
   * a full re-render every two seconds while the user read a month-old
   * transcript. Only the selected meeting matters, and only on the tab that
   * shows its movement: new caption lines on the transcript, a progress bar on
   * the minutes.
   */
  private liveTarget(): 'transcript' | 'progress' | null {
    const session = this.selected();
    if (!session) return null;
    const state = statusOf(this.data, session);
    if (state === 'recording' && this.tab === 'transcript') return 'transcript';
    if (state === 'processing' && this.tab === 'minutes') return 'progress';
    return null;
  }

  /**
   * Updates only the nodes that moved.
   *
   * Nothing here replaces a container, so scroll position, text selection and
   * focus all survive — which a re-render does not.
   */
  private async tick(): Promise<void> {
    const target = this.liveTarget();
    if (target === null || this.live === null) return;
    const { sessionId } = this.live;

    // A meeting ending is the one thing a targeted update cannot express — the
    // actions, tabs and body all change at once. Catch it with a single cheap
    // read rather than by re-rendering on a timer.
    const current = await this.repo.getSession(sessionId);
    const known = this.data.sessions.find((s) => s.id === sessionId);
    if (current !== null && known !== undefined && current.status !== known.status) {
      await this.refresh();
      return;
    }

    if (target === 'transcript') await this.tickTranscript(sessionId);
    else await this.tickProgress(sessionId);
  }

  private async tickTranscript(sessionId: string): Promise<void> {
    const wrap = this.live?.lines;
    if (!wrap) return;

    for (const segment of await this.repo.getSegments(sessionId)) {
      const existing = wrap.querySelector<HTMLElement>(`[data-seg="${CSS.escape(segment.id)}"]`);
      if (existing === null) {
        wrap.append(transcriptLine(segment));
        continue;
      }
      // Meet rewrites a block in place as its ASR refines it, so an existing
      // line's text and final-ness both change: patch rather than re-append.
      const said = existing.querySelector('.said');
      if (said !== null && said.textContent !== segment.text) said.textContent = segment.text;
      existing.classList.toggle('interim', !segment.final);
    }
  }

  private async tickProgress(sessionId: string): Promise<void> {
    const job = (await this.jobs.all()).find((j) => j.sessionId === sessionId);
    if (job === undefined) {
      // The job finished: this is the one case that genuinely needs the pane
      // rebuilt, because minutes have replaced the progress box entirely.
      await this.refresh();
      return;
    }
    const progress = progressOf(job);
    if (this.live?.phase) this.live.phase.textContent = describePhase(progress);
    if (this.live?.fill) this.live.fill.style.width = `${progressPercent(progress)}%`;
  }
}
