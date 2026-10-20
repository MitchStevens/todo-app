import { emptyData, type Data } from '../core/types';

export const DB_NAME = 'todo-app';
export const DB_VERSION = 1;

/** One object store per record type, each keyed by `id`. Plus `meta`, keyed by `key`. */
export const STORES = ['tasks', 'comparisons', 'tradeoffs', 'suggestions', 'contexts', 'contextLogs'] as const;
export type StoreName = (typeof STORES)[number];

export interface MetaRecord {
  key: string;
  value: unknown;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function openDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  const req = factory.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    for (const name of STORES) {
      if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
  };
  return request(req);
}

export async function loadAll(db: IDBDatabase): Promise<{ data: Data; meta: Map<string, unknown> }> {
  const tx = db.transaction([...STORES, 'meta'], 'readonly');
  const data = emptyData();
  const [records, metaRecords] = await Promise.all([
    Promise.all(STORES.map((name) => request(tx.objectStore(name).getAll()))),
    request(tx.objectStore('meta').getAll() as IDBRequest<MetaRecord[]>),
  ]);
  STORES.forEach((name, i) => {
    (data[name] as unknown[]) = records[i];
  });
  return { data, meta: new Map(metaRecords.map((m) => [m.key, m.value])) };
}

export async function put(db: IDBDatabase, store: StoreName | 'meta', value: object): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await done(tx);
}

/** Replace everything, in one transaction. Used by import. */
export async function replaceAll(db: IDBDatabase, data: Data): Promise<void> {
  const tx = db.transaction([...STORES], 'readwrite');
  for (const name of STORES) {
    const store = tx.objectStore(name);
    store.clear();
    for (const record of data[name]) store.put(record);
  }
  await done(tx);
}
