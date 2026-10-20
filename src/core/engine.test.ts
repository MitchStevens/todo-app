import { describe, expect, it } from 'vitest';
import { confidence, DAY, eventTimes, volatility } from './confidence';
import {
  buildPlan,
  candidates,
  newSession,
  nextStep,
  recordAsked,
  recordWin,
  type Question,
  type Session,
} from './engine';
import { buildBelief, wouldCreateDependencyCycle } from './graph';
import { autoResolve, train } from './tradeoff';
import { emptyData, type Comparison, type Data, type Situation, type Task, type Tradeoff } from './types';

const NOW = Date.UTC(2026, 9, 21);
const HOME: Situation = { minutes: 60, contexts: ['home'], energy: 'sharp' };

let seq = 0;
function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    notes: '',
    createdAt: NOW - 10 * DAY + seq++,
    editedAt: 0,
    contexts: [],
    energy: 'any',
    dependsOn: [],
    status: 'open',
    ...extra,
  };
}

function cmp(a: string, b: string, result: Comparison['result'], extra: Partial<Comparison> = {}): Comparison {
  return { id: `c${seq++}`, a, b, result, at: NOW - DAY, latencyMs: 1000, kind: 'initial', contexts: [], ...extra };
}

function data(tasks: Task[], comparisons: Comparison[] = [], tradeoffs: Tradeoff[] = []): Data {
  for (const t of tasks) if (t.editedAt === 0) t.editedAt = t.createdAt;
  return { ...emptyData(), tasks, comparisons, tradeoffs };
}

/** Answer every question from a hidden true ranking, as the UI would. */
function runSession(d: Data, truth: string[], situation = HOME, session: Session = newSession(NOW)) {
  const questions: Question[] = [];
  for (let guard = 0; guard < 200; guard++) {
    const plan = buildPlan(d, situation, NOW);
    const step = nextStep(plan, session, NOW);
    if (step.type !== 'question') return { step, questions };
    const q = step.question;
    questions.push(q);
    const aWins = truth.indexOf(q.a) < truth.indexOf(q.b);
    const [winner, loser] = aWins ? [q.a, q.b] : [q.b, q.a];
    if (q.type === 'importance') {
      d.comparisons.push(cmp(q.a, q.b, aWins ? 'a' : 'b', { at: NOW }));
      recordAsked(session, q, winner);
    } else {
      recordAsked(session, q);
      recordWin(session, winner, loser);
    }
  }
  throw new Error('session did not finish');
}

describe('belief', () => {
  it('orders tasks transitively from answers', () => {
    const tasks = [task('a'), task('b'), task('c')];
    const d = data(tasks, [cmp('a', 'b', 'a'), cmp('b', 'c', 'a')]);
    const belief = buildBelief(d.tasks, d.comparisons, NOW);
    expect(belief.above('a', 'c')).toBe(true);
    expect(belief.above('c', 'a')).toBe(false);
    expect(belief.belowCount('a')).toBe(2);
  });

  it('keeps the order acyclic and reports the weakest contradicting answer as a conflict', () => {
    const tasks = [task('a'), task('b'), task('c')];
    const d = data(tasks, [
      cmp('a', 'b', 'a'),
      cmp('b', 'c', 'a'),
      cmp('c', 'a', 'a', { latencyMs: 10_000 }), // slow, so least trusted
    ]);
    const belief = buildBelief(d.tasks, d.comparisons, NOW);
    expect(belief.conflicts).toHaveLength(1);
    expect(belief.conflicts[0]).toMatchObject({ from: 'c', to: 'a' });
    expect(belief.above('a', 'c')).toBe(true);
  });

  it('makes a blocker at least as important as what it blocks', () => {
    const tasks = [task('blocker'), task('big', { dependsOn: ['blocker'] }), task('small')];
    const d = data(tasks, [cmp('big', 'small', 'a')]);
    const belief = buildBelief(d.tasks, d.comparisons, NOW);
    expect(belief.above('blocker', 'small')).toBe(true);
  });

  it('reports an importance answer that contradicts a dependency', () => {
    const tasks = [task('blocker'), task('big', { dependsOn: ['blocker'] }), task('c')];
    const d = data(tasks, [cmp('big', 'c', 'a'), cmp('c', 'blocker', 'a', { latencyMs: 9000 })]);
    const belief = buildBelief(d.tasks, d.comparisons, NOW);
    expect(belief.conflicts.map((e) => [e.from, e.to])).toEqual([['c', 'blocker']]);
  });

  it('treats "can\'t compare" as incomparable rather than ordered', () => {
    const d = data([task('a'), task('b')], [cmp('a', 'b', 'incomparable')]);
    const belief = buildBelief(d.tasks, d.comparisons, NOW);
    expect(belief.comparable('a', 'b')).toBe(false);
    expect(belief.incomparable.size).toBe(1);
  });

  it('rejects dependency cycles', () => {
    const tasks = [task('a'), task('b', { dependsOn: ['a'] })];
    expect(wouldCreateDependencyCycle(tasks, 'a', 'b')).toBe(true);
    expect(wouldCreateDependencyCycle(tasks, 'b', 'a')).toBe(false);
  });
});

