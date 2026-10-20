import type { Comparison, Id, Task } from './types';

export const DAY = 86_400_000;

/** Confidence halves after this many days with nothing else happening. */
export const TIME_HALF_LIFE_DAYS = 60;
/** Each task added, closed or edited since an answer multiplies its confidence by this. */
export const EVENT_DECAY = 0.97;
/** Extra factor when one of the two compared tasks was itself edited since the answer. */
export const NEARBY_EDIT_FACTOR = 0.8;

/** Fast answers are trusted fully; slow ones (close calls) less. */
export function latencyFactor(ms: number): number {
  if (ms <= 3000) return 1;
  if (ms >= 10000) return 0.6;
  return 1 - (0.4 * (ms - 3000)) / 7000;
}

/** Sorted timestamps of every task change, for counting events since a time. */
export function eventTimes(tasks: Task[]): number[] {
  const times: number[] = [];
  for (const t of tasks) {
    times.push(t.createdAt);
    if (t.closedAt !== undefined) times.push(t.closedAt);
    if (t.editedAt > t.createdAt) times.push(t.editedAt);
  }
  return times.sort((x, y) => x - y);
}

export function countAfter(sorted: number[], t: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return sorted.length - lo;
}

export function pairKey(a: Id, b: Id): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * How often each task's answers get overturned by a later answer on the same
 * pair, from 0 (never) to 1 (always).
 */
export function volatility(comparisons: Comparison[]): Map<Id, number> {
  const byPair = new Map<string, Comparison[]>();
  for (const c of comparisons) {
    if (c.result === 'incomparable') continue;
    const k = pairKey(c.a, c.b);
    const list = byPair.get(k);
    if (list) list.push(c);
    else byPair.set(k, [c]);
  }
  const total = new Map<Id, number>();
  const overturned = new Map<Id, number>();
  const bump = (m: Map<Id, number>, id: Id) => m.set(id, (m.get(id) ?? 0) + 1);
  for (const list of byPair.values()) {
    list.sort((x, y) => x.at - y.at);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      bump(total, c.a);
      bump(total, c.b);
      const next = list[i + 1];
      if (next && winner(next) !== winner(c)) {
        bump(overturned, c.a);
        bump(overturned, c.b);
      }
    }
  }
  const out = new Map<Id, number>();
  for (const [id, n] of total) out.set(id, (overturned.get(id) ?? 0) / n);
  return out;
}

export function winner(c: Comparison): Id | undefined {
  if (c.result === 'a') return c.a;
  if (c.result === 'b') return c.b;
  return undefined;
}

export interface ConfidenceInputs {
  now: number;
  events: number[];
  tasks: Map<Id, Task>;
  volatility: Map<Id, number>;
}

/** Current confidence in one stored answer, from 0 to 1. */
export function confidence(c: Comparison, inp: ConfidenceInputs): number {
  const ta = inp.tasks.get(c.a);
  const tb = inp.tasks.get(c.b);
  if (!ta || !tb) return 0;
  if ((ta.resetAt ?? -Infinity) > c.at || (tb.resetAt ?? -Infinity) > c.at) return 0;

  const days = Math.max(0, inp.now - c.at) / DAY;
  let conf = latencyFactor(c.latencyMs);
  conf *= Math.pow(0.5, days / TIME_HALF_LIFE_DAYS);
  conf *= Math.pow(EVENT_DECAY, countAfter(inp.events, c.at));
  if (ta.editedAt > c.at || tb.editedAt > c.at) conf *= NEARBY_EDIT_FACTOR;
  const v = Math.max(inp.volatility.get(c.a) ?? 0, inp.volatility.get(c.b) ?? 0);
  conf *= 1 - 0.5 * v;
  return conf;
}
