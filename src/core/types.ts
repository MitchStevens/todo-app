export type Id = string;

export type TaskStatus = 'open' | 'done' | 'dropped';

/** What a task needs from you. A `focused` task is infeasible while tired. */
export type Energy = 'focused' | 'any';

/** Duration buckets, in minutes. */
export const DURATIONS = [5, 15, 30, 60, 120, 240] as const;

export interface Task {
  id: Id;
  title: string;
  notes: string;
  createdAt: number;
  editedAt: number;
  /** Hard deadline (epoch ms). Only this can trigger the deadline override. */
  due?: number;
  /** "Would it be bad if it slipped past X?" Counts towards urgency only. */
  softDue?: number;
  /** Estimated minutes. Unknown durations are treated as fitting any gap. */
  duration?: number;
  /** Context ids the task needs, all at once. Empty means anywhere. */
  contexts: Id[];
  energy: Energy;
  /** Tasks that must be done before this one. Always a DAG. */
  dependsOn: Id[];
  status: TaskStatus;
  closedAt?: number;
  /** Comparisons involving this task from before this time are ignored. */
  resetAt?: number;
}

export type ComparisonKind = 'initial' | 'check' | 'challenge';

/** One "which matters more?" answer. Append-only evidence. */
export interface Comparison {
  id: Id;
  a: Id;
  b: Id;
  result: 'a' | 'b' | 'incomparable';
  at: number;
  latencyMs: number;
  kind: ComparisonKind;
  contexts: Id[];
}

/** One "right now: which first?" answer, or a behavioral equivalent. */
export interface Tradeoff {
  id: Id;
  chosen: Id;
  other: Id;
  at: number;
  /** Feature differences (chosen − other) at the time of asking. */
  features: number[];
  source: 'question' | 'behavior';
}

export type Outcome = 'done' | 'skipped' | 'cant' | 'did_other';

export interface Suggestion {
  id: Id;
  task: Id;
  at: number;
  outcome: Outcome;
  reason?: string;
  other?: Id;
}

/** A place, tool or circumstance a task can require (Home, Car, Computer…). */
export interface Context {
  id: Id;
  name: string;
}

/** The user's situation when they ask what to do. */
export interface Situation {
  minutes: number;
  contexts: Id[];
  energy: 'sharp' | 'tired';
}

/** A record of one session's situation, used for slack and scarcity. */
export interface ContextLog extends Situation {
  id: Id;
  at: number;
}

export interface Data {
  tasks: Task[];
  comparisons: Comparison[];
  tradeoffs: Tradeoff[];
  suggestions: Suggestion[];
  contexts: Context[];
  contextLogs: ContextLog[];
}

export function emptyData(): Data {
  return { tasks: [], comparisons: [], tradeoffs: [], suggestions: [], contexts: [], contextLogs: [] };
}
