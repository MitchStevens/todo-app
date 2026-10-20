import { useState } from 'preact/hooks';
import { wouldCreateDependencyCycle } from '../core/graph';
import { DURATIONS, type Id, type Task } from '../core/types';
import type { Navigate } from './App';
import { formatDuration, fromDateInput, toDateInput } from './format';
import { useRepo } from './hooks';
import { BackIcon } from './icons';
import { ContextChips } from './SituationPicker';

export function TaskEdit({ id, go }: { id: Id; go: Navigate }) {
  const repo = useRepo();
  const [error, setError] = useState<string | null>(null);
  const t = repo.task(id);
  if (!t) {
    return (
      <main class="screen">
        <p>That task no longer exists.</p>
        <button class="btn" onClick={() => go({ name: 'list' })}>
          Back to tasks
        </button>
      </main>
    );
  }

  const update = (patch: Partial<Task>) => repo.updateTask(id, patch);
  const others = repo.data.tasks.filter((o) => o.id !== id && o.status === 'open' && !t.dependsOn.includes(o.id));

  const addBlocker = (blocker: Id) => {
    if (!blocker) return;
    setError(repo.addDependency(id, blocker) ? null : "That would make the two tasks wait on each other.");
  };

  return (
    <main class="screen">
      <div class="bar">
        <button class="icon-btn" aria-label="Back to tasks" onClick={() => go({ name: 'list' })}>
          <BackIcon />
        </button>
        {t.status !== 'open' && <span class="muted small">{t.status === 'done' ? 'Done' : 'Dropped'}</span>}
      </div>

      <div class="field">
        <label for="title">Task</label>
        <input id="title" class="input" value={t.title} onChange={(e) => update({ title: e.currentTarget.value })} />
      </div>

      <div class="field">
        <label for="notes">Notes</label>
        <textarea id="notes" class="input" value={t.notes} onChange={(e) => update({ notes: e.currentTarget.value })} />
      </div>

      <div class="row2">
        <div class="field">
          <label for="due">Due (hard deadline)</label>
          <input
            id="due"
            type="date"
            class="input"
            value={toDateInput(t.due)}
            onChange={(e) => update({ due: fromDateInput(e.currentTarget.value) })}
          />
        </div>
        <div class="field">
          <label for="soft">Ideally by</label>
          <input
            id="soft"
            type="date"
            class="input"
            value={toDateInput(t.softDue)}
            onChange={(e) => update({ softDue: fromDateInput(e.currentTarget.value) })}
          />
        </div>
      </div>

      <div class="field">
        <span class="label">How long does it take?</span>
        <div class="chips">
          <button class="chip" aria-pressed={t.duration === undefined} onClick={() => update({ duration: undefined })}>
            Not sure
          </button>
          {DURATIONS.map((d) => (
            <button key={d} class="chip" aria-pressed={t.duration === d} onClick={() => update({ duration: d })}>
              {formatDuration(d)}
            </button>
          ))}
        </div>
      </div>

      <div class="field">
        <span class="label">Needs (all of these)</span>
        <ContextChips selected={t.contexts} onChange={(contexts) => update({ contexts })} />
        <span class="muted small">Nothing selected means it can be done anywhere.</span>
      </div>

      <div class="field">
        <span class="label">Energy</span>
        <div class="chips">
          <button class="chip" aria-pressed={t.energy === 'any'} onClick={() => update({ energy: 'any' })}>
            Fine when tired
          </button>
          <button class="chip" aria-pressed={t.energy === 'focused'} onClick={() => update({ energy: 'focused' })}>
            Needs focus
          </button>
        </div>
      </div>

      <div class="field">
        <span class="label">Has to wait for</span>
        {t.dependsOn.length > 0 && (
          <ul class="list">
            {t.dependsOn.map((d) => {
              const blocker = repo.task(d);
              return (
                <li key={d} class="inline" style="align-items:center">
                  <span class="grow">
                    {blocker?.title ?? 'Deleted task'}
                    {blocker && blocker.status !== 'open' ? <span class="muted small"> (done)</span> : null}
                  </span>
                  <button class="btn" onClick={() => repo.removeDependency(id, d)}>
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <select
          class="input"
          aria-label="Add a task this has to wait for"
          value=""
          onChange={(e) => addBlocker(e.currentTarget.value)}
        >
          <option value="">Add a task it waits for…</option>
          {others
            .filter((o) => !wouldCreateDependencyCycle(repo.data.tasks, id, o.id))
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
        </select>
        {error && <span class="error">{error}</span>}
      </div>

      <div class="grow" />

      {t.status === 'open' ? (
        <>
          <button class="btn primary block" onClick={() => (repo.setStatus(id, 'done'), go({ name: 'list' }))}>
            Mark done
          </button>
          <div class="row2">
            <button class="btn" onClick={() => update({ resetAt: Date.now() })}>
              Re-rank from scratch
            </button>
            <button class="btn" onClick={() => (repo.setStatus(id, 'dropped'), go({ name: 'list' }))}>
              Drop task
            </button>
          </div>
        </>
      ) : (
        <button class="btn block" onClick={() => repo.setStatus(id, 'open')}>
          Reopen
        </button>
      )}
    </main>
  );
}
