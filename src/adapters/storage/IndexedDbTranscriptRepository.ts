import type { TranscriptRepository } from '@/core/ports/TranscriptRepository';
import type { MeetingSession } from '@/core/types/session';
import type { TranscriptSegment } from '@/core/types/transcript';

export const DB_NAME = 'saar';
export const DB_VERSION = 1;

/**
 * Segments are keyed by the compound `[sessionId, segId]` so `put()` gives
 * upsert semantics for free — re-writing a revised caption block overwrites its
 * row instead of duplicating it.
 */
interface SegmentRow extends TranscriptSegment {
  readonly sessionId: string;
  readonly segId: string;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function awaitTx(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export class IndexedDbTranscriptRepository implements TranscriptRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly dbName: string = DB_NAME) {}

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sessions')) {
          const s = db.createObjectStore('sessions', { keyPath: 'id' });
          s.createIndex('startedAt', 'startedAt');
        }
        if (!db.objectStoreNames.contains('segments')) {
          const g = db.createObjectStore('segments', { keyPath: ['sessionId', 'segId'] });
          g.createIndex('sessionId', 'sessionId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  private async store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.db();
    return db.transaction(name, mode).objectStore(name);
  }

  async createSession(session: MeetingSession): Promise<void> {
    await promisify((await this.store('sessions', 'readwrite')).put(session));
  }

  async updateSession(id: string, patch: Partial<MeetingSession>): Promise<void> {
    const store = await this.store('sessions', 'readwrite');
    const current = await promisify<MeetingSession | undefined>(store.get(id));
    if (!current) return;
    await promisify(store.put({ ...current, ...patch, id }));
  }

  async getSession(id: string): Promise<MeetingSession | null> {
    const store = await this.store('sessions', 'readonly');
    return (await promisify<MeetingSession | undefined>(store.get(id))) ?? null;
  }

  async listSessions(): Promise<readonly MeetingSession[]> {
    const store = await this.store('sessions', 'readonly');
    const all = await promisify<MeetingSession[]>(store.getAll());
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }

  async deleteSession(id: string): Promise<void> {
    const db = await this.db();
    const t = db.transaction(['sessions', 'segments'], 'readwrite');
    const segments = t.objectStore('segments');
    const keys = await promisify<IDBValidKey[]>(
      segments.index('sessionId').getAllKeys(IDBKeyRange.only(id)),
    );
    t.objectStore('sessions').delete(id);
    for (const k of keys) segments.delete(k);
    await awaitTx(t);
  }

  async appendSegments(id: string, segments: readonly TranscriptSegment[]): Promise<void> {
    if (segments.length === 0) return;
    const db = await this.db();
    const t = db.transaction('segments', 'readwrite');
    const store = t.objectStore('segments');
    for (const s of segments) {
      const row: SegmentRow = { ...s, sessionId: id, segId: s.id };
      store.put(row);
    }
    await awaitTx(t);
  }

  async getSegments(id: string): Promise<readonly TranscriptSegment[]> {
    const store = await this.store('segments', 'readonly');
    const rows = await promisify<SegmentRow[]>(
      store.index('sessionId').getAll(IDBKeyRange.only(id)),
    );
    return rows
      .sort((a, b) => a.tStart - b.tStart)
      .map(({ sessionId: _sessionId, segId: _segId, ...segment }) => segment);
  }
}
