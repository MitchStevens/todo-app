import { pairKey } from './confidence';
import { buildBelief, type Belief } from './graph';
import {
  OVERRIDE_CHANCES,
  infeasibility,
  scarcity,
  scarcityLevel,
  slack,
  urgencyLevel,
} from './situation';
import { autoResolve, MIN_SAMPLES, predict, toVector, train, type Weights } from './tradeoff';
import type { ComparisonKind, Data, Id, Situation, Task } from './types';

/** Importance edges below this confidence are worth challenging. */
export const CHALLENGE_BELOW = 0.5;
/** At most this many check or challenge questions per session. */
export const MAX_CHECKS = 2;
export const SESSION_BUDGET_MS = 30_000;
export const FOLLOW_UP_BUDGET_MS = 15_000;

export interface Scored {
  task: Task;
  slack: number;
  hardSlack: number;
  urgency: number;
  scarcity: number;
}

/** Everything derived for one situation. Rebuilt after every answer. */
export interface Plan {
  now: number;
  situation: Situation;
  byId: Map<Id, Task>;
  belief: Belief;
  scored: Map<Id, Scored>;
  /** Open, unblocked tasks that fit the situation. */
  feasible: Task[];
  weights: Weights;
  tradeoffSamples: number;
  skips: Map<Id, number>;
}

export function buildPlan(data: Data, situation: Situation, now: number): Plan {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const belief = buildBelief(
    data.tasks.filter((t) => t.status !== 'dropped'),
    data.comparisons,
    now,
  );
  const feasible = data.tasks.filter((t) => infeasibility(t, situation, byId, now) === null);
  const scored = new Map<Id, Scored>();
  for (const t of feasible) {
    const s = slack(t, data.contextLogs, now);
    scored.set(t.id, {
      task: t,
      slack: s,
      hardSlack: slack(t, data.contextLogs, now, true),
      urgency: urgencyLevel(s),
      scarcity: scarcityLevel(scarcity(t, data.contextLogs, now)),
    });
  }
  const skips = new Map<Id, number>();
  for (const s of data.suggestions) {
    if (s.outcome === 'skipped') skips.set(s.task, (skips.get(s.task) ?? 0) + 1);
  }
  return {
    now,
    situation,
    byId,
    belief,
    scored,
    feasible,
    weights: train(data.tradeoffs),
    tradeoffSamples: data.tradeoffs.length,
    skips,
  };
}

/** State for one "what should I do?" session. Lives only in memory. */
export interface Session {
  startedAt: number;
  budgetMs: number;
  stopRequested: boolean;
  /** Tasks out of the running for this session: skipped, or lost a "which first?". */
  excluded: Set<Id>;
  /** Wins this session, so pairs form a balanced bracket. */
  wins: Map<Id, number>;
  /** Questions already asked or skipped this session, keyed by `askedKey`. */
  askedPairs: Set<string>;
  asked: number;
  checksAsked: number;
}

export function newSession(now: number, budgetMs = SESSION_BUDGET_MS): Session {
  return {
    startedAt: now,
    budgetMs,
    stopRequested: false,
    excluded: new Set(),
    wins: new Map(),
    askedPairs: new Set(),
    asked: 0,
    checksAsked: 0,
  };
}

/** After acting on a suggestion: same session, short fresh time budget. */
export function continueSession(s: Session, now: number): void {
  s.startedAt = now;
  s.budgetMs = FOLLOW_UP_BUDGET_MS;
  s.stopRequested = false;
}

export type Question =
  | { type: 'importance'; a: Id; b: Id; kind: ComparisonKind }
  /** `features` are A − B, stored with the answer to train the trade-off model. */
  | { type: 'tradeoff'; a: Id; b: Id; features: number[] };

export type Reason =
  | { type: 'deadline'; due: number; chances: number }
  | { type: 'blocks'; titles: string[] }
  | { type: 'due'; due: number }
  | { type: 'above'; count: number }
  | { type: 'scarce' }
  | { type: 'top' };

export type Step =
  | { type: 'question'; question: Question; candidates: Id[] }
  | { type: 'suggest'; task: Id; reasons: Reason[]; override: boolean }
  | { type: 'empty' };

