import { IndexedDbTranscriptRepository } from '@/adapters/storage/IndexedDbTranscriptRepository';
import {
  formatTimestamp,
  meetingToMarkdown,
  minutesToMarkdown,
  transcriptToMarkdown,
} from '@/core/export/toMarkdown';
import type { MeetingSession } from '@/core/types/session';
import type { TranscriptSegment } from '@/core/types/transcript';
import { describePhase, progressPercent, type MomProgress } from '@/processing/types';
import type { Activity, Message } from '@/shared/messaging/messages';
import { renderMinutes } from '@/entrypoints/meetings/minutesView';
import {
  durationMinutes,
  groupByDay,
  matches,
  TRANSCRIPT_SEARCH_MIN,
} from '@/entrypoints/meetings/list';
import { JobStore } from '@/processing/JobStore';
import { progressOf } from '@/processing/MomBuilder';
import {
  canSummarise,
  deriveStatus,
  STATUS_LABEL,
  STATUS_TONE,
  type UiStatus,
} from '@/processing/status';
import type { MomPhase } from '@/processing/types';

const repo = new IndexedDbTranscriptRepository();
const listRoot = document.getElementById('list') as HTMLElement;
const detail = document.getElementById('detail') as HTMLElement;
const search = document.getElementById('search') as HTMLInputElement;

let sessions: readonly MeetingSession[] = [];
let selectedId: string | null = null;
let tab: 'minutes' | 'transcript' = 'minutes';
let progressById = new Map<string, MomProgress>();
let phaseById = new Map<string, MomPhase>();
let minutesIds = new Set<string>();

const jobs = new JobStore();

/** Every surface derives status the same way — see processing/status.ts. */
function statusOf(session: MeetingSession): UiStatus {
  return deriveStatus({
    status: session.status,
    jobPhase: phaseById.get(session.id),
    hasMinutes: minutesIds.has(session.id),
  });
}

/** Transcript text per session, loaded on demand and reused for search. */
const transcriptCache = new Map<string, string>();

/**
 * The handful of nodes that change while a meeting is in flight.
 *
 * Kept so a live tick can update just these. Re-running renderDetail on a timer
 * replaced the whole pane every two seconds, which read as a blink and threw
 * away scroll position and text selection along with it.
 */
let liveNodes: {
  sessionId: string;
  lines?: HTMLElement;
  shownIds?: Set<string>;
  phase?: HTMLElement;
  fill?: HTMLElement;
  chipHost?: HTMLElement;
} | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function chip(state: UiStatus, progress?: MomProgress): HTMLElement {
  const node = el('span', `chip ${STATUS_TONE[state]}`);
  if (state === 'recording') node.append(el('span', 'dotp'));
  // While summarising, the chip carries the count — it is the most useful
  // thing that can fit, and it moves.
  const label =
    state === 'processing' && progress !== undefined
      ? `${progress.done} / ${progress.total}`
      : STATUS_LABEL[state];
  node.append(document.createTextNode(label));
  return node;
}

/* ------------------------------------------------------------------ *
 * List
 * ------------------------------------------------------------------ */

