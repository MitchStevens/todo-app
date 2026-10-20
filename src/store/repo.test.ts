import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXTS, Repo } from './repo';

describe('Repo', () => {
  it('persists across reopening', async () => {
    const factory = new IDBFactory();
    const repo = await Repo.open(factory);
    const a = repo.addTask('Renew passport');
    const b = repo.addTask('Find birth certificate');
    expect(repo.addDependency(a.id, b.id)).toBe(true);
    repo.addComparison({ a: a.id, b: b.id, result: 'a', latencyMs: 1200, kind: 'initial', contexts: [] });
    repo.logSituation({ minutes: 15, contexts: [], energy: 'sharp' });
    await repo.saved();

    const reopened = await Repo.open(factory);
    expect(reopened.data.tasks.map((t) => t.title).sort()).toEqual(['Find birth certificate', 'Renew passport']);
    expect(reopened.task(a.id)?.dependsOn).toEqual([b.id]);
    expect(reopened.data.comparisons).toHaveLength(1);
    expect(reopened.data.contexts.map((c) => c.name).sort()).toEqual([...DEFAULT_CONTEXTS].sort());
    expect(reopened.getMeta('lastSituation')).toEqual({ minutes: 15, contexts: [], energy: 'sharp' });
  });

  it('rejects a dependency cycle', async () => {
    const repo = await Repo.open(new IDBFactory());
    const a = repo.addTask('a');
    const b = repo.addTask('b');
    expect(repo.addDependency(a.id, b.id)).toBe(true);
    expect(repo.addDependency(b.id, a.id)).toBe(false);
    expect(repo.task(b.id)?.dependsOn).toEqual([]);
  });

  it('round-trips a backup into a fresh database', async () => {
    const source = await Repo.open(new IDBFactory());
    source.addTask('Book dentist');
    const backup = source.exportJson();

    const factory = new IDBFactory();
    const target = await Repo.open(factory);
    target.addTask('will be replaced');
    await target.importJson(backup);
    expect(target.data.tasks.map((t) => t.title)).toEqual(['Book dentist']);

    const reopened = await Repo.open(factory);
    expect(reopened.data.tasks.map((t) => t.title)).toEqual(['Book dentist']);
    await expect(target.importJson('{"version": 99}')).rejects.toThrow();
  });
});
