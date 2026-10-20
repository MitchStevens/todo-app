import { confidence, eventTimes, pairKey, volatility, winner } from './confidence';
import type { Comparison, Id, Task } from './types';

/** Net confidence a pair needs before it counts as ordered. */
export const MIN_EDGE_CONFIDENCE = 0.25;

/** A derived edge: `from` matters more than `to`. */
export interface Edge {
  from: Id;
  to: Id;
  confidence: number;
  source: 'importance' | 'dependency';
  /** Comparison ids behind an importance edge, oldest first. */
  evidence: Id[];
}

/**
 * The app's current beliefs, recomputed from the evidence.
 *
 * `edges` is EFFECTIVE from the README: resolved importance edges plus a
 * blocker → blocked edge for every dependency. It is always acyclic.
 * Importance edges that would have closed a cycle are kept in `conflicts`.
 */
export interface Belief {
  edges: Edge[];
  conflicts: Edge[];
  /** Pairs the user recently said they can't compare. */
  incomparable: Set<string>;
  /** `a` is known to matter more than `b`, directly or by transitivity. */
  above(a: Id, b: Id): boolean;
  comparable(a: Id, b: Id): boolean;
  /** Number of tasks known to matter less than `id`. */
  belowCount(id: Id, filter?: (id: Id) => boolean): number;
}

export function buildBelief(tasks: Task[], comparisons: Comparison[], now: number): Belief {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const inputs = {
    now,
    events: eventTimes(tasks),
    tasks: byId,
    volatility: volatility(comparisons),
  };

  // Weigh every answer on each pair. Positive net favors the smaller id.
  const net = new Map<string, number>();
  const inc = new Map<string, number>();
  const evidence = new Map<string, Comparison[]>();
  for (const c of comparisons) {
    const conf = confidence(c, inputs);
    if (conf === 0) continue;
    const k = pairKey(c.a, c.b);
    const list = evidence.get(k);
    if (list) list.push(c);
    else evidence.set(k, [c]);
    const w = winner(c);
    if (w === undefined) {
      inc.set(k, (inc.get(k) ?? 0) + conf);
    } else {
      const lo = c.a < c.b ? c.a : c.b;
      net.set(k, (net.get(k) ?? 0) + (w === lo ? conf : -conf));
    }
  }

  const candidates: Edge[] = [];
  const incomparable = new Set<string>();
  for (const [k, list] of evidence) {
    const s = net.get(k) ?? 0;
    const i = inc.get(k) ?? 0;
    if (i >= MIN_EDGE_CONFIDENCE && i >= Math.abs(s)) {
      incomparable.add(k);
      continue;
    }
    if (Math.abs(s) < MIN_EDGE_CONFIDENCE) continue;
    const [lo, hi] = k.split('|');
    candidates.push({
      from: s > 0 ? lo : hi,
      to: s > 0 ? hi : lo,
      confidence: Math.min(1, Math.abs(s)),
      source: 'importance',
      evidence: list.sort((x, y) => x.at - y.at).map((c) => c.id),
    });
  }

  // Add dependency edges first (hard), then importance edges strongest first,
  // skipping any that would close a cycle.
  const ids = tasks.map((t) => t.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const adj: number[][] = ids.map(() => []);
  const reaches = (from: number, to: number): boolean => {
    const seen = new Uint8Array(ids.length);
    const stack = [from];
    while (stack.length) {
      const u = stack.pop()!;
      if (u === to) return true;
      if (seen[u]) continue;
      seen[u] = 1;
      for (const v of adj[u]) stack.push(v);
    }
    return false;
  };

  const edges: Edge[] = [];
  const conflicts: Edge[] = [];
  const tryAdd = (e: Edge): boolean => {
    const u = index.get(e.from);
    const v = index.get(e.to);
    if (u === undefined || v === undefined) return false;
    if (reaches(v, u)) return false;
    adj[u].push(v);
    edges.push(e);
    return true;
  };

  for (const t of tasks) {
    for (const d of t.dependsOn) {
      if (byId.has(d)) {
        tryAdd({ from: d, to: t.id, confidence: 1, source: 'dependency', evidence: [] });
      }
    }
  }
  candidates.sort((x, y) => y.confidence - x.confidence);
  for (const e of candidates) {
    if (!tryAdd(e)) conflicts.push(e);
  }

  // Transitive closure, one bitmap row per node.
  const n = ids.length;
  const reach: Uint8Array[] = ids.map(() => new Uint8Array(n));
  const done = new Uint8Array(n);
  const visit = (u: number) => {
    if (done[u]) return;
    done[u] = 1;
    const row = reach[u];
    for (const v of adj[u]) {
      visit(v);
      row[v] = 1;
      const sub = reach[v];
      for (let i = 0; i < n; i++) if (sub[i]) row[i] = 1;
    }
  };
  for (let u = 0; u < n; u++) visit(u);

  const above = (a: Id, b: Id): boolean => {
    const u = index.get(a);
    const v = index.get(b);
    return u !== undefined && v !== undefined && reach[u][v] === 1;
  };

  return {
    edges,
    conflicts,
    incomparable,
    above,
    comparable: (a, b) => above(a, b) || above(b, a),
    belowCount: (id, filter) => {
      const u = index.get(id);
      if (u === undefined) return 0;
      let count = 0;
      for (let i = 0; i < n; i++) if (reach[u][i] && (!filter || filter(ids[i]))) count++;
      return count;
    },
  };
}

/** Would making `task` depend on `blocker` create a dependency cycle? */
export function wouldCreateDependencyCycle(tasks: Task[], task: Id, blocker: Id): boolean {
  if (task === blocker) return true;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // A cycle exists if `blocker` already depends, directly or not, on `task`.
  const stack = [blocker];
  const seen = new Set<Id>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === task) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of byId.get(id)?.dependsOn ?? []) stack.push(d);
  }
  return false;
}