function renderList(): void {
  const query = search.value;
  const visible = sessions.filter((s) => matches(s, query, transcriptCache.get(s.id)));
  listRoot.replaceChildren();

  if (visible.length === 0) {
    const empty = el('div', 'list-empty');
    empty.append(
      el('p', 'empty-t', query.trim() === '' ? 'No meetings yet' : 'Nothing matches'),
      el(
        'p',
        'note',
        query.trim() === ''
          ? 'Saar saves a transcript every time it joins a Meet call.'
          : 'Try a word someone actually said.',
      ),
    );
    listRoot.append(empty);
    return;
  }

  for (const group of groupByDay(visible)) {
    listRoot.append(el('div', 'grouphead', group.label));
    for (const session of group.sessions) {
      const state = statusOf(session);
      const item = el('button', 'item');
      item.type = 'button';
      if (session.id === selectedId) item.classList.add('on');

      const row = el('div', 'item-row');
      row.append(el('span', 'item-t', session.title ?? session.meetingCode));
      row.append(chip(state, progressById.get(session.id)));

      const mins = durationMinutes(session);
      const when = new Date(session.startedAt).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
      const meta = [when, mins === null ? null : `${mins} min`].filter(Boolean).join(' · ');

      item.append(row, el('span', 'item-m', meta));
      item.addEventListener('click', () => select(session.id));
      listRoot.append(item);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */

function download(name: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Confirms a copy happened: label swap plus a green tick, then reverts. */
function flashCopied(node: HTMLButtonElement, label = 'Copied'): void {
  if (node.dataset['original'] === undefined) {
    node.dataset['original'] = node.textContent ?? '';
  }
  const original = node.dataset['original'];
  node.replaceChildren(el('span', 'tick-in', '✓'), document.createTextNode(label));
  node.classList.add('copied');
  node.disabled = true;

  window.clearTimeout(Number(node.dataset['timer'] ?? 0));
  node.dataset['timer'] = String(
    window.setTimeout(() => {
      node.textContent = original;
      node.classList.remove('copied');
      node.disabled = false;
    }, 1600),
  );
}

function stateBox(
  session: MeetingSession,
  state: UiStatus,
  progress: MomProgress | undefined,
): HTMLElement {
  const box = el('div', 'state-box');

  if (state === 'processing') {
    box.append(chip('processing', progress));
    const phaseLine = el('div', 'state-t', progress ? describePhase(progress) : 'Writing the minutes…');
    box.append(phaseLine);
    const track = el('div', 'track');
    const fill = el('span');
    fill.style.width = `${progress ? progressPercent(progress) : 0}%`;
    track.append(fill);
    box.append(track, el('p', 'note', 'You can read the transcript while this runs.'));
    if (liveNodes !== null) {
      liveNodes.phase = phaseLine;
      liveNodes.fill = fill;
    }
    return box;
  }

  if (state === 'failed') {
    box.classList.add('bad');
    box.append(chip('failed'));
    box.append(el('div', 'state-t', session.error ?? 'The model did not answer.'));
    // The transcript survives every summarisation failure by design.
    box.append(el('p', 'note', 'The transcript is saved. Nothing was lost.'));
    const actions = el('div', 'actions');
    actions.append(button('Try again', 'act primary', () => void retry(session.id)));
    box.append(actions);
    return box;
  }

  box.append(el('div', 'state-t', 'No summary for this meeting'));
  box.append(
    el('p', 'note', 'AI summaries were off when it was recorded. The transcript is complete.'),
  );
  const actions = el('div', 'actions');
  actions.append(button('Summarise now', 'act primary', () => void retry(session.id)));
  box.append(actions);
  return box;
}

function renderTranscript(
  segments: readonly TranscriptSegment[],
  live: boolean,
): HTMLElement {
  // While recording, the newest block is still being revised by Meet's ASR, so
  // filtering to final-only hides the last thing anyone said — exactly the part
  // someone watching a live meeting wants to see.
  const shown = live ? segments : segments.filter((s) => s.final);
  const finals = shown;
  if (finals.length === 0) {
    const box = el('div', 'state-box');
    box.append(el('div', 'state-t', 'No transcript captured'));
    box.append(el('p', 'note', 'Captions may not have been running for this meeting.'));
    return box;
  }

  const wrap = el('div', 'lines');
  for (const s of finals) wrap.append(transcriptLine(s));
  return wrap;
}

function transcriptLine(s: TranscriptSegment): HTMLElement {
  const line = el('div', 'line');
  line.dataset['seg'] = s.id;
  if (!s.final) line.classList.add('interim');
  const who = el('div', 'who');
  who.append(
    el('span', 'who-name', s.speaker ?? 'Unknown'),
    el('span', 'tstamp', formatTimestamp(s.tStart)),
  );
  line.append(who, el('div', 'said', s.text));
  return line;
}

async function retry(sessionId: string): Promise<void> {
  const ok = (await chrome.runtime.sendMessage({
    type: 'RETRY_REQUESTED',
    sessionId,
  } satisfies Message)) as boolean | undefined;
  if (ok === false) {
    // Refusing loudly beats clearing the error and doing nothing.
    alert('Turn on "Summarise with AI" in the Saar popup first.');
    return;
  }
  await refresh();
}

async function renderDetail(): Promise<void> {
  const session = sessions.find((s) => s.id === selectedId);
  detail.replaceChildren();

  if (!session) {
    const empty = el('div', 'detail-empty');
    empty.append(
      el('p', 'empty-t', 'Pick a meeting'),
      el('p', 'note', 'Its minutes and transcript appear here.'),
    );
    detail.append(empty);
    return;
  }

  const [segments, minutes] = await Promise.all([
    repo.getSegments(session.id),
    repo.getMinutes(session.id),
  ]);
  const state = statusOf(session);
  // Interim blocks are shown while recording, so count them too — otherwise a
  // live meeting reads "0 lines" while text is visibly arriving.
  const finals =
    state === 'recording' ? segments : segments.filter((s) => s.final);
  const progress = progressById.get(session.id);

  // Header
  const head = el('div', 'd-head');
  head.append(el('h2', 'd-title', session.title ?? session.meetingCode));
  const mins = durationMinutes(session);
  const meta = [
    new Date(session.startedAt).toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    mins === null ? null : `${mins} min`,
    `${finals.length} ${finals.length === 1 ? 'line' : 'lines'}`,
    session.meetingCode,
  ]
    .filter(Boolean)
    .join(' · ');
  head.append(el('div', 'd-meta', meta));
  detail.append(head);

  // Meeting-level actions only. Copy and Download belong to whichever section
  // is on screen, so they live under the tabs rather than above them — a
  // "Copy transcript" button sitting over the Minutes tab is a lie.
  const actions = el('div', 'actions');

  if (canSummarise(state, finals.length > 0)) {
    actions.append(
      button(minutes === null ? 'Summarise' : 'Re-run summary', 'act', () => void retry(session.id)),
    );
  }

  actions.append(
    button('Delete', 'act danger', () => {
      if (!confirm('Delete this meeting, its transcript and its minutes? This cannot be undone.')) {
        return;
      }
      void (async () => {
        await repo.deleteSession(session.id);
        transcriptCache.delete(session.id);
        selectedId = null;
        await refresh();
      })();
    }),
  );
  detail.append(actions);

  // Tabs
  const tabs = el('div', 'tabs');
  const minutesTab = button('Minutes', tab === 'minutes' ? 'on' : '', () => {
    tab = 'minutes';
    void renderDetail();
  });
  const transcriptTab = button(`Transcript · ${finals.length}`, tab === 'transcript' ? 'on' : '', () => {
    tab = 'transcript';
    void renderDetail();
  });
  tabs.append(minutesTab, transcriptTab);
  detail.append(tabs);

  // Section toolbar: acts on what is visible.
  const tools = el('div', 'actions tools');
  const showingMinutes = tab === 'minutes' && minutes !== null;

  const copy = button(
    showingMinutes ? 'Copy minutes' : 'Copy transcript',
    'act primary',
    () => {
      const body = showingMinutes
        ? minutesToMarkdown(minutes)
        : transcriptToMarkdown(session, segments);
      void navigator.clipboard
        .writeText(body)
        .then(() => flashCopied(copy))
        .catch(() => flashCopied(copy, 'Copy failed'));
    },
  );

  const dl = button('Download .md', 'act', () => {
    // One complete file regardless of the tab: minutes without the transcript
    // lose the evidence behind them.
    download(`${session.meetingCode}.md`, meetingToMarkdown(session, segments, minutes));
  });
  dl.title = 'Minutes and full transcript in one file';

  // Nothing worth copying yet on an empty or unwritten section.
  const hasSomething = showingMinutes || finals.length > 0;
  if (hasSomething) tools.append(copy, dl);
  if (tools.children.length > 0) detail.append(tools);

  // Body
  liveNodes = { sessionId: session.id };

  if (tab === 'transcript') {
    const lines = renderTranscript(segments, state === 'recording');
    liveNodes.lines = lines;
    liveNodes.shownIds = new Set(
      [...lines.querySelectorAll('[data-seg]')].map((n) => (n as HTMLElement).dataset['seg'] ?? ''),
    );
    detail.append(lines);
    return;
  }
  if (minutes !== null) {
    detail.append(renderMinutes(minutes));
    return;
  }
  detail.append(stateBox(session, state, progress));
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

function select(id: string): void {
  const session = sessions.find((s) => s.id === id);
  selectedId = id;
  // Nothing to summarise yet during a live call — open on the words instead.
  tab = session && statusOf(session) === 'recording' ? 'transcript' : 'minutes';
  history.replaceState(null, '', `#${id}`);
  renderList();
  void renderDetail();
}

/** Loads transcripts once so search can look inside them. */
async function warmTranscripts(): Promise<void> {
  for (const s of sessions) {
    if (transcriptCache.has(s.id)) continue;
    const segments = await repo.getSegments(s.id);
    transcriptCache.set(
      s.id,
      segments
        .filter((x) => x.final)
        .map((x) => `${x.speaker ?? ''} ${x.text}`)
        .join('\n'),
    );
  }
  renderList();
}

async function refresh(): Promise<void> {
  const [loaded, ids, allJobs] = await Promise.all([
    repo.listSessions(),
    repo.listMinutesIds(),
    // Read the job store directly: it is chrome.storage.local, so an extension
    // page can see it without a message round trip to a worker that may be
    // asleep. The job is what decides "processing", not the session row.
    jobs.all(),
  ]);
  sessions = loaded;
  minutesIds = new Set(ids);
  phaseById = new Map(allJobs.map((j) => [j.sessionId, j.phase]));

  const activities = ((await chrome.runtime.sendMessage({
    type: 'ACTIVITY_QUERY',
  } satisfies Message)) ?? []) as Activity[];
  progressById = new Map(
    activities
      .filter((a): a is Extract<Activity, { kind: 'processing' }> => a.kind === 'processing')
      .map((a) => [a.sessionId, a.progress]),
  );

  if (selectedId !== null && !sessions.some((s) => s.id === selectedId)) selectedId = null;
  renderList();
  await renderDetail();
}

search.addEventListener('input', () => {
  renderList();
  if (search.value.trim().length >= TRANSCRIPT_SEARCH_MIN) void warmTranscripts();
});

// The popup deep-links to a specific meeting: meetings.html#<sessionId>
void (async () => {
  const fromHash = location.hash.slice(1);
  if (fromHash !== '') selectedId = fromHash;
  await refresh();
  void warmTranscripts();
})();

/**
 * Whether anything on screen is actually changing.
 *
 * Deliberately narrow. Polling because *some* meeting elsewhere is busy meant a
 * full re-render every two seconds while the user read a month-old transcript.
 * Only the selected meeting matters, and only on the tab that shows its
 * movement: new caption lines on the transcript, a progress bar on the minutes.
 */
function liveTarget(): 'transcript' | 'progress' | null {
  const session = sessions.find((s) => s.id === selectedId);
  if (!session) return null;
  const state = statusOf(session);
  if (state === 'recording' && tab === 'transcript') return 'transcript';
  if (state === 'processing' && tab === 'minutes') return 'progress';
  return null;
}

/**
 * Updates only the nodes that moved.
 *
 * Nothing here replaces a container, so scroll position, text selection and
 * focus all survive — which a re-render does not.
 */
async function tick(): Promise<void> {
  const target = liveTarget();
  if (target === null || liveNodes === null) return;
  const sessionId = liveNodes.sessionId;

  // A meeting ending is the one thing a targeted update cannot express — the
  // actions, tabs and body all change at once. Catch it with a single cheap
  // read rather than by re-rendering on a timer.
  const current = await repo.getSession(sessionId);
  const known = sessions.find((s) => s.id === sessionId);
  if (current !== null && known !== undefined && current.status !== known.status) {
    await refresh();
    return;
  }

  if (target === 'transcript' && liveNodes.lines && liveNodes.shownIds) {
    const segments = await repo.getSegments(sessionId);
    const wrap = liveNodes.lines;
    const shown = liveNodes.shownIds;

    for (const seg of segments) {
      const existing = wrap.querySelector<HTMLElement>(`[data-seg="${CSS.escape(seg.id)}"]`);
      if (existing === null) {
        wrap.append(transcriptLine(seg));
        shown.add(seg.id);
        continue;
      }
      // Meet rewrites a block in place as its ASR refines it, so an existing
      // line's text and final-ness both change: patch rather than re-append.
      const said = existing.querySelector('.said');
      if (said !== null && said.textContent !== seg.text) said.textContent = seg.text;
      existing.classList.toggle('interim', !seg.final);
    }
    return;
  }

  if (target === 'progress') {
    const running = (await jobs.all()).find((j) => j.sessionId === sessionId);
    if (running === undefined) {
      // The job finished: this is the one case that genuinely needs the pane
      // rebuilt, because minutes have replaced the progress box entirely.
      await refresh();
      return;
    }
    const progress = progressOf(running);
    if (liveNodes.phase) liveNodes.phase.textContent = describePhase(progress);
    if (liveNodes.fill) liveNodes.fill.style.width = `${progressPercent(progress)}%`;
  }
}

setInterval(() => void tick(), 2000);
