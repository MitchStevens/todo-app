import { DAY } from '../core/confidence';
import type { Reason } from '../core/engine';
import type { Context, Id, Situation, Task } from '../core/types';

export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  if (min === 240) return 'Half day';
  return `${min / 60} h`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatDue(ms: number, now: number): string {
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / DAY);
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return new Date(ms).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatAge(ms: number, now: number): string {
  const days = Math.floor((now - ms) / DAY);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export function contextNames(ids: Id[], contexts: Context[]): string[] {
  return ids.map((id) => contexts.find((c) => c.id === id)?.name ?? '?');
}

/** "Due Fri · 15 min · Home", the one-line summary used everywhere. */
export function taskMeta(t: Task, contexts: Context[], now: number): string {
  const parts: string[] = [];
  const due = Math.min(t.due ?? Infinity, t.softDue ?? Infinity);
  if (due !== Infinity) parts.push(`${t.due === due ? 'Due' : 'Ideally by'} ${formatDue(due, now)}`);
  if (t.duration !== undefined) parts.push(`~${formatDuration(t.duration)}`);
  const where = contextNames(t.contexts, contexts);
  parts.push(where.length ? where.join(', ') : 'Anywhere');
  if (t.energy === 'focused') parts.push('Needs focus');
  return parts.join(' · ');
}

export function situationText(s: Situation, contexts: Context[]): string {
  const where = contextNames(s.contexts, contexts);
  return [`~${formatDuration(s.minutes)}`, ...(where.length ? [where.join(', ')] : []), s.energy === 'tired' ? 'Tired' : null]
    .filter(Boolean)
    .join(' · ');
}

export function reasonText(r: Reason, now: number): string {
  switch (r.type) {
    case 'deadline': {
      const chances = Math.max(0, Math.round(r.chances));
      return `Due ${formatDue(r.due, now)}, and you have ${chances <= 1 ? 'about one chance' : `about ${chances} chances`} left`;
    }
    case 'blocks':
      return `Blocks ${r.titles.map((t) => `“${t}”`).join(', ')}`;
    case 'due':
      return `Due ${formatDue(r.due, now)}`;
    case 'above':
      return `You said it matters more than ${r.count} other ${r.count === 1 ? 'task' : 'tasks'}`;
    case 'scarce':
      return "You don't often get a chance to do this";
    case 'top':
      return 'Nothing you can do right now is known to matter more';
  }
}

/** `<input type="date">` value for a timestamp, in local time. */
export function toDateInput(ms: number | undefined): string {
  if (ms === undefined) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A date input's value as the end of that local day, or undefined if empty. */
export function fromDateInput(value: string): number | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59).getTime();
}