describe('confidence', () => {
  it('decays with age, with changes since, and with slow answers', () => {
    const a = task('a', { createdAt: NOW - 200 * DAY });
    const b = task('b', { createdAt: NOW - 200 * DAY });
    for (const t of [a, b]) t.editedAt = t.createdAt;
    const inputs = (tasks: Task[], comparisons: Comparison[]) => ({
      now: NOW,
      events: eventTimes(tasks),
      tasks: new Map(tasks.map((t) => [t.id, t])),
      volatility: volatility(comparisons),
    });
    const fresh = cmp('a', 'b', 'a', { at: NOW });
    const old = cmp('a', 'b', 'a', { at: NOW - 60 * DAY });
    const slow = cmp('a', 'b', 'a', { at: NOW, latencyMs: 10_000 });
    const base = inputs([a, b], [fresh]);
    expect(confidence(fresh, base)).toBeCloseTo(1);
    expect(confidence(old, base)).toBeCloseTo(0.5);
    expect(confidence(slow, base)).toBeCloseTo(0.6);

    const busy = [a, b, ...Array.from({ length: 10 }, (_, i) => task(`n${i}`, { createdAt: NOW - DAY / 2 }))];
    const earlier = cmp('a', 'b', 'a', { at: NOW - DAY });
    expect(confidence(earlier, inputs(busy, [earlier]))).toBeLessThan(0.75);
  });

  it('ignores answers from before a task was reset', () => {
    const a = task('a', { resetAt: NOW });
    const b = task('b');
    const c = cmp('a', 'b', 'a');
    const belief = buildBelief(data([a, b]).tasks, [c], NOW);
    expect(belief.comparable('a', 'b')).toBe(false);
  });
});

