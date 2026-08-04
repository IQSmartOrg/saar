import { describe, it, expect } from 'vitest';
import { assertNever, PORT_NAME, type Message } from '@/shared/messaging/messages';

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
        case 'JOIN_CANCELLED':
          return 'cancelled';
        case 'BOT_STATE':
          return `state ${m.status}`;
        case 'SEGMENT_BATCH':
          return `batch ${m.segments.length}`;
        case 'SOURCE_HEALTH':
          return `health ${m.health.ok}`;
        case 'USER_LEFT':
          return 'left';
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
  });
});
