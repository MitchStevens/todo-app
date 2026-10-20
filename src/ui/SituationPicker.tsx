import { useState } from 'preact/hooks';
import { DURATIONS, type Id, type Situation } from '../core/types';
import type { Navigate } from './App';
import { formatDuration } from './format';
import { useRepo } from './hooks';
import { BackIcon } from './icons';

const DEFAULT_SITUATION: Situation = { minutes: 15, contexts: [], energy: 'sharp' };

/** Toggle chips for contexts, plus a box to add a new one. */
export function ContextChips({
  selected,
  onChange,
  only,
}: {
  selected: Id[];
  onChange: (ids: Id[]) => void;
  /** Restrict which contexts are offered. */
  only?: (id: Id) => boolean;
}) {
  const repo = useRepo();
  const [name, setName] = useState('');
  const contexts = [...repo.data.contexts]
    .filter((c) => !only || only(c.id) || selected.includes(c.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (id: Id) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  const add = (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return;
    const c = repo.addContext(name);
    if (!selected.includes(c.id)) onChange([...selected, c.id]);
    setName('');
  };
  return (
    <>
      <div class="chips">
        {contexts.map((c) => (
          <button key={c.id} type="button" class="chip" aria-pressed={selected.includes(c.id)} onClick={() => toggle(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      <form class="inline" onSubmit={add}>
        <input
          class="input"
          aria-label="New place or thing"
          placeholder="Add a place or thing (e.g. Printer)"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <button class="btn" type="submit">
          Add
        </button>
      </form>
    </>
  );
}

export function SituationPicker({ go }: { go: Navigate }) {
  const repo = useRepo();
  const [s, setS] = useState<Situation>(() => {
    const last = repo.getMeta<Situation>('lastSituation') ?? DEFAULT_SITUATION;
    // Drop contexts that no longer exist.
    return { ...last, contexts: last.contexts.filter((id) => repo.data.contexts.some((c) => c.id === id)) };
  });

  const start = () => {
    repo.logSituation(s);
    go({ name: 'session', situation: s });
  };

  return (
    <main class="screen">
      <div class="bar">
        <button class="icon-btn" aria-label="Back to tasks" onClick={() => go({ name: 'list' })}>
          <BackIcon />
        </button>
      </div>
      <h1>Right now…</h1>

      <div class="field">
        <span class="label">How long have you got?</span>
        <div class="chips">
          {DURATIONS.map((d) => (
            <button key={d} class="chip" aria-pressed={s.minutes === d} onClick={() => setS({ ...s, minutes: d })}>
              {formatDuration(d)}
            </button>
          ))}
        </div>
      </div>

      <div class="field">
        <span class="label">Where are you, and what do you have?</span>
        <ContextChips selected={s.contexts} onChange={(contexts) => setS({ ...s, contexts })} />
      </div>

      <div class="field">
        <span class="label">Energy</span>
        <div class="chips">
          <button class="chip" aria-pressed={s.energy === 'sharp'} onClick={() => setS({ ...s, energy: 'sharp' })}>
            Sharp
          </button>
          <button class="chip" aria-pressed={s.energy === 'tired'} onClick={() => setS({ ...s, energy: 'tired' })}>
            Tired
          </button>
        </div>
      </div>

      <div class="grow" />
      <button class="btn primary block" onClick={start}>
        Start
      </button>
    </main>
  );
}
