import type { Activity, Message } from '@/messaging/messages';
import { byId } from '@/ui/dom';
import { renderActivity } from '@/entrypoints/popup/panels/activityCards';

/** The recording timer ticks in seconds; the push below covers everything else. */
const TICK_MS = 1000;

function openMeetings(sessionId?: string): void {
  const base = chrome.runtime.getURL('/meetings.html');
  void chrome.tabs.create({ url: sessionId === undefined ? base : `${base}#${sessionId}` });
}

/** The "Now" tab: what Saar is doing, and the two buttons that change it. */
export function mountNowPanel(): void {
  const root = byId('activity');
  const open = byId<HTMLButtonElement>('open');

  const send = (m: Message): Promise<unknown> => chrome.runtime.sendMessage(m);

  async function refresh(): Promise<void> {
    const activities = ((await send({ type: 'ACTIVITY_QUERY' })) ?? []) as Activity[];
    renderActivity(root, activities, {
      onStop: (sessionId) => void send({ type: 'STOP_REQUESTED', sessionId }).then(refresh),
      onRetry: (sessionId) => void send({ type: 'RETRY_REQUESTED', sessionId }).then(refresh),
      onOpen: (sessionId) => openMeetings(sessionId),
      onMom: (sessionId, action) =>
        void send({ type: 'MOM_CONTROL', sessionId, action }).then(refresh),
    });
  }

  open.addEventListener('click', () => openMeetings());
  chrome.runtime.onMessage.addListener((msg: Message) => {
    if (msg.type === 'MOM_PROGRESS') void refresh();
  });

  void refresh();
  setInterval(() => void refresh(), TICK_MS);
}
