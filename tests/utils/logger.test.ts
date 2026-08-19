import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  addSink,
  consoleSink,
  formatPrefix,
  ingest,
  logger,
  setMinLevel,
  shortTime,
  toLoggedError,
  type LogRecord,
} from '@/utils/logger';

/**
 * The logger every other module depends on.
 *
 * Worth testing properly rather than trusting: a sink that throws, or a level
 * filter that silently drops the one line that mattered, fails exactly when
 * something else has already gone wrong and you are reading logs to find out
 * why.
 */

let captured: LogRecord[];
let removeSink: () => void;

beforeEach(() => {
  captured = [];
  removeSink = addSink((r) => captured.push(r));
  setMinLevel('debug');
});

afterEach(() => {
  removeSink();
  setMinLevel('debug');
  vi.restoreAllMocks();
});

describe('the record', () => {
  it('carries the module, level, message and a timestamp', () => {
    logger('meet.join').info('clicked join');

    expect(captured).toHaveLength(1);
    const r = captured[0]!;
    expect(r.module).toBe('meet.join');
    expect(r.level).toBe('info');
    expect(r.message).toBe('clicked join');
    expect(() => new Date(r.ts).toISOString()).not.toThrow();
    expect(r.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('is JSON-serialisable, since it crosses a message port', () => {
    logger('meet.join').warning('odd', { attempt: 2, label: 'ask to join' });
    expect(() => JSON.stringify(captured[0])).not.toThrow();
    expect(JSON.parse(JSON.stringify(captured[0])).context).toEqual({
      attempt: 2,
      label: 'ask to join',
    });
  });

  it('keeps context out of the record entirely when there is none', () => {
    logger('a').info('bare');
    expect(captured[0]!.context).toBeUndefined();
  });

  it('exposes the four levels the modules use', () => {
    const log = logger('a');
    log.debug('d');
    log.info('i');
    log.warning('w');
    log.severe('s');
    expect(captured.map((r) => r.level)).toEqual(['debug', 'info', 'warning', 'severe']);
  });

  it('child loggers narrow the module path', () => {
    logger('meet.join').child('driver').info('x');
    expect(captured[0]!.module).toBe('meet.join.driver');
  });
});

describe('exceptions', () => {
  it('normalises an Error into name, message and stack', () => {
    logger('a').severe('broke', { error: new TypeError('nope') });

    const err = captured[0]!.error;
    expect(err?.name).toBe('TypeError');
    expect(err?.message).toBe('nope');
    expect(typeof err?.stack).toBe('string');
  });

  it('survives something that is not an Error being thrown', () => {
    // `catch (e)` gives you whatever was thrown, which is not always an Error.
    expect(toLoggedError('just a string')).toEqual({
      name: 'Thrown',
      message: 'just a string',
    });
  });

  it('separates the exception from the rest of the context', () => {
    logger('a').severe('broke', { error: new Error('x'), sessionId: 's1' });
    expect(captured[0]!.context).toEqual({ sessionId: 's1' });
    expect(captured[0]!.error?.message).toBe('x');
  });
});

describe('levels', () => {
  it('drops anything below the minimum', () => {
    setMinLevel('warning');
    const log = logger('a');
    log.debug('d');
    log.info('i');
    log.warning('w');
    log.severe('s');
    expect(captured.map((r) => r.message)).toEqual(['w', 's']);
  });
});

describe('sinks', () => {
  it('a sink that throws does not take down the caller', () => {
    // The whole point of logging is to survive the thing being logged about.
    const off = addSink(() => {
      throw new Error('bad sink');
    });
    expect(() => logger('a').info('still fine')).not.toThrow();
    expect(captured).toHaveLength(1);
    off();
  });

  it('removing a sink stops it receiving', () => {
    const seen: LogRecord[] = [];
    const off = addSink((r) => seen.push(r));
    logger('a').info('one');
    off();
    logger('a').info('two');
    expect(seen.map((r) => r.message)).toEqual(['one']);
  });

  it('ingest re-emits a record from elsewhere, tagged with its origin', () => {
    // How the hidden notetaker's logs reach the worker's console.
    const fromBot: LogRecord = {
      ts: new Date().toISOString(),
      level: 'info',
      module: 'agents.notetaker',
      message: 'capturing',
    };
    ingest(fromBot, 'bot');

    expect(captured[0]!.origin).toBe('bot');
    expect(captured[0]!.module).toBe('agents.notetaker');
  });
});

describe('the console line', () => {
  it('reads as time, module, message', () => {
    const line = formatPrefix({
      ts: '2026-08-19T16:22:41.123Z',
      level: 'info',
      module: 'meet.join',
      message: 'clicked join',
    });
    expect(line).toBe('[saar] 16:22:41.123 meet.join: clicked join');
  });

  it('marks a forwarded record so it is not mistaken for a local one', () => {
    const line = formatPrefix({
      ts: '2026-08-19T16:22:41.123Z',
      level: 'info',
      module: 'agents.notetaker',
      message: 'capturing',
      origin: 'bot',
    });
    expect(line).toContain('←bot');
  });

  it('trims the ISO timestamp to a readable time', () => {
    expect(shortTime('2026-08-19T16:22:41.123Z')).toBe('16:22:41.123');
  });

  it('maps severity onto the matching console method, so DevTools filters work', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    consoleSink({ ts: '2026-08-19T00:00:00.000Z', level: 'severe', module: 'a', message: 'x' });
    consoleSink({ ts: '2026-08-19T00:00:00.000Z', level: 'warning', module: 'a', message: 'y' });

    expect(error).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('passes context as an object so DevTools renders it expandable', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleSink({
      ts: '2026-08-19T00:00:00.000Z',
      level: 'info',
      module: 'a',
      message: 'x',
      context: { count: 3 },
    });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('a: x'), { count: 3 });
  });

  it('keeps a bare line on one argument', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleSink({ ts: '2026-08-19T00:00:00.000Z', level: 'info', module: 'a', message: 'x' });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('a: x'));
  });
});