export function features(plan: Plan, a: Id, b: Id): number[] {
  const sa = plan.scored.get(a);
  const sb = plan.scored.get(b);
  return toVector({
    importance: plan.belief.above(a, b) ? 1 : plan.belief.above(b, a) ? -1 : 0,
    urgency: (sa?.urgency ?? 0) - (sb?.urgency ?? 0),
    scarcity: (sa?.scarcity ?? 0) - (sb?.scarcity ?? 0),
  });
}

/** A beats B on every dimension: more important, and at least as urgent and scarce. */
export function dominates(plan: Plan, a: Id, b: Id): boolean {
  const sa = plan.scored.get(a);
  const sb = plan.scored.get(b);
  if (!sa || !sb) return false;
  return plan.belief.above(a, b) && sa.urgency >= sb.urgency && sa.scarcity >= sb.scarcity;
}

/** The Pareto front: feasible tasks nothing else beats on every dimension. */
export function candidates(plan: Plan, active: Id[]): Id[] {
  return active.filter((b) => !active.some((a) => a !== b && dominates(plan, a, b)));
}

/**
 * Decide what happens next: a question, or a suggestion.
 * May settle "which first?" pairs itself when the trade-off model is confident,
 * which updates `session`.
 */
export function nextStep(plan: Plan, session: Session, now: number): Step {
  const active = plan.feasible.map((t) => t.id).filter((id) => !session.excluded.has(id));
  if (active.length === 0) return { type: 'empty' };

  // Layer 2: a deadline that is about to be missed goes first.
  const overrides = active
    .map((id) => plan.scored.get(id)!)
    .filter((s) => s.task.due !== undefined && s.hardSlack <= OVERRIDE_CHANCES)
    .sort((x, y) => x.task.due! - y.task.due!);
  if (overrides.length > 0) {
    const s = overrides[0];
    return {
      type: 'suggest',
      task: s.task.id,
      override: true,
      reasons: [{ type: 'deadline', due: s.task.due!, chances: s.hardSlack }, ...reasons(plan, s.task.id, true)],
    };
  }

  const timeUp = session.stopRequested || now - session.startedAt >= session.budgetMs;
  for (;;) {
    const cands = candidates(plan, active.filter((id) => !session.excluded.has(id)));
    if (cands.length === 1 || timeUp) return suggest(plan, cands);

    const check = findCheck(plan, session, new Set(cands));
    if (check) return { type: 'question', question: check, candidates: cands };

    const pair = bracketPair(plan, session, cands);
    if (!pair) return suggest(plan, cands);
    const [a, b] = pair;

    if (needsImportance(plan, a, b)) {
      return { type: 'question', question: { type: 'importance', a, b, kind: 'initial' }, candidates: cands };
    }

    // Importance alone doesn't settle it: the dimensions conflict.
    const diff = features(plan, a, b);
    const auto = autoResolve(plan.weights, plan.tradeoffSamples, diff);
    if (auto === null) {
      return { type: 'question', question: { type: 'tradeoff', a, b, features: diff }, candidates: cands };
    }
    recordWin(session, auto === 'a' ? a : b, auto === 'a' ? b : a);
  }
}

/** Importance questions and "which first?" questions are tracked separately. */
export function askedKey(type: Question['type'], a: Id, b: Id): string {
  return `${type}:${pairKey(a, b)}`;
}

/** The pair's order is unknown, and the user hasn't said they can't compare them. */
function needsImportance(plan: Plan, a: Id, b: Id): boolean {
  return !plan.belief.comparable(a, b) && !plan.belief.incomparable.has(pairKey(a, b));
}

/** Mark a session-scoped win (a "which first?" answer, given or inferred). */
export function recordWin(session: Session, winner: Id, loser: Id): void {
  session.excluded.add(loser);
  session.wins.set(winner, (session.wins.get(winner) ?? 0) + 1);
  session.askedPairs.add(askedKey('tradeoff', winner, loser));
}

/** Book-keeping after any question is answered or skipped. */
export function recordAsked(session: Session, q: Question, winner?: Id): void {
  session.asked++;
  session.askedPairs.add(askedKey(q.type, q.a, q.b));
  if (q.type === 'importance' && q.kind !== 'initial') session.checksAsked++;
  if (winner) session.wins.set(winner, (session.wins.get(winner) ?? 0) + 1);
}

