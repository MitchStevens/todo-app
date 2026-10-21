import { useState } from 'preact/hooks';
import type { Navigate } from './App';
import { taskMeta } from './format';
import { useRepo } from './hooks';
import { GearIcon, GraphIcon } from './icons';

export function TaskList({ go }: { go: Navigate }) {
  const repo = useRepo();
  const [title, setTitle] = useState('');
  const now = Date.now();
  const { tasks, contexts } = repo.data;
  const open = tasks.filter((t) => t.status === 'open').sort((a, b) => a.createdAt - b.createdAt);
  const done = tasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
    .slice(0, 20);
  const titleOf = (id: string) => repo.task(id)?.title ?? '?';

  const add = (e: Event) => {
    e.preventDefault();
    if (!title.trim()) return;
    repo.addTask(title);
    setTitle('');
  };

  return (
    <main class="screen">
      <div class="bar">
        <h1 class="grow">Tasks</h1>
        <button class="icon-btn" aria-label="Task graph" onClick={() => go({ name: 'graph' })}>
          <GraphIcon />
        </button>
        <button class="icon-btn" aria-label="Settings" onClick={() => go({ name: 'settings' })}>
          <GearIcon />
        </button>
      </div>

      <button class="btn primary block" disabled={open.length === 0} onClick={() => go({ name: 'situation' })}>
        What should I do?
      </button>

      <form class="inline" onSubmit={add}>
        <label class="grow">
          <span class="muted small" style="display:block;margin-bottom:6px">Add a task</span>
          <input
            class="input"
            value={title}
            placeholder="e.g. Book dentist check-up"
            onInput={(e) => setTitle(e.currentTarget.value)}
          />
        </label>
        <button class="btn" type="submit" style="align-self:flex-end">
          Add
        </button>
      </form>

      {open.length === 0 ? (
        <p class="muted">No open tasks. Add a few, then ask what to do.</p>
      ) : (
        <ul class="list">
          {open.map((t) => {
            const blockers = t.dependsOn.filter((d) => repo.task(d)?.status === 'open');
            return (
              <li key={t.id}>
                <button class="item" onClick={() => go({ name: 'edit', id: t.id })}>
                  <span>{t.title}</span>
                  <span class="sub">
                    {blockers.length > 0 ? `Waiting on ${blockers.map(titleOf).join(', ')} · ` : ''}
                    {taskMeta(t, contexts, now)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {done.length > 0 && (
        <details>
          <summary class="muted small" style="min-height:44px;display:flex;align-items:center;cursor:pointer">
            Recently done ({done.length})
          </summary>
          <ul class="list">
            {done.map((t) => (
              <li key={t.id}>
                <button class="item" onClick={() => go({ name: 'edit', id: t.id })}>
                  <span style="text-decoration:line-through">{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
