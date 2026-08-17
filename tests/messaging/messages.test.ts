import { describe, it, expect } from 'vitest';
import { PORT_NAME, type Message } from '@/messaging/messages';
import { assertNever } from '@/utils/assert';

describe('message bus', () => {
  it('exposes a stable port name', () => {
    expect(PORT_NAME).toBe('saar-bot');
  });

  it('assertNever throws when an unhandled variant reaches it', () => {
    expect(() => assertNever('surprise' as never)).toThrow(/Unhandled/);
  });

  it('narrows exhaustively over the union', () => {
    const describeMsg = (m: Message): string => {
      switch (m.type) {
        case 'MEETING_DETECTED':
          return `detected ${m.meetingCode}`;
        case 'BOT_STATE':
          return `state ${m.status}`;
        case 'SEGMENT_BATCH':
          return `batch ${m.segments.length}`;
        case 'SOURCE_HEALTH':
          return `health ${m.health.ok}`;
        case 'USER_LEFT':
          return `left (${m.reason})`;
        case 'USER_ALIVE':
          return 'alive';
        case 'BOT_PRESENCE':
          return `presence ${m.inCall}`;
        case 'STOP_REQUESTED':
          return 'stop';
        case 'ACTIVITY_QUERY':
          return 'activity';
        case 'RETRY_REQUESTED':
          return 'retry';
        case 'MOM_PROGRESS':
          return `mom ${m.progress.phase}`;
        case 'LLM_PROBE':
          return 'llm probe';
        case 'MOM_CONTROL':
          return `mom ${m.action}`;
        default:
          return assertNever(m);
      }
    };
    expect(
      describeMsg({ type: 'MEETING_DETECTED', meetingCode: 'abc-defg-hij', tabId: 1, title: null }),
    ).toBe('detected abc-defg-hij');
    expect(describeMsg({ type: 'SEGMENT_BATCH', sessionId: 's', segments: [] })).toBe('batch 0');
    expect(describeMsg({ type: 'BOT_STATE', sessionId: 's', status: 'capturing' })).toBe(
      'state capturing',
    );
    expect(
      describeMsg({ type: 'USER_LEFT', meetingCode: 'abc-defg-hij', reason: 'user-left-meeting' }),
    ).toBe('left (user-left-meeting)');
    expect(describeMsg({ type: 'STOP_REQUESTED', sessionId: 's' })).toBe('stop');
  });
});