function findCheck(plan: Plan, session: Session, cands: Set<Id>): Question | null {
  if (session.checksAsked >= MAX_CHECKS || session.asked % 3 !== 2) return null;
  const open = (id: Id) => plan.byId.get(id)?.status === 'open';
  const fresh = (a: Id, b: Id) => !session.askedPairs.has(askedKey('importance', a, b));

  // Contradicted answers first, where they touch a current candidate.
  for (const e of plan.belief.conflicts) {
    if ((cands.has(e.from) || cands.has(e.to)) && open(e.from) && open(e.to) && fresh(e.from, e.to)) {
      return { type: 'importance', a: e.from, b: e.to, kind: 'check' };
    }
  }
  // Then weak answers that bury a task you could be doing now.
  const feasible = new Set(plan.feasible.map((t) => t.id));
  const weak = plan.belief.edges
    .filter((e) => e.source === 'importance' && e.confidence < CHALLENGE_BELOW)
    .filter((e) => feasible.has(e.to) && !session.excluded.has(e.to) && open(e.from) && fresh(e.from, e.to))
    .sort((x, y) => x.confidence - y.confidence);
  if (weak.length > 0) return { type: 'importance', a: weak[0].from, b: weak[0].to, kind: 'challenge' };
  return null;
}

/** Pair candidates with equal session wins first, like rounds of a bracket. */
function bracketPair(plan: Plan, session: Session, cands: Id[]): [Id, Id] | null {
  const wins = (id: Id) => session.wins.get(id) ?? 0;
  const ordered = [...cands].sort(
    (x, y) => wins(x) - wins(y) || plan.byId.get(x)!.createdAt - plan.byId.get(y)!.createdAt,
  );
  let best: [Id, Id] | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      const type = needsImportance(plan, a, b) ? 'importance' : 'tradeoff';
      if (session.askedPairs.has(askedKey(type, a, b))) continue;
      const score = Math.abs(wins(a) - wins(b)) * 1e6 + (wins(a) + wins(b)) * 1e3 + i + j;
      if (score < bestScore) {
        bestScore = score;
        best = [a, b];
      }
    }
  }
  return best;
}

function suggest(plan: Plan, cands: Id[]): Step {
  const pick = rank(plan, cands)[0];
  return { type: 'suggest', task: pick, override: false, reasons: reasons(plan, pick, false) };
}

/** Order remaining candidates when questions run out. */
export function rank(plan: Plan, cands: Id[]): Id[] {
  const trained = plan.tradeoffSamples >= MIN_SAMPLES;
  const modelScore = (id: Id) =>
    trained ? cands.reduce((s, o) => (o === id ? s : s + predict(plan.weights, features(plan, id, o))), 0) : 0;
  const key = (id: Id) => {
    const s = plan.scored.get(id)!;
    return [-modelScore(id), -s.urgency, -s.scarcity, plan.skips.get(id) ?? 0, s.task.createdAt];
  };
  return [...cands].sort((x, y) => {
    const kx = key(x);
    const ky = key(y);
    for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return kx[i] - ky[i];
    return 0;
  });
}

export function reasons(plan: Plan, id: Id, override: boolean): Reason[] {
  const t = plan.byId.get(id)!;
  const out: Reason[] = [];
  const blocks = [...plan.byId.values()]
    .filter((o) => o.status === 'open' && o.dependsOn.includes(id))
    .map((o) => o.title);
  if (blocks.length > 0) out.push({ type: 'blocks', titles: blocks });
  const due = Math.min(t.due ?? Infinity, t.softDue ?? Infinity);
  if (!override && due !== Infinity) out.push({ type: 'due', due });
  const below = plan.belief.belowCount(id, (o) => plan.byId.get(o)?.status === 'open');
  if (below > 0) out.push({ type: 'above', count: below });
  if ((plan.scored.get(id)?.scarcity ?? 0) >= 1) out.push({ type: 'scarce' });
  if (out.length === 0 && !override) out.push({ type: 'top' });
  return out;
}
