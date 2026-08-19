/**
 * Structured logging, one line per thing that happens.
 *
 * Every record is a JSON-serialisable object — timestamp, level, module,
 * message, context, exception — printed alongside a readable prefix so DevTools
 * shows both a scannable line and an expandable object.
 *
 * Sinks are pluggable, which is not decoration. The notetaker runs in a hidden
 * tab, and opening that tab's console means clicking onto it, which makes Chrome
 * start rendering it — frequently the exact thing being diagnosed. So the
 * notetaker adds a sink that forwards its records to the background worker, and
 * everything lands in one console that can be read without disturbing anything.
 *
 * No `chrome.*` and no imports: this is the one module every other module is
 * allowed to depend on, so it must depend on nothing.
 */

export type LogLevel = 'debug' | 'info' | 'warning' | 'severe';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warning: 30, severe: 40 };

export interface LoggedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export interface LogRecord {
  /** ISO 8601, UTC. The prefix shows a short local time; this is the real one. */
  readonly ts: string;
  readonly level: LogLevel;
  /** Dotted path of the module that logged it, e.g. `meet.join`. */
  readonly module: string;
  readonly message: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly error?: LoggedError;
  /** Set by the receiver when a record arrived from somewhere else. */
  readonly origin?: string;
}

export type LogSink = (record: LogRecord) => void;

export interface LogContext {
  /** An Error, or anything thrown. Normalised into `record.error`. */
  readonly error?: unknown;
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warning(message: string, context?: LogContext): void;
  severe(message: string, context?: LogContext): void;
  /** A logger for a narrower part of the same module. */
  child(suffix: string): Logger;
}

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

/**
 * Dev builds log everything; production keeps `debug` out.
 *
 * Read defensively — this file is imported by content scripts, tests and the
 * worker alike, and not every one of those has `import.meta.env` defined.
 */
function isDev(): boolean {
  try {
    return import.meta.env?.DEV === true;
  } catch {
    return false;
  }
}

let minLevel: LogLevel = isDev() ? 'debug' : 'info';

export function setMinLevel(level: LogLevel): void {
  minLevel = level;
}

/**
 * Turn debug logging on from any console: `saarLogLevel('debug')`.
 *
 * A production build starts at `info`, which is right for normal running and
 * wrong the moment you are trying to diagnose something — and rebuilding in dev
 * mode to see one line is a poor trade. Reachable from the worker, the popup
 * and any page the extension runs in.
 */
try {
  (globalThis as Record<string, unknown>)['saarLogLevel'] = setMinLevel;
} catch {
  /* frozen global; the level can still be set from code */
}

const sinks = new Set<LogSink>();

/** Adds a destination. Returns a function that removes it again. */
export function addSink(sink: LogSink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

/* ------------------------------------------------------------------ *
 * The console sink
 * ------------------------------------------------------------------ */

/** `16:22:41.123` — enough to correlate with a meeting, without the date noise. */
export function shortTime(iso: string): string {
  return iso.slice(11, 23);
}

export function formatPrefix(record: LogRecord): string {
  const from = record.origin === undefined ? '' : `←${record.origin} `;
  return `[saar] ${from}${shortTime(record.ts)} ${record.module}: ${record.message}`;
}

const METHOD: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  severe: 'error',
};

export function consoleSink(record: LogRecord): void {
  const line = formatPrefix(record);
  const detail = { ...record.context, ...(record.error ? { error: record.error } : {}) };
  // The object is passed separately rather than stringified so DevTools renders
  // it expandable; an empty one is omitted so simple lines stay one line.
  if (Object.keys(detail).length === 0) console[METHOD[record.level]](line);
  else console[METHOD[record.level]](line, detail);
}

sinks.add(consoleSink);

/* ------------------------------------------------------------------ *
 * Emitting
 * ------------------------------------------------------------------ */

export function toLoggedError(error: unknown): LoggedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { name: 'Thrown', message: String(error) };
}

function emit(level: LogLevel, module: string, message: string, context?: LogContext): void {
  if (ORDER[level] < ORDER[minLevel]) return;

  const { error, ...rest } = context ?? {};
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    module,
    message,
    ...(Object.keys(rest).length === 0 ? {} : { context: rest }),
    ...(error === undefined ? {} : { error: toLoggedError(error) }),
  };

  for (const sink of sinks) {
    try {
      sink(record);
    } catch {
      // A broken sink must never take down the thing it was watching.
    }
  }
}

/** Re-emits a record that arrived from another context, tagged with where. */
export function ingest(record: LogRecord, origin: string): void {
  const tagged: LogRecord = { ...record, origin };
  for (const sink of sinks) {
    try {
      sink(tagged);
    } catch {
      /* see emit */
    }
  }
}

export function logger(module: string): Logger {
  return {
    debug: (message, context) => emit('debug', module, message, context),
    info: (message, context) => emit('info', module, message, context),
    warning: (message, context) => emit('warning', module, message, context),
    severe: (message, context) => emit('severe', module, message, context),
    child: (suffix) => logger(`${module}.${suffix}`),
  };
}
