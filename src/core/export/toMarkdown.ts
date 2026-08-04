import type { MeetingSession } from '@/core/types/session';
import type { TranscriptSegment } from '@/core/types/transcript';

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function durationLine(session: MeetingSession): string {
  if (session.endedAt === null) return '';
  const mins = Math.round((session.endedAt - session.startedAt) / 60000);
  return `- **Duration:** ${mins} min\n`;
}

export function transcriptToMarkdown(
  session: MeetingSession,
  segments: readonly TranscriptSegment[],
): string {
  const heading = session.title ?? session.meetingCode;
  const started = new Date(session.startedAt).toISOString();

  let out = `# ${heading}\n\n`;
  out += `- **Meeting:** ${session.meetingCode}\n`;
  out += `- **Started:** ${started}\n`;
  out += durationLine(session);
  if (session.participants.length > 0) {
    out += `- **Participants:** ${session.participants.join(', ')}\n`;
  }
  out += `\n## Transcript\n\n`;

  // Non-final segments are in-flight caption revisions; only finalised text
  // belongs in an export.
  const finals = segments.filter((s) => s.final);
  if (finals.length === 0) {
    out += '_No transcript captured._\n';
    return out;
  }

  for (const s of finals) {
    const who = s.speaker ?? 'Unknown';
    out += `**${who}** [${formatTimestamp(s.tStart)}] ${s.text}\n\n`;
  }
  return out;
}