describe('session', () => {
  it('finds the top task in exactly m − 1 non-redundant questions', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const d = data(ids.map((id) => task(id)));
    const truth = ['f', 'c', 'h', 'a', 'b', 'd', 'e', 'g'];
    const session = newSession(NOW, Infinity);
    const { step, questions } = runSession(d, truth, HOME, session);
    expect(step).toMatchObject({ type: 'suggest', task: 'f' });
    expect(questions).toHaveLength(ids.length - 1);
    expect(questions.every((q) => q.type === 'importance' && q.kind === 'initial')).toBe(true);
  });

  it('pairs like a bracket, so the winner beats only about log₂ m tasks directly', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const d = data(ids.map((id) => task(id)));
    runSession(d, ids, HOME, newSession(NOW, Infinity));
    const winnerAnswers = d.comparisons.filter((c) => c.a === 'a' || c.b === 'a');
    expect(winnerAnswers).toHaveLength(3);
  });

  it('only considers tasks that fit the situation', () => {
    const d = data([
      task('long', { duration: 120 }),
      task('car', { contexts: ['car'] }),
      task('focus', { energy: 'focused' }),
      task('blocked', { dependsOn: ['long'] }),
      task('ok'),
    ]);
    const tired: Situation = { minutes: 30, contexts: ['home'], energy: 'tired' };
    const plan = buildPlan(d, tired, NOW);
    expect(plan.feasible.map((t) => t.id)).toEqual(['ok']);
    expect(nextStep(plan, newSession(NOW), NOW)).toMatchObject({ type: 'suggest', task: 'ok' });
  });

  it('puts a deadline that is about to be missed first, without questions', () => {
    const d = data([task('a'), task('b'), task('due', { due: NOW + DAY })]);
    const step = nextStep(buildPlan(d, HOME, NOW), newSession(NOW), NOW);
    expect(step).toMatchObject({ type: 'suggest', task: 'due', override: true });
  });

  it('asks "which first?" when importance and urgency disagree', () => {
    const d = data(
      [task('important'), task('urgent', { softDue: NOW + 3 * DAY })],
      [cmp('important', 'urgent', 'a')],
    );
    const step = nextStep(buildPlan(d, HOME, NOW), newSession(NOW), NOW);
    expect(step).toMatchObject({ type: 'question', question: { type: 'tradeoff' } });
  });

  it('asks "which first?" for a pair the user can\'t compare', () => {
    const d = data([task('a'), task('b')], [cmp('a', 'b', 'incomparable')]);
    const step = nextStep(buildPlan(d, HOME, NOW), newSession(NOW), NOW);
    expect(step).toMatchObject({ type: 'question', question: { type: 'tradeoff' } });
  });

  it('suggests something when time runs out', () => {
    const d = data([task('a'), task('b'), task('c')]);
    const session = newSession(NOW - 60_000);
    expect(nextStep(buildPlan(d, HOME, NOW), session, NOW).type).toBe('suggest');
  });

  it('never suggests a task excluded this session', () => {
    const d = data([task('a'), task('b')], [cmp('a', 'b', 'a')]);
    const session = newSession(NOW);
    session.excluded.add('a');
    expect(nextStep(buildPlan(d, HOME, NOW), session, NOW)).toMatchObject({ type: 'suggest', task: 'b' });
  });

  it('challenges a weak answer that buries a feasible task', () => {
    const old = { createdAt: NOW - 200 * DAY };
    const d = data(
      [task('a', old), task('b', old), task('c', old), task('d', old)],
      [cmp('a', 'd', 'a', { at: NOW - 70 * DAY, latencyMs: 6000 })],
    );
    const session = newSession(NOW, Infinity);
    session.asked = 2;
    const step = nextStep(buildPlan(d, HOME, NOW), session, NOW);
    expect(step).toMatchObject({ type: 'question', question: { type: 'importance', kind: 'challenge', a: 'a', b: 'd' } });
  });
});

describe('trade-off model', () => {
  it('learns that this user favors urgency, then settles pairs itself', () => {
    const tradeoffs: Tradeoff[] = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      chosen: 'x',
      other: 'y',
      at: NOW,
      features: [-1, 2, 0], // picked the less important but more urgent task
      source: 'question',
    }));
    const w = train(tradeoffs);
    expect(autoResolve(w, tradeoffs.length, [-1, 2, 0])).toBe('a');
    expect(autoResolve(w, tradeoffs.length, [1, -2, 0])).toBe('b');
    expect(autoResolve(w, 3, [-1, 2, 0])).toBeNull();
  });

  it('removes questions once confident', () => {
    const d = data([task('important'), task('urgent', { softDue: NOW + 3 * DAY })], [cmp('important', 'urgent', 'a')]);
    d.tradeoffs = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      chosen: 'u',
      other: 'i',
      at: NOW,
      features: [-1, 2, 0],
      source: 'question' as const,
    }));
    const step = nextStep(buildPlan(d, HOME, NOW), newSession(NOW), NOW);
    expect(step).toMatchObject({ type: 'suggest', task: 'urgent' });
  });
});

describe('candidates', () => {
  it('is the set of tasks nothing beats on every dimension', () => {
    const d = data([task('a'), task('b'), task('c')], [cmp('a', 'b', 'a')]);
    const plan = buildPlan(d, HOME, NOW);
    expect(candidates(plan, ['a', 'b', 'c']).sort()).toEqual(['a', 'c']);
  });
});
