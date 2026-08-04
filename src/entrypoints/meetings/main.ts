import { IndexedDbTranscriptRepository } from '@/adapters/storage/IndexedDbTranscriptRepository';
import { transcriptToMarkdown, formatTimestamp } from '@/core/export/toMarkdown';
import type { MeetingSession } from '@/core/types/session';

const repo = new IndexedDbTranscriptRepository();
const list = document.getElementById('list') as HTMLUListElement;
const detail = document.getElementById('detail') as HTMLElement;

function download(name: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

async function renderDetail(session: MeetingSession): Promise<void> {
  const segments = await repo.getSegments(session.id);
  const finals = segments.filter((s) => s.final);

  detail.hidden = false;
  detail.replaceChildren();

  const h2 = document.createElement('h2');
  h2.textContent = session.title ?? session.meetingCode;
  detail.append(
    h2,
    button('Copy as Markdown', () => {
      void navigator.clipboard.writeText(transcriptToMarkdown(session, segments));
    }),
    button('Download .md', () => {
      download(`${session.meetingCode}.md`, transcriptToMarkdown(session, segments));
    }),
    button('Delete', () => {
      if (!confirm('Delete this meeting and its transcript? This cannot be undone.')) return;
      void (async () => {
        await repo.deleteSession(session.id);
        detail.hidden = true;
        await renderList();
      })();
    }),
  );

  if (finals.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No transcript captured.';
    detail.append(p);
    return;
  }

  for (const s of finals) {
    const p = document.createElement('p');
    p.className = 'line';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = s.speaker ?? 'Unknown';
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = formatTimestamp(s.tStart);
    p.append(who, ts, document.createTextNode(s.text));
    detail.append(p);
  }
}

async function renderList(): Promise<void> {
  const sessions = await repo.listSessions();
  list.replaceChildren();

  if (sessions.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No meetings recorded yet.';
    list.append(li);
    return;
  }

  for (const s of sessions) {
    const li = document.createElement('li');
    const h3 = document.createElement('h3');
    h3.textContent = s.title ?? s.meetingCode;
    const small = document.createElement('small');
    small.textContent = `${new Date(s.startedAt).toLocaleString()} · ${s.status}`;
    li.append(h3, small);
    li.addEventListener('click', () => {
      for (const other of list.children) other.removeAttribute('aria-selected');
      li.setAttribute('aria-selected', 'true');
      void renderDetail(s);
    });
    list.append(li);
  }
}

void renderList();
