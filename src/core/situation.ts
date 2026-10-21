import { DAY } from './confidence';
import type { ContextLog, Id, Situation, Task } from './types';

/** Below this many logged sessions, slack and scarcity fall back to defaults. */
export const MIN_LOGS = 10;
/** Context history window used for slack and scarcity. */
export const HISTORY_DAYS = 28;
/** A hard deadline with this many chances or fewer left goes before everything. */
export const OVERRIDE_CHANCES = 2;

export type Infeasible = 'blocked' | 'scheduled' | 'too_long' | 'context' | 'energy' | 'closed';

/** Why a task can't be done in this situation, or null if it can. */
export function infeasibility(t: Task, s: Situation, byId: Map<Id, Task>, now: number): Infeasible | null {
  if (t.status !== 'open') return 'closed';
  if (t.dependsOn.some((d) => byId.get(d)?.status === 'open')) return 'blocked';
  if (waitingOnOthers(t, now)) return 'scheduled';
  return fitReason(t, s);
}

function fitReason(t: Task, s: Situation): Infeasible | null {
  if (t.duration !== undefined && t.duration > s.minutes) return 'too_long';
  if (!t.contexts.every((c) => s.contexts.includes(c))) return 'context';
  if (t.energy === 'focused' && s.energy === 'tired') return 'energy';
  return null;
}

/** Arranged, and not yet due to have happened. A booking with no date waits until it's marked done. */
export function waitingOnOthers(t: Task, now: number): boolean {
  return !!t.delegated && t.scheduledAt !== undefined && (t.scheduledFor === undefined || t.scheduledFor > now);
}

/** Its booked date has passed, so the next step is checking it happened. */
export function needsFollowUp(t: Task, now: number): boolean {
  return !!t.delegated && t.scheduledFor !== undefined && t.scheduledFor <= now;
}

/** Could the task have been done in a past situation (ignoring dependencies)? */
export function fits(t: Task, s: Situation): boolean {
  return fitReason(t, s) === null;
}

function recentLogs(logs: ContextLog[], now: number): ContextLog[] {
  return logs.filter((l) => l.at <= now && now - l.at <= HISTORY_DAYS * DAY);
}

/** Expected chances per day to do this task, from context history. */
export function chancesPerDay(t: Task, logs: ContextLog[], now: number): number {
  const recent = recentLogs(logs, now);
  if (recent.length < MIN_LOGS) {
    // Cold start: roughly one chance a day for short tasks, fewer for long ones.
    return (t.duration ?? 15) <= 60 ? 1 : 0.3;
  }
  const oldest = Math.min(...recent.map((l) => l.at));
  const days = Math.max(1, (now - oldest) / DAY);
  return recent.filter((l) => fits(t, l)).length / days;
}

/** Chances left before a deadline. Infinity when there is none. */
export function slack(t: Task, logs: ContextLog[], now: number, hardOnly = false): number {
  const deadlines = hardOnly ? [t.due] : [t.due, t.softDue];
  const due = Math.min(...deadlines.map((d) => d ?? Infinity));
  if (due === Infinity) return Infinity;
  return (Math.max(0, due - now) / DAY) * chancesPerDay(t, logs, now);
}

/** Coarse urgency, so that tiny slack differences don't block dominance. */
export function urgencyLevel(chances: number): number {
  if (chances <= 2) return 3;
  if (chances <= 7) return 2;
  if (chances <= 21) return 1;
  return 0;
}

/** How rarely a chance to do this task comes up, from 0 (always) to 1 (never). */
export function scarcity(t: Task, logs: ContextLog[], now: number): number {
  const recent = recentLogs(logs, now);
  if (recent.length < MIN_LOGS) return 0;
  return 1 - recent.filter((l) => fits(t, l)).length / recent.length;
}

export function scarcityLevel(x: number): number {
  if (x < 0.5) return 0;
  if (x < 0.8) return 1;
  return 2;
}
