import type { MeetingSession } from '@/session/types';
import type { MeetingMinutes } from '@/minutes/types';
import type { TranscriptSegment } from '@/capture/types';
import { formatTimestamp } from '@/utils/time';

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

/** Minutes alone, for the clipboard when someone wants just the outcome. */
export function minutesToMarkdown(minutes: MeetingMinutes): string {
  if (minutes.raw !== undefined && minutes.topics.length === 0) {
    // Unparseable model output was kept verbatim rather than discarded.
    return `## Summary\n\n${minutes.raw.trim()}\n`;
  }

  let out = '';
  if (minutes.summary !== '') out += `## Summary\n\n${minutes.summary}\n\n`;

  if (minutes.topics.length > 0) {
    out += `## Topics\n\n`;
    for (const t of minutes.topics) {
      out += `### ${t.title}\n\n`;
      for (const p of t.points) out += `- ${p}\n`;
      if (t.speakers.length > 0) out += `\n_${t.speakers.join(', ')}_\n`;
      out += '\n';
    }
  }

  if (minutes.decisions.length > 0) {
    out += `## Decisions\n\n`;
    for (const d of minutes.decisions) {
      out += `- **${d.decision}**`;
      out += d.context === '' ? '\n' : ` — ${d.context}\n`;
    }
    out += '\n';
  }

  if (minutes.actionItems.length > 0) {
    out += `## Action items\n\n`;
    for (const a of minutes.actionItems) {
      const due = a.due === null ? '' : ` _(by ${a.due})_`;
      out += `- **${a.owner}** — ${a.task}${due}\n`;
      // The quote is what makes a local model's output checkable, so it
      // survives the export rather than being a UI-only flourish.
      if (a.quote !== '') out += `  > ${a.quote}\n`;
    }
    out += '\n';
  }

  if (minutes.openQuestions.length > 0) {
    out += `## Open questions\n\n`;
    for (const q of minutes.openQuestions) out += `- ${q}\n`;
    out += '\n';
  }

  return out;
}

/**
 * The whole meeting: minutes first, then the transcript they came from.
 *
 * Both, always. Minutes without the transcript lose the evidence, and a reader
 * who wants to check a claim should not have to go back for a second file.
 */
export function meetingToMarkdown(
  session: MeetingSession,
  segments: readonly TranscriptSegment[],
  minutes: MeetingMinutes | null,
): string {
  const transcript = transcriptToMarkdown(session, segments);
  if (minutes === null) return transcript;

  // Splice the minutes between the header block and the transcript heading.
  const marker = '\n## Transcript\n';
  const at = transcript.indexOf(marker);
  if (at === -1) return `${transcript}\n${minutesToMarkdown(minutes)}`;
  return `${transcript.slice(0, at)}\n${minutesToMarkdown(minutes)}${transcript.slice(at)}`;
}
