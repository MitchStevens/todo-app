import { wouldCreateDependencyCycle } from '../core/graph';
import type {
  Comparison,
  Context,
  Data,
  Id,
  Situation,
  Suggestion,
  Task,
  TaskStatus,
  Tradeoff,
} from '../core/types';
import { loadAll, openDb, put, replaceAll, STORES, type StoreName } from './db';

export const DEFAULT_CONTEXTS = ['Home', 'Work', 'Out', 'Computer', 'Phone', 'Car'];
export const EXPORT_VERSION = 1;

const newId = () => crypto.randomUUID();

/**
 * All app data, held in memory and written through to IndexedDB.
 *
 * Reads are synchronous from `data`. Every change updates memory first,
 * notifies subscribers, then persists in the background; `saved()` resolves
 * once every write so far has landed.
 */
export class Repo {
  private listeners = new Set<() => void>();
  private pending: Promise<void> = Promise.resolve();
  /** The last write error, if any. Shown in Settings. */
  lastError: string | null = null;

  private constructor(
    private db: IDBDatabase,
    public data: Data,
    private meta: Map<string, unknown>,
    private now: () => number,
  ) {}

  static async open(factory?: IDBFactory, now: () => number = Date.now): Promise<Repo> {
    const db = await openDb(factory);
    const { data, meta } = await loadAll(db);
    const repo = new Repo(db, data, meta, now);
    if (!meta.get('seeded')) {
      for (const name of DEFAULT_CONTEXTS) repo.addContext(name);
      repo.setMeta('seeded', true);
    }
    return repo;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  saved(): Promise<void> {
    return this.pending;
  }

  task(id: Id): Task | undefined {
    return this.data.tasks.find((t) => t.id === id);
  }

  getMeta<T>(key: string): T | undefined {
    return this.meta.get(key) as T | undefined;
  }

  setMeta(key: string, value: unknown): void {
    this.meta.set(key, value);
    this.persist('meta', { key, value });
    this.notify();
  }

  // Tasks

  addTask(title: string, extra: Partial<Task> = {}): Task {
    const now = this.now();
    const t: Task = {
      id: newId(),
      title: title.trim(),
      notes: '',
      createdAt: now,
      editedAt: now,
      contexts: [],
      energy: 'any',
      dependsOn: [],
      status: 'open',
      ...extra,
    };
    return this.save('tasks', t);
  }

  updateTask(id: Id, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): Task {
    const t = this.task(id);
    if (!t) throw new Error(`No task ${id}`);
    return this.save('tasks', { ...t, ...patch, editedAt: this.now() });
  }

  setStatus(id: Id, status: TaskStatus): Task {
    return this.updateTask(id, { status, closedAt: status === 'open' ? undefined : this.now() });
  }

  /** Returns false (and changes nothing) if the dependency would create a cycle. */
  addDependency(task: Id, blocker: Id): boolean {
    const t = this.task(task);
    if (!t || t.dependsOn.includes(blocker)) return !!t;
    if (wouldCreateDependencyCycle(this.data.tasks, task, blocker)) return false;
    this.updateTask(task, { dependsOn: [...t.dependsOn, blocker] });
    return true;
  }

  removeDependency(task: Id, blocker: Id): void {
    const t = this.task(task);
    if (t) this.updateTask(task, { dependsOn: t.dependsOn.filter((d) => d !== blocker) });
  }

  // Evidence (append-only)

  addComparison(c: Omit<Comparison, 'id' | 'at'>): Comparison {
    return this.save('comparisons', { ...c, id: newId(), at: this.now() });
  }

  addTradeoff(t: Omit<Tradeoff, 'id' | 'at'>): Tradeoff {
    return this.save('tradeoffs', { ...t, id: newId(), at: this.now() });
  }

  addSuggestion(s: Omit<Suggestion, 'id' | 'at'>): Suggestion {
    return this.save('suggestions', { ...s, id: newId(), at: this.now() });
  }

  // Contexts

  addContext(name: string): Context {
    const existing = this.data.contexts.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) return existing;
    return this.save('contexts', { id: newId(), name: name.trim() });
  }

  /** Record the situation of a session, for slack and scarcity, and remember it. */
  logSituation(s: Situation): void {
    this.save('contextLogs', { ...s, id: newId(), at: this.now() });
    this.setMeta('lastSituation', s);
  }

  // Backup

  exportJson(): string {
    return JSON.stringify({ version: EXPORT_VERSION, exportedAt: this.now(), data: this.data }, null, 2);
  }

  async importJson(text: string): Promise<void> {
    const parsed = JSON.parse(text) as { version?: number; data?: Partial<Data> };
    if (parsed.version !== EXPORT_VERSION || !parsed.data) throw new Error('Not a backup from this app');
    const data = {} as Data;
    for (const name of STORES) {
      const list = parsed.data[name];
      if (!Array.isArray(list)) throw new Error(`Backup is missing ${name}`);
      (data[name] as unknown[]) = list;
    }
    await this.pending;
    await replaceAll(this.db, data);
    this.data = data;
    this.notify();
  }

  private save<K extends StoreName>(store: K, record: Data[K][number]): Data[K][number] {
    const list = this.data[store] as Data[K][number][];
    const i = list.findIndex((r) => r.id === record.id);
    // Replace the array so derived state recomputes.
    const next = [...list];
    if (i >= 0) next[i] = record;
    else next.push(record);
    this.data = { ...this.data, [store]: next };
    this.persist(store, record);
    this.notify();
    return record;
  }

  private persist(store: StoreName | 'meta', record: object): void {
    this.pending = this.pending
      .then(() => put(this.db, store, record))
      .catch((e: unknown) => {
        this.lastError = e instanceof Error ? e.message : String(e);
        console.error('Failed to save', store, e);
      });
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
